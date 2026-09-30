import { createId, getNodeColor, getNodePropertyValue } from './model.js';
import { validateLinkedInstanceSnapshot } from './component-library.js';

const clone = value => structuredClone(value);

const editorLinkFields = [
  'isComponent', 'isInstance', 'componentId', 'componentOverrides', 'componentPropertyValues',
  'componentNameIsInherited', 'componentSourceId', 'componentSourceKey', 'variantNodeKey',
  'linkedComponent', 'publishedLibraryRefs'
];
const reservedOverrides = new Set(editorLinkFields.concat(['id', 'type', 'children']));

function stripLinkFields(node) {
  for (const property of editorLinkFields) delete node[property];
}

function removeUndefinedProperties(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (value[index] === undefined) value[index] = null;
      else removeUndefinedProperties(value[index]);
    }
    return value;
  }
  for (const [property, child] of Object.entries(value)) {
    if (child === undefined) delete value[property];
    else removeUndefinedProperties(child);
  }
  return value;
}

function setPropertyPath(node, property, value) {
  const parts = property.split('.');
  let target = node;
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {};
    target = target[part];
  }
  target[parts.at(-1)] = clone(value);
}

/** Serialize a main component or linked instance as a portable source tree. */
export function componentTreeForPublication(root, { useSourceIds = false, createSourceId = () => createId('source'), document = null } = {}) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new TypeError('Select a layer tree to publish.');
  const copy = clone(root);
  const sourceIdsByEditorId = new Map();
  const visit = (node, original) => {
    const sourceId = useSourceIds ? (original.componentSourceId || createSourceId()) : original.id;
    if (!sourceId) throw new TypeError('Every published component layer needs a stable source ID.');
    sourceIdsByEditorId.set(original.id, sourceId);
    if (useSourceIds && !original.componentSourceId) original.componentSourceId = sourceId;
    node.id = sourceId;
    stripLinkFields(node);
    for (const property of Object.keys(original.variableBindings || {})) {
      const value = document ? getNodePropertyValue(document, original, property) : undefined;
      if (value !== undefined) setPropertyPath(node, property, value);
    }
    if (document && (original.fillVariableId || original.fillStyleId)) node.fill = getNodeColor(document, original, 'fill');
    if (document && (original.textVariableId || original.textStyleId)) node.color = getNodeColor(document, original, 'text');
    if (document && original.strokeVariableId) node.stroke = getNodeColor(document, original, 'stroke');
    if (Array.isArray(node.interactions)) {
      node.interactions = node.interactions.filter(interaction => interaction.action !== 'change-variant'
        && interaction.action !== 'set-variable-mode' && !interaction.condition?.variableId);
      if (!node.interactions.length) delete node.interactions;
    }
    for (const property of ['fillStyleId', 'textStyleId', 'fillVariableId', 'textVariableId', 'strokeVariableId', 'variableBindings', 'variableModes']) {
      delete node[property];
    }
    node.children = (original.children || []).map((child, index) => {
      const childCopy = clone(child);
      return visit(childCopy, child);
    });
    return node;
  };
  const publishedRoot = visit(copy, root);
  const remapMaskReferences = node => {
    if (sourceIdsByEditorId.has(node.maskSourceId)) node.maskSourceId = sourceIdsByEditorId.get(node.maskSourceId);
    for (const child of node.children || []) remapMaskReferences(child);
  };
  remapMaskReferences(publishedRoot);
  return removeUndefinedProperties(publishedRoot);
}

/** Turn a library snapshot into an editable tree whose IDs remain stable across updates. */
export function createLinkedEditorInstance(snapshot, { x, y, makeNodeId = type => createId(type), instanceName = null, document = null } = {}) {
  validateLinkedInstanceSnapshot(snapshot);
  const root = clone(snapshot.root);
  const sourceToEditorId = new Map();
  const visit = node => {
    const sourceId = node.id;
    node.id = makeNodeId(node.type);
    sourceToEditorId.set(sourceId, node.id);
    node.componentSourceId = sourceId;
    delete node.componentSourceKey;
    stripLinkFields(node);
    node.componentSourceId = sourceId;
    node.children = (node.children || []).map(visit);
    return node;
  };
  const instance = visit(root);
  prepareTreeForDesign([instance], document, sourceToEditorId);
  if (Number.isFinite(x)) instance.x = x;
  if (Number.isFinite(y)) instance.y = y;
  instance.name = instanceName || `${snapshot.sourceSnapshot.name} instance`;
  instance.linkedComponent = clone(snapshot);
  return instance;
}

function keepDesignLocalInteractions(node, context) {
  if (!Array.isArray(node.interactions)) return;
  node.interactions = node.interactions.filter(interaction => {
    if (interaction.action === 'change-variant') return false;
    if (context.sourceToEditorId.has(interaction.destinationId)) interaction.destinationId = context.sourceToEditorId.get(interaction.destinationId);
    if (interaction.destinationId && !context.nodeIds.has(interaction.destinationId)) return false;
    if (interaction.destinationPageId && !context.pages.has(interaction.destinationPageId)) return false;
    if (interaction.condition?.variableId && !context.variables.has(interaction.condition.variableId)) return false;
    if (interaction.action === 'set-variable-mode') {
      const modes = context.collections.get(interaction.collectionId);
      if (!modes || (interaction.modeId != null && !modes.has(interaction.modeId))) return false;
    }
    return true;
  });
  if (!node.interactions.length) delete node.interactions;
}

function prepareTreeForDesign(nodes, document, sourceToEditorId = new Map()) {
  const context = { pages: new Set(), variables: new Set(), collections: new Map(), nodeIds: new Set(), sourceToEditorId };
  for (const page of document?.pages || []) {
    context.pages.add(page.id);
    const collect = layers => layers.forEach(layer => { context.nodeIds.add(layer.id); collect(layer.children || []); });
    collect(page.children || []);
  }
  for (const variable of document?.variables || []) context.variables.add(variable.id);
  for (const collection of document?.variableCollections || []) context.collections.set(collection.id, new Set((collection.modes || []).map(mode => mode.id)));
  for (const editorId of sourceToEditorId.values()) context.nodeIds.add(editorId);
  const visit = node => {
    if (sourceToEditorId.has(node.maskSourceId)) node.maskSourceId = sourceToEditorId.get(node.maskSourceId);
    keepDesignLocalInteractions(node, context);
    for (const child of node.children || []) visit(child);
  };
  for (const node of nodes) visit(node);
}

/** Record a supported local property edit in the immutable linked snapshot. */
export function withLinkedComponentOverride(snapshot, sourceLayerId, property, value) {
  validateLinkedInstanceSnapshot(snapshot);
  if (typeof sourceLayerId !== 'string' || !sourceLayerId || typeof property !== 'string' || !property) {
    throw new TypeError('A linked override needs a source layer and property.');
  }
  const next = clone(snapshot);
  next.overrides[sourceLayerId] ||= {};
  next.overrides[sourceLayerId][property] = value === undefined ? null : clone(value);
  const apply = node => {
    const properties = next.overrides[node.id];
    if (properties) Object.assign(node, clone(properties));
    for (const child of node.children || []) apply(child);
  };
  next.root = clone(next.sourceSnapshot.root);
  apply(next.root);
  validateLinkedInstanceSnapshot(next);
  return next;
}

/** Mutate one already-materialized linked snapshot without cloning its whole tree on every drag tick. */
export function recordLinkedComponentOverride(snapshot, sourceLayerId, property, value) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.schema !== 'tiny-image-star/linked-component-instance/1') {
    throw new TypeError('Invalid linked component snapshot.');
  }
  if (typeof sourceLayerId !== 'string' || !sourceLayerId || typeof property !== 'string' || !property || reservedOverrides.has(property)) {
    throw new TypeError('A linked override needs a supported source property.');
  }
  let target = null;
  const visit = node => {
    if (node.id === sourceLayerId) { target = node; return; }
    for (const child of node.children || []) { if (target) break; visit(child); }
  };
  visit(snapshot.root);
  if (!target) throw new TypeError(`Override refers to missing source layer “${sourceLayerId}”.`);
  const nextValue = value === undefined ? null : clone(value);
  snapshot.overrides[sourceLayerId] ||= {};
  snapshot.overrides[sourceLayerId][property] = nextValue;
  target[property] = clone(nextValue);
  return snapshot;
}

/** Apply a published update while preserving editor IDs and the instance position. */
export function applyLinkedComponentUpdate(instanceRoot, updatedSnapshot, { makeNodeId = type => createId(type), document = null } = {}) {
  validateLinkedInstanceSnapshot(updatedSnapshot);
  const previous = instanceRoot;
  const previousBySource = new Map();
  const collect = node => {
    if (node?.componentSourceId) previousBySource.set(node.componentSourceId, node);
    for (const child of node?.children || []) collect(child);
  };
  collect(previous);

  const rootX = previous.x;
  const rootY = previous.y;
  const rootName = previous.name;
  const sourceToEditorId = new Map();
  const materialize = sourceNode => {
    const prior = previousBySource.get(sourceNode.id);
    const next = clone(sourceNode);
    next.id = prior?.id || makeNodeId(next.type);
    sourceToEditorId.set(sourceNode.id, next.id);
    next.componentSourceId = sourceNode.id;
    delete next.componentSourceKey;
    stripLinkFields(next);
    next.componentSourceId = sourceNode.id;
    next.children = (sourceNode.children || []).map(materialize);
    return next;
  };
  const resolved = materialize(updatedSnapshot.root);
  prepareTreeForDesign([resolved], document, sourceToEditorId);
  Object.assign(instanceRoot, resolved, {
    id: previous.id,
    x: rootX,
    y: rootY,
    name: rootName,
    linkedComponent: clone(updatedSnapshot)
  });
  return instanceRoot;
}
