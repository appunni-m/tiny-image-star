import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addGridTrack, deleteGridTrack, gridTrackCount } from '../src/grid-track-editing.js';
import { applyAutoLayout, createAutoLayout } from '../src/layout-engine.js';
import { addNode, cloneDocument, createComponent, createComponentInstance, createDocument, createNode, findNode, parseDocument, serializeDocument, syncAllComponentInstances, validateDocument } from '../src/model.js';
import { removeLayersAtomically } from '../src/layer-deletion.js';

const editorSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

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
  const dispatchStart = editorSource.indexOf("if (action === 'add-grid-track' || action === 'delete-grid-track') {");
  const dispatchEnd = editorSource.indexOf("if (node?.type === 'slice'", dispatchStart);
  assert.ok(dispatchStart >= 0 && dispatchEnd > dispatchStart);
  const dispatch = editorSource.slice(dispatchStart, dispatchEnd);
  assert.match(dispatch, /deleteGridTrack\(frame, axis, trackIndex\)/);
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
