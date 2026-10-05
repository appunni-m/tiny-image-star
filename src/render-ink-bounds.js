import { getNodeColor, getNodeGeometry, getNodePropertyValue } from './model.js';
import { strokeGeometryBounds, strokePaintPadding } from './stroke-alignment.js';
import { strokeStackForNode, strokeSideNames, strokeSideWidths } from './strokes.js';
import { fillStackForNode } from './fills.js';
import { vectorPathContours } from './vector-path.js';
import { layerEffectPadding } from './layer-effects.js';
import { nodeToParentTransform, multiplyAffine, transformPoint } from './transform-geometry.js';
import { booleanSourceTransform } from './boolean-geometry.js';
import { isScrollableFrame } from './prototype-scroll-position.js';

export const RENDER_INK_BOUNDS_LIMITS = Object.freeze({ maxNodes: 100_000, maxDepth: 256, maxPoints: 1_000_000, maxCoordinate: 1_000_000_000_000 });

function colorHasAlpha(color, luminance = false) {
  if (!color || String(color).toLowerCase() === 'transparent') return false;
  const rgba = String(color).match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/iu);
  if (rgba) return Number(rgba[4] ?? 1) > 0 && (!luminance || rgba.slice(1, 4).some(channel => Number(channel) > 0));
  if (luminance && /^#0{3}(?:0{3})?$/iu.test(String(color))) return false;
  return true;
}

/** Enabled paint alpha, independently of layer geometry or isolation. */
export function paintHasVisibleAlpha(paint, { luminance = false } = {}) {
  if (!paint || paint.visible === false || Number(paint.opacity ?? 1) <= 0) return false;
  if (paint.gradient) return (paint.gradient.stops || []).some(stop => Number(stop.opacity ?? 1) > 0 && colorHasAlpha(stop.color, luminance));
  if (paint.type === 'image') return Boolean(paint.imageFill?.assetId);
  return colorHasAlpha(paint.color, luminance);
}

/**
 * Bounded paint eligibility for staged stroke subtrees. Alpha masks require
 * live source AND content paints; vector masks use enabled source geometry.
 * Primary bound colors and layer visibility/opacity resolve in the document.
 * This is paint eligibility, not a pixel-overlap or image-alpha computation.
 */
export function hasVisibleRenderedPaint(document, source, { resolveNode, limits = RENDER_INK_BOUNDS_LIMITS } = {}) {
  limits = { ...RENDER_INK_BOUNDS_LIMITS, ...limits };
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value <= 0)) throw new RangeError('Layer paint limits must be finite positive integers.');
  const resolve = resolveNode || (node => ({ ...node, ...getNodeGeometry(document, node),
    visible: getNodePropertyValue(document, node, 'visible'), opacity: getNodePropertyValue(document, node, 'opacity') }));
  let nodes = 0; let points = 0; const active = new Set();
  const visit = (original, depth, mode = 'paint') => {
    if (++nodes > limits.maxNodes || depth > limits.maxDepth || active.has(original)) throw new RangeError('Layer paint exceeds the bounded layer-tree budget.');
    active.add(original);
    try {
      const node = resolve(original); const geometry = mode === 'geometry';
      if (!node || node.visible === false || node.type === 'slice' || (!geometry && Number(node.opacity ?? 1) <= 0)) return false;
      const contours = node.type === 'path' ? vectorPathContours(node) : [];
      points += contours.reduce((sum, contour) => sum + (contour.points?.length || 0) + 1, 0)
        + (node.vertices?.length || 0) + (node.edges?.length || 0) * 2;
      if (points > limits.maxPoints) throw new RangeError('Layer paint exceeds the bounded vector-point budget.');
      const children = node.children || [];
      if (children.length > limits.maxNodes - nodes) throw new RangeError('Layer paint exceeds the bounded layer-tree budget.');
      if (node.mask && node.type === 'group') {
        const mask = children.find(child => child.id === node.maskSourceId) || children[0];
        const maskMode = node.maskMode === 'vector' ? 'geometry' : node.maskMode === 'luminance' ? 'luminance' : mode;
        return Boolean(mask && visit(mask, depth + 1, maskMode) && children.some(child => child !== mask && visit(child, depth + 1, mode)));
      }
      const fills = fillStackForNode(node); const strokes = strokeStackForNode(node);
      if (fills.length > 32 || strokes.length > 32) throw new RangeError('Layer paint exceeds the bounded paint-stack budget.');
      const fillGeometry = node.type !== 'line'
        && (node.type !== 'path' || contours.some(contour => contour.closed && contour.points?.length >= 2))
        && (node.type !== 'network' || node.faces?.length > 0)
        && !(node.type === 'group' && node.effectPaintMode === 'staged');
      const visibleFill = fillGeometry && fills.some((paint, index) => {
        const resolvedPaint = index === 0 && (node.fillVariableId || node.fillStyleId || node.type === 'text' && node.textVariableId)
          && paint.type === 'solid' ? { ...paint, color: getNodeColor(document, node, node.type === 'text' ? 'text' : 'fill') } : paint;
        return geometry ? resolvedPaint.visible !== false : paintHasVisibleAlpha(resolvedPaint, { luminance: mode === 'luminance' });
      });
      const strokeGeometry = node.type !== 'path' || contours.some(contour => contour.points?.length >= 2);
      const visibleStroke = strokeGeometry && strokes.some((paint, index) => {
        if (Math.max(Number(paint.width) || 0, ...strokeSideNames.map(side => Number(strokeSideWidths(paint)[side]) || 0)) <= 0) return false;
        const resolvedPaint = index === 0 && node.strokeVariableId ? { ...paint, color: getNodeColor(document, node, 'stroke') } : paint;
        return geometry ? resolvedPaint.visible !== false : paintHasVisibleAlpha(resolvedPaint, { luminance: mode === 'luminance' });
      });
      if (visibleFill || visibleStroke || node.type === 'image' && node.assetId) return true;
      if (node.effectPaintMode === 'staged' && node.effectFillMode === 'legacy' && Number(getNodePropertyValue(document, node, 'fillOpacity') ?? 1) <= 0) {
        return children.some(child => child.effectPaintPhase === 'stroke' && visit(child, depth + 1, mode));
      }
      return children.some(child => visit(child, depth + 1, mode));
    } finally { active.delete(original); }
  };
  return visit(source, 0);
}

const union = (left, right) => ({ left: Math.min(left.left, right.left), top: Math.min(left.top, right.top),
  right: Math.max(left.right, right.right), bottom: Math.max(left.bottom, right.bottom) });
const expand = (bounds, x, y = x) => ({ left: bounds.left - x, top: bounds.top - y,
  right: bounds.right + x, bottom: bounds.bottom + y });
const box = node => ({ left: 0, top: 0, right: node.width, bottom: node.height });
function checked(bounds, maxCoordinate = RENDER_INK_BOUNDS_LIMITS.maxCoordinate) {
  if (!Object.values(bounds).every(value => Number.isFinite(value) && Math.abs(value) <= maxCoordinate)) {
    throw new RangeError('Layer ink bounds exceed the finite coordinate budget.');
  }
  return bounds;
}

/** Map a local ink rectangle through the exact Canvas node transform. */
export function transformInkBounds(bounds, matrix, { maxCoordinate = RENDER_INK_BOUNDS_LIMITS.maxCoordinate } = {}) {
  const points = [[bounds.left, bounds.top], [bounds.right, bounds.top],
    [bounds.right, bounds.bottom], [bounds.left, bounds.bottom]].map(([x, y]) => transformPoint(matrix, { x, y }));
  return checked({ left: Math.min(...points.map(point => point.x)), top: Math.min(...points.map(point => point.y)),
    right: Math.max(...points.map(point => point.x)), bottom: Math.max(...points.map(point => point.y)) }, maxCoordinate);
}

/**
 * Conservative ink bounds in the root's untransformed local coordinates.
 * Descendant effects expand AFTER each descendant transform, matching Canvas
 * offscreen composition. The caller owns the root transform and effect apron.
 * Logical boxes remain a conservative baseline; path control hulls and actual
 * local font geometry may enlarge them. Masks/viewport clips bound descendants.
 */
export function renderNodeInkBounds(document, source, { resolveNode, textBounds, limits = RENDER_INK_BOUNDS_LIMITS } = {}) {
  limits = { ...RENDER_INK_BOUNDS_LIMITS, ...limits };
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value <= 0)) {
    throw new RangeError('Layer ink bounds limits must be finite positive integers.');
  }
  let nodes = 0; let points = 0; const active = new Set();
  const resolve = resolveNode || (node => ({ ...node, ...getNodeGeometry(document, node),
    visible: getNodePropertyValue(document, node, 'visible') }));
  const visit = (original, depth) => {
    if (++nodes > limits.maxNodes || depth > limits.maxDepth || active.has(original)) {
      throw new RangeError('Layer ink bounds exceed the bounded layer-tree budget.');
    }
    active.add(original);
    try {
      const node = resolve(original);
      if (!node || ![node.width, node.height].every(value => Number.isFinite(value) && value >= 0)) {
        throw new TypeError('Layer ink bounds require finite non-negative dimensions.');
      }
      if (node.visible === false) return null;
      if (depth > 0 && node.type === 'slice') return null;
      if (node.type === 'path') points += (node.points?.length || 0)
        + (node.subpaths?.length || 0) + (node.subpaths || []).reduce((sum, path) => sum + (path.points?.length || 0), 0);
      if (node.type === 'network') points += (node.vertices?.length || 0) + (node.edges?.length || 0) * 2;
      if (points > limits.maxPoints) throw new RangeError('Layer ink bounds exceed the bounded vector-point budget.');
      let own = strokeGeometryBounds(node);
      if (node.type === 'text' && textBounds) {
        const glyphBounds = textBounds(node);
        if (glyphBounds) own = union(own, checked(glyphBounds, limits.maxCoordinate));
      }
      own = expand(own, strokePaintPadding(node, strokeStackForNode(node)));
      let descendants = null;
      const children = node.children || [];
      if (children.length > limits.maxNodes - nodes) throw new RangeError('Layer ink bounds exceed the bounded layer-tree budget.');
      const basis = node.type === 'boolean' ? booleanSourceTransform(children.map(resolve), node.width, node.height) : null;
      const sourceTransform = basis ? { a: basis.scaleX, b: 0, c: 0, d: basis.scaleY,
        e: -basis.left * basis.scaleX, f: -basis.top * basis.scaleY } : null;
      for (const child of children) {
        const childBounds = visit(child, depth + 1);
        if (!childBounds) continue;
        const resolvedChild = resolve(child);
        const childTransform = nodeToParentTransform(resolvedChild);
        const transformed = transformInkBounds(childBounds, sourceTransform
          ? multiplyAffine(sourceTransform, childTransform) : childTransform, { maxCoordinate: limits.maxCoordinate });
        const padding = layerEffectPadding((resolvedChild.effects || []).filter(effect => effect.visible !== false));
        const ink = expand(transformed, padding.x, padding.y);
        descendants = descendants ? union(descendants, ink) : ink;
      }
      if (descendants && (node.mask || node.clip || isScrollableFrame(node))) {
        const viewport = box(node);
        descendants = { left: Math.max(viewport.left, descendants.left), top: Math.max(viewport.top, descendants.top),
          right: Math.min(viewport.right, descendants.right), bottom: Math.min(viewport.bottom, descendants.bottom) };
        if (descendants.right < descendants.left || descendants.bottom < descendants.top) descendants = null;
      }
      return checked(descendants ? union(own, descendants) : own, limits.maxCoordinate);
    } finally { active.delete(original); }
  };
  return visit(source, 0) || box(resolve(source));
}
