import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedVisibleFrameIds } from '../src/pdf-export-plan.js';

test('PDF frame order is stable, top-to-bottom then left-to-right, and excludes hidden or nested layers', () => {
  const frames = [
    { id: 'right-top', type: 'frame', x: 400, y: 0 },
    { id: 'left-bottom', type: 'frame', x: 0, y: 500 },
    { id: 'left-top', type: 'frame', x: 0, y: 0 },
    { id: 'hidden', type: 'frame', x: -100, y: -100, visible: false },
    { id: 'shape', type: 'rectangle', x: -200, y: -200 },
    { id: 'right-bottom', type: 'frame', x: 400, y: 500 },
  ];
  assert.deepEqual(orderedVisibleFrameIds(frames), ['left-top', 'right-top', 'left-bottom', 'right-bottom']);
  assert.deepEqual(orderedVisibleFrameIds(null), []);
  assert.deepEqual(orderedVisibleFrameIds([]), []);
});

test('PDF frame order preserves layer order when positions are equal', () => {
  assert.deepEqual(orderedVisibleFrameIds([
    { id: 'first', type: 'frame', x: 10, y: 20 },
    { id: 'second', type: 'frame', x: 10, y: 20 },
  ]), ['first', 'second']);
});
