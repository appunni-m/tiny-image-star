import { cloneDocument, createId, createNode, findNode, getNodeGeometry, getNodeTextPath, getNodePropertyValue, getNodeColor, validateDocument, walkNodes } from './model.js';
import { fillStackForNode, isFillStackSupported, syncLegacyFillFields } from './fills.js';
import { effectiveStrokeAlignment } from './stroke-alignment.js';
import { isUniformStrokeSideWidths, strokeSideNames, strokeSideWidths, strokeStackForNode, syncLegacyStrokeFields } from './strokes.js';
import { nodeToParentTransform } from './transform-geometry.js';
import { nativePathGeometryForNode } from './vector-shape-geometry.js';
import { booleanGeometry as defaultBooleanGeometry, outlineStrokeGeometry } from './vector-geometry-runtime.js';
import { outlinedGeometryToPathGeometry } from './vector-outline-conversion.js';

export const MAX_OUTLINE_STROKE_SELECTION = 64;
export const MAX_OUTLINE_STROKE_SELECTION_COMMANDS = 100_000;
export const MAX_OUTLINE_STROKE_SELECTION_POINTS = 100_000;
export const MAX_OUTLINE_STROKE_SELECTION_NODES = 20_000;
const MAX_OUTLINE_SNAPSHOT_CHARACTERS = 4_000_000;
const supportedTypes = new Set(['rectangle', 'ellipse', 'star', 'polygon', 'line', 'path', 'network']);
const geometryBindings = ['x', 'y', 'width', 'height', 'rotation', 'radius'];
const textStyleProperties = ['text', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontAxes', 'fontFeatures', 'lineHeight', 'lineHeightUnit', 'letterSpacing', 'paragraphSpacing', 'firstLineIndent', 'listSpacing', 'textCase', 'textDecoration', 'textDecorationStyle', 'textDecorationThickness', 'textDecorationOffset', 'textDecorationColor', 'textDecorationSkipInk', 'textPosition', 'textWrapStyle', 'align', 'verticalAlign', 'textFit', 'textTruncation', 'maxLines', 'paragraphStyles', 'textRuns', 'color', 'fillOpacity', 'textPath'];
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
    const isText = node.type === 'text';
    if (!supportedTypes.has(node.type) && !isText) throw new Error(`Outline Stroke supports text, shapes, lines, paths, and vector networks. ${label} is not supported yet.`);
    if (node.locked || entry.parents.some(parent => parent.locked)) throw new Error(`Unlock ${label} and its parent layers before outlining.`);
    if (node.isComponent || node.isInstance || entry.parents.some(parent => parent.isComponent || parent.isInstance)) throw new Error('Detach the component before outlining its strokes.');
    if (node.children?.length) throw new Error(`Outline leaf vector layers first. ${label} has children.`);
    if (document.motion?.tracks.some(track => track.nodeId === node.id)) throw new Error(`Remove motion tracks from ${label} before outlining its strokes.`);
    if (linkedTextSources.has(node.id)) throw new Error(`Detach linked text from ${label} before outlining its strokes.`);
    if (entry.parents.some(parent => parent.type === 'boolean' || parent.mask)) throw new Error('Separate the Boolean or release the mask before outlining its source strokes.');
    if (!isText && (node.effects?.length || node.effectStyleId)) throw new Error(`Remove effects from ${label} before outlining. Effect ordering on outlined paths is not supported yet.`);
    const blockedGeometryBindings = isText ? ['width', 'height'] : geometryBindings;
    if (blockedGeometryBindings.some(key => node.variableBindings?.[key])) throw new Error(`Detach position and size variables from ${label} before outlining.`);
    if (!isText && entry.parent?.autoLayout && node.layoutPositioning !== 'absolute') throw new Error(`Set ${label} to absolute positioning before outlining its strokes.`);
    if (fillStackForNode(node).some(paint => paint.blendMode && paint.blendMode !== 'normal')
      || strokeStackForNode(node).some(paint => paint.blendMode && paint.blendMode !== 'normal')) throw new Error(`Set fill and stroke paint blending on ${label} to Normal before outlining.`);
    const strokes = strokeStackForNode(node);
    if (!isText && !strokes.some(stroke => stroke.visible !== false && hasWidth(stroke))) throw new Error(`Add a visible stroke to ${label} before outlining.`);
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
    ...(entry.node.type === 'text' ? {
      resolved: {
        geometry: getNodeGeometry(document, entry.node),
        textPath: getNodeTextPath(document, entry.node),
        textPathSource: entry.node.textPath?.sourceId ? findNode(document, entry.node.textPath.sourceId, pageId)?.node : null,
        text: getNodePropertyValue(document, entry.node, 'text'),
        fontFamily: getNodePropertyValue(document, entry.node, 'fontFamily'),
        fontSize: getNodePropertyValue(document, entry.node, 'fontSize'),
        fontWeight: getNodePropertyValue(document, entry.node, 'fontWeight'),
        fontStyle: getNodePropertyValue(document, entry.node, 'fontStyle'),
        lineHeight: getNodePropertyValue(document, entry.node, 'lineHeight'),
        letterSpacing: getNodePropertyValue(document, entry.node, 'letterSpacing'),
        color: getNodeColor(document, entry.node, 'text')
      },
      variables: document.variables, variableCollections: document.variableCollections,
      typographyStyles: document.typographyStyles, colorStyles: document.colorStyles
    } : {}),
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

function editableGeometryFromNativeShape(shape, width, height) {
  const safeWidth = width > 0 ? width : 1; const safeHeight = height > 0 ? height : 1;
  const point = value => ({ x: value.x / safeWidth, y: value.y / safeHeight, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } });
  const paths = [];
  for (const group of shape?.fillGroups || []) {
    if (!['nonzero', 'evenodd'].includes(group.fillRule) || !Array.isArray(group.contours)) throw new Error('The text glyph fill has unsupported winding geometry.');
    const convert = contour => {
      if (!contour?.closed || !Array.isArray(contour.commands)) throw new Error('A shaped glyph outline contains an open fill contour.');
      const points = [point(contour.start)];
      for (const command of contour.commands) {
        const start = command.start; const end = command.end; const previous = points.at(-1);
        if (command.type === 'line') {
          points.push(point(end));
        } else if (command.type === 'quadratic') {
          const control1 = { x: start.x + 2 * (command.control.x - start.x) / 3, y: start.y + 2 * (command.control.y - start.y) / 3 };
          const control2 = { x: end.x + 2 * (command.control.x - end.x) / 3, y: end.y + 2 * (command.control.y - end.y) / 3 };
          previous.out = { x: (control1.x - start.x) / safeWidth, y: (control1.y - start.y) / safeHeight };
          const anchor = point(end); anchor.in = { x: (control2.x - end.x) / safeWidth, y: (control2.y - end.y) / safeHeight };
          points.push(anchor);
        } else if (command.type === 'cubic') {
          previous.out = { x: (command.control1.x - start.x) / safeWidth, y: (command.control1.y - start.y) / safeHeight };
          const anchor = point(end); anchor.in = { x: (command.control2.x - end.x) / safeWidth, y: (command.control2.y - end.y) / safeHeight };
          points.push(anchor);
        } else throw new Error('The local glyph contains a curve that cannot be represented as an editable path.');
      }
      const first = points[0]; const last = points.at(-1);
      if (points.length > 1 && Math.abs(last.x - first.x) <= 1e-12 && Math.abs(last.y - first.y) <= 1e-12) {
        first.in = last.in; points.pop();
      }
      return points;
    };
    const contours = group.contours.map(convert).filter(points => points.length >= 2);
    const first = contours.shift() || [];
    paths.push({ closed: true, points: first,
      ...(contours.length ? { subpaths: contours.map(points => ({ closed: true, points })) } : {}), fillRule: group.fillRule });
  }
  return paths;
}

function geometryCommandCount(shape) {
  return (shape?.fillGroups || []).reduce((sum, group) => sum + (group.contours || []).reduce((value, contour) => value + (contour.commands?.length || 0) + 1, 0), 0);
}

function editablePathNode(name, width, height, geometry, fill) {
  const path = createNode('path', { name, width, height, ...clone(geometry), fills: [clone(fill)], strokes: [], fill: 'transparent', stroke: null, strokeWidth: 0 });
  syncLegacyFillFields(path);
  return path;
}

function pathPointCount(path) {
  return (path.points?.length || 0) + (path.subpaths || []).reduce((sum, contour) => sum + (contour.points?.length || 0), 0);
}

function chargeNodes(budget, amount) {
  budget.nodes += amount;
  if (budget.nodes > MAX_OUTLINE_STROKE_SELECTION_NODES) throw new Error('This selection exceeds the 20,000 editable-outline layer budget. Outline fewer glyphs or paint layers at a time.');
}

function identityShapeNode(width, height, pathGeometry) {
  return nativePathGeometryForNode({ type: 'path', width, height, ...pathGeometry });
}

const identityTextStrokeTransform = Object.freeze([1, 0, 0, 1, 0, 0]);

function textStrokeTransform(value) {
  const matrix = value ?? identityTextStrokeTransform;
  if (!Array.isArray(matrix) || matrix.length !== 6 || matrix.some(part => !Number.isFinite(part))) {
    throw new Error('The local text outline has an invalid stroke transform.');
  }
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error('The local text outline has a singular stroke transform.');
  }
  return { matrix, inverse: [d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * f - d * e) / determinant, (b * e - a * f) / determinant] };
}

function mapTextOutlineShape(shape, matrix) {
  const [a, b, c, d, e, f] = matrix;
  const mapPoint = point => ({ ...point, x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f });
  const contours = list => list.map(contour => ({ ...contour, start: mapPoint(contour.start), commands: contour.commands.map(command => {
    const mapped = { ...command, start: mapPoint(command.start), end: mapPoint(command.end) };
    if (command.control) mapped.control = mapPoint(command.control);
    if (command.control1) mapped.control1 = mapPoint(command.control1);
    if (command.control2) mapped.control2 = mapPoint(command.control2);
    return mapped;
  }) }));
  return { ...shape,
    fillGroups: (shape.fillGroups || []).map(group => ({ ...group, contours: contours(group.contours || []) })),
    strokeContours: contours(shape.strokeContours || []),
    alignedStrokeContours: contours(shape.alignedStrokeContours || []) };
}

function mapTextOutlinePath(path, width, height, matrix) {
  const [a, b, c, d, e, f] = matrix;
  const safeWidth = width > 0 ? width : 1; const safeHeight = height > 0 ? height : 1;
  const mapPoint = point => ({ ...point,
    x: (a * point.x * safeWidth + c * point.y * safeHeight + e) / safeWidth,
    y: (b * point.x * safeWidth + d * point.y * safeHeight + f) / safeHeight,
    in: { x: (a * point.in.x * safeWidth + c * point.in.y * safeHeight) / safeWidth,
      y: (b * point.in.x * safeWidth + d * point.in.y * safeHeight) / safeHeight },
    out: { x: (a * point.out.x * safeWidth + c * point.out.y * safeHeight) / safeWidth,
      y: (b * point.out.x * safeWidth + d * point.out.y * safeHeight) / safeHeight } });
  return { ...path, points: (path.points || []).map(mapPoint),
    ...(path.subpaths ? { subpaths: path.subpaths.map(contour => ({ ...contour, points: contour.points.map(mapPoint) })) } : {}) };
}

function commonTextStrokeTransform(glyphs) {
  const metricFor = glyph => {
    const [a, b, c, d] = textStrokeTransform(glyph?.strokeTransform).matrix;
    return [a * a + c * c, a * b + c * d, b * b + d * d];
  };
  const first = metricFor(glyphs[0]);
  for (const glyph of glyphs.slice(1)) {
    const metric = metricFor(glyph); const tolerance = 1e-9 * Math.max(1, ...first.map(Math.abs), ...metric.map(Math.abs));
    if (metric.some((value, index) => Math.abs(value - first[index]) > tolerance)) {
      throw new Error('Aligned strokes on text with incompatible glyph scale transforms are not supported yet.');
    }
  }
  const [xx, xy, yy] = first; const determinantRoot = Math.sqrt(xx * yy - xy * xy);
  const denominator = Math.sqrt(xx + yy + 2 * determinantRoot);
  if (!(denominator > 0) || !Number.isFinite(denominator)) throw new Error('The local text outline has an invalid aligned-stroke scale transform.');
  // A symmetric square root of A·Aᵀ removes the captured stroke metric while
  // remaining independent of translation and each glyph's rigid orientation.
  const a = (xx + determinantRoot) / denominator; const b = xy / denominator; const d = (yy + determinantRoot) / denominator;
  return textStrokeTransform([a, b, b, d, 0, 0]);
}

async function clippedPathGeometry(width, height, geometry, clipGeometry, booleanGeometry, signal) {
  if (!clipGeometry) return geometry;
  const pathShape = identityShapeNode(width, height, geometry);
  const request = { root: { kind: 'boolean', operation: 'intersect', transform: [1, 0, 0, 1, 0, 0],
    includeFill: true, strokes: [], children: [
      { kind: 'shape', transform: [1, 0, 0, 1, 0, 0], geometry: clipGeometry, includeFill: true, strokes: [] },
      { kind: 'shape', transform: [1, 0, 0, 1, 0, 0], geometry: pathShape, includeFill: true, strokes: [] }
    ] } };
  const result = await booleanGeometry(request, { signal });
  abort(signal);
  return outlinedGeometryToPathGeometry(result, width, height);
}

function vectorMaskGroup(name, width, height, sourcePaths, paint) {
  const source = createNode('group', { name: `${name} glyph mask`, x: 0, y: 0, width, height, opacity: 1,
    children: sourcePaths.map(path => {
      const maskPath = clone(path); maskPath.id = createId('path');
      clearStrokes(maskPath);
      Object.assign(maskPath, { fills: [{ id: createId('fill'), type: 'solid', color: '#ffffff', opacity: 1, visible: true, blendMode: 'normal' }] });
      delete maskPath.fillVariableId; delete maskPath.fillStyleId; syncLegacyFillFields(maskPath); return maskPath;
    }) });
  const paintContent = createNode('rectangle', { name: `${name} paint`, x: 0, y: 0, width, height,
    fills: [clone(paint)], strokes: [], fill: 'transparent', stroke: null, strokeWidth: 0 });
  syncLegacyFillFields(paintContent);
  const group = createNode('group', { name, x: 0, y: 0, width, height, mask: true, maskMode: 'alpha',
    maskSourceId: source.id, children: [source, paintContent] });
  return group;
}

function clearTextLayerFields(node) {
  for (const property of textStyleProperties) delete node[property];
  for (const property of ['textVariableId', 'textStyleId', 'typographyStyleId', 'fillVariableId', 'fillStyleId', 'strokeVariableId']) delete node[property];
  if (node.variableBindings) {
    for (const property of textStyleProperties) delete node.variableBindings[property];
    if (!Object.keys(node.variableBindings).length) delete node.variableBindings;
  }
}

async function outlinedTextReplacement(document, node, textOutline, outline, booleanGeometry, signal, budget) {
  const width = textOutline.width; const height = textOutline.height;
  const expectedWidth = node.textPath ? textOutline.placement?.width : node.width;
  const expectedHeight = node.textPath ? textOutline.placement?.height : node.height;
  const resolvedFillOpacity = Number(getNodePropertyValue(document, node, 'fillOpacity') ?? 1);
  if (!(width > 0 && height > 0) || width !== expectedWidth || height !== expectedHeight) throw new Error(`The local text outline for “${node.name || 'text'}” does not match its logical frame.`);
  const explicitFills = Array.isArray(node.fills);
  const geometryClip = textOutline.clipGeometry || null;
  const glyphs = [];
  for (const [index, glyph] of textOutline.glyphs.entries()) {
    abort(signal); budget.glyphs += 1;
    if (budget.glyphs > 4096) throw new Error('This selection exceeds the 4,096-glyph outline limit. Outline fewer text layers at a time.');
    const geometries = editableGeometryFromNativeShape(glyph.geometry, width, height);
    const paths = [];
    for (const [groupIndex, geometry] of geometries.entries()) {
      if (!geometry.points.length) continue;
      const clipped = await clippedPathGeometry(width, height, geometry, geometryClip, booleanGeometry, signal);
      budget.points += clipped.points.length + (clipped.subpaths || []).reduce((sum, contour) => sum + contour.points.length, 0);
      if (budget.points > MAX_OUTLINE_STROKE_SELECTION_POINTS) throw new Error('This selection exceeds the 100,000-point outline budget. Outline fewer layers or simplify the text.');
      if (!clipped.points.length) continue;
      const path = editablePathNode(`${node.name || 'Text'} glyph ${index + 1}${groupIndex ? ` part ${groupIndex + 1}` : ''}`, width, height, clipped,
        { id: createId('fill'), type: 'solid', color: '#ffffff', opacity: 1, visible: true, blendMode: 'normal' });
      chargeNodes(budget, 1);
      paths.push(path);
    }
    // Keep source indices stable even when truncation removes every contour
    // from a glyph; paint/style lookup later follows shaped glyph order.
    glyphs.push({ id: glyph.glyphId, cluster: glyph.cluster, paint:glyph.paint, paths });
  }

  const decorations = [];
  for (const [index, decoration] of (textOutline.decorations || []).entries()) {
    for (const [partIndex, geometry] of editableGeometryFromNativeShape(decoration.geometry, width, height).entries()) {
      const clipped = await clippedPathGeometry(width, height, geometry, geometryClip, booleanGeometry, signal);
      budget.points += clipped.points.length + (clipped.subpaths || []).reduce((sum, contour) => sum + contour.points.length, 0);
      if (budget.points > MAX_OUTLINE_STROKE_SELECTION_POINTS) throw new Error('This selection exceeds the 100,000-point outline budget.');
      if (!clipped.points.length) continue;
      const path = editablePathNode(`${node.name || 'Text'} decoration ${index + 1}${partIndex ? ` part ${partIndex + 1}` : ''}`, width, height, clipped,
        { id: createId('fill'), type: 'solid', color: '#ffffff', opacity: 1, visible: true, blendMode: 'normal' });
      decorations.push({ path, paint: decoration.paint || {} });
      chargeNodes(budget, 1);
    }
  }

  const strokeMasks = [];
  for (const [strokeIndex, stroke] of strokeStackForNode(node).entries()) {
    if (!hasWidth(stroke)) continue;
    const outlined = [];
    const centered = effectiveStrokeAlignment(node, stroke) === 'center';
    if (!centered && !textOutline.glyphGeometry) throw new Error(`The local font outlines for “${node.name || 'text'}” do not include aggregate glyph-only geometry needed for aligned strokes.`);
    const alignedTransform = centered ? null : commonTextStrokeTransform(textOutline.glyphs);
    const strokeSources = centered
      ? textOutline.glyphs.map((glyph, glyphIndex) => ({ geometry:glyph.geometry, glyphIndex, transform:textStrokeTransform(glyph.strokeTransform) }))
      : [{ geometry:textOutline.glyphGeometry, glyphIndex:null, transform:alignedTransform }];
    for (const { geometry:sourceGeometry, glyphIndex, transform } of strokeSources) {
      abort(signal);
      const outlineSource = transform.matrix.every((value, index) => value === identityTextStrokeTransform[index])
        ? sourceGeometry : mapTextOutlineShape(sourceGeometry, transform.inverse);
      const result = await outline(outlineSource, { ...clone(stroke), alignment: effectiveStrokeAlignment(node, stroke) }, { signal });
      abort(signal);
      let geometry = outlinedGeometryToPathGeometry(result, width, height);
      if (!transform.matrix.every((value, index) => value === identityTextStrokeTransform[index])) {
        geometry = mapTextOutlinePath(geometry, width, height, transform.matrix);
      }
      if (!geometry.points.length) continue;
      if (textOutline.clipGeometry) geometry = await clippedPathGeometry(width, height, geometry, textOutline.clipGeometry, booleanGeometry, signal);
      budget.points += geometry.points.length + (geometry.subpaths || []).reduce((sum, contour) => sum + contour.points.length, 0);
      if (budget.points > MAX_OUTLINE_STROKE_SELECTION_POINTS) throw new Error('This selection exceeds the 100,000-point outline budget. Outline fewer layers or simplify their strokes.');
      if (!geometry.points.length) continue;
      const directPaint = strokeFill(stroke);
      const outlinedPath = editablePathNode(`${node.name || 'Text'}${glyphIndex == null ? '' : ` glyph ${glyphIndex + 1}`} stroke ${strokeIndex + 1}`, width, height, geometry,
        directPaint);
      if (strokeIndex === 0 && node.strokeVariableId) outlinedPath.fillVariableId = node.strokeVariableId;
      outlined.push(outlinedPath);
      chargeNodes(budget, 1);
    }
    if (!outlined.length) continue;
    strokeMasks.push(...outlined);
  }

  const replacement = clone(node);
  clearStrokes(replacement); clearFills(replacement); clearTextLayerFields(replacement);
  for (const key of ['points', 'subpaths', 'closed', 'fillRule', 'vertices', 'edges', 'faces', 'arcData', 'vertexRadii', 'innerRadius', 'cornerRadii', 'cornerSmoothing', 'lineReverseY']) delete replacement[key];
  Object.assign(replacement, { type: 'group', width: node.width, height: node.height, mask: false, clip: false, children: [] });
  replacement.effectPaintMode = 'staged';
  replacement.effectFillMode = explicitFills ? (node.fills.length ? 'stack' : 'none') : 'legacy';
  if (!explicitFills) {
    delete replacement.fills;
    replacement.fill = getNodeColor(document, node, 'text');
    replacement.fillOpacity = resolvedFillOpacity;
    if (node.textVariableId) replacement.fillVariableId = node.textVariableId;
  }
  const children = [];
  const maskPaths = [...glyphs.flatMap(glyph => glyph.paths), ...decorations.filter(item => !item.paint.independent).map(item => item.path)];
  const independentDecorations = decorations.filter(item => item.paint.independent);
  const resolvedText = getNodePropertyValue(document, node, 'text');
  const currentRichText = Array.isArray(node.textRuns) && node.textRuns.map(run => run.text).join('') === resolvedText;
  const textColorVariableApplies = Boolean(node.textVariableId && !(currentRichText && node.textRuns.some(run => run.color)));
  if (explicitFills) {
    const maskPathPoints = maskPaths.reduce((sum, path) => sum + pathPointCount(path), 0);
    budget.points += maskPathPoints * node.fills.length;
    if (budget.points > MAX_OUTLINE_STROKE_SELECTION_POINTS) throw new Error('This selection exceeds the 100,000-point outline budget. Reduce the text paint stack or outline fewer glyphs.');
    if (node.fills.length) chargeNodes(budget, node.fills.length * (maskPaths.length + 3));
    for (const [index, fill] of node.fills.entries()) {
      const mask = vectorMaskGroup(`${node.name || 'Text'} fill ${index + 1}`, width, height, maskPaths, fill);
      if (index === 0 && node.fillStyleId) mask.children[1].fillStyleId = node.fillStyleId;
      children.push(mask);
    }
    if (!node.fills.length && maskPaths.length) {
      for (const path of maskPaths) {
        clearFills(path);
      }
      children.push(...maskPaths);
    }
  } else {
    for (const glyph of glyphs) {
      const opacity = Math.max(0, Math.min(1, glyph.paint.opacity ?? 1));
      const paths = glyph.paths;
      for (const path of paths) {
        path.fills = [{ id:createId('fill'), type:'solid', color:glyph.paint.color || '#000000', opacity, visible:true, blendMode:'normal' }];
        syncLegacyFillFields(path);
        if (textColorVariableApplies) path.fillVariableId = node.textVariableId;
      }
      children.push(...paths);
    }
    for (const { path, paint } of decorations.filter(item => !item.paint.independent)) {
      path.fills = [{ id:createId('fill'), type:'solid', color:paint.color || '#000000',
        opacity:Math.max(0,Math.min(1,paint.opacity ?? 1)), visible:paint.visible !== false, blendMode:'normal' }];
      syncLegacyFillFields(path);
      if (!paint.independent && textColorVariableApplies) path.fillVariableId = node.textVariableId;
      if (paint.independent) path.effectPaintPhase = 'decoration';
      children.push(path);
    }
  }
  for (const { path, paint } of independentDecorations) {
    path.fills = [{ id:createId('fill'), type:'solid', color:paint.color || '#000000',
      opacity:Math.max(0,Math.min(1,paint.opacity ?? 1)), visible:paint.visible !== false, blendMode:'normal' }];
    syncLegacyFillFields(path);
    path.effectPaintPhase = 'decoration';
    children.push(path);
  }
  for (const path of strokeMasks) path.effectPaintPhase = 'stroke';
  children.push(...strokeMasks);
  replacement.children = children;
  if (node.textPath) {
    const placement = textOutline.placement;
    if (!placement || !['x', 'y', 'width', 'height', 'rotation'].every(key => Number.isFinite(placement[key]))) {
      throw new Error(`The linked text placement for “${node.name || 'text'}” changed or could not be resolved.`);
    }
    Object.assign(replacement, { x: placement.x, y: placement.y, width: placement.width, height: placement.height, rotation: placement.rotation });
    if (placement.affineTransform) replacement.affineTransform = clone(placement.affineTransform);
    else delete replacement.affineTransform;
    delete replacement.textPath;
    if (replacement.variableBindings) {
      for (const key of ['x', 'y', 'width', 'height', 'rotation']) delete replacement.variableBindings[key];
      if (!Object.keys(replacement.variableBindings).length) delete replacement.variableBindings;
    }
  } else transferTransform(node, replacement);
  return replacement;
}

/** Compute all geometry first. A failed/cancelled selection changes no layer. */
export async function prepareOutlineStroke(document, nodeIds, {
  pageId = document.activePageId, signal, outline = outlineStrokeGeometry,
  getTextOutline = null, booleanGeometry = defaultBooleanGeometry
} = {}) {
  abort(signal);
  const entries = entriesForSelection(document, nodeIds, pageId);
  const snapshots = entries.map(entry => contextSnapshot(document, entry, pageId));
  if (snapshots.reduce((sum, snapshot) => sum + snapshot.length, 0) > MAX_OUTLINE_SNAPSHOT_CHARACTERS) throw new Error('This selection is too large to outline safely in one edit. Outline fewer layers at a time.');
  let commandCount = 0;
  const shapes = []; const textOutlines = [];
  for (const entry of entries) {
    abort(signal);
    if (entry.node.type === 'text') {
      if (typeof getTextOutline !== 'function') throw new Error(`Local font outlines are unavailable for “${entry.node.name || 'text'}”. Load a font with complete glyph coverage and retry.`);
      const textOutline = await getTextOutline(document, entry.node, { signal });
      abort(signal);
      if (!textOutline || !Array.isArray(textOutline.glyphs) || !Array.isArray(textOutline.decorations || [])) throw new Error(`Local font outlines are unavailable for “${entry.node.name || 'text'}”.`);
      const textShapes = [...textOutline.glyphs, ...(textOutline.decorations || [])].map(item => item.geometry);
      textShapes.push(textOutline.glyphGeometry, textOutline.geometry, textOutline.clipGeometry, textOutline.fillClipGeometry);
      commandCount += [...new Set(textShapes.filter(Boolean))].reduce((sum, shape) => sum + geometryCommandCount(shape), 0);
      textOutlines.push(textOutline); shapes.push(null);
    } else {
      const shape = nativePathGeometryForNode(entry.node);
      for (const contours of [shape.strokeContours, shape.alignedStrokeContours, ...shape.fillGroups.map(group => group.contours)]) {
        commandCount += contours.reduce((sum, contour) => sum + contour.commands.length, 0);
      }
      textOutlines.push(null); shapes.push(shape);
    }
    if (commandCount > MAX_OUTLINE_STROKE_SELECTION_COMMANDS) throw new Error('This selection exceeds the 100,000-command outline budget. Outline fewer layers or simplify their geometry.');
    if (contextSnapshot(document, entry, pageId) !== snapshots[entries.indexOf(entry)]) throw new Error('A selected layer or its editing context changed while outlining. Try Outline Stroke again.');
  }
  const sources = entries.map(entry => clone(entry.node));
  const replacements = [];
  const budget = { points: 0, glyphs: 0, commands: commandCount, nodes: 0 };
  for (const [index, source] of sources.entries()) replacements.push(source.type === 'text'
    ? await outlinedTextReplacement(document, source, textOutlines[index], outline, booleanGeometry, signal, budget)
    : await outlinedReplacement(source, shapes[index], outline, signal, budget));
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
