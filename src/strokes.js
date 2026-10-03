/** Ordered, local stroke paints with a compatibility view for legacy layers. */

import { isValidGradientFill } from './fills.js';
import { isValidLayerBlendMode } from './layer-blend.js';
import { defaultStrokeDashArray, isValidStrokeDashArray, normalizeStrokeDashArray } from './stroke-style.js';

export const MAX_STROKES_PER_NODE = 32;

const caps = new Set(['butt', 'round', 'square']);
const joins = new Set(['miter', 'round', 'bevel']);
const patterns = new Set(['solid', 'dashed', 'dotted', 'custom']);
const endpointDecorations = new Set(['none', 'arrow', 'triangle']);
const clone = value => structuredClone(value);
const id = () => `stroke-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;

function legacyStrokeForNode(node) {
  if (!node?.stroke || !(Number(node.strokeWidth) > 0)) return [];
  return [{
    id: `legacy-stroke:${node.id || 'node'}`,
    color: node.stroke,
    width: node.strokeWidth,
    opacity: node.strokeOpacity ?? 1,
    visible: true,
    cap: node.strokeCap ?? (node.strokePattern === 'dotted' ? 'round' : 'butt'),
    join: node.strokeJoin ?? 'miter',
    pattern: node.strokePattern ?? 'solid',
    ...(node.strokePattern === 'custom' && Array.isArray(node.strokeDashArray) ? { dashArray: clone(node.strokeDashArray) } : {}),
    miterLimit: node.strokeMiterLimit ?? 10,
    startDecoration: 'none', endDecoration: 'none'
  }];
}

/**
 * Return the saved stroke stack, or expose a legacy scalar stroke as a stable
 * one-item view. Reading an old document never mutates its saved structure.
 */
export function strokeStackForNode(node) {
  if (!node) return [];
  if (Array.isArray(node.strokes)) return node.strokes;
  return legacyStrokeForNode(node);
}

/** Materialize a legacy scalar stroke before the first stack edit. */
export function ensureStrokeStack(node) {
  if (!node || typeof node !== 'object') return [];
  if (!Array.isArray(node.strokes)) node.strokes = legacyStrokeForNode(node).map(stroke => clone(stroke));
  return node.strokes;
}

export function createStroke(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('Stroke overrides must be an object.');
  }
  const stroke = {
    id: id(), color: '#1e1e1e', width: 1, opacity: 1, visible: true,
    cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10,
    startDecoration: 'none', endDecoration: 'none', blendMode: 'normal',
    ...overrides
  };
  const hasDashArray = Object.hasOwn(overrides, 'dashArray') && overrides.dashArray != null;
  const normalizedDashArray = hasDashArray ? normalizeStrokeDashArray(overrides.dashArray) : null;
  if (hasDashArray && !normalizedDashArray) throw new TypeError('A custom stroke dash array must contain finite, nonnegative dash and gap lengths.');
  if (hasDashArray && !Object.hasOwn(overrides, 'pattern')) stroke.pattern = 'custom';
  if (stroke.pattern === 'custom') stroke.dashArray = normalizedDashArray || defaultStrokeDashArray(stroke.width);
  else delete stroke.dashArray;
  if (stroke.pattern === 'dotted') stroke.cap = 'round';
  if (Object.hasOwn(stroke, 'gradient')) {
    if (stroke.gradient == null) delete stroke.gradient;
    else stroke.gradient = clone(stroke.gradient);
  }
  return stroke;
}

export function addStroke(node, stroke = createStroke()) {
  const strokes = ensureStrokeStack(node);
  if (strokes.length >= MAX_STROKES_PER_NODE || !isValidStroke(stroke)
    || strokes.some(item => item.id === stroke.id)) return false;
  strokes.push(clone(stroke));
  syncLegacyStrokeFields(node);
  return true;
}

export function removeStroke(node, strokeId) {
  const strokes = ensureStrokeStack(node);
  const index = strokes.findIndex(stroke => stroke.id === strokeId);
  if (index < 0) return null;
  const [removed] = strokes.splice(index, 1);
  syncLegacyStrokeFields(node);
  return removed;
}

/** Move a stroke one slot earlier (up) or later (down) in paint order. */
export function moveStroke(node, strokeId, direction) {
  const strokes = ensureStrokeStack(node);
  const index = strokes.findIndex(stroke => stroke.id === strokeId);
  const destination = index + (direction === 'up' ? -1 : direction === 'down' ? 1 : 0);
  if (index < 0 || destination < 0 || destination >= strokes.length || destination === index) return false;
  [strokes[index], strokes[destination]] = [strokes[destination], strokes[index]];
  syncLegacyStrokeFields(node);
  return true;
}

export function updateStroke(node, strokeId, changes = {}) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new TypeError('Stroke updates must be an object.');
  }
  const dashArraySpecified = Object.hasOwn(changes, 'dashArray');
  const normalizedDashArray = dashArraySpecified && changes.dashArray != null
    ? normalizeStrokeDashArray(changes.dashArray)
    : null;
  if (dashArraySpecified && changes.dashArray != null && !normalizedDashArray) {
    throw new TypeError('A custom stroke dash array must contain finite, nonnegative dash and gap lengths.');
  }
  const stroke = ensureStrokeStack(node).find(item => item.id === strokeId);
  if (!stroke) return null;
  if (Object.hasOwn(changes, 'visible') && typeof changes.visible === 'boolean') stroke.visible = changes.visible;
  if (Object.hasOwn(changes, 'opacity') && Number.isFinite(changes.opacity) && changes.opacity >= 0 && changes.opacity <= 1) stroke.opacity = changes.opacity;
  if (Object.hasOwn(changes, 'blendMode') && isValidLayerBlendMode(changes.blendMode)) stroke.blendMode = changes.blendMode;
  if (Object.hasOwn(changes, 'color') && validColor(changes.color)) stroke.color = changes.color;
  if (Object.hasOwn(changes, 'width') && Number.isFinite(changes.width) && changes.width >= 0 && changes.width <= 100_000) stroke.width = changes.width;
  if (Object.hasOwn(changes, 'cap') && caps.has(changes.cap)) stroke.cap = changes.cap;
  if (Object.hasOwn(changes, 'join') && joins.has(changes.join)) stroke.join = changes.join;
  const patternSpecified = Object.hasOwn(changes, 'pattern') && patterns.has(changes.pattern);
  if (patternSpecified) {
    stroke.pattern = changes.pattern;
    if (stroke.pattern === 'custom') {
      if (dashArraySpecified) stroke.dashArray = normalizedDashArray || defaultStrokeDashArray(stroke.width);
      else if (!isValidStrokeDashArray(stroke.dashArray)) stroke.dashArray = defaultStrokeDashArray(stroke.width);
    } else delete stroke.dashArray;
  } else if (dashArraySpecified) {
    if (normalizedDashArray) {
      stroke.pattern = 'custom';
      stroke.dashArray = normalizedDashArray;
    } else {
      delete stroke.dashArray;
      if (stroke.pattern === 'custom') stroke.pattern = 'solid';
    }
  } else if (stroke.pattern === 'custom' && !isValidStrokeDashArray(stroke.dashArray)) {
    stroke.dashArray = defaultStrokeDashArray(stroke.width);
  }
  if (stroke.pattern === 'dotted') stroke.cap = 'round';
  if (Object.hasOwn(changes, 'miterLimit') && Number.isFinite(changes.miterLimit) && changes.miterLimit >= 1 && changes.miterLimit <= 1000) stroke.miterLimit = changes.miterLimit;
  if (Object.hasOwn(changes, 'startDecoration') && endpointDecorations.has(changes.startDecoration)) stroke.startDecoration = changes.startDecoration;
  if (Object.hasOwn(changes, 'endDecoration') && endpointDecorations.has(changes.endDecoration)) stroke.endDecoration = changes.endDecoration;
  if (Object.hasOwn(changes, 'gradient')) {
    if (changes.gradient === null) delete stroke.gradient;
    else if (isValidGradientFill(changes.gradient)) stroke.gradient = clone(changes.gradient);
  }
  syncLegacyStrokeFields(node);
  return stroke;
}

/** Keep the first stack entry mirrored to scalar fields understood by old files. */
export function syncLegacyStrokeFields(node) {
  if (!node || !Array.isArray(node.strokes)) return node;
  const primary = node.strokes[0];
  if (!primary) {
    node.stroke = null;
    node.strokeWidth = 0;
    node.strokeOpacity = 1;
    for (const property of ['strokeCap', 'strokeJoin', 'strokePattern', 'strokeDashArray', 'strokeMiterLimit', 'strokeVariableId']) delete node[property];
    if (node.variableBindings) {
      delete node.variableBindings.stroke;
      if (!Object.keys(node.variableBindings).length) delete node.variableBindings;
    }
    return node;
  }
  // Keep old clients useful when a gradient is the primary paint. The ordered
  // stack remains canonical; the scalar compatibility field exposes its first
  // stop as the closest solid-color approximation.
  node.stroke = primary.gradient?.stops?.[0]?.color ?? primary.color;
  node.strokeWidth = primary.width;
  node.strokeOpacity = primary.opacity;
  node.strokeCap = primary.cap;
  node.strokeJoin = primary.join;
  node.strokePattern = primary.pattern;
  if (primary.pattern === 'custom' && isValidStrokeDashArray(primary.dashArray)) node.strokeDashArray = [...primary.dashArray];
  else delete node.strokeDashArray;
  node.strokeMiterLimit = primary.miterLimit;
  return node;
}

/** Preserve a previously bound primary color before its paint leaves slot 0. */
export function detachPrimaryStrokeBinding(node, previousPrimary, resolvedColor) {
  if (!node || !node.strokeVariableId) return false;
  if (Array.isArray(node.strokes) && node.strokes.includes(previousPrimary) && validColor(resolvedColor)) {
    previousPrimary.color = resolvedColor;
  }
  delete node.strokeVariableId;
  if (node.variableBindings) {
    delete node.variableBindings.stroke;
    if (!Object.keys(node.variableBindings).length) delete node.variableBindings;
  }
  return true;
}

export function isValidStroke(stroke) {
  return Boolean(stroke && typeof stroke === 'object' && !Array.isArray(stroke)
    && typeof stroke.id === 'string' && stroke.id.length > 0 && stroke.id.length <= 256
    && validColor(stroke.color)
    && Number.isFinite(stroke.width) && stroke.width >= 0 && stroke.width <= 100_000
    && Number.isFinite(stroke.opacity) && stroke.opacity >= 0 && stroke.opacity <= 1
    && (!Object.hasOwn(stroke, 'blendMode') || isValidLayerBlendMode(stroke.blendMode))
    && typeof stroke.visible === 'boolean'
    && caps.has(stroke.cap) && joins.has(stroke.join) && patterns.has(stroke.pattern)
    && (stroke.pattern !== 'custom' || isValidStrokeDashArray(stroke.dashArray))
    && (!Object.hasOwn(stroke, 'dashArray') || isValidStrokeDashArray(stroke.dashArray))
    && Number.isFinite(stroke.miterLimit) && stroke.miterLimit >= 1 && stroke.miterLimit <= 1000
    && (stroke.pattern !== 'dotted' || stroke.cap === 'round')
    && (!Object.hasOwn(stroke, 'startDecoration') || endpointDecorations.has(stroke.startDecoration))
    && (!Object.hasOwn(stroke, 'endDecoration') || endpointDecorations.has(stroke.endDecoration))
    && (!Object.hasOwn(stroke, 'gradient') || isValidGradientFill(stroke.gradient)));
}

export function isValidStrokeStack(strokes, node = null) {
  if (!Array.isArray(strokes) || strokes.length > MAX_STROKES_PER_NODE) return false;
  if (node?.type === 'boolean' && strokes.length) return false;
  const ids = new Set();
  for (const stroke of strokes) {
    if (!isValidStroke(stroke) || ids.has(stroke.id)) return false;
    ids.add(stroke.id);
  }
  return true;
}

export function validStrokeColor(color) { return validColor(color); }

function validColor(color) {
  return typeof color === 'string' && (/^#[0-9a-f]{6}$/i.test(color) || color === 'transparent');
}
