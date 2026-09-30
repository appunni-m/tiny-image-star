import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTransformHandles, invertAffine, multiplyAffine, nodeLocalToPage, nodeLocalToPageTransform,
  pageToNodeLocal, resizeOrientedRect, shortestAngleDelta, transformPoint, transformVector
} from '../src/transform-geometry.js';

const closePoint = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) <= epsilon,
    `Expected (${actual.x}, ${actual.y}) to be within ${epsilon} of (${expected.x}, ${expected.y}).`);
};

test('affine composition maps nested, center-rotated node-local points to page space', () => {
  const frame = { x: 120, y: 50, width: 300, height: 200, rotation: 90 };
  const group = { x: 30, y: 20, width: 120, height: 80, rotation: -30 };
  const node = { x: 10, y: 15, width: 40, height: 20, rotation: 45 };
  const point = { x: 8, y: 6 };

  const actual = nodeLocalToPage(node, point, [frame, group]);
  const radians = degrees => degrees * Math.PI / 180;
  const rotateAbout = (p, center, angle) => {
    const r = radians(angle); const dx = p.x - center.x; const dy = p.y - center.y;
    return { x: center.x + dx * Math.cos(r) - dy * Math.sin(r), y: center.y + dx * Math.sin(r) + dy * Math.cos(r) };
  };
  const applyNode = (p, item) => {
    const translated = { x: p.x + item.x, y: p.y + item.y };
    return rotateAbout(translated, { x: item.x + item.width / 2, y: item.y + item.height / 2 }, item.rotation);
  };
  const expected = applyNode(applyNode(applyNode(point, node), group), frame);
  closePoint(actual, expected);
  closePoint(pageToNodeLocal(node, actual, [frame, group]), point);
});

test('point and vector transforms distinguish translation and invert consistently', () => {
  const node = { x: 5, y: -8, width: 30, height: 10, rotation: 90 };
  const matrix = nodeLocalToPageTransform(node);
  const point = { x: 12, y: 4 };
  closePoint(transformPoint(invertAffine(matrix), transformPoint(matrix, point)), point);
  assert.deepEqual(transformVector(matrix, { x: 1, y: 0 }), { x: 6.123233995736766e-17, y: 1 });
  assert.deepEqual(transformPoint(multiplyAffine(matrix, invertAffine(matrix)), point), point);
});

test('shortest angle steps cross the wrap boundary and accumulate rotations beyond one turn', () => {
  const radians = degrees => degrees * Math.PI / 180;
  assert.ok(Math.abs(shortestAngleDelta(radians(179), radians(-179)) - radians(2)) < 1e-12);
  assert.ok(Math.abs(shortestAngleDelta(radians(-179), radians(179)) + radians(2)) < 1e-12);
  assert.throws(() => shortestAngleDelta(Number.NaN, 0), /finite radians/);

  const samples = [0, 90, 179, -179, -90, 0, 90, 179, -179, -90, 0].map(radians);
  let accumulated = 0;
  for (let index = 1; index < samples.length; index += 1) {
    accumulated += shortestAngleDelta(samples[index - 1], samples[index]);
  }
  assert.ok(Math.abs(accumulated - Math.PI * 4) < 1e-12,
    'incremental tracking should preserve two full turns instead of clamping at ±180°');
});

test('resize and rotation handles report exact oriented page coordinates', () => {
  const parent = { x: 70, y: 30, width: 160, height: 120, rotation: 90 };
  const node = { x: 10, y: 20, width: 100, height: 40, rotation: 90 };
  const handles = getTransformHandles(node, [parent], { rotateOffset: 16 });
  closePoint(handles.resize.nw, nodeLocalToPage(node, { x: 0, y: 0 }, [parent]));
  closePoint(handles.resize.e, nodeLocalToPage(node, { x: 100, y: 20 }, [parent]));
  closePoint(handles.rotate, nodeLocalToPage(node, { x: 50, y: -16 }, [parent]));
});

test('oriented east resize preserves the opposite handle under rotation and nesting', () => {
  const ancestors = [{ x: 90, y: 40, width: 240, height: 160, rotation: 27 }];
  const rect = { x: 12, y: 18, width: 80, height: 50, rotation: 63 };
  const originalHandles = getTransformHandles(rect, ancestors);
  const pointer = nodeLocalToPage(rect, { x: 125, y: rect.height / 2 }, ancestors);

  const resized = resizeOrientedRect(rect, 'e', pointer, ancestors);
  assert.ok(Math.abs(resized.width - 125) < 1e-9);
  assert.equal(resized.height, rect.height);
  closePoint(getTransformHandles(resized, ancestors).resize.w, originalHandles.resize.w);
  closePoint(getTransformHandles(resized, ancestors).resize.e, pointer);
});

test('oriented corner resize keeps its opposite corner fixed and clamps handle crossing', () => {
  const rect = { x: -5, y: 14, width: 70, height: 45, rotation: -38 };
  const originalHandles = getTransformHandles(rect);
  const pointer = nodeLocalToPage(rect, { x: -20, y: -12 });
  const resized = resizeOrientedRect(rect, 'nw', pointer);
  assert.ok(Math.abs(resized.width - 90) < 1e-9);
  assert.ok(Math.abs(resized.height - 57) < 1e-9);
  closePoint(getTransformHandles(resized).resize.se, originalHandles.resize.se);
  closePoint(getTransformHandles(resized).resize.nw, pointer);

  const crossed = resizeOrientedRect(rect, 'e', nodeLocalToPage(rect, { x: -50, y: 20 }));
  assert.equal(crossed.width, 1);
});

test('corner resize can lock an aspect ratio while preserving the opposite handle', () => {
  const ancestors = [{ x: 60, y: -25, width: 220, height: 130, rotation: 19 }];
  const rect = { x: 8, y: 11, width: 80, height: 40, rotation: -41 };
  const before = getTransformHandles(rect, ancestors);
  const pointer = nodeLocalToPage(rect, { x: 200, y: 70 }, ancestors);
  const resized = resizeOrientedRect(rect, 'se', pointer, ancestors, { aspectRatio: 2 });
  assert.ok(Math.abs(resized.width / resized.height - 2) < 1e-12);
  closePoint(getTransformHandles(resized, ancestors).resize.nw, before.resize.nw);
});

test('aspect-ratio option does not change edge resizing and rejects invalid ratios', () => {
  const rect = { x: 0, y: 0, width: 80, height: 40, rotation: 30 };
  const pointer = nodeLocalToPage(rect, { x: 130, y: 20 });
  const resized = resizeOrientedRect(rect, 'e', pointer, [], { aspectRatio: 3 });
  assert.ok(Math.abs(resized.width - 130) < 1e-9);
  assert.equal(resized.height, 40);
  assert.throws(() => resizeOrientedRect(rect, 'se', pointer, [], { aspectRatio: 0 }), /Aspect ratio/);
});
