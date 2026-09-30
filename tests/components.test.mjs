import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, canCreateMaskGroup, canGroupLayers, canUngroupLayers, combineBoolean, createComponent, createComponentInstance, createComponentSet, createDocument, createMaskGroup, createNode, detachComponentInstance,
  canSwapComponentTo, createComponentProperty, duplicateNode, findNode, moveNode, removeNode, reorderNode, releaseMaskGroup, separateBoolean, serializeDocument, parseDocument, setComponentPropertyValue, setComponentVariantProperty, switchComponentInstanceVariant, ungroupLayers, groupLayers, updateNode,
  resetComponentSlotContent, setComponentSlotContent, syncAllComponentInstances, syncComponentInstances, validateDocument
} from '../src/model.js';
import { addPrototypeInteraction } from '../src/prototype.js';

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

test('component blend-mode overrides validate with the component property schema', () => {
  const document = createDocument();
  const main = createNode('rectangle', { name: 'Blend card' });
  addNode(document, main);
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  const sourceId = instanceNode.componentSourceId;
  instanceNode.componentOverrides[sourceId] = { blendMode: 'screen' };
  assert.equal(validateDocument(document), true);
  instanceNode.componentOverrides[sourceId].blendMode = 'vivid-light';
  assert.throws(() => validateDocument(document), /Invalid component blend mode override/);
});

test('component text typography overrides validate with the component property schema', () => {
  const document = createDocument();
  const main = createNode('text', { text: 'Label' });
  addNode(document, main);
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  const sourceId = instanceNode.componentSourceId;
  instanceNode.componentOverrides[sourceId] = { fontFamily: 'Atkinson Hyperlegible, sans-serif', fontWeight: 800, fontStyle: 'italic' };
  assert.equal(validateDocument(document), true);
  instanceNode.componentOverrides[sourceId].fontStyle = 'oblique';
  assert.throws(() => validateDocument(document), /Invalid component font style override/);
});

test('component shape geometry overrides persist and validate against the source shape', () => {
  const document = createDocument();
  const master = createNode('star', { name: 'Badge', points: 5, innerRadius: .48 });
  addNode(document, master);
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  instance.componentOverrides[master.id] = { points: 8, innerRadius: 0 };

  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[1].componentOverrides[master.id], { points: 8, innerRadius: 0 });

  instance.componentOverrides[master.id].points = 33;
  assert.throws(() => validateDocument(document), /Invalid component shape point-count override/);
  instance.componentOverrides[master.id] = { points: 8, innerRadius: 1.01 };
  assert.throws(() => validateDocument(document), /Invalid component star inner-radius override/);
});

test('component vector-path point overrides validate and survive document reload', () => {
  const document = createDocument();
  const main = createNode('path', { name: 'Badge outline', points: [
    { x: 0, y: 0, out: { x: .2, y: 0 }, mode: 'smooth' },
    { x: 1, y: 1, in: { x: -.2, y: 0 }, mode: 'symmetric' }
  ] });
  addNode(document, main);
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  const editedPoints = structuredClone(main.points);
  editedPoints[0].out = { x: .35, y: .15 };
  instance.componentOverrides[main.id] = { points: editedPoints };

  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[1].componentOverrides[main.id].points, editedPoints);

  instance.componentOverrides[main.id].points[0].mode = 'invalid';
  assert.throws(() => validateDocument(document), /Invalid component vector path points override/);
  instance.componentOverrides[main.id].points = null;
  assert.throws(() => validateDocument(document), /Invalid component vector path points override/);
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

test('prototype interactions authored on an instance survive component sync and local reload', () => {
  const document = createDocument();
  const defaultMaster = createNode('rectangle', { name: 'Button/State=Default' });
  const hoverMaster = createNode('rectangle', { name: 'Button/State=Hover' });
  addNode(document, defaultMaster); addNode(document, hoverMaster);
  const defaultComponent = createComponent(document, defaultMaster.id);
  const hoverComponent = createComponent(document, hoverMaster.id);
  createComponentSet(document, [defaultComponent.id, hoverComponent.id]);
  const destinations = ['First', 'Second', 'Third'].map(name => createNode('frame', { name }));
  for (const destination of destinations) {
    addNode(document, destination);
    addPrototypeInteraction(document, defaultMaster.id, destination.id);
  }
  const instance = createComponentInstance(document, defaultComponent.id);
  assert.equal(instance.interactions.length, 3, 'the instance starts with the three interactions inherited from its master');

  addPrototypeInteraction(document, instance.id, null, {
    action: 'change-variant', trigger: 'on-press', targetVariantId: hoverComponent.id
  });
  instance.componentOverrides[defaultMaster.id] ||= {};
  instance.componentOverrides[defaultMaster.id].interactions = structuredClone(instance.interactions);

  assert.equal(syncAllComponentInstances(document), 1);
  assert.equal(findNode(document, instance.id).node.interactions.length, 4,
    'sync must reapply the instance interaction override after copying the master');
  assert.equal(findNode(document, instance.id).node.interactions.at(-1).targetVariantId, hoverComponent.id);

  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(syncAllComponentInstances(reloaded), 1);
  const restored = findNode(reloaded, instance.id).node;
  assert.equal(restored.interactions.length, 4, 'the variant interaction must survive serialization and a subsequent sync');
  assert.equal(restored.componentOverrides[defaultMaster.id].interactions.length, 4);
  assert.equal(validateDocument(reloaded), true);
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

test('instance size-limit overrides survive main edits and local design reload', () => {
  const document = createDocument();
  const main = createNode('frame', { width: 220, height: 120, autoLayout: { axis: 'horizontal' } });
  const tile = createNode('rectangle', { maxWidth: 220 });
  addNode(document, main); addNode(document, tile, { parentId: main.id });
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  const instanceTile = instance.children[0];
  instanceTile.maxWidth = 180;
  instance.componentOverrides[instanceTile.componentSourceId] = { maxWidth: 180 };

  tile.maxWidth = 260;
  assert.equal(syncComponentInstances(document, component.id), 1);
  const synchronizedTile = findNode(document, instanceTile.id).node;
  assert.equal(synchronizedTile.maxWidth, 180);
  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(findNode(reloaded, instanceTile.id).node.maxWidth, 180);
  assert.equal(validateDocument(reloaded), true);
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

test('typed component properties project defaults and instance values through sync and reload', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card' });
  const label = createNode('text', { text: 'Default label' });
  const badge = createNode('ellipse', { name: 'Badge', visible: true });
  const icon = createNode('rectangle', { name: 'Icon', fill: '#112233' });
  addNode(document, main); addNode(document, label, { parentId: main.id });
  addNode(document, badge, { parentId: main.id }); addNode(document, icon, { parentId: main.id });
  const component = createComponent(document, main.id, 'Card');
  const visibleProperty = createComponentProperty(document, component.id, { name: 'Show badge', type: 'BOOLEAN', targetNodeId: badge.id });
  const textProperty = createComponentProperty(document, component.id, { name: 'Label', type: 'TEXT', targetNodeId: label.id });
  const instance = createComponentInstance(document, component.id);
  assert.equal(instance.children.find(node => node.componentSourceId === badge.id).visible, true);
  assert.equal(instance.children.find(node => node.componentSourceId === label.id).text, 'Default label');

  instance.componentOverrides[icon.id] = { fill: '#445566' };
  assert.equal(setComponentPropertyValue(document, instance.id, visibleProperty.id, false), true);
  assert.equal(setComponentPropertyValue(document, instance.id, textProperty.id, 'Special label'), true);
  assert.equal(instance.componentPropertyValues[visibleProperty.id], false);
  assert.equal(instance.componentPropertyValues[textProperty.id], 'Special label');
  assert.equal(instance.children.find(node => node.componentSourceId === badge.id).visible, false);
  assert.equal(instance.children.find(node => node.componentSourceId === label.id).text, 'Special label');

  label.text = 'Updated default';
  badge.visible = false;
  icon.fill = '#abcdef';
  assert.equal(syncComponentInstances(document, component.id), 1);
  const synced = findNode(document, instance.id).node;
  assert.equal(synced.children.find(node => node.componentSourceId === badge.id).visible, false);
  assert.equal(synced.children.find(node => node.componentSourceId === label.id).text, 'Special label');
  assert.equal(synced.children.find(node => node.componentSourceId === icon.id).fill, '#445566');

  assert.equal(setComponentPropertyValue(document, instance.id, visibleProperty.id, undefined), true);
  assert.equal(setComponentPropertyValue(document, instance.id, textProperty.id, undefined), true);
  assert.equal(synced.children.find(node => node.componentSourceId === badge.id).visible, true);
  assert.equal(synced.children.find(node => node.componentSourceId === label.id).text, 'Default label');
  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reloaded), true);
  assert.deepEqual(reloaded.components[0].componentProperties, [visibleProperty, textProperty]);
});

test('instance-swap properties accept compatible components outside variant sets and keep ordinary overrides', () => {
  const document = createDocument();
  const baseNode = createNode('frame', { name: 'Original', width: 80, height: 40 });
  addNode(document, baseNode);
  const baseComponent = createComponent(document, baseNode.id, 'Original');

  const replacementNode = createNode('text', { name: 'Replacement', text: 'Swapped content' });
  addNode(document, replacementNode);
  const replacementComponent = createComponent(document, replacementNode.id, 'Replacement');

  const card = createNode('frame', { name: 'Card' });
  addNode(document, card);
  const slotGroup = createNode('group', { name: 'Slot group' });
  addNode(document, slotGroup, { parentId: card.id });
  const nested = createComponentInstance(document, baseComponent.id);
  document.pages[0].children.splice(document.pages[0].children.indexOf(nested), 1);
  slotGroup.children.push(nested);
  nested.x = 12; nested.y = 8;
  const accent = createNode('rectangle', { name: 'Accent' });
  addNode(document, accent, { parentId: card.id });
  const cardComponent = createComponent(document, card.id, 'Card');
  const swapProperty = createComponentProperty(document, cardComponent.id, { name: 'Content', type: 'INSTANCE_SWAP', targetNodeId: nested.id });
  assert.equal(canSwapComponentTo(document, cardComponent.id, replacementComponent.id), true);
  assert.equal(canSwapComponentTo(document, cardComponent.id, cardComponent.id), false);
  const instance = createComponentInstance(document, cardComponent.id);
  instance.componentOverrides[nested.id] = { opacity: 0.65, name: 'Custom content name' };
  const instanceNodeBySource = sourceId => {
    let found = null;
    const visit = node => {
      if (node.componentSourceId === sourceId) { found = node; return; }
      for (const child of node.children || []) visit(child);
    };
    visit(instance);
    return found;
  };
  instance.children.find(node => node.componentSourceId === accent.id).fill = '#00aa88';
  instance.componentOverrides[accent.id] = { fill: '#00aa88' };

  assert.equal(setComponentPropertyValue(document, instance.id, swapProperty.id, replacementComponent.id), true);
  let instanceNested = instanceNodeBySource(nested.id);
  assert.equal(instanceNested.type, 'text');
  assert.equal(instanceNested.componentId, replacementComponent.id);
  assert.equal(instanceNested.componentSourceId, nested.id);
  assert.equal(instanceNested.text, 'Swapped content');
  assert.equal(instanceNested.opacity, 0.65);
  assert.equal(instanceNested.name, 'Custom content name');
  assert.equal(instance.children.find(node => node.componentSourceId === accent.id).fill, '#00aa88');

  card.width = 280;
  assert.equal(syncComponentInstances(document, cardComponent.id), 1);
  instanceNested = instanceNodeBySource(nested.id);
  assert.equal(instanceNested.componentId, replacementComponent.id);
  assert.equal(instanceNested.type, 'text');
  assert.equal(instanceNested.opacity, 0.65);
  assert.equal(instanceNested.name, 'Custom content name');
  assert.equal(instance.width, 280);
  assert.throws(() => setComponentPropertyValue(document, instance.id, swapProperty.id, cardComponent.id), /Invalid value/);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('component-property validation rejects duplicate IDs, unsupported targets, and invalid instance values', () => {
  const document = createDocument();
  const main = createNode('frame'); const label = createNode('text', { text: 'Hello' });
  addNode(document, main); addNode(document, label, { parentId: main.id });
  const component = createComponent(document, main.id);
  const property = createComponentProperty(document, component.id, { name: 'Label', type: 'TEXT', targetNodeId: label.id });
  const instance = createComponentInstance(document, component.id);
  assert.equal(validateDocument(document), true);

  const duplicateId = parseDocument(serializeDocument(document));
  duplicateId.components[0].componentProperties.push({ ...duplicateId.components[0].componentProperties[0], name: 'Other' });
  assert.throws(() => validateDocument(duplicateId), /Invalid component property/);

  const missingTarget = parseDocument(serializeDocument(document));
  missingTarget.components[0].componentProperties[0].targetSourceId = 'missing-layer';
  assert.throws(() => validateDocument(missingTarget), /Invalid component property/);

  const wrongTarget = parseDocument(serializeDocument(document));
  wrongTarget.components[0].componentProperties[0].targetSourceId = main.id;
  assert.throws(() => validateDocument(wrongTarget), /Invalid TEXT default/);

  instance.componentPropertyValues = { [property.id]: false };
  assert.throws(() => validateDocument(document), /Invalid component property value/);
});

test('slot content is real cloned layer content that survives master sync, reload, detach, and reset', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card' });
  const slot = createNode('section', { name: 'Content', x: 12, y: 20, width: 180, height: 90 });
  const inherited = createNode('text', { name: 'Default content', text: 'Master copy' });
  addNode(document, main);
  addNode(document, slot, { parentId: main.id });
  addNode(document, inherited, { parentId: slot.id });
  const component = createComponent(document, main.id, 'Card');
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  assert.deepEqual(property.defaultValue, []);
  const instance = createComponentInstance(document, component.id);
  const replacement = createNode('group', { name: 'Supplied artwork', x: 3, y: 4, width: 80, height: 50 });
  const replacementChild = createNode('rectangle', { name: 'Badge', fill: '#12abef', x: 2, y: 3 });
  replacement.children.push(replacementChild);
  const [installed] = setComponentSlotContent(document, instance.id, property.id, [replacement]);
  assert.notEqual(installed.id, replacement.id, 'slot content gets new IDs instead of stealing IDs from its source');
  assert.notEqual(installed.children[0].id, replacementChild.id);
  assert.equal(installed.children[0].fill, '#12abef');
  const instanceSlot = findNode(document, instance.id).node.children.find(node => node.componentSourceId === slot.id);
  assert.deepEqual(instanceSlot.children.map(node => node.id), [installed.id]);
  assert.deepEqual(instance.componentPropertyValues[property.id], [installed.id]);
  assert.equal(validateDocument(document), true);
  assert.throws(() => setComponentPropertyValue(document, instance.id, property.id, ['not-a-layer-tree']), /setComponentSlotContent/);
  assert.equal(setComponentSlotContent(document, instance.id, 'missing-property', []), false);
  const duplicateTree = createNode('group');
  duplicateTree.children.push(createNode('rectangle', { id: duplicateTree.id }));
  assert.throws(() => setComponentSlotContent(document, instance.id, property.id, [duplicateTree]), /unique IDs/);
  const forbiddenMain = createNode('frame', { name: 'Unlinked main' });
  addNode(document, forbiddenMain);
  createComponent(document, forbiddenMain.id, 'Unlinked main');
  assert.throws(() => setComponentSlotContent(document, instance.id, property.id, [forbiddenMain]), /main component/);

  slot.width = 240;
  inherited.text = 'Master changed';
  assert.equal(syncComponentInstances(document, component.id), 1);
  const synced = findNode(document, instance.id).node;
  const syncedSlot = synced.children.find(node => node.componentSourceId === slot.id);
  assert.equal(syncedSlot.width, 240);
  assert.equal(syncedSlot.children[0].id, installed.id);
  assert.equal(syncedSlot.children[0].children[0].fill, '#12abef');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  assert.equal(detachComponentInstance(document, instance.id), true);
  assert.equal(synced.children.find(node => node.name === 'Content').children[0].id, installed.id);
  assert.equal(synced.isInstance, undefined);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const second = createComponentInstance(document, component.id);
  const [secondSlot] = findNode(document, second.id).node.children.filter(node => node.componentSourceId === slot.id);
  assert.equal(secondSlot.children[0].text, 'Master changed');
  const custom = createNode('text', { text: 'Replace again' });
  setComponentSlotContent(document, second.id, property.id, [custom]);
  setComponentSlotContent(document, second.id, property.id, []);
  const emptySlotInstance = findNode(document, second.id).node;
  assert.deepEqual(emptySlotInstance.componentPropertyValues[property.id], []);
  assert.deepEqual(emptySlotInstance.children.find(node => node.componentSourceId === slot.id).children, []);
  assert.equal(syncComponentInstances(document, component.id), 1);
  assert.deepEqual(findNode(document, second.id).node.children.find(node => node.componentSourceId === slot.id).children, []);
  assert.equal(resetComponentSlotContent(document, second.id, property.id), true);
  const resetSlot = findNode(document, second.id).node.children.find(node => node.componentSourceId === slot.id);
  assert.equal(resetSlot.children[0].text, 'Master changed');
  assert.equal(Object.hasOwn(findNode(document, second.id).node.componentPropertyValues || {}, property.id), false);
  assert.equal(validateDocument(document), true);
});

test('slot values remain isolated per instance and follow direct child order', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card' });
  const slot = createNode('group', { name: 'Content' });
  const inherited = createNode('text', { text: 'Master' });
  addNode(document, main); addNode(document, slot, { parentId: main.id });
  addNode(document, inherited, { parentId: slot.id });
  const component = createComponent(document, main.id, 'Card');
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const first = createComponentInstance(document, component.id);
  const second = createComponentInstance(document, component.id);
  setComponentSlotContent(document, first.id, property.id, [createNode('text', { text: 'First' }), createNode('text', { text: 'First extra' })]);
  setComponentSlotContent(document, second.id, property.id, [createNode('text', { text: 'Second' })]);

  inherited.text = 'Master updated';
  assert.equal(syncComponentInstances(document, component.id), 2);
  const firstSlot = findNode(document, first.id).node.children.find(node => node.componentSourceId === slot.id);
  const secondSlot = findNode(document, second.id).node.children.find(node => node.componentSourceId === slot.id);
  assert.deepEqual(firstSlot.children.map(node => node.text), ['First', 'First extra']);
  assert.deepEqual(secondSlot.children.map(node => node.text), ['Second']);
  assert.deepEqual(first.componentPropertyValues[property.id], firstSlot.children.map(node => node.id));
  assert.deepEqual(second.componentPropertyValues[property.id], secondSlot.children.map(node => node.id));
  assert.equal(validateDocument(document), true);
});

test('layer mutations keep explicit slot child IDs aligned through add, remove, duplicate, move, reorder, and group', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card' });
  const slot = createNode('frame', { name: 'Content' });
  addNode(document, main); addNode(document, slot, { parentId: main.id });
  const component = createComponent(document, main.id, 'Card');
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const target = instance.children.find(node => node.componentSourceId === slot.id);
  const first = createNode('rectangle', { name: 'First' });
  const second = createNode('ellipse', { name: 'Second' });
  const third = createNode('text', { name: 'Third', text: 'Third' });
  setComponentSlotContent(document, instance.id, property.id, [first, second]);
  const [firstId, secondId] = target.children.map(node => node.id);
  updateNode(document, target.id, { children: [...target.children, createNode('rectangle', { name: 'Patch-added' })] });
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  addNode(document, third, { parentId: target.id });
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  assert.equal(reorderNode(document, secondId, 0), true);
  assert.deepEqual(instance.componentPropertyValues[property.id], [secondId, firstId, ...target.children.slice(2).map(node => node.id)]);

  const duplicate = duplicateNode(document, firstId);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  assert.equal(removeNode(document, firstId)?.id, firstId);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  const movedId = target.children.at(-1).id;
  assert.equal(moveNode(document, movedId, { parentId: null }), true);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  assert.equal(moveNode(document, movedId, { parentId: target.id, index: 1 }), true);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));

  const groupInputs = target.children.slice(0, 2).map(node => node.id);
  assert.equal(canGroupLayers(document, groupInputs), true);
  const group = groupLayers(document, groupInputs);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  assert.equal(target.children[0].id, group.id);
  assert.equal(canUngroupLayers(document, group.id), true);
  ungroupLayers(document, group.id);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  assert.notEqual(duplicate.id, firstId);
  assert.equal(validateDocument(document), true);
});

test('default slot content allows child-order overrides and blocks structural mutations', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card' });
  const slot = createNode('frame', { name: 'Content' });
  const inherited = createNode('text', { name: 'Inherited', text: 'Keep me' });
  const inheritedSecond = createNode('rectangle', { name: 'Inherited second' });
  addNode(document, main); addNode(document, slot, { parentId: main.id });
  addNode(document, inherited, { parentId: slot.id }); addNode(document, inheritedSecond, { parentId: slot.id });
  const component = createComponent(document, main.id, 'Card');
  createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const target = instance.children.find(node => node.componentSourceId === slot.id);
  const inheritedInstanceChild = target.children[0];
  const inheritedInstanceSecond = target.children[1];

  assert.throws(() => addNode(document, createNode('rectangle'), { parentId: target.id }), /Set a slot override before editing it/);
  assert.throws(() => removeNode(document, inheritedInstanceChild.id), /Set a slot override before editing it/);
  assert.throws(() => duplicateNode(document, inheritedInstanceChild.id), /Set a slot override before editing it/);
  assert.throws(() => moveNode(document, inheritedInstanceChild.id, { parentId: null }), /Set a slot override before editing it/);
  assert.throws(() => updateNode(document, target.id, { children: [] }), /Set a slot override before editing it/);
  assert.equal(reorderNode(document, inheritedInstanceSecond.id, 0), true);
  assert.deepEqual(target.children.map(node => node.componentSourceId), [inheritedInstanceSecond.componentSourceId, inheritedInstanceChild.componentSourceId]);
  instance.componentOverrides ||= {};
  instance.componentOverrides[slot.id] = { __childOrder: target.children.map(node => node.componentSourceId) };
  assert.equal(syncComponentInstances(document, component.id), 1);
  assert.deepEqual(target.children.map(node => node.componentSourceId), [inheritedInstanceSecond.componentSourceId, inheritedInstanceChild.componentSourceId]);
  assert.equal(target.children.length, 2);
  assert.equal(target.children[1].text, 'Keep me');
  assert.equal(validateDocument(document), true);
});

test('Boolean and mask grouping mutations keep overridden slot roots synchronized', () => {
  const document = createDocument();
  const main = createNode('frame'); const slot = createNode('frame');
  addNode(document, main); addNode(document, slot, { parentId: main.id });
  const component = createComponent(document, main.id);
  const property = createComponentProperty(document, component.id, { name: 'Artwork', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const target = instance.children.find(node => node.componentSourceId === slot.id);

  setComponentSlotContent(document, instance.id, property.id, [createNode('rectangle'), createNode('ellipse')]);
  const booleanIds = target.children.map(node => node.id);
  const booleanGroup = combineBoolean(document, booleanIds, 'union');
  assert.deepEqual(instance.componentPropertyValues[property.id], [booleanGroup.id]);
  assert.equal(validateDocument(document), true);
  separateBoolean(document, booleanGroup.id);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));

  const text = createNode('text', { text: 'Masked' });
  const mask = createNode('rectangle');
  setComponentSlotContent(document, instance.id, property.id, [text, mask]);
  const [textId, maskId] = target.children.map(node => node.id);
  assert.equal(canCreateMaskGroup(document, [textId, maskId]), true);
  const maskGroup = createMaskGroup(document, [textId, maskId]);
  assert.deepEqual(instance.componentPropertyValues[property.id], [maskGroup.id]);
  releaseMaskGroup(document, maskGroup.id);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  assert.equal(validateDocument(document), true);
});

test('named slot content migrates between variants with different slot source IDs', () => {
  const document = createDocument();
  const compact = createNode('frame', { name: 'Compact card', width: 180, height: 100 });
  const compactSlot = createNode('group', { name: 'Compact content' });
  const wide = createNode('frame', { name: 'Wide card', width: 320, height: 140 });
  const wideSlot = createNode('frame', { name: 'Wide content' });
  addNode(document, compact); addNode(document, compactSlot, { parentId: compact.id });
  addNode(document, wide); addNode(document, wideSlot, { parentId: wide.id });
  const compactComponent = createComponent(document, compact.id, 'Card / Size=Compact');
  const wideComponent = createComponent(document, wide.id, 'Card / Size=Wide');
  const compactProperty = createComponentProperty(document, compactComponent.id, { name: 'Content', type: 'SLOT', targetNodeId: compactSlot.id });
  const wideProperty = createComponentProperty(document, wideComponent.id, { name: 'Content', type: 'SLOT', targetNodeId: wideSlot.id });
  createComponentSet(document, [compactComponent.id, wideComponent.id], 'Card');
  const instance = createComponentInstance(document, compactComponent.id);
  const artwork = createNode('rectangle', { name: 'Photo placeholder', fill: '#aabbcc', width: 64, height: 48 });
  const [installed] = setComponentSlotContent(document, instance.id, compactProperty.id, [artwork]);

  assert.equal(switchComponentInstanceVariant(document, instance.id, wideComponent.id), true);
  assert.equal(instance.componentId, wideComponent.id);
  assert.deepEqual(instance.componentPropertyValues[wideProperty.id], [installed.id]);
  assert.equal(Object.hasOwn(instance.componentPropertyValues, compactProperty.id), false);
  const targetSlot = instance.children.find(node => node.componentSourceId === wideSlot.id);
  assert.equal(targetSlot.children[0].id, installed.id);
  assert.equal(targetSlot.children[0].fill, '#aabbcc');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  assert.equal(switchComponentInstanceVariant(document, instance.id, compactComponent.id), true);
  assert.equal(instance.children.find(node => node.componentSourceId === compactSlot.id).children[0].id, installed.id);
  assert.equal(validateDocument(document), true);
});

test('slot validation rejects invalid targets, malformed content, and property-value mismatches', () => {
  const document = createDocument();
  const main = createNode('frame'); const slot = createNode('frame'); const label = createNode('text', { text: 'Label' });
  addNode(document, main); addNode(document, slot, { parentId: main.id }); addNode(document, label, { parentId: main.id });
  const component = createComponent(document, main.id);
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  assert.throws(() => createComponentProperty(document, component.id, { name: 'Root slot', type: 'SLOT', targetNodeId: main.id }), /nested frame, group, or section/);
  const instance = createComponentInstance(document, component.id);
  const supplied = createNode('section');
  supplied.children.push(createNode('rectangle'));
  const secondSupplied = createNode('text', { text: 'Also custom' });
  const [installed, secondInstalled] = setComponentSlotContent(document, instance.id, property.id, [supplied, secondSupplied]);
  assert.equal(validateDocument(document), true);

  const missingId = parseDocument(serializeDocument(document));
  const missingInstance = findNode(missingId, instance.id).node;
  missingInstance.componentPropertyValues[property.id] = ['not-a-child'];
  assert.throws(() => validateDocument(missingId), /Invalid component property value/);

  const duplicateValues = parseDocument(serializeDocument(document));
  const duplicateInstance = findNode(duplicateValues, instance.id).node;
  duplicateInstance.componentPropertyValues[property.id] = [installed.id, installed.id];
  assert.throws(() => validateDocument(duplicateValues), /Invalid component property value/);

  const wrongOrder = parseDocument(serializeDocument(document));
  const reorderedInstance = findNode(wrongOrder, instance.id).node;
  reorderedInstance.componentPropertyValues[property.id] = [secondInstalled.id, installed.id];
  assert.throws(() => validateDocument(wrongOrder), /Invalid component property value/);

  const badTarget = parseDocument(serializeDocument(document));
  badTarget.components[0].componentProperties[0].targetSourceId = label.id;
  assert.throws(() => validateDocument(badTarget), /Invalid component property/);

  const rootTarget = parseDocument(serializeDocument(document));
  rootTarget.components[0].componentProperties[0].targetSourceId = main.id;
  assert.throws(() => validateDocument(rootTarget), /Invalid component property/);

  const badDefault = parseDocument(serializeDocument(document));
  badDefault.components[0].componentProperties[0].defaultValue = ['content-is-not-a-default'];
  assert.throws(() => validateDocument(badDefault), /Invalid SLOT default/);
});

test('variant switching preserves populated slots only when a same-named target slot exists', () => {
  const document = createDocument();
  const first = createNode('frame', { name: 'First / Size=One' }); const firstSlot = createNode('frame', { name: 'Content' });
  const second = createNode('frame', { name: 'Second / Size=Two' }); const secondSlot = createNode('frame', { name: 'Other content' });
  addNode(document, first); addNode(document, firstSlot, { parentId: first.id });
  addNode(document, second); addNode(document, secondSlot, { parentId: second.id });
  const firstComponent = createComponent(document, first.id);
  const secondComponent = createComponent(document, second.id);
  const firstProperty = createComponentProperty(document, firstComponent.id, { name: 'Content', type: 'SLOT', targetNodeId: firstSlot.id });
  createComponentProperty(document, secondComponent.id, { name: 'Other content', type: 'SLOT', targetNodeId: secondSlot.id });
  createComponentSet(document, [firstComponent.id, secondComponent.id], 'Card');
  const instance = createComponentInstance(document, firstComponent.id);
  setComponentSlotContent(document, instance.id, firstProperty.id, [createNode('rectangle')]);
  const before = serializeDocument(document);
  assert.throws(() => switchComponentInstanceVariant(document, instance.id, secondComponent.id), /no matching target slot/);
  assert.equal(serializeDocument(document), before, 'a rejected variant switch must not discard custom slot content');
  assert.equal(validateDocument(document), true);
});
