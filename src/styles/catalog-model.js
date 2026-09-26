import { clone, validateData } from "../project/model.js";
import { originalRecipe, validateLegacyRecipe } from "./legacy.js";

export const LEGACY_RECIPES_KEY = "tiny-image-star.presets.v1";
export const CATALOG_KEY = "recipes";
export const CATALOG_VERSION = 1;
export const MAX_CATALOG_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_CATALOG_ENTRIES = 100;
export const MAX_CATALOG_RECEIPTS = 128;
const bytes = (value) => new TextEncoder().encode(value).byteLength;
const plain = (value) => value && Object.getPrototypeOf(value) === Object.prototype;
const identifier = (value) => typeof value === "string" && value.length > 0 && value.length <= 512 && !["__proto__", "constructor", "prototype"].includes(value);
export function catalogError(message, code = "CATALOG_UNAVAILABLE") { const error = new Error(message); error.code = code; return error; }
const check = (condition, message) => { if (!condition) throw catalogError(message); };
const keys = (value, names) => plain(value) && Object.keys(value).every((key) => names.includes(key));

export function parseLegacyCatalog(raw) {
  if (raw === null) return [];
  check(typeof raw === "string" && bytes(raw) <= MAX_CATALOG_SOURCE_BYTES, "The original recipe catalog is too large. It is preserved for backup; saved recipes are read-only.");
  let entries;
  try { entries = JSON.parse(raw); } catch { throw catalogError("The original recipe catalog could not be read. It is preserved for backup; saved recipes are read-only."); }
  check(Array.isArray(entries) && entries.length <= MAX_CATALOG_ENTRIES, "The original recipe catalog needs a different app version or exceeds its supported size. It is preserved for backup.");
  const ids = new Set();
  for (const recipe of entries) {
    try { validateLegacyRecipe(recipe); } catch { throw catalogError("Some original recipes need a different app version or contain invalid data. The complete catalog is preserved for backup; saved recipes are read-only."); }
    check(!ids.has(recipe.id), "The original catalog contains duplicate recipe IDs. All originals are preserved for backup; saved recipes are read-only.");
    ids.add(recipe.id);
  }
  return clone(entries);
}

export function emptyRecipeCatalog(source = null, generation = "initial") {
  return { key: CATALOG_KEY, version: CATALOG_VERSION, generation, revision: 0, source, entries: [], receipts: [] };
}

export function validateRecipeCatalog(catalog) {
  const message = "The saved recipe catalog needs a different app version or contains invalid data. It is preserved for backup; saved recipes are read-only.";
  check(keys(catalog, ["key", "version", "generation", "revision", "source", "entries", "receipts"])
    && catalog.key === CATALOG_KEY && catalog.version === CATALOG_VERSION && identifier(catalog.generation)
    && Number.isSafeInteger(catalog.revision) && catalog.revision >= 0, message);
  check(catalog.source === null || typeof catalog.source === "string" && bytes(catalog.source) <= MAX_CATALOG_SOURCE_BYTES, message);
  check(Array.isArray(catalog.entries) && catalog.entries.length <= MAX_CATALOG_ENTRIES
    && Array.isArray(catalog.receipts) && catalog.receipts.length <= MAX_CATALOG_RECEIPTS, message);
  const ids = new Set(), operations = new Set();
  for (const entry of catalog.entries) {
    check(keys(entry, ["id", "styleKey", "token"]) && identifier(entry.id) && typeof entry.styleKey === "string" && entry.styleKey.length > 0 && entry.styleKey.length <= 544 && identifier(entry.token) && !ids.has(entry.id), message);
    ids.add(entry.id);
  }
  let priorRevision = Math.max(0, catalog.revision - catalog.receipts.length);
  for (const receipt of catalog.receipts) {
    check(keys(receipt, ["operationId", "requestHash", "id", "type", "revision", "styleKey"]) && identifier(receipt.operationId)
      && typeof receipt.requestHash === "string" && /^[0-9a-f]{64}$/.test(receipt.requestHash) && identifier(receipt.id)
      && ["put", "delete"].includes(receipt.type) && (receipt.type === "delete" ? receipt.styleKey === null : typeof receipt.styleKey === "string" && receipt.styleKey.length > 0 && receipt.styleKey.length <= 544)
      && receipt.revision === ++priorRevision && !operations.has(receipt.operationId), message);
    operations.add(receipt.operationId);
  }
  check(priorRevision === catalog.revision && (catalog.revision === 0 || catalog.receipts.length > 0), message);
  return catalog;
}

export function validateCatalogCommand(command) {
  validateData(command);
  check(keys(command, ["type", "id", "recipe", "expectedToken", "base", "operationId"]) && ["put", "delete"].includes(command.type)
    && identifier(command.id) && identifier(command.operationId) && (command.expectedToken === null || identifier(command.expectedToken))
    && keys(command.base, ["generation", "revision"]) && identifier(command.base.generation)
    && Number.isSafeInteger(command.base.revision) && command.base.revision >= 0, "Invalid recipe update.");
  if (command.type === "put") {
    validateLegacyRecipe(command.recipe); check(command.recipe.id === command.id, "The recipe identity changed during editing.");
  } else check(command.recipe === undefined && command.expectedToken !== null, "A recipe deletion needs the revision being deleted.");
  return command;
}

export function checkCatalogCommand(catalog, command, requestHash) {
  validateRecipeCatalog(catalog); validateCatalogCommand(command);
  const conflict = () => { throw catalogError("This recipe changed or was removed in another tab. Your draft is still here. Reopen the current recipe or save a new copy.", "CATALOG_CONFLICT"); };
  if (command.base.generation !== catalog.generation) conflict();
  const receipt = catalog.receipts.find((entry) => entry.operationId === command.operationId);
  if (receipt) {
    if (receipt.requestHash !== requestHash) throw catalogError("This update ID already belongs to different recipe settings.", "CATALOG_CONFLICT");
    return "replayed";
  }
  if (command.base.revision > catalog.revision || command.base.revision < catalog.revision - catalog.receipts.length) conflict();
  const entry = catalog.entries.find((item) => item.id === command.id);
  if ((entry?.token ?? null) !== command.expectedToken) conflict();
  // A create based on an old absence must not resurrect a subsequently deleted ID.
  if (!entry && catalog.receipts.some((item) => item.id === command.id && item.revision > command.base.revision)) conflict();
  if (catalog.revision === Number.MAX_SAFE_INTEGER) throw catalogError("This catalog has reached its revision limit. Export a private backup before creating another catalog.");
  return "new";
}

export function advanceRecipeCatalog(catalog, command, requestHash, styleKey) {
  if (checkCatalogCommand(catalog, command, requestHash) === "replayed") return clone(catalog);
  const next = clone(catalog), index = next.entries.findIndex((entry) => entry.id === command.id);
  if (command.type === "put") {
    check(typeof styleKey === "string" && styleKey.length > 0 && styleKey.length <= 544, "A recipe update needs its saved style revision.");
    const entry = { id: command.id, styleKey, token: command.operationId };
    if (index < 0) next.entries.push(entry); else next.entries[index] = entry;
  } else next.entries.splice(index, 1);
  next.revision++;
  next.receipts.push({ operationId: command.operationId, requestHash, id: command.id, type: command.type, revision: next.revision, styleKey: styleKey ?? null });
  next.receipts = next.receipts.slice(-MAX_CATALOG_RECEIPTS);
  return validateRecipeCatalog(next);
}

export function recipeCommand(snapshot, type, recipeOrId, expectedToken = null, operationId = crypto.randomUUID()) {
  const recipe = type === "put" ? originalRecipe(recipeOrId) : undefined;
  return validateCatalogCommand({ type, id: recipe?.id ?? recipeOrId, ...(recipe ? { recipe } : {}), expectedToken,
    base: { generation: snapshot.generation, revision: snapshot.revision }, operationId });
}
