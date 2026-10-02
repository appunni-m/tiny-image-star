import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addGridTrack, deleteGridTrack, gridTrackCount, gridTrackMoveRange, gridTrackResizeHandles, moveGridTrack, resizeGridTrack } from '../src/grid-track-editing.js';
import { applyAutoLayout, createAutoLayout } from '../src/layout-engine.js';
import { addNode, cloneDocument, createComponent, createComponentInstance, createDocument, createNode, findNode, parseDocument, serializeDocument, syncAllComponentInstances, validateDocument } from '../src/model.js';
import { removeLayersAtomically } from '../src/layer-deletion.js';

const editorSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const rendererSource = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');
const browserSmoke = await readFile(new URL('./browser-smoke.mjs', import.meta.url), 'utf8');

function fixed(value) { return { mode: 'fixed', value }; }

test('adding a column preserves authored tracks and appends a weighted fill track', () => {
  const frame = createNode('frame', {
    width: 300, height: 120,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 2, rows: 1, padding: 0,
      columnTracks: [fixed(90), { mode: 'hug' }], rowTracks: [fixed(120)] })
  });
  const first = createNode('rectangle', { width: 30, height: 20, gridCell: { row: 1, column: 1 } });
  const second = createNode('rectangle', { width: 40, height: 20, gridCell: { row: 1, column: 2 } });
  frame.children.push(first, second);
  applyAutoLayout(frame);

  assert.equal(addGridTrack(frame, 'columnTracks'), true);
  assert.equal(frame.autoLayout.columns, 3);
  assert.deepEqual(frame.autoLayout.columnTracks, [fixed(90), { mode: 'hug' }, { mode: 'fill', weight: 1 }]);
  assert.equal(gridTrackCount(frame, 'columnTracks'), 3);
  assert.equal(first.width, 30);
  assert.equal(second.width, 40);
});

test('adding a row converts auto rows to fixed count without changing current hug tracks', () => {
  const frame = createNode('frame', {
    width: 240, height: 200,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 1, rows: 'auto', autoPositioning: false, padding: 0,
      rowTracks: [{ mode: 'hug' }, { mode: 'hug' }] })
  });
  frame.children.push(
    createNode('rectangle', { width: 40, height: 20, gridCell: { row: 1, column: 1 } }),
    createNode('rectangle', { width: 40, height: 30, gridCell: { row: 2, column: 1 } })
  );
  applyAutoLayout(frame);
  assert.equal(gridTrackCount(frame, 'rowTracks'), 2);

  assert.equal(addGridTrack(frame, 'rowTracks'), true);
  assert.equal(frame.autoLayout.rows, 3);
  assert.deepEqual(frame.autoLayout.rowTracks, [{ mode: 'hug' }, { mode: 'hug' }, { mode: 'fill', weight: 1 }]);
  assert.deepEqual(frame.children.map(child => child.gridCell.row), [1, 2]);
});

test('deleting a column removes its single-cell contents, contracts spans, and shifts following cells', () => {
  const frame = createNode('frame', {
    width: 300, height: 180,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 3, rows: 2, autoPositioning: false, padding: 0,
      columnGap: 10, rowGap: 10,
      columnTracks: [fixed(80), fixed(90), fixed(100)], rowTracks: [fixed(80), fixed(80)] })
  });
  const left = createNode('rectangle', { width: 30, height: 20, gridCell: { row: 1, column: 1 } });
  const spanning = createNode('rectangle', { width: 20, height: 20, layoutSizingX: 'fill', gridCell: { row: 1, column: 2, columnSpan: 2 } });
  const removed = createNode('rectangle', { width: 20, height: 20, gridCell: { row: 2, column: 2 } });
  const shifted = createNode('rectangle', { width: 20, height: 20, gridCell: { row: 2, column: 3 } });
  frame.children.push(left, spanning, removed, shifted);
  applyAutoLayout(frame);

  const result = deleteGridTrack(frame, 'columnTracks', 1);
  assert.deepEqual(result, { changed: true, removedNodeIds: [removed.id] });
  assert.equal(frame.autoLayout.columns, 2);
  assert.deepEqual(frame.autoLayout.columnTracks, [fixed(80), fixed(100)]);
  assert.deepEqual(spanning.gridCell, { row: 1, column: 2, columnSpan: 1, rowSpan: 1, alignX: 'start', alignY: 'start' });
  assert.equal(shifted.gridCell.column, 2);

  frame.children = frame.children.filter(child => child.id !== removed.id);
  applyAutoLayout(frame);
  assert.deepEqual([spanning.x, spanning.width, shifted.x], [90, 100, 90]);
});

test('deleting an auto row removes its visible cells and compacts higher rows', () => {
  const frame = createNode('frame', {
    width: 140, height: 200,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 1, rows: 'auto', autoPositioning: false, padding: 0,
      rowGap: 8, rowTracks: [{ mode: 'hug' }, { mode: 'hug' }, { mode: 'hug' }] })
  });
  const first = createNode('rectangle', { width: 30, height: 20, gridCell: { row: 1, column: 1 } });
  const second = createNode('rectangle', { width: 30, height: 20, gridCell: { row: 2, column: 1 } });
  const third = createNode('rectangle', { width: 30, height: 20, gridCell: { row: 3, column: 1 } });
  frame.children.push(first, second, third);
  applyAutoLayout(frame);

  const result = deleteGridTrack(frame, 'rowTracks', 0);
  assert.deepEqual(result, { changed: true, removedNodeIds: [first.id] });
  assert.equal(frame.autoLayout.rows, 'auto');
  assert.deepEqual([second.gridCell.row, third.gridCell.row], [1, 2]);
  assert.equal(gridTrackCount(frame, 'rowTracks'), 2);
});

test('deleting a track also removes hidden single-cell layers contained in it', () => {
  const frame = createNode('frame', {
    width: 120, height: 160,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 1, rows: 2, autoPositioning: false, padding: 0,
      columnTracks: [fixed(120)], rowTracks: [fixed(70), fixed(70)] })
  });
  const hidden = createNode('rectangle', { visible: false, gridCell: { row: 1, column: 1 } });
  const retained = createNode('rectangle', { gridCell: { row: 2, column: 1 } });
  frame.children.push(hidden, retained);
  applyAutoLayout(frame);

  const result = deleteGridTrack(frame, 'rowTracks', 0);

  assert.deepEqual(result.removedNodeIds, [hidden.id], 'hidden contents still belong to the deleted track');
  assert.equal(retained.gridCell.row, 1, 'layers in the following row shift into the freed row');
});

test('reordering a track moves a whole span block and keeps every cell contiguous', () => {
  const frame = createNode('frame', {
    width: 420, height: 120,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 4, rows: 1, autoPositioning: false, padding: 0,
      columnTracks: [fixed(80), fixed(90), fixed(100), fixed(110)], rowTracks: [fixed(120)] })
  });
  const first = createNode('rectangle', { gridCell: { row: 1, column: 1 } });
  const spanning = createNode('rectangle', { layoutSizingX: 'fill', gridCell: { row: 1, column: 2, columnSpan: 2 } });
  const last = createNode('rectangle', { gridCell: { row: 1, column: 4 } });
  frame.children.push(first, spanning, last);
  applyAutoLayout(frame);

  assert.deepEqual(gridTrackMoveRange(frame, 'columnTracks', 1), { start: 1, end: 2 });
  const result = moveGridTrack(frame, 'columnTracks', 1, 1);

  assert.deepEqual(result, { changed: true, movedTrackCount: 2, fromIndex: 1, toIndex: 2 });
  assert.deepEqual(frame.autoLayout.columnTracks, [fixed(80), fixed(110), fixed(90), fixed(100)]);
  assert.deepEqual(spanning.gridCell, { row: 1, column: 3, columnSpan: 2, rowSpan: 1, alignX: 'start', alignY: 'start' });
  assert.equal(last.gridCell.column, 2);
});

test('reordering row tracks remaps manual cells and rejects moves beyond the grid edges', () => {
  const frame = createNode('frame', {
    width: 140, height: 240,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 1, rows: 3, autoPositioning: false, padding: 0,
      rowTracks: [fixed(60), fixed(80), fixed(100)] })
  });
  const first = createNode('rectangle', { gridCell: { row: 1, column: 1 } });
  const second = createNode('rectangle', { gridCell: { row: 2, column: 1 } });
  const third = createNode('rectangle', { gridCell: { row: 3, column: 1 } });
  frame.children.push(first, second, third);
  applyAutoLayout(frame);

  assert.deepEqual(moveGridTrack(frame, 'rowTracks', 0, -1), { changed: false, movedTrackCount: 0 });
  assert.deepEqual(moveGridTrack(frame, 'rowTracks', 1, -1), { changed: true, movedTrackCount: 1, fromIndex: 1, toIndex: 0 });
  assert.deepEqual(frame.autoLayout.rowTracks, [fixed(80), fixed(60), fixed(100)]);
  assert.deepEqual([first.gridCell.row, second.gridCell.row, third.gridCell.row], [2, 1, 3]);
});

test('resizing adjacent fixed tracks preserves their combined size and rounds to hundredths', () => {
  const frame = createNode('frame', {
    width: 320, height: 100,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 2, rows: 1, columnGap: 20, padding: 0,
      columnTracks: [fixed(100), fixed(200)] })
  });
  const first = createNode('rectangle', { width: 20, height: 20, gridCell: { row: 1, column: 1 } });
  const second = createNode('rectangle', { width: 20, height: 20, gridCell: { row: 1, column: 2 } });
  frame.children.push(first, second);
  applyAutoLayout(frame);

  assert.equal(resizeGridTrack(frame, 'columnTracks', 0, 142.345, { adjacentIndex: 1, adjacentSize: 157.655 }), true);
  assert.deepEqual(frame.autoLayout.columnTracks, [fixed(142.35), fixed(157.65)]);
  assert.deepEqual([first.x, first.width, second.x, second.width], [0, 20, 162.35, 20]);
});

test('resizing a fill divider fixes the dragged track and lets the remaining fill track absorb the delta', () => {
  const frame = createNode('frame', {
    width: 300, height: 100,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 2, rows: 1, padding: 0,
      columnTracks: [{ mode: 'fill', weight: 1 }, { mode: 'fill', weight: 1 }] })
  });
  frame.children.push(
    createNode('rectangle', { width: 20, height: 20, layoutSizingX: 'fill', gridCell: { row: 1, column: 1 } }),
    createNode('rectangle', { width: 20, height: 20, layoutSizingX: 'fill', gridCell: { row: 1, column: 2 } })
  );
  applyAutoLayout(frame);

  assert.equal(resizeGridTrack(frame, 'columnTracks', 0, 175), true);
  assert.deepEqual(frame.autoLayout.columnTracks, [fixed(175), { mode: 'fill', weight: 1 }]);
  assert.deepEqual(frame.children.map(child => child.width), [175, 117]);
});

test('resizing an auto row makes the current row count explicit and preserves hug siblings', () => {
  const frame = createNode('frame', {
    width: 100, height: 180,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 1, rows: 'auto', autoPositioning: false, padding: 0,
      rowTracks: [{ mode: 'hug' }, { mode: 'hug' }] })
  });
  frame.children.push(
    createNode('rectangle', { width: 20, height: 20, gridCell: { row: 1, column: 1 } }),
    createNode('rectangle', { width: 20, height: 45, gridCell: { row: 2, column: 1 } })
  );
  applyAutoLayout(frame);

  assert.equal(resizeGridTrack(frame, 'rowTracks', 0, 60), true);
  assert.equal(frame.autoLayout.rows, 2);
  assert.deepEqual(frame.autoLayout.rowTracks, [fixed(60), { mode: 'hug' }]);
  assert.deepEqual(frame.children.map(child => child.y), [0, 68]);
  assert.equal(resizeGridTrack(frame, 'rowTracks', 5, 60), false);
  assert.equal(resizeGridTrack(frame, 'rowTracks', 0, Infinity), false);
});

test('canvas resize grabbers sit at measured track dividers in frame-local coordinates', () => {
  const frame = createNode('frame', {
    width: 300, height: 200,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 2, rows: 2, padding: 0, columnGap: 20, rowGap: 10,
      columnTracks: [fixed(100), fixed(180)], rowTracks: [fixed(40), fixed(80)] })
  });
  const handles = gridTrackResizeHandles(frame);
  assert.deepEqual(handles, [
    { axis: 'columnTracks', trackIndex: 0, adjacentIndex: 1, point: { x: 110, y: 100 } },
    { axis: 'rowTracks', trackIndex: 0, adjacentIndex: 1, point: { x: 150, y: 45 } }
  ]);
});

test('selected grid frames draw and drag the same track handles through saved auto layout', () => {
  assert.match(editorSource, /function gridTrackResizeHandleAt\(world, pointerType = 'mouse'\)[\s\S]*?gridTrackResizeHandles\(geometry\)/);
  assert.match(editorSource, /const gridHandle = gridTrackResizeHandleAt\(world, event.pointerType\)[\s\S]*?beginCanvasHistoryTransaction\('Resize grid track'\)/);
  assert.match(editorSource, /if \(interaction\.kind === 'grid-track-resize'\)[\s\S]*?resizeGridTrack\(interaction\.frame, interaction\.axis/);
  assert.match(editorSource, /if \(interaction\.kind === 'grid-track-resize'\)[\s\S]*?recordComponentOverride\(instanceRoot, frame, 'autoLayout'\)[\s\S]*?queueSave\(\)/);
  assert.match(rendererSource, /gridTrackResizeHandles\(node\)/);
  assert.match(browserSmoke, /drag a grid track divider[\s\S]*?should resize both adjacent fixed tracks and persist the exact sizes/);
});

test('last tracks and invalid track indexes are protected', () => {
  const frame = createNode('frame', {
    width: 100, height: 100,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 1, rows: 1 })
  });
  assert.deepEqual(deleteGridTrack(frame, 'columnTracks', 0), { changed: false, removedNodeIds: [] });
  assert.deepEqual(deleteGridTrack(frame, 'rowTracks', 4), { changed: false, removedNodeIds: [] });
  assert.equal(addGridTrack(frame, 'columnTracks'), true);
  const fullGrid = createNode('frame', {
    width: 100, height: 100,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 64, rows: 1 })
  });
  assert.equal(addGridTrack(fullGrid, 'columnTracks'), false);
});

test('track deletion composes with atomic layer removal and survives a saved-document reload', () => {
  const document = createDocument();
  const frame = createNode('frame', {
    width: 220, height: 120,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 2, rows: 1, autoPositioning: false,
      columnTracks: [fixed(100), fixed(100)], rowTracks: [fixed(100)] })
  });
  const retained = createNode('rectangle', { gridCell: { row: 1, column: 1 } });
  const removed = createNode('rectangle', { gridCell: { row: 1, column: 2 } });
  addNode(document, frame);
  addNode(document, retained, { parentId: frame.id });
  addNode(document, removed, { parentId: frame.id });

  const candidate = cloneDocument(document);
  const candidateFrame = findNode(candidate, frame.id).node;
  const operation = deleteGridTrack(candidateFrame, 'columnTracks', 1);
  const nextDocument = operation.removedNodeIds.length
    ? removeLayersAtomically(candidate, operation.removedNodeIds).document : candidate;
  assert.equal(findNode(nextDocument, removed.id), null);
  assert.deepEqual(findNode(nextDocument, frame.id).node.autoLayout.columnTracks, [fixed(100)]);
  assert.equal(validateDocument(parseDocument(serializeDocument(nextDocument))), true);
  assert.ok(findNode(document, removed.id), 'the source document stays untouched until the caller commits the candidate');
});

test('deleting a grid track keeps its component-instance contents removed through save-time sync and reload', () => {
  const document = createDocument();
  const master = createNode('frame', {
    width: 220, height: 120,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 2, rows: 1, autoPositioning: false,
      columnTracks: [fixed(100), fixed(100)], rowTracks: [fixed(100)] })
  });
  const retainedMaster = createNode('rectangle', { gridCell: { row: 1, column: 1 } });
  const deletedMaster = createNode('rectangle', { gridCell: { row: 1, column: 2 } });
  addNode(document, master);
  addNode(document, retainedMaster, { parentId: master.id });
  addNode(document, deletedMaster, { parentId: master.id });
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  const instanceFrame = findNode(document, instance.id).node;
  const deletedInstanceLayer = instanceFrame.children.find(child => child.componentSourceId === deletedMaster.id);

  const candidate = cloneDocument(document);
  const candidateFrame = findNode(candidate, instance.id).node;
  const trackEdit = deleteGridTrack(candidateFrame, 'columnTracks', 1);
  candidateFrame.componentOverrides[candidateFrame.componentSourceId] = {
    autoLayout: structuredClone(candidateFrame.autoLayout)
  };
  const nextDocument = removeLayersAtomically(candidate, trackEdit.removedNodeIds).document;

  assert.equal(findNode(nextDocument, deletedInstanceLayer.id), null);
  syncAllComponentInstances(nextDocument);
  const reloaded = parseDocument(serializeDocument(nextDocument));
  syncAllComponentInstances(reloaded);
  assert.equal(findNode(reloaded, deletedInstanceLayer.id), null,
    'the layer removed with its grid track must not return during component refresh or reload');
  assert.ok(findNode(reloaded, retainedMaster.id), 'the component source and its other track remain intact');
  assert.equal(findNode(reloaded, instance.id).node.children.some(child => child.id === deletedInstanceLayer.id), false);
  assert.equal(validateDocument(reloaded), true);
});

test('grid track controls capture the frame identity and route destructive edits through the atomic helper', () => {
  const section = editorSource.slice(editorSource.indexOf('function gridTrackEditor('), editorSource.indexOf('\nfunction visibleGridRowCount', editorSource.indexOf('function gridTrackEditor(')));
  assert.match(section, /data-action="delete-grid-track" data-frame-id="\$\{escapeHtml\(node\.id\)\}" data-axis="\$\{axis\}" data-track-index="\$\{index\}"/);
  assert.match(section, /data-action="add-grid-track" data-frame-id="\$\{escapeHtml\(node\.id\)\}" data-axis="\$\{axis\}"/);
  assert.match(section, /data-action="grid-track-move-menu" data-frame-id="\$\{escapeHtml\(node\.id\)\}" data-axis="\$\{axis\}" data-track-index="\$\{index\}"/);
  assert.match(editorSource, /function openGridTrackMoveMenu\(button\)[\s\S]*?gridTrackMoveRange\(entry\.node, axis, trackIndex\)[\s\S]*?label: `Move \$\{trackLabel\} \$\{label\}`/);
  const dispatchStart = editorSource.indexOf("if (action === 'add-grid-track' || action === 'delete-grid-track' || action === 'move-grid-track') {");
  const dispatchEnd = editorSource.indexOf("if (node?.type === 'slice'", dispatchStart);
  assert.ok(dispatchStart >= 0 && dispatchEnd > dispatchStart);
  const dispatch = editorSource.slice(dispatchStart, dispatchEnd);
  assert.match(dispatch, /deleteGridTrack\(frame, axis, trackIndex\)/);
  assert.match(dispatch, /moveGridTrack\(frame, axis, trackIndex, direction\)/);
  assert.match(dispatch, /removeLayersAtomically\(candidate, removedNodeIds, pageId\)/);
  assert.match(dispatch, /recordComponentOverride\(instanceRoot, frame, 'autoLayout'\)/);
  assert.match(dispatch, /recordComponentOverride\(instanceRoot, child, 'gridCell'\)/);
  assert.match(dispatch, /queueSave\(\{ syncComponents: removedNodeIds\.length === 0 \}\)/,
    'deleting grid-cell layers must not run a second component projection after atomic removal');
});

test('grid track controls disable when the frame or any ancestor is locked', () => {
  const editor = editorSource.slice(editorSource.indexOf('function gridTrackEditor('), editorSource.indexOf('\nfunction visibleGridRowCount', editorSource.indexOf('function gridTrackEditor(')));
  assert.match(editor, /function gridTrackEditor\(node, axis, count, tracks, fallbackMode, locked = node\.locked\)/);
  assert.match(editor, /locked \|\| count <= 1 \? ' disabled' : ''/,
    'track deletion should be disabled for a locked frame or its locked ancestor');
  assert.match(editor, /aria-label="Add \$\{trackKind\}"\$\{locked \|\| count >= 64 \? ' disabled' : ''\}/,
    'track creation should be disabled for a locked frame or its locked ancestor');
  const autoLayout = editorSource.slice(editorSource.indexOf('function autoLayoutSection('), editorSource.indexOf('\nfunction guideNumberField', editorSource.indexOf('function autoLayoutSection(')));
  assert.match(autoLayout, /const trackLocked = node\.locked \|\| Boolean\(entry\?\.parents\.some\(parent => parent\.locked\)\)/);
  assert.match(autoLayout, /gridTrackEditor\(node, 'columnTracks',[\s\S]*?trackLocked\)/);
  assert.match(autoLayout, /gridTrackEditor\(node, 'rowTracks',[\s\S]*?trackLocked\)/);
});
