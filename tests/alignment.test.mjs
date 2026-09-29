import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, alignLayers, canAlignLayers, createDocument, createNode, findNode } from '../src/model.js';

function visualBounds(node) {
  const radians = (node.rotation || 0) * Math.PI / 180;
  const halfWidth = (Math.abs(node.width * Math.cos(radians)) + Math.abs(node.height * Math.sin(radians))) / 2;
  const halfHeight = (Math.abs(node.width * Math.sin(radians)) + Math.abs(node.height * Math.cos(radians))) / 2;
  const centerX = node.x + node.width / 2; const centerY = node.y + node.height / 2;
  return { left: centerX - halfWidth, right: centerX + halfWidth, top: centerY - halfHeight, bottom: centerY + halfHeight };
}

test('align modes use rotated visual bounds and preserve unaffected axes', () => {
  for (const [mode, edge] of [['left', 'left'], ['center-x', 'centerX'], ['right', 'right']]) {
    const document = createDocument();
    const first = createNode('rectangle', { x: 18, y: 24, width: 62, height: 28, rotation: 23 });
    const second = createNode('ellipse', { x: 170, y: 100, width: 30, height: 78, rotation: -17 });
    addNode(document, first); addNode(document, second);
    const untouchedY = [first.y, second.y];
    const before = [first, second].map(visualBounds);
    const target = edge === 'left' ? Math.min(...before.map(box => box.left))
      : edge === 'right' ? Math.max(...before.map(box => box.right))
        : (Math.min(...before.map(box => box.left)) + Math.max(...before.map(box => box.right))) / 2;

    assert.equal(canAlignLayers(document, [first.id, second.id], mode), true);
    alignLayers(document, [first.id, second.id], mode);
    const after = [first, second].map(visualBounds);
    const actual = box => edge === 'left' ? box.left : edge === 'right' ? box.right : (box.left + box.right) / 2;
    for (const box of after) assert.ok(Math.abs(actual(box) - target) < 1e-8);
    assert.deepEqual([first.y, second.y], untouchedY);
    assert.equal(findNode(document, first.id).node, first);
  }
  for (const [mode, edge] of [['top', 'top'], ['center-y', 'centerY'], ['bottom', 'bottom']]) {
    const document = createDocument();
    const first = createNode('rectangle', { x: 15, y: 25, width: 46, height: 31, rotation: 19 });
    const second = createNode('ellipse', { x: 118, y: 140, width: 54, height: 23, rotation: -29 });
    addNode(document, first); addNode(document, second);
    const untouchedX = [first.x, second.x];
    const before = [first, second].map(visualBounds);
    const target = edge === 'top' ? Math.min(...before.map(box => box.top))
      : edge === 'bottom' ? Math.max(...before.map(box => box.bottom))
        : (Math.min(...before.map(box => box.top)) + Math.max(...before.map(box => box.bottom))) / 2;
    alignLayers(document, [first.id, second.id], mode);
    const after = [first, second].map(visualBounds);
    const actual = box => edge === 'top' ? box.top : edge === 'bottom' ? box.bottom : (box.top + box.bottom) / 2;
    for (const box of after) assert.ok(Math.abs(actual(box) - target) < 1e-8);
    assert.deepEqual([first.x, second.x], untouchedX);
  }
});

test('distribution creates equal visual gaps without changing the end layers or stack order', () => {
  const document = createDocument();
  const layers = [
    createNode('rectangle', { name: 'First', x: 0, y: 10, width: 10, height: 10 }),
    createNode('rectangle', { name: 'Second', x: 34, y: 10, width: 20, height: 10 }),
    createNode('rectangle', { name: 'Third', x: 105, y: 10, width: 40, height: 10 }),
    createNode('rectangle', { name: 'Last', x: 210, y: 10, width: 10, height: 10 })
  ];
  for (const layer of layers) addNode(document, layer);
  const orderBefore = document.pages[0].children.map(node => node.id);
  const endpointsBefore = [visualBounds(layers[0]).left, visualBounds(layers.at(-1)).right];

  assert.equal(canAlignLayers(document, layers.slice(0, 2).map(node => node.id), 'distribute-horizontal'), false);
  alignLayers(document, [layers[2].id, layers[0].id, layers[3].id, layers[1].id], 'distribute-horizontal');
  const ordered = layers.map((node, index) => ({ node, box: visualBounds(node), index })).sort((a, b) => a.box.left - b.box.left);
  const gaps = ordered.slice(1).map((item, index) => item.box.left - ordered[index].box.right);
  assert.ok(gaps.every(gap => Math.abs(gap - gaps[0]) < 1e-8));
  assert.ok(Math.abs(ordered[0].box.left - endpointsBefore[0]) < 1e-8);
  assert.ok(Math.abs(ordered.at(-1).box.right - endpointsBefore[1]) < 1e-8);
  assert.deepEqual(document.pages[0].children.map(node => node.id), orderBefore);
});

test('alignment rejects mixed parents, locked layers, and auto layout children', () => {
  const document = createDocument();
  const frame = createNode('frame'); const otherFrame = createNode('frame', { x: 400 });
  const first = createNode('rectangle'); const second = createNode('ellipse');
  addNode(document, frame); addNode(document, otherFrame);
  addNode(document, first, { parentId: frame.id }); addNode(document, second, { parentId: otherFrame.id });
  assert.equal(canAlignLayers(document, [first.id, second.id], 'left'), false);
  second.x = 100; addNode(document, second, { parentId: frame.id });
  second.locked = true;
  assert.equal(canAlignLayers(document, [first.id, second.id], 'left'), false);
  second.locked = false; frame.autoLayout = { axis: 'horizontal', gap: 8 };
  assert.equal(canAlignLayers(document, [first.id, second.id], 'left'), false);
  assert.throws(() => alignLayers(document, [first.id, second.id], 'left'), /auto layout/);
});
