import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientToPageGuidePosition,
  findNearestGuideWithinCssTolerance,
} from '../src/ruler-guide-geometry.js';

test('client pointer coordinates map through canvas rect, pan, and zoom on either ruler axis', () => {
  const transform = {
    client: { x: 184, y: 243 },
    rect: { left: 24, top: 43 },
    pan: { x: 20, y: -8 },
    zoom: 2,
  };
  assert.equal(clientToPageGuidePosition({ ...transform, axis: 'x' }), 70);
  assert.equal(clientToPageGuidePosition({ ...transform, axis: 'y' }), 104);
});

test('page ruler coordinates retain negative values and zero-pan defaults', () => {
  assert.equal(clientToPageGuidePosition({
    client: { x: 15, y: -5 }, rect: { left: 20, top: 0 }, zoom: 0.5, axis: 'x',
  }), -10);
  assert.equal(clientToPageGuidePosition({
    client: { x: 15, y: -5 }, rect: { left: 20, top: 0 }, zoom: 0.5, axis: 'y',
  }), -10);
});

test('ruler snapping is off by default and can be enabled within CSS-pixel tolerance', () => {
  const pointer = {
    client: { x: 101, y: 0 }, rect: { left: 0, top: 0 },
    pan: { x: 0, y: 0 }, zoom: 2, axis: 'x', guides: [48, 51],
  };
  assert.equal(clientToPageGuidePosition(pointer), 50.5, 'the default leaves the precise pointer position alone');
  assert.equal(clientToPageGuidePosition({ ...pointer, snapToGuides: true }), 51,
    'a nearby guide is chosen when its screen distance is within tolerance');
  assert.equal(clientToPageGuidePosition({ ...pointer, snapToGuides: true, tolerancePx: 0.5 }), 50.5,
    'a guide outside the configured CSS-pixel tolerance is ignored');
});

test('nearest-guide matching measures tolerance in screen pixels and preserves first ties', () => {
  assert.deepEqual(findNearestGuideWithinCssTolerance(10, [8, 12, 30], { zoom: 2, tolerancePx: 4 }), {
    position: 8,
    distancePx: 4,
  });
  assert.equal(findNearestGuideWithinCssTolerance(10, [-20, 10.1], { zoom: 3, tolerancePx: 0.3 }).position, 10.1);
  assert.equal(findNearestGuideWithinCssTolerance(10, [12], { zoom: 2, tolerancePx: 3 }), null,
    'a 2-page-unit gap is 4 CSS pixels at 2x zoom');
  assert.equal(findNearestGuideWithinCssTolerance(10, [12], { zoom: 2, tolerancePx: 0 }), null);
});

test('guide projection rejects malformed coordinates, axes, zoom, and snapping settings', () => {
  const valid = {
    client: { x: 1, y: 2 }, rect: { left: 0, top: 0 }, pan: { x: 0, y: 0 }, zoom: 1, axis: 'x',
  };
  for (const changed of [
    { client: { x: NaN, y: 0 } },
    { client: { x: 0, y: Infinity } },
    { rect: { left: -Infinity, top: 0 } },
    { rect: { left: 0, top: NaN } },
    { pan: { x: 0, y: Infinity } },
    { zoom: 0 },
    { zoom: Infinity },
    { axis: 'horizontal' },
    { snapToGuides: 1 },
  ]) {
    assert.throws(() => clientToPageGuidePosition({ ...valid, ...changed }));
  }
  assert.throws(() => clientToPageGuidePosition({ ...valid, axis: undefined }), /axis/);
  assert.throws(() => clientToPageGuidePosition({ ...valid, client: null }), /required/);
});

test('nearest-guide matching validates all positions and tolerance inputs', () => {
  assert.throws(() => findNearestGuideWithinCssTolerance(NaN, [], { zoom: 1 }), /finite/);
  assert.throws(() => findNearestGuideWithinCssTolerance(0, [1, Infinity], { zoom: 1 }), /finite/);
  assert.throws(() => findNearestGuideWithinCssTolerance(0, [1], { zoom: 0 }), /positive/);
  assert.throws(() => findNearestGuideWithinCssTolerance(0, [1], { zoom: 1, tolerancePx: -1 }), /cannot be negative/);
  assert.throws(() => findNearestGuideWithinCssTolerance(0, null, { zoom: 1 }), /array/);
});
