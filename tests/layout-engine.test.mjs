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

test('linear auto layout supports explicit negative gaps with correct overlap and Hug bounds', () => {
  const defaulted = createAutoLayout({ axis: 'horizontal', gap: -12 });
  assert.deepEqual([defaulted.rowGap, defaulted.columnGap], [-12, -12]);

  const row = createNode('frame', { width: 300, height: 80, autoLayout: createAutoLayout({ axis: 'horizontal', columnGap: -20, padding: 0 }) });
  const first = createNode('rectangle', { width: 100, height: 20 });
  const second = createNode('rectangle', { width: 100, height: 20 });
  row.children.push(first, second);
  applyAutoLayout(row);
  assert.deepEqual([first.x, second.x], [0, 80]);

  const hug = createNode('frame', { width: 300, height: 80, autoLayout: createAutoLayout({ axis: 'horizontal', columnGap: -30, mainSizing: 'hug', padding: 0 }) });
  hug.children.push(createNode('rectangle', { width: 80, height: 20 }), createNode('rectangle', { width: 100, height: 20 }));
  applyAutoLayout(hug);
  assert.equal(hug.width, 150, 'Hug size should use the overlapped content bounds');
});

test('auto layout distributes items with space-around and space-evenly', () => {
  const positions = (justify, columnGap, itemWidth, frameWidth) => {
    const frame = createNode('frame', { width: frameWidth, height: 80, autoLayout: createAutoLayout({ axis: 'horizontal', justify, columnGap, padding: 0 }) });
    const first = createNode('rectangle', { width: itemWidth, height: 20 });
    const second = createNode('rectangle', { width: itemWidth, height: 20 });
    frame.children.push(first, second);
    applyAutoLayout(frame);
    return [first.x, second.x];
  };
  assert.deepEqual(positions('space-between', 10, 40, 300), [0, 260]);
  assert.deepEqual(positions('space-around', 10, 40, 300), [52.5, 207.5]);
  assert.deepEqual(positions('space-evenly', 10, 40, 300), [70, 190]);
});

test('distributed auto layout adds free space to negative overlap gaps', () => {
  const positions = justify => {
    const frame = createNode('frame', { width: 300, height: 80, autoLayout: createAutoLayout({ axis: 'horizontal', justify, columnGap: -20, padding: 0 }) });
    frame.children.push(createNode('rectangle', { width: 100, height: 20 }), createNode('rectangle', { width: 100, height: 20 }));
    applyAutoLayout(frame);
    return frame.children.map(item => item.x);
  };
  assert.deepEqual(positions('space-between'), [0, 200]);
  assert.deepEqual(positions('space-around'), [30, 170]);
  assert.deepEqual(positions('space-evenly'), [40, 160]);
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

test('grid fixed, hug, and weighted fill columns reflow when the frame resizes', () => {
  const frame = createNode('frame', {
    width: 400, height: 140,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 4, columnGap: 10, padding: 10, columnTracks: [
      { mode: 'fixed', value: 100 }, { mode: 'hug' }, { mode: 'fill', weight: 1 }, { mode: 'fill', weight: 2 }
    ] })
  });
  const fixed = createNode('rectangle', { width: 32, height: 20 });
  const hug = createNode('rectangle', { width: 70, height: 24 });
  const fillOne = createNode('rectangle', { width: 20, height: 20, layoutSizingX: 'fill' });
  const fillTwo = createNode('rectangle', { width: 20, height: 20, layoutSizingX: 'fill' });
  frame.children.push(fixed, hug, fillOne, fillTwo);

  applyAutoLayout(frame);
  assert.deepEqual([fixed.x, fixed.width, hug.x, hug.width, fillOne.x, fillOne.width, fillTwo.x, fillTwo.width], [10, 32, 120, 70, 200, 60, 270, 120]);

  frame.width = 560;
  applyAutoLayout(frame);
  assert.deepEqual([fixed.x, fixed.width, hug.x, hug.width], [10, 32, 120, 70], 'fixed and content tracks keep their authored sizes');
  assert.deepEqual([fillOne.x, fillOne.width, fillTwo.x, fillTwo.width], [200, 113.33333333333333, 323.3333333333333, 226.66666666666666]);
});

test('grid row tracks combine fixed, hug, and weighted fill sizing with row spans and child limits', () => {
  const frame = createNode('frame', {
    width: 120, height: 300,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 1, rows: 3, rowGap: 10, padding: 0,
      rowTracks: [{ mode: 'fixed', value: 40 }, { mode: 'hug' }, { mode: 'fill', weight: 2 }] })
  });
  const fixed = createNode('rectangle', { width: 20, height: 15, gridCell: { row: 1, column: 1 } });
  const hug = createNode('rectangle', { width: 20, height: 60, minHeight: 72, maxHeight: 80, gridCell: { row: 2, column: 1 } });
  const fill = createNode('rectangle', { width: 20, height: 10, layoutSizingY: 'fill', gridCell: { row: 3, column: 1 } });
  frame.children.push(fixed, hug, fill);
  applyAutoLayout(frame);

  assert.deepEqual([fixed.y, fixed.height, hug.y, hug.height, fill.y, fill.height], [0, 15, 50, 72, 132, 168]);
});

test('old grid documents without track definitions keep equal columns and content-sized auto rows', () => {
  const frame = createNode('frame', { width: 220, height: 100, autoLayout: { axis: 'grid', columns: 2, padding: 10, columnGap: 10 } });
  delete frame.autoLayout.columnTracks;
  delete frame.autoLayout.rowTracks;
  const first = createNode('rectangle', { width: 20, height: 24 });
  const second = createNode('rectangle', { width: 20, height: 40 });
  frame.children.push(first, second);

  applyAutoLayout(frame);
  assert.deepEqual([first.x, first.width, second.x, second.width, first.height, second.height], [10, 20, 115, 20, 24, 40]);
  assert.deepEqual(frame.autoLayout.columnTracks, [{ mode: 'fill', weight: 1 }, { mode: 'fill', weight: 1 }]);
  assert.deepEqual(frame.autoLayout.rowTracks, [{ mode: 'hug' }]);
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

test('wrapped stretch alignment sizes items to their own row without overlap', () => {
  const frame = createNode('frame', {
    width: 130, height: 100,
    autoLayout: createAutoLayout({ axis: 'horizontal', wrap: true, align: 'stretch', columnGap: 10, rowGap: 10, padding: 10 })
  });
  const first = createNode('rectangle', { width: 50, height: 10 });
  const second = createNode('rectangle', { width: 50, height: 20 });
  const third = createNode('rectangle', { width: 50, height: 10 });
  frame.children.push(first, second, third);
  applyAutoLayout(frame);
  assert.deepEqual([first.y, first.height, second.height, third.y, third.height], [10, 40, 40, 60, 30]);
  assert.ok(first.y + first.height <= third.y, 'items in the second row should not overlap the first row');
});

test('stretch alignment does not inflate a hug-sized cross axis from the old frame size', () => {
  const frame = createNode('frame', {
    width: 220, height: 100,
    autoLayout: createAutoLayout({ axis: 'horizontal', align: 'stretch', crossSizing: 'hug', padding: 10 })
  });
  const child = createNode('rectangle', { width: 40, height: 20, layoutSizingCross: 'fill' });
  frame.children.push(child);
  applyAutoLayout(frame);
  assert.deepEqual([frame.height, child.height], [40, 20]);
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

test('absolute auto layout children keep explicit coordinates and do not affect flow sizing', () => {
  const frame = createNode('frame', {
    width: 220, height: 100,
    autoLayout: createAutoLayout({ axis: 'horizontal', mainSizing: 'hug', crossSizing: 'hug', gap: 8, padding: 10 })
  });
  const first = createNode('rectangle', { width: 40, height: 20 });
  const floating = createNode('rectangle', { x: 500, y: -35, width: 80, height: 70, layoutPositioning: 'absolute' });
  const last = createNode('rectangle', { width: 20, height: 20 });
  frame.children.push(first, floating, last);

  applyAutoLayout(frame);
  assert.deepEqual([first.x, last.x, frame.width, frame.height], [10, 58, 88, 40]);
  assert.deepEqual([floating.x, floating.y, floating.width, floating.height], [500, -35, 80, 70]);

  delete floating.layoutPositioning;
  applyAutoLayout(frame);
  assert.deepEqual([first.x, floating.x, last.x, frame.width], [10, 58, 146, 176]);
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

test('grid track sizing validates, serializes, and remains optional for older documents', () => {
  const document = createDocument();
  const frame = createNode('frame', { autoLayout: createAutoLayout({ axis: 'grid', columns: 3, rows: 2,
    columnTracks: [{ mode: 'fixed', value: 96 }, { mode: 'hug' }, { mode: 'fill', weight: 1.5 }],
    rowTracks: [{ mode: 'hug' }, { mode: 'fill', weight: 2 }] }) });
  addNode(document, frame);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const invalidMode = structuredClone(document);
  invalidMode.pages[0].children[0].autoLayout.columnTracks[0].mode = 'content';
  assert.throws(() => validateDocument(invalidMode), /Invalid auto layout/);

  const invalidValue = structuredClone(document);
  invalidValue.pages[0].children[0].autoLayout.columnTracks[0].value = -1;
  assert.throws(() => validateDocument(invalidValue), /Invalid auto layout/);

  const invalidWeight = structuredClone(document);
  invalidWeight.pages[0].children[0].autoLayout.rowTracks[1].weight = 0;
  assert.throws(() => validateDocument(invalidWeight), /Invalid auto layout/);

  const legacy = structuredClone(document);
  delete legacy.pages[0].children[0].autoLayout.columnTracks;
  delete legacy.pages[0].children[0].autoLayout.rowTracks;
  assert.equal(validateDocument(legacy), true, 'track definitions remain optional in previously saved documents');
});

test('negative gaps serialize for linear stacks and are rejected for grids', () => {
  const document = createDocument();
  const linear = createNode('frame', { autoLayout: createAutoLayout({ axis: 'horizontal', columnGap: -12 }) });
  addNode(document, linear);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const invalid = structuredClone(document);
  invalid.pages[0].children[0].autoLayout.axis = 'grid';
  assert.throws(() => validateDocument(invalid), /Invalid auto layout/);
});
