import {
  vectorNetworkEdgeForPair, vectorNetworkEdgePairIndex, vectorNetworkEdgePoints
} from './vector-path.js';

const EPSILON = 1e-9;
const CUBIC_LENGTH_SUBDIVISIONS = 32;
const GAUSS_NODES = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
const GAUSS_WEIGHTS = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];
const point = (x, y) => ({ x, y });
const add = (a, b) => point(a.x + b.x, a.y + b.y);
const subtract = (a, b) => point(a.x - b.x, a.y - b.y);
const scale = (a, amount) => point(a.x * amount, a.y * amount);
const length = value => Math.hypot(value.x, value.y);
const distance = (a, b) => length(subtract(a, b));
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;

function result(eligible, reason = null) {
  return { eligible, reason };
}

function faceIdentity(face) {
  return face?.id == null ? null : String(face.id);
}

function faceVertices(face) {
  return Array.isArray(face?.vertexIds) ? face.vertexIds : null;
}

/**
 * Check whether a face has one unambiguous, simple graph boundary that can be
 * rounded without changing any other part of the network.
 *
 * The `reason` field is a stable machine-readable code for inspector/UI use.
 */
export function networkFaceCornerEligibility(node, face) {
  if (node?.type !== 'network') return result(false, 'not-a-network');
  const ids = faceVertices(face);
  if (!ids || ids.length < 3 || ids.some(id => typeof id !== 'string' || !id)
    || new Set(ids).size !== ids.length) return result(false, 'invalid-face');
  if (!Array.isArray(node.vertices) || !Array.isArray(node.edges)
    || !Number.isFinite(node.width) || node.width <= 0
    || !Number.isFinite(node.height) || node.height <= 0) return result(false, 'invalid-geometry');

  const verticesById = new Map(node.vertices.map(vertex => [vertex?.id, vertex]));
  if (verticesById.size !== node.vertices.length) return result(false, 'invalid-geometry');
  for (const id of ids) {
    const vertex = verticesById.get(id);
    if (!vertex || !Number.isFinite(Number(vertex.x)) || !Number.isFinite(Number(vertex.y))) {
      return result(false, 'missing-vertex');
    }
    if (!Number.isFinite(Number(vertex.x) * node.width) || !Number.isFinite(Number(vertex.y) * node.height)) {
      return result(false, 'invalid-geometry');
    }
  }

  const id = faceIdentity(face);
  for (const candidate of node.faces || []) {
    const otherIds = faceVertices(candidate);
    if (candidate === face) continue;
    if (id != null && faceIdentity(candidate) === id) {
      if (otherIds?.length === ids.length && otherIds.every((vertexId, index) => vertexId === ids[index])) continue;
      return result(false, 'shared-face');
    }
    if (otherIds?.some(vertexId => ids.includes(vertexId))) return result(false, 'shared-face');
  }

  const degrees = new Map(ids.map(vertexId => [vertexId, 0]));
  const pairCounts = new Map();
  for (const edge of node.edges) {
    if (!edge || typeof edge.from !== 'string' || typeof edge.to !== 'string') {
      if (edge && (degrees.has(edge.from) || degrees.has(edge.to))) return result(false, 'invalid-geometry');
      continue;
    }
    if (edge.from === edge.to) {
      if (degrees.has(edge.from)) degrees.set(edge.from, degrees.get(edge.from) + 2);
      continue;
    }
    const pairKey = undirectedPairKey(edge.from, edge.to);
    pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
    if (degrees.has(edge.from)) degrees.set(edge.from, degrees.get(edge.from) + 1);
    if (degrees.has(edge.to)) degrees.set(edge.to, degrees.get(edge.to) + 1);
  }

  const edgesByPair = vectorNetworkEdgePairIndex(node);
  for (let index = 0; index < ids.length; index += 1) {
    const fromId = ids[index];
    const toId = ids[(index + 1) % ids.length];
    const pairKey = undirectedPairKey(fromId, toId);
    const edge = vectorNetworkEdgeForPair(edgesByPair, fromId, toId);
    if (!edge || pairCounts.get(pairKey) !== 1) return result(false, 'ambiguous-edge');
    if (!Number.isFinite(Number(edge.control1?.x ?? 0)) || !Number.isFinite(Number(edge.control1?.y ?? 0))
      || !Number.isFinite(Number(edge.control2?.x ?? 0)) || !Number.isFinite(Number(edge.control2?.y ?? 0))) {
      return result(false, 'invalid-geometry');
    }
    for (const control of [edge.control1, edge.control2]) {
      if (control && (!Number.isFinite(Number(control.x) * node.width)
        || !Number.isFinite(Number(control.y) * node.height))) return result(false, 'invalid-geometry');
    }
  }
  if ([...degrees.values()].some(degree => degree !== 2)) return result(false, 'boundary-branch');
  return result(true);
}

function undirectedPairKey(first, second) {
  return first < second ? `${first}\0${second}` : `${second}\0${first}`;
}

/** Apply the face eligibility rules to one selected anchor. */
export function vectorNetworkVertexCornerRadiusEligibility(node, vertexId) {
  if (node?.type !== 'network') return result(false, 'not-a-network');
  if (!node.vertices?.some(vertex => vertex?.id === vertexId)) return result(false, 'missing-vertex');
  const faces = (node.faces || []).filter(face => faceVertices(face)?.includes(vertexId));
  if (!faces.length) return result(false, 'not-face-boundary');
  if (faces.length !== 1) return result(false, 'shared-face');
  return networkFaceCornerEligibility(node, faces[0]);
}

function orientedEdge(node, fromId, toId, edgesByPair, origin) {
  const edge = vectorNetworkEdgeForPair(edgesByPair, fromId, toId);
  if (!edge) return null;
  const points = vectorNetworkEdgePoints(node, edge.id, origin);
  if (!points || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const reversed = edge.from !== fromId;
  const [start, control1, control2, end] = reversed
    ? [points[3], points[2], points[1], points[0]]
    : points;
  const hasControls = Boolean(edge.control1 || edge.control2);
  return {
    edge, start, control1, control2, end, hasControls,
    cubic: [start, control1, control2, end]
  };
}

function cubicPoint(curve, t) {
  const inverse = 1 - t;
  const [p0, p1, p2, p3] = curve;
  return point(
    inverse ** 3 * p0.x + 3 * inverse ** 2 * t * p1.x + 3 * inverse * t ** 2 * p2.x + t ** 3 * p3.x,
    inverse ** 3 * p0.y + 3 * inverse ** 2 * t * p1.y + 3 * inverse * t ** 2 * p2.y + t ** 3 * p3.y
  );
}

function cubicDerivative(curve, t) {
  const inverse = 1 - t;
  const [p0, p1, p2, p3] = curve;
  return point(
    3 * inverse ** 2 * (p1.x - p0.x) + 6 * inverse * t * (p2.x - p1.x) + 3 * t ** 2 * (p3.x - p2.x),
    3 * inverse ** 2 * (p1.y - p0.y) + 6 * inverse * t * (p2.y - p1.y) + 3 * t ** 2 * (p3.y - p2.y)
  );
}

function splitCubic(curve, t) {
  const [p0, p1, p2, p3] = curve;
  const p01 = lerp(p0, p1, t); const p12 = lerp(p1, p2, t); const p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t); const p123 = lerp(p12, p23, t);
  const middle = lerp(p012, p123, t);
  return [[p0, p01, p012, middle], [middle, p123, p23, p3]];
}

function lerp(a, b, t) {
  return point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
}

function cubicSubcurve(curve, start, end) {
  if (start <= EPSILON && end >= 1 - EPSILON) return curve.map(item => ({ ...item }));
  const left = end >= 1 - EPSILON ? curve : splitCubic(curve, end)[0];
  if (start <= EPSILON) return left;
  return splitCubic(left, start / end)[1];
}

function cubicIsStraight(curve) {
  const [start, control1, control2, end] = curve;
  const chord = subtract(end, start);
  const chordLength = length(chord);
  if (chordLength <= EPSILON) return true;
  const tolerance = chordLength * 1e-8;
  return Math.abs(cross(chord, subtract(control1, start))) <= tolerance
    && Math.abs(cross(chord, subtract(control2, start))) <= tolerance
    && dot(subtract(control1, start), chord) >= -tolerance
    && dot(subtract(control2, start), chord) >= -tolerance
    && dot(subtract(end, control2), chord) >= -tolerance;
}

function cubicArcLength(curve, t0 = 0, t1 = 1) {
  const half = (t1 - t0) / 2;
  if (Math.abs(half) <= EPSILON) return 0;
  const middle = (t0 + t1) / 2;
  let integral = 0;
  for (let index = 0; index < GAUSS_NODES.length; index += 1) {
    integral += GAUSS_WEIGHTS[index] * length(cubicDerivative(curve, middle + half * GAUSS_NODES[index]));
  }
  return Math.abs(half) * integral;
}

function cubicLengthTable(curve) {
  const parameters = [0];
  const cumulative = [0];
  for (let index = 1; index <= CUBIC_LENGTH_SUBDIVISIONS; index += 1) {
    const start = (index - 1) / CUBIC_LENGTH_SUBDIVISIONS;
    const end = index / CUBIC_LENGTH_SUBDIVISIONS;
    parameters.push(end);
    cumulative.push(cumulative.at(-1) + cubicArcLength(curve, start, end));
  }
  return { parameters, cumulative, total: cumulative.at(-1) };
}

function parameterAtLength(curve, requestedLength, table, fromEnd = false) {
  const total = table.total;
  const requested = Math.max(0, Math.min(total, requestedLength));
  const target = fromEnd ? total - requested : requested;
  if (total <= EPSILON || target <= 0) return 0;
  if (target >= total) return 1;
  let lower = 0;
  let upper = table.cumulative.length - 1;
  while (upper - lower > 1) {
    const middle = (lower + upper) >> 1;
    if (table.cumulative[middle] < target) lower = middle;
    else upper = middle;
  }
  const intervalStart = table.parameters[lower];
  let low = intervalStart;
  let high = table.parameters[upper];
  const baseLength = table.cumulative[lower];
  for (let index = 0; index < 24; index += 1) {
    const middle = (low + high) / 2;
    const lengthAtMiddle = baseLength + cubicArcLength(curve, intervalStart, middle);
    if (lengthAtMiddle < target) low = middle;
    else high = middle;
  }
  const parameter = (low + high) / 2;
  return parameter;
}

function unit(vector, fallback) {
  const magnitude = length(vector);
  if (magnitude > EPSILON) return scale(vector, 1 / magnitude);
  const fallbackMagnitude = length(fallback);
  return fallbackMagnitude > EPSILON ? scale(fallback, 1 / fallbackMagnitude) : point(0, 0);
}

function vertexTurn(previousEdge, nextEdge) {
  const incoming = unit(cubicDerivative(previousEdge.cubic, 1), subtract(previousEdge.end, previousEdge.start));
  const outgoing = unit(cubicDerivative(nextEdge.cubic, 0), subtract(nextEdge.end, nextEdge.start));
  const turn = Math.atan2(cross(incoming, outgoing), dot(incoming, outgoing));
  const angle = Math.abs(turn);
  if (angle < 1e-8 || Math.PI - angle < 1e-8) {
    return { incoming, outgoing, turn, tangentFactor: 0 };
  }
  const tangentFactor = Math.tan(angle / 2);
  return { incoming, outgoing, turn, tangentFactor: Number.isFinite(tangentFactor) ? tangentFactor : 0 };
}

function normalizedRadius(vertex) {
  if (!Object.hasOwn(vertex || {}, 'cornerRadius')) return 0;
  const radius = Number(vertex.cornerRadius);
  return Number.isFinite(radius) && radius > 0 ? Math.min(radius, 100_000) : 0;
}

function clampCornerRadii(corners, edges) {
  const limits = corners.map(() => 1);
  for (let index = 0; index < edges.length; index += 1) {
    const current = corners[index];
    const nextIndex = (index + 1) % corners.length;
    const next = corners[nextIndex];
    const used = current.trimDistance + next.trimDistance;
    if (used <= edges[index].length + 1e-8 || used <= 0) continue;
    const factor = Math.max(0, edges[index].length / used);
    limits[index] = Math.min(limits[index], factor);
    limits[nextIndex] = Math.min(limits[nextIndex], factor);
  }
  for (let index = 0; index < corners.length; index += 1) {
    corners[index].scale *= limits[index];
    corners[index].trimDistance *= limits[index];
  }
}

function makeOriginalSegment(edge, fromLength, toLength) {
  const startT = parameterAtLength(edge.cubic, fromLength, edge.lengthTable);
  const endT = parameterAtLength(edge.cubic, toLength, edge.lengthTable, true);
  const curve = cubicSubcurve(edge.cubic, startT, endT);
  return edge.hasControls
    ? { type: 'cubic', start: curve[0], control1: curve[1], control2: curve[2], end: curve[3] }
    : { type: 'line', start: curve[0], end: curve[3] };
}

function appendCornerBridge(commands, corner, incomingEdge, outgoingEdge) {
  if (corner.radius <= EPSILON) return;
  const start = incomingEdge.trimmedEnd;
  const end = outgoingEdge.trimmedStart;
  if (distance(start, end) <= EPSILON) return;
  const incomingTangent = unit(cubicDerivative(incomingEdge.trimmedCurve, 1), subtract(incomingEdge.trimmedEnd, incomingEdge.original.start));
  const outgoingTangent = unit(cubicDerivative(outgoingEdge.trimmedCurve, 0), subtract(outgoingEdge.original.end, outgoingEdge.trimmedStart));

  if (cubicIsStraight(incomingEdge.original.cubic) && cubicIsStraight(outgoingEdge.original.cubic)
    && Math.abs(corner.turn) > 1e-8 && corner.radius > EPSILON) {
    const center = add(start, scale(point(-incomingTangent.y, incomingTangent.x), Math.sign(corner.turn) * corner.radius));
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    commands.push({
      type: 'arc', center, radius: corner.radius,
      startAngle, endAngle: startAngle + corner.turn,
      start, end
    });
    return;
  }

  const handleLength = distance(start, end) * 0.5522847498307936;
  commands.push({
    type: 'cubic', start,
    control1: add(start, scale(incomingTangent, handleLength)),
    control2: subtract(end, scale(outgoingTangent, handleLength)),
    end
  });
}

/**
 * Build a face boundary with independent per-vertex corner radii.
 *
 * Network anchors and handles are normalized in storage. This function expands
 * them into node-local coordinates (plus the optional origin), trims the
 * original Bézier edges with exact De Casteljau subdivision, and inserts
 * tangent circular arcs for straight corners or tangent cubic transitions for
 * curved corners. Unsupported topology and zero-radius faces return null.
 */
export function vectorNetworkFacePathCommands(node, face, origin = { x: 0, y: 0 }) {
  const eligibility = networkFaceCornerEligibility(node, face);
  if (!eligibility.eligible || !Number.isFinite(origin?.x) || !Number.isFinite(origin?.y)) return null;
  const ids = face.vertexIds;
  const edgesByPair = vectorNetworkEdgePairIndex(node);
  const edges = ids.map((fromId, index) => orientedEdge(node, fromId, ids[(index + 1) % ids.length], edgesByPair, origin));
  if (edges.some(edge => !edge)) return null;

  const corners = ids.map((vertexId, index) => {
    const turn = vertexTurn(edges[(index + ids.length - 1) % ids.length], edges[index]);
    const requestedRadius = normalizedRadius(node.vertices.find(vertex => vertex.id === vertexId));
    return {
      ...turn, requestedRadius,
      radius: requestedRadius,
      scale: 1,
      trimDistance: requestedRadius * turn.tangentFactor
    };
  });
  if (!corners.some(corner => corner.trimDistance > EPSILON)) return null;

  for (const edge of edges) {
    edge.lengthTable = cubicLengthTable(edge.cubic);
    edge.length = edge.lengthTable.total;
  }
  clampCornerRadii(corners, edges);
  for (const corner of corners) corner.radius = corner.requestedRadius * corner.scale;
  if (!corners.some(corner => corner.radius > EPSILON)) return null;

  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const startDistance = corners[index].trimDistance;
    const endDistance = corners[(index + 1) % corners.length].trimDistance;
    const startT = parameterAtLength(edge.cubic, startDistance, edge.lengthTable);
    const endT = parameterAtLength(edge.cubic, endDistance, edge.lengthTable, true);
    if (startT > endT + 1e-8) return null;
    edge.trimmedCurve = cubicSubcurve(edge.cubic, startT, endT);
    edge.trimmedStart = edge.trimmedCurve[0];
    edge.trimmedEnd = edge.trimmedCurve[3];
    edge.original = edge;
  }

  const commands = [];
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const curve = edge.trimmedCurve;
    commands.push(edge.hasControls
      ? { type: 'cubic', start: curve[0], control1: curve[1], control2: curve[2], end: curve[3] }
      : { type: 'line', start: curve[0], end: curve[3] });
    const cornerIndex = (index + 1) % corners.length;
    appendCornerBridge(commands, corners[cornerIndex], edge, edges[cornerIndex]);
  }
  const firstEdge = edges[0];
  return { start: firstEdge.trimmedStart, commands, closed: true };
}

function appendFlattenedCubic(points, command, tolerance, depth = 0) {
  const chord = subtract(command.end, command.start);
  const chordLength = length(chord);
  const flatness = chordLength <= EPSILON
    ? Math.max(distance(command.control1, command.start), distance(command.control2, command.start))
    : Math.max(Math.abs(cross(chord, subtract(command.control1, command.start))),
      Math.abs(cross(chord, subtract(command.control2, command.start)))) / chordLength;
  if (flatness <= tolerance || depth >= 12) {
    points.push(command.end);
    return;
  }
  const [left, right] = splitCubic([command.start, command.control1, command.control2, command.end], 0.5);
  appendFlattenedCubic(points, { type: 'cubic', start: left[0], control1: left[1], control2: left[2], end: left[3] }, tolerance, depth + 1);
  appendFlattenedCubic(points, { type: 'cubic', start: right[0], control1: right[1], control2: right[2], end: right[3] }, tolerance, depth + 1);
}

/** Flatten the rounded boundary for precise fill hit testing; null means use the original face. */
export function vectorNetworkFacePathPoints(node, face, origin = { x: 0, y: 0 }, tolerance = 0.35) {
  const path = vectorNetworkFacePathCommands(node, face, origin);
  if (!path) return null;
  const flatness = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0.35;
  const points = [path.start];
  for (const command of path.commands) {
    if (command.type === 'line') points.push(command.end);
    else if (command.type === 'cubic') appendFlattenedCubic(points, command, flatness);
    else if (command.type === 'arc') {
      const sweep = command.endAngle - command.startAngle;
      const angleStep = command.radius > flatness
        ? 2 * Math.acos(Math.max(-1, 1 - flatness / command.radius))
        : Math.PI / 8;
      const segments = Math.max(1, Math.min(4096, Math.ceil(Math.abs(sweep) / Math.max(angleStep, 1e-4))));
      for (let index = 1; index <= segments; index += 1) {
        const angle = command.startAngle + sweep * index / segments;
        points.push(point(command.center.x + Math.cos(angle) * command.radius,
          command.center.y + Math.sin(angle) * command.radius));
      }
    }
  }
  if (points.length > 1 && distance(points[0], points.at(-1)) <= EPSILON) points.pop();
  return points;
}

/** Trace a rounded face into a Canvas 2D path; false asks callers to trace the original face. */
export function traceVectorNetworkFacePath(ctx, node, face, origin = { x: 0, y: 0 }) {
  const path = vectorNetworkFacePathCommands(node, face, origin);
  if (!path) return false;
  ctx.moveTo(path.start.x, path.start.y);
  for (const command of path.commands) {
    if (command.type === 'line') ctx.lineTo(command.end.x, command.end.y);
    else if (command.type === 'cubic') ctx.bezierCurveTo(
      command.control1.x, command.control1.y, command.control2.x, command.control2.y,
      command.end.x, command.end.y
    );
    else if (command.type === 'arc') ctx.arc(command.center.x, command.center.y, command.radius,
      command.startAngle, command.endAngle, command.endAngle < command.startAngle);
  }
  ctx.closePath();
  return true;
}
