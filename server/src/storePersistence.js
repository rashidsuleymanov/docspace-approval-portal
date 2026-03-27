import fs from "node:fs/promises";
import path from "node:path";

function safeJsonParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getStorePath() {
  const raw = process.env.DOCSPACE_APPROVAL_PORTAL_STORE_PATH;
  const value = String(raw || "").trim();
  if (value.toLowerCase() === "off" || value.toLowerCase() === "false") return null;
  if (value) return path.resolve(process.cwd(), value);
  return path.resolve(process.cwd(), "server/.data/store.json");
}

export async function loadStoreSnapshot(storePath) {
  const filePath = String(storePath || "").trim();
  if (!filePath) return null;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return safeJsonParse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function saveStoreSnapshot(storePath, snapshot) {
  const filePath = String(storePath || "").trim();
  if (!filePath) return;
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
}

