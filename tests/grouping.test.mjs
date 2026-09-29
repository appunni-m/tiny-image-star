import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, absoluteBounds, canGroupLayers, canUngroupLayers, createDocument, createNode, findNode,
  groupLayers, parseDocument, serializeDocument, ungroupLayers, validateDocument
} from '../src/model.js';

test('grouping siblings preserves hierarchy, stacking order, geometry, and local round trips', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 60, y: 80, width: 500, height: 400 });
  const behind = createNode('rectangle', { name: 'Behind', x: 2, y: 4, width: 12, height: 10 });
  const first = createNode('ellipse', { name: 'First', x: 24, y: 30, width: 70, height: 36, rotation: 27 });
  const middle = createNode('rectangle', { name: 'Middle', x: 108, y: 65, width: 25, height: 20 });
  const last = createNode('text', { name: 'Last', x: 160, y: 110, width: 120, height: 32, rotation: -13 });
  const ahead = createNode('rectangle', { name: 'Ahead', x: 300, y: 140, width: 20, height: 20 });
  addNode(document, frame);
  for (const node of [behind, first, middle, last, ahead]) addNode(document, node, { parentId: frame.id });
  const original = [first, last].map(node => ({ id: node.id, bounds: absoluteBounds(document, node.id), rotation: node.rotation }));

  assert.equal(canGroupLayers(document, [first.id, last.id]), true);
  const group = groupLayers(document, [last.id, first.id]);
  assert.equal(group.type, 'group');
  assert.equal(findNode(document, group.id).parent.id, frame.id);
  assert.deepEqual(frame.children.map(node => node.id), [behind.id, middle.id, group.id, ahead.id]);
  assert.deepEqual(group.children.map(node => node.id), [first.id, last.id]);
  for (const expected of original) {
    const node = findNode(document, expected.id).node;
    assert.deepEqual(absoluteBounds(document, expected.id), expected.bounds);
    assert.equal(node.rotation, expected.rotation);
  }
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('ungrouping applies group rotation and opacity to promoted children', () => {
  const document = createDocument();
  const first = createNode('rectangle', { name: 'First', x: 14, y: 18, width: 50, height: 30, opacity: .5 });
  const second = createNode('ellipse', { name: 'Second', x: 112, y: 42, width: 44, height: 60, opacity: .75 });
  const group = createNode('group', {
    name: 'Rotated group', x: 100, y: 80, width: 190, height: 120, rotation: 31, opacity: .8,
    children: [first, second]
  });
  const above = createNode('rectangle', { name: 'Above', x: 400, y: 10, width: 10, height: 10 });
  addNode(document, group); addNode(document, above);
  const center = { x: group.x + group.width / 2, y: group.y + group.height / 2 };
  const angle = group.rotation * Math.PI / 180;
  const expected = group.children.map(child => {
    const point = { x: group.x + child.x + child.width / 2, y: group.y + child.y + child.height / 2 };
    const dx = point.x - center.x; const dy = point.y - center.y;
    return {
      id: child.id,
      center: { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) },
      rotation: child.rotation + group.rotation,
      opacity: child.opacity * group.opacity
    };
  });

  assert.equal(canUngroupLayers(document, group.id), true);
  const children = ungroupLayers(document, group.id);
  assert.deepEqual(document.pages[0].children.map(node => node.id), [first.id, second.id, above.id]);
  assert.deepEqual(children.map(node => node.id), [first.id, second.id]);
  for (const item of expected) {
    const node = findNode(document, item.id).node;
    assert.ok(Math.abs(node.x + node.width / 2 - item.center.x) < 1e-8);
    assert.ok(Math.abs(node.y + node.height / 2 - item.center.y) < 1e-8);
    assert.equal(node.rotation, item.rotation);
    assert.equal(node.opacity, item.opacity);
  }
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('grouping rejects mixed parents, duplicates, locked layers, and locked containers', () => {
  const document = createDocument();
  const leftFrame = createNode('frame'); const rightFrame = createNode('frame', { x: 500 });
  const left = createNode('rectangle'); const right = createNode('ellipse');
  addNode(document, leftFrame); addNode(document, rightFrame);
  addNode(document, left, { parentId: leftFrame.id }); addNode(document, right, { parentId: rightFrame.id });
  assert.equal(canGroupLayers(document, [left.id, right.id]), false);
  assert.equal(canGroupLayers(document, [left.id, left.id]), false);

  const sibling = createNode('rectangle', { x: 200 }); addNode(document, sibling, { parentId: leftFrame.id });
  sibling.locked = true;
  assert.equal(canGroupLayers(document, [left.id, sibling.id]), false);
  sibling.locked = false; leftFrame.locked = true;
  assert.equal(canGroupLayers(document, [left.id, sibling.id]), false);
  assert.throws(() => groupLayers(document, [left.id, right.id]), /same container/);
});
