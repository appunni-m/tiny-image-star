import {
  listSavedDocuments as defaultListSavedDocuments,
  loadDocumentById as defaultLoadDocumentById,
  loadImageAsset as defaultLoadImageAsset,
  listFontAssets as defaultListFontAssets,
  loadFontAsset as defaultLoadFontAsset
} from '../storage.js';
import { createDocument, parseDocument, serializeDocument } from '../model.js';
import {
  MAX_DESIGN_SNAPSHOT_BYTES,
  commitDesign as defaultCommitDesign,
  createDesign as defaultCreateDesign,
  openDesign as defaultOpenDesign
} from './design-store.js';
import {
  MAX_IMAGE_ASSET_BYTES,
  readImageAsset as defaultReadImageAsset,
  saveImageAsset as defaultSaveImageAsset
} from './asset-store.js';
import {
  MAX_LOCAL_FONT_BYTES,
  validateLocalFontAsset
} from '../font-assets.js';
import {
  readWorkspaceFontAsset as defaultReadWorkspaceFontAsset,
  saveWorkspaceFontAsset as defaultSaveWorkspaceFontAsset
} from './font-store.js';
import { WorkspaceStoreError } from './workspace-store.js';

export const INDEXED_DB_MIGRATION_FORMAT_VERSION = 1;
export const INDEXED_DB_MIGRATION_FILE = 'indexeddb-migration.json';
export const MAX_MIGRATION_DESIGNS = 10_000;
export const MAX_MIGRATION_JOURNAL_BYTES = 8 * 1024 * 1024;

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const IMAGE_MIME = /^image\/[a-z0-9][a-z0-9.+-]{0,63}$/i;
const encoder = new TextEncoder();

function fail(code, message, cause) {
  throw new WorkspaceStoreError(code, message, cause);
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

async function hashBytes(bytes, crypto) {
  if (typeof crypto?.subtle?.digest !== 'function') fail('CRYPTO_UNAVAILABLE', 'Cryptographic hashing is unavailable in this browser.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashText(text, crypto) {
  return hashBytes(encoder.encode(text), crypto);
}

function asBytes(value, maxBytes, label) {
  let bytes;
  if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else if (typeof Blob !== 'undefined' && value instanceof Blob) {
    fail('MIGRATION_ASSET_INVALID', `${label} must be loaded as bounded bytes before migration.`);
  } else fail('MIGRATION_ASSET_MISSING', `${label} has no readable source bytes.`);
  if (!Number.isSafeInteger(bytes.byteLength) || bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    fail(bytes.byteLength > maxBytes ? 'MIGRATION_ASSET_TOO_LARGE' : 'MIGRATION_ASSET_INVALID', `${label} is empty or exceeds its safety limit.`);
  }
  return bytes;
}

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !ID.test(value) || value === '.' || value === '..') {
    fail('MIGRATION_INVALID_ID', `The saved ${label} has an unsafe ID and cannot be migrated.`);
  }
  return value;
}

function normalizedFamily(value) {
  return value.trim().replace(/^(["'])(.*)\1$/u, '$2').trim().toLocaleLowerCase('en-US');
}

function familyList(value) {
  const output = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (const character of value) {
    if (escaped) { current += character; escaped = false; continue; }
    if (character === '\\' && quote) { current += character; escaped = true; continue; }
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? '' : character;
      current += character;
      continue;
    }
    if (character === ',' && !quote) {
      const family = normalizedFamily(current);
      if (family) output.push(family);
      current = '';
      continue;
    }
    current += character;
  }
  const last = normalizedFamily(current);
  if (last) output.push(last);
  return [...new Set(output)];
}

function normalizeWeight(value, fallback) {
  if (value == null) return fallback;
  const weight = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  return Number.isInteger(weight) && weight >= 1 && weight <= 1000 ? weight : fallback;
}

/**
 * Walk the entire serialized design graph, including component trees and nested overrides.
 * The walk is deliberately schema-agnostic so newly nested image/font references are included.
 */
export function collectReferencedAssets(document, { maxNodes = 1_000_000, maxDepth = 128 } = {}) {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || !Number.isSafeInteger(maxDepth) || maxDepth < 1) {
    fail('MIGRATION_INVALID_LIMIT', 'The design traversal limit is invalid.');
  }
  const images = new Set();
  const fontSpecs = new Map();
  const visited = new WeakSet();
  let nodes = 0;
  const walk = (value, inheritedFont, depth) => {
    if (value === null || typeof value !== 'object') return;
    if (depth > maxDepth) fail('MIGRATION_DOCUMENT_TOO_DEEP', 'The saved design is too deeply nested to migrate safely.');
    if (visited.has(value)) return;
    visited.add(value);
    nodes += 1;
    if (nodes > maxNodes) fail('MIGRATION_DOCUMENT_TOO_LARGE', 'The saved design contains too many nested records to migrate safely.');
    const nextFont = { ...inheritedFont };
    if (typeof value.fontFamily === 'string' && value.fontFamily.trim()) nextFont.family = value.fontFamily;
    if (Object.hasOwn(value, 'fontWeight') && value.fontWeight != null) nextFont.weight = normalizeWeight(value.fontWeight, nextFont.weight ?? 400);
    if (Object.hasOwn(value, 'fontStyle') && value.fontStyle != null) nextFont.style = value.fontStyle === 'italic' ? 'italic' : 'normal';
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'assetId' || key === 'backgroundRemovalSourceAssetId' || key === 'backgroundRemovalAssetId'
        || key === 'resolutionBoostSourceAssetId' || key === 'resolutionBoostAssetId'
        || /imageAssetId$/iu.test(key)) && typeof child === 'string' && child) images.add(child);
    }
    if (typeof nextFont.family === 'string' && nextFont.family.trim()
      && (typeof value.fontFamily === 'string' || Object.hasOwn(value, 'fontWeight') || Object.hasOwn(value, 'fontStyle'))) {
      const families = familyList(nextFont.family);
      for (const family of families) {
        const key = `${family}\u0000${nextFont.weight ?? 400}\u0000${nextFont.style ?? 'normal'}`;
        fontSpecs.set(key, { family, weight: nextFont.weight ?? 400, style: nextFont.style ?? 'normal' });
      }
    }
    for (const child of Object.values(value)) walk(child, nextFont, depth + 1);
  };
  walk(document, { weight: 400, style: 'normal' }, 0);
  return Object.freeze({
    imageAssetIds: Object.freeze([...images].sort()),
    fontSpecs: Object.freeze([...fontSpecs.values()].sort((left, right) => left.family.localeCompare(right.family)
      || left.weight - right.weight || left.style.localeCompare(right.style)))
  });
}

function resolveReferencedFonts(fontRecords, fontSpecs) {
  if (!Array.isArray(fontRecords)) fail('MIGRATION_FONT_CATALOG_INVALID', 'The local font catalog could not be read.');
  const byFamily = new Map();
  for (const record of fontRecords) {
    if (!record || typeof record.id !== 'string' || typeof record.family !== 'string'
      || !Number.isInteger(record.weight) || !['normal', 'italic'].includes(record.style)) continue;
    const family = normalizedFamily(record.family);
    if (!family) continue;
    const records = byFamily.get(family) || [];
    records.push(record);
    byFamily.set(family, records);
  }
  const selected = new Map();
  for (const spec of fontSpecs) {
    const familyRecords = byFamily.get(spec.family);
    // Fonts absent from the user's local catalog are platform fallback families.
    if (!familyRecords) continue;
    const match = familyRecords.find(record => record.weight === spec.weight && record.style === spec.style);
    if (!match) fail('MIGRATION_FONT_VARIANT_MISSING', `Local font ${spec.family} (${spec.weight} ${spec.style}) is referenced but that face is missing.`);
    assertSafeId(match.id, 'font');
    selected.set(match.id, match);
  }
  return [...selected.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function validateImageSource(asset, assetId) {
  if (!asset || typeof asset !== 'object' || asset.id !== assetId) fail('MIGRATION_ASSET_MISSING', `Referenced image ${assetId} is missing from local storage.`);
  const bytes = asBytes(asset.bytes, MAX_IMAGE_ASSET_BYTES, `Image ${assetId}`);
  const mimeType = String(asset.type || asset.mimeType || '').toLowerCase();
  if (!IMAGE_MIME.test(mimeType)) fail('MIGRATION_ASSET_INVALID', `Image ${assetId} has invalid MIME metadata.`);
  return { bytes, mimeType };
}

function validateFontSource(asset, expectedId) {
  if (!asset || typeof asset !== 'object' || asset.id !== expectedId) fail('MIGRATION_FONT_MISSING', `Referenced local font ${expectedId} is missing from local storage.`);
  const bytes = asBytes(asset.bytes, MAX_LOCAL_FONT_BYTES, `Font ${expectedId}`);
  try { return validateLocalFontAsset({ ...asset, bytes }, { copyBytes: false }); }
  catch (error) { fail('MIGRATION_FONT_INVALID', `Local font ${expectedId} is invalid.`, error); }
}

async function readJournal(workspace, crypto) {
  const metadata = workspace?.metadataDirectory;
  if (!metadata || typeof metadata.getFileHandle !== 'function') fail('INVALID_WORKSPACE', 'The selected workspace metadata folder is unavailable.');
  let handle;
  try { handle = await metadata.getFileHandle(INDEXED_DB_MIGRATION_FILE, { create: false }); }
  catch (error) {
    if (error?.name === 'NotFoundError') return null;
    fail('MIGRATION_JOURNAL_READ_FAILED', 'Could not inspect the workspace migration journal.', error);
  }
  try {
    const file = await handle.getFile();
    if (!Number.isSafeInteger(file.size) || file.size > MAX_MIGRATION_JOURNAL_BYTES) fail('MIGRATION_JOURNAL_INVALID', 'The workspace migration journal exceeds its safety limit.');
    const text = await file.text();
    if (encoder.encode(text).byteLength > MAX_MIGRATION_JOURNAL_BYTES) fail('MIGRATION_JOURNAL_INVALID', 'The workspace migration journal exceeds its safety limit.');
    const journal = JSON.parse(text);
    if (!journal || typeof journal !== 'object' || Array.isArray(journal)
      || journal.formatVersion !== INDEXED_DB_MIGRATION_FORMAT_VERSION
      || journal.kind !== 'tiny-image-star-indexeddb-migration'
      || journal.workspaceId !== workspace.workspaceId
      || !Array.isArray(journal.sources) || !Array.isArray(journal.designs)
      || journal.sources.length > MAX_MIGRATION_DESIGNS || journal.designs.length > MAX_MIGRATION_DESIGNS
      || typeof journal.migrationId !== 'string' || !/^[a-f0-9]{64}$/u.test(journal.migrationId)
      || typeof journal.complete !== 'boolean') {
      fail('MIGRATION_JOURNAL_CONFLICT', 'The workspace contains unrelated or invalid migration data. It was left untouched.');
    }
    const phases = new Set(['queued', 'load', 'creating', 'copying-assets', 'design-verify', 'final-commit', 'complete']);
    const statuses = new Set(['pending', 'error', 'complete']);
    if (journal.designs.some((item, index) => !item || typeof item !== 'object' || item.id !== journal.sources[index]?.id
      || !statuses.has(item.status) || !phases.has(item.phase)
      || !(item.sourceHash === null || /^[a-f0-9]{64}$/u.test(item.sourceHash))
      || !(item.stagingHash == null || /^[a-f0-9]{64}$/u.test(item.stagingHash))
      || !Array.isArray(item.imageAssetIds) || !Array.isArray(item.completedImageAssetIds)
      || !Array.isArray(item.imageFingerprints ?? []) || !Array.isArray(item.fontIds)
      || !Array.isArray(item.fontFingerprints ?? []) || !Array.isArray(item.completedFontIds)
      || item.imageAssetIds.some(id => typeof id !== 'string' || !ID.test(id))
      || item.fontIds.some(id => typeof id !== 'string' || !ID.test(id))
      || (item.error != null && (typeof item.error !== 'object' || typeof item.error.code !== 'string' || typeof item.error.message !== 'string')))) {
      fail('MIGRATION_JOURNAL_INVALID', 'The workspace migration journal contains invalid progress data.');
    }
    if (journal.complete && journal.designs.some(item => item.status !== 'complete')) {
      fail('MIGRATION_JOURNAL_INVALID', 'The migration journal claims completion while designs remain unfinished.');
    }
    const expectedId = await hashText(stableJson(journal.sources), crypto);
    if (expectedId !== journal.migrationId) fail('MIGRATION_JOURNAL_INVALID', 'The workspace migration journal failed its identity check.');
    return journal;
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    fail('MIGRATION_JOURNAL_INVALID', 'The workspace migration journal is unreadable or corrupt.', error);
  }
}

async function writeJournal(workspace, journal) {
  const text = stableJson(journal);
  if (encoder.encode(text).byteLength > MAX_MIGRATION_JOURNAL_BYTES) fail('MIGRATION_JOURNAL_TOO_LARGE', 'The workspace migration journal exceeds its safety limit.');
  let handle;
  try { handle = await workspace.metadataDirectory.getFileHandle(INDEXED_DB_MIGRATION_FILE, { create: true }); }
  catch (error) { fail('MIGRATION_JOURNAL_WRITE_FAILED', 'Could not write the workspace migration journal.', error); }
  let writable;
  try {
    writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(text);
    await writable.close();
  } catch (error) {
    try { await writable?.abort?.(); } catch {}
    fail('MIGRATION_JOURNAL_WRITE_FAILED', 'Could not durably update the workspace migration journal.', error);
  }
  try {
    const reopened = await handle.getFile();
    const verified = await reopened.text();
    if (verified !== text || stableJson(JSON.parse(verified)) !== text) fail('MIGRATION_JOURNAL_VERIFY_FAILED', 'The closed workspace migration journal did not reopen correctly.');
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    fail('MIGRATION_JOURNAL_VERIFY_FAILED', 'The closed workspace migration journal could not be verified.', error);
  }
}

function validateSourceRows(rows) {
  if (!Array.isArray(rows)) fail('MIGRATION_SOURCE_INVALID', 'The local design library could not be listed.');
  if (rows.length > MAX_MIGRATION_DESIGNS) fail('MIGRATION_SOURCE_TOO_LARGE', 'The local design library exceeds the migration design-count limit.');
  const seen = new Set();
  return rows.map(row => {
    const id = assertSafeId(row?.id, 'design');
    if (seen.has(id)) fail('MIGRATION_SOURCE_INVALID', 'The local design library contains duplicate IDs.');
    seen.add(id);
    if (!Number.isFinite(row.savedAt) || row.savedAt < 0) fail('MIGRATION_SOURCE_INVALID', `Saved design ${id} has invalid metadata.`);
    return { id, name: typeof row.name === 'string' ? row.name : 'Untitled', savedAt: row.savedAt };
  });
}

function sameSources(left, right) { return stableJson(left) === stableJson(right); }

function asMigrationError(error, phase) {
  const code = typeof error?.code === 'string' ? error.code : 'MIGRATION_DESIGN_FAILED';
  const message = String(error?.message || 'The saved design could not be migrated.').slice(0, 500);
  return { code, message, phase };
}

function notify(callback, value) {
  if (typeof callback !== 'function') return;
  try { callback(Object.freeze({ ...value })); } catch { /* Progress listeners cannot interrupt durable migration work. */ }
}

async function designDirectoryExists(workspace, designId) {
  try { await workspace.getDesignDirectoryHandle(designId, { create: false }); return true; }
  catch (error) {
    if (error?.code === 'DESIGN_NOT_FOUND' || error?.name === 'NotFoundError') return false;
    throw error;
  }
}

async function prepareSourceDesign(id, dependencies, crypto) {
  const loaded = await dependencies.loadDocumentById(id);
  if (!loaded) fail('MIGRATION_SOURCE_MISSING', `Saved design ${id} is missing from local storage.`);
  let document;
  let snapshot;
  try {
    document = parseDocument(loaded);
    snapshot = serializeDocument(document);
  } catch (error) { fail('MIGRATION_SOURCE_INVALID', `Saved design ${id} failed document validation.`, error); }
  if (encoder.encode(snapshot).byteLength > MAX_DESIGN_SNAPSHOT_BYTES) fail('MIGRATION_DESIGN_TOO_LARGE', `Saved design ${id} exceeds the workspace snapshot limit.`);
  const sourceHash = await hashText(snapshot, crypto);
  const references = collectReferencedAssets(document);
  const fontCatalog = await dependencies.listFontAssets();
  const fonts = resolveReferencedFonts(fontCatalog, references.fontSpecs);

  // Validate every referenced source before creating a workspace design folder.
  // Only one large binary is resident at a time; copy and verification are repeated later.
  const imageFingerprints = [];
  for (const assetId of references.imageAssetIds) {
    assertSafeId(assetId, 'image asset');
    const sourceAsset = await dependencies.loadImageAsset(assetId);
    const { bytes, mimeType } = validateImageSource(sourceAsset, assetId);
    imageFingerprints.push({ id: assetId, contentHash: await hashBytes(bytes, crypto), byteLength: bytes.byteLength, mimeType });
  }
  const fontFingerprints = [];
  for (const font of fonts) {
    const sourceFont = validateFontSource(await dependencies.loadFontAsset(font.id), font.id);
    fontFingerprints.push({ id: sourceFont.id, contentHash: await hashBytes(sourceFont.bytes, crypto), byteLength: sourceFont.bytes.byteLength,
      name: sourceFont.name, type: sourceFont.type, family: sourceFont.family, weight: sourceFont.weight, style: sourceFont.style });
  }
  const stagingDocument = createStagingDocument(document);
  const stagingSnapshot = serializeDocument(stagingDocument);
  return { document, snapshot, sourceHash, stagingDocument, stagingSnapshot,
    imageAssetIds: references.imageAssetIds, imageFingerprints, fonts, fontFingerprints };
}

function createStagingDocument(document) {
  // Create a minimal, valid initial revision with the original design/page identities but no
  // asset references. The final full snapshot is committed only after every image is durable.
  const staged = createDocument();
  staged.id = document.id;
  staged.name = document.name;
  staged.pages = document.pages.map(page => ({ id: page.id, name: page.name, children: [], guides: [] }));
  staged.activePageId = document.activePageId;
  return parseDocument(staged);
}

async function copyAndVerifyImage(workspace, designId, assetId, fingerprint, dependencies, options) {
  const sourceAsset = await dependencies.loadImageAsset(assetId);
  const { bytes, mimeType } = validateImageSource(sourceAsset, assetId);
  const expectedHash = await hashBytes(bytes, options.crypto);
  if (fingerprint && (fingerprint.contentHash !== expectedHash || fingerprint.byteLength !== bytes.byteLength || fingerprint.mimeType !== mimeType)) {
    fail('MIGRATION_SOURCE_CHANGED', `Image ${assetId} changed while migration was in progress.`);
  }
  await dependencies.saveImageAsset(workspace, designId, assetId, bytes, {
    mimeType, maxBytes: MAX_IMAGE_ASSET_BYTES, crypto: options.crypto, locks: options.locks, now: options.now
  });
  const reopened = await dependencies.readImageAsset(workspace, designId, assetId, { crypto: options.crypto, maxBytes: MAX_IMAGE_ASSET_BYTES });
  const reopenedBytes = asBytes(reopened?.bytes, MAX_IMAGE_ASSET_BYTES, `Reopened image ${assetId}`);
  if (reopened?.metadata?.assetId !== assetId || reopened.metadata.byteLength !== bytes.byteLength
    || reopened.metadata.contentHash !== expectedHash || reopenedBytes.byteLength !== bytes.byteLength
    || await hashBytes(reopenedBytes, options.crypto) !== expectedHash
    || reopenedBytes.some((value, index) => value !== bytes[index])) {
    fail('MIGRATION_ASSET_VERIFY_FAILED', `Image ${assetId} did not reopen with its original bytes.`);
  }
}

async function copyAndVerifyFont(workspace, designId, fontId, fingerprint, dependencies, options) {
  const font = validateFontSource(await dependencies.loadFontAsset(fontId), fontId);
  const expectedHash = await hashBytes(font.bytes, options.crypto);
  if (fingerprint && (fingerprint.contentHash !== expectedHash || fingerprint.byteLength !== font.bytes.byteLength
    || fingerprint.name !== font.name || fingerprint.type !== font.type || fingerprint.family !== font.family
    || fingerprint.weight !== font.weight || fingerprint.style !== font.style)) {
    fail('MIGRATION_SOURCE_CHANGED', `Local font ${fontId} changed while migration was in progress.`);
  }
  await dependencies.saveWorkspaceFontAsset(workspace, designId, font, {
    crypto: options.crypto, locks: options.locks, now: options.now
  });
  const reopened = await dependencies.readWorkspaceFontAsset(workspace, designId, fontId, { crypto: options.crypto });
  const reopenedBytes = asBytes(reopened?.bytes, MAX_LOCAL_FONT_BYTES, `Reopened font ${fontId}`);
  const metadata = reopened?.metadata;
  if (metadata?.fontId !== fontId || metadata.size !== font.bytes.byteLength || metadata.contentHash !== expectedHash
    || metadata.name !== font.name || metadata.type !== font.type || metadata.family !== font.family
    || metadata.weight !== font.weight || metadata.style !== font.style
    || reopenedBytes.byteLength !== font.bytes.byteLength || await hashBytes(reopenedBytes, options.crypto) !== expectedHash
    || reopenedBytes.some((value, index) => value !== font.bytes[index])) {
    fail('MIGRATION_FONT_VERIFY_FAILED', `Font ${fontId} did not reopen with its original bytes and metadata.`);
  }
}

async function ensureDesign(workspace, item, prepared, dependencies, options) {
  const exists = await designDirectoryExists(workspace, item.id);
  let opened;
  if (exists) {
    if (item.phase === 'queued') fail('MIGRATION_DESTINATION_CONFLICT', `Workspace design ${item.id} already exists and is not owned by this migration.`);
    try { opened = await dependencies.openDesign(workspace, item.id, { crypto: options.crypto, locks: options.locks }); }
    catch (error) { fail('MIGRATION_DESTINATION_CONFLICT', `Workspace design ${item.id} exists but cannot be verified as a resumable migration.`, error); }
    const currentSnapshot = serializeDocument(parseDocument(opened.document));
    if (currentSnapshot !== prepared.snapshot && currentSnapshot !== prepared.stagingSnapshot) {
      fail('MIGRATION_DESTINATION_CONFLICT', `Workspace design ${item.id} contains different data. Existing workspace files were left untouched.`);
    }
    return { opened, alreadyFinal: currentSnapshot === prepared.snapshot };
  }
  if (item.phase !== 'queued' && item.phase !== 'creating') {
    fail('MIGRATION_DESTINATION_MISSING', `Workspace design ${item.id} disappeared during migration.`);
  }
  if (item.phase === 'queued') {
    item.phase = 'creating';
    await options.persist();
  }
  try {
    await dependencies.createDesign(workspace, prepared.stagingDocument, { crypto: options.crypto, locks: options.locks, now: options.now });
  } catch (error) {
    // A concurrent migration may have completed createDesign after this tab's existence check.
    if (!await designDirectoryExists(workspace, item.id)) throw error;
  }
  try { opened = await dependencies.openDesign(workspace, item.id, { crypto: options.crypto, locks: options.locks }); }
  catch (error) { fail('MIGRATION_DESIGN_VERIFY_FAILED', `Workspace design ${item.id} did not reopen after creation.`, error); }
  const currentSnapshot = serializeDocument(parseDocument(opened.document));
  if (currentSnapshot !== prepared.stagingSnapshot && currentSnapshot !== prepared.snapshot) {
    fail('MIGRATION_DESTINATION_CONFLICT', `Workspace design ${item.id} contains different data. Existing workspace files were left untouched.`);
  }
  return { opened, alreadyFinal: currentSnapshot === prepared.snapshot };
}

/**
 * Copy the saved IndexedDB library into the selected workspace without deleting or mutating
 * IndexedDB. The journal and exclusive Web Lock make retries safe after interrupted writes.
 */
export async function migrateIndexedDbToWorkspace(workspace, {
  storage = {},
  createDesign = defaultCreateDesign,
  openDesign = defaultOpenDesign,
  commitDesign = defaultCommitDesign,
  saveImageAsset = defaultSaveImageAsset,
  readImageAsset = defaultReadImageAsset,
  saveWorkspaceFontAsset = defaultSaveWorkspaceFontAsset,
  readWorkspaceFontAsset = defaultReadWorkspaceFontAsset,
  locks = globalThis.navigator?.locks,
  crypto = globalThis.crypto,
  now = Date.now(),
  onProgress
} = {}) {
  const dependencies = {
    listSavedDocuments: storage.listSavedDocuments || defaultListSavedDocuments,
    loadDocumentById: storage.loadDocumentById || defaultLoadDocumentById,
    loadImageAsset: storage.loadImageAsset || defaultLoadImageAsset,
    listFontAssets: storage.listFontAssets || defaultListFontAssets,
    loadFontAsset: storage.loadFontAsset || defaultLoadFontAsset,
    createDesign, openDesign, commitDesign, saveImageAsset, readImageAsset, saveWorkspaceFontAsset, readWorkspaceFontAsset
  };
  if (!workspace?.workspaceId || !workspace.metadataDirectory || typeof workspace.getDesignDirectoryHandle !== 'function') {
    fail('INVALID_WORKSPACE', 'A verified workspace is required for migration.');
  }
  if (typeof locks?.request !== 'function') fail('CROSS_TAB_LOCK_UNSUPPORTED', 'This browser cannot safely serialize workspace migration across tabs.');
  if (typeof crypto?.subtle?.digest !== 'function') fail('CRYPTO_UNAVAILABLE', 'Cryptographic hashing is unavailable in this browser.');
  if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_OPTIONS', 'Invalid migration timestamp.');
  for (const [name, method] of Object.entries(dependencies)) {
    if (typeof method !== 'function') fail('MIGRATION_DEPENDENCY_MISSING', `Migration dependency ${name} is unavailable.`);
  }
  return locks.request(`tiny-image-star-migration:${workspace.workspaceId}`, { mode: 'exclusive' }, async () => {
    const sources = validateSourceRows(await dependencies.listSavedDocuments());
    const migrationId = await hashText(stableJson(sources), crypto);
    let journal = await readJournal(workspace, crypto);
    const resumedMigration = Boolean(journal);
    if (journal) {
      if (journal.migrationId !== migrationId || !sameSources(journal.sources, sources)
        || journal.designs.length !== sources.length
        || journal.designs.some((item, index) => item.id !== sources[index].id || typeof item.phase !== 'string')) {
        fail('MIGRATION_SOURCE_CHANGED', 'The saved design library changed after migration began. Existing migration data was left untouched.');
      }
      if (journal.complete) return Object.freeze({ status: 'complete', migrationId, designCount: sources.length,
        migratedDesigns: sources.length, errors: Object.freeze([]), resumed: true });
    } else {
      journal = {
        formatVersion: INDEXED_DB_MIGRATION_FORMAT_VERSION,
        kind: 'tiny-image-star-indexeddb-migration',
        workspaceId: workspace.workspaceId,
        migrationId,
        sources,
        startedAt: now,
        updatedAt: now,
        complete: false,
        completedAt: null,
        designs: sources.map(source => ({ id: source.id, name: source.name, status: 'pending', phase: 'queued', sourceHash: null,
          imageAssetIds: [], completedImageAssetIds: [], imageFingerprints: [], fontIds: [], fontFingerprints: [], completedFontIds: [], error: null }))
      };
      await writeJournal(workspace, journal);
    }

    const errors = [];
    const persist = async () => {
      journal.updatedAt = Date.now();
      await writeJournal(workspace, journal);
    };
    for (let index = 0; index < journal.designs.length; index += 1) {
      const item = journal.designs[index];
      if (item.status === 'complete') continue;
      let phase = 'load';
      try {
        notify(onProgress, { phase, designId: item.id, designName: item.name, designIndex: index, designCount: journal.designs.length, status: 'running' });
        const prepared = await prepareSourceDesign(item.id, dependencies, crypto);
        if (item.sourceHash && item.sourceHash !== prepared.sourceHash) {
          fail('MIGRATION_SOURCE_CHANGED', `Saved design ${item.id} changed since migration began. Its workspace copy was left untouched.`);
        }
        if (item.stagingHash && item.stagingHash !== await hashText(prepared.stagingSnapshot, crypto)) {
          fail('MIGRATION_SOURCE_CHANGED', `The staging identity for ${item.id} changed after migration began.`);
        }
        if (item.imageFingerprints?.length && stableJson(item.imageFingerprints) !== stableJson(prepared.imageFingerprints)) {
          fail('MIGRATION_SOURCE_CHANGED', `Referenced image data for ${item.id} changed after migration began.`);
        }
        if (item.fontFingerprints?.length && stableJson(item.fontFingerprints) !== stableJson(prepared.fontFingerprints)) {
          fail('MIGRATION_SOURCE_CHANGED', `Referenced local font data for ${item.id} changed after migration began.`);
        }
        item.sourceHash = prepared.sourceHash;
        item.stagingHash = await hashText(prepared.stagingSnapshot, crypto);
        item.imageAssetIds = [...prepared.imageAssetIds];
        item.imageFingerprints = prepared.imageFingerprints;
        item.fontIds = prepared.fonts.map(font => font.id);
        item.fontFingerprints = prepared.fontFingerprints;
        item.status = 'pending';
        item.error = null;
        await persist();

        phase = 'design';
        await ensureDesign(workspace, item, prepared, dependencies, { crypto, locks, now, persist });
        item.phase = 'copying-assets';
        await persist();
        for (let assetIndex = 0; assetIndex < prepared.imageAssetIds.length; assetIndex += 1) {
          const assetId = prepared.imageAssetIds[assetIndex];
          phase = 'image';
          const fingerprint = prepared.imageFingerprints.find(entry => entry.id === assetId);
          await copyAndVerifyImage(workspace, item.id, assetId, fingerprint, dependencies, { crypto, locks, now });
          if (!item.completedImageAssetIds.includes(assetId)) item.completedImageAssetIds.push(assetId);
          await persist();
          notify(onProgress, { phase, designId: item.id, assetId, assetIndex, assetCount: prepared.imageAssetIds.length, status: 'verified' });
        }
        for (let fontIndex = 0; fontIndex < prepared.fonts.length; fontIndex += 1) {
          const font = prepared.fonts[fontIndex];
          phase = 'font';
          const fingerprint = prepared.fontFingerprints.find(entry => entry.id === font.id);
          await copyAndVerifyFont(workspace, item.id, font.id, fingerprint, dependencies, { crypto, locks, now });
          if (!item.completedFontIds.includes(font.id)) item.completedFontIds.push(font.id);
          await persist();
          notify(onProgress, { phase, designId: item.id, fontId: font.id, fontIndex, fontCount: prepared.fonts.length, status: 'verified' });
        }
        phase = 'design-verify';
        let reopened = await dependencies.openDesign(workspace, item.id, { crypto, locks });
        let reopenedSnapshot = serializeDocument(parseDocument(reopened.document));
        if (reopenedSnapshot === prepared.stagingSnapshot) {
          phase = 'final-commit';
          const pageId = prepared.document.pages[0]?.id;
          if (!pageId) fail('MIGRATION_SOURCE_INVALID', `Saved design ${item.id} has no page to commit.`);
          const committed = await dependencies.commitDesign(workspace, item.id, prepared.document, {
            expectedHead: reopened.head, pageId, crypto, locks
          });
          if (committed?.acknowledged !== true) fail('MIGRATION_COMMIT_NOT_ACKNOWLEDGED', `The final snapshot for ${item.id} was not durably acknowledged.`);
          reopened = await dependencies.openDesign(workspace, item.id, { crypto, locks });
          reopenedSnapshot = serializeDocument(parseDocument(reopened.document));
        }
        if (reopenedSnapshot !== prepared.snapshot) fail('MIGRATION_DESIGN_VERIFY_FAILED', `Workspace design ${item.id} changed while assets were being copied.`);
        item.status = 'complete';
        item.phase = 'complete';
        item.error = null;
        await persist();
        notify(onProgress, { phase: 'design', designId: item.id, designName: item.name, designIndex: index, designCount: journal.designs.length, status: 'complete' });
      } catch (error) {
        const recorded = asMigrationError(error, phase);
        item.status = 'error';
        item.error = recorded;
        errors.push(Object.freeze({ designId: item.id, ...recorded }));
        await persist();
        notify(onProgress, { phase: 'design', designId: item.id, designName: item.name, designIndex: index, designCount: journal.designs.length, status: 'error', error: recorded });
      }
    }
    const allComplete = journal.designs.every(item => item.status === 'complete');
    if (allComplete) {
      journal.complete = true;
      journal.completedAt = Date.now();
      await persist();
    }
    return Object.freeze({ status: allComplete ? 'complete' : 'partial', migrationId, designCount: sources.length,
      migratedDesigns: journal.designs.filter(item => item.status === 'complete').length,
      errors: Object.freeze(errors), resumed: resumedMigration });
  });
}
