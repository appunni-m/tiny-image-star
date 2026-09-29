const DATABASE = 'local-studio-assets';
const VERSION = 1;
let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('This browser cannot save image files locally.')); return; }
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('images')) request.result.createObjectStore('images', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local image storage is unavailable.'));
    request.onblocked = () => reject(new Error('Close other Local Studio tabs to update image storage.'));
  });
  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Image storage request failed.'));
  });
}

export async function saveImageAsset(id, bytes, name, type) {
  const db = await openDatabase();
  const transaction = db.transaction('images', 'readwrite');
  transaction.objectStore('images').put({ id, name, type, bytes: bytes.slice().buffer });
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Could not save this image on the device.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not save this image on the device.'));
  });
}

export async function loadImageAsset(id) {
  const db = await openDatabase();
  const record = await requestResult(db.transaction('images').objectStore('images').get(id));
  return record ? { ...record, bytes: new Uint8Array(record.bytes) } : null;
}

export async function listImageAssetIds() {
  const db = await openDatabase();
  return requestResult(db.transaction('images').objectStore('images').getAllKeys());
}

export async function deleteImageAsset(id) {
  const db = await openDatabase();
  const transaction = db.transaction('images', 'readwrite');
  transaction.objectStore('images').delete(id);
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Could not remove this image from the device.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not remove this image from the device.'));
  });
}
