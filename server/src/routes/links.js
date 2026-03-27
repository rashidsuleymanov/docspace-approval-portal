import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  ensureExternalLinkAccess,
  getFileInfo,
  getRoomInfo,
  getSelfProfileWithToken,
  ensureFolderByTitleWithin,
  createFileFromTemplateToFolder,
  setFileExternalLink
} from "../docspaceClient.js";
import { getConfig } from "../config.js";
import { createFlow, getProject } from "../store.js";

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

function normalize(value) {
  return String(value || "").trim();
}

function stripExtension(title) {
  const value = normalize(title);
  if (!value) return "";
  return value.replace(/\.[a-z0-9]+$/i, "");
}

function safeInt(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

router.post("/bulk", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const user = await getSelfProfileWithToken(auth);
    const userId = normalize(user?.id);
    if (!userId) return res.status(401).json({ error: "Invalid user token" });

    const cfg = getConfig();
    const targetProjectId = normalize(req.body?.projectId);
    const configuredRoomId = normalize(cfg.formsRoomId);
    const targetRoomId = targetProjectId ? normalize(getProject(targetProjectId)?.roomId) : configuredRoomId;
    if (!targetRoomId) {
      return res.status(400).json({
        error: "No target project selected",
        details: "Pick a project (or set a current project in Projects) first."
      });
    }

    const templateFileId = normalize(req.body?.templateFileId);
    if (!templateFileId) return res.status(400).json({ error: "templateFileId is required" });

    const count = Math.min(50, safeInt(req.body?.count, 1));

    const [roomAccess, templateInfo] = await Promise.all([
      getRoomInfo(targetRoomId, auth).catch(() => null),
      getFileInfo(templateFileId).catch(() => null)
    ]);
    if (!roomAccess?.id) return res.status(403).json({ error: "No access to the selected project" });
    if (!templateInfo?.id) return res.status(404).json({ error: "Template file not found" });

    const displayName =
      user?.displayName ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      user?.userName ||
      user?.email ||
      "User";

    const folder = await ensureFolderByTitleWithin(targetRoomId, "Bulk links", auth).catch(() => null);
    const destFolderId = normalize(folder?.id) || targetRoomId;

    const baseTitle = String(templateInfo?.title || "Document").trim();
    const baseNoExt = stripExtension(baseTitle) || "Document";
    const ext = String(baseTitle.match(/\.[a-z0-9]+$/i)?.[0] || "").trim();
    const batchId = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    const flows = [];

    for (let i = 0; i < count; i += 1) {
      const num = String(i + 1).padStart(3, "0");
      const title = `${baseNoExt} - Link ${batchId}-${num}${ext}`;

      const createdFile = await createFileFromTemplateToFolder({ templateFileId, destFolderId, title }, auth).catch((e) => {
        const err = new Error(e?.message || "Failed to create file copy");
        err.status = e?.status || 500;
        err.details = e?.details || null;
        throw err;
      });
      const fileId = normalize(createdFile?.id ?? createdFile?.response?.id ?? createdFile?.file?.id ?? null);
      const fileTitle = String(createdFile?.title || title).trim() || title;
      if (!fileId) throw new Error("Failed to determine created file id");

      const desiredTitle = "Approval link";
      let link =
        (await ensureExternalLinkAccess(fileId, { access: "FillForms", title: desiredTitle }, auth).catch(() => null)) ||
        (await setFileExternalLink(fileId, auth, { access: "FillForms" }).catch(() => null)) ||
        null;

      const openUrl = normalize(link?.shareLink);
      if (!openUrl) {
        return res.status(500).json({ error: "Unable to obtain link" });
      }

      const flow = createFlow({
        id: randomUUID(),
        kind: "approval",
        source: "bulkLink",
        templateFileId: String(templateFileId),
        templateTitle: String(templateInfo?.title || "") || null,
        fileId,
        fileTitle,
        projectRoomId: targetRoomId,
        createdByUserId: userId,
        recipientEmails: [],
        createdByName: displayName || null,
        openUrl,
        linkRequestToken: link?.requestToken || null,
        status: "InProgress"
      });
      if (flow) flows.push(flow);
    }

    res.json({ ok: true, flows });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

export default router;
