/**
 * Pure local component-library primitives.
 *
 * This module deliberately does not access the editor model, IndexedDB, or the
 * DOM. Callers publish serializable layer trees, persist the returned library,
 * and decide how to map source layer IDs to live editor node IDs.
 */

export const COMPONENT_LIBRARY_SCHEMA = 'tiny-image-star/component-library/1';
export const LINKED_INSTANCE_SCHEMA = 'tiny-image-star/linked-component-instance/1';
export const COMPONENT_DESIGN_TOKENS_SCHEMA = 'tiny-image-star/component-design-tokens/1';
/** Ephemeral handoff from the editor tree adapter to the pure library publisher. */
export const COMPONENT_PUBLICATION_TOKENS = Symbol('tiny-image-star.component-publication-tokens');

const RESERVED_OVERRIDE_PROPERTIES = new Set([
  'id', 'type', 'children', 'componentId', 'componentSourceId', 'componentSourceKey',
  'componentOverrides', 'componentPropertyValues', 'isComponent', 'isInstance'
]);

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableClone(value) {
  return deepFreeze(clone(value));
}

function fail(message) {
  throw new TypeError(message);
}

function validIdentity(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || value !== value.trim()) {
    fail(`${label} must be a non-empty, trimmed string of at most 200 characters.`);
  }
  return value;
}

function validName(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) {
    fail(`${label} must contain 1–120 characters.`);
  }
  return value.trim();
}

function validRevision(value, label = 'Revision') {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer.`);
  return value;
}

function tokenIdentity(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value !== value.trim()) {
    fail(`${label} must be a non-empty, trimmed token identity of at most 4096 characters.`);
  }
  return value;
}

/** Stable, collision-safe identity for a design token copied into a local library. */
export function componentTokenIdentityId(kind, { documentId, collectionId, id }) {
  for (const [value, label] of [[kind, 'Token kind'], [documentId, 'Source document ID'], [collectionId, 'Source collection ID'], [id, 'Source token ID']]) {
    if (typeof value !== 'string' || !value.trim()) fail(`${label} is required to create a stable token identity.`);
  }
  return `tiny-image-star-token:${encodeURIComponent(JSON.stringify([kind, documentId, collectionId, id]))}`;
}

function assertComponentDesignTokens(tokens, label = 'Component design tokens') {
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens) || tokens.schema !== COMPONENT_DESIGN_TOKENS_SCHEMA
    || !Array.isArray(tokens.collections) || !Array.isArray(tokens.variables)) fail(`Invalid ${label} snapshot.`);
  assertJsonValue(tokens, label);
  const collections = new Map();
  const modesByCollection = new Map();
  for (const collection of tokens.collections) {
    if (!collection || typeof collection !== 'object' || Array.isArray(collection)) fail(`Invalid collection in ${label}.`);
    tokenIdentity(collection.id, 'Token collection ID');
    if (collections.has(collection.id) || typeof collection.name !== 'string' || !collection.name.trim()
      || !Array.isArray(collection.modes) || !collection.modes.length) fail(`Invalid or duplicate collection in ${label}.`);
    const modes = new Set();
    for (const mode of collection.modes) {
      if (!mode || typeof mode !== 'object' || Array.isArray(mode)) fail(`Invalid mode in ${label}.`);
      tokenIdentity(mode.id, 'Token mode ID');
      if (modes.has(mode.id) || typeof mode.name !== 'string' || !mode.name.trim()) fail(`Invalid or duplicate mode in ${label}.`);
      modes.add(mode.id);
    }
    if (!modes.has(collection.defaultModeId)) fail(`A collection in ${label} has no default mode.`);
    if (collection.source != null) {
      tokenIdentity(collection.source.documentId, 'Source document ID');
      tokenIdentity(collection.source.collectionId, 'Source collection ID');
    }
    collections.set(collection.id, collection);
    modesByCollection.set(collection.id, modes);
  }
  const variables = new Map();
  const namesByCollection = new Set();
  for (const variable of tokens.variables) {
    if (!variable || typeof variable !== 'object' || Array.isArray(variable)) fail(`Invalid variable in ${label}.`);
    tokenIdentity(variable.id, 'Token variable ID');
    const modes = modesByCollection.get(variable.collectionId);
    const nameKey = `${variable.collectionId}:${String(variable.name || '').toLocaleLowerCase()}`;
    const validType = ['color', 'number', 'string', 'boolean'].includes(variable.type);
    const values = variable.valuesByMode;
    if (variables.has(variable.id) || !modes || typeof variable.name !== 'string' || !variable.name.trim()
      || namesByCollection.has(nameKey) || !validType || !values || typeof values !== 'object' || Array.isArray(values)
      || Object.keys(values).length !== modes.size || [...modes].some(modeId => {
        const value = values[modeId];
        return variable.type === 'color' ? typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)
          : variable.type === 'number' ? typeof value !== 'number' || !Number.isFinite(value)
            : variable.type === 'string' ? typeof value !== 'string' : typeof value !== 'boolean';
      })) fail(`Invalid or duplicate variable in ${label}.`);
    if (variable.source != null) {
      tokenIdentity(variable.source.documentId, 'Source document ID');
      tokenIdentity(variable.source.collectionId, 'Source collection ID');
      tokenIdentity(variable.source.variableId, 'Source variable ID');
    }
    const aliases = variable.aliasesByMode;
    if (aliases != null && (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)
      || Object.keys(aliases).some(modeId => !modes.has(modeId)))) fail(`Invalid aliases in ${label}.`);
    variables.set(variable.id, variable);
    namesByCollection.add(nameKey);
  }
  const edges = new Map([...variables.keys()].map(id => [id, new Set()]));
  for (const variable of variables.values()) {
    for (const [modeId, targetId] of Object.entries(variable.aliasesByMode || {})) {
      const target = variables.get(targetId);
      if (!target || target.type !== variable.type || !modesByCollection.get(variable.collectionId)?.has(modeId)) {
        fail(`Invalid alias in ${label}.`);
      }
      edges.get(variable.id).add(targetId);
    }
  }
  const visiting = new Set(); const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) fail(`Variable aliases in ${label} cannot contain a cycle.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const targetId of edges.get(id) || []) visit(targetId);
    visiting.delete(id); visited.add(id);
  };
  for (const id of variables.keys()) visit(id);
  return true;
}

function mergeComponentDesignTokens(existing, incoming) {
  if (incoming == null) return existing ? clone(existing) : null;
  assertComponentDesignTokens(incoming);
  const next = existing ? clone(existing) : { schema: COMPONENT_DESIGN_TOKENS_SCHEMA, collections: [], variables: [] };
  assertComponentDesignTokens(next);
  const collections = new Map(next.collections.map(collection => [collection.id, collection]));
  const variables = new Map(next.variables.map(variable => [variable.id, variable]));
  for (const incomingCollection of incoming.collections) {
    let collection = collections.get(incomingCollection.id);
    if (!collection) {
      collection = clone(incomingCollection);
      next.collections.push(collection); collections.set(collection.id, collection);
    } else {
      if (stableValue(collection.source || null) !== stableValue(incomingCollection.source || null)) fail('A published token collection identity cannot change its source.');
      collection.name = incomingCollection.name;
      collection.defaultModeId = incomingCollection.defaultModeId;
      for (const incomingMode of incomingCollection.modes) {
        const current = collection.modes.find(mode => mode.id === incomingMode.id);
        if (current) current.name = incomingMode.name;
        else collection.modes.push(clone(incomingMode));
      }
    }
  }
  for (const incomingVariable of incoming.variables) {
    let variable = variables.get(incomingVariable.id);
    if (!variable) {
      variable = clone(incomingVariable);
      next.variables.push(variable); variables.set(variable.id, variable);
      continue;
    }
    if (variable.collectionId !== incomingVariable.collectionId || variable.type !== incomingVariable.type
      || stableValue(variable.source || null) !== stableValue(incomingVariable.source || null)) {
      fail(`Published variable “${incomingVariable.name}” cannot change its collection, type, or source identity.`);
    }
    variable.name = incomingVariable.name;
    if (Object.hasOwn(incomingVariable, 'scopes')) variable.scopes = clone(incomingVariable.scopes);
    else delete variable.scopes;
    for (const [modeId, value] of Object.entries(incomingVariable.valuesByMode)) variable.valuesByMode[modeId] = value;
    variable.aliasesByMode ||= {};
    const currentModes = new Set(incomingCollectionModes(incoming, incomingVariable.collectionId));
    for (const modeId of currentModes) delete variable.aliasesByMode[modeId];
    Object.assign(variable.aliasesByMode, clone(incomingVariable.aliasesByMode || {}));
    if (!Object.keys(variable.aliasesByMode).length) delete variable.aliasesByMode;
  }
  assertComponentDesignTokens(next);
  return next;
}

function incomingCollectionModes(tokens, collectionId) {
  return tokens.collections.find(collection => collection.id === collectionId)?.modes.map(mode => mode.id) || [];
}

function referencedComponentDesignTokens(tokens, root) {
  if (!tokens) return null;
  const variables = new Map(tokens.variables.map(variable => [variable.id, variable]));
  const collections = new Map(tokens.collections.map(collection => [collection.id, collection]));
  const required = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    for (const [key, child] of Object.entries(value)) {
      if (['fillVariableId', 'textVariableId', 'strokeVariableId'].includes(key) && typeof child === 'string' && variables.has(child)) required.add(child);
      if (key === 'variableBindings' && child && typeof child === 'object' && !Array.isArray(child)) {
        for (const variableId of Object.values(child)) if (typeof variableId === 'string' && variables.has(variableId)) required.add(variableId);
      }
      visit(child);
    }
  };
  visit(root);
  const pending = [...required];
  while (pending.length) {
    const variable = variables.get(pending.pop());
    for (const targetId of Object.values(variable?.aliasesByMode || {})) {
      if (!required.has(targetId) && variables.has(targetId)) { required.add(targetId); pending.push(targetId); }
    }
  }
  if (!required.size) return { schema: COMPONENT_DESIGN_TOKENS_SCHEMA, collections: [], variables: [] };
  const collectionIds = new Set([...required].map(id => variables.get(id)?.collectionId).filter(Boolean));
  return {
    schema: COMPONENT_DESIGN_TOKENS_SCHEMA,
    collections: [...collectionIds].map(id => collections.get(id)).filter(Boolean).map(clone),
    variables: [...required].map(id => variables.get(id)).filter(Boolean).map(clone)
  };
}

function assertJsonValue(value, label, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number.`);
    return;
  }
  if (typeof value !== 'object') fail(`${label} must contain only JSON-compatible values.`);
  if (ancestors.has(value)) fail(`${label} cannot contain circular references.`);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail(`${label} must contain only plain objects and arrays.`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, label, ancestors);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__') fail(`${label} cannot contain an __proto__ property.`);
      assertJsonValue(item, label, ancestors);
    }
  }
  ancestors.delete(value);
}

function collectSourceLayers(root, label = 'Component root') {
  if (!root || typeof root !== 'object' || Array.isArray(root)) fail(`${label} must be a layer object.`);
  const layers = new Map();
  const visit = (node, parentSourceLayerId = null, childIndex = 0) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) fail(`${label} contains an invalid layer.`);
    const sourceLayerId = validIdentity(node.id, 'Source layer ID');
    validIdentity(node.type, `Layer type for ${sourceLayerId}`);
    if (layers.has(sourceLayerId)) fail(`${label} contains duplicate source layer ID “${sourceLayerId}”.`);
    if (node.children != null && !Array.isArray(node.children)) fail(`Children for layer “${sourceLayerId}” must be a list.`);
    layers.set(sourceLayerId, { node, parentSourceLayerId, childIndex });
    for (let index = 0; index < (node.children || []).length; index += 1) {
      visit(node.children[index], sourceLayerId, index);
    }
  };
  visit(root);
  return layers;
}

function assertLibrary(library) {
  if (!library || typeof library !== 'object' || Array.isArray(library) || library.schema !== COMPONENT_LIBRARY_SCHEMA) {
    fail('Invalid component library schema.');
  }
  validIdentity(library.id, 'Library ID');
  validName(library.name, 'Library name');
  validRevision(library.revision, 'Library revision');
  if (!Array.isArray(library.components)) fail('Library components must be a list.');
  if (library.componentSets != null && !Array.isArray(library.componentSets)) fail('Library component sets must be a list.');
  if (library.designTokens != null) assertComponentDesignTokens(library.designTokens, 'library design tokens');

  const componentIds = new Set();
  const publicationRevisions = new Set();
  for (const component of library.components) {
    if (!component || typeof component !== 'object' || Array.isArray(component)) fail('Invalid component record.');
    validIdentity(component.id, 'Component ID');
    if (componentIds.has(component.id)) fail(`Duplicate component ID “${component.id}”.`);
    componentIds.add(component.id);
    if (!Array.isArray(component.versions) || component.versions.length === 0) fail(`Component “${component.id}” must have at least one published version.`);
    let previousRevision = 0;
    for (const publication of component.versions) {
      if (!publication || typeof publication !== 'object' || Array.isArray(publication)) fail('Invalid component publication.');
      if (publication.libraryId !== library.id || publication.componentId !== component.id) fail('Publication identity does not match its library and component.');
      validRevision(publication.revision, 'Component publication revision');
      if (publication.revision <= previousRevision || publication.revision > library.revision) fail(`Component “${component.id}” revisions must increase and not exceed the library revision.`);
      if (publicationRevisions.has(publication.revision)) fail(`Library revision ${publication.revision} is assigned to more than one publication.`);
      publicationRevisions.add(publication.revision);
      previousRevision = publication.revision;
      validName(publication.name, 'Published component name');
      validateComponentMetadata(publication);
      assertJsonValue(publication.root, `Published component “${component.id}”`);
      const sourceLayers = collectSourceLayers(publication.root, `Published component “${component.id}”`);
      for (const property of publication.componentProperties || []) {
        if (!sourceLayers.has(property.targetSourceId)) fail(`Component property “${property.name}” refers to a missing source layer.`);
      }
    }
  }
  if (publicationRevisions.size !== library.revision
    || Array.from({ length: library.revision }, (_, index) => index + 1).some(revision => !publicationRevisions.has(revision))) {
    fail('Library publication revisions must cover every revision from 1 through the library revision.');
  }
  const setIds = new Set();
  for (const set of library.componentSets || []) {
    if (!set || typeof set !== 'object' || Array.isArray(set)) fail('Invalid component set record.');
    validIdentity(set.id, 'Component set ID');
    if (setIds.has(set.id)) fail(`Duplicate component set ID “${set.id}”.`);
    setIds.add(set.id);
    if (!Array.isArray(set.versions) || !set.versions.length) fail(`Component set “${set.id}” must have at least one published version.`);
    let previousRevision = 0;
    for (const version of set.versions) {
      validateComponentSetSnapshot(version, library, set.id);
      if (version.revision <= previousRevision || version.revision > library.revision) fail(`Component set “${set.id}” revisions must increase and not exceed the library revision.`);
      previousRevision = version.revision;
    }
  }
  return true;
}

function validateComponentMetadata(publication) {
  if (publication.componentSetId != null) validIdentity(publication.componentSetId, 'Component set ID');
  if (publication.variantProperties != null) {
    if (!publication.componentSetId || !publication.variantProperties || typeof publication.variantProperties !== 'object' || Array.isArray(publication.variantProperties)) fail('Variant properties require a component set and must be an object.');
    assertJsonValue(publication.variantProperties, 'Variant properties');
    for (const [name, value] of Object.entries(publication.variantProperties)) {
      validName(name, 'Variant property name');
      validName(value, `Variant value for ${name}`);
    }
  }
  if (publication.componentProperties != null) {
    if (!Array.isArray(publication.componentProperties) || publication.componentProperties.length > 100) fail('Component property definitions must be a list of at most 100 items.');
    const ids = new Set();
    for (const property of publication.componentProperties) {
      if (!property || typeof property !== 'object' || Array.isArray(property)) fail('Invalid component property definition.');
      validIdentity(property.id, 'Component property ID');
      validName(property.name, 'Component property name');
      validIdentity(property.type, 'Component property type');
      validIdentity(property.targetSourceId, 'Component property target source ID');
      if (ids.has(property.id)) fail(`Duplicate component property ID “${property.id}”.`);
      ids.add(property.id);
      if (!['BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'SLOT'].includes(property.type)) fail(`Unsupported component property type “${property.type}”.`);
      assertJsonValue(property.defaultValue, `Default value for component property “${property.name}”`);
      if (property.preferredComponentIds != null && (!Array.isArray(property.preferredComponentIds) || property.preferredComponentIds.some(id => typeof id !== 'string'))) fail(`Invalid preferred component IDs for “${property.name}”.`);
      if (Object.keys(property).some(key => !['id', 'name', 'type', 'targetSourceId', 'defaultValue', 'preferredComponentIds'].includes(key))) fail(`Unknown field in component property “${property.name}”.`);
    }
  }
}

function validateComponentSetSnapshot(snapshot, library, setId) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || snapshot.libraryId !== library.id || snapshot.componentSetId !== setId) fail('Component set publication identity does not match its library and set.');
  validRevision(snapshot.revision, 'Component set publication revision');
  validName(snapshot.name, 'Published component set name');
  if (!Array.isArray(snapshot.componentIds) || snapshot.componentIds.length < 2 || new Set(snapshot.componentIds).size !== snapshot.componentIds.length) fail('A published component set must contain at least two unique component IDs.');
  if (!Array.isArray(snapshot.properties) || !snapshot.properties.length) fail('A published component set must define at least one variant axis.');
  const propertyNames = new Set();
  for (const property of snapshot.properties) {
    if (!property || typeof property !== 'object' || Array.isArray(property)) fail('Invalid component variant axis.');
    validName(property.name, 'Variant axis name');
    if (propertyNames.has(property.name)) fail(`Duplicate variant axis “${property.name}”.`);
    propertyNames.add(property.name);
    if (!Array.isArray(property.values) || !property.values.length || new Set(property.values).size !== property.values.length) fail(`Variant axis “${property.name}” must contain unique values.`);
    for (const value of property.values) validName(value, `Variant value for ${property.name}`);
  }
  const combinations = new Set();
  for (const componentId of snapshot.componentIds) {
    validIdentity(componentId, 'Variant component ID');
    const record = componentRecord(library, componentId);
    // A later set snapshot must be checked against each member's publication
    // as of that snapshot, while older set snapshots continue to resolve to
    // the historical version that existed at their own revision.
    const version = record?.versions.filter(item => item.revision <= snapshot.revision && item.componentSetId === setId).at(-1);
    if (!version) fail(`Published variant “${componentId}” is missing from component set “${setId}”.`);
    const values = version.variantProperties || {};
    if (snapshot.properties.some(property => !property.values.includes(values[property.name]))) fail(`Published variant “${componentId}” has a value outside its component set axes.`);
    const key = JSON.stringify(snapshot.properties.map(property => values[property.name]));
    if (combinations.has(key)) fail(`Component set “${setId}” contains duplicate variant combinations.`);
    combinations.add(key);
  }
}

function componentRecord(library, componentId) {
  return library.components.find(component => component.id === componentId) || null;
}

function latestPublication(library, componentId) {
  const record = componentRecord(library, componentId);
  return record?.versions.at(-1) || null;
}

function validateOverrides(root, overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail('Instance overrides must be an object keyed by source layer ID.');
  assertJsonValue(overrides, 'Instance overrides');
  const layers = collectSourceLayers(root);
  for (const [sourceLayerId, properties] of Object.entries(overrides)) {
    if (!layers.has(sourceLayerId)) fail(`Override refers to missing source layer “${sourceLayerId}”.`);
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) fail(`Overrides for “${sourceLayerId}” must be a property object.`);
    for (const property of Object.keys(properties)) {
      if (!property || RESERVED_OVERRIDE_PROPERTIES.has(property)) fail(`Property “${property}” cannot be overridden.`);
    }
  }
  return layers;
}

function buildResolvedRoot(root, overrides) {
  const next = clone(root);
  const apply = node => {
    const local = overrides[node.id];
    if (local) Object.assign(node, clone(local));
    for (const child of node.children || []) apply(child);
  };
  apply(next);
  return next;
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sourceLayerChanges(previousRoot, nextRoot) {
  const previousLayers = collectSourceLayers(previousRoot);
  const nextLayers = collectSourceLayers(nextRoot);
  const addedSourceLayers = [];
  const removedSourceLayers = [];
  const changedSourceLayers = [];

  for (const [sourceLayerId, entry] of previousLayers) {
    const next = nextLayers.get(sourceLayerId);
    if (!next) {
      removedSourceLayers.push({ sourceLayerId, name: entry.node.name || '', type: entry.node.type });
      continue;
    }
    const changedProperties = new Set();
    const properties = new Set([...Object.keys(entry.node), ...Object.keys(next.node)]);
    properties.delete('id');
    properties.delete('children');
    for (const property of properties) {
      if (stableValue(entry.node[property]) !== stableValue(next.node[property])) changedProperties.add(property);
    }
    if (entry.parentSourceLayerId !== next.parentSourceLayerId) changedProperties.add('parentSourceLayerId');
    if (entry.childIndex !== next.childIndex) changedProperties.add('childIndex');
    if (changedProperties.size) {
      changedSourceLayers.push({
        sourceLayerId,
        name: next.node.name || entry.node.name || '',
        beforeType: entry.node.type,
        afterType: next.node.type,
        changedProperties: [...changedProperties].sort()
      });
    }
  }
  for (const [sourceLayerId, entry] of nextLayers) {
    if (!previousLayers.has(sourceLayerId)) addedSourceLayers.push({ sourceLayerId, name: entry.node.name || '', type: entry.node.type });
  }
  return { addedSourceLayers, removedSourceLayers, changedSourceLayers };
}

function propertyState(node, property) {
  return Object.hasOwn(node, property)
    ? { present: true, value: clone(node[property]) }
    : { present: false, value: null };
}

function samePropertyState(left, right) {
  return left.present === right.present
    && (!left.present || stableValue(left.value) === stableValue(right.value));
}

/** Create an empty library. IDs are caller supplied so identity is stable across persistence. */
export function createComponentLibrary({ id, name }) {
  const library = {
    schema: COMPONENT_LIBRARY_SCHEMA,
    id: validIdentity(id, 'Library ID'),
    name: validName(name, 'Library name'),
    revision: 0,
    components: [],
    componentSets: [],
    designTokens: { schema: COMPONENT_DESIGN_TOKENS_SCHEMA, collections: [], variables: [] }
  };
  return deepFreeze(library);
}

/**
 * Publish a component snapshot and return a new library plus its immutable
 * publication. Re-publishing an existing component keeps its identity and
 * appends a monotonically increasing, library-wide revision.
 */
export function publishComponent(library, input = {}) {
  const options = input && typeof input === 'object' ? input : {};
  const { componentId, name, root } = options;
  assertLibrary(library);
  validIdentity(componentId, 'Component ID');
  validName(name, 'Component name');
  assertJsonValue(root, `Component “${componentId}”`);
  collectSourceLayers(root, `Component “${componentId}”`);
  // Publishing an existing library component through the regular editor
  // action sends only its identity, name, and root. Carry its structural
  // metadata forward so a content revision cannot silently detach a variant
  // or erase its component property definitions.
  const previous = latestPublication(library, componentId);
  const componentSetId = Object.hasOwn(options, 'componentSetId') ? options.componentSetId : previous?.componentSetId;
  const variantProperties = Object.hasOwn(options, 'variantProperties') ? options.variantProperties : previous?.variantProperties;
  const componentProperties = Object.hasOwn(options, 'componentProperties') ? options.componentProperties : previous?.componentProperties;
  const metadata = {};
  if (componentSetId != null) metadata.componentSetId = componentSetId;
  if (variantProperties != null) metadata.variantProperties = variantProperties;
  if (componentProperties != null) metadata.componentProperties = componentProperties;
  validateComponentMetadata(metadata);
  const sourceLayers = collectSourceLayers(root, `Component “${componentId}”`);
  for (const property of metadata.componentProperties || []) {
    if (!sourceLayers.has(property.targetSourceId)) fail(`Component property “${property.name}” refers to a missing source layer.`);
  }

  const revision = library.revision + 1;
  if (!Number.isSafeInteger(revision)) fail('The library revision limit has been reached.');
  const publication = immutableClone({
    libraryId: library.id,
    componentId,
    revision,
    name: name.trim(),
    root,
    ...metadata
  });
  const nextComponents = clone(library.components);
  const existingIndex = nextComponents.findIndex(component => component.id === componentId);
  if (existingIndex < 0) nextComponents.push({ id: componentId, versions: [clone(publication)] });
  else nextComponents[existingIndex].versions.push(clone(publication));

  const publicationTokens = options.designTokens ?? root[COMPONENT_PUBLICATION_TOKENS]
    ?? (previous ? undefined : null);
  const designTokens = mergeComponentDesignTokens(library.designTokens, publicationTokens);
  const nextLibrary = deepFreeze({
    ...clone(library), revision, components: nextComponents, componentSets: clone(library.componentSets || []),
    ...(designTokens ? { designTokens } : {})
  });
  assertLibrary(nextLibrary);
  return { library: nextLibrary, publication };
}

/**
 * Publish a complete component set in one immutable library result. Each
 * variant gets its own component revision; the set snapshot is stamped with
 * the final revision and records its axes and member identities.
 */
export function publishComponentSet(library, { componentSetId, name, properties, variants }) {
  assertLibrary(library);
  validIdentity(componentSetId, 'Component set ID');
  validName(name, 'Component set name');
  if (!Array.isArray(variants) || variants.length < 2) fail('A component set must contain at least two variants.');
  if (!Array.isArray(properties) || !properties.length) fail('A component set must define at least one variant axis.');

  const axes = clone(properties);
  const axisNames = new Set();
  for (const axis of axes) {
    if (!axis || typeof axis !== 'object' || Array.isArray(axis)) fail('Invalid component variant axis.');
    validName(axis.name, 'Variant axis name');
    if (axisNames.has(axis.name)) fail(`Duplicate variant axis “${axis.name}”.`);
    axisNames.add(axis.name);
    if (!Array.isArray(axis.values) || !axis.values.length || new Set(axis.values).size !== axis.values.length) fail(`Variant axis “${axis.name}” must contain unique values.`);
    for (const value of axis.values) validName(value, `Variant value for ${axis.name}`);
  }
  const ids = new Set();
  const combinations = new Set();
  for (const variant of variants) {
    if (!variant || typeof variant !== 'object' || Array.isArray(variant)) fail('Invalid component variant.');
    validIdentity(variant.componentId, 'Component ID');
    if (ids.has(variant.componentId)) fail(`Duplicate variant component ID “${variant.componentId}”.`);
    ids.add(variant.componentId);
    if (!variant.variantProperties || typeof variant.variantProperties !== 'object' || Array.isArray(variant.variantProperties)) fail(`Variant “${variant.componentId}” must specify its axis values.`);
    const keys = Object.keys(variant.variantProperties).sort();
    if (stableValue(keys) !== stableValue([...axisNames].sort())) fail(`Variant “${variant.componentId}” must define exactly the component set axes.`);
    for (const axis of axes) if (!axis.values.includes(variant.variantProperties[axis.name])) fail(`Variant “${variant.componentId}” has an unknown value for axis “${axis.name}”.`);
    const combination = JSON.stringify(axes.map(axis => variant.variantProperties[axis.name]));
    if (combinations.has(combination)) fail('Component set variants must have unique axis combinations.');
    combinations.add(combination);
    const existing = latestPublication(library, variant.componentId);
    if (existing?.componentSetId && existing.componentSetId !== componentSetId) fail(`Component “${variant.componentId}” already belongs to another published set.`);
  }

  let next = library;
  const publications = [];
  for (const variant of variants) {
    const result = publishComponent(next, {
      componentId: variant.componentId,
      name: variant.name,
      root: variant.root,
      componentSetId,
      variantProperties: variant.variantProperties,
      ...(variant.componentProperties == null ? {} : { componentProperties: variant.componentProperties })
    });
    next = result.library;
    publications.push(result.publication);
  }
  const setSnapshot = immutableClone({
    libraryId: library.id,
    componentSetId,
    revision: next.revision,
    name: name.trim(),
    componentIds: variants.map(variant => variant.componentId),
    properties: axes
  });
  const componentSets = clone(next.componentSets || []);
  const index = componentSets.findIndex(set => set.id === componentSetId);
  if (index < 0) componentSets.push({ id: componentSetId, versions: [clone(setSnapshot)] });
  else componentSets[index].versions.push(clone(setSnapshot));
  const nextLibrary = deepFreeze({ ...clone(next), componentSets });
  assertLibrary(nextLibrary);
  return { library: nextLibrary, publication: setSnapshot, publications };
}

/** Validate a library; returns true or throws a TypeError describing the invalid field. */
export function validateComponentLibrary(library) {
  return assertLibrary(library);
}

/**
 * Create an immutable local link record pinned to the latest published
 * snapshot. Overrides are keyed by stable source layer ID.
 */
export function createLinkedInstanceSnapshot(library, componentId, { instanceId, overrides = {} } = {}) {
  assertLibrary(library);
  validIdentity(instanceId, 'Instance ID');
  const publication = latestPublication(library, componentId);
  if (!publication) fail(`Published component “${componentId}” does not exist in this library.`);
  validateOverrides(publication.root, overrides);
  const sourceSnapshot = immutableClone(publication);
  const linkedTokens = referencedComponentDesignTokens(library.designTokens, publication.root);
  return deepFreeze({
    schema: LINKED_INSTANCE_SCHEMA,
    id: instanceId,
    libraryId: library.id,
    componentId,
    sourceRevision: publication.revision,
    sourceSnapshot,
    overrides: clone(overrides),
    root: buildResolvedRoot(sourceSnapshot.root, overrides),
    ...(linkedTokens ? { designTokens: linkedTokens } : {})
  });
}

function assertLinkedInstance(instance) {
  if (!instance || typeof instance !== 'object' || Array.isArray(instance) || instance.schema !== LINKED_INSTANCE_SCHEMA) {
    fail('Invalid linked component instance schema.');
  }
  validIdentity(instance.id, 'Instance ID');
  validIdentity(instance.libraryId, 'Library ID');
  validIdentity(instance.componentId, 'Component ID');
  validRevision(instance.sourceRevision, 'Instance source revision');
  const publication = instance.sourceSnapshot;
  if (!publication || publication.libraryId !== instance.libraryId || publication.componentId !== instance.componentId
    || publication.revision !== instance.sourceRevision) fail('Instance source snapshot identity or revision does not match the link.');
  assertJsonValue(publication, 'Instance source snapshot');
  collectSourceLayers(publication.root, 'Instance source snapshot');
  validateOverrides(publication.root, instance.overrides);
  assertJsonValue(instance.root, 'Resolved instance root');
  collectSourceLayers(instance.root, 'Resolved instance root');
  if (instance.designTokens != null) assertComponentDesignTokens(instance.designTokens, 'linked instance design tokens');
  if (stableValue(instance.root) !== stableValue(buildResolvedRoot(publication.root, instance.overrides))) {
    fail('Resolved instance root does not match its source snapshot and overrides.');
  }
  return true;
}

/** Validate a linked snapshot; returns true or throws a TypeError. */
export function validateLinkedInstanceSnapshot(instance) {
  return assertLinkedInstance(instance);
}

/**
 * Update a link from a newer library publication. Compatible overrides are
 * retained when their stable source layer still exists with the same layer
 * type. Removed layers and type changes are reported and their overrides are
 * dropped. Source-property changes are reported even when overridden locally.
 */
export function updateLinkedInstanceSnapshot(instance, library) {
  assertLinkedInstance(instance);
  assertLibrary(library);
  if (instance.libraryId !== library.id) fail('Cannot update an instance from a different library.');
  const record = componentRecord(library, instance.componentId);
  const recordedSource = record?.versions.find(version => version.revision === instance.sourceRevision);
  if (!recordedSource || stableValue(recordedSource) !== stableValue(instance.sourceSnapshot)) {
    fail('The linked instance source revision does not match this library history.');
  }
  const publication = latestPublication(library, instance.componentId);
  if (!publication) fail(`Linked component “${instance.componentId}” was removed from the library.`);
  if (publication.revision <= instance.sourceRevision) fail('The library has no newer component revision for this instance.');

  const beforeLayers = collectSourceLayers(instance.sourceSnapshot.root);
  const afterLayers = collectSourceLayers(publication.root);
  const nextOverrides = {};
  const preservedOverrides = [];
  const droppedOverrides = [];
  const conflictingOverrides = [];
  for (const [sourceLayerId, properties] of Object.entries(instance.overrides)) {
    const before = beforeLayers.get(sourceLayerId);
    const after = afterLayers.get(sourceLayerId);
    if (!after) {
      droppedOverrides.push({ sourceLayerId, reason: 'removed-source-layer', properties: Object.keys(properties).sort() });
      continue;
    }
    if (!before || before.node.type !== after.node.type) {
      droppedOverrides.push({
        sourceLayerId,
        reason: 'incompatible-source-layer-type',
        beforeType: before?.node.type || null,
        afterType: after.node.type,
        properties: Object.keys(properties).sort()
      });
      continue;
    }
    nextOverrides[sourceLayerId] = clone(properties);
    preservedOverrides.push({ sourceLayerId, properties: Object.keys(properties).sort() });

    const conflicts = [];
    for (const property of Object.keys(properties).sort()) {
      const baseValue = propertyState(before.node, property);
      const sourceValue = propertyState(after.node, property);
      const instanceValue = { present: true, value: clone(properties[property]) };
      const sourceChanged = !samePropertyState(baseValue, sourceValue);
      const instanceChanged = !samePropertyState(baseValue, instanceValue);
      if (sourceChanged && instanceChanged && !samePropertyState(sourceValue, instanceValue)) {
        conflicts.push({ property, base: baseValue, source: sourceValue, instance: instanceValue });
      }
    }
    if (conflicts.length) {
      conflictingOverrides.push({
        sourceLayerId,
        name: after.node.name || before.node.name || '',
        properties: conflicts
      });
    }
  }

  const changes = sourceLayerChanges(instance.sourceSnapshot.root, publication.root);
  const updatedTokens = referencedComponentDesignTokens(library.designTokens, publication.root);
  const updated = deepFreeze({
    schema: LINKED_INSTANCE_SCHEMA,
    id: instance.id,
    libraryId: library.id,
    componentId: instance.componentId,
    sourceRevision: publication.revision,
    sourceSnapshot: immutableClone(publication),
    overrides: nextOverrides,
    root: buildResolvedRoot(publication.root, nextOverrides),
    ...(updatedTokens ? { designTokens: updatedTokens } : {})
  });
  const report = deepFreeze({
    fromRevision: instance.sourceRevision,
    toRevision: publication.revision,
    ...changes,
    preservedOverrides,
    droppedOverrides,
    conflictingOverrides: conflictingOverrides.sort((left, right) => left.sourceLayerId.localeCompare(right.sourceLayerId))
  });
  return { instance: updated, report };
}
