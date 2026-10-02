import { findNode, reorderNode } from './model.js';
import { canReparentLayer, reparentLayer } from './layer-reparent.js';

const layerContainerTypes = new Set(['frame', 'section', 'group', 'boolean']);

/** Translate a visual layer-row drop into a final sibling index.
 * Layer rows display sibling arrays in reverse paint order, so dropping above
 * a row means inserting after it in the model's bottom-to-top array.
 */
export function layerDropReorder(document, sourceId, targetId, position, pageId = document.activePageId) {
  if (!['before', 'after', 'inside'].includes(position) || sourceId === targetId) return null;
  const source = findNode(document, sourceId, pageId);
  const target = findNode(document, targetId, pageId);
  if (!source || !target) return null;
  if (source.node.locked || target.node.locked
    || source.parents.some(parent => parent.locked)
    || target.parents.some(parent => parent.locked)) return null;

  let parentId;
  let boundary;
  if (position === 'inside') {
    if (!layerContainerTypes.has(target.node.type)) return null;
    parentId = target.node.id;
    boundary = target.node.children?.length || 0;
  } else {
    parentId = target.parent?.id ?? null;
    boundary = target.index + (position === 'before' ? 1 : 0);
  }

  const sourceParentId = source.parent?.id ?? null;
  if (sourceParentId === parentId) {
    const siblings = source.parent?.children || document.pages.find(page => page.id === pageId)?.children;
    if (!siblings) return null;
    const index = Math.max(0, Math.min(boundary - (source.index < boundary ? 1 : 0), siblings.length - 1));
    if (position !== 'inside') {
      const firstCrossedIndex = Math.min(source.index, target.index) + 1;
      const lastCrossedIndex = Math.max(source.index, target.index);
      if (siblings.slice(firstCrossedIndex, lastCrossedIndex).some(node => node.locked)) return null;
    }
    return index === source.index ? null : { nodeId: sourceId, index, pageId };
  }

  if (!canReparentLayer(document, sourceId, { parentId, index: boundary, pageId })) return null;
  return { nodeId: sourceId, parentId, index: boundary, pageId, reparent: true };
}

export function reorderLayerForDrop(document, sourceId, targetId, position, pageId = document.activePageId) {
  const operation = layerDropReorder(document, sourceId, targetId, position, pageId);
  if (!operation) return false;
  return operation.reparent
    ? reparentLayer(document, operation.nodeId, operation)
    : reorderNode(document, operation.nodeId, operation.index, operation.pageId);
}

/** Whether a layer can move by one visible row within its current sibling list. */
export function canMoveLayerOneVisualRow(document, nodeId, direction, pageId = document.activePageId) {
  if (direction !== 'up' && direction !== 'down') return false;
  const entry = findNode(document, nodeId, pageId);
  if (!entry || entry.node.locked || entry.parents.some(parent => parent.locked)) return false;
  const siblings = entry.parent?.children || document.pages.find(page => page.id === pageId)?.children;
  if (!siblings) return false;
  const neighbor = siblings[entry.index + (direction === 'up' ? 1 : -1)];
  return Boolean(neighbor && !neighbor.locked);
}

/** Move a layer by one visible row within its current sibling list.
 * The layer panel reverses the model's bottom-to-top paint order, so visual
 * up increments the model index and visual down decrements it. A locked layer,
 * locked neighbor, or locked ancestor blocks the move.
 */
export function moveLayerOneVisualRow(document, nodeId, direction, pageId = document.activePageId) {
  if (!canMoveLayerOneVisualRow(document, nodeId, direction, pageId)) return false;
  const entry = findNode(document, nodeId, pageId);
  const siblings = entry.parent?.children || document.pages.find(page => page.id === pageId)?.children;
  const neighborIndex = entry.index + (direction === 'up' ? 1 : -1);
  return reorderNode(document, nodeId, neighborIndex, pageId);
}

/** Map the documented keyboard shortcut to its visual direction. */
export function layerOrderShortcutDirection(event) {
  if (!event?.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === 'ArrowUp') return 'up';
  if (event.key === 'ArrowDown') return 'down';
  return null;
}

export const LAYER_ROW_POINTER_DRAG_THRESHOLD = 6;
const LAYER_ROW_INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, summary, [role="button"], [contenteditable]:not([contenteditable="false"]), [data-layer-drag-ignore]';
const LAYER_ROW_DRAG_HANDLE_SELECTOR = '[data-layer-drag-handle]';

export function pointerDragThresholdExceeded(startX, startY, x, y, threshold = LAYER_ROW_POINTER_DRAG_THRESHOLD) {
  return Number.isFinite(startX) && Number.isFinite(startY) && Number.isFinite(x) && Number.isFinite(y)
    && Math.hypot(x - startX, y - startY) > threshold;
}

export function layerDropPositionAt(clientY, rect, canDropInside = false) {
  if (!Number.isFinite(clientY) || !rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height <= 0) return null;
  if (canDropInside) {
    const fraction = (clientY - rect.top) / rect.height;
    if (fraction < .25) return 'before';
    if (fraction > .75) return 'after';
    return 'inside';
  }
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
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
  let sourceRow = null;
  let dropRow = null;
  let pointerDrag = null;
  let suppressedClick = null;

  const ownerDocument = list.ownerDocument || globalThis.document;
  const ownerWindow = ownerDocument?.defaultView || globalThis.window;

  const rowFromTarget = target => {
    const row = target?.closest?.('[data-layer-id]');
    return row && list.contains(row) ? row : null;
  };
  const dragHandleFromEvent = (event, row) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
    const handle = path?.find(item => item?.matches?.(LAYER_ROW_DRAG_HANDLE_SELECTOR))
      || event.target?.closest?.(LAYER_ROW_DRAG_HANDLE_SELECTOR);
    return handle && row.contains(handle) ? handle : null;
  };
  const eventHitsInteractiveControl = (event, row, allowedControl = null) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
    const target = event.target;
    const interactive = path?.find(item => item?.matches?.(LAYER_ROW_INTERACTIVE_SELECTOR))
      || target?.closest?.(LAYER_ROW_INTERACTIVE_SELECTOR);
    return Boolean(interactive && interactive !== allowedControl && row.contains(interactive));
  };
  const sourceIsMovable = (row, document, pageId) => {
    if (!row || !canStart(row)) return false;
    const source = findNode(document, row.dataset.layerId, pageId);
    return Boolean(source && !source.node.locked && !source.parents.some(parent => parent.locked));
  };

  const clearDropTarget = () => {
    if (dropRow) dropRow.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-inside');
    dropRow = null;
  };
  const clearDrag = () => {
    clearDropTarget();
    sourceRow?.classList.remove('is-dragging');
    sourceId = null;
    sourceRow = null;
  };
  const cancelAutoScroll = drag => {
    if (drag?.frameId == null) return;
    ownerWindow?.cancelAnimationFrame?.(drag.frameId);
    drag.frameId = null;
  };
  const releasePointerCapture = drag => {
    try {
      if (list.hasPointerCapture?.(drag.pointerId)) list.releasePointerCapture(drag.pointerId);
    } catch { /* A browser can release capture automatically when a pointer is canceled. */ }
  };
  const stopPointerDrag = ({ suppress = false } = {}) => {
    const drag = pointerDrag;
    if (!drag) return;
    cancelAutoScroll(drag);
    releasePointerCapture(drag);
    if (suppress && drag.active) {
      suppressedClick = {
        pointerId: drag.pointerId,
        sourceId: drag.sourceId,
        targetId: drag.targetId,
        until: Date.now() + 750
      };
    }
    pointerDrag = null;
    clearDrag();
  };
  const commitDrop = (dragSourceId, targetId, position, pageId) => {
    const document = getDocument();
    const operation = layerDropReorder(document, dragSourceId, targetId, position, pageId);
    if (!operation) return false;
    beforeChange();
    if (!reorderLayerForDrop(document, dragSourceId, targetId, position, pageId)) return false;
    onChange();
    return true;
  };
  const targetRowAtPoint = (x, y, fallbackTarget = null) => {
    let target = null;
    try { target = ownerDocument?.elementFromPoint?.(x, y) || null; } catch { /* Use the dispatched event target below. */ }
    return rowFromTarget(target || fallbackTarget);
  };
  const setDropTarget = (row, position, document, pageId, dragSourceId) => {
    if (!row || row.dataset.layerId === dragSourceId
      || !layerDropReorder(document, dragSourceId, row.dataset.layerId, position, pageId)) {
      clearDropTarget();
      return null;
    }
    if (dropRow !== row) clearDropTarget();
    dropRow = row;
    row.classList.toggle('is-drop-before', position === 'before');
    row.classList.toggle('is-drop-after', position === 'after');
    row.classList.toggle('is-drop-inside', position === 'inside');
    return { targetId: row.dataset.layerId, position };
  };
  const dropPositionForRow = (y, row, document, pageId) => {
    const type = row?.dataset.layerType || findNode(document, row?.dataset.layerId, pageId)?.node.type;
    return layerDropPositionAt(y, row?.getBoundingClientRect?.(), layerContainerTypes.has(type));
  };
  const updatePointerTarget = (drag, fallbackTarget = null) => {
    if (getDocument() !== drag.document) {
      clearDropTarget();
      drag.targetId = null;
      drag.position = null;
      return;
    }
    const row = targetRowAtPoint(drag.lastX, drag.lastY, fallbackTarget);
    const position = row && dropPositionForRow(drag.lastY, row, drag.document, drag.pageId);
    const target = position && setDropTarget(row, position, drag.document, drag.pageId, drag.sourceId);
    drag.targetId = target?.targetId ?? null;
    drag.position = target?.position ?? null;
  };
  const edgeScrollVelocity = drag => {
    if (typeof list.getBoundingClientRect !== 'function') return 0;
    const bounds = list.getBoundingClientRect();
    if (!(bounds.height > 0)) return 0;
    const edgeSize = Math.min(48, Math.max(28, bounds.height * 0.12));
    if (drag.lastY < bounds.top + edgeSize) {
      return -Math.max(2, Math.ceil((bounds.top + edgeSize - drag.lastY) / edgeSize * 18));
    }
    if (drag.lastY > bounds.bottom - edgeSize) {
      return Math.max(2, Math.ceil((drag.lastY - (bounds.bottom - edgeSize)) / edgeSize * 18));
    }
    return 0;
  };
  const scheduleAutoScroll = drag => {
    const requestFrame = ownerWindow?.requestAnimationFrame?.bind(ownerWindow);
    if (!drag.active || drag.frameId != null || !requestFrame || !edgeScrollVelocity(drag)) return;
    drag.frameId = requestFrame(() => {
      drag.frameId = null;
      if (pointerDrag !== drag || !drag.active || getDocument() !== drag.document) return;
      const delta = edgeScrollVelocity(drag);
      if (!delta || !Number.isFinite(list.scrollTop)) return;
      const previous = list.scrollTop;
      list.scrollTop = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, previous + delta));
      if (list.scrollTop === previous) return;
      updatePointerTarget(drag);
      scheduleAutoScroll(drag);
    });
  };
  const onPointerDown = event => {
    if (!['touch', 'pen'].includes(event.pointerType) || event.isPrimary === false
      || (event.button != null && event.button !== 0) || pointerDrag || sourceId) return;
    const row = rowFromTarget(event.target);
    const handle = row && dragHandleFromEvent(event, row);
    if (!row || !handle || eventHitsInteractiveControl(event, row, handle)) return;
    const document = getDocument();
    const pageId = getPageId();
    if (!sourceIsMovable(row, document, pageId)) return;
    pointerDrag = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      sourceId: row.dataset.layerId,
      sourceRow: row,
      document,
      pageId,
      startX: Number(event.clientX),
      startY: Number(event.clientY),
      lastX: Number(event.clientX),
      lastY: Number(event.clientY),
      active: false,
      targetId: null,
      position: null,
      frameId: null
    };
  };
  const onPointerMove = event => {
    const drag = pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.lastX = Number(event.clientX);
    drag.lastY = Number(event.clientY);
    if (!drag.active && !pointerDragThresholdExceeded(drag.startX, drag.startY, drag.lastX, drag.lastY)) return;
    if (!drag.active) {
      if (getDocument() !== drag.document || !sourceIsMovable(drag.sourceRow, drag.document, drag.pageId)) {
        stopPointerDrag();
        return;
      }
      drag.active = true;
      sourceId = drag.sourceId;
      sourceRow = drag.sourceRow;
      sourceRow.classList.add('is-dragging');
      try { list.setPointerCapture?.(drag.pointerId); } catch { /* Document listeners still track the gesture. */ }
    }
    if (event.cancelable) event.preventDefault();
    updatePointerTarget(drag, event.target);
    const delta = edgeScrollVelocity(drag);
    if (delta && Number.isFinite(list.scrollTop)) {
      const previous = list.scrollTop;
      list.scrollTop = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, previous + delta));
      if (list.scrollTop !== previous) updatePointerTarget(drag);
    }
    scheduleAutoScroll(drag);
  };
  const onPointerUp = event => {
    const drag = pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.active) {
      drag.lastX = Number(event.clientX);
      drag.lastY = Number(event.clientY);
      updatePointerTarget(drag, event.target);
      if (drag.targetId && drag.position && getDocument() === drag.document) {
        commitDrop(drag.sourceId, drag.targetId, drag.position, drag.pageId);
      }
      stopPointerDrag({ suppress: true });
      return;
    }
    stopPointerDrag();
  };
  const onPointerCancel = event => {
    if (pointerDrag?.pointerId === event.pointerId) stopPointerDrag();
  };

  list.addEventListener('dragstart', event => {
    const row = rowFromTarget(event.target);
    if (!row || eventHitsInteractiveControl(event, row) || !canStart(row)) { event.preventDefault(); return; }
    const document = getDocument();
    const pageId = getPageId();
    const source = findNode(document, row.dataset.layerId, pageId);
    if (!source || source.node.locked || source.parents.some(parent => parent.locked)) { event.preventDefault(); return; }
    sourceId = source.node.id;
    sourceRow = row;
    row.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', sourceId);
    }
  });

  list.addEventListener('dragover', event => {
    const row = rowFromTarget(event.target);
    if (!sourceId || !row || row.dataset.layerId === sourceId) return;
    const position = dropPositionForRow(event.clientY, row, getDocument(), getPageId());
    if (!position) return;
    const operation = layerDropReorder(getDocument(), sourceId, row.dataset.layerId, position, getPageId());
    if (!operation) { clearDropTarget(); return; }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (dropRow !== row) clearDropTarget();
    dropRow = row;
    row.classList.toggle('is-drop-before', position === 'before');
    row.classList.toggle('is-drop-after', position === 'after');
    row.classList.toggle('is-drop-inside', position === 'inside');
  });

  list.addEventListener('drop', event => {
    const row = rowFromTarget(event.target);
    if (!sourceId || !row) return;
    event.preventDefault();
    const position = row.classList.contains('is-drop-before') ? 'before'
      : row.classList.contains('is-drop-after') ? 'after'
        : row.classList.contains('is-drop-inside') ? 'inside' : null;
    if (position) commitDrop(sourceId, row.dataset.layerId, position, getPageId());
    clearDrag();
  });

  list.addEventListener('pointerdown', onPointerDown);
  list.addEventListener('click', event => {
    if (!suppressedClick) return;
    const suppression = suppressedClick;
    if (Date.now() > suppression.until) { suppressedClick = null; return; }
    const eventPointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
    const row = rowFromTarget(event.target);
    const matchesPointer = eventPointerId != null && eventPointerId === suppression.pointerId;
    const matchesFallback = eventPointerId == null && (!row || row.dataset.layerId === suppression.sourceId || row.dataset.layerId === suppression.targetId);
    if (!matchesPointer && !matchesFallback) return;
    suppressedClick = null;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  const pointerEventRoot = ownerDocument || list;
  pointerEventRoot.addEventListener('pointermove', onPointerMove, { passive: false });
  pointerEventRoot.addEventListener('pointerup', onPointerUp);
  pointerEventRoot.addEventListener('pointercancel', onPointerCancel);
  list.addEventListener('dragend', clearDrag);
  list.addEventListener('dragleave', event => {
    if (dropRow && !dropRow.contains(event.relatedTarget)) clearDropTarget();
  });
}
