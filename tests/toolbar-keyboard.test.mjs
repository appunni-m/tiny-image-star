import test from 'node:test';
import assert from 'node:assert/strict';
import { toolbarNavigationTarget } from '../src/toolbar-keyboard.js';

test('horizontal toolbar navigation wraps and supports Home and End', () => {
  const items = ['select', 'frame', 'shape'];
  assert.equal(toolbarNavigationTarget(items, items[0], 'ArrowRight'), 'frame');
  assert.equal(toolbarNavigationTarget(items, items[2], 'ArrowRight'), 'select');
  assert.equal(toolbarNavigationTarget(items, items[0], 'ArrowLeft'), 'shape');
  assert.equal(toolbarNavigationTarget(items, items[1], 'Home'), 'select');
  assert.equal(toolbarNavigationTarget(items, items[1], 'End'), 'shape');
  assert.equal(toolbarNavigationTarget(items, items[1], 'Escape'), null);
});

test('horizontal toolbar navigation follows the visual direction in RTL layouts', () => {
  const items = ['first', 'second', 'third'];
  assert.equal(toolbarNavigationTarget(items, items[1], 'ArrowRight', 'rtl'), 'first');
  assert.equal(toolbarNavigationTarget(items, items[1], 'ArrowLeft', 'rtl'), 'third');
  assert.equal(toolbarNavigationTarget(items, null, 'ArrowLeft', 'rtl'), 'first');
  assert.equal(toolbarNavigationTarget([], null, 'ArrowRight'), null);
});
