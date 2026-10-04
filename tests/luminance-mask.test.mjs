import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyLuminanceMaskAlpha, initializeLuminanceMaskWasm, SVG_LUMINANCE_COEFFICIENTS } from '../src/luminance-mask.js';

const wasmBytes = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
const imageOps = await initializeLuminanceMaskWasm(wasmBytes);

test('converts sRGB luminance and source alpha into white mask coverage', () => {
  const imageData = { data: new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 255, 255, 255,
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 128,
    255, 0, 0, 128
  ]) };

  assert.equal(applyLuminanceMaskAlpha(imageData), imageData);
  assert.deepEqual([...imageData.data], [
    255, 255, 255, 0,
    255, 255, 255, 255,
    255, 255, 255, 54,
    255, 255, 255, 182,
    255, 255, 255, 18,
    255, 255, 255, 128,
    255, 255, 255, 27
  ]);
  assert.deepEqual(SVG_LUMINANCE_COEFFICIENTS, { red: .2125, green: .7154, blue: .0721 });
  const roundingBoundary = { data: new Uint8ClampedArray([0, 0, 104, 255]) };
  applyLuminanceMaskAlpha(roundingBoundary);
  assert.equal(roundingBoundary.data[3], 7, 'use the SVG 1.1 sRGB coefficients at rounding boundaries');
});

test('linearRGB masks linearize sRGB channels before applying luminance weights', () => {
  const srgb = { data: new Uint8ClampedArray([128, 128, 128, 255]) };
  const linear = { data: new Uint8ClampedArray([128, 128, 128, 255]) };
  applyLuminanceMaskAlpha(srgb);
  applyLuminanceMaskAlpha(linear, { colorSpace: 'linearRGB' });
  assert.equal(srgb.data[3], 128);
  assert.equal(linear.data[3], 55);
});

test('rejects invalid ImageData and unsupported color spaces', () => {
  assert.throws(() => applyLuminanceMaskAlpha(null), TypeError);
  assert.throws(() => applyLuminanceMaskAlpha({ data: [255, 255, 255, 255] }), TypeError);
  assert.throws(() => applyLuminanceMaskAlpha({ data: new Uint8ClampedArray([1, 2, 3]) }), TypeError);
  assert.throws(() => applyLuminanceMaskAlpha({ data: new Uint8ClampedArray([1, 2, 3, 4]) }, { colorSpace: 'display-p3' }), TypeError);
});

test('Pillow-RS WASM rejects incomplete RGBA pixels', () => {
  assert.throws(() => imageOps.luminanceMaskAlpha(new Uint8Array([1, 2, 3]), false), { name: 'ValueError' });
});
