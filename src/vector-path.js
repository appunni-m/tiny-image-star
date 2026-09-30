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

/** Convert absolute anchor/control coordinates into a scalable path layer. */
export function vectorGeometryFromAnchors(anchors, { closed = false } = {}) {
  if (!Array.isArray(anchors) || anchors.length < 2) throw new TypeError('A vector path needs at least two points.');
  if (anchors.some(point => !finitePoint(point) || (point.in && !finitePoint(point.in)) || (point.out && !finitePoint(point.out)))) {
    throw new TypeError('Vector path points must contain finite coordinates.');
  }
  if (anchors.some(point => point.mode != null && !isVectorAnchorMode(point.mode))) {
    throw new TypeError('Vector path anchor modes must be corner, smooth, or symmetric.');
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
  const mode = point.mode == null ? (symmetric ? 'symmetric' : 'corner') : point.mode;
  if (!isVectorAnchorMode(mode)) return false;
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
  constrainOppositeHandle(point, part, mode, width, height);
  return true;
}

/**
 * Set a persisted path anchor mode and reconcile its handles immediately.
 * Smooth mode keeps both handle lengths while making them collinear; symmetric
 * mode mirrors the preferred handle exactly. Corner mode preserves geometry.
 */
export function setVectorNodePointMode(node, index, mode, { preferredHandle = 'out' } = {}) {
  const point = node?.points?.[index];
  if (!point || !isVectorAnchorMode(mode) || !['in', 'out'].includes(preferredHandle)
    || (point.mode != null && !isVectorAnchorMode(point.mode))) return false;
  if (!finitePoint(point) || (point.in != null && !finitePoint(point.in)) || (point.out != null && !finitePoint(point.out))) return false;

  if (mode !== 'corner') {
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
    in: handle(d, anchor), out: handle(e, anchor), mode: 'smooth'
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
    y: (Number(point.y) - top) / height
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

/** Resolve a network junction or edge handle in document coordinates. */
export function vectorNetworkVertexPoint(node, vertexId, origin = { x: node.x, y: node.y }) {
  const vertex = networkVertexIndex(node?.vertices).get(vertexId);
  if (!vertex) return null;
  return { x: origin.x + Number(vertex.x) * node.width, y: origin.y + Number(vertex.y) * node.height };
}

/** Return one graph edge's cubic control polygon in document coordinates. */
export function vectorNetworkEdgePoints(node, edgeId, origin = { x: node.x, y: node.y }) {
  const edge = networkEdgeIndex(node?.edges).get(edgeId);
  const start = edge && vectorNetworkVertexPoint(node, edge.from, origin);
  const end = edge && vectorNetworkVertexPoint(node, edge.to, origin);
  if (!edge || !start || !end) return null;
  return [start, networkControlPoint(edge, 'control1', node, origin) || start, networkControlPoint(edge, 'control2', node, origin) || end, end];
}

/** Move a shared network junction without breaking its incident edges. */
export function setVectorNetworkVertexPoint(node, vertexId, position, origin = { x: node.x, y: node.y }) {
  const vertex = node?.vertices?.find(item => item.id === vertexId);
  if (!vertex || !finitePoint(position)) return false;
  for (const edge of node.edges || []) if (edge.from === vertexId || edge.to === vertexId) invalidateNetworkSplitForEdge(node, edge.id);
  delete vertex.split;
  vertex.x = (Number(position.x) - origin.x) / Math.max(1, Number(node.width) || 1);
  vertex.y = (Number(position.y) - origin.y) / Math.max(1, Number(node.height) || 1);
  return true;
}

/** Move a control point belonging to one edge, independent of other branches. */
export function setVectorNetworkEdgeControlPoint(node, edgeId, part, position, origin = { x: node.x, y: node.y }) {
  const edge = node?.edges?.find(item => item.id === edgeId);
  if (!edge || !['control1', 'control2'].includes(part) || !finitePoint(position)) return false;
  invalidateNetworkSplitForEdge(node, edgeId);
  edge[part] = normalizedNetworkPoint(position, node, origin);
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
  if (anchors.some(point => !finitePoint(point) || (point.in && !finitePoint(point.in)) || (point.out && !finitePoint(point.out)))) return false;
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
      const vertex = normalize(anchor); node.vertices.push({ id, ...vertex });
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
  if (vertex.split && incident.length === 2
    && incident.some(edge => edge.id === vertex.split.firstEdgeId)
    && incident.some(edge => edge.id === vertex.split.secondEdgeId)) {
    const restored = { ...vertex.split.originalEdge };
    const remaining = node.edges.filter(edge => edge.id !== vertex.split.firstEdgeId && edge.id !== vertex.split.secondEdgeId);
    if (remaining.some(edge => edge.id === restored.id)) return false;
    node.edges = [...remaining, restored];
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
    node.edges = node.edges.filter(edge => edge.id !== incident[0].id && edge.id !== incident[1].id);
    node.edges.push({ id: incident[0].id, from: startId, to: endId, control1, control2 });
  } else node.edges = node.edges.filter(edge => edge.from !== vertexId && edge.to !== vertexId);
  const vertices = node.vertices.filter(item => item.id !== vertexId);
  if (vertices.length < 2 || !node.edges.length) return false;
  const faces = [];
  for (const face of node.faces || []) {
    const ring = face.vertexIds || [];
    if (ring.includes(vertexId)) {
      if (incident.length !== 2 || ring.length <= 3) continue;
      face.vertexIds = ring.filter(id => id !== vertexId);
    }
    faces.push(face);
  }
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
