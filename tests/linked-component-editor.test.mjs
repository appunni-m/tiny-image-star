import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, addVariableMode, bindColorVariable, createColorStyle, createColorVariable, createDocument, createNode,
  createVariableCollection, deleteVariable, getNodeColor, setColorVariableValue, setFrameVariableMode, validateDocument
} from '../src/model.js';
import {
  componentTokenIdentityId, createComponentLibrary, createLinkedInstanceSnapshot, publishComponent, updateLinkedInstanceSnapshot
} from '../src/component-library.js';
import {
  applyLinkedComponentUpdate, componentTreeForPublication, createLinkedEditorInstance,
  recordLinkedComponentOverride, withLinkedComponentOverride
} from '../src/linked-component-editor.js';

function sourceTree({ title = 'Default', fontSize = 18, includeBadge = false } = {}) {
  return {
    id: 'source-card', type: 'frame', name: 'Card', x: 20, y: 30, width: 240, height: 120, rotation: 0, opacity: 1,
    fill: '#ffffff', children: [
      { id: 'source-title', type: 'text', name: 'Title', x: 12, y: 12, width: 210, height: 32, rotation: 0, opacity: 1, text: title, fontSize, children: [] },
      ...(includeBadge ? [{ id: 'source-badge', type: 'rectangle', name: 'Badge', x: 12, y: 60, width: 90, height: 24, rotation: 0, opacity: 1, fill: '#ffcc00', children: [] }] : [])
    ]
  };
}

function makeLibrary() {
  return publishComponent(createComponentLibrary({ id: 'library-kit', name: 'Kit' }), {
    componentId: 'component-card', name: 'Card', root: sourceTree()
  }).library;
}

test('publication adapter copies visual layers while excluding editor-local component and token links', () => {
  const root = sourceTree();
  root.isComponent = true;
  root.componentId = 'document-component';
  root.publishedLibraryRefs = [{ libraryId: 'library-kit', componentId: 'component-card' }];
  root.fillVariableId = 'local-token';
  root.children[0].textStyleId = 'local-style';
  root.children[0].variableBindings = { fontSize: 'local-token' };

  const portable = componentTreeForPublication(root);
  assert.equal(portable.id, 'source-card');
  assert.equal(portable.children[0].id, 'source-title');
  assert.equal(portable.isComponent, undefined);
  assert.equal(portable.componentId, undefined);
  assert.equal(portable.publishedLibraryRefs, undefined);
  assert.equal(portable.fillVariableId, undefined);
  assert.equal(portable.children[0].textStyleId, undefined);
  assert.equal(portable.children[0].variableBindings, undefined);
  assert.equal(root.componentId, 'document-component', 'publishing does not mutate the main component');
});

test('linked editor instances use distinct IDs, keep source identity, and retain placement through a compatible update', () => {
  const document = createDocument();
  const library = makeLibrary();
  const initial = createLinkedInstanceSnapshot(library, 'component-card', { instanceId: 'link-card' });
  let serial = 0;
  const instance = createLinkedEditorInstance(initial, {
    x: 350, y: 410, document, makeNodeId: type => `${type}-instance-${++serial}`
  });
  addNode(document, instance);
  validateDocument(document);

  assert.equal(instance.id, 'frame-instance-1');
  assert.equal(instance.componentSourceId, 'source-card');
  assert.equal(instance.children[0].componentSourceId, 'source-title');
  assert.notEqual(instance.children[0].id, 'source-title');
  assert.equal(instance.x, 350);
  assert.equal(instance.y, 410);

  instance.children[0].text = 'My local title';
  instance.linkedComponent = withLinkedComponentOverride(initial, 'source-title', 'text', 'My local title');
  const newerLibrary = publishComponent(library, {
    componentId: 'component-card', name: 'Card', root: sourceTree({ title: 'New default', fontSize: 21, includeBadge: true })
  }).library;
  const updated = updateLinkedInstanceSnapshot(instance.linkedComponent, newerLibrary);
  applyLinkedComponentUpdate(instance, updated.instance, {
    document, makeNodeId: type => `${type}-instance-${++serial}`
  });
  validateDocument(document);

  assert.equal(instance.x, 350);
  assert.equal(instance.y, 410);
  assert.equal(instance.children[0].id, 'text-instance-2', 'compatible layer IDs remain stable across updates');
  assert.equal(instance.children[0].text, 'My local title', 'compatible local text is preserved');
  assert.equal(instance.children[0].fontSize, 21, 'unmodified source properties receive the new revision');
  assert.equal(instance.children[1].componentSourceId, 'source-badge', 'new source layers appear in the instance');
  assert.equal(instance.linkedComponent.sourceRevision, 2);
});

test('linked editor instances remap internal prototype scroll targets to their new layer IDs', () => {
  const root = sourceTree();
  const scroller = { id: 'source-scroll-frame', type: 'frame', name: 'Scrollable content', x: 0, y: 0, width: 200, height: 120, rotation: 0, opacity: 1, overflowBehavior: 'vertical', children: [] };
  const hotspot = { id: 'source-scroll-hotspot', type: 'rectangle', name: 'Jump link', x: 0, y: 0, width: 40, height: 20, rotation: 0, opacity: 1, children: [], interactions: [
    { id: 'source-scroll-interaction', action: 'scroll-to', trigger: 'on-click', scrollTargetId: 'source-scroll-target', scrollAlignment: 'end', transition: 'scroll', duration: 300 }
  ] };
  const target = { id: 'source-scroll-target', type: 'rectangle', name: 'Anchor', x: 0, y: 350, width: 80, height: 24, rotation: 0, opacity: 1, children: [] };
  scroller.children.push(hotspot, target);
  root.children.push(scroller);
  const library = publishComponent(createComponentLibrary({ id: 'scroll-library', name: 'Scroll library' }), {
    componentId: 'component-scroll', name: 'Scrollable card', root
  }).library;
  const snapshot = createLinkedInstanceSnapshot(library, 'component-scroll', { instanceId: 'scroll-card' });
  const document = createDocument();
  let serial = 0;
  const instance = createLinkedEditorInstance(snapshot, {
    document, makeNodeId: type => `${type}-scroll-instance-${++serial}`
  });
  addNode(document, instance);

  const copiedScroller = instance.children.find(node => node.componentSourceId === scroller.id);
  const copiedHotspot = copiedScroller.children.find(node => node.componentSourceId === hotspot.id);
  const copiedTarget = copiedScroller.children.find(node => node.componentSourceId === target.id);
  assert.notEqual(copiedTarget.id, target.id);
  assert.equal(copiedHotspot.interactions[0].scrollTargetId, copiedTarget.id);
  assert.equal(validateDocument(document), true);
});

test('document validation rejects malformed local component snapshots and source mappings', () => {
  const library = makeLibrary();
  const snapshot = createLinkedInstanceSnapshot(library, 'component-card', { instanceId: 'invalid-link' });
  const document = createDocument();
  const instance = createLinkedEditorInstance(snapshot, { document, makeNodeId: type => `${type}-valid` });
  addNode(document, instance);
  assert.equal(validateDocument(document), true);

  const missingSource = structuredClone(instance);
  missingSource.linkedComponent.sourceSnapshot = null;
  const invalidSnapshot = createDocument();
  addNode(invalidSnapshot, missingSource);
  assert.throws(() => validateDocument(invalidSnapshot), /Invalid local component link/);

  const missingLayerMapping = structuredClone(instance);
  missingLayerMapping.children[0].componentSourceId = 'unknown-source-layer';
  const invalidMapping = createDocument();
  addNode(invalidMapping, missingLayerMapping);
  assert.throws(() => validateDocument(invalidMapping), /source-layer mapping/);
});

test('republishing a linked mask remaps editor IDs back to stable library source IDs', () => {
  const document = createDocument();
  const mask = createNode('path', {
    name: 'Mask shape', closed: true,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
  });
  const content = createNode('rectangle', { name: 'Masked content', x: 0, y: 0, width: 100, height: 100 });
  const group = createNode('group', { name: 'Masked component', mask: true, maskSourceId: mask.id });
  addNode(document, group);
  addNode(document, mask, { parentId: group.id });
  addNode(document, content, { parentId: group.id });
  validateDocument(document);

  let serial = 0;
  const library = publishComponent(createComponentLibrary({ id: 'library-mask', name: 'Mask library' }), {
    componentId: 'component-mask', name: 'Masked component', root: structuredClone(group)
  }).library;
  const firstSnapshot = createLinkedInstanceSnapshot(library, 'component-mask', { instanceId: 'linked-mask-one' });
  const first = createLinkedEditorInstance(firstSnapshot, { document, makeNodeId: type => `first-${type}-${++serial}` });
  addNode(document, first);
  validateDocument(document);

  const republishedRoot = componentTreeForPublication(first, { useSourceIds: true, document });
  assert.equal(republishedRoot.maskSourceId, republishedRoot.children[0].id);
  const nextLibrary = publishComponent(library, {
    componentId: 'component-mask', name: 'Masked component', root: republishedRoot
  }).library;
  const nextSnapshot = createLinkedInstanceSnapshot(nextLibrary, 'component-mask', { instanceId: 'linked-mask-two' });
  const second = createLinkedEditorInstance(nextSnapshot, { document, makeNodeId: type => `second-${type}-${++serial}` });
  addNode(document, second);
  assert.equal(validateDocument(document), true);
});

test('publishing a linked tree assigns stable IDs to newly added editor layers', () => {
  const library = makeLibrary();
  const snapshot = createLinkedInstanceSnapshot(library, 'component-card', { instanceId: 'link-new-child' });
  let serial = 0;
  const instance = createLinkedEditorInstance(snapshot, { makeNodeId: type => `${type}-${++serial}` });
  instance.children.push({ id: 'local-added-child', type: 'rectangle', name: 'Added', children: [] });
  const portable = componentTreeForPublication(instance, {
    useSourceIds: true,
    createSourceId: () => 'stable-added-source'
  });
  assert.equal(portable.children.at(-1).id, 'stable-added-source');
  assert.equal(instance.children.at(-1).componentSourceId, 'stable-added-source');
  assert.equal(portable.linkedComponent, undefined);
  assert.equal(instance.linkedComponent.sourceRevision, 1);
});

test('recording a linked property edit updates only that snapshot layer and remains update-valid', () => {
  const snapshot = structuredClone(createLinkedInstanceSnapshot(makeLibrary(), 'component-card', { instanceId: 'link-edit' }));
  const rootBefore = snapshot.root;
  recordLinkedComponentOverride(snapshot, 'source-title', 'text', 'Local');
  assert.equal(snapshot.root.children[0].text, 'Local');
  assert.equal(snapshot.overrides['source-title'].text, 'Local');
  assert.equal(snapshot.root, rootBefore, 'pointer-time edits mutate the existing materialized tree instead of cloning it');
  const next = publishComponent(makeLibrary(), {
    componentId: 'component-card', name: 'Card', root: sourceTree({ title: 'New default' })
  }).library;
  const updated = updateLinkedInstanceSnapshot(snapshot, next);
  assert.equal(updated.instance.root.children[0].text, 'Local');
});

test('linked override helpers reject editor-owned and prototype-mutating fields consistently', () => {
  const initial = createLinkedInstanceSnapshot(makeLibrary(), 'component-card', { instanceId: 'link-safe-overrides' });
  const reserved = ['id', 'type', 'children', 'componentSourceId', 'linkedComponent', '__proto__'];

  for (const property of reserved) {
    const before = structuredClone(initial);
    assert.throws(() => withLinkedComponentOverride(initial, 'source-title', property, 'unsafe'), /supported source property/);
    assert.deepEqual(initial, before, `immutable override rejects ${property} without touching the input`);

    const mutable = structuredClone(initial);
    const originalPrototype = Object.getPrototypeOf(mutable.overrides);
    assert.throws(() => recordLinkedComponentOverride(mutable, 'source-title', property, 'unsafe'), /supported source property/);
    assert.deepEqual(mutable, before, `pointer-time override rejects ${property} without changing snapshot data`);
    assert.equal(Object.getPrototypeOf(mutable.overrides), originalPrototype, 'rejected edits never alter override-map prototypes');
  }
});

test('recordLinkedComponentOverride ignores inherited override-map entries when creating a local entry', () => {
  const snapshot = structuredClone(createLinkedInstanceSnapshot(makeLibrary(), 'component-card', { instanceId: 'link-own-overrides' }));
  const inherited = { 'source-title': { text: 'inherited value' } };
  snapshot.overrides = Object.assign(Object.create(inherited), snapshot.overrides);

  recordLinkedComponentOverride(snapshot, 'source-title', 'text', 'Local value');

  assert.equal(Object.hasOwn(snapshot.overrides, 'source-title'), true);
  assert.equal(snapshot.overrides['source-title'].text, 'Local value');
  assert.equal(inherited['source-title'].text, 'inherited value', 'writing an override must never mutate a prototype entry');
  assert.equal(snapshot.root.children[0].text, 'Local value');
});

test('cross-design publication keeps source tokens portable while materializing local styles', () => {
  const sourceDocument = createDocument();
  const collection = createVariableCollection(sourceDocument, 'Brand colors');
  const accent = createColorVariable(sourceDocument, collection.id, 'Accent', '#2563eb');
  const root = createNode('frame', { name: 'Portable card' });
  const surface = createNode('rectangle', { fill: '#ffffff' });
  const label = createNode('text', { text: 'Continue', color: '#111111' });
  addNode(sourceDocument, root); addNode(sourceDocument, surface, { parentId: root.id }); addNode(sourceDocument, label, { parentId: root.id });
  assert.equal(bindColorVariable(sourceDocument, surface.id, accent.id, 'fill'), true);
  const textStyle = createColorStyle(sourceDocument, label.id, 'Brand label');
  root.interactions = [{ id: 'mode-route', action: 'set-variable-mode', trigger: 'on-click', collectionId: collection.id, modeId: collection.defaultModeId }];
  const portable = componentTreeForPublication(root, { document: sourceDocument });
  assert.equal(portable.children[0].fill, '#2563eb');
  assert.equal(typeof portable.children[0].fillVariableId, 'string', 'the published layer keeps a stable token reference');
  assert.equal(portable.children[1].color, textStyle.value);
  assert.equal(portable.children[1].textStyleId, undefined);
  assert.equal(portable.interactions, undefined, 'document-local variable mode interactions are not copied into an unrelated design');

  const library = publishComponent(createComponentLibrary({ id: 'library-portable', name: 'Portable kit' }), {
    componentId: 'component-portable', name: 'Portable card', root: portable
  }).library;
  const destination = createDocument();
  const instance = createLinkedEditorInstance(
    createLinkedInstanceSnapshot(library, 'component-portable', { instanceId: 'portable-link' }),
    { document: destination }
  );
  addNode(destination, instance);
  assert.equal(validateDocument(destination), true, 'the destination design saves with locally mapped tokens and no source color style');
  assert.equal(instance.children[0].fill, '#2563eb');
  assert.ok(instance.children[0].fillVariableId, 'the destination receives a local token binding');
  assert.equal(getNodeColor(destination, instance.children[0], 'fill'), '#2563eb');
});

test('published tokens preserve stable identities, alias and mode bindings, collision-safe destination mapping, and updates', () => {
  const source = createDocument();
  const collection = createVariableCollection(source, 'Brand');
  const dark = addVariableMode(source, collection.id, 'Dark');
  const brand = createColorVariable(source, collection.id, 'Brand accent', '#2463eb');
  const alias = createColorVariable(source, collection.id, 'Action', '#2463eb');
  alias.aliasesByMode = Object.fromEntries(collection.modes.map(mode => [mode.id, brand.id]));
  const unused = createColorVariable(source, collection.id, 'Private unused token', '#ae00ff');
  const root = createNode('frame', { name: 'Token card', width: 240, height: 100 });
  const button = createNode('rectangle', { name: 'Button', fill: '#ffffff', width: 120, height: 48 });
  addNode(source, root);
  addNode(source, button, { parentId: root.id });
  assert.equal(bindColorVariable(source, button.id, alias.id, 'fill'), true);
  assert.equal(setColorVariableValue(source, brand.id, '#d946ef', dark.id), true);
  assert.equal(setFrameVariableMode(source, root.id, collection.id, dark.id), true);
  assert.equal(getNodeColor(source, button, 'fill'), '#d946ef');

  const portable = componentTreeForPublication(root, { document: source });
  const expectedCollectionId = componentTokenIdentityId('collection', {
    documentId: source.id, collectionId: collection.id, id: collection.id
  });
  const expectedAliasId = componentTokenIdentityId('variable', {
    documentId: source.id, collectionId: collection.id, id: alias.id
  });
  const expectedBrandId = componentTokenIdentityId('variable', {
    documentId: source.id, collectionId: collection.id, id: brand.id
  });
  const expectedDarkModeId = componentTokenIdentityId('mode', {
    documentId: source.id, collectionId: collection.id, id: dark.id
  });
  assert.equal(portable.children[0].fillVariableId, expectedAliasId);
  assert.equal(portable.variableModes[expectedCollectionId], expectedDarkModeId);

  let library = publishComponent(createComponentLibrary({ id: 'library-token-portability', name: 'Token portability' }), {
    componentId: 'component-token-portability', name: 'Token card', root: portable
  }).library;
  const publishedTokens = library.designTokens;
  assert.equal(publishedTokens.variables.length, 2, 'only the referenced token and its alias dependency are published');
  assert.equal(publishedTokens.variables.some(variable => variable.name === unused.name), false, 'unreferenced source tokens stay private');
  assert.equal(publishedTokens.variables.find(variable => variable.id === expectedAliasId).aliasesByMode[expectedDarkModeId], expectedBrandId);

  const destination = createDocument();
  // Pre-existing local IDs deliberately collide with source-stable IDs. They
  // must remain untouched while the imported linked tokens receive new IDs.
  const collisionCollection = createVariableCollection(destination, 'Local collision');
  collisionCollection.id = expectedCollectionId;
  collisionCollection.modes[0].id = expectedDarkModeId;
  collisionCollection.defaultModeId = expectedDarkModeId;
  const collisionVariable = createColorVariable(destination, collisionCollection.id, 'Local action', '#123456');
  collisionVariable.id = expectedAliasId;
  const collisionBrand = createColorVariable(destination, collisionCollection.id, 'Local brand', '#654321');
  collisionBrand.id = expectedBrandId;
  const initial = createLinkedInstanceSnapshot(library, 'component-token-portability', { instanceId: 'linked-token-card' });
  const instance = createLinkedEditorInstance(initial, { document: destination });
  addNode(destination, instance);
  assert.equal(validateDocument(destination), true);
  assert.equal(collisionVariable.valuesByMode[expectedDarkModeId], '#123456');
  assert.equal(collisionBrand.valuesByMode[expectedDarkModeId], '#654321');
  const importedCollection = destination.variableCollections.find(item => item.linkedLibraryToken?.libraryId === library.id);
  const importedAlias = destination.variables.find(item => item.linkedLibraryToken?.libraryId === library.id && item.name === alias.name);
  const importedBrand = destination.variables.find(item => item.linkedLibraryToken?.libraryId === library.id && item.name === brand.name);
  assert.ok(importedCollection && importedAlias && importedBrand);
  assert.notEqual(importedCollection.id, expectedCollectionId, 'an occupied destination collection ID is remapped');
  assert.equal(instance.variableModes[expectedCollectionId], undefined, 'the source collection ID does not leak into the destination tree');
  assert.equal(instance.variableModes[importedCollection.id], importedCollection.modes.find(mode => mode.name === 'Dark').id);
  assert.equal(importedAlias.aliasesByMode[instance.variableModes[importedCollection.id]], importedBrand.id,
    'alias references follow the destination variable map');
  assert.equal(getNodeColor(destination, instance.children[0], 'fill'), '#d946ef', 'the imported dark mode resolves through its alias');

  importedBrand.name = 'Locally renamed brand';
  const nameCollision = createColorVariable(destination, importedCollection.id, brand.name, '#ffffff');
  assert.equal(setColorVariableValue(source, brand.id, '#00aa44', dark.id), true);
  const nextRoot = componentTreeForPublication(root, { document: source });
  library = publishComponent(library, {
    componentId: 'component-token-portability', name: 'Token card', root: nextRoot
  }).library;
  const updated = updateLinkedInstanceSnapshot(initial, library).instance;
  applyLinkedComponentUpdate(instance, updated, { document: destination });
  assert.equal(validateDocument(destination), true);
  assert.equal(nameCollision.name, brand.name, 'a local variable that takes the source name remains intact');
  assert.notEqual(importedBrand.name, brand.name, 'a colliding published name is disambiguated without breaking its identity');
  assert.equal(importedBrand.valuesByMode[instance.variableModes[importedCollection.id]], '#00aa44',
    'a source token edit updates the existing destination token in place');
  assert.equal(getNodeColor(destination, instance.children[0], 'fill'), '#00aa44');
});

test('missing and deleted published tokens retain their resolved literal fallback', () => {
  const source = createDocument();
  const collection = createVariableCollection(source, 'Brand');
  const accent = createColorVariable(source, collection.id, 'Accent', '#1759c7');
  const root = createNode('frame', { name: 'Fallback card', width: 180, height: 80 });
  const shape = createNode('rectangle', { fill: '#ffffff', width: 64, height: 32 });
  addNode(source, root);
  addNode(source, shape, { parentId: root.id });
  assert.equal(bindColorVariable(source, shape.id, accent.id, 'fill'), true);
  const library = publishComponent(createComponentLibrary({ id: 'library-fallback', name: 'Fallbacks' }), {
    componentId: 'component-fallback', name: 'Fallback card', root: componentTreeForPublication(root, { document: source })
  }).library;
  const snapshot = createLinkedInstanceSnapshot(library, 'component-fallback', { instanceId: 'linked-fallback' });
  const destination = createDocument();
  const instance = createLinkedEditorInstance(snapshot, { document: destination });
  addNode(destination, instance);
  const imported = destination.variables.find(item => item.linkedLibraryToken?.libraryId === library.id);
  assert.ok(imported);
  assert.equal(instance.children[0].fill, '#1759c7');
  assert.equal(deleteVariable(destination, imported.id), true);
  assert.equal(instance.children[0].fillVariableId, undefined);
  assert.equal(instance.children[0].fill, '#1759c7');
  assert.equal(getNodeColor(destination, instance.children[0], 'fill'), '#1759c7');
  assert.equal(validateDocument(destination), true);

  // A legacy library/component snapshot has no designTokens field and may
  // carry only an already-resolved literal. Import strips the unresolvable
  // reference while keeping that usable literal intact.
  const legacyLibrary = createComponentLibrary({ id: 'library-legacy-tokens', name: 'Legacy' });
  const legacyRoot = sourceTree({ includeBadge: true });
  legacyRoot.children[1].fill = '#c0ffee';
  legacyRoot.children[1].fillVariableId = 'removed-from-legacy-library';
  const legacyWithoutTokens = { ...legacyLibrary };
  delete legacyWithoutTokens.designTokens;
  const legacyPublished = publishComponent(legacyWithoutTokens, {
    componentId: 'component-legacy-token', name: 'Legacy card', root: legacyRoot
  }).library;
  const published = { ...legacyPublished };
  delete published.designTokens;
  const legacySnapshot = createLinkedInstanceSnapshot(published, 'component-legacy-token', { instanceId: 'legacy-token-link' });
  assert.equal(Object.hasOwn(legacySnapshot, 'designTokens'), false);
  const legacyDestination = createDocument();
  const legacyInstance = createLinkedEditorInstance(legacySnapshot, { document: legacyDestination });
  addNode(legacyDestination, legacyInstance);
  assert.equal(legacyInstance.children[1].fillVariableId, undefined);
  assert.equal(legacyInstance.children[1].fill, '#c0ffee');
  assert.equal(validateDocument(legacyDestination), true);
});
