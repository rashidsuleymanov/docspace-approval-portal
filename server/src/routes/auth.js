import { Router } from "express";
import {
  authenticateUser,
  createUser,
  findRoomByCandidates,
  getRoomInfo,
  getSelfProfileWithToken,
  shareRoom,
  createRoom,
  requireFormsRoom
} from "../docspaceClient.js";
import { getConfig, updateConfig } from "../config.js";

const router = Router();

const _authAttempts = new Map();
function checkAuthRateLimit(ip) {
  const key = String(ip || "unknown");
  const now = Date.now();
  const windowMs = 60_000;
  const max = 5;
  if (_authAttempts.size > 5000) _authAttempts.clear();
  const timestamps = (_authAttempts.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= max) return false;
  timestamps.push(now);
  _authAttempts.set(key, timestamps);
  return true;
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

async function ensureProjectTemplatesRoom() {
  const cfg = getConfig();
  const configuredId = String(cfg.projectTemplatesRoomId || "").trim();
  if (configuredId) {
    const existing = await getRoomInfo(configuredId).catch(() => null);
    if (existing?.id) return existing;
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
  if (!roomId) return null;
  await updateConfig({
    projectTemplatesRoomId: String(roomId),
    projectTemplatesRoomTitle: cfg.projectTemplatesRoomTitle || "Projects Templates"
  }).catch(() => null);
  return { ...created, id: roomId };
}

router.post("/login", async (req, res) => {
  if (process.env.DEMO_MODE === "true") {
    return res.status(403).json({ error: "Login is disabled in demo mode. Use /api/demo/start instead." });
  }
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "");
  if (!checkAuthRateLimit(ip)) {
    return res.status(429).json({ error: "Too many login attempts. Please try again in a minute." });
  }
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const token = await authenticateUser({ userName: email, password });
    if (!token) {
      return res.status(401).json({ error: "DocSpace authentication failed" });
    }

    const user = await getSelfProfileWithToken(token);

    const cfg = getConfig();
    const roomCandidates = [
      cfg.formsRoomTitle,
      ...(cfg.formsRoomTitleFallbacks || []),
      "Forms Room",
      "Medical Room",
      "Medical Forms"
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    const formsRoom =
      (await findRoomByCandidates(roomCandidates, token).catch(() => null)) ||
      (await findRoomByCandidates(roomCandidates).catch(() => null)) ||
      (await requireFormsRoom(token).catch(() => null)) ||
      (await requireFormsRoom().catch(() => null)) ||
      null;

    const templatesRoom = await ensureProjectTemplatesRoom().catch(() => null);
    if (templatesRoom?.id && user?.id) {
      await shareRoom({
        roomId: String(templatesRoom.id),
        invitations: [{ id: String(user.id), access: "ContentCreator" }],
        notify: false
      }).catch(() => null);
    }

    res.json({ user, formsRoom, token });
  } catch (error) {
    const status = Number(error?.status) || 500;
    res.status(status).json({ error: status < 500 ? error.message : "Internal server error" });
  }
});

router.post("/register", async (req, res) => {
  if (process.env.DEMO_MODE === "true") {
    return res.status(403).json({ error: "Registration is disabled in demo mode. Use /api/demo/start instead." });
  }
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "");
  if (!checkAuthRateLimit(ip)) {
    return res.status(429).json({ error: "Too many registration attempts. Please try again in a minute." });
  }
  try {
    const cfg = getConfig();
    if (!String(cfg.rawAuthToken || "").trim()) {
      return res.status(501).json({
        error: "Registration is not configured.",
        details: "Open Settings and set an admin Authorization token first."
      });
    }

    const { firstName, lastName, email, password } = req.body || {};
    const em = String(email || "").trim();
    const pw = String(password || "").trim();
    if (!em || !pw) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    await createUser({
      firstName: String(firstName || "").trim(),
      lastName: String(lastName || "").trim(),
      email: em,
      password: pw
    });

    // Auto-login after successful creation.
    const token = await authenticateUser({ userName: em, password: pw });
    if (!token) {
      return res.status(201).json({ ok: true });
    }

    const user = await getSelfProfileWithToken(token);
    const room = await ensureProjectTemplatesRoom().catch(() => null);
    if (room?.id && user?.id) {
      await shareRoom({
        roomId: String(room.id),
        invitations: [{ id: String(user.id), access: "ContentCreator" }],
        notify: false
      }).catch(() => null);
    }
    res.status(201).json({ user, token });
  } catch (error) {
    const status = Number(error?.status) || 500;
    res.status(status).json({ error: status < 500 ? error.message : "Internal server error" });
  }
});

router.get("/session", (_req, res) => {
  res.status(501).json({ error: "Session storage disabled for local-only setup" });
});

export default router;
