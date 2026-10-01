import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_INPAINT_POINTS, MAX_INPAINT_SOURCE_PIXELS, MAX_INPAINT_STROKES,
  compositeInpaintRgbPixels, normalizeImageEraseStrokes, normalizeInpaintStrokes, rasterizeInpaintMask,
  resolveImageEraseStrokes, validateInpaintDimensions,
} from '../src/inpaint-mask.js';

test('inpaint dimensions are validated against safe integer and mobile memory limits', () => {
  assert.equal(validateInpaintDimensions(100, 200), 20_000);
  for (const [width, height] of [[0, 4], [-1, 5], [1.5, 2]]) {
    assert.throws(() => validateInpaintDimensions(width, height), /valid image size/);
  }
  assert.throws(() => validateInpaintDimensions(Number.MAX_SAFE_INTEGER, 2), /safe pixel-count limit/);
  assert.throws(() => validateInpaintDimensions(MAX_INPAINT_SOURCE_PIXELS + 1, 1), /supports source images up to/);
});

test('stroke validation bounds radius, point count, and coordinates before allocating a mask', () => {
  assert.deepEqual(normalizeInpaintStrokes([{ radius: 2, points: [{ x: 1, y: 1 }] }], 8, 8), [
    { radius: 2, points: [{ x: 1, y: 1 }] },
  ]);
  assert.throws(() => normalizeInpaintStrokes([], 8, 8), /at least one erase stroke/);
  assert.throws(() => normalizeInpaintStrokes(Array(MAX_INPAINT_STROKES + 1).fill({ radius: 1, points: [{ x: 2, y: 2 }] }), 8, 8), /stroke limit/);
  assert.throws(() => normalizeInpaintStrokes([{ radius: 0, points: [{ x: 2, y: 2 }] }], 8, 8), /malformed/);
  assert.throws(() => normalizeInpaintStrokes([{ radius: 99, points: [{ x: 2, y: 2 }] }], 8, 8), /malformed/);
  assert.throws(() => normalizeInpaintStrokes([{ radius: 1, points: [{ x: 9, y: 2 }] }], 8, 8), /outside the image/);
  assert.throws(() => normalizeInpaintStrokes([{ radius: 1, points: [{ x: NaN, y: 2 }] }], 8, 8), /outside the image/);
  const tooManyPoints = Array(MAX_INPAINT_POINTS + 1).fill({ x: 2, y: 2 });
  assert.throws(() => normalizeInpaintStrokes([{ radius: 1, points: tooManyPoints }], 8, 8), /too many points/);
});

test('MI-GAN masks preserve untouched pixels and erase single taps, strokes, and clipped edges', () => {
  const tap = rasterizeInpaintMask(12, 10, [{ radius: 1, points: [{ x: 3.5, y: 3.5 }] }]);
  assert.equal(tap[3 * 12 + 3], 0, 'the center of a brush tap is erased');
  assert.equal(tap[0], 255, 'unpainted image pixels remain known to the model');

  const stroke = rasterizeInpaintMask(12, 10, [{ radius: 1, points: [{ x: 2, y: 5 }, { x: 9, y: 5 }] }]);
  assert.equal(stroke[5 * 12 + 5], 0, 'segment interpolation leaves no gap between brush samples');
  assert.equal(stroke[0], 255);

  const clipped = rasterizeInpaintMask(12, 10, [{ radius: 2, points: [{ x: 0, y: 0 }] }]);
  assert.equal(clipped[0], 0, 'edge painting is clipped to the image without an out-of-bounds write');
  assert.equal(clipped[9 * 12 + 11], 255);
});

test('inpaint compositing changes only masked RGB values and preserves source alpha', () => {
  const original = new Uint8ClampedArray([
    10, 20, 30, 255,
    40, 50, 60, 128,
  ]);
  const generated = new Uint8Array([110, 120, 130, 140, 150, 160]);
  const mask = new Uint8Array([255, 0]);
  compositeInpaintRgbPixels(original, generated, mask, 2, 1);
  assert.deepEqual([...original], [10, 20, 30, 255, 120, 140, 160, 128]);
  assert.throws(() => compositeInpaintRgbPixels(original, generated, mask, 1, 1), /matching/);
});

test('large overlapping brush paths are rejected before allocating and looping over unsafe mask work', () => {
  const broadTaps = Array.from({ length: 65 }, () => ({ radius: 512, points: [{ x: 1024, y: 1024 }] }));
  assert.throws(() => rasterizeInpaintMask(2048, 2048, broadTaps), /too detailed for safe local processing/);
});

test('saved object-erase strokes stay normalized and scale to each recipe target', () => {
  const saved = normalizeImageEraseStrokes([{ radius: 0.05, points: [{ x: 0.25, y: 0.75 }] }]);
  assert.deepEqual(resolveImageEraseStrokes(saved, 800, 600), [
    { radius: 30, points: [{ x: 200, y: 450 }] },
  ]);
  assert.deepEqual(resolveImageEraseStrokes(saved, 400, 1000), [
    { radius: 20, points: [{ x: 100, y: 750 }] },
  ], 'point coordinates scale on each source axis and brush radius stays proportional to the short edge');
  assert.deepEqual(normalizeImageEraseStrokes([]), [], 'an empty saved recipe clears prior target strokes');
  assert.throws(() => normalizeImageEraseStrokes([{ radius: 0, points: [{ x: 0.5, y: 0.5 }] }]), /malformed/);
  assert.throws(() => normalizeImageEraseStrokes([{ radius: 0.1, points: [{ x: 1.1, y: 0.5 }] }]), /normalized within/);
});
