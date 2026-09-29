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

/** Return the cubic segment joining one path anchor to the next. */
export function vectorSegmentPoints(node, index, origin = { x: node.x, y: node.y }) {
  const points = node?.points || [];
  const nextIndex = (index + 1) % points.length;
  if (points.length < 2 || !Number.isInteger(index) || index < 0 || index >= points.length || (!node?.closed && nextIndex === 0)) return null;
  return [
    vectorNodePoint(node, index, 'anchor', origin),
    vectorNodePoint(node, index, 'out', origin),
    vectorNodePoint(node, nextIndex, 'in', origin),
    vectorNodePoint(node, nextIndex, 'anchor', origin)
  ];
}

/** Evaluate a path segment at t in the interval [0, 1]. */
export function vectorSegmentPoint(node, index, t, origin = { x: node.x, y: node.y }) {
  const segment = vectorSegmentPoints(node, index, origin);
  if (!segment) return null;
  const amount = Math.max(0, Math.min(1, Number(t)));
  const inverse = 1 - amount;
  const [start, control1, control2, end] = segment;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * amount * control1.x + 3 * inverse * amount ** 2 * control2.x + amount ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * amount * control1.y + 3 * inverse * amount ** 2 * control2.y + amount ** 3 * end.y
  };
}

/** Find the closest point on any open or closed path segment. */
export function closestVectorSegment(node, position, origin = { x: node.x, y: node.y }) {
  const points = node?.points || [];
  const segmentCount = node?.closed ? points.length : points.length - 1;
  let closest = null;
  const distanceAt = (index, t) => {
    const point = vectorSegmentPoint(node, index, t, origin);
    return { point, distance: Math.hypot(position.x - point.x, position.y - point.y) };
  };
  for (let index = 0; index < segmentCount; index += 1) {
    const samples = 64;
    let bestT = 0;
    let best = distanceAt(index, bestT);
    for (let sample = 1; sample <= samples; sample += 1) {
      const t = sample / samples;
      const candidate = distanceAt(index, t);
      if (candidate.distance < best.distance) { bestT = t; best = candidate; }
    }
    let low = Math.max(0, bestT - 1 / samples);
    let high = Math.min(1, bestT + 1 / samples);
    for (let iteration = 0; iteration < 18; iteration += 1) {
      const left = low + (high - low) / 3;
      const right = high - (high - low) / 3;
      if (distanceAt(index, left).distance <= distanceAt(index, right).distance) high = right;
      else low = left;
    }
    const t = (low + high) / 2;
    const candidate = distanceAt(index, t);
    if (!closest || candidate.distance < closest.distance) closest = { segmentIndex: index, t, ...candidate };
  }
  return closest;
}

/** Subdivide a cubic segment in place without changing its curve. */
export function insertVectorNodePoint(node, segmentIndex, t = .5, origin = { x: node.x, y: node.y }) {
  const points = node?.points || [];
  const segment = vectorSegmentPoints(node, segmentIndex, origin);
  if (!segment || !Number.isFinite(Number(t))) return -1;
  const amount = Math.max(.000001, Math.min(.999999, Number(t)));
  const [p0, p1, p2, p3] = segment;
  const lerp = (left, right) => ({ x: left.x + (right.x - left.x) * amount, y: left.y + (right.y - left.y) * amount });
  const a = lerp(p0, p1);
  const b = lerp(p1, p2);
  const c = lerp(p2, p3);
  const d = lerp(a, b);
  const e = lerp(b, c);
  const anchor = lerp(d, e);
  const width = Math.max(1, Number(node.width) || 1);
  const height = Math.max(1, Number(node.height) || 1);
  const handle = (point, anchorPoint) => ({ x: (point.x - anchorPoint.x) / width, y: (point.y - anchorPoint.y) / height });
  const nextIndex = (segmentIndex + 1) % points.length;
  points[segmentIndex].out = handle(a, p0);
  points[nextIndex].in = handle(c, p3);
  const insertedIndex = nextIndex === 0 ? points.length : nextIndex;
  points.splice(insertedIndex, 0, {
    x: (anchor.x - Number(origin.x || 0)) / width, y: (anchor.y - Number(origin.y || 0)) / height,
    in: handle(d, anchor), out: handle(e, anchor)
  });
  return insertedIndex;
}

/** Remove one path anchor while retaining the minimum two-point path. */
export function removeVectorNodePoint(node, index) {
  if (!Array.isArray(node?.points) || node.points.length <= 2 || !Number.isInteger(index) || index < 0 || index >= node.points.length) return null;
  return node.points.splice(index, 1)[0];
}

/** Find the longest path segment for one-tap point insertion on touch devices. */
export function longestVectorSegment(node, origin = { x: node.x, y: node.y }) {
  const segmentCount = node?.closed ? node.points?.length || 0 : (node?.points?.length || 0) - 1;
  let longest = null;
  for (let index = 0; index < segmentCount; index += 1) {
    let length = 0;
    let previous = vectorSegmentPoint(node, index, 0, origin);
    for (let sample = 1; sample <= 24; sample += 1) {
      const current = vectorSegmentPoint(node, index, sample / 24, origin);
      length += Math.hypot(current.x - previous.x, current.y - previous.y);
      previous = current;
    }
    if (!longest || length > longest.length) longest = { segmentIndex: index, t: .5, length };
  }
  return longest;
}
