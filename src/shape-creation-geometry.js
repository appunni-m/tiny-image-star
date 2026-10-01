const constrainedShapeTypes = new Set(['frame', 'section', 'rectangle', 'ellipse', 'star', 'polygon']);

function finitePoint(point, label) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${label} must contain finite x and y coordinates.`);
  }
}

function signed(value) {
  return value < 0 ? -1 : 1;
}

/**
 * Calculate a normalized drag-created shape rectangle.
 * Shift makes supported shapes square and snaps lines to 45° increments;
 * Alt treats the initial pointer as the center instead of a corner.
 */
export function shapeCreationGeometry(type, start, end, { shiftKey = false, altKey = false } = {}) {
  if (typeof type !== 'string' || !type) throw new TypeError('Shape type must be a non-empty string.');
  finitePoint(start, 'Shape start');
  finitePoint(end, 'Shape end');

  let dx = end.x - start.x;
  let dy = end.y - start.y;
  let lineReverseY = false;

  if (type === 'line' && shiftKey) {
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      const angle = Math.atan2(dy, dx);
      const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      dx = Math.cos(snappedAngle) * length;
      dy = Math.sin(snappedAngle) * length;
    }
  } else if (constrainedShapeTypes.has(type) && shiftKey) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = signed(dx) * side;
    dy = signed(dy) * side;
  }

  lineReverseY = type === 'line' && dx * dy < 0;
  const x = altKey ? start.x - Math.abs(dx) : Math.min(start.x, start.x + dx);
  const y = altKey ? start.y - Math.abs(dy) : Math.min(start.y, start.y + dy);
  const width = Math.abs(dx) * (altKey ? 2 : 1);
  const height = Math.abs(dy) * (altKey ? 2 : 1);

  return {
    x,
    y,
    width: type === 'line' ? width : Math.max(1, width),
    height: type === 'line' ? height : Math.max(1, height),
    lineReverseY
  };
}
