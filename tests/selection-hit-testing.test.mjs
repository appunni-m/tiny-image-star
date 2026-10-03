import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestScreenHandle } from '../src/selection-hit-testing.js';

test('screen-space handle hit testing chooses the nearest candidate inside the touch radius', () => {
  const handles = [
    { kind: 'resize', name: 'nw', point: { x: 20, y: 20 } },
    { kind: 'resize', name: 'se', point: { x: 28, y: 28 } },
    { kind: 'rotate', point: { x: 20, y: -4 } }
  ];
  assert.equal(nearestScreenHandle({ x: 27, y: 27 }, handles, 22)?.name, 'se');
  assert.equal(nearestScreenHandle({ x: 80, y: 80 }, handles, 22), null);
});

test('exactly overlapping tiny-selection handles always prefer resize over rotate', () => {
  const handles = [
    { kind: 'resize', name: 'nw', point: { x: 100, y: 100 } },
    { kind: 'resize', name: 'se', point: { x: 100, y: 100 } },
    { kind: 'rotate', point: { x: 100, y: 100 } }
  ];
  assert.equal(nearestScreenHandle({ x: 100, y: 100 }, handles, 22)?.name, 'nw');
  assert.equal(nearestScreenHandle({ x: 100, y: 100 }, [...handles].reverse(), 22)?.kind, 'resize');
});

test('handle hit radius is measured in screen pixels independent of canvas zoom', () => {
  const handle = { kind: 'resize', name: 'e', point: { x: 240, y: 180 } };
  assert.equal(nearestScreenHandle({ x: 261, y: 180 }, [handle], 22)?.name, 'e');
  assert.equal(nearestScreenHandle({ x: 262.01, y: 180 }, [handle], 22), null);
});
