import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveCanvasWorldCenterOnResize } from '../src/canvas-viewport.js';

test('canvas resize keeps the same document point centered at the new viewport size', () => {
  const previousSize = { width: 1280, height: 720 };
  const nextSize = { width: 390, height: 844 };
  const pan = { panX: 837, panY: 322, zoom: 1 };
  const worldCenterBefore = {
    x: (previousSize.width / 2 - pan.panX) / pan.zoom,
    y: (previousSize.height / 2 - pan.panY) / pan.zoom
  };
  const resized = preserveCanvasWorldCenterOnResize({ ...pan, previousSize, nextSize });
  assert.deepEqual(resized, {
    panX: nextSize.width / 2 - worldCenterBefore.x * pan.zoom,
    panY: nextSize.height / 2 - worldCenterBefore.y * pan.zoom
  });
});

test('canvas resize preserves document center at non-unit zoom', () => {
  const resized = preserveCanvasWorldCenterOnResize({
    panX: -112, panY: 48, zoom: 2.5,
    previousSize: { width: 900, height: 600 }, nextSize: { width: 390, height: 844 }
  });
  assert.deepEqual(resized, { panX: -367, panY: 170 });
});

test('invalid viewport sizes do not introduce non-finite camera positions', () => {
  assert.deepEqual(preserveCanvasWorldCenterOnResize({
    panX: 12, panY: 34, zoom: 1,
    previousSize: { width: 0, height: 100 }, nextSize: { width: 390, height: 844 }
  }), { panX: 12, panY: 34 });
});
