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

test('resolved variable settings drive layout without overwriting the saved base settings', () => {
  const frame = createNode('frame', {
    width: 220, height: 100,
    autoLayout: createAutoLayout({ axis: 'horizontal', columnGap: 8, padding: 8 })
  });
  const first = createNode('rectangle', { width: 30, height: 20 });
  const second = createNode('rectangle', { width: 30, height: 20 });
  frame.children.push(first, second);
  const resolved = createAutoLayout({ ...frame.autoLayout, columnGap: 20, padding: { ...frame.autoLayout.padding, left: 24 } });
  applyAutoLayout(frame, resolved);
  assert.deepEqual([first.x, second.x], [24, 74]);
  assert.equal(frame.autoLayout.columnGap, 8, 'mode-resolved values must not replace the serialized base values');
  assert.equal(frame.autoLayout.padding.left, 8);
});

test('linear fill sizes honor min and max bounds while redistributing available space', () => {
  const frame = createNode('frame', { width: 230, height: 100, autoLayout: createAutoLayout({ axis: 'horizontal', gap: 10, padding: 10 }) });
  const fixed = createNode('rectangle', { width: 40, height: 30 });
  const minimum = createNode('rectangle', { width: 20, height: 30, layoutSizingMain: 'fill', minWidth: 100 });
  const maximum = createNode('rectangle', { width: 20, height: 30, layoutSizingMain: 'fill', minWidth: 20, maxWidth: 40 });
  frame.children.push(fixed, minimum, maximum);
  applyAutoLayout(frame);
  assert.deepEqual([minimum.width, maximum.width, minimum.x, maximum.x], [100, 40, 60, 170]);
});

test('size limits constrain stretched children and hug-sized frames', () => {
  const frame = createNode('frame', {
    width: 220, height: 100, minWidth: 150, maxHeight: 50,
    autoLayout: createAutoLayout({ axis: 'vertical', gap: 5, padding: 10, mainSizing: 'hug', crossSizing: 'hug' })
  });
  frame.children.push(createNode('rectangle', { width: 120, height: 20 }), createNode('rectangle', { width: 80, height: 30 }));
  applyAutoLayout(frame);
  assert.deepEqual([frame.width, frame.height], [150, 50]);

  const row = createNode('frame', { width: 220, height: 100, autoLayout: createAutoLayout({ axis: 'horizontal', padding: 10, align: 'stretch' }) });
  const stretched = createNode('rectangle', { width: 40, height: 20, minHeight: 50, maxHeight: 60 });
  row.children.push(stretched);
  applyAutoLayout(row);
  assert.equal(stretched.height, 60);
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

test('grid fill sizing applies bounds before aligning within its cell', () => {
  const frame = createNode('frame', { width: 240, height: 120, autoLayout: createAutoLayout({ axis: 'grid', columns: 2, padding: 10, columnGap: 10 }) });
  const tile = createNode('rectangle', {
    width: 20, height: 10, layoutSizingX: 'fill', layoutSizingY: 'fill', maxWidth: 90, minHeight: 30,
    gridCell: { row: 1, column: 1, alignX: 'center', alignY: 'end' }
  });
  frame.children.push(tile);
  applyAutoLayout(frame);
  assert.deepEqual([tile.x, tile.y, tile.width, tile.height], [17.5, 10, 90, 30]);
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

test('wrapped stacks measure children using their constrained dimensions', () => {
  const frame = createNode('frame', { width: 120, height: 100, autoLayout: createAutoLayout({ axis: 'horizontal', wrap: true, columnGap: 0, rowGap: 12, padding: 10 }) });
  const first = createNode('rectangle', { width: 40, height: 15 });
  const wider = createNode('rectangle', { width: 40, height: 15, minWidth: 60 });
  const third = createNode('rectangle', { width: 40, height: 15 });
  frame.children.push(first, wider, third);
  applyAutoLayout(frame);
  assert.deepEqual([first.x, first.y, wider.x, wider.y, wider.width, third.x, third.y], [10, 10, 50, 10, 60, 10, 37]);
});

test('grid auto layout and cell placement validate and survive document reload', () => {
  const document = createDocument();
  const frame = createNode('frame', { autoLayout: createAutoLayout({ axis: 'grid', columns: 4, rows: 3 }) });
  const tile = createNode('rectangle', { gridCell: { row: 2, column: 3, rowSpan: 2, columnSpan: 2, alignX: 'center' }, layoutSizingX: 'fill', maxWidth: 180, minHeight: 32 });
  addNode(document, frame);
  addNode(document, tile, { parentId: frame.id });
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const invalid = structuredClone(document);
  invalid.pages[0].children[0].autoLayout.columns = 0;
  assert.throws(() => validateDocument(invalid), /Invalid auto layout/);

  const inverted = structuredClone(document);
  inverted.pages[0].children[0].children[0].minWidth = 200;
  inverted.pages[0].children[0].children[0].maxWidth = 100;
  assert.throws(() => validateDocument(inverted), /Invalid size limits/);

  const misplaced = structuredClone(document);
  misplaced.pages[0].children[0].children[0].autoLayout = null;
  misplaced.pages[0].children[0].autoLayout = null;
  assert.throws(() => validateDocument(misplaced), /Size limits require an auto layout frame/);
});
