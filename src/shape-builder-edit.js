import {
  createShapeBuilderSession, shapeBuilderPathGeometryFromCurves
} from './boolean-geometry.js';
import { captureAutoLayoutAncestors, reflowAutoLayoutAncestors } from './layer-auto-layout.js';
import { addNode, cloneDocument, createId, findNode, removeNode, validateDocument } from './model.js';

const shapeTypes = new Set(['rectangle', 'ellipse', 'polygon', 'star', 'path', 'network', 'boolean']);
const geometryProperties = ['x', 'y', 'width', 'height', 'rotation', 'radius', 'innerRadius'];
const typeSpecificProperties = [
  'innerRadius', 'arcData', 'operation', 'vertices', 'edges', 'faces', 'cornerRadii', 'lineReverseY',
  'overflowBehavior', 'autoLayout', 'mask', 'maskSourceId'
];

function colorHasTransparency(color) {
  if (typeof color !== 'string') return false;
  const value = color.trim().toLowerCase();
  if (value === 'transparent') return true;
  if (/^#[\da-f]{4}$/iu.test(value)) return Number.parseInt(value.at(-1), 16) !== 15;
  if (/^#[\da-f]{8}$/iu.test(value)) return Number.parseInt(value.slice(-2), 16) !== 255;
  const functionColor = value.match(/^(?:rgba?|hsla?)\((.*)\)$/iu)?.[1];
  if (!functionColor) return false;
  const slashParts = functionColor.split('/');
  if (slashParts.length > 1) {
    const alpha = slashParts.at(-1).trim();
    const number = Number.parseFloat(alpha);
    return Number.isFinite(number) && number < (alpha.endsWith('%') ? 100 : 1);
  }
  const parts = functionColor.split(',');
  if (parts.length !== 4) return false;
  const alpha = parts[3].trim();
  const number = Number.parseFloat(alpha);
  return Number.isFinite(number) && number < (alpha.endsWith('%') ? 100 : 1);
}

function paintHasUnmodeledCompositing(paint) {
  if (!paint || paint.visible === false) return false;
  if ((paint.opacity ?? 1) !== 1 || (paint.blendMode && paint.blendMode !== 'normal')) return true;
  if (paint.type === 'image') return true;
  const colors = [paint.color, ...(paint.gradient?.stops || []).map(stop => stop.color)];
  return colors.some(colorHasTransparency);
}

function pathFromSource(source, curves, { id = source.id, name = source.name } = {}) {
  const geometry = shapeBuilderPathGeometryFromCurves(curves);
  const node = structuredClone(source);
  node.id = id;
  node.type = 'path';
  node.name = name || 'Vector region';
  node.x = geometry.x;
  node.y = geometry.y;
  node.width = geometry.width;
  node.height = geometry.height;
  node.rotation = 0;
  delete node.affineTransform;
  node.closed = true;
  node.points = geometry.points;
  node.subpaths = geometry.subpaths;
  node.fillRule = 'evenodd';
  node.children = [];
  for (const property of typeSpecificProperties) delete node[property];
  return node;
}

export function shapeBuilderSourceBlockReason(entry) {
  const node = entry.node;
  if (!shapeTypes.has(node.type)) return `“${node.name || 'Layer'}” is not a supported closed vector layer.`;
  if (node.locked || entry.parents.some(parent => parent.locked)) return 'Unlock the selected vectors and their parent layers before using Shape Builder.';
  if (node.isComponent || node.isInstance || node.componentSourceId || node.nestedComponentSourceId
    || entry.parents.some(parent => parent.isComponent || parent.isInstance || parent.componentSourceId || parent.nestedComponentSourceId)) {
    return 'Detach component content before destructively editing its vector regions.';
  }
  if (geometryProperties.some(property => node.variableBindings?.[property])) {
    return `“${node.name || 'Layer'}” has variable-bound geometry. Unbind its geometry before using Shape Builder.`;
  }
  if (node.visible === false || node.variableBindings?.visible) {
    return `“${node.name || 'Layer'}” is hidden or mode-bound for visibility. Show it and unlink visibility before using Shape Builder.`;
  }
  if ((node.opacity ?? 1) !== 1 || (node.fillOpacity ?? 1) !== 1
    || node.blendMode && node.blendMode !== 'normal'
    || node.variableBindings?.opacity || node.variableBindings?.fillOpacity
    || (node.fills || []).some(paintHasUnmodeledCompositing)
    || (!(node.fills || []).length && paintHasUnmodeledCompositing({ type: 'solid', color: node.fill }))) {
    return `“${node.name || 'Layer'}” uses transparency or blending that cannot be preserved when its regions are separated.`;
  }
  return null;
}

/**
 * Destructively extract, merge, or subtract one or more arrangement faces.
 * The source document remains untouched if geometry validation fails.
 */
export function applyShapeBuilderEdit(document, nodeIds, points, { mode = 'extract', pageId = document.activePageId } = {}) {
  if (!['extract', 'merge', 'subtract'].includes(mode)) throw new TypeError('Choose extract, merge, or subtract for Shape Builder.');
  if (!Array.isArray(nodeIds) || !nodeIds.length || new Set(nodeIds).size !== nodeIds.length) {
    throw new Error('Select closed vector layers before using Shape Builder.');
  }
  if (!Array.isArray(points) || !points.length || points.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
    throw new Error('Move over one or more regions inside the selected vectors.');
  }
  const entries = nodeIds.map(id => findNode(document, id, pageId));
  if (entries.some(entry => !entry)) throw new Error('One of the selected vector layers is no longer available.');
  const parent = entries[0].parent;
  if (entries.some(entry => entry.parent !== parent)) throw new Error('Shape Builder requires vector layers in the same container.');
  if (parent?.locked) throw new Error('Unlock the selected vectors and their parent before using Shape Builder.');
  for (const entry of entries) {
    const reason = shapeBuilderSourceBlockReason(entry);
    if (reason) throw new Error(reason);
  }
  const list = parent ? parent.children : document.pages.find(page => page.id === pageId)?.children;
  if (!list) throw new Error('The selected page is no longer available.');
  const orderedEntries = entries.map(entry => ({ ...entry, index: list.indexOf(entry.node) }))
    .sort((left, right) => left.index - right.index);
  const session = createShapeBuilderSession(orderedEntries.map(entry => entry.node));
  const regions = [];
  const seenFaces = new Set();
  for (const point of points) {
    const region = session.regionAtPoint(point);
    if (!region || seenFaces.has(region.faceKey)) continue;
    seenFaces.add(region.faceKey);
    regions.push(region);
  }
  if (!regions.length) throw new Error('Move inside a filled region of the selected vectors, then try again.');

  const regionContours = regions.map(region => region.contours);
  const regionCurves = session.unionRegions(regionContours);
  const contributed = new Set();
  for (const region of regions) region.membership.forEach((inside, index) => { if (inside) contributed.add(orderedEntries[index].node.id); });
  const contributors = orderedEntries.filter(entry => contributed.has(entry.node.id));
  if (!contributors.length) throw new Error('The selected point is not inside an editable vector source.');
  const remainderById = new Map(contributors.map(entry => {
    const sourceIndex = orderedEntries.findIndex(candidate => candidate.node.id === entry.node.id);
    return [entry.node.id, session.remainderForSource(sourceIndex, regionContours)];
  }));

  const nextDocument = cloneDocument(document);
  const autoLayoutAncestors = captureAutoLayoutAncestors(nextDocument, contributors.map(entry => entry.node.id), pageId);
  const nextEntries = contributors.map(entry => ({ id: entry.node.id, index: entry.index }));
  const styleSourceId = contributors.at(-1).node.id;
  const styleSource = findNode(nextDocument, styleSourceId, pageId)?.node;
  if (!styleSource) throw new Error('The topmost vector source changed before Shape Builder could commit.');

  for (const entry of nextEntries) {
    const remainder = remainderById.get(entry.id);
    if (remainder.length) {
      const candidateEntry = findNode(nextDocument, entry.id, pageId);
      if (!candidateEntry) throw new Error('A vector source changed before Shape Builder could commit.');
      // A Boolean source owns child nodes; remove them through the model API so
      // any prototype references are cleaned before replacing its geometry.
      if (candidateEntry.node.type === 'boolean') {
        for (const child of [...candidateEntry.node.children]) removeNode(nextDocument, child.id, pageId);
      }
      const path = pathFromSource(candidateEntry.node, remainder);
      for (const property of Object.keys(candidateEntry.node)) {
        if (!Object.hasOwn(path, property)) delete candidateEntry.node[property];
      }
      Object.assign(candidateEntry.node, path);
    } else {
      removeNode(nextDocument, entry.id, pageId);
    }
  }

  let resultPath = null;
  if (mode !== 'subtract') {
    const frontmostIndex = orderedEntries.at(-1).index;
    const removedBeforeInsertion = nextEntries.filter(entry => !remainderById.get(entry.id).length && entry.index <= frontmostIndex).length;
    const insertionIndex = Math.max(0, Math.min(frontmostIndex + 1 - removedBeforeInsertion, parent
      ? findNode(nextDocument, parent.id, pageId)?.node.children.length ?? 0
      : nextDocument.pages.find(page => page.id === pageId)?.children.length ?? 0));
    const name = mode === 'merge' && regions.length > 1 ? 'Merged vector regions' : `${styleSource.name || 'Vector'} region`;
    resultPath = pathFromSource(styleSource, regionCurves, { id: createId('path'), name });
    addNode(nextDocument, resultPath, { parentId: parent?.id || null, pageId, index: insertionIndex });
  }
  reflowAutoLayoutAncestors(nextDocument, autoLayoutAncestors, pageId);
  validateDocument(nextDocument);
  const changedIds = [...new Set([...contributors.map(entry => entry.node.id), ...(resultPath ? [resultPath.id] : [])])]
    .filter(id => findNode(nextDocument, id, pageId));
  return { document: nextDocument, resultPath, changedIds, regions: regions.length, mode };
}
