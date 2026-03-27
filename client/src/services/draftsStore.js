function normalize(value) {
  return String(value || "").trim();
}

function userKeyFrom(session) {
  const id = normalize(session?.user?.id);
  if (id) return id;
  const email = normalize(session?.user?.email).toLowerCase();
  return email || "me";
}

function storageKeyFor(session) {
  return `portal:drafts:${userKeyFrom(session)}`;
}

function safeParse(json) {
  try {
    return JSON.parse(String(json || ""));
  } catch {
    return null;
  }
}

function safeNowIso() {
  return new Date().toISOString();
}

export function listLocalDrafts(session) {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(storageKeyFor(session));
  const data = safeParse(raw);
  const items = Array.isArray(data) ? data : [];
  return items
    .filter((d) => d && typeof d === "object" && normalize(d.id))
    .map((d) => ({
      id: normalize(d.id),
      type: normalize(d.type) || "request",
      title: normalize(d.title) || "Draft",
      payload: d.payload && typeof d.payload === "object" ? d.payload : {},
      createdAt: normalize(d.createdAt) || safeNowIso(),
      updatedAt: normalize(d.updatedAt) || normalize(d.createdAt) || safeNowIso()
    }))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

export function saveLocalDraft(session, draft) {
  if (typeof window === "undefined") return null;
  const id = normalize(draft?.id) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const type = normalize(draft?.type) || "request";
  const title = normalize(draft?.title) || "Draft";
  const payload = draft?.payload && typeof draft.payload === "object" ? draft.payload : {};

  const existing = listLocalDrafts(session);
  const now = safeNowIso();
  const createdAt = normalize(draft?.createdAt) || now;
  const updatedAt = now;

  const next = [{ id, type, title, payload, createdAt, updatedAt }, ...existing.filter((d) => d.id !== id)];
  window.localStorage.setItem(storageKeyFor(session), JSON.stringify(next.slice(0, 50)));
  return next[0];
}

export function deleteLocalDraft(session, draftId) {
  if (typeof window === "undefined") return false;
  const id = normalize(draftId);
  if (!id) return false;
  const existing = listLocalDrafts(session);
  const next = existing.filter((d) => d.id !== id);
  window.localStorage.setItem(storageKeyFor(session), JSON.stringify(next));
  return next.length !== existing.length;
}

