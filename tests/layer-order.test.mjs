import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, findNode, validateDocument } from '../src/model.js';
import { canMoveLayerOneVisualRow, layerDropReorder, layerOrderShortcutDirection, layerTreeSections, moveLayerOneVisualRow, reorderLayerForDrop } from '../src/layer-order.js';

test('keyboard layer-order shortcuts use Alt+ArrowUp and Alt+ArrowDown only', () => {
  assert.equal(layerOrderShortcutDirection({ key: 'ArrowUp', altKey: true }), 'up');
  assert.equal(layerOrderShortcutDirection({ key: 'ArrowDown', altKey: true }), 'down');
  for (const event of [
    { key: 'ArrowLeft', altKey: true },
    { key: 'ArrowUp', altKey: false },
    { key: 'ArrowUp', altKey: true, ctrlKey: true },
    { key: 'ArrowDown', altKey: true, metaKey: true },
    { key: 'ArrowDown', altKey: true, shiftKey: true },
    null
  ]) assert.equal(layerOrderShortcutDirection(event), null);
});

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

test('scrolling frames show Fixed and Scrolls sections in paint-stack order', () => {
  const fixedBottom = createNode('rectangle', { name: 'Fixed bottom', scrollPosition: 'fixed' });
  const scrollBottom = createNode('rectangle', { name: 'Scroll bottom', scrollPosition: 'scroll' });
  const fixedTop = createNode('rectangle', { name: 'Fixed top', fixedPositionWhenScrolling: true });
  const scrollTop = createNode('rectangle', { name: 'Scroll top' });
  const frame = {
    type: 'frame', overflowBehavior: 'vertical',
    children: [fixedBottom, scrollBottom, fixedTop, scrollTop]
  };

  assert.deepEqual(layerTreeSections(frame.children, frame), [
    { label: 'Fixed', position: 'fixed', nodes: [fixedTop, fixedBottom] },
    { label: 'Scrolls', position: 'scroll', nodes: [scrollTop, scrollBottom] }
  ]);
  assert.deepEqual(frame.children, [fixedBottom, scrollBottom, fixedTop, scrollTop],
    'the Layers-panel grouping does not mutate saved document order');
  assert.deepEqual(layerTreeSections(frame.children, { ...frame, overflowBehavior: 'none' }), [
    { label: null, position: null, nodes: [...frame.children].reverse() }
  ], 'ordinary frames keep the established reversed sibling order');
});

test('crossing Fixed and Scrolls sections updates scroll position and one-row moves follow the visible order', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Scroller', overflowBehavior: 'vertical' });
  const fixed = createNode('rectangle', { name: 'Fixed', scrollPosition: 'fixed' });
  const scrollAbove = createNode('rectangle', { name: 'Scroll above', scrollPosition: 'scroll' });
  const scrollTarget = createNode('rectangle', { name: 'Scroll target', scrollPosition: 'scroll' });
  addNode(document, frame);
  addNode(document, fixed, { parentId: frame.id });
  addNode(document, scrollAbove, { parentId: frame.id });
  addNode(document, scrollTarget, { parentId: frame.id });

  assert.deepEqual(layerTreeSections(frame.children, frame).map(section => section.nodes.map(node => node.id)), [
    [fixed.id], [scrollTarget.id, scrollAbove.id]
  ]);
  assert.equal(moveLayerOneVisualRow(document, scrollTarget.id, 'up'), true,
    'the first scroll layer moves above the Fixed section when it moves up one visible row');
  assert.equal(scrollTarget.scrollPosition, 'fixed');
  assert.equal(scrollTarget.fixedPositionWhenScrolling, true);
  assert.deepEqual(layerTreeSections(frame.children, frame).map(section => section.nodes.map(node => node.id)), [
    [scrollTarget.id, fixed.id], [scrollAbove.id]
  ]);

  assert.equal(reorderLayerForDrop(document, scrollTarget.id, scrollAbove.id, 'before'), true,
    'dropping a Fixed layer into Scrolls updates its position state');
  assert.equal(scrollTarget.scrollPosition, 'scroll');
  assert.equal(scrollTarget.fixedPositionWhenScrolling, false);
  assert.deepEqual(layerTreeSections(frame.children, frame).map(section => section.nodes.map(node => node.id)), [
    [fixed.id], [scrollTarget.id, scrollAbove.id]
  ]);
  assert.equal(validateDocument(document), true);
});

test('layer-row drops reorder siblings and reparent across containers using row edges', () => {
  const document = createDocument();
  const firstFrame = createNode('frame', { name: 'First frame' });
  const secondFrame = createNode('frame', { name: 'Second frame' });
  const first = createNode('rectangle', { name: 'First' });
  const second = createNode('rectangle', { name: 'Second' });
  addNode(document, firstFrame); addNode(document, secondFrame);
  addNode(document, first, { parentId: firstFrame.id });
  addNode(document, second, { parentId: secondFrame.id });

  assert.deepEqual(layerDropReorder(document, first.id, second.id, 'before'), {
    nodeId: first.id, parentId: secondFrame.id, index: 1, pageId: document.activePageId, reparent: true
  });
  assert.equal(reorderLayerForDrop(document, first.id, second.id, 'before'), true);
  assert.deepEqual(firstFrame.children, []);
  assert.deepEqual(secondFrame.children.map(node => node.id), [second.id, first.id]);
  assert.equal(findNode(document, first.id).parent.id, secondFrame.id);
  assert.equal(validateDocument(document), true);

  assert.equal(layerDropReorder(document, first.id, first.id, 'before'), null);
  assert.equal(layerDropReorder(document, first.id, second.id, 'sideways'), null);

  // Drop inside a container appends to its layer stack, including when it is
  // already the source parent (a useful way to move an item to the bottom).
  assert.deepEqual(layerDropReorder(document, second.id, secondFrame.id, 'inside'), {
    nodeId: second.id, index: 1, pageId: document.activePageId
  });
  assert.equal(reorderLayerForDrop(document, second.id, secondFrame.id, 'inside'), true);
  assert.deepEqual(secondFrame.children.map(node => node.id), [first.id, second.id]);

  // A row edge can also move a child back out to the page-level stack.
  const rootTarget = createNode('ellipse', { name: 'Page target' });
  addNode(document, rootTarget);
  assert.equal(reorderLayerForDrop(document, first.id, rootTarget.id, 'before'), true);
  assert.equal(findNode(document, first.id).parent, null);

  const sibling = createNode('ellipse', { name: 'Sibling', locked: true });
  addNode(document, sibling, { parentId: secondFrame.id });
  assert.equal(layerDropReorder(document, second.id, sibling.id, 'before'), null);
  secondFrame.locked = true;
  assert.equal(layerDropReorder(document, second.id, sibling.id, 'before'), null);
  assert.equal(findNode(document, first.id).parent, null);
});

test('layer-row drops enter frames, groups, and sections but reject invalid or cyclic containers', () => {
  const document = createDocument();
  const source = createNode('frame', { name: 'Source', x: 300, y: 80 });
  const group = createNode('group', { name: 'Group', x: 40, y: 30 });
  const section = createNode('section', { name: 'Section', x: 500, y: 50 });
  const child = createNode('rectangle', { name: 'Child', x: 16, y: 24 });
  const nested = createNode('ellipse', { name: 'Nested', x: 8, y: 10 });
  const nestedContainer = createNode('frame', { name: 'Nested container' });
  const leaf = createNode('ellipse', { name: 'Leaf' });
  addNode(document, source); addNode(document, group); addNode(document, section);
  addNode(document, child, { parentId: source.id });
  addNode(document, nested, { parentId: group.id });
  addNode(document, nestedContainer, { parentId: group.id });
  addNode(document, leaf);

  assert.equal(reorderLayerForDrop(document, child.id, group.id, 'inside'), true);
  assert.equal(findNode(document, child.id).parent.id, group.id);
  assert.equal(reorderLayerForDrop(document, leaf.id, source.id, 'inside'), true);
  assert.equal(findNode(document, leaf.id).parent.id, source.id);
  assert.equal(reorderLayerForDrop(document, nested.id, section.id, 'inside'), true);
  assert.equal(findNode(document, nested.id).parent.id, section.id);
  assert.equal(layerDropReorder(document, group.id, nestedContainer.id, 'inside'), null, 'descendant containers cannot accept their ancestors');
  assert.equal(layerDropReorder(document, child.id, leaf.id, 'inside'), null, 'leaf nodes are not drop containers');
  assert.equal(validateDocument(document), true);
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
  assert.equal(canMoveLayerOneVisualRow(document, middle.id, 'up'), true);
  assert.equal(canMoveLayerOneVisualRow(document, middle.id, 'sideways'), false);
  assert.equal(moveLayerOneVisualRow(document, middle.id, 'up'), true);
  assert.deepEqual(container.children.map(node => node.name), ['Bottom', 'Top', 'Middle']);
  assert.equal(moveLayerOneVisualRow(document, middle.id, 'down'), true);
  assert.deepEqual(container.children.map(node => node.name), ['Bottom', 'Middle', 'Top']);

  assert.equal(moveLayerOneVisualRow(document, top.id, 'up'), false, 'the visible top row cannot move above its container');
  assert.equal(canMoveLayerOneVisualRow(document, top.id, 'up'), false);
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
  assert.equal(canMoveLayerOneVisualRow(document, lockedChild.id, 'down'), false);
  assert.equal(moveLayerOneVisualRow(document, lockedChild.id, 'down'), false, 'a locked source cannot move');
  assert.equal(moveLayerOneVisualRow(document, sibling.id, 'up'), false, 'a locked adjacent layer cannot be crossed');
  assert.deepEqual(lockedContainer.children.map(node => node.name), ['Locked child', 'Sibling']);
});
