import { createId } from './model.js';
import { publishComponent, validateComponentLibrary } from './component-library.js';
import { inspectRasterDimensions } from './image-engine.js';
import { validateLocalFontAsset } from './font-assets.js';

const DB_NAME = 'figma-local-documents';
const COMPONENT_LIBRARY_DB_NAME = 'tiny-image-star-component-libraries';
const DB_VERSION = 5;
const COMPONENT_LIBRARY_DB_VERSION = 1;
export const MAX_LOCAL_DOCUMENT_VERSIONS = 30;
const ASSET_METADATA_MIGRATION_ID = 'legacy-assets-v1-migrated';
const FONT_METADATA_MIGRATION_ID = 'font-metadata-v1-migrated';
const dbPromises = new Map();
let assetMetadataMigrationPromise = null;
let fontMetadataMigrationPromise = null;

function openDatabase(name = DB_NAME, storeNames = ['documents', 'assets', 'assetMetadata', 'assetMetadataState', 'fontAssets', 'fontMetadata', 'fontMetadataState', 'versions'], version = DB_VERSION) {
  if (dbPromises.has(name)) return dbPromises.get(name);
  let resolveOpen;
  let rejectOpen;
  let settled = false;
  const pending = new Promise((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; });
  dbPromises.set(name, pending);

  const clearPending = () => {
    if (dbPromises.get(name) === pending) dbPromises.delete(name);
  };

  const fail = error => {
    if (settled) return;
    settled = true;
    rejectOpen(error);
  };
  const requestOpen = () => {
    if (!globalThis.indexedDB) {
      fail(new Error('Local file storage is not available in this browser.'));
      return;
    }

    let request;
    try { request = indexedDB.open(name, version); }
    catch (error) { fail(error); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of storeNames) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: 'id' });
          if (storeName === 'versions') store.createIndex('byDocument', 'documentId', { unique: false });
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // An open request can succeed after an earlier `blocked` event has
      // already rejected it. Do not leak a connection that nobody can use.
      if (settled) { db.close?.(); return; }
      settled = true;
      db.onversionchange = () => {
        // Let another tab perform its schema upgrade instead of keeping this
        // connection alive. Future operations will lazily open the new DB.
        db.close();
        clearPending();
      };
      resolveOpen(db);
    };
    request.onerror = () => fail(request.error || new Error('Could not open local design storage.'));
    request.onblocked = () => fail(new Error('Close other design tabs before upgrading local storage.'));
  };

  pending.then(() => {}, clearPending);
  requestOpen();
  return pending;
}

function openComponentLibraryDatabase() {
  return openDatabase(COMPONENT_LIBRARY_DB_NAME, ['componentLibraries'], COMPONENT_LIBRARY_DB_VERSION);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local storage request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Local storage write failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Local storage write was cancelled.'));
  });
}

function asBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function imageAssetMetadata(id, name, type, sourceBytes) {
  const bytes = asBytes(sourceBytes);
  const dimensions = bytes ? inspectRasterDimensions(bytes) : null;
  return {
    id,
    name: typeof name === 'string' ? name : '',
    type: typeof type === 'string' ? type : '',
    byteLength: bytes?.byteLength ?? 0,
    dimensions: dimensions ? { width: dimensions.width, height: dimensions.height, pixels: dimensions.pixels } : null
  };
}

function localFontMetadata(font) {
  const bytes = asBytes(font?.bytes);
  return {
    id: font.id,
    name: font.name,
    type: font.type,
    family: font.family,
    weight: font.weight,
    style: font.style,
    byteLength: bytes?.byteLength ?? 0
  };
}

function fontFaceKey(font) {
  return `${String(font?.family || '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()}\u0000${font?.weight}\u0000${font?.style}`;
}

/** Backfill a compact font catalog once without retaining every font buffer. */
function migrateFontMetadataOnce() {
  if (fontMetadataMigrationPromise) return fontMetadataMigrationPromise;
  const migration = (async () => {
    const db = await openDatabase();
    const tx = db.transaction(['fontAssets', 'fontMetadata', 'fontMetadataState'], 'readwrite');
    const done = transactionDone(tx);
    const metadataStore = tx.objectStore('fontMetadata');
    const stateStore = tx.objectStore('fontMetadataState');
    const stateRequest = stateStore.get(FONT_METADATA_MIGRATION_ID);
    stateRequest.onsuccess = () => {
      if (stateRequest.result?.complete === true) return;
      const cursorRequest = tx.objectStore('fontAssets').openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          stateStore.put({ id: FONT_METADATA_MIGRATION_ID, complete: true, completedAt: Date.now() });
          return;
        }
        const record = cursor.value;
        if (record && typeof record.id === 'string' && record.id) metadataStore.put(localFontMetadata(record));
        cursor.continue();
      };
    };
    await done;
  })();
  fontMetadataMigrationPromise = migration;
  migration.catch(() => {
    if (fontMetadataMigrationPromise === migration) fontMetadataMigrationPromise = null;
  });
  return migration;
}

/**
 * Backfill the lightweight metadata index once for databases created before
 * assetMetadata existed. A cursor visits one legacy asset at a time, so the
 * migration does not retain every original image buffer at once.
 */
function migrateAssetMetadataOnce() {
  if (assetMetadataMigrationPromise) return assetMetadataMigrationPromise;
  const migration = (async () => {
    const db = await openDatabase();
    const tx = db.transaction(['assets', 'assetMetadata', 'assetMetadataState'], 'readwrite');
    const done = transactionDone(tx);
    const metadataStore = tx.objectStore('assetMetadata');
    const stateStore = tx.objectStore('assetMetadataState');
    const stateRequest = stateStore.get(ASSET_METADATA_MIGRATION_ID);
    stateRequest.onsuccess = () => {
      if (stateRequest.result?.complete === true) return;
      const metadataToWrite = [];
      const cursorRequest = tx.objectStore('assets').openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          for (const metadata of metadataToWrite) metadataStore.put(metadata);
          stateStore.put({ id: ASSET_METADATA_MIGRATION_ID, complete: true, completedAt: Date.now() });
          return;
        }
        const record = cursor.value;
        if (!record || typeof record.id !== 'string' || !record.id) {
          cursor.continue();
          return;
        }
        const existingMetadata = metadataStore.get(record.id);
        existingMetadata.onsuccess = () => {
          if (!existingMetadata.result) {
            metadataToWrite.push(imageAssetMetadata(record.id, record.name, record.type, record.bytes));
          }
          cursor.continue();
        };
      };
    };
    await done;
  })();
  assetMetadataMigrationPromise = migration;
  migration.catch(() => {
    if (assetMetadataMigrationPromise === migration) assetMetadataMigrationPromise = null;
  });
  return migration;
}

export async function saveDocument(document) {
  const db = await openDatabase();
  const tx = db.transaction('documents', 'readwrite');
  tx.objectStore('documents').put({ id: document.id, savedAt: Date.now(), document });
  await transactionDone(tx);
}

export async function loadLatestDocument() {
  const db = await openDatabase();
  const records = await requestResult(db.transaction('documents').objectStore('documents').getAll());
  records.sort((a, b) => b.savedAt - a.savedAt);
  return records[0]?.document ?? null;
}

function versionOrder(left, right) {
  return (right.createdAt || 0) - (left.createdAt || 0) || String(right.id).localeCompare(String(left.id));
}

/** Save one local document snapshot and retain a bounded history per design. */
export async function saveDocumentVersion(document, { name = 'Autosaved version', force = false, limit = MAX_LOCAL_DOCUMENT_VERSIONS } = {}) {
  if (!document || typeof document.id !== 'string' || !document.id) throw new TypeError('A local version needs a saved design ID.');
  const versionName = String(name ?? '').trim().slice(0, 120) || 'Autosaved version';
  const keep = Math.max(1, Math.min(100, Math.floor(Number(limit) || MAX_LOCAL_DOCUMENT_VERSIONS)));
  const db = await openDatabase();
  const tx = db.transaction('versions', 'readwrite');
  const store = tx.objectStore('versions');
  const done = transactionDone(tx);
  const request = store.index('byDocument').getAll(document.id);
  let saved = null;
  request.onsuccess = () => {
    const versions = (Array.isArray(request.result) ? request.result : []).sort(versionOrder);
    const snapshot = structuredClone(document);
    const latest = versions[0];
    if (!force && latest && JSON.stringify(latest.document) === JSON.stringify(snapshot)) return;
    const record = { id: createId('version'), documentId: document.id, name: versionName, createdAt: Date.now(), document: snapshot };
    store.put(record);
    for (const stale of [...versions, record].sort(versionOrder).slice(keep)) store.delete(stale.id);
    saved = { id: record.id, documentId: record.documentId, name: record.name, createdAt: record.createdAt };
  };
  await done;
  return saved;
}

/** List local version summaries without returning the saved document trees. */
export async function listDocumentVersions(documentId) {
  if (typeof documentId !== 'string' || !documentId) return [];
  const db = await openDatabase();
  const records = await requestResult(db.transaction('versions').objectStore('versions').index('byDocument').getAll(documentId));
  return records.sort(versionOrder).map(({ id, documentId: ownerId, name, createdAt }) => ({
    id,
    documentId: ownerId,
    name: typeof name === 'string' ? name : 'Saved version',
    createdAt: Number.isFinite(createdAt) ? createdAt : 0
  }));
}

/** Read one retained snapshot and optionally fence it to its owning design ID. */
export async function loadDocumentVersion(versionId, documentId = null) {
  if (typeof versionId !== 'string' || !versionId) return null;
  const db = await openDatabase();
  const record = await requestResult(db.transaction('versions').objectStore('versions').get(versionId));
  if (!record?.document || (documentId != null && record.documentId !== documentId)) return null;
  return structuredClone(record);
}

/** Return document-library rows without loading every design tree into the UI. */
export async function listSavedDocuments() {
  const db = await openDatabase();
  const records = await requestResult(db.transaction('documents').objectStore('documents').getAll());
  return records
    .filter(record => record?.document && typeof record.id === 'string')
    .map(({ id, savedAt, document }) => ({
      id,
      name: typeof document.name === 'string' && document.name.trim() ? document.name : 'Untitled',
      savedAt: Number.isFinite(savedAt) ? savedAt : 0
    }))
    .sort((left, right) => right.savedAt - left.savedAt || left.name.localeCompare(right.name));
}

/** Retrieve one saved local design by its stable document ID. */
export async function loadDocumentById(id) {
  if (typeof id !== 'string' || !id) return null;
  const db = await openDatabase();
  const record = await requestResult(db.transaction('documents').objectStore('documents').get(id));
  return record?.document ?? null;
}

/** Rename a saved document. Returns false when the requested ID is absent. */
export async function renameStoredDocument(id, name) {
  const nextName = String(name ?? '').trim();
  if (!nextName || nextName.length > 120) throw new TypeError('A design name must contain 1–120 characters.');
  const db = await openDatabase();
  const tx = db.transaction('documents', 'readwrite');
  const store = tx.objectStore('documents');
  let found = false;
  const done = transactionDone(tx);
  const request = store.get(id);
  request.onsuccess = () => {
    const existing = request.result;
    if (!existing?.document) return;
    found = true;
    store.put({ ...existing, savedAt: Date.now(), document: { ...existing.document, name: nextName } });
  };
  await done;
  return found;
}

/** Duplicate a saved design under a new document ID while retaining its local asset references. */
export async function duplicateStoredDocument(id, name = null) {
  if (name != null && (!String(name).trim() || String(name).trim().length > 120)) throw new TypeError('A design name must contain 1–120 characters.');
  const db = await openDatabase();
  const tx = db.transaction('documents', 'readwrite');
  const store = tx.objectStore('documents');
  let duplicate = null;
  const done = transactionDone(tx);
  const request = store.get(id);
  request.onsuccess = () => {
    const existing = request.result;
    if (!existing?.document) return;
    duplicate = structuredClone(existing.document);
    duplicate.id = createId('file');
    const suggestedName = `${String(duplicate.name || 'Untitled').slice(0, 114)} copy`;
    duplicate.name = name == null ? suggestedName : String(name).trim();
    store.put({ id: duplicate.id, savedAt: Date.now(), document: duplicate });
  };
  await done;
  return duplicate && structuredClone(duplicate);
}

/** Delete a saved design and its local versions atomically; shared asset rows remain owned by the local library. */
export async function deleteStoredDocument(id) {
  if (typeof id !== 'string' || !id) return false;
  const db = await openDatabase();
  const tx = db.transaction(['documents', 'versions'], 'readwrite');
  const store = tx.objectStore('documents');
  const versions = tx.objectStore('versions');
  let found = false;
  const done = transactionDone(tx);
  const request = store.get(id);
  request.onsuccess = () => {
    if (!request.result) return;
    found = true;
    store.delete(id);
    const versionRequest = versions.index('byDocument').getAll(id);
    versionRequest.onsuccess = () => {
      for (const version of versionRequest.result || []) versions.delete(version.id);
    };
  };
  await done;
  return found;
}

function validComponentLibraryId(id) {
  return typeof id === 'string' && id.trim() === id && id.length > 0 && id.length <= 200;
}

function validateStoredComponentLibrary(record) {
  if (!record || typeof record !== 'object' || !record.library || typeof record.id !== 'string') {
    throw new TypeError('Stored component library record is invalid.');
  }
  validateComponentLibrary(record.library);
  if (record.id !== record.library.id || record.name !== record.library.name || record.revision !== record.library.revision) {
    throw new TypeError('Stored component library metadata does not match its snapshot.');
  }
  return record.library;
}

function referencedPackageAssetIds(document) {
  if (!document || !Array.isArray(document.pages) || !document.pages.length) {
    throw new TypeError('Local design package does not contain a valid design.');
  }
  const references = new Set();
  const visited = new WeakSet();
  const visitNode = node => {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (node.type === 'image' && typeof node.assetId === 'string' && node.assetId) references.add(node.assetId);
    if (typeof node.imageFill?.assetId === 'string' && node.imageFill.assetId) references.add(node.imageFill.assetId);
    if (Array.isArray(node.fills)) {
      for (const fill of node.fills) {
        if (fill.type === 'image' && typeof fill.imageFill?.assetId === 'string' && fill.imageFill.assetId) references.add(fill.imageFill.assetId);
      }
    }
    for (const child of node.children || []) visitNode(child);
    const linkedComponent = node.linkedComponent;
    visitNode(linkedComponent?.sourceSnapshot?.root);
    visitNode(linkedComponent?.root);
  };
  for (const page of document.pages) {
    if (!page || !Array.isArray(page.children)) throw new TypeError('Local design package contains an invalid page.');
    for (const node of page.children) visitNode(node);
  }
  return references;
}

/** Walk regular page layers and both frozen/resolved linked-component trees. */
function visitPackageNodes(nodes, visitor, visited = new WeakSet()) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);
    visitor(node);
    visitPackageNodes(node.children, visitor, visited);
    const linkedComponent = node.linkedComponent;
    visitPackageNodes(linkedComponent?.sourceSnapshot?.root ? [linkedComponent.sourceSnapshot.root] : [], visitor, visited);
    visitPackageNodes(linkedComponent?.root ? [linkedComponent.root] : [], visitor, visited);
  }
}

function remapPackageNodeAssets(node, mapping) {
  if (node.type === 'image' && mapping.has(node.assetId)) node.assetId = mapping.get(node.assetId);
  if (node.imageFill && mapping.has(node.imageFill.assetId)) node.imageFill.assetId = mapping.get(node.imageFill.assetId);
  const remapFills = fills => {
    if (!Array.isArray(fills)) return;
    for (const fill of fills) {
      if (fill?.type === 'image' && fill.imageFill && mapping.has(fill.imageFill.assetId)) {
        fill.imageFill.assetId = mapping.get(fill.imageFill.assetId);
      }
    }
  };
  remapFills(node.fills);
  for (const overrides of Object.values(node.componentOverrides || {})) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) continue;
    if (overrides.imageFill && mapping.has(overrides.imageFill.assetId)) {
      overrides.imageFill.assetId = mapping.get(overrides.imageFill.assetId);
    }
    remapFills(overrides.fills);
  }
}

function assertPackageAssetReferences(document, assets) {
  const available = new Set();
  for (const asset of assets) {
    if (!asset || typeof asset.id !== 'string' || !asset.id || available.has(asset.id)) {
      throw new TypeError('Local design package contains an invalid or duplicate image asset.');
    }
    available.add(asset.id);
  }
  for (const assetId of referencedPackageAssetIds(document)) {
    if (!available.has(assetId)) {
      throw new TypeError(`The design references image source “${assetId}”, but its bytes are missing. Restore the source image and try again.`);
    }
  }
}

function validatePackageFonts(fonts) {
  if (!Array.isArray(fonts)) throw new TypeError('Local design package fonts must be a list.');
  const seen = new Set();
  const faces = new Set();
  return fonts.map(source => {
    let font;
    try { font = validateLocalFontAsset(source); }
    catch (error) { throw new TypeError(`Local design package contains an invalid font: ${error.message}`); }
    if (seen.has(font.id)) throw new TypeError('Local design package contains a duplicate font asset ID.');
    seen.add(font.id);
    const faceKey = fontFaceKey(font);
    if (faces.has(faceKey)) throw new TypeError(`Local design package contains duplicate ${font.weight} ${font.style} faces for “${font.family}”.`);
    faces.add(faceKey);
    return font;
  });
}

function fontBytesEqual(left, right) {
  const a = left?.bytes ? new Uint8Array(left.bytes) : null;
  const b = right?.bytes ? new Uint8Array(right.bytes) : null;
  return Boolean(a && b && a.byteLength === b.byteLength && a.every((value, index) => value === b[index]));
}

function importFontFamilyAliases(fonts, existingFonts, existingFontAssetsById) {
  const existing = new Set(existingFonts.map(font => String(font?.family || '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()));
  const renames = new Map();
  for (const font of fonts) {
    if (renames.has(font.family)) continue;
    const conflict = existingFonts.some(candidate => fontFaceKey(candidate) === fontFaceKey(font)
      && !fontBytesEqual(existingFontAssetsById.get(candidate.id), { bytes: font.bytes.buffer }));
    if (!conflict) continue;
    let suffix = 1;
    let alias;
    do { alias = `${font.family} Imported${suffix === 1 ? '' : ` ${suffix}`}`; suffix += 1; }
    while (existing.has(alias.trim().replace(/\s+/gu, ' ').toLocaleLowerCase()));
    existing.add(alias.trim().replace(/\s+/gu, ' ').toLocaleLowerCase());
    renames.set(font.family, alias);
  }
  return renames;
}

function splitFontFamilyStack(value) {
  const parts = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  const source = String(value || '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ',') {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function normalizeFontFamilyToken(token) {
  let value = String(token || '').trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
    value = value.slice(1, -1).replace(/\\(["'\\])/gu, '$1');
  }
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function remapFontFamilyStack(value, aliases) {
  const aliasesByName = new Map([...aliases].map(([family, alias]) => [normalizeFontFamilyToken(family), alias]));
  return splitFontFamilyStack(value).map(token => {
    const alias = aliasesByName.get(normalizeFontFamilyToken(token));
    if (!alias) return token;
    const leading = token.match(/^\s*/u)?.[0] || '';
    const trailing = token.match(/\s*$/u)?.[0] || '';
    const trimmed = token.trim();
    const quote = trimmed[0];
    if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
      const escaped = [...alias].map(character => character === '\\' || character === quote ? `\\${character}` : character).join('');
      return `${leading}${quote}${escaped}${quote}${trailing}`;
    }
    return `${leading}${alias}${trailing}`;
  }).join(',');
}

function remapDocumentFontFamilies(document, aliases) {
  if (!aliases.size) return;
  const visited = new WeakSet();
  const visit = value => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'fontFamily' && typeof child === 'string') {
        if (aliases.has(child)) value[key] = aliases.get(child);
        else value[key] = remapFontFamilyStack(child, aliases);
      } else visit(child);
    }
  };
  visit(document);
}

/** Persist one validated component-library snapshot without retaining caller-owned objects. */
export async function saveComponentLibrary(library) {
  const snapshot = structuredClone(library);
  validateComponentLibrary(snapshot);
  const record = {
    id: snapshot.id,
    name: snapshot.name,
    revision: snapshot.revision,
    savedAt: Date.now(),
    library: snapshot
  };
  const db = await openComponentLibraryDatabase();
  const tx = db.transaction('componentLibraries', 'readwrite');
  tx.objectStore('componentLibraries').put(structuredClone(record));
  await transactionDone(tx);
}

/** Publish against the latest on-device library revision in one serialized write transaction. */
export async function publishStoredComponent(libraryId, component) {
  if (!validComponentLibraryId(libraryId)) throw new TypeError('A valid local component library ID is required.');
  const db = await openComponentLibraryDatabase();
  const tx = db.transaction('componentLibraries', 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore('componentLibraries');
  let result = null;
  let operationError = null;
  const request = store.get(libraryId);
  request.onsuccess = () => {
    try {
      const current = validateStoredComponentLibrary(request.result);
      const published = publishComponent(current, component);
      const library = structuredClone(published.library);
      store.put({
        id: library.id,
        name: library.name,
        revision: library.revision,
        savedAt: Date.now(),
        library
      });
      result = { library, publication: structuredClone(published.publication) };
    } catch (error) {
      operationError = error;
      tx.abort();
    }
  };
  try { await done; }
  catch (error) { throw operationError || error; }
  if (!result) throw new Error('The local component publication did not complete.');
  return result;
}

/** Load and validate one saved component library, returning a defensive copy. */
export async function loadComponentLibrary(id) {
  if (!validComponentLibraryId(id)) return null;
  const db = await openComponentLibraryDatabase();
  const record = await requestResult(db.transaction('componentLibraries').objectStore('componentLibraries').get(id));
  if (!record) return null;
  return structuredClone(validateStoredComponentLibrary(record));
}

/** Return validated component-library summaries without loading records into UI state by reference. */
export async function listComponentLibraries() {
  const db = await openComponentLibraryDatabase();
  const records = await requestResult(db.transaction('componentLibraries').objectStore('componentLibraries').getAll());
  const summaries = [];
  for (const record of records) {
    try {
      const library = validateStoredComponentLibrary(record);
      summaries.push({
        id: library.id,
        name: library.name,
        revision: library.revision,
        savedAt: Number.isFinite(record.savedAt) ? record.savedAt : 0
      });
    } catch (error) {
      // A damaged record should not hide healthy libraries or prevent edits in
      // the active design. The bad entry remains isolated for recovery tools.
      console.warn('Skipping invalid local component library record', record?.id, error);
    }
  }
  return summaries.sort((left, right) => right.savedAt - left.savedAt || left.name.localeCompare(right.name));
}

/** Delete one component library by stable ID; returns false when no record exists. */
export async function deleteComponentLibrary(id) {
  if (!validComponentLibraryId(id)) return false;
  const db = await openComponentLibraryDatabase();
  const tx = db.transaction('componentLibraries', 'readwrite');
  const store = tx.objectStore('componentLibraries');
  let found = false;
  const done = transactionDone(tx);
  const request = store.get(id);
  request.onsuccess = () => {
    if (!request.result) return;
    found = true;
    store.delete(id);
  };
  await done;
  return found;
}

export async function saveImageAsset(id, file) {
  return saveImageAssetBytes(id, file.name, file.type, new Uint8Array(await file.arrayBuffer()));
}

export async function saveImageAssetBytes(id, name, type, bytes) {
  if (typeof id !== 'string' || !id || !(bytes instanceof Uint8Array)
    || typeof name !== 'string' || typeof type !== 'string') {
    throw new TypeError('A saved image asset needs an ID, name, MIME type, and byte data.');
  }
  await migrateAssetMetadataOnce();
  const db = await openDatabase();
  const tx = db.transaction(['assets', 'assetMetadata'], 'readwrite');
  const copy = bytes.slice();
  tx.objectStore('assets').put({ id, name, type, bytes: copy.buffer });
  tx.objectStore('assetMetadata').put(imageAssetMetadata(id, name, type, copy));
  await transactionDone(tx);
}

/** Save a validated local font face without copying its bytes into a design tree. */
export async function saveFontAsset(asset) {
  const font = validateLocalFontAsset(asset);
  await migrateFontMetadataOnce();
  const db = await openDatabase();
  const tx = db.transaction(['fontAssets', 'fontMetadata'], 'readwrite');
  const done = transactionDone(tx);
  const binaries = tx.objectStore('fontAssets');
  const metadataStore = tx.objectStore('fontMetadata');
  let operationError = null;
  const request = metadataStore.getAll();
  request.onsuccess = () => {
    try {
      const current = request.result || [];
      if (current.some(record => record.id === font.id)) throw new TypeError('A local font with this ID is already installed.');
      if (current.some(record => fontFaceKey(record) === fontFaceKey(font))) {
        throw new TypeError(`A ${font.weight} ${font.style} face for “${font.family}” is already installed.`);
      }
      binaries.add({ ...localFontMetadata(font), bytes: font.bytes.slice().buffer });
      metadataStore.add(localFontMetadata(font));
    } catch (error) {
      operationError = error;
      try { tx.abort(); } catch { /* The transaction may already be aborting. */ }
    }
  };
  try { await done; }
  catch (error) { throw operationError || error; }
  if (operationError) throw operationError;
  const { bytes: _bytes, ...fontRecord } = font;
  return fontRecord;
}

/** Return local font metadata without reading font binaries. */
export async function listFontAssets() {
  await migrateFontMetadataOnce();
  const db = await openDatabase();
  const records = await requestResult(db.transaction('fontMetadata').objectStore('fontMetadata').getAll());
  return records
    .filter(record => record && typeof record.id === 'string')
    .map(({ id, name, type, family, weight, style, byteLength }) => ({ id, name, type, family, weight, style, byteLength }))
    .sort((left, right) => left.family.localeCompare(right.family) || left.weight - right.weight || left.style.localeCompare(right.style) || left.name.localeCompare(right.name));
}

/** Retrieve one font binary for FontFace loading or a portable design export. */
export async function loadFontAsset(id) {
  if (typeof id !== 'string' || !id) return null;
  const db = await openDatabase();
  const record = await requestResult(db.transaction('fontAssets').objectStore('fontAssets').get(id));
  if (!record) return null;
  try { return validateLocalFontAsset({ ...record, bytes: record.bytes }); }
  catch { return null; }
}

/** Remove one local font face; design text retains its family name and falls back. */
export async function deleteFontAsset(id) {
  if (typeof id !== 'string' || !id) return false;
  await migrateFontMetadataOnce();
  const db = await openDatabase();
  const tx = db.transaction(['fontAssets', 'fontMetadata'], 'readwrite');
  const store = tx.objectStore('fontAssets');
  const metadata = tx.objectStore('fontMetadata');
  let found = false;
  const done = transactionDone(tx);
  const request = metadata.get(id);
  request.onsuccess = () => {
    if (!request.result) return;
    found = true;
    store.delete(id);
    metadata.delete(id);
  };
  await done;
  return found;
}

/**
 * Import package assets without replacing an existing source image. Identical
 * bytes reuse the stored ID; an ID collision with different bytes gets a new
 * ID. All reads and writes share one readwrite transaction, so the collision
 * decision cannot race another tab and the entire import rolls back on error.
 */
export async function importLocalPackage(document, assets, fonts = []) {
  if (!document || typeof document.id !== 'string' || !document.id || !Array.isArray(document.pages)) {
    throw new TypeError('Local design package does not contain a valid design.');
  }
  if (!Array.isArray(assets)) throw new TypeError('Local design package assets must be a list.');
  const packageFonts = validatePackageFonts(fonts);
  assertPackageAssetReferences(document, assets);
  const seen = new Set();
  for (const asset of assets) {
    if (!asset || typeof asset.id !== 'string' || !asset.id || seen.has(asset.id)
      || !(asset.bytes instanceof Uint8Array) || typeof asset.name !== 'string' || typeof asset.type !== 'string') {
      throw new TypeError('Local design package contains an invalid or duplicate image asset.');
    }
    seen.add(asset.id);
  }

  await Promise.all([migrateAssetMetadataOnce(), migrateFontMetadataOnce()]);
  const db = await openDatabase();
  const tx = db.transaction(['assets', 'assetMetadata', 'documents', 'fontAssets', 'fontMetadata'], 'readwrite');
  const assetStore = tx.objectStore('assets');
  const metadataStore = tx.objectStore('assetMetadata');
  const documentStore = tx.objectStore('documents');
  const fontStore = tx.objectStore('fontAssets');
  const fontMetadataStore = tx.objectStore('fontMetadata');
  const done = transactionDone(tx);
  const mappingPromise = new Promise((resolve, reject) => {
    const fail = error => {
      reject(error);
      try { tx.abort(); } catch { /* IndexedDB may already be aborting. */ }
    };
    const existing = new Array(assets.length);
    const existingFontAssets = new Array(packageFonts.length);
    const existingFontAssetRecords = new Map();
    let existingFontRecords = [];
    let existingDocument;
    let remaining = assets.length + packageFonts.length + 2;
    const prepareImport = () => {
      if (remaining !== 0) return;
      const mapping = new Map();
      const fontMapping = new Map();
      const reserved = new Set(seen);
      const importedDocument = structuredClone(document);
      if (existingDocument) importedDocument.id = createId('file');
      try {
        for (let itemIndex = 0; itemIndex < assets.length; itemIndex += 1) {
          const assetToSave = assets[itemIndex];
          const stored = existing[itemIndex];
          const source = assetToSave.bytes;
          const storedBytes = stored?.bytes ? new Uint8Array(stored.bytes) : null;
          const identical = storedBytes && storedBytes.byteLength === source.byteLength
            && storedBytes.every((value, byteIndex) => value === source[byteIndex]);
          if (stored && identical) {
            mapping.set(assetToSave.id, assetToSave.id);
            continue;
          }
          let id = assetToSave.id;
          if (stored) {
            do { id = createId('asset'); } while (reserved.has(id));
          }
          reserved.add(id);
          const assetBytes = source.slice();
          assetStore.add({ id, name: assetToSave.name, type: assetToSave.type, bytes: assetBytes.buffer });
          metadataStore.put(imageAssetMetadata(id, assetToSave.name, assetToSave.type, assetBytes));
          mapping.set(assetToSave.id, id);
        }
        const familyAliases = importFontFamilyAliases(packageFonts, existingFontRecords, existingFontAssetRecords);
        remapDocumentFontFamilies(importedDocument, familyAliases);
        const reservedFonts = new Set([...packageFonts.map(font => font.id), ...existingFontRecords.map(font => font.id)]);
        for (let itemIndex = 0; itemIndex < packageFonts.length; itemIndex += 1) {
          const source = packageFonts[itemIndex];
          const importedFamily = familyAliases.get(source.family) || source.family;
          const stored = existingFontAssets[itemIndex];
          const identicalFace = existingFontRecords.find(candidate => fontFaceKey(candidate) === fontFaceKey({ ...source, family: importedFamily })
            && candidate.type === source.type
            && fontBytesEqual(existingFontAssetRecords.get(candidate.id), { bytes: source.bytes.buffer }));
          if (identicalFace) {
            fontMapping.set(source.id, identicalFace.id);
            continue;
          }
          let id = source.id;
          if (stored) {
            do { id = createId('font'); } while (reservedFonts.has(id));
          }
          reservedFonts.add(id);
          const fontBytes = source.bytes.slice();
          const importedFont = {
            id, name: source.name, type: source.type, family: importedFamily,
            weight: source.weight, style: source.style, bytes: fontBytes.buffer
          };
          fontStore.add(importedFont);
          fontMetadataStore.add(localFontMetadata(importedFont));
          fontMapping.set(source.id, id);
        }
        for (const page of importedDocument.pages) {
          visitPackageNodes(page.children || [], node => remapPackageNodeAssets(node, mapping));
        }
        documentStore.add({ id: importedDocument.id, savedAt: Date.now(), document: importedDocument });
        resolve({ document: importedDocument, assetIds: mapping, fontIds: fontMapping, fontFamilies: familyAliases });
      } catch (error) {
        fail(error);
      }
    };
    const documentRequest = documentStore.get(document.id);
    documentRequest.onsuccess = () => { existingDocument = documentRequest.result; remaining -= 1; prepareImport(); };
    documentRequest.onerror = () => fail(documentRequest.error || new Error('Could not check the local design library.'));
    for (const [index, asset] of assets.entries()) {
      const request = assetStore.get(asset.id);
      request.onsuccess = () => {
        existing[index] = request.result;
        remaining -= 1;
        prepareImport();
      };
      request.onerror = () => fail(request.error || new Error('Could not check imported image assets.'));
    }
    const fontsRequest = fontMetadataStore.getAll();
    fontsRequest.onsuccess = () => {
      existingFontRecords = fontsRequest.result || [];
      const relevantKeys = new Set(packageFonts.map(fontFaceKey));
      const candidates = existingFontRecords.filter(record => relevantKeys.has(fontFaceKey(record)));
      const candidatesById = new Map(candidates.map(record => [record.id, record]));
      for (const record of existingFontAssetRecords.values()) candidatesById.set(record.id, record);
      const toLoad = [...candidatesById.keys()];
      remaining += toLoad.length;
      remaining -= 1;
      prepareImport();
      for (const id of toLoad) {
        const request = fontStore.get(id);
        request.onsuccess = () => {
          existingFontAssetRecords.set(id, request.result);
          remaining -= 1;
          prepareImport();
        };
        request.onerror = () => fail(request.error || new Error('Could not inspect a matching local font face.'));
      }
    };
    fontsRequest.onerror = () => fail(fontsRequest.error || new Error('Could not check local font assets.'));
    for (const [index, font] of packageFonts.entries()) {
      const request = fontStore.get(font.id);
      request.onsuccess = () => {
        existingFontAssets[index] = request.result;
        if (request.result) existingFontAssetRecords.set(request.result.id, request.result);
        remaining -= 1;
        prepareImport();
      };
      request.onerror = () => fail(request.error || new Error('Could not check imported font assets.'));
    }
  });
  try {
    const imported = await mappingPromise;
    await done;
    return imported;
  } catch (error) {
    await done.catch(() => {});
    throw error;
  }
}

export async function loadImageAsset(id) {
  const db = await openDatabase();
  return requestResult(db.transaction('assets').objectStore('assets').get(id));
}

/**
 * Load an image's compact catalog metadata without retrieving its source bytes.
 * Legacy records are backfilled once on the first metadata-aware operation.
 */
export async function loadImageAssetMetadata(id) {
  if (typeof id !== 'string' || !id) return null;
  await migrateAssetMetadataOnce();
  const db = await openDatabase();
  const record = await requestResult(db.transaction('assetMetadata').objectStore('assetMetadata').get(id));
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    byteLength: record.byteLength,
    dimensions: record.dimensions ? { ...record.dimensions } : null
  };
}

export async function deleteImageAsset(id) {
  await migrateAssetMetadataOnce();
  const db = await openDatabase();
  const tx = db.transaction(['assets', 'assetMetadata'], 'readwrite');
  tx.objectStore('assets').delete(id);
  tx.objectStore('assetMetadata').delete(id);
  await transactionDone(tx);
}

export function packLocalPackage(design, assets, fonts = []) {
  if (!Array.isArray(assets)) throw new TypeError('Local design package assets must be a list.');
  const packageAssets = assets.map(asset => {
    if (!asset || typeof asset.id !== 'string' || !asset.id || typeof asset.name !== 'string' || typeof asset.type !== 'string') {
      throw new TypeError('Local design package contains an invalid image asset.');
    }
    const bytes = asset.bytes instanceof Uint8Array
      ? asset.bytes
      : asset.bytes instanceof ArrayBuffer
        ? new Uint8Array(asset.bytes)
        : ArrayBuffer.isView(asset.bytes)
          ? new Uint8Array(asset.bytes.buffer, asset.bytes.byteOffset, asset.bytes.byteLength)
          : null;
    if (!bytes) throw new TypeError(`The image source “${asset.id}” has no readable bytes. Restore the source image and try again.`);
    return { id: asset.id, name: asset.name, type: asset.type, bytes };
  });
  const packageFonts = validatePackageFonts(fonts);
  assertPackageAssetReferences(design, packageAssets);
  const manifest = new TextEncoder().encode(JSON.stringify({
    schema: design.schema,
    document: design,
    assets: packageAssets.map(({ id, name, type, bytes }) => ({ id, name, type, length: bytes.byteLength })),
    fonts: packageFonts.map(({ id, name, type, family, weight, style, bytes }) => ({ id, name, type, family, weight, style, length: bytes.byteLength }))
  }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.length, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest];
  for (const asset of packageAssets) parts.push(asset.bytes);
  for (const font of packageFonts) parts.push(font.bytes);
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const packed = new Uint8Array(total); let offset = 0;
  for (const part of parts) { packed.set(part, offset); offset += part.byteLength; }
  return packed;
}

export async function downloadLocalPackage(design, assets, fonts = []) {
  const bytes = packLocalPackage(design, assets, fonts);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const anchor = Object.assign(globalThis.document.createElement('a'), { href: url, download: `${design.name || 'design'}.flocal` });
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function unpackLocalPackage(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const magic = [70, 76, 79, 67, 65, 76, 1];
  if (bytes.length < 11 || magic.some((value, index) => bytes[index] !== value)) throw new TypeError('Invalid local design package.');
  const manifestLength = new DataView(bytes.buffer, bytes.byteOffset + 7, 4).getUint32(0, true);
  if (manifestLength > bytes.length - 11) throw new TypeError('Invalid local design package manifest.');
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(11, 11 + manifestLength))); }
  catch { throw new TypeError('Invalid local design package manifest.'); }
  if (manifest.schema !== 'figma-local/1' || !manifest.document || !Array.isArray(manifest.assets)) throw new TypeError('Unsupported local design package.');
  if (manifest.fonts !== undefined && !Array.isArray(manifest.fonts)) throw new TypeError('Invalid local design package font manifest.');
  let offset = 11 + manifestLength;
  const assets = [];
  const seen = new Set();
  for (const entry of manifest.assets) {
    if (!entry || typeof entry.id !== 'string' || !entry.id
      || !Number.isSafeInteger(entry.length) || entry.length < 0 || offset + entry.length > bytes.length) {
      throw new TypeError('Invalid local design package asset data.');
    }
    if (seen.has(entry.id)) throw new TypeError('Invalid local design package: duplicate image asset ID.');
    assets.push({ id: entry.id, name: String(entry.name || 'image'), type: String(entry.type || 'application/octet-stream'), bytes: bytes.slice(offset, offset + entry.length) });
    seen.add(entry.id);
    offset += entry.length;
  }
  const fonts = [];
  const seenFontIds = new Set();
  for (const entry of manifest.fonts || []) {
    if (!entry || typeof entry.id !== 'string' || !entry.id
      || !Number.isSafeInteger(entry.length) || entry.length < 0 || offset + entry.length > bytes.length) {
      throw new TypeError('Invalid local design package font data.');
    }
    if (seenFontIds.has(entry.id)) throw new TypeError('Invalid local design package: duplicate font asset ID.');
    const fontBytes = bytes.slice(offset, offset + entry.length);
    let font;
    try {
      font = validateLocalFontAsset({
        id: entry.id,
        name: String(entry.name || 'font.woff2'),
        type: String(entry.type || 'application/octet-stream'),
        family: entry.family,
        weight: entry.weight,
        style: entry.style,
        bytes: fontBytes
      });
    } catch (error) {
      throw new TypeError(`Invalid local design package font: ${error.message}`);
    }
    fonts.push(font);
    seenFontIds.add(entry.id);
    offset += entry.length;
  }
  if (offset !== bytes.length) throw new TypeError('Invalid local design package: unexpected trailing data.');
  assertPackageAssetReferences(manifest.document, assets);
  validatePackageFonts(fonts);
  return { document: manifest.document, assets, fonts };
}
