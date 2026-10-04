import test from 'node:test';
import assert from 'node:assert/strict';
import { toolbarOverflowDestination, toolbarOverflowState } from '../src/toolbar-overflow.js';

test('the mobile More tools control advances by one visible toolbar page and returns to the start', () => {
  const layout = { clientWidth: 320, scrollWidth: 920 };
  assert.deepEqual(toolbarOverflowState({ ...layout, scrollLeft: 0 }), { hasOverflow: true, atEnd: false });
  assert.equal(toolbarOverflowDestination({ ...layout, scrollLeft: 0 }), 320);
  assert.equal(toolbarOverflowDestination({ ...layout, scrollLeft: 320 }), 600);
  assert.equal(toolbarOverflowDestination({ ...layout, scrollLeft: 596 }), 600);
  assert.deepEqual(toolbarOverflowState({ ...layout, scrollLeft: 600 }), { hasOverflow: true, atEnd: true });
  assert.equal(toolbarOverflowDestination({ ...layout, scrollLeft: 600 }), 0);
});

test('the mobile More tools control hides when all tools fit and handles subpixel end positions', () => {
  assert.deepEqual(toolbarOverflowState({ scrollLeft: 0, clientWidth: 320, scrollWidth: 321 }), {
    hasOverflow: false,
    atEnd: false
  });
  assert.equal(toolbarOverflowDestination({ scrollLeft: 0, clientWidth: 320, scrollWidth: 321 }), 0);
  assert.deepEqual(toolbarOverflowState({ scrollLeft: 598.5, clientWidth: 320, scrollWidth: 920 }), {
    hasOverflow: true,
    atEnd: true
  });
});
