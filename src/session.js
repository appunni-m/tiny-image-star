// Browser-local recovery for the active image set. Source bytes are retained
// only under a bounded budget; generated outputs are deliberately excluded and
// are rebuilt through the normal worker path after a restore.

export const SESSION_VERSION = 1;
export const SESSION_DB_NAME = "tiny-image-star.session";
export const SESSION_STORE_NAME = "snapshots";
export const SESSION_KEY = "active";
export const EDITOR_SESSION_KEY = "editor";
export const MAX_SESSION_BYTES = 64 * 1024 * 1024;

const RECIPE_SCOPES = new Set(["all", "selected", "this"]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isIndexedDbAvailable() {
  return typeof globalThis.indexedDB !== "undefined";
}

function copyBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes.slice().buffer;
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return null;
}

export function buildSessionSnapshot({ batch, activePresetId }) {
  const files = Array.from(batch?.files ?? []).map((item) => ({
    id: String(item.id),
    name: String(item.name ?? item.file?.name ?? "image"),
    type: String(item.file?.type ?? "application/octet-stream"),
    lastModified: Number(item.file?.lastModified) || 0,
    bytes: copyBytes(item.bytes),
    fingerprint: item.fingerprint ?? null,
    duplicateKey: item.duplicateKey ?? null,
    // A scoped destination belongs to this image only. It is deliberately
    // separate from `override`, which stores manual canvas corrections.
    presetOverride: item.presetOverride ?? null,
    override: clone(item.override),
  }));
  const byteLength = files.reduce((total, item) => total + (item.bytes?.byteLength ?? 0), 0);
  if (!files.length) return { snapshot: null, byteLength: 0, reason: "empty" };
  if (byteLength > MAX_SESSION_BYTES) return { snapshot: null, byteLength, reason: "too-large" };
  return {
    snapshot: {
      version: SESSION_VERSION,
      savedAt: Date.now(),
      activePresetId: activePresetId ?? null,
      batch: {
        presetId: batch.presetId ?? null,
        recipeScope: RECIPE_SCOPES.has(batch.recipeScope) ? batch.recipeScope : "all",
        sharedOverride: clone(batch.sharedOverride),
        formatOverride: batch.formatOverride ?? null,
        lossyOverride: typeof batch.lossyOverride === "boolean" ? batch.lossyOverride : null,
        qualityOverride: Number.isFinite(Number(batch.qualityOverride)) ? Number(batch.qualityOverride) : null,
        activeId: batch.activeId ?? null,
        selected: [...(batch.selected ?? [])],
        selectionTouched: Boolean(batch.selectionTouched),
        files,
      },
    },
    byteLength,
    reason: null,
  };
}

export function buildEditorSessionSnapshot({ file, operations }) {
  const bytes = copyBytes(file?.bytes);
  const byteLength = bytes?.byteLength ?? 0;
  if (!file || !bytes?.byteLength) return { snapshot: null, byteLength, reason: "empty" };
  if (byteLength > MAX_SESSION_BYTES) return { snapshot: null, byteLength, reason: "too-large" };
  return {
    snapshot: {
      version: SESSION_VERSION,
      kind: "editor",
      savedAt: Date.now(),
      editor: {
        id: String(file.id ?? "editor"),
        name: String(file.name ?? "image"),
        type: String(file.type ?? "application/octet-stream"),
        lastModified: Number(file.lastModified) || 0,
        bytes,
        operations: clone(operations),
      },
    },
    byteLength,
    reason: null,
  };
}

export function editorSessionRecordIsUsable(record) {
  return Boolean(
    record
      && record.version === SESSION_VERSION
      && record.kind === "editor"
      && record.editor
      && record.editor.id
      && record.editor.name
      && record.editor.bytes
      && record.editor.operations,
  );
}

export function sessionRecordIsUsable(record) {
  if (editorSessionRecordIsUsable(record)) return true;
  return Boolean(
    record
      && record.version === SESSION_VERSION
      && record.batch
      && Array.isArray(record.batch.files)
      && record.batch.files.length
      && record.batch.files.every((item) => item && item.id && item.name && item.bytes),
  );
}

export function sessionFile(item) {
  if (!item?.bytes || typeof File === "undefined") return null;
  const bytes = item.bytes instanceof ArrayBuffer
    ? item.bytes
    : ArrayBuffer.isView(item.bytes)
      ? item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength)
      : null;
  if (!bytes) return null;
  return new File([bytes], item.name, { type: item.type || "application/octet-stream", lastModified: item.lastModified || Date.now() });
}

function openDatabase() {
  if (!isIndexedDbAvailable()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SESSION_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SESSION_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("local session storage is unavailable"));
  });
}

export async function readSession(key = SESSION_KEY) {
  try {
    const database = await openDatabase();
    if (!database) return null;
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(SESSION_STORE_NAME, "readonly");
      const request = transaction.objectStore(SESSION_STORE_NAME).get(key);
      request.onsuccess = () => resolve(sessionRecordIsUsable(request.result) ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error("local session could not be read"));
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => reject(transaction.error ?? new Error("local session could not be read"));
    });
  } catch {
    return null;
  }
}

export async function writeSession(snapshot, key = SESSION_KEY) {
  if (!sessionRecordIsUsable(snapshot)) return false;
  try {
    const database = await openDatabase();
    if (!database) return false;
    return await new Promise((resolve) => {
      const transaction = database.transaction(SESSION_STORE_NAME, "readwrite");
      transaction.objectStore(SESSION_STORE_NAME).put(snapshot, key);
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

export async function clearSession(key = SESSION_KEY) {
  try {
    const database = await openDatabase();
    if (!database) return false;
    return await new Promise((resolve) => {
      const transaction = database.transaction(SESSION_STORE_NAME, "readwrite");
      transaction.objectStore(SESSION_STORE_NAME).delete(key);
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

export async function readEditorSession() {
  const record = await readSession(EDITOR_SESSION_KEY);
  return editorSessionRecordIsUsable(record) ? record : null;
}

export async function writeEditorSession(snapshot) {
  if (!editorSessionRecordIsUsable(snapshot)) return false;
  return writeSession(snapshot, EDITOR_SESSION_KEY);
}

export async function clearEditorSession() {
  return clearSession(EDITOR_SESSION_KEY);
}
