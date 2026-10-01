import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createComponent, createComponentInstance, createComponentProperty, createDocument, createMaskGroup, createNode, findNode, parseDocument, serializeDocument, setComponentSlotContent, syncAllComponentInstances, validateDocument } from '../src/model.js';
import { layerDeleteTargets, removeLayersAtomically } from '../src/layer-deletion.js';

test('keyboard delete prefers a focused unselected layer and preserves an active multi-selection', () => {
  const selectedIds = ['selected-a', 'selected-b'];

  assert.deepEqual(layerDeleteTargets(selectedIds, 'focused-unselected'), ['focused-unselected']);
  assert.deepEqual(layerDeleteTargets(selectedIds, 'selected-b'), selectedIds);
  assert.deepEqual(layerDeleteTargets(selectedIds, null), selectedIds);
  assert.deepEqual(layerDeleteTargets([], 'focused-layer'), ['focused-layer']);
  assert.deepEqual(layerDeleteTargets(['selected-a', 'selected-a'], null), ['selected-a']);
});

test('layer deletion removes selections from a new valid document', () => {
  const document = createDocument();
  const first = createNode('rectangle', { name: 'First' });
  const second = createNode('ellipse', { name: 'Second' });
  addNode(document, first);
  addNode(document, second);

  const result = removeLayersAtomically(document, [first.id, second.id, first.id]);

  assert.equal(findNode(result.document, first.id), null);
  assert.equal(findNode(result.document, second.id), null);
  assert.ok(findNode(document, first.id), 'the active document is left untouched until deletion succeeds');
  assert.deepEqual(result.removedIds, [first.id, second.id]);
});

test('deleting a mask source removes only that layer and keeps the remaining group editable', () => {
  const document = createDocument();
  const content = createNode('rectangle', { name: 'Visible content' });
  const mask = createNode('ellipse', { name: 'Mask source' });
  addNode(document, content);
  addNode(document, mask);
  const group = createMaskGroup(document, [content.id, mask.id]);

  const result = removeLayersAtomically(document, [mask.id]);
  const updatedGroup = findNode(result.document, group.id).node;

  assert.equal(findNode(result.document, mask.id), null);
  assert.equal(findNode(result.document, content.id).parent.id, group.id);
  assert.equal(updatedGroup.mask, false);
  assert.equal(Object.hasOwn(updatedGroup, 'maskSourceId'), false);
  assert.equal(validateDocument(result.document), true);
});

test('deleting a mask source from a component instance remains deleted after component sync and reload', () => {
  const document = createDocument();
  const content = createNode('rectangle', { name: 'Component content' });
  const mask = createNode('ellipse', { name: 'Component mask' });
  addNode(document, content);
  addNode(document, mask);
  const maskGroup = createMaskGroup(document, [content.id, mask.id]);
  const component = createComponent(document, maskGroup.id, 'Masked component');
  const instance = createComponentInstance(document, component.id);
  const instanceGroup = instance;
  const instanceMask = instanceGroup.children.find(child => child.type === 'ellipse');

  const result = removeLayersAtomically(document, [instanceMask.id]);
  syncAllComponentInstances(result.document);
  validateDocument(result.document);
  const reloaded = parseDocument(serializeDocument(result.document));
  syncAllComponentInstances(reloaded);
  validateDocument(reloaded);

  const reloadedInstanceGroup = findNode(reloaded, instanceGroup.id).node;
  assert.equal(findNode(reloaded, instanceMask.id), null);
  assert.equal(reloadedInstanceGroup.mask, false);
  assert.equal(reloadedInstanceGroup.children.some(child => child.type === 'rectangle'), true);
});

test('a blocked slot-layer deletion leaves every selected layer intact', () => {
  const document = createDocument();
  const removable = createNode('rectangle', { name: 'Ordinary layer' });
  const card = createNode('frame', { name: 'Card' });
  const slot = createNode('frame', { name: 'Content' });
  const inherited = createNode('rectangle', { name: 'Inherited content' });
  addNode(document, removable);
  addNode(document, card);
  addNode(document, slot, { parentId: card.id });
  addNode(document, inherited, { parentId: slot.id });
  const component = createComponent(document, card.id, 'Card');
  createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const inheritedInstanceLayer = instance.children[0].children[0];

  assert.throws(() => removeLayersAtomically(document, [removable.id, inheritedInstanceLayer.id]), /Set a slot override before editing it/);
  assert.ok(findNode(document, removable.id), 'the ordinary selection must not be partially deleted');
  assert.ok(findNode(document, inheritedInstanceLayer.id), 'the protected slot layer remains intact');
});

test('deleting a selected slot override remains supported', () => {
  const document = createDocument();
  const card = createNode('frame', { name: 'Card' });
  const slot = createNode('frame', { name: 'Content' });
  addNode(document, card);
  addNode(document, slot, { parentId: card.id });
  const component = createComponent(document, card.id, 'Card');
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const instanceSlot = instance.children[0];
  setComponentSlotContent(document, instance.id, property.id, [createNode('rectangle', { name: 'Custom content' })]);
  const customLayer = instanceSlot.children[0];

  const result = removeLayersAtomically(document, [customLayer.id]);

  assert.equal(findNode(result.document, customLayer.id), null);
  assert.deepEqual(findNode(result.document, instanceSlot.id).node.children, []);
});

test('deleting inside deeply nested component instances survives the save-time component sync', () => {
  const document = createDocument();
  const leafMaster = createNode('frame', { name: 'Leaf component' });
  const leafChild = createNode('rectangle', { name: 'Deletable leaf' });
  addNode(document, leafMaster);
  addNode(document, leafChild, { parentId: leafMaster.id });
  const leafComponent = createComponent(document, leafMaster.id, 'Leaf component');

  const middleMaster = createNode('frame', { name: 'Middle component' });
  addNode(document, middleMaster);
  createComponentInstance(document, leafComponent.id, { parentId: middleMaster.id });
  createComponentInstance(document, leafComponent.id, { parentId: middleMaster.id });
  const middleComponent = createComponent(document, middleMaster.id, 'Middle component');

  const outerMaster = createNode('frame', { name: 'Outer component' });
  addNode(document, outerMaster);
  createComponentInstance(document, middleComponent.id, { parentId: outerMaster.id });
  const outerComponent = createComponent(document, outerMaster.id, 'Outer component');
  const outerInstance = createComponentInstance(document, outerComponent.id);
  const firstNestedLeafInstance = outerInstance.children[0].children[0];
  const selectedLeaf = firstNestedLeafInstance.children[0];

  const result = removeLayersAtomically(document, [selectedLeaf.id]);
  assert.equal(findNode(result.document, selectedLeaf.id), null);
  syncAllComponentInstances(result.document);
  const syncedOuter = findNode(result.document, outerInstance.id).node;
  assert.deepEqual(syncedOuter.children[0].children[0].children, [],
    'refreshing an enclosing component must preserve the nested instance deletion');
  assert.equal(syncedOuter.children[0].children[1].children[0].name, 'Deletable leaf',
    'the sibling instance of the same component must retain its own unedited content');
  assert.ok(findNode(result.document, leafChild.id), 'the source component layer must remain intact');

  const reloaded = parseDocument(serializeDocument(result.document));
  syncAllComponentInstances(reloaded);
  const restoredOuter = findNode(reloaded, outerInstance.id).node;
  assert.deepEqual(restoredOuter.children[0].children[0].children, [],
    'the nested deletion must survive local save and reload');
  assert.equal(restoredOuter.children[0].children[1].children[0].name, 'Deletable leaf',
    'a sibling instance must remain unchanged after local save and reload');
});
