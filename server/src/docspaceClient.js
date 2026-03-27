import { getConfig } from "./config.js";

function normalizeAuthHeader(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";

  // DocSpace personal access tokens are passed as a raw value in `Authorization` header.
  // If the user provides an explicit scheme (e.g., "Bearer ..."), keep it as-is.
  if (/\s/.test(trimmed)) return trimmed;

  return trimmed;
}

function resolveRuntimeConfig({ requiresAuth = true, providedAuth } = {}) {
  const cfg = getConfig();
  const baseUrl = String(cfg.baseUrl || "").trim();
  const adminAuthHeader = cfg.rawAuthToken ? normalizeAuthHeader(String(cfg.rawAuthToken)) : "";

  if (!baseUrl) {
    throw new Error("DOCSPACE_BASE_URL is not set");
  }
  if (requiresAuth && !normalizeAuthHeader(providedAuth || adminAuthHeader)) {
    throw new Error("DOCSPACE_AUTH_TOKEN is not set");
  }

  return { cfg, baseUrl, adminAuthHeader };
}

async function apiRequest(path, { method = "GET", body, auth } = {}) {
  const runtime = resolveRuntimeConfig({ requiresAuth: !auth, providedAuth: auth });
  const authorization = normalizeAuthHeader(auth || runtime.adminAuthHeader);
  const response = await fetch(`${runtime.baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Authorization: authorization
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const rawText = await response.text().catch(() => "");
  const data = rawText
    ? (() => {
        try {
          return JSON.parse(rawText);
        } catch {
          return { raw: rawText };
        }
      })()
    : {};
  if (!response.ok) {
    const message =
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.message === "string" && data.message) ||
      (typeof data?.raw === "string" && data.raw) ||
      response.statusText;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data?.response ?? data;
}

function normalizeFolderContent(content, fallbackId) {
  const items = Array.isArray(content?.items)
    ? content.items
    : [
        ...(Array.isArray(content?.folders) ? content.folders.map((f) => ({ ...f, type: "folder" })) : []),
        ...(Array.isArray(content?.files) ? content.files.map((f) => ({ ...f, type: "file" })) : [])
      ];

  const normalized = items
    .map((entry) => {
      const type = entry?.type || (entry?.fileExst || entry?.isFile ? "file" : "folder");
      if (type === "folder") {
        return {
          ...entry,
          id: entry?.id,
          title: entry?.title,
          type: "folder",
          folderType: entry?.folderType ?? null,
          rootFolderType: entry?.rootFolderType ?? null
        };
      }
      return {
        ...entry,
        id: entry?.id,
        title: entry?.title,
        type: "file",
        fileExst: entry?.fileExst ?? null,
        isForm: entry?.isForm ?? null,
        webUrl: entry?.webUrl ?? entry?.viewUrl ?? null,
        created: entry?.created ?? null,
        updated: entry?.updated ?? null
      };
    })
    .filter((x) => x?.id);

  return {
    id: content?.id || fallbackId || null,
    title: content?.title || "Folder",
    items: normalized
  };
}

export async function authenticateUser({ userName, password }) {
  const runtime = resolveRuntimeConfig({ requiresAuth: false });
  const response = await fetch(`${runtime.baseUrl}/api/2.0/authentication`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName, password })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || data?.message || response.statusText;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data?.response?.token || null;
}

export async function getSelfProfileWithToken(token) {
  if (!token) throw new Error("User token is required");
  return apiRequest("/api/2.0/people/@self", { auth: token });
}

export async function getAdminProfile() {
  return apiRequest("/api/2.0/people/@self");
}

export async function getTokenClaims() {
  return apiRequest("/api/2.0/people/tokendiagnostics");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export async function listRooms(auth) {
  const roomsFolder = await apiRequest("/api/2.0/files/rooms", { auth });
  return roomsFolder?.folders || [];
}

export async function getRoomInfo(roomId, auth) {
  const rid = String(roomId || "").trim();
  if (!rid) throw new Error("roomId is required");
  return apiRequest(`/api/2.0/files/rooms/${encodeURIComponent(rid)}`, { auth });
}

export async function createRoom({ title, roomType } = {}) {
  const roomTitle = String(title || "").trim();
  if (!roomTitle) throw new Error("title is required");
  if (roomType === undefined || roomType === null || roomType === "") {
    throw new Error("roomType is required");
  }
  return apiRequest("/api/2.0/files/rooms", {
    method: "POST",
    body: {
      title: roomTitle,
      roomType
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeFileOpId(value) {
  const raw = String(value || "").trim();
  return raw;
}

function getFileOpEntry(list, opId) {
  const id = normalizeFileOpId(opId);
  if (!id) return null;
  const items = Array.isArray(list)
    ? list
    : Array.isArray(list?.items)
      ? list.items
      : Array.isArray(list?.operations)
        ? list.operations
        : [];
  return items.find((entry) => normalizeFileOpId(entry?.id ?? entry?.operationId ?? entry?.ID) === id) || null;
}

export async function listFileOps(auth) {
  const data = await apiRequest("/api/2.0/files/fileops", { auth });
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.operations)) return data.operations;
  return [];
}

async function waitFileOp(opId, auth, { timeoutMs = 12000, intervalMs = 650 } = {}) {
  const id = normalizeFileOpId(opId);
  if (!id) return { pending: false, operationId: null };
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    let list = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      list = await listFileOps(auth);
    } catch (e) {
      return { pending: true, operationId: id, error: e?.message || "Unable to check file operation status" };
    }

    const entry = getFileOpEntry(list, id);
    if (!entry) {
      // Some DocSpace builds remove completed operations from the list.
      return { pending: false, operationId: id };
    }

    const done =
      Boolean(entry?.finished) ||
      Number(entry?.progress ?? entry?.percents ?? entry?.percentage ?? entry?.percent ?? 0) >= 100;

    if (done) {
      const errorText = String(entry?.error || "").trim();
      if (errorText) {
        const error = new Error(errorText);
        error.details = entry;
        throw error;
      }
      return { pending: false, operationId: id };
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }

  return { pending: true, operationId: id, error: "DocSpace is still processing this operation" };
}

export async function archiveRoom(roomId, auth) {
  const rid = String(roomId || "").trim();
  if (!rid) throw new Error("roomId is required");

  // DocSpace expects JSON content-type even when the body is empty.
  const op = await apiRequest(`/api/2.0/files/rooms/${encodeURIComponent(rid)}/archive`, {
    method: "PUT",
    auth,
    body: {}
  });

  const opId = normalizeFileOpId(op?.id ?? op?.operationId);
  const finished = op?.finished === undefined ? null : Boolean(op.finished);

  if (opId && finished === false) {
    const waited = await waitFileOp(opId, auth, { timeoutMs: 12000, intervalMs: 650 });
    return { operationId: waited.operationId || opId, pending: Boolean(waited.pending) };
  }

  return { operationId: opId || null, pending: false };
}

export async function unarchiveRoom(roomId, auth) {
  const rid = String(roomId || "").trim();
  if (!rid) throw new Error("roomId is required");
  // DocSpace expects JSON content-type even when the body is empty.
  return apiRequest(`/api/2.0/files/rooms/${encodeURIComponent(rid)}/unarchive`, {
    method: "PUT",
    auth,
    body: {}
  });
}

export async function findRoomByCandidates(candidates, auth) {
  const list = await listRooms(auth);
  const normalized = (candidates || [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => ({ key: normalize(value) }));
  if (!normalized.length) return null;
  const rooms = (list || []).map((r) => ({ ...r, key: normalize(r.title || r.name) }));
  for (const candidate of normalized) {
    const match = rooms.find((r) => r.key === candidate.key);
    if (match) return match;
  }
  for (const candidate of normalized) {
    const match = rooms.find((r) => r.key.includes(candidate.key));
    if (match) return match;
  }
  return null;
}

export async function requireFormsRoom(auth) {
  const cfg = getConfig();
  const configuredId = String(cfg.formsRoomId || "").trim();
  if (configuredId) {
    const room = await getRoomInfo(configuredId, auth).catch(() => null);
    if (room?.id) return room;
  }
  const candidates = [cfg.formsRoomTitle, ...(cfg.formsRoomTitleFallbacks || [])]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  const room = await findRoomByCandidates(candidates, auth);
  if (!room?.id) {
    throw new Error(
      `Forms room not found. Configure DOCSPACE_FORMS_ROOM_TITLE (candidates: ${candidates.join(", ") || "Forms Room"}).`
    );
  }
  return room;
}

export async function getUserByEmail(email, auth) {
  const value = String(email || "").trim();
  if (!value) return null;
  return apiRequest(`/api/2.0/people/email?email=${encodeURIComponent(value)}`, { auth });
}

export async function createUser({ firstName, lastName, email, password } = {}) {
  const fn = String(firstName || "").trim();
  const ln = String(lastName || "").trim();
  const em = String(email || "").trim();
  const pw = String(password || "").trim();

  if (!em) throw new Error("email is required");
  if (!pw) throw new Error("password is required");

  return apiRequest("/api/2.0/people", {
    method: "POST",
    body: {
      firstName: fn || em.split("@")[0] || "User",
      lastName: ln,
      email: em,
      password: pw
    }
  });
}

export async function createUserProfile({ firstName, lastName, email } = {}, auth) {
  const fn = String(firstName || "").trim();
  const ln = String(lastName || "").trim();
  const em = String(email || "").trim();
  if (!em) throw new Error("email is required");
  return apiRequest("/api/2.0/people", {
    method: "POST",
    auth,
    body: {
      firstName: fn || em.split("@")[0] || "User",
      lastName: ln,
      email: em
    }
  });
}

export async function inviteUsers({ emails, message, subject } = {}, auth) {
  const list = Array.isArray(emails) ? emails : [];
  const invitations = list.map((e) => String(e || "").trim()).filter(Boolean).map((email) => ({ email, type: "All" }));
  if (!invitations.length) throw new Error("emails are required");
  const body = { invitations };
  if (message) body.message = String(message);
  if (subject) body.subject = String(subject);
  return apiRequest("/api/2.0/people/invite", { method: "POST", auth, body });
}

export async function deleteUser(userId, auth) {
  const id = String(userId || "").trim();
  if (!id) throw new Error("userId is required");
  return apiRequest(`/api/2.0/people/${encodeURIComponent(id)}`, { method: "DELETE", auth });
}

export async function searchUsers(query, auth) {
  const q = String(query || "").trim();
  if (!q) return [];
  const response = await apiRequest(`/api/2.0/people/search?query=${encodeURIComponent(q)}`, { auth });
  return Array.isArray(response) ? response : [];
}

export async function listPeople(auth) {
  const response = await apiRequest("/api/2.0/people", { auth });
  const list = Array.isArray(response) ? response : response?.users || response?.items || response?.response || [];
  return Array.isArray(list) ? list : [];
}

export async function listGroups(auth) {
  const paths = ["/api/2.0/group", "/api/2.0/groups"];
  let lastError = null;
  for (const path of paths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await apiRequest(path, { auth });
      const list = Array.isArray(response) ? response : response?.groups || response?.items || response?.response || [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("Failed to load groups");
}

export async function getGroupInfo(groupId, { includeMembers = true } = {}, auth) {
  const gid = String(groupId || "").trim();
  if (!gid) throw new Error("groupId is required");
  const query = includeMembers ? "?includeMembers=true" : "";
  const paths = [`/api/2.0/group/${encodeURIComponent(gid)}${query}`, `/api/2.0/groups/${encodeURIComponent(gid)}${query}`];
  let lastError = null;
  for (const path of paths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await apiRequest(path, { auth });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("Failed to load group");
}

export async function createGroup({ groupName, groupManager, members } = {}, auth) {
  const name = String(groupName || "").trim();
  const manager = String(groupManager || "").trim();
  const list = Array.isArray(members) ? members.map((m) => String(m || "").trim()).filter(Boolean) : [];
  if (!name) throw new Error("groupName is required");
  const body = { groupName: name };
  if (manager) body.groupManager = manager;
  if (list.length) body.members = list;
  return apiRequest("/api/2.0/group", { method: "POST", auth, body });
}

export async function updateGroup(groupId, { groupName, groupManager, membersToAdd } = {}, auth) {
  const gid = String(groupId || "").trim();
  if (!gid) throw new Error("groupId is required");
  const name = String(groupName || "").trim();
  const manager = String(groupManager || "").trim();
  const list = Array.isArray(membersToAdd) ? membersToAdd.map((m) => String(m || "").trim()).filter(Boolean) : [];
  const body = {};
  if (name) body.groupName = name;
  if (manager) body.groupManager = manager;
  if (list.length) body.membersToAdd = list;
  if (!Object.keys(body).length) throw new Error("Nothing to update");
  return apiRequest(`/api/2.0/group/${encodeURIComponent(gid)}`, { method: "PUT", auth, body });
}

export async function removeGroupMembers(groupId, { members } = {}, auth) {
  const gid = String(groupId || "").trim();
  if (!gid) throw new Error("groupId is required");
  const list = Array.isArray(members) ? members.map((m) => String(m || "").trim()).filter(Boolean) : [];
  if (!list.length) throw new Error("members are required");
  return apiRequest(`/api/2.0/group/${encodeURIComponent(gid)}/members`, { method: "DELETE", auth, body: { members: list } });
}

export async function deleteGroup(groupId, auth) {
  const gid = String(groupId || "").trim();
  if (!gid) throw new Error("groupId is required");
  return apiRequest(`/api/2.0/group/${encodeURIComponent(gid)}`, { method: "DELETE", auth });
}

export async function shareRoom({ roomId, invitations, notify = false, message } = {}, auth) {
  const rid = String(roomId || "").trim();
  if (!rid || !Array.isArray(invitations) || !invitations.length) return null;
  const body = { invitations, notify };
  if (message) body.message = message;
  return apiRequest(`/api/2.0/files/rooms/${encodeURIComponent(rid)}/share`, {
    method: "PUT",
    body,
    auth
  });
}

export async function getRoomSecurityInfo(roomId, auth) {
  const rid = String(roomId || "").trim();
  if (!rid) throw new Error("roomId is required");
  return apiRequest(`/api/2.0/files/rooms/${encodeURIComponent(rid)}/share`, { auth });
}

export async function getFolderContents(folderId, auth) {
  const id = String(folderId || "").trim();
  if (!id) throw new Error("folderId is required");
  const content = await apiRequest(`/api/2.0/files/${encodeURIComponent(id)}`, { auth });
  return normalizeFolderContent(content, id);
}

async function getFolderByTitleWithin(folderId, title, auth) {
  const contents = await getFolderContents(folderId, auth);
  const items = Array.isArray(contents?.items) ? contents.items : [];
  const target = normalize(title);
  const exact = items.find((i) => i.type === "folder" && normalize(i.title) === target);
  const match = exact || items.find((i) => i.type === "folder" && normalize(i.title).includes(target));
  return match || null;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function findFolderByTypes(items, types) {
  const wanted = new Set((types || []).map((t) => Number(t)).filter((t) => Number.isFinite(t)));
  if (!wanted.size) return null;
  return (
    items.find((i) => i.type === "folder" && wanted.has(asNumber(i.folderType))) ||
    items.find((i) => i.type === "folder" && wanted.has(asNumber(i.rootFolderType))) ||
    null
  );
}

function findFolderByTitle(items, title) {
  const target = normalize(title);
  const exact = items.find((i) => i.type === "folder" && normalize(i.title) === target);
  const match = exact || items.find((i) => i.type === "folder" && normalize(i.title).includes(target));
  return match || null;
}

export async function getFormsRoomFolders(roomId, auth) {
  const rid = String(roomId || "").trim();
  if (!rid) throw new Error("roomId is required");
  const cfg = getConfig();

  const contents = await getFolderContents(rid, auth);
  const items = Array.isArray(contents?.items) ? contents.items : [];

  // Prefer folderType for system folders (more reliable than localized titles).
  // FolderType docs: InProcessFormFolder=26, FormFillingFolderDone=27, FormFillingFolderInProgress=28, ReadyFormFolder=25.
  const inProcess = findFolderByTypes(items, [26, 28]) || findFolderByTitle(items, "In Process");
  const complete = findFolderByTypes(items, [27]) || findFolderByTitle(items, "Complete");
  const templates =
    findFolderByTypes(items, [25]) ||
    (cfg.formsTemplatesFolderTitle ? findFolderByTitle(items, cfg.formsTemplatesFolderTitle) : null) ||
    findFolderByTitle(items, "Templates");

  return {
    inProcess: inProcess?.id ? inProcess : null,
    complete: complete?.id ? complete : null,
    templates: templates?.id ? templates : { id: rid, title: contents?.title || "Room root" }
  };
}

export async function getFileInfo(fileId, auth) {
  const id = String(fileId || "").trim();
  if (!id) throw new Error("fileId is required");
  return apiRequest(`/api/2.0/files/file/${encodeURIComponent(id)}`, { auth });
}

export async function getFileExternalLinks(fileId, auth) {
  const id = String(fileId || "").trim();
  if (!id) throw new Error("fileId is required");
  return apiRequest(`/api/2.0/files/file/${encodeURIComponent(id)}/links`, { auth });
}

export async function deleteFile(fileId, auth, { immediately = true } = {}) {
  const id = String(fileId || "").trim();
  if (!id) throw new Error("fileId is required");
  return apiRequest(`/api/2.0/files/file/${encodeURIComponent(id)}`, {
    method: "DELETE",
    auth,
    body: { immediately: Boolean(immediately) }
  });
}

function normalizeLinkEntry(entry) {
  const shared = entry?.sharedLink || entry?.sharedTo || entry?.shared || entry || {};
  const shareLink = shared?.shareLink || entry?.shareLink || null;
  const requestToken = shared?.requestToken || entry?.requestToken || null;
  const title = shared?.title || entry?.title || "";
  const linkType = shared?.linkType ?? entry?.linkType ?? null;
  const internal = shared?.internal ?? entry?.internal ?? null;
  const primary = shared?.primary ?? entry?.primary ?? null;

  return {
    id: shared?.id || entry?.id || null,
    title: String(title || ""),
    shareLink: shareLink ? String(shareLink) : null,
    requestToken: requestToken ? String(requestToken) : null,
    linkType,
    internal: typeof internal === "boolean" ? internal : null,
    primary: typeof primary === "boolean" ? primary : null
  };
}

export async function getFillOutLink(fileId, auth) {
  const links = await getFileExternalLinks(fileId, auth);
  const normalized = (links || []).map(normalizeLinkEntry).filter((l) => l.shareLink);
  const preferred =
    normalized.find((l) => l.title.toLowerCase() === "link to fill out") ||
    normalized.find((l) => l.title.toLowerCase().includes("fill out")) ||
    normalized.find((l) => l.linkType === 1) ||
    normalized.find((l) => l.primary && l.internal === false) ||
    normalized.find((l) => l.internal === false) ||
    null;
  return preferred || null;
}

export async function ensureExternalLinkAccess(fileId, { access = "FillForms", title } = {}, auth) {
  const fid = String(fileId || "").trim();
  if (!fid) throw new Error("fileId is required");
  const desiredAccess = String(access || "").trim();
  if (!desiredAccess) throw new Error("access is required");

  const links = await getFileExternalLinks(fid, auth);
  const normalized = (links || []).map(normalizeLinkEntry).filter((l) => l.shareLink);
  const existing =
    normalized.find((l) => l.primary && l.internal === false && l.id) ||
    normalized.find((l) => l.internal === false && l.id) ||
    normalized.find((l) => l.id) ||
    null;

  const body = {
    access: desiredAccess,
    internal: false,
    primary: true
  };
  if (existing?.id) body.linkId = String(existing.id);
  if (title) body.title = String(title).slice(0, 255);

  await apiRequest(`/api/2.0/files/file/${encodeURIComponent(fid)}/links`, {
    method: "PUT",
    auth,
    body
  });

  const after = await getFileExternalLinks(fid, auth);
  const updated = (after || []).map(normalizeLinkEntry).filter((l) => l.shareLink);
  const picked =
    updated.find((l) => l.primary && l.internal === false) ||
    updated.find((l) => l.internal === false) ||
    updated[0] ||
    null;
  return picked || null;
}

export async function setFileExternalLink(fileId, auth = "", { access = "ReadWrite" } = {}) {
  const fid = String(fileId || "").trim();
  if (!fid) throw new Error("fileId is required");

  const body = { access, internal: false, primary: true };

  try {
    const response = await apiRequest(`/api/2.0/files/file/${encodeURIComponent(fid)}/links`, {
      method: "PUT",
      auth,
      body
    });
    const sharedLinkObj = response?.sharedLink || response?.sharedTo || null;
    const shared = sharedLinkObj?.shareLink || response?.shareLink || null;
    const requestToken = sharedLinkObj?.requestToken || response?.requestToken || null;
    return { shareLink: shared ? String(shared) : null, requestToken: requestToken ? String(requestToken) : null };
  } catch (error) {
    if (auth && error?.status === 403) {
      const response = await apiRequest(`/api/2.0/files/file/${encodeURIComponent(fid)}/links`, {
        method: "PUT",
        body
      });
      const sharedLinkObj = response?.sharedLink || response?.sharedTo || null;
      const shared = sharedLinkObj?.shareLink || response?.shareLink || null;
      const requestToken = sharedLinkObj?.requestToken || response?.requestToken || null;
      return { shareLink: shared ? String(shared) : null, requestToken: requestToken ? String(requestToken) : null };
    }
    throw error;
  }
}

export async function createFolder({ parentFolderId, title }, auth) {
  const pid = String(parentFolderId || "").trim();
  const folderTitle = String(title || "").trim();
  if (!pid) throw new Error("parentFolderId is required");
  if (!folderTitle) throw new Error("title is required");
  return apiRequest(`/api/2.0/files/folder/${encodeURIComponent(pid)}`, {
    method: "POST",
    auth,
    body: { title: folderTitle }
  });
}

export async function ensureFolderByTitleWithin(parentFolderId, title, auth) {
  const existing = await getFolderByTitleWithin(parentFolderId, title, auth).catch(() => null);
  if (existing?.id) return existing;
  const created = await createFolder({ parentFolderId, title }, auth).catch(() => null);
  if (created?.id) return created;
  const after = await getFolderByTitleWithin(parentFolderId, title, auth).catch(() => null);
  return after || null;
}

export async function ensureFormsRoomFolders(roomId, auth) {
  const rid = String(roomId || "").trim();
  if (!rid) throw new Error("roomId is required");

  // For FillingFormsRoom, DocSpace creates system folders automatically.
  // If they're missing, the selected room is likely not a form-filling room (or names are localized).
  return getFormsRoomFolders(rid, auth);
}

export async function getMyDocuments(auth) {
  if (!auth) throw new Error("User token is required");
  const content = await apiRequest("/api/2.0/files/@my", { auth });
  return normalizeFolderContent(content, "@my");
}

export async function createFileInMyDocuments({ title } = {}, auth) {
  if (!auth) throw new Error("User token is required");
  const name = String(title || "").trim();
  if (!name) throw new Error("title is required");
  return apiRequest("/api/2.0/files/@my/file", {
    method: "POST",
    auth,
    body: { title: name }
  });
}

export async function createFileInFolder({ folderId, title, type = "text" } = {}, auth) {
  const fid = String(folderId || "").trim();
  const name = String(title || "").trim();
  const t = String(type || "").trim() || "text";
  if (!fid) throw new Error("folderId is required");
  if (!name) throw new Error("title is required");
  return apiRequest(`/api/2.0/files/${encodeURIComponent(fid)}/file`, {
    method: "POST",
    auth,
    body: { title: name, type: t }
  });
}

export async function copyFilesToFolder({ fileIds, destFolderId, deleteAfter = false, content = true, toFillOut = false } = {}, auth) {
  if (!auth) throw new Error("User token is required");
  const ids = Array.isArray(fileIds) ? fileIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const dest = String(destFolderId || "").trim();
  if (!ids.length) throw new Error("fileIds is required");
  if (!dest) throw new Error("destFolderId is required");
  const op = await apiRequest("/api/2.0/files/fileops/copy", {
    method: "PUT",
    auth,
    body: {
      fileIds: ids,
      destFolderId: dest,
      deleteAfter: Boolean(deleteAfter),
      content: Boolean(content),
      toFillOut: Boolean(toFillOut)
    }
  });

  const opId = normalizeFileOpId(op?.id ?? op?.operationId);
  const finished = op?.finished === undefined ? null : Boolean(op.finished);
  if (opId && finished === false) {
    const waited = await waitFileOp(opId, auth, { timeoutMs: 20000, intervalMs: 750 });
    return { operationId: waited.operationId || opId, pending: Boolean(waited.pending) };
  }

  return { operationId: opId || null, pending: false };
}

export async function copyFilesToFolderAsAdmin(
  { fileIds, destFolderId, deleteAfter = false, content = true, toFillOut = false } = {}
) {
  const ids = Array.isArray(fileIds) ? fileIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const dest = String(destFolderId || "").trim();
  if (!ids.length) throw new Error("fileIds is required");
  if (!dest) throw new Error("destFolderId is required");
  const op = await apiRequest("/api/2.0/files/fileops/copy", {
    method: "PUT",
    body: {
      fileIds: ids,
      destFolderId: dest,
      deleteAfter: Boolean(deleteAfter),
      content: Boolean(content),
      toFillOut: Boolean(toFillOut)
    }
  });

  const opId = normalizeFileOpId(op?.id ?? op?.operationId);
  const finished = op?.finished === undefined ? null : Boolean(op.finished);
  if (opId && finished === false) {
    const waited = await waitFileOp(opId, "", { timeoutMs: 20000, intervalMs: 750 });
    return { operationId: waited.operationId || opId, pending: Boolean(waited.pending) };
  }

  return { operationId: opId || null, pending: false };
}

async function updateFileTitle({ fileId, title }, auth) {
  const fid = String(fileId || "").trim();
  const fileTitle = String(title || "").trim();
  if (!fid) throw new Error("fileId is required");
  if (!fileTitle) throw new Error("title is required");
  return apiRequest(`/api/2.0/files/file/${encodeURIComponent(fid)}`, {
    method: "PUT",
    auth,
    body: { title: fileTitle }
  });
}

export async function terminateUsers(userIds, auth) {
  const ids = Array.isArray(userIds) ? userIds.map((v) => String(v || "").trim()).filter(Boolean) : [];
  if (!ids.length) throw new Error("userIds are required");
  return apiRequest("/api/2.0/people/status/Terminated", {
    method: "PUT",
    auth,
    body: { userIds: ids }
  });
}

export async function deleteRoom(roomId, auth) {
  const rid = String(roomId || "").trim();
  if (!rid) throw new Error("roomId is required");
  // Some DocSpace setups require the room to be archived before permanent deletion.
  await archiveRoom(rid, auth).catch(() => null);

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await apiRequest(`/api/2.0/files/rooms/${encodeURIComponent(rid)}`, {
        method: "DELETE",
        body: {},
        auth
      });
    } catch (error) {
      if (error?.status === 404) {
        return { ok: true, deleted: false, reason: "not_found" };
      }
      lastError = error;
      if (error?.status === 400 && attempt < 2) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("Failed to delete room");
}

// Alias that accepts { fullName, email, password } like the medical portal pattern.
export async function createDocSpaceUser({ fullName, email, password } = {}) {
  const name = String(fullName || "").trim();
  const parts = name.split(" ").filter(Boolean);
  const firstName = parts[0] || "Demo";
  const lastName = parts.slice(1).join(" ") || "User";
  return createUser({ firstName, lastName, email, password });
}

export async function copyFileToFolder({ fileId, destFolderId, toFillOut = false }, auth) {
  const fid = String(fileId || "").trim();
  const did = String(destFolderId || "").trim();
  if (!fid || !did) throw new Error("fileId and destFolderId are required");
  const op = await apiRequest("/api/2.0/files/fileops/copy", {
    method: "PUT",
    auth,
    body: {
      fileIds: [fid],
      destFolderId: did,
      deleteAfter: false,
      content: true,
      toFillOut: Boolean(toFillOut)
    }
  });

  const opId = normalizeFileOpId(op?.id ?? op?.operationId);
  const finished = op?.finished === undefined ? null : Boolean(op.finished);
  if (opId && finished === false) {
    const waited = await waitFileOp(opId, auth, { timeoutMs: 20000, intervalMs: 750 });
    return { operationId: waited.operationId || opId, pending: Boolean(waited.pending) };
  }

  return { operationId: opId || null, pending: false };
}

export async function startFilling(fileId, auth) {
  const fid = String(fileId || "").trim();
  if (!fid) throw new Error("fileId is required");
  return apiRequest(`/api/2.0/files/file/${encodeURIComponent(fid)}/startfilling`, {
    method: "PUT",
    auth
  });
}

export async function createFileFromTemplateToFolder({ templateFileId, destFolderId, title }, auth) {
  const fid = String(templateFileId || "").trim();
  const did = String(destFolderId || "").trim();
  if (!fid) throw new Error("templateFileId is required");
  if (!did) throw new Error("destFolderId is required");

  const before = await getFolderContents(did, auth).catch(() => null);
  const beforeIds = new Set((before?.items || []).map((i) => String(i.id)));

  await copyFileToFolder({ fileId: fid, destFolderId: did }, auth);

  const after = await getFolderContents(did, auth).catch(() => null);
  const afterFiles = (after?.items || []).filter((item) => item.type === "file");
  const created = afterFiles.find((item) => !beforeIds.has(String(item.id))) || afterFiles[0] || null;
  const createdId = created?.id ? String(created.id) : null;
  if (!createdId) {
    throw new Error("Unable to determine created file after template copy");
  }

  if (title) {
    await updateFileTitle({ fileId: createdId, title: String(title) }).catch(() => null);
  }

  const info = await getFileInfo(createdId, auth).catch(() => null);
  return {
    id: createdId,
    title: info?.title || created?.title || null
  };
}
