/** Toggle one layer ID while preserving the order of the remaining selection. */
export function toggleLayerSelection(selectedIds, nodeId) {
  if (!Array.isArray(selectedIds)) throw new TypeError('Layer selection must be an array.');
  if (typeof nodeId !== 'string' || !nodeId) throw new TypeError('A layer ID is required.');
  const selected = [...new Set(selectedIds)];
  return selected.includes(nodeId)
    ? selected.filter(id => id !== nodeId)
    : [...selected, nodeId];
}

/** Treat a touch as selection only when its full pointer path stayed within tap slop. */
export function isLayerSelectionTap({ moved = false, startClient, endClient } = {}, slop = 8) {
  if (moved) return false;
  if (!startClient || !endClient
    || !Number.isFinite(startClient.x) || !Number.isFinite(startClient.y)
    || !Number.isFinite(endClient.x) || !Number.isFinite(endClient.y)
    || !Number.isFinite(slop) || slop < 0) return false;
  return Math.hypot(endClient.x - startClient.x, endClient.y - startClient.y) <= slop;
}
