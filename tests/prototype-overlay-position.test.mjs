import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPrototypeOverlayRelativePosition, prototypeOverlayPositionInFrame } from '../src/prototype-overlay-position.js';

test('manual overlay placement adds its persisted trigger-relative offset to the rendered trigger origin', () => {
  assert.deepEqual(prototypeOverlayPositionInFrame(
    'manual', { width: 400, height: 700 }, { width: 200, height: 100 }, { x: 54, y: 33 }, { x: 8, y: -12 }
  ), { x: 62, y: 21 });
});

test('manual overlay placement falls back to centered when a legacy anchor is missing', () => {
  assert.deepEqual(prototypeOverlayPositionInFrame(
    'manual', { width: 400, height: 700 }, { width: 200, height: 100 }
  ), { x: 100, y: 300 });
});

test('manual overlay offsets accept only finite X and Y coordinates', () => {
  assert.equal(isValidPrototypeOverlayRelativePosition({ x: 2.5, y: -3 }), true);
  assert.equal(isValidPrototypeOverlayRelativePosition({ x: NaN, y: 3 }), false);
  assert.equal(isValidPrototypeOverlayRelativePosition({ x: 0, y: 1, z: 2 }), false);
});

test('preset edge placements use the remaining space when the 16px inset does not fit', () => {
  assert.deepEqual(prototypeOverlayPositionInFrame(
    'top-left', { width: 320, height: 568 }, { width: 310, height: 550 }
  ), { x: 10, y: 16 });
  assert.deepEqual(prototypeOverlayPositionInFrame(
    'bottom-right', { width: 320, height: 568 }, { width: 310, height: 550 }
  ), { x: 0, y: 2 });
});
