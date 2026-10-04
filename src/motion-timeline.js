/** Clamp a dragged keyframe to the nearest unoccupied millisecond in its track. */
export function resolveMotionKeyframeDragTime(track, keyframeId, requestedTimeMs, durationMs, direction = 0) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) {
    throw new TypeError('Motion timeline duration must be a positive whole number of milliseconds.');
  }
  if (!Number.isFinite(requestedTimeMs)) throw new TypeError('Motion keyframe drag time must be finite.');
  const keyframe = track?.keyframes?.find(item => item.id === keyframeId);
  if (!keyframe) return null;

  const target = Math.max(0, Math.min(durationMs, Math.round(requestedTimeMs)));
  const occupied = new Set(track.keyframes.filter(item => item.id !== keyframeId).map(item => item.timeMs));
  if (!occupied.has(target)) return target;

  let before = target - 1;
  while (before >= 0 && occupied.has(before)) before -= 1;
  let after = target + 1;
  while (after <= durationMs && occupied.has(after)) after += 1;
  if (before < 0) return after <= durationMs ? after : keyframe.timeMs;
  if (after > durationMs) return before;

  const beforeDistance = target - before;
  const afterDistance = after - target;
  if (beforeDistance < afterDistance) return before;
  if (afterDistance < beforeDistance) return after;
  return direction < 0 ? before : after;
}
