/**
 * Pure local component-library primitives.
 *
 * This module deliberately does not access the editor model, IndexedDB, or the
 * DOM. Callers publish serializable layer trees, persist the returned library,
 * and decide how to map source layer IDs to live editor node IDs.
 */

export const COMPONENT_LIBRARY_SCHEMA = 'tiny-image-star/component-library/1';
export const LINKED_INSTANCE_SCHEMA = 'tiny-image-star/linked-component-instance/1';

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
      assertJsonValue(publication.root, `Published component “${component.id}”`);
      collectSourceLayers(publication.root, `Published component “${component.id}”`);
    }
  }
  if (publicationRevisions.size !== library.revision
    || Array.from({ length: library.revision }, (_, index) => index + 1).some(revision => !publicationRevisions.has(revision))) {
    fail('Library publication revisions must cover every revision from 1 through the library revision.');
  }
  return true;
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

/** Create an empty library. IDs are caller supplied so identity is stable across persistence. */
export function createComponentLibrary({ id, name }) {
  const library = {
    schema: COMPONENT_LIBRARY_SCHEMA,
    id: validIdentity(id, 'Library ID'),
    name: validName(name, 'Library name'),
    revision: 0,
    components: []
  };
  return deepFreeze(library);
}

/**
 * Publish a component snapshot and return a new library plus its immutable
 * publication. Re-publishing an existing component keeps its identity and
 * appends a monotonically increasing, library-wide revision.
 */
export function publishComponent(library, { componentId, name, root }) {
  assertLibrary(library);
  validIdentity(componentId, 'Component ID');
  validName(name, 'Component name');
  assertJsonValue(root, `Component “${componentId}”`);
  collectSourceLayers(root, `Component “${componentId}”`);

  const revision = library.revision + 1;
  if (!Number.isSafeInteger(revision)) fail('The library revision limit has been reached.');
  const publication = immutableClone({
    libraryId: library.id,
    componentId,
    revision,
    name: name.trim(),
    root
  });
  const nextComponents = clone(library.components);
  const existingIndex = nextComponents.findIndex(component => component.id === componentId);
  if (existingIndex < 0) nextComponents.push({ id: componentId, versions: [clone(publication)] });
  else nextComponents[existingIndex].versions.push(clone(publication));

  const nextLibrary = deepFreeze({ ...clone(library), revision, components: nextComponents });
  assertLibrary(nextLibrary);
  return { library: nextLibrary, publication };
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
  return deepFreeze({
    schema: LINKED_INSTANCE_SCHEMA,
    id: instanceId,
    libraryId: library.id,
    componentId,
    sourceRevision: publication.revision,
    sourceSnapshot,
    overrides: clone(overrides),
    root: buildResolvedRoot(sourceSnapshot.root, overrides)
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
  }

  const changes = sourceLayerChanges(instance.sourceSnapshot.root, publication.root);
  const updated = deepFreeze({
    schema: LINKED_INSTANCE_SCHEMA,
    id: instance.id,
    libraryId: library.id,
    componentId: instance.componentId,
    sourceRevision: publication.revision,
    sourceSnapshot: immutableClone(publication),
    overrides: nextOverrides,
    root: buildResolvedRoot(publication.root, nextOverrides)
  });
  const report = deepFreeze({
    fromRevision: instance.sourceRevision,
    toRevision: publication.revision,
    ...changes,
    preservedOverrides,
    droppedOverrides
  });
  return { instance: updated, report };
}
