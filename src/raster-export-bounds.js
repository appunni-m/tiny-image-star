import { getBooleanStrokePath, getBooleanVectorPath, getNodeGeometry, getNodePropertyValue } from './model.js';
import { layerEffectPadding } from './layer-effects.js';
import { strokeStackForNode } from './strokes.js';
import { nodeLocalToPage, nodeToParentTransform } from './transform-geometry.js';
import { projectBooleanVectorPaintTree } from './boolean-vector-export-preflight.js';
import { renderNodeInkBounds, transformInkBounds } from './render-ink-bounds.js';

/** Bound the composited subtree, expanding each effect after its layer transform. */
export function rasterExportBounds(document, node, ancestors = [], { booleanGeometryPlan, textBounds } = {}) {
  const resolveNode = source => {
    const resolved = { ...source, ...getNodeGeometry(document, source),
      visible: getNodePropertyValue(document, source, 'visible') };
    if (resolved.type === 'boolean' && resolved.visible !== false) {
      if (resolved.booleanGeometry === 'vector') {
        return booleanGeometryPlan ? projectBooleanVectorPaintTree(document, resolved, booleanGeometryPlan)
          : getBooleanVectorPath(document, resolved);
      }
      if (strokeStackForNode(resolved).length) {
        try { return getBooleanStrokePath(document, resolved); }
        catch { /* Keep readable bounds while the inspector explains the unavailable outline. */ }
      }
    }
    return resolved;
  };
  const resolved = resolveNode(node);
  const parents = ancestors.map(parent => ({ ...parent, ...getNodeGeometry(document, parent) }));
  const paint = transformInkBounds(renderNodeInkBounds(document, node, { resolveNode, textBounds }), nodeToParentTransform(resolved));
  const effects = layerEffectPadding(resolved.effects);
  // Foreground effects act on the already transformed layer surface. Expand
  // in parent coordinates before applying ancestor transforms; shrinking a
  // layer's affine scale must not shrink its shadow's independent offset.
  const ownLeft = paint.left - effects.x;
  const ownTop = paint.top - effects.y;
  const ownRight = paint.right + effects.x;
  const ownBottom = paint.bottom + effects.y;
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
