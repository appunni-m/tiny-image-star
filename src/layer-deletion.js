import { cloneDocument, findNode, getNodePropertyValue, removeInheritedSlotNodes, removeNode, validateDocument } from './model.js';
import { applyAutoLayout, createAutoLayout } from './layout-engine.js';

const autoLayoutBindingProperties = [
  'autoLayout.axis', 'autoLayout.align', 'autoLayout.justify', 'autoLayout.wrapDistribution',
  'autoLayout.mainSizing', 'autoLayout.crossSizing', 'autoLayout.wrap', 'autoLayout.autoPositioning',
  'autoLayout.columns', 'autoLayout.rows', 'autoLayout.columnGap', 'autoLayout.rowGap',
  'autoLayout.padding.top', 'autoLayout.padding.right', 'autoLayout.padding.bottom', 'autoLayout.padding.left'
];

function settingsWithBoundValues(document, frame) {
  const settings = createAutoLayout(frame.autoLayout || {});
  for (const property of autoLayoutBindingProperties) {
    if (!frame.variableBindings?.[property]) continue;
    const value = getNodePropertyValue(document, frame, property);
    const path = property.slice('autoLayout.'.length).split('.');
    let target = settings;
    for (const key of path.slice(0, -1)) target = target[key];
    target[path.at(-1)] = value;
  }
  return createAutoLayout(settings);
}

/** Capture auto-layout parents that must be recomputed after removing layers. */
export function captureAutoLayoutAncestors(document, nodeIds, pageId = document.activePageId) {
  const affected = new Map();
  for (const nodeId of nodeIds) {
    const entry = findNode(document, nodeId, pageId);
    if (!entry) continue;
    for (const [index, parent] of entry.parents.entries()) {
      if (parent.type !== 'frame' || !parent.autoLayout) continue;
      const depth = index + 1;
      const previous = affected.get(parent.id);
      if (!previous || depth > previous.depth) affected.set(parent.id, { id: parent.id, depth });
    }
  }
  return [...affected.values()];
}

/** Recompute affected auto-layout parents from deepest to shallowest. */
export function reflowAutoLayoutAncestors(document, affected, pageId = document.activePageId) {
  for (const { id } of [...affected].sort((left, right) => right.depth - left.depth)) {
    const frame = findNode(document, id, pageId)?.node;
    if (!frame?.autoLayout) continue;
    const hasBindings = autoLayoutBindingProperties.some(property => frame.variableBindings?.[property]);
    if (hasBindings) applyAutoLayout(frame, settingsWithBoundValues(document, frame));
    else applyAutoLayout(frame);
  }
}

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

/** Keep stale vector-anchor state from intercepting deletion of another layer. */
export function shouldDeleteSelectedVectorAnchor(selectedIds, selectedVectorPoint) {
  return Boolean(selectedVectorPoint?.nodeId
    && selectedIds.length === 1
    && selectedIds[0] === selectedVectorPoint.nodeId);
}

/** Remove a set of top-level selections atomically, without leaving a partial delete. */
export function removeLayersAtomically(document, nodeIds, pageId = document.activePageId) {
  const ids = [...new Set(nodeIds)];
  if (!ids.length) return { document, removedIds: [] };

  const autoLayoutAncestors = captureAutoLayoutAncestors(document, ids, pageId);
  const nextDocument = cloneDocument(document);
  const slotRemovedIds = removeInheritedSlotNodes(nextDocument, ids, pageId);
  for (const nodeId of ids) {
    if (slotRemovedIds.has(nodeId)) continue;
    if (!removeNode(nextDocument, nodeId, pageId)) {
      throw new Error('One of the selected layers no longer exists.');
    }
  }
  reflowAutoLayoutAncestors(nextDocument, autoLayoutAncestors, pageId);
  validateDocument(nextDocument);
  return { document: nextDocument, removedIds: ids };
}
