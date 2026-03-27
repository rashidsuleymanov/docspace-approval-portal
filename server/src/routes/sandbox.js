import { Router } from "express";
import {
  createRoom,
  ensureFormsRoomFolders,
  findRoomByCandidates,
  getRoomInfo,
  getFormsRoomFolders,
  getAdminProfile,
  getUserByEmail,
  listRooms,
  requireFormsRoom,
  shareRoom
} from "../docspaceClient.js";
import { getConfig, updateConfig, validateConfig } from "../config.js";

const router = Router();

function normalizeEmailList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  return String(value)
    .split(/[,\n;]/g)
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function maskSecret(value) {
  const raw = String(value || "");
  if (!raw) return "";
  const last = raw.slice(-6);
  return `${"*".repeat(Math.max(0, raw.length - last.length))}${last}`;
}

function normalizeRoomType(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

function parseRoomTypeFilter(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && String(asNum) === raw) return String(asNum);
  return raw.toLowerCase();
}

function matchesRoomType(room, filter) {
  if (!filter) return true;
  const aliases = {
    "1": ["fillingformsroom"],
    fillingformsroom: ["1"]
  };
  const candidates = [room?.rootRoomType, room?.roomType, room?.folderType]
    .map(normalizeRoomType)
    .filter(Boolean)
    .map((v) => (v.match(/^\d+$/) ? v : v.toLowerCase()));
  if (candidates.includes(filter)) return true;
  const expanded = aliases[filter] || [];
  return expanded.some((a) => candidates.includes(a));
}

router.get("/config", (_req, res) => {
  const cfg = getConfig();
  res.json({
    baseUrl: cfg.baseUrl || "",
    hasAuthToken: Boolean(cfg.rawAuthToken),
    authTokenMasked: cfg.rawAuthToken ? maskSecret(cfg.rawAuthToken) : "",
    hasWebhookSecret: Boolean(cfg.webhookSecret),
    webhookSecretMasked: cfg.webhookSecret ? maskSecret(cfg.webhookSecret) : "",
    portalName: cfg.portalName || "DocSpace Approval Portal",
    portalTagline: cfg.portalTagline || "Approval portal",
    portalLogoUrl: cfg.portalLogoUrl || "",
    portalAccent: cfg.portalAccent || "",
    formsRoomId: cfg.formsRoomId || "",
    libraryRoomId: cfg.libraryRoomId || "",
    projectTemplatesRoomId: cfg.projectTemplatesRoomId || "",
    formsRoomTitle: cfg.formsRoomTitle || "",
    formsRoomTitleFallbacks: Array.isArray(cfg.formsRoomTitleFallbacks) ? cfg.formsRoomTitleFallbacks : [],
    projectTemplatesRoomTitle: cfg.projectTemplatesRoomTitle || "",
    projectTemplatesRoomTitleFallbacks: Array.isArray(cfg.projectTemplatesRoomTitleFallbacks)
      ? cfg.projectTemplatesRoomTitleFallbacks
      : [],
    formsTemplatesFolderTitle: cfg.formsTemplatesFolderTitle || ""
  });
});

router.put("/config", async (req, res) => {
  try {
    const patch = req.body || {};
    if (patch.formsRoomId !== undefined && patch.formsRoomTitle === undefined) {
      const room = await getRoomInfo(patch.formsRoomId).catch(() => null);
      if (room?.title) patch.formsRoomTitle = String(room.title);
    }
    if (patch.projectTemplatesRoomId !== undefined && patch.projectTemplatesRoomTitle === undefined) {
      const room = await getRoomInfo(patch.projectTemplatesRoomId).catch(() => null);
      if (room?.title) patch.projectTemplatesRoomTitle = String(room.title);
    }
    const next = await updateConfig(patch);
    const errors = validateConfig({ requiresAuth: false }, next);
    res.json({
      baseUrl: next.baseUrl || "",
      hasAuthToken: Boolean(next.rawAuthToken),
      authTokenMasked: next.rawAuthToken ? maskSecret(next.rawAuthToken) : "",
      hasWebhookSecret: Boolean(next.webhookSecret),
      webhookSecretMasked: next.webhookSecret ? maskSecret(next.webhookSecret) : "",
      portalName: next.portalName || "DocSpace Approval Portal",
      portalTagline: next.portalTagline || "Approval portal",
      portalLogoUrl: next.portalLogoUrl || "",
      portalAccent: next.portalAccent || "",
      formsRoomId: next.formsRoomId || "",
      libraryRoomId: next.libraryRoomId || "",
      projectTemplatesRoomId: next.projectTemplatesRoomId || "",
      formsRoomTitle: next.formsRoomTitle || "",
      formsRoomTitleFallbacks: Array.isArray(next.formsRoomTitleFallbacks) ? next.formsRoomTitleFallbacks : [],
      projectTemplatesRoomTitle: next.projectTemplatesRoomTitle || "",
      projectTemplatesRoomTitleFallbacks: Array.isArray(next.projectTemplatesRoomTitleFallbacks)
        ? next.projectTemplatesRoomTitleFallbacks
        : [],
      formsTemplatesFolderTitle: next.formsTemplatesFolderTitle || "",
      warnings: errors
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

router.post("/config/test", async (_req, res) => {
  try {
    const errors = validateConfig({ requiresAuth: true });
    if (errors.length) {
      return res.status(400).json({ error: "Config is incomplete", details: errors.join("; "), errors });
    }

    const [profile, rooms] = await Promise.all([getAdminProfile(), listRooms().catch(() => [])]);
    res.json({
      ok: true,
      profile: profile?.id ? { id: profile.id, email: profile.email || null, displayName: profile.displayName || null } : null,
      roomsCount: Array.isArray(rooms) ? rooms.length : 0
    });
  } catch (error) {
    res.status(error.status || 500).json({
      ok: false,
      error: error.message,
      details: error.details || null
    });
  }
});

router.get("/rooms", async (req, res) => {
  try {
    const filter = parseRoomTypeFilter(req.query.roomType || req.query.type);
    const rooms = await listRooms().catch(() => []);
    const filtered = (rooms || []).filter((r) => matchesRoomType(r, filter));
    res.json({
      rooms: filtered.map((r) => ({
        id: r?.id ?? null,
        title: r?.title || r?.name || "",
        rootRoomType: r?.rootRoomType ?? null,
        roomType: r?.roomType ?? null,
        webUrl: r?.webUrl || null
      }))
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

router.post("/rooms", async (req, res) => {
  try {
    const { title, roomType = 1, select = true } = req.body || {};
    const safeTitle = String(title || "").trim();
    if (!safeTitle) return res.status(400).json({ error: "title is required" });

    const created = await createRoom({ title: safeTitle, roomType }).catch((e) => {
      const err = new Error(e?.message || "Failed to create room");
      err.status = e?.status || 500;
      err.details = e?.details || null;
      throw err;
    });

    const roomId = created?.id ?? created?.response?.id ?? created?.folder?.id ?? null;
    if (select && roomId) {
      await updateConfig({ formsRoomId: String(roomId), formsRoomTitle: safeTitle });
    }

    res.json({
      room: {
        id: roomId,
        title: created?.title || safeTitle,
        rootRoomType: created?.rootRoomType ?? null,
        roomType: created?.roomType ?? null,
        webUrl: created?.webUrl || null
      }
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

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

function libraryRoomCandidates() {
  return ["Template library", "Templates", "Templates room", "Drafts"].map((v) => String(v || "").trim()).filter(Boolean);
}

async function resolveRoomByConfigOrCandidates({ configuredId, candidates }) {
  const cid = String(configuredId || "").trim();
  if (cid) {
    const existing = await getRoomInfo(cid).catch(() => null);
    if (existing?.id) return existing;
  }
  const found = await findRoomByCandidates(candidates || []).catch(() => null);
  if (found?.id) return found;
  return null;
}

function requiredRoomsDefinitions(cfg) {
  return [
    {
      key: "project-templates",
      label: "Shared templates room",
      description: "Holds reusable templates that can be published into projects.",
      roomType: 1,
      expectedTitle: String(cfg?.projectTemplatesRoomTitle || "Projects Templates"),
      candidates: projectTemplatesCandidates(cfg),
      configuredId: cfg?.projectTemplatesRoomId,
      onResolved: async (room) => {
        if (!room?.id) return;
        await updateConfig({
          projectTemplatesRoomId: String(room.id),
          projectTemplatesRoomTitle: String(room.title || cfg?.projectTemplatesRoomTitle || "Projects Templates")
        }).catch(() => null);
      },
      create: async () => {
        const title = String(cfg?.projectTemplatesRoomTitle || "").trim() || "Projects Templates";
        const created = await createRoom({ title, roomType: 1 });
        const roomId = created?.id ?? created?.response?.id ?? created?.folder?.id ?? null;
        if (roomId) {
          await updateConfig({ projectTemplatesRoomId: String(roomId), projectTemplatesRoomTitle: title }).catch(() => null);
        }
        return { ...created, id: roomId, title };
      }
    },
    {
      key: "library",
      label: "Template library room",
      description: "Optional room for a shared template library (used by the Library page).",
      roomType: 2,
      expectedTitle: "Template library",
      candidates: libraryRoomCandidates(),
      configuredId: cfg?.libraryRoomId,
      onResolved: async (room) => {
        if (!room?.id) return;
        await updateConfig({ libraryRoomId: String(room.id) }).catch(() => null);
      },
      create: async () => {
        const title = "Template library";
        const created = await createRoom({ title, roomType: 2 });
        const roomId = created?.id ?? created?.response?.id ?? created?.folder?.id ?? null;
        if (roomId) await updateConfig({ libraryRoomId: String(roomId) }).catch(() => null);
        return { ...created, id: roomId, title };
      }
    }
  ];
}

router.get("/required-rooms", async (_req, res) => {
  try {
    const cfg = getConfig();
    const defs = requiredRoomsDefinitions(cfg);
    const canCreate = validateConfig({ requiresAuth: true }).length === 0;

    const rooms = [];
    for (const def of defs) {
      const room = await resolveRoomByConfigOrCandidates({ configuredId: def.configuredId, candidates: def.candidates });
      if (room?.id) {
        await def.onResolved(room).catch(() => null);
      }
      rooms.push({
        key: def.key,
        label: def.label,
        description: def.description,
        expectedTitle: def.expectedTitle,
        roomType: def.roomType,
        configuredId: String(def.configuredId || "").trim() || null,
        found: Boolean(room?.id),
        room: room?.id
          ? {
              id: room.id,
              title: room.title || room.name || "",
              rootRoomType: room.rootRoomType ?? null,
              roomType: room.roomType ?? null,
              webUrl: room.webUrl || null
            }
          : null,
        canCreate
      });
    }

    res.json({
      canCreate,
      missingAuth: canCreate ? false : validateConfig({ requiresAuth: true }),
      rooms
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/required-rooms/:key/create", async (req, res) => {
  try {
    const errors = validateConfig({ requiresAuth: true });
    if (errors.length) {
      return res.status(400).json({ error: "Admin connection is required", details: errors.join("; "), errors });
    }

    const cfg = getConfig();
    const defs = requiredRoomsDefinitions(cfg);
    const key = String(req.params.key || "").trim();
    const def = defs.find((d) => d.key === key);
    if (!def) return res.status(404).json({ error: "Unknown required room key", details: key });

    const existing = await resolveRoomByConfigOrCandidates({ configuredId: def.configuredId, candidates: def.candidates });
    if (existing?.id) {
      await def.onResolved(existing).catch(() => null);
      return res.json({
        ok: true,
        created: false,
        room: { id: existing.id, title: existing.title || existing.name || "", webUrl: existing.webUrl || null }
      });
    }

    const created = await def.create().catch((e) => {
      const err = new Error(e?.message || "Failed to create room");
      err.status = e?.status || 500;
      err.details = e?.details || null;
      throw err;
    });

    const roomId = created?.id ?? created?.response?.id ?? created?.folder?.id ?? null;
    const title = created?.title || def.expectedTitle;
    res.json({
      ok: true,
      created: Boolean(roomId),
      room: roomId ? { id: String(roomId), title: String(title || ""), webUrl: created?.webUrl || null } : null
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.get("/status", async (req, res) => {
  try {
    const cfg = getConfig();
    const roomId = String(req.query.roomId || "").trim() || String(cfg.formsRoomId || "").trim();
    const roomTitle = String(req.query.roomTitle || "").trim();

    let room = null;
    if (roomId) {
      room = await getRoomInfo(roomId).catch(() => null);
    } else if (roomTitle) {
      room = await findRoomByCandidates([roomTitle]).catch(() => null);
    } else {
      room = await requireFormsRoom().catch(() => null);
    }
    if (!room?.id) {
      return res.json({ room: null, folders: null });
    }

    const folders = await getFormsRoomFolders(room.id);

    res.json({
      room: { id: room.id, title: room.title, webUrl: room.webUrl || null },
      folders: folders
        ? {
            inProcess: folders.inProcess?.id ? { id: folders.inProcess.id, title: folders.inProcess.title } : null,
            complete: folders.complete?.id ? { id: folders.complete.id, title: folders.complete.title } : null,
            templates: folders.templates?.id ? { id: folders.templates.id, title: folders.templates.title } : null
          }
        : null
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

router.post("/bootstrap", async (req, res) => {
  try {
    const {
      roomId,
      workspaceName,
      roomTitle,
      roomType = 1,
      createFolders = true,
      memberEmails,
      memberAccess = "FillForms",
      notify = false,
      message
    } = req.body || {};

    const cfg = getConfig();
    const requestedRoomId = String(roomId || "").trim() || String(cfg.formsRoomId || "").trim();

    let room = null;
    if (requestedRoomId) {
      room = await getRoomInfo(requestedRoomId).catch(() => null);
      if (!room?.id) {
        return res.status(404).json({ error: "Room not found", details: requestedRoomId });
      }
    } else {
      const safeWorkspace = String(workspaceName || "").trim();
      const safeTitle = String(roomTitle || "").trim() || (safeWorkspace ? `${safeWorkspace} - Forms` : "");
      if (!safeTitle) {
        return res.status(400).json({ error: "roomId (recommended) or roomTitle (or workspaceName) is required" });
      }

      room = await findRoomByCandidates([safeTitle]).catch(() => null);
      if (!room?.id) {
        const created = await createRoom({ title: safeTitle, roomType }).catch((e) => {
          const err = new Error(e?.message || "Failed to create room");
          err.status = e?.status || 500;
          err.details = e?.details || null;
          throw err;
        });
        room = { id: created?.id || created?.response?.id || created?.folder?.id, title: created?.title || safeTitle };
      }

      if (room?.id) {
        await updateConfig({ formsRoomId: String(room.id), formsRoomTitle: String(room.title || safeTitle) }).catch(() => null);
      }
    }

    let folders = null;
    if (createFolders) {
      folders = await ensureFormsRoomFolders(room.id).catch(() => null);
    }

    const emails = normalizeEmailList(memberEmails);
    const invitations = [];
    for (const email of emails) {
      const user = await getUserByEmail(email).catch(() => null);
      if (user?.id) {
        invitations.push({ id: user.id, access: memberAccess });
      } else {
        invitations.push({ email, access: memberAccess });
      }
    }

    const shareResult = invitations.length
      ? await shareRoom({ roomId: room.id, invitations, notify: Boolean(notify), message }).catch(() => null)
      : null;

    res.json({
      room,
      folders: folders
        ? {
            inProcess: folders.inProcess?.id ? { id: folders.inProcess.id, title: folders.inProcess.title } : null,
            complete: folders.complete?.id ? { id: folders.complete.id, title: folders.complete.title } : null,
            templates: folders.templates?.id ? { id: folders.templates.id, title: folders.templates.title } : null
          }
        : null,
      invited: invitations.length,
      shareResult
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

export default router;
