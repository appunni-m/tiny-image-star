function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
}

function positive(value, label) {
  finite(value, label);
  if (value <= 0) throw new RangeError(`${label} must be positive.`);
}

function checkedAxis(axis) {
  if (axis !== 'x' && axis !== 'y') throw new TypeError('Guide axis must be x or y.');
  return axis;
}

function checkedGuidePositions(guides) {
  if (!Array.isArray(guides)) throw new TypeError('Guides must be an array of finite page positions.');
  for (const guide of guides) finite(guide, 'Guide position');
  return guides;
}

/**
 * Convert a pointer position from client CSS pixels to a page-space ruler
 * coordinate. `rect` is the canvas bounding client rect; `pan` is the canvas
 * translation in CSS pixels; and `zoom` scales page units into CSS pixels.
 *
 * Guide snapping is opt-in. When `snapToGuides` is true, the nearest guide is
 * returned only when it is within `tolerancePx` CSS pixels; otherwise the
 * unsnapped page coordinate is returned. Guides are scalar page coordinates
 * for the requested axis.
 */
export function clientToPageGuidePosition({
  client,
  rect,
  pan = { x: 0, y: 0 },
  zoom,
  axis,
  snapToGuides = false,
  guides = [],
  tolerancePx = 6,
}) {
  const selectedAxis = checkedAxis(axis);
  if (!client || !rect || !pan) throw new TypeError('Client point, canvas rect, and pan are required.');
  finite(client.x, 'Client x');
  finite(client.y, 'Client y');
  finite(rect.left, 'Canvas left');
  finite(rect.top, 'Canvas top');
  finite(pan.x, 'Pan x');
  finite(pan.y, 'Pan y');
  positive(zoom, 'Zoom');
  if (typeof snapToGuides !== 'boolean') throw new TypeError('Guide snapping must be a boolean.');

  const coordinate = selectedAxis === 'x' ? client.x : client.y;
  const origin = selectedAxis === 'x' ? rect.left : rect.top;
  const translation = selectedAxis === 'x' ? pan.x : pan.y;
  const position = (coordinate - origin - translation) / zoom;
  finite(position, 'Page guide position');

  if (!snapToGuides) return position;
  const nearest = findNearestGuideWithinCssTolerance(position, guides, { zoom, tolerancePx });
  return nearest ? nearest.position : position;
}

/**
 * Find the closest scalar page-space guide to `position` that is no farther
 * than `tolerancePx` in CSS pixels at the current zoom. Returns null when no
 * guide is close enough. Ties keep the first guide in the input array.
 */
export function findNearestGuideWithinCssTolerance(position, guides, { zoom, tolerancePx = 6 } = {}) {
  finite(position, 'Page guide position');
  positive(zoom, 'Zoom');
  finite(tolerancePx, 'Guide tolerance');
  if (tolerancePx < 0) throw new RangeError('Guide tolerance cannot be negative.');
  const candidates = checkedGuidePositions(guides);

  let nearest = null;
  for (const guidePosition of candidates) {
    const distancePx = Math.abs(guidePosition - position) * zoom;
    if (distancePx <= tolerancePx && (!nearest || distancePx < nearest.distancePx)) {
      nearest = { position: guidePosition, distancePx };
    }
  }
  return nearest;
}
