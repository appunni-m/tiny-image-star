import { vectorNetworkEdgePoints, vectorNodePoint, vectorPathContours } from './vector-path.js';

export const strokeDecorationTypes = Object.freeze(['none', 'arrow', 'triangle']);
const knownDecorations = new Set(strokeDecorationTypes);

function point(x, y) { return { x, y }; }
function difference(a, b) { return point(a.x - b.x, a.y - b.y); }
function length(value) { return Math.hypot(value.x, value.y); }
function hasDirection(value) { return Number.isFinite(value.x) && Number.isFinite(value.y) && length(value) > 1e-10; }
function hasHandle(anchor, handle) { return Boolean(handle && (Number(handle.x) !== 0 || Number(handle.y) !== 0)); }

function pathSegmentControls(node, contourIndex, index, origin) {
  const contour = vectorPathContours(node)[contourIndex];
  const points = contour?.points || [];
  const nextIndex = index + 1;
  const start = vectorNodePoint(node, index, 'anchor', origin, contourIndex);
  const end = vectorNodePoint(node, nextIndex, 'anchor', origin, contourIndex);
  if (!start || !end) return null;
  const previous = points[index];
  const current = points[nextIndex];
  const hasControls = hasHandle(previous, 'out') || hasHandle(current, 'in');
  const control1 = hasControls
    ? vectorNodePoint(node, index, 'out', origin, contourIndex)
    : point(start.x + (end.x - start.x) / 3, start.y + (end.y - start.y) / 3);
  const control2 = hasControls
    ? vectorNodePoint(node, nextIndex, 'in', origin, contourIndex)
    : point(start.x + 2 * (end.x - start.x) / 3, start.y + 2 * (end.y - start.y) / 3);
  return { start, control1, control2, end };
}

function forwardTangents(segment) {
  const chord = difference(segment.end, segment.start);
  const start = [difference(segment.control1, segment.start), difference(segment.control2, segment.start), chord].find(hasDirection) || point(0, 0);
  const end = [difference(segment.end, segment.control2), difference(segment.end, segment.control1), chord].find(hasDirection) || point(0, 0);
  return { start, end };
}

function decoration(type, side, tip, forward, strokeWidth, metadata = {}) {
  if (!knownDecorations.has(type) || type === 'none' || !hasDirection(forward)
    || !Number.isFinite(strokeWidth) || strokeWidth <= 0) return null;
  const forwardLength = length(forward);
  const direction = point(forward.x / forwardLength, forward.y / forwardLength);
  const outward = side === 'start' ? point(-direction.x, -direction.y) : direction;
  const normal = point(-outward.y, outward.x);
  const size = strokeWidth * 4;
  const halfWidth = size * .55;
  const base = point(tip.x - outward.x * size, tip.y - outward.y * size);
  const left = point(base.x + normal.x * halfWidth, base.y + normal.y * halfWidth);
  const right = point(base.x - normal.x * halfWidth, base.y - normal.y * halfWidth);
  return {
    type, side, tip: { ...tip }, points: type === 'triangle' ? [{ ...tip }, left, right] : [left, { ...tip }, right],
    closed: type === 'triangle', ...metadata
  };
}

function addEndpoint(result, stroke, side, tip, forward, metadata) {
  const type = stroke?.[side === 'start' ? 'startDecoration' : 'endDecoration'] ?? 'none';
  const value = decoration(type, side, tip, forward, Number(stroke?.width), metadata);
  if (value) result.push(value);
}

function lineDecorations(node, stroke, origin) {
  const start = node.lineReverseY === true
    ? point(origin.x, origin.y + node.height)
    : point(origin.x, origin.y);
  const end = node.lineReverseY === true
    ? point(origin.x + node.width, origin.y)
    : point(origin.x + node.width, origin.y + node.height);
  const forward = difference(end, start);
  const result = [];
  addEndpoint(result, stroke, 'start', start, forward, { endpoint: 'start' });
  addEndpoint(result, stroke, 'end', end, forward, { endpoint: 'end' });
  return result;
}

function pathDecorations(node, stroke, origin) {
  const result = [];
  for (const [contourIndex, contour] of vectorPathContours(node).entries()) {
    const points = contour.points || [];
    if (contour.closed || points.length < 2) continue;
    const first = pathSegmentControls(node, contourIndex, 0, origin);
    const last = pathSegmentControls(node, contourIndex, points.length - 2, origin);
    if (!first || !last) continue;
    const firstTangents = forwardTangents(first);
    const lastTangents = forwardTangents(last);
    addEndpoint(result, stroke, 'start', first.start, firstTangents.start, { endpoint: 'start', contourIndex });
    addEndpoint(result, stroke, 'end', last.end, lastTangents.end, { endpoint: 'end', contourIndex });
  }
  return result;
}

function networkDecorations(node, stroke, origin) {
  const result = [];
  const degree = new Map((node.vertices || []).map(vertex => [vertex.id, 0]));
  for (const edge of node.edges || []) {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  }
  for (const edge of node.edges || []) {
    const points = vectorNetworkEdgePoints(node, edge.id, origin);
    if (!points) continue;
    const [start, control1, control2, end] = points;
    const tangents = forwardTangents({ start, control1, control2, end });
    if (degree.get(edge.from) === 1) {
      addEndpoint(result, stroke, 'start', start, tangents.start, { endpoint: 'start', edgeId: edge.id });
    }
    if (degree.get(edge.to) === 1) {
      addEndpoint(result, stroke, 'end', end, tangents.end, { endpoint: 'end', edgeId: edge.id });
    }
  }
  return result;
}

/** Resolve arrow/triangle geometry at open stroke endpoints in the layer's local canvas coordinates. */
export function strokeEndpointDecorations(node, stroke, origin = { x: node?.x || 0, y: node?.y || 0 }) {
  if (!node || !stroke || !['line', 'path', 'network'].includes(node.type)) return [];
  const safeOrigin = Number.isFinite(origin?.x) && Number.isFinite(origin?.y) ? origin : { x: 0, y: 0 };
  if (node.type === 'line') return lineDecorations(node, stroke, safeOrigin);
  if (node.type === 'path') return pathDecorations(node, stroke, safeOrigin);
  return networkDecorations(node, stroke, safeOrigin);
}
