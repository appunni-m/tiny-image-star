import { isValidLayerEffects } from './layer-effects.js';
import { isValidFillStack, isValidGradientFill } from './fills.js';
import { createImageFill, defaultImageAdjustments, isImageFillSupported, isValidImageAdjustments, isValidImageFill, normalizeImageAdjustments } from './image-fills.js';
import { createImageTransforms, isValidImageTransforms } from './image-transforms.js';
import { isValidLayerBlendMode } from './layer-blend.js';
import { validateLinkedInstanceSnapshot } from './component-library.js';
import { isValidCornerRadii } from './corner-radii.js';
import { isValidStrokeStack, syncLegacyStrokeFields } from './strokes.js';
import { flattenBooleanPathContours, normalizedPathGeometryFromCurveContours } from './boolean-geometry.js';
import { MAX_TEXT_RUN_BASELINE_SHIFT } from './text-run-editing.js';

const clone = value => structuredClone(value);
/** Persisted layer trees allow at most 256 levels (root layer counts as 1). */
export const MAX_DOCUMENT_TREE_DEPTH = 256;
/** A local design may contain at most 100,000 unique layer objects across its trees. */
export const MAX_DOCUMENT_NODE_COUNT = 100_000;
/** Each page may contain at most 500 persistent ruler guides. */
export const MAX_PAGE_RULER_GUIDES = 500;
const variableTypes = new Set(['color', 'number', 'string', 'boolean']);
const variableBindingSpecs = {
  x: { type: 'number' },
  y: { type: 'number' },
  width: { type: 'number' },
  height: { type: 'number' },
  rotation: { type: 'number' },
  visible: { type: 'boolean' },
  opacity: { type: 'number' },
  radius: { type: 'number', nodeTypes: ['rectangle', 'frame', 'section', 'image'] },
  text: { type: 'string', nodeTypes: ['text'] },
  fontSize: { type: 'number', nodeTypes: ['text'] },
  lineHeight: { type: 'number', nodeTypes: ['text'] },
  letterSpacing: { type: 'number', nodeTypes: ['text'] },
  'autoLayout.axis': { type: 'string', nodeTypes: ['frame'] },
  'autoLayout.align': { type: 'string', nodeTypes: ['frame'] },
  'autoLayout.justify': { type: 'string', nodeTypes: ['frame'] },
  'autoLayout.mainSizing': { type: 'string', nodeTypes: ['frame'] },
  'autoLayout.crossSizing': { type: 'string', nodeTypes: ['frame'] },
  'autoLayout.wrap': { type: 'boolean', nodeTypes: ['frame'] },
  'autoLayout.autoPositioning': { type: 'boolean', nodeTypes: ['frame'] },
  'autoLayout.columns': { type: 'number', nodeTypes: ['frame'] },
  'autoLayout.rows': { type: 'number', nodeTypes: ['frame'] },
  'autoLayout.rowGap': { type: 'number', nodeTypes: ['frame'] },
  'autoLayout.columnGap': { type: 'number', nodeTypes: ['frame'] },
  'autoLayout.padding.top': { type: 'number', nodeTypes: ['frame'] },
  'autoLayout.padding.right': { type: 'number', nodeTypes: ['frame'] },
  'autoLayout.padding.bottom': { type: 'number', nodeTypes: ['frame'] },
  'autoLayout.padding.left': { type: 'number', nodeTypes: ['frame'] }
};

export function isVariableValue(type, value) {
  if (type === 'color') return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  return false;
}

function defaultVariableValue(type) {
  return type === 'color' ? '#1e1e1e' : type === 'number' ? 0 : type === 'string' ? '' : false;
}

function canBindVariableToNode(node, property) {
  if (node?.type === 'slice' && ['x', 'y', 'width', 'height', 'rotation'].includes(property)) return false;
  const spec = variableBindingSpecs[property];
  return Boolean(spec && (!spec.nodeTypes || spec.nodeTypes.includes(node?.type))
    && (!property.startsWith('autoLayout.') || node?.autoLayout));
}

function isVariableBindingValue(property, value) {
  const spec = variableBindingSpecs[property];
  if (!spec || !isVariableValue(spec.type, value)) return false;
  if (property === 'opacity') return value >= 0 && value <= 1;
  if (property === 'radius') return value >= 0;
  if (property === 'width' || property === 'height') return value >= 0;
  if (property === 'fontSize' || property === 'lineHeight') return value > 0;
  if (property.startsWith('autoLayout.')) {
    if (property.endsWith('.axis')) return ['vertical', 'horizontal', 'grid'].includes(value);
    if (property.endsWith('.align')) return ['start', 'center', 'end', 'stretch'].includes(value);
    if (property.endsWith('.justify')) return ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'].includes(value);
    if (property.endsWith('.mainSizing') || property.endsWith('.crossSizing')) return ['fixed', 'hug'].includes(value);
    if (property.endsWith('.columns') || property.endsWith('.rows')) return Number.isInteger(value) && value >= 1 && value <= 64;
    if (property.endsWith('.rowGap') || property.endsWith('.columnGap')) return value >= 0 && value <= 100_000;
    if (property.includes('.padding.')) return value >= 0 && value <= 100_000;
  }
  return true;
}

function readNodePropertyPath(node, property) {
  return property.split('.').reduce((value, key) => value?.[key], node);
}

function writeNodePropertyPath(node, property, value) {
  const keys = property.split('.');
  const key = keys.pop();
  let target = node;
  for (const segment of keys) {
    if (!target[segment] || typeof target[segment] !== 'object' || Array.isArray(target[segment])) target[segment] = {};
    target = target[segment];
  }
  target[key] = value;
}

function isValidFontWeight(value) {
  const weight = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isInteger(weight) && weight >= 1 && weight <= 1000;
}

const textRunStyleProperties = new Set(['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color', 'textDecoration', 'baselineShift']);

function isValidTextRun(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run)
    || typeof run.text !== 'string' || !run.text.length
    || Object.keys(run).some(key => key !== 'text' && !textRunStyleProperties.has(key))) return false;
  if (run.fontFamily != null && (typeof run.fontFamily !== 'string' || !run.fontFamily.trim() || run.fontFamily.length > 160 || /[\x00-\x1f]/.test(run.fontFamily))) return false;
  if (run.fontSize != null && (typeof run.fontSize !== 'number' || !Number.isFinite(run.fontSize) || run.fontSize <= 0 || run.fontSize > 100_000)) return false;
  if (run.fontWeight != null && !isValidFontWeight(run.fontWeight)) return false;
  if (run.fontStyle != null && !['normal', 'italic'].includes(run.fontStyle)) return false;
  if (run.lineHeight != null && (typeof run.lineHeight !== 'number' || !Number.isFinite(run.lineHeight) || run.lineHeight <= 0 || run.lineHeight > 100)) return false;
  if (run.letterSpacing != null && (typeof run.letterSpacing !== 'number' || !Number.isFinite(run.letterSpacing) || Math.abs(run.letterSpacing) > 10_000)) return false;
  if (run.color != null && (typeof run.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(run.color))) return false;
  if (run.textDecoration != null && !textDecorations.has(run.textDecoration)) return false;
  if (run.baselineShift != null && (typeof run.baselineShift !== 'number' || !Number.isFinite(run.baselineShift) || Math.abs(run.baselineShift) > MAX_TEXT_RUN_BASELINE_SHIFT)) return false;
  return true;
}

function isValidTextRuns(runs, text = undefined) {
  if (!Array.isArray(runs) || runs.length > 10_000 || runs.some(run => !isValidTextRun(run))) return false;
  const runText = runs.map(run => run.text).join('');
  if (runText.length > 1_000_000) return false;
  return text === undefined || (typeof text === 'string' && runText === text);
}

const paragraphListStyles = new Set(['none', 'bulleted', 'numbered']);
const maxTextParagraphStyles = 100_000;

function isValidTextParagraphStyles(styles, text = undefined) {
  if (!Array.isArray(styles) || styles.length > maxTextParagraphStyles) return false;
  if (text !== undefined) {
    if (typeof text !== 'string' || text.length > 1_000_000) return false;
    if (styles.length !== text.split(/\r\n|\r|\n/u).length) return false;
  }
  for (let index = 0; index < styles.length; index += 1) {
    const style = styles[index];
    if (!style || typeof style !== 'object' || Array.isArray(style)
      || Object.keys(style).some(key => !['listStyle', 'listLevel', 'listStart', 'align'].includes(key))) return false;
    const listStyle = style.listStyle ?? 'none';
    const listLevel = style.listLevel ?? 0;
    if (!paragraphListStyles.has(listStyle) || !Number.isInteger(listLevel) || listLevel < 0 || listLevel > 4) return false;
    if (listStyle === 'none' && listLevel !== 0) return false;
    if (style.listStart != null && (listStyle !== 'numbered' || !Number.isInteger(style.listStart) || style.listStart < 1 || style.listStart > 999_999)) return false;
    if (style.align != null && !textAlignments.has(style.align)) return false;
  }
  return true;
}

export function createId(prefix = 'id') {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${id}`;
}

export function createDocument() {
  const pageId = createId('page');
  return {
    schema: 'figma-local/1',
    id: createId('file'),
    name: 'Untitled',
    activePageId: pageId,
    pages: [{ id: pageId, name: 'Page 1', children: [], guides: [] }],
    components: [],
    componentSets: [],
    recipes: [],
    colorStyles: [],
    typographyStyles: [],
    effectStyles: [],
    variableCollections: [],
    variables: [],
    comments: [],
    prototypeStartPoint: null,
    prototypeFlows: [],
    prototypeStartFlowId: null,
    settings: { unit: 'px', grid: 8, snap: true }
  };
}

const defaults = {
  frame: { name: 'Frame', width: 390, height: 844, fill: '#ffffff', clip: true, overflowBehavior: 'none' },
  section: { name: 'Section', width: 480, height: 320, fill: '#e6e6e6', clip: false },
  slice: { name: 'Slice', width: 100, height: 100, fill: 'transparent', stroke: null, strokeWidth: 0, clip: false },
  group: { name: 'Group', width: 120, height: 80, fill: 'transparent', clip: false, mask: false },
  boolean: { name: 'Boolean group', width: 120, height: 80, fill: '#d9d9d9', operation: 'union', clip: false },
  rectangle: { name: 'Rectangle', width: 120, height: 80, fill: '#d9d9d9', radius: 0 },
  ellipse: { name: 'Ellipse', width: 100, height: 100, fill: '#d9d9d9' },
  line: { name: 'Line', width: 120, height: 0, fill: 'transparent', stroke: '#1e1e1e', strokeWidth: 2 },
  star: { name: 'Star', width: 100, height: 100, fill: '#ffcd29', points: 5, innerRadius: 0.48 },
  polygon: { name: 'Polygon', width: 100, height: 100, fill: '#d9d9d9', points: 6 },
  text: { name: 'Text', width: 240, height: 48, text: 'Text', textFit: 'auto-height', fontFamily: 'Inter, Arial, sans-serif', fontSize: 24, fontWeight: 400, fontStyle: 'normal', lineHeight: 1.25, letterSpacing: 0, paragraphSpacing: 0, firstLineIndent: 0, listSpacing: 0, color: '#1e1e1e', align: 'left', verticalAlign: 'top', textCase: 'none', textDecoration: 'none' },
  image: { name: 'Image', width: 320, height: 240, fill: '#eeeeee', assetId: null, fileName: 'Image', adjustments: defaultImageAdjustments, transforms: { crop: null, rotation: 0, flipHorizontal: false, flipVertical: false }, fit: 'cover', outputFormat: 'png', outputQuality: 90 },
  path: { name: 'Vector', width: 120, height: 100, fill: 'transparent', stroke: '#1e1e1e', strokeWidth: 2, points: [] },
  network: { name: 'Vector network', width: 120, height: 100, fill: 'transparent', stroke: '#1e1e1e', strokeWidth: 2, vertices: [], edges: [], faces: [] }
};
const prototypeActions = new Set(['navigate', 'open-overlay', 'swap-overlay', 'close-overlay', 'back', 'open-link', 'set-variable-mode', 'change-variant', 'scroll-to']);
const prototypeTriggers = new Set(['on-click', 'on-press', 'on-drag', 'while-hovering', 'after-delay']);
const prototypeTransitions = new Set(['instant', 'dissolve', 'move-left', 'move-right', 'smart-animate', 'scroll']);
const prototypeEasings = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out']);
const prototypeOverlayPositions = new Set(['center', 'top-left', 'top-center', 'top-right', 'left-center', 'right-center', 'bottom-left', 'bottom-center', 'bottom-right']);
const prototypeNumericConditionOperators = new Set(['greater-than', 'greater-than-or-equal', 'less-than', 'less-than-or-equal']);
const prototypeConditionOperators = new Set(['equals', 'not-equals', ...prototypeNumericConditionOperators]);
function isValidPrototypeConditionOperator(operator, type) {
  return prototypeConditionOperators.has(operator)
    && (!prototypeNumericConditionOperators.has(operator) || type === 'number');
}
function isSafePrototypeLinkUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return (['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname))
      || (url.protocol === 'mailto:' && !url.host && !url.username && !url.password && Boolean(url.pathname.trim()));
  } catch { return false; }
}
function hasInvalidPrototypeInteractions(interactions, document) {
  return !Array.isArray(interactions) || interactions.some(item => {
    if (!item || typeof item.id !== 'string' || !prototypeActions.has(item.action) || !prototypeTriggers.has(item.trigger)) return true;
    if (item.condition != null) {
      const condition = item.condition;
      const conditionFields = ['variableId', 'type', 'operator', 'value'];
      const variable = condition && typeof condition === 'object' && !Array.isArray(condition)
        ? document.variables?.find(candidate => candidate.id === condition.variableId)
        : null;
      if (!condition || typeof condition !== 'object' || Array.isArray(condition)
        || Object.keys(condition).some(key => !conditionFields.includes(key))
        || typeof condition.variableId !== 'string' || !condition.variableId
        || !isValidPrototypeConditionOperator(condition.operator, condition.type)
        || !variable || condition.type !== variable.type || !isVariableValue(condition.type, condition.value)) return true;
    }
    const needsDestination = ['navigate', 'open-overlay', 'swap-overlay'].includes(item.action);
    if (needsDestination ? typeof item.destinationId !== 'string' : item.destinationId != null) return true;
    if (item.action === 'scroll-to'
      ? (typeof item.scrollTargetId !== 'string' || !item.scrollTargetId
        || (item.scrollAlignment != null && !['nearest', 'start', 'center', 'end'].includes(item.scrollAlignment)))
      : (Object.hasOwn(item, 'scrollTargetId') || Object.hasOwn(item, 'scrollAlignment'))) return true;
    if (item.action === 'open-link' ? !isSafePrototypeLinkUrl(item.url) : item.url != null) return true;
    if (item.action === 'set-variable-mode'
      ? (typeof item.collectionId !== 'string' || !item.collectionId || (item.modeId != null && (typeof item.modeId !== 'string' || !item.modeId)))
      : (Object.hasOwn(item, 'collectionId') || Object.hasOwn(item, 'modeId'))) return true;
    if (item.action === 'change-variant'
      ? (typeof item.instanceId !== 'string' || !item.instanceId || typeof item.targetVariantId !== 'string' || !item.targetVariantId)
      : (Object.hasOwn(item, 'instanceId') || Object.hasOwn(item, 'targetVariantId'))) return true;
    if (item.destinationPageId != null && typeof item.destinationPageId !== 'string') return true;
    if (item.transition != null && !prototypeTransitions.has(item.transition)) return true;
    if (item.easing != null && !prototypeEasings.has(item.easing)) return true;
    if (item.transition === 'smart-animate' && item.action !== 'navigate') return true;
    if (item.transition === 'scroll' && item.action !== 'scroll-to') return true;
    if (item.action === 'scroll-to' && item.transition != null && !['instant', 'scroll'].includes(item.transition)) return true;
    if (item.duration != null && (!Number.isFinite(Number(item.duration)) || Number(item.duration) < 0 || Number(item.duration) > 2000)) return true;
    if (item.trigger === 'after-delay'
      ? (!['navigate', 'open-overlay', 'swap-overlay'].includes(item.action)
        || !Number.isInteger(item.delay) || item.delay < 100 || item.delay > 10_000)
      : Object.hasOwn(item, 'delay')) return true;
    if (item.action === 'open-overlay') {
      if (item.overlayPosition != null && !prototypeOverlayPositions.has(item.overlayPosition)) return true;
      if (item.overlayOutsideClick != null && typeof item.overlayOutsideClick !== 'boolean') return true;
      if (item.overlayBackground != null && typeof item.overlayBackground !== 'boolean') return true;
      if (item.overlayBackgroundColor != null && !/^#[0-9a-f]{6}$/i.test(item.overlayBackgroundColor)) return true;
      if (item.overlayBackgroundOpacity != null && (!Number.isFinite(Number(item.overlayBackgroundOpacity)) || Number(item.overlayBackgroundOpacity) < 0 || Number(item.overlayBackgroundOpacity) > 1)) return true;
    }
    return false;
  });
}
const prototypeScrollBehaviors = new Set(['vertical', 'horizontal', 'both']);

function isValidPrototypeScrollTarget(document, page, source, parents, targetId) {
  const screenFrame = [...parents, source].reverse().find(candidate => candidate.type === 'frame');
  const target = findNode(document, targetId, page.id);
  if (!screenFrame || !target) return false;
  const screenIndex = target.parents.findIndex(candidate => candidate.id === screenFrame.id);
  return screenIndex >= 0 && target.parents.slice(screenIndex)
    .some(candidate => candidate.type === 'frame' && prototypeScrollBehaviors.has(candidate.overflowBehavior));
}

function hasInvalidPrototypeScrollTargets(document) {
  let invalid = false;
  for (const page of document.pages || []) walkNodes(page.children || [], ({ node, parents }) => {
    if (invalid) return;
    if ((node.interactions || []).some(interaction => interaction.action === 'scroll-to'
      && !isValidPrototypeScrollTarget(document, page, node, parents, interaction.scrollTargetId))) invalid = true;
  });
  return invalid;
}

/** Remove scroll-to routes made invalid by a frame or hierarchy edit. */
export function reconcilePrototypeScrollInteractions(document, onPrune = null) {
  let removedCount = 0;
  for (const page of document.pages || []) walkNodes(page.children || [], ({ node, parents }) => {
    if (!Array.isArray(node.interactions)) return;
    const retained = node.interactions.filter(interaction => interaction.action !== 'scroll-to'
      || isValidPrototypeScrollTarget(document, page, node, parents, interaction.scrollTargetId));
    const removed = node.interactions.length - retained.length;
    if (!removed) return;
    removedCount += removed;
    if (retained.length) node.interactions = retained;
    else delete node.interactions;
    if (node.componentSourceId) {
      const instanceRoot = [...parents, node].reverse().find(candidate => candidate.isInstance);
      const override = instanceRoot?.componentOverrides?.[node.componentSourceId];
      if (override && Object.hasOwn(override, 'interactions')) {
        if (retained.length) override.interactions = clone(retained);
        else delete override.interactions;
      }
    }
    if (typeof onPrune === 'function') onPrune(node, removed);
  });
  return removedCount;
}
const exportFormats = new Set(['png', 'jpeg', 'webp']);
const layoutGuideTypes = new Set(['grid', 'columns', 'rows']);
const booleanOperations = new Set(['union', 'subtract', 'intersect', 'exclude']);
const textCases = new Set(['none', 'uppercase', 'lowercase', 'capitalize']);
const textDecorations = new Set(['none', 'underline', 'line-through']);
const textAlignments = new Set(['left', 'center', 'right', 'justify']);
const textVerticalAlignments = new Set(['top', 'middle', 'bottom']);
const strokeCaps = new Set(['butt', 'round', 'square']);
const strokeJoins = new Set(['miter', 'round', 'bevel']);
const strokePatterns = new Set(['solid', 'dashed', 'dotted']);
const vectorAnchorModes = new Set(['corner', 'smooth', 'symmetric']);
const vectorFillRules = new Set(['nonzero', 'evenodd']);
const frameOverflowBehaviors = new Set(['none', 'vertical', 'horizontal', 'both']);
const booleanOperandTypes = new Set(['rectangle', 'ellipse', 'star', 'polygon', 'path', 'network', 'text', 'boolean']);
const componentOverrideProperties = new Set([
  'name', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'locked', 'fill', 'fills', 'fillOpacity', 'fillStyleId',
  'stroke', 'strokeWidth', 'strokeOpacity', 'strokeCap', 'strokeJoin', 'strokePattern', 'strokeMiterLimit', 'strokes', 'radius', 'cornerRadii', 'clip', 'mask', 'text', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
  'letterSpacing', 'paragraphSpacing', 'firstLineIndent', 'listSpacing', 'paragraphStyles', 'fontStyle', 'color', 'textRuns', 'textStyleId', 'align', 'verticalAlign', 'textFit', 'textCase', 'textDecoration', 'fit', 'adjustments', 'transforms', 'constraints', 'autoLayout',
  'fillVariableId', 'textVariableId', 'strokeVariableId', 'variableModes',
  'variableBindings',
  'effects',
  'fillGradient',
  'imageFill',
  'blendMode',
  'layoutPositioning', 'layoutSizingMain', 'layoutSizingCross', 'layoutSizingX', 'layoutSizingY', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'gridCell', 'points', 'subpaths', 'fillRule', 'innerRadius', 'lineReverseY', 'closed', 'vertices', 'edges', 'faces', 'operation', 'exportSettings', 'outputFormat', 'outputQuality', 'layoutGuides', 'interactions', '__childOrder'
]);
const componentPropertyTypes = new Set(['BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'SLOT']);

function vectorPathContours(node) {
  return [{ points: node?.points, closed: node?.closed ?? false }, ...(Array.isArray(node?.subpaths) ? node.subpaths : [])];
}

function hasFillablePathContour(node) {
  return vectorPathContours(node).some(contour => contour.closed === true && Array.isArray(contour.points) && contour.points.length >= 2);
}

function hasOnlyClosedPathContours(node) {
  const contours = vectorPathContours(node);
  return contours.length > 0 && contours.every(contour => contour.closed === true && Array.isArray(contour.points) && contour.points.length >= 2);
}

function validVectorPath(node) {
  if (!Array.isArray(node.points) || (node.closed != null && typeof node.closed !== 'boolean')
    || (node.fillRule != null && !vectorFillRules.has(node.fillRule))
    || (node.subpaths != null && (!Array.isArray(node.subpaths) || node.subpaths.length > 9_999))) return false;
  const paths = vectorPathContours(node);
  if (paths.length > 10_000) return false;
  let pointCount = 0;
  for (const [index, path] of paths.entries()) {
    if (!Array.isArray(path.points) || (index > 0 && (path.points.length < 2 || typeof path.closed !== 'boolean'))) return false;
    pointCount += path.points.length;
    if (pointCount > 20_000 || path.points.some(point => !point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))
      || ['in', 'out'].some(part => point[part] != null && (!Number.isFinite(Number(point[part].x)) || !Number.isFinite(Number(point[part].y))))
      || (point.mode != null && !vectorAnchorModes.has(point.mode)))) return false;
  }
  return true;
}

export function createNode(type, overrides = {}) {
  const preset = defaults[type];
  if (!preset) throw new TypeError(`Unsupported layer type: ${type}`);
  const node = {
    id: createId(type), type,
    name: preset.name,
    x: 0, y: 0, width: preset.width, height: preset.height,
    rotation: 0, opacity: 1, visible: true, locked: false, blendMode: 'normal',
    fill: preset.fill, stroke: preset.stroke ?? null,
    strokeWidth: preset.strokeWidth ?? 0,
    radius: preset.radius ?? 0,
    clip: preset.clip ?? false,
    constraints: { horizontal: 'left', vertical: 'top' },
    children: [],
    ...preset,
    ...overrides,
    constraints: { horizontal: 'left', vertical: 'top', ...(overrides.constraints || {}) },
    children: overrides.children ? clone(overrides.children) : [],
    ...(Array.isArray(overrides.fills) ? { fills: clone(overrides.fills) } : {}),
    ...(Array.isArray(overrides.strokes) ? { strokes: clone(overrides.strokes) } : {}),
    ...(overrides.cornerRadii ? { cornerRadii: clone(overrides.cornerRadii) } : {}),
    ...(Array.isArray(overrides.paragraphStyles) ? { paragraphStyles: clone(overrides.paragraphStyles) } : {}),
    ...(type === 'image' ? {
      adjustments: normalizeImageAdjustments(overrides.adjustments ?? preset.adjustments),
      transforms: createImageTransforms(overrides.transforms ?? preset.transforms ?? {})
    } : {})
  };
  if (Array.isArray(node.strokes)) syncLegacyStrokeFields(node);
  return node;
}

export function createExportSetting(overrides = {}) {
  return { id: createId('export'), format: 'png', scale: 1, suffix: '', quality: 90, ...overrides };
}

export function createLayoutGuide(type = 'grid', overrides = {}) {
  if (!layoutGuideTypes.has(type)) throw new TypeError(`Unsupported layout guide type: ${type}`);
  return {
    id: createId('guide'), type, visible: true, color: '#ff0000', opacity: 0.1,
    size: 10, count: 4, alignment: 'stretch', gutter: 20, margin: 20, bandSize: 80, offset: 0,
    ...overrides
  };
}

export function createLayerEffect(type, overrides = {}) {
  if (type === 'drop-shadow') return { id: createId('effect'), type, visible: true, color: '#000000', opacity: 0.25, offsetX: 0, offsetY: 4, blur: 8, ...overrides };
  if (type === 'inner-shadow') return { id: createId('effect'), type, visible: true, color: '#000000', opacity: 0.25, offsetX: 0, offsetY: 4, blur: 8, ...overrides };
  if (type === 'layer-blur') return { id: createId('effect'), type, visible: true, radius: 4, ...overrides };
  if (type === 'background-blur') return { id: createId('effect'), type, visible: true, radius: 12, ...overrides };
  if (type === 'noise') return { id: createId('effect'), type, visible: true, mode: 'mono', sizeX: 1, sizeY: 1, density: 40, color: '#000000', color2: '#ffffff', opacity: 0.18, ...overrides };
  if (type === 'texture') return { id: createId('effect'), type, visible: true, sizeX: 0.7, sizeY: 0.7, radius: 20, clipToShape: true, ...overrides };
  if (type === 'glass') return { id: createId('effect'), type, visible: true, lightAngle: 45, lightIntensity: 50, refraction: 50, depth: 50, dispersion: 0, frost: 0, splay: 0, ...overrides };
  throw new TypeError(`Unsupported layer effect: ${type}`);
}

export function createGradientFill(type = 'linear', firstColor = '#d9d9d9') {
  if (!['linear', 'radial'].includes(type)) throw new TypeError(`Unsupported gradient fill: ${type}`);
  if (!/^#[0-9a-f]{6}$/i.test(firstColor)) throw new TypeError('Gradient stops require six-digit hex colors.');
  return {
    type, angle: 0,
    stops: [
      { id: createId('stop'), color: firstColor, position: 0 },
      { id: createId('stop'), color: '#ffffff', position: 1 }
    ]
  };
}

export function createFillLayer(type = 'solid', overrides = {}) {
  if (!['solid', 'linear', 'radial', 'image'].includes(type)) throw new TypeError(`Unsupported fill type: ${type}`);
  const base = { id: createId('fill'), type, visible: true, opacity: 1 };
  if (type === 'solid') return { ...base, color: '#d9d9d9', ...overrides };
  if (type === 'linear' || type === 'radial') return { ...base, gradient: createGradientFill(type), ...overrides };
  if (typeof overrides.assetId !== 'string' && typeof overrides.imageFill?.assetId !== 'string') {
    throw new TypeError('Choose an image already placed in this design.');
  }
  const imageFill = overrides.imageFill || createImageFill(overrides.assetId, overrides.imageOptions || {});
  const { assetId, imageOptions, ...rest } = overrides;
  return { ...base, imageFill, ...rest };
}

function normalizeCommentText(text) {
  const value = String(text ?? '').trim();
  if (!value || value.length > 4000) throw new TypeError('A comment must contain 1–4000 characters.');
  return value;
}

export function createCommentThread(document, { pageId = document.activePageId, x, y, text, author = 'You' } = {}) {
  if (!document.pages.some(page => page.id === pageId)) throw new TypeError('The comment page does not exist.');
  if (![x, y].every(value => Number.isFinite(value) && Math.abs(value) <= 100_000_000)) throw new TypeError('A comment needs a valid canvas position.');
  if ((document.comments || []).length >= 10_000) throw new TypeError('A design can have up to 10,000 comment threads.');
  const message = { id: createId('message'), author: String(author).trim().slice(0, 40) || 'You', text: normalizeCommentText(text), createdAt: Date.now() };
  const thread = { id: createId('comment'), pageId, x, y, resolved: false, createdAt: message.createdAt, updatedAt: message.createdAt, messages: [message] };
  document.comments ||= [];
  document.comments.push(thread);
  return thread;
}

export function addCommentReply(document, threadId, text, author = 'You') {
  const thread = (document.comments || []).find(item => item.id === threadId);
  if (!thread) throw new TypeError('The comment thread does not exist.');
  if (thread.messages.length >= 100) throw new TypeError('A comment thread can have up to 100 messages.');
  const message = { id: createId('message'), author: String(author).trim().slice(0, 40) || 'You', text: normalizeCommentText(text), createdAt: Date.now() };
  thread.messages.push(message);
  thread.updatedAt = message.createdAt;
  thread.resolved = false;
  return message;
}

export function setCommentResolved(document, threadId, resolved) {
  const thread = (document.comments || []).find(item => item.id === threadId);
  if (!thread) return false;
  if (typeof resolved !== 'boolean') throw new TypeError('Comment resolution state must be boolean.');
  thread.resolved = resolved;
  thread.updatedAt = Date.now();
  return true;
}

export function removeCommentThread(document, threadId) {
  const comments = document.comments || [];
  const index = comments.findIndex(item => item.id === threadId);
  if (index < 0) return false;
  comments.splice(index, 1);
  return true;
}

export function getActivePage(document) {
  return document.pages.find(page => page.id === document.activePageId) ?? document.pages[0] ?? null;
}

export function walkNodes(nodes, visitor, parent = null, depth = 0, parents = []) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const entry = { node, parent, depth, index, parents };
    visitor(entry);
    walkNodes(node.children ?? [], visitor, node, depth + 1, [...parents, node]);
  }
}

function treeContainsSlice(root) {
  const pending = Array.isArray(root) ? [...root] : [root];
  const visited = new Set();
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);
    if (node.type === 'slice') return true;
    if (Array.isArray(node.children)) pending.push(...node.children);
  }
  return false;
}

function assertSliceTreePlacement(node, parent = null) {
  if (!treeContainsSlice(node)) return;
  const childrenAreEmpty = node?.children == null
    || (Array.isArray(node.children) && node.children.length === 0);
  const isStandaloneSlice = node?.type === 'slice' && !parent
    && node.width > 0 && node.height > 0 && node.rotation === 0 && childrenAreEmpty;
  if (!isStandaloneSlice || node.isComponent || node.isInstance || node.mask) {
    throw new Error('Slices must be positive-size, unrotated, top-level export regions without children or components.');
  }
}

export function findNode(document, nodeId, pageId = document.activePageId) {
  const page = document.pages.find(item => item.id === pageId);
  if (!page) return null;
  let found = null;
  walkNodes(page.children, entry => { if (entry.node.id === nodeId) found = entry; });
  return found;
}

export function findNodeAcrossPages(document, nodeId) {
  for (const page of document.pages) {
    const entry = findNode(document, nodeId, page.id);
    if (entry) return { ...entry, page };
  }
  return null;
}

function componentSlotMutationContext(document, entry) {
  if (!entry?.node) return null;
  const ancestry = [...(entry.parents || []), entry.node];
  let best = null;
  for (let instanceDepth = 0; instanceDepth < ancestry.length; instanceDepth += 1) {
    const instance = ancestry[instanceDepth];
    if (!instance.isInstance) continue;
    const component = document.components?.find(item => item.id === instance.componentId);
    if (!component) continue;
    for (const property of component.componentProperties || []) {
      if (property.type !== 'SLOT') continue;
      const target = findInstancePropertyTarget(instance, property.targetSourceId);
      const targetDepth = ancestry.indexOf(target);
      if (!target || targetDepth < 0 || targetDepth > ancestry.length - 1) continue;
      if (best && (instanceDepth < best.instanceDepth || (instanceDepth === best.instanceDepth && targetDepth <= best.targetDepth))) continue;
      best = {
        instance, component, property, target, instanceDepth, targetDepth,
        overridden: Object.hasOwn(instance.componentPropertyValues || {}, property.id)
      };
    }
  }
  return best;
}

function requireOverriddenSlotForMutation(context, action) {
  if (context && !context.overridden) {
    throw new Error(`Cannot ${action} inherited slot content. Set a slot override before editing it.`);
  }
}

function syncSlotChildOrder(context, children) {
  if (!context?.overridden || context.target.children !== children) return;
  context.instance.componentPropertyValues[context.property.id] = children.map(node => node.id);
}

function slotAwareSiblingMutation(document, entries) {
  if (!entries.some(entry => entry.parents.some(parent => parent.isInstance))) return { allowed: true, context: null };
  const contexts = entries.map(entry => componentSlotMutationContext(document, entry));
  const context = contexts[0];
  const allowed = Boolean(context?.overridden && contexts.every(candidate => candidate?.overridden
    && candidate.instance === context.instance && candidate.property === context.property && candidate.target === context.target));
  return { allowed, context: allowed ? context : null };
}

export function addNode(document, node, { parentId = null, pageId = document.activePageId, index } = {}) {
  const page = document.pages.find(item => item.id === pageId);
  if (!page) throw new Error('The target page no longer exists.');
  const parentEntry = parentId ? findNode(document, parentId, pageId) : null;
  const parent = parentEntry?.node || null;
  if (parentId && !parent) throw new Error('The target parent layer no longer exists.');
  assertSliceTreePlacement(node, parent);
  if (parent && !['frame', 'section', 'group', 'boolean'].includes(parent.type)) throw new Error('This layer cannot contain other layers.');
  const slotContext = componentSlotMutationContext(document, parentEntry);
  requireOverriddenSlotForMutation(slotContext, 'add layers to');
  const list = parent ? parent.children : page.children;
  const insertAt = index == null ? list.length : Math.max(0, Math.min(index, list.length));
  list.splice(insertAt, 0, node);
  if (parent === slotContext?.target) syncSlotChildOrder(slotContext, list);
  return node;
}

export function removeNode(document, nodeId, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return null;
  const slotContext = componentSlotMutationContext(document, entry);
  requireOverriddenSlotForMutation(slotContext, 'remove');
  if (slotContext && entry.node === slotContext.target) throw new Error('Cannot remove a component slot target from its instance.');
  const list = entry.parent ? entry.parent.children : getActivePage({ ...document, activePageId: pageId }).children;
  const [removed] = list.splice(entry.index, 1);
  if (entry.parent === slotContext?.target) syncSlotChildOrder(slotContext, list);
  const removedComponents = [];
  const removedNodeIds = new Set();
  walkNodes([removed], ({ node }) => {
    removedNodeIds.add(node.id);
    if (node.isComponent && node.componentId) removedComponents.push(node.componentId);
  });
  removePrototypeInteractionsUsingNodes(document, removedNodeIds);
  if (Array.isArray(document.prototypeFlows)) {
    document.prototypeFlows = document.prototypeFlows.filter(flow => !(flow.pageId === pageId && removedNodeIds.has(flow.nodeId)));
    const selectedFlow = document.prototypeFlows.find(flow => flow.id === document.prototypeStartFlowId)
      || document.prototypeFlows[0]
      || null;
    document.prototypeStartFlowId = selectedFlow?.id ?? null;
    if (selectedFlow) {
      document.prototypeStartPoint = { pageId: selectedFlow.pageId, nodeId: selectedFlow.nodeId };
    } else if (document.prototypeStartPoint?.pageId === pageId && removedNodeIds.has(document.prototypeStartPoint.nodeId)) {
      document.prototypeStartPoint = null;
    }
  } else if (document.prototypeStartPoint?.pageId === pageId && removedNodeIds.has(document.prototypeStartPoint.nodeId)) {
    document.prototypeStartPoint = null;
  }
  for (const componentId of removedComponents) {
    document.components = (document.components || []).filter(component => component.id !== componentId);
    detachComponentInstances(document, componentId);
    removeComponentFromSets(document, componentId);
  }
  removeDanglingComponentProperties(document, removedNodeIds, new Set(removedComponents));
  return removed;
}

export function updateNode(document, nodeId, patch, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return false;
  const inPlaceSnapshot = typeof patch === 'function' ? clone(entry.node) : null;
  let changes;
  try {
    changes = typeof patch === 'function' ? patch(entry.node) : patch;
    const patchObject = changes && typeof changes === 'object' && !Array.isArray(changes) ? changes : {};
    assertSliceTreePlacement({ ...entry.node, ...patchObject }, entry.parent);
  } catch (error) {
    if (inPlaceSnapshot) Object.assign(entry.node, inPlaceSnapshot);
    throw error;
  }
  let slotContext = null;
  if (changes && Object.hasOwn(changes, 'children')) {
    slotContext = componentSlotMutationContext(document, entry);
    requireOverriddenSlotForMutation(slotContext, 'replace children in');
  }
  Object.assign(entry.node, changes);
  if (slotContext && entry.node === slotContext.target) syncSlotChildOrder(slotContext, entry.node.children || []);
  if (changes && (Object.hasOwn(changes, 'children') || Object.hasOwn(changes, 'overflowBehavior') || Object.hasOwn(changes, 'type'))) {
    reconcilePrototypeScrollInteractions(document);
  }
  return true;
}

export function flattenPage(page) {
  const result = [];
  walkNodes(page?.children ?? [], entry => result.push(entry));
  return result;
}

export function absoluteBounds(document, nodeId, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return null;
  const geometry = getNodeGeometry(document, entry.node);
  let x = geometry.x;
  let y = geometry.y;
  for (const parent of entry.parents) {
    const parentGeometry = getNodeGeometry(document, parent);
    x += parentGeometry.x;
    y += parentGeometry.y;
  }
  return { x, y, width: geometry.width, height: geometry.height };
}

export function duplicateNode(document, nodeId, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return null;
  assertSliceTreePlacement(entry.node, entry.parent);
  const slotContext = componentSlotMutationContext(document, entry);
  requireOverriddenSlotForMutation(slotContext, 'duplicate');
  if (slotContext && entry.node === slotContext.target) throw new Error('Cannot duplicate a component slot target from its instance.');
  const duplicate = clone(entry.node);
  const idMap = new Map();
  const renew = node => {
    const originalId = node.id;
    node.id = createId(node.type);
    idMap.set(originalId, node.id);
    node.name = node.name.endsWith(' copy') ? `${node.name.slice(0, -5)} copy 2` : `${node.name} copy`;
    for (const child of node.children ?? []) renew(child);
  };
  renew(duplicate);
  walkNodes([duplicate], ({ node }) => {
    for (const interaction of node.interactions || []) {
      if (idMap.has(interaction.destinationId)) interaction.destinationId = idMap.get(interaction.destinationId);
      if (idMap.has(interaction.scrollTargetId)) interaction.scrollTargetId = idMap.get(interaction.scrollTargetId);
    }
  });
  duplicate.x += 16;
  duplicate.y += 16;
  const list = entry.parent ? entry.parent.children : document.pages.find(page => page.id === pageId).children;
  list.splice(entry.index + 1, 0, duplicate);
  if (entry.parent === slotContext?.target) syncSlotChildOrder(slotContext, list);
  return duplicate;
}

/** Move a layer to another container, updating any overridden slot root order atomically. */
export function moveNode(document, nodeId, { parentId = null, index, pageId = document.activePageId } = {}) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return false;
  if (parentId === nodeId) throw new Error('A layer cannot be moved into itself.');
  const page = document.pages.find(item => item.id === pageId);
  if (!page) throw new Error('The target page no longer exists.');
  const parentEntry = parentId ? findNode(document, parentId, pageId) : null;
  const parent = parentEntry?.node || null;
  if (parentId && !parent) throw new Error('The target parent layer no longer exists.');
  assertSliceTreePlacement(entry.node, parent);
  if (parent && !['frame', 'section', 'group', 'boolean'].includes(parent.type)) throw new Error('This layer cannot contain other layers.');
  let parentInsideNode = false;
  walkNodes([entry.node], ({ node }) => { if (node.id === parentId) parentInsideNode = true; });
  if (parentInsideNode) throw new Error('A layer cannot be moved into one of its descendants.');

  const sourceContext = componentSlotMutationContext(document, entry);
  const destinationContext = componentSlotMutationContext(document, parentEntry);
  if (entry.parent === parent) return reorderNode(document, nodeId, index ?? entry.index, pageId);
  requireOverriddenSlotForMutation(sourceContext, 'move');
  requireOverriddenSlotForMutation(destinationContext, 'move layers into');
  if (sourceContext && entry.node === sourceContext.target) throw new Error('Cannot move a component slot target from its instance.');

  const sourceList = entry.parent ? entry.parent.children : page.children;
  const targetList = parent ? parent.children : page.children;
  const numericIndex = index == null ? targetList.length : Number(index);
  if (!Number.isInteger(numericIndex)) throw new TypeError('The layer order index must be an integer.');
  const insertAt = Math.max(0, Math.min(numericIndex, targetList.length));
  const [moving] = sourceList.splice(entry.index, 1);
  targetList.splice(insertAt, 0, moving);
  if (entry.parent === sourceContext?.target) syncSlotChildOrder(sourceContext, sourceList);
  if (parent === destinationContext?.target) syncSlotChildOrder(destinationContext, targetList);
  reconcilePrototypeScrollInteractions(document);
  return true;
}

/** Reorder a layer among its siblings using its final zero-based index. */
export function reorderNode(document, nodeId, index, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return false;
  if (!Number.isInteger(index)) throw new TypeError('The layer order index must be an integer.');
  const slotContext = componentSlotMutationContext(document, entry);
  const list = entry.parent ? entry.parent.children : document.pages.find(page => page.id === pageId)?.children;
  if (!list?.length) return false;
  const nextIndex = Math.max(0, Math.min(index, list.length - 1));
  if (nextIndex === entry.index) return false;
  const [moving] = list.splice(entry.index, 1);
  list.splice(nextIndex, 0, moving);
  if (entry.parent === slotContext?.target) syncSlotChildOrder(slotContext, list);
  return true;
}

function visualBounds(node) {
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  const angle = (node.rotation || 0) * Math.PI / 180;
  const extentX = Math.abs(node.width * Math.cos(angle)) / 2 + Math.abs(node.height * Math.sin(angle)) / 2;
  const extentY = Math.abs(node.width * Math.sin(angle)) / 2 + Math.abs(node.height * Math.cos(angle)) / 2;
  return { left: centerX - extentX, top: centerY - extentY, right: centerX + extentX, bottom: centerY + extentY };
}

/** Return whether the selected layers can be grouped without crossing containers. */
export function canGroupLayers(document, nodeIds, pageId = document.activePageId) {
  if (!Array.isArray(nodeIds) || nodeIds.length < 2 || new Set(nodeIds).size !== nodeIds.length) return false;
  const entries = nodeIds.map(id => findNode(document, id, pageId));
  if (entries.some(entry => !entry || entry.node.locked || entry.node.type === 'slice') || !slotAwareSiblingMutation(document, entries).allowed) return false;
  const parent = entries[0].parent;
  if (parent?.locked || parent?.type === 'boolean') return false;
  if (!entries.every(entry => entry.parent === parent)) return false;
  if (parent?.mask && nodeIds.includes(parent.maskSourceId)) return false;
  return true;
}

/** Group sibling layers while preserving their stack order and page-space geometry. */
export function groupLayers(document, nodeIds, pageId = document.activePageId) {
  if (!canGroupLayers(document, nodeIds, pageId)) throw new Error('Select at least two unlocked sibling layers in the same container.');
  const entries = nodeIds.map(id => findNode(document, id, pageId));
  const page = document.pages.find(item => item.id === pageId);
  const parent = entries[0].parent;
  const list = parent ? parent.children : page.children;
  const selectedIds = new Set(nodeIds);
  const selectedEntries = entries.map(entry => ({ ...entry, index: list.indexOf(entry.node) })).sort((a, b) => a.index - b.index);
  const bounds = selectedEntries.map(entry => visualBounds(entry.node));
  const left = Math.min(...bounds.map(item => item.left));
  const top = Math.min(...bounds.map(item => item.top));
  const right = Math.max(...bounds.map(item => item.right));
  const bottom = Math.max(...bounds.map(item => item.bottom));
  const children = selectedEntries.map(entry => {
    entry.node.x -= left;
    entry.node.y -= top;
    return entry.node;
  });
  const group = createNode('group', {
    name: 'Group', x: left, y: top,
    width: Math.max(1, right - left), height: Math.max(1, bottom - top),
    children
  });
  const frontmostIndex = selectedEntries.at(-1).index;
  const insertionIndex = list.slice(0, frontmostIndex).filter(node => !selectedIds.has(node.id)).length;
  for (const entry of selectedEntries.slice().reverse()) list.splice(entry.index, 1);
  list.splice(insertionIndex, 0, group);
  syncSlotChildOrder(slotAwareSiblingMutation(document, entries).context, list);
  return group;
}

/** Return whether a regular, editable group can be expanded into its siblings. */
export function canUngroupLayers(document, groupId, pageId = document.activePageId) {
  const entry = findNode(document, groupId, pageId);
  const slotMutation = entry && slotAwareSiblingMutation(document, [entry]);
  return Boolean(entry && entry.node.type === 'group' && !entry.node.mask && !entry.node.isComponent && !entry.node.isInstance
    && !entry.node.locked && entry.node.children?.length && entry.parent?.type !== 'boolean' && !entry.parent?.locked
    && slotMutation?.allowed);
}

/** Ungroup layers, applying the group's rotation before promoting its children. */
export function ungroupLayers(document, groupId, pageId = document.activePageId) {
  if (!canUngroupLayers(document, groupId, pageId)) throw new Error('Select an unlocked regular group that can be expanded.');
  const entry = findNode(document, groupId, pageId);
  const group = entry.node;
  const angle = (group.rotation || 0) * Math.PI / 180;
  const centerX = group.x + group.width / 2;
  const centerY = group.y + group.height / 2;
  for (const child of group.children) {
    const childCenterX = group.x + child.x + child.width / 2;
    const childCenterY = group.y + child.y + child.height / 2;
    const dx = childCenterX - centerX;
    const dy = childCenterY - centerY;
    child.x = centerX + dx * Math.cos(angle) - dy * Math.sin(angle) - child.width / 2;
    child.y = centerY + dx * Math.sin(angle) + dy * Math.cos(angle) - child.height / 2;
    child.rotation = (child.rotation || 0) + (group.rotation || 0);
    if (!group.visible) child.visible = false;
    if (group.opacity !== 1) child.opacity *= group.opacity;
  }
  const list = entry.parent ? entry.parent.children : document.pages.find(page => page.id === pageId).children;
  const slotContext = slotAwareSiblingMutation(document, [entry]).context;
  const children = group.children;
  list.splice(entry.index, 1, ...children);
  group.children = [];
  syncSlotChildOrder(slotContext, list);
  return children;
}

const layerAlignmentModes = new Set(['left', 'center-x', 'right', 'top', 'center-y', 'bottom', 'distribute-horizontal', 'distribute-vertical']);

/** Return whether sibling layers can be aligned without fighting a layout container. */
export function canAlignLayers(document, nodeIds, mode, pageId = document.activePageId) {
  if (!layerAlignmentModes.has(mode) || !Array.isArray(nodeIds) || nodeIds.length < 2 || new Set(nodeIds).size !== nodeIds.length) return false;
  if (mode.startsWith('distribute-') && nodeIds.length < 3) return false;
  const entries = nodeIds.map(id => findNode(document, id, pageId));
  if (entries.some(entry => !entry || entry.node.locked || entry.parents.some(parent => parent.isInstance))) return false;
  const parent = entries[0].parent;
  if (parent?.locked || parent?.type === 'boolean' || parent?.autoLayout) return false;
  return entries.every(entry => entry.parent === parent);
}

/** Align bounding edges or distribute sibling layers evenly along one axis. */
export function alignLayers(document, nodeIds, mode, pageId = document.activePageId) {
  if (!canAlignLayers(document, nodeIds, mode, pageId)) throw new Error('Select unlocked sibling layers outside an auto layout container.');
  const entries = nodeIds.map(id => findNode(document, id, pageId));
  const bounds = entries.map(entry => visualBounds(entry.node));
  if (mode.startsWith('distribute-')) {
    const horizontal = mode === 'distribute-horizontal';
    const start = horizontal ? 'left' : 'top';
    const end = horizontal ? 'right' : 'bottom';
    const size = horizontal ? 'width' : 'height';
    const ordered = entries.map((entry, index) => ({ entry, bounds: bounds[index] })).sort((a, b) => a.bounds[start] - b.bounds[start] || a.entry.index - b.entry.index);
    const first = ordered[0].bounds[start];
    const last = ordered.at(-1).bounds[end];
    const totalSize = ordered.reduce((sum, item) => sum + item.bounds[end] - item.bounds[start], 0);
    const gap = (last - first - totalSize) / (ordered.length - 1);
    let cursor = first;
    for (const item of ordered) {
      const delta = cursor - item.bounds[start];
      if (horizontal) item.entry.node.x += delta; else item.entry.node.y += delta;
      cursor += item.bounds[end] - item.bounds[start] + gap;
    }
    return ordered.map(item => item.entry.node);
  }

  const left = Math.min(...bounds.map(item => item.left));
  const right = Math.max(...bounds.map(item => item.right));
  const top = Math.min(...bounds.map(item => item.top));
  const bottom = Math.max(...bounds.map(item => item.bottom));
  const targetX = mode === 'left' ? left : mode === 'right' ? right : (left + right) / 2;
  const targetY = mode === 'top' ? top : mode === 'bottom' ? bottom : (top + bottom) / 2;
  for (const [index, entry] of entries.entries()) {
    if (['left', 'center-x', 'right'].includes(mode)) {
      const current = mode === 'left' ? bounds[index].left : mode === 'right' ? bounds[index].right : (bounds[index].left + bounds[index].right) / 2;
      entry.node.x += targetX - current;
    } else {
      const current = mode === 'top' ? bounds[index].top : mode === 'bottom' ? bounds[index].bottom : (bounds[index].top + bounds[index].bottom) / 2;
      entry.node.y += targetY - current;
    }
  }
  return entries.map(entry => entry.node);
}

function isBooleanOperand(node) {
  return booleanOperandTypes.has(node.type) && (node.type !== 'path' || hasOnlyClosedPathContours(node)) && (node.type !== 'network' || (node.faces || []).length > 0);
}

/** Return whether these layers can become one live, editable Boolean group. */
export function canCombineBoolean(document, nodeIds, pageId = document.activePageId) {
  if (!Array.isArray(nodeIds) || nodeIds.length < 2 || new Set(nodeIds).size !== nodeIds.length) return false;
  const entries = nodeIds.map(id => findNode(document, id, pageId));
  if (entries.some(entry => !entry || !isBooleanOperand(entry.node) || entry.node.locked)) return false;
  if (!slotAwareSiblingMutation(document, entries).allowed) return false;
  const parent = entries[0].parent;
  return entries.every(entry => entry.parent === parent);
}

/** Combine supported sibling shapes and text without flattening their editable source layers. */
export function combineBoolean(document, nodeIds, operation = 'union', pageId = document.activePageId) {
  if (!booleanOperations.has(operation)) throw new TypeError('Choose a supported Boolean operation.');
  if (!canCombineBoolean(document, nodeIds, pageId)) throw new Error('Select at least two unlocked, supported shape or text layers in the same container.');
  const entries = nodeIds.map(id => findNode(document, id, pageId));
  const page = document.pages.find(item => item.id === pageId);
  const parent = entries[0].parent;
  const list = parent ? parent.children : page.children;
  const selectedIds = new Set(nodeIds);
  const selectedEntries = entries.map(entry => ({ ...entry, index: list.indexOf(entry.node) })).sort((a, b) => a.index - b.index);
  const bounds = selectedEntries.map(entry => visualBounds(entry.node));
  const left = Math.min(...bounds.map(item => item.left));
  const top = Math.min(...bounds.map(item => item.top));
  const right = Math.max(...bounds.map(item => item.right));
  const bottom = Math.max(...bounds.map(item => item.bottom));
  const frontmost = selectedEntries.at(-1).node;
  const styleSource = operation === 'subtract' ? selectedEntries[0].node : frontmost;
  const operationNames = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' };
  const group = createNode('boolean', {
    name: `${operationNames[operation]} group`, operation,
    x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top),
    fill: styleSource.fill || '#d9d9d9', fillOpacity: styleSource.fillOpacity ?? 1,
    ...(styleSource.fillStyleId ? { fillStyleId: styleSource.fillStyleId } : {}),
    ...(styleSource.fillVariableId ? { fillVariableId: styleSource.fillVariableId } : {}),
    children: selectedEntries.map(entry => {
      entry.node.x -= left;
      entry.node.y -= top;
      return entry.node;
    })
  });
  const frontmostIndex = selectedEntries.at(-1).index;
  const insertionIndex = list.slice(0, frontmostIndex).filter(node => !selectedIds.has(node.id)).length;
  for (const entry of selectedEntries.slice().reverse()) list.splice(entry.index, 1);
  list.splice(insertionIndex, 0, group);
  syncSlotChildOrder(slotAwareSiblingMutation(document, entries).context, list);
  return group;
}

const maskSourceTypes = new Set(['rectangle', 'ellipse', 'star', 'polygon', 'path', 'network', 'boolean']);
function isMaskSource(node) {
  return Boolean(node && maskSourceTypes.has(node.type) && (node.type !== 'path' || hasFillablePathContour(node)) && (node.type !== 'network' || (node.faces || []).length > 0));
}

/** Return whether selected sibling layers can become a live alpha-mask group. */
export function canCreateMaskGroup(document, nodeIds, pageId = document.activePageId) {
  if (!Array.isArray(nodeIds) || nodeIds.length < 2 || new Set(nodeIds).size !== nodeIds.length) return false;
  const entries = nodeIds.map(id => findNode(document, id, pageId));
  if (entries.some(entry => !entry || entry.node.locked || entry.node.type === 'slice')) return false;
  if (!slotAwareSiblingMutation(document, entries).allowed) return false;
  const parent = entries[0].parent;
  if (!entries.every(entry => entry.parent === parent)) return false;
  const frontmost = entries.reduce((top, entry) => entry.index > top.index ? entry : top);
  return isMaskSource(frontmost.node);
}

/** Group sibling layers under the frontmost selected closed vector mask. */
export function createMaskGroup(document, nodeIds, pageId = document.activePageId) {
  if (!canCreateMaskGroup(document, nodeIds, pageId)) throw new Error('Select a closed vector shape and at least one unlocked sibling layer; the frontmost selected shape becomes the mask.');
  const entries = nodeIds.map(id => findNode(document, id, pageId));
  const page = document.pages.find(item => item.id === pageId);
  const parent = entries[0].parent;
  const list = parent ? parent.children : page.children;
  const selectedIds = new Set(nodeIds);
  const selectedEntries = entries.map(entry => ({ ...entry, index: list.indexOf(entry.node) })).sort((a, b) => a.index - b.index);
  const maskEntry = selectedEntries.at(-1);
  const bounds = selectedEntries.map(entry => visualBounds(entry.node));
  const left = Math.min(...bounds.map(item => item.left));
  const top = Math.min(...bounds.map(item => item.top));
  const right = Math.max(...bounds.map(item => item.right));
  const bottom = Math.max(...bounds.map(item => item.bottom));
  const children = selectedEntries.map(entry => {
    entry.node.x -= left;
    entry.node.y -= top;
    return entry.node;
  });
  const group = createNode('group', {
    name: 'Mask group', x: left, y: top,
    width: Math.max(1, right - left), height: Math.max(1, bottom - top),
    mask: true, maskSourceId: maskEntry.node.id, children
  });
  const insertionIndex = list.slice(0, maskEntry.index).filter(node => !selectedIds.has(node.id)).length;
  for (const entry of selectedEntries.slice().reverse()) list.splice(entry.index, 1);
  list.splice(insertionIndex, 0, group);
  syncSlotChildOrder(slotAwareSiblingMutation(document, entries).context, list);
  return group;
}

/** Remove a mask group while restoring every source layer to the page stack. */
export function releaseMaskGroup(document, groupId, pageId = document.activePageId) {
  const entry = findNode(document, groupId, pageId);
  if (!entry || entry.node.type !== 'group' || !entry.node.mask || entry.node.children.length < 2) throw new Error('Select a valid mask group to release.');
  const slotContext = componentSlotMutationContext(document, entry);
  requireOverriddenSlotForMutation(slotContext, 'release');
  if (slotContext && entry.node === slotContext.target) throw new Error('Cannot replace a component slot target from its instance.');
  const group = entry.node;
  const children = group.children;
  const angle = (group.rotation || 0) * Math.PI / 180;
  const centerX = group.x + group.width / 2;
  const centerY = group.y + group.height / 2;
  for (const child of children) {
    const childCenterX = group.x + child.x + child.width / 2;
    const childCenterY = group.y + child.y + child.height / 2;
    const dx = childCenterX - centerX;
    const dy = childCenterY - centerY;
    child.x = centerX + dx * Math.cos(angle) - dy * Math.sin(angle) - child.width / 2;
    child.y = centerY + dx * Math.sin(angle) + dy * Math.cos(angle) - child.height / 2;
    child.rotation = (child.rotation || 0) + (group.rotation || 0);
  }
  const list = entry.parent ? entry.parent.children : document.pages.find(page => page.id === pageId).children;
  list.splice(entry.index, 1, ...children);
  group.children = [];
  if (entry.parent === slotContext?.target) syncSlotChildOrder(slotContext, list);
  return children;
}

/** Restore a Boolean group's source layers while keeping the visible group transform. */
export function separateBoolean(document, nodeId, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry || entry.node.type !== 'boolean') throw new Error('Select a Boolean group to separate.');
  const slotContext = componentSlotMutationContext(document, entry);
  requireOverriddenSlotForMutation(slotContext, 'separate');
  if (slotContext && entry.node === slotContext.target) throw new Error('Cannot replace a component slot target from its instance.');
  const group = entry.node;
  const children = group.children || [];
  if (children.length < 2) throw new Error('This Boolean group has no source shapes to separate.');
  const bounds = children.map(visualBounds);
  const sourceLeft = Math.min(...bounds.map(item => item.left));
  const sourceTop = Math.min(...bounds.map(item => item.top));
  const sourceWidth = Math.max(1, Math.max(...bounds.map(item => item.right)) - sourceLeft);
  const sourceHeight = Math.max(1, Math.max(...bounds.map(item => item.bottom)) - sourceTop);
  const scaleX = group.width / sourceWidth;
  const scaleY = group.height / sourceHeight;
  const rotation = (group.rotation || 0) * Math.PI / 180;
  const parentCenter = { x: group.x + group.width / 2, y: group.y + group.height / 2 };
  for (const child of children) {
    const width = child.width * scaleX;
    const height = child.height * scaleY;
    const center = {
      x: group.x + (child.x - sourceLeft + child.width / 2) * scaleX,
      y: group.y + (child.y - sourceTop + child.height / 2) * scaleY
    };
    const dx = center.x - parentCenter.x;
    const dy = center.y - parentCenter.y;
    child.x = parentCenter.x + dx * Math.cos(rotation) - dy * Math.sin(rotation) - width / 2;
    child.y = parentCenter.y + dx * Math.sin(rotation) + dy * Math.cos(rotation) - height / 2;
    child.width = width;
    child.height = height;
    child.rotation = (child.rotation || 0) + (group.rotation || 0);
  }
  const list = entry.parent ? entry.parent.children : document.pages.find(page => page.id === pageId).children;
  list.splice(entry.index, 1, ...children);
  group.children = [];
  if (entry.parent === slotContext?.target) syncSlotChildOrder(slotContext, list);
  return children;
}

const booleanBakePlans = new WeakMap();

/** Prepare a non-mutating Boolean bake so the editor can checkpoint only after geometry succeeds. */
export function prepareBooleanBake(document, nodeId, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry || entry.node.type !== 'boolean') throw new Error('Select a Boolean group to bake.');
  const group = entry.node;
  if (group.locked) throw new Error('Unlock the Boolean group before baking it.');
  if (group.isComponent || group.isInstance || entry.parents.some(parent => parent.isComponent || parent.isInstance)) {
    throw new Error('Boolean baking is not available inside component masters or instances. Detach the component first.');
  }
  const slotContext = componentSlotMutationContext(document, entry);
  requireOverriddenSlotForMutation(slotContext, 'bake');
  if (slotContext && group === slotContext.target) throw new Error('Cannot replace a component slot target from its instance.');
  const geometryBindings = ['width', 'height'];
  if (geometryBindings.some(property => group.variableBindings?.[property])) {
    throw new Error('This Boolean group has mode-bound dimensions. Remove those bindings before baking it.');
  }
  const verifyChildren = node => {
    if (node.isComponent || node.isInstance) throw new Error('Boolean baking cannot remove a component or instance layer from the source geometry. Detach the component first.');
    if (['x', 'y', 'width', 'height', 'rotation', 'radius'].some(property => node.variableBindings?.[property])) {
      throw new Error(`“${node.name || node.type}” has mode-bound geometry. Remove those bindings before baking the group.`);
    }
    for (const child of node.children || []) verifyChildren(child);
  };
  for (const child of group.children || []) verifyChildren(child);
  const contours = flattenBooleanPathContours(group);
  const geometry = normalizedPathGeometryFromCurveContours(contours, group.width, group.height);
  const plan = Object.freeze({ nodeId: group.id, pageId });
  booleanBakePlans.set(plan, { expected: JSON.stringify(group), geometry });
  return plan;
}

/** Commit one prepared Boolean result as native, editable path geometry in place. */
export function applyBooleanBake(document, plan) {
  const prepared = booleanBakePlans.get(plan);
  if (!prepared) throw new TypeError('Prepare a Boolean bake before committing it.');
  const entry = findNode(document, plan.nodeId, plan.pageId);
  if (!entry || entry.node.type !== 'boolean' || JSON.stringify(entry.node) !== prepared.expected) {
    throw new Error('The Boolean group changed after the bake was prepared. Prepare it again before committing.');
  }
  const node = entry.node;
  Object.assign(node, { type: 'path', ...prepared.geometry, children: [] });
  delete node.operation;
  booleanBakePlans.delete(plan);
  return node;
}

/** Bake a supported live Boolean group into one editable vector path. */
export function bakeBoolean(document, nodeId, pageId = document.activePageId) {
  return applyBooleanBake(document, prepareBooleanBake(document, nodeId, pageId));
}

export function renameNode(document, nodeId, name, pageId = document.activePageId) {
  return updateNode(document, nodeId, { name: String(name).trim() || 'Untitled layer' }, pageId);
}

export function createImageRecipe(imageNode, name, output = {}, document = null) {
  if (!imageNode || imageNode.type !== 'image') throw new TypeError('Recipes can only be created from an image layer.');
  const fit = imageNode.fit ?? 'cover';
  if (imageNode.variableBindings?.opacity && !document) {
    throw new TypeError('The design is required to save the visible opacity of a variable-bound image.');
  }
  const opacity = document ? getNodePropertyValue(document, imageNode, 'opacity') ?? imageNode.opacity ?? 1 : imageNode.opacity ?? 1;
  const blendMode = imageNode.blendMode ?? 'normal';
  const effects = clone(imageNode.effects || []);
  if (!['cover', 'contain'].includes(fit)) throw new TypeError('Image recipe fit must be Fill or Fit.');
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new TypeError('Image recipe opacity must be between 0 and 1.');
  if (!isValidLayerBlendMode(blendMode)) throw new TypeError('Image recipe blend mode is invalid.');
  if (!isValidLayerEffects(effects)) throw new TypeError('Image recipe effect stack is invalid.');
  const format = output.format ?? imageNode.outputFormat ?? 'png';
  const quality = output.quality ?? imageNode.outputQuality ?? 90;
  if (!exportFormats.has(format)) throw new TypeError('Image recipe output format must be PNG, JPEG, or WebP.');
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new TypeError('Image recipe quality must be an integer from 1 to 100.');
  return {
    id: createId('recipe'),
    name: String(name).trim() || `${imageNode.name} recipe`,
    adjustments: normalizeImageAdjustments(imageNode.adjustments || {}),
    transforms: createImageTransforms(imageNode.transforms || {}),
    fit,
    opacity,
    effects,
    blendMode,
    format,
    quality,
    createdAt: new Date().toISOString()
  };
}

export function applyImageRecipe(document, nodeId, recipe, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry || entry.node.type !== 'image') return false;
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) throw new TypeError('Image recipe must be an object.');
  const format = recipe.format ?? 'png';
  const quality = recipe.quality ?? 90;
  if (!exportFormats.has(format)) throw new TypeError('Image recipe output format must be PNG, JPEG, or WebP.');
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new TypeError('Image recipe quality must be an integer from 1 to 100.');
  const fit = recipe.fit ?? entry.node.fit ?? 'cover';
  const opacity = recipe.opacity ?? entry.node.opacity ?? 1;
  const hasOpacity = Object.hasOwn(recipe, 'opacity') && recipe.opacity != null;
  const hasEffects = recipe.effects != null;
  const blendMode = recipe.blendMode ?? entry.node.blendMode ?? 'normal';
  if (!['cover', 'contain'].includes(fit)) throw new TypeError('Image recipe fit must be Fill or Fit.');
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new TypeError('Image recipe opacity must be between 0 and 1.');
  if (!isValidLayerBlendMode(blendMode)) throw new TypeError('Image recipe blend mode is invalid.');
  if (hasEffects && !isValidLayerEffects(recipe.effects)) throw new TypeError('Image recipe effect stack is invalid.');
  // Normalize every recipe field before mutation so malformed data cannot leave
  // a partially-applied image look behind.
  const adjustments = normalizeImageAdjustments(recipe.adjustments || {});
  const transforms = createImageTransforms(recipe.transforms || {});
  const effects = hasEffects
    ? recipe.effects.map(effect => ({ ...clone(effect), id: createId('effect') }))
    : null;
  const variableBindings = entry.node.variableBindings ? { ...entry.node.variableBindings } : null;
  if (hasOpacity && variableBindings) delete variableBindings.opacity;

  entry.node.adjustments = adjustments;
  entry.node.transforms = transforms;
  entry.node.fit = fit;
  entry.node.opacity = opacity;
  entry.node.outputFormat = format;
  entry.node.outputQuality = quality;
  if (hasEffects) entry.node.effects = effects;
  if (recipe.blendMode != null) entry.node.blendMode = blendMode;
  if (hasOpacity && entry.node.variableBindings?.opacity) {
    if (variableBindings && Object.keys(variableBindings).length) entry.node.variableBindings = variableBindings;
    else delete entry.node.variableBindings;
  }
  return true;
}

export function createVariableCollection(document, name = 'Colors') {
  const mode = { id: createId('mode'), name: 'Mode 1' };
  const collection = {
    id: createId('collection'), name: String(name).trim() || 'Colors',
    defaultModeId: mode.id, modes: [mode]
  };
  document.variableCollections ||= [];
  document.variableCollections.push(collection);
  return collection;
}

export function addVariableMode(document, collectionId, name = null) {
  const collection = document.variableCollections?.find(item => item.id === collectionId);
  if (!collection) throw new Error('The variable collection no longer exists.');
  const nextName = String(name || `Mode ${collection.modes.length + 1}`).trim();
  if (!nextName || collection.modes.some(mode => mode.name.toLowerCase() === nextName.toLowerCase())) throw new TypeError('Choose a unique name for this mode.');
  const mode = { id: createId('mode'), name: nextName };
  const sourceModeId = collection.defaultModeId;
  collection.modes.push(mode);
  for (const variable of document.variables || []) {
    if (variable.collectionId !== collectionId) continue;
    variable.valuesByMode[mode.id] = variable.valuesByMode[sourceModeId];
    if (variable.aliasesByMode?.[sourceModeId]) {
      variable.aliasesByMode ||= {};
      variable.aliasesByMode[mode.id] = variable.aliasesByMode[sourceModeId];
    }
  }
  return mode;
}

export function createVariable(document, collectionId, name, type = 'color', value = defaultVariableValue(type)) {
  const collection = document.variableCollections?.find(item => item.id === collectionId);
  if (!collection) throw new Error('The variable collection no longer exists.');
  if (!variableTypes.has(type) || !isVariableValue(type, value)) throw new TypeError(`Invalid ${type} variable value.`);
  const nextName = String(name).trim() || `${type[0].toUpperCase()}${type.slice(1)} ${(document.variables || []).filter(item => item.collectionId === collectionId).length + 1}`;
  if ((document.variables || []).some(variable => variable.collectionId === collectionId && variable.name.toLowerCase() === nextName.toLowerCase())) throw new TypeError('A variable with that name already exists in this collection.');
  const valuesByMode = Object.fromEntries(collection.modes.map(mode => [mode.id, value]));
  const variable = { id: createId('variable'), collectionId, name: nextName, type, valuesByMode };
  document.variables ||= [];
  document.variables.push(variable);
  return variable;
}

export function createColorVariable(document, collectionId, name, value = '#1e1e1e') {
  return createVariable(document, collectionId, name, 'color', value);
}

export function setVariableValue(document, variableId, value, modeId = null) {
  const variable = document.variables?.find(item => item.id === variableId);
  const collection = variable && document.variableCollections?.find(item => item.id === variable.collectionId);
  if (!variable || !collection || !isVariableValue(variable.type, value)) return false;
  const targetModeId = modeId || collection.defaultModeId;
  if (!collection.modes.some(mode => mode.id === targetModeId)) return false;
  const previousValue = variable.valuesByMode[targetModeId];
  const previousAliasId = variable.aliasesByMode?.[targetModeId];
  variable.valuesByMode[targetModeId] = value;
  if (variable.aliasesByMode) {
    delete variable.aliasesByMode[targetModeId];
    if (!Object.keys(variable.aliasesByMode).length) delete variable.aliasesByMode;
  }
  if (!variableBindingsAreValid(document)) {
    variable.valuesByMode[targetModeId] = previousValue;
    if (previousAliasId) { variable.aliasesByMode ||= {}; variable.aliasesByMode[targetModeId] = previousAliasId; }
    return false;
  }
  return true;
}

export function setColorVariableValue(document, variableId, value, modeId = null) {
  const normalized = typeof value === 'string' ? value : String(value);
  const variable = document.variables?.find(item => item.id === variableId);
  if (!variable || variable.type !== 'color') return false;
  return setVariableValue(document, variableId, normalized, modeId);
}

function variableAliasesHaveCycle(variables) {
  const byId = new Map(variables.map(variable => [variable.id, variable]));
  const indegree = new Map(variables.map(variable => [variable.id, 0]));
  for (const variable of variables) for (const targetId of new Set(Object.values(variable.aliasesByMode || {}))) {
    if (indegree.has(targetId)) indegree.set(targetId, indegree.get(targetId) + 1);
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  for (let index = 0; index < ready.length; index += 1) {
    const variable = byId.get(ready[index]);
    visited += 1;
    for (const targetId of new Set(Object.values(variable.aliasesByMode || {}))) {
      if (!indegree.has(targetId)) continue;
      const count = indegree.get(targetId) - 1;
      indegree.set(targetId, count);
      if (count === 0) ready.push(targetId);
    }
  }
  return visited !== variables.length;
}

function variableBindingsAreValid(document) {
  let valid = true;
  for (const page of document.pages || []) walkNodes(page.children || [], ({ node }) => {
    for (const [property, variableId] of Object.entries(node.variableBindings || {})) {
      const variable = document.variables?.find(item => item.id === variableId);
      const collection = variable && document.variableCollections?.find(item => item.id === variable.collectionId);
      if (!variable || !collection || !canBindVariableToNode(node, property) || variable.type !== variableBindingSpecs[property]?.type) { valid = false; return; }
      for (const mode of collection.modes) {
        const value = resolveVariableValueInternal(document, variable.id, node, new Map([[collection.id, mode.id]]), new Set());
        if (!isVariableBindingValue(property, value)) { valid = false; return; }
      }
    }
  });
  return valid;
}

export function setVariableAlias(document, variableId, targetVariableId, modeId = null) {
  const variable = document.variables?.find(item => item.id === variableId);
  const collection = variable && document.variableCollections?.find(item => item.id === variable.collectionId);
  const target = targetVariableId ? document.variables?.find(item => item.id === targetVariableId) : null;
  if (!variable || !collection || (targetVariableId && (!target || target.id === variable.id || target.type !== variable.type))) return false;
  const targetModeId = modeId || collection.defaultModeId;
  if (!collection.modes.some(mode => mode.id === targetModeId)) return false;
  variable.aliasesByMode ||= {};
  const previousTargetId = variable.aliasesByMode[targetModeId];
  if (targetVariableId) variable.aliasesByMode[targetModeId] = targetVariableId;
  else delete variable.aliasesByMode[targetModeId];
  if (variableAliasesHaveCycle(document.variables || []) || !variableBindingsAreValid(document)) {
    if (previousTargetId) variable.aliasesByMode[targetModeId] = previousTargetId;
    else delete variable.aliasesByMode[targetModeId];
    if (!Object.keys(variable.aliasesByMode).length) delete variable.aliasesByMode;
    return false;
  }
  if (!Object.keys(variable.aliasesByMode).length) delete variable.aliasesByMode;
  return true;
}

function resolveVariableValueInternal(document, variableId, node, modeOverrides, resolving) {
  if (resolving.has(variableId)) return null;
  const variable = document.variables?.find(item => item.id === variableId);
  const collection = variable && document.variableCollections?.find(item => item.id === variable.collectionId);
  if (!variable || !collection) return null;
  const requestedModeId = modeOverrides.get(collection.id);
  const modeId = requestedModeId && collection.modes.some(mode => mode.id === requestedModeId)
    ? requestedModeId : variableModeForNode(document, collection.id, node);
  const targetId = variable.aliasesByMode?.[modeId];
  if (targetId) {
    resolving.add(variableId);
    const value = resolveVariableValueInternal(document, targetId, node, modeOverrides, resolving);
    resolving.delete(variableId);
    return value;
  }
  return variable.valuesByMode?.[modeId] ?? variable.valuesByMode?.[collection.defaultModeId] ?? null;
}

export function resolveVariableValue(document, variableId, node = null) {
  return resolveVariableValueInternal(document, variableId, node, new Map(), new Set());
}

/** Resolve a variable using explicit per-collection mode overrides before frame modes. */
export function resolveVariableValueWithModeOverrides(document, variableId, modeOverrides = {}, node = null) {
  const overrides = modeOverrides instanceof Map
    ? modeOverrides
    : new Map(Object.entries(modeOverrides && typeof modeOverrides === 'object' && !Array.isArray(modeOverrides) ? modeOverrides : {}));
  return resolveVariableValueInternal(document, variableId, node, overrides, new Set());
}

export function getNodePropertyValue(document, node, property) {
  if (!node) return undefined;
  const variableId = node.variableBindings?.[property];
  if (!variableId || !canBindVariableToNode(node, property)) return readNodePropertyPath(node, property);
  const variable = document.variables?.find(item => item.id === variableId);
  if (!variable || variable.type !== variableBindingSpecs[property].type) return readNodePropertyPath(node, property);
  const value = resolveVariableValue(document, variableId, node);
  return isVariableBindingValue(property, value) ? value : readNodePropertyPath(node, property);
}

/** Return the current mode-resolved transform fields for a layer. */
export function getNodeGeometry(document, node) {
  if (!node) return undefined;
  return Object.fromEntries(['x', 'y', 'width', 'height', 'rotation'].map(property => [
    property, getNodePropertyValue(document, node, property)
  ]));
}

export function canBindVariable(document, nodeId, variableId, property, pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  if (!node || !canBindVariableToNode(node, property)) return false;
  if (!variableId) return true;
  const variable = document.variables?.find(item => item.id === variableId);
  const collection = variable && document.variableCollections?.find(item => item.id === variable.collectionId);
  const spec = variableBindingSpecs[property];
  if (!variable || !collection || variable.type !== spec.type) return false;
  for (const mode of collection.modes) {
    const value = resolveVariableValueInternal(document, variable.id, node, new Map([[collection.id, mode.id]]), new Set());
    if (!isVariableBindingValue(property, value)) return false;
  }
  return true;
}

export function bindVariable(document, nodeId, variableId, property, pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  if (!canBindVariable(document, nodeId, variableId, property, pageId)) return false;
  if (!variableId) {
    const value = getNodePropertyValue(document, node, property);
    if (isVariableBindingValue(property, value)) writeNodePropertyPath(node, property, value);
    if (node.variableBindings) {
      delete node.variableBindings[property];
      if (!Object.keys(node.variableBindings).length) delete node.variableBindings;
    }
    return true;
  }
  node.variableBindings ||= {};
  node.variableBindings[property] = variableId;
  return true;
}

function materializeVariableBindingsToRemovedVariables(document, removedIds) {
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    for (const [property, variableId] of Object.entries(node.variableBindings || {})) {
      if (!removedIds.has(variableId)) continue;
      const value = getNodePropertyValue(document, node, property);
      if (isVariableBindingValue(property, value)) writeNodePropertyPath(node, property, value);
      delete node.variableBindings[property];
    }
    if (!Object.keys(node.variableBindings || {}).length) delete node.variableBindings;
  });
}

function materializeAliasesToRemovedVariables(document, removedIds) {
  for (const variable of document.variables || []) {
    if (removedIds.has(variable.id)) continue;
    const collection = document.variableCollections.find(item => item.id === variable.collectionId);
    for (const [modeId, targetId] of Object.entries(variable.aliasesByMode || {})) {
      if (!removedIds.has(targetId)) continue;
      const value = resolveVariableValueInternal(document, variable.id, null, new Map([[collection.id, modeId]]), new Set());
      if (isVariableValue(variable.type, value)) variable.valuesByMode[modeId] = value;
      delete variable.aliasesByMode[modeId];
    }
    if (!Object.keys(variable.aliasesByMode || {}).length) delete variable.aliasesByMode;
  }
}

function removePrototypeInteractionsUsingVariables(document, removedIds) {
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    if (!Array.isArray(node.interactions)) return;
    node.interactions = node.interactions.filter(interaction => !removedIds.has(interaction.condition?.variableId));
    if (!node.interactions.length) delete node.interactions;
  });
}

function removePrototypeInteractionsUsingNodes(document, removedIds) {
  for (const page of document.pages) walkNodes(page.children, ({ node, parents }) => {
    if (!Array.isArray(node.interactions)) return;
    const retained = node.interactions.filter(interaction => !removedIds.has(interaction.scrollTargetId));
    if (retained.length === node.interactions.length) return;
    if (retained.length) node.interactions = retained;
    else delete node.interactions;
    if (node.componentSourceId) {
      const instanceRoot = [...parents, node].reverse().find(candidate => candidate.isInstance);
      const override = instanceRoot?.componentOverrides?.[node.componentSourceId];
      if (override && Object.hasOwn(override, 'interactions')) {
        if (retained.length) override.interactions = clone(retained);
        else delete override.interactions;
      }
    }
  });
}

function clearVariableReferencesFromComponentOverrides(document, variableIds, collectionId = null) {
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    if (!node.componentOverrides) return;
    for (const overrides of Object.values(node.componentOverrides)) {
      for (const property of ['fillVariableId', 'textVariableId', 'strokeVariableId']) if (variableIds.has(overrides[property])) delete overrides[property];
      for (const [property, variableId] of Object.entries(overrides.variableBindings || {})) if (variableIds.has(variableId)) delete overrides.variableBindings[property];
      if (!Object.keys(overrides.variableBindings || {}).length) delete overrides.variableBindings;
      if (collectionId && overrides.variableModes) {
        delete overrides.variableModes[collectionId];
        if (!Object.keys(overrides.variableModes).length) delete overrides.variableModes;
      }
    }
    for (const [sourceId, overrides] of Object.entries(node.componentOverrides)) if (!Object.keys(overrides).length) delete node.componentOverrides[sourceId];
    if (!Object.keys(node.componentOverrides).length) delete node.componentOverrides;
  });
}

export function deleteVariable(document, variableId) {
  const index = (document.variables || []).findIndex(variable => variable.id === variableId);
  if (index < 0) return false;
  materializeAliasesToRemovedVariables(document, new Set([variableId]));
  materializeVariableBindingsToRemovedVariables(document, new Set([variableId]));
  document.variables.splice(index, 1);
  removePrototypeInteractionsUsingVariables(document, new Set([variableId]));
  const properties = ['fillVariableId', 'textVariableId', 'strokeVariableId'];
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    for (const property of properties) if (node[property] === variableId) delete node[property];
  });
  clearVariableReferencesFromComponentOverrides(document, new Set([variableId]));
  return true;
}

export function deleteVariableCollection(document, collectionId) {
  const index = (document.variableCollections || []).findIndex(collection => collection.id === collectionId);
  if (index < 0) return false;
  const variableIds = new Set((document.variables || []).filter(variable => variable.collectionId === collectionId).map(variable => variable.id));
  materializeAliasesToRemovedVariables(document, variableIds);
  materializeVariableBindingsToRemovedVariables(document, variableIds);
  document.variables = (document.variables || []).filter(variable => variable.collectionId !== collectionId);
  removePrototypeInteractionsUsingVariables(document, variableIds);
  document.variableCollections.splice(index, 1);
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    for (const property of ['fillVariableId', 'textVariableId', 'strokeVariableId']) if (variableIds.has(node[property])) delete node[property];
    if (node.variableModes) { delete node.variableModes[collectionId]; if (!Object.keys(node.variableModes).length) delete node.variableModes; }
  });
  clearVariableReferencesFromComponentOverrides(document, variableIds, collectionId);
  return true;
}

export function setFrameVariableMode(document, frameId, collectionId, modeId = null, pageId = document.activePageId) {
  const frame = findNode(document, frameId, pageId)?.node;
  const collection = document.variableCollections?.find(item => item.id === collectionId);
  if (!frame || frame.type !== 'frame' || !collection || (modeId && !collection.modes.some(mode => mode.id === modeId))) return false;
  const previousModes = frame.variableModes ? { ...frame.variableModes } : null;
  frame.variableModes ||= {};
  if (modeId) frame.variableModes[collectionId] = modeId;
  else delete frame.variableModes[collectionId];
  if (!variableBindingsAreValid(document)) {
    if (previousModes) frame.variableModes = previousModes;
    else delete frame.variableModes;
    return false;
  }
  if (!Object.keys(frame.variableModes).length) delete frame.variableModes;
  return true;
}

export function variableModeForNode(document, collectionId, node) {
  const collection = document.variableCollections?.find(item => item.id === collectionId);
  if (!collection) return null;
  const entry = node?.id ? findNodeAcrossPages(document, node.id) : null;
  const frames = [...(entry?.parents || []), ...(node?.type === 'frame' ? [node] : [])].filter(parent => parent.type === 'frame');
  let modeId = collection.defaultModeId;
  for (const frame of frames) if (frame.variableModes?.[collectionId]) modeId = frame.variableModes[collectionId];
  return collection.modes.some(mode => mode.id === modeId) ? modeId : collection.defaultModeId;
}

export function resolveColorVariable(document, variableId, node = null) {
  const variable = document.variables?.find(item => item.id === variableId && item.type === 'color');
  if (!variable) return null;
  const value = resolveVariableValue(document, variable.id, node);
  return isVariableValue('color', value) ? value : null;
}

export function bindColorVariable(document, nodeId, variableId, kind = 'fill', pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  const variable = variableId ? document.variables?.find(item => item.id === variableId && item.type === 'color') : null;
  const properties = { fill: 'fillVariableId', text: 'textVariableId', stroke: 'strokeVariableId' };
  const property = properties[kind];
  if (!node || !property || (variableId && !variable)) return false;
  const compatible = kind === 'text' ? node.type === 'text'
    : kind === 'fill' ? !['text', 'image', 'line'].includes(node.type) && (node.type !== 'path' || hasFillablePathContour(node)) && (node.type !== 'network' || (node.faces || []).length > 0)
      : !['text', 'image', 'group', 'boolean'].includes(node.type);
  if (!compatible) return false;
  if (variableId) {
    node[property] = variableId;
    if (kind === 'fill') delete node.fillStyleId;
    if (kind === 'text') delete node.textStyleId;
  } else delete node[property];
  return true;
}

export function getNodeColor(document, node, kind = node?.type === 'text' ? 'text' : 'fill') {
  if (!node) return '#000000';
  const variableId = kind === 'text' ? node.textVariableId : kind === 'stroke' ? node.strokeVariableId : node.fillVariableId;
  const variableValue = resolveColorVariable(document, variableId, node);
  if (variableValue) return variableValue;
  const styleId = kind === 'text' ? node.textStyleId : kind === 'stroke' ? null : node.fillStyleId;
  const style = (document.colorStyles || []).find(item => item.id === styleId && item.kind === kind);
  if (style) return style.value;
  return kind === 'text' ? (node.color || '#1e1e1e') : kind === 'stroke' ? (node.stroke || '#1e1e1e') : (node.fill || '#ffffff');
}

export function createColorStyle(document, nodeId, name, pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  if (!node) throw new Error('Select a layer before creating a color style.');
  if (node.type === 'network' && !(node.faces || []).length) throw new TypeError('Open vector networks use stroke styles; close a region before creating a fill style.');
  const kind = node.type === 'text' ? 'text' : 'fill';
  const value = getNodeColor(document, node, kind);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('Color styles require a solid six-digit color.');
  const style = { id: createId('style'), name: String(name).trim() || `${node.name} color`, kind, value };
  document.colorStyles ||= [];
  document.colorStyles.push(style);
  if (kind === 'text') { delete node.textVariableId; node.textStyleId = style.id; }
  else { delete node.fillVariableId; node.fillStyleId = style.id; }
  return style;
}

export function applyColorStyle(document, nodeId, styleId, pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  const style = document.colorStyles?.find(item => item.id === styleId);
  if (!node || !style) return false;
  if (style.kind === 'text' && node.type === 'text') { delete node.textVariableId; node.textStyleId = style.id; }
  else if (style.kind === 'fill' && !['text', 'image', 'line', 'path'].includes(node.type) && (node.type !== 'network' || (node.faces || []).length > 0)) { delete node.fillVariableId; node.fillStyleId = style.id; }
  else return false;
  return true;
}

const typographyStyleProperties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'firstLineIndent', 'listSpacing', 'align', 'verticalAlign', 'color', 'textCase', 'textDecoration'];

function typographyStyleValues(document, node) {
  return {
    fontFamily: getNodePropertyValue(document, node, 'fontFamily') || 'Arial, sans-serif',
    fontSize: getNodePropertyValue(document, node, 'fontSize') || 24,
    fontWeight: Number(getNodePropertyValue(document, node, 'fontWeight')) || 400,
    fontStyle: getNodePropertyValue(document, node, 'fontStyle') || 'normal',
    lineHeight: getNodePropertyValue(document, node, 'lineHeight') || 1.25,
    letterSpacing: getNodePropertyValue(document, node, 'letterSpacing') ?? 0,
    paragraphSpacing: Number(node.paragraphSpacing) || 0,
    firstLineIndent: Number(node.firstLineIndent) || 0,
    listSpacing: Number(node.listSpacing) || 0,
    align: node.align || 'left',
    verticalAlign: textVerticalAlignments.has(node.verticalAlign) ? node.verticalAlign : 'top',
    color: getNodeColor(document, node, 'text'),
    textCase: textCases.has(node.textCase) ? node.textCase : 'none',
    textDecoration: textDecorations.has(node.textDecoration) ? node.textDecoration : 'none'
  };
}

export function createTypographyStyle(document, nodeId, name, pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  if (!node || node.type !== 'text') throw new Error('Select a text layer before saving a text style.');
  document.typographyStyles ||= [];
  if (document.typographyStyles.length >= 1000) throw new Error('A design can contain up to 1,000 text styles.');
  const styleName = String(name ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim() || `${node.name} text`;
  const style = { id: createId('typography'), name: styleName.slice(0, 120), ...typographyStyleValues(document, node) };
  document.typographyStyles.push(style);
  return style;
}

export function applyTypographyStyle(document, nodeId, styleId, pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  const style = document.typographyStyles?.find(item => item.id === styleId);
  if (!node || node.type !== 'text' || !style) return false;
  for (const property of typographyStyleProperties) {
    if (property === 'paragraphSpacing' || property === 'firstLineIndent' || property === 'listSpacing') node[property] = Number(style[property]) || 0;
    else node[property] = style[property];
  }
  node.textVariableId = null;
  node.textStyleId = null;
  node.variableBindings ||= {};
  for (const property of ['fontSize', 'lineHeight', 'letterSpacing']) delete node.variableBindings[property];
  node.textCase = textCases.has(style.textCase) ? style.textCase : 'none';
  node.verticalAlign = textVerticalAlignments.has(style.verticalAlign) ? style.verticalAlign : 'top';
  node.textDecoration = textDecorations.has(style.textDecoration) ? style.textDecoration : 'none';
  return true;
}

export function updateTypographyStyle(document, styleId, nodeId, pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  const style = document.typographyStyles?.find(item => item.id === styleId);
  if (!node || node.type !== 'text' || !style) return false;
  Object.assign(style, typographyStyleValues(document, node));
  return true;
}

const MAX_EFFECT_STYLES = 1000;

function effectStyleName(name, fallback) {
  const cleaned = String(name ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  const safeFallback = String(fallback ?? 'Effect style').replace(/[\x00-\x1f\x7f]/g, ' ').trim() || 'Effect style';
  return (cleaned || safeFallback).slice(0, 120);
}

/** Save the selected layer's complete ordered effect stack as a reusable snapshot. */
export function createEffectStyle(document, nodeId, name, pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  if (!node) throw new Error('Select a layer before saving an effect style.');
  const effects = node.effects || [];
  if (!isValidLayerEffects(effects)) throw new TypeError('The selected layer has an invalid effect stack.');
  document.effectStyles ||= [];
  if (document.effectStyles.length >= MAX_EFFECT_STYLES) throw new Error(`A design can contain up to ${MAX_EFFECT_STYLES.toLocaleString()} effect styles.`);
  const style = {
    id: createId('effect-style'),
    name: effectStyleName(name, `${node.name} effects`),
    effects: clone(effects)
  };
  document.effectStyles.push(style);
  return style;
}

/** Apply a detached copy of a named ordered effect stack to one layer. */
export function applyEffectStyle(document, nodeId, styleId, pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  const style = document.effectStyles?.find(item => item.id === styleId);
  if (!node || !style || !isValidLayerEffects(style.effects)) return false;
  node.effects = style.effects.map(effect => ({ ...clone(effect), id: createId('effect') }));
  return true;
}

/** Replace a named effect style with the selected layer's current ordered stack. */
export function updateEffectStyle(document, styleId, nodeId, pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  const style = document.effectStyles?.find(item => item.id === styleId);
  if (!node || !style || !isValidLayerEffects(node.effects || [])) return false;
  style.effects = clone(node.effects || []);
  return true;
}

export function deleteEffectStyle(document, styleId) {
  const index = (document.effectStyles || []).findIndex(style => style.id === styleId);
  if (index < 0) return false;
  document.effectStyles.splice(index, 1);
  return true;
}

function findComponentPropertyTarget(document, component, targetSourceId) {
  const root = component && findNodeAcrossPages(document, component.rootNodeId)?.node;
  if (!root) return null;
  let found = null;
  const visit = (node, isRoot = false) => {
    if (node.id === targetSourceId) { found = node; return; }
    // A nested component instance is one layer in this component. Its internal
    // layers belong to another component and have a separate property scope.
    if (!isRoot && node.isInstance) return;
    for (const child of node.children || []) visit(child);
  };
  visit(root, true);
  return found;
}

function componentDependencies(document, componentId) {
  const component = document.components?.find(item => item.id === componentId);
  const root = component && findNodeAcrossPages(document, component.rootNodeId)?.node;
  if (!root) return [];
  const dependencies = [];
  const visit = (node, isRoot = false) => {
    if (!isRoot && node.isInstance) {
      if (node.componentId) dependencies.push(node.componentId);
      return;
    }
    for (const child of node.children || []) visit(child);
  };
  visit(root, true);
  return dependencies;
}

function componentSwapIsCompatible(document, ownerComponentId, targetComponentId) {
  const visiting = new Set();
  const visited = new Set();
  const visit = componentId => {
    if (componentId === ownerComponentId || visiting.has(componentId)) return false;
    if (visited.has(componentId)) return true;
    const component = document.components?.find(item => item.id === componentId);
    const root = component && findNodeAcrossPages(document, component.rootNodeId)?.node;
    if (!root?.isComponent) return false;
    visiting.add(componentId);
    for (const dependencyId of componentDependencies(document, componentId)) {
      if (!visit(dependencyId)) return false;
    }
    visiting.delete(componentId);
    visited.add(componentId);
    return true;
  };
  return visit(targetComponentId);
}

/** Return whether a nested instance can be swapped to another component without creating a cycle. */
export function canSwapComponentTo(document, ownerComponentId, targetComponentId) {
  return typeof ownerComponentId === 'string' && typeof targetComponentId === 'string'
    && componentSwapIsCompatible(document, ownerComponentId, targetComponentId);
}

function componentPropertyValueIsValid(document, component, property, value) {
  if (property.type === 'BOOLEAN') return typeof value === 'boolean';
  if (property.type === 'TEXT') return typeof value === 'string' && value.length <= 1_000_000;
  if (property.type === 'SLOT') return Array.isArray(value) && new Set(value).size === value.length && value.every(id => typeof id === 'string' && id.length > 0);
  if (property.type !== 'INSTANCE_SWAP' || typeof value !== 'string') return false;
  return Boolean(document.components?.some(item => item.id === value)
    && canSwapComponentTo(document, component.id, value));
}

function componentSlotValueIsValidForInstance(document, instance, component, property, value) {
  if (property.type !== 'SLOT' || !isComponentSlotTarget(findComponentPropertyTarget(document, component, property.targetSourceId), component)
    || !componentPropertyValueIsValid(document, component, property, value) || value.length > 10_000) return false;
  const target = findInstancePropertyTarget(instance, property.targetSourceId);
  if (!isComponentSlotTarget(target)) return false;
  const children = target.children || [];
  if (value.length !== children.length || value.some((id, index) => id !== children[index].id)) return false;
  const sourceTarget = findComponentPropertyTarget(document, component, property.targetSourceId);
  const inheritedIds = new Set((sourceTarget.children || []).map(child => child.id));
  if (children.some(child => inheritedIds.has(child.componentSourceId))) return false;
  let safe = true;
  walkNodes(children, ({ node }) => {
    if (node.type === 'slice' || node.isComponent || (node.isInstance && !canSwapComponentTo(document, component.id, node.componentId))) safe = false;
  });
  return safe;
}

/** Add a stable, typed property to a component definition. */
export function createComponentProperty(document, componentId, { id = null, name, type, targetNodeId, preferredComponentIds } = {}) {
  const component = document.components?.find(item => item.id === componentId);
  const target = component && findComponentPropertyTarget(document, component, targetNodeId);
  const propertyName = String(name || '').trim();
  if (!component || !target || !propertyName || propertyName.length > 80 || !componentPropertyTypes.has(type)) throw new Error('Choose a component, property name, supported type, and target layer.');
  if (type === 'SLOT' && !isComponentSlotTarget(target, component)) throw new Error('A slot must target a nested frame, group, or section inside the component.');
  if (type === 'SLOT' && treeContainsSlice(target.children || [])) throw new Error('A component slot source cannot contain slices.');
  component.componentProperties ||= [];
  if (component.componentProperties.length >= 100) throw new Error('A component can have at most 100 component properties.');
  if (component.componentProperties.some(property => property.name.toLocaleLowerCase() === propertyName.toLocaleLowerCase())) throw new Error('Component property names must be unique.');
  if (component.componentProperties.some(property => property.type === type && property.targetSourceId === target.id)) throw new Error('That layer already has a property of this type.');

  let defaultValue;
  if (type === 'BOOLEAN' && typeof getNodePropertyValue(document, target, 'visible') === 'boolean') defaultValue = getNodePropertyValue(document, target, 'visible');
  else if (type === 'TEXT' && target.type === 'text' && typeof getNodePropertyValue(document, target, 'text') === 'string') defaultValue = getNodePropertyValue(document, target, 'text');
  else if (type === 'INSTANCE_SWAP' && target.isInstance && typeof target.componentId === 'string') defaultValue = target.componentId;
  else if (type === 'SLOT' && isComponentSlotTarget(target, component)) defaultValue = [];
  else throw new Error(`The ${type} property is not supported by the selected layer.`);

  const property = {
    id: id || createId('component-property'), name: propertyName, type,
    targetSourceId: target.id, defaultValue
  };
  if (type === 'INSTANCE_SWAP' && preferredComponentIds != null) {
    if (!Array.isArray(preferredComponentIds)) throw new TypeError('Preferred swap targets must be a list.');
    property.preferredComponentIds = [...new Set(preferredComponentIds)];
    if (property.preferredComponentIds.some(targetId => !componentPropertyValueIsValid(document, component, property, targetId))) throw new Error('Choose existing, compatible components for the swap options.');
  }
  if (!property.id || document.components.some(item => item.componentProperties?.some(existing => existing.id === property.id))) throw new Error('Component property IDs must be unique.');
  if (!componentPropertyValueIsValid(document, component, property, defaultValue)) throw new Error('The component property default is invalid.');
  component.componentProperties.push(property);
  return property;
}

function findInstancePropertyTarget(instance, targetSourceId) {
  let found = null;
  const visit = (node, isRoot = false) => {
    if (node.componentSourceId === targetSourceId || node.nestedComponentSourceId === targetSourceId) { found = node; return; }
    if (!isRoot && node.isInstance) return;
    for (const child of node.children || []) visit(child);
  };
  visit(instance, true);
  return found;
}

function isComponentSlotTarget(node, component = null) {
  return Boolean(node && ['frame', 'group', 'section'].includes(node.type)
    && (!component || node.id !== component.rootNodeId));
}

function componentSlotContentKey(instanceId, targetSourceId) {
  return `${instanceId}\u0000${targetSourceId}`;
}

function instanceSlotContent(document, instance, component, property) {
  const ids = instance.componentPropertyValues?.[property.id];
  if (!Array.isArray(ids)) return [];
  const target = findInstancePropertyTarget(instance, property.targetSourceId);
  if (!isComponentSlotTarget(target, component)) throw new TypeError(`Missing slot target for ${property.name}.`);
  const byId = new Map((target.children || []).map(child => [child.id, child]));
  const nodes = ids.map(id => byId.get(id));
  if (nodes.some(node => !node)) throw new TypeError(`Missing layer content for slot ${property.name}.`);
  return nodes;
}

function collectInstanceSlotContents(document, instance, component) {
  const contents = new Map();
  if (!instance?.isInstance || !component) return contents;
  for (const property of component.componentProperties || []) {
    if (property.type !== 'SLOT' || !Object.hasOwn(instance.componentPropertyValues || {}, property.id)) continue;
    contents.set(componentSlotContentKey(instance.id, property.targetSourceId), instanceSlotContent(document, instance, component, property));
  }
  return contents;
}

function collectNestedInstanceSlotContents(document, rootInstance) {
  const contents = new Map();
  walkNodes([rootInstance], ({ node }) => {
    if (!node.isInstance) return;
    const component = document.components?.find(item => item.id === node.componentId);
    for (const [sourceId, slotNodes] of collectInstanceSlotContents(document, node, component)) contents.set(sourceId, slotNodes);
  });
  return contents;
}

function assignComponentPropertyValue(document, component, instance, property, value) {
  const target = findInstancePropertyTarget(instance, property.targetSourceId);
  if (!target) return false;
  if (property.type === 'BOOLEAN') {
    target.visible = value;
    if (target.variableBindings) {
      delete target.variableBindings.visible;
      if (!Object.keys(target.variableBindings).length) delete target.variableBindings;
    }
  } else if (property.type === 'TEXT') {
    if (target.text !== value) delete target.textRuns;
    target.text = value;
    if (target.variableBindings) {
      delete target.variableBindings.text;
      if (!Object.keys(target.variableBindings).length) delete target.variableBindings;
    }
  } else if (property.type === 'SLOT') {
    // Slot children are real layer nodes installed by setComponentSlotContent.
    // The ID list is metadata used by validation and synchronization, not a
    // serialized copy of those nodes.
    return true;
  } else {
    if (target.componentId !== value) {
      const swapComponent = document.components?.find(item => item.id === value);
      const master = swapComponent && findNodeAcrossPages(document, swapComponent.rootNodeId)?.node;
      if (!master?.isComponent || !componentSwapIsCompatible(document, component.id, value)) return false;
      const sourceId = target.componentSourceId;
      const sourceKey = target.componentSourceKey;
      const name = target.name;
      const inheritedName = target.componentNameIsInherited;
      target.componentOverrides = {};
      target.componentPropertyValues = {};
      syncInstanceNode(target, master, value, {}, true);
      target.componentSourceId = sourceId;
      if (sourceKey) target.componentSourceKey = sourceKey;
      else delete target.componentSourceKey;
      if (inheritedName) target.name = `${swapComponent.name} instance`;
      else target.name = name;
      if (inheritedName != null) target.componentNameIsInherited = inheritedName;
      // Overrides authored on the owning component instance are keyed by the
      // swappable layer's source ID. Keep compatible ones after replacing the
      // nested component's subtree.
      const ownerOverrides = instance.componentOverrides?.[property.targetSourceId] || {};
      for (const [key, overrideValue] of Object.entries(ownerOverrides)) {
        if (key === '__childOrder' || !componentOverrideProperties.has(key)) continue;
        if (['text', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'firstLineIndent', 'listSpacing', 'paragraphStyles', 'fontStyle', 'color', 'textRuns', 'textStyleId', 'align', 'verticalAlign', 'textFit', 'textCase', 'textDecoration'].includes(key) && target.type !== 'text') continue;
        if (key === 'transforms' && target.type !== 'image') continue;
        target[key] = clone(overrideValue);
      }
    }
  }
  return true;
}

function applyComponentPropertyValues(document, instance) {
  if (!instance?.isInstance) return;
  const component = document.components?.find(item => item.id === instance.componentId);
  if (component) {
    const values = instance.componentPropertyValues || {};
    for (const property of component.componentProperties || []) {
      const value = Object.hasOwn(values, property.id) ? values[property.id] : property.defaultValue;
      assignComponentPropertyValue(document, component, instance, property, value);
    }
  }
  const applyNested = node => {
    for (const child of node.children || []) {
      if (child.isInstance) applyComponentPropertyValues(document, child);
      else applyNested(child);
    }
  };
  applyNested(instance);
}

/** Set or reset an instance property. Pass undefined to restore its default. */
export function setComponentPropertyValue(document, instanceId, propertyId, value, pageId = document.activePageId) {
  const instance = findNode(document, instanceId, pageId)?.node;
  const component = instance?.isInstance && document.components?.find(item => item.id === instance.componentId);
  const property = component?.componentProperties?.find(item => item.id === propertyId);
  if (!instance || !component || !property) return false;
  if (property.type === 'SLOT') {
    if (value === undefined) return resetComponentSlotContent(document, instanceId, propertyId, pageId);
    throw new TypeError(`Use setComponentSlotContent to change slot ${property.name}.`);
  }
  if (value !== undefined && !componentPropertyValueIsValid(document, component, property, value)) throw new TypeError(`Invalid value for component property ${property.name}.`);
  instance.componentPropertyValues ||= {};
  if (value === undefined || Object.is(value, property.defaultValue)) delete instance.componentPropertyValues[property.id];
  else instance.componentPropertyValues[property.id] = value;
  if (!Object.keys(instance.componentPropertyValues).length) delete instance.componentPropertyValues;
  applyComponentPropertyValues(document, instance);
  return true;
}

function cloneSlotContentTrees(document, nodes) {
  if (!Array.isArray(nodes)) throw new TypeError('Slot content must be a list of layer trees.');
  const sourceIds = new Set();
  const sourceObjects = new Set();
  let count = 0;
  const inspect = node => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || sourceObjects.has(node)) throw new TypeError('Slot content must be a tree of layer objects.');
    sourceObjects.add(node);
    if (typeof node.id !== 'string' || !node.id || sourceIds.has(node.id)) throw new TypeError('Slot content layers need unique IDs.');
    if (node.type === 'slice') throw new TypeError('A slice cannot be inserted as component slot content.');
    if (node.isComponent) throw new TypeError('A main component cannot be inserted as slot content; create an instance first.');
    if (node.children != null && !Array.isArray(node.children)) throw new TypeError('Slot content children must be a list.');
    sourceIds.add(node.id);
    count += 1;
    if (count > 10_000) throw new RangeError('A slot can receive at most 10,000 layer nodes at once.');
    for (const child of node.children || []) inspect(child);
  };
  for (const node of nodes) inspect(node);

  const usedIds = new Set();
  for (const page of document.pages || []) walkNodes(page.children || [], ({ node }) => usedIds.add(node.id));
  const idMap = new Map();
  for (const sourceId of sourceIds) {
    let nextId;
    do { nextId = createId('slot-layer'); } while (usedIds.has(nextId));
    usedIds.add(nextId);
    idMap.set(sourceId, nextId);
  }
  const copies = clone(nodes);
  const remap = (node, insideLinkedInstance = false) => {
    const wasInstance = node.isInstance === true;
    node.id = idMap.get(node.id);
    if (!insideLinkedInstance) {
      delete node.componentSourceId;
      delete node.componentSourceKey;
      delete node.variantNodeKey;
    }
    if (node.maskSourceId && idMap.has(node.maskSourceId)) node.maskSourceId = idMap.get(node.maskSourceId);
    for (const interaction of node.interactions || []) {
      if (interaction.destinationId && idMap.has(interaction.destinationId)) interaction.destinationId = idMap.get(interaction.destinationId);
      if (interaction.scrollTargetId && idMap.has(interaction.scrollTargetId)) interaction.scrollTargetId = idMap.get(interaction.scrollTargetId);
    }
    if (node.isInstance && node.componentPropertyValues) {
      const component = document.components?.find(item => item.id === node.componentId);
      const propertiesById = new Map((component?.componentProperties || []).map(property => [property.id, property]));
      for (const [propertyId, value] of Object.entries(node.componentPropertyValues)) {
        if (propertiesById.get(propertyId)?.type === 'SLOT' && Array.isArray(value)) {
          node.componentPropertyValues[propertyId] = value.map(id => idMap.get(id) || id);
        }
      }
    }
    for (const child of node.children || []) remap(child, insideLinkedInstance || wasInstance);
  };
  for (const node of copies) remap(node);
  return copies;
}

function validateSlotSubtreeDependencies(document, ownerComponentId, nodes) {
  let invalidMainComponent = false;
  let cyclicInstance = false;
  walkNodes(nodes, ({ node }) => {
    if (node.isComponent) invalidMainComponent = true;
    if (node.isInstance && !canSwapComponentTo(document, ownerComponentId, node.componentId)) cyclicInstance = true;
  });
  if (invalidMainComponent) throw new TypeError('Slot content cannot contain a main component.');
  if (cyclicInstance) throw new TypeError('Slot content would create a recursive component dependency.');
}

/**
 * Replace a component instance's named SLOT contents with cloned layer trees.
 * The supplied roots and descendants receive fresh IDs; their original objects
 * are not attached or mutated. The resulting roots are ordinary children of
 * the slot's frame, group, or section, and their layer order follows `nodes`.
 * An empty list installs an explicit empty override; call resetComponentSlotContent
 * to restore the current master content.
 */
export function setComponentSlotContent(document, instanceId, propertyId, nodes, pageId = document.activePageId) {
  const instance = findNode(document, instanceId, pageId)?.node;
  const component = instance?.isInstance && document.components?.find(item => item.id === instance.componentId);
  const property = component?.componentProperties?.find(item => item.id === propertyId);
  if (!instance || !component || property?.type !== 'SLOT') return false;
  if (!Array.isArray(nodes)) throw new TypeError('Slot content must be a list of layer trees.');
  const target = findInstancePropertyTarget(instance, property.targetSourceId);
  if (!isComponentSlotTarget(target)) throw new TypeError(`Missing slot target for ${property.name}.`);

  const content = cloneSlotContentTrees(document, nodes);
  validateSlotSubtreeDependencies(document, component.id, content);
  const candidate = clone(document);
  const candidateInstance = findNode(candidate, instanceId, pageId)?.node;
  const candidateTarget = candidateInstance && findInstancePropertyTarget(candidateInstance, property.targetSourceId);
  if (!candidateTarget) throw new TypeError(`Missing slot target for ${property.name}.`);
  candidateTarget.children = clone(content);
  candidateInstance.componentPropertyValues ||= {};
  candidateInstance.componentPropertyValues[property.id] = content.map(node => node.id);
  validateDocument(candidate);

  target.children = content;
  instance.componentPropertyValues ||= {};
  instance.componentPropertyValues[property.id] = content.map(node => node.id);
  return content;
}

/** Restore a component instance's slot to the current main-component children. */
export function resetComponentSlotContent(document, instanceId, propertyId, pageId = document.activePageId) {
  const instance = findNode(document, instanceId, pageId)?.node;
  const component = instance?.isInstance && document.components?.find(item => item.id === instance.componentId);
  const property = component?.componentProperties?.find(item => item.id === propertyId);
  if (!instance || !component || property?.type !== 'SLOT') return false;
  if (instance.componentPropertyValues) {
    delete instance.componentPropertyValues[property.id];
    if (!Object.keys(instance.componentPropertyValues).length) delete instance.componentPropertyValues;
  }
  syncSingleComponentInstance(document, instance, component);
  return true;
}

export function deleteTypographyStyle(document, styleId) {
  const index = (document.typographyStyles || []).findIndex(style => style.id === styleId);
  if (index < 0) return false;
  document.typographyStyles.splice(index, 1);
  return true;
}

export function createComponent(document, nodeId, name = null, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) throw new Error('Select a layer to create a component.');
  if (entry.node.isInstance || entry.parents.some(parent => parent.isInstance)) throw new Error('Detach an instance before creating a new component.');
  if (treeContainsSlice(entry.node)) throw new Error('Slices cannot be used as component sources.');
  if (entry.node.isComponent) return (document.components || []).find(component => component.id === entry.node.componentId) || null;
  const component = { id: createId('component'), name: String(name || entry.node.name).trim() || entry.node.name, pageId, rootNodeId: entry.node.id };
  entry.node.isComponent = true;
  entry.node.componentId = component.id;
  document.components ||= [];
  document.components.push(component);
  return component;
}

function assignVariantNodeKeys(root, key = 'root') {
  root.variantNodeKey = key;
  for (let index = 0; index < (root.children || []).length; index += 1) assignVariantNodeKeys(root.children[index], `${key}/${index}`);
}

function componentVariantValues(component, setProperties) {
  const segments = String(component.name).split('/').map(value => value.trim());
  const suffix = segments.slice(1).join('/');
  if (suffix.includes('=')) {
    const parsed = Object.fromEntries(suffix.split(',').map(part => {
      const [name, ...values] = part.split('=');
      return [name.trim(), values.join('=').trim()];
    }).filter(([name, value]) => name && value));
    if (Object.keys(parsed).length) return parsed;
  }
  const key = setProperties[0]?.name || 'Variant';
  return { [key]: suffix || component.name };
}

export function createComponentSet(document, componentIds, name = null) {
  const uniqueIds = [...new Set(componentIds || [])];
  if (uniqueIds.length < 2) throw new TypeError('Select at least two main components to combine as variants.');
  const components = uniqueIds.map(id => document.components?.find(component => component.id === id));
  if (components.some(component => !component)) throw new Error('One or more selected main components no longer exist.');
  if (components.some(component => component.componentSetId)) throw new Error('A component is already part of a variant set.');
  const roots = components.map(component => findNodeAcrossPages(document, component.rootNodeId)?.node);
  if (roots.some(root => !root?.isComponent)) throw new Error('Every variant must have a valid main component.');
  const commonPrefix = components.map(component => String(component.name).split('/')[0].trim()).every(value => value === String(components[0].name).split('/')[0].trim())
    ? String(components[0].name).split('/')[0].trim()
    : components[0].name;
  const set = { id: createId('component-set'), name: String(name || commonPrefix).trim() || commonPrefix, componentIds: uniqueIds, properties: [] };
  const rawValues = components.map(component => componentVariantValues(component, set.properties));
  const propertyNames = [...new Set(rawValues.flatMap(properties => Object.keys(properties)))];
  const combinations = rawValues.map(properties => JSON.stringify(propertyNames.map(propertyName => String(properties[propertyName] || 'Default'))));
  if (new Set(combinations).size !== combinations.length) throw new Error('Each variant needs a unique combination of property values. Rename layers with distinct variant names before combining.');
  set.properties = propertyNames.map(propertyName => ({
    name: propertyName,
    values: [...new Set(rawValues.map(properties => String(properties[propertyName] || 'Default')))]
  }));
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    component.componentSetId = set.id;
    component.variantProperties = Object.fromEntries(set.properties.map(property => [property.name, String(rawValues[index][property.name] || 'Default')]));
    assignVariantNodeKeys(roots[index]);
  }
  document.componentSets ||= [];
  document.componentSets.push(set);
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    if (!node.isInstance || !uniqueIds.includes(node.componentId)) return;
    walkNodes([node], ({ node: instanceNode }) => {
      const source = instanceNode.componentSourceId && findNodeAcrossPages(document, instanceNode.componentSourceId)?.node;
      if (source?.variantNodeKey) instanceNode.componentSourceKey = source.variantNodeKey;
    });
  });
  return set;
}

function componentVariantSet(document, setId) {
  const set = document.componentSets?.find(item => item.id === setId);
  if (!set) throw new Error('This component set is no longer available.');
  const members = set.componentIds.map(id => document.components?.find(component => component.id === id));
  if (members.length < 2 || members.some(component => !component || component.componentSetId !== set.id)) {
    throw new Error('This component set has missing or mismatched variants.');
  }
  return { set, members };
}

function normalizedComponentVariantValue(rawValue, propertyName) {
  const value = String(rawValue ?? '').trim();
  if (!value || value.length > 80 || /[\x00-\x1f\x7f]/u.test(value)) {
    throw new TypeError(`Variant value for “${propertyName}” must contain 1–80 printable characters.`);
  }
  return value;
}

function normalizedVariantValues(set, sourceComponent, overrides) {
  if (overrides == null) overrides = {};
  if (typeof overrides !== 'object' || Array.isArray(overrides)) throw new TypeError('Variant values must be an object keyed by axis name.');
  const propertyNames = new Set(set.properties.map(property => property.name));
  for (const name of Object.keys(overrides)) {
    if (!propertyNames.has(name)) throw new Error(`Variant property “${name}” does not exist in this set.`);
  }
  const values = Object.fromEntries(set.properties.map(property => {
    const raw = Object.hasOwn(overrides, property.name)
      ? overrides[property.name]
      : sourceComponent.variantProperties?.[property.name];
    return [property.name, normalizedComponentVariantValue(raw, property.name)];
  }));
  return values;
}

/**
 * Create a new main component by copying a set member's design, then add it to
 * the same set with the supplied axis values. Values omitted from `values`
 * inherit from the source variant; the resulting combination must be unique.
 * The source is not changed, and cloned layer IDs plus internal mask/interaction
 * references are remapped before the new component is committed.
 */
export function addComponentVariantFromMaster(document, setId, sourceComponentId, values = {}, name = null) {
  const { set, members } = componentVariantSet(document, setId);
  const sourceComponent = members.find(component => component.id === sourceComponentId);
  if (!sourceComponent) throw new Error('Choose a source variant from this component set.');
  const variantValues = normalizedVariantValues(set, sourceComponent, values);
  const combination = JSON.stringify(set.properties.map(property => variantValues[property.name]));
  if (members.some(component => JSON.stringify(set.properties.map(property => component.variantProperties?.[property.name])) === combination)) {
    throw new Error('That combination already exists in this component set.');
  }
  const sourceEntry = findNodeAcrossPages(document, sourceComponent.rootNodeId);
  if (!sourceEntry?.node.isComponent || sourceEntry.node.componentId !== sourceComponent.id) {
    throw new Error('The source variant no longer has a valid main component layer.');
  }
  if (sourceEntry.parents.some(parent => parent.isInstance)) {
    throw new Error('A variant cannot be created inside a component instance.');
  }
  const changedValues = set.properties
    .filter(property => variantValues[property.name] !== sourceComponent.variantProperties?.[property.name])
    .map(property => `${property.name}=${variantValues[property.name]}`);
  const defaultName = `${set.name} / ${changedValues.join(', ')}`;
  const componentName = String(name ?? defaultName).trim();
  if (!componentName || componentName.length > 160 || /[\x00-\x1f\x7f]/u.test(componentName)) {
    throw new TypeError('Variant name must contain 1–160 printable characters.');
  }

  // Build a fresh tree through the normal instance path so every node receives
  // a valid new ID and nested component instances retain their own links.
  const cloneRoot = createComponentInstance(document, sourceComponent.id, {
    pageId: sourceEntry.page.id,
    parentId: sourceEntry.parent?.id ?? null,
    x: sourceEntry.node.x + sourceEntry.node.width + 32,
    y: sourceEntry.node.y
  });
  const cloneBySourceId = new Map();
  walkNodes([cloneRoot], ({ node }) => {
    if (node.componentSourceId) cloneBySourceId.set(node.componentSourceId, node.id);
  });
  const sourceProperties = (sourceComponent.componentProperties || []).map(property => {
    const targetSourceId = cloneBySourceId.get(property.targetSourceId);
    if (!targetSourceId) throw new Error(`Cannot copy component property “${property.name}” because its target is outside the source variant.`);
    return { ...clone(property), id: createId('component-property'), targetSourceId };
  });
  detachComponentInstance(document, cloneRoot.id, sourceEntry.page.id);
  if (sourceEntry.parent?.autoLayout) {
    // The variant master is a sibling on the canvas, but should not perturb an
    // existing auto-layout flow just because it was created from an asset.
    cloneRoot.layoutPositioning = 'absolute';
  }
  cloneRoot.name = componentName;
  const component = createComponent(document, cloneRoot.id, componentName, sourceEntry.page.id);
  component.componentSetId = set.id;
  component.variantProperties = variantValues;
  if (sourceProperties.length) component.componentProperties = sourceProperties;
  assignVariantNodeKeys(cloneRoot);
  set.componentIds.push(component.id);
  for (const property of set.properties) {
    if (!property.values.includes(variantValues[property.name])) property.values.push(variantValues[property.name]);
  }
  // Keep the new master next to its source in layer order.
  reorderNode(document, cloneRoot.id, sourceEntry.index + 1, sourceEntry.page.id);
  // If the source is nested in other main components, propagate the new sibling
  // into their linked instances from the innermost owner outward.
  for (const parent of [...sourceEntry.parents].reverse()) {
    if (parent.isComponent && parent.componentId) syncComponentInstances(document, parent.componentId);
  }
  return component;
}

/**
 * Remove a variant from its set without deleting its master layer or linked
 * instances. It becomes a standalone main component. Removal is rejected when
 * the set has only two variants; prototype variant actions that depend on the
 * removed set membership are cleared so the document remains valid.
 */
export function removeComponentVariantFromSet(document, setId, componentId) {
  const { set, members } = componentVariantSet(document, setId);
  if (members.length <= 2) throw new Error('A component set must keep at least two variants.');
  const component = members.find(item => item.id === componentId);
  if (!component) throw new Error('Choose a variant from this component set.');

  set.componentIds = set.componentIds.filter(id => id !== componentId);
  delete component.componentSetId;
  delete component.variantProperties;
  set.properties = set.properties.map(property => ({
    ...property,
    values: [...new Set(set.componentIds.map(id => document.components.find(item => item.id === id)?.variantProperties?.[property.name]).filter(Boolean))]
  }));

  for (const page of document.pages || []) walkNodes(page.children || [], ({ node, parents }) => {
    const interactions = Array.isArray(node.interactions) ? node.interactions : [];
    const retainedInteractions = interactions.filter(interaction => {
      if (interaction.action !== 'change-variant') return true;
      // An instance of the removed variant is now standalone, so it cannot
      // change to another member of the former set.
      if (node.isInstance && node.id === interaction.instanceId && node.componentId === componentId) return false;
      // Existing actions elsewhere cannot target a component outside their set.
      return interaction.targetVariantId !== componentId;
    });
    const changed = retainedInteractions.length !== interactions.length;
    if (changed) {
      if (retainedInteractions.length) node.interactions = retainedInteractions;
      else delete node.interactions;
    }

    // Prototype interactions edited on an instance are mirrored in the root's
    // source-keyed override map. Keep that persisted copy in lockstep with the
    // pruned layer array so validation and reload see the same routes.
    if (changed && node.componentSourceId) {
      const instanceRoot = [...parents, node].reverse().find(candidate => candidate.isInstance);
      const override = instanceRoot?.componentOverrides?.[node.componentSourceId];
      if (override && Object.hasOwn(override, 'interactions')) {
        override.interactions = clone(retainedInteractions);
      }
    }
  });
  return component;
}

export function setComponentVariantProperty(document, componentId, propertyName, value) {
  const component = document.components?.find(item => item.id === componentId);
  const set = component && document.componentSets?.find(item => item.id === component.componentSetId);
  const name = String(propertyName || '').trim();
  if (!component || !set || !name) throw new Error('Choose a component variant property and value.');
  if (!set.properties.some(property => property.name === name)) throw new Error(`Variant property “${name}” does not exist.`);
  const nextValue = normalizedComponentVariantValue(value, name);
  const proposed = { ...(component.variantProperties || {}), [name]: nextValue };
  const duplicate = set.componentIds.filter(id => id !== componentId).some(id => {
    const other = document.components.find(item => item.id === id);
    return set.properties.every(property => (other.variantProperties?.[property.name] || '') === (proposed[property.name] || ''));
  });
  if (duplicate) throw new Error('That combination already exists in this component set.');
  component.variantProperties = proposed;
  const property = set.properties.find(item => item.name === name);
  property.values = [...new Set(set.componentIds.map(id => {
    const item = document.components.find(componentItem => componentItem.id === id);
    return item?.variantProperties?.[name];
  }).filter(Boolean))];
  return component.variantProperties;
}

export function switchComponentInstanceVariant(document, instanceId, targetComponentId, pageId = document.activePageId, { preservePrototypeInteractions = false } = {}) {
  const instance = findNode(document, instanceId, pageId)?.node;
  const currentComponent = instance?.isInstance && document.components?.find(item => item.id === instance.componentId);
  const targetComponent = document.components?.find(item => item.id === targetComponentId);
  if (!currentComponent || !targetComponent || !currentComponent.componentSetId || currentComponent.componentSetId !== targetComponent.componentSetId) throw new Error('Choose a variant from this component set.');
  if (currentComponent.id === targetComponent.id) return false;
  const targetMaster = findNodeAcrossPages(document, targetComponent.rootNodeId)?.node;
  if (!targetMaster?.isComponent) throw new Error('The selected variant no longer exists.');
  const slotContentsByInstanceAndSourceId = collectNestedInstanceSlotContents(document, instance);
  const nextPropertyValues = {};
  const targetProperties = targetComponent.componentProperties || [];
  const currentPropertiesById = new Map((currentComponent.componentProperties || []).map(property => [property.id, property]));
  for (const [propertyId, value] of Object.entries(instance.componentPropertyValues || {})) {
    const currentProperty = currentPropertiesById.get(propertyId);
    if (currentProperty?.type === 'SLOT') continue;
    if (targetProperties.some(property => property.id === propertyId)) nextPropertyValues[propertyId] = clone(value);
  }
  for (const currentProperty of currentComponent.componentProperties || []) {
    const contentIds = instance.componentPropertyValues?.[currentProperty.id];
    if (currentProperty.type !== 'SLOT' || !Array.isArray(contentIds) || !Object.hasOwn(instance.componentPropertyValues || {}, currentProperty.id)) continue;
    const targetProperty = targetProperties.find(property => property.name.trim().toLocaleLowerCase() === currentProperty.name.trim().toLocaleLowerCase());
    if (!targetProperty || targetProperty.type !== 'SLOT') throw new Error(`Cannot switch variants because slot “${currentProperty.name}” has no matching target slot.`);
    const currentTarget = findInstancePropertyTarget(instance, currentProperty.targetSourceId);
    const content = instanceSlotContent(document, instance, currentComponent, currentProperty);
    slotContentsByInstanceAndSourceId.delete(componentSlotContentKey(instance.id, currentProperty.targetSourceId));
    slotContentsByInstanceAndSourceId.set(componentSlotContentKey(instance.id, targetProperty.targetSourceId), content);
    nextPropertyValues[targetProperty.id] = clone(contentIds);
    if (!isComponentSlotTarget(currentTarget)) throw new Error(`Cannot switch variants because slot “${currentProperty.name}” no longer exists.`);
  }
  const overridesByKey = new Map();
  for (const [sourceId, overrides] of Object.entries(instance.componentOverrides || {})) {
    const source = findNodeAcrossPages(document, sourceId)?.node;
    if (source?.variantNodeKey) overridesByKey.set(source.variantNodeKey, overrides);
  }
  const targetNodesByKey = new Map();
  walkNodes([targetMaster], ({ node }) => { if (node.variantNodeKey) targetNodesByKey.set(node.variantNodeKey, node); });
  const nextOverrides = {};
  for (const [key, overrides] of overridesByKey) {
    const targetNode = targetNodesByKey.get(key);
    if (!targetNode) continue;
    const migrated = clone(overrides);
    if (Array.isArray(migrated.__childOrder)) migrated.__childOrder = migrated.__childOrder.map(id => {
      const source = findNodeAcrossPages(document, id)?.node;
      return source?.variantNodeKey ? targetNodesByKey.get(source.variantNodeKey)?.id : null;
    }).filter(Boolean);
    nextOverrides[targetNode.id] = migrated;
  }
  instance.componentId = targetComponent.id;
  instance.componentOverrides = nextOverrides;
  instance.componentPropertyValues = nextPropertyValues;
  if (!Object.keys(instance.componentPropertyValues).length) delete instance.componentPropertyValues;
  if (instance.componentNameIsInherited !== false) instance.name = `${targetComponent.name} instance`;
  syncInstanceNode(instance, targetMaster, targetComponent.id, nextOverrides, true, slotContentsByInstanceAndSourceId);
  applyComponentPropertyValues(document, instance);
  if (!preservePrototypeInteractions && Array.isArray(instance.interactions)) {
    instance.interactions = instance.interactions.filter(interaction =>
      interaction.action !== 'change-variant' || interaction.targetVariantId !== targetComponent.id);
    if (!instance.interactions.length) delete instance.interactions;
    const targetInteractionsOverride = instance.componentOverrides?.[targetMaster.id];
    if (targetInteractionsOverride && Object.hasOwn(targetInteractionsOverride, 'interactions')) {
      targetInteractionsOverride.interactions = clone(instance.interactions || []);
    }
  }
  remapComponentInstanceReferences(document, instance);
  return true;
}

function removeComponentFromSets(document, componentId) {
  document.componentSets ||= [];
  for (const set of [...document.componentSets]) {
    if (!set.componentIds.includes(componentId)) continue;
    set.componentIds = set.componentIds.filter(id => id !== componentId);
    const remaining = set.componentIds.map(id => document.components.find(component => component.id === id)).filter(Boolean);
    const hasVariantDifferences = set.properties.some(property => new Set(remaining.map(component => component.variantProperties?.[property.name]).filter(Boolean)).size > 1);
    if (remaining.length < 2 || !hasVariantDifferences) {
      for (const component of remaining) { delete component.componentSetId; delete component.variantProperties; }
      document.componentSets = document.componentSets.filter(item => item.id !== set.id);
    } else {
      set.properties = set.properties.map(property => ({ ...property, values: [...new Set(remaining.map(component => component.variantProperties?.[property.name]).filter(Boolean))] }));
    }
  }
}

function removeDanglingComponentProperties(document, removedNodeIds, removedComponentIds) {
  const removedPropertyIds = new Set();
  for (const component of document.components || []) {
    component.componentProperties = (component.componentProperties || []).filter(property => {
      const invalid = removedNodeIds.has(property.targetSourceId)
        || (property.type === 'INSTANCE_SWAP' && removedComponentIds.has(property.defaultValue));
      if (invalid) removedPropertyIds.add(property.id);
      else if (property.preferredComponentIds) property.preferredComponentIds = property.preferredComponentIds.filter(id => !removedComponentIds.has(id));
      return !invalid;
    });
    if (!component.componentProperties.length) delete component.componentProperties;
  }
  for (const page of document.pages || []) walkNodes(page.children || [], ({ node }) => {
    if (!node.componentPropertyValues) return;
    const component = document.components?.find(item => item.id === node.componentId);
    const definitions = new Map((component?.componentProperties || []).map(property => [property.id, property]));
    for (const [propertyId, value] of Object.entries(node.componentPropertyValues)) {
      const property = definitions.get(propertyId);
      if (removedPropertyIds.has(propertyId) || (property?.type === 'INSTANCE_SWAP' && removedComponentIds.has(value))) delete node.componentPropertyValues[propertyId];
      else if (property?.type === 'SLOT' && Array.isArray(value)) node.componentPropertyValues[propertyId] = value.filter(id => !removedNodeIds.has(id));
    }
    if (!Object.keys(node.componentPropertyValues).length) delete node.componentPropertyValues;
  });
}

export function createComponentInstance(document, componentId, { pageId = document.activePageId, parentId = null, x = null, y = null } = {}) {
  const component = document.components?.find(item => item.id === componentId);
  const master = component && findNodeAcrossPages(document, component.rootNodeId);
  if (!component || !master || !master.node.isComponent) throw new Error('The main component no longer exists.');
  if (treeContainsSlice(master.node)) throw new Error('A component containing a slice cannot be instantiated.');
  const targetPage = document.pages.find(page => page.id === pageId);
  if (!targetPage) throw new Error('The target page no longer exists.');
  const instance = clone(master.node);
  const cloneByOriginalId = new Map();
  const renew = (node, isRoot = false) => {
    const sourceId = node.id;
    node.id = createId(node.type);
    cloneByOriginalId.set(sourceId, node.id);
    // A nested linked component needs its own source mapping for component
    // properties, while componentSourceId tracks this outer instance's tree.
    const nestedSourceId = node.nestedComponentSourceId || node.componentSourceId;
    if (nestedSourceId) node.nestedComponentSourceId = nestedSourceId;
    else delete node.nestedComponentSourceId;
    node.componentSourceId = sourceId;
    if (node.variantNodeKey) node.componentSourceKey = node.variantNodeKey;
    else delete node.componentSourceKey;
    if (node.isComponent) {
      node.isInstance = true;
      delete node.isComponent;
    }
    for (const child of node.children || []) renew(child);
    if (isRoot) {
      node.isInstance = true;
      node.componentId = componentId;
      node.componentOverrides = {};
      node.componentNameIsInherited = true;
      node.name = `${component.name} instance`;
      node.x = x != null && Number.isFinite(Number(x)) ? Number(x) : node.x + 16;
      node.y = y != null && Number.isFinite(Number(y)) ? Number(y) : node.y + 16;
    }
  };
  renew(instance, true);
  const cloneBySourceId = new Map();
  walkNodes([instance], ({ node }) => {
    if (node.componentSourceId) cloneBySourceId.set(node.componentSourceId, node.id);
  });
  walkNodes([instance], ({ node }) => {
    const copiedMaskId = cloneByOriginalId.get(node.maskSourceId) || cloneBySourceId.get(node.maskSourceId);
    if (copiedMaskId) node.maskSourceId = copiedMaskId;
    for (const interaction of node.interactions || []) {
      if (interaction.action === 'change-variant') {
        const copiedInstanceId = cloneByOriginalId.get(interaction.instanceId) || cloneBySourceId.get(interaction.instanceId);
        if (copiedInstanceId) interaction.instanceId = copiedInstanceId;
      }
      const copiedDestinationId = cloneByOriginalId.get(interaction.destinationId) || cloneBySourceId.get(interaction.destinationId);
      if (copiedDestinationId) {
        interaction.destinationId = copiedDestinationId;
        interaction.destinationPageId = pageId;
      }
      const copiedScrollTargetId = cloneByOriginalId.get(interaction.scrollTargetId) || cloneBySourceId.get(interaction.scrollTargetId);
      if (copiedScrollTargetId) interaction.scrollTargetId = copiedScrollTargetId;
    }

    if (node.isInstance && node.componentPropertyValues) {
      const nestedComponent = document.components?.find(component => component.id === node.componentId);
      const slotPropertyIds = new Set((nestedComponent?.componentProperties || [])
        .filter(property => property.type === 'SLOT')
        .map(property => property.id));
      for (const propertyId of slotPropertyIds) {
        const value = node.componentPropertyValues[propertyId];
        if (!Array.isArray(value)) continue;
        node.componentPropertyValues[propertyId] = value.map(id => cloneByOriginalId.get(id) || cloneBySourceId.get(id) || id);
      }
    }
  });
  addNode(document, instance, { pageId, parentId });
  applyComponentPropertyValues(document, instance);
  return instance;
}

export function detachComponentInstances(document, componentId) {
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    if (node.isInstance && node.componentId === componentId) clearComponentInstanceLink(node);
  });
}

function clearComponentInstanceLink(instance) {
  const componentId = instance.componentId;
  delete instance.isInstance; delete instance.componentId; delete instance.componentOverrides; delete instance.componentPropertyValues; delete instance.componentNameIsInherited;
  walkNodes(instance.children || [], ({ node, parents }) => {
    const belongsToNestedInstance = parents.some(parent => parent.isInstance && parent.componentId !== componentId);
    if (!belongsToNestedInstance) {
      delete node.componentSourceId;
      delete node.componentSourceKey;
      delete node.nestedComponentSourceId;
    }
    if (node.isInstance && node.componentId === componentId) { delete node.isInstance; delete node.componentId; delete node.componentOverrides; delete node.componentPropertyValues; }
  });
  delete instance.componentSourceId; delete instance.componentSourceKey;
}

export function detachComponentInstance(document, nodeId, pageId = document.activePageId) {
  const instance = findNode(document, nodeId, pageId)?.node;
  if (!instance?.isInstance) return false;
  clearComponentInstanceLink(instance);
  return true;
}

function syncInstanceNode(instance, master, componentId, overrides, isRoot = false, slotContentsBySourceId = new Map(), ownerInstanceId = instance?.id) {
  const stableId = instance?.id || createId(master.type);
  const rootX = instance?.x ?? master.x;
  const rootY = instance?.y ?? master.y;
  const rootName = instance?.name ?? `${master.name} instance`;
  const componentOverrides = isRoot ? clone(instance?.componentOverrides || {}) : null;
  const componentPropertyValues = instance?.componentPropertyValues && typeof instance.componentPropertyValues === 'object'
    ? clone(instance.componentPropertyValues) : clone(master.componentPropertyValues || {});
  const oldChildren = instance?.children || [];
  const oldChildrenBySourceId = new Map(oldChildren.filter(child => child.componentSourceId).map(child => [child.componentSourceId, child]));
  const oldChildrenBySourceKey = new Map(oldChildren.filter(child => child.componentSourceKey).map(child => [child.componentSourceKey, child]));
  const copy = clone(master);
  const slotContentKey = componentSlotContentKey(ownerInstanceId, master.id);
  const hasSlotContent = slotContentsBySourceId.has(slotContentKey);
  const childOwnerInstanceId = master.isInstance && !isRoot ? (instance?.id || master.id) : ownerInstanceId;
  let children = hasSlotContent ? slotContentsBySourceId.get(slotContentKey).slice() : (master.children || []).map((child, index) => {
    const legacyChild = oldChildren[index]?.componentSourceId ? null : oldChildren[index];
    return syncInstanceNode(oldChildrenBySourceId.get(child.id) || oldChildrenBySourceKey.get(child.variantNodeKey) || legacyChild, child, componentId, overrides, false, slotContentsBySourceId, childOwnerInstanceId);
  });
  const nodeOverrides = overrides?.[master.id];
  if (!hasSlotContent && Array.isArray(nodeOverrides?.__childOrder)) {
    const masterOrder = new Map((master.children || []).map((child, index) => [child.id, index]));
    const requestedOrder = new Map(nodeOverrides.__childOrder.map((id, index) => [id, index]));
    children = children.map((child, index) => ({ child, index })).sort((a, b) => {
      const rank = item => requestedOrder.has(item.child.componentSourceId)
        ? requestedOrder.get(item.child.componentSourceId)
        : nodeOverrides.__childOrder.length + (masterOrder.get(item.child.componentSourceId) ?? item.index);
      return rank(a) - rank(b) || a.index - b.index;
    }).map(item => item.child);
  }
  const target = Object.assign(instance || {}, copy, {
    id: stableId,
    componentSourceId: master.id,
    children,
    x: isRoot ? rootX : copy.x,
    y: isRoot ? rootY : copy.y,
    name: isRoot ? rootName : copy.name
  });
  const nestedSourceId = master.nestedComponentSourceId || master.componentSourceId;
  if (nestedSourceId) target.nestedComponentSourceId = nestedSourceId;
  else delete target.nestedComponentSourceId;
  if (target.type !== 'frame') delete target.overflowBehavior;
  if (isRoot) {
    target.componentId = componentId;
    target.isInstance = true;
    target.componentOverrides = componentOverrides;
    delete target.isComponent;
  } else if (copy.isComponent) {
    target.componentId = copy.componentId;
    target.isInstance = true;
    delete target.isComponent;
  } else if (copy.isInstance) {
    target.componentId = copy.componentId;
    target.isInstance = true;
    delete target.isComponent;
  } else {
    delete target.componentId;
    delete target.isComponent;
    delete target.isInstance;
  }
  if (target.isInstance && Object.keys(componentPropertyValues || {}).length) target.componentPropertyValues = componentPropertyValues;
  else delete target.componentPropertyValues;
  if (master.variantNodeKey) target.componentSourceKey = master.variantNodeKey;
  else delete target.componentSourceKey;
  if (nodeOverrides && typeof nodeOverrides === 'object' && !Array.isArray(nodeOverrides)) {
    for (const [key, value] of Object.entries(nodeOverrides)) if (key !== '__childOrder' && componentOverrideProperties.has(key)) target[key] = clone(value);
  }
  return target;
}

function remapComponentInstanceReferences(document, instance) {
  const instanceEntry = findNodeAcrossPages(document, instance?.id);
  if (!instanceEntry) return false;

  const sourceToInstanceId = new Map();
  walkNodes([instance], ({ node }) => {
    if (typeof node.componentSourceId === 'string' && node.componentSourceId) {
      sourceToInstanceId.set(node.componentSourceId, node.id);
    }
  });

  let changed = false;
  walkNodes([instance], ({ node, parents }) => {
    const copiedMaskId = sourceToInstanceId.get(node.maskSourceId);
    if (copiedMaskId && copiedMaskId !== node.maskSourceId) {
      node.maskSourceId = copiedMaskId;
      changed = true;
    }

    if (!Array.isArray(node.interactions)) return;
    let interactionsChanged = false;
    for (const interaction of node.interactions) {
      for (const property of ['destinationId', 'scrollTargetId', 'instanceId']) {
        const copiedId = sourceToInstanceId.get(interaction[property]);
        if (!copiedId || copiedId === interaction[property]) continue;
        interaction[property] = copiedId;
        interactionsChanged = true;
        if (property === 'destinationId') interaction.destinationPageId = instanceEntry.page.id;
      }
    }

    const fullParents = [...instanceEntry.parents, ...parents];
    const retained = node.interactions.filter(interaction => interaction.action !== 'scroll-to'
      || isValidPrototypeScrollTarget(document, instanceEntry.page, node, fullParents, interaction.scrollTargetId));
    if (retained.length !== node.interactions.length) {
      interactionsChanged = true;
      if (retained.length) node.interactions = retained;
      else delete node.interactions;
    }
    if (!interactionsChanged) return;
    changed = true;

    const instanceRoot = [...fullParents, node].reverse().find(candidate => candidate.isInstance);
    const override = instanceRoot?.componentOverrides?.[node.componentSourceId];
    if (override && Object.hasOwn(override, 'interactions')) {
      if (retained.length) override.interactions = clone(retained);
      else delete override.interactions;
    }
  });
  return changed;
}

export function syncComponentInstances(document, componentId) {
  const component = document.components?.find(item => item.id === componentId);
  const master = component && findNodeAcrossPages(document, component.rootNodeId)?.node;
  if (!component || !master) return 0;
  const instances = [];
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    if (node.isInstance && node.componentId === componentId) instances.push(node);
  });
  for (const instance of instances) {
    syncSingleComponentInstance(document, instance, component);
  }
  return instances.length;
}

function syncSingleComponentInstance(document, instance, component = document.components?.find(item => item.id === instance?.componentId)) {
  const master = component && findNodeAcrossPages(document, component.rootNodeId)?.node;
  if (!component || !master || !instance?.isInstance) return false;
  const slotContents = collectNestedInstanceSlotContents(document, instance);
  syncInstanceNode(instance, master, component.id, instance.componentOverrides || {}, true, slotContents);
  if (instance.componentNameIsInherited !== false) instance.name = `${component.name} instance`;
  applyComponentPropertyValues(document, instance);
  remapComponentInstanceReferences(document, instance);
  return true;
}

export function syncAllComponentInstances(document) {
  for (const set of document.componentSets || []) for (const componentId of set.componentIds) {
    const component = document.components?.find(item => item.id === componentId);
    const master = component && findNodeAcrossPages(document, component.rootNodeId)?.node;
    if (master) assignVariantNodeKeys(master);
  }
  let updated = 0;
  for (const component of document.components || []) updated += syncComponentInstances(document, component.id);
  return updated;
}

export function cloneDocument(document) { return clone(document); }

function validNetworkGeometry(node) {
  if (!Array.isArray(node.vertices) || node.vertices.length < 2 || !Array.isArray(node.edges) || !node.edges.length || !Array.isArray(node.faces || [])) return false;
  const vertexIds = new Set();
  for (const vertex of node.vertices) {
    if (!vertex || typeof vertex.id !== 'string' || !vertex.id || vertexIds.has(vertex.id) || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) return false;
    if (Object.hasOwn(vertex, 'mode') && !vectorAnchorModes.has(vertex.mode)) return false;
    if (vertex.split != null) {
      const split = vertex.split;
      const original = split?.originalEdge;
      if (!split || typeof split.firstEdgeId !== 'string' || typeof split.secondEdgeId !== 'string' || split.firstEdgeId === split.secondEdgeId
        || !original || original.id !== split.firstEdgeId || typeof original.from !== 'string' || typeof original.to !== 'string' || original.from === original.to
        || ['control1', 'control2'].some(part => original[part] != null && (!Number.isFinite(original[part].x) || !Number.isFinite(original[part].y)))) return false;
    }
    vertexIds.add(vertex.id);
  }
  const edgeIds = new Set();
  const connections = new Map();
  for (const edge of node.edges) {
    if (!edge || typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id)
      || !vertexIds.has(edge.from) || !vertexIds.has(edge.to) || edge.from === edge.to
      || ['control1', 'control2'].some(part => edge[part] != null && (!Number.isFinite(edge[part].x) || !Number.isFinite(edge[part].y)))) return false;
    edgeIds.add(edge.id);
    if (!connections.has(edge.from)) connections.set(edge.from, new Set());
    if (!connections.has(edge.to)) connections.set(edge.to, new Set());
    connections.get(edge.from).add(edge.to);
    connections.get(edge.to).add(edge.from);
  }
  for (const vertex of node.vertices) if (vertex.split) {
    const split = vertex.split;
    const first = node.edges.find(edge => edge.id === split.firstEdgeId);
    const second = node.edges.find(edge => edge.id === split.secondEdgeId);
    if (!vertexIds.has(split.originalEdge.from) || !vertexIds.has(split.originalEdge.to)
      || !first || !second || first.from !== split.originalEdge.from || first.to !== vertex.id
      || second.from !== vertex.id || second.to !== split.originalEdge.to) return false;
  }
  const faceIds = new Set();
  for (const face of node.faces || []) {
    if (!face || typeof face.id !== 'string' || !face.id || faceIds.has(face.id) || !Array.isArray(face.vertexIds) || face.vertexIds.length < 3
      || face.vertexIds.some(id => !vertexIds.has(id)) || new Set(face.vertexIds).size !== face.vertexIds.length) return false;
    for (let index = 0; index < face.vertexIds.length; index += 1) {
      const from = face.vertexIds[index]; const to = face.vertexIds[(index + 1) % face.vertexIds.length];
      if (!connections.get(from)?.has(to)) return false;
    }
    if (face.fill != null && typeof face.fill !== 'string') return false;
    if (face.fillOpacity != null && (!Number.isFinite(face.fillOpacity) || face.fillOpacity < 0 || face.fillOpacity > 1)) return false;
    faceIds.add(face.id);
  }
  return true;
}

export function assertDocumentTreeBounds(document) {
  if (!document || !Array.isArray(document.pages)) return;
  const pending = [];
  for (let pageIndex = document.pages.length - 1; pageIndex >= 0; pageIndex -= 1) {
    const children = document.pages[pageIndex]?.children;
    if (!Array.isArray(children)) continue;
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push({ node: children[index], depth: 1 });
  }

  const visited = new WeakSet();
  const active = new WeakSet();
  let nodeCount = 0;
  while (pending.length) {
    const entry = pending.pop();
    if (entry.exit) {
      active.delete(entry.node);
      continue;
    }
    const { node, depth } = entry;
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new TypeError('Invalid or duplicate layer.');
    if (active.has(node)) throw new TypeError('Layer tree contains a cycle.');
    if (visited.has(node)) throw new TypeError('Layer tree nodes cannot be shared between positions.');
    if (depth > MAX_DOCUMENT_TREE_DEPTH) {
      throw new TypeError(`Design layer nesting exceeds the maximum depth of ${MAX_DOCUMENT_TREE_DEPTH}.`);
    }
    nodeCount += 1;
    if (nodeCount > MAX_DOCUMENT_NODE_COUNT) {
      throw new TypeError(`Design contains more than ${MAX_DOCUMENT_NODE_COUNT.toLocaleString()} layer nodes.`);
    }
    if (node.children != null && !Array.isArray(node.children)) throw new TypeError('Layer children must be a list.');

    visited.add(node);
    active.add(node);
    pending.push({ node, exit: true });
    const linked = node.linkedComponent;
    const linkedRoots = [linked?.sourceSnapshot?.root, linked?.root];
    for (const root of linkedRoots) if (root != null) pending.push({ node: root, depth: depth + 1 });
    for (let index = (node.children?.length || 0) - 1; index >= 0; index -= 1) {
      pending.push({ node: node.children[index], depth: depth + 1 });
    }
  }
}

export function validateDocument(document) {
  if (!document || document.schema !== 'figma-local/1'
    || typeof document.id !== 'string' || !document.id || document.id.trim() !== document.id
    || !Array.isArray(document.pages) || !document.pages.length) throw new TypeError('Invalid local design file.');
  assertDocumentTreeBounds(document);
  const pageIds = new Set();
  const nodeIds = new Set();
  for (const page of document.pages) {
    if (!page.id || pageIds.has(page.id) || !Array.isArray(page.children)) throw new TypeError('Invalid or duplicate page.');
    pageIds.add(page.id);
    if (Object.hasOwn(page, 'guides')) {
      const guideIds = new Set();
      if (!Array.isArray(page.guides) || page.guides.length > MAX_PAGE_RULER_GUIDES || page.guides.some(guide => {
        if (!guide || typeof guide !== 'object' || Array.isArray(guide)
          || Object.keys(guide).some(key => !['id', 'axis', 'position'].includes(key))
          || typeof guide.id !== 'string' || !guide.id.trim() || guide.id.trim() !== guide.id || guideIds.has(guide.id)
          || !['x', 'y'].includes(guide.axis)
          || typeof guide.position !== 'number' || !Number.isFinite(guide.position) || Math.abs(guide.position) > 1_000_000_000) return true;
        guideIds.add(guide.id);
        return false;
      })) throw new TypeError(`Invalid ruler guides on page ${page.name || page.id}.`);
    }
    walkNodes(page.children, ({ node, parent }) => {
      if (!node.id || nodeIds.has(node.id)) throw new TypeError('Invalid or duplicate layer.');
      nodeIds.add(node.id);
      if (!defaults[node.type] || ![node.x, node.y, node.width, node.height, node.rotation, node.opacity].every(Number.isFinite) || node.width < 0 || node.height < 0 || node.opacity < 0 || node.opacity > 1) throw new TypeError(`Invalid geometry or type on layer ${node.name || node.id}.`);
      if (node.type === 'slice' && (parent || node.width <= 0 || node.height <= 0 || node.rotation !== 0
        || node.children?.length || node.isComponent || node.isInstance || node.mask)) {
        throw new TypeError(`Slices are positive-size, unrotated, top-level export regions without children or components (${node.name || node.id}).`);
      }
      if (Object.hasOwn(node, 'strokes') && !isValidStrokeStack(node.strokes, node)) throw new TypeError(`Invalid stroke stack on layer ${node.name || node.id}.`);
      if ((node.strokeWidth != null && (!Number.isFinite(node.strokeWidth) || node.strokeWidth < 0 || node.strokeWidth > 100_000))
        || (node.strokeOpacity != null && (!Number.isFinite(node.strokeOpacity) || node.strokeOpacity < 0 || node.strokeOpacity > 1))
        || (node.strokeCap != null && !strokeCaps.has(node.strokeCap))
        || (node.strokeJoin != null && !strokeJoins.has(node.strokeJoin))
        || (node.strokePattern != null && !strokePatterns.has(node.strokePattern))
        || (node.strokeMiterLimit != null && (!Number.isFinite(node.strokeMiterLimit) || node.strokeMiterLimit < 1 || node.strokeMiterLimit > 1000))
        || (node.strokePattern === 'dotted' && node.strokeCap != null && node.strokeCap !== 'round')) throw new TypeError(`Invalid stroke style on layer ${node.name || node.id}.`);
      if (node.lineReverseY != null && (node.type !== 'line' || typeof node.lineReverseY !== 'boolean')) throw new TypeError(`Invalid line direction on layer ${node.name || node.id}.`);
      if (node.cornerRadii != null && (!['rectangle', 'frame', 'section', 'image'].includes(node.type) || !isValidCornerRadii(node.cornerRadii))) {
        throw new TypeError(`Invalid independent corner radii on layer ${node.name || node.id}.`);
      }
      if (node.cornerRadii != null && node.variableBindings?.radius != null) {
        throw new TypeError(`Independent corner radii cannot use a uniform radius variable binding on layer ${node.name || node.id}.`);
      }
      if (Object.hasOwn(node, 'overflowBehavior') && (node.type !== 'frame' || !frameOverflowBehaviors.has(node.overflowBehavior))) {
        throw new TypeError(`Invalid frame overflow behavior on layer ${node.name || node.id}.`);
      }
      const sizeLimits = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'];
      const hasSizeLimit = sizeLimits.some(property => node[property] != null);
      if (hasSizeLimit && !(node.type === 'frame' && node.autoLayout) && !parent?.autoLayout) throw new TypeError(`Size limits require an auto layout frame on layer ${node.name || node.id}.`);
      if (sizeLimits.some(property => node[property] != null && (typeof node[property] !== 'number' || !Number.isFinite(node[property]) || node[property] < 0))
        || (node.minWidth != null && node.maxWidth != null && node.minWidth > node.maxWidth)
        || (node.minHeight != null && node.maxHeight != null && node.minHeight > node.maxHeight)) throw new TypeError(`Invalid size limits on layer ${node.name || node.id}.`);
      if (node.type === 'boolean' && (!booleanOperations.has(node.operation) || !Array.isArray(node.children) || node.children.length < 2 || node.children.some(child => !isBooleanOperand(child)))) throw new TypeError(`Invalid Boolean group on layer ${node.name || node.id}.`);
      if (node.textFit != null && (node.type !== 'text' || !['fixed', 'auto-height', 'auto-width'].includes(node.textFit))) throw new TypeError(`Invalid text resize mode on layer ${node.name || node.id}.`);
      if (node.textCase != null && (node.type !== 'text' || !textCases.has(node.textCase))) throw new TypeError(`Invalid text case on layer ${node.name || node.id}.`);
      if (node.textDecoration != null && (node.type !== 'text' || !textDecorations.has(node.textDecoration))) throw new TypeError(`Invalid text decoration on layer ${node.name || node.id}.`);
      if (node.align != null && (node.type !== 'text' || !textAlignments.has(node.align))) throw new TypeError(`Invalid text alignment on layer ${node.name || node.id}.`);
      if (node.verticalAlign != null && (node.type !== 'text' || !textVerticalAlignments.has(node.verticalAlign))) throw new TypeError(`Invalid text vertical alignment on layer ${node.name || node.id}.`);
      if (['paragraphSpacing', 'firstLineIndent'].some(property => node[property] != null
        && (node.type !== 'text' || !Number.isFinite(node[property]) || node[property] < 0 || node[property] > 10_000))) {
        throw new TypeError(`Invalid paragraph typography on layer ${node.name || node.id}.`);
      }
      if (node.listSpacing != null && (node.type !== 'text' || !Number.isFinite(node.listSpacing) || node.listSpacing < 0 || node.listSpacing > 10_000)) {
        throw new TypeError(`Invalid list spacing on layer ${node.name || node.id}.`);
      }
      if (node.paragraphStyles != null && (node.type !== 'text' || typeof node.text !== 'string' || !isValidTextParagraphStyles(node.paragraphStyles, node.text))) {
        throw new TypeError(`Invalid text paragraph styles on layer ${node.name || node.id}.`);
      }
      if (node.textRuns != null && (node.type !== 'text' || !isValidTextRuns(node.textRuns, node.text))) throw new TypeError(`Invalid rich text runs on layer ${node.name || node.id}.`);
      if (node.fontFamily != null && (node.type !== 'text' || typeof node.fontFamily !== 'string' || !node.fontFamily.trim() || node.fontFamily.length > 160 || /[\x00-\x1f]/.test(node.fontFamily))) throw new TypeError(`Invalid font family on layer ${node.name || node.id}.`);
      if (node.fontWeight != null && (node.type !== 'text' || !isValidFontWeight(node.fontWeight))) throw new TypeError(`Invalid font weight on layer ${node.name || node.id}.`);
      if (node.fontStyle != null && (node.type !== 'text' || !['normal', 'italic'].includes(node.fontStyle))) throw new TypeError(`Invalid font style on layer ${node.name || node.id}.`);
      if (['polygon', 'star'].includes(node.type) && node.points != null && (!Number.isFinite(node.points) || node.points < 3 || node.points > 32)) throw new TypeError(`Invalid shape point count on layer ${node.name || node.id}.`);
      if (node.type === 'star' && node.innerRadius != null && (!Number.isFinite(node.innerRadius) || node.innerRadius < 0 || node.innerRadius > 1)) throw new TypeError(`Invalid star inner radius on layer ${node.name || node.id}.`);
      if (node.type !== 'star' && node.innerRadius != null) throw new TypeError(`Star inner radius is only supported on star layers (${node.name || node.id}).`);
      if (node.effects != null && !isValidLayerEffects(node.effects)) throw new TypeError(`Invalid layer effects on layer ${node.name || node.id}.`);
      if (node.blendMode != null && !isValidLayerBlendMode(node.blendMode)) throw new TypeError(`Invalid blend mode on layer ${node.name || node.id}.`);
      if (node.fillGradient != null && (!['frame', 'section', 'group', 'boolean', 'rectangle', 'ellipse', 'star', 'polygon'].includes(node.type)
        && !(node.type === 'path' && hasFillablePathContour(node)) && !(node.type === 'network' && node.faces?.length))) throw new TypeError(`Gradient fill is not supported on layer ${node.name || node.id}.`);
      if (node.fillGradient != null && !isValidGradientFill(node.fillGradient)) throw new TypeError(`Invalid gradient fill on layer ${node.name || node.id}.`);
      if (node.imageFill != null && !isImageFillSupported(node)) throw new TypeError(`Image fill is not supported on layer ${node.name || node.id}.`);
      if (node.imageFill != null && !isValidImageFill(node.imageFill)) throw new TypeError(`Invalid image fill on layer ${node.name || node.id}.`);
      if (Object.hasOwn(node, 'fills') && !isValidFillStack(node.fills, node, { isValidImageFill, isImageFillSupported })) throw new TypeError(`Invalid fill stack on layer ${node.name || node.id}.`);
      if (node.adjustments != null && (node.type !== 'image' || !isValidImageAdjustments(node.adjustments))) throw new TypeError(`Invalid image adjustments on layer ${node.name || node.id}.`);
      if (node.transforms != null && (node.type !== 'image' || !isValidImageTransforms(node.transforms))) throw new TypeError(`Invalid image transforms on layer ${node.name || node.id}.`);
      if (node.outputFormat != null && (node.type !== 'image' || !exportFormats.has(node.outputFormat))) throw new TypeError(`Invalid image output format on layer ${node.name || node.id}.`);
      if (node.outputQuality != null && (node.type !== 'image' || !Number.isInteger(node.outputQuality) || node.outputQuality < 1 || node.outputQuality > 100)) throw new TypeError(`Invalid image output quality on layer ${node.name || node.id}.`);
      if (node.type === 'path' && !validVectorPath(node)) throw new TypeError(`Invalid vector path on layer ${node.name || node.id}.`);
      if (node.type === 'network' && !validNetworkGeometry(node)) throw new TypeError(`Invalid vector network on layer ${node.name || node.id}.`);
      if (node.mask != null && typeof node.mask !== 'boolean') throw new TypeError(`Invalid mask setting on layer ${node.name || node.id}.`);
      if (node.mask && (node.type !== 'group' || !Array.isArray(node.children) || node.children.length < 2 || typeof node.maskSourceId !== 'string' || !isMaskSource(node.children.find(child => child.id === node.maskSourceId)))) throw new TypeError(`Invalid mask group on layer ${node.name || node.id}.`);
      if (node.exportSettings != null) {
        const settingIds = new Set();
        if (!Array.isArray(node.exportSettings) || node.exportSettings.length > 8 || node.exportSettings.some(setting => {
          if (!setting || typeof setting.id !== 'string' || !setting.id || settingIds.has(setting.id)
            || !exportFormats.has(setting.format) || ![0.5, 0.75, 1, 1.5, 2, 3, 4].includes(setting.scale)
            || typeof setting.suffix !== 'string' || setting.suffix.length > 24
            || !Number.isInteger(setting.quality) || setting.quality < 1 || setting.quality > 100
            || (setting.padding != null && (node.type !== 'slice' || !Number.isInteger(setting.padding) || setting.padding < 0 || setting.padding > 10_000))) return true;
          settingIds.add(setting.id); return false;
        })) throw new TypeError(`Invalid export settings on layer ${node.name || node.id}.`);
      }
      if (node.layoutGuides != null) {
        const guideIds = new Set();
        if (node.type !== 'frame' || !Array.isArray(node.layoutGuides) || node.layoutGuides.length > 32 || node.layoutGuides.some(guide => {
          const validMeasurement = value => Number.isFinite(value) && value >= 0 && value <= 10_000;
          if (!guide || typeof guide.id !== 'string' || !guide.id || guideIds.has(guide.id)
            || !layoutGuideTypes.has(guide.type) || typeof guide.visible !== 'boolean'
            || !/^#[0-9a-f]{6}$/i.test(guide.color) || !Number.isFinite(guide.opacity) || guide.opacity < 0 || guide.opacity > 1) return true;
          if (guide.type === 'grid') {
            if (!Number.isFinite(guide.size) || guide.size < 1 || guide.size > 500) return true;
          } else {
            const alignments = guide.type === 'columns' ? ['stretch', 'left', 'center', 'right'] : ['stretch', 'top', 'center', 'bottom'];
            if (!Number.isInteger(guide.count) || guide.count < 1 || guide.count > 64 || !alignments.includes(guide.alignment)
              || !validMeasurement(guide.gutter) || !validMeasurement(guide.margin)
              || !Number.isFinite(guide.bandSize) || guide.bandSize < 1 || guide.bandSize > 10_000
              || !validMeasurement(guide.offset)) return true;
          }
          guideIds.add(guide.id); return false;
        })) throw new TypeError(`Invalid layout guides on layer ${node.name || node.id}.`);
      }
      if (node.children && !Array.isArray(node.children)) throw new TypeError('Layer children must be a list.');
      if (node.autoLayout) {
        const layout = node.autoLayout;
        const validCount = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 64;
        const validGap = value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100_000;
        const validFlowGap = value => Number.isFinite(Number(value)) && Number(value) >= (layout.axis === 'grid' ? 0 : -100_000) && Number(value) <= 100_000;
        const validGridTracks = tracks => tracks === undefined || (Array.isArray(tracks) && tracks.length <= 64 && tracks.every(track => {
          if (!track || typeof track !== 'object' || Array.isArray(track) || !['fixed', 'hug', 'fill'].includes(track.mode)) return false;
          if (track.mode === 'fixed') return Number.isFinite(track.value) && track.value >= 0 && track.value <= 100_000 && track.weight === undefined;
          if (track.mode === 'fill') return track.value === undefined && (track.weight === undefined || (Number.isFinite(track.weight) && track.weight > 0 && track.weight <= 100_000));
          return track.value === undefined && track.weight === undefined;
        }));
        const padding = layout.padding == null ? {} : typeof layout.padding === 'object' ? layout.padding : { top: layout.padding, right: layout.padding, bottom: layout.padding, left: layout.padding };
        if (node.type !== 'frame' || !['horizontal', 'vertical', 'grid'].includes(layout.axis)
          || (layout.gap != null && !validFlowGap(layout.gap))
          || (layout.rowGap != null && !validFlowGap(layout.rowGap))
          || (layout.columnGap != null && !validFlowGap(layout.columnGap))
          || (layout.columns != null && !validCount(layout.columns))
          || (layout.rows != null && layout.rows !== 'auto' && !validCount(layout.rows))
          || ((layout.columnTracks != null || layout.rowTracks != null) && layout.axis !== 'grid')
          || !validGridTracks(layout.columnTracks) || !validGridTracks(layout.rowTracks)
          || (layout.autoPositioning != null && typeof layout.autoPositioning !== 'boolean')
          || ['top', 'right', 'bottom', 'left'].some(side => padding[side] != null && !validGap(padding[side]))) throw new TypeError(`Invalid auto layout on layer ${node.name || node.id}.`);
      }
      if (node.gridCell != null && (!node.gridCell || typeof node.gridCell !== 'object' || Array.isArray(node.gridCell)
        || ['row', 'column', 'rowSpan', 'columnSpan'].some(key => node.gridCell[key] != null && (!Number.isInteger(Number(node.gridCell[key])) || Number(node.gridCell[key]) < 1 || Number(node.gridCell[key]) > 64))
        || (node.gridCell.alignX != null && !['start', 'center', 'end'].includes(node.gridCell.alignX))
        || (node.gridCell.alignY != null && !['start', 'center', 'end'].includes(node.gridCell.alignY)))) throw new TypeError(`Invalid grid cell on layer ${node.name || node.id}.`);
      if (node.layoutPositioning != null && (!['auto', 'absolute'].includes(node.layoutPositioning)
        || (node.layoutPositioning === 'absolute' && !parent?.autoLayout))) {
        throw new TypeError(`Invalid layout positioning on layer ${node.name || node.id}.`);
      }
      if ((node.layoutSizingX != null && !['fixed', 'fill'].includes(node.layoutSizingX)) || (node.layoutSizingY != null && !['fixed', 'fill'].includes(node.layoutSizingY))) throw new TypeError(`Invalid grid sizing on layer ${node.name || node.id}.`);
      if (node.interactions != null && hasInvalidPrototypeInteractions(node.interactions, document)) throw new TypeError(`Invalid prototype interactions on layer ${node.name || node.id}.`);
      if (node.constraints != null && (!['left', 'right', 'left-right', 'center', 'scale'].includes(node.constraints.horizontal) || !['top', 'bottom', 'top-bottom', 'center', 'scale'].includes(node.constraints.vertical))) throw new TypeError(`Invalid frame constraints on layer ${node.name || node.id}.`);
      if (node.componentSourceId != null && typeof node.componentSourceId !== 'string') throw new TypeError(`Invalid component source layer on ${node.name || node.id}.`);
      if (node.componentSourceKey != null && typeof node.componentSourceKey !== 'string') throw new TypeError(`Invalid component source key on ${node.name || node.id}.`);
      if (node.nestedComponentSourceId != null && typeof node.nestedComponentSourceId !== 'string') throw new TypeError(`Invalid nested component source layer on ${node.name || node.id}.`);
      if (node.variantNodeKey != null && typeof node.variantNodeKey !== 'string') throw new TypeError(`Invalid variant node key on ${node.name || node.id}.`);
      if (node.linkedComponent != null) {
        try { validateLinkedInstanceSnapshot(node.linkedComponent); }
        catch (error) { throw new TypeError(`Invalid local component link on ${node.name || node.id}: ${error.message}`); }
        const sourceLayers = new Map();
        walkNodes([node.linkedComponent.root], ({ node: sourceNode }) => sourceLayers.set(sourceNode.id, sourceNode));
        const editorLayers = new Map();
        walkNodes([node], ({ node: editorNode }) => {
          if (typeof editorNode.componentSourceId !== 'string' || !editorNode.componentSourceId || editorLayers.has(editorNode.componentSourceId)) {
            throw new TypeError(`Invalid local component source-layer mapping on ${node.name || node.id}.`);
          }
          editorLayers.set(editorNode.componentSourceId, editorNode);
        });
        if (node.componentSourceId !== node.linkedComponent.root.id || editorLayers.size !== sourceLayers.size
          || [...sourceLayers].some(([sourceId, sourceNode]) => editorLayers.get(sourceId)?.type !== sourceNode.type)) {
          throw new TypeError(`Local component source-layer mapping does not match its snapshot on ${node.name || node.id}.`);
        }
      }
      if (node.componentNameIsInherited != null && (typeof node.componentNameIsInherited !== 'boolean' || !node.isInstance)) throw new TypeError(`Invalid inherited component name on ${node.name || node.id}.`);
      if (node.componentOverrides != null) {
        if (!node.isInstance || typeof node.componentOverrides !== 'object' || Array.isArray(node.componentOverrides)) throw new TypeError(`Invalid component overrides on ${node.name || node.id}.`);
        for (const [sourceId, overrides] of Object.entries(node.componentOverrides)) {
          if (!sourceId || !overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).some(key => !componentOverrideProperties.has(key)) || (overrides.__childOrder != null && (!Array.isArray(overrides.__childOrder) || overrides.__childOrder.some(id => typeof id !== 'string')))) throw new TypeError(`Invalid component override on ${node.name || node.id}.`);
          const sourceNode = findNodeAcrossPages(document, sourceId)?.node;
          if (Object.hasOwn(overrides, 'lineReverseY')
            && (sourceNode?.type !== 'line' || typeof overrides.lineReverseY !== 'boolean')) {
            throw new TypeError(`Invalid component line direction override on ${node.name || node.id}.`);
          }
          if (Object.hasOwn(overrides, 'points')) {
            if (['polygon', 'star'].includes(sourceNode?.type)) {
              if (!Number.isFinite(overrides.points) || overrides.points < 3 || overrides.points > 32) throw new TypeError(`Invalid component shape point-count override on ${node.name || node.id}.`);
            } else if (sourceNode?.type === 'path') {
              if (!Array.isArray(overrides.points) || overrides.points.some(point => !point
                || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))
                || ['in', 'out'].some(part => point[part] != null && (!Number.isFinite(Number(point[part].x)) || !Number.isFinite(Number(point[part].y))))
                || (point.mode != null && !['corner', 'smooth', 'symmetric'].includes(point.mode)))) {
                throw new TypeError(`Invalid component vector path points override on ${node.name || node.id}.`);
              }
            } else throw new TypeError(`Invalid component shape point-count override on ${node.name || node.id}.`);
          }
          const pathGeometryProperties = ['points', 'subpaths', 'closed', 'fillRule'];
          const hasPathGeometryOverride = ['subpaths', 'closed', 'fillRule'].some(property => Object.hasOwn(overrides, property))
            || (sourceNode?.type === 'path' && Object.hasOwn(overrides, 'points'));
          if (hasPathGeometryOverride) {
            if (sourceNode?.type !== 'path') throw new TypeError(`Invalid component vector path geometry override on ${node.name || node.id}.`);
            const candidate = { ...sourceNode };
            for (const property of pathGeometryProperties) {
              if (Object.hasOwn(overrides, property)) candidate[property] = overrides[property];
            }
            if (!validVectorPath(candidate)) throw new TypeError(`Invalid component vector path geometry override on ${node.name || node.id}.`);
          }
          if (overrides.innerRadius != null && (sourceNode?.type !== 'star' || !Number.isFinite(overrides.innerRadius) || overrides.innerRadius < 0 || overrides.innerRadius > 1)) throw new TypeError(`Invalid component star inner-radius override on ${node.name || node.id}.`);
          if (overrides.cornerRadii != null && (!['rectangle', 'frame', 'section', 'image'].includes(sourceNode?.type) || !isValidCornerRadii(overrides.cornerRadii))) throw new TypeError(`Invalid component corner-radius override on ${node.name || node.id}.`);
          if (overrides.interactions != null) {
            if (hasInvalidPrototypeInteractions(overrides.interactions, document)) throw new TypeError(`Invalid component interactions override on ${node.name || node.id}.`);
            const matchingInstanceNodes = [];
            walkNodes([node], ({ node: candidate }) => {
              if (candidate.componentSourceId === sourceId) matchingInstanceNodes.push(candidate);
            });
            if (matchingInstanceNodes.length !== 1
              || JSON.stringify(matchingInstanceNodes[0].interactions || []) !== JSON.stringify(overrides.interactions)) {
              throw new TypeError(`Component interactions override does not match its instance layer on ${node.name || node.id}.`);
            }
            for (const interaction of overrides.interactions) {
              if (interaction.action !== 'change-variant') continue;
              const instanceNode = matchingInstanceNodes[0];
              const component = instanceNode.isInstance ? document.components?.find(item => item.id === instanceNode.componentId) : null;
              const target = document.components?.find(item => item.id === interaction.targetVariantId);
              if (interaction.instanceId !== instanceNode.id || !component?.componentSetId
                || target?.componentSetId !== component.componentSetId || target.id === component.id) {
                throw new TypeError(`Invalid component variant target on prototype interaction ${interaction.id}.`);
              }
            }
          }
          if (overrides.textRuns != null) {
            const sourceText = overrides.text ?? sourceNode?.text;
            if ((sourceNode && sourceNode.type !== 'text') || !isValidTextRuns(overrides.textRuns, sourceText)) throw new TypeError(`Invalid component text runs override on ${node.name || node.id}.`);
          }
          if (overrides.fillGradient != null && !isValidGradientFill(overrides.fillGradient)) throw new TypeError(`Invalid component gradient override on ${node.name || node.id}.`);
          if (overrides.imageFill != null && (!isImageFillSupported(node) || !isValidImageFill(overrides.imageFill))) throw new TypeError(`Invalid component image fill override on ${node.name || node.id}.`);
          if (overrides.fills != null && !isValidFillStack(overrides.fills, sourceNode || node, { isValidImageFill, isImageFillSupported })) throw new TypeError(`Invalid component fill stack override on ${node.name || node.id}.`);
          if (overrides.strokes != null && !isValidStrokeStack(overrides.strokes, sourceNode || node)) throw new TypeError(`Invalid component stroke stack override on ${node.name || node.id}.`);
          if (overrides.blendMode != null && !isValidLayerBlendMode(overrides.blendMode)) throw new TypeError(`Invalid component blend mode override on ${node.name || node.id}.`);
          if (overrides.fontFamily != null && (node.type !== 'text' || typeof overrides.fontFamily !== 'string' || !overrides.fontFamily.trim() || overrides.fontFamily.length > 160 || /[\x00-\x1f]/.test(overrides.fontFamily))) throw new TypeError(`Invalid component font family override on ${node.name || node.id}.`);
          if (overrides.fontWeight != null && (node.type !== 'text' || !isValidFontWeight(overrides.fontWeight))) throw new TypeError(`Invalid component font weight override on ${node.name || node.id}.`);
          if (overrides.fontStyle != null && (node.type !== 'text' || !['normal', 'italic'].includes(overrides.fontStyle))) throw new TypeError(`Invalid component font style override on ${node.name || node.id}.`);
          if (overrides.textCase != null && (node.type !== 'text' || !textCases.has(overrides.textCase))) throw new TypeError(`Invalid component text case override on ${node.name || node.id}.`);
          if (overrides.textDecoration != null && (node.type !== 'text' || !textDecorations.has(overrides.textDecoration))) throw new TypeError(`Invalid component text decoration override on ${node.name || node.id}.`);
          if (overrides.align != null && (sourceNode?.type !== 'text' || !textAlignments.has(overrides.align))) throw new TypeError(`Invalid component text alignment override on ${node.name || node.id}.`);
          if (overrides.verticalAlign != null) {
            if (sourceNode?.type !== 'text' || !textVerticalAlignments.has(overrides.verticalAlign)) throw new TypeError(`Invalid component text vertical alignment override on ${node.name || node.id}.`);
          }
          if (['paragraphSpacing', 'firstLineIndent'].some(property => overrides[property] != null
            && (sourceNode?.type !== 'text' || !Number.isFinite(overrides[property]) || overrides[property] < 0 || overrides[property] > 10_000))) {
            throw new TypeError(`Invalid component paragraph typography override on ${node.name || node.id}.`);
          }
          if (overrides.listSpacing != null && (sourceNode?.type !== 'text' || !Number.isFinite(overrides.listSpacing) || overrides.listSpacing < 0 || overrides.listSpacing > 10_000)) {
            throw new TypeError(`Invalid component list spacing override on ${node.name || node.id}.`);
          }
          if (overrides.paragraphStyles != null) {
            const sourceText = overrides.text ?? sourceNode?.text;
            if (sourceNode?.type !== 'text' || typeof sourceText !== 'string' || !isValidTextParagraphStyles(overrides.paragraphStyles, sourceText)) {
              throw new TypeError(`Invalid component text paragraph styles override on ${node.name || node.id}.`);
            }
          }
          if (overrides.effects != null && !isValidLayerEffects(overrides.effects)) throw new TypeError(`Invalid component effects override on ${node.name || node.id}.`);
          if (overrides.layoutPositioning != null && (!['auto', 'absolute'].includes(overrides.layoutPositioning)
            || (overrides.layoutPositioning === 'absolute' && !findNodeAcrossPages(document, sourceId)?.parent?.autoLayout))) {
            throw new TypeError(`Invalid component layout positioning override on ${node.name || node.id}.`);
          }
        }
      }
      if (node.componentPropertyValues != null && (!node.isInstance || typeof node.componentPropertyValues !== 'object' || Array.isArray(node.componentPropertyValues))) throw new TypeError(`Invalid component property values on ${node.name || node.id}.`);
    });
  }
  if (hasInvalidPrototypeScrollTargets(document)) throw new TypeError('Prototype scroll-to interactions must target a layer inside a scrollable frame on the same prototype screen.');
  if (!pageIds.has(document.activePageId)) throw new TypeError('The active page does not exist.');
  if (document.prototypeFlows != null) {
    if (!Array.isArray(document.prototypeFlows) || document.prototypeFlows.length > 1000) throw new TypeError('Prototype flows must be a list of up to 1,000 flows.');
    const flowIds = new Set();
    const flowNames = new Set();
    for (const flow of document.prototypeFlows) {
      const normalizedName = typeof flow?.name === 'string' ? flow.name.trim().toLocaleLowerCase() : '';
      const target = flow && pageIds.has(flow.pageId) ? findNode(document, flow.nodeId, flow.pageId) : null;
      if (!flow || typeof flow !== 'object' || Array.isArray(flow)
        || typeof flow.id !== 'string' || !flow.id.trim() || flowIds.has(flow.id)
        || !normalizedName || flow.name.length > 120 || /[\x00-\x1f\x7f]/.test(flow.name) || flowNames.has(normalizedName)
        || target?.node.type !== 'frame') throw new TypeError('Invalid or duplicate prototype flow.');
      flowIds.add(flow.id);
      flowNames.add(normalizedName);
    }
    if (document.prototypeStartFlowId != null && !flowIds.has(document.prototypeStartFlowId)) throw new TypeError('The prototype start flow does not exist.');
  }
  if (document.prototypeStartPoint != null) {
    const start = document.prototypeStartPoint;
    const target = start && pageIds.has(start.pageId) ? findNode(document, start.nodeId, start.pageId) : null;
    if (!start || typeof start !== 'object' || Array.isArray(start) || target?.node.type !== 'frame') throw new TypeError('Invalid prototype starting point.');
  }
  if (document.comments != null) {
    if (!Array.isArray(document.comments) || document.comments.length > 10_000) throw new TypeError('Comments must be a list of up to 10,000 threads.');
    const threadIds = new Set();
    const messageIds = new Set();
    for (const thread of document.comments) {
      if (!thread || typeof thread.id !== 'string' || !thread.id || threadIds.has(thread.id)
        || !pageIds.has(thread.pageId) || !Number.isFinite(thread.x) || !Number.isFinite(thread.y)
        || Math.abs(thread.x) > 100_000_000 || Math.abs(thread.y) > 100_000_000
        || typeof thread.resolved !== 'boolean' || !Number.isFinite(thread.createdAt) || !Number.isFinite(thread.updatedAt)
        || !Array.isArray(thread.messages) || thread.messages.length < 1 || thread.messages.length > 100) throw new TypeError('Invalid comment thread.');
      threadIds.add(thread.id);
      for (const message of thread.messages) {
        if (!message || typeof message.id !== 'string' || !message.id || messageIds.has(message.id)
          || typeof message.author !== 'string' || !message.author.trim() || message.author.length > 40
          || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 4000
          || !Number.isFinite(message.createdAt)) throw new TypeError('Invalid comment message.');
        messageIds.add(message.id);
      }
    }
  }
  if (document.components != null) {
    if (!Array.isArray(document.components)) throw new TypeError('Components must be a list.');
    const componentIds = new Set();
    const componentPropertyIds = new Set();
    for (const component of document.components) {
      const root = findNodeAcrossPages(document, component.rootNodeId);
      if (!component.id || componentIds.has(component.id) || !root?.node.isComponent || root.node.componentId !== component.id) throw new TypeError('Invalid or duplicate component.');
      if (component.componentSetId != null && typeof component.componentSetId !== 'string') throw new TypeError('Invalid component set reference.');
      if (component.variantProperties != null && (!component.variantProperties || typeof component.variantProperties !== 'object' || Array.isArray(component.variantProperties) || Object.values(component.variantProperties).some(value => typeof value !== 'string' || !value))) throw new TypeError('Invalid component variant properties.');
      componentIds.add(component.id);
    }
    for (const component of document.components) {
      if (component.componentProperties != null && (!Array.isArray(component.componentProperties) || component.componentProperties.length > 100)) throw new TypeError(`Invalid component properties on ${component.name || component.id}.`);
      const propertyNames = new Set(); const propertyTargets = new Set();
      for (const property of component.componentProperties || []) {
        const nameKey = typeof property?.name === 'string' ? property.name.trim().toLocaleLowerCase() : '';
        const target = property?.targetSourceId && findComponentPropertyTarget(document, component, property.targetSourceId);
        const allowedKeys = new Set(['id', 'name', 'type', 'targetSourceId', 'defaultValue', 'preferredComponentIds']);
        if (!property || typeof property !== 'object' || Array.isArray(property)
          || Object.keys(property).some(key => !allowedKeys.has(key))
          || typeof property.id !== 'string' || !property.id || componentPropertyIds.has(property.id)
          || !nameKey || nameKey.length > 80 || propertyNames.has(nameKey)
          || !componentPropertyTypes.has(property.type)
          || typeof property.targetSourceId !== 'string' || !target
          || (property.type === 'SLOT' && !isComponentSlotTarget(target, component))) throw new TypeError(`Invalid component property on ${component.name || component.id}.`);
        const targetKey = `${property.type}:${property.targetSourceId}`;
        if (propertyTargets.has(targetKey)) throw new TypeError(`Duplicate component property target on ${component.name || component.id}.`);
        propertyTargets.add(targetKey); propertyNames.add(nameKey); componentPropertyIds.add(property.id);
        if ((property.type === 'BOOLEAN' && typeof property.defaultValue !== 'boolean')
          || (property.type === 'TEXT' && (target.type !== 'text' || typeof property.defaultValue !== 'string' || property.defaultValue.length > 1_000_000))
          || (property.type === 'INSTANCE_SWAP' && (!target.isInstance || !componentPropertyValueIsValid(document, component, property, property.defaultValue)))
          || (property.type === 'SLOT' && (!componentPropertyValueIsValid(document, component, property, property.defaultValue) || property.defaultValue.length !== 0))) throw new TypeError(`Invalid ${property.type} default on component property ${property.name}.`);
        if (property.preferredComponentIds != null) {
          if (property.type !== 'INSTANCE_SWAP' || !Array.isArray(property.preferredComponentIds)
            || new Set(property.preferredComponentIds).size !== property.preferredComponentIds.length
            || property.preferredComponentIds.some(targetId => !componentPropertyValueIsValid(document, component, property, targetId))) throw new TypeError(`Invalid swap choices on component property ${property.name}.`);
        }
      }
    }
    for (const page of document.pages) walkNodes(page.children, ({ node }) => {
      if (node.isComponent && !componentIds.has(node.componentId)) throw new TypeError(`Missing component definition on layer ${node.name || node.id}.`);
      if (node.isInstance && !componentIds.has(node.componentId)) throw new TypeError(`Missing component source on layer ${node.name || node.id}.`);
      if (node.componentPropertyValues != null) {
        const component = document.components.find(item => item.id === node.componentId);
        const properties = new Map((component?.componentProperties || []).map(property => [property.id, property]));
        if (Object.entries(node.componentPropertyValues).some(([propertyId, value]) => {
          const property = properties.get(propertyId);
          return !property || (property.type === 'SLOT'
            ? !componentSlotValueIsValidForInstance(document, node, component, property, value)
            : !componentPropertyValueIsValid(document, component, property, value));
        })) throw new TypeError(`Invalid component property value on layer ${node.name || node.id}.`);
      }
    });
  }
  if (document.componentSets != null) {
    if (!Array.isArray(document.componentSets)) throw new TypeError('Component sets must be a list.');
    const setIds = new Set(); const memberIds = new Set(); const components = document.components || [];
    for (const set of document.componentSets) {
      if (!set.id || setIds.has(set.id) || typeof set.name !== 'string' || !set.name.trim() || !Array.isArray(set.componentIds) || set.componentIds.length < 2 || new Set(set.componentIds).size !== set.componentIds.length || !Array.isArray(set.properties) || !set.properties.length) throw new TypeError('Invalid or duplicate component set.');
      setIds.add(set.id);
      const members = set.componentIds.map(id => components.find(component => component.id === id));
      if (members.some(component => !component || component.componentSetId !== set.id)) throw new TypeError('Component set members are missing or mismatched.');
      const propertyNames = new Set();
      for (const property of set.properties) {
        if (!property || typeof property.name !== 'string' || !property.name.trim() || propertyNames.has(property.name) || !Array.isArray(property.values) || !property.values.length || new Set(property.values).size !== property.values.length || property.values.some(value => typeof value !== 'string' || !value)) throw new TypeError('Invalid component variant property.');
        propertyNames.add(property.name);
        if (members.some(component => !property.values.includes(component.variantProperties?.[property.name]))) throw new TypeError(`Variant values are missing for property ${property.name}.`);
      }
      for (const component of members) memberIds.add(component.id);
      const combinations = members.map(component => JSON.stringify(set.properties.map(property => component.variantProperties[property.name])));
      if (new Set(combinations).size !== combinations.length) throw new TypeError('Component set contains duplicate variant combinations.');
    }
    for (const component of components) {
      if (component.componentSetId && (!setIds.has(component.componentSetId) || !memberIds.has(component.id))) throw new TypeError('Component points to a missing variant set.');
      if (!component.componentSetId && component.variantProperties != null) throw new TypeError('Variant properties require a component set.');
    }
  }
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    for (const interaction of node.interactions || []) {
      if (interaction.action !== 'change-variant') continue;
      const component = node.isInstance && node.id === interaction.instanceId
        ? (document.components || []).find(item => item.id === node.componentId)
        : null;
      const target = (document.components || []).find(item => item.id === interaction.targetVariantId);
      if (!component?.componentSetId || target?.componentSetId !== component.componentSetId || target.id === component.id) {
        throw new TypeError(`Invalid component variant target on prototype interaction ${interaction.id}.`);
      }
    }
  });
  const variableCollections = document.variableCollections ?? [];
  if (!Array.isArray(variableCollections)) throw new TypeError('Variable collections must be a list.');
  const collectionIds = new Set();
  const modesByCollection = new Map();
  for (const collection of variableCollections) {
    if (!collection.id || collectionIds.has(collection.id) || typeof collection.name !== 'string' || !collection.name.trim() || !Array.isArray(collection.modes) || !collection.modes.length) throw new TypeError('Invalid or duplicate variable collection.');
    collectionIds.add(collection.id);
    const modeIds = new Set();
    for (const mode of collection.modes) {
      if (!mode?.id || modeIds.has(mode.id) || typeof mode.name !== 'string' || !mode.name.trim()) throw new TypeError('Invalid or duplicate variable mode.');
      modeIds.add(mode.id);
    }
    if (!modeIds.has(collection.defaultModeId)) throw new TypeError('Variable collection default mode is missing.');
    modesByCollection.set(collection.id, modeIds);
  }
  if (document.variables != null && !Array.isArray(document.variables)) throw new TypeError('Variables must be a list.');
  const variables = document.variables ?? [];
  const variableIds = new Set();
  const variableNames = new Set();
  const variableById = new Map();
  for (const variable of variables) {
    const modes = modesByCollection.get(variable.collectionId);
    const values = variable.valuesByMode;
    const nameKey = `${variable.collectionId}:${String(variable.name || '').toLocaleLowerCase()}`;
    if (!variable.id || variableIds.has(variable.id) || !modes || typeof variable.name !== 'string' || !variable.name.trim() || variableNames.has(nameKey) || !variableTypes.has(variable.type) || !values || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Invalid or duplicate variable.');
    if (Object.keys(values).length !== modes.size || [...modes].some(modeId => !isVariableValue(variable.type, values[modeId]))) throw new TypeError(`Invalid mode values for variable ${variable.name}.`);
    variableIds.add(variable.id); variableNames.add(nameKey); variableById.set(variable.id, variable);
  }
  for (const variable of variables) {
    const modes = modesByCollection.get(variable.collectionId);
    const aliases = variable.aliasesByMode;
    if (aliases != null && (!aliases || typeof aliases !== 'object' || Array.isArray(aliases) || Object.keys(aliases).some(modeId => !modes.has(modeId)))) throw new TypeError(`Invalid aliases for variable ${variable.name}.`);
    for (const targetId of Object.values(aliases || {})) {
      const target = variableById.get(targetId);
      if (!target || target.id === variable.id || target.type !== variable.type) throw new TypeError(`Invalid alias for variable ${variable.name}.`);
    }
  }
  if (variableAliasesHaveCycle(variables)) throw new TypeError('Variable aliases cannot contain a cycle.');
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    for (const interaction of node.interactions || []) if (interaction.action === 'set-variable-mode') {
      const modes = modesByCollection.get(interaction.collectionId);
      const collection = variableCollections.find(item => item.id === interaction.collectionId);
      if (!modes || (interaction.modeId != null && !modes.has(interaction.modeId)) || (interaction.modeId == null && !collection?.defaultModeId)) {
        throw new TypeError(`Missing variable mode on prototype interaction ${interaction.id}.`);
      }
    }
    for (const [property, kind] of [['fillVariableId', 'fill'], ['textVariableId', 'text'], ['strokeVariableId', 'stroke']]) {
      const variable = variableById.get(node[property]);
      if (node[property] && (!variable || variable.type !== 'color')) throw new TypeError(`Missing ${kind} variable on layer ${node.name || node.id}.`);
      if (!variable) continue;
      const compatible = kind === 'text' ? node.type === 'text'
        : kind === 'fill' ? !['text', 'image', 'line'].includes(node.type) && (node.type !== 'path' || hasFillablePathContour(node)) && (node.type !== 'network' || (node.faces || []).length > 0)
          : !['text', 'image', 'group', 'boolean'].includes(node.type);
      if (!compatible) throw new TypeError(`Incompatible ${kind} variable on layer ${node.name || node.id}.`);
    }
    if (node.variableModes != null) {
      if (node.type !== 'frame' || !node.variableModes || typeof node.variableModes !== 'object' || Array.isArray(node.variableModes)) throw new TypeError(`Invalid variable mode overrides on layer ${node.name || node.id}.`);
      for (const [collectionId, modeId] of Object.entries(node.variableModes)) if (!modesByCollection.get(collectionId)?.has(modeId)) throw new TypeError(`Missing variable mode on layer ${node.name || node.id}.`);
    }
    if (node.variableBindings != null) {
      if (!node.variableBindings || typeof node.variableBindings !== 'object' || Array.isArray(node.variableBindings)) throw new TypeError(`Invalid variable bindings on layer ${node.name || node.id}.`);
      for (const [property, variableId] of Object.entries(node.variableBindings)) {
        const spec = variableBindingSpecs[property];
        const variable = variableById.get(variableId);
        const collection = variable && document.variableCollections.find(item => item.id === variable.collectionId);
        if (!spec || !canBindVariableToNode(node, property) || !variable || variable.type !== spec.type || !collection) throw new TypeError(`Invalid ${property} variable binding on layer ${node.name || node.id}.`);
        for (const mode of collection.modes) {
          const value = resolveVariableValueInternal(document, variable.id, node, new Map([[collection.id, mode.id]]), new Set());
          if (!isVariableBindingValue(property, value)) throw new TypeError(`Invalid ${property} value for variable binding on layer ${node.name || node.id}.`);
        }
      }
    }
    for (const [sourceId, overrides] of Object.entries(node.componentOverrides || {})) {
      const bindings = overrides.variableBindings;
      if (bindings == null) continue;
      if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw new TypeError(`Invalid component variable bindings on layer ${node.name || node.id}.`);
      const sourceNode = findNodeAcrossPages(document, sourceId)?.node;
      for (const [property, variableId] of Object.entries(bindings)) {
        const variable = variableById.get(variableId);
        if (!variable || !variableBindingSpecs[property] || variable.type !== variableBindingSpecs[property].type || (sourceNode && !canBindVariableToNode(sourceNode, property))) throw new TypeError(`Invalid component variable binding on layer ${node.name || node.id}.`);
      }
    }
  });
  if (!Array.isArray(document.recipes)) throw new TypeError('Recipes must be a list.');
  const recipeIds = new Set();
  for (const recipe of document.recipes) {
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)
      || typeof recipe.id !== 'string' || !recipe.id.trim()
      || typeof recipe.name !== 'string' || !recipe.name.trim() || recipe.name.length > 60
      || recipeIds.has(recipe.id)) {
      throw new TypeError('Invalid or duplicate image recipe identity.');
    }
    recipeIds.add(recipe.id);
  }
  if (document.recipes.some(recipe => recipe?.adjustments != null && !isValidImageAdjustments(recipe.adjustments))) {
    throw new TypeError('Invalid image adjustments in image recipe.');
  }
  if (document.recipes.some(recipe => recipe?.transforms != null && !isValidImageTransforms(recipe.transforms))) {
    throw new TypeError('Invalid image transforms in image recipe.');
  }
  if (document.recipes.some(recipe => recipe?.format != null && !exportFormats.has(recipe.format))) {
    throw new TypeError('Invalid image output format in image recipe.');
  }
  if (document.recipes.some(recipe => recipe?.quality != null
    && (!Number.isInteger(recipe.quality) || recipe.quality < 1 || recipe.quality > 100))) {
    throw new TypeError('Invalid image output quality in image recipe.');
  }
  if (document.recipes.some(recipe => recipe?.fit != null && !['cover', 'contain'].includes(recipe.fit))) {
    throw new TypeError('Invalid image fit mode in image recipe.');
  }
  if (document.recipes.some(recipe => recipe?.opacity != null
    && (!Number.isFinite(recipe.opacity) || recipe.opacity < 0 || recipe.opacity > 1))) {
    throw new TypeError('Invalid image opacity in image recipe.');
  }
  if (document.recipes.some(recipe => recipe?.effects != null && !isValidLayerEffects(recipe.effects))) {
    throw new TypeError('Invalid image effects in image recipe.');
  }
  if (document.recipes.some(recipe => recipe?.blendMode != null && !isValidLayerBlendMode(recipe.blendMode))) {
    throw new TypeError('Invalid image blend mode in image recipe.');
  }
  if (document.colorStyles != null) {
    if (!Array.isArray(document.colorStyles)) throw new TypeError('Color styles must be a list.');
    const styleIds = new Set();
    for (const style of document.colorStyles) {
      if (!style.id || styleIds.has(style.id) || !['fill', 'text'].includes(style.kind) || !/^#[0-9a-f]{6}$/i.test(style.value || '')) throw new TypeError('Invalid or duplicate color style.');
      styleIds.add(style.id);
    }
    for (const page of document.pages) walkNodes(page.children, ({ node }) => {
      if (node.fillStyleId && !styleIds.has(node.fillStyleId)) throw new TypeError(`Missing fill style on layer ${node.name || node.id}.`);
      if (node.textStyleId && !styleIds.has(node.textStyleId)) throw new TypeError(`Missing text style on layer ${node.name || node.id}.`);
    });
  }
  if (document.typographyStyles != null) {
    if (!Array.isArray(document.typographyStyles) || document.typographyStyles.length > 1000) throw new TypeError('Text styles must be a list of up to 1,000 presets.');
    const styleIds = new Set();
    for (const style of document.typographyStyles) {
      if (!style || typeof style.id !== 'string' || !style.id || styleIds.has(style.id)
        || typeof style.name !== 'string' || !style.name.trim() || style.name.length > 120 || /[\x00-\x1f\x7f]/.test(style.name)
        || typeof style.fontFamily !== 'string' || !style.fontFamily.trim() || style.fontFamily.length > 160 || /[\x00-\x1f]/.test(style.fontFamily)
        || !Number.isFinite(style.fontSize) || style.fontSize <= 0
        || !isValidFontWeight(style.fontWeight)
        || !['normal', 'italic'].includes(style.fontStyle)
        || !Number.isFinite(style.lineHeight) || style.lineHeight <= 0
        || !Number.isFinite(style.letterSpacing)
        || (style.paragraphSpacing != null && (!Number.isFinite(style.paragraphSpacing) || style.paragraphSpacing < 0 || style.paragraphSpacing > 10_000))
        || (style.firstLineIndent != null && (!Number.isFinite(style.firstLineIndent) || style.firstLineIndent < 0 || style.firstLineIndent > 10_000))
        || (style.listSpacing != null && (!Number.isFinite(style.listSpacing) || style.listSpacing < 0 || style.listSpacing > 10_000))
        || !textAlignments.has(style.align)
        || (style.verticalAlign != null && !textVerticalAlignments.has(style.verticalAlign))
        || (style.textCase != null && !textCases.has(style.textCase))
        || (style.textDecoration != null && !textDecorations.has(style.textDecoration))
        || !/^#[0-9a-f]{6}$/i.test(style.color || '')) throw new TypeError('Invalid or duplicate text style.');
      styleIds.add(style.id);
    }
  }
  if (document.effectStyles != null) {
    if (!Array.isArray(document.effectStyles) || document.effectStyles.length > MAX_EFFECT_STYLES) throw new TypeError(`Effect styles must be a list of up to ${MAX_EFFECT_STYLES.toLocaleString()} presets.`);
    const styleIds = new Set();
    for (const style of document.effectStyles) {
      if (!style || typeof style.id !== 'string' || !style.id || styleIds.has(style.id)
        || typeof style.name !== 'string' || !style.name.trim() || style.name.length > 120 || /[\x00-\x1f\x7f]/.test(style.name)
        || !isValidLayerEffects(style.effects)) throw new TypeError('Invalid or duplicate effect style.');
      styleIds.add(style.id);
    }
  }
  return true;
}

export function serializeDocument(document) {
  validateDocument(document);
  return JSON.stringify(document);
}

export function parseDocument(json) {
  const source = typeof json === 'string' ? JSON.parse(json) : json;
  // Check before structuredClone: a hostile object graph can be nested deeply
  // enough to fail inside cloning before ordinary validation gets control.
  assertDocumentTreeBounds(source);
  const document = typeof json === 'string' ? source : clone(source);
  // Older local files stored only one prototypeStartPoint. Promote that entry to
  // the named-flow model while retaining the legacy field for older readers.
  if (!Array.isArray(document.prototypeFlows)) document.prototypeFlows = [];
  if (document.prototypeStartPoint && document.prototypeFlows.length === 0) {
    document.prototypeFlows.push({
      id: 'prototype-flow-legacy',
      name: 'Flow 1',
      pageId: document.prototypeStartPoint.pageId,
      nodeId: document.prototypeStartPoint.nodeId
    });
  }
  if (document.prototypeStartFlowId == null && document.prototypeFlows.length) {
    document.prototypeStartFlowId = document.prototypeFlows[0].id;
  }
  validateDocument(document);
  return document;
}
