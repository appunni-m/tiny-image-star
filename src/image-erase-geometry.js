const QUARTER_TURNS = new Set([0, 90, 180, 270]);

function positiveBounds(bounds) {
  if (!bounds || ![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0) {
    throw new TypeError('The displayed image bounds must be finite and positive.');
  }
  return bounds;
}

/** Map a pointer in the rotated/flipped image display back to source-relative coordinates. */
export function imageErasePointFromDisplay(point, bounds, { rotation = 0, flipHorizontal = false, flipVertical = false } = {}) {
  positiveBounds(bounds);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError('The erase pointer must have finite coordinates.');
  }
  if (!QUARTER_TURNS.has(rotation)) throw new TypeError('Image rotation must use a quarter turn.');
  let x = Math.max(0, Math.min(1, (point.x - bounds.left) / bounds.width));
  let y = Math.max(0, Math.min(1, (point.y - bounds.top) / bounds.height));
  if (flipHorizontal) x = 1 - x;
  if (flipVertical) y = 1 - y;
  switch (rotation) {
    case 90: return { x: y, y: 1 - x };
    case 180: return { x: 1 - x, y: 1 - y };
    case 270: return { x: 1 - y, y: x };
    default: return { x, y };
  }
}

/** Convert an on-screen brush diameter to a source-relative, recipe-stable radius. */
export function imageEraseRadiusFraction({ brushDiameterCssPx, zoom, imageScale, sourceWidth, sourceHeight }) {
  if (![brushDiameterCssPx, zoom, imageScale].every(Number.isFinite)
    || brushDiameterCssPx <= 0 || zoom <= 0 || imageScale <= 0
    || !Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight)
    || sourceWidth < 1 || sourceHeight < 1) {
    throw new TypeError('The object-erase brush needs a valid image size and display scale.');
  }
  const shortEdge = Math.min(sourceWidth, sourceHeight);
  const sourceRadius = Math.max(1, brushDiameterCssPx / (2 * zoom * imageScale));
  return Math.min(0.25, sourceRadius / shortEdge);
}

/** Resolve the recipe brush radius for a displayed source image in local units. */
export function imageEraseRadiusLocal(radiusFraction, sourceWidth, sourceHeight, imageScale) {
  if (!Number.isFinite(radiusFraction) || radiusFraction <= 0 || radiusFraction > 0.25
    || !Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight)
    || sourceWidth < 1 || sourceHeight < 1 || !Number.isFinite(imageScale) || imageScale <= 0) {
    throw new TypeError('The saved object-erase brush geometry is invalid.');
  }
  return Math.max(1, radiusFraction * Math.min(sourceWidth, sourceHeight)) * imageScale;
}
