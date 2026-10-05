import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, addVariableMode, bindColorVariable, bindVariable, combineBoolean,
  createComponent, createComponentInstance, createDocument, createNode,
  createVariable, createVariableCollection, findNode, getBooleanStrokePath,
  parseDocument, serializeDocument, setFrameVariableMode, setVariableValue,
  syncAllComponentInstances, validateDocument
} from '../src/model.js';
import { addStroke, createStroke, isValidStrokeStack } from '../src/strokes.js';
import { applyHostTypedOperation } from '../src/collaboration/host-operation-engine.js';
import { selectLayersWithSamePaint } from '../src/select-similar-layers.js';

function fixture() {
  const document = createDocument();
  const base = createNode('rectangle', { width: 120, height: 100 });
  const cutter = createNode('rectangle', { x: 30, y: 20, width: 50, height: 60 });
  addNode(document, base); addNode(document, cutter);
  const group = combineBoolean(document, [base.id, cutter.id], 'subtract');
  return { document, group };
}

test('ordered Boolean result outlines survive local reload without baking their source layers', () => {
  const { document, group } = fixture();
  const sourceIds = group.children.map(child => child.id);
  addStroke(group, createStroke({ width: 8, alignment: 'outside', color: '#1a2b3c', opacity: .6 }));
  addStroke(group, createStroke({ width: 3, alignment: 'inside', pattern: 'custom', dashArray: [3, 7], join: 'round' }));
  const before = getBooleanStrokePath(document, group);
  assert.equal(before.subpaths.length, 1, 'subtract preserves the inner cutout boundary');
  const loaded = parseDocument(serializeDocument(document));
  const restored = findNode(loaded, group.id).node;
  assert.equal(restored.type, 'boolean');
  assert.deepEqual(restored.children.map(child => child.id), sourceIds);
  assert.deepEqual(restored.strokes, group.strokes);
  assert.equal(isValidStrokeStack(restored.strokes, restored), true);
  assert.deepEqual(getBooleanStrokePath(loaded, restored).points, before.points);
  restored.children[1].x += 12;
  assert.notDeepEqual(getBooleanStrokePath(loaded, restored).subpaths, before.subpaths,
    'editing an operand updates the derived outline after reload');
  assert.equal(validateDocument(loaded), true);
});

test('Boolean result outline overrides persist through component synchronization and reload', () => {
  const { document, group } = fixture();
  const master = createNode('frame', { children: [group] });
  document.pages[0].children = [master];
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  const instanceGroup = instance.children[0];
  addStroke(instanceGroup, createStroke({ width: 6, alignment: 'outside' }));
  instance.componentOverrides[instanceGroup.componentSourceId] = {
    strokes: structuredClone(instanceGroup.strokes),
    stroke: instanceGroup.stroke, strokeWidth: instanceGroup.strokeWidth,
    strokeAlignment: instanceGroup.strokeAlignment
  };
  const loaded = parseDocument(serializeDocument(document));
  syncAllComponentInstances(loaded);
  const result = findNode(loaded, instance.id).node.children[0];
  assert.equal(result.type, 'boolean');
  assert.equal(result.strokes[0].alignment, 'outside');
  assert.equal(result.strokes[0].width, 6);
  assert.equal(result.children.length, 2);
  assert.equal(getBooleanStrokePath(loaded, result).type, 'path');
  assert.equal(findNode(loaded, group.id).node.strokes, undefined, 'the master remains unmodified');
  assert.equal(validateDocument(loaded), true);
});

test('typed collaboration can add and edit result strokes while invalid edits leave the base untouched', () => {
  const { document, group } = fixture();
  const operation = (property, value) => ({
    type: 'SetProperty', opId: `outline-${property.replaceAll('.', '-')}`, baseRevision: 0,
    pageId: document.activePageId, targetId: group.id, property, value
  });
  const strokes = [createStroke({ alignment: 'inside', width: 4 })];
  const withOutline = applyHostTypedOperation(document, operation('strokes', strokes));
  const outside = applyHostTypedOperation(withOutline, operation('strokes.0.alignment', 'outside'));
  const restored = parseDocument(serializeDocument(outside));
  const result = findNode(restored, group.id).node;
  assert.equal(result.strokes[0].alignment, 'outside');
  assert.equal(getBooleanStrokePath(restored, result).subpaths.length, 1);
  assert.equal(group.strokes, undefined);
  const snapshot = serializeDocument(outside);
  assert.throws(() => applyHostTypedOperation(outside, operation('strokes.0.alignment', 'invalid')));
  assert.throws(() => applyHostTypedOperation(outside, operation('strokes.0.sideMode', 'top')));
  assert.equal(serializeDocument(outside), snapshot);
});

test('Boolean outline geometry follows inherited variable modes and bound source coverage', () => {
  const { document, group } = fixture();
  const frame = createNode('frame');
  frame.children = [group];
  document.pages[0].children = [frame];
  const collection = createVariableCollection(document, 'Geometry');
  const wide = addVariableMode(document, collection.id, 'Wide');
  const width = createVariable(document, collection.id, 'Cutout width', 'number', 50);
  setVariableValue(document, width.id, 70, wide.id);
  const paint = createVariable(document, collection.id, 'Source paint', 'color', '#123456');
  const opacity = createVariable(document, collection.id, 'Source opacity', 'number', 1);
  setVariableValue(document, opacity.id, .5, wide.id);
  assert.equal(bindVariable(document, group.children[1].id, width.id, 'width'), true);
  const narrow = getBooleanStrokePath(document, group);
  setFrameVariableMode(document, frame.id, collection.id, wide.id);
  const wider = getBooleanStrokePath(document, group);
  assert.notDeepEqual(wider.subpaths, narrow.subpaths);
  assert.equal(bindColorVariable(document, group.children[1].id, paint.id), true);
  assert.equal(bindVariable(document, group.children[1].id, opacity.id, 'opacity'), true);
  assert.throws(() => getBooleanStrokePath(document, group), /opaque|translucent/i);
  setFrameVariableMode(document, frame.id, collection.id, collection.defaultModeId);
  assert.doesNotThrow(() => getBooleanStrokePath(document, group));
});

test('Boolean outlines use color bindings and participate in same-stroke selection', () => {
  const { document, group } = fixture();
  addStroke(group, createStroke({ alignment: 'outside', width: 5, color: '#112233' }));
  const shape = createNode('ellipse', { strokes: [createStroke({ alignment: 'outside', width: 5, color: '#112233' })] });
  addNode(document, shape);
  assert.deepEqual(selectLayersWithSamePaint(document.pages[0].children, group, 'stroke'), [group.id, shape.id]);
  const collection = createVariableCollection(document, 'Stroke colors');
  const color = createVariable(document, collection.id, 'Accent', 'color', '#aabbcc');
  assert.equal(bindColorVariable(document, group.id, color.id, 'stroke'), true);
  assert.equal(getBooleanStrokePath(document, group).strokes[0].color, '#aabbcc');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});
