import { Router } from "express";
import {
  copyFilesToFolder,
  createFileInMyDocuments,
  deleteFile,
  createRoom,
  findRoomByCandidates,
  getFileInfo,
  getFolderContents,
  getFormsRoomFolders,
  getRoomInfo,
  getRoomSecurityInfo,
  getSelfProfileWithToken,
  getMyDocuments
} from "../docspaceClient.js";
import { getProject } from "../store.js";
import { getConfig, updateConfig } from "../config.js";
import { shareRoom } from "../docspaceClient.js";

const router = Router();

function isPdfTitle(title) {
  const t = String(title || "").trim().toLowerCase();
  return Boolean(t) && t.endsWith(".pdf");
}

function isPdfFileInfo(info) {
  const ext = String(info?.fileExst || info?.fileExt || "").trim().toLowerCase();
  const title = String(info?.title || "").trim().toLowerCase();
  if (ext === "pdf" || ext === ".pdf") return true;
  if (title.endsWith(".pdf")) return true;
  return false;
}

function isPdfEntry(entry) {
  const ext = String(entry?.fileExst || "").trim().toLowerCase();
  const title = String(entry?.title || "").trim().toLowerCase();
  return ext === "pdf" || ext === ".pdf" || title.endsWith(".pdf");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function projectTemplatesCandidates(cfg) {
  return [
    cfg?.projectTemplatesRoomTitle,
    ...(cfg?.projectTemplatesRoomTitleFallbacks || []),
    "Projects Templates",
    "Project Templates"
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

async function ensureProjectTemplatesRoom(auth) {
  const cfg = getConfig();
  const configuredId = String(cfg.projectTemplatesRoomId || "").trim();
  if (configuredId) {
    const existing = await getRoomInfo(configuredId).catch(() => null);
    if (existing?.id) {
      return existing;
    }
  }

  const candidates = projectTemplatesCandidates(cfg);
  const found = await findRoomByCandidates(candidates).catch(() => null);
  if (found?.id) {
    await updateConfig({
      projectTemplatesRoomId: String(found.id),
      projectTemplatesRoomTitle: String(found.title || found.name || cfg.projectTemplatesRoomTitle || "Projects Templates")
    }).catch(() => null);
    return found;
  }

  const created = await createRoom({ title: cfg.projectTemplatesRoomTitle || "Projects Templates", roomType: 1 });
  const roomId = created?.id ?? created?.response?.id ?? created?.folder?.id ?? null;
  if (!roomId) throw new Error("Failed to determine templates room id");

  await updateConfig({
    projectTemplatesRoomId: String(roomId),
    projectTemplatesRoomTitle: cfg.projectTemplatesRoomTitle || "Projects Templates"
  }).catch(() => null);

  return { ...created, id: roomId };
}

async function ensureUserAccessToTemplatesRoom({ roomId, userId, userEmail } = {}) {
  const rid = String(roomId || "").trim();
  const uid = String(userId || "").trim();
  if (!rid || !uid) return false;
  const invitations = [{ id: uid, access: "ContentCreator" }];
  if (userEmail) invitations.push({ email: String(userEmail).trim(), access: "ContentCreator" });
  const result = await shareRoom({ roomId: rid, invitations, notify: false }).catch(() => null);
  return Boolean(result);
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

function isRoomOwnerFromSecurityInfo(security, userId) {
  const uid = String(userId || "").trim();
  if (!uid) return false;
  const members = roomMembersFromSecurityInfo(security);
  const me = members.find((m) => String(m?.user?.id || m?.sharedTo?.id || "").trim() === uid) || null;
  return Boolean(me?.isOwner);
}

router.get("/", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const contents = await getMyDocuments(auth);
    const items = Array.isArray(contents?.items) ? contents.items : [];
    const files = items
      .filter((i) => i.type === "file")
      .filter((f) => {
        const ext = String(f?.fileExst || "").trim().toLowerCase();
        const title = String(f?.title || "").trim().toLowerCase();
        return ext === "pdf" || ext === ".pdf" || title.endsWith(".pdf");
      })
      .map((f) => ({
        id: f.id,
        title: f.title,
        fileExst: f.fileExst || null,
        isForm: f.isForm ?? null,
        webUrl: f.webUrl || null,
        created: f.created || null,
        updated: f.updated || null
      }));
    res.json({ folder: { id: contents?.id || "@my", title: contents?.title || "My documents" }, drafts: files });
  } catch (error) {
    const status = error.status || 500;
    const details = error.details || null;
    const docSpaceErr = details?.error || null;
    const docSpaceType = typeof docSpaceErr?.type === "string" ? docSpaceErr.type : "";
    const docSpaceMsg = typeof docSpaceErr?.message === "string" ? docSpaceErr.message : "";

    if (
      status === 404 &&
      docSpaceType.includes("ItemNotFoundException") &&
      docSpaceMsg.toLowerCase().includes("required folder was not found")
    ) {
      return res.status(404).json({
        error: "My documents is not available for this DocSpace account.",
        details: {
          hint: "This can happen for guest/external users. Try signing in with an internal DocSpace user or ask your admin to enable personal documents."
        }
      });
    }

    res.status(status).json({ error: error.message, details: details?.error ? { message: docSpaceMsg, type: docSpaceType } : null });
  }
});

router.get("/templates-room", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const me = await getSelfProfileWithToken(auth).catch(() => null);
    const meId = String(me?.id || "").trim();
    if (!meId) return res.status(401).json({ error: "Invalid user token" });

    const room = await ensureProjectTemplatesRoom(auth);
    const roomId = String(room?.id || "").trim();
    if (!roomId) return res.status(500).json({ error: "Templates room is missing" });

    let hasAccess = false;
    const info = await getRoomInfo(roomId, auth).catch(() => null);
    if (info?.id) hasAccess = true;

    if (!hasAccess) {
      await ensureUserAccessToTemplatesRoom({
        roomId,
        userId: meId,
        userEmail: String(me?.email || "").trim()
      }).catch(() => null);
      const recheck = await getRoomInfo(roomId, auth).catch(() => null);
      hasAccess = Boolean(recheck?.id);
    }

    const security = await getRoomSecurityInfo(roomId, auth).catch(() => null);
    const isOwner = isRoomOwnerFromSecurityInfo(security, meId);

    res.json({
      room: {
        id: roomId,
        title: String(room?.title || room?.name || getConfig().projectTemplatesRoomTitle || "Projects Templates"),
        roomUrl: room?.webUrl || room?.shortWebUrl || info?.webUrl || info?.shortWebUrl || null
      },
      hasAccess,
      isOwner
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.delete("/templates-room/templates/:fileId", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const me = await getSelfProfileWithToken(auth).catch(() => null);
    const meId = String(me?.id || "").trim();
    if (!meId) return res.status(401).json({ error: "Invalid user token" });

    const room = await ensureProjectTemplatesRoom(auth);
    const roomId = String(room?.id || "").trim();
    if (!roomId) return res.status(500).json({ error: "Templates room is missing" });

    const security = await getRoomSecurityInfo(roomId, auth).catch(() => null);
    if (!isRoomOwnerFromSecurityInfo(security, meId)) {
      return res.status(403).json({ error: "Only the room owner can delete published templates" });
    }

    const fileId = String(req.params?.fileId || "").trim();
    if (!fileId) return res.status(400).json({ error: "fileId is required" });

    const folders =
      (await getFormsRoomFolders(roomId, auth).catch(() => null)) ||
      (await getFormsRoomFolders(roomId).catch(() => null)) ||
      null;
    const folderId = String(folders?.templates?.id || roomId || "").trim();
    if (!folderId) return res.status(500).json({ error: "Unable to determine templates folder" });

    const contents =
      (await getFolderContents(folderId, auth).catch(() => null)) ||
      (await getFolderContents(folderId).catch(() => null));
    const items = Array.isArray(contents?.items) ? contents.items : [];
    const exists = items.some((i) => i.type === "file" && String(i?.id || "") === fileId);
    if (!exists) return res.status(404).json({ error: "Template file not found in the shared room" });

    const result = await deleteFile(fileId, auth);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.get("/templates-room/templates", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const room = await ensureProjectTemplatesRoom(auth);
    const roomId = String(room?.id || "").trim();
    if (!roomId) return res.status(500).json({ error: "Templates room is missing" });

    const folders =
      (await getFormsRoomFolders(roomId, auth).catch(() => null)) ||
      (await getFormsRoomFolders(roomId).catch(() => null)) ||
      null;
    const folderId = String(folders?.templates?.id || roomId || "").trim();
    if (!folderId) return res.status(500).json({ error: "Unable to determine templates folder" });

    const contents =
      (await getFolderContents(folderId, auth).catch(() => null)) ||
      (await getFolderContents(folderId).catch(() => null));
    const items = Array.isArray(contents?.items) ? contents.items : [];
    const templates = items
      .filter((item) => item.type === "file" && isPdfEntry(item))
      .map((item) => ({
        id: item.id,
        title: item.title,
        fileExst: item.fileExst || null,
        isForm: item.isForm ?? null,
        webUrl: item.webUrl || null
      }));

    res.json({
      room: {
        id: roomId,
        title: String(room?.title || room?.name || getConfig().projectTemplatesRoomTitle || "Projects Templates"),
        roomUrl: room?.webUrl || room?.shortWebUrl || null
      },
      folder: { id: folderId, title: folders?.templates?.title || contents?.title || null },
      templates
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const { title } = req.body || {};
    if (!isPdfTitle(title)) return res.status(400).json({ error: "Only .pdf templates are supported" });
    const created = await createFileInMyDocuments({ title }, auth);
    res.json({ file: created });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.delete("/:fileId", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const fileId = String(req.params?.fileId || "").trim();
    if (!fileId) return res.status(400).json({ error: "fileId is required" });

    const contents = await getMyDocuments(auth);
    const items = Array.isArray(contents?.items) ? contents.items : [];
    const exists = items.some((i) => i.type === "file" && String(i?.id || "") === fileId && isPdfEntry(i));
    if (!exists) return res.status(404).json({ error: "Template file not found in My documents" });

    const result = await deleteFile(fileId, auth);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/publish", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const fileId = String(req.body?.fileId || "").trim();
    const projectId = String(req.body?.projectId || "").trim();
    const destination = String(req.body?.destination || "project").trim();
    const activate = req.body?.activate !== false;

    if (!fileId) return res.status(400).json({ error: "fileId is required" });
    if (destination !== "templatesRoom" && !projectId) return res.status(400).json({ error: "projectId is required" });

    const project = destination === "templatesRoom" ? null : getProject(projectId);
    if (destination !== "templatesRoom" && !project?.roomId) return res.status(404).json({ error: "Project not found" });

    const info = await getFileInfo(fileId, auth).catch(() => null);
    if (!isPdfFileInfo(info)) return res.status(400).json({ error: "Only .pdf templates can be published" });

    let destRoomId = destination === "templatesRoom" ? "" : String(project.roomId || "").trim();
    let roomMeta = destination === "templatesRoom" ? null : project;
    if (destination === "templatesRoom") {
      const me = await getSelfProfileWithToken(auth).catch(() => null);
      const meId = String(me?.id || "").trim();
      if (!meId) return res.status(401).json({ error: "Invalid user token" });
      const room = await ensureProjectTemplatesRoom(auth);
      destRoomId = String(room?.id || "").trim();
      roomMeta = { id: "templatesRoom", title: String(room?.title || room?.name || "Projects Templates"), roomId: destRoomId, roomUrl: room?.webUrl || room?.shortWebUrl || null };
      await ensureUserAccessToTemplatesRoom({ roomId: destRoomId, userId: meId, userEmail: String(me?.email || "").trim() }).catch(() => null);
    }

    const folders =
      (await getFormsRoomFolders(destRoomId).catch(() => null)) ||
      (await getFormsRoomFolders(destRoomId, auth).catch(() => null)) ||
      null;

    const destFolderId = String(folders?.templates?.id || destRoomId || "").trim();
    if (!destFolderId) return res.status(500).json({ error: "Unable to determine destination folder" });
    const inProcessFolderId = String(folders?.inProcess?.id || "").trim();

    const before = await getFolderContents(destFolderId).catch(() => null);
    const beforeIds = new Set((before?.items || []).filter((i) => i.type === "file").map((i) => String(i.id)));

    const operation = await copyFilesToFolder(
      // Publishing a template should copy into Templates; `toFillOut` can move the copy to an "in-progress" folder.
      { fileIds: [fileId], destFolderId, deleteAfter: false, toFillOut: false },
      auth
    );

    const opPending = Boolean(operation?.pending);
    const maxDetectAttempts = opPending ? 30 : 12;
    let createdFile = null;
    for (let attempt = 0; attempt < maxDetectAttempts; attempt += 1) {
      const after = await getFolderContents(destFolderId).catch(() => null);
      const items = Array.isArray(after?.items) ? after.items : [];
      const candidates = items.filter((i) => i.type === "file" && !beforeIds.has(String(i.id)) && isPdfEntry(i));
      const matchByTitle = candidates.find((i) => String(i.title || "").trim() === String(info?.title || "").trim()) || null;
      createdFile = matchByTitle || candidates[0] || null;
      if (createdFile?.id) break;
      await sleep(opPending ? 700 : 450);
    }
    let createdIn = createdFile?.id ? "templates" : null;

    if (!createdFile?.id && inProcessFolderId) {
      const beforeIn = await getFolderContents(inProcessFolderId).catch(() => null);
      const beforeInIds = new Set((beforeIn?.items || []).filter((i) => i.type === "file").map((i) => String(i.id)));
      for (let attempt = 0; attempt < maxDetectAttempts; attempt += 1) {
        const after = await getFolderContents(inProcessFolderId).catch(() => null);
        const items = Array.isArray(after?.items) ? after.items : [];
        const candidates = items.filter((i) => i.type === "file" && !beforeInIds.has(String(i.id)) && isPdfEntry(i));
        const matchByTitle = candidates.find((i) => String(i.title || "").trim() === String(info?.title || "").trim()) || null;
        createdFile = matchByTitle || candidates[0] || createdFile;
        if (createdFile?.id) {
          createdIn = "inProcess";
          break;
        }
        await sleep(opPending ? 700 : 450);
      }
    }

    if (activate) {
      if (destination !== "templatesRoom") {
        await updateConfig({ formsRoomId: String(project.roomId), formsRoomTitle: String(project.title || "") }).catch(() => null);
      }
    }

    res.json({
      ok: true,
      destination,
      project:
        destination === "templatesRoom"
          ? { id: "templatesRoom", title: roomMeta?.title || "Projects Templates", roomId: destRoomId, roomUrl: roomMeta?.roomUrl || null }
          : { id: project.id, title: project.title, roomId: project.roomId, roomUrl: project.roomUrl || null },
      destFolderId,
      operation,
      createdIn,
      createdFile: createdFile?.id
        ? { id: createdFile.id, title: createdFile.title || null, fileExst: createdFile.fileExst || null, isForm: createdFile.isForm ?? null }
        : null
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

export default router;
