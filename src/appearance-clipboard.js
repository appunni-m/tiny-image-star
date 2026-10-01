import { fillStackForNode, isFillStackSupported, isValidFillStack, syncLegacyFillFields } from './fills.js';
import { isImageFillSupported, isValidImageFill } from './image-fills.js';
import { isValidLayerEffects } from './layer-effects.js';
import { isValidLayerBlendMode } from './layer-blend.js';
import { isValidCornerRadii } from './corner-radii.js';
import { isValidStrokeStack, strokeStackForNode, syncLegacyStrokeFields } from './strokes.js';

const clone = value => structuredClone(value);
const radiusNodeTypes = new Set(['rectangle', 'frame', 'section', 'image']);
const textStyleProperties = Object.freeze([
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'lineHeightUnit', 'letterSpacing',
  'paragraphSpacing', 'firstLineIndent', 'listSpacing', 'color', 'align',
  'verticalAlign', 'textCase', 'textDecoration'
]);

/**
 * Capture only reusable visual properties from a layer. The returned value
 * contains no layer identity, geometry, name, visibility, children, content,
 * component metadata, or references to mutable source objects.
 *
 * Fill stacks are captured only from layer types that support fills. Text
 * layers contribute layer-level typography; their rich-text runs and paragraph
 * content are deliberately excluded because those styles belong to ranges of
 * the source string and cannot be copied without also copying that content.
 */
export function snapshotAppearance(sourceNode) {
  if (!sourceNode || typeof sourceNode !== 'object' || Array.isArray(sourceNode)
    || typeof sourceNode.type !== 'string') {
    throw new TypeError('Choose a valid layer to copy its appearance.');
  }

  const snapshot = {
    version: 1,
    sourceType: sourceNode.type,
    opacity: Number.isFinite(sourceNode.opacity) && sourceNode.opacity >= 0 && sourceNode.opacity <= 1
      ? sourceNode.opacity : 1,
    blendMode: isValidLayerBlendMode(sourceNode.blendMode) ? sourceNode.blendMode : 'normal',
    fills: null,
    strokes: clone(strokeStackForNode(sourceNode)),
    effects: clone(Array.isArray(sourceNode.effects) ? sourceNode.effects : [])
  };

  if (isFillStackSupported(sourceNode)) snapshot.fills = clone(fillStackForNode(sourceNode));

  if (radiusNodeTypes.has(sourceNode.type)) {
    if (isValidCornerRadii(sourceNode.cornerRadii)) snapshot.cornerRadii = clone(sourceNode.cornerRadii);
    else if (Number.isFinite(sourceNode.radius) && sourceNode.radius >= 0) snapshot.radius = sourceNode.radius;
  }

  if (sourceNode.type === 'text') {
    const textStyle = Object.fromEntries(textStyleProperties
      .filter(property => Object.hasOwn(sourceNode, property) && sourceNode[property] !== undefined)
      .map(property => [property, clone(sourceNode[property])]));
    if (Object.keys(textStyle).length) snapshot.textStyle = textStyle;
  }

  // Stable, user-facing capability list for menu enablement and no-op checks.
  // Empty stroke/effect stacks remain included because applying them can clear
  // an existing target stack. Generic opacity and blend mode are always copied.
  snapshot.families = [
    'opacity', 'blendMode',
    ...(snapshot.fills === null ? [] : ['fills']),
    'strokes', 'effects',
    ...(Object.hasOwn(snapshot, 'radius') || Object.hasOwn(snapshot, 'cornerRadii') ? ['radii'] : []),
    ...(snapshot.textStyle ? ['textStyle'] : [])
  ];

  return snapshot;
}

/**
 * Apply a captured appearance to a layer without changing its geometry,
 * identity, name, content, visibility, or children. Unsupported groups are
 * skipped as a whole (for example, a rectangle fill stack pasted onto text),
 * so ordered paints are never partially reordered or silently dropped.
 *
 * Text styling is copied only text-to-text and only at the layer level. The
 * target's `text`, `textRuns`, and `paragraphStyles` remain exactly as authored.
 * Image-fill asset IDs remain shared references; fill, gradient-stop, stroke,
 * and effect IDs are regenerated for the destination.
 *
 * `idFactory(prefix)` can be injected for deterministic IDs. The function
 * returns a cloned node plus property names applied and human-readable skips.
 */
export function applyAppearance(targetNode, appearance, { idFactory = defaultIdFactory } = {}) {
  if (!targetNode || typeof targetNode !== 'object' || Array.isArray(targetNode)
    || typeof targetNode.type !== 'string') {
    throw new TypeError('Choose a valid target layer to paste appearance.');
  }
  if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance)
    || appearance.version !== 1 || typeof appearance.sourceType !== 'string') {
    throw new TypeError('The copied appearance is invalid or unsupported.');
  }
  if (typeof idFactory !== 'function') throw new TypeError('The appearance ID factory must be a function.');

  const node = clone(targetNode);
  const applied = [];
  const skipped = [];
  const changedFamilies = [];
  const before = clone(targetNode);
  const idsInUse = new Set([
    ...appearanceInnerIds(appearance),
    ...nodeInnerIds(node)
  ]);

  if (Number.isFinite(appearance.opacity) && appearance.opacity >= 0 && appearance.opacity <= 1) {
    const previousBindings = bindingState(before, 'opacity');
    node.opacity = appearance.opacity;
    clearVariableBinding(node, 'opacity');
    applied.push('opacity');
    if (before.opacity !== node.opacity || !sameValue(previousBindings, bindingState(node, 'opacity'))) changedFamilies.push('opacity');
  } else {
    throw new TypeError('The copied opacity is invalid.');
  }

  if (isValidLayerBlendMode(appearance.blendMode)) {
    node.blendMode = appearance.blendMode;
    applied.push('blendMode');
    if (before.blendMode !== node.blendMode) changedFamilies.push('blendMode');
  } else {
    throw new TypeError('The copied blend mode is invalid.');
  }

  if (appearance.fills !== null) {
    if (!Array.isArray(appearance.fills)) throw new TypeError('The copied fill stack is invalid.');
    if (isFillStackSupported(node)
      && isValidFillStack(appearance.fills, node, { isValidImageFill, isImageFillSupported })) {
      const previousFills = isFillStackSupported(before) ? fillStackForNode(before) : null;
      const previousBindings = bindingState(before, 'fills');
      node.fills = remapFillIds(appearance.fills, createUniqueId);
      syncLegacyFillFields(node);
      delete node.fillStyleId;
      delete node.fillVariableId;
      clearVariableBinding(node, 'fill');
      applied.push('fills');
      if (!sameValue(normalizeIds(previousFills), normalizeIds(appearance.fills))
        || !sameValue(previousBindings, bindingState(node, 'fills'))) changedFamilies.push('fills');
    } else {
      skipped.push(`fills: ${targetNode.type} does not support the complete copied fill stack`);
    }
  } else {
    skipped.push(`fills: ${appearance.sourceType} does not expose a reusable fill stack`);
  }

  if (Array.isArray(appearance.strokes) && isValidStrokeStack(appearance.strokes)) {
    if (isValidStrokeStack(appearance.strokes, node)) {
      const previousStrokes = strokeStackForNode(before);
      const previousBindings = bindingState(before, 'strokes');
      node.strokes = remapStrokeIds(appearance.strokes, createUniqueId);
      syncLegacyStrokeFields(node);
      delete node.strokeVariableId;
      clearVariableBinding(node, 'stroke');
      applied.push('strokes');
      if (!sameValue(normalizeIds(previousStrokes), normalizeIds(appearance.strokes))
        || !sameValue(previousBindings, bindingState(node, 'strokes'))) changedFamilies.push('strokes');
    } else {
      skipped.push(`strokes: ${targetNode.type} does not support the copied stroke stack`);
    }
  } else {
    throw new TypeError('The copied stroke stack is invalid.');
  }

  if (Array.isArray(appearance.effects) && isValidLayerEffects(appearance.effects)) {
    const previousEffects = Array.isArray(before.effects) ? before.effects : [];
    node.effects = appearance.effects.map(effect => ({ ...clone(effect), id: createUniqueId('effect') }));
    applied.push('effects');
    if (!sameValue(normalizeIds(previousEffects), normalizeIds(appearance.effects))) changedFamilies.push('effects');
  } else {
    throw new TypeError('The copied effect stack is invalid.');
  }

  const hasCopiedRadii = Object.hasOwn(appearance, 'radius') || Object.hasOwn(appearance, 'cornerRadii');
  if (hasCopiedRadii) {
    if (radiusNodeTypes.has(node.type)
      && (Object.hasOwn(appearance, 'radius')
        ? Number.isFinite(appearance.radius) && appearance.radius >= 0
        : isValidCornerRadii(appearance.cornerRadii))) {
      const previousBindings = bindingState(before, 'radii');
      if (Object.hasOwn(appearance, 'cornerRadii')) {
        node.cornerRadii = clone(appearance.cornerRadii);
        delete node.variableBindings?.radius;
        cleanupVariableBindings(node);
      } else {
        node.radius = appearance.radius;
        delete node.cornerRadii;
        clearVariableBinding(node, 'radius');
      }
      const family = Object.hasOwn(appearance, 'cornerRadii') ? 'cornerRadii' : 'radius';
      applied.push(family);
      const previousRadii = Object.hasOwn(before, 'cornerRadii')
        ? before.cornerRadii : before.radius;
      const nextRadii = Object.hasOwn(appearance, 'cornerRadii')
        ? appearance.cornerRadii : appearance.radius;
      if (!sameValue(previousRadii, nextRadii)
        || !sameValue(previousBindings, bindingState(node, 'radii'))) changedFamilies.push('radii');
    } else {
      skipped.push(`radii: ${targetNode.type} does not support the copied corner radii`);
    }
  } else {
    skipped.push(`radii: ${appearance.sourceType} does not support corner radii`);
  }

  if (appearance.textStyle && typeof appearance.textStyle === 'object' && !Array.isArray(appearance.textStyle)) {
    if (node.type === 'text') {
      const previousTextStyle = Object.fromEntries(textStyleProperties
        .filter(property => Object.hasOwn(before, property))
        .map(property => [property, before[property]]));
      const previousBindings = bindingState(before, 'textStyle');
      for (const property of textStyleProperties) {
        if (!Object.hasOwn(appearance.textStyle, property)) continue;
        node[property] = clone(appearance.textStyle[property]);
        clearVariableBinding(node, property);
      }
      delete node.textStyleId;
      delete node.textVariableId;
      applied.push('textStyle');
      if (!sameValue(previousTextStyle, appearance.textStyle)
        || !sameValue(previousBindings, bindingState(node, 'textStyle'))) changedFamilies.push('textStyle');
    } else {
      skipped.push(`textStyle: ${targetNode.type} is not a text layer`);
    }
  } else {
    skipped.push(`textStyle: ${appearance.sourceType} has no text styling`);
  }

  const appliedFamilies = [...new Set(applied.map(property => property === 'radius' || property === 'cornerRadii' ? 'radii' : property))];
  return {
    node,
    applied,
    skipped,
    appliedFamilies,
    changedFamilies,
    hasChanges: changedFamilies.length > 0,
    noOp: changedFamilies.length === 0
  };

  function createUniqueId(prefix) {
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const id = idFactory(prefix);
      if (typeof id !== 'string' || !id || id.length > 256) {
        throw new TypeError(`The appearance ID factory returned an invalid ${prefix} ID.`);
      }
      if (!idsInUse.has(id)) {
        idsInUse.add(id);
        return id;
      }
    }
    throw new TypeError(`The appearance ID factory did not produce a unique ${prefix} ID.`);
  }
}

function remapFillIds(fills, createId) {
  return fills.map(fill => {
    const copy = clone(fill);
    copy.id = createId('fill');
    if (copy.gradient?.stops) {
      copy.gradient.stops = copy.gradient.stops.map(stop => ({ ...stop, id: createId('stop') }));
    }
    return copy;
  });
}

function remapStrokeIds(strokes, createId) {
  return strokes.map(stroke => {
    const copy = clone(stroke);
    copy.id = createId('stroke');
    if (copy.gradient?.stops) {
      copy.gradient.stops = copy.gradient.stops.map(stop => ({ ...stop, id: createId('stop') }));
    }
    return copy;
  });
}

function appearanceInnerIds(appearance) {
  const ids = [];
  for (const fill of Array.isArray(appearance.fills) ? appearance.fills : []) {
    if (typeof fill?.id === 'string') ids.push(fill.id);
    for (const stop of Array.isArray(fill?.gradient?.stops) ? fill.gradient.stops : []) if (typeof stop?.id === 'string') ids.push(stop.id);
  }
  for (const stroke of Array.isArray(appearance.strokes) ? appearance.strokes : []) {
    if (typeof stroke?.id === 'string') ids.push(stroke.id);
    for (const stop of Array.isArray(stroke?.gradient?.stops) ? stroke.gradient.stops : []) if (typeof stop?.id === 'string') ids.push(stop.id);
  }
  for (const effect of Array.isArray(appearance.effects) ? appearance.effects : []) {
    if (typeof effect?.id === 'string') ids.push(effect.id);
  }
  return ids;
}

function nodeInnerIds(node) {
  const ids = [];
  for (const fill of Array.isArray(node.fills) ? node.fills : []) {
    if (typeof fill?.id === 'string') ids.push(fill.id);
    for (const stop of Array.isArray(fill?.gradient?.stops) ? fill.gradient.stops : []) if (typeof stop?.id === 'string') ids.push(stop.id);
  }
  for (const stroke of Array.isArray(node.strokes) ? node.strokes : []) {
    if (typeof stroke?.id === 'string') ids.push(stroke.id);
    for (const stop of Array.isArray(stroke?.gradient?.stops) ? stroke.gradient.stops : []) if (typeof stop?.id === 'string') ids.push(stop.id);
  }
  for (const effect of Array.isArray(node.effects) ? node.effects : []) if (typeof effect?.id === 'string') ids.push(effect.id);
  return ids;
}

function defaultIdFactory(prefix) {
  const unique = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${unique}`;
}

function clearVariableBinding(node, property) {
  if (node.variableBindings && Object.hasOwn(node.variableBindings, property)) {
    delete node.variableBindings[property];
    cleanupVariableBindings(node);
  }
}

function cleanupVariableBindings(node) {
  if (node.variableBindings && Object.keys(node.variableBindings).length === 0) delete node.variableBindings;
}

function normalizeIds(value) {
  if (Array.isArray(value)) return value.map(normalizeIds);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'id')
      .map(([key, entry]) => [key, normalizeIds(entry)]));
  }
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(sortObjectKeys(left)) === JSON.stringify(sortObjectKeys(right));
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortObjectKeys(value[key])]));
  }
  return value;
}

function bindingState(node, family) {
  if (family === 'opacity') return { variable: node.variableBindings?.opacity };
  if (family === 'fills') return {
    styleId: node.fillStyleId,
    variableId: node.fillVariableId,
    variable: node.variableBindings?.fill
  };
  if (family === 'strokes') return {
    variableId: node.strokeVariableId,
    variable: node.variableBindings?.stroke
  };
  if (family === 'radii') return { variable: node.variableBindings?.radius };
  if (family === 'textStyle') return {
    styleId: node.textStyleId,
    variableId: node.textVariableId,
    variables: Object.fromEntries(['fontSize', 'lineHeight', 'letterSpacing']
      .filter(property => Object.hasOwn(node.variableBindings || {}, property))
      .map(property => [property, node.variableBindings[property]]))
  };
  return {};
}
