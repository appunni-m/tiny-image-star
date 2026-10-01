/** Maximum source entries a document can keep in its image library. */
export const MAX_IMAGE_LIBRARY_ENTRIES = 100_000;
/** Keep library metadata inside the decoder's current per-image pixel ceiling. */
export const MAX_IMAGE_LIBRARY_SOURCE_PIXELS = 80_000_000;

const entryFields = new Set(['assetId', 'name', 'type', 'width', 'height']);
const mimeToken = /^[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Validate the persisted metadata for one original image source.
 * The source bytes live in local asset storage and are deliberately not copied
 * into the document manifest.
 */
export function isValidImageLibraryEntry(entry) {
  if (!isRecord(entry) || Object.keys(entry).some(key => !entryFields.has(key))) return false;
  const { assetId, name, type, width, height } = entry;
  if (typeof assetId !== 'string' || !assetId || assetId.length > 256
    || assetId.trim() !== assetId || /[\x00-\x20\x7f]/u.test(assetId)) return false;
  if (typeof name !== 'string' || !name.trim() || name.length > 512
    || /[\x00-\x1f\x7f/\\]/u.test(name)) return false;
  // Some browsers provide an empty File.type. A missing MIME hint is valid;
  // any supplied hint must still identify an image media type.
  if (typeof type !== 'string' || type.length > 128
    || (type !== '' && (!type.startsWith('image/') || !mimeToken.test(type.slice('image/'.length))))) return false;
  if (!Number.isSafeInteger(width) || width < 1
    || !Number.isSafeInteger(height) || height < 1) return false;
  const pixels = width * height;
  return Number.isSafeInteger(pixels) && pixels <= MAX_IMAGE_LIBRARY_SOURCE_PIXELS;
}

/** Validate a document-level list, including one-entry-per-source identity. */
export function isValidImageLibraryManifest(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_IMAGE_LIBRARY_ENTRIES) return false;
  const assetIds = new Set();
  for (const entry of entries) {
    if (!isValidImageLibraryEntry(entry) || assetIds.has(entry.assetId)) return false;
    assetIds.add(entry.assetId);
  }
  return true;
}

/** Build one safe, backward-compatible library entry from an older image reference. */
export function migrateImageLibraryEntry(reference, metadata = null) {
  if (!reference || typeof reference.assetId !== 'string') return null;
  const width = metadata?.dimensions?.width || reference.node?.sourceWidth;
  const height = metadata?.dimensions?.height || reference.node?.sourceHeight;
  const rawName = String(metadata?.name || reference.name || 'Image');
  const name = rawName.split(/[\\/]/u).at(-1)?.replace(/[\x00-\x1f\x7f]/gu, ' ').slice(0, 512).trim() || 'Image';
  const rawType = typeof metadata?.type === 'string' ? metadata.type : '';
  const type = /^image\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu.test(rawType) ? rawType : '';
  const entry = { assetId: reference.assetId, name, type, width, height };
  return isValidImageLibraryEntry(entry) ? entry : null;
}

function assertDocument(document) {
  if (!isRecord(document)) throw new TypeError('A local design document is required.');
}

function assertManifest(document) {
  assertDocument(document);
  if (!Object.hasOwn(document, 'imageLibrary')) return [];
  if (!isValidImageLibraryManifest(document.imageLibrary)) {
    throw new TypeError('The design image library is invalid.');
  }
  return document.imageLibrary;
}

function copyEntry(entry) {
  return { assetId: entry.assetId, name: entry.name, type: entry.type, width: entry.width, height: entry.height };
}

/** Return a detached list so callers cannot mutate persisted metadata by alias. */
export function listImageLibraryEntries(document) {
  return assertManifest(document).map(copyEntry);
}

/**
 * Add sources atomically and idempotently. Reusing an asset ID with different
 * metadata is rejected instead of silently renaming or resizing its source.
 */
export function addImageLibraryEntries(document, entries) {
  assertDocument(document);
  if (!Array.isArray(entries)) throw new TypeError('Image library entries must be a list.');
  const current = assertManifest(document);
  const byAssetId = new Map(current.map(entry => [entry.assetId, entry]));
  const additions = [];
  for (const entry of entries) {
    if (!isValidImageLibraryEntry(entry)) throw new TypeError('Invalid image library entry.');
    const existing = byAssetId.get(entry.assetId);
    if (existing) {
      if (existing.name !== entry.name || existing.type !== entry.type
        || existing.width !== entry.width || existing.height !== entry.height) {
        throw new TypeError(`Image asset ${entry.assetId} already exists with different metadata.`);
      }
      continue;
    }
    if (current.length + additions.length >= MAX_IMAGE_LIBRARY_ENTRIES) {
      throw new RangeError(`A design can contain up to ${MAX_IMAGE_LIBRARY_ENTRIES.toLocaleString()} image library entries.`);
    }
    const normalized = copyEntry(entry);
    byAssetId.set(normalized.assetId, normalized);
    additions.push(normalized);
  }
  if (additions.length) document.imageLibrary = [...current, ...additions];
  else if (!Object.hasOwn(document, 'imageLibrary')) document.imageLibrary = [];
  return additions.map(copyEntry);
}

/** Add one source; return a detached copy of its canonical manifest entry. */
export function addImageLibraryEntry(document, entry) {
  const added = addImageLibraryEntries(document, [entry]);
  if (added.length) return added[0];
  const existing = assertManifest(document).find(candidate => candidate.assetId === entry.assetId);
  return copyEntry(existing);
}

/** Remove metadata from the library without deleting bytes or placed layers. */
export function removeImageLibraryEntry(document, assetId) {
  const entries = assertManifest(document);
  if (typeof assetId !== 'string' || !assetId || assetId.trim() !== assetId) return false;
  const index = entries.findIndex(entry => entry.assetId === assetId);
  if (index < 0) return false;
  document.imageLibrary = entries.filter((_, entryIndex) => entryIndex !== index);
  return true;
}
