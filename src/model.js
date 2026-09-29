const clone = value => structuredClone(value);
const variableTypes = new Set(['color', 'number', 'string', 'boolean']);

function isVariableValue(type, value) {
  if (type === 'color') return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  return false;
}

function defaultVariableValue(type) {
  return type === 'color' ? '#1e1e1e' : type === 'number' ? 0 : type === 'string' ? '' : false;
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
    pages: [{ id: pageId, name: 'Page 1', children: [] }],
    components: [],
    componentSets: [],
    recipes: [],
    colorStyles: [],
    variableCollections: [],
    variables: [],
    prototypeStartPoint: null,
    settings: { unit: 'px', grid: 8, snap: true }
  };
}

const defaults = {
  frame: { name: 'Frame', width: 390, height: 844, fill: '#ffffff', clip: true },
  section: { name: 'Section', width: 480, height: 320, fill: '#e6e6e6', clip: false },
  group: { name: 'Group', width: 120, height: 80, fill: 'transparent', clip: false },
  boolean: { name: 'Boolean group', width: 120, height: 80, fill: '#d9d9d9', operation: 'union', clip: false },
  rectangle: { name: 'Rectangle', width: 120, height: 80, fill: '#d9d9d9', radius: 0 },
  ellipse: { name: 'Ellipse', width: 100, height: 100, fill: '#d9d9d9' },
  line: { name: 'Line', width: 120, height: 0, fill: 'transparent', stroke: '#1e1e1e', strokeWidth: 2 },
  star: { name: 'Star', width: 100, height: 100, fill: '#ffcd29', points: 5, innerRadius: 0.48 },
  polygon: { name: 'Polygon', width: 100, height: 100, fill: '#d9d9d9', points: 6 },
  text: { name: 'Text', width: 240, height: 48, text: 'Text', fontFamily: 'Inter, Arial, sans-serif', fontSize: 24, fontWeight: 400, lineHeight: 1.25, letterSpacing: 0, color: '#1e1e1e', align: 'left' },
  image: { name: 'Image', width: 320, height: 240, fill: '#eeeeee', assetId: null, fileName: 'Image', adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 }, fit: 'cover' },
  path: { name: 'Vector', width: 120, height: 100, fill: 'transparent', stroke: '#1e1e1e', strokeWidth: 2, points: [] }
};
const prototypeActions = new Set(['navigate', 'open-overlay', 'close-overlay']);
const prototypeTriggers = new Set(['on-click', 'while-hovering']);
const prototypeTransitions = new Set(['instant', 'dissolve', 'move-left', 'move-right']);
const prototypeOverlayPositions = new Set(['center', 'top-left', 'top-center', 'top-right', 'left-center', 'right-center', 'bottom-left', 'bottom-center', 'bottom-right']);
const booleanOperations = new Set(['union', 'subtract', 'intersect', 'exclude']);
const booleanOperandTypes = new Set(['rectangle', 'ellipse', 'star', 'polygon', 'path', 'boolean']);
const componentOverrideProperties = new Set([
  'name', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'locked', 'fill', 'fillOpacity', 'fillStyleId',
  'stroke', 'strokeWidth', 'radius', 'clip', 'text', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
  'letterSpacing', 'color', 'textStyleId', 'align', 'fit', 'adjustments', 'constraints', 'autoLayout',
  'fillVariableId', 'textVariableId', 'strokeVariableId', 'variableModes',
  'layoutSizingMain', 'layoutSizingCross', 'points', 'closed', 'operation', '__childOrder'
]);

export function createNode(type, overrides = {}) {
  const preset = defaults[type];
  if (!preset) throw new TypeError(`Unsupported layer type: ${type}`);
  return {
    id: createId(type), type,
    name: preset.name,
    x: 0, y: 0, width: preset.width, height: preset.height,
    rotation: 0, opacity: 1, visible: true, locked: false,
    fill: preset.fill, stroke: preset.stroke ?? null,
    strokeWidth: preset.strokeWidth ?? 0,
    radius: preset.radius ?? 0,
    clip: preset.clip ?? false,
    constraints: { horizontal: 'left', vertical: 'top' },
    children: [],
    ...preset,
    ...overrides,
    constraints: { horizontal: 'left', vertical: 'top', ...(overrides.constraints || {}) },
    children: overrides.children ? clone(overrides.children) : []
  };
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

export function addNode(document, node, { parentId = null, pageId = document.activePageId, index } = {}) {
  const page = document.pages.find(item => item.id === pageId);
  if (!page) throw new Error('The target page no longer exists.');
  const parent = parentId ? findNode(document, parentId, pageId)?.node : null;
  if (parentId && !parent) throw new Error('The target parent layer no longer exists.');
  if (parent && !['frame', 'group', 'boolean'].includes(parent.type)) throw new Error('This layer cannot contain other layers.');
  const list = parent ? parent.children : page.children;
  const insertAt = index == null ? list.length : Math.max(0, Math.min(index, list.length));
  list.splice(insertAt, 0, node);
  return node;
}

export function removeNode(document, nodeId, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return null;
  const list = entry.parent ? entry.parent.children : getActivePage({ ...document, activePageId: pageId }).children;
  const [removed] = list.splice(entry.index, 1);
  const removedComponents = [];
  walkNodes([removed], ({ node }) => { if (node.isComponent && node.componentId) removedComponents.push(node.componentId); });
  for (const componentId of removedComponents) {
    document.components = (document.components || []).filter(component => component.id !== componentId);
    detachComponentInstances(document, componentId);
    removeComponentFromSets(document, componentId);
  }
  return removed;
}

export function updateNode(document, nodeId, patch, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return false;
  Object.assign(entry.node, typeof patch === 'function' ? patch(entry.node) : patch);
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
  let x = entry.node.x;
  let y = entry.node.y;
  for (const parent of entry.parents) { x += parent.x; y += parent.y; }
  return { x, y, width: entry.node.width, height: entry.node.height };
}

export function duplicateNode(document, nodeId, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return null;
  const duplicate = clone(entry.node);
  const renew = node => { node.id = createId(node.type); node.name = node.name.endsWith(' copy') ? `${node.name.slice(0, -5)} copy 2` : `${node.name} copy`; for (const child of node.children ?? []) renew(child); };
  renew(duplicate);
  duplicate.x += 16;
  duplicate.y += 16;
  const list = entry.parent ? entry.parent.children : document.pages.find(page => page.id === pageId).children;
  list.splice(entry.index + 1, 0, duplicate);
  return duplicate;
}

function visualBounds(node) {
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  const angle = (node.rotation || 0) * Math.PI / 180;
  const extentX = Math.abs(node.width * Math.cos(angle)) / 2 + Math.abs(node.height * Math.sin(angle)) / 2;
  const extentY = Math.abs(node.width * Math.sin(angle)) / 2 + Math.abs(node.height * Math.cos(angle)) / 2;
  return { left: centerX - extentX, top: centerY - extentY, right: centerX + extentX, bottom: centerY + extentY };
}

function isBooleanOperand(node) {
  return booleanOperandTypes.has(node.type) && (node.type !== 'path' || node.closed === true);
}

/** Return whether these layers can become one live, editable Boolean group. */
export function canCombineBoolean(document, nodeIds, pageId = document.activePageId) {
  if (!Array.isArray(nodeIds) || nodeIds.length < 2 || new Set(nodeIds).size !== nodeIds.length) return false;
  const entries = nodeIds.map(id => findNode(document, id, pageId));
  if (entries.some(entry => !entry || !isBooleanOperand(entry.node) || entry.node.locked)) return false;
  const parent = entries[0].parent;
  return entries.every(entry => entry.parent === parent);
}

/** Combine sibling vector shapes without flattening their editable source layers. */
export function combineBoolean(document, nodeIds, operation = 'union', pageId = document.activePageId) {
  if (!booleanOperations.has(operation)) throw new TypeError('Choose a supported Boolean operation.');
  if (!canCombineBoolean(document, nodeIds, pageId)) throw new Error('Select at least two unlocked, closed vector shapes in the same container.');
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
  return group;
}

/** Restore a Boolean group's source layers while keeping the visible group transform. */
export function separateBoolean(document, nodeId, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry || entry.node.type !== 'boolean') throw new Error('Select a Boolean group to separate.');
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
  return children;
}

export function renameNode(document, nodeId, name, pageId = document.activePageId) {
  return updateNode(document, nodeId, { name: String(name).trim() || 'Untitled layer' }, pageId);
}

export function createImageRecipe(imageNode, name) {
  if (!imageNode || imageNode.type !== 'image') throw new TypeError('Recipes can only be created from an image layer.');
  return {
    id: createId('recipe'),
    name: String(name).trim() || `${imageNode.name} recipe`,
    adjustments: { ...imageNode.adjustments },
    fit: imageNode.fit ?? 'cover',
    opacity: imageNode.opacity ?? 1,
    createdAt: new Date().toISOString()
  };
}

export function applyImageRecipe(document, nodeId, recipe, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry || entry.node.type !== 'image') return false;
  entry.node.adjustments = { ...recipe.adjustments };
  entry.node.fit = recipe.fit ?? entry.node.fit;
  entry.node.opacity = recipe.opacity ?? entry.node.opacity;
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
  variable.valuesByMode[targetModeId] = value;
  if (variable.aliasesByMode) {
    delete variable.aliasesByMode[targetModeId];
    if (!Object.keys(variable.aliasesByMode).length) delete variable.aliasesByMode;
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
  if (variableAliasesHaveCycle(document.variables || [])) {
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

function clearVariableReferencesFromComponentOverrides(document, variableIds, collectionId = null) {
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    if (!node.componentOverrides) return;
    for (const overrides of Object.values(node.componentOverrides)) {
      for (const property of ['fillVariableId', 'textVariableId', 'strokeVariableId']) if (variableIds.has(overrides[property])) delete overrides[property];
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
  document.variables.splice(index, 1);
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
  document.variables = (document.variables || []).filter(variable => variable.collectionId !== collectionId);
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
  frame.variableModes ||= {};
  if (modeId) frame.variableModes[collectionId] = modeId;
  else delete frame.variableModes[collectionId];
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
    : kind === 'fill' ? !['text', 'image', 'line'].includes(node.type) && (node.type !== 'path' || node.closed)
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
  else if (style.kind === 'fill' && !['text', 'image', 'line', 'path'].includes(node.type)) { delete node.fillVariableId; node.fillStyleId = style.id; }
  else return false;
  return true;
}

export function createComponent(document, nodeId, name = null, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) throw new Error('Select a layer to create a component.');
  if (entry.node.isInstance || entry.parents.some(parent => parent.isInstance)) throw new Error('Detach an instance before creating a new component.');
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

export function setComponentVariantProperty(document, componentId, propertyName, value) {
  const component = document.components?.find(item => item.id === componentId);
  const set = component && document.componentSets?.find(item => item.id === component.componentSetId);
  const name = String(propertyName || '').trim(); const nextValue = String(value ?? '').trim();
  if (!component || !set || !name || !nextValue) throw new Error('Choose a component variant property and value.');
  if (!set.properties.some(property => property.name === name)) throw new Error(`Variant property “${name}” does not exist.`);
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

export function switchComponentInstanceVariant(document, instanceId, targetComponentId, pageId = document.activePageId) {
  const instance = findNode(document, instanceId, pageId)?.node;
  const currentComponent = instance?.isInstance && document.components?.find(item => item.id === instance.componentId);
  const targetComponent = document.components?.find(item => item.id === targetComponentId);
  if (!currentComponent || !targetComponent || !currentComponent.componentSetId || currentComponent.componentSetId !== targetComponent.componentSetId) throw new Error('Choose a variant from this component set.');
  if (currentComponent.id === targetComponent.id) return false;
  const targetMaster = findNodeAcrossPages(document, targetComponent.rootNodeId)?.node;
  if (!targetMaster?.isComponent) throw new Error('The selected variant no longer exists.');
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
  if (instance.componentNameIsInherited !== false) instance.name = `${targetComponent.name} instance`;
  syncInstanceNode(instance, targetMaster, targetComponent.id, nextOverrides, true);
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

export function createComponentInstance(document, componentId, { pageId = document.activePageId, parentId = null, x = null, y = null } = {}) {
  const component = document.components?.find(item => item.id === componentId);
  const master = component && findNodeAcrossPages(document, component.rootNodeId);
  if (!component || !master || !master.node.isComponent) throw new Error('The main component no longer exists.');
  const targetPage = document.pages.find(page => page.id === pageId);
  if (!targetPage) throw new Error('The target page no longer exists.');
  const instance = clone(master.node);
  const renew = (node, isRoot = false) => {
    const sourceId = node.id;
    node.id = createId(node.type);
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
  addNode(document, instance, { pageId, parentId });
  return instance;
}

export function detachComponentInstances(document, componentId) {
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    if (node.isInstance && node.componentId === componentId) clearComponentInstanceLink(node);
  });
}

function clearComponentInstanceLink(instance) {
  const componentId = instance.componentId;
  delete instance.isInstance; delete instance.componentId; delete instance.componentOverrides; delete instance.componentNameIsInherited;
  walkNodes(instance.children || [], ({ node, parents }) => {
    const belongsToNestedInstance = parents.some(parent => parent.isInstance && parent.componentId !== componentId);
    if (!belongsToNestedInstance) { delete node.componentSourceId; delete node.componentSourceKey; }
    if (node.isInstance && node.componentId === componentId) { delete node.isInstance; delete node.componentId; delete node.componentOverrides; }
  });
  delete instance.componentSourceId; delete instance.componentSourceKey;
}

export function detachComponentInstance(document, nodeId, pageId = document.activePageId) {
  const instance = findNode(document, nodeId, pageId)?.node;
  if (!instance?.isInstance) return false;
  clearComponentInstanceLink(instance);
  return true;
}

function syncInstanceNode(instance, master, componentId, overrides, isRoot = false) {
  const stableId = instance?.id || createId(master.type);
  const rootX = instance?.x ?? master.x;
  const rootY = instance?.y ?? master.y;
  const rootName = instance?.name ?? `${master.name} instance`;
  const componentOverrides = isRoot ? clone(instance?.componentOverrides || {}) : null;
  const oldChildren = instance?.children || [];
  const oldChildrenBySourceId = new Map(oldChildren.filter(child => child.componentSourceId).map(child => [child.componentSourceId, child]));
  const oldChildrenBySourceKey = new Map(oldChildren.filter(child => child.componentSourceKey).map(child => [child.componentSourceKey, child]));
  const copy = clone(master);
  let children = (master.children || []).map((child, index) => {
    const legacyChild = oldChildren[index]?.componentSourceId ? null : oldChildren[index];
    return syncInstanceNode(oldChildrenBySourceId.get(child.id) || oldChildrenBySourceKey.get(child.variantNodeKey) || legacyChild, child, componentId, overrides);
  });
  const nodeOverrides = overrides?.[master.id];
  if (Array.isArray(nodeOverrides?.__childOrder)) {
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
  if (master.variantNodeKey) target.componentSourceKey = master.variantNodeKey;
  else delete target.componentSourceKey;
  if (nodeOverrides && typeof nodeOverrides === 'object' && !Array.isArray(nodeOverrides)) {
    for (const [key, value] of Object.entries(nodeOverrides)) if (key !== '__childOrder' && componentOverrideProperties.has(key)) target[key] = clone(value);
  }
  return target;
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
    syncInstanceNode(instance, master, componentId, instance.componentOverrides || {}, true);
    if (instance.componentNameIsInherited !== false) instance.name = `${component.name} instance`;
  }
  return instances.length;
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

export function validateDocument(document) {
  if (!document || document.schema !== 'figma-local/1' || !Array.isArray(document.pages) || !document.pages.length) throw new TypeError('Invalid local design file.');
  const pageIds = new Set();
  const nodeIds = new Set();
  for (const page of document.pages) {
    if (!page.id || pageIds.has(page.id) || !Array.isArray(page.children)) throw new TypeError('Invalid or duplicate page.');
    pageIds.add(page.id);
    walkNodes(page.children, ({ node }) => {
      if (!node.id || nodeIds.has(node.id)) throw new TypeError('Invalid or duplicate layer.');
      nodeIds.add(node.id);
      if (!defaults[node.type] || ![node.x, node.y, node.width, node.height, node.rotation, node.opacity].every(Number.isFinite) || node.width < 0 || node.height < 0 || node.opacity < 0 || node.opacity > 1) throw new TypeError(`Invalid geometry or type on layer ${node.name || node.id}.`);
      if (node.type === 'boolean' && (!booleanOperations.has(node.operation) || !Array.isArray(node.children) || node.children.length < 2 || node.children.some(child => !isBooleanOperand(child)))) throw new TypeError(`Invalid Boolean group on layer ${node.name || node.id}.`);
      if (node.type === 'path' && (!Array.isArray(node.points) || node.points.some(point => !point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y)) || ['in', 'out'].some(part => point[part] != null && (!Number.isFinite(Number(point[part].x)) || !Number.isFinite(Number(point[part].y))))) || (node.closed != null && typeof node.closed !== 'boolean'))) throw new TypeError(`Invalid vector path on layer ${node.name || node.id}.`);
      if (node.children && !Array.isArray(node.children)) throw new TypeError('Layer children must be a list.');
      if (node.autoLayout && (node.type !== 'frame' || !['horizontal', 'vertical'].includes(node.autoLayout.axis) || !Number.isFinite(Number(node.autoLayout.gap)))) throw new TypeError(`Invalid auto layout on layer ${node.name || node.id}.`);
      if (node.interactions != null && (!Array.isArray(node.interactions) || node.interactions.some(item => {
        if (!item || typeof item.id !== 'string' || !prototypeActions.has(item.action) || !prototypeTriggers.has(item.trigger)) return true;
        if (item.action === 'close-overlay' ? item.destinationId != null : typeof item.destinationId !== 'string') return true;
        if (item.destinationPageId != null && typeof item.destinationPageId !== 'string') return true;
        if (item.transition != null && !prototypeTransitions.has(item.transition)) return true;
        if (item.duration != null && (!Number.isFinite(Number(item.duration)) || Number(item.duration) < 0 || Number(item.duration) > 2000)) return true;
        if (item.action === 'open-overlay') {
          if (item.overlayPosition != null && !prototypeOverlayPositions.has(item.overlayPosition)) return true;
          if (item.overlayOutsideClick != null && typeof item.overlayOutsideClick !== 'boolean') return true;
          if (item.overlayBackground != null && typeof item.overlayBackground !== 'boolean') return true;
          if (item.overlayBackgroundColor != null && !/^#[0-9a-f]{6}$/i.test(item.overlayBackgroundColor)) return true;
          if (item.overlayBackgroundOpacity != null && (!Number.isFinite(Number(item.overlayBackgroundOpacity)) || Number(item.overlayBackgroundOpacity) < 0 || Number(item.overlayBackgroundOpacity) > 1)) return true;
        }
        return false;
      }))) throw new TypeError(`Invalid prototype interactions on layer ${node.name || node.id}.`);
      if (node.constraints != null && (!['left', 'right', 'left-right', 'center', 'scale'].includes(node.constraints.horizontal) || !['top', 'bottom', 'top-bottom', 'center', 'scale'].includes(node.constraints.vertical))) throw new TypeError(`Invalid frame constraints on layer ${node.name || node.id}.`);
      if (node.componentSourceId != null && typeof node.componentSourceId !== 'string') throw new TypeError(`Invalid component source layer on ${node.name || node.id}.`);
      if (node.componentSourceKey != null && typeof node.componentSourceKey !== 'string') throw new TypeError(`Invalid component source key on ${node.name || node.id}.`);
      if (node.variantNodeKey != null && typeof node.variantNodeKey !== 'string') throw new TypeError(`Invalid variant node key on ${node.name || node.id}.`);
      if (node.componentNameIsInherited != null && (typeof node.componentNameIsInherited !== 'boolean' || !node.isInstance)) throw new TypeError(`Invalid inherited component name on ${node.name || node.id}.`);
      if (node.componentOverrides != null) {
        if (!node.isInstance || typeof node.componentOverrides !== 'object' || Array.isArray(node.componentOverrides)) throw new TypeError(`Invalid component overrides on ${node.name || node.id}.`);
        for (const [sourceId, overrides] of Object.entries(node.componentOverrides)) {
          if (!sourceId || !overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).some(key => !componentOverrideProperties.has(key)) || (overrides.__childOrder != null && (!Array.isArray(overrides.__childOrder) || overrides.__childOrder.some(id => typeof id !== 'string')))) throw new TypeError(`Invalid component override on ${node.name || node.id}.`);
        }
      }
    });
  }
  if (!pageIds.has(document.activePageId)) throw new TypeError('The active page does not exist.');
  if (document.components != null) {
    if (!Array.isArray(document.components)) throw new TypeError('Components must be a list.');
    const componentIds = new Set();
    for (const component of document.components) {
      const root = findNodeAcrossPages(document, component.rootNodeId);
      if (!component.id || componentIds.has(component.id) || !root?.node.isComponent || root.node.componentId !== component.id) throw new TypeError('Invalid or duplicate component.');
      if (component.componentSetId != null && typeof component.componentSetId !== 'string') throw new TypeError('Invalid component set reference.');
      if (component.variantProperties != null && (!component.variantProperties || typeof component.variantProperties !== 'object' || Array.isArray(component.variantProperties) || Object.values(component.variantProperties).some(value => typeof value !== 'string' || !value))) throw new TypeError('Invalid component variant properties.');
      componentIds.add(component.id);
    }
    for (const page of document.pages) walkNodes(page.children, ({ node }) => {
      if (node.isComponent && !componentIds.has(node.componentId)) throw new TypeError(`Missing component definition on layer ${node.name || node.id}.`);
      if (node.isInstance && !componentIds.has(node.componentId)) throw new TypeError(`Missing component source on layer ${node.name || node.id}.`);
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
    for (const [property, kind] of [['fillVariableId', 'fill'], ['textVariableId', 'text'], ['strokeVariableId', 'stroke']]) {
      const variable = variableById.get(node[property]);
      if (node[property] && (!variable || variable.type !== 'color')) throw new TypeError(`Missing ${kind} variable on layer ${node.name || node.id}.`);
      if (!variable) continue;
      const compatible = kind === 'text' ? node.type === 'text'
        : kind === 'fill' ? !['text', 'image', 'line'].includes(node.type) && (node.type !== 'path' || node.closed)
          : !['text', 'image', 'group', 'boolean'].includes(node.type);
      if (!compatible) throw new TypeError(`Incompatible ${kind} variable on layer ${node.name || node.id}.`);
    }
    if (node.variableModes != null) {
      if (node.type !== 'frame' || !node.variableModes || typeof node.variableModes !== 'object' || Array.isArray(node.variableModes)) throw new TypeError(`Invalid variable mode overrides on layer ${node.name || node.id}.`);
      for (const [collectionId, modeId] of Object.entries(node.variableModes)) if (!modesByCollection.get(collectionId)?.has(modeId)) throw new TypeError(`Missing variable mode on layer ${node.name || node.id}.`);
    }
  });
  if (!Array.isArray(document.recipes)) throw new TypeError('Recipes must be a list.');
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
  return true;
}

export function serializeDocument(document) {
  validateDocument(document);
  return JSON.stringify(document);
}

export function parseDocument(json) {
  const document = typeof json === 'string' ? JSON.parse(json) : clone(json);
  validateDocument(document);
  return document;
}
