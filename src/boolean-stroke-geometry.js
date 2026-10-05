import { flattenBooleanPathContours, normalizedPathGeometryFromCurveContours } from './boolean-geometry.js';
import { fillStackForNode, gradientTypes } from './fills.js';
import { strokeSideWidths, strokeStackForNode } from './strokes.js';

export class BooleanStrokeGeometryError extends Error {
  constructor(reason) {
    super(`Cannot outline this Boolean group: ${reason}`);
    this.name = 'BooleanStrokeGeometryError';
    this.code = 'UNSUPPORTED_BOOLEAN_STROKE';
  }
}

const MAX_SOURCE_NODES = 256;
const MAX_SOURCE_ITEMS = 20_000;
const MAX_SOURCE_DEPTH = 32;
const MAX_CACHE_ENTRIES = 32;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const cache = new Map();
let cacheBytes = 0;
const geometryProperties = ['type', 'name', 'x', 'y', 'width', 'height', 'rotation', 'affineTransform', 'radius',
  'cornerRadii', 'cornerSmoothing', 'points', 'vertexRadii', 'innerRadius', 'arcData',
  'closed', 'subpaths', 'fillRule', 'vertices', 'edges', 'faces', 'operation'];

const opaqueColor = color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
const fail = (node, reason) => { throw new BooleanStrokeGeometryError(`“${node?.name || node?.type || 'Unknown layer'}” ${reason}`); };

function opaquePaint(fill) {
  if (!fill || fill.visible === false || (fill.opacity ?? 1) !== 1) return false;
  if (fill.type === 'solid') return opaqueColor(fill.color);
  return gradientTypes.has(fill.type) && fill.gradient?.stops?.length >= 2
    && fill.gradient.stops.every(stop => (stop.opacity ?? 1) === 1 && opaqueColor(stop.color));
}

function hasOpaqueGeometryFill(node) {
  const fills = fillStackForNode(node);
  if (node.type !== 'network') return fills.some(opaquePaint);
  if (!Array.isArray(node.fills) && (node.fillOpacity ?? 1) !== 1) return false;
  return node.faces?.length > 0 && node.faces.every(face => {
    if ((face.fillOpacity ?? 1) !== 1) return false;
    if (!Array.isArray(node.fills)) {
      if (node.imageFill) return false;
      return opaqueColor(face.fill) || (face.fill == null && fills.some(opaquePaint));
    }
    return fills.some((fill, index) => opaquePaint(index === 0 && fill.type === 'solid' && face.fill != null
      ? { ...fill, color: face.fill } : fill));
  });
}

function hasVisibleSourceStroke(node) {
  return strokeStackForNode(node).some(stroke => {
    if (stroke.visible === false || Number(stroke.opacity ?? 1) <= 0
      || Math.max(...Object.values(strokeSideWidths(stroke))) <= 0) return false;
    if (stroke.gradient) return stroke.gradient.stops?.some(stop => Number(stop.opacity ?? 1) > 0);
    return opaqueColor(stroke.color);
  });
}

function sourceGeometry(node, resolveNode, state, depth = 0, root = false) {
  if (!node || typeof node !== 'object') fail(node, 'has no readable source geometry.');
  if (depth > MAX_SOURCE_DEPTH || ++state.nodes > MAX_SOURCE_NODES) fail(node, 'exceeds the bounded source-tree limit.');
  if (state.ancestors.has(node)) fail(node, 'contains a cyclic source tree.');
  state.ancestors.add(node);
  const resolved = resolveNode(node);
  if (!resolved || typeof resolved !== 'object') fail(node, 'could not resolve its current source properties.');
  if (!root) {
    if (resolved.visible === false || (resolved.opacity ?? 1) !== 1) {
      fail(resolved, 'uses hidden or translucent source geometry; make the source visible and opaque before adding an outline.');
    }
    if (!hasOpaqueGeometryFill(resolved)) fail(resolved, 'needs an opaque geometric fill before its result can have an editable outline.');
    if (hasVisibleSourceStroke(resolved)) fail(resolved, 'has a visible source stroke; remove that stroke before outlining the Boolean result.');
    if (resolved.children?.length && resolved.type !== 'boolean') fail(resolved, 'contains descendants whose mask cannot be represented by one closed vector source.');
  }
  const projected = {};
  for (const property of geometryProperties) if (Object.hasOwn(resolved, property)) projected[property] = resolved[property];
  // Effects and paint blend modes are suppressed by the live alpha-mask path.
  // Resolved paints are checked above, then omitted from the geometry cache.
  Object.assign(projected, { visible: true, opacity: 1, fillOpacity: 1, fill: '#ffffff', blendMode: 'normal', stroke: null, strokeWidth: 0, strokes: [] });
  if (resolved.type === 'network') projected.faces = (resolved.faces || []).map(face => ({ ...face, fill: '#ffffff', fillOpacity: 1 }));
  state.items += (Array.isArray(resolved.points) ? resolved.points.length : 0)
    + (resolved.subpaths || []).reduce((sum, contour) => sum + (contour.points?.length || 0), 0)
    + (resolved.vertices?.length || 0) + (resolved.edges?.length || 0)
    + (resolved.faces || []).reduce((sum, face) => sum + (face.vertexIds?.length || 0), 0);
  if (state.items > MAX_SOURCE_ITEMS) fail(resolved, 'exceeds the bounded source-geometry limit.');
  if (resolved.type === 'boolean') projected.children = (resolved.children || []).map(child => sourceGeometry(child, resolveNode, state, depth + 1));
  state.ancestors.delete(node);
  return root ? { resolved, projected } : projected;
}

/**
 * Return a current paint-preserving path view of an editable Boolean boundary.
 * Sources stay untouched. Only exact supported vector fragments enter the
 * bounded cache; own paints and transforms are copied fresh on every call.
 */
export function booleanStrokePath(node, { resolveNode = value => value } = {}) {
  if (node?.type !== 'boolean') throw new BooleanStrokeGeometryError('select a Boolean group first.');
  const { resolved, projected } = sourceGeometry(node, resolveNode, { nodes: 0, items: 0, ancestors: new Set() }, 0, true);
  const keyNode = { type: 'boolean', operation: projected.operation, width: projected.width, height: projected.height, children: projected.children };
  const key = JSON.stringify(keyNode, (property, value) => property === 'name' ? undefined : value);
  let entry = cache.get(key);
  if (entry) { cache.delete(key); cache.set(key, entry); }
  else {
    let geometry;
    try {
      geometry = normalizedPathGeometryFromCurveContours(flattenBooleanPathContours({ ...projected, x: 0, y: 0, rotation: 0, affineTransform: undefined }), resolved.width, resolved.height);
    } catch (error) {
      throw new BooleanStrokeGeometryError(error.message.replace(/^Cannot bake this Boolean group:\s*/, ''));
    }
    const size = (key.length + JSON.stringify(geometry).length) * 2;
    entry = { geometry, size };
    if (size <= MAX_CACHE_BYTES) {
      while (cache.size >= MAX_CACHE_ENTRIES || cacheBytes + size > MAX_CACHE_BYTES) {
        const oldestKey = cache.keys().next().value;
        cacheBytes -= cache.get(oldestKey).size; cache.delete(oldestKey);
      }
      cache.set(key, entry); cacheBytes += size;
    }
  }
  return { ...resolved, ...structuredClone(entry.geometry), type: 'path', children: [] };
}
