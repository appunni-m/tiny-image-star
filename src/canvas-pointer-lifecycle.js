/** Whether a release missed the captured canvas but belongs to its active pointer. */
export function shouldRouteCanvasPointerCompletion(event, canvas, pointerMap) {
  if (!['pointerup', 'pointercancel'].includes(event?.type)
    || !canvas || typeof canvas.contains !== 'function'
    || !pointerMap || typeof pointerMap.has !== 'function') return false;
  return !canvas.contains(event.target) && pointerMap.has(event.pointerId);
}

/** Let a delete shortcut recover when an interaction outlives every pointer. */
export function shouldRecoverCanvasInteractionForDelete(key, interaction, activePointerCount, editing) {
  return Boolean(interaction)
    && activePointerCount === 0
    && !editing
    && (key === 'Delete' || key === 'Backspace');
}
