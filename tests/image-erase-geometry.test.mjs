import test from 'node:test';
import assert from 'node:assert/strict';
import { imageErasePointFromDisplay, imageEraseRadiusFraction, imageEraseRadiusLocal } from '../src/image-erase-geometry.js';

const bounds = { left: 10, top: 20, width: 200, height: 100 };

test('erase points map from displayed orientation to original source coordinates', () => {
  const point = { x: 60, y: 45 };
  assert.deepEqual(imageErasePointFromDisplay(point, bounds), { x: 0.25, y: 0.25 });
  assert.deepEqual(imageErasePointFromDisplay(point, bounds, { rotation: 90 }), { x: 0.25, y: 0.75 });
  assert.deepEqual(imageErasePointFromDisplay(point, bounds, { rotation: 180 }), { x: 0.75, y: 0.75 });
  assert.deepEqual(imageErasePointFromDisplay(point, bounds, { rotation: 270 }), { x: 0.75, y: 0.25 });
  assert.deepEqual(imageErasePointFromDisplay(point, bounds, { flipHorizontal: true, flipVertical: true }), { x: 0.75, y: 0.75 });
  assert.deepEqual(imageErasePointFromDisplay(point, bounds, { rotation: 90, flipHorizontal: true }), { x: 0.25, y: 0.25 });
  assert.deepEqual(imageErasePointFromDisplay(point, bounds, { rotation: 90, flipVertical: true }), { x: 0.75, y: 0.75 });
});

test('erase points clamp at the full displayed source edge and reject malformed geometry', () => {
  assert.deepEqual(imageErasePointFromDisplay({ x: 999, y: -10 }, bounds), { x: 1, y: 0 });
  assert.throws(() => imageErasePointFromDisplay({ x: 1, y: 2 }, { ...bounds, width: 0 }), /bounds/);
  assert.throws(() => imageErasePointFromDisplay({ x: 1, y: 2 }, bounds, { rotation: 45 }), /quarter turn/);
});

test('mobile brush diameter becomes stable source-relative recipe geometry', () => {
  const radius = imageEraseRadiusFraction({ brushDiameterCssPx: 32, zoom: 2, imageScale: 0.5, sourceWidth: 1600, sourceHeight: 800 });
  assert.equal(radius, 0.02);
  assert.equal(imageEraseRadiusLocal(radius, 1600, 800, 0.5), 8);
  assert.equal(imageEraseRadiusFraction({ brushDiameterCssPx: 1000, zoom: 0.1, imageScale: 0.01, sourceWidth: 100, sourceHeight: 100 }), 0.25);
  assert.throws(() => imageEraseRadiusLocal(0.3, 100, 100, 1), /geometry/);
});
