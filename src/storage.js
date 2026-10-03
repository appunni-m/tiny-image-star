import { assertDocumentTreeBounds, createId } from './model.js';
import { publishComponent, publishComponentSet, validateComponentLibrary } from './component-library.js';
import { assertSafeRasterDimensions, inspectRasterDimensions } from './image-engine.js';
import { validateLocalFontAsset } from './font-assets.js';
import { isValidImageLibraryManifest } from './image-asset-library.js';

const DB_NAME = 'figma-local-documents';
const COMPONENT_LIBRARY_DB_NAME = 'tiny-image-star-component-libraries';
const DB_VERSION = 7;
const COMPONENT_LIBRARY_DB_VERSION = 1;
export const MAX_LOCAL_DOCUMENT_VERSIONS = 30;
export const MAX_LOCAL_PACKAGE_BYTES = 128 * 1024 * 1024;
const MAX_RECIPE_BATCH_TARGET_IDS = 100_000;
const MAX_RECIPE_BATCH_ID_LENGTH = 256;
const MAX_RECIPE_BATCH_RECIPE_BYTES = 256 * 1024;
const MAX_IMAGE_ASSET_THUMBNAIL_BYTES = 48 * 1024;
const MAX_IMAGE_ASSET_THUMBNAIL_SIDE = 128;
export const RECIPE_BATCH_RECOVERY_LEASE_MS = 120_000;
// Older tabs wrote recovery rows without a renewable lease. Hold those rows
// through one bounded compatibility window before allowing a newer tab to
// take them over; they cannot heartbeat or be fenced by the new code.
export const LEGACY_RECIPE_BATCH_RECOVERY_GRACE_MS = 30 * 60_000;
const RECIPE_BATCH_STATUSES = new Set(['running', 'paused', 'cancelled', 'complete']);
const ASSET_METADATA_MIGRATION_ID = 'legacy-assets-v1-migrated';
const FONT_METADATA_MIGRATION_ID = 'font-metadata-v1-migrated';
const WORKSPACE_HANDLE_SETTING_ID = 'active-workspace-directory-handle';
const dbPromises = new Map();
let assetMetadataMigrationPromise = null;
let fontMetadataMigrationPromise = null;

export class DocumentSaveConflictError extends Error {
  constructor(documentId, expectedRevision, actualRevision) {
    super('This design was saved in another tab. Your edits need to be preserved as a separate recovery copy.');
    this.name = 'DocumentSaveConflictError';
    this.documentId = documentId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class RecipeBatchRecoveryLeaseError extends Error {
  constructor(documentId, reason = 'active', leaseExpiresAt = null) {
    const message = reason === 'active'
      ? 'This design already has an image recipe batch running in another tab.'
      : reason === 'owner'
        ? 'This tab no longer owns the image recipe recovery record.'
        : 'The image recipe recovery record changed in another tab. Reload it before continuing.';
    super(message);
    this.name = 'RecipeBatchRecoveryLeaseError';
    this.documentId = documentId;
    this.reason = reason;
    this.leaseExpiresAt = leaseExpiresAt;
  }
}

function openDatabase(name = DB_NAME, storeNames = ['documents', 'assets', 'assetMetadata', 'assetMetadataState', 'fontAssets', 'fontMetadata', 'fontMetadataState', 'versions', 'recipeBatchRecovery', 'workspaceSettings'], version = DB_VERSION) {
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
          const store = db.createObjectStore(storeName, { keyPath: storeName === 'recipeBatchRecovery' ? 'documentId' : 'id' });
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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function pngCrc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) crc = PNG_CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function validThumbnailPng(bytes) {
  if (bytes.length < 45 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let dimensions = null;
  let sawPalette = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let imageDataLength = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return false;
    const length = view.getUint32(offset, false);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    if (!Number.isSafeInteger(crcOffset) || crcOffset + 4 > bytes.length) return false;
    let type = '';
    for (let index = 0; index < 4; index += 1) type += String.fromCharCode(bytes[typeOffset + index]);
    if (pngCrc32(bytes, typeOffset, crcOffset) !== view.getUint32(crcOffset, false)) return false;

    if (!dimensions) {
      if (type !== 'IHDR' || offset !== 8 || length !== 13) return false;
      const width = view.getUint32(dataOffset, false);
      const height = view.getUint32(dataOffset + 4, false);
      const bitDepth = bytes[dataOffset + 8];
      const colorType = bytes[dataOffset + 9];
      const legalDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!width || !height || width > MAX_IMAGE_ASSET_THUMBNAIL_SIDE || height > MAX_IMAGE_ASSET_THUMBNAIL_SIDE
        || !legalDepths[colorType]?.includes(bitDepth) || bytes[dataOffset + 10] !== 0 || bytes[dataOffset + 11] !== 0
        || bytes[dataOffset + 12] > 1) return false;
      dimensions = { width, height, colorType };
    } else if (type === 'IHDR') {
      return false;
    } else if (type === 'PLTE') {
      if (sawImageData || sawPalette || length === 0 || length > 768 || length % 3 !== 0 || dimensions.colorType === 0 || dimensions.colorType === 4) return false;
      sawPalette = true;
    } else if (type === 'IDAT') {
      if (imageDataEnded || (dimensions.colorType === 3 && !sawPalette)) return false;
      sawImageData = true;
      imageDataLength += length;
      if (!Number.isSafeInteger(imageDataLength) || imageDataLength > MAX_IMAGE_ASSET_THUMBNAIL_BYTES) return false;
    } else if (type === 'IEND') {
      if (length !== 0 || !sawImageData || imageDataLength === 0 || offset + 12 !== bytes.length) return false;
      return true;
    } else {
      if (sawImageData) imageDataEnded = true;
      // Unknown critical chunks can change how pixels are interpreted. Animated
      // PNG is deliberately excluded because library thumbnails are stills.
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT' || (type[0] >= 'A' && type[0] <= 'Z')) return false;
    }
    if (sawImageData && type !== 'IDAT') imageDataEnded = true;
    offset = crcOffset + 4;
  }
  return false;
}

function validThumbnailJpeg(bytes) {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return false;
  let offset = 2;
  let sawFrame = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    if (offset + 2 > bytes.length - 2) return false;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length - 2) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (sawFrame || segmentLength < 11) return false;
      const componentCount = bytes[offset + 7];
      if (componentCount < 1 || segmentLength !== 8 + componentCount * 3) return false;
      sawFrame = true;
    }
    const segmentEnd = offset + segmentLength;
    if (marker === 0xda) {
      if (!sawFrame || segmentLength < 8 || bytes[offset + 2] < 1 || segmentLength !== 6 + bytes[offset + 2] * 2) return false;
      // The first scan's entropy-coded bytes are opaque here; the overall input
      // is capped to 48 KiB and the dimensions are validated separately.
      return segmentEnd < bytes.length - 2;
    }
    offset = segmentEnd;
  }
  return false;
}

function validatedImageThumbnailBytes(value) {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > MAX_IMAGE_ASSET_THUMBNAIL_BYTES) {
    throw new TypeError(`An image library thumbnail must be a PNG or JPEG no larger than ${MAX_IMAGE_ASSET_THUMBNAIL_BYTES / 1024} KiB.`);
  }
  const bytes = value.slice();
  const dimensions = inspectRasterDimensions(bytes);
  if (dimensions && (dimensions.width > MAX_IMAGE_ASSET_THUMBNAIL_SIDE || dimensions.height > MAX_IMAGE_ASSET_THUMBNAIL_SIDE)) {
    throw new TypeError(`An image library thumbnail must be no larger than ${MAX_IMAGE_ASSET_THUMBNAIL_SIDE} × ${MAX_IMAGE_ASSET_THUMBNAIL_SIDE} pixels.`);
  }
  const validPng = validThumbnailPng(bytes);
  const validJpeg = !validPng && validThumbnailJpeg(bytes);
  if (!validPng && !validJpeg) throw new TypeError('An image library thumbnail must be a complete, valid PNG or JPEG.');
  if (!dimensions) {
    throw new TypeError(`An image library thumbnail must be no larger than ${MAX_IMAGE_ASSET_THUMBNAIL_SIDE} × ${MAX_IMAGE_ASSET_THUMBNAIL_SIDE} pixels.`);
  }
  return bytes;
}

function imageAssetMetadata(id, name, type, sourceBytes) {
  const bytes = asBytes(sourceBytes);
  const dimensions = bytes ? inspectRasterDimensions(bytes) : null;
  return {
    id,
    name: typeof name === 'string' ? name : '',
    type: typeof type === 'string' ? type : '',
    byteLength: bytes?.byteLength ?? 0,
    dimensions: dimensions ? {
      width: dimensions.width, height: dimensions.height, pixels: dimensions.pixels,
      ...(Number.isInteger(dimensions.orientation) && dimensions.orientation !== 1 ? { orientation: dimensions.orientation } : {}),
    } : null
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

export async function saveDocument(document, options = {}) {
  const compareAndSwap = Object.hasOwn(options, 'expectedRevision');
  const expectedRevision = options.expectedRevision;
  if (compareAndSwap && !(expectedRevision === null || (Number.isSafeInteger(expectedRevision) && expectedRevision >= 0))) {
    throw new TypeError('An expected document revision must be null or a non-negative safe integer.');
  }
  const db = await openDatabase();
  const tx = db.transaction('documents', 'readwrite');
  const store = tx.objectStore('documents');
  const done = transactionDone(tx);
  let savedRevision = null;
  let conflict = null;
  const request = store.get(document.id);
  request.onsuccess = () => {
    const existing = request.result;
    const actualRevision = existing
      ? (Number.isSafeInteger(existing.revision) && existing.revision >= 0 ? existing.revision : 0)
      : null;
    if (compareAndSwap && actualRevision !== expectedRevision) {
      conflict = new DocumentSaveConflictError(document.id, expectedRevision, actualRevision);
      return;
    }
    savedRevision = (actualRevision ?? 0) + 1;
    store.put({ ...existing, id: document.id, savedAt: Date.now(), revision: savedRevision, document });
  };
  await done;
  if (conflict) throw conflict;
  return savedRevision;
}

/** Persist a user-selected directory handle locally so later launches can recheck its permission. */
export async function saveWorkspaceDirectoryHandle(handle) {
  if (!handle || handle.kind !== 'directory' || typeof handle.getDirectoryHandle !== 'function'
    || typeof handle.queryPermission !== 'function') {
    throw new TypeError('A supported writable workspace folder handle is required.');
  }
  const db = await openDatabase();
  const tx = db.transaction('workspaceSettings', 'readwrite');
  tx.objectStore('workspaceSettings').put({ id: WORKSPACE_HANDLE_SETTING_ID, handle, savedAt: Date.now() });
  await transactionDone(tx);
  return true;
}

/** Load the saved folder handle; callers must recheck its read/write permission before use. */
export async function loadWorkspaceDirectoryHandle() {
  const db = await openDatabase();
  const record = await requestResult(db.transaction('workspaceSettings').objectStore('workspaceSettings').get(WORKSPACE_HANDLE_SETTING_ID));
  const handle = record?.handle;
  return handle?.kind === 'directory' && typeof handle.getDirectoryHandle === 'function'
    && typeof handle.queryPermission === 'function' ? handle : null;
}

/** Forget the local folder reference without deleting any workspace files. */
export async function deleteWorkspaceDirectoryHandle() {
  const db = await openDatabase();
  const tx = db.transaction('workspaceSettings', 'readwrite');
  tx.objectStore('workspaceSettings').delete(WORKSPACE_HANDLE_SETTING_ID);
  await transactionDone(tx);
}

function validRecipeBatchId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_RECIPE_BATCH_ID_LENGTH;
}

function cloneRecipeBatchRecovery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !validRecipeBatchId(input.documentId) || !validRecipeBatchId(input.pageId)
    || !input.recipe || typeof input.recipe !== 'object' || Array.isArray(input.recipe)
    || !Array.isArray(input.targetIds) || input.targetIds.length < 1 || input.targetIds.length > MAX_RECIPE_BATCH_TARGET_IDS
    || !RECIPE_BATCH_STATUSES.has(input.status)) return null;
  const recipePrototype = Object.getPrototypeOf(input.recipe);
  if (recipePrototype !== Object.prototype && recipePrototype !== null) return null;

  const targetIds = new Set();
  for (const id of input.targetIds) {
    if (!validRecipeBatchId(id) || targetIds.has(id)) return null;
    targetIds.add(id);
  }

  try {
    const recipe = structuredClone(input.recipe);
    const serializedRecipe = JSON.stringify(recipe);
    if (serializedRecipe === undefined || new TextEncoder().encode(serializedRecipe).byteLength > MAX_RECIPE_BATCH_RECIPE_BYTES) return null;
    return {
      documentId: input.documentId,
      recipe,
      pageId: input.pageId,
      targetIds: [...input.targetIds],
      status: input.status,
      ownerToken: validRecipeBatchOwnerToken(input.ownerToken) ? input.ownerToken : null,
      leaseExpiresAt: Number.isFinite(input.leaseExpiresAt) ? input.leaseExpiresAt : null
    };
  } catch {
    return null;
  }
}

function validRecipeBatchOwnerToken(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_RECIPE_BATCH_ID_LENGTH;
}

function legacyRecoveryLeaseExpiresAt(record, now) {
  // Older writers always stamped savedAt. Treat malformed legacy rows without
  // a timestamp as stale instead of giving them a sliding grace period.
  const savedAt = Number.isFinite(record?.savedAt) && record.savedAt >= 0 ? record.savedAt : 0;
  return Math.min(now + LEGACY_RECIPE_BATCH_RECOVERY_GRACE_MS, savedAt + LEGACY_RECIPE_BATCH_RECOVERY_GRACE_MS);
}

function recipeRecoveryLeaseExpiresAt(record, now = Date.now()) {
  return validRecipeBatchOwnerToken(record?.ownerToken) && Number.isFinite(record?.leaseExpiresAt)
    ? record.leaseExpiresAt
    : legacyRecoveryLeaseExpiresAt(record, now);
}

/** Atomically claim a per-design recovery journal before any batch edit is admitted. */
export async function claimRecipeBatchRecovery(input = {}, options = {}) {
  const {
    expectedOwnerToken,
    replaceOwnerToken,
    now = Date.now(),
    leaseMs = RECIPE_BATCH_RECOVERY_LEASE_MS
  } = options;
  const recovery = cloneRecipeBatchRecovery(input);
  const ownerToken = input.ownerToken;
  const checksExistingOwner = Object.hasOwn(options, 'expectedOwnerToken');
  if (!recovery || !validRecipeBatchOwnerToken(ownerToken)
    || !Number.isFinite(now) || !Number.isFinite(leaseMs) || leaseMs < 1_000 || leaseMs > 24 * 60 * 60_000
    || (checksExistingOwner && expectedOwnerToken != null && !validRecipeBatchOwnerToken(expectedOwnerToken))
    || (replaceOwnerToken != null && !validRecipeBatchOwnerToken(replaceOwnerToken))) {
    throw new TypeError('Invalid image recipe batch recovery data.');
  }
  const db = await openDatabase();
  const tx = db.transaction('recipeBatchRecovery', 'readwrite');
  const store = tx.objectStore('recipeBatchRecovery');
  const done = transactionDone(tx);
  let failure = null;
  let claimed = null;
  const request = store.get(recovery.documentId);
  request.onsuccess = () => {
    const existing = request.result;
    const storedOwner = validRecipeBatchOwnerToken(existing?.ownerToken) ? existing.ownerToken : null;
    const leaseExpiresAt = existing ? recipeRecoveryLeaseExpiresAt(existing, now) : null;
    const leaseIsActive = Boolean(existing && leaseExpiresAt > now);
    const expectedMatches = checksExistingOwner && storedOwner === (expectedOwnerToken ?? null);
    const checksTransferOwner = Object.hasOwn(options, 'replaceOwnerToken');
    const transferMatches = checksTransferOwner && storedOwner === (replaceOwnerToken ?? null);

    if (!existing && (checksExistingOwner || checksTransferOwner)) {
      failure = new RecipeBatchRecoveryLeaseError(recovery.documentId, 'stale');
      return;
    }
    if (existing && checksExistingOwner && !expectedMatches) {
      failure = new RecipeBatchRecoveryLeaseError(recovery.documentId, 'stale', leaseExpiresAt);
      return;
    }
    if (existing && checksTransferOwner && !transferMatches) {
      failure = new RecipeBatchRecoveryLeaseError(recovery.documentId, 'stale', leaseExpiresAt);
      return;
    }
    if (existing && leaseIsActive && storedOwner !== ownerToken && !transferMatches) {
      failure = new RecipeBatchRecoveryLeaseError(recovery.documentId, 'active', leaseExpiresAt);
      return;
    }
    if (existing && storedOwner !== ownerToken && !transferMatches && !expectedMatches) {
      // An expired recovery point still belongs to an explicit recovery flow;
      // ordinary batch starts must not silently erase it.
      failure = new RecipeBatchRecoveryLeaseError(recovery.documentId, 'stale', leaseExpiresAt);
      return;
    }

    claimed = {
      ...recovery,
      ownerToken,
      leaseExpiresAt: now + leaseMs,
      savedAt: now
    };
    store.put(claimed);
  };
  await done;
  if (failure) throw failure;
  if (!claimed) throw new Error('The image recipe recovery lease was not acquired.');
  return { ...claimed };
}

/** Refresh an owned recovery journal; an expired owner may renew only if no tab has taken it over. */
export async function saveRecipeBatchRecovery(input = {}, { now = Date.now(), leaseMs = RECIPE_BATCH_RECOVERY_LEASE_MS } = {}) {
  const recovery = cloneRecipeBatchRecovery(input);
  const ownerToken = input.ownerToken;
  if (!recovery || !validRecipeBatchOwnerToken(ownerToken)
    || !Number.isFinite(now) || !Number.isFinite(leaseMs) || leaseMs < 1_000 || leaseMs > 24 * 60 * 60_000) {
    throw new TypeError('Invalid image recipe batch recovery data.');
  }
  const db = await openDatabase();
  const tx = db.transaction('recipeBatchRecovery', 'readwrite');
  const store = tx.objectStore('recipeBatchRecovery');
  const done = transactionDone(tx);
  let failure = null;
  const request = store.get(recovery.documentId);
  request.onsuccess = () => {
    const existing = request.result;
    if (!existing || existing.ownerToken !== ownerToken) {
      failure = new RecipeBatchRecoveryLeaseError(recovery.documentId, 'owner', existing?.leaseExpiresAt ?? null);
      return;
    }
    store.put({ ...recovery, ownerToken, leaseExpiresAt: now + leaseMs, savedAt: now });
  };
  await done;
  if (failure) throw failure;
  return { leaseExpiresAt: now + leaseMs };
}

/** Release an owned recovery lease after its batch has drained and its edits are saved. */
export async function releaseRecipeBatchRecoveryLease(documentId, ownerToken, { now = Date.now() } = {}) {
  if (!validRecipeBatchId(documentId) || !validRecipeBatchOwnerToken(ownerToken) || !Number.isFinite(now)) {
    throw new TypeError('A design ID, image recipe owner token, and valid release time are required.');
  }
  const db = await openDatabase();
  const tx = db.transaction('recipeBatchRecovery', 'readwrite');
  const store = tx.objectStore('recipeBatchRecovery');
  const done = transactionDone(tx);
  let failure = null;
  const request = store.get(documentId);
  request.onsuccess = () => {
    const existing = request.result;
    if (!existing || existing.ownerToken !== ownerToken) {
      failure = new RecipeBatchRecoveryLeaseError(documentId, 'owner', existing?.leaseExpiresAt ?? null);
      return;
    }
    store.put({ ...existing, leaseExpiresAt: now, savedAt: now });
  };
  await done;
  if (failure) throw failure;
  return { leaseExpiresAt: now };
}

/** Read a validated local recovery journal without removing corrupt rows. */
export async function loadRecipeBatchRecovery(documentId) {
  if (!validRecipeBatchId(documentId)) return null;
  const db = await openDatabase();
  const record = await requestResult(db.transaction('recipeBatchRecovery').objectStore('recipeBatchRecovery').get(documentId));
  if (!record || record.documentId !== documentId) return null;
  const recovery = cloneRecipeBatchRecovery(record);
  if (!recovery) return null;
  const savedAt = Number.isFinite(record.savedAt) ? record.savedAt : 0;
  return {
    ...recovery,
    savedAt,
    leaseExpiresAt: recovery.ownerToken && recovery.leaseExpiresAt != null
      ? recovery.leaseExpiresAt
      : legacyRecoveryLeaseExpiresAt(record, Date.now())
  };
}

/** Remove a recovery journal only when the caller still owns its run token. */
export async function deleteRecipeBatchRecovery(documentId, ownerToken) {
  if (!validRecipeBatchId(documentId)) return false;
  if (!validRecipeBatchOwnerToken(ownerToken)) throw new TypeError('An image recipe run owner token is required to clear recovery data.');
  const db = await openDatabase();
  const tx = db.transaction('recipeBatchRecovery', 'readwrite');
  const store = tx.objectStore('recipeBatchRecovery');
  let found = false;
  const request = store.get(documentId);
  let failure = null;
  request.onsuccess = () => {
    if (!request.result) return;
    if (request.result.ownerToken !== ownerToken) {
      failure = new RecipeBatchRecoveryLeaseError(documentId, 'owner', request.result.leaseExpiresAt ?? null);
      return;
    }
    found = true;
    store.delete(documentId);
  };
  await transactionDone(tx);
  if (failure) throw failure;
  return found;
}

export async function loadLatestDocument() {
  const db = await openDatabase();
  const records = await requestResult(db.transaction('documents').objectStore('documents').getAll());
  records.sort((a, b) => b.savedAt - a.savedAt);
  return records[0]?.document ?? null;
}

/** Load the newest saved document accepted by the supplied parser without changing rejected rows. */
export async function loadLatestValidDocument(parseDocument) {
  if (typeof parseDocument !== 'function') throw new TypeError('A document parser is required to load a valid local design.');
  const db = await openDatabase();
  const records = await requestResult(db.transaction('documents').objectStore('documents').getAll());
  const savedAt = record => Number.isFinite(record?.savedAt) ? record.savedAt : 0;
  records.sort((left, right) => savedAt(right) - savedAt(left)
    || String(right?.id ?? '').localeCompare(String(left?.id ?? '')));
  const invalidRecords = [];
  for (const record of records) {
    try {
      const document = parseDocument(record?.document);
      if (typeof record?.id !== 'string' || record.id !== document.id) {
        throw new TypeError('Saved design identity does not match its storage record.');
      }
      return {
        document,
        recordId: record?.id ?? null,
        savedAt: savedAt(record),
        revision: Number.isSafeInteger(record?.revision) && record.revision >= 0 ? record.revision : 0,
        invalidRecords
      };
    } catch (error) {
      invalidRecords.push({
        id: record?.id ?? null,
        savedAt: savedAt(record),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { document: null, recordId: null, savedAt: null, revision: null, invalidRecords };
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
  const record = await loadDocumentRecordById(id);
  return record?.document ?? null;
}

/** Retrieve one saved local design and its concurrency revision by stable ID. */
export async function loadDocumentRecordById(id) {
  if (typeof id !== 'string' || !id) return null;
  const db = await openDatabase();
  const record = await requestResult(db.transaction('documents').objectStore('documents').get(id));
  if (!record) return null;
  return {
    ...record,
    revision: Number.isSafeInteger(record.revision) && record.revision >= 0 ? record.revision : 0
  };
}

/** Rename a saved document. Returns false when the requested ID is absent. */
export async function renameStoredDocument(id, name, options = {}) {
  const nextName = String(name ?? '').trim();
  if (!nextName || nextName.length > 120) throw new TypeError('A design name must contain 1–120 characters.');
  const compareAndSwap = Object.hasOwn(options, 'expectedRevision');
  const expectedRevision = options.expectedRevision;
  if (compareAndSwap && !(expectedRevision === null || (Number.isSafeInteger(expectedRevision) && expectedRevision >= 0))) {
    throw new TypeError('An expected document revision must be null or a non-negative safe integer.');
  }
  const db = await openDatabase();
  const tx = db.transaction('documents', 'readwrite');
  const store = tx.objectStore('documents');
  let found = false;
  let conflict = null;
  const done = transactionDone(tx);
  const request = store.get(id);
  request.onsuccess = () => {
    const existing = request.result;
    if (!existing?.document) return;
    const actualRevision = Number.isSafeInteger(existing.revision) && existing.revision >= 0 ? existing.revision : 0;
    if (compareAndSwap && actualRevision !== expectedRevision) {
      conflict = new DocumentSaveConflictError(id, expectedRevision, actualRevision);
      return;
    }
    found = true;
    store.put({ ...existing, savedAt: Date.now(), revision: actualRevision + 1, document: { ...existing.document, name: nextName } });
  };
  await done;
  if (conflict) throw conflict;
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
    store.put({ id: duplicate.id, savedAt: Date.now(), revision: 0, document: duplicate });
  };
  await done;
  return duplicate && structuredClone(duplicate);
}

/** Delete a saved design, its local versions, and any interrupted recipe journal atomically. */
export async function deleteStoredDocument(id) {
  if (typeof id !== 'string' || !id) return false;
  const db = await openDatabase();
  const tx = db.transaction(['documents', 'versions', 'recipeBatchRecovery'], 'readwrite');
  const store = tx.objectStore('documents');
  const versions = tx.objectStore('versions');
  const recipeRecovery = tx.objectStore('recipeBatchRecovery');
  let found = false;
  let operationError = null;
  const done = transactionDone(tx);
  const request = store.get(id);
  request.onsuccess = () => {
    if (!request.result) return;
    const recoveryRequest = recipeRecovery.get(id);
    recoveryRequest.onsuccess = () => {
      const recovery = recoveryRequest.result;
      const leaseExpiresAt = recovery ? recipeRecoveryLeaseExpiresAt(recovery) : null;
      if (recovery && leaseExpiresAt > Date.now()) {
        operationError = new RecipeBatchRecoveryLeaseError(id, 'active', leaseExpiresAt);
        return;
      }
      found = true;
      store.delete(id);
      recipeRecovery.delete(id);
      const versionRequest = versions.index('byDocument').getAll(id);
      versionRequest.onsuccess = () => {
        for (const version of versionRequest.result || []) versions.delete(version.id);
      };
    };
  };
  await done;
  if (operationError) throw operationError;
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
  // Sources retained only in the document's reusable image library are still
  // part of the portable design and must travel with its package.
  if (Object.hasOwn(document, 'imageLibrary')) {
    if (!isValidImageLibraryManifest(document.imageLibrary)) {
      throw new TypeError('Local design package contains an invalid image library.');
    }
    for (const entry of document.imageLibrary) references.add(entry.assetId);
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

function validatePackageFonts(fonts, { copyBytes = true } = {}) {
  if (!Array.isArray(fonts)) throw new TypeError('Local design package fonts must be a list.');
  const seen = new Set();
  const faces = new Set();
  return fonts.map(source => {
    let font;
    try { font = validateLocalFontAsset(source, { copyBytes }); }
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

/** Publish a complete component set against the latest saved revision atomically. */
export async function publishStoredComponentSet(libraryId, set) {
  if (!validComponentLibraryId(libraryId)) throw new TypeError('A valid local component library ID is required.');
  const snapshot = structuredClone(set);
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
      const published = publishComponentSet(current, snapshot);
      const library = structuredClone(published.library);
      store.put({
        id: library.id,
        name: library.name,
        revision: library.revision,
        savedAt: Date.now(),
        library
      });
      result = {
        library,
        publication: structuredClone(published.publication),
        publications: structuredClone(published.publications)
      };
    } catch (error) {
      operationError = error;
      tx.abort();
    }
  };
  try { await done; }
  catch (error) { throw operationError || error; }
  if (!result) throw new Error('The local component-set publication did not complete.');
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

/** Save one small PNG/JPEG preview alongside an existing source's compact metadata. */
export async function saveImageAssetThumbnail(assetId, bytes) {
  if (typeof assetId !== 'string' || !assetId || assetId.length > 256 || assetId.trim() !== assetId) {
    throw new TypeError('An image library thumbnail needs a valid source asset ID.');
  }
  const thumbnail = validatedImageThumbnailBytes(bytes);
  const db = await openDatabase();
  const tx = db.transaction(['assets', 'assetMetadata'], 'readwrite');
  const assetStore = tx.objectStore('assets');
  const metadataStore = tx.objectStore('assetMetadata');
  if (typeof assetStore.getKey !== 'function') {
    throw new Error('This browser cannot verify a saved image source without loading its original bytes.');
  }
  const sourceRequest = assetStore.getKey(assetId);
  const metadataRequest = metadataStore.get(assetId);
  const done = transactionDone(tx);
  let operationError = null;
  let pendingReads = 2;
  const writeWhenReady = () => {
    pendingReads -= 1;
    if (pendingReads !== 0) return;
    if (sourceRequest.result === undefined) {
      operationError = new Error('The original image source is no longer saved. Import it again before saving a thumbnail.');
      return;
    }
    if (!metadataRequest.result) {
      operationError = new Error('The saved image source has no compact metadata record. Restore it before saving a thumbnail.');
      return;
    }
    metadataStore.put({ ...metadataRequest.result, thumbnail: thumbnail.slice().buffer });
  };
  sourceRequest.onsuccess = writeWhenReady;
  metadataRequest.onsuccess = writeWhenReady;
  sourceRequest.onerror = () => { operationError = sourceRequest.error || new Error('Could not verify the saved image source.'); };
  metadataRequest.onerror = () => { operationError = metadataRequest.error || new Error('Could not read image source metadata.'); };
  try {
    await done;
  } catch (error) {
    throw operationError || error;
  }
  if (operationError) throw operationError;
  return true;
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
  assertDocumentTreeBounds(document);
  const packageFonts = validatePackageFonts(fonts, { copyBytes: false });
  assertPackageAssetReferences(document, assets);
  const seen = new Set();
  for (const asset of assets) {
    if (!asset || typeof asset.id !== 'string' || !asset.id || seen.has(asset.id)
      || !(asset.bytes instanceof Uint8Array) || typeof asset.name !== 'string' || typeof asset.type !== 'string') {
      throw new TypeError('Local design package contains an invalid or duplicate image asset.');
    }
    seen.add(asset.id);
    try {
      // Container parsing stays byte-exact and format-agnostic so packages can
      // be inspected or round-tripped independently. The durable image store,
      // however, must never accept bytes the local decoder cannot safely size.
      assertSafeRasterDimensions(asset.bytes);
    } catch (error) {
      throw new TypeError(`Local design package image “${asset.name || asset.id}” is invalid or unsafe: ${error.message}`);
    }
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
        for (const entry of importedDocument.imageLibrary || []) {
          if (mapping.has(entry.assetId)) entry.assetId = mapping.get(entry.assetId);
        }
        documentStore.add({ id: importedDocument.id, savedAt: Date.now(), revision: 0, document: importedDocument });
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

/** Return a detached, validated thumbnail without retrieving the original source bytes. */
export async function loadImageAssetThumbnail(assetId) {
  if (typeof assetId !== 'string' || !assetId || assetId.length > 256 || assetId.trim() !== assetId) return null;
  const db = await openDatabase();
  const tx = db.transaction(['assets', 'assetMetadata'], 'readonly');
  const assetStore = tx.objectStore('assets');
  if (typeof assetStore.getKey !== 'function') return null;
  const done = transactionDone(tx);
  const [sourceKey, metadata] = await Promise.all([
    requestResult(assetStore.getKey(assetId)),
    requestResult(tx.objectStore('assetMetadata').get(assetId))
  ]);
  await done;
  if (sourceKey === undefined || !metadata?.thumbnail) return null;
  try {
    return validatedImageThumbnailBytes(asBytes(metadata.thumbnail));
  } catch {
    return null;
  }
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

function localPackageParts(design, assets, fonts = [], maxPackageBytes = MAX_LOCAL_PACKAGE_BYTES) {
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
  const packageFonts = validatePackageFonts(fonts, { copyBytes: false });
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
  if (!Number.isSafeInteger(maxPackageBytes) || maxPackageBytes < 11) throw new RangeError('Local design package size limit is invalid.');
  if (total > maxPackageBytes) {
    throw new RangeError(`This local design package is ${(total / (1024 * 1024)).toFixed(1)} MiB. The local package limit is ${Math.floor(maxPackageBytes / (1024 * 1024))} MiB; remove unused images or fonts and try again.`);
  }
  return parts;
}

export function packLocalPackage(design, assets, fonts = [], { maxBytes = MAX_LOCAL_PACKAGE_BYTES } = {}) {
  const parts = localPackageParts(design, assets, fonts, maxBytes);
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const packed = new Uint8Array(total); let offset = 0;
  for (const part of parts) { packed.set(part, offset); offset += part.byteLength; }
  return packed;
}

export function buildLocalPackageBlob(design, assets, fonts = [], { maxBytes = MAX_LOCAL_PACKAGE_BYTES } = {}) {
  // Passing validated chunks to Blob avoids a second full-size Uint8Array
  // allocation on top of the immutable Blob data, which matters on phones.
  return new Blob(localPackageParts(design, assets, fonts, maxBytes), { type: 'application/octet-stream' });
}

export function localPackageFilename(name) {
  const suffix = '.flocal';
  let stem = String(name ?? 'design')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/g, '')
    .trim();
  stem = [...stem].slice(0, 120 - suffix.length).join('').replace(/[. ]+$/g, '');
  if (!stem) stem = 'design';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `_${stem}`;
  return `${stem}${suffix}`;
}

export async function downloadLocalPackage(design, assets, fonts = []) {
  const blob = buildLocalPackageBlob(design, assets, fonts);
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(globalThis.document.createElement('a'), { href: url, download: localPackageFilename(design.name) });
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function unpackLocalPackage(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_LOCAL_PACKAGE_BYTES) {
    throw new RangeError(`This local design package is larger than the ${Math.floor(MAX_LOCAL_PACKAGE_BYTES / (1024 * 1024))} MiB local package limit.`);
  }
  const magic = [70, 76, 79, 67, 65, 76, 1];
  if (bytes.length < 11 || magic.some((value, index) => bytes[index] !== value)) throw new TypeError('Invalid local design package.');
  const manifestLength = new DataView(bytes.buffer, bytes.byteOffset + 7, 4).getUint32(0, true);
  if (manifestLength > bytes.length - 11) throw new TypeError('Invalid local design package manifest.');
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(11, 11 + manifestLength))); }
  catch { throw new TypeError('Invalid local design package manifest.'); }
  if (manifest.schema !== 'figma-local/1' || !manifest.document || !Array.isArray(manifest.assets)) throw new TypeError('Unsupported local design package.');
  if (manifest.fonts !== undefined && !Array.isArray(manifest.fonts)) throw new TypeError('Invalid local design package font manifest.');
  // Bound the untrusted layer tree before the reference walk recurses through it.
  assertDocumentTreeBounds(manifest.document);
  let offset = 11 + manifestLength;
  const assets = [];
  const seen = new Set();
  for (const entry of manifest.assets) {
    if (!entry || typeof entry.id !== 'string' || !entry.id
      || !Number.isSafeInteger(entry.length) || entry.length < 0 || offset + entry.length > bytes.length) {
      throw new TypeError('Invalid local design package asset data.');
    }
    if (seen.has(entry.id)) throw new TypeError('Invalid local design package: duplicate image asset ID.');
    // Keep asset payloads as read-only views into the bounded input package;
    // importLocalPackage makes the durable IndexedDB copy after validation.
    assets.push({ id: entry.id, name: String(entry.name || 'image'), type: String(entry.type || 'application/octet-stream'), bytes: bytes.subarray(offset, offset + entry.length) });
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
    const fontBytes = bytes.subarray(offset, offset + entry.length);
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
      }, { copyBytes: false });
    } catch (error) {
      throw new TypeError(`Invalid local design package font: ${error.message}`);
    }
    fonts.push(font);
    seenFontIds.add(entry.id);
    offset += entry.length;
  }
  if (offset !== bytes.length) throw new TypeError('Invalid local design package: unexpected trailing data.');
  assertPackageAssetReferences(manifest.document, assets);
  validatePackageFonts(fonts, { copyBytes: false });
  return { document: manifest.document, assets, fonts };
}
