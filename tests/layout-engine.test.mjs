import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { applyAutoLayout, createAutoLayout } from '../src/layout-engine.js';

test('vertical auto layout positions children using padding and gap', () => {
  const frame = createNode('frame', { width: 240, height: 240, autoLayout: createAutoLayout({ gap: 8, padding: 12 }) });
  const first = createNode('rectangle', { width: 40, height: 20 });
  const second = createNode('rectangle', { width: 70, height: 30 });
  frame.children.push(first, second);
  applyAutoLayout(frame);
  assert.deepEqual([first.x, first.y, second.x, second.y], [12, 12, 12, 40]);
});

test('horizontal fill children divide remaining main-axis space', () => {
  const frame = createNode('frame', { width: 220, height: 100, autoLayout: createAutoLayout({ axis: 'horizontal', gap: 10, padding: { left: 10, right: 10, top: 8, bottom: 8 } }) });
  const fixed = createNode('rectangle', { width: 40, height: 30 });
  const fill = createNode('rectangle', { width: 20, height: 30, layoutSizingMain: 'fill' });
  frame.children.push(fixed, fill);
  applyAutoLayout(frame);
  assert.deepEqual([fixed.x, fill.x, fill.width], [10, 60, 150]);
});

test('hug sizing updates the frame to match its laid out content', () => {
  const frame = createNode('frame', { width: 220, height: 100, autoLayout: createAutoLayout({ axis: 'vertical', gap: 5, padding: 10, mainSizing: 'hug', crossSizing: 'hug' }) });
  frame.children.push(createNode('rectangle', { width: 60, height: 20 }), createNode('rectangle', { width: 80, height: 30 }));
  applyAutoLayout(frame);
  assert.deepEqual([frame.width, frame.height], [100, 75]);
});

test('grid auto layout assigns cells in layer order with independent gaps and auto rows', () => {
  const frame = createNode('frame', { width: 240, height: 160, autoLayout: createAutoLayout({ axis: 'grid', columns: 2, columnGap: 10, rowGap: 20, padding: { left: 10, right: 10, top: 10, bottom: 10 } }) });
  const first = createNode('rectangle', { width: 40, height: 20 });
  const second = createNode('rectangle', { width: 50, height: 30 });
  const third = createNode('rectangle', { width: 60, height: 40 });
  frame.children.push(first, second, third);
  applyAutoLayout(frame);
  assert.deepEqual([first.x, first.y, second.x, second.y, third.x, third.y], [10, 10, 125, 10, 10, 60]);
  assert.deepEqual([first.gridCell.row, first.gridCell.column, second.gridCell.row, second.gridCell.column, third.gridCell.row, third.gridCell.column], [1, 1, 1, 2, 2, 1]);
});

test('grid auto layout preserves manual cells, spans tracks and fills the spanned area', () => {
  const frame = createNode('frame', { width: 310, height: 210, autoLayout: createAutoLayout({ axis: 'grid', columns: 3, rows: 'auto', autoPositioning: false, columnGap: 10, rowGap: 10, padding: 10 }) });
  const spanning = createNode('rectangle', { width: 20, height: 40, layoutSizingX: 'fill', layoutSizingY: 'fill', gridCell: { row: 1, column: 1, rowSpan: 2, columnSpan: 2 } });
  const lastCell = createNode('rectangle', { width: 20, height: 30, layoutSizingX: 'fill', gridCell: { row: 2, column: 3 } });
  const placedInFirstGap = createNode('rectangle', { width: 15, height: 15 });
  frame.children.push(spanning, lastCell, placedInFirstGap);
  applyAutoLayout(frame);
  assert.deepEqual([spanning.x, spanning.y, spanning.width, spanning.height], [10, 10, 190, 55]);
  assert.deepEqual([lastCell.x, lastCell.y, lastCell.width], [210, 35, 90]);
  assert.deepEqual([placedInFirstGap.gridCell.row, placedInFirstGap.gridCell.column], [1, 3]);
});

test('wrapped horizontal stacks use distinct row and column gaps', () => {
  const frame = createNode('frame', { width: 120, height: 100, autoLayout: createAutoLayout({ axis: 'horizontal', wrap: true, columnGap: 10, rowGap: 20, padding: 10 }) });
  const first = createNode('rectangle', { width: 40, height: 15 });
  const second = createNode('rectangle', { width: 40, height: 15 });
  const third = createNode('rectangle', { width: 40, height: 15 });
  frame.children.push(first, second, third);
  applyAutoLayout(frame);
  assert.deepEqual([first.x, first.y, second.x, second.y, third.x, third.y], [10, 10, 60, 10, 10, 45]);
});

test('grid auto layout and cell placement validate and survive document reload', () => {
  const document = createDocument();
  const frame = createNode('frame', { autoLayout: createAutoLayout({ axis: 'grid', columns: 4, rows: 3 }) });
  const tile = createNode('rectangle', { gridCell: { row: 2, column: 3, rowSpan: 2, columnSpan: 2, alignX: 'center' }, layoutSizingX: 'fill' });
  addNode(document, frame);
  addNode(document, tile, { parentId: frame.id });
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const invalid = structuredClone(document);
  invalid.pages[0].children[0].autoLayout.columns = 0;
  assert.throws(() => validateDocument(invalid), /Invalid auto layout/);
});
