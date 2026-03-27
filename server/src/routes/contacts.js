import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getSelfProfileWithToken } from "../docspaceClient.js";
import { createContact, deleteContact, listContactsForUser, updateContact } from "../store.js";

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

function normalizeEmail(value) {
  return normalize(value).toLowerCase();
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    const t = normalize(raw);
    if (!t) continue;
    out.push(t);
  }
  return Array.from(new Set(out)).slice(0, 12);
}

router.get("/", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const user = await getSelfProfileWithToken(auth);
    const userId = normalize(user?.id);
    if (!userId) return res.status(401).json({ error: "Invalid user token" });
    const contacts = listContactsForUser(userId);
    res.json({ contacts });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.post("/", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const user = await getSelfProfileWithToken(auth);
    const userId = normalize(user?.id);
    if (!userId) return res.status(401).json({ error: "Invalid user token" });

    const { name, email, tags } = req.body || {};
    const mail = normalizeEmail(email);
    if (!mail) return res.status(400).json({ error: "email is required" });

    const created = createContact({
      id: randomUUID(),
      ownerUserId: userId,
      name: normalize(name) || mail,
      email: mail,
      tags: normalizeTags(tags)
    });
    if (!created) return res.status(500).json({ error: "Failed to create contact" });
    res.json({ contact: created });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.put("/:contactId", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const user = await getSelfProfileWithToken(auth);
    const userId = normalize(user?.id);
    if (!userId) return res.status(401).json({ error: "Invalid user token" });

    const { contactId } = req.params || {};
    const cid = normalize(contactId);
    if (!cid) return res.status(400).json({ error: "contactId is required" });

    const mine = listContactsForUser(userId).some((c) => normalize(c?.id) === cid);
    if (!mine) return res.status(404).json({ error: "Contact not found" });

    const { name, email, tags } = req.body || {};
    const next = updateContact(cid, {
      name: name !== undefined ? normalize(name) : undefined,
      email: email !== undefined ? normalizeEmail(email) : undefined,
      tags: tags !== undefined ? normalizeTags(tags) : undefined
    });
    if (!next) return res.status(404).json({ error: "Contact not found" });
    res.json({ contact: next });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

router.delete("/:contactId", async (req, res) => {
  try {
    const auth = requireUserToken(req);
    const user = await getSelfProfileWithToken(auth);
    const userId = normalize(user?.id);
    if (!userId) return res.status(401).json({ error: "Invalid user token" });

    const { contactId } = req.params || {};
    const cid = normalize(contactId);
    if (!cid) return res.status(400).json({ error: "contactId is required" });

    const mine = listContactsForUser(userId).some((c) => normalize(c?.id) === cid);
    if (!mine) return res.status(404).json({ error: "Contact not found" });

    deleteContact(cid);
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

export default router;

