import { getNodeGeometry, findNode } from './model.js';
import { nodeLocalToPage } from './transform-geometry.js';

/** Pick a raster preview edge that matches the layer's actual displayed size. */
export function imagePreviewMaxDimensionForNode(node, document, pageId, {
  zoom = 1,
  pixelRatio = 1,
  maximumDimension = 4096,
} = {}) {
  if (!node || !document || typeof node.id !== 'string') throw new TypeError('A raster preview needs a live image layer.');
  if (![zoom, pixelRatio].every(value => Number.isFinite(value) && value > 0)
    || !Number.isSafeInteger(maximumDimension) || maximumDimension < 1) {
    throw new TypeError('Raster preview scale and dimensions must be positive finite values.');
  }
  const entry = findNode(document, node.id, pageId);
  if (!entry) throw new TypeError('The raster preview layer no longer exists.');
  const geometry = { ...node, ...getNodeGeometry(document, node) };
  const ancestors = entry.parents.map(parent => ({ ...parent, ...getNodeGeometry(document, parent) }));
  const corners = [
    { x: 0, y: 0 },
    { x: geometry.width, y: 0 },
    { x: geometry.width, y: geometry.height },
    { x: 0, y: geometry.height }
  ].map(point => nodeLocalToPage(geometry, point, ancestors));
  const width = Math.max(...corners.map(point => point.x)) - Math.min(...corners.map(point => point.x));
  const height = Math.max(...corners.map(point => point.y)) - Math.min(...corners.map(point => point.y));
  const displayEdge = Math.ceil(Math.max(width, height) * zoom * pixelRatio);
  return Math.max(1, Math.min(maximumDimension, displayEdge));
}
