const AXES = {
  x: { start: 'left', end: 'right', size: 'width', middle: 'centerX', guideFrom: 'top', guideTo: 'bottom' },
  y: { start: 'top', end: 'bottom', size: 'height', middle: 'centerY', guideFrom: 'left', guideTo: 'right' }
};

function normalizedBounds(value) {
  if (!value || ![value.x, value.y, value.width, value.height].every(number => Number.isFinite(Number(number)))) return null;
  const x = Number(value.x); const y = Number(value.y);
  const width = Math.max(0, Number(value.width)); const height = Math.max(0, Number(value.height));
  return { left: x, right: x + width, top: y, bottom: y + height };
}

function featureValues(bounds, axis) {
  if (axis === 'x') return [
    { value: bounds.left, name: 'left' },
    { value: (bounds.left + bounds.right) / 2, name: 'center' },
    { value: bounds.right, name: 'right' }
  ];
  return [
    { value: bounds.top, name: 'top' },
    { value: (bounds.top + bounds.bottom) / 2, name: 'center' },
    { value: bounds.bottom, name: 'bottom' }
  ];
}

function boundsUnion(bounds) {
  return {
    left: Math.min(...bounds.map(value => value.left)),
    right: Math.max(...bounds.map(value => value.right)),
    top: Math.min(...bounds.map(value => value.top)),
    bottom: Math.max(...bounds.map(value => value.bottom))
  };
}

/**
 * Snap a translating selection to the nearest visible peer edge or center.
 * Bounds and deltas use page coordinates. The threshold is also in page units,
 * so callers can scale it by the current canvas zoom.
 */
export function snapToAlignmentGuides(moving, targets, delta = { x: 0, y: 0 }, threshold = 6) {
  const movingBounds = (Array.isArray(moving) ? moving : [moving]).map(normalizedBounds).filter(Boolean);
  const targetBounds = (Array.isArray(targets) ? targets : [targets]).map(normalizedBounds).filter(Boolean);
  const requestedX = Number.isFinite(Number(delta?.x)) ? Number(delta.x) : 0;
  const requestedY = Number.isFinite(Number(delta?.y)) ? Number(delta.y) : 0;
  const range = Math.max(0, Number.isFinite(Number(threshold)) ? Number(threshold) : 0);
  if (!movingBounds.length || !targetBounds.length || range === 0) return { x: requestedX, y: requestedY, guides: [] };

  const movingBox = boundsUnion(movingBounds);
  const corrections = { x: 0, y: 0 };
  const matches = {};
  for (const axis of ['x', 'y']) {
    const meta = AXES[axis];
    const currentDelta = axis === 'x' ? requestedX : requestedY;
    let best = null;
    const movingFeatures = featureValues(movingBox, axis);
    for (const targetBox of targetBounds) {
      const targetFeatures = featureValues(targetBox, axis);
      for (const source of movingFeatures) for (const target of targetFeatures) {
        const correction = target.value - (source.value + currentDelta);
        const distance = Math.abs(correction);
        if (distance > range) continue;
        const sameFeature = source.name === target.name ? 0 : 1;
        const rank = [distance, sameFeature, target.value, source.name, target.name];
        if (!best || rank[0] < best.rank[0] - 1e-9
          || (Math.abs(rank[0] - best.rank[0]) <= 1e-9 && rank[1] < best.rank[1])) {
          best = { correction, position: target.value, movingFeature: source.name, targetFeature: target.name, targetBox, rank };
        }
      }
    }
    if (!best) continue;
    corrections[axis] = best.correction;
    matches[axis] = best;
  }
  const guides = [];
  const shifted = {
    left: movingBox.left + requestedX + corrections.x,
    right: movingBox.right + requestedX + corrections.x,
    top: movingBox.top + requestedY + corrections.y,
    bottom: movingBox.bottom + requestedY + corrections.y
  };
  for (const axis of ['x', 'y']) {
    const best = matches[axis];
    if (!best) continue;
    const meta = AXES[axis];
    guides.push({
      axis,
      position: best.position,
      from: Math.min(shifted[meta.guideFrom], best.targetBox[meta.guideFrom]),
      to: Math.max(shifted[meta.guideTo], best.targetBox[meta.guideTo]),
      movingFeature: best.movingFeature,
      targetFeature: best.targetFeature
    });
  }
  return { x: requestedX + corrections.x, y: requestedY + corrections.y, guides };
}

/** Draw guide geometry in page coordinates while keeping its stroke screen-sized. */
export function drawAlignmentGuides(context, guides, zoom = 1) {
  if (!context || !Array.isArray(guides) || guides.length === 0) return 0;
  const scale = Math.max(.08, Number.isFinite(Number(zoom)) ? Number(zoom) : 1);
  context.save();
  context.beginPath();
  for (const guide of guides) {
    if (!guide || !Number.isFinite(guide.position) || !Number.isFinite(guide.from) || !Number.isFinite(guide.to)) continue;
    if (guide.axis === 'x') {
      context.moveTo(guide.position, guide.from);
      context.lineTo(guide.position, guide.to);
    } else if (guide.axis === 'y') {
      context.moveTo(guide.from, guide.position);
      context.lineTo(guide.to, guide.position);
    }
  }
  context.strokeStyle = '#ff4db8';
  context.lineWidth = 1 / scale;
  context.setLineDash([]);
  context.stroke();
  context.restore();
  return guides.filter(guide => guide && (guide.axis === 'x' || guide.axis === 'y')
    && Number.isFinite(guide.position) && Number.isFinite(guide.from) && Number.isFinite(guide.to)).length;
}
