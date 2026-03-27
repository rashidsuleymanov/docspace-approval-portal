import { Router } from "express";
import { randomUUID, randomBytes } from "node:crypto";
import {
  authenticateUser,
  createDocSpaceUser,
  createRoom,
  deleteRoom,
  deleteUser,
  getFileInfo,
  getFormsRoomFolders,
  getRoomInfo,
  shareRoom,
  terminateUsers,
  copyFileToFolder
} from "../docspaceClient.js";
import { createProject } from "../store.js";
import {
  clearDemoSessionCookie,
  createDemoSession,
  deleteDemoSession,
  listDemoSessions,
  setDemoSessionCookie
} from "../demoSessionStore.js";
import { cleanupDemoSession } from "./demoCleanup.js";

const router = Router();

// Simple in-memory rate limiter for /demo/start — no extra dependency needed.
const _startAttempts = new Map(); // ip -> number[]
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkDemoStartRateLimit(ip) {
  const now = Date.now();
  const times = (_startAttempts.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (times.length >= RATE_LIMIT_MAX) return false;
  times.push(now);
  _startAttempts.set(ip, times);
  // Prune map to prevent unbounded growth under sustained attack.
  if (_startAttempts.size > 5_000) {
    for (const [key, val] of _startAttempts) {
      if (val.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) _startAttempts.delete(key);
    }
  }
  return true;
}

const DEMO_RECIPIENT_FIRST_NAMES = [
  "Alex", "Jordan", "Morgan", "Casey", "Riley", "Taylor", "Drew", "Blake", "Avery", "Reese",
  "Quinn", "Skyler", "Dakota", "Sage", "Hayden", "Emerson", "Finley", "Parker", "Cameron", "Logan"
];
const DEMO_RECIPIENT_LAST_NAMES = [
  "Johnson", "Williams", "Davis", "Miller", "Wilson", "Moore", "Taylor", "Anderson", "Thomas", "Jackson",
  "White", "Harris", "Martin", "Garcia", "Martinez", "Robinson", "Clark", "Rodriguez", "Lewis", "Lee"
];

function normalizeEmailDomain(value) {
  const raw = String(value || "").trim();
  if (!raw) return "demo.local";
  return raw.replace(/^@+/, "");
}

function securePick(set) {
  // Rejection sampling to avoid modulo bias.
  const limit = 256 - (256 % set.length);
  let byte;
  do { byte = randomBytes(1)[0]; } while (byte >= limit);
  return set[byte % set.length];
}

function randomPassword() {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const special = "!@#$%^&*()-_=+[]{}";
  const all = upper + lower + digits + special;
  const length = 16;
  const chars = [securePick(upper), securePick(lower), securePick(digits), securePick(special)];
  while (chars.length < length) chars.push(securePick(all));
  // Fisher-Yates shuffle with secure random.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const limit = 256 - (256 % (i + 1));
    let byte;
    do { byte = randomBytes(1)[0]; } while (byte >= limit);
    const j = byte % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function buildEmail({ sessionId, role }) {
  const domain = normalizeEmailDomain(process.env.DEMO_EMAIL_DOMAIN || "demo.local");
  const slug = String(sessionId || "").replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase() || "demo";
  const r = String(role || "user").toLowerCase();
  return `demo+${slug}-${r}@${domain}`;
}

function sanitizeNameParts(value, fallbackFirst, fallbackLast) {
  const raw = String(value || "").trim();
  const cleaned = raw.replace(/[^A-Za-z\s-]/g, " ").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(" ").filter(Boolean);
  const firstName = parts[0] || fallbackFirst;
  const lastName = parts.slice(1).join(" ") || fallbackLast;
  return { firstName, lastName };
}

function buildSafeFullName(input, fallbackFirst, fallbackLast) {
  const parts = sanitizeNameParts(input, fallbackFirst, fallbackLast);
  return `${parts.firstName} ${parts.lastName}`.trim();
}

function hashSeed(value) {
  const raw = String(value || "");
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function recipientDisplayNameOf(session) {
  const displayName = String(session?.recipient?.user?.displayName || "").trim();
  if (displayName) return displayName;
  const firstName = String(session?.recipient?.user?.firstName || "").trim();
  const lastName = String(session?.recipient?.user?.lastName || "").trim();
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function buildDemoRecipientName(sessionId) {
  const used = new Set(
    listDemoSessions()
      .map(recipientDisplayNameOf)
      .map((v) => String(v || "").trim())
      .filter(Boolean)
  );

  const total = DEMO_RECIPIENT_FIRST_NAMES.length * DEMO_RECIPIENT_LAST_NAMES.length;
  const base = hashSeed(sessionId);
  for (let offset = 0; offset < total; offset += 1) {
    const index = (base + offset) % total;
    const firstName = DEMO_RECIPIENT_FIRST_NAMES[index % DEMO_RECIPIENT_FIRST_NAMES.length];
    const lastName = DEMO_RECIPIENT_LAST_NAMES[Math.floor(index / DEMO_RECIPIENT_FIRST_NAMES.length)];
    const fullName = `${firstName} ${lastName}`;
    if (!used.has(fullName)) return fullName;
  }
  return "Alex Johnson";
}

function userSafeProfile(user) {
  if (!user) return null;
  const displayName =
    user.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.userName ||
    user.email;
  return {
    id: user.id,
    displayName,
    email: user.email || ""
  };
}

function roomSafe(room) {
  if (!room?.id) return null;
  return {
    id: room.id,
    title: room.title || room.name || "Demo Project",
    webUrl: room.webUrl || room.shortWebUrl || null
  };
}

async function rollbackDemoCreation({ requesterUser, recipientUser, room }, sessionId) {
  const errors = [];

  if (room?.id) {
    await deleteRoom(room.id).catch((e) => errors.push(`deleteRoom: ${e?.message || e}`));
  }

  const userIds = [requesterUser?.id, recipientUser?.id].filter(Boolean).map(String);
  if (userIds.length) {
    await terminateUsers(userIds).catch((e) => errors.push(`terminateUsers: ${e?.message || e}`));
    for (const uid of userIds) {
      // eslint-disable-next-line no-await-in-loop
      await deleteUser(uid).catch((e) => errors.push(`deleteUser:${uid}: ${e?.message || e}`));
    }
  }

  if (errors.length) {
    console.error(`[demo/start] ORPHANED RESOURCES - partial rollback for session ${sessionId}:`, errors.join("; "));
    console.error("[demo/start] Manual cleanup required:", {
      roomId: room?.id || null,
      requesterUserId: requesterUser?.id || null,
      recipientUserId: recipientUser?.id || null
    });
  }
}

// Copy a demo template into the room's Templates folder if configured.
async function ensureDemoTemplate(projectRoomId) {
  const templateFileId = String(process.env.DOCSPACE_DEMO_TEMPLATE_FILE_ID || "").trim();
  if (!templateFileId) return;

  const info = await getFileInfo(templateFileId).catch(() => null);
  if (!info?.id) {
    console.warn("[demo/start] DOCSPACE_DEMO_TEMPLATE_FILE_ID not found:", templateFileId);
    return;
  }

  const folders = await getFormsRoomFolders(projectRoomId).catch(() => null);
  const templatesFolderId = folders?.templates?.id ? String(folders.templates.id) : String(projectRoomId);

  await copyFileToFolder({ fileId: templateFileId, destFolderId: templatesFolderId, toFillOut: true }).catch((e) => {
    console.warn("[demo/start] template copy failed:", e?.message || e);
  });
}

router.get("/session", async (req, res) => {
  const session = req.demoSession || null;
  if (!session) {
    return res.status(204).end();
  }
  return res.json({
    sessionId: session.id,
    requester: session.requester?.user ? userSafeProfile(session.requester.user) : null,
    requesterToken: session.requester?.token ? String(session.requester.token) : null,
    recipient: session.recipient?.user ? userSafeProfile(session.recipient.user) : null,
    recipientToken: session.recipient?.token ? String(session.recipient.token) : null,
    projectRoom: session.requester?.projectRoom ? roomSafe(session.requester.projectRoom) : null
  });
});

router.post("/start", async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  if (!checkDemoStartRateLimit(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait a minute before trying again." });
  }

  const created = { requesterUser: null, recipientUser: null, room: null };
  let session = null;

  try {
    // Clean up any existing session for this browser.
    const existing = req.demoSession || null;
    if (existing?.id) {
      await cleanupDemoSession(existing).catch(() => null);
      deleteDemoSession(existing.id);
      clearDemoSessionCookie(res);
    }

    session = createDemoSession({ requester: null, recipient: null });

    const rawName = String(req.body?.requesterName || "").trim().slice(0, 100);
    const requesterFullName = buildSafeFullName(rawName, "Demo", "User");
    const recipientFullName = buildDemoRecipientName(session.id);

    const requesterEmail = buildEmail({ sessionId: session.id, role: "requester" });
    const recipientEmail = buildEmail({ sessionId: session.id, role: "recipient" });
    const requesterPassword = randomPassword();
    const recipientPassword = randomPassword();

    created.requesterUser = await createDocSpaceUser({
      fullName: requesterFullName,
      email: requesterEmail,
      password: requesterPassword
    });
    created.recipientUser = await createDocSpaceUser({
      fullName: recipientFullName,
      email: recipientEmail,
      password: recipientPassword
    });

    const [requesterToken, recipientToken] = await Promise.all([
      authenticateUser({ userName: requesterEmail, password: requesterPassword }),
      authenticateUser({ userName: recipientEmail, password: recipientPassword })
    ]);

    // Create a FillingForms room (roomType 1) for this demo session.
    const roomTitle = `${requesterFullName}'s Demo Project`;
    const rawRoom = await createRoom({ title: roomTitle, roomType: 1 });
    const roomId = rawRoom?.id ?? rawRoom?.response?.id ?? rawRoom?.folder?.id ?? null;
    if (!roomId) throw new Error("Failed to create demo project room");
    created.room = { id: roomId, title: roomTitle };

    // Share: requester = ContentCreator, recipient = FillForms
    await shareRoom({
      roomId,
      invitations: [
        { id: String(created.requesterUser.id), access: "ContentCreator" },
        { id: String(created.recipientUser.id), access: "FillForms" }
      ],
      notify: false
    }).catch(() => null);

    const verifiedRoom = await getRoomInfo(roomId).catch(() => null);
    const finalRoom = verifiedRoom?.id ? verifiedRoom : created.room;

    // Copy demo template if configured.
    await ensureDemoTemplate(roomId).catch((e) =>
      console.warn("[demo/start] ensureDemoTemplate failed:", e?.message || e)
    );

    // Create a project record in the local store so the sidebar can find it.
    const projectId = randomUUID();
    createProject({
      id: projectId,
      title: finalRoom.title || roomTitle,
      roomId: String(finalRoom.id),
      roomUrl: finalRoom.webUrl || finalRoom.shortWebUrl || null
    });

    session.requester = {
      userId: String(created.requesterUser.id),
      token: requesterToken,
      user: created.requesterUser,
      projectRoomId: String(finalRoom.id),
      projectRoom: finalRoom,
      projectId
    };
    session.recipient = {
      userId: String(created.recipientUser.id),
      token: recipientToken,
      user: created.recipientUser
    };

    setDemoSessionCookie(res, session.id);

    return res.json({
      sessionId: session.id,
      requester: userSafeProfile(created.requesterUser),
      requesterToken: requesterToken || null,
      recipient: userSafeProfile(created.recipientUser),
      recipientToken: recipientToken || null,
      projectRoom: roomSafe(finalRoom)
    });
  } catch (error) {
    await rollbackDemoCreation(created, session?.id);
    if (session?.id) {
      deleteDemoSession(session.id);
    }
    const status = typeof error?.status === "number" ? error.status : 500;
    console.error("[demo/start]", error?.message || error, error?.details || "");
    // Never expose internal DocSpace API details to the client.
    const clientMessage = status >= 500 ? "Failed to start demo session" : (error?.message || "Failed to start demo session");
    return res.status(status).json({ error: clientMessage });
  }
});

router.post("/end", async (req, res) => {
  try {
    const session = req.demoSession || null;
    if (!session?.id) {
      clearDemoSessionCookie(res);
      return res.json({ ok: true });
    }
    const cleanup = await cleanupDemoSession(session);
    if (cleanup?.ok) {
      deleteDemoSession(session.id);
    }
    clearDemoSessionCookie(res);
    return res.json({ ok: true, cleanupPending: !cleanup?.ok });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

export default router;
