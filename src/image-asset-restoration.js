/**
 * Keep lazy image restoration scoped to the sources that need decoding. An
 * empty request intentionally means startup restoration of all page refs.
 */
export function scopeImageAssetReferences(references, requestedAssetIds = []) {
  if (!Array.isArray(references)) throw new TypeError('Image asset references must be a list.');
  if (!Array.isArray(requestedAssetIds)) throw new TypeError('Requested image asset IDs must be a list.');
  if (!requestedAssetIds.length) return references;
  const requested = new Set(requestedAssetIds.filter(id => typeof id === 'string' && id));
  return references.filter(reference => requested.has(reference?.assetId));
}
