/** Choose the nearest handle using coordinates and distances in screen pixels. */
export function nearestScreenHandle(point, handles, radius) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw new TypeError('Handle hit point must contain finite screen coordinates.');
  if (!Array.isArray(handles)) throw new TypeError('Handles must be an array.');
  if (!Number.isFinite(radius) || radius < 0) throw new TypeError('Handle hit radius must be a finite non-negative distance.');

  const radiusSquared = radius * radius;
  let nearest = null;
  for (const handle of handles) {
    if (!Number.isFinite(handle?.point?.x) || !Number.isFinite(handle?.point?.y)) {
      throw new TypeError('Handle hit candidates must contain finite screen coordinates.');
    }
    const dx = point.x - handle.point.x;
    const dy = point.y - handle.point.y;
    const distanceSquared = dx * dx + dy * dy;
    // Resize is the safer action when a small target puts its resize and rotate
    // handles at the same screen point. Keep candidate order for other exact
    // ties so callers can still define priority between equivalent handles.
    const resizeWinsTie = distanceSquared === nearest?.distanceSquared
      && handle.kind === 'resize' && nearest.kind === 'rotate';
    if (distanceSquared <= radiusSquared
      && (!nearest || distanceSquared < nearest.distanceSquared || resizeWinsTie)) {
      nearest = { ...handle, distanceSquared };
    }
  }
  return nearest;
}
