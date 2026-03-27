import "dotenv/config";
import { getConfig, validateConfig } from "./config.js";
import { getFolderContents, getFormsRoomFolders, requireFormsRoom } from "./docspaceClient.js";

function logOk(message) {
  console.log(`OK  ${message}`);
}

function logWarn(message) {
  console.warn(`WARN ${message}`);
}

function logFail(message) {
  console.error(`FAIL ${message}`);
}

async function run() {
  const errors = validateConfig({ requiresAuth: true });
  if (errors.length) {
    errors.forEach((e) => logFail(e));
    process.exitCode = 1;
    return;
  }

  logOk("Base config present");

  const formsRoom = await requireFormsRoom().catch((e) => {
    logFail(e?.message || "Forms room not found");
    process.exitCode = 1;
    return null;
  });
  if (!formsRoom?.id) return;
  logOk(`Forms room: ${formsRoom.title} (${formsRoom.id})`);

  const folders = await getFormsRoomFolders(formsRoom.id).catch(() => null);

  const templatesFolderId = folders?.templates?.id || formsRoom.id;
  const templatesFolder = await getFolderContents(templatesFolderId).catch(() => null);
  const templatesCount = Array.isArray(templatesFolder?.items)
    ? templatesFolder.items.filter((i) => i.type === "file").length
    : 0;
  const cfg = getConfig();
  logOk(
    `Templates folder: ${templatesFolder?.title || cfg.formsTemplatesFolderTitle} (${templatesCount} file(s))`
  );

  if (!process.exitCode) {
    logOk("Smoke check finished");
  }
}

run();
