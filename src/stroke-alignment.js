import { vectorNetworkEdgeForPair, vectorNetworkEdgePairIndex, vectorPathContours } from './vector-path.js';
import { strokeSideNames, strokeSideWidths } from './strokes.js';

const alignments = new Set(['inside', 'center', 'outside']);
const closedPrimitives = new Set(['rectangle', 'frame', 'image', 'ellipse', 'star', 'polygon', 'text']);

/** Omitted positions retain the historical centered stroke. */
export function strokeAlignment(stroke) {
  return alignments.has(stroke?.alignment) ? stroke.alignment : 'center';
}

/** Alignment needs a filled geometric boundary, independently of its paints. */
export function supportsStrokeAlignment(node) {
  if (!node) return false;
  if (closedPrimitives.has(node.type)) return true;
  if (node.type === 'path') {
    const contours = vectorPathContours(node).filter(contour => contour.points?.length);
    return contours.length > 0 && contours.every(contour => contour.closed && contour.points.length >= 2);
  }
  if (node.type !== 'network' || !node.edges?.length || !node.faces?.length) return false;
  const edgeByPair = vectorNetworkEdgePairIndex(node);
  const covered = new Set();
  for (const face of node.faces) {
    const ids = face.vertexIds || [];
    if (ids.length < 3) return false;
    for (let index = 0; index < ids.length; index += 1) {
      const from = ids[index]; const to = ids[(index + 1) % ids.length];
      const edge = vectorNetworkEdgeForPair(edgeByPair, from, to);
      if (!edge) return false;
      covered.add(edge.id);
    }
  }
  return node.edges.every(edge => covered.has(edge.id));
}

/** Open paths keep their authored position but render with centered semantics. */
export function effectiveStrokeAlignment(node, stroke) {
  return supportsStrokeAlignment(node) ? strokeAlignment(stroke) : 'center';
}

/** A conservative local control hull, including geometry beyond the layout box. */
export function strokeGeometryBounds(node) {
  const width = Math.max(0, Number(node?.width) || 0);
  const height = Math.max(0, Number(node?.height) || 0);
  const bounds = { left: 0, top: 0, right: width, bottom: height };
  const include = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y);
  };
  if (node?.type === 'path') {
    for (const contour of vectorPathContours(node)) for (const point of contour.points || []) {
      const x = Number(point.x) * width; const y = Number(point.y) * height;
      include(x, y);
      for (const part of ['in', 'out']) if (point[part]) {
        include(x + Number(point[part].x) * width, y + Number(point[part].y) * height);
      }
    }
  } else if (node?.type === 'network') {
    for (const vertex of node.vertices || []) include(Number(vertex.x) * width, Number(vertex.y) * height);
    // Network controls are normalized absolute positions. Path handles above
    // are normalized offsets from their respective anchors.
    for (const edge of node.edges || []) for (const part of ['control1', 'control2']) {
      if (edge[part]) include(Number(edge[part].x) * width, Number(edge[part].y) * height);
    }
  }
  return bounds;
}

/** The perpendicular extent beyond a boundary; joins can require more padding. */
export function strokeOuterExtent(stroke, node = null) {
  const widths = strokeSideWidths(stroke);
  const width = Math.max(0, ...strokeSideNames.map(side => Number(widths[side]) || 0));
  const alignment = node ? effectiveStrokeAlignment(node, stroke) : strokeAlignment(stroke);
  return alignment === 'inside' ? 0 : width * (alignment === 'outside' ? 1 : .5);
}

/** Conservative local paint apron for masks, effect surfaces, and miter joins. */
export function strokePaintPadding(node, strokes) {
  return (strokes || []).reduce((maximum, stroke, index) => {
    if (stroke.visible === false || Number(stroke.opacity ?? 1) <= 0
      || (!stroke.gradient && !(index === 0 && node?.strokeVariableId)
        && (!stroke.color || stroke.color === 'transparent'))) return maximum;
    const outer = strokeOuterExtent(stroke, node);
    // Rectangular miter corners occupy the axis apron without multiplying it.
    const miter = ['star', 'polygon', 'path', 'network', 'text'].includes(node?.type) && stroke.join === 'miter'
      ? Math.max(1, Number(stroke.miterLimit) || 10) : 1;
    return Math.max(maximum, outer * miter);
  }, 0);
}
