import { getBooleanStrokePath, getBooleanVectorPath, getNodeGeometry, getNodePropertyValue } from './model.js';
import { layerEffectPadding } from './layer-effects.js';
import { strokeGeometryBounds, strokePaintPadding } from './stroke-alignment.js';
import { strokeStackForNode } from './strokes.js';
import { nodeLocalToPage } from './transform-geometry.js';
import { projectBooleanVectorPaintTree } from './boolean-vector-export-preflight.js';

/** Bound a layer's own raster paint in page coordinates, including aligned strokes. */
export function rasterExportBounds(document, node, ancestors = [], { booleanGeometryPlan } = {}) {
  const resolved = { ...node, ...getNodeGeometry(document, node) };
  const parents = ancestors.map(parent => ({ ...parent, ...getNodeGeometry(document, parent) }));
  let outline = resolved;
  if (resolved.type === 'boolean' && resolved.booleanGeometry === 'vector' && getNodePropertyValue(document, node, 'visible') !== false) {
    outline = booleanGeometryPlan ? projectBooleanVectorPaintTree(document, resolved, booleanGeometryPlan) : getBooleanVectorPath(document, resolved);
  } else if (resolved.type === 'boolean' && strokeStackForNode(resolved).length) {
    try { outline = getBooleanStrokePath(document, resolved); }
    catch { /* Bounds remain readable while the inspector explains an unavailable outline. */ }
  }
  const strokePadding = strokePaintPadding(outline, strokeStackForNode(outline));
  const effects = layerEffectPadding(resolved.effects);
  const geometry = strokeGeometryBounds(outline);
  const paint = [
    { x: geometry.left - strokePadding, y: geometry.top - strokePadding },
    { x: geometry.right + strokePadding, y: geometry.top - strokePadding },
    { x: geometry.right + strokePadding, y: geometry.bottom + strokePadding },
    { x: geometry.left - strokePadding, y: geometry.bottom + strokePadding }
  ].map(point => nodeLocalToPage(resolved, point));
  // Foreground effects act on the already transformed layer surface. Expand
  // in parent coordinates before applying ancestor transforms; shrinking a
  // layer's affine scale must not shrink its shadow's independent offset.
  const ownLeft = Math.min(...paint.map(point => point.x)) - effects.x;
  const ownTop = Math.min(...paint.map(point => point.y)) - effects.y;
  const ownRight = Math.max(...paint.map(point => point.x)) + effects.x;
  const ownBottom = Math.max(...paint.map(point => point.y)) + effects.y;
  const points = [
    { x: ownLeft, y: ownTop }, { x: ownRight, y: ownTop },
    { x: ownRight, y: ownBottom }, { x: ownLeft, y: ownBottom }
  ].map(point => parents.length ? nodeLocalToPage(parents.at(-1), point, parents.slice(0, -1)) : point);
  const left = Math.min(...points.map(point => point.x));
  const top = Math.min(...points.map(point => point.y));
  const right = Math.max(...points.map(point => point.x));
  const bottom = Math.max(...points.map(point => point.y));
  const result = { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  if (resolved.children?.length && resolved.type !== 'boolean' && !resolved.clip && !resolved.mask) {
    for (const child of resolved.children) {
      if (child.type === 'slice' || getNodePropertyValue(document, child, 'visible') === false) continue;
      const bounds = rasterExportBounds(document, child, [...ancestors, node], { booleanGeometryPlan });
      const r = Math.max(result.x + result.width, bounds.x + bounds.width);
      const b = Math.max(result.y + result.height, bounds.y + bounds.height);
      result.x = Math.min(result.x, bounds.x); result.y = Math.min(result.y, bounds.y);
      result.width = Math.max(1, r - result.x); result.height = Math.max(1, b - result.y);
    }
  }
  return result;
}
