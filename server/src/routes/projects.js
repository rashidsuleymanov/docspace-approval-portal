import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  cancelFlow,
  createProject,
  createProjectContact,
  deleteProject,
  deleteProjectContact,
  getProject,
  listFlowsForRoom,
  listFlowsForUser,
  listProjectContacts,
  listProjects,
  updateProject,
  updateProjectContact
} from "../store.js";
import { archiveRoom, createRoom, getRoomInfo, getRoomSecurityInfo, getSelfProfileWithToken, listRooms, shareRoom, unarchiveRoom } from "../docspaceClient.js";
import { getConfig, updateConfig } from "../config.js";

const router = Router();

function normalizeEmailList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  return String(value)
    .split(/[,\n;]/g)
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function requireUserToken(req) {
  const auth = String(req.headers.authorization || "").trim();
  if (!auth) {
    const err = new Error("Authorization token is required");
    err.status = 401;
    throw err;
  }
  return auth;
}

function isRoomAdminAccess(access) {
  if (typeof access === "number") return access >= 7;
  const v = String(access || "").trim().toLowerCase();
  if (/^\d+$/.test(v) && Number(v) >= 7) return true;
  return v === "roommanager" || v === "roomadmin";
}

function normalizeRoomAccess(access) {
  // For DocSpace room sharing (`PUT /files/rooms/{id}/share`), access values are expected as strings
  // like "FillForms", "ReadWrite", "RoomManager", etc. The share-info API may return numeric codes,
  // so we accept both and normalize to canonical strings.
  const byCode = {
    0: "Deny",
    1: "Read",
    2: "ReadWrite",
    3: "Review",
    4: "Comment",
    5: "FillForms",
    6: "ContentCreator",
    7: "RoomManager"
  };

  if (access === undefined || access === null) return "FillForms";
  if (typeof access === "number") return byCode[access] || "FillForms";

  const raw = String(access || "").trim();
  if (!raw) return "FillForms";

  const lower = raw.toLowerCase();
  if (/^\d+$/.test(lower)) return byCode[Number(lower)] || "FillForms";

  if (lower === "deny" || lower === "none") return "Deny";
  if (lower === "read") return "Read";
  if (lower === "readwrite") return "ReadWrite";
  if (lower === "review") return "Review";
  if (lower === "comment") return "Comment";
  if (lower === "fillforms") return "FillForms";
  if (lower === "contentcreator") return "ContentCreator";
  if (lower === "roommanager" || lower === "roomadmin") return "RoomManager";

  return "FillForms";
}

function roomMembersFromSecurityInfo(security) {
  if (!security) return [];
  if (Array.isArray(security)) return security;
  if (Array.isArray(security?.members)) return security.members;
  if (Array.isArray(security?.response)) return security.response;
  if (Array.isArray(security?.shared)) return security.shared;
  if (Array.isArray(security?.items)) return security.items;
  return [];
}

function canManageRoomFromSecurityInfo(security, userId) {
  const uid = String(userId || "").trim();
  if (!uid) return false;
  const members = roomMembersFromSecurityInfo(security);
  const me =
    members.find((m) => String(m?.user?.id || m?.sharedTo?.id || "").trim() === uid) ||
    null;
  if (!me) return false;
  return Boolean(me?.isOwner) || isRoomAdminAccess(me?.access);
}

function isAlreadyArchivedError(error) {
  const msg = String(error?.message || "").toLowerCase();
  if (!msg) return false;
  return msg.includes("already") && msg.includes("archiv");
}

function isAlreadyUnarchivedError(error) {
  const msg = String(error?.message || "").toLowerCase();
  if (!msg) return false;
  return msg.includes("already") && (msg.includes("unarchiv") || msg.includes("restor"));
}

async function runRoomActionWithFallback(action, roomId, auth) {
  const rid = String(roomId || "").trim();
  if (!rid) return { roomId: "", ok: false, error: "roomId is required", via: null };

  try {
    // eslint-disable-next-line no-await-in-loop
    const result = await action(rid, auth);
    const operationId = String(result?.operationId || result?.id || "").trim() || null;
    const pending = Boolean(result?.pending);
    return { roomId: rid, ok: true, error: null, via: "user", operationId, pending };
  } catch (e) {
    const alreadyOk = action === archiveRoom ? isAlreadyArchivedError(e) : isAlreadyUnarchivedError(e);
    if (alreadyOk) return { roomId: rid, ok: true, error: null, via: "noop", operationId: null, pending: false };

    if (e?.status === 403) {
      console.warn(`[projects] user token 403 on room ${rid}, retrying with admin credentials`);
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await action(rid);
        const operationId = String(result?.operationId || result?.id || "").trim() || null;
        const pending = Boolean(result?.pending);
        return { roomId: rid, ok: true, error: null, via: "admin", operationId, pending };
      } catch (e2) {
        const alreadyOk2 = action === archiveRoom ? isAlreadyArchivedError(e2) : isAlreadyUnarchivedError(e2);
        if (alreadyOk2) return { roomId: rid, ok: true, error: null, via: "noop", operationId: null, pending: false };
        return { roomId: rid, ok: false, error: e2?.message || "Room action failed", via: "admin", operationId: null, pending: false };
      }
    }

    return { roomId: rid, ok: false, error: e?.message || "Room action failed", via: "user", operationId: null, pending: false };
  }
}

router.get("/", (_req, res) => {
  res.status(501).json({ error: "Use /sidebar with Authorization token" });
});

router.get("/permissions", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const user = await getSelfProfileWithToken(auth);
    const userId = String(user?.id || "").trim();
    if (!userId) return res.status(401).json({ error: "Invalid user token" });

    const projects = listProjects();
    const pairs = await Promise.all(
      projects.map(async (p) => {
        const pid = String(p?.id || "").trim();
        const roomId = String(p?.roomId || "").trim();
        if (!pid || !roomId) return [pid, false];
        const security = await getRoomSecurityInfo(roomId, auth).catch(() => null);
        const members = roomMembersFromSecurityInfo(security);
        const isMember = members.some((m) => String(m?.user?.id || m?.sharedTo?.id || "").trim() === userId);
        const canManage = isMember ? canManageRoomFromSecurityInfo(security, userId) : false;
        return [pid, canManage];
      })
    );

    res.json({ userId, permissions: Object.fromEntries(pairs.filter((x) => x?.[0])) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.get("/active", (_req, res) => {
  res.status(501).json({ error: "Use /sidebar with Authorization token" });
});

router.get("/list", (req, res) => {
  (async () => {
    try {
      const auth = requireUserToken(req);
      const user = await getSelfProfileWithToken(auth);
      const userId = String(user?.id || "").trim();
      if (!userId) return res.status(401).json({ error: "Invalid user token" });
      const userEmail = String(user?.email || "").trim().toLowerCase();

      const rooms = await listRooms(auth).catch(() => []);
      const accessibleRoomIds = new Set((rooms || []).map((r) => String(r?.id || "").trim()).filter(Boolean));
      if (!accessibleRoomIds.size) {
        const projects = listProjects();
        const checks = await Promise.all(
          projects.map(async (p) => {
            const roomId = String(p?.roomId || "").trim();
            if (!roomId) return null;
            const room = await getRoomInfo(roomId, auth).catch(() => null);
            return room?.id ? String(room.id) : null;
          })
        );
        for (const rid of checks) {
          if (rid) accessibleRoomIds.add(String(rid).trim());
        }
      }

      const cfg = getConfig();
      const configuredActiveRoomId = String(cfg.formsRoomId || "").trim();
      const activeRoomId = configuredActiveRoomId && accessibleRoomIds.has(configuredActiveRoomId) ? configuredActiveRoomId : "";

      const flows = listFlowsForUser({ userId, userEmail });
      const countsByRoomId = new Map();
      for (const flow of flows) {
        if (flow?.trashedAt) continue;
        if (flow?.archivedAt) continue;
        const roomId = String(flow?.projectRoomId || "").trim();
        if (!roomId) continue;
        if (!accessibleRoomIds.has(roomId)) continue;
        const entry = countsByRoomId.get(roomId) || { total: 0, inProgress: 0, completed: 0, other: 0 };
        entry.total += 1;
        if (flow.status === "InProgress") entry.inProgress += 1;
        else if (flow.status === "Completed") entry.completed += 1;
        else entry.other += 1;
        countsByRoomId.set(roomId, entry);
      }

      const projects = listProjects()
        .filter((p) => accessibleRoomIds.has(String(p?.roomId || "").trim()))
        .map((p) => {
          const roomId = String(p.roomId || "").trim();
          const counts = roomId ? countsByRoomId.get(roomId) : null;
          return {
            id: p.id,
            title: p.title,
            roomId: p.roomId,
            roomUrl: p.roomUrl || null,
            archivedAt: p.archivedAt || null,
            archivedByName: p.archivedByName || null,
            isCurrent: activeRoomId && String(p.roomId) === activeRoomId,
            counts: counts || { total: 0, inProgress: 0, completed: 0, other: 0 }
          };
        });

      res.json({ activeRoomId: activeRoomId || null, projects });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message, details: error.details || null });
    }
  })();
});

router.get("/sidebar", (req, res) => {
  (async () => {
    try {
      const auth = requireUserToken(req);
      const user = await getSelfProfileWithToken(auth);
      const userId = String(user?.id || "").trim();
      if (!userId) return res.status(401).json({ error: "Invalid user token" });
      const userEmail = String(user?.email || "").trim().toLowerCase();

      const rooms = await listRooms(auth).catch(() => []);
      const accessibleRoomIds = new Set((rooms || []).map((r) => String(r?.id || "").trim()).filter(Boolean));
      if (!accessibleRoomIds.size) {
        const projects = listProjects();
        const checks = await Promise.all(
          projects.map(async (p) => {
            const roomId = String(p?.roomId || "").trim();
            if (!roomId) return null;
            const room = await getRoomInfo(roomId, auth).catch(() => null);
            return room?.id ? String(room.id) : null;
          })
        );
        for (const rid of checks) {
          if (rid) accessibleRoomIds.add(String(rid).trim());
        }
      }

      const cfg = getConfig();
      const configuredActiveRoomId = String(cfg.formsRoomId || "").trim();
      // In demo mode, prefer the requester's project room as the active room.
      const demoProjectRoomId = req.demoSession?.requester?.projectRoomId
        ? String(req.demoSession.requester.projectRoomId)
        : null;
      const activeRoomId =
        (demoProjectRoomId && accessibleRoomIds.has(demoProjectRoomId) ? demoProjectRoomId : null) ||
        (configuredActiveRoomId && accessibleRoomIds.has(configuredActiveRoomId) ? configuredActiveRoomId : "") ||
        "";

      const flows = listFlowsForUser({ userId, userEmail });
      const countsByRoomId = new Map();
      for (const flow of flows) {
        if (flow?.trashedAt) continue;
        if (flow?.archivedAt) continue;
        const roomId = String(flow?.projectRoomId || "").trim();
        if (!roomId) continue;
        if (!accessibleRoomIds.has(roomId)) continue;
        const entry = countsByRoomId.get(roomId) || { total: 0, inProgress: 0, completed: 0, other: 0 };
        entry.total += 1;
        if (flow.status === "InProgress") entry.inProgress += 1;
        else if (flow.status === "Completed") entry.completed += 1;
        else entry.other += 1;
        countsByRoomId.set(roomId, entry);
      }

      const projects = listProjects()
        .filter((p) => accessibleRoomIds.has(String(p?.roomId || "").trim()))
        .map((p) => {
          const roomId = String(p.roomId || "").trim();
          const counts = roomId ? countsByRoomId.get(roomId) : null;
          return {
            id: p.id,
            title: p.title,
            roomId: p.roomId,
            roomUrl: p.roomUrl || null,
            archivedAt: p.archivedAt || null,
            isCurrent: activeRoomId && String(p.roomId) === activeRoomId,
            counts: counts || { total: 0, inProgress: 0, completed: 0, other: 0 }
          };
        });

      res.json({
        activeRoomId: activeRoomId || null,
        projects
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message, details: error.details || null });
    }
  })();
});

router.get("/:projectId/members", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const project = getProject(req.params.projectId);
    if (!project?.roomId) return res.status(404).json({ error: "Project not found" });

    const me = await getSelfProfileWithToken(auth).catch(() => null);
    const meId = String(me?.id || "").trim();
    if (!meId) return res.status(401).json({ error: "Invalid user token" });

    const security = await getRoomSecurityInfo(project.roomId, auth).catch((e) => {
      const err = new Error(e?.message || "Failed to load room members");
      err.status = e?.status || 500;
      err.details = e?.details || null;
      throw err;
    });

    const members = roomMembersFromSecurityInfo(security);
    if (!members.length) return res.status(403).json({ error: "No access to this project room" });
    const isMember = members.some((m) => String(m?.user?.id || m?.sharedTo?.id || "").trim() === meId);
    if (!isMember) return res.status(403).json({ error: "No access to this project room" });

    const normalized = members.map((m) => ({
      subjectType: m?.subjectType ?? null,
      access: m?.access ?? null,
      isOwner: Boolean(m?.isOwner),
      canEditAccess: Boolean(m?.canEditAccess),
      canRevoke: Boolean(m?.canRevoke),
      user: (m?.user || m?.sharedTo || null)
        ? {
            id: (m?.user || m?.sharedTo).id ?? null,
            displayName: (m?.user || m?.sharedTo).displayName || (m?.user || m?.sharedTo).userName || "",
            email: (m?.user || m?.sharedTo).email || ""
          }
        : null,
      group: m?.group
        ? {
            id: m.group.id ?? null,
            name: m.group.name || ""
          }
        : null
    }));

    res.json({
      project: { id: project.id, title: project.title, roomId: project.roomId, roomUrl: project.roomUrl || null },
      members: normalized
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.delete("/:projectId/members/:userId", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const project = getProject(req.params.projectId);
    if (!project?.roomId) return res.status(404).json({ error: "Project not found" });

    const user = await getSelfProfileWithToken(auth);
    const userId = String(user?.id || "").trim();
    if (!userId) return res.status(401).json({ error: "Invalid user token" });

    const targetUserId = String(req.params.userId || "").trim();
    if (!targetUserId) return res.status(400).json({ error: "userId is required" });
    if (targetUserId === userId) return res.status(400).json({ error: "You cannot remove yourself" });

    const security =
      (await getRoomSecurityInfo(project.roomId, auth).catch(() => null)) ||
      (await getRoomSecurityInfo(project.roomId).catch((e) => {
        const err = new Error(e?.message || "Failed to load room members");
        err.status = e?.status || 500;
        err.details = e?.details || null;
        throw err;
      }));

    if (!canManageRoomFromSecurityInfo(security, userId)) {
      return res.status(403).json({ error: "Only the room admin can remove members" });
    }

    const members = roomMembersFromSecurityInfo(security);
    const target =
      members.find((m) => String(m?.user?.id || m?.sharedTo?.id || "").trim() === targetUserId) || null;
    if (!target) return res.status(404).json({ error: "Member not found" });
    if (target?.isOwner) return res.status(403).json({ error: "Owner cannot be removed" });

    // DocSpace API doesn't have a dedicated "remove member" endpoint; revoking is done via share API.
    // Setting access to "Deny" removes access to the room for that user.
    const invitations = [{ id: targetUserId, access: normalizeRoomAccess("Deny") }];
    let shareResult = await shareRoom({ roomId: project.roomId, invitations, notify: false }, auth).catch((e) => e);
    if (shareResult instanceof Error) {
      // Fallback to server admin token (if configured) for setups where room-managers can't manage sharing via API.
      shareResult = await shareRoom({ roomId: project.roomId, invitations, notify: false }).catch((e) => {
        const err = new Error(e?.message || "Failed to remove member");
        err.status = e?.status || 500;
        err.details = e?.details || null;
        throw err;
      });
    }

    res.json({ ok: true, shareResult });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.delete("/:projectId", async (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project?.id) return res.status(404).json({ error: "Project not found" });

    const auth = requireUserToken(req);
    const user = await getSelfProfileWithToken(auth);
    const userId = String(user?.id || "").trim();
    if (!userId) return res.status(401).json({ error: "Invalid user token" });
    const security =
      (await getRoomSecurityInfo(project.roomId, auth).catch(() => null)) ||
      (await getRoomSecurityInfo(project.roomId).catch(() => null));
    if (!canManageRoomFromSecurityInfo(security, userId)) {
      return res.status(403).json({ error: "Only the room admin can remove projects" });
    }

    const ok = deleteProject(project.id);
    const cfg = getConfig();
    if (ok && String(cfg.formsRoomId || "").trim() && String(cfg.formsRoomId) === String(project.roomId)) {
      await updateConfig({ formsRoomId: "", formsRoomTitle: "" }).catch(() => null);
    }

    res.json({ ok: Boolean(ok) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.get("/:projectId/contacts", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const project = getProject(req.params.projectId);
    if (!project?.roomId) return res.status(404).json({ error: "Project not found" });

    const me = await getSelfProfileWithToken(auth).catch(() => null);
    const meId = String(me?.id || "").trim();
    if (!meId) return res.status(401).json({ error: "Invalid user token" });

    const security = await getRoomSecurityInfo(project.roomId, auth).catch(() => null);
    const members = roomMembersFromSecurityInfo(security);
    const isMember = members.some((m) => String(m?.user?.id || m?.sharedTo?.id || "").trim() === meId);
    if (!isMember) return res.status(403).json({ error: "No access to this project room" });

    const canManage = canManageRoomFromSecurityInfo(security, meId);
    const contacts = listProjectContacts(project.id);
    res.json({ project: { id: project.id, title: project.title }, canManage, contacts });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/:projectId/contacts", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const project = getProject(req.params.projectId);
    if (!project?.roomId) return res.status(404).json({ error: "Project not found" });

    const me = await getSelfProfileWithToken(auth).catch(() => null);
    const meId = String(me?.id || "").trim();
    if (!meId) return res.status(401).json({ error: "Invalid user token" });

    const security = await getRoomSecurityInfo(project.roomId, auth).catch(() => null);
    if (!canManageRoomFromSecurityInfo(security, meId)) {
      return res.status(403).json({ error: "Only the project admin can manage team contacts" });
    }

    const { name, email, tags } = req.body || {};
    const mail = String(email || "").trim().toLowerCase();
    if (!mail) return res.status(400).json({ error: "email is required" });
    const tagList = Array.isArray(tags) ? tags : [];

    const displayName =
      me?.displayName ||
      [me?.firstName, me?.lastName].filter(Boolean).join(" ") ||
      me?.userName ||
      me?.email ||
      "User";

    const created = createProjectContact({
      id: randomUUID(),
      projectId: project.id,
      name: String(name || "").trim() || mail,
      email: mail,
      tags: tagList,
      createdByUserId: meId,
      createdByName: displayName
    });
    if (!created) return res.status(500).json({ error: "Failed to create contact" });
    res.json({ contact: created });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.put("/:projectId/contacts/:contactId", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const project = getProject(req.params.projectId);
    if (!project?.roomId) return res.status(404).json({ error: "Project not found" });

    const me = await getSelfProfileWithToken(auth).catch(() => null);
    const meId = String(me?.id || "").trim();
    if (!meId) return res.status(401).json({ error: "Invalid user token" });

    const security = await getRoomSecurityInfo(project.roomId, auth).catch(() => null);
    if (!canManageRoomFromSecurityInfo(security, meId)) {
      return res.status(403).json({ error: "Only the project admin can manage team contacts" });
    }

    const cid = String(req.params.contactId || "").trim();
    if (!cid) return res.status(400).json({ error: "contactId is required" });

    const mine = listProjectContacts(project.id).some((c) => String(c?.id || "").trim() === cid);
    if (!mine) return res.status(404).json({ error: "Contact not found" });

    const { name, email, tags } = req.body || {};
    const next = updateProjectContact(cid, {
      name: name !== undefined ? String(name || "").trim() : undefined,
      email: email !== undefined ? String(email || "").trim().toLowerCase() : undefined,
      tags: tags !== undefined ? (Array.isArray(tags) ? tags : []) : undefined
    });
    if (!next) return res.status(404).json({ error: "Contact not found" });
    res.json({ contact: next });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.delete("/:projectId/contacts/:contactId", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const project = getProject(req.params.projectId);
    if (!project?.roomId) return res.status(404).json({ error: "Project not found" });

    const me = await getSelfProfileWithToken(auth).catch(() => null);
    const meId = String(me?.id || "").trim();
    if (!meId) return res.status(401).json({ error: "Invalid user token" });

    const security = await getRoomSecurityInfo(project.roomId, auth).catch(() => null);
    if (!canManageRoomFromSecurityInfo(security, meId)) {
      return res.status(403).json({ error: "Only the project admin can manage team contacts" });
    }

    const cid = String(req.params.contactId || "").trim();
    if (!cid) return res.status(400).json({ error: "contactId is required" });

    const mine = listProjectContacts(project.id).some((c) => String(c?.id || "").trim() === cid);
    if (!mine) return res.status(404).json({ error: "Contact not found" });

    deleteProjectContact(cid);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/:projectId/archive", async (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project?.id || !project?.roomId) return res.status(404).json({ error: "Project not found" });

    const auth = requireUserToken(req);
    const user = await getSelfProfileWithToken(auth).catch(() => null);
    const userId = String(user?.id || "").trim();
    if (!userId) return res.status(401).json({ error: "Invalid user token" });

    const security =
      (await getRoomSecurityInfo(project.roomId, auth).catch(() => null)) ||
      (await getRoomSecurityInfo(project.roomId).catch(() => null));
    if (!canManageRoomFromSecurityInfo(security, userId)) {
      return res.status(403).json({ error: "Only the room admin can archive projects" });
    }

    const cancelOpenRequests = Boolean(req.body?.cancelOpenRequests);
    const roomId = String(project.roomId || "").trim();
    const openFlows = listFlowsForRoom(roomId).filter((f) => {
      if (f?.trashedAt) return false;
      const st = String(f?.status || "");
      return st !== "Completed" && st !== "Canceled";
    });
    if (openFlows.length && !cancelOpenRequests) {
      return res.status(409).json({
        error: "Project has open requests",
        openRequests: openFlows.length
      });
    }

    const roomIds = [String(project.roomId).trim(), String(project.signingRoomId || "").trim()]
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);

    const results = [];
    for (const rid of roomIds) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await runRoomActionWithFallback(archiveRoom, rid, auth);
      results.push(outcome);
    }

    const primaryRid = String(project.roomId || "").trim();
    const primary = results.find((r) => String(r?.roomId || "") === primaryRid) || null;
    if (!primary?.ok) {
      return res.status(502).json({
        error: "Failed to archive DocSpace room",
        details: primary?.error || null,
        rooms: results
      });
    }

    const failedSecondary = results.filter((r) => r?.roomId && r.roomId !== primaryRid && !r.ok);
    const pendingRooms = results.filter((r) => r?.roomId && r.pending);

    const displayName =
      user?.displayName ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      user?.userName ||
      user?.email ||
      "User";

    const now = new Date().toISOString();

    if (openFlows.length && cancelOpenRequests) {
      for (const f of openFlows) {
        const id = String(f?.id || "").trim();
        if (!id) continue;
        cancelFlow(id, { canceledByUserId: userId, canceledByName: displayName });
      }
    }

    updateProject(project.id, {
      archivedAt: now,
      archivedByUserId: userId,
      archivedByName: displayName
    });

    const cfg = getConfig();
    if (String(cfg.formsRoomId || "").trim() && String(cfg.formsRoomId) === String(project.roomId)) {
      await updateConfig({ formsRoomId: "", formsRoomTitle: "" }).catch(() => null);
    }

    res.json({
      ok: true,
      projectId: project.id,
      archivedAt: now,
      rooms: results,
      warning:
        failedSecondary.length || pendingRooms.length
          ? [
              failedSecondary.length ? "Some linked rooms could not be archived." : "",
              pendingRooms.length ? "DocSpace is still archiving one or more rooms. It may take a moment to appear in the Archive." : ""
            ]
              .filter(Boolean)
              .join(" ")
          : null,
      canceledRequests: cancelOpenRequests ? openFlows.length : 0
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/:projectId/unarchive", async (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project?.id || !project?.roomId) return res.status(404).json({ error: "Project not found" });

    const auth = requireUserToken(req);
    const user = await getSelfProfileWithToken(auth).catch(() => null);
    const userId = String(user?.id || "").trim();
    if (!userId) return res.status(401).json({ error: "Invalid user token" });

    const security =
      (await getRoomSecurityInfo(project.roomId, auth).catch(() => null)) ||
      (await getRoomSecurityInfo(project.roomId).catch(() => null));
    if (!canManageRoomFromSecurityInfo(security, userId)) {
      return res.status(403).json({ error: "Only the room admin can restore projects" });
    }

    const roomIds = [String(project.roomId).trim(), String(project.signingRoomId || "").trim()]
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);

    const results = [];
    for (const rid of roomIds) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await runRoomActionWithFallback(unarchiveRoom, rid, auth);
      results.push(outcome);
    }

    const primaryRid = String(project.roomId || "").trim();
    const primary = results.find((r) => String(r?.roomId || "") === primaryRid) || null;
    if (!primary?.ok) {
      return res.status(502).json({
        error: "Failed to restore DocSpace room",
        details: primary?.error || null,
        rooms: results
      });
    }

    const failedSecondary = results.filter((r) => r?.roomId && r.roomId !== primaryRid && !r.ok);
    const pendingRooms = results.filter((r) => r?.roomId && r.pending);

    updateProject(project.id, {
      archivedAt: null,
      archivedByUserId: null,
      archivedByName: null
    });

    res.json({
      ok: true,
      projectId: project.id,
      rooms: results,
      warning:
        failedSecondary.length || pendingRooms.length
          ? [
              failedSecondary.length ? "Some linked rooms could not be restored." : "",
              pendingRooms.length ? "DocSpace is still restoring one or more rooms. It may take a moment to re-appear." : ""
            ]
              .filter(Boolean)
              .join(" ")
          : null
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const user = await getSelfProfileWithToken(auth);
    const userId = String(user?.id || "").trim();
    if (!userId) return res.status(401).json({ error: "Invalid user token" });

    const { title } = req.body || {};
    const name = String(title || "").trim();
    if (!name) return res.status(400).json({ error: "title is required" });

    const created = await createRoom({ title: name, roomType: 1 });
    const roomId = created?.id ?? created?.response?.id ?? created?.folder?.id ?? null;
    if (!roomId) return res.status(500).json({ error: "Failed to determine created room id" });

    // Ensure the creator has access to the room, otherwise they won't see the project.
    const creatorInvite = { id: userId, access: normalizeRoomAccess("RoomManager") };
    const creatorEmail = String(user?.email || "").trim();
    const creatorEmailInvite = creatorEmail ? { email: creatorEmail, access: normalizeRoomAccess("RoomManager") } : null;
    let shareResult = await shareRoom({
      roomId: String(roomId),
      invitations: [creatorInvite],
      notify: false
    }).catch((e) => e);
    if (shareResult instanceof Error) {
      shareResult = creatorEmailInvite
        ? await shareRoom({ roomId: String(roomId), invitations: [creatorEmailInvite], notify: false }).catch((e) => e)
        : shareResult;
    }
    if (shareResult instanceof Error) {
      return res.status(500).json({
        error: "Project room created, but failed to grant access to its creator",
        details: shareResult?.details || null,
        roomId: String(roomId)
      });
    }

    const project = createProject({
      id: randomUUID(),
      title: name,
      roomId: String(roomId),
      roomUrl: created?.webUrl || created?.shortWebUrl || null
    });

    await updateConfig({ formsRoomId: String(roomId), formsRoomTitle: name }).catch(() => null);

    res.json({ project, activeRoomId: String(roomId) });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

router.post("/:projectId/activate", async (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project?.roomId) return res.status(404).json({ error: "Project not found" });
    await updateConfig({ formsRoomId: String(project.roomId), formsRoomTitle: project.title }).catch(() => null);
    res.json({ ok: true, activeRoomId: String(project.roomId) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/:projectId/invite", async (req, res) => {
  try {
    const project = getProject(req.params.projectId);
    if (!project?.roomId) return res.status(404).json({ error: "Project not found" });

    const auth = requireUserToken(req);
    const user = await getSelfProfileWithToken(auth);
    const userId = String(user?.id || "").trim();
    if (!userId) return res.status(401).json({ error: "Invalid user token" });
    const security =
      (await getRoomSecurityInfo(project.roomId, auth).catch(() => null)) ||
      (await getRoomSecurityInfo(project.roomId).catch(() => null));
    if (!canManageRoomFromSecurityInfo(security, userId)) {
      return res.status(403).json({ error: "Only the room admin can invite users" });
    }

    const { emails, access = "FillForms", notify = false, message } = req.body || {};
    const list = normalizeEmailList(emails);
    if (!list.length) return res.status(400).json({ error: "emails is required" });

    const normalizedAccess = normalizeRoomAccess(access);
    const invitations = list.map((email) => ({ email, access: normalizedAccess }));
    const shareResult = await shareRoom(
      {
      roomId: project.roomId,
      invitations,
      notify: Boolean(notify),
      message
      },
      auth
    );

    res.json({ invited: invitations.length, shareResult });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

export default router;
