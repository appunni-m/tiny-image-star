import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, bindColorVariable, createColorStyle, createColorVariable, createDocument, createNode, createVariableCollection, validateDocument
} from '../src/model.js';
import {
  createComponentLibrary, createLinkedInstanceSnapshot, publishComponent, updateLinkedInstanceSnapshot
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

test('cross-design publication materializes source variable and style values without dangling IDs', () => {
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
  assert.equal(portable.children[0].fillVariableId, undefined);
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
  assert.equal(validateDocument(destination), true, 'the destination design saves without the source token collection or color style');
  assert.equal(instance.children[0].fill, '#2563eb');
  assert.equal(instance.children[0].fillVariableId, undefined);
});
