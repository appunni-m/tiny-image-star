import { WorkspaceStoreError } from './workspace-store.js';
import { listDesignAssetReferences } from './design-store.js';

export const ASSET_STORE_FORMAT_VERSION = 1;
export const MAX_IMAGE_ASSET_BYTES = 64 * 1024 * 1024;
export const MAX_ASSET_METADATA_BYTES = 4 * 1024;

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const MIME = /^image\/[a-z0-9][a-z0-9.+-]{0,63}$/;
const METADATA_KEYS = ['formatVersion', 'designId', 'assetId', 'contentHash', 'byteLength', 'mimeType', 'createdAt'];

function fail(code, message, cause) { throw new WorkspaceStoreError(code, message, cause); }
function notFound(error) { return error?.name === 'NotFoundError'; }

function assertId(value, label) {
  if (typeof value !== 'string' || !ID.test(value) || value === '.' || value === '..') {
    fail('INVALID_ID', `Invalid ${label}.`);
  }
  return value;
}

function assertOptions(workspace, locks, crypto) {
  if (!workspace?.workspaceId || typeof workspace.getDesignDirectoryHandle !== 'function') {
    fail('INVALID_WORKSPACE', 'A verified workspace is required.');
  }
  if (typeof locks?.request !== 'function') {
    fail('CROSS_TAB_LOCK_UNSUPPORTED', 'This browser cannot safely serialize image asset writes across tabs.');
  }
  if (typeof crypto?.subtle?.digest !== 'function') {
    fail('CRYPTO_UNAVAILABLE', 'Cryptographic hashing is unavailable in this browser.');
  }
}

async function requireWritePermission(workspace) {
  const handle = workspace.directoryHandle;
  if (typeof handle?.queryPermission !== 'function') {
    fail('UNSUPPORTED_PERMISSION_API', 'This browser cannot verify workspace write permission.');
  }
  let permission;
  try { permission = await handle.queryPermission({ mode: 'readwrite' }); }
  catch (error) { fail('PERMISSION_CHECK_FAILED', 'Could not verify access to the selected workspace folder.', error); }
  if (permission !== 'granted') {
    fail('PERMISSION_REQUIRED', 'Workspace access is needed. Re-select the folder and grant read and write permission.');
  }
}

function getInputBytes(source, maxBytes) {
  if (source instanceof ArrayBuffer) {
    if (source.byteLength > maxBytes) fail('ASSET_TOO_LARGE', 'The image exceeds the asset size limit.');
    return new Uint8Array(source.slice(0));
  }
  if (ArrayBuffer.isView(source)) {
    if (source.byteLength > maxBytes) fail('ASSET_TOO_LARGE', 'The image exceeds the asset size limit.');
    return new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (source.size > maxBytes) fail('ASSET_TOO_LARGE', 'The image exceeds the asset size limit.');
    return source.arrayBuffer().then(buffer => new Uint8Array(buffer));
  }
  fail('INVALID_ASSET_BYTES', 'Image data must be a Blob, ArrayBuffer, or typed byte view.');
}

async function hashBytes(bytes, crypto) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function imageDirectories(workspace, designId, { create = false } = {}) {
  let design;
  try { design = await workspace.getDesignDirectoryHandle(designId, { create: false }); }
  catch (error) { throw error; }
  let assets;
  try { assets = await design.getDirectoryHandle('assets', { create }); }
  catch (error) {
    if (notFound(error)) fail('ASSET_NOT_FOUND', 'The image asset does not exist in this design.', error);
    fail('ASSET_DIRECTORY_FAILED', 'Could not open the design image asset directory.', error);
  }
  try {
    const [blobs, metadata] = await Promise.all([
      assets.getDirectoryHandle('blobs', { create }),
      assets.getDirectoryHandle('metadata', { create })
    ]);
    return { blobs, metadata };
  } catch (error) { fail('ASSET_DIRECTORY_FAILED', 'Could not open the design image asset directories.', error); }
}

async function readBytesFile(directory, name, maxBytes, missingCode = 'ASSET_NOT_FOUND') {
  let handle;
  try { handle = await directory.getFileHandle(name, { create: false }); }
  catch (error) {
    if (notFound(error)) fail(missingCode, 'The referenced image asset data is missing.', error);
    fail('ASSET_READ_FAILED', 'Could not open the image asset data.', error);
  }
  try {
    const file = await handle.getFile();
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxBytes) {
      fail('ASSET_TOO_LARGE', 'The stored image asset exceeds its safety limit.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) fail('ASSET_READ_FAILED', 'The stored image asset could not be read completely.');
    return bytes;
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    fail('ASSET_READ_FAILED', 'Could not read the image asset data.', error);
  }
}

function validateMetadata(value, designId, assetId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== METADATA_KEYS.length
    || Object.keys(value).some(key => !METADATA_KEYS.includes(key))
    || value.formatVersion !== ASSET_STORE_FORMAT_VERSION
    || value.designId !== designId || value.assetId !== assetId
    || typeof value.contentHash !== 'string' || !HASH.test(value.contentHash)
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0 || value.byteLength > MAX_IMAGE_ASSET_BYTES
    || typeof value.mimeType !== 'string' || !MIME.test(value.mimeType)
    || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    fail('ASSET_METADATA_INVALID', 'The image asset metadata is invalid or corrupt.');
  }
  return Object.freeze({ ...value });
}

async function readMetadata(directory, designId, assetId) {
  const name = `${assetId}.json`;
  let handle;
  try { handle = await directory.getFileHandle(name, { create: false }); }
  catch (error) {
    if (notFound(error)) fail('ASSET_NOT_FOUND', 'This image is not registered in the design.', error);
    fail('ASSET_METADATA_READ_FAILED', 'Could not open image asset metadata.', error);
  }
  try {
    const file = await handle.getFile();
    if (!Number.isSafeInteger(file.size) || file.size > MAX_ASSET_METADATA_BYTES) {
      fail('ASSET_METADATA_INVALID', 'The image asset metadata exceeds its safety limit.');
    }
    const text = await file.text();
    if (new TextEncoder().encode(text).byteLength > MAX_ASSET_METADATA_BYTES) {
      fail('ASSET_METADATA_INVALID', 'The image asset metadata exceeds its safety limit.');
    }
    return validateMetadata(JSON.parse(text), designId, assetId);
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    fail('ASSET_METADATA_INVALID', 'The image asset metadata is unreadable or corrupt.', error);
  }
}

function canonicalJson(value) {
  return JSON.stringify({
    formatVersion: value.formatVersion,
    designId: value.designId,
    assetId: value.assetId,
    contentHash: value.contentHash,
    byteLength: value.byteLength,
    mimeType: value.mimeType,
    createdAt: value.createdAt
  });
}

async function writeNewFile(directory, name, bytes, { binary = false } = {}) {
  let handle;
  try {
    // Refuse an existing path. Callers must verify existing immutable content first.
    handle = await directory.getFileHandle(name, { create: false });
    if (handle) fail('ASSET_PATH_COLLISION', 'An unexpected file already occupies the generated asset path.');
  } catch (error) {
    if (!notFound(error)) {
      if (error instanceof WorkspaceStoreError) throw error;
      fail('ASSET_OPEN_FAILED', 'Could not check for an existing image asset path.', error);
    }
  }
  try { handle = await directory.getFileHandle(name, { create: true }); }
  catch (error) { fail('ASSET_OPEN_FAILED', 'Could not create the image asset file.', error); }
  let writable;
  try {
    writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(binary ? bytes : new TextDecoder().decode(bytes));
    await writable.close();
  } catch (error) {
    try { await writable?.abort?.(); } catch {}
    // This path was verified absent under the workspace lock, so cleanup cannot remove
    // a previously registered or shared asset.
    try { await directory.removeEntry(name); } catch {}
    fail('ASSET_WRITE_FAILED', 'Could not durably write the image asset.', error);
  }
  const reopened = await readBytesFile(directory, name, binary ? MAX_IMAGE_ASSET_BYTES : MAX_ASSET_METADATA_BYTES, 'ASSET_VERIFY_FAILED');
  if (reopened.byteLength !== bytes.byteLength || reopened.some((byte, index) => byte !== bytes[index])) {
    try { await directory.removeEntry(name); } catch {}
    fail('ASSET_VERIFY_FAILED', 'The closed image asset did not reopen byte-for-byte.');
  }
  return reopened;
}

/**
 * Stores source image bytes as immutable content-addressed data under a design.
 * `assetId` is a logical ID; it is never treated as a path or filename.
 */
export async function saveImageAsset(workspace, designId, assetId, source, {
  mimeType = source?.type,
  maxBytes = MAX_IMAGE_ASSET_BYTES,
  crypto = globalThis.crypto,
  locks = globalThis.navigator?.locks,
  now = Date.now()
} = {}) {
  designId = assertId(designId, 'design ID');
  assetId = assertId(assetId, 'asset ID');
  assertOptions(workspace, locks, crypto);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_IMAGE_ASSET_BYTES) {
    fail('INVALID_ASSET_LIMIT', 'The configured image asset size limit is invalid.');
  }
  if (typeof mimeType !== 'string' || !MIME.test(mimeType.toLowerCase())) {
    fail('INVALID_ASSET_MIME', 'A valid image MIME type is required.');
  }
  mimeType = mimeType.toLowerCase();
  if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_OPTIONS', 'Invalid image asset creation time.');
  const bytes = await getInputBytes(source, maxBytes);
  if (bytes.byteLength === 0) fail('INVALID_ASSET_BYTES', 'Image data cannot be empty.');
  const contentHash = await hashBytes(bytes, crypto);
  const blobName = contentHash;

  return locks.request(`tiny-image-star-assets:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
    await requireWritePermission(workspace);
    const directories = await imageDirectories(workspace, designId, { create: true });
    let existingMetadata = null;
    try { existingMetadata = await readMetadata(directories.metadata, designId, assetId); }
    catch (error) { if (error.code !== 'ASSET_NOT_FOUND') throw error; }
    const metadata = {
      formatVersion: ASSET_STORE_FORMAT_VERSION,
      designId,
      assetId,
      contentHash,
      byteLength: bytes.byteLength,
      mimeType,
      createdAt: now
    };
    if (existingMetadata) {
      if (existingMetadata.contentHash !== contentHash || existingMetadata.byteLength !== bytes.byteLength) {
        fail('ASSET_ID_COLLISION', 'This asset ID already refers to different image bytes. Existing data was not changed.');
      }
      if (existingMetadata.mimeType !== mimeType) {
        fail('ASSET_ID_COLLISION', 'This asset ID already has different immutable image metadata. Existing data was not changed.');
      }
      const existingBytes = await readBytesFile(directories.blobs, blobName, maxBytes);
      if (existingBytes.byteLength !== bytes.byteLength || await hashBytes(existingBytes, crypto) !== contentHash) {
        fail('ASSET_CONTENT_CORRUPT', 'The existing content-addressed image failed integrity validation.');
      }
      return Object.freeze({ ...existingMetadata, deduplicated: true });
    }

    let blobExists = false;
    try {
      const stored = await readBytesFile(directories.blobs, blobName, maxBytes);
      blobExists = true;
      if (stored.byteLength !== bytes.byteLength || await hashBytes(stored, crypto) !== contentHash
        || stored.some((byte, index) => byte !== bytes[index])) {
        fail('ASSET_CONTENT_COLLISION', 'A content-addressed image path contains different bytes. Existing data was not changed.');
      }
    } catch (error) { if (error.code !== 'ASSET_NOT_FOUND') throw error; }
    if (!blobExists) {
      const reopened = await writeNewFile(directories.blobs, blobName, bytes, { binary: true });
      if (await hashBytes(reopened, crypto) !== contentHash) {
        try { await directories.blobs.removeEntry(blobName); } catch {}
        fail('ASSET_VERIFY_FAILED', 'The closed image asset failed its content hash check.');
      }
    }

    const metadataBytes = new TextEncoder().encode(canonicalJson(metadata));
    if (metadataBytes.byteLength > MAX_ASSET_METADATA_BYTES) fail('ASSET_METADATA_TOO_LARGE', 'The image asset metadata exceeds its safety limit.');
    await writeNewFile(directories.metadata, `${assetId}.json`, metadataBytes);
    return Object.freeze({ ...metadata, deduplicated: blobExists });
  });
}

/** Reads and verifies immutable source bytes before returning them. */
export async function readImageAsset(workspace, designId, assetId, {
  maxBytes = MAX_IMAGE_ASSET_BYTES,
  crypto = globalThis.crypto
} = {}) {
  designId = assertId(designId, 'design ID');
  assetId = assertId(assetId, 'asset ID');
  if (!workspace?.workspaceId || typeof workspace.getDesignDirectoryHandle !== 'function') {
    fail('INVALID_WORKSPACE', 'A verified workspace is required.');
  }
  if (typeof crypto?.subtle?.digest !== 'function') fail('CRYPTO_UNAVAILABLE', 'Cryptographic hashing is unavailable in this browser.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_IMAGE_ASSET_BYTES) fail('INVALID_ASSET_LIMIT', 'The configured image asset size limit is invalid.');
  const { blobs, metadata: metadataDirectory } = await imageDirectories(workspace, designId);
  const metadata = await readMetadata(metadataDirectory, designId, assetId);
  if (metadata.byteLength > maxBytes) fail('ASSET_TOO_LARGE', 'The stored image asset exceeds the configured size limit.');
  const bytes = await readBytesFile(blobs, metadata.contentHash, maxBytes);
  if (bytes.byteLength !== metadata.byteLength || await hashBytes(bytes, crypto) !== metadata.contentHash) {
    fail('ASSET_CONTENT_CORRUPT', 'The stored image failed its content integrity check.');
  }
  return Object.freeze({ metadata, bytes });
}

/** Removes only an asset's metadata reference; content blobs are retained safely. */
export async function deleteImageAsset(workspace, designId, assetId, {
  locks = globalThis.navigator?.locks,
  crypto = globalThis.crypto
} = {}) {
  designId = assertId(designId, 'design ID');
  assetId = assertId(assetId, 'asset ID');
  if (!workspace?.workspaceId || typeof workspace.getDesignDirectoryHandle !== 'function') fail('INVALID_WORKSPACE', 'A verified workspace is required.');
  if (typeof locks?.request !== 'function') fail('CROSS_TAB_LOCK_UNSUPPORTED', 'This browser cannot safely serialize image asset writes across tabs.');
  // Design commits and image collection use the same design lock. Check all retained
  // snapshots first, then fence that check with HEAD before deleting the metadata row.
  // This preserves image references needed by older recoverable design revisions.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const references = await listDesignAssetReferences(workspace, designId, { locks, crypto });
    if (references.assetIds.includes(assetId)) fail('ASSET_IN_USE', 'This image is retained by a design snapshot and cannot be removed safely.');
    const result = await locks.request(`tiny-image-star-design:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
      const design = await workspace.getDesignDirectoryHandle(designId, { create: false });
      let head;
      try {
        const metadata = await design.getDirectoryHandle('.tiny-image-star');
        const headHandle = await metadata.getFileHandle('HEAD.json');
        const file = await headHandle.getFile();
        if (!Number.isSafeInteger(file.size) || file.size > 4096) fail('DESIGN_HEAD_INVALID', 'The current design HEAD exceeds its safety limit.');
        head = JSON.parse(await file.text());
      } catch (error) {
        if (error instanceof WorkspaceStoreError) throw error;
        fail('DESIGN_HEAD_INVALID', 'Could not verify the current design revision before removing an image.', error);
      }
      if (head?.commitHash !== references.head.commitHash || head?.sequence !== references.head.sequence) return null;
      return locks.request(`tiny-image-star-assets:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
        await requireWritePermission(workspace);
        const { metadata } = await imageDirectories(workspace, designId);
        await readMetadata(metadata, designId, assetId);
        try { await metadata.removeEntry(`${assetId}.json`); }
        catch (error) { fail('ASSET_DELETE_FAILED', 'Could not remove the image asset reference.', error); }
        return true;
      });
    });
    if (result !== null) return result;
  }
  fail('DESIGN_CHANGED_RETRY', 'The design changed while image cleanup was being checked. Try again.');
}
