import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_OBJECT_ISOLATION_SOURCE_PIXELS, OBJECT_ISOLATION_BRUSH_MODE,
  applyObjectIsolationMaskToRgba, normalizeObjectIsolationStrokes, validateObjectIsolationDimensions,
} from '../src/object-isolation-mask.js';

test('object-isolation dimensions are rejected before mobile-sized allocations exceed the cap', () => {
  assert.equal(validateObjectIsolationDimensions(2048, 2048), MAX_OBJECT_ISOLATION_SOURCE_PIXELS);
  assert.throws(() => validateObjectIsolationDimensions(2049, 2048), /supports images up to/);
  assert.throws(() => validateObjectIsolationDimensions(0, 1), /valid source image size/);
  assert.throws(() => validateObjectIsolationDimensions(Number.MAX_SAFE_INTEGER, 2), /safe pixel-count/);
});

test('positive, negative, and lasso strokes are normalized for the official MediaPipe API', () => {
  const input = [
    { brushMode: OBJECT_ISOLATION_BRUSH_MODE.POSITIVE, isCompleted: true, point: [{ x: .25, y: .5 }, { x: .4, y: .6 }] },
    { brushMode: OBJECT_ISOLATION_BRUSH_MODE.NEGATIVE, isCompleted: true, point: [{ x: .8, y: .2 }] },
    { brushMode: OBJECT_ISOLATION_BRUSH_MODE.LASSO, isCompleted: true, point: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .5, y: .9 }] },
  ];
  assert.deepEqual(normalizeObjectIsolationStrokes(input), input);
  assert.throws(() => normalizeObjectIsolationStrokes([]), /at least one isolation stroke/);
  assert.throws(() => normalizeObjectIsolationStrokes([{ ...input[0], isCompleted: false }]), /malformed or incomplete/);
  assert.throws(() => normalizeObjectIsolationStrokes([{ ...input[0], brushMode: 99 }]), /malformed or incomplete/);
  assert.throws(() => normalizeObjectIsolationStrokes([{ ...input[2], point: [{ x: .5, y: .5 }] }]), /malformed or incomplete/);
  assert.throws(() => normalizeObjectIsolationStrokes([{ ...input[0], point: [{ x: 1.1, y: .5 }] }]), /normalized within/);
});

test('confidence-mask scaling applies a soft alpha edge and preserves every source RGB channel', () => {
  const pixels = new Uint8ClampedArray([
    10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
  ]);
  const sourceBefore = pixels.slice();
  const result = applyObjectIsolationMaskToRgba(pixels, 4, 1, new Float32Array([0, 1]), 2, 1);
  assert.strictEqual(result.pixels, pixels);
  assert.equal(result.selectedPixels, 3);
  assert.deepEqual([...pixels].filter((_, index) => index % 4 !== 3), [...sourceBefore].filter((_, index) => index % 4 !== 3));
  assert.deepEqual([pixels[3], pixels[7], pixels[11], pixels[15]], [0, 64, 191, 255]);
});

test('object isolation multiplies the existing source alpha instead of making transparent pixels opaque', () => {
  const pixels = new Uint8ClampedArray([1, 2, 3, 0, 4, 5, 6, 128, 7, 8, 9, 255]);
  const result = applyObjectIsolationMaskToRgba(pixels, 3, 1, new Float32Array([1, .5, 0]), 3, 1);
  assert.equal(result.selectedPixels, 1);
  assert.deepEqual([pixels[3], pixels[7], pixels[11]], [0, 64, 0]);
});

test('invalid confidence masks and empty results fail instead of creating a fake transparent image', () => {
  const pixels = new Uint8ClampedArray(4);
  assert.throws(() => applyObjectIsolationMaskToRgba(pixels, 1, 1, new Float32Array([NaN]), 1, 1), /non-finite/);
  assert.throws(() => applyObjectIsolationMaskToRgba(pixels, 1, 1, new Float32Array([0]), 1, 1), /did not contain any visible pixels/);
  assert.throws(() => applyObjectIsolationMaskToRgba(pixels, 1, 1, new Uint16Array([1]), 1, 1), /invalid confidence mask/);
  assert.throws(() => applyObjectIsolationMaskToRgba(pixels, 1, 1, new Float32Array([1, 0]), 3, 1), /invalid confidence mask/);
  assert.throws(() => applyObjectIsolationMaskToRgba(pixels, 1, 1,
    new Float32Array([1]), MAX_OBJECT_ISOLATION_SOURCE_PIXELS + 1, 1), /invalid confidence mask/);
});
