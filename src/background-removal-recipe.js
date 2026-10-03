/**
 * Resolve background removal for one image recipe target. A recipe stores the
 * operation, not the transparent pixels that happened to be on its source.
 */
export function planBackgroundRemovalRecipe(node, enabled) {
  if (node?.type !== 'image') throw new TypeError('Background removal recipes require an image layer.');
  if (typeof enabled !== 'boolean') throw new TypeError('Background removal recipe state must be boolean.');

  const sourceAssetId = node.backgroundRemoved === true
    ? node.backgroundRemovalSourceAssetId
    : node.assetId;
  if (typeof sourceAssetId !== 'string' || !sourceAssetId) {
    return { action: 'unavailable', sourceAssetId: null, outputAssetId: null };
  }
  const outputAssetId = node.backgroundRemovalSourceAssetId === sourceAssetId
    && typeof node.backgroundRemovalAssetId === 'string'
    ? node.backgroundRemovalAssetId
    : null;

  if (!enabled) {
    return {
      action: node.backgroundRemoved === true ? 'restore' : 'unchanged',
      sourceAssetId,
      outputAssetId,
    };
  }
  if (node.backgroundRemoved === true && outputAssetId && node.assetId === outputAssetId) {
    return { action: 'unchanged', sourceAssetId, outputAssetId };
  }
  if (outputAssetId) return { action: 'activate-cache', sourceAssetId, outputAssetId };
  return { action: 'remove', sourceAssetId, outputAssetId: null };
}

/** Keep image batches within the requested CPU budget; active model work reserves its own slot dynamically. */
export function imageRecipeRenderWorkerBudget(cpuBudget, requestedConcurrency) {
  if (!Number.isSafeInteger(cpuBudget) || cpuBudget < 1) throw new RangeError('The image recipe CPU budget must be a positive integer.');
  if (!Number.isSafeInteger(requestedConcurrency) || requestedConcurrency < 1) throw new RangeError('The image recipe concurrency must be a positive integer.');
  return Math.min(cpuBudget, requestedConcurrency);
}

/** Whether applying this recipe will need one of the serialized local model workers. */
export function imageRecipeUsesLocalModel(recipe) {
  return recipe?.backgroundRemoved === true
    || recipe?.resolutionBoosted === true
    || (recipe?.imageExpansionPaddingRatio != null)
    || (Array.isArray(recipe?.inpaintStrokes) && recipe.inpaintStrokes.length > 0);
}
