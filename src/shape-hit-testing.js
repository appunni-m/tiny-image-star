import { clampCornerRadii, containsPointInRoundedRect, cornerRadiusKeys, roundedRectPathPoints } from './corner-radii.js';
import { regularShapeVertices, roundedPolygonPathPoints } from './polygon-corners.js';
import { fillStackForNode } from './fills.js';
import { getNodeColor, getNodePropertyValue } from './model.js';
import { strokeSideWidths, strokeStackForNode } from './strokes.js';
import { rectangleStrokeSideJoins, rectangleStrokeSidePaths } from './stroke-side-geometry.js';
import {
  vectorNetworkEdgePairIndex, vectorNetworkEdgePoints, vectorNetworkEdgeForPair,
  vectorNetworkVertexPoint, vectorPathContours, vectorSegmentPoints
} from './vector-path.js';
import { vectorNetworkFacePathPoints } from './vector-network-corners.js';
import { ellipseArcBoundaryPolylines, ellipseArcContainsPoint } from './ellipse-arc.js';
import { effectiveStrokeAlignment, strokeGeometryBounds, strokePaintPadding } from './stroke-alignment.js';

const MAX_FLATTENED_PATH_POINTS = 12_000;
const MAX_CUBIC_DEPTH = 8;

function resolvedFills(node, document) {
  const fills = fillStackForNode(node);
  const linkedPrimary = node.fillStyleId || node.fillVariableId || node.variableBindings?.fill;
  if (!fills.length || !(linkedPrimary || !Array.isArray(node.fills)) || fills[0].type !== 'solid') return fills;
  return fills.map((fill, index) => index === 0
    ? { ...fill, color: document ? getNodeColor(document, node, 'fill') : node.fill }
    : fill);
}

function visibleFill(node, document) {
  const fills = resolvedFills(node, document);
  if (node.type === 'path' && !vectorPathContours(node).some(contour => contour.closed && contour.points.length >= 2)) return false;
  if (node.type === 'network') return (node.faces || []).some(face => (
    face.fill && face.fill !== 'transparent' && Number(face.fillOpacity ?? 1) > 0
  )) || ((node.faces || []).length > 0 && fills.some(fill => (
    fill.visible !== false && Number(fill.opacity ?? 1) > 0 && (fill.type !== 'solid' || fill.color !== 'transparent')
  )));
  return fills.some(fill => fill.visible !== false && Number(fill.opacity ?? 1) > 0
    && (fill.type !== 'solid' || fill.color !== 'transparent'));
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - (start.x + dx * amount), point.y - (start.y + dy * amount));
}

function pointInPolygon(point, vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = vertices.length - 1; current < vertices.length; previous = current, current += 1) {
    const a = vertices[current];
    const b = vertices[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function windingNumber(point, vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return 0;
  let winding = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const cross = (end.x - start.x) * (point.y - start.y) - (point.x - start.x) * (end.y - start.y);
    if (start.y <= point.y && end.y > point.y && cross > 0) winding += 1;
    else if (start.y > point.y && end.y <= point.y && cross < 0) winding -= 1;
  }
  return winding;
}

function distanceToPolyline(point, vertices, closed = false) {
  if (!Array.isArray(vertices) || vertices.length < 2) return Infinity;
  let closest = Infinity;
  const count = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < count; index += 1) {
    closest = Math.min(closest, pointSegmentDistance(point, vertices[index], vertices[(index + 1) % vertices.length]));
  }
  return closest;
}

function splitCubic(points) {
  const [p0, p1, p2, p3] = points;
  const midpoint = (left, right) => ({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
  const a = midpoint(p0, p1);
  const b = midpoint(p1, p2);
  const c = midpoint(p2, p3);
  const d = midpoint(a, b);
  const e = midpoint(b, c);
  const middle = midpoint(d, e);
  return [[p0, a, d, middle], [middle, e, c, p3]];
}

function flattenCubic(points, output, depth = 0) {
  if (output.length >= MAX_FLATTENED_PATH_POINTS) return;
  const [start, control1, control2, end] = points;
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  const flatness = chord
    ? Math.max(Math.abs((control1.x - start.x) * (end.y - start.y) - (control1.y - start.y) * (end.x - start.x)) / chord,
      Math.abs((control2.x - start.x) * (end.y - start.y) - (control2.y - start.y) * (end.x - start.x)) / chord)
    : Math.max(Math.hypot(control1.x - start.x, control1.y - start.y), Math.hypot(control2.x - start.x, control2.y - start.y));
  if (flatness <= .5 || depth >= MAX_CUBIC_DEPTH) {
    output.push(end);
    return;
  }
  const [left, right] = splitCubic(points);
  flattenCubic(left, output, depth + 1);
  flattenCubic(right, output, depth + 1);
}

function flattenPathContour(node, contourIndex, contour) {
  const points = [];
  const segmentCount = contour.closed ? contour.points.length : contour.points.length - 1;
  if (segmentCount < 1) return points;
  const origin = { x: 0, y: 0 };
  for (let index = 0; index < segmentCount && points.length < MAX_FLATTENED_PATH_POINTS; index += 1) {
    const segment = vectorSegmentPoints(node, index, origin, contourIndex);
    if (!segment) continue;
    if (!points.length) points.push(segment[0]);
    const isCurve = [1, 2].some(control => Math.hypot(segment[control].x - segment[control - 1].x, segment[control].y - segment[control - 1].y) > 1e-9);
    if (isCurve) flattenCubic(segment, points);
    else points.push(segment[3]);
  }
  return points;
}

function polygonForNode(node, document) {
  const vertices = regularShapeVertices(node.type, node.width, node.height, node.points, node.innerRadius ?? .48);
  const radius = document ? getNodePropertyValue(document, node, 'radius') : node.radius;
  return roundedPolygonPathPoints(vertices, node.vertexRadii || radius, node.cornerSmoothing || 0);
}

function roundedRectanglePolygon(node, document) {
  const width = Math.abs(node.width);
  const height = Math.abs(node.height);
  const fallbackRadius = document ? getNodePropertyValue(document, node, 'radius') : node.radius;
  const rawRadii = node.cornerRadii || Object.fromEntries(cornerRadiusKeys.map(key => [key, Number(fallbackRadius) || 0]));
  const radii = clampCornerRadii(width, height, rawRadii);
  return roundedRectPathPoints(width, height, radii, node.cornerSmoothing || 0);
}

function containsRoundedRectangle(node, point, document) {
  const rawRadii = node.cornerRadii ?? (document ? getNodePropertyValue(document, node, 'radius') : node.radius) ?? 0;
  const radii = typeof rawRadii === 'number'
    ? Object.fromEntries(cornerRadiusKeys.map(key => [key, rawRadii]))
    : rawRadii;
  return containsPointInRoundedRect(point.x, point.y, node.width, node.height, radii, node.cornerSmoothing || 0);
}

function lineSegmentForNode(node) {
  return node.lineReverseY === true
    ? [{ x: 0, y: node.height }, { x: node.width, y: 0 }]
    : [{ x: 0, y: 0 }, { x: node.width, y: node.height }];
}

function pathContainsPoint(node, point) {
  const contours = vectorPathContours(node).map((contour, index) => ({
    closed: contour.closed,
    vertices: flattenPathContour(node, index, contour)
  }));
  const closed = contours.filter(contour => contour.closed && contour.vertices.length >= 3);
  if (!closed.length) return false;
  if (node.fillRule === 'evenodd') return closed.reduce((count, contour) => count + Number(pointInPolygon(point, contour.vertices)), 0) % 2 === 1;
  return closed.reduce((winding, contour) => winding + windingNumber(point, contour.vertices), 0) !== 0;
}

function networkPolygons(node) {
  const edgeByPair = vectorNetworkEdgePairIndex(node);
  return (node.faces || []).map(face => {
    const rounded = vectorNetworkFacePathPoints(node, face, { x: 0, y: 0 });
    if (rounded) return rounded;
    const vertices = [];
    for (let index = 0; index < face.vertexIds.length; index += 1) {
      const from = face.vertexIds[index];
      const to = face.vertexIds[(index + 1) % face.vertexIds.length];
      const edge = vectorNetworkEdgeForPair(edgeByPair, from, to);
      const segment = edge && vectorNetworkEdgePoints(node, edge.id, { x: 0, y: 0 });
      if (!segment) return [];
      const reversed = edge.from !== from;
      const directed = reversed ? [segment[3], segment[2], segment[1], segment[0]] : segment;
      if (!vertices.length) vertices.push(directed[0]);
      const isCurve = [1, 2].some(control => Math.hypot(directed[control].x - directed[control - 1].x, directed[control].y - directed[control - 1].y) > 1e-9);
      if (isCurve) flattenCubic(directed, vertices);
      else vertices.push(directed[3]);
      if (vertices.length >= MAX_FLATTENED_PATH_POINTS) break;
    }
    return vertices;
  });
}

function networkStrokePolylines(node) {
  const edgeByPair = vectorNetworkEdgePairIndex(node);
  const roundedEdgeIds = new Set();
  const polylines = [];
  for (const face of node.faces || []) {
    const vertices = vectorNetworkFacePathPoints(node, face, { x: 0, y: 0 });
    if (!vertices) continue;
    const ids = face.vertexIds || [];
    for (let index = 0; index < ids.length; index += 1) {
      const edge = vectorNetworkEdgeForPair(edgeByPair, ids[index], ids[(index + 1) % ids.length]);
      if (edge) roundedEdgeIds.add(edge.id);
    }
    // Keep the closing segment explicit because stroke hit testing treats
    // individual network edges as open polylines.
    polylines.push([...vertices, vertices[0]]);
  }
  for (const edge of node.edges || []) {
    if (roundedEdgeIds.has(edge.id)) continue;
    const points = vectorNetworkEdgePoints(node, edge.id, { x: 0, y: 0 });
    if (!points) continue;
    const vertices = [points[0]];
    const isCurve = [1, 2].some(control => Math.hypot(points[control].x - points[control - 1].x, points[control].y - points[control - 1].y) > 1e-9);
    if (isCurve) flattenCubic(points, vertices);
    else vertices.push(points[3]);
    polylines.push(vertices);
  }
  return polylines;
}

function inVisibleFill(node, point, document) {
  if (['frame', 'section', 'group'].includes(node.type)) {
    // Containers remain selectable across their full layout bounds. A clipping
    // frame's rounded viewport is enforced separately for descendants by the
    // renderer's ancestor-clip check, so a clipped corner selects the frame
    // without exposing the child beneath it.
    return point.x >= 0 && point.y >= 0 && point.x <= node.width && point.y <= node.height;
  }
  if (!visibleFill(node, document)) return false;
  if (node.type === 'rectangle') {
    return containsRoundedRectangle(node, point, document);
  }
  if (node.type === 'ellipse') {
    return ellipseArcContainsPoint(node, point);
  }
  if (node.type === 'star' || node.type === 'polygon') return pointInPolygon(point, polygonForNode(node, document));
  if (node.type === 'path') return pathContainsPoint(node, point);
  if (node.type === 'network') {
    const baseFillVisible = resolvedFills(node, document).some(fill => fill.visible !== false && Number(fill.opacity ?? 1) > 0
      && (fill.type !== 'solid' || fill.color !== 'transparent'));
    return networkPolygons(node).some((vertices, index) => {
      const face = node.faces[index];
      const faceFillVisible = face.fill && face.fill !== 'transparent' && Number(face.fillOpacity ?? 1) > 0;
      return (baseFillVisible || faceFillVisible) && pointInPolygon(point, vertices);
    });
  }
  return true;
}

function containsGeometricFill(node, point, document) {
  if (['rectangle', 'frame', 'image'].includes(node.type)) return containsRoundedRectangle(node, point, document);
  if (node.type === 'ellipse') return ellipseArcContainsPoint(node, point);
  if (node.type === 'star' || node.type === 'polygon') return pointInPolygon(point, polygonForNode(node, document));
  if (node.type === 'path') return pathContainsPoint(node, point);
  if (node.type === 'network') return networkPolygons(node).some(vertices => pointInPolygon(point, vertices));
  return point.x >= 0 && point.y >= 0 && point.x <= node.width && point.y <= node.height;
}

function strokeDistance(node, point, document) {
  if (node.type === 'line') return pointSegmentDistance(point, ...lineSegmentForNode(node));
  if (['frame', 'section', 'group', 'rectangle', 'image'].includes(node.type)) return distanceToPolyline(point, roundedRectanglePolygon(node, document), true);
  if (node.type === 'ellipse') return Math.min(...ellipseArcBoundaryPolylines(node).map(path => distanceToPolyline(point, path.points, path.closed)));
  if (node.type === 'star' || node.type === 'polygon') return distanceToPolyline(point, polygonForNode(node, document), true);
  if (node.type === 'path') return Math.min(...vectorPathContours(node).map((contour, index) => distanceToPolyline(point, flattenPathContour(node, index, contour), contour.closed)));
  if (node.type === 'network') return Math.min(...networkStrokePolylines(node).map(vertices => distanceToPolyline(point, vertices)));
  return Math.min(Math.abs(point.x), Math.abs(point.y), Math.abs(node.width - point.x), Math.abs(node.height - point.y));
}

function closedStrokeBoundaries(node, document) {
  if (['rectangle', 'frame', 'image'].includes(node.type)) return [roundedRectanglePolygon(node, document)];
  if (node.type === 'star' || node.type === 'polygon') return [polygonForNode(node, document)];
  if (node.type === 'path') return vectorPathContours(node).flatMap((contour, index) => contour.closed ? [flattenPathContour(node, index, contour)] : []);
  if (node.type === 'network') return networkPolygons(node);
  return [];
}

function strokeCornerPatches(boundaries, width, stroke) {
  return boundaries.flatMap(vertices => {
    if (vertices.length < 3) return [];
    const points = Math.hypot(vertices[0].x - vertices.at(-1).x, vertices[0].y - vertices.at(-1).y) < 1e-7
      ? vertices.slice(0, -1) : vertices;
    const paths = points.map((point, index) => ({ side: String(index), points: [point, points[(index + 1) % points.length]] }));
    const widths = Object.fromEntries(paths.map(path => [path.side, width]));
    return rectangleStrokeSideJoins(paths, widths, stroke.join, stroke.miterLimit);
  });
}

function inVisibleStroke(node, point, tolerance, document) {
  const geometricallyInside = containsGeometricFill(node, point, document);
  const fallbackRadius = document ? getNodePropertyValue(document, node, 'radius') : node.radius;
  const sidePaths = ['rectangle', 'frame'].includes(node.type)
    ? rectangleStrokeSidePaths(node.width, node.height, node.cornerRadii || fallbackRadius || 0, node.cornerSmoothing || 0) : null;
  const distance = sidePaths ? null : strokeDistance(node, point, document);
  let closedBoundaries;
  for (const [index, stroke] of strokeStackForNode(node).entries()) {
    const color = index === 0 && node.strokeVariableId && document ? getNodeColor(document, node, 'stroke') : stroke.color;
    if (stroke.visible === false || Number(stroke.opacity ?? 1) <= 0 || (!stroke.gradient && (!color || color === 'transparent'))) continue;
    const alignment = effectiveStrokeAlignment(node, stroke);
    const threshold = width => tolerance + (alignment === 'center' ? width / 2
      : (alignment === 'inside') === geometricallyInside ? width : 0);
    const alignmentAllowsCorner = alignment === 'center' || (alignment === 'inside') === geometricallyInside;
    let cornerPatches = [];
    if (sidePaths) {
      const sideWidths = strokeSideWidths(stroke);
      for (const run of sidePaths) {
        const width = sideWidths[run.side];
        if (width > 0 && distanceToPolyline(point, run.points, false) <= threshold(width)) return true;
      }
      if (alignmentAllowsCorner && stroke.pattern === 'solid') {
        const multiplier = alignment === 'center' ? 1 : 2;
        cornerPatches = rectangleStrokeSideJoins(sidePaths,
          Object.fromEntries(Object.entries(sideWidths).map(([side, width]) => [side, width * multiplier])), stroke.join, stroke.miterLimit);
      }
    } else if (Number(stroke.width) > 0 && distance <= threshold(stroke.width)) return true;
    if (!sidePaths && alignmentAllowsCorner && stroke.pattern === 'solid' && (node.type !== 'network' || alignment !== 'center')) {
      closedBoundaries ||= closedStrokeBoundaries(node, document);
      cornerPatches = strokeCornerPatches(closedBoundaries, stroke.width * (alignment === 'center' ? 1 : 2), stroke);
    }
    if (cornerPatches.some(patch => pointInPolygon(point, patch.points)
      || distanceToPolyline(point, patch.points, true) <= tolerance)) return true;
  }
  return false;
}

/** Hit-test a layer's painted geometry in its own local coordinate system. */
export function hitTestVisibleGeometry(node, localPoint, { tolerance = 4, document = null } = {}) {
  if (!node || !Number.isFinite(localPoint?.x) || !Number.isFinite(localPoint?.y)) return false;
  if (node.type === 'slice') {
    // Keep the artwork underneath a slice directly selectable. Select the
    // region from its border or its Layers row instead of swallowing every
    // pointer hit inside the crop rectangle.
    const inside = localPoint.x >= 0 && localPoint.y >= 0 && localPoint.x <= node.width && localPoint.y <= node.height;
    if (!inside) return false;
    return Math.min(localPoint.x, localPoint.y, node.width - localPoint.x, node.height - localPoint.y) <= Math.max(0, tolerance);
  }
  if (node.type === 'image') return containsRoundedRectangle(node, localPoint, document)
    || inVisibleStroke(node, localPoint, Math.max(0, tolerance), document);
  if (node.type === 'text') {
    return localPoint.x >= 0 && localPoint.y >= 0 && localPoint.x <= node.width && localPoint.y <= node.height;
  }
  const strokes = strokeStackForNode(node).map((stroke, index) => index === 0 && node.strokeVariableId && document
    ? { ...stroke, color: getNodeColor(document, node, 'stroke') } : stroke);
  const maximumStroke = strokePaintPadding(node, strokes) + Math.max(0, tolerance);
  const bounds = strokeGeometryBounds(node);
  if (localPoint.x < bounds.left - maximumStroke || localPoint.y < bounds.top - maximumStroke
    || localPoint.x > bounds.right + maximumStroke || localPoint.y > bounds.bottom + maximumStroke) return false;
  return inVisibleFill(node, localPoint, document) || inVisibleStroke(node, localPoint, Math.max(0, tolerance), document);
}
