import { createId, getNodeColor, getNodePropertyValue } from './model.js';
import {
  COMPONENT_DESIGN_TOKENS_SCHEMA, COMPONENT_PUBLICATION_TOKENS, componentTokenIdentityId,
  validateLinkedInstanceSnapshot
} from './component-library.js';

const clone = value => structuredClone(value);

const editorLinkFields = [
  'isComponent', 'isInstance', 'componentId', 'componentOverrides', 'componentPropertyValues',
  'componentNameIsInherited', 'componentSourceId', 'componentSourceKey', 'variantNodeKey',
  'linkedComponent', 'publishedLibraryRefs'
];
const reservedOverrides = new Set(editorLinkFields.concat(['id', 'type', 'children']));

function assertOverrideAddress(sourceLayerId, property) {
  if (typeof sourceLayerId !== 'string' || !sourceLayerId || sourceLayerId === '__proto__'
    || typeof property !== 'string' || !property || property === '__proto__' || reservedOverrides.has(property)) {
    throw new TypeError('A linked override needs a supported source property.');
  }
}

function ownPropertiesFor(object, key) {
  if (!Object.hasOwn(object, key)) {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: {}
    });
  }
  return object[key];
}

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

function collectTokenReferences(value, references) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) collectTokenReferences(item, references); return; }
  for (const [key, child] of Object.entries(value)) {
    if (['fillVariableId', 'textVariableId', 'strokeVariableId'].includes(key) && typeof child === 'string') references.add(child);
    if (key === 'variableBindings' && child && typeof child === 'object' && !Array.isArray(child)) {
      for (const variableId of Object.values(child)) if (typeof variableId === 'string') references.add(variableId);
    }
    collectTokenReferences(child, references);
  }
}

function tokenOrigin(record, kind, document, linkedLibraryId, collection = null) {
  const linked = record?.linkedLibraryToken;
  if (linkedLibraryId && linked?.libraryId === linkedLibraryId && linked.source) return structuredClone(linked.source);
  return {
    documentId: document.id,
    collectionId: collection?.id || record.id,
    ...(kind === 'collection' ? { collectionId: record.id } : {}),
    ...(kind === 'mode' ? { id: record.id } : kind === 'collection' ? {} : { id: record.id }),
    ...(kind === 'variable' ? { variableId: record.id } : {})
  };
}

function makeTokenId(kind, source) {
  return componentTokenIdentityId(kind, {
    documentId: source.documentId,
    collectionId: source.collectionId,
    id: kind === 'collection' ? source.collectionId : kind === 'mode' ? source.id : source.variableId
  });
}

function buildPublicationDesignTokens(root, document, linkedLibraryId) {
  if (!document) return null;
  const sourceVariables = document.variables || [];
  const sourceCollections = document.variableCollections || [];
  const variablesById = new Map(sourceVariables.map(variable => [variable.id, variable]));
  const collectionsById = new Map(sourceCollections.map(collection => [collection.id, collection]));
  const references = new Set();
  collectTokenReferences(root, references);
  const included = new Set();
  const collectionIds = new Set();
  const pending = [...references];
  while (pending.length) {
    const variableId = pending.pop();
    const variable = variablesById.get(variableId);
    const collection = variable && collectionsById.get(variable.collectionId);
    if (!variable || !collection) continue;
    if (included.has(variable.id)) continue;
    included.add(variable.id);
    collectionIds.add(collection.id);
    for (const targetId of Object.values(variable.aliasesByMode || {})) if (!included.has(targetId)) pending.push(targetId);
  }
  const sourceIdentityForCollection = new Map();
  const sourceIdentityForVariable = new Map();
  const collectionIdMap = new Map();
  const variableIdMap = new Map();
  const modeIdMap = new Map();
  for (const collectionId of collectionIds) {
    const collection = collectionsById.get(collectionId);
    const source = tokenOrigin(collection, 'collection', document, linkedLibraryId);
    sourceIdentityForCollection.set(collectionId, source);
    collectionIdMap.set(collectionId, makeTokenId('collection', source));
    for (const mode of collection.modes || []) {
      const modeSource = tokenOrigin(mode, 'mode', document, linkedLibraryId, collection);
      // Imported modes keep their original collection identity even if a
      // same-named collection exists elsewhere in the receiving design.
      if (mode.linkedLibraryToken?.source && linkedLibraryId === mode.linkedLibraryToken.libraryId) {
        modeSource.documentId = mode.linkedLibraryToken.source.documentId;
        modeSource.collectionId = mode.linkedLibraryToken.source.collectionId;
      } else {
        modeSource.documentId = source.documentId;
        modeSource.collectionId = source.collectionId;
      }
      modeIdMap.set(`${collectionId}\u0000${mode.id}`, makeTokenId('mode', modeSource));
    }
  }
  for (const variableId of included) {
    const variable = variablesById.get(variableId);
    const collection = collectionsById.get(variable.collectionId);
    const source = tokenOrigin(variable, 'variable', document, linkedLibraryId, collection);
    sourceIdentityForVariable.set(variableId, source);
    variableIdMap.set(variableId, makeTokenId('variable', source));
  }
  const collections = [...collectionIds].map(collectionId => {
    const collection = collectionsById.get(collectionId);
    const source = sourceIdentityForCollection.get(collectionId);
    return {
      id: collectionIdMap.get(collectionId), name: collection.name,
      defaultModeId: modeIdMap.get(`${collectionId}\u0000${collection.defaultModeId}`),
      modes: (collection.modes || []).map(mode => ({
        id: modeIdMap.get(`${collectionId}\u0000${mode.id}`), name: mode.name,
        source: tokenOrigin(mode, 'mode', document, linkedLibraryId, collection)
      })),
      source
    };
  });
  const variables = [...included].map(variableId => {
    const variable = variablesById.get(variableId);
    const collection = collectionsById.get(variable.collectionId);
    const source = sourceIdentityForVariable.get(variableId);
    const valuesByMode = {};
    const aliasesByMode = {};
    for (const mode of collection.modes || []) {
      const modeId = modeIdMap.get(`${collection.id}\u0000${mode.id}`);
      valuesByMode[modeId] = variable.valuesByMode?.[mode.id];
      const aliasTarget = variable.aliasesByMode?.[mode.id];
      if (aliasTarget && variableIdMap.has(aliasTarget)) aliasesByMode[modeId] = variableIdMap.get(aliasTarget);
    }
    return {
      id: variableIdMap.get(variableId), collectionId: collectionIdMap.get(collection.id),
      name: variable.name, type: variable.type, valuesByMode,
      ...(Object.hasOwn(variable, 'scopes') ? { scopes: structuredClone(variable.scopes) } : {}),
      ...(Object.keys(aliasesByMode).length ? { aliasesByMode } : {}), source
    };
  });
  const remap = { collections: collectionIdMap, variables: variableIdMap, modes: modeIdMap };
  return {
    snapshot: { schema: COMPONENT_DESIGN_TOKENS_SCHEMA, collections, variables },
    remap
  };
}

function remapTokenReferences(value, maps) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) remapTokenReferences(item, maps); return; }
  for (const property of ['fillVariableId', 'textVariableId', 'strokeVariableId']) {
    if (typeof value[property] === 'string') {
      const mapped = maps.variables.get(value[property]);
      if (mapped) value[property] = mapped;
      else delete value[property];
    }
  }
  if (value.variableBindings && typeof value.variableBindings === 'object' && !Array.isArray(value.variableBindings)) {
    for (const [property, variableId] of Object.entries(value.variableBindings)) {
      const mapped = maps.variables.get(variableId);
      if (mapped) value.variableBindings[property] = mapped;
      else delete value.variableBindings[property];
    }
    if (!Object.keys(value.variableBindings).length) delete value.variableBindings;
  }
  if (value.variableModes && typeof value.variableModes === 'object' && !Array.isArray(value.variableModes)) {
    const mappedModes = {};
    for (const [collectionId, modeId] of Object.entries(value.variableModes)) {
      const mappedCollection = maps.collections.get(collectionId);
      const mappedMode = maps.modes.get(`${collectionId}\u0000${modeId}`);
      if (mappedCollection && mappedMode) mappedModes[mappedCollection] = mappedMode;
    }
    if (Object.keys(mappedModes).length) value.variableModes = mappedModes;
    else delete value.variableModes;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'variableBindings' || key === 'variableModes' || ['fillVariableId', 'textVariableId', 'strokeVariableId'].includes(key)) continue;
    remapTokenReferences(child, maps);
  }
}

function uniqueIdentity(used, preferred, prefix) {
  if (preferred && !used.has(preferred)) { used.add(preferred); return preferred; }
  let id;
  do { id = createId(prefix); } while (used.has(id));
  used.add(id);
  return id;
}

function uniqueLinkedVariableName(document, collectionId, sourceName, variableId) {
  const occupied = new Set(document.variables.filter(variable => variable.collectionId === collectionId && variable.id !== variableId)
    .map(variable => variable.name.toLocaleLowerCase()));
  if (!occupied.has(sourceName.toLocaleLowerCase())) return sourceName;
  const base = `${sourceName} (linked)`;
  let name = base;
  let suffix = 2;
  while (occupied.has(name.toLocaleLowerCase())) name = `${base} ${suffix++}`;
  return name;
}

function installLinkedDesignTokens(document, tokenSnapshot, libraryId) {
  const variableMap = new Map(); const collectionMap = new Map(); const modeMap = new Map();
  if (!document || !tokenSnapshot?.collections?.length) return { variables: variableMap, collections: collectionMap, modes: modeMap };
  document.variableCollections ||= [];
  document.variables ||= [];
  for (const source of tokenSnapshot.variables || []) {
    const existing = document.variables.find(variable => variable.linkedLibraryToken?.libraryId === libraryId
      && variable.linkedLibraryToken?.id === source.id);
    if (existing && existing.type !== source.type) {
      throw new TypeError(`Linked token “${source.name}” changed type. Detach or recreate its local binding before updating.`);
    }
  }
  const collectionIds = new Set(document.variableCollections.map(collection => collection.id));
  const variableIds = new Set(document.variables.map(variable => variable.id));
  const findLinkedCollection = tokenId => document.variableCollections.find(collection => collection.linkedLibraryToken?.libraryId === libraryId
    && collection.linkedLibraryToken?.id === tokenId);
  const findLinkedVariable = tokenId => document.variables.find(variable => variable.linkedLibraryToken?.libraryId === libraryId
    && variable.linkedLibraryToken?.id === tokenId);
  const collectionRecords = new Map();
  for (const source of tokenSnapshot.collections) {
    let target = findLinkedCollection(source.id);
    if (!target) {
      target = {
        id: uniqueIdentity(collectionIds, source.id, 'collection'), name: source.name,
        defaultModeId: '', modes: [], linkedLibraryToken: { libraryId, id: source.id, source: clone(source.source) }
      };
      document.variableCollections.push(target);
    }
    target.name = source.name;
    target.linkedLibraryToken = { libraryId, id: source.id, source: clone(source.source) };
    collectionIds.add(target.id);
    collectionMap.set(source.id, target.id);
    for (const mode of source.modes) {
      let targetMode = target.modes.find(item => item.linkedLibraryToken?.libraryId === libraryId && item.linkedLibraryToken?.id === mode.id);
      if (!targetMode) {
        targetMode = {
          id: uniqueIdentity(new Set(target.modes.map(item => item.id)), mode.id, 'mode'),
          name: mode.name,
          linkedLibraryToken: { libraryId, id: mode.id, source: clone(mode.source) }
        };
        target.modes.push(targetMode);
      }
      targetMode.name = mode.name;
      targetMode.linkedLibraryToken = { libraryId, id: mode.id, source: clone(mode.source) };
      modeMap.set(`${source.id}\u0000${mode.id}`, targetMode.id);
    }
    target.defaultModeId = modeMap.get(`${source.id}\u0000${source.defaultModeId}`);
    collectionRecords.set(source.id, target);
  }
  for (const source of tokenSnapshot.variables) {
    let target = findLinkedVariable(source.id);
    const collection = collectionRecords.get(source.collectionId);
    if (!target) {
      target = {
        id: uniqueIdentity(variableIds, source.id, 'variable'), collectionId: collection.id,
        name: source.name, type: source.type, valuesByMode: {},
        linkedLibraryToken: { libraryId, id: source.id, source: clone(source.source) }
      };
      document.variables.push(target);
    }
    target.collectionId = collection.id;
    target.name = uniqueLinkedVariableName(document, collection.id, source.name, target.id);
    target.type = source.type;
    target.linkedLibraryToken = { libraryId, id: source.id, source: clone(source.source) };
    if (Object.hasOwn(source, 'scopes')) target.scopes = clone(source.scopes);
    else delete target.scopes;
    target.valuesByMode ||= {};
    const sourceCollection = tokenSnapshot.collections.find(item => item.id === source.collectionId);
    const sourceDefault = source.valuesByMode[sourceCollection?.defaultModeId];
    for (const mode of collection.modes) {
      if (!Object.hasOwn(target.valuesByMode, mode.id)) target.valuesByMode[mode.id] = sourceDefault;
    }
    for (const sourceModeId of Object.keys(source.valuesByMode)) {
      const destinationModeId = modeMap.get(`${source.collectionId}\u0000${sourceModeId}`);
      if (destinationModeId) target.valuesByMode[destinationModeId] = source.valuesByMode[sourceModeId];
    }
    variableIds.add(target.id);
    variableMap.set(source.id, target.id);
  }
  for (const source of tokenSnapshot.variables) {
    const target = findLinkedVariable(source.id);
    const collection = collectionRecords.get(source.collectionId);
    const sourceModeIds = new Set(collection.modes.map(mode => mode.id));
    target.aliasesByMode ||= {};
    for (const sourceModeId of sourceModeIds) {
      const destinationModeId = modeMap.get(`${source.collectionId}\u0000${sourceModeId}`);
      if (!destinationModeId) continue;
      delete target.aliasesByMode[destinationModeId];
      const aliasSourceId = source.aliasesByMode?.[sourceModeId];
      const aliasTargetId = variableMap.get(aliasSourceId);
      if (aliasTargetId) target.aliasesByMode[destinationModeId] = aliasTargetId;
    }
    if (!Object.keys(target.aliasesByMode).length) delete target.aliasesByMode;
  }
  return { variables: variableMap, collections: collectionMap, modes: modeMap };
}

/** Serialize a main component or linked instance as a portable source tree. */
export function componentTreeForPublication(root, { useSourceIds = false, createSourceId = () => createId('source'), document = null } = {}) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new TypeError('Select a layer tree to publish.');
  const copy = clone(root);
  const tokenSnapshot = buildPublicationDesignTokens(root, document, root.linkedComponent?.libraryId || null);
  const sourceIdsByEditorId = new Map();
  const visit = (node, original) => {
    node.children = [];
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
    for (const property of ['fillStyleId', 'textStyleId', 'typographyStyleId']) delete node[property];
    if (document) remapTokenReferences(node, tokenSnapshot.remap);
    else for (const property of ['fillVariableId', 'textVariableId', 'strokeVariableId', 'variableBindings', 'variableModes']) delete node[property];
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
  if (document) Object.defineProperty(publishedRoot, COMPONENT_PUBLICATION_TOKENS, {
    configurable: false, enumerable: false, writable: false, value: tokenSnapshot.snapshot
  });
  return removeUndefinedProperties(publishedRoot);
}

/** Turn a library snapshot into an editable tree whose IDs remain stable across updates. */
export function createLinkedEditorInstance(snapshot, { x, y, makeNodeId = type => createId(type), instanceName = null, document = null } = {}) {
  validateLinkedInstanceSnapshot(snapshot);
  const root = clone(snapshot.root);
  const tokenMaps = installLinkedDesignTokens(document, snapshot.designTokens, snapshot.libraryId);
  remapTokenReferences(root, tokenMaps);
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
    if (interaction.action === 'scroll-to') {
      const targetSourceId = interaction.scrollTargetId;
      const editorTargetId = context.sourceToEditorId.get(targetSourceId);
      if (editorTargetId) interaction.scrollTargetId = editorTargetId;
      else if (!context.nodeIds.has(targetSourceId)) return false;
    }
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
  assertOverrideAddress(sourceLayerId, property);
  const next = clone(snapshot);
  const properties = ownPropertiesFor(next.overrides, sourceLayerId);
  Object.defineProperty(properties, property, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: value === undefined ? null : clone(value)
  });
  const apply = node => {
    const local = Object.hasOwn(next.overrides, node.id) ? next.overrides[node.id] : null;
    if (local) Object.assign(node, clone(local));
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
  assertOverrideAddress(sourceLayerId, property);
  let target = null;
  const visit = node => {
    if (node.id === sourceLayerId) { target = node; return; }
    for (const child of node.children || []) { if (target) break; visit(child); }
  };
  visit(snapshot.root);
  if (!target) throw new TypeError(`Override refers to missing source layer “${sourceLayerId}”.`);
  const nextValue = value === undefined ? null : clone(value);
  const properties = ownPropertiesFor(snapshot.overrides, sourceLayerId);
  Object.defineProperty(properties, property, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: nextValue
  });
  Object.defineProperty(target, property, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: clone(nextValue)
  });
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

  const tokenMaps = installLinkedDesignTokens(document, updatedSnapshot.designTokens, updatedSnapshot.libraryId);

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
    next.children = [];
    remapTokenReferences(next, tokenMaps);
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
