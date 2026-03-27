import crypto from "node:crypto";
import { Router } from "express";
import { getConfig } from "../config.js";
import { listAllFlows, listFlowsForRoom } from "../store.js";
import { resolveFlowsStatus } from "./flows.js";

const router = Router();

function normalize(value) {
  return String(value || "").trim();
}

function stableJsonStringify(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "";
  }
}

function verifyDocSpaceSignature(rawBody, secret, headerValue) {
  const sec = normalize(secret);
  if (!sec) return { ok: true, checked: false, reason: "no_secret" };

  const header = normalize(headerValue);
  if (!header) return { ok: false, checked: true, reason: "missing_header" };

  const m = header.match(/^sha256=([a-fA-F0-9]{64})$/);
  if (!m) return { ok: false, checked: true, reason: "bad_format" };

  const expected = crypto.createHmac("sha256", sec).update(rawBody).digest("hex");
  const provided = String(m[1]).toLowerCase();

  const ok = crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"));
  return { ok, checked: true, reason: ok ? "ok" : "mismatch" };
}

function collectIdsByKeys(obj, keys) {
  const out = new Set();
  const wanted = new Set((keys || []).map((k) => String(k || "").toLowerCase()).filter(Boolean));
  const seen = new Set();

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    for (const [k, v] of Object.entries(node)) {
      const key = String(k || "").toLowerCase();
      if (wanted.has(key)) {
        if (typeof v === "string" || typeof v === "number") {
          const id = normalize(v);
          if (id) out.add(id);
        }
      }
      walk(v);
    }
  };

  walk(obj);
  return Array.from(out);
}

function isTrackableFlow(flow) {
  const status = String(flow?.status || "");
  if (!flow?.id) return false;
  if (flow?.archivedAt) return false;
  if (flow?.trashedAt) return false;
  if (status === "Canceled" || status === "Completed") return false;
  const kind = String(flow?.kind || "").toLowerCase();
  if (kind === "sharedsign") return false;
  return true;
}

router.head("/docspace", (_req, res) => {
  res.status(200).end();
});

router.post("/docspace", async (req, res) => {
  try {
    const cfg = getConfig();
    const secret = cfg.webhookSecret || "";
    const rawBody =
      req.rawBody instanceof Buffer ? req.rawBody : Buffer.from(stableJsonStringify(req.body || {}), "utf8");

    const signatureHeader =
      req.headers["x-docspace-signature-256"] ||
      req.headers["x-docspace-signature"] ||
      req.headers["x-onlyoffice-signature-256"] ||
      req.headers["x-onlyoffice-signature"] ||
      "";

    const signature = verifyDocSpaceSignature(rawBody, secret, signatureHeader);
    if (!signature.ok) {
      return res.status(401).json({ ok: false, error: "Invalid signature", details: signature.reason });
    }

    const payload = req.body || {};

    const fileIds = collectIdsByKeys(payload, ["fileId", "file_id", "documentId", "document_id"]);
    const roomIds = collectIdsByKeys(payload, ["roomId", "room_id"]);
    const folderIds = collectIdsByKeys(payload, [
      "folderId",
      "folder_id",
      "parentFolderId",
      "parent_folder_id",
      "toFolderId",
      "destFolderId"
    ]);

    const candidates = [];

    if (roomIds.length) {
      for (const rid of roomIds) {
        candidates.push(...listFlowsForRoom(rid).filter(isTrackableFlow));
      }
    }

    if (fileIds.length) {
      const all = listAllFlows() || [];
      for (const flow of all) {
        if (!isTrackableFlow(flow)) continue;
        const fid = normalize(flow?.fileId);
        const rf = normalize(flow?.resultFileId);
        if (fileIds.includes(fid) || (rf && fileIds.includes(rf))) candidates.push(flow);
      }
    }

    const byId = new Map();
    for (const f of candidates) {
      if (!f?.id) continue;
      byId.set(String(f.id), f);
    }
    const unique = Array.from(byId.values());

    if (unique.length) {
      await resolveFlowsStatus(unique).catch(() => null);
    }

    res.json({
      ok: true,
      signatureChecked: signature.checked,
      roomIds,
      folderIds,
      fileIds,
      flowsConsidered: unique.length
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message, details: error.details || null });
  }
});

export default router;
