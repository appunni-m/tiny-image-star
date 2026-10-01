import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createComponent, createComponentInstance, createComponentProperty, createDocument, createNode, findNode, setComponentSlotContent } from '../src/model.js';
import { removeLayersAtomically } from '../src/layer-deletion.js';

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
