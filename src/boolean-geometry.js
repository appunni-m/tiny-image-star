import { clampCornerRadii, cornerRadiusKeys } from './corner-radii.js';
import { vectorPathContours } from './vector-path.js';

const operations = new Set(['union', 'subtract', 'intersect', 'exclude']);
const MAX_INPUT_SEGMENTS = 512;
const MAX_SPLIT_POINTS = 40_000;
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
  if (!node || !['rectangle', 'polygon', 'star', 'path', 'boolean'].includes(node.type)) {
    unsupported(`“${node?.name || node?.type || 'Unknown layer'}” is not a supported polygonal shape. Ellipses and vector networks are not supported by this exact bake yet.`);
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
    const radiusInput = node.cornerRadii ?? node.radius ?? 0;
    const radiusValues = typeof radiusInput === 'number'
      ? Object.fromEntries(cornerRadiusKeys.map(key => [key, radiusInput]))
      : radiusInput;
    const radii = clampCornerRadii(node.width, node.height, radiusValues);
    if (cornerRadiusKeys.some(key => radii[key] !== 0)) unsupported(`“${node.name || node.type}” has rounded corners; only square-corner rectangles can be baked exactly.`);
    return;
  }
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
    if (contours.some(contour => contour.points.some(point => !finite(point.x) || !finite(point.y)
      || !isZeroHandle(point.in) || !isZeroHandle(point.out)))) {
      unsupported(`“${node.name || node.type}” contains Bézier curves; only straight vector segments can be baked exactly.`);
    }
    return;
  }
  if (node.type === 'boolean') {
    if (!operations.has(node.operation) || !Array.isArray(node.children) || node.children.length < 2) {
      unsupported(`“${node.name || node.type}” has an invalid Boolean operation or no source shapes.`);
    }
    for (const child of node.children) validateSimpleOperand(child);
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

function transformContours(contours, node) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  return contours.map(contour => contour.map(point => rotate(add(point, vector(node.x, node.y)), cx, cy, node.rotation || 0)));
}

function visualBounds(node) {
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
  const contours = booleanContentContours(node);
  if (contours.reduce((count, contour) => count + contour.length, 0) > 20_000) unsupported('the result exceeds the 20,000-point editable path limit.');
  return contours.map(contour => contour.map(point => ({ x: Object.is(point.x, -0) ? 0 : point.x, y: Object.is(point.y, -0) ? 0 : point.y })));
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
