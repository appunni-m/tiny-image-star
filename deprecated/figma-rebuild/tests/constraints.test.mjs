import test from 'node:test';
import assert from 'node:assert/strict';
import { createNode } from '../src/model.js';
import { applyFrameConstraints, captureChildGeometry } from '../src/constraints.js';

test('right and bottom constraints keep a child pinned to its frame edges', () => {
  const frame = createNode('frame', { width: 300, height: 200 });
  const child = createNode('rectangle', { x: 240, y: 155, width: 40, height: 30, constraints: { horizontal: 'right', vertical: 'bottom' } });
  frame.children.push(child);
  applyFrameConstraints(frame, 300, 200, 400, 260);
  assert.deepEqual([child.x, child.y, child.width, child.height], [340, 215, 40, 30]);
});

test('left-right and top-bottom constraints stretch the child with the parent', () => {
  const frame = createNode('frame', { width: 300, height: 200 });
  const child = createNode('rectangle', { x: 20, y: 15, width: 260, height: 170, constraints: { horizontal: 'left-right', vertical: 'top-bottom' } });
  frame.children.push(child);
  applyFrameConstraints(frame, 300, 200, 380, 240);
  assert.deepEqual([child.x, child.y, child.width, child.height], [20, 15, 340, 210]);
});

test('center and scale constraints recompute from the original geometry during pointer resizing', () => {
  const frame = createNode('frame', { width: 200, height: 100 });
  const centered = createNode('rectangle', { x: 80, y: 35, width: 40, height: 30, constraints: { horizontal: 'center', vertical: 'center' } });
  const scaled = createNode('rectangle', { x: 20, y: 10, width: 40, height: 20, constraints: { horizontal: 'scale', vertical: 'scale' } });
  frame.children.push(centered, scaled);
  const original = captureChildGeometry(frame);
  applyFrameConstraints(frame, 200, 100, 240, 120, original);
  applyFrameConstraints(frame, 200, 100, 300, 150, original);
  assert.deepEqual([centered.x, centered.y, centered.width, centered.height], [130, 60, 40, 30]);
  assert.deepEqual([scaled.x, scaled.y, scaled.width, scaled.height], [30, 15, 60, 30]);
});

test('auto layout keeps ownership of child placement and does not apply fixed-frame constraints', () => {
  const frame = createNode('frame', { width: 200, height: 100, autoLayout: { axis: 'horizontal', gap: 8 } });
  const child = createNode('rectangle', { x: 20, y: 10, width: 40, height: 20, constraints: { horizontal: 'right', vertical: 'bottom' } });
  frame.children.push(child);
  applyFrameConstraints(frame, 200, 100, 300, 200);
  assert.deepEqual([child.x, child.y, child.width, child.height], [20, 10, 40, 20]);
});
