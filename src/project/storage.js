import { canonicalJSON, clone, createLegacyProject, validateProject, assertEngineCompatibility, upgradeProjectRenderer } from "./model.js";
import { validateRecipeReferences } from "../styles/selection.js";
import { storageTransactionError } from "./storage-errors.js";

export const PROJECT_DB_NAME = "tiny-image-star.projects";
const MAX_ASSET_BYTES = 128 * 1024 * 1024;
let opening;
let writes = Promise.resolve();
const result = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const complete = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onabort = transaction.onerror = event => reject(storageTransactionError(event.target?.error ?? transaction.error, "Project storage was interrupted."));
});

async function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(PROJECT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("records");
      request.result.createObjectStore("assets", { keyPath: "sha256" });
    };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); opening = null; };
      resolve(request.result);
    };
  });
  return opening;
}

async function transact(mode, callback) {
  const db = await database();
  const transaction = db.transaction(["records", "assets"], mode, { durability: "strict" });
  const done = complete(transaction);
  void done.catch(() => {});
  try {
    const value = await callback(transaction.objectStore("records"), transaction.objectStore("assets"));
    await done;
    return value;
  } catch (error) {
    try { transaction.abort(); } catch { /* Already settled. */ }
    await done.catch(() => {});
    throw error;
  }
}

export async function hashAsset(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function entriesFor(snapshot) { return snapshot.kind === "editor" ? [snapshot.editor] : snapshot.batch.files; }

function validateRecoveryEnvelope(record) {
  if (record.kind != null && !["story", "design"].includes(record.kind)) throw new Error("Unsupported recovery kind. Its original data has been preserved.");
  if (record.kind === "design") { designDocument(record.document); return; }
  if (record.kind == null && record.session?.version !== 1) throw new Error("Unsupported saved session format. Its original data has been preserved.");
  if (record.version === 1 && !record.session?.recipeReferences) return;
  if (record.version !== 2 || record.kind != null || !record.session?.batch) throw new Error("Unsupported recovery record. Its original data has been preserved.");
  validateRecipeReferences(record.session);
  if (canonicalJSON(record.document.recipe?.references) !== canonicalJSON(record.session.recipeReferences)
    || canonicalJSON(record.document.recipe?.definitions) !== canonicalJSON(record.session.frozenRecipes)) throw new Error("Saved recipe selections disagree with the recovery project. Its data has been preserved.");
}
function knownStoredRecord(record) {
  try {
    if (record.kind === "story") { if (record.version !== 1) return false; storyDocument(record.document); return true; }
    if (record.kind === "design") { if (record.version !== 1) return false; designDocument(record.document); return true; }
    validateRecoveryEnvelope(record);
    return record.document?.version === 1;
  } catch { return false; }
}

export function projectForSnapshot(snapshot) {
  if (snapshot.project) return upgradeProjectRenderer(snapshot.project);
  const files = entriesFor(snapshot);
  const project = createLegacyProject({ id: snapshot.projectId, createdAt: snapshot.projectCreatedAt ?? snapshot.savedAt, name: snapshot.kind === "editor" ? files[0].name : "Image set",
    files: files.map((file) => ({ ...file, width: file.width || null, height: file.height || null })),
    operations: files.map((file) => file.operations ?? file.resolvedOperations ?? file.override ?? {}) });
  project.recipe = snapshot.frozenRecipes?.length ? { kind: "legacy-recipes", revision: 1, definitions: clone(snapshot.frozenRecipes),
    ...(snapshot.recipeReferences ? { references: clone(snapshot.recipeReferences) } : {}) } : null;
  project.revision = Number(snapshot.projectRevision) || 0;
  return project;
}

async function save(snapshot, key) {
  if (snapshot.recipeReferences) validateRecipeReferences(snapshot);
  const document = projectForSnapshot(snapshot);
  if (document.recipe?.kind === "legacy-recipes") document.recipe.revision = await hashAsset(new TextEncoder().encode(canonicalJSON(document.recipe.references
    ? { definitions: document.recipe.definitions, references: document.recipe.references } : document.recipe.definitions)));
  const files = entriesFor(snapshot), session = clone(snapshot);
  delete session.project;
  const metadata = entriesFor(session);
  const assets = new Map();
  if (document.slides.length !== files.length) throw new Error("The recovery document does not match its source files.");
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index], node = document.nodes[document.slides[index].nodeIds[0]];
    if (node?.kind !== "legacy-image") throw new Error("This document needs the story project saver.");
    const sha256 = await hashAsset(file.bytes);
    const asset = document.assets[node.assetId];
    if (asset.sha256 && asset.sha256 !== sha256) throw new Error("A project source changed unexpectedly. The previous recovery copy is preserved.");
    asset.sha256 = sha256;
    asset.byteLength = file.bytes.byteLength;
    assets.set(sha256, { sha256, blob: new Blob([file.bytes], { type: file.type || "application/octet-stream" }) });
    delete metadata[index].bytes;
    delete metadata[index].operations;
    delete metadata[index].resolvedOperations;
    metadata[index].assetId = node.assetId;
    metadata[index].nodeId = node.id;
  }
  validateProject(document);
  const record = { version: snapshot.recipeReferences ? 2 : 1, document, session };
  validateRecoveryEnvelope(record);
  return commitRecord(record, key, assets);
}

async function commitRecord(record, key, assets, expected) {
  const document = record.document;
  await transact("readwrite", async (records, assetStore) => {
    const existing = await result(records.get(key));
    // An old app must never downgrade an unknown newer document in place.
    if (existing) {
      validateProject(existing.document); assertEngineCompatibility(existing.document, { allowLegacy: true });
      if (existing.kind === "story" && existing.version === 1) storyDocument(existing.document);
      else if (existing.kind === "design" && existing.version === 1) designDocument(existing.document);
      else if (existing.kind == null) validateRecoveryEnvelope(existing);
      else throw new Error("An unsupported project kind is saved. Its recovery copy has been preserved.");
    }
    if (existing?.version === 2 && record.version === 1 && existing.document.id === document.id) throw new Error("This saved image set requires its exact recipe revisions. Its recovery copy has been preserved.");
    if (existing && (existing.kind ?? "recovery") !== (record.kind ?? "recovery")) throw new Error("This recovery location belongs to a different kind of project.");
    if (expected && (expected.revision === null ? Boolean(existing) : !existing || existing.document.id !== document.id || existing.document.revision !== expected.revision)) {
      const label = record.kind === "design" ? "design" : record.kind === "story" ? "story" : "image set";
      const error = new Error(`This ${label} changed in another tab. Reopen the saved version before saving again.`);
      error.code = "PROJECT_CONFLICT"; throw error;
    }
    if (existing?.document.id === document.id && existing.document.revision > document.revision) throw new Error("A newer project revision is already saved.");
    if (existing?.document.id === document.id && existing.document.revision === document.revision
      && canonicalJSON(existing.document) !== canonicalJSON(document)) throw new Error("Another edit has already saved this project revision. Its recovery copy has been preserved.");
    if (existing?.version === 1 && record.version === 2) {
      const archiveKey = `${key}:schema-backup:${existing.document.id}:${existing.document.revision}`;
      const archive = { ...existing, archiveOf: key }, saved = await result(records.get(archiveKey));
      if (saved && canonicalJSON(saved) !== canonicalJSON(archive)) throw new Error("An earlier recovery backup already occupies this revision. Its data has been preserved.");
      if (!saved) records.add(archive, archiveKey);
    }
    if (existing && canonicalJSON(existing.document.engine) !== canonicalJSON(document.engine)) {
      const archiveKey = `${key}:renderer-backup:${existing.document.id}:${existing.document.revision}`;
      const archive = { ...existing, archiveOf: key };
      const saved = await result(records.get(archiveKey));
      if (saved && canonicalJSON(saved) !== canonicalJSON(archive)) throw new Error("An earlier renderer backup already occupies this revision. Its data has been preserved.");
      if (!saved) records.add(archive, archiveKey);
    }
    const all = await result(records.getAll());
    const keys = await result(records.getAllKeys());
    const oldAssets = await result(assetStore.getAll());
    const keep = new Set(Object.values(document.assets).map((asset) => asset.sha256).filter(Boolean));
    for (const [index, item] of all.entries()) {
      if (keys[index] === key) continue;
      if (!knownStoredRecord(item)) {
        // Unknown record formats may refer to any stored asset. Keep all
        // current blobs rather than collecting data that a newer app needs.
        for (const stored of oldAssets) keep.add(stored.sha256);
        continue;
      }
      for (const asset of Object.values(item.document.assets)) if (asset.sha256) keep.add(asset.sha256);
    }
    const sizes = new Map(oldAssets.map((asset) => [asset.sha256, asset.blob.size]));
    for (const asset of assets.values()) sizes.set(asset.sha256, asset.blob.size);
    if ([...keep].some((hash) => !sizes.has(hash))) throw new Error("A saved project asset is missing. Existing recovery copies have been preserved.");
    if ([...keep].reduce((sum, hash) => sum + (sizes.get(hash) ?? 0), 0) > MAX_ASSET_BYTES) throw new Error("Project recovery storage exceeds its 128 MiB budget. Back up and clear older recovery copies first.");
    for (const asset of assets.values()) assetStore.put(asset);
    records.put(record, key);
    for (const asset of oldAssets) if (!keep.has(asset.sha256)) assetStore.delete(asset.sha256);
  });
  // Verify the committed metadata can be reopened before the caller treats
  // migration as successful. The old v1 snapshot is deliberately retained.
  const reopened = await transact("readonly", (records) => result(records.get(key)));
  if (canonicalJSON(reopened) !== canonicalJSON(record)) throw new Error("Project readback verification failed.");
  return true;
}

function persistedProjectDocument(project, kind) {
  validateProject(project); assertEngineCompatibility(project);
  if (Object.values(project.nodes).some((node) => node.kind === "legacy-image")) throw new Error(`Use image recovery for this legacy ${kind} project.`);
  const sizes = new Map();
  for (const asset of Object.values(project.assets)) {
    if (kind === "design" && asset.kind !== "image") throw new Error("Design files can only contain local image assets.");
    if (!asset.sha256 || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1) throw new Error(`${kind} assets need their original length and SHA-256 before saving.`);
    if (asset.kind !== "font" && (!Number.isInteger(asset.width) || !Number.isInteger(asset.height))) throw new Error(`${kind} image assets need their upright pixel dimensions.`);
    if (sizes.has(asset.sha256) && sizes.get(asset.sha256) !== asset.byteLength) throw new Error(`Identical ${kind} assets cannot declare different lengths.`);
    sizes.set(asset.sha256, asset.byteLength);
  }
  if ([...sizes.values()].reduce((sum, size) => sum + size, 0) > MAX_ASSET_BYTES) throw new Error(`This ${kind} exceeds the 128 MiB recovery asset budget.`);
  return project;
}

function storyDocument(project) { return persistedProjectDocument(project, "story"); }
function designDocument(project) { return persistedProjectDocument(project, "design"); }

function storyKey(key) {
  if (typeof key !== "string" || !key.startsWith("story:") || key.length < 7 || key.length > 1024 || key.includes(":renderer-backup:")) throw new Error("Invalid story recovery location.");
  return key;
}

function designKey(key) {
  if (typeof key !== "string" || !key.startsWith("design:") || key.length < 8 || key.length > 1024 || key.includes(":renderer-backup:")) throw new Error("Invalid design recovery location.");
  return key;
}

async function verifiedBlob(asset, source) {
  const size = source instanceof Blob ? source.size : source?.byteLength;
  if (size !== asset.byteLength) throw new Error("A saved project asset is missing or changed. The previous recovery copy is preserved.");
  // Blob snapshots mutable views, including their exact byteOffset/byteLength.
  // Only one source is expanded for hashing at a time; stored assets stay Blobs.
  const blob = source instanceof Blob ? source : source instanceof ArrayBuffer || ArrayBuffer.isView(source) ? new Blob([source], { type: asset.type }) : null;
  if (!blob || await hashAsset(await blob.arrayBuffer()) !== asset.sha256) throw new Error("A saved project asset failed its integrity check. The previous recovery copy is preserved.");
  return blob;
}

/** Reuse verified bytes retained by a saved project, without a network request. */
export async function readStoredStoryAsset(asset) {
  const saved = await transact("readonly", (_records, assets) => result(assets.get(asset.sha256)));
  return saved ? verifiedBlob(asset, saved.blob) : null;
}

/**
 * Save a frozen scene and its local asset dependencies atomically. A new story
 * requires expectedRevision: null; updates require the revision last reopened
 * or saved by this caller. The comparison occurs inside the write transaction,
 * so independent browser tabs cannot overwrite each other's edits.
 */
export function writeStoryProject(project, { key = `story:${project.id}`, readAsset, expectedRevision = null } = {}) {
  const document = storyDocument(clone(project));
  storyKey(key);
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > document.revision)) throw new Error("Invalid expected story revision.");
  const next = writes.catch(() => {}).then(async () => {
    const assets = new Map();
    for (const asset of Object.values(document.assets)) {
      if (assets.has(asset.sha256)) continue;
      let source = readAsset ? await readAsset(asset.id) : undefined;
      if (source == null) source = (await transact("readonly", (_records, store) => result(store.get(asset.sha256))))?.blob;
      const blob = await verifiedBlob(asset, source);
      assets.set(asset.sha256, { sha256: asset.sha256, blob });
    }
    await commitRecord({ version: 1, kind: "story", savedAt: Date.now(), document }, key, assets, { revision: expectedRevision });
    return { key, revision: document.revision };
  });
  writes = next;
  return next;
}

/** Save a local multi-page design and its immutable original images atomically. */
export function writeDesignProject(project, { key = `design:${project.id}`, readAsset, expectedRevision = null } = {}) {
  const document = designDocument(clone(project));
  designKey(key);
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > document.revision)) throw new Error("Invalid expected design revision.");
  const next = writes.catch(() => {}).then(async () => {
    const assets = new Map();
    for (const asset of Object.values(document.assets)) {
      if (assets.has(asset.sha256)) continue;
      let source = readAsset ? await readAsset(asset.id) : undefined;
      if (source == null) source = (await transact("readonly", (_records, store) => result(store.get(asset.sha256))))?.blob;
      const blob = await verifiedBlob(asset, source);
      assets.set(asset.sha256, { sha256: asset.sha256, blob });
    }
    await commitRecord({ version: 1, kind: "design", savedAt: Date.now(), document }, key, assets, { revision: expectedRevision });
    return { key, revision: document.revision };
  });
  writes = next;
  return next;
}

/** Reopen metadata and immutable Blob handles; verify bytes lazily on access. */
export async function readStoryProject(key) {
  storyKey(key);
  const value = await transact("readonly", async (records, assets) => {
    const record = await result(records.get(key));
    if (!record) return null;
    if (record.version !== 1 || record.kind !== "story") throw new Error("Unsupported story recovery format. Its data has been preserved.");
    const project = storyDocument(record.document), stored = new Map();
    for (const asset of Object.values(project.assets)) {
      if (!stored.has(asset.sha256)) {
        const saved = await result(assets.get(asset.sha256));
        if (!(saved?.blob instanceof Blob) || saved.blob.size !== asset.byteLength) throw new Error("A story asset is missing. The saved document is preserved for backup.");
        stored.set(asset.sha256, saved.blob);
      }
    }
    return { project, stored };
  });
  if (!value) return null;
  // Keep the validation manifest separate from the caller's editable document.
  // Blob handles also let an already-open revision finish rendering after a
  // later save removes its asset from the database.
  const manifest = value.project.assets;
  return { key, revision: value.project.revision, project: clone(value.project), readAsset: async (id) => {
    const asset = manifest[id];
    if (!asset) throw new Error("This asset does not belong to the reopened story revision.");
    return verifiedBlob(asset, value.stored.get(asset.sha256));
  } };
}

/** Reopen a saved design with pinned Blob handles and integrity-checked reads. */
export async function readDesignProject(key) {
  designKey(key);
  const value = await transact("readonly", async (records, assets) => {
    const record = await result(records.get(key));
    if (!record) return null;
    if (record.version !== 1 || record.kind !== "design") throw new Error("Unsupported design recovery format. Its data has been preserved.");
    const project = designDocument(record.document), stored = new Map();
    for (const asset of Object.values(project.assets)) {
      if (!stored.has(asset.sha256)) {
        const saved = await result(assets.get(asset.sha256));
        if (!(saved?.blob instanceof Blob) || saved.blob.size !== asset.byteLength) throw new Error("A design image is missing. The saved document is preserved for backup.");
        stored.set(asset.sha256, saved.blob);
      }
    }
    return { project, stored };
  });
  if (!value) return null;
  const manifest = value.project.assets;
  return { key, revision: value.project.revision, project: clone(value.project), readAsset: async (id) => {
    const asset = manifest[id];
    if (!asset) throw new Error("This image does not belong to the reopened design revision.");
    return verifiedBlob(asset, value.stored.get(asset.sha256));
  } };
}

export async function listStoryProjects() {
  return transact("readonly", async (records) => {
    const values = await result(records.getAll()), keys = await result(records.getAllKeys());
    return values.flatMap((record, index) => record.kind === "story" && !record.archiveOf ? [{ key: keys[index],
      name: typeof record.document?.name === "string" ? record.document.name : "Saved story", revision: record.document?.revision,
      savedAt: record.savedAt ?? record.document?.createdAt ?? 0,
      byteLength: Object.values(record.document?.assets ?? {}).reduce((sum, asset) => sum + (Number(asset.byteLength) || 0), 0) }] : [])
      .sort((a, b) => b.savedAt - a.savedAt);
  });
}

export async function listDesignProjects() {
  return transact("readonly", async (records) => {
    const values = await result(records.getAll()), keys = await result(records.getAllKeys());
    return values.flatMap((record, index) => record.kind === "design" && !record.archiveOf ? [{ key: keys[index],
      name: typeof record.document?.name === "string" ? record.document.name : "Untitled design", revision: record.document?.revision,
      savedAt: record.savedAt ?? record.document?.createdAt ?? 0,
      byteLength: Object.values(record.document?.assets ?? {}).reduce((sum, asset) => sum + (Number(asset.byteLength) || 0), 0) }] : [])
      .sort((a, b) => b.savedAt - a.savedAt);
  });
}

// An estimate for the import sheet. The write transaction remains authoritative
// because deduplication and writes from other tabs can change available space.
export function projectStorageBudget() {
  return transact("readonly", async (_records, assets) => {
    const stored = await result(assets.getAll());
    const usedBytes = stored.reduce((sum, asset) => sum + (asset.blob?.size ?? 0), 0);
    return { usedBytes, limitBytes: MAX_ASSET_BYTES, availableBytes: Math.max(0, MAX_ASSET_BYTES - usedBytes) };
  });
}

function clearProjectKind(kind) {
  const next = writes.catch(() => {}).then(() => transact("readwrite", async (records, assets) => {
    const values = await result(records.getAll()), keys = await result(records.getAllKeys());
    for (let index = 0; index < values.length; index++) if (values[index].kind === kind) records.delete(keys[index]);
    const remaining = values.filter((record) => record.kind !== kind);
    if (remaining.some((record) => !knownStoredRecord(record))) return;
    const keep = new Set(remaining.flatMap((record) => Object.values(record.document.assets).map((asset) => asset.sha256)));
    for (const hash of await result(assets.getAllKeys())) if (!keep.has(hash)) assets.delete(hash);
  }));
  writes = next; return next;
}

export function clearStoryProjects() { return clearProjectKind("story"); }
export function clearDesignProjects() { return clearProjectKind("design"); }

export function writeRecoveryProject(snapshot, key) {
  const next = writes.catch(() => {}).then(() => save(snapshot, key));
  writes = next;
  return next;
}

export async function readRecoveryProject(key) {
  const value = await transact("readonly", async (records, assets) => {
    const record = await result(records.get(key));
    if (!record) return null;
    if (record.kind === "story") throw new Error("Open this project in the story workspace.");
    if (record.kind === "design") throw new Error("Open this file in the design workspace.");
    if (record.kind != null) throw new Error("Unsupported recovery kind. Its original data has been preserved.");
    validateProject(record.document);
    assertEngineCompatibility(record.document, { allowLegacy: true });
    validateRecoveryEnvelope(record);
    const stored = [];
    for (const file of entriesFor(record.session)) stored.push(await result(assets.get(record.document.assets[file.assetId].sha256)));
    return { record, stored };
  });
  if (!value) return null;
  const { record, stored } = value;
  const snapshot = clone(record.session);
  snapshot.project = upgradeProjectRenderer(record.document);
  if (snapshot.kind === "batch") snapshot.projectRevision = snapshot.project.revision;
  for (const [index, file] of entriesFor(snapshot).entries()) {
    const asset = record.document.assets[file.assetId], saved = stored[index];
    if (!saved?.blob || saved.blob.size !== asset.byteLength) throw new Error("A project source is missing. The recovery document is preserved for backup.");
    file.bytes = await saved.blob.arrayBuffer();
    if (await hashAsset(file.bytes) !== asset.sha256) throw new Error("A saved source failed its integrity check. The recovery document is preserved for backup.");
    const operations = clone(record.document.nodes[file.nodeId].operations);
    if (snapshot.kind === "editor") file.operations = operations;
    else file.resolvedOperations = operations;
  }
  return snapshot;
}

export function clearRecoveryProject(key) {
  const next = writes.catch(() => {}).then(() => transact("readwrite", async (records, assets) => {
    records.delete(key);
    for (const storedKey of await result(records.getAllKeys())) {
      if (typeof storedKey === "string" && ["renderer-backup", "schema-backup"].some((kind) => storedKey.startsWith(`${key}:${kind}:`))) records.delete(storedKey);
    }
    const remaining = await result(records.getAll());
    // Unknown records may use asset references this version cannot interpret.
    // Preserve their assets until the owner explicitly clears every record.
    if (remaining.some((record) => !knownStoredRecord(record))) return;
    const keep = new Set(remaining.flatMap((record) => Object.values(record.document.assets).map((asset) => asset.sha256)));
    for (const hash of await result(assets.getAllKeys())) if (!keep.has(hash)) assets.delete(hash);
  }));
  writes = next;
  return next;
}

// Lossless backup of even unknown document versions. Binary assets are Blob
// parts, avoiding base64 expansion and huge JSON arrays of image bytes.
export async function exportRecoveryBackup(extras = {}) {
  const { records, assets } = await transact("readonly", async (records, assets) => ({
    records: await result(records.getAll()), assets: await result(assets.getAll()),
  }));
  const parts = new Map(assets.map((asset) => [asset.sha256, asset]));
  const extract = async (value) => {
    if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const view = ArrayBuffer.isView(value);
      const blob = value instanceof Blob ? value : new Blob([view ? value.buffer : value]);
      const sha256 = await hashAsset(await blob.arrayBuffer());
      parts.set(sha256, { sha256, blob });
      const reference = { binaryAsset: sha256, kind: value instanceof Blob ? "blob" : view ? "view" : "arraybuffer" };
      if (value instanceof Blob) reference.type = value.type;
      if (view) Object.assign(reference, { viewType: value.constructor.name, byteOffset: value.byteOffset, byteLength: value.byteLength });
      if (typeof File !== "undefined" && value instanceof File) Object.assign(reference, { kind: "file", name: value.name, lastModified: value.lastModified });
      return reference;
    }
    if (Array.isArray(value)) return Promise.all(value.map(extract));
    if (value && typeof value === "object") {
      const entries = [];
      for (const [key, child] of Object.entries(value)) entries.push([key, await extract(child)]);
      return Object.fromEntries(entries);
    }
    return value;
  };
  const extracted = await extract(extras);
  const binary = [...parts.values()];
  const header = new TextEncoder().encode(JSON.stringify({ format: "tiny-image-star/project-backup", version: 1,
    records, extras: extracted, assets: binary.map((asset) => ({ sha256: asset.sha256, size: asset.blob.size, type: asset.blob.type })) }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, header.length);
  return new Blob(["TSTAR1\n", length, header, ...binary.map((asset) => asset.blob)], { type: "application/octet-stream" });
}
