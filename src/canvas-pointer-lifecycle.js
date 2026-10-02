/** Whether a release missed the captured canvas but belongs to its active pointer. */
export function shouldRouteCanvasPointerCompletion(event, canvas, pointerMap) {
  if (!['pointerup', 'pointercancel'].includes(event?.type)
    || !canvas || typeof canvas.contains !== 'function'
    || !pointerMap || typeof pointerMap.has !== 'function') return false;
  return !canvas.contains(event.target) && pointerMap.has(event.pointerId);
}

/** Let Delete/Backspace recover even when a lost release leaves a stale pointer recorded. */
export function shouldRecoverCanvasInteractionForDelete(key, interaction, editing) {
  return Boolean(interaction)
    && !editing
    && (key === 'Delete' || key === 'Backspace');
}
