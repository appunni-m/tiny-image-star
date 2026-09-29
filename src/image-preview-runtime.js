export function collectLiveImagePreviewNodeIds(document) {
  const liveNodeIds = new Set();
  for (const page of document?.pages || []) {
    const visit = nodes => {
      for (const node of nodes || []) {
        if ((node.type === 'image' && node.assetId) || node.imageFill?.assetId) liveNodeIds.add(node.id);
        visit(node.children);
      }
    };
    visit(page.children);
  }
  return liveNodeIds;
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
    ...imageStatus.keys(),
    ...renderVersion.keys(),
  ]);
  let releasedPreviews = 0;
  let revokedUrls = 0;
  let cancelledTimers = 0;

  for (const nodeId of tracked) {
    if (live.has(nodeId)) continue;

    if (timers.has(nodeId)) {
      clearTimer(timers.get(nodeId));
      timers.delete(nodeId);
      cancelledTimers += 1;
    }

    const preview = previews.get(nodeId);
    if (preview) {
      preview.close?.();
      releasedPreviews += 1;
    }
    previews.delete(nodeId);

    const url = previewUrls.get(nodeId);
    if (url) {
      revokeUrl(url);
      revokedUrls += 1;
    }
    previewUrls.delete(nodeId);

    previewAssetIds.delete(nodeId);
    previewVersions.delete(nodeId);
    imageStatus.delete(nodeId);
    // Removing the token makes every render that captured it stale. Callers
    // must use globally unique tokens so a later node with the same ID cannot
    // accidentally make an old render current again.
    renderVersion.delete(nodeId);
  }

  return { cancelledTimers, releasedPreviews, revokedUrls };
}
