import { createId, walkNodes } from './model.js';
import { publishComponent, validateComponentLibrary } from './component-library.js';

const DB_NAME = 'figma-local-documents';
const COMPONENT_LIBRARY_DB_NAME = 'tiny-image-star-component-libraries';
const dbPromises = new Map();

function openDatabase(name = DB_NAME, storeNames = ['documents', 'assets']) {
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
    try { request = indexedDB.open(name); }
    catch (error) { fail(error); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of storeNames) {
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' });
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
  return openDatabase(COMPONENT_LIBRARY_DB_NAME, ['componentLibraries']);
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

/** Delete one saved design atomically. Asset rows are intentionally retained: v1 assets have no document ownership metadata. */
export async function deleteStoredDocument(id) {
  if (typeof id !== 'string' || !id) return false;
  const db = await openDatabase();
  const tx = db.transaction('documents', 'readwrite');
  const store = tx.objectStore('documents');
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
  const db = await openDatabase();
  const tx = db.transaction('assets', 'readwrite');
  tx.objectStore('assets').put({ id, name, type, bytes: bytes.slice().buffer });
  await transactionDone(tx);
}

/**
 * Import package assets without replacing an existing source image. Identical
 * bytes reuse the stored ID; an ID collision with different bytes gets a new
 * ID. All reads and writes share one readwrite transaction, so the collision
 * decision cannot race another tab and the entire import rolls back on error.
 */
export async function importLocalPackage(document, assets) {
  if (!document || typeof document.id !== 'string' || !document.id || !Array.isArray(document.pages)) {
    throw new TypeError('Local design package does not contain a valid design.');
  }
  if (!Array.isArray(assets)) throw new TypeError('Local design package assets must be a list.');
  const seen = new Set();
  for (const asset of assets) {
    if (!asset || typeof asset.id !== 'string' || !asset.id || seen.has(asset.id)
      || !(asset.bytes instanceof Uint8Array) || typeof asset.name !== 'string' || typeof asset.type !== 'string') {
      throw new TypeError('Local design package contains an invalid or duplicate image asset.');
    }
    seen.add(asset.id);
  }

  const db = await openDatabase();
  const tx = db.transaction(['assets', 'documents'], 'readwrite');
  const assetStore = tx.objectStore('assets');
  const documentStore = tx.objectStore('documents');
  const done = transactionDone(tx);
  const mappingPromise = new Promise((resolve, reject) => {
    const fail = error => {
      reject(error);
      try { tx.abort(); } catch { /* IndexedDB may already be aborting. */ }
    };
    const existing = new Array(assets.length);
    let existingDocument;
    let remaining = assets.length + 1;
    const prepareImport = () => {
      if (remaining !== 0) return;
      const mapping = new Map();
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
          assetStore.add({ id, name: assetToSave.name, type: assetToSave.type, bytes: source.slice().buffer });
          mapping.set(assetToSave.id, id);
        }
        for (const page of importedDocument.pages) {
          walkNodes(page.children || [], ({ node }) => {
            if (node.type === 'image' && mapping.has(node.assetId)) node.assetId = mapping.get(node.assetId);
            if (node.imageFill && mapping.has(node.imageFill.assetId)) node.imageFill.assetId = mapping.get(node.imageFill.assetId);
          });
        }
        documentStore.add({ id: importedDocument.id, savedAt: Date.now(), document: importedDocument });
        resolve({ document: importedDocument, assetIds: mapping });
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

export async function deleteImageAsset(id) {
  const db = await openDatabase();
  const tx = db.transaction('assets', 'readwrite');
  tx.objectStore('assets').delete(id);
  await transactionDone(tx);
}

export function packLocalPackage(design, assets) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: design.schema, document: design, assets: assets.map(({ id, name, type, bytes }) => ({ id, name, type, length: bytes.byteLength })) }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.length, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest];
  for (const asset of assets) parts.push(new Uint8Array(asset.bytes));
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const packed = new Uint8Array(total); let offset = 0;
  for (const part of parts) { packed.set(part, offset); offset += part.byteLength; }
  return packed;
}

export async function downloadLocalPackage(design, assets) {
  const bytes = packLocalPackage(design, assets);
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
  let offset = 11 + manifestLength;
  const assets = [];
  for (const entry of manifest.assets) {
    if (!entry.id || !Number.isSafeInteger(entry.length) || entry.length < 0 || offset + entry.length > bytes.length) throw new TypeError('Invalid local design package asset data.');
    assets.push({ id: entry.id, name: String(entry.name || 'image'), type: String(entry.type || 'application/octet-stream'), bytes: bytes.slice(offset, offset + entry.length) });
    offset += entry.length;
  }
  if (offset !== bytes.length) throw new TypeError('Invalid local design package: unexpected trailing data.');
  return { document: manifest.document, assets };
}
