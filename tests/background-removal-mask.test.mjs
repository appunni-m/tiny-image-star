import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBackgroundRemovalMatte,
  BACKGROUND_REMOVAL_MODEL_LONG_EDGE,
  MAX_BACKGROUND_REMOVAL_PIXELS,
  validateBackgroundRemovalDimensions,
  backgroundRemovalModelDimensions,
} from '../src/background-removal-mask.js';

test('background-removal dimensions reject unsafe and over-budget images before allocation', () => {
  assert.throws(() => validateBackgroundRemovalDimensions(0, 100), /valid source image size/);
  assert.throws(() => validateBackgroundRemovalDimensions(1.5, 4), /valid source image size/);
  assert.throws(() => validateBackgroundRemovalDimensions(Number.MAX_SAFE_INTEGER, 2), /safe pixel-count/);
  assert.throws(() => validateBackgroundRemovalDimensions(MAX_BACKGROUND_REMOVAL_PIXELS + 1, 1), /supports images up to/);
  assert.equal(validateBackgroundRemovalDimensions(2048, 2048), MAX_BACKGROUND_REMOVAL_PIXELS);
});

test('model input stays 32-aligned without distorting small source aspect ratios', () => {
  assert.equal(BACKGROUND_REMOVAL_MODEL_LONG_EDGE, 512);
  assert.deepEqual(backgroundRemovalModelDimensions(100, 50), { width: 512, height: 256 });
  assert.deepEqual(backgroundRemovalModelDimensions(50, 100), { width: 256, height: 512 });
  assert.deepEqual(backgroundRemovalModelDimensions(2000, 1000), { width: 512, height: 256 });
  for (const [width, height] of [[2048, 2048], [1, 1], [4096, 1]]) {
    const dimensions = backgroundRemovalModelDimensions(width, height);
    assert.equal(dimensions.width % 32, 0);
    assert.equal(dimensions.height % 32, 0);
    assert.ok(dimensions.width >= 32 && dimensions.width <= 512);
    assert.ok(dimensions.height >= 32 && dimensions.height <= 512);
  }
  assert.throws(() => backgroundRemovalModelDimensions(64, 64, 48), /multiple of 32/);
});

test('alpha matte preserves source RGB and existing transparency while bilinearly fitting the model mask', () => {
  const pixels = new Uint8ClampedArray([
    10, 20, 30, 255,
    40, 50, 60, 128,
    70, 80, 90, 0,
  ]);
  const beforeRgb = [...pixels].filter((_, index) => index % 4 !== 3);
  const result = applyBackgroundRemovalMatte(pixels, 3, 1, new Float32Array([0, 0.5, 1]), 3, 1);
  assert.strictEqual(result.pixels, pixels);
  assert.deepEqual([...pixels].filter((_, index) => index % 4 !== 3), beforeRgb);
  assert.deepEqual([pixels[3], pixels[7], pixels[11]], [0, 64, 0]);
  assert.equal(result.visiblePixels, 1);
});

test('invalid, constant, and empty model masks fail without returning a false foreground', () => {
  assert.throws(() => applyBackgroundRemovalMatte(new Uint8ClampedArray(4), 1, 1, new Float32Array([0]), 1, 1), /could not separate/);
  assert.throws(() => applyBackgroundRemovalMatte(new Uint8ClampedArray(4), 1, 1, new Float32Array([Number.NaN]), 1, 1), /non-finite/);
  assert.throws(() => applyBackgroundRemovalMatte(new Uint8ClampedArray(3), 1, 1, new Float32Array([0, 1]), 2, 1), /one RGBA pixel/);
  assert.throws(() => applyBackgroundRemovalMatte(new Uint8ClampedArray([1, 2, 3, 0]), 1, 1, new Float32Array([0, 1]), 2, 1), /no visible foreground/);
  assert.throws(() => applyBackgroundRemovalMatte(new Uint8ClampedArray(4), 1, 1, [0, 1], 2, 1), /invalid confidence mask/);
});
