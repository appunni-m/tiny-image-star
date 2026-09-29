import { canonicalJSON, clone } from "../project/model.js";
import { LEGACY_STYLE_KIND, withLegacyStyle } from "./legacy.js";
import { advanceRecipeCatalog, catalogError, CATALOG_KEY, checkCatalogCommand, emptyRecipeCatalog, LEGACY_RECIPES_KEY,
  parseLegacyCatalog, validateCatalogCommand, validateRecipeCatalog } from "./catalog-model.js";
import { allocateLegacyRecord, styleDatabaseVersion, STYLE_DB_VERSION, validateStyleRecord, withStyleTransaction } from "./store.js";

const result = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const stores = ["styles", "recipeCatalog"];
const interrupted = (signal) => { if (signal?.aborted) throw new DOMException("Recipe update was cancelled.", "AbortError"); };
function legacySource() {
  try { return localStorage.getItem(LEGACY_RECIPES_KEY); }
  catch { throw catalogError("The original recipe catalog cannot be read in this browser. Saved recipes are read-only; previous data has not been replaced."); }
}
function checkSource(catalog) {
  if (catalog.source !== legacySource()) throw catalogError("The original recipe catalog changed outside this app version. Both copies are preserved in the private backup. Saved recipes are read-only until that data is reviewed.");
  parseLegacyCatalog(catalog.source);
}
function openedSnapshot(catalog, records) {
  validateRecipeCatalog(catalog);
  const recipes = catalog.entries.map((entry) => {
    const record = validateStyleRecord(records.find((record) => record.key === entry.styleKey));
    if (record.style.kind !== LEGACY_STYLE_KIND || record.style.id !== entry.id) throw catalogError("A saved recipe references an unavailable style revision. Its original data is preserved for backup.");
    return withLegacyStyle(record.style);
  });
  return { generation: catalog.generation, revision: catalog.revision, entries: clone(catalog.entries), recipes, readOnly: false, issue: "" };
}
function unavailable(error, snapshot) {
  return { generation: null, revision: 0, entries: [], recipes: [], ...snapshot, readOnly: true, issue: error.message };
}
async function readState({ styles, recipeCatalog }) {
  const rows = await result(recipeCatalog.getAll());
  if (rows.some((row) => row.key !== CATALOG_KEY)) throw catalogError("The saved recipe catalog contains unknown records. They are preserved for backup; saved recipes are read-only.");
  return { catalog: rows[0], records: await result(styles.getAll()) };
}

async function initialize(stores, raw, signal) {
  const rows = await result(stores.recipeCatalog.getAll());
  if (rows.some((row) => row.key !== CATALOG_KEY)) throw catalogError("The saved recipe catalog contains unknown records. They are preserved for backup; saved recipes are read-only.");
  const existing = await result(stores.recipeCatalog.get(CATALOG_KEY)); interrupted(signal);
  if (existing) { validateRecipeCatalog(existing); checkSource(existing); return existing; }
  const originals = parseLegacyCatalog(raw), records = await result(stores.styles.getAll()); interrupted(signal);
  if (legacySource() !== raw) throw catalogError("The original recipes changed while migrating. Reload to review them; no originals were replaced.");
  const catalog = emptyRecipeCatalog(raw);
  for (const original of originals) {
    const { record, added } = allocateLegacyRecord(records, original);
    if (added) { await result(stores.styles.add(record)); records.push(record); }
    catalog.entries.push({ id: original.id, styleKey: record.key, token: crypto.randomUUID() });
    interrupted(signal);
  }
  validateRecipeCatalog(catalog);
  await result(stores.recipeCatalog.add(catalog)); return catalog;
}

/** Coherent catalog and definition read; originals are migrated only once. */
export async function readRecipeCatalog({ signal } = {}) {
  let snapshot;
  try {
    interrupted(signal);
    if (await styleDatabaseVersion() !== STYLE_DB_VERSION) throw catalogError("Saved recipes need a newer app version. Their original data remains available for private backup.");
    const raw = legacySource();
    let loaded = await withStyleTransaction("readonly", stores, readState);
    interrupted(signal);
    if (!loaded.catalog && raw === null) return openedSnapshot(emptyRecipeCatalog(), []);
    if (!loaded.catalog) {
      parseLegacyCatalog(raw);
      await withStyleTransaction("readwrite", stores, (entries) => initialize(entries, raw, signal));
      loaded = await withStyleTransaction("readonly", stores, readState);
    }
    interrupted(signal); snapshot = openedSnapshot(loaded.catalog, loaded.records); checkSource(loaded.catalog);
    return snapshot;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return unavailable(error, snapshot);
  }
}

/** One item edit, atomically committed with its immutable definition. */
export async function mutateRecipeCatalog(command, { signal } = {}) {
  const frozen = clone(validateCatalogCommand(command)); interrupted(signal);
  const requestHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJSON(frozen))))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  interrupted(signal);
  const committed = await withStyleTransaction("readwrite", stores, async (entries) => {
    const raw = legacySource(), catalog = await initialize(entries, raw, signal);
    interrupted(signal); checkSource(catalog);
    if (checkCatalogCommand(catalog, frozen, requestHash) === "replayed") return catalog.receipts.find((entry) => entry.operationId === frozen.operationId).styleKey;
    const records = await result(entries.styles.getAll()); interrupted(signal);
    let styleKey = null;
    if (frozen.type === "put") {
      const { record, added } = allocateLegacyRecord(records, frozen.recipe); styleKey = record.key;
      if (added) await result(entries.styles.add(record));
    } else {
      for (const record of records) if (record.style?.id === frozen.id) {
        validateStyleRecord(record);
        if (record.style.kind !== LEGACY_STYLE_KIND) throw catalogError("This recipe identity also belongs to another style. Its data was not deleted.");
        await result(entries.styles.delete(record.key));
      }
    }
    interrupted(signal); checkSource(catalog);
    const next = advanceRecipeCatalog(catalog, frozen, requestHash, styleKey);
    await result(entries.recipeCatalog.put(next)); return styleKey;
  });
  interrupted(signal);
  const reopened = await withStyleTransaction("readonly", stores, readState);
  interrupted(signal);
  const snapshot = openedSnapshot(reopened.catalog, reopened.records); checkSource(reopened.catalog);
  const receipt = reopened.catalog.receipts.find((entry) => entry.operationId === frozen.operationId && entry.requestHash === requestHash);
  if (!receipt) throw catalogError("The saved recipe changed before it could be reopened. Your draft is still here; refresh the catalog before retrying.", "CATALOG_CONFLICT");
  const active = reopened.catalog.entries.find((entry) => entry.id === frozen.id);
  const key = committed ?? (active?.token === frozen.operationId ? active.styleKey : null);
  let recipe = null;
  if (frozen.type === "put") {
    const record = reopened.records.find((entry) => entry.key === key);
    if (!record) throw catalogError("The saved recipe was changed or deleted before it could be reopened. Your draft is still here.", "CATALOG_CONFLICT");
    validateStyleRecord(record); recipe = withLegacyStyle(record.style);
  }
  return { snapshot, recipe };
}
