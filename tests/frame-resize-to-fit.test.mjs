import test from 'node:test';
import assert from 'node:assert/strict';
import { planFrameResizeToFit } from '../src/frame-resize-to-fit.js';

function worldPoint(frame, child, localPoint) {
  const angle = Number(frame.rotation || 0) * Math.PI / 180;
  const localX = child.x + localPoint.x - frame.width / 2;
  const localY = child.y + localPoint.y - frame.height / 2;
  const rotatedX = localX * Math.cos(angle) - localY * Math.sin(angle) + frame.width / 2;
  const rotatedY = localX * Math.sin(angle) + localY * Math.cos(angle) + frame.height / 2;
  const affine = frame.affineTransform || { a: 1, b: 0, c: 0, d: 1 };
  return {
    x: frame.x + affine.a * rotatedX + affine.c * rotatedY,
    y: frame.y + affine.b * rotatedX + affine.d * rotatedY
  };
}

test('resize-to-fit wraps negative and overflowing content while preserving child coordinates in world space', () => {
  const frame = {
    id: 'frame', type: 'frame', x: 80, y: 50, width: 100, height: 60,
    children: [
      { id: 'left', type: 'rectangle', x: -14, y: 6, width: 30, height: 20 },
      { id: 'right', type: 'rectangle', x: 74, y: 37, width: 45, height: 29 }
    ]
  };
  const plan = planFrameResizeToFit(frame, { x: -14, y: 6, width: 133, height: 60 });
  assert.equal(plan.changed, true);
  assert.deepEqual(plan.after, { x: 66, y: 56, width: 133, height: 60 });
  assert.deepEqual(plan.children.map(child => child.after), [{ x: 0, y: 0 }, { x: 88, y: 31 }]);

  for (let index = 0; index < frame.children.length; index += 1) {
    const child = frame.children[index];
    const changed = plan.children[index];
    const before = worldPoint(frame, child, { x: child.width / 2, y: child.height / 2 });
    const after = worldPoint({ ...frame, ...plan.after }, { ...child, ...changed.after }, { x: child.width / 2, y: child.height / 2 });
    assert.ok(Math.abs(before.x - after.x) < 1e-9);
    assert.ok(Math.abs(before.y - after.y) < 1e-9);
  }
});

test('rotated frames retain the exact world positions of their children when their bounds shift', () => {
  const frame = {
    id: 'frame', type: 'frame', x: 10, y: 20, width: 120, height: 80, rotation: 37,
    children: [{ id: 'child', type: 'text', x: -7.5, y: 12.25, width: 34, height: 19 }]
  };
  const plan = planFrameResizeToFit(frame, { x: -7.5, y: 12.25, width: 34, height: 19 });
  const before = worldPoint(frame, frame.children[0], { x: 18, y: 9.5 });
  const after = worldPoint({ ...frame, ...plan.after }, { ...frame.children[0], ...plan.children[0].after }, { x: 18, y: 9.5 });
  assert.ok(Math.abs(before.x - after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
  assert.equal(plan.after.width, 34);
  assert.equal(plan.after.height, 19);
  assert.ok(Math.abs(plan.after.x - 23.652030915136592) < 1e-9);
  assert.ok(Math.abs(plan.after.y - 5.533243272458469) < 1e-9);
});

test('frames with imported affine transforms retain child positions when their bounds shift', () => {
  const frame = {
    id: 'frame', type: 'frame', x: 12, y: -5, width: 80, height: 70, rotation: -23,
    affineTransform: { a: 1.2, b: 0.1, c: -0.25, d: 0.85 },
    children: [{ id: 'child', type: 'rectangle', x: -11, y: 9, width: 29, height: 17 }]
  };
  const plan = planFrameResizeToFit(frame, { x: -11, y: 9, width: 29, height: 17 });
  const before = worldPoint(frame, frame.children[0], { x: 14.5, y: 8.5 });
  const after = worldPoint({ ...frame, ...plan.after }, { ...frame.children[0], ...plan.children[0].after }, { x: 14.5, y: 8.5 });
  assert.ok(Math.abs(before.x - after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
});

test('an already fitted frame is a no-op and auto-layout frames fail closed', () => {
  const frame = { id: 'frame', type: 'frame', x: 2, y: 3, width: 40, height: 20, children: [] };
  const plan = planFrameResizeToFit(frame, { x: 0, y: 0, width: 40, height: 20 });
  assert.equal(plan.changed, false);
  assert.throws(() => planFrameResizeToFit({ ...frame, autoLayout: { direction: 'vertical' } }, {
    x: 0, y: 0, width: 40, height: 20
  }), /Hug contents/);
});

test('fit bounds and direct child positions must be finite and bounded', () => {
  const frame = { id: 'frame', type: 'frame', x: 0, y: 0, width: 10, height: 10, children: [] };
  assert.throws(() => planFrameResizeToFit(frame, { x: 0, y: 0, width: Infinity, height: 1 }), /finite bounds/);
  assert.throws(() => planFrameResizeToFit(frame, { x: 0, y: 0, width: 100_001, height: 1 }), /supported frame size/);
  assert.throws(() => planFrameResizeToFit({ ...frame, children: [{ id: 'bad', x: NaN, y: 0 }] }, {
    x: 0, y: 0, width: 10, height: 10
  }), /invalid position geometry/);
});
