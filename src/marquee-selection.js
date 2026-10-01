import { clampCornerRadii, cornerRadiiForNode } from './corner-radii.js';
import { getNodePropertyValue } from './model.js';
import { nodeLocalToPage } from './transform-geometry.js';

function finitePoint(point) {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function pointInRect(point, rect) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, point) {
  return Math.abs(orientation(a, b, point)) <= 1e-9
    && point.x >= Math.min(a.x, b.x) - 1e-9 && point.x <= Math.max(a.x, b.x) + 1e-9
    && point.y >= Math.min(a.y, b.y) - 1e-9 && point.y <= Math.max(a.y, b.y) + 1e-9;
}

function segmentsIntersect(a, b, c, d) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (((first > 0 && second < 0) || (first < 0 && second > 0))
    && ((third > 0 && fourth < 0) || (third < 0 && fourth > 0))) return true;
  return (Math.abs(first) <= 1e-9 && onSegment(a, b, c))
    || (Math.abs(second) <= 1e-9 && onSegment(a, b, d))
    || (Math.abs(third) <= 1e-9 && onSegment(c, d, a))
    || (Math.abs(fourth) <= 1e-9 && onSegment(c, d, b));
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    if (onSegment(a, b, point)) return true;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonArea(polygon) {
  return polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function polygonHasArea(polygon) {
  return polygon.length >= 3 && Math.abs(polygonArea(polygon)) > 1e-9;
}

function polygonHasNonCollinearPoints(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.some(point => !finitePoint(point))) return false;
  const origin = polygon[0];
  const second = polygon.find(point => Math.hypot(point.x - origin.x, point.y - origin.y) > 1e-9);
  return Boolean(second && polygon.some(point => Math.abs(orientation(origin, second, point)) > 1e-9));
}

/** Append a spaced lasso sample while bounding the retained pointer path. */
export function appendLassoPoint(points, point, { minDistance = 1, maxPoints = 2048 } = {}) {
  if (!Array.isArray(points) || !finitePoint(point)) return false;
  const distance = Number.isFinite(minDistance) ? Math.max(0, minDistance) : 1;
  const limit = Number.isFinite(maxPoints) ? Math.max(3, Math.floor(maxPoints)) : 2048;
  const last = points.at(-1);
  if (last && finitePoint(last) && Math.hypot(point.x - last.x, point.y - last.y) < distance) return false;
  points.push({ x: point.x, y: point.y });
  if (points.length > limit) {
    const previous = points.length;
    const reduced = points.filter((_, index) => index === 0 || index === previous - 1 || index % 2 === 0);
    points.splice(0, points.length, ...reduced);
  }
  return true;
}

/** Clip a subject polygon by a convex polygon, preserving intersections. */
export function clipPolygonToConvexPolygon(subject, clip) {
  if (!Array.isArray(subject) || subject.length < 3 || subject.some(point => !finitePoint(point))
    || !Array.isArray(clip) || clip.length < 3 || clip.some(point => !finitePoint(point))
    || !polygonHasArea(clip)) return [];
  let output = subject.map(point => ({ x: point.x, y: point.y }));
  const winding = Math.sign(polygonArea(clip));
  for (let edgeIndex = 0; edgeIndex < clip.length && output.length; edgeIndex += 1) {
    const edgeStart = clip[edgeIndex];
    const edgeEnd = clip[(edgeIndex + 1) % clip.length];
    const input = output;
    output = [];
    let start = input.at(-1);
    let startDistance = orientation(edgeStart, edgeEnd, start);
    for (const end of input) {
      const endDistance = orientation(edgeStart, edgeEnd, end);
      const startInside = winding * startDistance >= -1e-9;
      const endInside = winding * endDistance >= -1e-9;
      if (startInside !== endInside) {
        const amount = startDistance / (startDistance - endDistance);
        output.push({
          x: start.x + (end.x - start.x) * amount,
          y: start.y + (end.y - start.y) * amount
        });
      }
      if (endInside) output.push({ x: end.x, y: end.y });
      start = end;
      startDistance = endDistance;
    }
  }
  return polygonHasArea(output) ? output : [];
}

function quadraticPoint(start, control, end, amount) {
  const inverse = 1 - amount;
  return {
    x: inverse ** 2 * start.x + 2 * inverse * amount * control.x + amount ** 2 * end.x,
    y: inverse ** 2 * start.y + 2 * inverse * amount * control.y + amount ** 2 * end.y
  };
}

/** Return a rounded layer viewport as a transformed polygon for marquee clipping. */
export function marqueeClipPolygon(node, ancestors = [], document = null) {
  if (!node || !Number.isFinite(node.width) || !Number.isFinite(node.height) || node.width <= 0 || node.height <= 0) return [];
  const rawRadius = node.cornerRadii ?? (document ? getNodePropertyValue(document, node, 'radius') : node.radius) ?? 0;
  const radii = clampCornerRadii(node.width, node.height, cornerRadiiForNode({ cornerRadii: node.cornerRadii }, rawRadius));
  const { topLeft, topRight, bottomRight, bottomLeft } = radii;
  const width = node.width;
  const height = node.height;
  const points = [];
  const append = point => points.push(nodeLocalToPage(node, point, ancestors));
  const appendCorner = (start, control, end) => {
    for (let step = 1; step <= 8; step += 1) append(quadraticPoint(start, control, end, step / 8));
  };
  append({ x: topLeft, y: 0 });
  append({ x: width - topRight, y: 0 });
  appendCorner({ x: width - topRight, y: 0 }, { x: width, y: 0 }, { x: width, y: topRight });
  append({ x: width, y: height - bottomRight });
  appendCorner({ x: width, y: height - bottomRight }, { x: width, y: height }, { x: width - bottomRight, y: height });
  append({ x: bottomLeft, y: height });
  appendCorner({ x: bottomLeft, y: height }, { x: 0, y: height }, { x: 0, y: height - bottomLeft });
  append({ x: 0, y: topLeft });
  appendCorner({ x: 0, y: topLeft }, { x: 0, y: 0 }, { x: topLeft, y: 0 });
  return points;
}

/** Whether a layer and every ancestor are visible under their active variable modes. */
export function isMarqueeLayerVisible(node, ancestors = [], document = null) {
  return [...ancestors, node].every(layer => document
    ? getNodePropertyValue(document, layer, 'visible') !== false
    : layer?.visible !== false);
}

function clipsChildren(node) {
  return Boolean(node?.clip)
    || (node?.type === 'frame' && ['vertical', 'horizontal', 'both'].includes(node.overflowBehavior));
}

/** Restrict a layer's marquee geometry to the visible portion of its ancestors. */
export function clipMarqueePolygonThroughAncestors(polygon, ancestors = [], document = null) {
  let visiblePolygon = polygon;
  for (let index = 0; index < ancestors.length; index += 1) {
    const ancestor = ancestors[index];
    if (!clipsChildren(ancestor)) continue;
    const clip = marqueeClipPolygon(ancestor, ancestors.slice(0, index), document);
    visiblePolygon = clipPolygonToConvexPolygon(visiblePolygon, clip);
    if (!visiblePolygon.length) return [];
  }
  return visiblePolygon;
}

/** Resolve Figma-style left-to-right window and right-to-left crossing selection. */
export function marqueeSelectionMode(start, end) {
  if (!finitePoint(start) || !finitePoint(end)) throw new TypeError('Marquee points must contain finite coordinates.');
  return end.x >= start.x ? 'window' : 'crossing';
}

/** Test a transformed layer quadrilateral against a marquee rectangle. */
export function marqueeSelectsPolygon(start, end, polygon) {
  if (!finitePoint(start) || !finitePoint(end) || !Array.isArray(polygon) || polygon.length < 3 || polygon.some(point => !finitePoint(point))) {
    return false;
  }
  const rect = {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y)
  };
  if (marqueeSelectionMode(start, end) === 'window') return polygon.every(point => pointInRect(point, rect));

  const marqueeCorners = [
    { x: rect.left, y: rect.top }, { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom }
  ];
  if (polygon.some(point => pointInRect(point, rect)) || marqueeCorners.some(point => pointInPolygon(point, polygon))) return true;
  for (let polygonIndex = 0; polygonIndex < polygon.length; polygonIndex += 1) {
    const a = polygon[polygonIndex];
    const b = polygon[(polygonIndex + 1) % polygon.length];
    for (let rectIndex = 0; rectIndex < marqueeCorners.length; rectIndex += 1) {
      if (segmentsIntersect(a, b, marqueeCorners[rectIndex], marqueeCorners[(rectIndex + 1) % marqueeCorners.length])) return true;
    }
  }
  return false;
}

function polygonBounds(polygon) {
  return polygon.reduce((bounds, point) => ({
    left: Math.min(bounds.left, point.x), top: Math.min(bounds.top, point.y),
    right: Math.max(bounds.right, point.x), bottom: Math.max(bounds.bottom, point.y)
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}

function boundsIntersect(first, second) {
  return first.left <= second.right && first.right >= second.left
    && first.top <= second.bottom && first.bottom >= second.top;
}

/** Build one lasso hit-test for a page, caching expensive path validation and bounds. */
export function createLassoSelectionTest(lasso) {
  if (!Array.isArray(lasso) || !polygonHasNonCollinearPoints(lasso)) return () => false;
  const bounds = polygonBounds(lasso);
  return polygon => {
    if (!Array.isArray(polygon) || polygon.length < 3 || !polygonHasNonCollinearPoints(polygon)
      || !boundsIntersect(bounds, polygonBounds(polygon))) return false;
    if (lasso.some(point => pointInPolygon(point, polygon))
      || polygon.some(point => pointInPolygon(point, lasso))) return true;
    for (let lassoIndex = 0; lassoIndex < lasso.length; lassoIndex += 1) {
      const lassoStart = lasso[lassoIndex];
      const lassoEnd = lasso[(lassoIndex + 1) % lasso.length];
      for (let polygonIndex = 0; polygonIndex < polygon.length; polygonIndex += 1) {
        if (segmentsIntersect(lassoStart, lassoEnd, polygon[polygonIndex], polygon[(polygonIndex + 1) % polygon.length])) return true;
      }
    }
    return false;
  };
}

/** Select a layer whose visible polygon touches a freeform lasso region. */
export function lassoSelectsPolygon(lasso, polygon) {
  return createLassoSelectionTest(lasso)(polygon);
}
