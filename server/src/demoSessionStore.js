import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadStoreSnapshot, saveStoreSnapshot } from "./storePersistence.js";

const COOKIE_NAME = process.env.DEMO_COOKIE_NAME || "approval_demo_sid";

function parseEnvMinutes(envVar, defaultVal, min = 1, max = 1440) {
  const raw = process.env[envVar];
  if (raw == null || raw === "") return defaultVal;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.warn(`[demo-session-store] ${envVar}="${raw}" is out of range [${min}, ${max}], using default ${defaultVal}`);
    return defaultVal;
  }
  return n;
}

function parseEnvSeconds(envVar, defaultVal, min = 10, max = 3600) {
  const raw = process.env[envVar];
  if (raw == null || raw === "") return defaultVal;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.warn(`[demo-session-store] ${envVar}="${raw}" is out of range [${min}, ${max}], using default ${defaultVal}`);
    return defaultVal;
  }
  return n;
}

const TTL_MINUTES = parseEnvMinutes("DEMO_SESSION_TTL_MINUTES", 45);
const IDLE_MINUTES = parseEnvMinutes("DEMO_SESSION_IDLE_MINUTES", 20);
const JANITOR_INTERVAL_SECONDS = parseEnvSeconds("DEMO_SESSION_JANITOR_INTERVAL_SECONDS", 60);
const PERSIST_PATH = getDemoSessionStorePath();

function minutesToMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 60 * 1000);
}

const TTL_MS = minutesToMs(TTL_MINUTES);
const IDLE_MS = minutesToMs(IDLE_MINUTES);

function nowMs() {
  return Date.now();
}

function getDemoSessionStorePath() {
  const raw = String(process.env.DEMO_SESSION_STORE_PATH || "").trim();
  if (raw.toLowerCase() === "off" || raw.toLowerCase() === "false") return null;
  if (raw) return path.resolve(process.cwd(), raw);
  return path.resolve(process.cwd(), "server/.data/demo-sessions.json");
}

function parseCookies(header) {
  const raw = String(header || "");
  if (!raw) return {};
  const out = {};
  raw.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) return;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  });
  return out;
}

function buildCookie({ name, value, maxAgeSeconds, secure } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (typeof maxAgeSeconds === "number") parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function getDemoCookieName() {
  return COOKIE_NAME;
}

export function setDemoSessionCookie(res, sessionId) {
  const secure = process.env.NODE_ENV === "production";
  const maxAgeSeconds = TTL_MS ? Math.ceil(TTL_MS / 1000) : undefined;
  res.setHeader("Set-Cookie", buildCookie({ name: COOKIE_NAME, value: sessionId, maxAgeSeconds, secure }));
}

export function clearDemoSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production";
  res.setHeader("Set-Cookie", buildCookie({ name: COOKIE_NAME, value: "", maxAgeSeconds: 0, secure }));
}

export function getDemoSessionId(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const sid = String(cookies[COOKIE_NAME] || "").trim();
  return sid || null;
}

const sessions = new Map();
let persistTimer = null;
let persistPromise = Promise.resolve();
let hydrated = false;

// Serialize for disk — tokens are NOT persisted (security).
function serializeSession(session) {
  if (!session?.id) return null;
  return {
    id: String(session.id),
    createdAt: Number(session.createdAt || nowMs()),
    lastSeenAt: Number(session.lastSeenAt || nowMs()),
    requester: session.requester
      ? {
          userId: session.requester.userId ? String(session.requester.userId) : null,
          projectRoomId: session.requester.projectRoomId ? String(session.requester.projectRoomId) : null,
          projectId: session.requester.projectId ? String(session.requester.projectId) : null,
          user: session.requester.user
            ? {
                id: session.requester.user.id || null,
                displayName: session.requester.user.displayName || null,
                email: session.requester.user.email || null
              }
            : null,
          projectRoom: session.requester.projectRoom
            ? {
                id: session.requester.projectRoom.id || null,
                title: session.requester.projectRoom.title || null
              }
            : null
        }
      : null,
    recipient: session.recipient
      ? {
          userId: session.recipient.userId ? String(session.recipient.userId) : null,
          user: session.recipient.user
            ? {
                id: session.recipient.user.id || null,
                displayName: session.recipient.user.displayName || null,
                email: session.recipient.user.email || null
              }
            : null
        }
      : null
  };
}

function persistSnapshot() {
  const snapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sessions: listDemoSessions().map(serializeSession).filter(Boolean)
  };
  persistPromise = persistPromise
    .catch(() => null)
    .then(() => saveStoreSnapshot(PERSIST_PATH, snapshot))
    .catch((error) => {
      console.warn("[demo-session-store] persist failed", error?.message || error);
    });
  return persistPromise;
}

function schedulePersist() {
  if (!PERSIST_PATH) return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistSnapshot();
  }, 150);
  persistTimer.unref?.();
}

function normalizeLoadedSession(raw) {
  const id = String(raw?.id || "").trim();
  if (!id) return null;
  return {
    id,
    createdAt: Number(raw?.createdAt || nowMs()),
    lastSeenAt: Number(raw?.lastSeenAt || raw?.createdAt || nowMs()),
    requester: raw?.requester
      ? {
          userId: raw.requester.userId ? String(raw.requester.userId) : null,
          projectRoomId: raw.requester.projectRoomId ? String(raw.requester.projectRoomId) : null,
          projectId: raw.requester.projectId ? String(raw.requester.projectId) : null,
          user: raw.requester.user || null,
          projectRoom: raw.requester.projectRoom || null
          // token is NOT restored from disk
        }
      : null,
    recipient: raw?.recipient
      ? {
          userId: raw.recipient.userId ? String(raw.recipient.userId) : null,
          user: raw.recipient.user || null
          // token is NOT restored from disk
        }
      : null
  };
}

export async function hydrateDemoSessions() {
  if (hydrated) return listDemoSessions();
  hydrated = true;
  const snapshot = await loadStoreSnapshot(PERSIST_PATH).catch((error) => {
    console.warn("[demo-session-store] hydrate failed", error?.message || error);
    return null;
  });
  const entries = Array.isArray(snapshot?.sessions) ? snapshot.sessions : [];
  sessions.clear();
  entries.map(normalizeLoadedSession).filter(Boolean).forEach((session) => {
    sessions.set(session.id, session);
  });
  return listDemoSessions();
}

export async function flushDemoSessions() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
    await persistSnapshot();
    return;
  }
  await persistPromise.catch(() => null);
}

export function createDemoSession(initial) {
  const id = randomUUID();
  const createdAt = nowMs();
  const session = {
    id,
    createdAt,
    lastSeenAt: createdAt,
    ...initial
  };
  sessions.set(id, session);
  schedulePersist();
  return session;
}

export function touchDemoSession(session) {
  if (!session) return;
  session.lastSeenAt = nowMs();
  schedulePersist();
}

export function getDemoSessionById(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  return sessions.get(id) || null;
}

export function deleteDemoSession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return false;
  const deleted = sessions.delete(id);
  if (deleted) schedulePersist();
  return deleted;
}

export function listDemoSessions() {
  return Array.from(sessions.values());
}

export function isDemoSessionExpired(session, timestampMs = nowMs()) {
  if (!session) return true;
  if (TTL_MS && timestampMs - Number(session.createdAt || 0) > TTL_MS) return true;
  if (IDLE_MS && timestampMs - Number(session.lastSeenAt || 0) > IDLE_MS) return true;
  return false;
}

export function startDemoJanitor({ onExpire } = {}) {
  const intervalMs = Math.max(10_000, Math.floor(Number(JANITOR_INTERVAL_SECONDS || 60) * 1000));
  const timer = setInterval(async () => {
    const ts = nowMs();
    const expired = listDemoSessions().filter((s) => isDemoSessionExpired(s, ts));
    for (const session of expired) {
      let cleanupOk = false;
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await onExpire?.(session);
        cleanupOk = result?.ok !== false;
      } catch (e) {
        console.warn("[demo-janitor] cleanup failed", session?.id, e?.message || e);
      } finally {
        if (cleanupOk) {
          deleteDemoSession(session?.id);
        }
      }
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function cleanupStoredDemoSessions({ onCleanup, predicate } = {}) {
  const targets = listDemoSessions().filter((session) => (predicate ? predicate(session) : true));
  for (const session of targets) {
    let cleanupOk = false;
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await onCleanup?.(session);
      cleanupOk = result?.ok !== false;
    } catch (error) {
      console.warn("[demo-session-store] cleanup failed", session?.id, error?.message || error);
    }
    if (cleanupOk) {
      deleteDemoSession(session.id);
    }
  }
  await flushDemoSessions();
  return listDemoSessions();
}
