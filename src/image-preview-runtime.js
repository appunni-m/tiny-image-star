export function imagePreviewKey(nodeId, fillId = null) {
  // A materialized legacy fill keeps the exact preview slot older documents
  // used, so changing only fit/opacity cannot flash back to the source bitmap.
  if (fillId === `legacy-fill:${nodeId}`) return nodeId;
  return fillId ? `image-fill:${JSON.stringify([nodeId, fillId])}` : nodeId;
}

function stableSettingsValue(value) {
  if (Array.isArray(value)) return value.map(stableSettingsValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSettingsValue(value[key])]));
}

/** Identify the exact inputs used to build a local image preview. */
export function imagePreviewSettingsSignature({
  assetId,
  adjustments = {},
  transforms = {},
  inpaintStrokes = [],
  outputFormat = 'png',
  outputQuality = 90,
} = {}) {
  return JSON.stringify(stableSettingsValue({
    assetId: assetId ?? null,
    adjustments: adjustments ?? {},
    transforms: transforms ?? {},
    inpaintStrokes: inpaintStrokes ?? [],
    outputFormat: outputFormat || 'png',
    outputQuality: Number.isFinite(outputQuality) ? outputQuality : 90,
  }));
}

export function collectLiveImagePreviewNodeIds(document) {
  const liveNodeIds = new Set();
  for (const page of document?.pages || []) {
    const visit = nodes => {
      for (const node of nodes || []) {
        if (node.type === 'image' && node.assetId) liveNodeIds.add(imagePreviewKey(node.id));
        if (node.imageFill?.assetId && !Array.isArray(node.fills)) liveNodeIds.add(imagePreviewKey(node.id));
        for (const fill of node.fills || []) {
          if (fill.type === 'image' && fill.id && fill.imageFill?.assetId) liveNodeIds.add(imagePreviewKey(node.id, fill.id));
        }
        visit(node.children);
      }
    };
    visit(page.children);
  }
  return liveNodeIds;
}

/**
 * Collect source assets reachable from document snapshots and clipboard
 * trees. Callers should include the open document and every undo/redo snapshot
 * so assets remain available until history and pending paste references end.
 */
export function collectLiveImageAssetIds(documents, extraNodes = []) {
  const liveAssetIds = new Set();
  const snapshots = Array.isArray(documents) ? documents : [documents];
  const visit = nodes => {
    for (const node of nodes || []) {
      if (node.type === 'image' && node.assetId) liveAssetIds.add(node.assetId);
      if (!Array.isArray(node.fills) && node.imageFill?.assetId) liveAssetIds.add(node.imageFill.assetId);
      for (const fill of node.fills || []) {
        if (fill.type === 'image' && fill.imageFill?.assetId) liveAssetIds.add(fill.imageFill.assetId);
      }
      visit(node.children);
    }
  };
  for (const document of snapshots) {
    for (const page of document?.pages || []) visit(page.children);
    // Source library entries can outlive every placed layer. Keep those
    // original bytes available across edits and undo/redo snapshots too.
    for (const entry of document?.imageLibrary || []) {
      if (typeof entry?.assetId === 'string' && entry.assetId) liveAssetIds.add(entry.assetId);
    }
  }
  visit(extraNodes);
  return liveAssetIds;
}

/** Release source bytes, fallback bitmaps, object URLs, and budget entries for orphan assets. */
export function pruneImageAssetRuntime({
  liveAssetIds,
  assets,
  disposeSource = () => {},
  releaseMemory = () => {},
  revokeUrl = url => URL.revokeObjectURL(url),
}) {
  const live = liveAssetIds instanceof Set ? liveAssetIds : new Set(liveAssetIds);
  let releasedAssets = 0;
  let closedBitmaps = 0;
  let revokedUrls = 0;
  for (const [assetId, asset] of [...assets]) {
    if (live.has(assetId)) continue;
    try { disposeSource(assetId); } catch {}
    if (asset.bitmap) {
      try { asset.bitmap.close?.(); closedBitmaps += 1; } catch {}
    }
    if (asset.bitmapUrl) {
      try { revokeUrl(asset.bitmapUrl); revokedUrls += 1; } catch {}
    }
    try { asset.sourceBytes = null; } catch {}
    assets.delete(assetId);
    try { releaseMemory(assetId); } catch {}
    releasedAssets += 1;
  }
  return { releasedAssets, closedBitmaps, revokedUrls };
}

export function imagePreviewFailureStatus(error) {
  return error?.previewFallbackShown ? 'Preview unavailable · showing original' : 'Preview failed';
}

export function setImagePreviewFailureStatus(imageStatus, previewKey, error) {
  const status = imagePreviewFailureStatus(error);
  imageStatus.set(previewKey, status);
  return status;
}

/**
 * Release preview-only resources for nodes that no longer belong to the open
 * document. Asset sources and worker caches are deliberately left alone:
 * another live node or page may still reference the same asset.
 */
export function pruneImagePreviewRuntime({
  liveNodeIds,
  timers,
  previews,
  previewUrls,
  previewAssetIds,
  previewVersions,
  previewSignatures,
  imageStatus,
  renderVersion,
  clearTimer = clearTimeout,
  revokeUrl = url => URL.revokeObjectURL(url),
}) {
  const live = liveNodeIds instanceof Set ? liveNodeIds : new Set(liveNodeIds);
  const tracked = new Set([
    ...timers.keys(),
    ...previews.keys(),
    ...previewUrls.keys(),
    ...previewAssetIds.keys(),
    ...previewVersions.keys(),
    ...(previewSignatures?.keys?.() || []),
    ...imageStatus.keys(),
    ...renderVersion.keys(),
  ]);
  let releasedPreviews = 0;
  let revokedUrls = 0;
  let cancelledTimers = 0;

  for (const nodeId of tracked) {
    if (live.has(nodeId)) continue;

    if (timers.has(nodeId)) {
      try { clearTimer(timers.get(nodeId)); } catch {}
      timers.delete(nodeId);
      cancelledTimers += 1;
    }

    const preview = previews.get(nodeId);
    if (preview) {
      try { preview.close?.(); releasedPreviews += 1; } catch {}
    }
    previews.delete(nodeId);

    const url = previewUrls.get(nodeId);
    if (url) {
      try { revokeUrl(url); revokedUrls += 1; } catch {}
    }
    previewUrls.delete(nodeId);

    previewAssetIds.delete(nodeId);
    previewVersions.delete(nodeId);
    previewSignatures?.delete(nodeId);
    imageStatus.delete(nodeId);
    // Removing the token makes every render that captured it stale. Callers
    // must use globally unique tokens so a later node with the same ID cannot
    // accidentally make an old render current again.
    renderVersion.delete(nodeId);
  }

  return { cancelledTimers, releasedPreviews, revokedUrls };
}
