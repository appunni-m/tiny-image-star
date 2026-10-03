import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultStrokeDashArray, isValidStrokeDashArray, normalizeStrokeDashArray, parseStrokeDashArray,
  strokeDashArray, applyStrokeStyle
} from '../src/stroke-style.js';
import { addNode, createDocument, createNode, validateDocument } from '../src/model.js';
import { createStroke, updateStroke } from '../src/strokes.js';

test('custom dash arrays normalize alternating SVG lengths and reject unsafe values', () => {
  assert.deepEqual(normalizeStrokeDashArray([3, 5]), [3, 5]);
  assert.deepEqual(normalizeStrokeDashArray([1, 2, 3]), [1, 2, 3, 1, 2, 3]);
  assert.deepEqual(normalizeStrokeDashArray([0, 4]), [0, 4]);
  assert.equal(normalizeStrokeDashArray([]), null);
  assert.equal(normalizeStrokeDashArray([0, 0]), null);
  assert.equal(normalizeStrokeDashArray([-1, 2]), null);
  assert.equal(normalizeStrokeDashArray([1, Infinity]), null);
  assert.equal(normalizeStrokeDashArray([true, 2]), null);
  assert.equal(normalizeStrokeDashArray([Symbol('bad'), 2]), null);
  assert.equal(normalizeStrokeDashArray([, 2]), null);
  assert.equal(normalizeStrokeDashArray(Array.from({ length: 17 }, () => 1)), null);
  assert.equal(normalizeStrokeDashArray(Array.from({ length: 9 }, () => 1)), null);
  assert.equal(isValidStrokeDashArray([0, 4]), true);
  assert.equal(isValidStrokeDashArray([4]), false);
  assert.equal(isValidStrokeDashArray([0, 0]), false);
  assert.equal(isValidStrokeDashArray([, 4]), false);
  assert.deepEqual(parseStrokeDashArray('1.5, 2e1 0'), [1.5, 20, 0, 1.5, 20, 0]);
  assert.equal(parseStrokeDashArray('-1 2'), null);
  assert.equal(parseStrokeDashArray('1 nope'), null);
});

test('custom strokes always have a bounded valid dash pattern at creation and update', () => {
  assert.deepEqual(defaultStrokeDashArray(0), [1, 1]);
  assert.deepEqual(defaultStrokeDashArray(3), [12, 6]);
  assert.deepEqual(defaultStrokeDashArray(100_000), [100_000, 100_000]);
  assert.deepEqual(defaultStrokeDashArray(Symbol('bad')), [4, 2]);

  assert.throws(() => createStroke(null), /overrides must be an object/u);
  const implicit = createStroke({ id: 'custom-default', pattern: 'custom', width: 2 });
  assert.deepEqual(implicit.dashArray, [8, 4]);
  const inferred = createStroke({ id: 'custom-inferred', width: 3, dashArray: [2, 4, 6] });
  assert.equal(inferred.pattern, 'custom');
  assert.deepEqual(inferred.dashArray, [2, 4, 6, 2, 4, 6]);
  assert.throws(() => createStroke({ pattern: 'custom', dashArray: [0, 0] }), /custom stroke dash array/u);

  const node = { strokes: [createStroke({ id: 'solid', width: 3 })] };
  const stroke = node.strokes[0];
  updateStroke(node, stroke.id, { pattern: 'custom' });
  assert.deepEqual(stroke.dashArray, [12, 6]);
  updateStroke(node, stroke.id, { dashArray: [5, 7] });
  assert.equal(stroke.pattern, 'custom', 'an explicit dash array selects the custom pattern');
  assert.deepEqual(stroke.dashArray, [5, 7]);
  updateStroke(node, stroke.id, { pattern: 'custom', dashArray: null });
  assert.deepEqual(stroke.dashArray, [12, 6], 'custom with an empty value returns to a valid default pattern');
  updateStroke(node, stroke.id, { dashArray: null });
  assert.equal(stroke.pattern, 'solid', 'clearing the only custom pattern data cannot leave an invalid stroke');
  assert.equal(Object.hasOwn(stroke, 'dashArray'), false);
});

test('custom stroke patterns render their literal lengths and survive document validation', () => {
  const stroke = createStroke({
    id: 'custom-dash', pattern: 'custom', dashArray: [3, 5, 0, 2]
  });
  const node = createNode('line', {
    id: 'custom-line', width: 20, height: 0, stroke: '#123456', strokeWidth: 2,
    strokePattern: 'custom', strokeDashArray: [3, 5], strokes: [stroke]
  });
  assert.deepEqual(strokeDashArray({ strokeWidth: 2, strokePattern: 'custom', dashArray: stroke.dashArray }), [3, 5, 0, 2]);
  const context = { setLineDash(value) { this.dash = value; } };
  applyStrokeStyle(context, { width: 2, pattern: 'custom', dashArray: [3, 5, 0, 2], cap: 'square' });
  assert.deepEqual(context.dash, [3, 5, 0, 2]);
  assert.equal(context.lineCap, 'square');
  const document = createDocument();
  addNode(document, node);
  assert.equal(validateDocument(document), true);
});

test('changing away from custom clears stale dash values while edits keep them', () => {
  const stroke = createStroke({ id: 'custom-dash', pattern: 'custom', dashArray: [3, 5] });
  updateStroke({ strokes: [stroke] }, stroke.id, { dashArray: [2, 6] });
  assert.deepEqual(stroke.dashArray, [2, 6]);
  updateStroke({ strokes: [stroke] }, stroke.id, { pattern: 'dashed' });
  assert.equal(stroke.pattern, 'dashed');
  assert.equal(Object.hasOwn(stroke, 'dashArray'), false);
});

test('invalid dash updates fail before changing any stroke properties', () => {
  const stroke = createStroke({ id: 'atomic-dash', color: '#123456', width: 2 });
  const node = { strokes: [stroke] };
  assert.throws(() => updateStroke(node, stroke.id, { color: '#abcdef', pattern: 'custom', dashArray: [0, 0] }), /custom stroke dash array/u);
  assert.equal(stroke.color, '#123456');
  assert.equal(stroke.pattern, 'solid');
  assert.equal(Object.hasOwn(stroke, 'dashArray'), false);
  assert.throws(() => updateStroke(node, stroke.id, null), /updates must be an object/u);
});
