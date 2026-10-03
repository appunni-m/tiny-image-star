import { CANVAS_TOUCH_DRAG_THRESHOLD_PX } from './canvas-drag-slop.js';

export const CANVAS_CONTEXT_PRESS_DELAY_MS = 560;
// A touch that has moved far enough to start dragging must no longer become a
// context press if the finger pauses before release. Keep this in lockstep
// with the canvas drag gate so the two gestures cannot claim the same motion.
export const CANVAS_CONTEXT_PRESS_MOVE_TOLERANCE = CANVAS_TOUCH_DRAG_THRESHOLD_PX;

export function shouldArmCanvasContextPress({ pointerType, tool, button = 0, isLayerHit = false }) {
  return (pointerType === 'touch' || pointerType === 'pen')
    && tool === 'select'
    && button === 0
    && isLayerHit;
}

export function createCanvasContextPressController({
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  delayMs = CANVAS_CONTEXT_PRESS_DELAY_MS,
  moveTolerance = CANVAS_CONTEXT_PRESS_MOVE_TOLERANCE
} = {}) {
  let pending = null;

  function cancel() {
    if (!pending) return false;
    clearTimer(pending.timer);
    pending = null;
    return true;
  }

  return {
    arm({ pointerId, pointerType, x, y, payload }, onFire) {
      cancel();
      if (!Number.isFinite(pointerId) || !Number.isFinite(x) || !Number.isFinite(y) || typeof onFire !== 'function') return false;
      const current = { pointerId, pointerType, x, y, payload, timer: null };
      current.timer = setTimer(() => {
        if (pending !== current) return;
        pending = null;
        onFire(current.payload);
      }, delayMs);
      pending = current;
      return true;
    },
    move({ pointerId, x, y }) {
      if (!pending || pending.pointerId !== pointerId) return false;
      if (Math.hypot(x - pending.x, y - pending.y) <= moveTolerance) return false;
      cancel();
      return true;
    },
    finish(pointerId) {
      if (!pending || (pointerId != null && pending.pointerId !== pointerId)) return false;
      return cancel();
    },
    cancel,
    get pendingPointerId() { return pending?.pointerId ?? null; }
  };
}
