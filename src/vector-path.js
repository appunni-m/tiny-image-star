function finitePoint(point) {
  return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

/** Convert absolute anchor/control coordinates into a scalable path layer. */
export function vectorGeometryFromAnchors(anchors, { closed = false } = {}) {
  if (!Array.isArray(anchors) || anchors.length < 2) throw new TypeError('A vector path needs at least two points.');
  if (anchors.some(point => !finitePoint(point) || (point.in && !finitePoint(point.in)) || (point.out && !finitePoint(point.out)))) {
    throw new TypeError('Vector path points must contain finite coordinates.');
  }

  const extents = [];
  for (const point of anchors) {
    extents.push(point);
    if (point.in) extents.push(point.in);
    if (point.out) extents.push(point.out);
  }
  const left = Math.min(...extents.map(point => Number(point.x)));
  const top = Math.min(...extents.map(point => Number(point.y)));
  const right = Math.max(...extents.map(point => Number(point.x)));
  const bottom = Math.max(...extents.map(point => Number(point.y)));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  return {
    x: left, y: top, width, height, closed,
    points: anchors.map(point => {
      const anchorX = Number(point.x);
      const anchorY = Number(point.y);
      return {
        x: (anchorX - left) / width,
        y: (anchorY - top) / height,
        in: point.in ? { x: (Number(point.in.x) - anchorX) / width, y: (Number(point.in.y) - anchorY) / height } : { x: 0, y: 0 },
        out: point.out ? { x: (Number(point.out.x) - anchorX) / width, y: (Number(point.out.y) - anchorY) / height } : { x: 0, y: 0 }
      };
    })
  };
}

/** Return an anchor or its Bézier control point in document coordinates. */
export function vectorNodePoint(node, index, part = 'anchor', origin = { x: node.x, y: node.y }) {
  const point = node?.points?.[index];
  if (!point) return null;
  const anchorX = origin.x + Number(point.x) * node.width;
  const anchorY = origin.y + Number(point.y) * node.height;
  if (part === 'anchor') return { x: anchorX, y: anchorY };
  const handle = point[part];
  if (!handle) return { x: anchorX, y: anchorY };
  return { x: anchorX + Number(handle.x || 0) * node.width, y: anchorY + Number(handle.y || 0) * node.height };
}

/** Move an anchor/control point using document coordinates. */
export function setVectorNodePoint(node, index, part, position, { origin = { x: node.x, y: node.y }, symmetric = false } = {}) {
  const point = node?.points?.[index];
  if (!point || !finitePoint(position) || !['anchor', 'in', 'out'].includes(part)) return false;
  const width = Math.max(1, Number(node.width) || 1);
  const height = Math.max(1, Number(node.height) || 1);
  const anchor = vectorNodePoint(node, index, 'anchor', origin);
  if (part === 'anchor') {
    point.x = (Number(position.x) - origin.x) / width;
    point.y = (Number(position.y) - origin.y) / height;
    return true;
  }
  const handle = { x: (Number(position.x) - anchor.x) / width, y: (Number(position.y) - anchor.y) / height };
  point[part] = handle;
  if (symmetric) point[part === 'in' ? 'out' : 'in'] = { x: -handle.x, y: -handle.y };
  return true;
}
