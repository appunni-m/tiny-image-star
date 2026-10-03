import { MAX_STAR_POINTS, MIN_STAR_POINTS, regularShapeVertices, roundedPolygonPathCommands } from './polygon-corners.js';

const MAX_STAR_RADIUS = 100_000;

const subtract = (left, right) => ({ x: left.x - right.x, y: left.y - right.y });
const add = (left, right) => ({ x: left.x + right.x, y: left.y + right.y });
const multiply = (value, factor) => ({ x: value.x * factor, y: value.y * factor });
const length = value => Math.hypot(value.x, value.y);
const dot = (left, right) => left.x * right.x + left.y * right.y;

function starCornerMetrics(vertices, index) {
  const vertex = vertices[index];
  const previous = vertices[(index + vertices.length - 1) % vertices.length];
  const next = vertices[(index + 1) % vertices.length];
  const incomingEdge = subtract(vertex, previous);
  const outgoingEdge = subtract(next, vertex);
  const incomingLength = length(incomingEdge);
  const outgoingLength = length(outgoingEdge);
  if (incomingLength < 1e-9 || outgoingLength < 1e-9) return null;
  const incoming = multiply(incomingEdge, 1 / incomingLength);
  const outgoing = multiply(outgoingEdge, 1 / outgoingLength);
  const angle = Math.abs(Math.atan2(incoming.x * outgoing.y - incoming.y * outgoing.x,
    dot(incoming, outgoing)));
  if (angle < 1e-8 || Math.PI - angle < 1e-8) return null;
  const tangentFactor = Math.tan(angle / 2);
  if (!Number.isFinite(tangentFactor) || tangentFactor < 1e-9) return null;
  return { vertex, incoming, tangentFactor };
}

/** Return node-local edit handles for a selected star. */
export function starControlHandles(node, zoom = 1) {
  if (!node || node.type !== 'star') return [];
  const width = Math.abs(Number(node.width) || 0);
  const height = Math.abs(Number(node.height) || 0);
  if (width < 1e-9 || height < 1e-9) return [];
  const scale = Math.max(0.08, Number(zoom) || 1);
  const vertices = regularShapeVertices('star', width, height, node.points, node.innerRadius ?? 0.48);
  const center = { x: width / 2, y: height / 2 };
  const outward = (point, distance) => {
    const direction = subtract(point, center);
    const magnitude = length(direction);
    return magnitude > 1e-9 ? add(point, multiply(direction, distance / magnitude)) : point;
  };
  const cornerIndex = Math.min(2, vertices.length - 1);
  const corner = starCornerMetrics(vertices, cornerIndex);
  const requestedRadius = Math.max(0, Math.min(MAX_STAR_RADIUS, Number(node.radius) || 0));
  const smoothing = Math.max(0, Math.min(1, Number(node.cornerSmoothing) || 0));
  const rounded = !node.vertexRadii && requestedRadius ? roundedPolygonPathCommands(vertices, requestedRadius, smoothing).corners?.[cornerIndex] : null;
  const radiusOrigin = rounded?.entry || vertices[cornerIndex];
  let maxRadius = MAX_STAR_RADIUS;
  for (let index = 0; index < vertices.length; index += 1) {
    const nextIndex = (index + 1) % vertices.length;
    const current = starCornerMetrics(vertices, index);
    const next = starCornerMetrics(vertices, nextIndex);
    const tangentTotal = (current?.tangentFactor || 0) + (next?.tangentFactor || 0);
    const edgeLength = length(subtract(vertices[nextIndex], vertices[index]));
    if (tangentTotal > 1e-9) maxRadius = Math.min(maxRadius, edgeLength / (tangentTotal * (1 + smoothing)));
  }
  return [
    { kind: 'points', label: 'Points', property: 'points', point: { x: vertices[0].x, y: vertices[0].y - 24 / scale } },
    { kind: 'ratio', label: 'Ratio', property: 'innerRadius', point: outward(vertices[1], 10 / scale) },
    ...(corner && !node.vertexRadii ? [{
      kind: 'radius', label: 'Radius', property: 'radius',
      point: outward(radiusOrigin, 12 / scale),
      axis: multiply(corner.incoming, -1), tangentFactor: corner.tangentFactor, smoothing, maxRadius
    }] : [])
  ];
}

/** One count step per 12 CSS pixels of vertical pointer travel. */
export function starPointCountFromDrag(initial, startClientY, currentClientY, pixelsPerPoint = 12) {
  const step = Math.max(1, Number(pixelsPerPoint) || 12);
  const origin = Number.isFinite(Number(initial)) ? Math.round(Number(initial)) : 5;
  const delta = (Number(startClientY) - Number(currentClientY)) / step;
  return Math.max(MIN_STAR_POINTS, Math.min(MAX_STAR_POINTS, Math.round(origin + delta)));
}

/** Convert a pointer position to the star's center-relative inner-radius ratio. */
export function starInnerRadiusFromPointer(node, localPoint) {
  const width = Math.abs(Number(node?.width) || 0);
  const height = Math.abs(Number(node?.height) || 0);
  const radius = Math.min(width, height) / 2;
  if (radius < 1e-9 || !Number.isFinite(localPoint?.x) || !Number.isFinite(localPoint?.y)) return 0.48;
  const ratio = Math.hypot(localPoint.x - width / 2, localPoint.y - height / 2) / radius;
  return Math.max(0, Math.min(1, ratio));
}

/** Map pointer travel along an outer point's incoming edge to its rounding radius. */
export function starCornerRadiusFromDrag(initial, startLocal, currentLocal, handle) {
  const requestedMaximum = Number(handle?.maxRadius);
  const maximum = Number.isFinite(requestedMaximum)
    ? Math.max(0, Math.min(MAX_STAR_RADIUS, requestedMaximum)) : MAX_STAR_RADIUS;
  const origin = Math.max(0, Math.min(maximum, Number(initial) || 0));
  const axis = handle?.axis;
  const tangentFactor = Number(handle?.tangentFactor);
  if (!axis || !Number.isFinite(tangentFactor) || tangentFactor < 1e-9) return origin;
  const smoothing = Math.max(0, Math.min(1, Number(handle.smoothing) || 0));
  const response = tangentFactor * (1 + smoothing);
  if (response < 1e-9) return origin;
  const travel = dot(subtract(currentLocal, startLocal), axis);
  return Math.max(0, Math.min(maximum, origin + travel / response));
}
