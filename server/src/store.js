import { getStorePath, loadStoreSnapshot, saveStoreSnapshot } from "./storePersistence.js";

const flows = [];
const projects = [];
const contacts = [];
const projectContacts = [];

const storePath = getStorePath();
let saveTimer = null;

function snapshotStore() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    flows,
    projects,
    contacts,
    projectContacts
  };
}

async function hydrateStore() {
  if (!storePath) return;
  const snapshot = await loadStoreSnapshot(storePath).catch(() => null);
  if (!snapshot) return;
  if (Array.isArray(snapshot.flows)) {
    flows.splice(0, flows.length, ...snapshot.flows);
  }
  if (Array.isArray(snapshot.projects)) {
    projects.splice(0, projects.length, ...snapshot.projects);
  }
  if (Array.isArray(snapshot.contacts)) {
    contacts.splice(0, contacts.length, ...snapshot.contacts);
  }
  if (Array.isArray(snapshot.projectContacts)) {
    projectContacts.splice(0, projectContacts.length, ...snapshot.projectContacts);
  }

  for (const flow of flows) {
    if (!flow || typeof flow !== "object") continue;
    if (!flow.groupId && flow.id) flow.groupId = flow.id;
    if (flow.source === undefined) flow.source = null;
    if (flow.resultFileId === undefined) flow.resultFileId = null;
    if (flow.resultFileTitle === undefined) flow.resultFileTitle = null;
    if (flow.resultFileUrl === undefined) flow.resultFileUrl = null;
    if (flow.stageIndex === undefined) flow.stageIndex = null;
    if (flow.dueDate === undefined) flow.dueDate = null;
    if (flow.archivedAt === undefined) flow.archivedAt = null;
    if (flow.archivedByUserId === undefined) flow.archivedByUserId = null;
    if (flow.archivedByName === undefined) flow.archivedByName = null;
    if (flow.trashedAt === undefined) flow.trashedAt = null;
    if (flow.trashedByUserId === undefined) flow.trashedByUserId = null;
    if (flow.trashedByName === undefined) flow.trashedByName = null;
    if (!Array.isArray(flow.events)) flow.events = [];
  }

  for (const project of projects) {
    if (!project || typeof project !== "object") continue;
    if (!project.signingRoomId) project.signingRoomId = null;
    if (project.archivedAt === undefined) project.archivedAt = null;
    if (project.archivedByUserId === undefined) project.archivedByUserId = null;
    if (project.archivedByName === undefined) project.archivedByName = null;
  }

  for (const contact of contacts) {
    if (!contact || typeof contact !== "object") continue;
    if (contact.ownerUserId === undefined) contact.ownerUserId = null;
    if (contact.name === undefined) contact.name = null;
    if (contact.email === undefined) contact.email = null;
    if (!Array.isArray(contact.tags)) contact.tags = [];
  }

  for (const contact of projectContacts) {
    if (!contact || typeof contact !== "object") continue;
    if (contact.projectId === undefined) contact.projectId = null;
    if (contact.name === undefined) contact.name = null;
    if (contact.email === undefined) contact.email = null;
    if (!Array.isArray(contact.tags)) contact.tags = [];
    if (contact.createdByUserId === undefined) contact.createdByUserId = null;
    if (contact.createdByName === undefined) contact.createdByName = null;
  }
}

function scheduleSave() {
  if (!storePath) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveStoreSnapshot(storePath, snapshotStore()).catch(() => null);
  }, 200);
}

await hydrateStore();

function normalize(value) {
  return String(value || "").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function withEvent(flow, event) {
  const current = flow && typeof flow === "object" ? flow : {};
  const ts = normalize(event?.ts) || new Date().toISOString();
  const entry = { ts, ...(event && typeof event === "object" ? event : {}) };
  const next = [...safeArray(current.events), entry].slice(-200);
  return next;
}

export function createFlow({
  id,
  groupId,
  kind = "approval",
  source = null,
  templateFileId,
  templateTitle,
  fileId,
  fileTitle,
  resultFileId,
  resultFileTitle,
  resultFileUrl,
  stageIndex,
  dueDate,
  projectRoomId,
  documentRoomId,
  documentRoomTitle,
  documentRoomUrl,
  createdByUserId,
  recipientEmails,
  recipientUserId,
  recipientName,
  createdByName,
  openUrl,
  linkRequestToken,
  status = "InProgress"
} = {}) {
  const flowId = String(id || "").trim();
  const fid = String(templateFileId || "").trim();
  const uid = String(createdByUserId || "").trim();
  if (!flowId || !fid || !uid) return null;

  const now = new Date().toISOString();

  const entry = {
    id: flowId,
    groupId: String(groupId || flowId).trim() || flowId,
    kind: String(kind || "approval").trim() || "approval",
    source: source ? String(source) : null,
    templateFileId: fid,
    templateTitle: templateTitle ? String(templateTitle) : null,
    fileId: fileId ? String(fileId) : null,
    fileTitle: fileTitle ? String(fileTitle) : null,
    resultFileId: resultFileId ? String(resultFileId) : null,
    resultFileTitle: resultFileTitle ? String(resultFileTitle) : null,
    resultFileUrl: resultFileUrl ? String(resultFileUrl) : null,
    stageIndex: Number.isFinite(Number(stageIndex)) ? Number(stageIndex) : null,
    dueDate: dueDate ? String(dueDate) : null,
    projectRoomId: projectRoomId ? String(projectRoomId) : null,
    documentRoomId: documentRoomId ? String(documentRoomId) : null,
    documentRoomTitle: documentRoomTitle ? String(documentRoomTitle) : null,
    documentRoomUrl: documentRoomUrl ? String(documentRoomUrl) : null,
    createdByUserId: uid,
    recipientEmails: Array.isArray(recipientEmails)
      ? Array.from(
          new Set(
            recipientEmails
              .map((e) => String(e || "").trim().toLowerCase())
              .filter(Boolean)
          )
        )
      : [],
    recipientUserId: recipientUserId ? String(recipientUserId) : null,
    recipientName: recipientName ? String(recipientName) : null,
    createdByName: createdByName ? String(createdByName) : null,
    openUrl: openUrl ? String(openUrl) : null,
    linkRequestToken: linkRequestToken ? String(linkRequestToken) : null,
    status,
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    trashedByUserId: null,
    trashedByName: null,
    events: [
      {
        ts: now,
        type: "created",
        actorUserId: uid,
        actorName: createdByName ? String(createdByName) : null,
        kind: String(kind || "approval").trim() || "approval",
        templateFileId: fid,
        projectRoomId: projectRoomId ? String(projectRoomId) : null,
        recipientEmails: Array.isArray(recipientEmails) ? recipientEmails : []
      }
    ]
  };

  flows.unshift(entry);
  scheduleSave();
  return entry;
}

export function getFlow(flowId) {
  const id = String(flowId || "").trim();
  if (!id) return null;
  return flows.find((f) => String(f?.id || "") === id) || null;
}

export function updateFlow(flowId, patch = {}) {
  const id = String(flowId || "").trim();
  if (!id) return null;
  const index = flows.findIndex((f) => String(f?.id || "") === id);
  if (index < 0) return null;

  const current = flows[index] || {};
  const next = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    events: safeArray(patch?.events).length ? safeArray(patch.events) : safeArray(current.events),
    updatedAt: new Date().toISOString()
  };
  flows[index] = next;
  scheduleSave();
  return next;
}

export function cancelFlow(flowId, { canceledByUserId, canceledByName } = {}) {
  const id = String(flowId || "").trim();
  if (!id) return null;
  const current = getFlow(id);
  if (!current) return null;
  if (String(current.status || "") === "Completed") return current;
  if (String(current.status || "") === "Canceled") return current;

  const now = new Date().toISOString();
  return updateFlow(id, {
    status: "Canceled",
    canceledAt: now,
    canceledByUserId: canceledByUserId ? String(canceledByUserId) : null,
    canceledByName: canceledByName ? String(canceledByName) : null,
    events: withEvent(current, {
      ts: now,
      type: "canceled",
      actorUserId: canceledByUserId ? String(canceledByUserId) : null,
      actorName: canceledByName ? String(canceledByName) : null
    })
  });
}

export function reopenFlow(flowId, { reopenedByUserId, reopenedByName } = {}) {
  const id = String(flowId || "").trim();
  if (!id) return null;
  const current = getFlow(id);
  if (!current) return null;

  const status = String(current.status || "");
  if (status === "Completed") return current;
  if (status === "InProgress") return current;
  if (status !== "Canceled") return current;

  const now = new Date().toISOString();
  return updateFlow(id, {
    status: "InProgress",
    canceledAt: null,
    canceledByUserId: null,
    canceledByName: null,
    reopenedAt: now,
    reopenedByUserId: reopenedByUserId ? String(reopenedByUserId) : null,
    reopenedByName: reopenedByName ? String(reopenedByName) : null,
    events: withEvent(current, {
      ts: now,
      type: "reopened",
      actorUserId: reopenedByUserId ? String(reopenedByUserId) : null,
      actorName: reopenedByName ? String(reopenedByName) : null
    })
  });
}

export function archiveFlow(flowId, { archivedByUserId, archivedByName } = {}) {
  const id = String(flowId || "").trim();
  if (!id) return null;
  const current = getFlow(id);
  if (!current) return null;

  const status = String(current.status || "");
  if (status !== "Completed" && status !== "Canceled") return current;
  if (current.archivedAt) return current;

  const now = new Date().toISOString();
  return updateFlow(id, {
    archivedAt: now,
    archivedByUserId: archivedByUserId ? String(archivedByUserId) : null,
    archivedByName: archivedByName ? String(archivedByName) : null,
    events: withEvent(current, {
      ts: now,
      type: "archived",
      actorUserId: archivedByUserId ? String(archivedByUserId) : null,
      actorName: archivedByName ? String(archivedByName) : null
    })
  });
}

export function unarchiveFlow(flowId, { unarchivedByUserId, unarchivedByName } = {}) {
  const id = String(flowId || "").trim();
  if (!id) return null;
  const current = getFlow(id);
  if (!current) return null;
  if (!current.archivedAt) return current;

  const now = new Date().toISOString();
  return updateFlow(id, {
    archivedAt: null,
    archivedByUserId: null,
    archivedByName: null,
    unarchivedAt: now,
    unarchivedByUserId: unarchivedByUserId ? String(unarchivedByUserId) : null,
    unarchivedByName: unarchivedByName ? String(unarchivedByName) : null,
    events: withEvent(current, {
      ts: now,
      type: "unarchived",
      actorUserId: unarchivedByUserId ? String(unarchivedByUserId) : null,
      actorName: unarchivedByName ? String(unarchivedByName) : null
    })
  });
}

export function trashFlow(flowId, { trashedByUserId, trashedByName } = {}) {
  const id = normalize(flowId);
  if (!id) return null;
  const current = getFlow(id);
  if (!current) return null;
  if (current.trashedAt) return current;

  const now = new Date().toISOString();
  return updateFlow(id, {
    trashedAt: now,
    trashedByUserId: trashedByUserId ? String(trashedByUserId) : null,
    trashedByName: trashedByName ? String(trashedByName) : null,
    events: withEvent(current, {
      ts: now,
      type: "trashed",
      actorUserId: trashedByUserId ? String(trashedByUserId) : null,
      actorName: trashedByName ? String(trashedByName) : null
    })
  });
}

export function untrashFlow(flowId, { untrashedByUserId, untrashedByName } = {}) {
  const id = normalize(flowId);
  if (!id) return null;
  const current = getFlow(id);
  if (!current) return null;
  if (!current.trashedAt) return current;

  const now = new Date().toISOString();
  return updateFlow(id, {
    trashedAt: null,
    trashedByUserId: null,
    trashedByName: null,
    untrashedAt: now,
    untrashedByUserId: untrashedByUserId ? String(untrashedByUserId) : null,
    untrashedByName: untrashedByName ? String(untrashedByName) : null,
    events: withEvent(current, {
      ts: now,
      type: "untrashed",
      actorUserId: untrashedByUserId ? String(untrashedByUserId) : null,
      actorName: untrashedByName ? String(untrashedByName) : null
    })
  });
}

export function deleteFlow(flowId) {
  const id = normalize(flowId);
  if (!id) return false;
  const idx = flows.findIndex((f) => String(f?.id || "").trim() === id);
  if (idx === -1) return false;
  flows.splice(idx, 1);
  scheduleSave();
  return true;
}

export function completeFlow(
  flowId,
  {
    completedByUserId = null,
    completedByName = null,
    method = "manual",
    resultFileId = null,
    resultFileTitle = null,
    resultFileUrl = null
  } = {}
) {
  const id = normalize(flowId);
  if (!id) return null;
  const current = getFlow(id);
  if (!current) return null;
  if (String(current.status || "") === "Canceled") return current;

  const now = new Date().toISOString();
  return updateFlow(id, {
    status: "Completed",
    completedAt: current.completedAt || now,
    completedByUserId: completedByUserId ? String(completedByUserId) : current.completedByUserId || null,
    completedByName: completedByName ? String(completedByName) : current.completedByName || null,
    resultFileId: resultFileId ? String(resultFileId) : current.resultFileId || null,
    resultFileTitle: resultFileTitle ? String(resultFileTitle) : current.resultFileTitle || null,
    resultFileUrl: resultFileUrl ? String(resultFileUrl) : current.resultFileUrl || null,
    events: withEvent(current, {
      ts: now,
      type: "completed",
      method: String(method || "manual"),
      actorUserId: completedByUserId ? String(completedByUserId) : null,
      actorName: completedByName ? String(completedByName) : null,
      resultFileId: resultFileId ? String(resultFileId) : null,
      resultFileTitle: resultFileTitle ? String(resultFileTitle) : null
    })
  });
}

export function listFlowsForUser(userId) {
  const uid = typeof userId === "object" && userId !== null ? String(userId.userId || "").trim() : String(userId || "").trim();
  const email =
    typeof userId === "object" && userId !== null && userId.userEmail
      ? String(userId.userEmail || "").trim().toLowerCase()
      : "";
  if (!uid) return [];
  return flows
    .filter((flow) => {
      if (String(flow.createdByUserId || "") === uid) return true;
      if (!email) return false;
      const recipients = Array.isArray(flow?.recipientEmails) ? flow.recipientEmails : [];
      return recipients.map((e) => String(e || "").trim().toLowerCase()).includes(email);
    })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export function listFlowsForRoom(roomId) {
  const rid = String(roomId || "").trim();
  if (!rid) return [];
  return flows
    .filter((flow) => String(flow?.projectRoomId || "").trim() === rid)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export function listAllFlows() {
  return flows.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export function listFlowsForGroup(groupId) {
  const gid = String(groupId || "").trim();
  if (!gid) return [];
  return flows
    .filter((flow) => String(flow?.groupId || flow?.id || "").trim() === gid)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

export function createProject({ id, title, roomId, roomUrl } = {}) {
  const pid = String(id || "").trim();
  const name = String(title || "").trim();
  const rid = String(roomId || "").trim();
  if (!pid || !name || !rid) return null;

  const entry = {
    id: pid,
    title: name,
    roomId: rid,
    roomUrl: roomUrl ? String(roomUrl) : null,
    signingRoomId: null,
    archivedAt: null,
    archivedByUserId: null,
    archivedByName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  projects.unshift(entry);
  scheduleSave();
  return entry;
}

export function listProjects() {
  return projects
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export function getProject(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid) return null;
  return projects.find((p) => String(p.id) === pid) || null;
}

export function updateProject(projectId, patch = {}) {
  const pid = String(projectId || "").trim();
  if (!pid) return null;
  const idx = projects.findIndex((p) => String(p?.id || "") === pid);
  if (idx < 0) return null;

  const current = projects[idx] || {};
  const next = {
    ...current,
    ...patch,
    id: current.id,
    roomId: current.roomId,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString()
  };
  projects[idx] = next;
  scheduleSave();
  return next;
}

export function deleteProject(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid) return false;
  const idx = projects.findIndex((p) => String(p.id) === pid);
  if (idx === -1) return false;
  projects.splice(idx, 1);
  scheduleSave();
  return true;
}

function normalizeEmail(value) {
  const v = normalize(value).toLowerCase();
  if (!v) return "";
  return v;
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  const uniq = new Set();
  for (const raw of value) {
    const t = normalize(raw);
    if (!t) continue;
    uniq.add(t.slice(0, 30));
  }
  return Array.from(uniq).slice(0, 12);
}

export function listContactsForUser(userId) {
  const uid = normalize(userId);
  if (!uid) return [];
  return contacts
    .filter((c) => normalize(c?.ownerUserId) === uid)
    .slice()
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
}

export function createContact({ id, ownerUserId, name, email, tags } = {}) {
  const cid = normalize(id);
  const uid = normalize(ownerUserId);
  const mail = normalizeEmail(email);
  if (!cid || !uid || !mail) return null;

  const entry = {
    id: cid,
    ownerUserId: uid,
    name: normalize(name) || mail,
    email: mail,
    tags: normalizeTags(tags),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const existingIdx = contacts.findIndex((c) => normalize(c?.id) === cid);
  if (existingIdx >= 0) contacts.splice(existingIdx, 1);
  contacts.unshift(entry);
  scheduleSave();
  return entry;
}

export function updateContact(contactId, patch = {}) {
  const cid = normalize(contactId);
  if (!cid) return null;
  const idx = contacts.findIndex((c) => normalize(c?.id) === cid);
  if (idx < 0) return null;

  const current = contacts[idx] || {};
  const next = {
    ...current,
    ...patch,
    id: current.id,
    ownerUserId: current.ownerUserId,
    email: patch.email !== undefined ? normalizeEmail(patch.email) : current.email,
    name: patch.name !== undefined ? normalize(patch.name) : current.name,
    tags: patch.tags !== undefined ? normalizeTags(patch.tags) : current.tags,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString()
  };

  contacts[idx] = next;
  scheduleSave();
  return next;
}

export function deleteContact(contactId) {
  const cid = normalize(contactId);
  if (!cid) return false;
  const idx = contacts.findIndex((c) => normalize(c?.id) === cid);
  if (idx === -1) return false;
  contacts.splice(idx, 1);
  scheduleSave();
  return true;
}

export function listProjectContacts(projectId) {
  const pid = normalize(projectId);
  if (!pid) return [];
  return projectContacts
    .filter((c) => normalize(c?.projectId) === pid)
    .slice()
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
}

export function createProjectContact({ id, projectId, name, email, tags, createdByUserId = null, createdByName = null } = {}) {
  const cid = normalize(id);
  const pid = normalize(projectId);
  const mail = normalizeEmail(email);
  if (!cid || !pid || !mail) return null;

  const entry = {
    id: cid,
    projectId: pid,
    name: normalize(name) || mail,
    email: mail,
    tags: normalizeTags(tags),
    createdByUserId: createdByUserId ? normalize(createdByUserId) : null,
    createdByName: createdByName ? normalize(createdByName) : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const existingIdx = projectContacts.findIndex((c) => normalize(c?.id) === cid);
  if (existingIdx >= 0) projectContacts.splice(existingIdx, 1);
  projectContacts.unshift(entry);
  scheduleSave();
  return entry;
}

export function updateProjectContact(contactId, patch = {}) {
  const cid = normalize(contactId);
  if (!cid) return null;
  const idx = projectContacts.findIndex((c) => normalize(c?.id) === cid);
  if (idx < 0) return null;

  const current = projectContacts[idx] || {};
  const next = {
    ...current,
    ...patch,
    id: current.id,
    projectId: current.projectId,
    email: patch.email !== undefined ? normalizeEmail(patch.email) : current.email,
    name: patch.name !== undefined ? normalize(patch.name) : current.name,
    tags: patch.tags !== undefined ? normalizeTags(patch.tags) : current.tags,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString()
  };

  projectContacts[idx] = next;
  scheduleSave();
  return next;
}

export function purgeDemoData({ projectRoomId, requesterUserId } = {}) {
  const roomId = String(projectRoomId || "").trim();
  const uid = String(requesterUserId || "").trim();

  // Remove flows in the demo project room or created by the demo requester
  const flowIds = flows
    .filter((f) => (roomId && String(f?.projectRoomId || "") === roomId) || (uid && String(f?.createdByUserId || "") === uid))
    .map((f) => String(f?.id || ""))
    .filter(Boolean);
  for (const fid of flowIds) {
    const idx = flows.findIndex((f) => String(f?.id || "") === fid);
    if (idx >= 0) flows.splice(idx, 1);
  }

  // Remove projects for the demo room
  if (roomId) {
    const projectIds = projects
      .filter((p) => String(p?.roomId || "") === roomId)
      .map((p) => String(p?.id || ""))
      .filter(Boolean);
    for (const pid of projectIds) {
      const idx = projects.findIndex((p) => String(p?.id || "") === pid);
      if (idx >= 0) projects.splice(idx, 1);
    }
  }

  // Remove contacts created by the demo requester
  if (uid) {
    const contactIds = contacts
      .filter((c) => String(c?.ownerUserId || "") === uid)
      .map((c) => String(c?.id || ""))
      .filter(Boolean);
    for (const cid of contactIds) {
      const idx = contacts.findIndex((c) => String(c?.id || "") === cid);
      if (idx >= 0) contacts.splice(idx, 1);
    }
  }

  // Remove project contacts in the demo room or created by the requester
  const pcIds = projectContacts
    .filter((c) => (roomId && String(c?.projectId || "") === roomId) || (uid && String(c?.createdByUserId || "") === uid))
    .map((c) => String(c?.id || ""))
    .filter(Boolean);
  for (const cid of pcIds) {
    const idx = projectContacts.findIndex((c) => String(c?.id || "") === cid);
    if (idx >= 0) projectContacts.splice(idx, 1);
  }

  scheduleSave();
}

export function deleteProjectContact(contactId) {
  const cid = normalize(contactId);
  if (!cid) return false;
  const idx = projectContacts.findIndex((c) => normalize(c?.id) === cid);
  if (idx === -1) return false;
  projectContacts.splice(idx, 1);
  scheduleSave();
  return true;
}
