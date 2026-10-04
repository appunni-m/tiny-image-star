import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeFrameToPreset } from '../src/frame-preset-resize.js';

const desktopPreset = { width: 1440, height: 900 };

test('resizing an existing frame applies its constraints from the original child geometry', () => {
  const frame = {
    id: 'frame', type: 'frame', x: 20, y: 30, width: 100, height: 100,
    children: [
      { id: 'left', x: 8, y: 10, width: 20, height: 30 },
      { id: 'right', x: 70, y: 75, width: 20, height: 15, constraints: { horizontal: 'right', vertical: 'bottom' } },
      { id: 'stretch', x: 10, y: 12, width: 80, height: 76, constraints: { horizontal: 'left-right', vertical: 'top-bottom' } },
      { id: 'center', x: 40, y: 40, width: 20, height: 20, constraints: { horizontal: 'center', vertical: 'center' } },
      { id: 'scale', x: 10, y: 10, width: 20, height: 30, constraints: { horizontal: 'scale', vertical: 'scale' } },
    ]
  };
  const result = resizeFrameToPreset(frame, { width: 140, height: 120 });

  assert.equal(result.changed, true);
  assert.deepEqual(result.before, { width: 100, height: 100 });
  assert.deepEqual(result.after, { width: 140, height: 120 });
  assert.deepEqual(frame.children.map(({ x, y, width, height }) => ({ x, y, width, height })), [
    { x: 8, y: 10, width: 20, height: 30 },
    { x: 110, y: 95, width: 20, height: 15 },
    { x: 10, y: 12, width: 120, height: 96 },
    { x: 60, y: 50, width: 20, height: 20 },
    { x: 14, y: 12, width: 28, height: 36 },
  ]);
});

test('resizing an auto-layout frame reruns its layout, then its auto-layout parent', () => {
  const calls = [];
  const parent = { id: 'parent', type: 'frame', autoLayout: { axis: 'horizontal' }, children: [] };
  const frame = { id: 'frame', type: 'frame', width: 300, height: 300, autoLayout: { axis: 'vertical' }, children: [] };
  const result = resizeFrameToPreset(frame, desktopPreset, {
    applyAutoLayout: node => calls.push(node.id),
    parentOf: () => parent,
  });

  assert.equal(result.changed, true);
  assert.equal(result.parent, parent);
  assert.deepEqual(calls, ['frame', 'parent']);
});

test('an ordinary frame nested in auto layout captures and reflows the parent', () => {
  const sibling = { id: 'sibling', x: 0, y: 0, width: 80, height: 40 };
  const frame = { id: 'frame', type: 'frame', width: 100, height: 100, children: [] };
  const parent = { id: 'parent', type: 'frame', autoLayout: { axis: 'horizontal' }, children: [frame, sibling] };
  const calls = [];
  const result = resizeFrameToPreset(frame, { width: 160, height: 120 }, {
    applyAutoLayout: node => {
      calls.push(node.id);
      if (node === parent) sibling.x = 160;
    },
    parentOf: () => parent,
  });

  assert.deepEqual(calls, ['parent']);
  assert.deepEqual(result.parentChildrenBefore.get('sibling'), { x: 0, y: 0, width: 80, height: 40 });
  assert.equal(sibling.x, 160);
});

test('matching dimensions are a no-op and invalid sizes fail before mutation', () => {
  const frame = { type: 'frame', width: 1440, height: 900, children: [] };
  assert.equal(resizeFrameToPreset(frame, desktopPreset).changed, false);
  assert.throws(() => resizeFrameToPreset(frame, { width: Infinity, height: 900 }), /outside the supported range/);
  assert.throws(() => resizeFrameToPreset({ ...frame, type: 'group' }, desktopPreset), /A frame is required/);
  assert.equal(frame.width, 1440);
  assert.equal(frame.height, 900);
});

test('a preset snaps a nearly matching custom size to its exact dimensions', () => {
  const frame = { type: 'frame', width: 399.999, height: 800, children: [] };
  const result = resizeFrameToPreset(frame, { width: 400, height: 800 });
  assert.equal(result.changed, true);
  assert.equal(frame.width, 400);
  assert.equal(frame.height, 800);
});
