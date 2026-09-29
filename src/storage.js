const DB_NAME = 'figma-local-documents';
const DB_VERSION = 1;
let dbPromise;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Local file storage is not available in this browser.')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local design storage.'));
    request.onblocked = () => reject(new Error('Close other design tabs before upgrading local storage.'));
  });
  return dbPromise;
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

export async function saveImageAsset(id, file) {
  return saveImageAssetBytes(id, file.name, file.type, new Uint8Array(await file.arrayBuffer()));
}

export async function saveImageAssetBytes(id, name, type, bytes) {
  const db = await openDatabase();
  const tx = db.transaction('assets', 'readwrite');
  tx.objectStore('assets').put({ id, name, type, bytes: bytes.slice().buffer });
  await transactionDone(tx);
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
