import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, absoluteBounds, canFrameSelection, createDocument, createNode, findNode,
  frameSelection, parseDocument, serializeDocument, validateDocument
} from '../src/model.js';
import { applyAutoLayout, createAutoLayout } from '../src/layout-engine.js';

test('Frame selection wraps one layer in a transparent clipping frame without moving it', () => {
  const document = createDocument();
  const behind = createNode('rectangle', { name: 'Behind', x: -40, y: -20, width: 20, height: 20 });
  const image = createNode('image', { name: 'Photo', x: 40, y: 60, width: 120, height: 90, rotation: 17 });
  const ahead = createNode('ellipse', { name: 'Ahead', x: 240, y: 90, width: 20, height: 20 });
  addNode(document, behind); addNode(document, image); addNode(document, ahead);
  const before = absoluteBounds(document, image.id);

  assert.equal(canFrameSelection(document, [image.id]), true);
  const frame = frameSelection(document, [image.id]);

  assert.equal(frame.type, 'frame');
  assert.equal(frame.fill, 'transparent');
  assert.equal(frame.clip, true);
  assert.deepEqual(document.pages[0].children.map(node => node.id), [behind.id, frame.id, ahead.id]);
  assert.deepEqual(frame.children.map(node => node.id), [image.id]);
  assert.deepEqual(absoluteBounds(document, image.id), before);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('Frame selection keeps sibling stacking order and transformed geometry in the tight frame', () => {
  const document = createDocument();
  const parent = createNode('frame', { x: 75, y: 110, width: 640, height: 500, fill: 'transparent' });
  const behind = createNode('rectangle', { name: 'Behind', x: 2, y: 4, width: 12, height: 10 });
  const first = createNode('ellipse', { name: 'First', x: 24, y: 30, width: 70, height: 36, rotation: 27 });
  const middle = createNode('rectangle', { name: 'Middle', x: 108, y: 65, width: 25, height: 20 });
  const last = createNode('text', { name: 'Last', x: 160, y: 110, width: 120, height: 32, rotation: -13 });
  const ahead = createNode('rectangle', { name: 'Ahead', x: 300, y: 140, width: 20, height: 20 });
  addNode(document, parent);
  for (const node of [behind, first, middle, last, ahead]) addNode(document, node, { parentId: parent.id });
  const before = [first, last].map(node => ({ id: node.id, bounds: absoluteBounds(document, node.id), rotation: node.rotation }));

  const frame = frameSelection(document, [last.id, first.id]);

  assert.equal(findNode(document, frame.id).parent.id, parent.id);
  assert.deepEqual(parent.children.map(node => node.id), [behind.id, middle.id, frame.id, ahead.id]);
  assert.deepEqual(frame.children.map(node => node.id), [first.id, last.id]);
  for (const expected of before) {
    const node = findNode(document, expected.id).node;
    const actualBounds = absoluteBounds(document, expected.id);
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(actualBounds[key] - expected.bounds[key]) <= 1e-9,
        `${expected.id} ${key} should stay within 1e-9px of its original geometry`);
    }
    assert.equal(node.rotation, expected.rotation);
  }
  assert.ok(frame.children.every(node => node.x >= 0 && node.y >= 0));
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('Frame selection follows Auto Layout stack order and reflows only when selection is non-adjacent', () => {
  const makeLayout = () => {
    const document = createDocument();
    const parent = createNode('frame', {
      width: 500, height: 100,
      autoLayout: createAutoLayout({ axis: 'horizontal', padding: 10, columnGap: 10 })
    });
    const first = createNode('rectangle', { id: 'first', width: 20, height: 20 });
    const middle = createNode('rectangle', { id: 'middle', width: 30, height: 20 });
    const last = createNode('rectangle', { id: 'last', width: 40, height: 20 });
    addNode(document, parent);
    for (const node of [first, middle, last]) addNode(document, node, { parentId: parent.id });
    applyAutoLayout(parent);
    return { document, parent, first, middle, last };
  };

  const adjacent = makeLayout();
  const beforeAdjacent = [adjacent.first, adjacent.middle, adjacent.last].map(node => absoluteBounds(adjacent.document, node.id).x);
  const adjacentFrame = frameSelection(adjacent.document, [adjacent.first.id, adjacent.middle.id]);
  applyAutoLayout(adjacent.parent);
  assert.deepEqual(adjacent.parent.children.map(node => node.id), [adjacentFrame.id, adjacent.last.id]);
  assert.deepEqual([adjacent.first, adjacent.middle, adjacent.last].map(node => absoluteBounds(adjacent.document, node.id).x), beforeAdjacent);
  assert.equal(validateDocument(parseDocument(serializeDocument(adjacent.document))), true);

  const separated = makeLayout();
  const frame = frameSelection(separated.document, [separated.first.id, separated.last.id]);
  applyAutoLayout(separated.parent);
  assert.deepEqual(separated.parent.children.map(node => node.id), [separated.middle.id, frame.id]);
  assert.deepEqual([separated.middle, separated.first, separated.last].map(node => absoluteBounds(separated.document, node.id).x), [10, 50, 120]);
  assert.equal(validateDocument(parseDocument(serializeDocument(separated.document))), true);
});

test('Frame selection rejects duplicate, mixed-parent, locked, and slice inputs', () => {
  const document = createDocument();
  const firstFrame = createNode('frame');
  const secondFrame = createNode('frame', { x: 500 });
  const first = createNode('rectangle');
  const second = createNode('ellipse');
  const slice = createNode('slice', { width: 24, height: 18 });
  addNode(document, firstFrame); addNode(document, secondFrame);
  addNode(document, first, { parentId: firstFrame.id });
  addNode(document, second, { parentId: secondFrame.id });
  addNode(document, slice);

  assert.equal(canFrameSelection(document, []), false);
  assert.equal(canFrameSelection(document, [first.id, first.id]), false);
  assert.equal(canFrameSelection(document, [first.id, second.id]), false);
  assert.equal(canFrameSelection(document, [slice.id]), false);
  first.locked = true;
  assert.equal(canFrameSelection(document, [first.id]), false);
  assert.throws(() => frameSelection(document, [first.id]), /unlocked sibling layers/);
});
