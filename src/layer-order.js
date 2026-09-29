import { findNode, reorderNode } from './model.js';

/** Translate a visual layer-row drop into a final sibling index.
 * Layer rows display sibling arrays in reverse paint order, so dropping above
 * a row means inserting after it in the model's bottom-to-top array.
 */
export function layerDropReorder(document, sourceId, targetId, position, pageId = document.activePageId) {
  if (!['before', 'after'].includes(position) || sourceId === targetId) return null;
  const source = findNode(document, sourceId, pageId);
  const target = findNode(document, targetId, pageId);
  if (!source || !target || source.parent !== target.parent) return null;
  if (source.node.locked || target.node.locked
    || source.parents.some(parent => parent.locked)
    || target.parents.some(parent => parent.locked)) return null;

  const boundary = target.index + (position === 'before' ? 1 : 0);
  const index = boundary - (source.index < boundary ? 1 : 0);
  return index === source.index ? null : { nodeId: sourceId, index, pageId };
}

export function reorderLayerForDrop(document, sourceId, targetId, position, pageId = document.activePageId) {
  const operation = layerDropReorder(document, sourceId, targetId, position, pageId);
  return operation ? reorderNode(document, operation.nodeId, operation.index, operation.pageId) : false;
}

/** Move a layer by one visible row within its current sibling list.
 * The layer panel reverses the model's bottom-to-top paint order, so visual
 * up increments the model index and visual down decrements it. A locked layer,
 * locked neighbor, or locked ancestor blocks the move.
 */
export function moveLayerOneVisualRow(document, nodeId, direction, pageId = document.activePageId) {
  if (direction !== 'up' && direction !== 'down') return false;
  const entry = findNode(document, nodeId, pageId);
  if (!entry || entry.node.locked || entry.parents.some(parent => parent.locked)) return false;
  const siblings = entry.parent?.children || document.pages.find(page => page.id === pageId)?.children;
  if (!siblings) return false;
  const neighborIndex = entry.index + (direction === 'up' ? 1 : -1);
  const neighbor = siblings[neighborIndex];
  if (!neighbor || neighbor.locked) return false;
  return reorderNode(document, nodeId, neighborIndex, pageId);
}

/** Install same-parent drag reordering on a rendered layer tree. */
export function installLayerReorder(list, {
  getDocument,
  getPageId,
  canStart = () => true,
  beforeChange = () => {},
  onChange = () => {}
}) {
  let sourceId = null;
  let dropRow = null;

  const clearDropTarget = () => {
    if (dropRow) dropRow.classList.remove('is-drop-before', 'is-drop-after');
    dropRow = null;
  };
  const clearDrag = () => {
    clearDropTarget();
    if (sourceId) list.querySelector(`[data-layer-id="${CSS.escape(sourceId)}"]`)?.classList.remove('is-dragging');
    sourceId = null;
  };

  list.addEventListener('dragstart', event => {
    const row = event.target.closest('[data-layer-id]');
    if (!row || !canStart(row)) { event.preventDefault(); return; }
    const document = getDocument();
    const source = findNode(document, row.dataset.layerId, getPageId());
    if (!source || source.node.locked || source.parents.some(parent => parent.locked)) { event.preventDefault(); return; }
    sourceId = source.node.id;
    row.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', sourceId);
    }
  });

  list.addEventListener('dragover', event => {
    const row = event.target.closest('[data-layer-id]');
    if (!sourceId || !row || row.dataset.layerId === sourceId) return;
    const rect = row.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    const operation = layerDropReorder(getDocument(), sourceId, row.dataset.layerId, position, getPageId());
    if (!operation) { clearDropTarget(); return; }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (dropRow !== row) clearDropTarget();
    dropRow = row;
    row.classList.toggle('is-drop-before', position === 'before');
    row.classList.toggle('is-drop-after', position === 'after');
  });

  list.addEventListener('drop', event => {
    const row = event.target.closest('[data-layer-id]');
    if (!sourceId || !row) return;
    event.preventDefault();
    const position = row.classList.contains('is-drop-before') ? 'before'
      : row.classList.contains('is-drop-after') ? 'after' : null;
    const operation = position && layerDropReorder(getDocument(), sourceId, row.dataset.layerId, position, getPageId());
    if (operation) {
      beforeChange();
      if (reorderLayerForDrop(getDocument(), sourceId, row.dataset.layerId, position, getPageId())) onChange();
    }
    clearDrag();
  });

  list.addEventListener('dragend', clearDrag);
  list.addEventListener('dragleave', event => {
    if (dropRow && !dropRow.contains(event.relatedTarget)) clearDropTarget();
  });
}
