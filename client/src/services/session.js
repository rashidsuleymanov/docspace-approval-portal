const sessionKey = "docspace.approval.portal.session";

export function loadSession() {
  const raw = localStorage.getItem(sessionKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(sessionKey, JSON.stringify(session || null));
}

export function clearSession() {
  localStorage.removeItem(sessionKey);
}

