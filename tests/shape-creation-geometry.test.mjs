import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeCreationGeometry } from '../src/shape-creation-geometry.js';

test('ordinary shape drags normalize the dragged corners', () => {
  assert.deepEqual(shapeCreationGeometry('rectangle', { x: 70, y: 40 }, { x: 20, y: 95 }), {
    x: 20, y: 40, width: 50, height: 55, lineReverseY: false
  });
});

test('Shift constrains shape drags to squares in either direction', () => {
  assert.deepEqual(shapeCreationGeometry('ellipse', { x: 10, y: 20 }, { x: 30, y: 70 }, { shiftKey: true }), {
    x: 10, y: 20, width: 50, height: 50, lineReverseY: false
  });
  assert.deepEqual(shapeCreationGeometry('star', { x: 10, y: 20 }, { x: -30, y: -10 }, { shiftKey: true }), {
    x: -30, y: -20, width: 40, height: 40, lineReverseY: false
  });
});

test('Alt draws from the initial pointer as center and combines with Shift', () => {
  assert.deepEqual(shapeCreationGeometry('rectangle', { x: 50, y: 60 }, { x: 62, y: 69 }, { altKey: true }), {
    x: 38, y: 51, width: 24, height: 18, lineReverseY: false
  });
  assert.deepEqual(shapeCreationGeometry('polygon', { x: 50, y: 60 }, { x: 62, y: 69 }, { altKey: true, shiftKey: true }), {
    x: 38, y: 48, width: 24, height: 24, lineReverseY: false
  });
});

test('Shift snaps line angle to 45 degree increments without changing its length', () => {
  const geometry = shapeCreationGeometry('line', { x: 0, y: 0 }, { x: 50, y: 30 }, { shiftKey: true });
  assert.ok(Math.abs(geometry.width - geometry.height) < 1e-10);
  assert.ok(Math.abs(Math.hypot(geometry.width, geometry.height) - Math.hypot(50, 30)) < 1e-10);
  assert.equal(geometry.lineReverseY, false);
});

test('negative-slope lines retain direction for both drag orientations', () => {
  for (const [start, end] of [
    [{ x: 100, y: 100 }, { x: 150, y: 70 }],
    [{ x: 150, y: 70 }, { x: 100, y: 100 }]
  ]) {
    const geometry = shapeCreationGeometry('line', start, end, { shiftKey: true });
    assert.equal(geometry.lineReverseY, true);
    assert.ok(Math.abs(geometry.width - geometry.height) < 1e-10);
  }
});

test('shape geometry rejects invalid coordinates', () => {
  assert.throws(() => shapeCreationGeometry('rectangle', { x: 0, y: NaN }, { x: 2, y: 3 }), /finite/);
  assert.throws(() => shapeCreationGeometry('rectangle', { x: 0, y: 0 }, { x: Infinity, y: 3 }), /finite/);
});
