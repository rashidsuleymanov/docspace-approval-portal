import fs from "node:fs/promises";
import path from "node:path";

const configFilePath = path.resolve(process.cwd(), "server/.data/config.json");

function normalizeFallbacks(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function envDefaults() {
  const baseUrl = process.env.DOCSPACE_BASE_URL || "";
  const rawAuthToken =
    process.env.DOCSPACE_AUTHORIZATION ||
    process.env.DOCSPACE_AUTH_TOKEN ||
    process.env.DOCSPACE_API_KEY ||
    "";
  const webhookSecret =
    process.env.DOCSPACE_WEBHOOK_SECRET ||
    process.env.DOCSPACE_WEBHOOK_SECRET_KEY ||
    process.env.DOCSPACE_WEBHOOK_KEY ||
    "";
  const formsRoomId = process.env.DOCSPACE_FORMS_ROOM_ID || "";
  const libraryRoomId = process.env.DOCSPACE_LIBRARY_ROOM_ID || "";
  const projectTemplatesRoomId = process.env.DOCSPACE_PROJECT_TEMPLATES_ROOM_ID || "";
  const formsRoomTitle = process.env.DOCSPACE_FORMS_ROOM_TITLE || "Forms Room";
  const projectTemplatesRoomTitle = process.env.DOCSPACE_PROJECT_TEMPLATES_ROOM_TITLE || "Projects Templates";
  const formsRoomTitleFallbacks = normalizeFallbacks(
    process.env.DOCSPACE_FORMS_ROOM_TITLE_FALLBACKS || "Medical Room,Medical Forms"
  );
  const projectTemplatesRoomTitleFallbacks = normalizeFallbacks(
    process.env.DOCSPACE_PROJECT_TEMPLATES_ROOM_TITLE_FALLBACKS || "Project Templates,Templates"
  );
  const formsTemplatesFolderTitle = process.env.DOCSPACE_FORMS_TEMPLATES_FOLDER_TITLE || "Templates";

  const portalName = process.env.PORTAL_NAME || "DocSpace Approval Portal";
  const portalTagline = process.env.PORTAL_TAGLINE || "Approval portal";
  const portalLogoUrl = process.env.PORTAL_LOGO_URL || "";
  const portalAccent = process.env.PORTAL_ACCENT || "";
  return {
    baseUrl,
    rawAuthToken,
    webhookSecret,
    formsRoomId,
    libraryRoomId,
    projectTemplatesRoomId,
    formsRoomTitle,
    projectTemplatesRoomTitle,
    formsRoomTitleFallbacks,
    projectTemplatesRoomTitleFallbacks,
    formsTemplatesFolderTitle
    ,
    portalName,
    portalTagline,
    portalLogoUrl,
    portalAccent
  };
}

let runtimeConfig = envDefaults();

async function loadConfigFile() {
  try {
    const raw = await fs.readFile(configFilePath, "utf8");
    const data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== "object") return;

    runtimeConfig = {
      ...runtimeConfig,
      baseUrl: typeof data.baseUrl === "string" ? data.baseUrl : runtimeConfig.baseUrl,
      rawAuthToken: typeof data.rawAuthToken === "string" ? data.rawAuthToken : runtimeConfig.rawAuthToken,
      webhookSecret: typeof data.webhookSecret === "string" ? data.webhookSecret : runtimeConfig.webhookSecret,
      formsRoomId: typeof data.formsRoomId === "string" || typeof data.formsRoomId === "number" ? String(data.formsRoomId) : runtimeConfig.formsRoomId,
      libraryRoomId:
        typeof data.libraryRoomId === "string" || typeof data.libraryRoomId === "number"
          ? String(data.libraryRoomId)
          : runtimeConfig.libraryRoomId,
      projectTemplatesRoomId:
        typeof data.projectTemplatesRoomId === "string" || typeof data.projectTemplatesRoomId === "number"
          ? String(data.projectTemplatesRoomId)
          : runtimeConfig.projectTemplatesRoomId,
      formsRoomTitle: typeof data.formsRoomTitle === "string" ? data.formsRoomTitle : runtimeConfig.formsRoomTitle,
      projectTemplatesRoomTitle:
        typeof data.projectTemplatesRoomTitle === "string"
          ? data.projectTemplatesRoomTitle
          : runtimeConfig.projectTemplatesRoomTitle,
      formsRoomTitleFallbacks: normalizeFallbacks(data.formsRoomTitleFallbacks) || runtimeConfig.formsRoomTitleFallbacks,
      projectTemplatesRoomTitleFallbacks:
        normalizeFallbacks(data.projectTemplatesRoomTitleFallbacks) || runtimeConfig.projectTemplatesRoomTitleFallbacks,
      formsTemplatesFolderTitle:
        typeof data.formsTemplatesFolderTitle === "string"
          ? data.formsTemplatesFolderTitle
          : runtimeConfig.formsTemplatesFolderTitle
      ,
      portalName: typeof data.portalName === "string" ? data.portalName : runtimeConfig.portalName,
      portalTagline: typeof data.portalTagline === "string" ? data.portalTagline : runtimeConfig.portalTagline,
      portalLogoUrl: typeof data.portalLogoUrl === "string" ? data.portalLogoUrl : runtimeConfig.portalLogoUrl,
      portalAccent: typeof data.portalAccent === "string" ? data.portalAccent : runtimeConfig.portalAccent
    };
  } catch (e) {
    if (e?.code === "ENOENT") return;
    console.warn("[config] failed to load persisted config:", e?.message || e);
  }
}

await loadConfigFile();

export function getConfig() {
  return { ...runtimeConfig, formsRoomTitleFallbacks: [...(runtimeConfig.formsRoomTitleFallbacks || [])] };
}

export async function updateConfig(patch = {}) {
  const next = { ...runtimeConfig };
  if (typeof patch.baseUrl === "string") next.baseUrl = patch.baseUrl.trim();
  if (typeof patch.rawAuthToken === "string") {
    const token = patch.rawAuthToken.trim();
    if (token) next.rawAuthToken = token;
    if (!token && patch.clearAuthToken === true) next.rawAuthToken = "";
  }
  if (typeof patch.rawWebhookSecret === "string") {
    const value = patch.rawWebhookSecret.trim();
    if (value) next.webhookSecret = value;
    if (!value && patch.clearWebhookSecret === true) next.webhookSecret = "";
  }
  if (patch.formsRoomId !== undefined) {
    const rid = String(patch.formsRoomId || "").trim();
    next.formsRoomId = rid;
  }
  if (patch.libraryRoomId !== undefined) {
    const rid = String(patch.libraryRoomId || "").trim();
    next.libraryRoomId = rid;
  }
  if (patch.projectTemplatesRoomId !== undefined) {
    const rid = String(patch.projectTemplatesRoomId || "").trim();
    next.projectTemplatesRoomId = rid;
  }
  if (typeof patch.formsRoomTitle === "string") next.formsRoomTitle = patch.formsRoomTitle.trim() || next.formsRoomTitle;
  if (typeof patch.projectTemplatesRoomTitle === "string") {
    next.projectTemplatesRoomTitle = patch.projectTemplatesRoomTitle.trim() || next.projectTemplatesRoomTitle;
  }
  if (patch.formsRoomTitleFallbacks !== undefined) {
    next.formsRoomTitleFallbacks = normalizeFallbacks(patch.formsRoomTitleFallbacks);
  }
  if (patch.projectTemplatesRoomTitleFallbacks !== undefined) {
    next.projectTemplatesRoomTitleFallbacks = normalizeFallbacks(patch.projectTemplatesRoomTitleFallbacks);
  }
  if (typeof patch.formsTemplatesFolderTitle === "string") {
    next.formsTemplatesFolderTitle = patch.formsTemplatesFolderTitle.trim() || next.formsTemplatesFolderTitle;
  }
  if (typeof patch.portalName === "string") next.portalName = patch.portalName.trim() || next.portalName;
  if (typeof patch.portalTagline === "string") next.portalTagline = patch.portalTagline.trim() || next.portalTagline;
  if (typeof patch.portalLogoUrl === "string") next.portalLogoUrl = patch.portalLogoUrl.trim();
  if (typeof patch.portalAccent === "string") next.portalAccent = patch.portalAccent.trim();

  runtimeConfig = next;
  await persistConfig();
  return getConfig();
}

export async function persistConfig() {
  try {
    await fs.mkdir(path.dirname(configFilePath), { recursive: true });
    await fs.writeFile(configFilePath, JSON.stringify(runtimeConfig, null, 2), "utf8");
  } catch (e) {
    console.warn("[config] failed to persist config:", e?.message || e);
  }
}

export function validateConfig({ requiresAuth = true } = {}, cfg = getConfig()) {
  const errors = [];
  if (!cfg?.baseUrl) {
    errors.push("DOCSPACE_BASE_URL is not set");
  }
  if (requiresAuth && !cfg?.rawAuthToken) {
    errors.push("DOCSPACE_AUTH_TOKEN (or DOCSPACE_AUTHORIZATION) is not set");
  }
  return errors;
}
