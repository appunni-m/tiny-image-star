import { getNodeGeometry } from './model.js';
import { layerEffectPadding } from './layer-effects.js';
import { strokeGeometryBounds, strokePaintPadding } from './stroke-alignment.js';
import { strokeStackForNode } from './strokes.js';
import { nodeLocalToPage } from './transform-geometry.js';

/** Bound a layer's own raster paint in page coordinates, including aligned strokes. */
export function rasterExportBounds(document, node, ancestors = []) {
  const resolved = { ...node, ...getNodeGeometry(document, node) };
  const parents = ancestors.map(parent => ({ ...parent, ...getNodeGeometry(document, parent) }));
  const strokePadding = strokePaintPadding(resolved, strokeStackForNode(resolved));
  const effects = layerEffectPadding(resolved.effects);
  const geometry = strokeGeometryBounds(resolved);
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
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}
