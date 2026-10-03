/** CSS-pixel movement needed before a touch drag changes a selected layer. */
export const CANVAS_TOUCH_DRAG_THRESHOLD_PX = 8;

/**
 * Gate layer movement/reordering until the active touch has moved far enough
 * to distinguish a deliberate drag from the small jitter common on phones.
 * Pointer coordinates are viewport CSS pixels, so the threshold is stable at
 * every canvas zoom level.
 */
export function beginCanvasDragAfterSlop(interaction, event) {
  if (!interaction || !event || !['move', 'reorder'].includes(interaction.kind)) return false;
  if (interaction.pointerId != null && interaction.pointerId !== event.pointerId) return false;
  if (interaction.dragStarted) return true;

  if (interaction.pointerType !== 'touch') {
    interaction.dragStarted = true;
    return true;
  }

  const start = interaction.startClient;
  if (!Number.isFinite(start?.x) || !Number.isFinite(start?.y)
    || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= CANVAS_TOUCH_DRAG_THRESHOLD_PX) return false;

  interaction.dragStarted = true;
  return true;
}
