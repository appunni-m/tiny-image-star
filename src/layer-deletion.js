import { cloneDocument, findNode, removeInheritedSlotNodes, removeNode, separateBoolean, syncAllComponentInstances, validateDocument } from './model.js';
import { captureAutoLayoutAncestors, reflowAutoLayoutAncestors } from './layer-auto-layout.js';

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

  const autoLayoutAncestors = captureAutoLayoutAncestors(document, ids, pageId);
  const nextDocument = cloneDocument(document);

  // Boolean groups require at least two operands. Separate the group first
  // when deleting one of its final two children, so the surviving source stays
  // editable and the atomic candidate remains a valid document.
  const booleanGroupsToSeparate = new Set();
  for (const nodeId of ids) {
    const entry = findNode(nextDocument, nodeId, pageId);
    const parent = entry?.parent;
    if (parent?.type !== 'boolean' || parent.children?.length !== 2) continue;
    if (entry.parents.some(ancestor => ancestor.isInstance)) {
      throw new Error('Detach this component instance before deleting one of the final two Boolean operands.');
    }
    booleanGroupsToSeparate.add(parent.id);
  }
  for (const booleanId of booleanGroupsToSeparate) separateBoolean(nextDocument, booleanId, pageId);

  const slotRemovedIds = removeInheritedSlotNodes(nextDocument, ids, pageId);
  for (const nodeId of ids) {
    if (slotRemovedIds.has(nodeId)) continue;
    if (!removeNode(nextDocument, nodeId, pageId)) {
      throw new Error('One of the selected layers no longer exists.');
    }
  }
  reflowAutoLayoutAncestors(nextDocument, autoLayoutAncestors, pageId);
  // Autosave also refreshes component instances. Run that same derived-state
  // pass before installing the delete so a broken override cannot report
  // success only to have the next save put the layer back.
  syncAllComponentInstances(nextDocument);
  if (ids.some(nodeId => findNode(nextDocument, nodeId, pageId))) {
    throw new Error('Component refresh restored a selected layer. Nothing was deleted.');
  }
  validateDocument(nextDocument);
  return { document: nextDocument, removedIds: ids };
}
