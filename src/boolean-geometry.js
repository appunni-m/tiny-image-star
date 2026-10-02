import { clampCornerRadii, cornerRadiusKeys, isValidCornerRadii } from './corner-radii.js';
import {
  vectorNetworkEdgeForPair, vectorNetworkEdgePairIndex, vectorNetworkEdgePoints,
  vectorNetworkVertexPoint, vectorPathContours
} from './vector-path.js';

const operations = new Set(['union', 'subtract', 'intersect', 'exclude']);
const MAX_INPUT_SEGMENTS = 512;
const MAX_INPUT_CURVES = 512;
const MAX_SPLIT_POINTS = 40_000;
const MAX_CURVE_INTERSECTION_CELLS = 200_000;
const TAU = Math.PI * 2;

export class BooleanBakeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BooleanBakeError';
    this.code = 'UNSUPPORTED_BOOLEAN_BAKE';
  }
}

function unsupported(reason) {
  throw new BooleanBakeError(`Cannot bake this Boolean group: ${reason}`);
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function rectangleCornerRadii(node) {
  const radiusInput = node.cornerRadii ?? node.radius ?? 0;
  const radiusValues = typeof radiusInput === 'number'
    ? Object.fromEntries(cornerRadiusKeys.map(key => [key, radiusInput]))
    : radiusInput;
  return clampCornerRadii(node.width, node.height, radiusValues);
}

function vector(x, y) { return { x, y }; }
function subtract(a, b) { return vector(a.x - b.x, a.y - b.y); }
function add(a, b) { return vector(a.x + b.x, a.y + b.y); }
function scale(point, amount) { return vector(point.x * amount, point.y * amount); }
function cross(a, b) { return a.x * b.y - a.y * b.x; }
function dot(a, b) { return a.x * b.x + a.y * b.y; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function area(contour) {
  let value = 0;
  for (let index = 0; index < contour.length; index += 1) {
    value += cross(contour[index], contour[(index + 1) % contour.length]);
  }
  return value / 2;
}

function isZeroHandle(handle) {
  return handle == null || (Number(handle.x) === 0 && Number(handle.y) === 0);
}

function validateSimpleOperand(node, { root = false } = {}) {
  if (!node || !['rectangle', 'ellipse', 'polygon', 'star', 'path', 'network', 'boolean'].includes(node.type)) {
    unsupported(`“${node?.name || node?.type || 'Unknown layer'}” is not a supported closed vector shape.`);
  }
  if (![node.x, node.y, node.width, node.height, node.rotation ?? 0].every(finite)
    || node.width <= 0 || node.height <= 0) unsupported(`“${node.name || node.type}” has invalid or zero-sized geometry.`);
  if (!root && ((node.opacity ?? 1) !== 1 || (node.fillOpacity ?? 1) !== 1
    || node.blendMode && node.blendMode !== 'normal'
    || node.variableBindings?.opacity || node.variableBindings?.fillOpacity || node.variableBindings?.visible
    || node.visible === false)) {
    unsupported(`“${node.name || node.type}” uses transparency, visibility, or blending that cannot be represented by a single vector path.`);
  }

  if (node.type === 'rectangle') {
    if (node.cornerRadii != null && !isValidCornerRadii(node.cornerRadii)) {
      unsupported(`“${node.name || node.type}” has invalid corner-radius geometry.`);
    }
    if (node.variableBindings?.radius) {
      unsupported(`“${node.name || node.type}” has a mode-bound radius; remove that binding before baking its geometry.`);
    }
    return;
  }
  if (node.type === 'ellipse') return;
  if (node.type === 'polygon' || node.type === 'star') {
    const count = Number(node.points ?? (node.type === 'star' ? 5 : 6));
    if (!Number.isInteger(count) || count < 3 || count > 32) unsupported(`“${node.name || node.type}” has a non-integer or unsupported point count.`);
    if (node.type === 'star' && (!finite(node.innerRadius ?? .48) || (node.innerRadius ?? .48) < 0 || (node.innerRadius ?? .48) > 1)) {
      unsupported(`“${node.name || node.type}” has an invalid inner radius.`);
    }
    return;
  }
  if (node.type === 'path') {
    const contours = vectorPathContours(node);
    if (!contours.length || contours.some(contour => contour.closed !== true || !Array.isArray(contour.points) || contour.points.length < 3)) {
      unsupported(`“${node.name || node.type}” must contain only closed contours with at least three points.`);
    }
    const invalidCurveCoordinates = contours.some(contour => contour.points.some(point => {
      return !finite(point.x) || !finite(point.y)
        || (point.in != null && (!finite(point.in.x) || !finite(point.in.y)))
        || (point.out != null && (!finite(point.out.x) || !finite(point.out.y)));
    }));
    if (invalidCurveCoordinates) {
      unsupported(`“${node.name || node.type}” contains non-finite Bézier geometry.`);
    }
    return;
  }
  if (node.type === 'network') {
    validateNetworkBakeSource(node);
    return;
  }
  if (node.type === 'boolean') {
    if (!operations.has(node.operation) || !Array.isArray(node.children) || node.children.length < 2) {
      unsupported(`“${node.name || node.type}” has an invalid Boolean operation or no source shapes.`);
    }
    for (const child of node.children) validateSimpleOperand(child);
  }
}

function networkEdgePair(from, to) {
  return [from, to].sort().join('\0');
}

function validateNetworkBakeSource(node) {
  const vertices = node.vertices;
  const edges = node.edges;
  const faces = node.faces;
  if (!Array.isArray(vertices) || !vertices.length || !Array.isArray(edges) || !edges.length
    || !Array.isArray(faces) || !faces.length) {
    unsupported(`“${node.name || node.type}” must have at least one closed network face.`);
  }
  const vertexIds = new Set();
  for (const vertex of vertices) {
    if (!vertex || typeof vertex.id !== 'string' || !vertex.id || vertexIds.has(vertex.id)
      || !finite(vertex.x) || !finite(vertex.y)) {
      unsupported(`“${node.name || node.type}” has malformed or duplicate network vertices.`);
    }
    if (vertex.mode != null && !['corner', 'smooth', 'symmetric'].includes(vertex.mode)) {
      unsupported(`“${node.name || node.type}” has an unsupported network vertex mode.`);
    }
    if (vertex.mode === 'smooth' || vertex.mode === 'symmetric') {
      unsupported(`“${node.name || node.type}” has constrained handle modes that an editable path cannot preserve.`);
    }
    if (vertex.split) unsupported(`“${node.name || node.type}” contains split-edge restoration metadata that an editable path cannot preserve.`);
    vertexIds.add(vertex.id);
  }

  const edgeIds = new Set();
  const edgePairs = new Map();
  for (const edge of edges) {
    if (!edge || typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id)
      || !vertexIds.has(edge.from) || !vertexIds.has(edge.to) || edge.from === edge.to
      || ['control1', 'control2'].some(part => edge[part] != null && (!finite(edge[part].x) || !finite(edge[part].y)))) {
      unsupported(`“${node.name || node.type}” has a malformed network edge.`);
    }
    const pair = networkEdgePair(edge.from, edge.to);
    if (edgePairs.has(pair)) {
      unsupported(`“${node.name || node.type}” has parallel edges that make its face boundaries ambiguous.`);
    }
    edgeIds.add(edge.id);
    edgePairs.set(pair, edge.id);
  }

  const edgesByPair = vectorNetworkEdgePairIndex(node);
  const faceEdgeUse = new Map();
  const faceVertexUse = new Set();
  for (const face of faces) {
    const ring = face?.vertexIds;
    if (!Array.isArray(ring) || ring.length < 3 || new Set(ring).size !== ring.length
      || ring.some(id => !vertexIds.has(id))) {
      unsupported(`“${node.name || node.type}” has a malformed or non-simple face vertex cycle.`);
    }
    if ((face.fillOpacity ?? 1) !== 1) {
      unsupported(`“${node.name || node.type}” has a translucent face; its mask cannot be represented by a binary vector path.`);
    }
    // Connected planar faces normally share vertices at their junctions. The
    // bake converts the filled regions to ordinary path contours, so these
    // graph junctions are safe when every edge remains part of one or two
    // closed face boundaries. `curveBoolean` below removes internal shared
    // edges and keeps the visible union as editable path geometry.
    for (const vertexId of ring) faceVertexUse.add(vertexId);
    for (let index = 0; index < ring.length; index += 1) {
      const fromId = ring[index];
      const toId = ring[(index + 1) % ring.length];
      if (!vectorNetworkEdgeForPair(edgesByPair, fromId, toId)) {
        unsupported(`“${node.name || node.type}” has a face boundary that does not follow a network edge.`);
      }
      const pair = networkEdgePair(fromId, toId);
      const uses = faceEdgeUse.get(pair) || [];
      uses.push({ fromId, toId });
      if (uses.length > 2) unsupported(`“${node.name || node.type}” has a network edge shared by more than two faces.`);
      faceEdgeUse.set(pair, uses);
    }
  }
  if (faceEdgeUse.size !== edges.length || edges.some(edge => !faceEdgeUse.has(networkEdgePair(edge.from, edge.to)))) {
    unsupported(`“${node.name || node.type}” has open or unfilled network edges outside its closed faces.`);
  }
  for (const uses of faceEdgeUse.values()) {
    if (uses.length === 2 && uses[0].fromId === uses[1].fromId && uses[0].toId === uses[1].toId) {
      unsupported(`“${node.name || node.type}” has a shared face edge with inconsistent direction.`);
    }
  }
  if (faceVertexUse.size !== vertices.length) {
    unsupported(`“${node.name || node.type}” has isolated network vertices outside its closed faces.`);
  }
}

function rotate(point, cx, cy, angle) {
  if (!angle) return point;
  const radians = angle * Math.PI / 180;
  const dx = point.x - cx;
  const dy = point.y - cy;
  return vector(cx + dx * Math.cos(radians) - dy * Math.sin(radians), cy + dx * Math.sin(radians) + dy * Math.cos(radians));
}

function regularPolygon(node, star = false) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const count = Number(node.points ?? (star ? 5 : 6));
  const result = [];
  const vertexCount = star ? count * 2 : count;
  const starRadius = Math.min(node.width, node.height) / 2;
  for (let index = 0; index < vertexCount; index += 1) {
    const angle = -Math.PI / 2 + index * (star ? Math.PI : TAU) / count;
    const ratio = star && index % 2 ? Number(node.innerRadius ?? .48) : 1;
    const radiusX = (star ? starRadius : node.width / 2) * ratio;
    const radiusY = (star ? starRadius : node.height / 2) * ratio;
    result.push(rotate(vector(cx + Math.cos(angle) * radiusX, cy + Math.sin(angle) * radiusY), cx, cy, node.rotation || 0));
  }
  return result;
}

function primitiveContours(node) {
  let contours;
  if (node.type === 'rectangle') {
    contours = [[
      vector(node.x, node.y), vector(node.x + node.width, node.y),
      vector(node.x + node.width, node.y + node.height), vector(node.x, node.y + node.height)
    ]];
  } else if (node.type === 'polygon' || node.type === 'star') {
    contours = [regularPolygon(node, node.type === 'star')];
  } else if (node.type === 'path') {
    contours = vectorPathContours(node).map(contour => contour.points.map(point => vector(
      node.x + Number(point.x) * node.width,
      node.y + Number(point.y) * node.height
    )));
  } else return null;

  if (node.type === 'path' || node.type === 'rectangle') {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    if (node.rotation) contours = contours.map(contour => contour.map(point => rotate(point, cx, cy, node.rotation)));
  }
  return contours;
}

function pointInContours(point, contours, fillRule = 'evenodd') {
  let crossings = 0;
  let winding = 0;
  for (const contour of contours) {
    for (let index = 0; index < contour.length; index += 1) {
      const first = contour[index];
      const second = contour[(index + 1) % contour.length];
      if ((first.y > point.y) !== (second.y > point.y)) {
        const x = first.x + (point.y - first.y) * (second.x - first.x) / (second.y - first.y);
        if (x > point.x) crossings += 1;
      }
      if (first.y <= point.y) {
        if (second.y > point.y && cross(subtract(second, first), subtract(point, first)) > 0) winding += 1;
      } else if (second.y <= point.y && cross(subtract(second, first), subtract(point, first)) < 0) winding -= 1;
    }
  }
  return fillRule === 'nonzero' ? winding !== 0 : crossings % 2 === 1;
}

function combineMembership(shapes, point, operation) {
  let result = pointInContours(point, shapes[0].contours, shapes[0].fillRule);
  for (let index = 1; index < shapes.length; index += 1) {
    const inside = pointInContours(point, shapes[index].contours, shapes[index].fillRule);
    if (operation === 'union') result ||= inside;
    else if (operation === 'subtract') result &&= !inside;
    else if (operation === 'intersect') result &&= inside;
    else result = result !== inside;
  }
  return result;
}

function segmentBoundsOverlap(a, b, epsilon) {
  return Math.max(Math.min(a.a.x, a.b.x), Math.min(b.a.x, b.b.x)) <= Math.min(Math.max(a.a.x, a.b.x), Math.max(b.a.x, b.b.x)) + epsilon
    && Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y)) <= Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y)) + epsilon;
}

function addSplit(segment, value) {
  if (value < -1e-10 || value > 1 + 1e-10) return;
  segment.splits.push(Math.max(0, Math.min(1, value)));
}

function splitAtIntersection(first, second, epsilon) {
  if (!segmentBoundsOverlap(first, second, epsilon)) return;
  const r = subtract(first.b, first.a);
  const s = subtract(second.b, second.a);
  const delta = subtract(second.a, first.a);
  const denominator = cross(r, s);
  const threshold = epsilon * Math.max(Math.hypot(r.x, r.y), Math.hypot(s.x, s.y), 1);
  if (Math.abs(denominator) > threshold) {
    const t = cross(delta, s) / denominator;
    const u = cross(delta, r) / denominator;
    const tTolerance = epsilon / Math.max(distance(first.a, first.b), epsilon);
    const uTolerance = epsilon / Math.max(distance(second.a, second.b), epsilon);
    if (t >= -tTolerance && t <= 1 + tTolerance && u >= -uTolerance && u <= 1 + uTolerance) {
      addSplit(first, t);
      addSplit(second, u);
    }
    return;
  }
  if (Math.abs(cross(delta, r)) > epsilon * Math.max(1, Math.hypot(r.x, r.y))) return;
  const rLength = dot(r, r);
  const sLength = dot(s, s);
  if (rLength <= epsilon * epsilon || sLength <= epsilon * epsilon) return;
  for (const point of [second.a, second.b]) addSplit(first, dot(subtract(point, first.a), r) / rLength);
  for (const point of [first.a, first.b]) addSplit(second, dot(subtract(point, second.a), s) / sLength);
}

function pointKey(point, epsilon) {
  return `${Math.round(point.x / epsilon)},${Math.round(point.y / epsilon)}`;
}

function turnClockwise(fromAngle, toAngle) {
  let turn = fromAngle - toAngle;
  while (turn < 0) turn += TAU;
  while (turn >= TAU) turn -= TAU;
  return turn;
}

function canonicalizeContour(contour, epsilon) {
  const simplified = [];
  for (const point of contour) {
    if (!simplified.length || distance(simplified.at(-1), point) > epsilon) simplified.push(point);
  }
  if (simplified.length > 1 && distance(simplified[0], simplified.at(-1)) <= epsilon) simplified.pop();
  let changed = true;
  while (changed && simplified.length > 3) {
    changed = false;
    for (let index = 0; index < simplified.length; index += 1) {
      const previous = simplified[(index - 1 + simplified.length) % simplified.length];
      const current = simplified[index];
      const next = simplified[(index + 1) % simplified.length];
      const first = subtract(current, previous);
      const second = subtract(next, current);
      if (Math.abs(cross(first, second)) <= epsilon * Math.max(1, Math.hypot(first.x, first.y), Math.hypot(second.x, second.y))
        && dot(first, second) >= 0) {
        simplified.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  if (simplified.length < 3 || Math.abs(area(simplified)) <= epsilon * epsilon) return null;
  let smallest = 0;
  for (let index = 1; index < simplified.length; index += 1) {
    if (simplified[index].x < simplified[smallest].x - epsilon
      || (Math.abs(simplified[index].x - simplified[smallest].x) <= epsilon && simplified[index].y < simplified[smallest].y)) smallest = index;
  }
  return [...simplified.slice(smallest), ...simplified.slice(0, smallest)];
}

/** Compute exact polygonal Boolean boundaries. Curves are refused instead of rasterized or approximated. */
export function polygonBoolean(shapes, operation) {
  if (!operations.has(operation)) throw new TypeError('Choose a supported Boolean operation.');
  if (!Array.isArray(shapes) || !shapes.length || shapes.some(shape => !Array.isArray(shape?.contours))) throw new TypeError('Boolean geometry needs one or more polygon contour sets.');
  const segments = [];
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity; let maxCoordinate = 0;
  for (const [shapeIndex, shape] of shapes.entries()) {
    for (const contour of shape.contours) {
      if (!Array.isArray(contour) || contour.length < 3 || contour.some(point => !finite(point?.x) || !finite(point?.y))) unsupported('an input contour is malformed.');
      for (let index = 0; index < contour.length; index += 1) {
        const a = contour[index]; const b = contour[(index + 1) % contour.length];
        minX = Math.min(minX, a.x); minY = Math.min(minY, a.y);
        maxX = Math.max(maxX, a.x); maxY = Math.max(maxY, a.y);
        maxCoordinate = Math.max(maxCoordinate, Math.abs(a.x), Math.abs(a.y));
        if (distance(a, b) > 0) segments.push({ a: vector(a.x, a.y), b: vector(b.x, b.y), shapeIndex, splits: [0, 1] });
      }
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const epsilon = Math.max(extent * 1e-10, maxCoordinate * Number.EPSILON * 64, 1e-10);
  if (segments.length > MAX_INPUT_SEGMENTS) unsupported(`the source has more than ${MAX_INPUT_SEGMENTS} straight segments.`);
  let splitPointCount = segments.length * 2;
  for (let first = 0; first < segments.length; first += 1) {
    for (let second = first + 1; second < segments.length; second += 1) {
      const before = segments[first].splits.length + segments[second].splits.length;
      splitAtIntersection(segments[first], segments[second], epsilon);
      splitPointCount += segments[first].splits.length + segments[second].splits.length - before;
      if (splitPointCount > MAX_SPLIT_POINTS) unsupported(`the source exceeds the ${MAX_SPLIT_POINTS}-intersection-point complexity limit.`);
    }
  }

  const directed = new Map();
  const outputScale = extent;
  for (const segment of segments) {
    segment.splits.sort((a, b) => a - b);
    const unique = segment.splits.filter((value, index, list) => !index || Math.abs(value - list[index - 1]) > epsilon / Math.max(distance(segment.a, segment.b), epsilon));
    for (let index = 1; index < unique.length; index += 1) {
      const start = add(segment.a, scale(subtract(segment.b, segment.a), unique[index - 1]));
      const end = add(segment.a, scale(subtract(segment.b, segment.a), unique[index]));
      const length = distance(start, end);
      if (length <= epsilon * 2) continue;
      const midpoint = scale(add(start, end), .5);
      const offset = Math.max(epsilon * 3, Math.min(length * 1e-7, outputScale * 1e-8));
      const normal = vector(-(end.y - start.y) / length * offset, (end.x - start.x) / length * offset);
      const onLeft = combineMembership(shapes, add(midpoint, normal), operation);
      const onRight = combineMembership(shapes, subtract(midpoint, normal), operation);
      if (onLeft === onRight) continue;
      const a = onLeft ? start : end;
      const b = onLeft ? end : start;
      const key = `${pointKey(a, epsilon)}>${pointKey(b, epsilon)}`;
      if (!directed.has(key)) directed.set(key, { a, b, used: false, key });
    }
  }

  const edges = [...directed.values()];
  if (!edges.length) return [];
  const outgoing = new Map();
  for (const edge of edges) {
    const key = pointKey(edge.a, epsilon);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(edge);
  }
  const contours = [];
  for (const initial of edges) {
    if (initial.used) continue;
    initial.used = true;
    const contour = [initial.a];
    let current = initial;
    let closed = false;
    for (let steps = 0; steps <= edges.length; steps += 1) {
      const endKey = pointKey(current.b, epsilon);
      if (endKey === pointKey(initial.a, epsilon)) { closed = true; break; }
      const candidates = (outgoing.get(endKey) || []).filter(edge => !edge.used);
      if (!candidates.length) break;
      const reverseAngle = Math.atan2(current.a.y - current.b.y, current.a.x - current.b.x);
      candidates.sort((left, right) => {
        const leftAngle = Math.atan2(left.b.y - left.a.y, left.b.x - left.a.x);
        const rightAngle = Math.atan2(right.b.y - right.a.y, right.b.x - right.a.x);
        return turnClockwise(reverseAngle, leftAngle) - turnClockwise(reverseAngle, rightAngle) || left.key.localeCompare(right.key);
      });
      const next = candidates[0];
      next.used = true;
      contour.push(current.b);
      current = next;
    }
    if (!closed) unsupported('the polygon boundaries have a touching or degenerate junction that cannot be represented as a closed editable path.');
    const canonical = canonicalizeContour(contour, epsilon);
    if (canonical) contours.push(canonical);
  }
  if (edges.some(edge => !edge.used)) unsupported('the polygon boundaries could not be assembled into closed contours.');
  contours.sort((left, right) => left[0].x - right[0].x || left[0].y - right[0].y || Math.abs(area(right)) - Math.abs(area(left)));
  return contours;
}

function cubic(p0, p1, p2, p3) { return { p0, p1, p2, p3 }; }
function cubicPoint(curve, t) {
  const u = 1 - t;
  return add(add(scale(curve.p0, u ** 3), scale(curve.p1, 3 * u * u * t)),
    add(scale(curve.p2, 3 * u * t * t), scale(curve.p3, t ** 3)));
}
function cubicDerivative(curve, t) {
  const u = 1 - t;
  return add(add(scale(subtract(curve.p1, curve.p0), 3 * u * u), scale(subtract(curve.p2, curve.p1), 6 * u * t)),
    scale(subtract(curve.p3, curve.p2), 3 * t * t));
}
function splitCubic(curve, t = .5) {
  const p01 = add(scale(curve.p0, 1 - t), scale(curve.p1, t));
  const p12 = add(scale(curve.p1, 1 - t), scale(curve.p2, t));
  const p23 = add(scale(curve.p2, 1 - t), scale(curve.p3, t));
  const p012 = add(scale(p01, 1 - t), scale(p12, t));
  const p123 = add(scale(p12, 1 - t), scale(p23, t));
  const point = add(scale(p012, 1 - t), scale(p123, t));
  return [cubic(curve.p0, p01, p012, point), cubic(point, p123, p23, curve.p3)];
}
function cubicSubcurve(curve, start, end) {
  if (start <= 0 && end >= 1) return curve;
  const left = end >= 1 ? curve : splitCubic(curve, end)[0];
  if (start <= 0) return left;
  return splitCubic(left, start / end)[1];
}
function cubicBounds(curve) {
  const points = [curve.p0, curve.p1, curve.p2, curve.p3];
  return {
    left: Math.min(...points.map(point => point.x)), right: Math.max(...points.map(point => point.x)),
    top: Math.min(...points.map(point => point.y)), bottom: Math.max(...points.map(point => point.y))
  };
}
function cubicTightBounds(curve) {
  const extrema = axis => {
    const p0 = curve.p0[axis]; const p1 = curve.p1[axis];
    const p2 = curve.p2[axis]; const p3 = curve.p3[axis];
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 3 * p0 - 6 * p1 + 3 * p2;
    const c = -3 * p0 + 3 * p1;
    const cuts = [0, 1, ...rootsOfQuadratic(3 * a, 2 * b, c).filter(value => value > 0 && value < 1)];
    return cuts.map(value => cubicPoint(curve, value)[axis]);
  };
  const xs = extrema('x'); const ys = extrema('y');
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}
function cubicBoundsOverlap(a, b, epsilon) {
  return a.left <= b.right + epsilon && b.left <= a.right + epsilon
    && a.top <= b.bottom + epsilon && b.top <= a.bottom + epsilon;
}
function cubicSize(bounds) { return Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top); }
function cubicFlatEnough(curve, epsilon) {
  const chord = subtract(curve.p3, curve.p0);
  const length = Math.hypot(chord.x, chord.y);
  if (length <= epsilon) return Math.max(distance(curve.p0, curve.p1), distance(curve.p0, curve.p2), distance(curve.p0, curve.p3)) <= epsilon;
  return Math.max(Math.abs(cross(chord, subtract(curve.p1, curve.p0))), Math.abs(cross(chord, subtract(curve.p2, curve.p0)))) <= epsilon * length;
}
function cubicFlatnessDistance(curve) {
  const chord = subtract(curve.p3, curve.p0);
  const length = Math.hypot(chord.x, chord.y);
  if (length <= 1e-20) return Math.max(distance(curve.p0, curve.p1), distance(curve.p0, curve.p2));
  return Math.max(Math.abs(cross(chord, subtract(curve.p1, curve.p0))), Math.abs(cross(chord, subtract(curve.p2, curve.p0)))) / length;
}
function pointSegmentDistance(point, start, end) {
  const delta = subtract(end, start);
  const lengthSquared = dot(delta, delta);
  if (!lengthSquared) return distance(point, start);
  const amount = Math.max(0, Math.min(1, dot(subtract(point, start), delta) / lengthSquared));
  return distance(point, add(start, scale(delta, amount)));
}
function segmentDistance(first, second) {
  const a = { a: first.p0, b: first.p3, splits: [] };
  const b = { a: second.p0, b: second.p3, splits: [] };
  splitAtIntersection(a, b, 1e-14);
  if (a.splits.length || b.splits.length) return 0;
  return Math.min(pointSegmentDistance(first.p0, second.p0, second.p3),
    pointSegmentDistance(first.p3, second.p0, second.p3),
    pointSegmentDistance(second.p0, first.p0, first.p3),
    pointSegmentDistance(second.p3, first.p0, first.p3));
}
function curveIsLine(curve, epsilon) {
  return cubicFlatEnough(curve, epsilon)
    && Math.abs(cross(subtract(curve.p3, curve.p0), subtract(curve.p1, curve.p0))) <= epsilon
    && Math.abs(cross(subtract(curve.p3, curve.p0), subtract(curve.p2, curve.p0))) <= epsilon;
}
function cubicLinearlyParameterized(curve, epsilon) {
  const delta = subtract(curve.p3, curve.p0);
  const expected1 = add(curve.p0, scale(delta, 1 / 3));
  const expected2 = add(curve.p0, scale(delta, 2 / 3));
  return distance(curve.p1, expected1) <= epsilon && distance(curve.p2, expected2) <= epsilon;
}
function nearlySamePoint(a, b, epsilon) { return distance(a, b) <= epsilon; }
function cubicTangentAngle(curve, atEnd = false) {
  const derivative = cubicDerivative(curve, atEnd ? 1 : 0);
  const usable = Math.hypot(derivative.x, derivative.y) > 1e-14;
  const fallback = atEnd ? subtract(curve.p3, curve.p0) : subtract(curve.p3, curve.p0);
  return Math.atan2(usable ? derivative.y : fallback.y, usable ? derivative.x : fallback.x);
}
function reverseCubic(curve) { return cubic(curve.p3, curve.p2, curve.p1, curve.p0); }

function rootsOfQuadratic(a, b, c) {
  if (Math.abs(a) < 1e-18) return Math.abs(b) < 1e-18 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  const q = -.5 * (b + Math.sign(b || 1) * root);
  if (q === 0) return [-b / (2 * a)];
  return [q / a, c / q];
}

function pointInCurveContours(point, contours, fillRule = 'evenodd') {
  let crossings = 0;
  let winding = 0;
  for (const contour of contours) for (const curve of contour) {
    const p0 = curve.p0.y; const p1 = curve.p1.y; const p2 = curve.p2.y; const p3 = curve.p3.y;
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 3 * p0 - 6 * p1 + 3 * p2;
    const c = -3 * p0 + 3 * p1;
    const cuts = [0, ...rootsOfQuadratic(3 * a, 2 * b, c).filter(t => t > 1e-12 && t < 1 - 1e-12), 1].sort((x, y) => x - y);
    for (let index = 1; index < cuts.length; index += 1) {
      let low = cuts[index - 1]; let high = cuts[index];
      let lowY = cubicPoint(curve, low).y; let highY = cubicPoint(curve, high).y;
      const upward = lowY <= point.y && point.y < highY;
      const downward = highY <= point.y && point.y < lowY;
      if (!upward && !downward) continue;
      const increasing = highY > lowY;
      for (let iteration = 0; iteration < 48; iteration += 1) {
        const middle = (low + high) / 2;
        const middleY = cubicPoint(curve, middle).y;
        if ((middleY < point.y) === increasing) low = middle;
        else high = middle;
      }
      const x = cubicPoint(curve, (low + high) / 2).x;
      if (x > point.x) {
        crossings += 1;
        winding += upward ? 1 : -1;
      }
    }
  }
  return fillRule === 'nonzero' ? winding !== 0 : crossings % 2 === 1;
}

function combineCurveMembership(shapes, point, operation) {
  let result = pointInCurveContours(point, shapes[0].contours, shapes[0].fillRule);
  for (let index = 1; index < shapes.length; index += 1) {
    const inside = pointInCurveContours(point, shapes[index].contours, shapes[index].fillRule);
    if (operation === 'union') result ||= inside;
    else if (operation === 'subtract') result &&= !inside;
    else if (operation === 'intersect') result &&= inside;
    else result = result !== inside;
  }
  return result;
}

function classifyCurveSides(shapes, midpoint, normal, operation, initialOffset, minimumOffset, insidePredicate = null) {
  let previous = null;
  let stableSteps = 0;
  const contains = insidePredicate || (point => combineCurveMembership(shapes, point, operation));
  for (let offset = initialOffset; offset >= minimumOffset; offset /= 2) {
    const pair = [
      contains(add(midpoint, scale(normal, offset))),
      contains(subtract(midpoint, scale(normal, offset)))
    ];
    if (previous && pair[0] === previous[0] && pair[1] === previous[1]) stableSteps += 1;
    else stableSteps = 0;
    if (stableSteps >= 2) return pair;
    previous = pair;
  }
  unsupported('a Bézier boundary is too close to another edge to classify its inside and outside reliably.');
}

function refineCubicIntersection(first, second, firstRange, secondRange, tolerance) {
  let t = (firstRange[0] + firstRange[1]) / 2;
  let u = (secondRange[0] + secondRange[1]) / 2;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const p = cubicPoint(first, t); const q = cubicPoint(second, u); const difference = subtract(p, q);
    if (Math.hypot(difference.x, difference.y) <= tolerance) return { t, u, point: scale(add(p, q), .5) };
    const dp = cubicDerivative(first, t); const dq = cubicDerivative(second, u);
    const determinant = cross(dp, dq);
    const derivativeProduct = Math.hypot(dp.x, dp.y) * Math.hypot(dq.x, dq.y);
    if (derivativeProduct === 0 || Math.abs(determinant) <= derivativeProduct * 1e-11) return null;
    const dt = -cross(difference, dq) / determinant;
    const du = cross(dp, difference) / determinant;
    const nextT = t + dt; const nextU = u + du;
    if (nextT < firstRange[0] - 1e-8 || nextT > firstRange[1] + 1e-8
      || nextU < secondRange[0] - 1e-8 || nextU > secondRange[1] + 1e-8) return null;
    t = Math.max(firstRange[0], Math.min(firstRange[1], nextT));
    u = Math.max(secondRange[0], Math.min(secondRange[1], nextU));
  }
  const difference = subtract(cubicPoint(first, t), cubicPoint(second, u));
  return Math.hypot(difference.x, difference.y) <= tolerance ? { t, u, point: scale(add(cubicPoint(first, t), cubicPoint(second, u)), .5) } : null;
}

function addCurveSplit(segment, value) {
  if (value >= -1e-10 && value <= 1 + 1e-10) segment.splits.push(Math.max(0, Math.min(1, value)));
}

function findCubicIntersections(first, second, epsilon, intersectionTolerance, budget) {
  const firstBounds = cubicBounds(first.curve); const secondBounds = cubicBounds(second.curve);
  if (!cubicBoundsOverlap(firstBounds, secondBounds, epsilon)) return [];
  const endpoints = [];
  for (const [t, p] of [[0, first.curve.p0], [1, first.curve.p3]]) {
    for (const [u, q] of [[0, second.curve.p0], [1, second.curve.p3]]) {
      if (nearlySamePoint(p, q, epsilon * 8)) endpoints.push({ t, u, point: scale(add(p, q), .5) });
    }
  }
  const bothLines = curveIsLine(first.curve, epsilon) && curveIsLine(second.curve, epsilon);
  if (bothLines) {
    if (!cubicLinearlyParameterized(first.curve, epsilon * 8) || !cubicLinearlyParameterized(second.curve, epsilon * 8)) {
      unsupported('overlapping collinear Bézier segments with non-linear parameterization cannot be split without changing their geometry.');
    }
    const lineA = { a: first.curve.p0, b: first.curve.p3, splits: [] };
    const lineB = { a: second.curve.p0, b: second.curve.p3, splits: [] };
    splitAtIntersection(lineA, lineB, epsilon);
    const intersections = [];
    for (const t of lineA.splits) for (const u of lineB.splits) {
      const p = cubicPoint(first.curve, t); const q = cubicPoint(second.curve, u);
      if (Math.hypot(p.x - q.x, p.y - q.y) <= epsilon * 8) intersections.push({ t, u, point: scale(add(p, q), .5) });
    }
    for (const endpoint of endpoints) if (!intersections.some(item => Math.abs(item.t - endpoint.t) < 1e-9 && Math.abs(item.u - endpoint.u) < 1e-9)) intersections.push(endpoint);
    return intersections;
  }
  // Coincident/reversed cubics have infinitely many intersections. The current
  // arrangement representation cannot preserve that topology, so fail closed.
  const controlSets = [
    [first.curve.p0, first.curve.p1, first.curve.p2, first.curve.p3],
    [second.curve.p0, second.curve.p1, second.curve.p2, second.curve.p3],
    [second.curve.p3, second.curve.p2, second.curve.p1, second.curve.p0]
  ];
  if ([1, 2].some(index => controlSets[0].every((point, pointIndex) => distance(point, controlSets[index][pointIndex]) <= epsilon * 8))) {
    unsupported('coincident Bézier segments have ambiguous boundary ownership.');
  }

  const stack = [{ curveA: first.curve, curveB: second.curve, t0: 0, t1: 1, u0: 0, u1: 1, depth: 0 }];
  const intersections = [...endpoints];
  while (stack.length) {
    if (++budget.cells > MAX_CURVE_INTERSECTION_CELLS) unsupported(`the source exceeds the ${MAX_CURVE_INTERSECTION_CELLS}-cell Bézier intersection limit.`);
    const item = stack.pop();
    const boundsA = cubicBounds(item.curveA); const boundsB = cubicBounds(item.curveB);
    if (!cubicBoundsOverlap(boundsA, boundsB, epsilon)) continue;
    const sizeA = cubicSize(boundsA); const sizeB = cubicSize(boundsB);
    if (Math.max(sizeA, sizeB) <= intersectionTolerance * 2) {
      const root = refineCubicIntersection(first.curve, second.curve,
        [item.t0, item.t1], [item.u0, item.u1], epsilon * .1);
      if (root) {
        const isEndpoint = endpoints.some(endpoint => Math.abs(root.t - endpoint.t) <= 1e-7 && Math.abs(root.u - endpoint.u) <= 1e-7);
        if (!isEndpoint) {
          const tangentA = cubicDerivative(first.curve, root.t); const tangentB = cubicDerivative(second.curve, root.u);
          const product = Math.hypot(tangentA.x, tangentA.y) * Math.hypot(tangentB.x, tangentB.y);
          if (!product || Math.abs(cross(tangentA, tangentB)) <= product * 1e-9) unsupported('a Bézier intersection is tangent or numerically unstable.');
          if (!intersections.some(other => Math.abs(other.t - root.t) <= 1e-7 && Math.abs(other.u - root.u) <= 1e-7)) intersections.push(root);
        }
      } else {
        const nearSharedEndpoint = endpoints.some(endpoint =>
          Math.abs((item.t0 + item.t1) / 2 - endpoint.t) <= 1e-5
          && Math.abs((item.u0 + item.u1) / 2 - endpoint.u) <= 1e-5);
        if (!nearSharedEndpoint) {
          const flatA = cubicFlatnessDistance(item.curveA); const flatB = cubicFlatnessDistance(item.curveB);
          const chordGap = segmentDistance(item.curveA, item.curveB);
          if (chordGap <= flatA + flatB + epsilon * 2) {
            unsupported('nearby Bézier boundaries could not be separated from an intersection with sufficient precision.');
          }
        }
      }
      continue;
    }
    if (item.depth >= 96) unsupported('a Bézier intersection could not be isolated within the subdivision limit.');
    if (sizeA >= sizeB) {
      const [left, right] = splitCubic(item.curveA);
      const middle = (item.t0 + item.t1) / 2;
      stack.push({ ...item, curveA: right, t0: middle, depth: item.depth + 1 });
      stack.push({ ...item, curveA: left, t1: middle, depth: item.depth + 1 });
    } else {
      const [left, right] = splitCubic(item.curveB);
      const middle = (item.u0 + item.u1) / 2;
      stack.push({ ...item, curveB: right, u0: middle, depth: item.depth + 1 });
      stack.push({ ...item, curveB: left, u1: middle, depth: item.depth + 1 });
    }
  }
  return intersections;
}

function shapesMeetOnlyAtBounds(shapeA, shapeB, tolerance) {
  const overlapX = Math.min(shapeA.right, shapeB.right) - Math.max(shapeA.left, shapeB.left);
  const overlapY = Math.min(shapeA.bottom, shapeB.bottom) - Math.max(shapeA.top, shapeB.top);
  // A cubic curve stays within the convex hull of its control points. If those
  // enclosing boxes have no interior overlap (or meet only within floating-point
  // roundoff), the filled shapes cannot cross with positive area. Keeping their
  // original contours is exact for a tangent union/XOR, an empty intersection,
  // and a subtraction whose operands only touch.
  return (Math.abs(overlapX) <= tolerance && overlapY >= -tolerance)
    || (Math.abs(overlapY) <= tolerance && overlapX >= -tolerance);
}

function curveBoolean(shapes, operation, insidePredicate = null) {
  if (!operations.has(operation) || !Array.isArray(shapes) || !shapes.length
    || shapes.some(shape => !Array.isArray(shape?.contours))) throw new TypeError('Boolean geometry needs one or more cubic contour sets.');
  const segments = [];
  const shapeBounds = shapes.map(() => ({ left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }));
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity; let maxCoordinate = 0;
  for (const [shapeIndex, shape] of shapes.entries()) for (const [contourIndex, contour] of shape.contours.entries()) {
    if (!Array.isArray(contour) || contour.length < 2) unsupported('a Bézier contour is malformed.');
    for (const [segmentIndex, curve] of contour.entries()) {
      const points = [curve.p0, curve.p1, curve.p2, curve.p3];
      if (points.some(point => !finite(point?.x) || !finite(point?.y))) unsupported('a Bézier segment contains non-finite coordinates.');
      for (const point of points) {
        minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
        maxCoordinate = Math.max(maxCoordinate, Math.abs(point.x), Math.abs(point.y));
        const bounds = shapeBounds[shapeIndex];
        bounds.left = Math.min(bounds.left, point.x); bounds.top = Math.min(bounds.top, point.y);
        bounds.right = Math.max(bounds.right, point.x); bounds.bottom = Math.max(bounds.bottom, point.y);
      }
      if (distance(curve.p0, curve.p3) > 0 || distance(curve.p0, curve.p1) > 0 || distance(curve.p0, curve.p2) > 0) {
        segments.push({ curve, shapeIndex, contourIndex, segmentIndex, contourLength: contour.length, splits: [0, 1] });
      }
    }
  }
  if (segments.length > MAX_INPUT_CURVES) unsupported(`the source has more than ${MAX_INPUT_CURVES} Bézier segments.`);
  if (!segments.length) return [];
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const epsilon = Math.max(extent * 1e-10, maxCoordinate * Number.EPSILON * 64, 1e-10);
  const contactTolerance = Math.max(maxCoordinate * Number.EPSILON * 64, 1e-12);
  const intersectionTolerance = Math.max(epsilon * 4, extent * 1e-8);
  const budget = { cells: 0 };
  let splitPointCount = segments.length * 2;
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const first = segments[firstIndex]; const second = segments[secondIndex];
      if (first.shapeIndex !== second.shapeIndex
        && shapesMeetOnlyAtBounds(shapeBounds[first.shapeIndex], shapeBounds[second.shapeIndex], contactTolerance)) continue;
      const boundsA = cubicBounds(first.curve); const boundsB = cubicBounds(second.curve);
      if (!cubicBoundsOverlap(boundsA, boundsB, epsilon)) continue;
      const intersections = findCubicIntersections(first, second, epsilon, intersectionTolerance, budget);
      for (const intersection of intersections) {
        addCurveSplit(first, intersection.t); addCurveSplit(second, intersection.u);
      }
      splitPointCount += intersections.length * 2;
      if (splitPointCount > MAX_SPLIT_POINTS) unsupported(`the source exceeds the ${MAX_SPLIT_POINTS}-intersection-point complexity limit.`);
    }
  }

  const directed = new Map();
  for (const segment of segments) {
    segment.splits.sort((a, b) => a - b);
    const curveLength = Math.max(distance(segment.curve.p0, segment.curve.p3), epsilon);
    const unique = segment.splits.filter((value, index, list) => !index || Math.abs(value - list[index - 1]) > epsilon / curveLength);
    for (let index = 1; index < unique.length; index += 1) {
      const fragment = cubicSubcurve(segment.curve, unique[index - 1], unique[index]);
      const length = distance(fragment.p0, fragment.p3);
      if (length <= epsilon * 2) continue;
      const midpoint = cubicPoint(fragment, .5);
      let tangent = cubicDerivative(fragment, .5);
      let tangentLength = Math.hypot(tangent.x, tangent.y);
      if (!(tangentLength > epsilon)) { tangent = subtract(fragment.p3, fragment.p0); tangentLength = Math.hypot(tangent.x, tangent.y); }
      if (!(tangentLength > epsilon)) unsupported('a split Bézier fragment has a degenerate tangent.');
      const minimumOffset = epsilon * 8;
      const offset = Math.max(minimumOffset * 4, Math.min(length * 1e-7, extent * 1e-8));
      const normal = vector(-tangent.y / tangentLength * offset, tangent.x / tangentLength * offset);
      const [onLeft, onRight] = classifyCurveSides(shapes, midpoint,
        vector(normal.x / offset, normal.y / offset), operation, offset, minimumOffset, insidePredicate);
      if (onLeft === onRight) continue;
      const oriented = onLeft ? fragment : reverseCubic(fragment);
      const key = `${pointKey(oriented.p0, epsilon * 8)}>${pointKey(oriented.p3, epsilon * 8)}`;
      if (!directed.has(key)) directed.set(key, { curve: oriented, key, used: false });
    }
  }

  const edges = [...directed.values()];
  if (!edges.length) return [];
  const outgoing = new Map();
  for (const edge of edges) {
    const key = pointKey(edge.curve.p0, epsilon * 8);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(edge);
  }
  const contours = [];
  for (const initial of edges) {
    if (initial.used) continue;
    initial.used = true;
    const contour = [initial.curve];
    let current = initial;
    let closed = false;
    for (let steps = 0; steps <= edges.length; steps += 1) {
      const endKey = pointKey(current.curve.p3, epsilon * 8);
      if (endKey === pointKey(initial.curve.p0, epsilon * 8)) { closed = true; break; }
      const candidates = (outgoing.get(endKey) || []).filter(edge => !edge.used);
      if (!candidates.length) break;
      const reverseAngle = cubicTangentAngle(reverseCubic(current.curve));
      candidates.sort((left, right) => turnClockwise(reverseAngle, cubicTangentAngle(left.curve)) - turnClockwise(reverseAngle, cubicTangentAngle(right.curve)) || left.key.localeCompare(right.key));
      current = candidates[0];
      current.used = true;
      contour.push(current.curve);
    }
    if (!closed) unsupported('the Bézier boundaries contain a touching or degenerate junction that cannot be represented as a closed editable path.');
    contours.push(contour);
  }
  if (edges.some(edge => !edge.used)) unsupported('the Bézier boundaries could not be assembled into closed contours.');
  if (contours.reduce((count, contour) => count + contour.length, 0) > 20_000) unsupported('the result exceeds the 20,000-anchor editable path limit.');
  contours.sort((left, right) => left[0].p0.x - right[0].p0.x || left[0].p0.y - right[0].p0.y);
  return contours;
}

/**
 * A bounded geometry failure while resolving a Shape Builder region.
 * Tangencies and other topologies that the local cubic arrangement cannot
 * separate are rejected instead of returning a visually plausible wrong face.
 */
export class ShapeBuilderGeometryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShapeBuilderGeometryError';
    this.code = 'UNSUPPORTED_SHAPE_BUILDER_GEOMETRY';
  }
}

function curveContourArea(contour) {
  // Four-point Gauss–Legendre integration is exact for the degree-five
  // polynomial cross(P(t), P'(t)) of a cubic Bézier segment.
  const nodes = [
    -0.8611363115940526, -0.3399810435848563,
    0.3399810435848563, 0.8611363115940526
  ];
  const weights = [
    0.3478548451374538, 0.6521451548625461,
    0.6521451548625461, 0.3478548451374538
  ];
  let twiceArea = 0;
  for (const curve of contour) {
    for (let index = 0; index < nodes.length; index += 1) {
      const t = (nodes[index] + 1) / 2;
      twiceArea += weights[index] * cross(cubicPoint(curve, t), cubicDerivative(curve, t)) / 2;
    }
  }
  return twiceArea / 2;
}

function curveContourInteriorSample(contour, areaValue, epsilon) {
  const candidates = contour.map(curve => ({
    curve,
    length: Math.max(distance(curve.p0, curve.p3), distance(curve.p0, curve.p1), distance(curve.p0, curve.p2))
  })).sort((left, right) => right.length - left.length);
  for (const { curve, length } of candidates) {
    if (!(length > epsilon * 4)) continue;
    const middle = cubicPoint(curve, .5);
    const tangent = cubicDerivative(curve, .5);
    const tangentLength = Math.hypot(tangent.x, tangent.y);
    if (!(tangentLength > epsilon)) continue;
    const side = areaValue >= 0 ? 1 : -1;
    const offset = Math.max(epsilon * 8, Math.min(length * 1e-6, epsilon * 128));
    const sample = vector(
      middle.x - tangent.y / tangentLength * offset * side,
      middle.y + tangent.x / tangentLength * offset * side
    );
    if (pointInCurveContours(sample, [contour])) return sample;
  }
  throw new ShapeBuilderGeometryError('A region boundary could not be sampled safely. Move or simplify the touching vector edges, then try again.');
}

function curveContourBounds(contour) {
  return contour.reduce((bounds, curve) => {
    for (const point of [curve.p0, curve.p1, curve.p2, curve.p3]) {
      bounds.left = Math.min(bounds.left, point.x);
      bounds.top = Math.min(bounds.top, point.y);
      bounds.right = Math.max(bounds.right, point.x);
      bounds.bottom = Math.max(bounds.bottom, point.y);
    }
    return bounds;
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}

function separateCurveRegionComponent(contours, point) {
  if (!contours.length || !pointInCurveContours(point, contours)) return [];
  const allPoints = contours.flatMap(contour => contour.flatMap(curve => [curve.p0, curve.p1, curve.p2, curve.p3]));
  const coordinateScale = Math.max(1, ...allPoints.map(item => Math.max(Math.abs(item.x), Math.abs(item.y))));
  const bounds = allPoints.reduce((result, item) => ({
    left: Math.min(result.left, item.x), top: Math.min(result.top, item.y),
    right: Math.max(result.right, item.x), bottom: Math.max(result.bottom, item.y)
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const extent = Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top, 1);
  const epsilon = Math.max(extent * 1e-10, coordinateScale * Number.EPSILON * 64, 1e-10);
  const rings = contours.map(curves => {
    const areaValue = curveContourArea(curves);
    if (!Number.isFinite(areaValue) || Math.abs(areaValue) <= epsilon * epsilon) {
      throw new ShapeBuilderGeometryError('The selected vector arrangement contains a zero-area boundary. Simplify the source geometry and try again.');
    }
    return { curves, area: areaValue, magnitude: Math.abs(areaValue), sample: curveContourInteriorSample(curves, areaValue, epsilon), parent: null, depth: 0 };
  });
  for (const ring of rings) {
    const parents = rings.filter(candidate => candidate !== ring
      && candidate.magnitude > ring.magnitude + epsilon * epsilon
      && pointInCurveContours(ring.sample, [candidate.curves]));
    parents.sort((left, right) => left.magnitude - right.magnitude);
    ring.parent = parents[0] || null;
  }
  const depthOf = ring => {
    let depth = 0;
    let current = ring.parent;
    const visited = new Set([ring]);
    while (current) {
      if (visited.has(current)) throw new ShapeBuilderGeometryError('The selected vectors have ambiguous nested boundaries.');
      visited.add(current);
      depth += 1;
      current = current.parent;
    }
    return depth;
  };
  for (const ring of rings) ring.depth = depthOf(ring);
  const outers = rings.filter(ring => ring.depth % 2 === 0 && pointInCurveContours(point, [ring.curves]));
  outers.sort((left, right) => left.magnitude - right.magnitude);
  const selectedOuter = outers[0];
  if (!selectedOuter) return [];
  return [selectedOuter.curves, ...rings
    .filter(ring => ring.parent === selectedOuter && ring.depth === selectedOuter.depth + 1)
    .map(ring => ring.curves)];
}

/**
 * Resolve the exact editable cubic boundary of the arrangement region under
 * a point. `membership` records which source layers cover that region; the
 * renderer/model use it to subtract the extracted face from only its sources.
 */
export function createShapeBuilderSession(nodes) {
  if (!Array.isArray(nodes) || !nodes.length || nodes.length > 128
    || nodes.some(node => !node || !['rectangle', 'ellipse', 'polygon', 'star', 'path', 'network', 'boolean'].includes(node.type))) {
    throw new ShapeBuilderGeometryError('Select one or more closed vector layers before using Shape Builder.');
  }
  const regionCache = new Map();
  try {
    const inputShapes = nodes.map(node => {
      validateSimpleOperand(node, { root: true });
      const contours = shapeCurvesInParent(node);
      if (!contours.length || contours.some(contour => !contour.length)) {
        throw new ShapeBuilderGeometryError(`“${node.name || 'Vector layer'}” has no fillable region.`);
      }
      return { contours, fillRule: node.type === 'path' ? node.fillRule || 'nonzero' : 'nonzero' };
    });
    // Resolve each source's own fill rule before splitting overlaps. This also
    // turns a self-intersecting path into the same filled arrangement that the
    // editor paints, while keeping every surviving cubic fragment editable.
    const shapes = inputShapes.map(shape => ({ ...shape, contours: curveBoolean([shape], 'union') }));
    const regionAtPoint = point => {
      if (!finite(point?.x) || !finite(point?.y)) throw new ShapeBuilderGeometryError('Move over a point inside the selected vector layers.');
      const membership = shapes.map(shape => pointInCurveContours(point, shape.contours, shape.fillRule));
      const seedIndex = membership.findIndex(Boolean);
      if (seedIndex < 0) return null;
      const signature = membership.map(value => value ? '1' : '0').join('');
      let regionContours = regionCache.get(signature);
      if (!regionContours) {
        let region = shapes[seedIndex];
        for (let index = 0; index < shapes.length; index += 1) {
          if (index === seedIndex) continue;
          if (!region.contours.length) break;
          region = {
            contours: curveBoolean([region, shapes[index]], membership[index] ? 'intersect' : 'subtract'),
            fillRule: 'evenodd'
          };
        }
        regionContours = region.contours;
        if (regionCache.size >= 64) regionCache.delete(regionCache.keys().next().value);
        regionCache.set(signature, regionContours);
      }
      const selectedContours = separateCurveRegionComponent(regionContours, point);
      if (!selectedContours.length) return null;
      const faceKey = selectedContours.map(contour => contour.map(curve =>
        `${curve.p0.x.toPrecision(12)},${curve.p0.y.toPrecision(12)}>${curve.p3.x.toPrecision(12)},${curve.p3.y.toPrecision(12)}`
      ).join(';')).join('|');
      return { contours: selectedContours, membership, signature, faceKey };
    };
    const remainderForSource = (sourceIndex, regions) => {
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= shapes.length
        || !Array.isArray(regions) || !regions.length || regions.some(contours => !Array.isArray(contours) || !contours.length)) {
        throw new ShapeBuilderGeometryError('A selected source and at least one region are required to calculate the remaining vectors.');
      }
      try {
        // Reclassify the original arrangement's split edges with an arbitrary
        // region predicate. This preserves every untouched face and avoids
        // intersecting a region contour back against coincident source curves.
        return curveBoolean(shapes, 'union', point => pointInCurveContours(point,
          shapes[sourceIndex].contours, shapes[sourceIndex].fillRule)
          && !regions.some(contours => pointInCurveContours(point, contours, 'evenodd')));
      } catch (error) {
        if (error instanceof ShapeBuilderGeometryError) throw error;
        if (error instanceof BooleanBakeError) {
          const reason = error.message.replace(/^Cannot bake this Boolean group:\s*/, '');
          throw new ShapeBuilderGeometryError(`Shape Builder cannot preserve the remaining faces: ${reason}`);
        }
        throw error;
      }
    };
    const unionRegions = regions => {
      if (!Array.isArray(regions) || !regions.length || regions.some(contours => !Array.isArray(contours) || !contours.length)) {
        throw new ShapeBuilderGeometryError('Select at least one visible vector region.');
      }
      try {
        return curveBoolean(shapes, 'union', point => regions.some(contours => pointInCurveContours(point, contours, 'evenodd')));
      } catch (error) {
        if (error instanceof ShapeBuilderGeometryError) throw error;
        if (error instanceof BooleanBakeError) {
          const reason = error.message.replace(/^Cannot bake this Boolean group:\s*/, '');
          throw new ShapeBuilderGeometryError(`Shape Builder cannot merge these regions: ${reason}`);
        }
        throw error;
      }
    };
    return Object.freeze({
      sourceCount: shapes.length,
      regionAtPoint,
      remainderForSource,
      unionRegions
    });
  } catch (error) {
    if (error instanceof ShapeBuilderGeometryError) throw error;
    if (error instanceof BooleanBakeError) {
      const reason = error.message.replace(/^Cannot bake this Boolean group:\s*/, '');
      throw new ShapeBuilderGeometryError(`Shape Builder cannot resolve this geometry: ${reason}`);
    }
    throw error;
  }
}

/** Resolve one point without retaining an interactive region cache. */
export function shapeBuilderRegionAtPoint(nodes, point) {
  return createShapeBuilderSession(nodes).regionAtPoint(point);
}

/** Merge the selected face boundaries into one exact editable contour set. */
export function unionShapeBuilderRegions(regions) {
  if (!Array.isArray(regions) || !regions.length || regions.some(contours => !Array.isArray(contours) || !contours.length)) {
    throw new ShapeBuilderGeometryError('Select at least one visible vector region.');
  }
  try {
    return curveBoolean(regions.map(contours => ({ contours, fillRule: 'evenodd' })), 'union');
  } catch (error) {
    if (error instanceof BooleanBakeError) {
      throw new ShapeBuilderGeometryError(`Shape Builder cannot merge these regions: ${error.message.replace(/^Cannot bake this Boolean group:\s*/, '')}`);
    }
    throw error;
  }
}

/** Remove a selected arrangement region from one filled vector source. */
export function subtractShapeBuilderRegionsFromNode(node, regionContours) {
  try {
    validateSimpleOperand(node, { root: true });
    const source = { contours: shapeCurvesInParent(node), fillRule: node.type === 'path' ? node.fillRule || 'nonzero' : 'nonzero' };
    const region = { contours: unionShapeBuilderRegions([regionContours]), fillRule: 'evenodd' };
    return curveBoolean([source, region], 'subtract');
  } catch (error) {
    if (error instanceof ShapeBuilderGeometryError) throw error;
    if (error instanceof BooleanBakeError) {
      throw new ShapeBuilderGeometryError(`Shape Builder cannot update “${node?.name || 'Vector layer'}”: ${error.message.replace(/^Cannot bake this Boolean group:\s*/, '')}`);
    }
    throw error;
  }
}

function transformContours(contours, node) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  return contours.map(contour => contour.map(point => rotate(add(point, vector(node.x, node.y)), cx, cy, node.rotation || 0)));
}

function transformCurves(contours, node) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const transform = point => rotate(add(point, vector(node.x, node.y)), cx, cy, node.rotation || 0);
  return contours.map(contour => contour.map(curve => cubic(transform(curve.p0), transform(curve.p1), transform(curve.p2), transform(curve.p3))));
}

function transformCurvesByNodeAffine(contours, node) {
  const affine = node.affineTransform;
  if (!affine) return contours;
  const { a, b, c, d } = affine;
  const transform = point => vector(
    node.x + a * (point.x - node.x) + c * (point.y - node.y),
    node.y + b * (point.x - node.x) + d * (point.y - node.y)
  );
  return contours.map(contour => contour.map(curve => cubic(
    transform(curve.p0), transform(curve.p1), transform(curve.p2), transform(curve.p3)
  )));
}

function linearCurvesFromContours(contours) {
  return contours.map(contour => contour.map((point, index) => {
    const next = contour[(index + 1) % contour.length];
    const delta = subtract(next, point);
    return cubic(point, add(point, scale(delta, 1 / 3)), add(point, scale(delta, 2 / 3)), next);
  }));
}

function roundedRectangleCurves(node) {
  const radii = rectangleCornerRadii(node);
  const { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl } = radii;
  const left = node.x;
  const top = node.y;
  const right = left + node.width;
  const bottom = top + node.height;
  const centerX = left + node.width / 2;
  const centerY = top + node.height / 2;
  const rotation = node.rotation || 0;
  const transform = point => rotation ? rotate(point, centerX, centerY, rotation) : point;
  const contours = [];
  const first = vector(left + tl, top);
  let current = first;
  const lineTo = end => {
    if (distance(current, end) > 0) {
      const start = transform(current);
      const finish = transform(end);
      const delta = subtract(finish, start);
      contours.push(cubic(start, add(start, scale(delta, 1 / 3)), add(start, scale(delta, 2 / 3)), finish));
    }
    current = end;
  };
  // Convert each quadratic corner Q(P0, Q, P2) exactly to cubic controls:
  // C1=P0+2/3(Q-P0), C2=P2+2/3(Q-P2). Applying rotation after conversion
  // preserves each independent renderer radius and its corner geometry.
  const quadraticTo = (control, end, radius) => {
    if (radius > 0) {
      const start = transform(current);
      const quadraticControl = transform(control);
      const finish = transform(end);
      contours.push(cubic(
        start,
        add(start, scale(subtract(quadraticControl, start), 2 / 3)),
        add(finish, scale(subtract(quadraticControl, finish), 2 / 3)),
        finish
      ));
    }
    current = end;
  };

  lineTo(vector(right - tr, top));
  quadraticTo(vector(right, top), vector(right, top + tr), tr);
  lineTo(vector(right, bottom - br));
  quadraticTo(vector(right, bottom), vector(right - br, bottom), br);
  lineTo(vector(left + bl, bottom));
  quadraticTo(vector(left, bottom), vector(left, bottom - bl), bl);
  lineTo(vector(left, top + tl));
  quadraticTo(vector(left, top), first, tl);
  return [contours];
}

function pathCurves(node) {
  return vectorPathContours(node).map(contour => {
    const points = contour.points || [];
    return points.map((point, index) => {
      const next = points[(index + 1) % points.length];
      const start = vector(node.x + Number(point.x) * node.width, node.y + Number(point.y) * node.height);
      const end = vector(node.x + Number(next.x) * node.width, node.y + Number(next.y) * node.height);
      const outgoing = point.out || { x: 0, y: 0 };
      const incoming = next.in || { x: 0, y: 0 };
      const hasControls = !isZeroHandle(outgoing) || !isZeroHandle(incoming);
      const control1 = hasControls
        ? vector(start.x + Number(outgoing.x || 0) * node.width, start.y + Number(outgoing.y || 0) * node.height)
        : add(start, scale(subtract(end, start), 1 / 3));
      const control2 = hasControls
        ? vector(end.x + Number(incoming.x || 0) * node.width, end.y + Number(incoming.y || 0) * node.height)
        : add(start, scale(subtract(end, start), 2 / 3));
      const angle = node.rotation || 0;
      if (!angle) return cubic(start, control1, control2, end);
      const cx = node.x + node.width / 2; const cy = node.y + node.height / 2;
      return cubic(rotate(start, cx, cy, angle), rotate(control1, cx, cy, angle), rotate(control2, cx, cy, angle), rotate(end, cx, cy, angle));
    });
  });
}

function networkFaceCurves(node, face, edgesByPair) {
  const ids = face.vertexIds;
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const transform = point => rotate(point, cx, cy, node.rotation || 0);
  const curves = [];
  for (let index = 0; index < ids.length; index += 1) {
    const fromId = ids[index];
    const toId = ids[(index + 1) % ids.length];
    const edge = vectorNetworkEdgeForPair(edgesByPair, fromId, toId);
    const points = edge && vectorNetworkEdgePoints(node, edge.id, { x: node.x, y: node.y });
    if (!points) unsupported(`“${node.name || node.type}” has a face boundary that cannot be read as a closed cubic path.`);
    const reversed = edge.from !== fromId;
    const start = points[reversed ? 3 : 0];
    const end = points[reversed ? 0 : 3];
    let control1 = points[reversed ? 2 : 1];
    let control2 = points[reversed ? 1 : 2];
    if (!edge.control1 && !edge.control2) {
      const delta = subtract(end, start);
      control1 = add(start, scale(delta, 1 / 3));
      control2 = add(start, scale(delta, 2 / 3));
    }
    curves.push(cubic(transform(start), transform(control1), transform(control2), transform(end)));
  }
  return curves;
}

function networkCurves(node) {
  const edgesByPair = vectorNetworkEdgePairIndex(node);
  const faces = node.faces.map(face => networkFaceCurves(node, face, edgesByPair));
  if (faces.length === 1) return faces;
  // The live Boolean mask paints each network face independently. Union these
  // closed regions first so different contour directions remain additive.
  return curveBoolean(faces.map(contour => ({ contours: [contour], fillRule: 'nonzero' })), 'union');
}

// Editable paths store cubic handles rather than rational conic segments, so
// an ellipse cannot be represented exactly in the native path model. Twelve
// 30-degree cubic arcs, inset by 5e-7 of each radius, keep the approximation
// inside the source ellipse and below 1e-6 times its longer semiaxis in
// Hausdorff distance. The small inset also prevents rotated ellipses from
// protruding beyond the source visual bounds and creating a spurious clip.
function ellipseCurves(node) {
  const segments = 12;
  const inset = 1 - 5e-7;
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const rx = node.width / 2 * inset;
  const ry = node.height / 2 * inset;
  const delta = TAU / segments;
  const handle = 4 / 3 * Math.tan(delta / 4);
  const angle = node.rotation || 0;
  const transform = point => angle ? rotate(point, cx, cy, angle) : point;
  const curves = [];
  for (let index = 0; index < segments; index += 1) {
    const startAngle = index * delta;
    const endAngle = (index + 1) * delta;
    const start = vector(cx + rx * Math.cos(startAngle), cy + ry * Math.sin(startAngle));
    const end = vector(cx + rx * Math.cos(endAngle), cy + ry * Math.sin(endAngle));
    const startTangent = vector(-rx * Math.sin(startAngle), ry * Math.cos(startAngle));
    const endTangent = vector(-rx * Math.sin(endAngle), ry * Math.cos(endAngle));
    curves.push(cubic(
      transform(start),
      transform(add(start, scale(startTangent, handle))),
      transform(subtract(end, scale(endTangent, handle))),
      transform(end)
    ));
  }
  return [curves];
}

function primitiveCurves(node) {
  if (node.type === 'path') return pathCurves(node);
  if (node.type === 'ellipse') return ellipseCurves(node);
  if (node.type === 'network') return networkCurves(node);
  if (node.type === 'rectangle') {
    const radii = rectangleCornerRadii(node);
    if (cornerRadiusKeys.some(key => radii[key] > 0)) return roundedRectangleCurves(node);
  }
  return linearCurvesFromContours(primitiveContours(node) || []);
}

function transformCurveSet(curves, sourceTransform) {
  return curves.map(contour => contour.map(curve => {
    const map = point => vector((point.x - sourceTransform.left) * sourceTransform.scaleX,
      (point.y - sourceTransform.top) * sourceTransform.scaleY);
    return cubic(map(curve.p0), map(curve.p1), map(curve.p2), map(curve.p3));
  }));
}

function booleanContentCurves(node) {
  const sourceTransform = booleanSourceTransform(node.children, node.width, node.height);
  const shapes = node.children.map(child => ({
    contours: transformCurveSet(shapeCurvesInParent(child), sourceTransform),
    fillRule: child.type === 'path' ? child.fillRule || 'nonzero' : 'nonzero'
  }));
  const result = curveBoolean(shapes, node.operation);
  const epsilon = Math.max(node.width, node.height, 1) * 1e-10;
  const withinGroupBounds = result.every(contour => contour.every(curve => {
    const bounds = cubicTightBounds(curve);
    return bounds.left >= -epsilon && bounds.top >= -epsilon
      && bounds.right <= node.width + epsilon && bounds.bottom <= node.height + epsilon;
  }));
  // Source visual bounds already match the Boolean group's clip in ordinary
  // cases. Avoid introducing artificial tangent intersections at those exact
  // bounds; run a second Boolean clip only when a control hull may exceed them.
  if (withinGroupBounds) return result;
  const clip = linearCurvesFromContours([[
    vector(0, 0), vector(node.width, 0), vector(node.width, node.height), vector(0, node.height)
  ]]);
  return curveBoolean([{ contours: result }, { contours: clip }], 'intersect');
}

function shapeCurvesInParent(node) {
  const contours = node.type === 'boolean'
    ? transformCurves(booleanContentCurves(node), node)
    : primitiveCurves(node);
  return transformCurvesByNodeAffine(contours, node);
}

function containsCurvedPath(node) {
  if (node.type === 'ellipse') return true;
  if (node.type === 'network') return true;
  if (node.type === 'rectangle') {
    if (cornerRadiusKeys.some(key => rectangleCornerRadii(node)[key] > 0)) return true;
  }
  if (node.type === 'path' && vectorPathContours(node).some(contour => contour.points.some(point =>
    !isZeroHandle(point.in) || !isZeroHandle(point.out)))) return true;
  return (node.children || []).some(containsCurvedPath);
}

function visualBounds(node) {
  if (node.affineTransform) {
    const { a, b, c, d } = node.affineTransform;
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const angle = node.rotation || 0;
    const corners = [
      vector(node.x, node.y), vector(node.x + node.width, node.y),
      vector(node.x + node.width, node.y + node.height), vector(node.x, node.y + node.height)
    ].map(point => rotate(vector(
      node.x + a * (point.x - node.x) + c * (point.y - node.y),
      node.y + b * (point.x - node.x) + d * (point.y - node.y)
    ), cx, cy, angle));
    return corners.reduce((bounds, point) => ({
      left: Math.min(bounds.left, point.x), top: Math.min(bounds.top, point.y),
      right: Math.max(bounds.right, point.x), bottom: Math.max(bounds.bottom, point.y)
    }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  }
  const angle = (node.rotation || 0) * Math.PI / 180;
  const extentX = Math.abs(node.width * Math.cos(angle)) / 2 + Math.abs(node.height * Math.sin(angle)) / 2;
  const extentY = Math.abs(node.width * Math.sin(angle)) / 2 + Math.abs(node.height * Math.cos(angle)) / 2;
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  return { left: centerX - extentX, top: centerY - extentY, right: centerX + extentX, bottom: centerY + extentY };
}

/** Shared source-bounds transform used by Boolean rendering, separation, and baking. */
export function booleanSourceTransform(children, width, height) {
  if (!Array.isArray(children) || !children.length || !finite(width) || !finite(height)) {
    return { left: 0, top: 0, scaleX: 1, scaleY: 1 };
  }
  const bounds = children.map(visualBounds);
  const left = Math.min(...bounds.map(item => item.left));
  const top = Math.min(...bounds.map(item => item.top));
  const right = Math.max(...bounds.map(item => item.right));
  const bottom = Math.max(...bounds.map(item => item.bottom));
  return {
    left,
    top,
    // Boolean group bounds have a one-pixel minimum. Keep sub-unit source
    // geometry unchanged at that minimum, matching Separate's transform.
    scaleX: width / Math.max(1, right - left),
    scaleY: height / Math.max(1, bottom - top)
  };
}

function booleanContentContours(node) {
  const childContours = node.children.map(child => shapeContoursInParent(child));
  const sourceTransform = booleanSourceTransform(node.children, node.width, node.height);
  const shapes = node.children.map((child, index) => ({
    // Separate Boolean uses the same source visual bounds to restore children
    // after resizing. Apply that affine map before clipping to the group box.
    contours: childContours[index].map(contour => contour.map(point => vector(
      (point.x - sourceTransform.left) * sourceTransform.scaleX,
      (point.y - sourceTransform.top) * sourceTransform.scaleY
    ))),
    fillRule: child.type === 'path' ? child.fillRule || 'nonzero' : 'nonzero'
  }));
  const result = polygonBoolean(shapes, node.operation);
  const clip = [[vector(0, 0), vector(node.width, 0), vector(node.width, node.height), vector(0, node.height)]];
  return polygonBoolean([{ contours: result }, { contours: clip }], 'intersect');
}

function shapeContoursInParent(node) {
  if (node.type === 'boolean') return transformContours(booleanContentContours(node), node);
  return primitiveContours(node);
}

/** Validate supported source semantics and return the Boolean result in node-local coordinates. */
export function flattenBooleanContours(node) {
  if (node?.type !== 'boolean') throw new BooleanBakeError('Select a Boolean group to bake.');
  validateSimpleOperand(node, { root: true });
  if (containsCurvedPath(node)) unsupported('curved boundaries require the cubic path contour interface.');
  const contours = booleanContentContours(node);
  if (contours.reduce((count, contour) => count + contour.length, 0) > 20_000) unsupported('the result exceeds the 20,000-point editable path limit.');
  return contours.map(contour => contour.map(point => ({ x: Object.is(point.x, -0) ? 0 : point.x, y: Object.is(point.y, -0) ? 0 : point.y })));
}

/** Return the exact cubic boundary fragments for a Boolean result in local coordinates. */
export function flattenBooleanPathContours(node) {
  if (node?.type !== 'boolean') throw new BooleanBakeError('Select a Boolean group to bake.');
  validateSimpleOperand(node, { root: true });
  if (!containsCurvedPath(node)) {
    const contours = booleanContentContours(node);
    return linearCurvesFromContours(contours);
  }
  return booleanContentCurves(node);
}

/** Convert local polygon contours to the editable normalized points used by a path layer. */
export function normalizedPathGeometryFromContours(contours, width, height) {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) throw new BooleanBakeError('The Boolean group needs positive dimensions before it can be baked.');
  const normalize = point => ({
    x: Object.is(point.x / width, -0) ? 0 : point.x / width,
    y: Object.is(point.y / height, -0) ? 0 : point.y / height,
    in: { x: 0, y: 0 },
    out: { x: 0, y: 0 }
  });
  const first = contours[0] || [];
  return {
    closed: true,
    points: first.map(normalize),
    ...(contours.length > 1 ? { subpaths: contours.slice(1).map(contour => ({ closed: true, points: contour.map(normalize) })) } : {}),
    fillRule: 'evenodd'
  };
}

/** Convert exact cubic Boolean contours to the editable normalized native path format. */
export function normalizedPathGeometryFromCurveContours(contours, width, height) {
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) throw new BooleanBakeError('The Boolean group needs positive dimensions before it can be baked.');
  const normalize = (point, anchor) => ({
    x: Object.is(point.x / width, -0) ? 0 : point.x / width,
    y: Object.is(point.y / height, -0) ? 0 : point.y / height,
    in: { x: (point.x - anchor.x) / width, y: (point.y - anchor.y) / height },
    out: { x: 0, y: 0 }
  });
  const convert = contour => {
    if (!contour.length) return [];
    return contour.map((curve, index) => {
      const previous = contour[(index - 1 + contour.length) % contour.length];
      const anchor = curve.p0;
      const straightOut = cubicLinearlyParameterized(curve, Math.max(width, height) * 1e-10);
      const straightIn = cubicLinearlyParameterized(previous, Math.max(width, height) * 1e-10);
      const point = normalize(anchor, anchor);
      point.in = straightIn ? { x: 0, y: 0 } : {
        x: (previous.p2.x - anchor.x) / width,
        y: (previous.p2.y - anchor.y) / height
      };
      point.out = straightOut ? { x: 0, y: 0 } : {
        x: (curve.p1.x - anchor.x) / width,
        y: (curve.p1.y - anchor.y) / height
      };
      return point;
    });
  };
  const first = convert(contours[0] || []);
  return {
    closed: true,
    points: first,
    ...(contours.length > 1 ? { subpaths: contours.slice(1).map(contour => ({ closed: true, points: convert(contour) })) } : {}),
    fillRule: 'evenodd'
  };
}

/** Compute tight parent-local bounds and editable path data for Shape Builder curves. */
export function shapeBuilderPathGeometryFromCurves(contours) {
  if (!Array.isArray(contours) || !contours.length || contours.some(contour => !Array.isArray(contour) || !contour.length)) {
    throw new ShapeBuilderGeometryError('A Shape Builder result needs at least one closed contour.');
  }
  const boxes = contours.flatMap(contour => contour.map(cubicTightBounds));
  const left = Math.min(...boxes.map(bounds => bounds.left));
  const top = Math.min(...boxes.map(bounds => bounds.top));
  const right = Math.max(...boxes.map(bounds => bounds.right));
  const bottom = Math.max(...boxes.map(bounds => bounds.bottom));
  const width = right - left;
  const height = bottom - top;
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new ShapeBuilderGeometryError('The selected region has no positive editable bounds.');
  }
  const local = contours.map(contour => contour.map(curve => {
    const translate = point => vector(point.x - left, point.y - top);
    return cubic(translate(curve.p0), translate(curve.p1), translate(curve.p2), translate(curve.p3));
  }));
  return { x: left, y: top, width, height, ...normalizedPathGeometryFromCurveContours(local, width, height) };
}
