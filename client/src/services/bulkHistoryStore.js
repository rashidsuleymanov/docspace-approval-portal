function normalize(value) {
  return String(value || "").trim();
}

function userKeyFrom(session) {
  const id = normalize(session?.user?.id);
  if (id) return id;
  const email = normalize(session?.user?.email).toLowerCase();
  return email || "me";
}

function storageKeyFor(session, type) {
  const t = normalize(type) || "bulkSend";
  return `portal:bulkHistory:${t}:${userKeyFrom(session)}`;
}

function safeParse(json) {
  try {
    return JSON.parse(String(json || ""));
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

export function listBulkBatches(session, type, { includeTrashed = false, trashedOnly = false } = {}) {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(storageKeyFor(session, type));
  const data = safeParse(raw);
  const items = Array.isArray(data) ? data : [];
  let list = items
    .filter((b) => b && typeof b === "object" && normalize(b.id))
    .map((b) => ({
      id: normalize(b.id),
      type: normalize(b.type) || normalize(type) || "bulkSend",
      title: normalize(b.title) || "Batch",
      payload: b.payload && typeof b.payload === "object" ? b.payload : {},
      createdAt: normalize(b.createdAt) || nowIso(),
      updatedAt: normalize(b.updatedAt) || normalize(b.createdAt) || nowIso(),
      trashedAt: normalize(b.trashedAt) || ""
    }));

  if (trashedOnly) list = list.filter((b) => Boolean(b.trashedAt));
  else if (!includeTrashed) list = list.filter((b) => !b.trashedAt);

  list.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
  return list;
}

export function saveBulkBatch(session, type, batch) {
  if (typeof window === "undefined") return null;
  const id = normalize(batch?.id) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const t = normalize(batch?.type) || normalize(type) || "bulkSend";
  const title = normalize(batch?.title) || "Batch";
  const payload = batch?.payload && typeof batch.payload === "object" ? batch.payload : {};
  const existing = listBulkBatches(session, t, { includeTrashed: true });
  const createdAt = normalize(batch?.createdAt) || nowIso();
  const updatedAt = nowIso();
  const trashedAt = normalize(batch?.trashedAt) || "";

  const next = [{ id, type: t, title, payload, createdAt, updatedAt, trashedAt }, ...existing.filter((b) => b.id !== id)];
  window.localStorage.setItem(storageKeyFor(session, t), JSON.stringify(next.slice(0, 50)));
  return next[0];
}

export function trashBulkBatch(session, type, batchId) {
  const id = normalize(batchId);
  if (!id) return false;
  const t = normalize(type) || "bulkSend";
  const existing = listBulkBatches(session, t, { includeTrashed: true });
  const idx = existing.findIndex((b) => b.id === id);
  if (idx < 0) return false;
  existing[idx] = { ...existing[idx], trashedAt: nowIso(), updatedAt: nowIso() };
  window.localStorage.setItem(storageKeyFor(session, t), JSON.stringify(existing));
  return true;
}

export function restoreBulkBatch(session, type, batchId) {
  const id = normalize(batchId);
  if (!id) return false;
  const t = normalize(type) || "bulkSend";
  const existing = listBulkBatches(session, t, { includeTrashed: true });
  const idx = existing.findIndex((b) => b.id === id);
  if (idx < 0) return false;
  existing[idx] = { ...existing[idx], trashedAt: "", updatedAt: nowIso() };
  window.localStorage.setItem(storageKeyFor(session, t), JSON.stringify(existing));
  return true;
}

export function deleteBulkBatch(session, type, batchId) {
  const id = normalize(batchId);
  if (!id) return false;
  const t = normalize(type) || "bulkSend";
  const existing = listBulkBatches(session, t, { includeTrashed: true });
  const next = existing.filter((b) => b.id !== id);
  window.localStorage.setItem(storageKeyFor(session, t), JSON.stringify(next));
  return next.length !== existing.length;
}

