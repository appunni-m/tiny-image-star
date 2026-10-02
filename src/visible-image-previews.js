import { fillStackForNode } from './fills.js';
import { getNodeGeometry, getNodePropertyValue } from './model.js';
import { imagePreviewKey } from './image-preview-runtime.js';
import { nodeLocalToPage } from './transform-geometry.js';

const FRAME_OVERFLOW_BEHAVIORS = new Set(['none', 'vertical', 'horizontal', 'both']);

function polygonArea(polygon) {
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const point = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    twiceArea += point.x * next.y - next.x * point.y;
  }
  return twiceArea / 2;
}

function cross(a, b, point) {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function lineIntersection(start, end, clipStart, clipEnd) {
  const startSide = cross(clipStart, clipEnd, start);
  const endSide = cross(clipStart, clipEnd, end);
  const denominator = startSide - endSide;
  if (Math.abs(denominator) < 1e-12) return { ...end };
  const amount = startSide / denominator;
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount
  };
}

/** Intersect two convex polygons. The transformed frame bounds are parallelograms. */
function intersectConvexPolygon(subject, clip) {
  if (subject.length < 3 || clip.length < 3) return [];
  const orientation = Math.sign(polygonArea(clip)) || 1;
  let output = subject;
  for (let index = 0; index < clip.length && output.length; index += 1) {
    const clipStart = clip[index];
    const clipEnd = clip[(index + 1) % clip.length];
    const input = output;
    output = [];
    let start = input.at(-1);
    for (const end of input) {
      const startInside = orientation * cross(clipStart, clipEnd, start) >= -1e-9;
      const endInside = orientation * cross(clipStart, clipEnd, end) >= -1e-9;
      if (endInside) {
        if (!startInside) output.push(lineIntersection(start, end, clipStart, clipEnd));
        output.push(end);
      } else if (startInside) output.push(lineIntersection(start, end, clipStart, clipEnd));
      start = end;
    }
  }
  return output;
}

function nodePolygon(geometry, ancestors) {
  return [
    { x: 0, y: 0 },
    { x: geometry.width, y: 0 },
    { x: geometry.width, y: geometry.height },
    { x: 0, y: geometry.height }
  ].map(point => nodeLocalToPage(geometry, point, ancestors));
}

function visiblePolygonInViewport(polygon, clipPolygons, viewportPolygon) {
  let clipped = polygon;
  for (const clip of clipPolygons) {
    clipped = intersectConvexPolygon(clipped, clip);
    if (clipped.length < 3) return false;
  }
  clipped = intersectConvexPolygon(clipped, viewportPolygon);
  return clipped.length >= 3 && Math.abs(polygonArea(clipped)) > 1e-9;
}

function clipsChildren(node) {
  return Boolean(node.clip)
    || (node.type === 'frame' && FRAME_OVERFLOW_BEHAVIORS.has(node.overflowBehavior)
      && node.overflowBehavior !== 'none');
}

function presentationScrollOffset(frame, offsets) {
  const behavior = frame?.type === 'frame' && FRAME_OVERFLOW_BEHAVIORS.has(frame.overflowBehavior)
    ? frame.overflowBehavior
    : 'none';
  const stored = offsets instanceof Map ? offsets.get(frame.id) : null;
  return {
    x: behavior === 'horizontal' || behavior === 'both' ? Math.max(0, Number(stored?.x) || 0) : 0,
    y: behavior === 'vertical' || behavior === 'both' ? Math.max(0, Number(stored?.y) || 0) : 0
  };
}

function imagePreviewKeysForNode(node) {
  const keys = [];
  if (node.type === 'image' && node.assetId) keys.push(imagePreviewKey(node.id));
  for (const fill of fillStackForNode(node)) {
    if (fill.type === 'image' && fill.imageFill?.assetId && fill.visible !== false && Number(fill.opacity ?? 1) > 0) {
      keys.push(imagePreviewKey(node.id, fill.id));
    }
  }
  return keys;
}

/** Find raster previews that can contribute pixels to the current page viewport. */
export function collectVisibleImagePreviewKeys(page, document, viewport, { presentationScrollOffsets = null } = {}) {
  if (!page || !document || !viewport
    || ![viewport.left, viewport.top, viewport.right, viewport.bottom].every(Number.isFinite)
    || viewport.right <= viewport.left || viewport.bottom <= viewport.top) return new Set();
  const visible = new Set();
  const viewportPolygon = [
    { x: viewport.left, y: viewport.top },
    { x: viewport.right, y: viewport.top },
    { x: viewport.right, y: viewport.bottom },
    { x: viewport.left, y: viewport.bottom }
  ];
  const visit = (nodes, ancestors = [], clipPolygons = [], parentScroll = { x: 0, y: 0 }, inheritedOpacity = 1) => {
    for (const node of nodes || []) {
      if (!getNodePropertyValue(document, node, 'visible')) continue;
      const opacity = Number(getNodePropertyValue(document, node, 'opacity') ?? 1);
      const effectiveOpacity = inheritedOpacity * (Number.isFinite(opacity) ? opacity : 1);
      if (effectiveOpacity <= 0) continue;
      const resolved = getNodeGeometry(document, node);
      const geometry = {
        ...node,
        ...resolved,
        x: Number(resolved.x) - parentScroll.x,
        y: Number(resolved.y) - parentScroll.y
      };
      const polygon = nodePolygon(geometry, ancestors);
      const previewKeys = imagePreviewKeysForNode(node);
      if (previewKeys.length && visiblePolygonInViewport(polygon, clipPolygons, viewportPolygon)) {
        for (const key of previewKeys) visible.add(key);
      }
      const childClips = clipsChildren(node) ? [...clipPolygons, polygon] : clipPolygons;
      visit(
        node.children,
        [...ancestors, geometry],
        childClips,
        presentationScrollOffset(node, presentationScrollOffsets),
        effectiveOpacity
      );
    }
  };
  visit(page.children);
  return visible;
}
