import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, createComponent, createComponentInstance, createComponentSet, createDocument, createNode, detachComponentInstance,
  findNode, removeNode, serializeDocument, parseDocument, setComponentVariantProperty, switchComponentInstanceVariant,
  syncComponentInstances, validateDocument
} from '../src/model.js';

test('component instances link to a main component and can be placed on another page', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Primary button', x: 24, y: 32, width: 160, height: 48 });
  const label = createNode('text', { text: 'Continue', x: 12, y: 8 });
  addNode(document, main); addNode(document, label, { parentId: main.id });
  const component = createComponent(document, main.id);
  const nextPage = { id: 'page-secondary', name: 'Secondary', children: [] };
  document.pages.push(nextPage);
  const instance = createComponentInstance(document, component.id, { pageId: nextPage.id, x: 300, y: 180 });

  assert.equal(instance.isInstance, true);
  assert.equal(instance.componentId, component.id);
  assert.equal(instance.x, 300);
  assert.equal(instance.y, 180);
  assert.equal(instance.children[0].text, 'Continue');
  assert.notEqual(instance.id, main.id);
  assert.notEqual(instance.children[0].id, label.id);
  assert.equal(validateDocument(document), true);
});

test('main component edits synchronize while preserving instance placement and stable layer identities', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card', width: 220, height: 120 });
  const title = createNode('text', { text: 'Old title', x: 12, y: 10 });
  const subtitle = createNode('text', { text: 'Before', x: 12, y: 48 });
  addNode(document, main); addNode(document, title, { parentId: main.id }); addNode(document, subtitle, { parentId: main.id });
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id, { x: 360, y: 240 });
  const instanceId = instance.id;
  const instanceTitleId = instance.children[0].id;

  main.width = 280;
  title.text = 'Updated title';
  subtitle.text = 'After';
  const added = createNode('ellipse', { x: 180, y: 16, fill: '#00aa88' });
  addNode(document, added, { parentId: main.id });
  main.children.reverse();
  assert.equal(syncComponentInstances(document, component.id), 1);

  const synced = findNode(document, instanceId).node;
  assert.equal(synced.width, 280);
  assert.equal(synced.x, 360);
  assert.equal(synced.y, 240);
  const syncedTitle = synced.children.find(child => child.componentSourceId === title.id);
  const syncedSubtitle = synced.children.find(child => child.componentSourceId === subtitle.id);
  const syncedAdded = synced.children.find(child => child.componentSourceId === added.id);
  assert.equal(syncedTitle.id, instanceTitleId);
  assert.equal(syncedTitle.text, 'Updated title');
  assert.equal(syncedSubtitle.text, 'After');
  assert.equal(syncedAdded.fill, '#00aa88');
  assert.notEqual(syncedAdded.id, added.id);
  assert.equal(validateDocument(document), true);
});

test('local instance overrides survive main edits and synchronization', () => {
  const document = createDocument();
  const main = createNode('frame', { width: 200, height: 80 });
  const label = createNode('text', { text: 'Default label' });
  addNode(document, main); addNode(document, label, { parentId: main.id });
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  const instanceLabel = instance.children[0];
  instanceLabel.text = 'Special label';
  instance.componentOverrides[instanceLabel.componentSourceId] = { text: 'Special label' };
  instance.width = 240;
  instance.componentOverrides[instance.componentSourceId] = { width: 240 };
  label.text = 'Master label changed';
  main.width = 260;
  syncComponentInstances(document, component.id);

  const synced = findNode(document, instance.id).node;
  assert.equal(synced.width, 240);
  assert.equal(synced.children[0].text, 'Special label');
  assert.equal(validateDocument(document), true);
});

test('local child ordering and geometry overrides are restored after a master edit', () => {
  const document = createDocument();
  const main = createNode('frame');
  const first = createNode('rectangle', { name: 'First', x: 0 });
  const second = createNode('rectangle', { name: 'Second', x: 40 });
  addNode(document, main); addNode(document, first, { parentId: main.id }); addNode(document, second, { parentId: main.id });
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  instance.children.reverse();
  instance.children[0].x = 72;
  instance.componentOverrides[main.id] = { __childOrder: instance.children.map(child => child.componentSourceId) };
  instance.componentOverrides[first.id] = { x: 72 };
  first.width = 150;
  syncComponentInstances(document, component.id);

  const synced = findNode(document, instance.id).node;
  assert.deepEqual(synced.children.map(child => child.componentSourceId), [second.id, first.id]);
  assert.equal(synced.children.find(child => child.componentSourceId === first.id).x, 72);
  assert.equal(synced.children.find(child => child.componentSourceId === first.id).width, 150);
  assert.equal(validateDocument(document), true);
});

test('detached instances stop following the main component and still validate after reload', () => {
  const document = createDocument();
  const main = createNode('rectangle', { fill: '#112233' }); addNode(document, main);
  const component = createComponent(document, main.id, 'Accent');
  const instance = createComponentInstance(document, component.id);
  assert.equal(detachComponentInstance(document, instance.id), true);
  instance.fill = '#445566';
  main.fill = '#aabbcc';
  assert.equal(syncComponentInstances(document, component.id), 0);
  assert.equal(instance.fill, '#445566');
  const restored = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(restored), true);
  assert.equal(findNode(restored, instance.id).node.isInstance, undefined);
});

test('deleting a main component removes its definition and detaches surviving instances', () => {
  const document = createDocument();
  const main = createNode('rectangle'); addNode(document, main);
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  removeNode(document, main.id);
  assert.equal(document.components.length, 0);
  assert.equal(instance.isInstance, undefined);
  assert.equal(instance.componentId, undefined);
  assert.equal(validateDocument(document), true);
});

test('document validation rejects dangling component references', () => {
  const document = createDocument();
  const layer = createNode('rectangle', { isInstance: true, componentId: 'missing' }); addNode(document, layer);
  assert.throws(() => validateDocument(document), /Missing component source/);
});

test('document validation rejects identity and prototype-field component overrides', () => {
  const document = createDocument();
  const main = createNode('rectangle'); addNode(document, main);
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  instance.componentOverrides[main.id] = { id: 'replace-layer-identity' };
  assert.throws(() => validateDocument(document), /Invalid component override/);
});

test('components cannot be declared from an instance subtree', () => {
  const document = createDocument();
  const main = createNode('frame'); const child = createNode('rectangle');
  addNode(document, main); addNode(document, child, { parentId: main.id });
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  assert.throws(() => createComponent(document, instance.children[0].id), /Detach an instance/);
});

test('variant sets capture property values and switch instances without losing compatible overrides', () => {
  const document = createDocument();
  const small = createNode('frame', { name: 'Small button', width: 120, height: 40 });
  const smallLabel = createNode('text', { name: 'Label', text: 'Continue' });
  const large = createNode('frame', { name: 'Large button', width: 220, height: 64 });
  const largeLabel = createNode('text', { name: 'Label', text: 'Continue' });
  addNode(document, small); addNode(document, smallLabel, { parentId: small.id });
  addNode(document, large); addNode(document, largeLabel, { parentId: large.id });
  const smallComponent = createComponent(document, small.id, 'Button / Size=Small');
  const largeComponent = createComponent(document, large.id, 'Button / Size=Large');
  const instance = createComponentInstance(document, smallComponent.id, { x: 180, y: 90 });
  instance.children[0].fill = '#12abef';
  instance.componentOverrides[smallLabel.id] = { fill: '#12abef' };

  const set = createComponentSet(document, [smallComponent.id, largeComponent.id], 'Button');
  assert.deepEqual(set.properties, [{ name: 'Size', values: ['Small', 'Large'] }]);
  assert.equal(instance.children[0].componentSourceKey, 'root/0');
  assert.equal(switchComponentInstanceVariant(document, instance.id, largeComponent.id), true);
  assert.equal(instance.componentId, largeComponent.id);
  assert.equal(instance.x, 180);
  assert.equal(instance.y, 90);
  assert.equal(instance.width, 220);
  assert.equal(instance.children[0].text, 'Continue');
  assert.equal(instance.children[0].fill, '#12abef');
  assert.equal(instance.children[0].componentSourceId, largeLabel.id);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('variant value changes reject duplicate combinations and deleting a variant dissolves a degenerate set', () => {
  const document = createDocument();
  const first = createNode('rectangle'); const second = createNode('rectangle');
  addNode(document, first); addNode(document, second);
  const a = createComponent(document, first.id, 'Chip / Tone=Blue');
  const b = createComponent(document, second.id, 'Chip / Tone=Green');
  const set = createComponentSet(document, [a.id, b.id], 'Chip');
  assert.throws(() => setComponentVariantProperty(document, b.id, 'Tone', 'Blue'), /combination already exists/);
  setComponentVariantProperty(document, b.id, 'Tone', 'Mint');
  assert.deepEqual(set.properties[0].values, ['Blue', 'Mint']);
  removeNode(document, second.id);
  assert.deepEqual(document.componentSets, []);
  assert.equal(a.componentSetId, undefined);
  assert.equal(a.variantProperties, undefined);
  assert.equal(validateDocument(document), true);
});
