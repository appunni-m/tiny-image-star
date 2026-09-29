import { canonicalJSON, clone } from "../project/model.js";
import { curatedStyles, curatedStoryStyles, styleKey, validateStyle } from "./model.js";
import { LEGACY_STYLE_KIND, legacyStyleFromRecipe, originalRecipe, validateLegacyStyle } from "./legacy.js";
import { CATALOG_KEY, emptyRecipeCatalog, LEGACY_RECIPES_KEY } from "./catalog-model.js";

export const STYLE_DB_NAME = "tiny-image-star.styles";
export const STYLE_DB_VERSION = 2;
export const MAX_STORED_STYLES = 100;
export const MAX_LIBRARY_BYTES = 2 * 1024 * 1024;
export const STYLE_CHANGE_EVENT = "tinystar:styles-changed";
let opening, channel, clearGeneration = 0;
const result = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
function notify(remote = false) {
  globalThis.dispatchEvent?.(new Event(STYLE_CHANGE_EVENT));
  if (!remote) channel?.postMessage("changed");
}
function openDatabase(version) {
  return new Promise((resolve, reject) => {
    let abandoned = false;
    const request = version === undefined ? indexedDB.open(STYLE_DB_NAME) : indexedDB.open(STYLE_DB_NAME, version);
    request.onupgradeneeded = () => {
      for (const name of ["styles", "recipeCatalog"]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "key" });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { abandoned = true; reject(new Error("Close older app tabs to open the style library.")); };
    request.onsuccess = () => { if (abandoned) request.result.close(); else resolve(request.result); };
  });
}
async function database() {
  if (!opening) opening = (async () => {
    let db;
    try { db = await openDatabase(STYLE_DB_VERSION); }
    catch (error) { if (error.name !== "VersionError") throw error; db = await openDatabase(); }
    db.onversionchange = () => { db.close(); opening = null; };
    if (!channel && typeof BroadcastChannel === "function") { channel = new BroadcastChannel("tiny-image-star.styles"); channel.onmessage = () => notify(true); }
    return db;
  })().catch((error) => { opening = null; throw error; });
  return opening;
}
export async function styleDatabaseVersion() { return (await database()).version; }
export async function assertStyleStorageWritable() {
  if (await styleDatabaseVersion() !== STYLE_DB_VERSION) throw new Error("Saved styles need a newer app version. Their original data remains available for private backup.");
}
export async function withStyleTransaction(mode, names, run) {
  const db = await database();
  if (mode === "readwrite" && db.version !== STYLE_DB_VERSION) throw new Error("Saved styles need a newer app version. Their original data remains available for private backup.");
  const tx = db.transaction(names, mode, { durability: "strict" });
  const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Style storage was interrupted.")); });
  void done.catch(() => {});
  try { const value = await run(Object.fromEntries(names.map((name) => [name, tx.objectStore(name)]))); await done; if (mode === "readwrite") notify(); return value; }
  catch (error) { try { tx.abort(); } catch { /* Already settled. */ } await done.catch(() => {}); throw error; }
}
const transaction = (mode, run) => withStyleTransaction(mode, ["styles"], ({ styles }) => run(styles));

export function validateStyleRecord(record) {
  if (!record || Object.keys(record).some((key) => !["version", "key", "style", "origin", "favorite", "savedAt", "lastUsed"].includes(key))
    || record.version !== 1 || record.key !== styleKey(record.style ?? {}) || !["custom", "imported", "curated", "recent", "legacy"].includes(record.origin)
    || typeof record.favorite !== "boolean" || !Number.isSafeInteger(record.savedAt) || record.savedAt < 0 || !Number.isSafeInteger(record.lastUsed) || record.lastUsed < 0) throw new Error("Some saved styles need a different app version. Their original data is preserved in the private backup.");
  if (record.style.kind === LEGACY_STYLE_KIND) validateLegacyStyle(record.style);
  else { validateStyle(record.style); assertBuiltin(record.style); }
  return record;
}
const validateRecord = validateStyleRecord;

function assertBuiltin(style) {
  if (!style.id.startsWith("builtin:")) return false;
  const builtin = [...curatedStyles(), ...curatedStoryStyles({ revision: 1 }), ...curatedStoryStyles()].find((item) => styleKey(item) === styleKey(style));
  if (!builtin || canonicalJSON(builtin) !== canonicalJSON(style)) throw new Error("This file conflicts with a built-in style. Its settings were not imported.");
  return true;
}

export function readStyleBackup() { return transaction("readonly", (store) => result(store.getAll())); }
export async function readStyleLibrary() {
  const raw = await readStyleBackup(), records = [], issues = [];
  for (const record of raw) {
    try { records.push(clone(validateRecord(record))); }
    catch { issues.push("Some saved styles could not be opened. Their original data is preserved in the private backup."); }
  }
  return { records, issues: [...new Set(issues)] };
}

export async function putStyle(style, { origin = "custom", favorite, used = false } = {}) {
  const frozen = clone(validateStyle(style)), generation = clearGeneration;
  if (!["custom", "imported", "curated", "recent"].includes(origin) || (favorite !== undefined && typeof favorite !== "boolean") || typeof used !== "boolean") throw new Error("Invalid style library update.");
  // An imported file may not impersonate a built-in revision. Its renderer
  // requirements can be unavailable, but its identity cannot overwrite one.
  if (assertBuiltin(frozen)) origin = "curated";
  const key = styleKey(frozen);
  return transaction("readwrite", async (store) => {
    const records = await result(store.getAll()), prior = records.find((record) => record.key === key);
    if (generation !== clearGeneration) throw new Error("The style library was cleared while saving. Save again to add this style.");
    if (prior) {
      validateRecord(prior);
      if (canonicalJSON(prior.style) !== canonicalJSON(frozen)) throw new Error("That style ID and revision already contain different settings. Import a new revision instead.");
    }
    const latestUse = Math.max(0, ...records.map((entry) => Number.isSafeInteger(entry.lastUsed) ? entry.lastUsed : 0));
    if (used && latestUse === Number.MAX_SAFE_INTEGER) throw new Error("A saved style has an invalid recent-use marker. Export a private backup before removing it.");
    const record = { version: 1, key, style: frozen, origin: prior && prior.origin !== "recent" ? prior.origin : origin, favorite: favorite ?? prior?.favorite ?? false,
      savedAt: prior?.savedAt ?? Date.now(), lastUsed: used ? Math.max(Date.now(), latestUse + 1) : prior?.lastUsed ?? 0 };
    const next = records.filter((entry) => entry.key !== key).concat(record);
    if (next.length > MAX_STORED_STYLES) throw new Error("Your library has 100 style revisions. Remove a saved style before adding another.");
    if (new TextEncoder().encode(JSON.stringify(next)).length > MAX_LIBRARY_BYTES) throw new Error("Your style library is full. Export and remove some styles before adding another.");
    await result(store.put(record)); return clone(record);
  });
}

export function removeStyle(key) {
  return withStyleTransaction("readwrite", ["styles", "recipeCatalog"], async ({ styles, recipeCatalog }) => {
    const catalog = await result(recipeCatalog.get(CATALOG_KEY));
    if (catalog?.entries?.some((entry) => entry.styleKey === key)) throw new Error("Delete an active recipe from Presets so its catalog and definition stay consistent.");
    const record = await result(styles.get(key)); if (record) { validateRecord(record); await result(styles.delete(key)); }
  });
}
export function clearStyleLibrary() {
  clearGeneration++;
  let source = null; try { source = localStorage.getItem(LEGACY_RECIPES_KEY); } catch { /* The reader will fence an unavailable source. */ }
  return withStyleTransaction("readwrite", ["styles", "recipeCatalog"], async ({ styles, recipeCatalog }) => {
    await result(styles.clear()); await result(recipeCatalog.clear());
    await result(recipeCatalog.put(emptyRecipeCatalog(source, crypto.randomUUID())));
  });
}

export async function readRecipeCatalogBackup() {
  const db = await database();
  if (!db.objectStoreNames.contains("recipeCatalog")) return [];
  return withStyleTransaction("readonly", ["recipeCatalog"], ({ recipeCatalog }) => result(recipeCatalog.getAll()));
}

/** Keep catalog pointers and immutable definitions at one database snapshot. */
export async function readStyleCatalogBackup() {
  const db = await database(), hasCatalog = db.objectStoreNames.contains("recipeCatalog");
  return withStyleTransaction("readonly", hasCatalog ? ["styles", "recipeCatalog"] : ["styles"], async (stores) => {
    const [styleLibrary, recipeCatalog] = await Promise.all([
      result(stores.styles.getAll()), hasCatalog ? result(stores.recipeCatalog.getAll()) : [],
    ]);
    return { styleLibrary, recipeCatalog };
  });
}

/** Choose an immutable definition inside the caller's catalog transaction. */
export function allocateLegacyRecord(records, recipe) {
  const original = originalRecipe(recipe), probe = legacyStyleFromRecipe(original);
  if (original.id.startsWith("builtin:")) throw new Error("This recipe ID is reserved for built-in styles. The original recipe is preserved.");
  const related = records.filter((record) => record.style?.id === original.id);
  for (const record of related) {
    validateRecord(record);
    if (record.style.kind !== LEGACY_STYLE_KIND) throw new Error("This recipe identity conflicts with another style. The original recipe is preserved.");
  }
  const same = related.find((record) => canonicalJSON(record.style.recipe) === canonicalJSON(original)
    && canonicalJSON(record.style.engine) === canonicalJSON(probe.engine));
  if (same) return { record: clone(same), added: false };
  const revision = Math.max(0, ...related.map((record) => record.style.revision)) + 1;
  const style = legacyStyleFromRecipe(original, revision), record = { version: 1, key: styleKey(style), style,
    origin: "legacy", favorite: false, savedAt: Date.now(), lastUsed: 0 };
  checkStyleCapacity([...records, record]);
  return { record, added: true };
}
export function checkStyleCapacity(records) {
  if (records.length > MAX_STORED_STYLES) throw new Error("Your library has 100 style revisions. Export a private backup and remove a saved recipe before adding another.");
  if (new TextEncoder().encode(JSON.stringify(records)).byteLength > MAX_LIBRARY_BYTES) throw new Error("Your style library is full. Previous recipes are preserved.");
}

/** Atomically allocate a revision, then reopen the committed copy before use. */
export async function putLegacyRecipe(recipe, { signal } = {}) {
  const original = originalRecipe(recipe), generation = clearGeneration;
  legacyStyleFromRecipe(original);
  const interrupted = () => {
    if (signal?.aborted || generation !== clearGeneration) throw new DOMException("Recipe migration was interrupted. Its original is preserved.", "AbortError");
  };
  interrupted();
  const saved = await transaction("readwrite", async (store) => {
    const records = await result(store.getAll()); interrupted();
    const { record, added } = allocateLegacyRecord(records, original);
    if (added) await result(store.add(record)); return clone(record);
  });
  interrupted();
  const reopened = await transaction("readonly", (store) => result(store.get(saved.key))); interrupted();
  validateRecord(reopened);
  if (canonicalJSON(reopened.style) !== canonicalJSON(saved.style)) throw new Error("The migrated recipe could not be verified after saving. Its original is preserved.");
  return clone(reopened);
}

export function removeLegacyRecipes(id) {
  return withStyleTransaction("readwrite", ["styles", "recipeCatalog"], async ({ styles: store, recipeCatalog }) => {
    const catalog = await result(recipeCatalog.get(CATALOG_KEY));
    if (catalog?.entries?.some((entry) => entry.id === id)) throw new Error("Delete an active recipe from Presets so its catalog and definitions stay consistent.");
    const records = await result(store.getAll());
    for (const record of records) if (record.style?.kind === LEGACY_STYLE_KIND && record.style.id === id) {
      validateRecord(record); await result(store.delete(record.key));
    }
  });
}
