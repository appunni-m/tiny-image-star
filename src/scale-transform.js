import { nodeLocalToPage, nodeToParentTransform, pageToParentLocal, transformPoint } from './transform-geometry.js';
import { selectionBounds } from './group-transform.js';

const GEOMETRY_LIMIT = 100_000;
const ANCHOR_COORDINATES = Object.freeze({
  'top-left': [0, 0], top: [.5, 0], 'top-right': [1, 0],
  left: [0, .5], center: [.5, .5], right: [1, .5],
  'bottom-left': [0, 1], bottom: [.5, 1], 'bottom-right': [1, 1]
});

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be a positive finite number.`);
}

function scaleNumber(value, factor) {
  if (!Number.isFinite(value)) return value;
  const scaled = value * factor;
  if (!Number.isFinite(scaled) || Math.abs(scaled) > GEOMETRY_LIMIT) throw new RangeError('Scale would exceed the 100,000-unit editor limit.');
  return scaled;
}

function scaleTextRuns(runs, factor) {
  return Array.isArray(runs) ? runs.map(run => ({
    ...run,
    ...Object.fromEntries(['fontSize', 'letterSpacing', 'baselineShift'].filter(key => Number.isFinite(run?.[key]) && run[key] !== 0)
      .map(key => [key, scaleNumber(run[key], factor)])),
    ...(run?.lineHeightUnit === 'pixels' && Number.isFinite(run.lineHeight)
      ? { lineHeight: scaleNumber(run.lineHeight, factor) } : {})
  })) : runs;
}

function scaleParagraphStyles(styles, factor) {
  const keys = ['paragraphSpacing', 'firstLineIndent', 'listSpacing', 'indent'];
  return Array.isArray(styles) ? styles.map(style => ({
    ...style,
    ...Object.fromEntries(keys.filter(key => Number.isFinite(style?.[key]) && style[key] !== 0)
      .map(key => [key, scaleNumber(style[key], factor)]))
  })) : styles;
}

function scaledAppearance(node, factor) {
  const patch = {};
  for (const key of ['strokeWidth', 'radius', 'fontSize', 'letterSpacing', 'paragraphSpacing', 'firstLineIndent', 'listSpacing']) {
    if (Number.isFinite(node[key]) && node[key] !== 0) patch[key] = scaleNumber(node[key], factor);
  }
  if (node.lineHeightUnit === 'pixels' && Number.isFinite(node.lineHeight)) patch.lineHeight = scaleNumber(node.lineHeight, factor);
  if (Array.isArray(node.strokeDashArray)) patch.strokeDashArray = node.strokeDashArray.map(value => scaleNumber(value, factor));
  if (Array.isArray(node.strokes)) {
    patch.strokes = node.strokes.map(stroke => ({
      ...stroke,
      ...(Number.isFinite(stroke.width) ? { width: scaleNumber(stroke.width, factor) } : {}),
      ...(stroke.sideWidths && typeof stroke.sideWidths === 'object'
        ? { sideWidths: Object.fromEntries(Object.entries(stroke.sideWidths).map(([side, width]) => [side, scaleNumber(width, factor)])) }
        : {})
    }));
  }
  if (Array.isArray(node.effects)) {
    const dimensions = ['radius', 'blur', 'offsetX', 'offsetY', 'spread', 'sizeX', 'sizeY'];
    patch.effects = node.effects.map(effect => ({
      ...effect,
      ...Object.fromEntries(dimensions.filter(key => Number.isFinite(effect?.[key]) && effect[key] !== 0)
        .map(key => [key, scaleNumber(effect[key], factor)]))
    }));
  }
  if (node.cornerRadii && typeof node.cornerRadii === 'object') {
    patch.cornerRadii = Object.fromEntries(Object.entries(node.cornerRadii).map(([corner, value]) => [corner, scaleNumber(value, factor)]));
  }
  if (Array.isArray(node.vertexRadii)) patch.vertexRadii = node.vertexRadii.map(value => scaleNumber(value, factor));
  if (Array.isArray(node.textRuns)) patch.textRuns = scaleTextRuns(node.textRuns, factor);
  if (Array.isArray(node.paragraphStyles)) patch.paragraphStyles = scaleParagraphStyles(node.paragraphStyles, factor);
  return patch;
}

const SCALE_GEOMETRY_PROPERTIES = ['x', 'y', 'width', 'height'];
const SCALE_APPEARANCE_PROPERTIES = ['strokeWidth', 'radius', 'fontSize', 'letterSpacing', 'paragraphSpacing', 'firstLineIndent', 'listSpacing'];

function resolveNumericBinding(node, property, resolveBoundProperty) {
  if (!node.variableBindings?.[property]) return node[property];
  if (typeof resolveBoundProperty !== 'function') {
    throw new TypeError(`Cannot scale bound ${property} on “${node.name || node.id}” without a variable resolver.`);
  }
  const value = resolveBoundProperty(node, property);
  if (!Number.isFinite(value)) {
    throw new TypeError(`Cannot scale “${node.name || node.id}”: bound ${property} does not resolve to a finite number.`);
  }
  return value;
}

function resolvePlanningGeometry(node, resolveBoundProperty) {
  const resolved = { ...node };
  for (const property of [...SCALE_GEOMETRY_PROPERTIES, 'rotation']) {
    if (node.variableBindings?.[property]) resolved[property] = resolveNumericBinding(node, property, resolveBoundProperty);
  }
  return resolved;
}

function resolveScaleNode(node, resolveBoundProperty) {
  const resolved = resolvePlanningGeometry(node, resolveBoundProperty);
  const detach = [];
  for (const property of SCALE_GEOMETRY_PROPERTIES) {
    if (node.variableBindings?.[property]) detach.push(property);
  }
  for (const property of SCALE_APPEARANCE_PROPERTIES) {
    if (node.variableBindings?.[property]) {
      resolved[property] = resolveNumericBinding(node, property, resolveBoundProperty);
      detach.push(property);
    }
  }
  if (node.lineHeightUnit === 'pixels' && node.variableBindings?.lineHeight) {
    resolved.lineHeight = resolveNumericBinding(node, 'lineHeight', resolveBoundProperty);
    detach.push('lineHeight');
  }
  return { node: resolved, detach };
}

function bindingPatch(node, detachedProperties) {
  if (!detachedProperties.length) return {};
  const variableBindings = { ...(node.variableBindings || {}) };
  for (const property of detachedProperties) delete variableBindings[property];
  return { variableBindings: Object.keys(variableBindings).length ? variableBindings : null };
}

function pageAnchor(bounds, name) {
  const coordinates = ANCHOR_COORDINATES[name];
  if (!coordinates) throw new TypeError(`Unknown scale anchor: ${name}`);
  return { x: bounds.x + bounds.width * coordinates[0], y: bounds.y + bounds.height * coordinates[1] };
}

function scaledRootGeometry(node, ancestors, factor, anchor, currentCenter) {
  const width = scaleNumber(node.width, factor);
  const height = scaleNumber(node.height, factor);
  const targetCenter = {
    x: anchor.x + (currentCenter.x - anchor.x) * factor,
    y: anchor.y + (currentCenter.y - anchor.y) * factor
  };
  const targetParentCenter = pageToParentLocal(targetCenter, ancestors);
  const resized = { ...node, x: 0, y: 0, width, height };
  const transformedCenter = transformPoint(nodeToParentTransform(resized), { x: width / 2, y: height / 2 });
  const x = targetParentCenter.x - transformedCenter.x;
  const y = targetParentCenter.y - transformedCenter.y;
  if (![x, y].every(Number.isFinite)) throw new RangeError('Scale produced invalid layer coordinates.');
  return {
    x, y, width, height,
    ...(ancestors.at(-1)?.autoLayout && node.layoutPositioning !== 'absolute' ? { layoutPositioning: 'absolute' } : {}),
    ...scaledAppearance(node, factor)
  };
}

/**
 * Build a complete, non-mutating scale plan for selected layer roots.
 * Nested frames scale their children directly without running layout constraints;
 * a locked node and a nested component instance form a protected subtree.
 */
export function planScaleTransform(entries, factor, anchorName = 'center', { resolveBoundProperty } = {}) {
  if (!Array.isArray(entries) || !entries.length) throw new TypeError('Scale needs at least one selected layer.');
  finitePositive(factor, 'Scale factor');
  const normalized = [];
  const selectedIds = new Set(entries.map(entry => entry?.node?.id).filter(Boolean));
  for (const entry of entries) {
    if (!entry?.node || typeof entry.node.id !== 'string' || !entry.node.id) throw new TypeError('Every scaled layer needs a stable ID.');
    if (entry.ancestors != null && !Array.isArray(entry.ancestors)) throw new TypeError('Scale ancestors must be an array.');
    if (entry.ancestors?.some(ancestor => selectedIds.has(ancestor.id))) continue;
    normalized.push({ ...entry, ancestors: entry.ancestors || [] });
  }
  const editableEntries = normalized.filter(({ node, ancestors }) => !node.locked && !ancestors.some(parent => parent.locked || parent.isInstance));
  const editable = editableEntries.map(entry => ({
    ...entry,
    node: resolvePlanningGeometry(entry.node, resolveBoundProperty),
    ancestors: entry.ancestors.map(ancestor => resolvePlanningGeometry(ancestor, resolveBoundProperty))
  }));
  if (!editable.length) return { patches: [], excludedIds: normalized.map(({ node }) => node.id), bounds: null, anchor: null };
  const bounds = selectionBounds(editable.map(({ node, ancestors }) => ({ node, ancestors })));
  const anchor = pageAnchor(bounds, anchorName);
  const patches = new Map();
  const editableIds = new Set(editableEntries.map(({ node }) => node.id));
  const excludedIds = new Set(normalized.filter(entry => !editableIds.has(entry.node.id)).map(({ node }) => node.id));

  const addNode = (node, { root = false, ancestors = [], inheritedProtection = false, parentAutoLayout = false } = {}) => {
    if (inheritedProtection || node.locked || (!root && node.isInstance)) {
      excludedIds.add(node.id);
      return;
    }
    const { node: scaleNode, detach } = resolveScaleNode(node, resolveBoundProperty);
    if (![scaleNode.x, scaleNode.y, scaleNode.width, scaleNode.height].every(Number.isFinite) || scaleNode.width < 0 || scaleNode.height < 0) {
      throw new TypeError(`Layer “${node.name || node.id}” has invalid geometry and cannot be scaled.`);
    }
    let patch;
    if (root) {
      const center = nodeLocalToPage(scaleNode, { x: scaleNode.width / 2, y: scaleNode.height / 2 }, ancestors);
      patch = scaledRootGeometry(scaleNode, ancestors, factor, anchor, center);
    } else {
      patch = {
        x: scaleNumber(scaleNode.x, factor), y: scaleNumber(scaleNode.y, factor),
        width: scaleNumber(scaleNode.width, factor), height: scaleNumber(scaleNode.height, factor),
        ...(parentAutoLayout && scaleNode.layoutPositioning !== 'absolute' ? { layoutPositioning: 'absolute' } : {}),
        ...scaledAppearance(scaleNode, factor)
      };
    }
    Object.assign(patch, bindingPatch(node, detach));
    patches.set(node.id, patch);
    const insideInstance = root ? node.isInstance === true : false;
    for (const child of node.children || []) addNode(child, { inheritedProtection: insideInstance, parentAutoLayout: Boolean(node.autoLayout) });
  };
  for (const entry of editable) addNode(entry.node, { root: true, ancestors: entry.ancestors });
  return { patches: [...patches].map(([id, patch]) => ({ id, ...patch })), excludedIds: [...excludedIds], bounds, anchor };
}

export { ANCHOR_COORDINATES };
