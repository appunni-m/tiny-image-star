/** Resolve resolution boost for one recipe target without copying source pixels. */
export function planResolutionBoostRecipe(node, enabled) {
  if (node?.type !== 'image') throw new TypeError('Resolution boost recipes require an image layer.');
  if (typeof enabled !== 'boolean') throw new TypeError('Resolution boost recipe state must be boolean.');

  const sourceAssetId = node.resolutionBoosted === true
    ? node.resolutionBoostSourceAssetId
    : node.assetId;
  if (typeof sourceAssetId !== 'string' || !sourceAssetId) {
    return { action: 'unavailable', sourceAssetId: null, outputAssetId: null };
  }
  const outputAssetId = node.resolutionBoostSourceAssetId === sourceAssetId
    && typeof node.resolutionBoostAssetId === 'string'
    ? node.resolutionBoostAssetId
    : null;

  if (!enabled) {
    return {
      action: node.resolutionBoosted === true ? 'restore' : 'unchanged',
      sourceAssetId,
      outputAssetId,
    };
  }
  if (node.resolutionBoosted === true && outputAssetId && node.assetId === outputAssetId) {
    return { action: 'unchanged', sourceAssetId, outputAssetId };
  }
  if (outputAssetId) return { action: 'activate-cache', sourceAssetId, outputAssetId };
  return { action: 'boost', sourceAssetId, outputAssetId: null };
}
