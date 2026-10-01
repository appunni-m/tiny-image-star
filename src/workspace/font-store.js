import { WorkspaceStoreError } from './workspace-store.js';
import { MAX_LOCAL_FONT_BYTES, validateLocalFontAsset } from '../font-assets.js';
import { assertDesignNotDeleted, listDesignAssetReferences } from './design-store.js';

export const FONT_STORE_FORMAT_VERSION = 1;
export const MAX_FONT_METADATA_BYTES = 8 * 1024;

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const KEYS = ['formatVersion', 'designId', 'fontId', 'contentHash', 'size', 'id', 'name', 'type', 'family', 'weight', 'style', 'createdAt'];

function fail(code, message, cause) { throw new WorkspaceStoreError(code, message, cause); }
function notFound(error) { return error?.name === 'NotFoundError'; }

function assertId(value, label) {
  if (typeof value !== 'string' || !ID.test(value) || value === '.' || value === '..') fail('INVALID_ID', `Invalid ${label}.`);
  return value;
}

function assertWorkspace(workspace) {
  if (!workspace?.workspaceId || typeof workspace.getDesignDirectoryHandle !== 'function') fail('INVALID_WORKSPACE', 'A verified workspace is required.');
}

function assertCrypto(crypto) {
  if (typeof crypto?.subtle?.digest !== 'function') fail('CRYPTO_UNAVAILABLE', 'Cryptographic hashing is unavailable in this browser.');
}

function assertLocks(locks) {
  if (typeof locks?.request !== 'function') fail('CROSS_TAB_LOCK_UNSUPPORTED', 'This browser cannot safely serialize font writes across tabs.');
}

async function requireWritePermission(workspace) {
  const handle = workspace.directoryHandle;
  if (typeof handle?.queryPermission !== 'function') fail('UNSUPPORTED_PERMISSION_API', 'This browser cannot verify workspace write permission.');
  let permission;
  try { permission = await handle.queryPermission({ mode: 'readwrite' }); }
  catch (error) { fail('PERMISSION_CHECK_FAILED', 'Could not verify access to the selected workspace folder.', error); }
  if (permission !== 'granted') fail('PERMISSION_REQUIRED', 'Workspace access is needed. Re-select the folder and grant read and write permission.');
}

async function hashBytes(bytes, crypto) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function fontDirectories(workspace, designId, create = false) {
  let design;
  try { design = await workspace.getDesignDirectoryHandle(designId, { create: false }); }
  catch (error) { throw error; }
  let fonts;
  try { fonts = await design.getDirectoryHandle('fonts', { create }); }
  catch (error) {
    if (notFound(error)) fail('FONT_NOT_FOUND', 'The font does not exist in this design.', error);
    fail('FONT_DIRECTORY_FAILED', 'Could not open the design font directory.', error);
  }
  try {
    const [blobs, metadata] = await Promise.all([
      fonts.getDirectoryHandle('blobs', { create }), fonts.getDirectoryHandle('metadata', { create })
    ]);
    return { blobs, metadata };
  } catch (error) { fail('FONT_DIRECTORY_FAILED', 'Could not open the design font directories.', error); }
}

async function readBytes(directory, name, maxBytes, missingCode = 'FONT_NOT_FOUND') {
  let handle;
  try { handle = await directory.getFileHandle(name, { create: false }); }
  catch (error) {
    if (notFound(error)) fail(missingCode, 'The referenced font data is missing.', error);
    fail('FONT_READ_FAILED', 'Could not open the font data.', error);
  }
  try {
    const file = await handle.getFile();
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxBytes) fail('FONT_TOO_LARGE', 'The stored font exceeds its safety limit.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) fail('FONT_READ_FAILED', 'The stored font could not be read completely.');
    return bytes;
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    fail('FONT_READ_FAILED', 'Could not read the font data.', error);
  }
}

function validateMetadata(value, designId, fontId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== KEYS.length || Object.keys(value).some(key => !KEYS.includes(key))
    || value.formatVersion !== FONT_STORE_FORMAT_VERSION || value.designId !== designId || value.fontId !== fontId
    || value.id !== fontId || typeof value.contentHash !== 'string' || !HASH.test(value.contentHash)
    || !Number.isSafeInteger(value.size) || value.size < 12 || value.size > MAX_LOCAL_FONT_BYTES
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 255
    || typeof value.type !== 'string' || !['font/woff2', 'font/woff', 'font/otf', 'font/ttf'].includes(value.type)
    || typeof value.family !== 'string' || !value.family.trim() || value.family.length > 120
    || !Number.isInteger(value.weight) || value.weight < 1 || value.weight > 1000
    || !['normal', 'italic'].includes(value.style)
    || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    fail('FONT_METADATA_INVALID', 'The font metadata is invalid or corrupt.');
  }
  return Object.freeze({ ...value });
}

async function readMetadata(directory, designId, fontId) {
  let handle;
  try { handle = await directory.getFileHandle(`${fontId}.json`, { create: false }); }
  catch (error) {
    if (notFound(error)) fail('FONT_NOT_FOUND', 'This font is not registered in the design.', error);
    fail('FONT_METADATA_READ_FAILED', 'Could not open font metadata.', error);
  }
  try {
    const file = await handle.getFile();
    if (!Number.isSafeInteger(file.size) || file.size > MAX_FONT_METADATA_BYTES) fail('FONT_METADATA_INVALID', 'The font metadata exceeds its safety limit.');
    const text = await file.text();
    if (new TextEncoder().encode(text).byteLength > MAX_FONT_METADATA_BYTES) fail('FONT_METADATA_INVALID', 'The font metadata exceeds its safety limit.');
    return validateMetadata(JSON.parse(text), designId, fontId);
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    fail('FONT_METADATA_INVALID', 'The font metadata is unreadable or corrupt.', error);
  }
}

function canonicalJson(value) {
  return JSON.stringify(Object.fromEntries(KEYS.map(key => [key, value[key]])));
}

async function writeNewFile(directory, name, bytes, { binary = false } = {}) {
  let handle;
  try {
    handle = await directory.getFileHandle(name, { create: false });
    if (handle) fail('FONT_PATH_COLLISION', 'An unexpected file already occupies the generated font path.');
  } catch (error) {
    if (!notFound(error)) {
      if (error instanceof WorkspaceStoreError) throw error;
      fail('FONT_OPEN_FAILED', 'Could not check for an existing font path.', error);
    }
  }
  try { handle = await directory.getFileHandle(name, { create: true }); }
  catch (error) { fail('FONT_OPEN_FAILED', 'Could not create the font file.', error); }
  let writable;
  try {
    writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(binary ? bytes : new TextDecoder().decode(bytes));
    await writable.close();
  } catch (error) {
    try { await writable?.abort?.(); } catch {}
    try { await directory.removeEntry(name); } catch {}
    fail('FONT_WRITE_FAILED', 'Could not durably write the font.', error);
  }
  const reopened = await readBytes(directory, name, binary ? MAX_LOCAL_FONT_BYTES : MAX_FONT_METADATA_BYTES, 'FONT_VERIFY_FAILED');
  if (reopened.byteLength !== bytes.byteLength || reopened.some((byte, index) => byte !== bytes[index])) {
    try { await directory.removeEntry(name); } catch {}
    fail('FONT_VERIFY_FAILED', 'The closed font file did not reopen byte-for-byte.');
  }
  return reopened;
}

async function readVerified(workspace, designId, fontId, crypto) {
  const { blobs, metadata: metadataDirectory } = await fontDirectories(workspace, designId);
  const metadata = await readMetadata(metadataDirectory, designId, fontId);
  const bytes = await readBytes(blobs, metadata.contentHash, MAX_LOCAL_FONT_BYTES);
  if (bytes.byteLength !== metadata.size || await hashBytes(bytes, crypto) !== metadata.contentHash) {
    fail('FONT_CONTENT_CORRUPT', 'The stored font failed its content integrity check.');
  }
  try {
    const validated = validateLocalFontAsset({ ...metadata, bytes }, { copyBytes: false });
    if (validated.type !== metadata.type) fail('FONT_METADATA_INVALID', 'The stored font metadata does not match its font data.');
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    fail('FONT_CONTENT_CORRUPT', 'The stored font data is invalid.', error);
  }
  return Object.freeze({ metadata, bytes });
}

/** Stores an immutable, per-design copy of a validated local font. */
export async function saveWorkspaceFontAsset(workspace, designId, font, {
  crypto = globalThis.crypto, locks = globalThis.navigator?.locks, now = Date.now()
} = {}) {
  designId = assertId(designId, 'design ID');
  assertWorkspace(workspace); assertLocks(locks); assertCrypto(crypto);
  if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_OPTIONS', 'Invalid font creation time.');
  let validated;
  try { validated = validateLocalFontAsset(font); }
  catch (error) { fail('INVALID_FONT', error?.message || 'The local font is invalid.', error); }
  const fontId = assertId(validated.id, 'font ID');
  const bytes = validated.bytes;
  const contentHash = await hashBytes(bytes, crypto);
  return locks.request(`tiny-image-star-fonts:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
    await assertDesignNotDeleted(workspace, designId);
    await requireWritePermission(workspace);
    const dirs = await fontDirectories(workspace, designId, true);
    let existing;
    try { existing = await readMetadata(dirs.metadata, designId, fontId); }
    catch (error) { if (error.code !== 'FONT_NOT_FOUND') throw error; }
    const metadata = {
      formatVersion: FONT_STORE_FORMAT_VERSION, designId, fontId, contentHash, size: bytes.byteLength,
      id: fontId, name: validated.name, type: validated.type, family: validated.family,
      weight: validated.weight, style: validated.style, createdAt: now
    };
    if (existing) {
      const immutableKeys = KEYS.filter(key => key !== 'createdAt');
      if (immutableKeys.some(key => existing[key] !== metadata[key])) fail('FONT_ID_COLLISION', 'This font ID already refers to different immutable font data or metadata.');
      const stored = await readBytes(dirs.blobs, existing.contentHash, MAX_LOCAL_FONT_BYTES);
      if (stored.byteLength !== existing.size || await hashBytes(stored, crypto) !== existing.contentHash || stored.some((byte, index) => byte !== bytes[index])) {
        fail('FONT_CONTENT_CORRUPT', 'The existing content-addressed font failed integrity validation.');
      }
      return Object.freeze({ ...existing, deduplicated: true });
    }
    let blobExists = false;
    try {
      const stored = await readBytes(dirs.blobs, contentHash, MAX_LOCAL_FONT_BYTES);
      blobExists = true;
      if (stored.byteLength !== bytes.byteLength || await hashBytes(stored, crypto) !== contentHash || stored.some((byte, index) => byte !== bytes[index])) {
        fail('FONT_CONTENT_COLLISION', 'A content-addressed font path contains different bytes.');
      }
    } catch (error) { if (error.code !== 'FONT_NOT_FOUND') throw error; }
    if (!blobExists) {
      const reopened = await writeNewFile(dirs.blobs, contentHash, bytes, { binary: true });
      if (await hashBytes(reopened, crypto) !== contentHash) {
        try { await dirs.blobs.removeEntry(contentHash); } catch {}
        fail('FONT_VERIFY_FAILED', 'The closed font file failed its content hash check.');
      }
    }
    const metadataBytes = new TextEncoder().encode(canonicalJson(metadata));
    if (metadataBytes.byteLength > MAX_FONT_METADATA_BYTES) fail('FONT_METADATA_TOO_LARGE', 'The font metadata exceeds its safety limit.');
    await writeNewFile(dirs.metadata, `${fontId}.json`, metadataBytes);
    return Object.freeze({ ...metadata, deduplicated: blobExists });
  });
}

/** Reads stored font bytes only after metadata, bytes, hash, and font format agree. */
export async function readWorkspaceFontAsset(workspace, designId, fontId, { crypto = globalThis.crypto } = {}) {
  designId = assertId(designId, 'design ID'); fontId = assertId(fontId, 'font ID');
  assertWorkspace(workspace); assertCrypto(crypto);
  return readVerified(workspace, designId, fontId, crypto);
}

/** Lists and verifies every font registered in a design. */
export async function listWorkspaceFontAssets(workspace, designId, { crypto = globalThis.crypto } = {}) {
  designId = assertId(designId, 'design ID'); assertWorkspace(workspace); assertCrypto(crypto);
  const { metadata } = await fontDirectories(workspace, designId);
  const names = [];
  try {
    for await (const [name, handle] of metadata.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json')) fail('FONT_METADATA_INVALID', 'The font metadata directory contains an unexpected entry.');
      const id = name.slice(0, -5);
      assertId(id, 'font ID');
      names.push(id);
    }
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    fail('FONT_METADATA_READ_FAILED', 'Could not list font metadata.', error);
  }
  names.sort();
  const result = [];
  for (const id of names) result.push(await readVerified(workspace, designId, id, crypto));
  return result;
}

/** Removes a font's metadata reference; shared content blobs remain available. */
export async function deleteWorkspaceFontAsset(workspace, designId, fontId, {
  locks = globalThis.navigator?.locks,
  crypto = globalThis.crypto
} = {}) {
  designId = assertId(designId, 'design ID'); fontId = assertId(fontId, 'font ID');
  assertWorkspace(workspace); assertLocks(locks);
  const designLock = `tiny-image-star-design:${workspace.workspaceId}:${designId}`;
  const fontLock = `tiny-image-star-fonts:${workspace.workspaceId}:${designId}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const references = await listDesignAssetReferences(workspace, designId, { locks, crypto });
    const result = await locks.request(designLock, { mode: 'exclusive' }, async () => {
      let indexed;
      try {
        const design = await workspace.getDesignDirectoryHandle(designId, { create: false });
        const internal = await design.getDirectoryHandle('.tiny-image-star', { create: false });
        const handle = await internal.getFileHandle('HEAD.json', { create: false });
        const file = await handle.getFile();
        if (!Number.isSafeInteger(file.size) || file.size > 4096) fail('DESIGN_HEAD_INVALID', 'The current design HEAD exceeds its safety limit.');
        indexed = JSON.parse(await file.text());
      } catch (error) {
        if (error instanceof WorkspaceStoreError) throw error;
        fail('DESIGN_HEAD_INVALID', 'Could not verify the design revision before removing a font.', error);
      }
      if (indexed?.commitHash !== references.head.commitHash || indexed?.sequence !== references.head.sequence) return null;
      return locks.request(fontLock, { mode: 'exclusive' }, async () => {
        await requireWritePermission(workspace);
        const { metadata } = await fontDirectories(workspace, designId);
        const font = await readMetadata(metadata, designId, fontId);
        const family = font.family.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
        const inUse = references.fontSpecs.some(spec => spec.family === family
          && spec.weight === font.weight && spec.style === font.style);
        if (inUse) fail('FONT_IN_USE', 'This font face is retained by a design snapshot and cannot be removed safely.');
        try { await metadata.removeEntry(`${fontId}.json`); }
        catch (error) { fail('FONT_DELETE_FAILED', 'Could not remove the font reference.', error); }
        return true;
      });
    });
    if (result !== null) return result;
  }
  fail('DESIGN_CHANGED_RETRY', 'The design changed while font cleanup was being checked. Try again.');
}
