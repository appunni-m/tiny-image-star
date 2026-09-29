import { canonicalJSON, clone, validateData } from "../project/model.js";
import { validateStyle } from "../styles/model.js";
import { knownStoryFont } from "../styles/font-pack.js";
import { folderRecipeDigest } from "./render-contract.js";

export const PHOTO_COLLECTION_SCHEMA = "tinystar/scene-collection@2";
export const PHOTO_IMPORT_SCHEMA = "tinystar/photo-import@1";
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...keys].sort().join();
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function photoFileReference(file) {
  return { name: file.name, path: file.webkitRelativePath || file.name, byteLength: file.size, lastModified: file.lastModified || 0 };
}

export function assertPhotoInput(input) {
  if (!exact(input, ["name", "files"]) || typeof input.name !== "string" || !input.name.trim() || input.name.length > 80
    || !Array.isArray(input.files) || input.files.length < 6 || input.files.length > 12) throw new Error("Invalid photo group import plan.");
  for (const file of input.files) if (!exact(file, ["name", "path", "byteLength", "lastModified"])
    || typeof file.name !== "string" || !file.name || file.name.length > 512 || typeof file.path !== "string" || !file.path || file.path.length > 2048
    || !Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || !Number.isSafeInteger(file.lastModified) || file.lastModified < 0) throw new Error("A photo's saved import identity is invalid.");
  if (input.files.reduce((sum, file) => sum + file.byteLength, 0) > 96 * 1024 * 1024) throw new Error("Each story can import at most 96 MiB of photos.");
  return input;
}

export function assertPhotoImportDefinition(value, count) {
  if (!exact(value, ["schema", "style", "inputDigests"]) || value.schema !== PHOTO_IMPORT_SCHEMA
    || !Array.isArray(value.inputDigests) || value.inputDigests.length !== count || !value.inputDigests.every(hash)) throw new Error("This photo batch has an unsupported import plan.");
  validateStyle(value.style);
  if (value.style.components.depthTitle || value.style.components.cutoutEffects) throw new Error("This preset needs subject selection. Create editable library stories to use it.");
  if (value.style.assets.some(asset => !knownStoryFont(asset))) throw new Error("This batch preset needs a supported bundled font.");
  return value;
}

export async function photoImportDefinition(groups, style) {
  const inputs = groups.map(group => assertPhotoInput({ name: group.name.trim().slice(0, 80) || "My story", files: group.files.map(photoFileReference) }));
  validateData(inputs);
  // Bound the complete manifest before any destination or database is created.
  await folderRecipeDigest(inputs);
  const inputDigests = [];
  for (const input of inputs) inputDigests.push(await folderRecipeDigest(input));
  const definition = assertPhotoImportDefinition({ schema: PHOTO_IMPORT_SCHEMA, style: clone(style), inputDigests }, inputs.length);
  return { inputs, definition };
}

export async function assertPhotoInputDigest(input, digest) {
  assertPhotoInput(input);
  if (await folderRecipeDigest(input) !== digest) throw new Error("The saved photo selection changed. Its completed groups are preserved.");
}

export function indexPhotoFiles(files) {
  if (!Array.isArray(files) || files.length > 12000) throw new Error("Select at most 12,000 source files.");
  const result = new Map();
  for (const file of files) {
    const key = canonicalJSON(photoFileReference(file));
    if (!result.has(key)) result.set(key, []);
    // The same File object may be used in several selected stories.
    if (!result.get(key).includes(file)) result.get(key).push(file);
  }
  return result;
}

export function matchPhotoFiles(input, files) {
  return input.files.map(reference => {
    const matches = files.get(canonicalJSON(reference));
    if (!matches?.length) throw Object.assign(new Error(`Reselect the original photo: ${reference.path}. Its name, folder, size or modification time is missing or changed.`), { code: "PHOTO_SOURCE_REQUIRED" });
    if (matches.length !== 1) throw new Error(`More than one selected photo matches ${reference.path}. Select its original folder to keep file paths distinct.`);
    return matches[0];
  });
}

// Folder exports still keep source snapshots in browser storage. Reserve that
// cache alongside browser-output jobs instead of treating external output as
// permission to consume unlimited local storage.
export function photoCachePlan(groups) {
  if (!Array.isArray(groups) || !groups.length || groups.length > 1000) throw new Error("Invalid photo cache plan.");
  for (const group of groups) if (!exact(group, ["sha256", "sourceBytes", "metadataBytes"]) || !hash(group.sha256)
    || !Number.isSafeInteger(group.sourceBytes) || group.sourceBytes < 1 || !Number.isSafeInteger(group.metadataBytes) || group.metadataBytes < 1) throw new Error("Invalid photo cache allowance.");
  const totalBytes = groups.reduce((sum, group) => sum + group.sourceBytes + group.metadataBytes, 0);
  if (!Number.isSafeInteger(totalBytes)) throw new Error("The photo cache is too large.");
  return { schema: "tinystar/photo-cache@1", groups: clone(groups), totalBytes };
}

export function remainingPhotoCacheBytes(job) {
  if (!job.photoCache) return 0;
  const plan = photoCachePlan(job.photoCache.groups), spent = job.photoCacheSpent ?? 0;
  if (canonicalJSON(plan) !== canonicalJSON(job.photoCache) || !Number.isSafeInteger(spent) || spent < 0 || spent > plan.totalBytes) throw new Error("The saved photo cache reservation is invalid.");
  return plan.totalBytes - spent;
}
