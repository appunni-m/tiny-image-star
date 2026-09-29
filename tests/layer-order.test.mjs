import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, findNode, validateDocument } from '../src/model.js';
import { layerDropReorder, moveLayerOneVisualRow, reorderLayerForDrop } from '../src/layer-order.js';

test('layer-row drops reorder siblings using the reversed visual stack order', () => {
  const document = createDocument();
  const bottom = createNode('rectangle', { name: 'Bottom' });
  const middle = createNode('rectangle', { name: 'Middle' });
  const top = createNode('rectangle', { name: 'Top' });
  addNode(document, bottom); addNode(document, middle); addNode(document, top);

  // The panel shows [Top, Middle, Bottom]. Drag Bottom above Middle.
  assert.deepEqual(layerDropReorder(document, bottom.id, middle.id, 'before'), {
    nodeId: bottom.id, index: 1, pageId: document.activePageId
  });
  assert.equal(reorderLayerForDrop(document, bottom.id, middle.id, 'before'), true);
  assert.deepEqual(document.pages[0].children.map(node => node.name), ['Middle', 'Bottom', 'Top']);

  // Now the panel shows [Top, Bottom, Middle]. Put Middle below Top.
  assert.equal(reorderLayerForDrop(document, middle.id, top.id, 'after'), true);
  assert.deepEqual(document.pages[0].children.map(node => node.name), ['Bottom', 'Middle', 'Top']);
  assert.equal(validateDocument(document), true);
});

test('layer-row drops reject cross-container, locked, invalid, and no-op moves', () => {
  const document = createDocument();
  const firstFrame = createNode('frame', { name: 'First frame' });
  const secondFrame = createNode('frame', { name: 'Second frame' });
  const first = createNode('rectangle', { name: 'First' });
  const second = createNode('rectangle', { name: 'Second' });
  addNode(document, firstFrame); addNode(document, secondFrame);
  addNode(document, first, { parentId: firstFrame.id });
  addNode(document, second, { parentId: secondFrame.id });

  assert.equal(layerDropReorder(document, first.id, second.id, 'before'), null);
  assert.equal(layerDropReorder(document, first.id, first.id, 'before'), null);
  assert.equal(layerDropReorder(document, first.id, second.id, 'sideways'), null);
  assert.equal(layerDropReorder(document, first.id, first.id, 'after'), null);

  const sibling = createNode('ellipse', { name: 'Sibling', locked: true });
  addNode(document, sibling, { parentId: firstFrame.id });
  assert.equal(layerDropReorder(document, first.id, sibling.id, 'before'), null);
  firstFrame.locked = true;
  assert.equal(layerDropReorder(document, first.id, sibling.id, 'before'), null);
  assert.equal(findNode(document, first.id).parent.id, firstFrame.id);
});

test('layer-row drops reject descendants of any locked ancestor', () => {
  const document = createDocument();
  const lockedRoot = createNode('frame', { name: 'Locked root', locked: true });
  const unlockedNested = createNode('group', { name: 'Unlocked nested group' });
  const first = createNode('rectangle', { name: 'First' });
  const second = createNode('ellipse', { name: 'Second' });
  addNode(document, lockedRoot);
  addNode(document, unlockedNested, { parentId: lockedRoot.id });
  addNode(document, first, { parentId: unlockedNested.id });
  addNode(document, second, { parentId: unlockedNested.id });

  assert.equal(layerDropReorder(document, first.id, second.id, 'before'), null);
  assert.equal(reorderLayerForDrop(document, first.id, second.id, 'before'), false);
  assert.deepEqual(unlockedNested.children.map(node => node.name), ['First', 'Second']);
});

test('one-row layer moves follow reversed stack order and stop at sibling boundaries', () => {
  const document = createDocument();
  const container = createNode('frame', { name: 'Container' });
  const bottom = createNode('rectangle', { name: 'Bottom' });
  const middle = createNode('ellipse', { name: 'Middle' });
  const top = createNode('rectangle', { name: 'Top' });
  addNode(document, container);
  addNode(document, bottom, { parentId: container.id });
  addNode(document, middle, { parentId: container.id });
  addNode(document, top, { parentId: container.id });

  // The visible order is [Top, Middle, Bottom].
  assert.equal(moveLayerOneVisualRow(document, middle.id, 'up'), true);
  assert.deepEqual(container.children.map(node => node.name), ['Bottom', 'Top', 'Middle']);
  assert.equal(moveLayerOneVisualRow(document, middle.id, 'down'), true);
  assert.deepEqual(container.children.map(node => node.name), ['Bottom', 'Middle', 'Top']);

  assert.equal(moveLayerOneVisualRow(document, top.id, 'up'), false, 'the visible top row cannot move above its container');
  assert.equal(moveLayerOneVisualRow(document, bottom.id, 'down'), false, 'the visible bottom row cannot move below its container');
  assert.equal(moveLayerOneVisualRow(document, middle.id, 'sideways'), false, 'unknown directions are rejected');
  assert.equal(validateDocument(document), true);
});

test('one-row layer moves respect locked layers, neighbors, and ancestors', () => {
  const document = createDocument();
  const lockedContainer = createNode('frame', { name: 'Locked container', locked: true });
  const lockedChild = createNode('rectangle', { name: 'Locked child' });
  const sibling = createNode('ellipse', { name: 'Sibling' });
  addNode(document, lockedContainer);
  addNode(document, lockedChild, { parentId: lockedContainer.id });
  addNode(document, sibling, { parentId: lockedContainer.id });
  assert.equal(moveLayerOneVisualRow(document, sibling.id, 'up'), false, 'a locked ancestor blocks reordering its descendants');

  lockedContainer.locked = false;
  lockedChild.locked = true;
  assert.equal(moveLayerOneVisualRow(document, lockedChild.id, 'down'), false, 'a locked source cannot move');
  assert.equal(moveLayerOneVisualRow(document, sibling.id, 'up'), false, 'a locked adjacent layer cannot be crossed');
  assert.deepEqual(lockedContainer.children.map(node => node.name), ['Locked child', 'Sibling']);
});
