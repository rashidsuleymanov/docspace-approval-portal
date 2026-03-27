import { Router } from "express";
import { deleteFile, getFolderContents, getFormsRoomFolders, requireFormsRoom } from "../docspaceClient.js";
import { getConfig } from "../config.js";
import { getProject } from "../store.js";

const router = Router();

function isPdfItem(item) {
  if (!item) return false;
  const ext = String(item?.fileExst || "").trim().toLowerCase();
  const title = String(item?.title || "").trim().toLowerCase();
  if (ext === "pdf" || ext === ".pdf") return true;
  if (title.endsWith(".pdf")) return true;
  return false;
}

router.get("/", async (req, res) => {
  try {
    const auth = String(req.headers.authorization || "").trim();
    if (!auth) {
      return res.status(401).json({ error: "Authorization token is required" });
    }

    const cfg = getConfig();
    if (!String(cfg.formsRoomId || "").trim()) {
      return res.status(400).json({
        error: "No current project selected",
        details: "Open Projects and select (or create) a project first."
      });
    }

    const room =
      (await requireFormsRoom(auth).catch(() => null)) ||
      (await requireFormsRoom().catch(() => null));
    if (!room?.id) {
      return res.status(404).json({ error: "Forms room not found" });
    }

    const folders =
      (await getFormsRoomFolders(room.id, auth).catch(() => null)) ||
      (await getFormsRoomFolders(room.id).catch(() => null)) ||
      null;

    const folderId = folders?.templates?.id || room.id;
    const contents =
      (await getFolderContents(folderId, auth).catch(() => null)) ||
      (await getFolderContents(folderId).catch(() => null));

    const items = Array.isArray(contents?.items) ? contents.items : [];
    const templates = items
      .filter((item) => item.type === "file" && isPdfItem(item))
      .map((item) => ({
        id: item.id,
        title: item.title,
        fileExst: item.fileExst || null,
        isForm: item.isForm ?? null
      }));

    res.json({
      room: { id: room.id, title: room.title },
      folder: {
        id: folderId,
        title: folders?.templates?.title || contents?.title || null
      },
      templates
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

router.get("/project/:projectId", async (req, res) => {
  try {
    const auth = String(req.headers.authorization || "").trim();
    if (!auth) {
      return res.status(401).json({ error: "Authorization token is required" });
    }

    const projectId = String(req.params?.projectId || "").trim();
    if (!projectId) return res.status(400).json({ error: "projectId is required" });

    const project = getProject(projectId);
    if (!project?.roomId) return res.status(404).json({ error: "Project not found" });

    const roomId = String(project.roomId || "").trim();
    if (!roomId) return res.status(404).json({ error: "Project room not found" });

    const folders =
      (await getFormsRoomFolders(roomId, auth).catch(() => null)) ||
      (await getFormsRoomFolders(roomId).catch(() => null)) ||
      null;

    const folderId = folders?.templates?.id || roomId;
    const contents =
      (await getFolderContents(folderId, auth).catch(() => null)) ||
      (await getFolderContents(folderId).catch(() => null));

    const items = Array.isArray(contents?.items) ? contents.items : [];
    const templates = items
      .filter((item) => item.type === "file" && isPdfItem(item))
      .map((item) => ({
        id: item.id,
        title: item.title,
        fileExst: item.fileExst || null,
        isForm: item.isForm ?? null,
        webUrl: item.webUrl || null
      }));

    res.json({
      project: { id: project.id, title: project.title || null, roomId },
      folder: {
        id: folderId,
        title: folders?.templates?.title || contents?.title || null
      },
      templates
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

router.delete("/:fileId", async (req, res) => {
  try {
    const auth = String(req.headers.authorization || "").trim();
    if (!auth) {
      return res.status(401).json({ error: "Authorization token is required" });
    }

    const cfg = getConfig();
    if (!String(cfg.formsRoomId || "").trim()) {
      return res.status(400).json({
        error: "No current project selected",
        details: "Open Projects and select (or create) a project first."
      });
    }

    const fid = String(req.params?.fileId || "").trim();
    if (!fid) return res.status(400).json({ error: "fileId is required" });

    const room =
      (await requireFormsRoom(auth).catch(() => null)) ||
      (await requireFormsRoom().catch(() => null));
    if (!room?.id) {
      return res.status(404).json({ error: "Forms room not found" });
    }

    const folders =
      (await getFormsRoomFolders(room.id, auth).catch(() => null)) ||
      (await getFormsRoomFolders(room.id).catch(() => null)) ||
      null;

    const folderId = folders?.templates?.id || room.id;
    const contents =
      (await getFolderContents(folderId, auth).catch(() => null)) ||
      (await getFolderContents(folderId).catch(() => null));

    const items = Array.isArray(contents?.items) ? contents.items : [];
    const exists = items.some((item) => item.type === "file" && String(item?.id || "") === fid);
    if (!exists) return res.status(404).json({ error: "Template file not found in the current project Templates folder" });

    const result = await deleteFile(fid, auth);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.delete("/project/:projectId/:fileId", async (req, res) => {
  try {
    const auth = String(req.headers.authorization || "").trim();
    if (!auth) {
      return res.status(401).json({ error: "Authorization token is required" });
    }

    const projectId = String(req.params?.projectId || "").trim();
    if (!projectId) return res.status(400).json({ error: "projectId is required" });

    const project = getProject(projectId);
    if (!project?.roomId) return res.status(404).json({ error: "Project not found" });

    const fid = String(req.params?.fileId || "").trim();
    if (!fid) return res.status(400).json({ error: "fileId is required" });

    const roomId = String(project.roomId || "").trim();
    const folders =
      (await getFormsRoomFolders(roomId, auth).catch(() => null)) ||
      (await getFormsRoomFolders(roomId).catch(() => null)) ||
      null;

    const folderId = folders?.templates?.id || roomId;
    const contents =
      (await getFolderContents(folderId, auth).catch(() => null)) ||
      (await getFolderContents(folderId).catch(() => null));

    const items = Array.isArray(contents?.items) ? contents.items : [];
    const exists = items.some((item) => item.type === "file" && String(item?.id || "") === fid);
    if (!exists) return res.status(404).json({ error: "Template file not found in the selected project Templates folder" });

    const result = await deleteFile(fid, auth);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

export default router;
