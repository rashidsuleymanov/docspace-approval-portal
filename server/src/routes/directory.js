import { Router } from "express";
import {
  createGroup,
  createUserProfile,
  deleteGroup,
  deleteUser,
  getGroupInfo,
  getUserByEmail,
  inviteUsers,
  listGroups,
  listPeople,
  removeGroupMembers,
  searchUsers,
  updateGroup
} from "../docspaceClient.js";

const router = Router();

function requireUserToken(req) {
  const auth = String(req.headers.authorization || "").trim();
  if (!auth) {
    const err = new Error("Authorization token is required");
    err.status = 401;
    throw err;
  }
  return auth;
}

function normalize(value) {
  return String(value || "").trim();
}

function clampInt(value, { min = 0, max = 200, fallback = 25 } = {}) {
  const n = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function pickEmail(user) {
  const raw = String(user?.email || user?.mail || user?.userName || "").trim();
  if (!raw) return "";
  return raw.includes("@") ? raw : "";
}

function pickDisplayName(user) {
  const named = String(user?.displayName || user?.name || "").trim();
  if (named) return named;
  const composed = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  if (composed) return composed;
  const email = pickEmail(user);
  return email || "User";
}

function pickMembersArray(data) {
  const candidates = [
    data?.members,
    data?.users,
    data?.people,
    data?.members?.items,
    data?.members?.users,
    data?.members?.people,
    data?.response?.members,
    data?.response?.users,
    data?.response?.people
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function normalizeEmailList(value) {
  const raw = String(value || "");
  const parts = raw
    .split(/[\n,;]+/g)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

async function resolveEmailsToUserIds(emails, auth) {
  const list = Array.isArray(emails) ? emails : [];
  const ids = [];
  const missing = [];
  for (const email of list) {
    // eslint-disable-next-line no-await-in-loop
    const user = await getUserByEmail(email, auth).catch(() => null);
    const id = String(user?.id || "").trim();
    if (id) ids.push(id);
    else missing.push(email);
  }
  if (missing.length) {
    const err = new Error(`Some emails were not found in DocSpace: ${missing.join(", ")}`);
    err.status = 400;
    throw err;
  }
  return ids;
}

router.get("/groups", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const groups = await listGroups(auth);
    const normalized = (groups || [])
      .map((g) => ({
        id: g?.id ?? g?.groupId ?? null,
        name: g?.name ?? g?.title ?? g?.groupName ?? "",
        membersCount: g?.membersCount ?? g?.usersCount ?? g?.count ?? null
      }))
      .filter((g) => String(g.id || "").trim());
    res.json({ groups: normalized });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/groups", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const groupName = normalize(req.body?.groupName || req.body?.name);
    if (!groupName) return res.status(400).json({ error: "groupName is required" });

    const managerEmail = normalize(req.body?.managerEmail);
    const managerIdRaw = normalize(req.body?.groupManager || req.body?.managerId);
    const groupManager = managerIdRaw
      ? managerIdRaw
      : managerEmail
        ? String((await getUserByEmail(managerEmail, auth).catch(() => null))?.id || "").trim()
        : "";

    const membersEmails = normalizeEmailList(req.body?.memberEmails || req.body?.membersEmails || "");
    const membersIds = Array.isArray(req.body?.members) ? req.body.members : Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
    const membersFromEmails = membersEmails.length ? await resolveEmailsToUserIds(membersEmails, auth) : [];
    const members = [...new Set([...membersIds.map((v) => String(v || "").trim()).filter(Boolean), ...membersFromEmails])];

    const created = await createGroup({ groupName, groupManager, members }, auth);
    res.status(201).json({ group: created });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.put("/groups/:groupId", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const groupId = normalize(req.params?.groupId);
    if (!groupId) return res.status(400).json({ error: "groupId is required" });

    const groupName = normalize(req.body?.groupName || req.body?.name);
    const managerEmail = normalize(req.body?.managerEmail);
    const managerIdRaw = normalize(req.body?.groupManager || req.body?.managerId);
    const groupManager = managerIdRaw
      ? managerIdRaw
      : managerEmail
        ? String((await getUserByEmail(managerEmail, auth).catch(() => null))?.id || "").trim()
        : "";

    const addEmails = normalizeEmailList(req.body?.addEmails || req.body?.memberEmails || "");
    const addIdsRaw = Array.isArray(req.body?.membersToAdd) ? req.body.membersToAdd : Array.isArray(req.body?.addIds) ? req.body.addIds : [];
    const addIdsFromEmails = addEmails.length ? await resolveEmailsToUserIds(addEmails, auth) : [];
    const membersToAdd = [...new Set([...addIdsRaw.map((v) => String(v || "").trim()).filter(Boolean), ...addIdsFromEmails])];

    const updated = await updateGroup(groupId, { groupName, groupManager, membersToAdd }, auth);
    res.json({ group: updated });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.delete("/groups/:groupId", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const groupId = normalize(req.params?.groupId);
    if (!groupId) return res.status(400).json({ error: "groupId is required" });
    const result = await deleteGroup(groupId, auth);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.delete("/groups/:groupId/members", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const groupId = normalize(req.params?.groupId);
    if (!groupId) return res.status(400).json({ error: "groupId is required" });
    const members = Array.isArray(req.body?.members) ? req.body.members : normalizeEmailList(req.body?.emails || "");
    const memberIds = members.length && String(members[0] || "").includes("@") ? await resolveEmailsToUserIds(members, auth) : members;
    const result = await removeGroupMembers(groupId, { members: memberIds }, auth);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.get("/people", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const limit = clampInt(req.query?.limit, { min: 1, max: 200, fallback: 25 });
    const offset = clampInt(req.query?.offset, { min: 0, max: 100000, fallback: 0 });

    const results = await listPeople(auth);
    const normalized = (results || [])
      .map((u) => ({
        id: u?.id ?? null,
        displayName: u?.displayName ?? [u?.firstName, u?.lastName].filter(Boolean).join(" ") ?? u?.email ?? "",
        email: u?.email ?? ""
      }))
      .filter((p) => String(p.email || "").trim());

    const total = normalized.length;
    const people = normalized.slice(offset, offset + limit);
    res.json({ people, total, offset, limit });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/people", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const email = normalize(req.body?.email);
    if (!email) return res.status(400).json({ error: "email is required" });
    const created = await createUserProfile(
      { firstName: normalize(req.body?.firstName), lastName: normalize(req.body?.lastName), email },
      auth
    );
    res.status(201).json({ user: created });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/people/invite", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const emails = Array.isArray(req.body?.emails) ? req.body.emails : normalizeEmailList(req.body?.emails || req.body?.email || "");
    if (!emails.length) return res.status(400).json({ error: "emails are required" });
    const result = await inviteUsers({ emails, message: req.body?.message, subject: req.body?.subject }, auth);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.delete("/people/:userId", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const userId = normalize(req.params?.userId);
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const result = await deleteUser(userId, auth);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.get("/groups/:groupId", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const groupId = normalize(req.params?.groupId);
    if (!groupId) return res.status(400).json({ error: "groupId is required" });
    const data = await getGroupInfo(groupId, { includeMembers: true }, auth);
    const membersRaw = pickMembersArray(data);
    const members = membersRaw
      .map((m) => {
        const user = m?.user || m;
        return {
          id: user?.id ?? null,
          displayName: pickDisplayName(user),
          email: pickEmail(user)
        };
      })
      .filter((m) => String(m.id || "").trim() || String(m.email || "").trim());

    res.json({
      group: {
        id: data?.id ?? data?.groupId ?? groupId,
        name: data?.name ?? data?.title ?? "",
        membersCount: members.length
      },
      members
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.get("/people/search", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const query = normalize(req.query?.query);
    if (!query) return res.json({ people: [] });
    const results = await searchUsers(query, auth);
    const people = (results || [])
      .map((u) => ({
        id: u?.id ?? null,
        displayName: u?.displayName ?? [u?.firstName, u?.lastName].filter(Boolean).join(" ") ?? u?.email ?? "",
        email: u?.email ?? ""
      }))
      .filter((p) => String(p.email || "").trim());
    res.json({ people });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

export default router;
