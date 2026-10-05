import { cloneDocument, createId, createNode, findNode, validateDocument, walkNodes } from './model.js';
import { fillStackForNode, isFillStackSupported, syncLegacyFillFields } from './fills.js';
import { effectiveStrokeAlignment } from './stroke-alignment.js';
import { isUniformStrokeSideWidths, strokeSideNames, strokeSideWidths, strokeStackForNode, syncLegacyStrokeFields } from './strokes.js';
import { nodeToParentTransform } from './transform-geometry.js';
import { nativePathGeometryForNode } from './vector-shape-geometry.js';
import { outlineStrokeGeometry } from './vector-geometry-runtime.js';
import { outlinedGeometryToPathGeometry } from './vector-outline-conversion.js';

export const MAX_OUTLINE_STROKE_SELECTION = 64;
export const MAX_OUTLINE_STROKE_SELECTION_COMMANDS = 100_000;
export const MAX_OUTLINE_STROKE_SELECTION_POINTS = 100_000;
const MAX_OUTLINE_SNAPSHOT_CHARACTERS = 4_000_000;
const supportedTypes = new Set(['rectangle', 'ellipse', 'star', 'polygon', 'line', 'path', 'network']);
const geometryBindings = ['x', 'y', 'width', 'height', 'rotation', 'radius'];
const plans = new WeakMap();
const clone = value => structuredClone(value);
const abort = signal => { if (signal?.aborted) throw new DOMException('Outline Stroke cancelled.', 'AbortError'); };

function hasWidth(stroke) {
  return Math.max(stroke.width || 0, ...strokeSideNames.map(side => strokeSideWidths(stroke)[side])) > 0;
}

function entriesForSelection(document, nodeIds, pageId) {
  if (!Array.isArray(nodeIds) || !nodeIds.length) throw new Error('Select a stroked vector layer first.');
  if (nodeIds.length > MAX_OUTLINE_STROKE_SELECTION) throw new Error('Outline up to 64 vector layers at a time.');
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error('The outline selection contains duplicate layers.');
  const entries = nodeIds.map(id => findNode(document, id, pageId));
  if (entries.some(entry => !entry)) throw new Error('A selected layer is no longer on this page.');
  const linkedTextSources = new Set();
  for (const page of document.pages) walkNodes(page.children, ({ node }) => { if (node.type === 'text' && node.textPath?.sourceId) linkedTextSources.add(node.textPath.sourceId); });
  for (const entry of entries) {
    const node = entry.node;
    const label = `“${node.name || node.type}”`;
    if (!supportedTypes.has(node.type)) throw new Error(`Outline Stroke supports shapes, lines, paths, and vector networks. ${label} is not supported yet.`);
    if (node.locked || entry.parents.some(parent => parent.locked)) throw new Error(`Unlock ${label} and its parent layers before outlining.`);
    if (node.isComponent || node.isInstance || entry.parents.some(parent => parent.isComponent || parent.isInstance)) throw new Error('Detach the component before outlining its strokes.');
    if (node.children?.length) throw new Error(`Outline leaf vector layers first. ${label} has children.`);
    if (document.motion?.tracks.some(track => track.nodeId === node.id)) throw new Error(`Remove motion tracks from ${label} before outlining its strokes.`);
    if (linkedTextSources.has(node.id)) throw new Error(`Detach linked text from ${label} before outlining its strokes.`);
    if (entry.parents.some(parent => parent.type === 'boolean' || parent.mask)) throw new Error('Separate the Boolean or release the mask before outlining its source strokes.');
    if (node.effects?.length || node.effectStyleId) throw new Error(`Remove effects from ${label} before outlining. Effect ordering on outlined paths is not supported yet.`);
    if (geometryBindings.some(key => node.variableBindings?.[key])) throw new Error(`Detach position, size, rotation, and corner-radius variables from ${label} before outlining.`);
    if (entry.parent?.autoLayout && node.layoutPositioning !== 'absolute') throw new Error(`Set ${label} to absolute positioning before outlining its strokes.`);
    if (fillStackForNode(node).some(paint => paint.blendMode && paint.blendMode !== 'normal')
      || strokeStackForNode(node).some(paint => paint.blendMode && paint.blendMode !== 'normal')) throw new Error(`Set fill and stroke paint blending on ${label} to Normal before outlining.`);
    const strokes = strokeStackForNode(node);
    if (!strokes.some(stroke => stroke.visible !== false && hasWidth(stroke))) throw new Error(`Add a visible stroke to ${label} before outlining.`);
    for (const stroke of strokes.filter(hasWidth)) {
      if (stroke.startDecoration && stroke.startDecoration !== 'none' || stroke.endDecoration && stroke.endDecoration !== 'none') throw new Error(`Remove endpoint decorations from ${label} before outlining.`);
      if (stroke.pattern === 'custom' && stroke.dashArray?.length !== 2) throw new Error(`Outline Stroke currently supports solid strokes or one dash-and-gap pair. Simplify the custom dash pattern on ${label} first.`);
      if (stroke.pattern === 'custom' && !(stroke.dashArray?.[1] > 0)) throw new Error(`Set a positive dash gap on ${label} before outlining. Zero-gap corner and cap behavior is not supported yet.`);
      if (stroke.gradient && (node.width === 0 || node.height === 0)) throw new Error(`Give ${label} a nonzero width and height before outlining a gradient stroke.`);
      const independentRuns = node.type === 'network' || node.type === 'rectangle' && !isUniformStrokeSideWidths(strokeSideWidths(stroke));
      const partialPaint = (stroke.opacity ?? 1) !== 1 || (node.opacity ?? 1) !== 1 || node.variableBindings?.opacity
        || stroke.gradient?.stops.some(stop => (stop.opacity ?? 1) !== 1);
      if (independentRuns && effectiveStrokeAlignment(node, stroke) === 'center' && partialPaint) throw new Error(`Centered network and individual-side strokes on ${label} need opaque paints and full layer opacity before outlining. Overlapping translucent runs are not supported yet.`);
    }
  }
  return entries;
}

/** Shared availability explanation for the context menu, inspector and action search. */
export function outlineStrokeUnavailableReason(document, nodeIds, pageId = document.activePageId) {
  try { entriesForSelection(document, nodeIds, pageId); return ''; }
  catch (error) { return error.message; }
}

function contextSnapshot(document, entry, pageId) {
  return JSON.stringify({
    node: entry.node, pageId,
    parents: entry.parents.map(parent => ({
      id: parent.id, locked: parent.locked, isComponent: parent.isComponent, isInstance: parent.isInstance,
      type: parent.type, mask: parent.mask, autoLayout: parent.autoLayout, variableModes: parent.variableModes
    }))
  });
}

function clearStrokes(node) { node.strokes = []; syncLegacyStrokeFields(node); }
function clearFills(node) {
  node.fills = []; syncLegacyFillFields(node);
  delete node.fillVariableId; delete node.fillStyleId;
}

function retainedFill(node) {
  return isFillStackSupported(node) && (node.fillVariableId || node.fillStyleId || fillStackForNode(node).some(fill => fill.type !== 'solid' || fill.color !== 'transparent'))
    || node.type === 'network' && node.faces?.some(face => face.fill && face.fill !== 'transparent');
}

function strokeFill(stroke) {
  const base = { id: createId('fill'), visible: stroke.visible !== false, opacity: stroke.opacity ?? 1, blendMode: stroke.blendMode || 'normal' };
  return stroke.gradient ? { ...base, type: stroke.gradient.type, gradient: clone(stroke.gradient) }
    : { ...base, type: 'solid', color: stroke.color || 'transparent' };
}

function localFillSource(node) {
  const source = clone(node);
  Object.assign(source, { id: createId(node.type), name: `${node.name || node.type} fill`, x: 0, y: 0, rotation: 0, opacity: 1, visible: true, locked: false, blendMode: 'normal', effects: [], interactions: [], exportSettings: [] });
  delete source.affineTransform; delete source.variableModes;
  delete source.variableBindings; delete source.strokeVariableId;
  for (const key of Object.keys(source)) if (key.startsWith('layout') || key === 'gridCell') delete source[key];
  clearStrokes(source);
  return source;
}

function transferTransform(source, replacement) {
  // Zero-height lines need positive native-path dimensions. Compensate their
  // center-of-rotation shift, including shear/reflection, without moving ink.
  const before = nodeToParentTransform(source); const after = nodeToParentTransform(replacement);
  replacement.x += before.e - after.e; replacement.y += before.f - after.f;
}

async function outlinedReplacement(node, shape, outline, signal, budget) {
  const width = node.width > 0 ? node.width : 1; const height = node.height > 0 ? node.height : 1;
  const paths = [];
  for (const [index, stroke] of strokeStackForNode(node).entries()) {
    abort(signal);
    if (!hasWidth(stroke)) continue;
    const result = await outline(shape, { ...clone(stroke), alignment: effectiveStrokeAlignment(node, stroke) }, { signal });
    abort(signal);
    const geometry = outlinedGeometryToPathGeometry(result, width, height);
    budget.points += geometry.points.length + (geometry.subpaths || []).reduce((sum, contour) => sum + contour.points.length, 0);
    if (budget.points > MAX_OUTLINE_STROKE_SELECTION_POINTS) throw new Error('This selection exceeds the 100,000-point outline budget. Outline fewer layers or simplify their strokes.');
    if (!geometry.points?.length) throw new Error(`The stroke on “${node.name || node.type}” has no outline. The original layer was kept.`);
    const path = createNode('path', { name: `${node.name || node.type} stroke ${index + 1}`, width, height, ...geometry,
      fills: [strokeFill(stroke)], strokes: [], fill: 'transparent', stroke: null, strokeWidth: 0 });
    syncLegacyFillFields(path);
    if (index === 0 && node.strokeVariableId) path.fillVariableId = node.strokeVariableId;
    paths.push(path);
  }
  const keepFill = retainedFill(node);
  const replacement = clone(node);
  clearStrokes(replacement); clearFills(replacement);
  Object.assign(replacement, { width, height, children: [] });
  // Keep the original ID for selection, comments, prototypes and motion. Shape
  // metadata is replaced by native contours or by explicit child paint layers.
  for (const key of ['points', 'subpaths', 'closed', 'fillRule', 'vertices', 'edges', 'faces', 'arcData', 'vertexRadii', 'innerRadius', 'cornerRadii', 'cornerSmoothing', 'lineReverseY']) delete replacement[key];
  replacement.radius = 0;
  if (!keepFill && paths.length === 1) {
    const path = paths[0];
    Object.assign(replacement, { type: 'path', points: path.points, subpaths: path.subpaths, closed: path.closed, fillRule: path.fillRule, fills: path.fills });
    if (path.fillVariableId) replacement.fillVariableId = path.fillVariableId;
    syncLegacyFillFields(replacement);
  } else {
    Object.assign(replacement, { type: 'group', clip: false, mask: false, children: [...(keepFill ? [localFillSource(node)] : []), ...paths] });
  }
  transferTransform(node, replacement);
  return replacement;
}

/** Compute all geometry first. A failed/cancelled selection changes no layer. */
export async function prepareOutlineStroke(document, nodeIds, { pageId = document.activePageId, signal, outline = outlineStrokeGeometry } = {}) {
  abort(signal);
  const entries = entriesForSelection(document, nodeIds, pageId);
  let commandCount = 0;
  const shapes = entries.map(entry => {
    const shape = nativePathGeometryForNode(entry.node);
    for (const contours of [shape.strokeContours, shape.alignedStrokeContours, ...shape.fillGroups.map(group => group.contours)]) {
      commandCount += contours.reduce((sum, contour) => sum + contour.commands.length, 0);
    }
    if (commandCount > MAX_OUTLINE_STROKE_SELECTION_COMMANDS) throw new Error('This selection exceeds the 100,000-command outline budget. Outline fewer layers or simplify their geometry.');
    return shape;
  });
  const snapshots = entries.map(entry => contextSnapshot(document, entry, pageId));
  if (snapshots.reduce((sum, snapshot) => sum + snapshot.length, 0) > MAX_OUTLINE_SNAPSHOT_CHARACTERS) throw new Error('This selection is too large to outline safely in one edit. Outline fewer layers at a time.');
  const sources = entries.map(entry => clone(entry.node));
  const replacements = [];
  const budget = { points: 0 };
  for (const [index, source] of sources.entries()) replacements.push(await outlinedReplacement(source, shapes[index], outline, signal, budget));
  abort(signal);
  const plan = Object.freeze({ pageId, nodeIds: Object.freeze([...nodeIds]) });
  plans.set(plan, { document, snapshots, replacements });
  validateOutlineStrokePlan(document, plan);
  return plan;
}

function preparedEntries(document, plan) {
  const prepared = plans.get(plan);
  if (!prepared || prepared.document !== document) throw new Error('Prepare Outline Stroke in this design before applying it.');
  const entries = entriesForSelection(document, plan.nodeIds, plan.pageId);
  for (const [index, entry] of entries.entries()) if (contextSnapshot(document, entry, plan.pageId) !== prepared.snapshots[index]) throw new Error('A selected layer or its editing context changed while outlining. Try Outline Stroke again.');
  return { prepared, entries };
}

/** Validate the complete future design, including tree, font and motion limits. */
export function validateOutlineStrokePlan(document, plan) {
  const { prepared } = preparedEntries(document, plan);
  const candidate = cloneDocument(document);
  for (const [index, id] of plan.nodeIds.entries()) {
    const entry = findNode(candidate, id, plan.pageId);
    const list = entry.parent ? entry.parent.children : candidate.pages.find(page => page.id === plan.pageId).children;
    list[entry.index] = clone(prepared.replacements[index]);
  }
  validateDocument(candidate);
  return true;
}

/** Commit a prepared selection synchronously, retaining root layer identities. */
export function applyOutlineStroke(document, plan) {
  validateOutlineStrokePlan(document, plan);
  const { prepared, entries } = preparedEntries(document, plan);
  for (const [index, entry] of entries.entries()) {
    const replacement = prepared.replacements[index];
    for (const key of Object.keys(entry.node)) if (!Object.hasOwn(replacement, key)) delete entry.node[key];
    Object.assign(entry.node, replacement);
  }
  plans.delete(plan);
  return entries.map(entry => entry.node);
}
