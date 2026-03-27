function truncate(value, limit = 240) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/g)[0] || "";
}

function sanitizeDetails(details) {
  if (!details) return "";

  if (typeof details === "string") {
    const raw = details.trim();
    if (!raw) return "";

    const short = firstLine(raw);
    const mayBeJson = (short.startsWith("{") && short.endsWith("}")) || (short.startsWith("[") && short.endsWith("]"));
    if (mayBeJson) {
      try {
        const parsed = JSON.parse(short);
        return sanitizeDetails(parsed);
      } catch {
        // ignore
      }
    }

    return truncate(short);
  }

  if (typeof details === "object") {
    const hint = typeof details?.hint === "string" ? details.hint : "";
    const message = typeof details?.message === "string" ? details.message : "";
    const nestedMessage = typeof details?.error?.message === "string" ? details.error.message : "";
    const nestedHint = typeof details?.error?.hint === "string" ? details.error.hint : "";
    const best = hint || message || nestedMessage || nestedHint;
    if (best) return truncate(firstLine(best));

    try {
      const json = JSON.parse(
        JSON.stringify(details, (key, value) => {
          if (key === "stack" || key === "trace" || key === "innerStack" || key === "exception") return undefined;
          return value;
        })
      );
      return truncate(firstLine(JSON.stringify(json)));
    } catch {
      return "";
    }
  }

  return "";
}

function toErrorMessage(data, fallback) {
  const message = typeof data?.error === "string" ? data.error : String(fallback || "Request failed");
  const details = sanitizeDetails(data?.details);
  return details ? `${message}: ${details}` : message;
}

export async function login({ email, password }) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, "Login failed"));
  }
  return {
    token: data?.token || null,
    user: data?.user || null,
    formsRoom: data?.formsRoom || null
  };
}

export async function register({ firstName, lastName, email, password }) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName, lastName, email, password })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, "Registration failed"));
  }
  return {
    token: data?.token || null,
    user: data?.user || null
  };
}

export async function listTemplates({ token }) {
  const response = await fetch("/api/templates", {
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Forms load failed (${response.status})`));
  }
  return data;
}

export async function listProjectTemplates({ token, projectId }) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("projectId is required");
  const response = await fetch(`/api/templates/project/${encodeURIComponent(pid)}`, {
    headers: { Authorization: t }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Templates load failed (${response.status})`));
  }
  return data;
}

export async function listDrafts({ token }) {
  const response = await fetch("/api/drafts", {
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Drafts load failed (${response.status})`));
  }
  return data;
}

export async function createDraft({ token, title }) {
  const response = await fetch("/api/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ title })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Draft create failed (${response.status})`));
  }
  return data;
}

export async function publishDraft({ token, fileId, projectId, destination = "project", activate = true }) {
  const response = await fetch("/api/drafts/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ fileId, projectId, destination, activate })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Publish failed (${response.status})`));
  }
  if (data?.ok && data?.createdFile === null) {
    data.warning =
      data.warning ||
      "Copy finished, but the created file was not detected. Check the project room Templates (and In Process) folders.";
  }
  return data;
}

export async function getProjectTemplatesRoom({ token }) {
  const response = await fetch("/api/drafts/templates-room", {
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Templates room check failed (${response.status})`));
  }
  return data;
}

export async function listSharedTemplates({ token }) {
  const response = await fetch("/api/drafts/templates-room/templates", {
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Shared templates load failed (${response.status})`));
  }
  return data;
}

export async function deleteSharedTemplate({ token, fileId }) {
  const fid = String(fileId || "").trim();
  if (!fid) throw new Error("fileId is required");
  const response = await fetch(`/api/drafts/templates-room/templates/${encodeURIComponent(fid)}`, {
    method: "DELETE",
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Delete failed (${response.status})`));
  }
  return data;
}

export async function deleteDraftTemplate({ token, fileId } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const fid = String(fileId || "").trim();
  if (!fid) throw new Error("fileId is required");
  const response = await fetch(`/api/drafts/${encodeURIComponent(fid)}`, {
    method: "DELETE",
    headers: { Authorization: t }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Delete failed (${response.status})`));
  }
  return data;
}

export async function deleteProjectTemplate({ token, fileId } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const fid = String(fileId || "").trim();
  if (!fid) throw new Error("fileId is required");
  const response = await fetch(`/api/templates/${encodeURIComponent(fid)}`, {
    method: "DELETE",
    headers: { Authorization: t }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Remove failed (${response.status})`));
  }
  return data;
}

export async function deleteProjectTemplateFromProject({ token, projectId, fileId } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("projectId is required");
  const fid = String(fileId || "").trim();
  if (!fid) throw new Error("fileId is required");
  const response = await fetch(`/api/templates/project/${encodeURIComponent(pid)}/${encodeURIComponent(fid)}`, {
    method: "DELETE",
    headers: { Authorization: t }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Remove failed (${response.status})`));
  }
  return data;
}

export async function listFlows({ token, includeArchived = false, archivedOnly = false, includeTrashed = false, trashedOnly = false } = {}) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const params = new URLSearchParams();
  if (includeArchived) params.set("includeArchived", "1");
  if (archivedOnly) params.set("archivedOnly", "1");
  if (includeTrashed) params.set("includeTrashed", "1");
  if (trashedOnly) params.set("trashedOnly", "1");
  const query = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`/api/flows${query}`, { headers: { Authorization: token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Flows load failed (${response.status})`));
  }
  return data;
}

export async function listProjectFlows({ token, projectId, includeArchived = false, archivedOnly = false, includeTrashed = false, trashedOnly = false } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("projectId is required");
  const params = new URLSearchParams();
  if (includeArchived) params.set("includeArchived", "1");
  if (archivedOnly) params.set("archivedOnly", "1");
  if (includeTrashed) params.set("includeTrashed", "1");
  if (trashedOnly) params.set("trashedOnly", "1");
  const query = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`/api/flows/project/${encodeURIComponent(pid)}${query}`, { headers: { Authorization: t } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Project flows load failed (${response.status})`));
  }
  return data;
}

export async function trashFlow({ token, flowId }) {
  const id = String(flowId || "").trim();
  if (!id) throw new Error("flowId is required");
  const response = await fetch(`/api/flows/${encodeURIComponent(id)}/trash`, {
    method: "POST",
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Trash failed (${response.status})`));
  return data;
}

export async function untrashFlow({ token, flowId }) {
  const id = String(flowId || "").trim();
  if (!id) throw new Error("flowId is required");
  const response = await fetch(`/api/flows/${encodeURIComponent(id)}/untrash`, {
    method: "POST",
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Restore failed (${response.status})`));
  return data;
}

export async function deleteFlowPermanently({ token, flowId }) {
  const id = String(flowId || "").trim();
  if (!id) throw new Error("flowId is required");
  const response = await fetch(`/api/flows/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Delete failed (${response.status})`));
  return data;
}

export async function listDirectoryGroups({ token } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const response = await fetch("/api/directory/groups", { headers: { Authorization: t } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Groups load failed (${response.status})`));
  return data;
}

export async function getDirectoryGroup({ token, groupId } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const id = String(groupId || "").trim();
  if (!id) throw new Error("groupId is required");
  const response = await fetch(`/api/directory/groups/${encodeURIComponent(id)}`, { headers: { Authorization: t } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Group load failed (${response.status})`));
  return data;
}

export async function createDirectoryGroup({ token, groupName, managerEmail, memberEmails, memberIds } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const response = await fetch("/api/directory/groups", {
    method: "POST",
    headers: { Authorization: t, "Content-Type": "application/json" },
    body: JSON.stringify({ groupName, managerEmail, memberEmails, memberIds, members: memberIds })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Create group failed (${response.status})`));
  return data;
}

export async function updateDirectoryGroup({ token, groupId, groupName, managerEmail, addEmails, addIds } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const id = String(groupId || "").trim();
  if (!id) throw new Error("groupId is required");
  const response = await fetch(`/api/directory/groups/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { Authorization: t, "Content-Type": "application/json" },
    body: JSON.stringify({ groupName, managerEmail, addEmails, addIds, membersToAdd: addIds })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Update group failed (${response.status})`));
  return data;
}

export async function deleteDirectoryGroup({ token, groupId } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const id = String(groupId || "").trim();
  if (!id) throw new Error("groupId is required");
  const response = await fetch(`/api/directory/groups/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: t } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Delete group failed (${response.status})`));
  return data;
}

export async function removeDirectoryGroupMembers({ token, groupId, members } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const id = String(groupId || "").trim();
  if (!id) throw new Error("groupId is required");
  const response = await fetch(`/api/directory/groups/${encodeURIComponent(id)}/members`, {
    method: "DELETE",
    headers: { Authorization: t, "Content-Type": "application/json" },
    body: JSON.stringify({ members })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Remove members failed (${response.status})`));
  return data;
}

export async function searchDirectoryPeople({ token, query } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const q = String(query || "").trim();
  if (!q) return { people: [] };
  const response = await fetch(`/api/directory/people/search?query=${encodeURIComponent(q)}`, { headers: { Authorization: t } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `People load failed (${response.status})`));
  return data;
}

export async function listDirectoryPeople({ token, limit = 25, offset = 0 } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const l = Number.isFinite(Number(limit)) ? Number(limit) : 25;
  const o = Number.isFinite(Number(offset)) ? Number(offset) : 0;
  const response = await fetch(`/api/directory/people?limit=${encodeURIComponent(l)}&offset=${encodeURIComponent(o)}`, {
    headers: { Authorization: t }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `People load failed (${response.status})`));
  return data;
}

export async function createDirectoryPerson({ token, firstName, lastName, email } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const response = await fetch("/api/directory/people", {
    method: "POST",
    headers: { Authorization: t, "Content-Type": "application/json" },
    body: JSON.stringify({ firstName, lastName, email })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Create user failed (${response.status})`));
  return data;
}

export async function inviteDirectoryPeople({ token, emails, message, subject } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const response = await fetch("/api/directory/people/invite", {
    method: "POST",
    headers: { Authorization: t, "Content-Type": "application/json" },
    body: JSON.stringify({ emails, message, subject })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Invite failed (${response.status})`));
  return data;
}

export async function deleteDirectoryPerson({ token, userId } = {}) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const id = String(userId || "").trim();
  if (!id) throw new Error("userId is required");
  const response = await fetch(`/api/directory/people/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: t } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Delete failed (${response.status})`));
  return data;
}

export async function cancelFlow({ token, flowId }) {
  const id = String(flowId || "").trim();
  if (!id) throw new Error("flowId is required");
  const response = await fetch(`/api/flows/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Cancel failed (${response.status})`));
  }
  return data;
}

export async function reopenFlow({ token, flowId }) {
  const id = String(flowId || "").trim();
  if (!id) throw new Error("flowId is required");
  const response = await fetch(`/api/flows/${encodeURIComponent(id)}/reopen`, {
    method: "POST",
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Reopen failed (${response.status})`));
  }
  return data;
}

export async function archiveFlow({ token, flowId }) {
  const id = String(flowId || "").trim();
  if (!id) throw new Error("flowId is required");
  const response = await fetch(`/api/flows/${encodeURIComponent(id)}/archive`, {
    method: "POST",
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Archive failed (${response.status})`));
  }
  return data;
}

export async function unarchiveFlow({ token, flowId }) {
  const id = String(flowId || "").trim();
  if (!id) throw new Error("flowId is required");
  const response = await fetch(`/api/flows/${encodeURIComponent(id)}/unarchive`, {
    method: "POST",
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Restore failed (${response.status})`));
  }
  return data;
}

export async function completeFlow({ token, flowId }) {
  const id = String(flowId || "").trim();
  if (!id) throw new Error("flowId is required");
  const response = await fetch(`/api/flows/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Complete failed (${response.status})`));
  }
  return data;
}

export async function getFlowAudit({ token, flowId }) {
  const id = String(flowId || "").trim();
  if (!id) throw new Error("flowId is required");
  const response = await fetch(`/api/flows/${encodeURIComponent(id)}/audit`, { headers: { Authorization: token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Audit load failed (${response.status})`));
  }
  return data;
}

export async function createFlowFromTemplate({ token, templateFileId, projectId, recipientEmails, recipientLevels, dueDate, kind } = {}) {
  const response = await fetch("/api/flows/from-template", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ templateFileId, projectId, recipientEmails, recipientLevels, dueDate, kind })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Flow creation failed (${response.status})`));
  }
  return data;
}

export async function settingsStatus({ roomTitle, roomId } = {}) {
  const params = new URLSearchParams();
  if (roomId) params.set("roomId", String(roomId));
  if (roomTitle) params.set("roomTitle", String(roomTitle));
  const qs = params.toString();
  const response = await fetch(`/api/settings/status${qs ? `?${qs}` : ""}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Settings status failed (${response.status})`));
  }
  return data;
}

export async function settingsBootstrap(payload) {
  const response = await fetch("/api/settings/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Settings bootstrap failed (${response.status})`));
  }
  return data;
}

export async function getSettingsConfig() {
  const response = await fetch("/api/settings/config");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Config load failed (${response.status})`));
  }
  return data;
}

export async function updateSettingsConfig(patch) {
  const response = await fetch("/api/settings/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Config save failed (${response.status})`));
  }
  return data;
}

export async function testSettingsConfig() {
  const response = await fetch("/api/settings/config/test", { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Config test failed (${response.status})`));
  }
  return data;
}

export async function listSettingsRooms({ roomType = 1 } = {}) {
  const query = roomType !== undefined && roomType !== null ? `?roomType=${encodeURIComponent(String(roomType))}` : "";
  const response = await fetch(`/api/settings/rooms${query}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Rooms load failed (${response.status})`));
  }
  return data;
}

export async function createSettingsRoom({ title, roomType = 1, select = true } = {}) {
  const response = await fetch("/api/settings/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, roomType, select })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Room creation failed (${response.status})`));
  }
  return data;
}

export async function listRequiredRooms() {
  const response = await fetch("/api/settings/required-rooms");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Required rooms load failed (${response.status})`));
  }
  return data;
}

export async function createRequiredRoom(key) {
  const k = String(key || "").trim();
  if (!k) throw new Error("key is required");
  const response = await fetch(`/api/settings/required-rooms/${encodeURIComponent(k)}/create`, { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Create room failed (${response.status})`));
  }
  return data;
}

export async function listProjects() {
  throw new Error("Use getProjectsSidebar({ token })");
}

export async function getProjectsSidebar({ token }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const response = await fetch("/api/projects/sidebar", { headers: { Authorization: token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Projects load failed (${response.status})`));
  return data;
}

export async function getProjectsList({ token }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const response = await fetch("/api/projects/list", { headers: { Authorization: token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Projects load failed (${response.status})`));
  return data;
}

export async function archiveProject({ token, projectId, cancelOpenRequests = false }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("projectId is required");
  const response = await fetch(`/api/projects/${encodeURIComponent(pid)}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ cancelOpenRequests: Boolean(cancelOpenRequests) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(toErrorMessage(data, `Archive failed (${response.status})`));
    err.status = response.status;
    err.details = data;
    throw err;
  }
  return data;
}

export async function unarchiveProject({ token, projectId }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("projectId is required");
  const response = await fetch(`/api/projects/${encodeURIComponent(pid)}/unarchive`, {
    method: "POST",
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toErrorMessage(data, `Restore failed (${response.status})`));
  }
  return data;
}

export async function createProject({ token, title }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ title })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Project creation failed (${response.status})`));
  return data;
}

export async function listContacts({ token }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const response = await fetch("/api/contacts", { headers: { Authorization: token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Contacts load failed (${response.status})`));
  return data;
}

export async function createContact({ token, name, email, tags }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const response = await fetch("/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ name, email, tags })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Contact create failed (${response.status})`));
  return data;
}

export async function updateContact({ token, contactId, name, email, tags }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const response = await fetch(`/api/contacts/${encodeURIComponent(String(contactId || ""))}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ name, email, tags })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Contact update failed (${response.status})`));
  return data;
}

export async function deleteContact({ token, contactId }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const response = await fetch(`/api/contacts/${encodeURIComponent(String(contactId || ""))}`, {
    method: "DELETE",
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Contact delete failed (${response.status})`));
  return data;
}

export async function createBulkLinks({ token, templateFileId, projectId, count } = {}) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const response = await fetch("/api/links/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ templateFileId, projectId, count })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Bulk links failed (${response.status})`));
  return data;
}

export async function listProjectContacts({ token, projectId }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("projectId is required");
  const response = await fetch(`/api/projects/${encodeURIComponent(pid)}/contacts`, { headers: { Authorization: token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Contacts load failed (${response.status})`));
  return data;
}

export async function createProjectContact({ token, projectId, name, email, tags }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("projectId is required");
  const response = await fetch(`/api/projects/${encodeURIComponent(pid)}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ name, email, tags })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Contact create failed (${response.status})`));
  return data;
}

export async function updateProjectContact({ token, projectId, contactId, name, email, tags }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const pid = String(projectId || "").trim();
  const cid = String(contactId || "").trim();
  if (!pid) throw new Error("projectId is required");
  if (!cid) throw new Error("contactId is required");
  const response = await fetch(`/api/projects/${encodeURIComponent(pid)}/contacts/${encodeURIComponent(cid)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ name, email, tags })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Contact update failed (${response.status})`));
  return data;
}

export async function deleteProjectContact({ token, projectId, contactId }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const pid = String(projectId || "").trim();
  const cid = String(contactId || "").trim();
  if (!pid) throw new Error("projectId is required");
  if (!cid) throw new Error("contactId is required");
  const response = await fetch(`/api/projects/${encodeURIComponent(pid)}/contacts/${encodeURIComponent(cid)}`, {
    method: "DELETE",
    headers: { Authorization: token }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Contact delete failed (${response.status})`));
  return data;
}

export async function activateProject(projectId) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/activate`, { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Project activate failed (${response.status})`));
  return data;
}

export async function getActiveProject() {
  throw new Error("Use getProjectsSidebar({ token })");
}

export async function inviteProject({ token, projectId, emails, access, notify, message }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ emails, access, notify, message })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Invite failed (${response.status})`));
  return data;
}

export async function deleteProject({ token, projectId }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("projectId is required");
  const response = await fetch(`/api/projects/${encodeURIComponent(pid)}`, { method: "DELETE", headers: { Authorization: token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Delete failed (${response.status})`));
  return data;
}

export async function getProjectsPermissions({ token }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const response = await fetch("/api/projects/permissions", { headers: { Authorization: token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Permissions load failed (${response.status})`));
  return data;
}

export async function getProjectMembers({ token, projectId }) {
  const pid = String(projectId || "").trim();
  if (!pid) throw new Error("projectId is required");
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const response = await fetch(`/api/projects/${encodeURIComponent(pid)}/members`, { headers: { Authorization: token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Members load failed (${response.status})`));
  return data;
}

export async function removeProjectMember({ token, projectId, userId }) {
  const t = String(token || "").trim();
  if (!t) throw new Error("Authorization token is required");
  const pid = String(projectId || "").trim();
  const uid = String(userId || "").trim();
  if (!pid) throw new Error("projectId is required");
  if (!uid) throw new Error("userId is required");
  const response = await fetch(`/api/projects/${encodeURIComponent(pid)}/members/${encodeURIComponent(uid)}`, {
    method: "DELETE",
    headers: { Authorization: t }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Remove member failed (${response.status})`));
  return data;
}

export async function getLibraryStatus() {
  const response = await fetch("/api/library/status");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Library status failed (${response.status})`));
  return data;
}

export async function createLibraryRoom({ title }) {
  const response = await fetch("/api/library/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Library room create failed (${response.status})`));
  return data;
}

export async function listLibraryFiles() {
  const response = await fetch("/api/library/files");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Library files load failed (${response.status})`));
  return data;
}

export async function createLibraryFile({ title, type = "text" } = {}) {
  const response = await fetch("/api/library/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, type })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Library file create failed (${response.status})`));
  return data;
}

export async function publishLibraryFile({ token, fileId, targetRoomId }) {
  if (!String(token || "").trim()) throw new Error("Authorization token is required");
  const response = await fetch("/api/library/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ fileId, targetRoomId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(toErrorMessage(data, `Publish failed (${response.status})`));
  return data;
}

