// Local font files stay on this device. The editor never fetches a font from a
// website on the user's behalf, which keeps the font workflow compatible with
// the app's offline/private promise.

import { MAX_FONT_BYTES, MAX_TEXT_FONT_BYTES, fontDigest, loadFontFace, verifyFontRecord, textError, textFontRequirements } from "../compositor/fonts.js";
export { BUILTIN_FONTS, builtinFontById, fontRecordForLayer } from "../compositor/fonts.js";

const FONT_DB_NAME = "tiny-image-star-fonts";
const FONT_DB_VERSION = 1;
const FONT_STORE_NAME = "fonts";
const loadedFonts = new Map();

function rememberLoadedFont(record) {
  const previous = loadedFonts.get(record.id);
  if (previous?.face && previous.face !== record.face) (globalThis.document?.fonts ?? globalThis.fonts)?.delete(previous.face);
  loadedFonts.set(record.id, record);
  return record;
}

// Active edits keep their fonts after clearing saved data. Copy only the
// referenced assets, and only when the shared scheduler admits the image.
export function copyLoadedFonts(layers) {
  const records = [], transfer = [];
  let total = 0;
  for (const requirement of textFontRequirements(layers ?? []).required.values()) {
    const record = loadedFonts.get(requirement.id);
    if (!record) continue;
    if (record.bytes.byteLength > requirement.bytes) throw textError("A font exceeds its processing memory budget. Add it again.", "font-limit");
    total += record.bytes.byteLength;
    if (total > MAX_TEXT_FONT_BYTES) throw textError("The fonts in this edit exceed the 32 MiB font limit.", "font-limit");
    const bytes = record.bytes.slice(0);
    records.push({ id: record.id, family: record.family, sha256: record.sha256, bytes });
    transfer.push(bytes);
  }
  return { records, transfer };
}

function bytesBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return null;
}

function openFontDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FONT_DB_NAME, FONT_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(FONT_STORE_NAME)) request.result.createObjectStore(FONT_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local font storage is unavailable."));
  });
}

async function saveFontRecord(record) {
  try {
    const database = await openFontDatabase();
    if (!database) return false;
    return await new Promise((resolve) => {
      const transaction = database.transaction(FONT_STORE_NAME, "readwrite");
      transaction.objectStore(FONT_STORE_NAME).put({
        id: record.id,
        name: record.name,
        fileName: record.fileName,
        family: record.family,
        bytes: bytesBuffer(record.bytes),
        sha256: record.sha256,
        byteLength: record.bytes.byteLength,
      });
      transaction.oncomplete = () => {
        database.close();
        resolve(true);
      };
      transaction.onerror = () => {
        database.close();
        resolve(false);
      };
      transaction.onabort = () => {
        database.close();
        resolve(false);
      };
    });
  } catch {
    return false;
  }
}

export async function readFontRecords({ strict = false } = {}) {
  try {
    const database = await openFontDatabase();
    if (!database) return [];
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(FONT_STORE_NAME, "readonly");
      const request = transaction.objectStore(FONT_STORE_NAME).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error ?? new Error("Local fonts could not be read."));
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => reject(transaction.error ?? new Error("Local fonts could not be read."));
    });
  } catch (error) {
    if (strict) throw error;
    return [];
  }
}

export async function countStoredFonts() {
  try {
    const database = await openFontDatabase();
    if (!database) return 0;
    return await new Promise((resolve) => {
      const transaction = database.transaction(FONT_STORE_NAME, "readonly");
      const request = transaction.objectStore(FONT_STORE_NAME).count();
      let count = 0;
      request.onsuccess = () => { count = Number(request.result) || 0; };
      transaction.oncomplete = () => {
        database.close();
        resolve(count);
      };
      transaction.onerror = () => {
        database.close();
        resolve(0);
      };
      transaction.onabort = () => {
        database.close();
        resolve(0);
      };
    });
  } catch {
    return 0;
  }
}

export async function clearStoredFonts() {
  try {
    const database = await openFontDatabase();
    if (!database) return false;
    return await new Promise((resolve) => {
      const transaction = database.transaction(FONT_STORE_NAME, "readwrite");
      const request = transaction.objectStore(FONT_STORE_NAME).clear();
      let cleared = false;
      request.onsuccess = () => { cleared = true; };
      transaction.oncomplete = () => {
        database.close();
        resolve(cleared);
      };
      transaction.onerror = () => {
        database.close();
        resolve(false);
      };
      transaction.onabort = () => {
        database.close();
        resolve(false);
      };
    });
  } catch {
    return false;
  }
}

function displayName(fileName) {
  const stem = String(fileName ?? "Custom font").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return stem ? stem.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Custom font";
}

function supportedFontFile(file) {
  return Boolean(file && (
    /\.(woff2?|otf|ttf|sfnt)$/i.test(file.name ?? "")
    || /font\//i.test(file.type ?? "")
    || file.type === "application/octet-stream"
  ));
}

export async function readFontRecord(id) {
  const database = await openFontDatabase();
  if (!database) return null;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(FONT_STORE_NAME, "readonly");
    const request = transaction.objectStore(FONT_STORE_NAME).get(id);
    let record;
    request.onsuccess = () => { record = request.result; };
    transaction.oncomplete = () => { database.close(); resolve(record ?? null); };
    transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Local fonts could not be read.")); };
  });
}

export async function registerFontFile(file, { persist = true } = {}) {
  if (!supportedFontFile(file)) {
    const error = new Error("Drop a .ttf, .otf, .woff, or .woff2 font file.");
    error.userMessage = error.message;
    throw error;
  }
  if (file.size > MAX_FONT_BYTES) throw textError("Choose a font file no larger than 16 MiB.", "font-limit");
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_FONT_BYTES) throw textError("Choose a font file no larger than 16 MiB.", "font-limit");
  if (!bytes.byteLength) throw new Error("That font file is empty.");
  const hash = await fontDigest(bytes);
  const record = {
    id: `font-${hash.slice(0, 16)}`,
    name: displayName(file.name),
    fileName: file.name,
    family: `TinyStarFont-${hash.slice(0, 10)}`,
    bytes,
    sha256: hash,
    byteLength: bytes.byteLength,
  };
  const loaded = await loadFontFace(record);
  if (persist && !await saveFontRecord(record)) {
    (globalThis.document?.fonts ?? globalThis.fonts)?.delete(loaded.face);
    throw textError("The font could not be saved locally. Free some browser storage and add it again.", "font-storage");
  }
  return rememberLoadedFont(loaded);
}

export async function restoreStoredFonts() {
  const records = await readFontRecords();
  const restored = [];
  for (const record of records) {
    try {
      restored.push(rememberLoadedFont(await loadFontFace(await verifyFontRecord(record, { id: record.id, bytes: MAX_FONT_BYTES }))));
    } catch {
      // A removed or invalid local font must not prevent the editor from
      // opening. The text layer reports a clear re-drop message when needed.
    }
  }
  return restored;
}

export function fontFileSupported(file) {
  return supportedFontFile(file);
}
