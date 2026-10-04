import { WorkspaceStoreError } from './workspace-store.js';
import { assertDesignNotDeleted } from './design-store.js';

export const FIG_SOURCE_ARCHIVE_STORE_FORMAT_VERSION = 1;
export const MAX_FIG_SOURCE_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_FIG_SOURCE_ARCHIVE_METADATA_BYTES = 4 * 1024;

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const ARCHIVE_DIRECTORY = 'fig-source';
const BLOBS_DIRECTORY = 'blobs';
const METADATA_FILE = 'archive.json';
const METADATA_KEYS = ['formatVersion', 'designId', 'contentHash', 'byteLength', 'createdAt'];
const encoder = new TextEncoder();

function fail(code, message, cause) { throw new WorkspaceStoreError(code, message, cause); }
function notFound(error) { return error?.name === 'NotFoundError'; }

function assertId(value, label) {
  if (typeof value !== 'string' || !ID.test(value) || value === '.' || value === '..') {
    fail('INVALID_ID', `Invalid ${label}.`);
  }
  return value;
}

function assertWorkspace(workspace, locks, crypto, { write = false, requireCrypto = true } = {}) {
  if (!workspace?.workspaceId || typeof workspace.getDesignDirectoryHandle !== 'function') {
    fail('INVALID_WORKSPACE', 'A verified workspace is required.');
  }
  if (typeof locks?.request !== 'function') {
    fail('CROSS_TAB_LOCK_UNSUPPORTED', 'This browser cannot safely serialize original .fig archive access across tabs.');
  }
  if (requireCrypto && typeof crypto?.subtle?.digest !== 'function') {
    fail('CRYPTO_UNAVAILABLE', 'Cryptographic hashing is unavailable in this browser.');
  }
  if (write && typeof workspace.directoryHandle?.queryPermission !== 'function') {
    fail('UNSUPPORTED_PERMISSION_API', 'This browser cannot verify workspace write permission.');
  }
}

async function requireWritePermission(workspace) {
  let permission;
  try { permission = await workspace.directoryHandle.queryPermission({ mode: 'readwrite' }); }
  catch (error) { fail('PERMISSION_CHECK_FAILED', 'Could not verify access to the selected workspace folder.', error); }
  if (permission !== 'granted') {
    fail('PERMISSION_REQUIRED', 'Workspace access is needed. Re-select the folder and grant read and write permission.');
  }
}

async function inputBytes(source) {
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer());
  }
  fail('INVALID_FIG_SOURCE_ARCHIVE', 'The original .fig archive must be a Blob, ArrayBuffer, or typed byte view.');
}

function checkArchiveSize(size) {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FIG_SOURCE_ARCHIVE_BYTES) {
    fail('FIG_SOURCE_ARCHIVE_TOO_LARGE', 'The original .fig archive must be between 1 byte and 32 MiB.');
  }
}

async function hashBytes(bytes, crypto) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function openArchiveDirectory(workspace, designId, { create = false } = {}) {
  let design;
  try { design = await workspace.getDesignDirectoryHandle(designId, { create: false }); }
  catch (error) { throw error; }
  let archive;
  try { archive = await design.getDirectoryHandle(ARCHIVE_DIRECTORY, { create }); }
  catch (error) {
    if (notFound(error)) fail('FIG_SOURCE_ARCHIVE_NOT_FOUND', 'This design has no retained original .fig archive.', error);
    fail('FIG_SOURCE_ARCHIVE_DIRECTORY_FAILED', 'Could not open the retained .fig archive folder.', error);
  }
  try {
    const blobs = await archive.getDirectoryHandle(BLOBS_DIRECTORY, { create });
    return { archive, blobs };
  } catch (error) {
    fail('FIG_SOURCE_ARCHIVE_LAYOUT_INVALID', 'The retained .fig archive folder is incomplete or unreadable.', error);
  }
}

async function readBytes(directory, name) {
  let handle;
  try { handle = await directory.getFileHandle(name, { create: false }); }
  catch (error) {
    if (notFound(error)) fail('FIG_SOURCE_ARCHIVE_NOT_FOUND', 'The retained original .fig archive data is missing.', error);
    fail('FIG_SOURCE_ARCHIVE_READ_FAILED', 'Could not open the retained .fig archive data.', error);
  }
  try {
    const file = await handle.getFile();
    checkArchiveSize(file.size);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) fail('FIG_SOURCE_ARCHIVE_READ_FAILED', 'The retained .fig archive could not be read completely.');
    return bytes;
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    fail('FIG_SOURCE_ARCHIVE_READ_FAILED', 'Could not read the retained .fig archive data.', error);
  }
}

function validateMetadata(value, designId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== METADATA_KEYS.length
    || Object.keys(value).some(key => !METADATA_KEYS.includes(key))
    || value.formatVersion !== FIG_SOURCE_ARCHIVE_STORE_FORMAT_VERSION
    || value.designId !== designId
    || typeof value.contentHash !== 'string' || !HASH.test(value.contentHash)
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > MAX_FIG_SOURCE_ARCHIVE_BYTES
    || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    fail('FIG_SOURCE_ARCHIVE_METADATA_INVALID', 'The retained .fig archive metadata is invalid or corrupt.');
  }
  return Object.freeze({ ...value });
}

async function readMetadata(directory, designId) {
  let handle;
  try { handle = await directory.getFileHandle(METADATA_FILE, { create: false }); }
  catch (error) {
    if (notFound(error)) fail('FIG_SOURCE_ARCHIVE_NOT_FOUND', 'This design has no retained original .fig archive.', error);
    fail('FIG_SOURCE_ARCHIVE_METADATA_READ_FAILED', 'Could not open the retained .fig archive metadata.', error);
  }
  try {
    const file = await handle.getFile();
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FIG_SOURCE_ARCHIVE_METADATA_BYTES) {
      fail('FIG_SOURCE_ARCHIVE_METADATA_INVALID', 'The retained .fig archive metadata exceeds its safety limit.');
    }
    const text = await file.text();
    if (encoder.encode(text).byteLength > MAX_FIG_SOURCE_ARCHIVE_METADATA_BYTES) {
      fail('FIG_SOURCE_ARCHIVE_METADATA_INVALID', 'The retained .fig archive metadata exceeds its safety limit.');
    }
    return validateMetadata(JSON.parse(text), designId);
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    fail('FIG_SOURCE_ARCHIVE_METADATA_INVALID', 'The retained .fig archive metadata is unreadable or corrupt.', error);
  }
}

function metadataJson(metadata) {
  return JSON.stringify(Object.fromEntries(METADATA_KEYS.map(key => [key, metadata[key]])));
}

async function writeArchiveBlob(directory, name, bytes) {
  let handle;
  try {
    handle = await directory.getFileHandle(name, { create: false });
    const existing = await handle.getFile();
    if (!Number.isSafeInteger(existing.size) || existing.size !== bytes.byteLength || existing.size > MAX_FIG_SOURCE_ARCHIVE_BYTES) {
      fail('FIG_SOURCE_ARCHIVE_COLLISION', 'A stored archive path already contains different data. Existing workspace data was not replaced.');
    }
    const stored = new Uint8Array(await existing.arrayBuffer());
    if (stored.byteLength !== bytes.byteLength || stored.some((byte, index) => byte !== bytes[index])) {
      fail('FIG_SOURCE_ARCHIVE_COLLISION', 'A stored archive path already contains different data. Existing workspace data was not replaced.');
    }
    return;
  } catch (error) {
    if (!notFound(error)) {
      if (error instanceof WorkspaceStoreError) throw error;
      fail('FIG_SOURCE_ARCHIVE_OPEN_FAILED', 'Could not check the retained .fig archive path.', error);
    }
  }

  try { handle = await directory.getFileHandle(name, { create: true }); }
  catch (error) { fail('FIG_SOURCE_ARCHIVE_OPEN_FAILED', 'Could not create the retained .fig archive file.', error); }
  let writable;
  try {
    writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(bytes);
    await writable.close();
  } catch (error) {
    try { await writable?.abort?.(); } catch {}
    try { await directory.removeEntry(name); } catch {}
    fail('FIG_SOURCE_ARCHIVE_WRITE_FAILED', 'Could not durably write the retained .fig archive.', error);
  }
  let reopened;
  try { reopened = await readBytes(directory, name); }
  catch (error) {
    try { await directory.removeEntry(name); } catch {}
    fail('FIG_SOURCE_ARCHIVE_VERIFY_FAILED', 'The closed .fig archive could not be reopened for verification.', error);
  }
  if (reopened.byteLength !== bytes.byteLength || reopened.some((byte, index) => byte !== bytes[index])) {
    try { await directory.removeEntry(name); } catch {}
    fail('FIG_SOURCE_ARCHIVE_VERIFY_FAILED', 'The closed .fig archive did not reopen byte-for-byte.');
  }
}

async function writeMetadata(directory, metadata) {
  const text = metadataJson(metadata);
  if (encoder.encode(text).byteLength > MAX_FIG_SOURCE_ARCHIVE_METADATA_BYTES) {
    fail('FIG_SOURCE_ARCHIVE_METADATA_INVALID', 'The retained .fig archive metadata exceeds its safety limit.');
  }
  let handle;
  try {
    handle = await directory.getFileHandle(METADATA_FILE, { create: false });
    if (handle) fail('FIG_SOURCE_ARCHIVE_PATH_COLLISION', 'An unexpected file occupies the retained .fig archive metadata path.');
  } catch (error) {
    if (!notFound(error)) {
      if (error instanceof WorkspaceStoreError) throw error;
      fail('FIG_SOURCE_ARCHIVE_METADATA_OPEN_FAILED', 'Could not check the retained .fig archive metadata path.', error);
    }
  }
  try { handle = await directory.getFileHandle(METADATA_FILE, { create: true }); }
  catch (error) { fail('FIG_SOURCE_ARCHIVE_METADATA_WRITE_FAILED', 'Could not create retained .fig archive metadata.', error); }
  let writable;
  try {
    writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(text);
    await writable.close();
  } catch (error) {
    try { await writable?.abort?.(); } catch {}
    try { await directory.removeEntry(METADATA_FILE); } catch {}
    fail('FIG_SOURCE_ARCHIVE_METADATA_WRITE_FAILED', 'Could not durably save retained .fig archive metadata.', error);
  }
  let reopened;
  try { reopened = await readMetadata(directory, metadata.designId); }
  catch (error) {
    try { await directory.removeEntry(METADATA_FILE); } catch {}
    fail('FIG_SOURCE_ARCHIVE_METADATA_VERIFY_FAILED', 'The retained .fig archive metadata could not be reopened for verification.', error);
  }
  if (metadataJson(reopened) !== text) {
    try { await directory.removeEntry(METADATA_FILE); } catch {}
    fail('FIG_SOURCE_ARCHIVE_METADATA_VERIFY_FAILED', 'The retained .fig archive metadata did not reopen correctly.');
  }
}

function lockName(workspace, designId) {
  // Share the design lock so archive maintenance cannot race a design-folder deletion.
  return `tiny-image-star-design:${workspace.workspaceId}:${designId}`;
}

/**
 * Retains one immutable original `.fig` archive in a design's separate `fig-source`
 * folder. Repeating the same save is idempotent; a different archive is rejected so
 * an import retry cannot silently replace the source archive already attached to a design.
 */
export async function saveFigSourceArchive(workspace, designId, source, {
  crypto = globalThis.crypto,
  locks = globalThis.navigator?.locks,
  now = Date.now()
} = {}) {
  designId = assertId(designId, 'design ID');
  assertWorkspace(workspace, locks, crypto, { write: true });
  if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_OPTIONS', 'Invalid original .fig archive creation time.');
  const bytes = await inputBytes(source);
  checkArchiveSize(bytes.byteLength);
  const contentHash = await hashBytes(bytes, crypto);
  const metadata = Object.freeze({
    formatVersion: FIG_SOURCE_ARCHIVE_STORE_FORMAT_VERSION,
    designId,
    contentHash,
    byteLength: bytes.byteLength,
    createdAt: now
  });

  return locks.request(lockName(workspace, designId), { mode: 'exclusive' }, async () => {
    await assertDesignNotDeleted(workspace, designId);
    await requireWritePermission(workspace);
    const { archive, blobs } = await openArchiveDirectory(workspace, designId, { create: true });
    let existing;
    try { existing = await readMetadata(archive, designId); }
    catch (error) { if (error.code !== 'FIG_SOURCE_ARCHIVE_NOT_FOUND') throw error; }
    if (existing) {
      if (existing.contentHash !== contentHash || existing.byteLength !== bytes.byteLength) {
        fail('FIG_SOURCE_ARCHIVE_CONFLICT', 'This design already retains a different original .fig archive. Existing data was not replaced.');
      }
      let existingBytes;
      try { existingBytes = await readBytes(blobs, `${existing.contentHash}.fig`); }
      catch (error) {
        if (error.code === 'FIG_SOURCE_ARCHIVE_NOT_FOUND') fail('FIG_SOURCE_ARCHIVE_CORRUPT', 'The existing original .fig archive data is missing.', error);
        throw error;
      }
      if (existingBytes.byteLength !== existing.byteLength || await hashBytes(existingBytes, crypto) !== existing.contentHash) {
        fail('FIG_SOURCE_ARCHIVE_CORRUPT', 'The existing original .fig archive failed its content-hash check.');
      }
      return Object.freeze({ ...existing, deduplicated: true });
    }

    await writeArchiveBlob(blobs, `${contentHash}.fig`, bytes);
    await writeMetadata(archive, metadata);
    return Object.freeze({ ...metadata, deduplicated: false });
  });
}

/** Reads and verifies the retained archive; returns null when the design has none. */
export async function readFigSourceArchive(workspace, designId, {
  crypto = globalThis.crypto,
  locks = globalThis.navigator?.locks
} = {}) {
  designId = assertId(designId, 'design ID');
  assertWorkspace(workspace, locks, crypto);
  return locks.request(lockName(workspace, designId), { mode: 'exclusive' }, async () => {
    await assertDesignNotDeleted(workspace, designId);
    let directories;
    try { directories = await openArchiveDirectory(workspace, designId); }
    catch (error) {
      if (error.code === 'FIG_SOURCE_ARCHIVE_NOT_FOUND') return null;
      throw error;
    }
    let metadata;
    try { metadata = await readMetadata(directories.archive, designId); }
    catch (error) {
      if (error.code === 'FIG_SOURCE_ARCHIVE_NOT_FOUND') return null;
      throw error;
    }
    let bytes;
    try { bytes = await readBytes(directories.blobs, `${metadata.contentHash}.fig`); }
    catch (error) {
      if (error.code === 'FIG_SOURCE_ARCHIVE_NOT_FOUND') fail('FIG_SOURCE_ARCHIVE_CORRUPT', 'The retained original .fig archive data is missing.', error);
      throw error;
    }
    if (bytes.byteLength !== metadata.byteLength || await hashBytes(bytes, crypto) !== metadata.contentHash) {
      fail('FIG_SOURCE_ARCHIVE_CORRUPT', 'The retained original .fig archive failed its content-hash check.');
    }
    return Object.freeze({ bytes, metadata });
  });
}

/** Deletes the reserved source-archive folder for a design. Returns false when absent. */
export async function deleteFigSourceArchive(workspace, designId, {
  locks = globalThis.navigator?.locks
} = {}) {
  designId = assertId(designId, 'design ID');
  assertWorkspace(workspace, locks, null, { write: true, requireCrypto: false });
  return locks.request(lockName(workspace, designId), { mode: 'exclusive' }, async () => {
    await assertDesignNotDeleted(workspace, designId);
    await requireWritePermission(workspace);
    let design;
    try { design = await workspace.getDesignDirectoryHandle(designId, { create: false }); }
    catch (error) { if (error.code === 'DESIGN_NOT_FOUND') return false; throw error; }
    try {
      await design.removeEntry(ARCHIVE_DIRECTORY, { recursive: true });
      return true;
    } catch (error) {
      if (notFound(error)) return false;
      fail('FIG_SOURCE_ARCHIVE_DELETE_FAILED', 'Could not delete the retained original .fig archive.', error);
    }
  });
}
