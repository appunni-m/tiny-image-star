import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, canCombineBoolean, combineBoolean, createDocument, createNode, findNode,
  parseDocument, separateBoolean, serializeDocument, validateDocument
} from '../src/model.js';

test('Boolean combine keeps editable operands and their stacking order', () => {
  const document = createDocument();
  const back = createNode('rectangle', { name: 'Back layer', x: -200, y: 0 });
  const base = createNode('rectangle', { name: 'Base', x: 20, y: 30, width: 100, height: 60, fill: '#123456' });
  const middle = createNode('ellipse', { name: 'Unselected middle', x: 300, y: 0 });
  const cutter = createNode('ellipse', { name: 'Cutter', x: 80, y: 20, width: 50, height: 80 });
  const front = createNode('rectangle', { name: 'Front layer', x: 400, y: 0 });
  for (const node of [back, base, middle, cutter, front]) addNode(document, node);

  assert.equal(canCombineBoolean(document, [cutter.id, base.id]), true);
  const group = combineBoolean(document, [cutter.id, base.id], 'subtract');
  assert.equal(group.type, 'boolean');
  assert.equal(group.operation, 'subtract');
  assert.deepEqual(group.children.map(node => node.id), [base.id, cutter.id]);
  assert.deepEqual(document.pages[0].children.map(node => node.id), [back.id, middle.id, group.id, front.id]);
  assert.deepEqual({ x: group.x, y: group.y, width: group.width, height: group.height }, { x: 20, y: 20, width: 110, height: 80 });
  assert.deepEqual({ x: group.children[0].x, y: group.children[0].y }, { x: 0, y: 10 });
  assert.deepEqual({ x: group.children[1].x, y: group.children[1].y }, { x: 60, y: 0 });
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('Boolean combine requires unlocked closed vector siblings in one container', () => {
  const document = createDocument();
  const frame = createNode('frame');
  const first = createNode('rectangle');
  const second = createNode('ellipse', { x: 30 });
  const locked = createNode('rectangle', { locked: true });
  const openPath = createNode('path', { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false });
  addNode(document, frame); addNode(document, first); addNode(document, second);
  addNode(document, locked); addNode(document, openPath); addNode(document, createNode('rectangle'), { parentId: frame.id });

  assert.equal(canCombineBoolean(document, [first.id]), false);
  assert.equal(canCombineBoolean(document, [first.id, locked.id]), false);
  assert.equal(canCombineBoolean(document, [first.id, openPath.id]), false);
  assert.equal(canCombineBoolean(document, [first.id, frame.children[0].id]), false);
  assert.throws(() => combineBoolean(document, [first.id, second.id], 'merge'), /supported Boolean/);
  assert.throws(() => combineBoolean(document, [first.id, frame.children[0].id]), /same container/);
  assert.equal(canCombineBoolean(document, [first.id, second.id]), true);
});

test('separate restores source geometry through Boolean group scale and rotation', () => {
  const document = createDocument();
  const first = createNode('rectangle', { x: 20, y: 40, width: 20, height: 20 });
  const second = createNode('ellipse', { x: 60, y: 40, width: 20, height: 20 });
  addNode(document, first); addNode(document, second);
  const group = combineBoolean(document, [first.id, second.id], 'union');
  group.width = 120; group.height = 40; group.rotation = 90;

  const restored = separateBoolean(document, group.id);
  assert.deepEqual(restored.map(node => node.id), [first.id, second.id]);
  assert.deepEqual(document.pages[0].children.map(node => node.id), [first.id, second.id]);
  assert.deepEqual(restored.map(({ x, y, width, height, rotation }) => ({ x, y, width, height, rotation })), [
    { x: 60, y: 0, width: 40, height: 40, rotation: 90 },
    { x: 60, y: 80, width: 40, height: 40, rotation: 90 }
  ]);
  assert.equal(findNode(document, group.id), null);
  assert.equal(validateDocument(document), true);
});

test('Boolean groups reject invalid operations, child sets, and nested open paths on reload', () => {
  const document = createDocument();
  const group = createNode('boolean', { children: [createNode('rectangle'), createNode('ellipse')] });
  addNode(document, group);
  assert.equal(validateDocument(document), true);
  const invalidOperation = structuredClone(document);
  invalidOperation.pages[0].children[0].operation = 'merge';
  assert.throws(() => validateDocument(invalidOperation), /Invalid Boolean group/);
  const openOperand = structuredClone(document);
  openOperand.pages[0].children[0].children[0] = createNode('path', { closed: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
  assert.throws(() => validateDocument(openOperand), /Invalid Boolean group/);
  const tooFew = structuredClone(document);
  tooFew.pages[0].children[0].children.pop();
  assert.throws(() => validateDocument(tooFew), /Invalid Boolean group/);
});
