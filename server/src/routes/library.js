import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  copyFilesToFolderAsAdmin,
  createFileInFolder,
  createRoom,
  findRoomByCandidates,
  getFileInfo,
  getRoomSecurityInfo,
  getSelfProfileWithToken,
  getFolderContents,
  getFormsRoomFolders
} from "../docspaceClient.js";
import { getConfig, updateConfig } from "../config.js";

const router = Router();

function requireUserToken(req) {
  const auth = String(req.headers.authorization || "").trim();
  if (!auth) {
    const err = new Error("Authorization token is required");
    err.status = 401;
    throw err;
  }
  return auth;
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

function isRoomAdminAccess(access) {
  if (typeof access === "number") return access === 7;
  const v = String(access || "").trim().toLowerCase();
  if (v === "7") return true;
  return v === "roommanager" || v === "roomadmin";
}

function canManageRoomFromSecurityInfo(security, userId) {
  const uid = String(userId || "").trim();
  if (!uid) return false;
  const members = roomMembersFromSecurityInfo(security);
  const me = members.find((m) => String(m?.user?.id || m?.sharedTo?.id || "").trim() === uid) || null;
  if (!me) return false;
  return Boolean(me?.isOwner) || isRoomAdminAccess(me?.access);
}

function isPdfEntry(entry) {
  const ext = String(entry?.fileExst || "").trim().toLowerCase();
  const title = String(entry?.title || "").trim().toLowerCase();
  return ext === "pdf" || ext === ".pdf" || title.endsWith(".pdf");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

router.get("/status", async (_req, res) => {
  const cfg = getConfig();
  const configured = String(cfg.libraryRoomId || "").trim();
  if (configured) {
    return res.json({ libraryRoomId: configured, hasLibrary: true });
  }

  const candidates = ["Templates", "Template library", "Templates room", "Drafts"].filter(Boolean);
  const found = await findRoomByCandidates(candidates).catch(() => null);
  const roomId = String(found?.id || "").trim();
  if (roomId) {
    await updateConfig({ libraryRoomId: roomId }).catch(() => null);
    return res.json({ libraryRoomId: roomId, hasLibrary: true, discovered: true, title: found?.title || found?.name || "" });
  }

  return res.json({ libraryRoomId: "", hasLibrary: false });
});

router.post("/create", async (req, res) => {
  try {
    const { title } = req.body || {};
    const name = String(title || "").trim() || "Drafts";
    const created = await createRoom({ title: name, roomType: 2 });
    const roomId = created?.id ?? created?.response?.id ?? created?.folder?.id ?? null;
    if (!roomId) return res.status(500).json({ error: "Failed to determine created room id" });
    await updateConfig({ libraryRoomId: String(roomId) });
    res.json({ room: { id: String(roomId), title: created?.title || name, webUrl: created?.webUrl || null } });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.put("/select", async (req, res) => {
  try {
    const { roomId } = req.body || {};
    const rid = String(roomId || "").trim();
    if (!rid) return res.status(400).json({ error: "roomId is required" });
    await updateConfig({ libraryRoomId: rid });
    res.json({ ok: true, libraryRoomId: rid });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.get("/files", async (_req, res) => {
  try {
    const cfg = getConfig();
    let rid = String(cfg.libraryRoomId || "").trim();
    if (!rid) return res.status(400).json({ error: "Library room is not set" });

    const contents = await getFolderContents(rid);
    const items = Array.isArray(contents?.items) ? contents.items : [];
    const files = items
      .filter((i) => i.type === "file" && isPdfEntry(i))
      .map((f) => ({
        id: f.id,
        title: f.title,
        fileExst: f.fileExst || null,
        isForm: f.isForm ?? null,
        webUrl: f.webUrl || null
      }));
    res.json({ roomId: rid, files });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/files", async (req, res) => {
  try {
    const cfg = getConfig();
    const rid = String(cfg.libraryRoomId || "").trim();
    if (!rid) return res.status(400).json({ error: "Library room is not set" });

    const title = String(req.body?.title || "").trim() || `Template ${randomUUID()}.pdf`;
    if (!String(title).toLowerCase().endsWith(".pdf")) return res.status(400).json({ error: "Only .pdf templates are supported" });
    const type = String(req.body?.type || "").trim() || "text";

    const created = await createFileInFolder({ folderId: rid, title, type }, "");
    res.json({ file: created?.response ?? created });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/publish", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const me = await getSelfProfileWithToken(auth);
    const meId = String(me?.id || "").trim();
    if (!meId) return res.status(401).json({ error: "Invalid user token" });

    const cfg = getConfig();
    const sourceFileId = String(req.body?.fileId || "").trim();
    if (!sourceFileId) return res.status(400).json({ error: "fileId is required" });

    const targetRoomId = String(req.body?.targetRoomId || cfg.formsRoomId || "").trim();
    if (!targetRoomId) return res.status(400).json({ error: "targetRoomId is required" });

    const info = await getFileInfo(sourceFileId).catch(() => null);
    if (!isPdfEntry(info)) return res.status(400).json({ error: "Only .pdf templates can be published" });

    const security = await getRoomSecurityInfo(targetRoomId, auth).catch(() => null);
    const members = roomMembersFromSecurityInfo(security);
    const isMember = members.some((m) => String(m?.user?.id || m?.sharedTo?.id || "").trim() === meId);
    if (!isMember) return res.status(403).json({ error: "No access to this project room" });
    if (!canManageRoomFromSecurityInfo(security, meId)) {
      return res.status(403).json({ error: "Only the project admin can publish templates" });
    }

    const folders = await getFormsRoomFolders(targetRoomId).catch(() => null);
    const destFolderId = String(folders?.templates?.id || targetRoomId).trim();
    const inProcessFolderId = String(folders?.inProcess?.id || "").trim();

    const before = await getFolderContents(destFolderId).catch(() => null);
    const beforeIds = new Set((before?.items || []).filter((i) => i.type === "file").map((i) => String(i.id)));

    const operation = await copyFilesToFolderAsAdmin({
      fileIds: [sourceFileId],
      destFolderId,
      deleteAfter: false,
      toFillOut: false
    });

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

    res.json({
      ok: true,
      operation,
      destFolderId,
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
