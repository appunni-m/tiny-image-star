import { cloneDocument, removeInheritedSlotNodes, removeNode, validateDocument } from './model.js';

/** Prefer the focused layer when keyboard focus moved away from the current selection. */
export function layerDeleteTargets(selectedIds, focusedLayerId) {
  const selected = [...new Set(selectedIds)];
  return focusedLayerId && !selected.includes(focusedLayerId) ? [focusedLayerId] : selected;
}

/** Keep a layer menu's delete target stable for the lifetime of that menu. */
export function layerMenuDeleteTargets(selectedIds, menuLayerId) {
  const selected = [...new Set(selectedIds)];
  return selected.includes(menuLayerId) ? selected : [menuLayerId];
}

/** Remove a set of top-level selections atomically, without leaving a partial delete. */
export function removeLayersAtomically(document, nodeIds, pageId = document.activePageId) {
  const ids = [...new Set(nodeIds)];
  if (!ids.length) return { document, removedIds: [] };

  const nextDocument = cloneDocument(document);
  const slotRemovedIds = removeInheritedSlotNodes(nextDocument, ids, pageId);
  for (const nodeId of ids) {
    if (slotRemovedIds.has(nodeId)) continue;
    if (!removeNode(nextDocument, nodeId, pageId)) {
      throw new Error('One of the selected layers no longer exists.');
    }
  }
  validateDocument(nextDocument);
  return { document: nextDocument, removedIds: ids };
}
