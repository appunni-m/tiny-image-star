function finitePoint(point) {
  return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

export const VECTOR_ANCHOR_MODES = Object.freeze(['corner', 'smooth', 'symmetric']);
const vectorAnchorModes = new Set(VECTOR_ANCHOR_MODES);

function isVectorAnchorMode(mode) {
  return vectorAnchorModes.has(mode);
}

function constrainOppositeHandle(point, part, mode, width, height) {
  const oppositePart = part === 'in' ? 'out' : 'in';
  const active = point[part];
  const activeVector = { x: (Number(active?.x) || 0) * width, y: (Number(active?.y) || 0) * height };
  const activeLength = Math.hypot(activeVector.x, activeVector.y);
  if (mode === 'symmetric') {
    point[oppositePart] = { x: -(Number(active?.x) || 0), y: -(Number(active?.y) || 0) };
    return;
  }
  if (mode !== 'smooth') return;

  // Smooth handles share a tangent but keep independent lengths. If the
  // opposite handle does not yet exist, start it at the active handle's
  // length so the new tangent is visible immediately.
  const opposite = point[oppositePart];
  const oppositeLength = Math.hypot((Number(opposite?.x) || 0) * width, (Number(opposite?.y) || 0) * height) || activeLength;
  if (activeLength === 0 || oppositeLength === 0) {
    point[oppositePart] = { x: 0, y: 0 };
    return;
  }
  point[oppositePart] = {
    x: -activeVector.x / activeLength * oppositeLength / width,
    y: -activeVector.y / activeLength * oppositeLength / height
  };
}

/** Normalize one or more editable contours to a shared scalable path box. */
export function vectorGeometryFromContours(contours) {
  if (!Array.isArray(contours) || !contours.length || contours.length > 10_000) throw new TypeError('A vector path needs between one and 10000 contours.');
  let pointCount = 0;
  const extents = [];
  for (const contour of contours) {
    const anchors = contour?.anchors;
    if (!Array.isArray(anchors) || anchors.length < 2 || typeof contour.closed !== 'boolean') throw new TypeError('Every vector contour needs at least two points and a closed setting.');
    pointCount += anchors.length;
    if (pointCount > 20_000) throw new RangeError('A vector path can contain at most 20000 points.');
    if (anchors.some(point => !finitePoint(point) || (point.in && !finitePoint(point.in)) || (point.out && !finitePoint(point.out)))) {
      throw new TypeError('Vector path points must contain finite coordinates.');
    }
    if (anchors.some(point => point.mode != null && !isVectorAnchorMode(point.mode))) {
      throw new TypeError('Vector path anchor modes must be corner, smooth, or symmetric.');
    }
    for (const point of anchors) {
      extents.push(point);
      if (point.in) extents.push(point.in);
      if (point.out) extents.push(point.out);
    }
  }
  const left = Math.min(...extents.map(point => Number(point.x)));
  const top = Math.min(...extents.map(point => Number(point.y)));
  const right = Math.max(...extents.map(point => Number(point.x)));
  const bottom = Math.max(...extents.map(point => Number(point.y)));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  const normalized = contours.map(({ anchors, closed }) => ({
    closed,
    points: anchors.map(point => {
      const anchorX = Number(point.x);
      const anchorY = Number(point.y);
      const converted = {
        x: (anchorX - left) / width,
        y: (anchorY - top) / height,
        in: point.in ? { x: (Number(point.in.x) - anchorX) / width, y: (Number(point.in.y) - anchorY) / height } : { x: 0, y: 0 },
        out: point.out ? { x: (Number(point.out.x) - anchorX) / width, y: (Number(point.out.y) - anchorY) / height } : { x: 0, y: 0 }
      };
      // Omit the field for legacy/import callers that have no mode data. Once
      // an anchor mode is explicitly chosen, it remains ordinary path data and
      // survives document serialization without changing older path behavior.
      if (point.mode != null) converted.mode = point.mode;
      return converted;
    })
  }));
  return {
    x: left, y: top, width, height,
    closed: normalized[0].closed,
    points: normalized[0].points,
    ...(normalized.length > 1 ? { subpaths: normalized.slice(1) } : {})
  };
}

/** Convert absolute anchor/control coordinates into a scalable path layer. */
export function vectorGeometryFromAnchors(anchors, { closed = false } = {}) {
  return vectorGeometryFromContours([{ anchors, closed }]);
}

/** Return a path's contour records with the primary legacy fields at index zero. */
export function vectorPathContours(node) {
  return [
    { points: node?.points || [], closed: node?.closed ?? false },
    ...(Array.isArray(node?.subpaths) ? node.subpaths : [])
  ];
}

function finitePathPoint(point) {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function pathCubic(points, index, width, height) {
  const start = points[index];
  const end = points[(index + 1) % points.length];
  if (!start || !end || !finitePathPoint(start) || !finitePathPoint(end)
    || (start.out != null && !finitePathPoint(start.out))
    || (end.in != null && !finitePathPoint(end.in))) return null;
  const p0 = { x: start.x * width, y: start.y * height };
  const p3 = { x: end.x * width, y: end.y * height };
  const out = start.out || { x: 0, y: 0 };
  const incoming = end.in || { x: 0, y: 0 };
  const p1 = { x: p0.x + out.x * width, y: p0.y + out.y * height };
  const p2 = { x: p3.x + incoming.x * width, y: p3.y + incoming.y * height };
  if (![p0, p1, p2, p3].every(finitePathPoint)) return null;
  return { p0, p1, p2, p3 };
}

function cubicPointAt(segment, t) {
  const u = 1 - t;
  return {
    x: u ** 3 * segment.p0.x + 3 * u ** 2 * t * segment.p1.x + 3 * u * t ** 2 * segment.p2.x + t ** 3 * segment.p3.x,
    y: u ** 3 * segment.p0.y + 3 * u ** 2 * t * segment.p1.y + 3 * u * t ** 2 * segment.p2.y + t ** 3 * segment.p3.y
  };
}

function unitPathTangent(vector) {
  const length = Math.hypot(vector.x, vector.y);
  return Number.isFinite(length) && length > 1e-9 ? { x: vector.x / length, y: vector.y / length } : null;
}

function deletionParameterWeights(points, segmentIndexes, width, height, fallback) {
  const logWeights = [0];
  for (let index = 1; index < segmentIndexes.length; index += 1) {
    const join = points[segmentIndexes[index]];
    const incoming = { x: (Number(join?.in?.x) || 0) * width, y: (Number(join?.in?.y) || 0) * height };
    const outgoing = { x: (Number(join?.out?.x) || 0) * width, y: (Number(join?.out?.y) || 0) * height };
    const incomingLength = Math.hypot(incoming.x, incoming.y);
    const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
    if (!(incomingLength > 1e-9) || !(outgoingLength > 1e-9)) return fallback;
    const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    if (dot >= -incomingLength * outgoingLength * .95
      || Math.abs(cross) > incomingLength * outgoingLength * .32) return fallback;
    logWeights.push(logWeights.at(-1) + Math.log(outgoingLength / incomingLength));
  }
  const maximum = logWeights.reduce((current, value) => Math.max(current, value), -Infinity);
  const weights = logWeights.map(value => Math.exp(Math.max(-700, value - maximum)));
  const sum = weights.reduce((total, value) => total + value, 0);
  return Number.isFinite(sum) && sum > 0 ? weights.map(value => value / sum) : fallback;
}

/**
 * Fit one cubic to the span between surviving anchors. The authored endpoint
 * positions and tangent directions stay fixed; least squares chooses the
 * handle lengths. Explicitly constrained endpoint modes are left untouched.
 */
function fitPathDeletionJoin(points, segmentIndexes, width, height) {
  const segments = segmentIndexes.map(index => pathCubic(points, index, width, height));
  if (!segments.length || segments.some(segment => !segment)) return null;
  const startPoint = points[segmentIndexes[0]];
  const endPoint = points[(segmentIndexes.at(-1) + 1) % points.length];
  if ((startPoint.mode != null && startPoint.mode !== 'corner')
    || (endPoint.mode != null && endPoint.mode !== 'corner')) return null;
  if (!segments.some(({ p0, p1, p2, p3 }) =>
    Math.hypot(p1.x - p0.x, p1.y - p0.y) > 1e-9 || Math.hypot(p3.x - p2.x, p3.y - p2.y) > 1e-9)) return null;

  const samplesPerSegment = 24;
  const samples = segments.map(segment => Array.from({ length: samplesPerSegment + 1 }, (_, index) => cubicPointAt(segment, index / samplesPerSegment)));
  const lengths = samples.map(segmentSamples => segmentSamples.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - segmentSamples[index].x, point.y - segmentSamples[index].y), 0));
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  if (!Number.isFinite(totalLength) || totalLength <= 1e-9) return null;
  const weights = deletionParameterWeights(points, segmentIndexes, width, height,
    lengths.map(length => length / totalLength));

  const first = segments[0];
  const last = segments.at(-1);
  const startTangent = unitPathTangent({ x: first.p1.x - first.p0.x, y: first.p1.y - first.p0.y })
    || unitPathTangent({ x: first.p3.x - first.p0.x, y: first.p3.y - first.p0.y });
  const endTangent = unitPathTangent({ x: last.p3.x - last.p2.x, y: last.p3.y - last.p2.y })
    || unitPathTangent({ x: last.p3.x - last.p0.x, y: last.p3.y - last.p0.y });
  if (!startTangent || !endTangent) return null;

  let aa = 0; let ab = 0; let bb = 0; let ar = 0; let br = 0;
  const { p0 } = first;
  const { p3 } = last;
  let precedingWeight = 0;
  for (const [segmentIndex, segmentSamples] of samples.entries()) {
    const segmentWeight = weights[segmentIndex];
    for (let index = 0; index <= samplesPerSegment; index += 1) {
      const point = segmentSamples[index];
      const t = Math.max(0, Math.min(1, precedingWeight + segmentWeight * index / samplesPerSegment));
      const u = 1 - t;
      const startWeight = u ** 3 + 3 * u ** 2 * t;
      const endWeight = 3 * u * t ** 2 + t ** 3;
      const a = 3 * u ** 2 * t;
      const b = -3 * u * t ** 2;
      const residualX = point.x - startWeight * p0.x - endWeight * p3.x;
      const residualY = point.y - startWeight * p0.y - endWeight * p3.y;
      aa += a * a;
      ab += a * b * (startTangent.x * endTangent.x + startTangent.y * endTangent.y);
      bb += b * b;
      ar += a * (residualX * startTangent.x + residualY * startTangent.y);
      br += b * (residualX * endTangent.x + residualY * endTangent.y);
    }
    precedingWeight += segmentWeight;
  }
  const determinant = aa * bb - ab * ab;
  if (!Number.isFinite(determinant) || determinant <= Math.max(1e-20, aa * bb * 1e-12)) return null;
  const startHandleLength = (ar * bb - br * ab) / determinant;
  const endHandleLength = (br * aa - ar * ab) / determinant;
  if (![startHandleLength, endHandleLength].every(Number.isFinite)) return null;
  const maxHandleLength = Math.max(1, totalLength) * 1_000;
  const alpha = Math.max(0, Math.min(maxHandleLength, startHandleLength));
  const beta = Math.max(0, Math.min(maxHandleLength, endHandleLength));
  return {
    startPoint, endPoint,
    startOut: { x: alpha * startTangent.x / width, y: alpha * startTangent.y / height },
    endIn: { x: -beta * endTangent.x / width, y: -beta * endTangent.y / height }
  };
}

function pathDeletionJoins(points, closed, indexes, width, height) {
  const removed = new Set(indexes);
  const kept = points.map((_, index) => index).filter(index => !removed.has(index));
  const joins = [];
  if (closed) {
    for (let position = 0; position < kept.length; position += 1) {
      const startIndex = kept[position];
      const endIndex = kept[(position + 1) % kept.length];
      const steps = (endIndex - startIndex + points.length) % points.length;
      if (steps <= 1) continue;
      const segments = Array.from({ length: steps }, (_, offset) => (startIndex + offset) % points.length);
      const fitted = fitPathDeletionJoin(points, segments, width, height);
      if (fitted) joins.push(fitted);
    }
  } else {
    for (let position = 0; position + 1 < kept.length; position += 1) {
      const startIndex = kept[position];
      const endIndex = kept[position + 1];
      if (endIndex - startIndex <= 1) continue;
      const segments = Array.from({ length: endIndex - startIndex }, (_, offset) => startIndex + offset);
      const fitted = fitPathDeletionJoin(points, segments, width, height);
      if (fitted) joins.push(fitted);
    }
  }
  return joins;
}

/** Delete anchors across contours atomically and fit curved spans where possible. */
export function removeVectorPathPoints(node, selections, { dryRun = false } = {}) {
  if (!node || !Array.isArray(selections) || !selections.length) return false;
  const contours = vectorPathContours(node);
  const groups = new Map();
  for (const selection of selections) {
    const contourIndex = selection?.contourIndex;
    const indexes = selection?.indexes;
    const contour = contours[contourIndex];
    if (!Number.isInteger(contourIndex) || contourIndex < 0 || !contour
      || !Array.isArray(indexes) || !indexes.length) return false;
    const group = groups.get(contourIndex) || { points: contour.points, indexes: [] };
    if (group.points !== contour.points) return false;
    group.indexes.push(...indexes);
    groups.set(contourIndex, group);
  }
  for (const { points, indexes } of groups.values()) {
    if (!Array.isArray(points) || new Set(indexes).size !== indexes.length
      || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= points.length
        || !finitePoint(points[index]) || (points[index].in != null && !finitePoint(points[index].in))
        || (points[index].out != null && !finitePoint(points[index].out)))
      || points.length - indexes.length < 2) return false;
  }
  const width = Number.isFinite(node.width) && node.width > 0 ? node.width : 1;
  const height = Number.isFinite(node.height) && node.height > 0 ? node.height : 1;
  const joins = [...groups.entries()].flatMap(([contourIndex, group]) => pathDeletionJoins(
    group.points, contours[contourIndex].closed, group.indexes, width, height
  ));
  const removals = [...groups.entries()].flatMap(([contourIndex, group]) =>
    group.indexes.map(index => ({ contourIndex, index, points: group.points }))
  ).sort((left, right) => right.contourIndex - left.contourIndex || right.index - left.index);
  if (dryRun) return removals.length;
  for (const removal of removals) removal.points.splice(removal.index, 1);
  for (const join of joins) {
    join.startPoint.out = join.startOut;
    join.endPoint.in = join.endIn;
  }
  return removals.length;
}

/** Reverse a contour's direction while keeping every cubic segment unchanged. */
export function reverseVectorPathContour(node, contourIndex = 0) {
  if (!node || !Number.isInteger(contourIndex) || contourIndex < 0) return false;
  const contour = contourIndex === 0 ? node : node.subpaths?.[contourIndex - 1];
  const points = contourIndex === 0 ? node.points : contour?.points;
  if (!Array.isArray(points) || points.length < 2
    || points.some(point => !finitePoint(point) || (point.in != null && !finitePoint(point.in)) || (point.out != null && !finitePoint(point.out)))) return false;
  const reversed = points.slice().reverse().map(point => {
    const copy = { ...point };
    if (Object.hasOwn(point, 'in') || Object.hasOwn(point, 'out')) {
      copy.in = point.out == null ? point.out : { ...point.out };
      copy.out = point.in == null ? point.in : { ...point.in };
    }
    return copy;
  });
  if (contourIndex === 0) node.points = reversed;
  else contour.points = reversed;
  return true;
}

function contourAt(node, contourIndex = 0) {
  if (!Number.isInteger(contourIndex) || contourIndex < 0) return null;
  return contourIndex === 0
    ? { points: node?.points, closed: node?.closed ?? false }
    : node?.subpaths?.[contourIndex - 1] || null;
}

/** Return an anchor or its Bézier control point in document coordinates. */
export function vectorNodePoint(node, index, part = 'anchor', origin = { x: node.x, y: node.y }, contourIndex = 0) {
  const point = contourAt(node, contourIndex)?.points?.[index];
  if (!point) return null;
  const anchorX = origin.x + Number(point.x) * node.width;
  const anchorY = origin.y + Number(point.y) * node.height;
  if (part === 'anchor') return { x: anchorX, y: anchorY };
  const handle = point[part];
  if (!handle) return { x: anchorX, y: anchorY };
  return { x: anchorX + Number(handle.x || 0) * node.width, y: anchorY + Number(handle.y || 0) * node.height };
}

/** Move an anchor/control point using document coordinates. */
export function setVectorNodePoint(node, index, part, position, { origin = { x: node.x, y: node.y }, symmetric = false, contourIndex = 0 } = {}) {
  const point = contourAt(node, contourIndex)?.points?.[index];
  if (!point || !finitePoint(position) || !['anchor', 'in', 'out'].includes(part)) return false;
  const mode = point.mode == null ? (symmetric ? 'symmetric' : 'corner') : point.mode;
  if (!isVectorAnchorMode(mode)) return false;
  const width = Math.max(1, Number(node.width) || 1);
  const height = Math.max(1, Number(node.height) || 1);
  const anchor = vectorNodePoint(node, index, 'anchor', origin, contourIndex);
  if (part === 'anchor') {
    point.x = (Number(position.x) - origin.x) / width;
    point.y = (Number(position.y) - origin.y) / height;
    return true;
  }
  const handle = { x: (Number(position.x) - anchor.x) / width, y: (Number(position.y) - anchor.y) / height };
  point[part] = handle;
  constrainOppositeHandle(point, part, mode, width, height);
  return true;
}

/**
 * Capture both Bézier controls at a path anchor or degree-two network vertex.
 * Shift-dragging a control in the editor uses this snapshot to move both
 * controls by the same amount without changing their relative shape.
 */
export function vectorControlPairSnapshot(node, control, geometry = node, {
  shiftKey = false, origin = { x: 0, y: 0 }
} = {}) {
  if (!shiftKey || !node?.id || node.type !== geometry?.type
    || !finitePoint(origin) || !Number.isFinite(geometry?.width) || geometry.width <= 0
    || !Number.isFinite(geometry?.height) || geometry.height <= 0) return null;

  if (node.type === 'path' && ['in', 'out'].includes(control?.part)) {
    const contourIndex = control.contourIndex || 0;
    const contour = contourAt(node, contourIndex);
    const points = contour?.points;
    const index = control.index;
    if (!Array.isArray(points) || !Number.isInteger(index) || !points[index]) return null;
    const anchor = vectorNodePoint(geometry, index, 'anchor', origin, contourIndex);
    const handles = Object.fromEntries(['in', 'out'].map(part => {
      const point = points[index][part];
      const position = point && finitePoint(point)
        ? vectorNodePoint(geometry, index, part, origin, contourIndex)
        : anchor;
      return [part, position];
    }));
    if (!finitePoint(anchor) || !finitePoint(handles.in) || !finitePoint(handles.out)) return null;
    return {
      type: 'path', nodeId: node.id, contourIndex, index,
      width: geometry.width, height: geometry.height, origin: { ...origin }, anchor,
      handles
    };
  }

  if (node.type === 'network' && ['control1', 'control2'].includes(control?.part)) {
    const edge = node.edges?.find(item => item.id === control.edgeId);
    if (!edge) return null;
    const vertexId = control.part === 'control1' ? edge.from : edge.to;
    const handles = networkVertexHandles(node, vertexId);
    if (handles.length !== 2 || !handles.some(item => item.edge.id === edge.id && item.part === control.part)) return null;
    const anchor = vectorNetworkVertexPoint(geometry, vertexId, origin);
    const positions = handles.map(item => ({
      edgeId: item.edge.id,
      part: item.part,
      position: networkControlPoint(item.edge, item.part, geometry, origin) || anchor
    }));
    if (!finitePoint(anchor) || positions.some(item => !finitePoint(item.position))) return null;
    return {
      type: 'network', nodeId: node.id, vertexId, width: geometry.width, height: geometry.height,
      origin: { ...origin }, anchor, handles: positions
    };
  }
  return null;
}

/** Move both controls from their pointer-down positions, preserving the delta. */
export function translateVectorControlPair(node, snapshot, delta) {
  if (!snapshot || snapshot.nodeId !== node?.id || !finitePoint(delta)
    || !finitePoint(snapshot.origin) || !finitePoint(snapshot.anchor)
    || !Number.isFinite(snapshot.width) || snapshot.width <= 0
    || !Number.isFinite(snapshot.height) || snapshot.height <= 0) return false;

  if (snapshot.type === 'path' && node.type === 'path') {
    const points = contourAt(node, snapshot.contourIndex)?.points;
    const point = points?.[snapshot.index];
    if (!point || !finitePoint(snapshot.handles?.in) || !finitePoint(snapshot.handles?.out)) return false;
    const next = Object.fromEntries(['in', 'out'].map(part => [part, {
      x: (snapshot.handles[part].x + delta.x - snapshot.anchor.x) / snapshot.width,
      y: (snapshot.handles[part].y + delta.y - snapshot.anchor.y) / snapshot.height
    }]));
    if (Object.values(next).some(handle => !finitePoint(handle))) return false;
    point.in = next.in;
    point.out = next.out;
    return 2;
  }

  if (snapshot.type === 'network' && node.type === 'network' && Array.isArray(snapshot.handles)
    && snapshot.handles.length === 2) {
    const updates = snapshot.handles.map(handle => {
      const edge = node.edges?.find(item => item.id === handle.edgeId);
      const endpoint = handle.part === 'control1' ? edge?.from : handle.part === 'control2' ? edge?.to : null;
      if (!edge || endpoint !== snapshot.vertexId || !finitePoint(handle.position)) return null;
      return {
        edge, part: handle.part,
        position: {
          x: (handle.position.x + delta.x - snapshot.origin.x) / snapshot.width,
          y: (handle.position.y + delta.y - snapshot.origin.y) / snapshot.height
        }
      };
    });
    if (updates.some(item => !item || !finitePoint(item.position))) return false;
    for (const update of updates) {
      invalidateNetworkSplitForEdge(node, update.edge.id);
      update.edge[update.part] = update.position;
    }
    return updates.length;
  }
  return false;
}

function autoSmoothVectorNodePoint(node, index, contourIndex = 0) {
  const contour = contourAt(node, contourIndex);
  const points = contour?.points || [];
  const point = points[index];
  if (!point || points.length < 2 || !finitePoint(point)) return false;
  const width = Math.max(1, Number(node.width) || 1);
  const height = Math.max(1, Number(node.height) || 1);
  const anchor = vectorNodePoint(node, index, 'anchor', { x: 0, y: 0 }, contourIndex);
  const previousIndex = index > 0 ? index - 1 : contour.closed ? points.length - 1 : -1;
  const nextIndex = index + 1 < points.length ? index + 1 : contour.closed ? 0 : -1;
  const previous = previousIndex < 0 ? null : vectorNodePoint(node, previousIndex, 'anchor', { x: 0, y: 0 }, contourIndex);
  const next = nextIndex < 0 ? null : vectorNodePoint(node, nextIndex, 'anchor', { x: 0, y: 0 }, contourIndex);
  if ((previous && !finitePoint(previous)) || (next && !finitePoint(next))) return false;

  let tangent;
  if (previous && next) {
    tangent = { x: next.x - previous.x, y: next.y - previous.y };
  } else if (next) {
    tangent = { x: next.x - anchor.x, y: next.y - anchor.y };
  } else if (previous) {
    tangent = { x: anchor.x - previous.x, y: anchor.y - previous.y };
  } else return false;

  const tangentLength = Math.hypot(tangent.x, tangent.y);
  if (!(tangentLength > 1e-9)) return false;
  tangent.x /= tangentLength;
  tangent.y /= tangentLength;

  const previousLength = previous ? Math.hypot(anchor.x - previous.x, anchor.y - previous.y) / 3 : 0;
  const nextLength = next ? Math.hypot(next.x - anchor.x, next.y - anchor.y) / 3 : 0;
  const handle = (x, y) => ({ x: Object.is(x, -0) ? 0 : x, y: Object.is(y, -0) ? 0 : y });
  point.in = previousLength > 0
    ? handle(-tangent.x * previousLength / width, -tangent.y * previousLength / height)
    : { x: 0, y: 0 };
  point.out = nextLength > 0
    ? handle(tangent.x * nextLength / width, tangent.y * nextLength / height)
    : { x: 0, y: 0 };
  return true;
}

/**
 * Set a persisted path anchor mode and reconcile its handles immediately.
 * Smooth mode keeps both handle lengths while making them collinear; symmetric
 * mode mirrors the preferred handle exactly. When a handle-less anchor becomes
 * smooth, infer a tangent from its neighboring anchors so the mode has an
 * immediate visible effect. Corner mode preserves geometry.
 */
export function setVectorNodePointMode(node, index, mode, { preferredHandle = 'out', contourIndex = 0 } = {}) {
  const point = contourAt(node, contourIndex)?.points?.[index];
  if (!point || !isVectorAnchorMode(mode) || !['in', 'out'].includes(preferredHandle)
    || (point.mode != null && !isVectorAnchorMode(point.mode))) return false;
  if (!finitePoint(point) || (point.in != null && !finitePoint(point.in)) || (point.out != null && !finitePoint(point.out))) return false;

  const handleLength = handle => Math.hypot((Number(handle?.x) || 0) * Math.max(1, Number(node.width) || 1),
    (Number(handle?.y) || 0) * Math.max(1, Number(node.height) || 1));
  const hasHandles = handleLength(point.in) > 0 || handleLength(point.out) > 0;
  if (mode === 'smooth' && !hasHandles) {
    autoSmoothVectorNodePoint(node, index, contourIndex);
  } else if (mode !== 'corner') {
    const width = Math.max(1, Number(node.width) || 1);
    const height = Math.max(1, Number(node.height) || 1);
    let primary = point[preferredHandle];
    let secondary = point[preferredHandle === 'in' ? 'out' : 'in'];
    const length = handle => Math.hypot((Number(handle?.x) || 0) * width, (Number(handle?.y) || 0) * height);
    if (length(primary) === 0 && length(secondary) > 0) {
      preferredHandle = preferredHandle === 'in' ? 'out' : 'in';
      primary = point[preferredHandle];
    }
    if (!primary) primary = { x: 0, y: 0 };
    point[preferredHandle] = primary;
    constrainOppositeHandle(point, preferredHandle, mode, width, height);
  }
  point.mode = mode;
  return true;
}

/** Return the cubic segment joining one path anchor to the next. */
export function vectorSegmentPoints(node, index, origin = { x: node.x, y: node.y }, contourIndex = 0) {
  const contour = contourAt(node, contourIndex);
  const points = contour?.points || [];
  const nextIndex = (index + 1) % points.length;
  if (points.length < 2 || !Number.isInteger(index) || index < 0 || index >= points.length || (!contour.closed && nextIndex === 0)) return null;
  return [
    vectorNodePoint(node, index, 'anchor', origin, contourIndex),
    vectorNodePoint(node, index, 'out', origin, contourIndex),
    vectorNodePoint(node, nextIndex, 'in', origin, contourIndex),
    vectorNodePoint(node, nextIndex, 'anchor', origin, contourIndex)
  ];
}

/** Evaluate a path segment at t in the interval [0, 1]. */
export function vectorSegmentPoint(node, index, t, origin = { x: node.x, y: node.y }, contourIndex = 0) {
  const segment = vectorSegmentPoints(node, index, origin, contourIndex);
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
  let closest = null;
  const distanceAt = (index, t, contourIndex) => {
    const point = vectorSegmentPoint(node, index, t, origin, contourIndex);
    return { point, distance: Math.hypot(position.x - point.x, position.y - point.y) };
  };
  for (const [contourIndex, contour] of vectorPathContours(node).entries()) {
    const segmentCount = contour.closed ? contour.points.length : contour.points.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
    const samples = 64;
    let bestT = 0;
    let best = distanceAt(index, bestT, contourIndex);
    for (let sample = 1; sample <= samples; sample += 1) {
      const t = sample / samples;
      const candidate = distanceAt(index, t, contourIndex);
      if (candidate.distance < best.distance) { bestT = t; best = candidate; }
    }
    let low = Math.max(0, bestT - 1 / samples);
    let high = Math.min(1, bestT + 1 / samples);
    for (let iteration = 0; iteration < 18; iteration += 1) {
      const left = low + (high - low) / 3;
      const right = high - (high - low) / 3;
      if (distanceAt(index, left, contourIndex).distance <= distanceAt(index, right, contourIndex).distance) high = right;
      else low = left;
    }
    const t = (low + high) / 2;
    const candidate = distanceAt(index, t, contourIndex);
    if (!closest || candidate.distance < closest.distance) closest = { segmentIndex: index, contourIndex, t, ...candidate };
    }
  }
  return closest;
}

/** Subdivide a cubic segment in place without changing its curve. */
export function insertVectorNodePoint(node, segmentIndex, t = .5, origin = { x: node.x, y: node.y }, contourIndex = 0) {
  const points = contourAt(node, contourIndex)?.points || [];
  const segment = vectorSegmentPoints(node, segmentIndex, origin, contourIndex);
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
    in: handle(d, anchor), out: handle(e, anchor), mode: 'smooth'
  });
  return insertedIndex;
}

/** Remove one path anchor while retaining the minimum two-point path. */
export function removeVectorNodePoint(node, index, contourIndex = 0) {
  const points = contourAt(node, contourIndex)?.points;
  if (!Array.isArray(points) || points.length <= 2 || !Number.isInteger(index) || index < 0 || index >= points.length) return null;
  const removed = points[index];
  return removeVectorPathPoints(node, [{ contourIndex, indexes: [index] }]) ? removed : null;
}

/** Find the longest path segment for one-tap point insertion on touch devices. */
export function longestVectorSegment(node, origin = { x: node.x, y: node.y }) {
  let longest = null;
  for (const [contourIndex, contour] of vectorPathContours(node).entries()) {
    const segmentCount = contour.closed ? contour.points.length : contour.points.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
    let length = 0;
    let previous = vectorSegmentPoint(node, index, 0, origin, contourIndex);
    for (let sample = 1; sample <= 24; sample += 1) {
      const current = vectorSegmentPoint(node, index, sample / 24, origin, contourIndex);
      length += Math.hypot(current.x - previous.x, current.y - previous.y);
      previous = current;
    }
    if (!longest || length > longest.length) longest = { segmentIndex: index, contourIndex, t: .5, length };
    }
  }
  return longest;
}

function nextNetworkId(items, prefix) {
  let largest = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  for (const item of items || []) {
    const match = pattern.exec(item.id || '');
    if (match) largest = Math.max(largest, Number(match[1]));
  }
  return `${prefix}${largest + 1}`;
}

function networkIdGenerator(items, prefix) {
  let largest = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  for (const item of items || []) {
    const match = pattern.exec(item.id || '');
    if (match) largest = Math.max(largest, Number(match[1]));
  }
  return () => `${prefix}${++largest}`;
}

function normalizedNetworkPoint(point, node, origin) {
  return {
    x: (Number(point.x) - origin.x) / Math.max(1, Number(node.width) || 1),
    y: (Number(point.y) - origin.y) / Math.max(1, Number(node.height) || 1)
  };
}

function networkControlPoint(edge, part, node, origin) {
  const point = edge?.[part];
  if (!point) return null;
  return {
    x: origin.x + Number(point.x) * node.width,
    y: origin.y + Number(point.y) * node.height
  };
}

const networkVertexIndexes = new WeakMap();
const networkEdgeIndexes = new WeakMap();

function networkVertexIndex(vertices) {
  if (!Array.isArray(vertices)) return new Map();
  let index = networkVertexIndexes.get(vertices);
  if (!index) {
    index = new Map(vertices.map(vertex => [vertex.id, vertex]));
    networkVertexIndexes.set(vertices, index);
  }
  return index;
}

function networkEdgeIndex(edges) {
  if (!Array.isArray(edges)) return new Map();
  let index = networkEdgeIndexes.get(edges);
  if (!index) {
    index = new Map(edges.map(edge => [edge.id, edge]));
    networkEdgeIndexes.set(edges, index);
  }
  return index;
}

function invalidateNetworkSplitForEdge(node, edgeId) {
  for (const vertex of node.vertices || []) {
    if (vertex.split?.firstEdgeId === edgeId || vertex.split?.secondEdgeId === edgeId) delete vertex.split;
  }
}

/** Build a graph-backed vector network from an editable Pen-tool stroke. */
export function vectorNetworkGeometryFromAnchors(anchors, { closed = false } = {}) {
  if (!Array.isArray(anchors) || anchors.length < 2) throw new TypeError('A vector network needs at least two points.');
  if (anchors.some(point => !finitePoint(point) || (point.in && !finitePoint(point.in)) || (point.out && !finitePoint(point.out)))) {
    throw new TypeError('Vector network points must contain finite coordinates.');
  }
  if (anchors.some(point => point.mode != null && !isVectorAnchorMode(point.mode))) {
    throw new TypeError('Vector network anchor modes must be corner, smooth, or symmetric.');
  }
  const extents = anchors.flatMap(point => [point, ...(point.in ? [point.in] : []), ...(point.out ? [point.out] : [])]);
  const left = Math.min(...extents.map(point => Number(point.x)));
  const top = Math.min(...extents.map(point => Number(point.y)));
  const right = Math.max(...extents.map(point => Number(point.x)));
  const bottom = Math.max(...extents.map(point => Number(point.y)));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const vertices = anchors.map((point, index) => ({
    id: `v${index + 1}`,
    x: (Number(point.x) - left) / width,
    y: (Number(point.y) - top) / height,
    ...(point.mode == null ? {} : { mode: point.mode })
  }));
  const control = point => ({ x: (Number(point.x) - left) / width, y: (Number(point.y) - top) / height });
  const edges = [];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index]; const end = anchors[index + 1];
    edges.push({
      id: `e${edges.length + 1}`, from: vertices[index].id, to: vertices[index + 1].id,
      control1: start.out && (start.out.x !== start.x || start.out.y !== start.y) ? control(start.out) : null,
      control2: end.in && (end.in.x !== end.x || end.in.y !== end.y) ? control(end.in) : null
    });
  }
  if (closed) {
    const start = anchors.at(-1); const end = anchors[0];
    edges.push({
      id: `e${edges.length + 1}`, from: vertices.at(-1).id, to: vertices[0].id,
      control1: start.out && (start.out.x !== start.x || start.out.y !== start.y) ? control(start.out) : null,
      control2: end.in && (end.in.x !== end.x || end.in.y !== end.y) ? control(end.in) : null
    });
  }
  return {
    x: left, y: top, width, height, fill: 'transparent', stroke: '#1e1e1e', strokeWidth: 2,
    vertices, edges,
    faces: closed && vertices.length >= 3 ? [{ id: 'f1', vertexIds: vertices.map(vertex => vertex.id), fill: null, fillOpacity: 1 }] : []
  };
}

const FREEHAND_MAX_SAMPLES = 16384;
const FREEHAND_MAX_ANCHORS = 1024;
const FREEHAND_MAX_DISTANCE_CHECKS = 1_000_000;

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length)) throw new RangeError('Freehand samples exceed the supported coordinate range.');
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const along = ((point.x - start.x) * (dx / length) + (point.y - start.y) * (dy / length)) / length;
  const amount = Math.max(0, Math.min(1, along));
  return Math.hypot(point.x - (start.x + dx * amount), point.y - (start.y + dy * amount));
}

function simplifyFreehandSamples(points, tolerance) {
  const kept = new Uint8Array(points.length);
  kept[0] = 1;
  kept[points.length - 1] = 1;
  const pending = [[0, points.length - 1]];
  let checks = 0;

  while (pending.length) {
    const [first, last] = pending.pop();
    if (last - first < 2) continue;
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      checks += 1;
      if (checks > FREEHAND_MAX_DISTANCE_CHECKS) {
        throw new RangeError('Freehand samples are too complex to simplify within the processing budget.');
      }
      const distance = distanceToSegment(points[index], points[first], points[last]);
      if (distance > farthestDistance) {
        farthest = index;
        farthestDistance = distance;
      }
    }
    if (farthest >= 0) {
      kept[farthest] = 1;
      pending.push([first, farthest], [farthest, last]);
    }
  }

  const simplified = [];
  for (let index = 0; index < points.length; index += 1) if (kept[index]) simplified.push(points[index]);
  return simplified;
}

function constrainedFreehandHandle(anchor, candidate, start, end, maximumDeviation) {
  if (distanceToSegment(candidate, start, end) <= maximumDeviation) return candidate;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 28; iteration += 1) {
    const amount = (low + high) / 2;
    const point = {
      x: anchor.x + (candidate.x - anchor.x) * amount,
      y: anchor.y + (candidate.y - anchor.y) * amount
    };
    if (distanceToSegment(point, start, end) <= maximumDeviation) low = amount;
    else high = amount;
  }
  return {
    x: anchor.x + (candidate.x - anchor.x) * low,
    y: anchor.y + (candidate.y - anchor.y) * low
  };
}

/**
 * Simplify sampled freehand input into a smooth, editable vector network.
 * Tolerance is measured in page-space units, so the same samples produce the
 * same geometry at every canvas zoom. Throws for invalid input or when hard
 * work/anchor limits prevent preserving the requested tolerance; returns null
 * when the input contains fewer than two distinct points.
 */
export function vectorNetworkGeometryFromFreehandSamples(samples, { tolerance = 1, maxAnchors = FREEHAND_MAX_ANCHORS } = {}) {
  if (!Array.isArray(samples)) throw new TypeError('Freehand samples must be an array of finite points.');
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new TypeError('Freehand tolerance must be a finite, non-negative number.');
  if (!Number.isInteger(maxAnchors) || maxAnchors < 2) throw new TypeError('The freehand anchor limit must be an integer of at least two.');
  if (samples.length > FREEHAND_MAX_SAMPLES) throw new RangeError(`Freehand input is limited to ${FREEHAND_MAX_SAMPLES} samples.`);

  const points = [];
  for (const sample of samples) {
    if (!sample || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
      throw new TypeError('Freehand samples must contain finite numeric coordinates.');
    }
    if (!points.length || sample.x !== points.at(-1).x || sample.y !== points.at(-1).y) {
      points.push({ x: sample.x, y: sample.y });
    }
  }
  if (points.length < 2) return null;

  const left = Math.min(...points.map(point => point.x));
  const top = Math.min(...points.map(point => point.y));
  const right = Math.max(...points.map(point => point.x));
  const bottom = Math.max(...points.map(point => point.y));
  const width = right - left;
  const height = bottom - top;
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(Math.hypot(width, height))) {
    throw new RangeError('Freehand samples exceed the supported coordinate range.');
  }

  // Reserve half the error budget for simplifying the sampled polyline and
  // half for keeping each fitted cubic inside a narrow corridor around its
  // retained chord. Their sum bounds the rendered path's deviation.
  const simplificationTolerance = tolerance / 2;
  const curveTolerance = tolerance - simplificationTolerance;
  const anchors = simplifyFreehandSamples(points, simplificationTolerance);
  if (anchors.length > Math.min(maxAnchors, FREEHAND_MAX_ANCHORS)) {
    throw new RangeError(`Freehand geometry exceeds the ${Math.min(maxAnchors, FREEHAND_MAX_ANCHORS)}-anchor limit at the requested tolerance.`);
  }

  const tangents = anchors.map((point, index) => {
    const previous = anchors[Math.max(0, index - 1)];
    const next = anchors[Math.min(anchors.length - 1, index + 1)];
    let x = next.x - previous.x;
    let y = next.y - previous.y;
    let length = Math.hypot(x, y);
    if (!(length > 0)) {
      const neighbor = index + 1 < anchors.length ? anchors[index + 1] : anchors[index - 1];
      x = neighbor.x - point.x;
      y = neighbor.y - point.y;
      length = Math.hypot(x, y);
    }
    return length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
  });

  const smoothAnchors = anchors.map((point, index) => {
    const previous = anchors[index - 1];
    const next = anchors[index + 1];
    const previousLength = previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0;
    const nextLength = next ? Math.hypot(next.x - point.x, next.y - point.y) : 0;
    const incomingCandidate = previous ? {
      x: point.x - tangents[index].x * previousLength / 3,
      y: point.y - tangents[index].y * previousLength / 3
    } : point;
    const outgoingCandidate = next ? {
      x: point.x + tangents[index].x * nextLength / 3,
      y: point.y + tangents[index].y * nextLength / 3
    } : point;
    const incoming = previous && Number.isFinite(incomingCandidate.x) && Number.isFinite(incomingCandidate.y)
      ? constrainedFreehandHandle(point, incomingCandidate, previous, point, curveTolerance) : { ...point };
    const outgoing = next && Number.isFinite(outgoingCandidate.x) && Number.isFinite(outgoingCandidate.y)
      ? constrainedFreehandHandle(point, outgoingCandidate, point, next, curveTolerance) : { ...point };
    return { ...point, in: incoming, out: outgoing, mode: 'smooth' };
  });

  return vectorNetworkGeometryFromAnchors(smoothAnchors);
}

/** Resolve a network junction or edge handle in document coordinates. */
export function vectorNetworkVertexPoint(node, vertexId, origin = { x: node.x, y: node.y }) {
  const vertex = networkVertexIndex(node?.vertices).get(vertexId);
  if (!vertex) return null;
  return { x: origin.x + Number(vertex.x) * node.width, y: origin.y + Number(vertex.y) * node.height };
}

/** Return a network vertex's persisted anchor mode, treating legacy data as a corner. */
export function getVectorNetworkVertexMode(node, vertexId) {
  const vertex = node?.vertices?.find(item => item.id === vertexId);
  if (!vertex) return null;
  return isVectorAnchorMode(vertex.mode) ? vertex.mode : 'corner';
}

/** Return one graph edge's cubic control polygon in document coordinates. */
export function vectorNetworkEdgePoints(node, edgeId, origin = { x: node.x, y: node.y }) {
  const edge = networkEdgeIndex(node?.edges).get(edgeId);
  const start = edge && vectorNetworkVertexPoint(node, edge.from, origin);
  const end = edge && vectorNetworkVertexPoint(node, edge.to, origin);
  if (!edge || !start || !end) return null;
  return [start, networkControlPoint(edge, 'control1', node, origin) || start, networkControlPoint(edge, 'control2', node, origin) || end, end];
}

/** Index the first edge for each undirected vertex pair, matching face rendering. */
export function vectorNetworkEdgePairIndex(node) {
  const edgesByPair = new Map();
  for (const edge of node?.edges || []) {
    const forward = `${edge.from}\0${edge.to}`;
    const reverse = `${edge.to}\0${edge.from}`;
    if (!edgesByPair.has(forward)) edgesByPair.set(forward, edge);
    if (!edgesByPair.has(reverse)) edgesByPair.set(reverse, edge);
  }
  return edgesByPair;
}

/** Resolve one directed face side from the stable undirected edge-pair index. */
export function vectorNetworkEdgeForPair(edgesByPair, fromId, toId) {
  return edgesByPair?.get(`${fromId}\0${toId}`) || null;
}

/** Move a shared network junction without breaking its incident edges. */
export function setVectorNetworkVertexPoint(node, vertexId, position, origin = { x: node.x, y: node.y }) {
  const vertex = node?.vertices?.find(item => item.id === vertexId);
  if (!vertex || !finitePoint(position)) return false;
  const mode = vertex.mode;
  const handles = ['smooth', 'symmetric'].includes(mode) ? networkVertexHandles(node, vertexId) : [];
  const oldAnchor = handles.length === 2 ? vectorNetworkVertexPoint(node, vertexId, origin) : null;
  const relativeHandles = oldAnchor ? handles.map(handle => {
    const control = networkControlPoint(handle.edge, handle.part, node, origin);
    return control ? {
      handle,
      vector: { x: control.x - oldAnchor.x, y: control.y - oldAnchor.y }
    } : null;
  }) : [];
  for (const edge of node.edges || []) if (edge.from === vertexId || edge.to === vertexId) invalidateNetworkSplitForEdge(node, edge.id);
  delete vertex.split;
  vertex.x = (Number(position.x) - origin.x) / Math.max(1, Number(node.width) || 1);
  vertex.y = (Number(position.y) - origin.y) / Math.max(1, Number(node.height) || 1);
  if (relativeHandles.length === 2) {
    const movedAnchor = vectorNetworkVertexPoint(node, vertexId, origin);
    for (const entry of relativeHandles) {
      if (!entry) continue;
      setNetworkHandle(node, entry.handle, {
        x: movedAnchor.x + entry.vector.x,
        y: movedAnchor.y + entry.vector.y
      }, origin);
    }
  }
  return true;
}

function networkVertexHandles(node, vertexId) {
  const incident = [];
  for (const edge of node?.edges || []) {
    if (edge.from === vertexId) incident.push({ edge, part: 'control1' });
    if (edge.to === vertexId) incident.push({ edge, part: 'control2' });
  }
  return incident;
}

function setNetworkHandle(node, handle, position, origin) {
  invalidateNetworkSplitForEdge(node, handle.edge.id);
  handle.edge[handle.part] = normalizedNetworkPoint(position, node, origin);
}

/**
 * Align the two edge handles meeting at a degree-two vertex. The active handle
 * determines the tangent. Smooth mode keeps the paired handle's length (or
 * adopts the active length when that handle is absent); symmetric mode mirrors
 * the active handle exactly. Branched and endpoint vertices remain independent.
 */
function alignNetworkVertexHandles(node, vertexId, active, mode, origin, { adoptActiveWhenMissing = false } = {}) {
  if (!['smooth', 'symmetric'].includes(mode)) return false;
  const handles = networkVertexHandles(node, vertexId);
  if (handles.length !== 2) return false;
  const activeIndex = handles.findIndex(handle => handle.edge.id === active.edge.id && handle.part === active.part);
  if (activeIndex < 0) return false;
  const paired = handles[1 - activeIndex];
  const anchor = vectorNetworkVertexPoint(node, vertexId, origin);
  if (!anchor) return false;
  const activePosition = networkControlPoint(active.edge, active.part, node, origin) || anchor;
  const activeVector = { x: activePosition.x - anchor.x, y: activePosition.y - anchor.y };
  const activeLength = Math.hypot(activeVector.x, activeVector.y);
  const pairedPosition = networkControlPoint(paired.edge, paired.part, node, origin) || anchor;
  const pairedLength = Math.hypot(pairedPosition.x - anchor.x, pairedPosition.y - anchor.y);
  if (activeLength === 0 && !(adoptActiveWhenMissing && pairedLength > 0)) {
    if (pairedLength === 0) return true;
    // A dragged handle at the anchor has no tangent to follow, so collapse the
    // paired handle too. When assigning a mode, instead use the existing side.
    setNetworkHandle(node, paired, anchor, origin);
    return true;
  }
  if (activeLength === 0) {
    const oppositeVector = { x: pairedPosition.x - anchor.x, y: pairedPosition.y - anchor.y };
    const oppositeLength = Math.hypot(oppositeVector.x, oppositeVector.y);
    const length = oppositeLength;
    setNetworkHandle(node, active, {
      x: anchor.x - oppositeVector.x / oppositeLength * length,
      y: anchor.y - oppositeVector.y / oppositeLength * length
    }, origin);
    return true;
  }
  const pairedTargetLength = mode === 'symmetric' ? activeLength : pairedLength || activeLength;
  setNetworkHandle(node, paired, {
    x: anchor.x - activeVector.x / activeLength * pairedTargetLength,
    y: anchor.y - activeVector.y / activeLength * pairedTargetLength
  }, origin);
  return true;
}

/** Infer tangent controls for a degree-two vertex whose incident edges are straight. */
function inferNetworkVertexHandles(node, vertexId, handles, preferredEdgeId, mode, origin) {
  const anchor = vectorNetworkVertexPoint(node, vertexId, origin);
  if (!anchor || handles.length !== 2) return false;
  const sides = handles.map(handle => {
    const neighborId = handle.part === 'control1' ? handle.edge.to : handle.edge.from;
    const neighbor = vectorNetworkVertexPoint(node, neighborId, origin);
    if (!neighbor) return null;
    const vector = { x: neighbor.x - anchor.x, y: neighbor.y - anchor.y };
    const length = Math.hypot(vector.x, vector.y);
    return length > 1e-9 ? { ...handle, neighbor, vector, length } : null;
  });
  if (sides.some(side => !side)) return false;

  const incoming = sides.find(side => side.part === 'control2');
  const outgoing = sides.find(side => side.part === 'control1');
  let axis;
  let directionFor;
  if (incoming && outgoing) {
    // Orient the tangent along the edge flow: an incoming control points
    // against it, while an outgoing control points with it.
    axis = { x: outgoing.neighbor.x - incoming.neighbor.x, y: outgoing.neighbor.y - incoming.neighbor.y };
    const length = Math.hypot(axis.x, axis.y);
    if (!(length > 1e-9)) return false;
    axis.x /= length;
    axis.y /= length;
    directionFor = side => side.part === 'control1' ? 1 : -1;
  } else {
    // If both edges share an orientation, use the preferred edge (or first
    // incident edge) to choose which side follows the inferred tangent.
    axis = { x: sides[1].neighbor.x - sides[0].neighbor.x, y: sides[1].neighbor.y - sides[0].neighbor.y };
    const length = Math.hypot(axis.x, axis.y);
    if (!(length > 1e-9)) return false;
    axis.x /= length;
    axis.y /= length;
    const active = sides.find(side => preferredEdgeId != null && side.edge.id === preferredEdgeId) || sides[0];
    if (axis.x * active.vector.x + axis.y * active.vector.y < 0) {
      axis.x = -axis.x;
      axis.y = -axis.y;
    }
    directionFor = side => side === active ? 1 : -1;
  }

  const active = sides.find(side => preferredEdgeId != null && side.edge.id === preferredEdgeId) || sides[0];
  for (const side of sides) {
    const length = mode === 'symmetric' ? active.length / 3 : side.length / 3;
    const direction = directionFor(side);
    setNetworkHandle(node, side, {
      x: anchor.x + axis.x * length * direction,
      y: anchor.y + axis.y * length * direction
    }, origin);
  }
  return true;
}

/**
 * Persist a Corner, Smooth, or Symmetric mode on one network vertex.
 * Switching to a constrained mode aligns the two handles when the vertex has
 * exactly two incident edges; endpoints and branches keep their current geometry.
 */
export function setVectorNetworkVertexMode(node, vertexId, mode, {
  preferredEdgeId = null,
  origin = { x: node?.x || 0, y: node?.y || 0 }
} = {}) {
  const vertex = node?.vertices?.find(item => item.id === vertexId);
  if (!vertex || !isVectorAnchorMode(mode) || !finitePoint(origin) || (vertex.mode != null && !isVectorAnchorMode(vertex.mode))) return false;
  const handles = networkVertexHandles(node, vertexId);
  if (preferredEdgeId != null && !handles.some(handle => handle.edge.id === preferredEdgeId)) return false;

  if (mode !== 'corner' && handles.length === 2) {
    const candidates = preferredEdgeId == null ? handles : handles.filter(handle => handle.edge.id === preferredEdgeId);
    const anchor = vectorNetworkVertexPoint(node, vertexId, origin);
    const hasExistingHandle = handles.some(handle => {
      const point = networkControlPoint(handle.edge, handle.part, node, origin) || anchor;
      return Math.hypot(point.x - anchor.x, point.y - anchor.y) > 1e-9;
    });
    if (!hasExistingHandle) {
      inferNetworkVertexHandles(node, vertexId, handles, preferredEdgeId, mode, origin);
      vertex.mode = mode;
      return true;
    }
    const active = candidates.find(handle => {
      const point = networkControlPoint(handle.edge, handle.part, node, origin) || anchor;
      return Math.hypot(point.x - anchor.x, point.y - anchor.y) > 0;
    }) || candidates[0];
    if (active) alignNetworkVertexHandles(node, vertexId, active, mode, origin, { adoptActiveWhenMissing: true });
  }
  vertex.mode = mode;
  return true;
}

/** Move one edge control; a constrained degree-two endpoint moves its paired handle. */
export function setVectorNetworkEdgeControlPoint(node, edgeId, part, position, origin = { x: node.x, y: node.y }) {
  const edge = node?.edges?.find(item => item.id === edgeId);
  if (!edge || !['control1', 'control2'].includes(part) || !finitePoint(position) || !finitePoint(origin)) return false;
  invalidateNetworkSplitForEdge(node, edgeId);
  edge[part] = normalizedNetworkPoint(position, node, origin);
  const vertexId = part === 'control1' ? edge.from : edge.to;
  const vertex = node.vertices?.find(item => item.id === vertexId);
  if (vertex && isVectorAnchorMode(vertex.mode) && vertex.mode !== 'corner') {
    alignNetworkVertexHandles(node, vertexId, { edge, part }, vertex.mode, origin);
  }
  return true;
}

/** Find the closest network edge by sampling and refining each cubic segment. */
export function closestVectorNetworkEdge(node, position, origin = { x: node.x, y: node.y }) {
  let closest = null;
  for (const edge of node?.edges || []) {
    const points = vectorNetworkEdgePoints(node, edge.id, origin);
    if (!points) continue;
    const pointAt = t => {
      const inverse = 1 - t; const [p0, p1, p2, p3] = points;
      return {
        x: inverse ** 3 * p0.x + 3 * inverse ** 2 * t * p1.x + 3 * inverse * t ** 2 * p2.x + t ** 3 * p3.x,
        y: inverse ** 3 * p0.y + 3 * inverse ** 2 * t * p1.y + 3 * inverse * t ** 2 * p2.y + t ** 3 * p3.y
      };
    };
    const distanceAt = t => { const point = pointAt(t); return { point, distance: Math.hypot(position.x - point.x, position.y - point.y) }; };
    let bestT = 0; let best = distanceAt(0);
    for (let sample = 1; sample <= 64; sample += 1) {
      const t = sample / 64; const candidate = distanceAt(t);
      if (candidate.distance < best.distance) { bestT = t; best = candidate; }
    }
    let low = Math.max(0, bestT - 1 / 64); let high = Math.min(1, bestT + 1 / 64);
    for (let iteration = 0; iteration < 18; iteration += 1) {
      const left = low + (high - low) / 3; const right = high - (high - low) / 3;
      if (distanceAt(left).distance <= distanceAt(right).distance) high = right; else low = left;
    }
    const t = (low + high) / 2; const candidate = distanceAt(t);
    if (!closest || candidate.distance < closest.distance) closest = { edgeId: edge.id, t, ...candidate };
  }
  return closest;
}

/** Add a path to an existing graph, reusing supplied vertex IDs to create branches. */
export function appendVectorNetworkPath(node, anchors, origin = { x: node.x, y: node.y }, { closed = false } = {}) {
  if (!node || !Array.isArray(node.vertices) || !Array.isArray(node.edges) || !Array.isArray(anchors) || anchors.length < 2) return false;
  if (anchors.some(point => !finitePoint(point) || (point.in && !finitePoint(point.in)) || (point.out && !finitePoint(point.out))
    || (point.mode != null && !isVectorAnchorMode(point.mode)))) return false;
  const verticesById = new Map(node.vertices.map(vertex => [vertex.id, {
    id: vertex.id, x: origin.x + vertex.x * node.width, y: origin.y + vertex.y * node.height
  }]));
  const edgeControls = node.edges.flatMap(edge => ['control1', 'control2'].flatMap(part => {
    const point = networkControlPoint(edge, part, node, origin);
    return point ? [point] : [];
  }));
  const restorableControls = node.vertices.flatMap(vertex => ['control1', 'control2'].flatMap(part => {
    const original = vertex.split?.originalEdge;
    const point = original && networkControlPoint(original, part, node, origin);
    return point ? [point] : [];
  }));
  const allPoints = [
    ...verticesById.values(), ...edgeControls, ...restorableControls,
    ...anchors.flatMap(point => [point, ...(point.in ? [point.in] : []), ...(point.out ? [point.out] : [])])
  ];
  let left = Math.min(...allPoints.map(point => point.x)); let top = Math.min(...allPoints.map(point => point.y));
  const right = Math.max(...allPoints.map(point => point.x)); const bottom = Math.max(...allPoints.map(point => point.y));
  let width = Math.max(1, right - left); let height = Math.max(1, bottom - top);
  if (node.rotation) {
    const center = { x: origin.x + node.width / 2, y: origin.y + node.height / 2 };
    width = Math.max(1, 2 * Math.max(Math.abs(center.x - left), Math.abs(right - center.x)));
    height = Math.max(1, 2 * Math.max(Math.abs(center.y - top), Math.abs(bottom - center.y)));
    left = center.x - width / 2;
    top = center.y - height / 2;
  }
  const normalize = point => ({ x: (point.x - left) / width, y: (point.y - top) / height });
  const oldVertices = node.vertices.map(vertex => {
    const rebased = { ...vertex, ...normalizedNetworkPoint(verticesById.get(vertex.id), { width, height }, { x: left, y: top }) };
    if (vertex.split) {
      const originalEdge = vertex.split.originalEdge;
      rebased.split = {
        ...vertex.split,
        originalEdge: {
          ...originalEdge,
          ...(originalEdge.control1 ? { control1: normalize(networkControlPoint(originalEdge, 'control1', node, origin)) } : {}),
          ...(originalEdge.control2 ? { control2: normalize(networkControlPoint(originalEdge, 'control2', node, origin)) } : {})
        }
      };
    }
    return rebased;
  });
  node.edges = node.edges.map(edge => ({
    ...edge,
    ...(edge.control1 ? { control1: normalize(networkControlPoint(edge, 'control1', node, origin)) } : {}),
    ...(edge.control2 ? { control2: normalize(networkControlPoint(edge, 'control2', node, origin)) } : {})
  }));
  node.vertices = oldVertices;
  node.x += left - origin.x; node.y += top - origin.y; node.width = width; node.height = height;
  const vertexIds = [];
  const createVertexId = networkIdGenerator(node.vertices, 'v');
  const createEdgeId = networkIdGenerator(node.edges, 'e');
  let addedVertices = 0;
  for (const anchor of anchors) {
    const existing = anchor.vertexId && verticesById.has(anchor.vertexId) ? anchor.vertexId : null;
    if (existing) { vertexIds.push(existing); delete node.vertices.find(vertex => vertex.id === existing)?.split; }
    else {
      const id = createVertexId();
      const vertex = normalize(anchor);
      node.vertices.push({ id, ...vertex, ...(anchor.mode == null ? {} : { mode: anchor.mode }) });
      verticesById.set(id, { id, x: anchor.x, y: anchor.y });
      vertexIds.push(id);
      addedVertices += 1;
    }
  }
  const addEdge = (index, nextIndex) => {
    const from = vertexIds[index]; const to = vertexIds[nextIndex];
    if (from === to) return false;
    const start = anchors[index]; const end = anchors[nextIndex];
    const hasControl1 = start.out && (start.out.x !== start.x || start.out.y !== start.y);
    const hasControl2 = end.in && (end.in.x !== end.x || end.in.y !== end.y);
    const edge = { id: createEdgeId(), from, to, control1: hasControl1 ? normalize(start.out) : null, control2: hasControl2 ? normalize(end.in) : null };
    node.edges.push(edge);
    return true;
  };
  let addedEdges = 0;
  for (let index = 0; index < vertexIds.length - 1; index += 1) if (addEdge(index, index + 1)) addedEdges += 1;
  if (closed && vertexIds.length > 2 && addEdge(vertexIds.length - 1, 0)) addedEdges += 1;
  if (!Array.isArray(node.faces)) node.faces = [];
  if (closed && vertexIds.length > 2 && new Set(vertexIds).size === vertexIds.length) {
    node.faces.push({ id: networkIdGenerator(node.faces, 'f')(), vertexIds: [...vertexIds], fill: null, fillOpacity: 1 });
  }
  return { addedEdges, addedVertices };
}

/** Append a Pen path using the network geometry resolved for the active mode. */
export function appendVectorNetworkPathResolved(node, anchors, geometry, { closed = false, writeGeometry = null } = {}) {
  if (!node || !geometry) return false;
  const working = structuredClone(node);
  for (const property of ['x', 'y', 'width', 'height', 'rotation']) working[property] = geometry[property];
  const result = appendVectorNetworkPath(working, anchors, { x: geometry.x, y: geometry.y }, { closed });
  if (!result?.addedEdges) return result;
  const nextGeometry = { x: working.x, y: working.y, width: working.width, height: working.height };
  if (writeGeometry && writeGeometry(nextGeometry) === false) return false;
  node.vertices = working.vertices;
  node.edges = working.edges;
  node.faces = working.faces;
  if (!writeGeometry) Object.assign(node, nextGeometry);
  return result;
}

/** Split one graph edge while preserving its cubic outline exactly. */
export function insertVectorNetworkPoint(node, edgeId, t = .5, origin = { x: node.x, y: node.y }) {
  const edge = node?.edges?.find(item => item.id === edgeId);
  if (!edge || !Number.isFinite(Number(t))) return null;
  const amount = Math.max(.000001, Math.min(.999999, Number(t)));
  invalidateNetworkSplitForEdge(node, edgeId);
  const originalEdge = {
    id: edge.id, from: edge.from, to: edge.to,
    ...(edge.control1 ? { control1: { ...edge.control1 } } : {}),
    ...(edge.control2 ? { control2: { ...edge.control2 } } : {})
  };
  const [p0, p1, p2, p3] = vectorNetworkEdgePoints(node, edgeId, origin);
  const lerp = (left, right) => ({ x: left.x + (right.x - left.x) * amount, y: left.y + (right.y - left.y) * amount });
  const a = lerp(p0, p1); const b = lerp(p1, p2); const c = lerp(p2, p3); const d = lerp(a, b); const e = lerp(b, c); const anchor = lerp(d, e);
  const id = nextNetworkId(node.vertices, 'v');
  const secondEdgeId = nextNetworkId(node.edges, 'e');
  node.vertices.push({ id, ...normalizedNetworkPoint(anchor, node, origin), split: { firstEdgeId: edge.id, secondEdgeId, originalEdge } });
  networkVertexIndexes.delete(node.vertices);
  const originalTo = edge.to;
  edge.to = id; edge.control1 = normalizedNetworkPoint(a, node, origin); edge.control2 = normalizedNetworkPoint(d, node, origin);
  node.edges.push({ id: secondEdgeId, from: id, to: originalTo, control1: normalizedNetworkPoint(e, node, origin), control2: normalizedNetworkPoint(c, node, origin) });
  networkEdgeIndexes.delete(node.edges);
  for (const face of node.faces || []) {
    const ring = face.vertexIds || [];
    for (let index = 0; index < ring.length; index += 1) {
      const next = (index + 1) % ring.length;
      if ((ring[index] === edge.from && ring[next] === originalTo) || (ring[index] === originalTo && ring[next] === edge.from)) {
        ring.splice(index + 1, 0, id); break;
      }
    }
  }
  return id;
}

/** Remove a junction and its incident edges; refuse to destroy the whole network. */
export function removeVectorNetworkVertex(node, vertexId) {
  if (!Array.isArray(node?.vertices) || !Array.isArray(node.edges)) return false;
  const index = node.vertices.findIndex(vertex => vertex.id === vertexId);
  if (index < 0) return false;
  const vertex = node.vertices[index];
  const incident = node.edges.filter(edge => edge.from === vertexId || edge.to === vertexId);
  let edges;
  if (vertex.split && incident.length === 2
    && incident.some(edge => edge.id === vertex.split.firstEdgeId)
    && incident.some(edge => edge.id === vertex.split.secondEdgeId)) {
    const restored = { ...vertex.split.originalEdge };
    const remaining = node.edges.filter(edge => edge.id !== vertex.split.firstEdgeId && edge.id !== vertex.split.secondEdgeId);
    if (remaining.some(edge => edge.id === restored.id)) return false;
    edges = [...remaining, restored];
  } else if (incident.length === 2) {
    const other = edge => edge.from === vertexId ? edge.to : edge.from;
    const startId = other(incident[0]); const endId = other(incident[1]);
    if (startId === endId) return false;
    const origin = { x: node.x, y: node.y };
    const orient = (edge, from, to) => {
      const points = vectorNetworkEdgePoints(node, edge.id, origin);
      return edge.from === from && edge.to === to ? points : [points[3], points[2], points[1], points[0]];
    };
    const first = orient(incident[0], startId, vertexId);
    const second = orient(incident[1], vertexId, endId);
    const control1 = Math.hypot(first[1].x - first[0].x, first[1].y - first[0].y) > 1e-8 ? normalizedNetworkPoint(first[1], node, origin) : null;
    const control2 = Math.hypot(second[2].x - second[3].x, second[2].y - second[3].y) > 1e-8 ? normalizedNetworkPoint(second[2], node, origin) : null;
    edges = node.edges.filter(edge => edge.id !== incident[0].id && edge.id !== incident[1].id);
    edges.push({ id: incident[0].id, from: startId, to: endId, control1, control2 });
  } else edges = node.edges.filter(edge => edge.from !== vertexId && edge.to !== vertexId);
  const vertices = node.vertices.filter(item => item.id !== vertexId);
  // Validate the complete result before changing the live graph. In
  // particular, deleting an endpoint from the smallest supported network
  // must not remove its only edge when the operation is refused.
  if (vertices.length < 2 || !edges.length) return false;
  const faces = [];
  for (const face of node.faces || []) {
    const ring = face.vertexIds || [];
    if (ring.includes(vertexId)) {
      if (incident.length !== 2 || ring.length <= 3) continue;
      faces.push({ ...face, vertexIds: ring.filter(id => id !== vertexId) });
      continue;
    }
    faces.push(face);
  }
  node.edges = edges;
  node.vertices = vertices;
  node.faces = faces;
  return true;
}

/** Return the longest graph edge, used by the touch-friendly add-point action. */
export function longestVectorNetworkEdge(node, origin = { x: node.x, y: node.y }) {
  let longest = null;
  for (const edge of node?.edges || []) {
    const points = vectorNetworkEdgePoints(node, edge.id, origin);
    if (!points) continue;
    let length = 0; let previous = points[0];
    for (let sample = 1; sample <= 24; sample += 1) {
      const t = sample / 24; const inverse = 1 - t;
      const current = {
        x: inverse ** 3 * points[0].x + 3 * inverse ** 2 * t * points[1].x + 3 * inverse * t ** 2 * points[2].x + t ** 3 * points[3].x,
        y: inverse ** 3 * points[0].y + 3 * inverse ** 2 * t * points[1].y + 3 * inverse * t ** 2 * points[2].y + t ** 3 * points[3].y
      };
      length += Math.hypot(current.x - previous.x, current.y - previous.y); previous = current;
    }
    if (!longest || length > longest.length) longest = { edgeId: edge.id, t: .5, length };
  }
  return longest;
}
