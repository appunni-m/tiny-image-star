// Local font files stay on this device. The editor never fetches a font from a
// website on the user's behalf, which keeps the font workflow compatible with
// the app's offline/private promise.

export const BUILTIN_FONTS = Object.freeze([
  { id: "system-sans", name: "Clean sans", family: "Arial, Helvetica, sans-serif" },
  { id: "system-serif", name: "Classic serif", family: "Georgia, 'Times New Roman', serif" },
  { id: "system-mono", name: "Monospace", family: "'Courier New', Courier, monospace" },
  { id: "system-display", name: "Bold display", family: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif" },
]);

const FONT_DB_NAME = "tiny-image-star-fonts";
const FONT_DB_VERSION = 1;
const FONT_STORE_NAME = "fonts";

function bytesBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return null;
}

function fallbackHash(bytes) {
  let hash = 2166136261;
  for (const byte of new Uint8Array(bytes)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function bytesHash(bytes) {
  const buffer = bytesBuffer(bytes);
  if (!buffer) throw new Error("The font file could not be read.");
  if (globalThis.crypto?.subtle) {
    try {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      // Some local file contexts expose crypto without digest support. The
      // deterministic fallback still gives the local record a stable key.
    }
  }
  return fallbackHash(buffer);
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

async function readFontRecords() {
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
  } catch {
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

async function loadFace(record) {
  if (typeof FontFace !== "function" || !globalThis.document?.fonts) {
    throw new Error("Custom fonts are not available in this browser.");
  }
  const bytes = bytesBuffer(record.bytes);
  if (!bytes) throw new Error("The font file could not be read.");
  const face = new FontFace(record.family, bytes);
  document.fonts.add(face);
  try {
    await face.load();
  } catch (error) {
    document.fonts.delete(face);
    throw error;
  }
  return { ...record, bytes, face };
}

export async function registerFontFile(file, { persist = true } = {}) {
  if (!supportedFontFile(file)) {
    const error = new Error("Drop a .ttf, .otf, .woff, or .woff2 font file.");
    error.userMessage = error.message;
    throw error;
  }
  const bytes = await file.arrayBuffer();
  if (!bytes.byteLength) throw new Error("That font file is empty.");
  const hash = await bytesHash(bytes);
  const record = {
    id: `font-${hash.slice(0, 16)}`,
    name: displayName(file.name),
    fileName: file.name,
    family: `TinyStarFont-${hash.slice(0, 10)}`,
    bytes,
  };
  const loaded = await loadFace(record);
  if (persist) await saveFontRecord(record);
  return loaded;
}

export async function restoreStoredFonts() {
  const records = await readFontRecords();
  const restored = [];
  for (const record of records) {
    try {
      restored.push(await loadFace(record));
    } catch {
      // A removed or invalid local font must not prevent the editor from
      // opening. The text layer reports a clear re-drop message when needed.
    }
  }
  return restored;
}

export function builtinFontById(id) {
  return BUILTIN_FONTS.find((font) => font.id === id) ?? BUILTIN_FONTS[0];
}

export function fontRecordForLayer(fonts, layer) {
  const custom = layer?.fontId ? fonts?.get(layer.fontId) : null;
  if (custom) return custom;
  return builtinFontById(layer?.fontId);
}

export function fontFileSupported(file) {
  return supportedFontFile(file);
}
