import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITOR_NUMBER_STEP, formatEditorNumber } from '../src/editor-number-format.js';

test('editor geometry precision supports and displays hundredth-point values', () => {
  assert.equal(EDITOR_NUMBER_STEP, 0.01);
  assert.equal(formatEditorNumber(12.34), '12.34');
  assert.equal(formatEditorNumber(12.3), '12.3');
  assert.equal(formatEditorNumber(12), '12');
  assert.equal(formatEditorNumber(-0.001), '0');
});

test('editor number formatting rejects non-finite display values safely', () => {
  assert.equal(formatEditorNumber(Number.NaN), '0');
  assert.equal(formatEditorNumber(Number.POSITIVE_INFINITY), '0');
});
