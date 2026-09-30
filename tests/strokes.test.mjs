import test from 'node:test';
import assert from 'node:assert/strict';
import { createNode } from '../src/model.js';
import {
  MAX_STROKES_PER_NODE, addStroke, createStroke, detachPrimaryStrokeBinding,
  ensureStrokeStack, isValidStrokeStack, moveStroke, removeStroke,
  strokeStackForNode, syncLegacyStrokeFields, updateStroke
} from '../src/strokes.js';

test('legacy scalar strokes expose a stable read-only item and materialize without changing appearance', () => {
  const node = createNode('rectangle', { id: 'legacy', stroke: '#123456', strokeWidth: 4, strokePattern: 'dashed', strokeCap: 'square' });
  const first = strokeStackForNode(node);
  const second = strokeStackForNode(node);
  assert.deepEqual(first, second);
  assert.equal(first[0].id, 'legacy-stroke:legacy');
  assert.deepEqual(first[0], {
    id: 'legacy-stroke:legacy', color: '#123456', width: 4, opacity: 1,
    visible: true, cap: 'square', join: 'miter', pattern: 'dashed', miterLimit: 10
  });
  assert.equal(Object.hasOwn(node, 'strokes'), false, 'reading a legacy design must not rewrite it');
  assert.deepEqual(ensureStrokeStack(node), first);
  assert.equal(Object.hasOwn(node, 'strokes'), true);
});

test('stroke stack operations preserve order, enforce a cap, and mirror the primary to legacy fields', () => {
  const node = createNode('line', { stroke: '#102030', strokeWidth: 2 });
  const legacy = ensureStrokeStack(node)[0];
  const next = createStroke({ id: 'outer', color: '#abcdef', width: 7, opacity: .5, visible: false });
  assert.equal(addStroke(node, next), true);
  assert.deepEqual(node.strokes.map(stroke => stroke.id), [legacy.id, 'outer']);
  assert.equal(node.stroke, '#102030');
  assert.equal(moveStroke(node, 'outer', 'up'), true);
  assert.deepEqual(node.strokes.map(stroke => stroke.id), ['outer', legacy.id]);
  assert.equal(node.stroke, '#abcdef');
  assert.equal(node.strokeWidth, 7);
  assert.equal(node.strokeOpacity, .5);
  assert.equal(removeStroke(node, 'outer').id, 'outer');
  assert.equal(node.stroke, '#102030');

  const capped = createNode('rectangle', { strokes: Array.from({ length: MAX_STROKES_PER_NODE }, (_, index) => createStroke({ id: `s${index}` })) });
  assert.equal(addStroke(capped, createStroke({ id: 'overflow' })), false);
  assert.equal(capped.strokes.length, MAX_STROKES_PER_NODE);
});

test('stroke edits validate independently and removing the stack clears stale scalar bindings', () => {
  const node = createNode('rectangle', { stroke: '#445566', strokeWidth: 3, strokeVariableId: 'variable-1', variableBindings: { stroke: 'variable-1', fill: 'variable-2' } });
  const stroke = ensureStrokeStack(node)[0];
  assert.equal(detachPrimaryStrokeBinding(node, stroke, '#778899'), true);
  assert.equal(stroke.color, '#778899');
  updateStroke(node, stroke.id, { color: '#aabbcc', width: 9, opacity: .25, visible: false, pattern: 'dotted', cap: 'round', join: 'bevel', miterLimit: 4 });
  assert.equal(stroke.color, '#aabbcc');
  assert.equal(stroke.width, 9);
  assert.equal(stroke.opacity, .25);
  assert.equal(isValidStrokeStack(node.strokes, node), true);
  for (const bad of [
    [{ ...stroke, width: -1 }],
    [{ ...stroke, opacity: 1.1 }],
    [{ ...stroke, cap: 'triangle' }],
    [{ ...stroke, pattern: 'dotted', cap: 'butt' }],
    [{ ...stroke }, { ...stroke }]
  ]) assert.equal(isValidStrokeStack(bad, node), false);

  removeStroke(node, stroke.id);
  syncLegacyStrokeFields(node);
  assert.deepEqual(node.strokes, []);
  assert.equal(node.stroke, null);
  assert.equal(node.strokeWidth, 0);
  assert.equal(node.strokeVariableId, undefined);
  assert.deepEqual(node.variableBindings, { fill: 'variable-2' });
});
