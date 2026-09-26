import { canonicalJSON, ENGINE_IDENTITY } from "../project/model.js";
import { MAX_FONT_BYTES, MAX_TEXT_FONT_BYTES, MAX_TEXT_FONTS } from "../compositor/fonts.js";

export const FOLDER_RENDER_SCHEMA = "tinystar/folder-render@1";
const digestPattern = /^[a-f0-9]{64}$/;
const fields = (value, names) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(" ") === [...names].sort().join(" ");
function fail(message) { const error = new Error(message); error.userMessage = message; error.code = "FOLDER_RENDER_CONTRACT"; throw error; }

export function pendingFolderContract() {
  return { schema: FOLDER_RENDER_SCHEMA, engine: { ...ENGINE_IDENTITY }, recipeSha256: null, fonts: [] };
}

export function assertFolderContract(job) {
  if (!job) fail("The saved folder job is no longer available. Its exported files have not been removed.");
  if (job?.version !== 2) fail("This saved folder job predates frozen rendering. Its outputs are preserved. Start a new folder job to use this version.");
  const contract = job.renderContract;
  if (!fields(contract, ["schema", "engine", "recipeSha256", "fonts"]) || contract.schema !== FOLDER_RENDER_SCHEMA) fail("This folder job has an unsupported rendering contract. Its saved data is preserved.");
  if (canonicalJSON(contract.engine) !== canonicalJSON(ENGINE_IDENTITY)) fail("This folder job needs a different renderer version. Its saved outputs are preserved. Start a new job with this version.");
  if (contract.recipeSha256 !== null && !digestPattern.test(contract.recipeSha256)) fail("The folder recipe identity is invalid.");
  if (!Array.isArray(contract.fonts) || contract.fonts.length > MAX_TEXT_FONTS || contract.recipeSha256 === null && contract.fonts.length) fail("The folder font snapshot is invalid.");
  let bytes = 0; const seen = new Set();
  for (const font of contract.fonts) {
    if (!fields(font, ["id", "sha256", "byteLength"]) || typeof font.id !== "string" || !/^font-[a-f0-9]{8,64}$/.test(font.id)
      || seen.has(font.id) || !digestPattern.test(font.sha256) || !Number.isInteger(font.byteLength) || font.byteLength < 1 || font.byteLength > MAX_FONT_BYTES) fail("The folder font snapshot is invalid.");
    seen.add(font.id); bytes += font.byteLength;
  }
  if (bytes > MAX_TEXT_FONT_BYTES) fail("The folder font snapshot exceeds 32 MiB.");
  return contract;
}

export async function folderRecipeDigest(recipe) {
  const value = canonicalJSON(recipe);
  if (typeof value !== "string" || value.length > 2 * 1024 * 1024) fail("The folder recipe is too large to preserve safely.");
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > 2 * 1024 * 1024) fail("The folder recipe is too large to preserve safely.");
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function assertFolderRecipe(job, recipe = job?.recipe) {
  const contract = assertFolderContract(job);
  if (canonicalJSON(recipe) !== canonicalJSON(job.recipe)) fail("The queued recipe no longer matches this folder job. Start a new job to change its edits.");
  const sha256 = await folderRecipeDigest(job.recipe);
  if (contract.recipeSha256 !== null && contract.recipeSha256 !== sha256) fail("The saved folder recipe changed after processing began. Existing outputs have been preserved.");
  return sha256;
}
