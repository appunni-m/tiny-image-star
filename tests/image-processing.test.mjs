import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as pillow from '../wasm/pillow_rs_js.js';
import { decodeOriginal, renderImage } from '../src/image-processing.js';

function twoPixelBmp() {
  const bytes = Buffer.alloc(62);
  bytes.write('BM', 0, 'ascii'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(2, 18); bytes.writeInt32LE(1, 22); bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(8, 34);
  bytes.set([0, 0, 255, 0, 255, 0, 0, 0], 54); return new Uint8Array(bytes);
}

function fourColorBmp() {
  // BMP rows are stored bottom-up and each row is padded to a four-byte edge.
  const bytes = Buffer.alloc(70);
  bytes.write('BM', 0, 'ascii'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(2, 18); bytes.writeInt32LE(2, 22); bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(16, 34);
  bytes.set([255, 0, 0, 0, 255, 255, 0, 0], 54); // blue, yellow, padding
  bytes.set([0, 0, 255, 0, 255, 0, 0, 0], 62); // red, green, padding
  return new Uint8Array(bytes);
}

function pixel(image, x, y) { return [...image.getpixel(x, y)].slice(0, 3); }

test('vendored Pillow-RS WebAssembly opens a local source and emits adjusted PNG bytes', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, twoPixelBmp());
  try {
    const baseline = renderImage(original, {});
    const adjusted = renderImage(original, { brightness: -35, contrast: 10, saturation: 18, blur: 1 });
    assert.equal(adjusted.width, 2); assert.equal(adjusted.height, 1);
    assert.ok(adjusted.bytes.length > 50); assert.notDeepEqual(adjusted.bytes, baseline.bytes);
    const reopened = decodeOriginal(pillow, adjusted.bytes);
    assert.equal(reopened.width, 2); assert.equal(reopened.height, 1); reopened.free();
  } finally { original.free(); }
});

test('Pillow-RS rejects image pixel budgets before editing', async () => {
  await pillow.default();
  assert.throws(() => decodeOriginal(pillow, twoPixelBmp(), { maxPixels: 1 }), /too large/);
});

test('Pillow-RS crops normalized source bounds, rotates clockwise, and reports output metadata', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, fourColorBmp());
  try {
    const rendered = renderImage(original, {}, {
      crop: { left: 0, top: 0, right: 0.5, bottom: 1 },
      rotation: 90,
    });
    assert.deepEqual(
      { sourceWidth: rendered.sourceWidth, sourceHeight: rendered.sourceHeight, width: rendered.width, height: rendered.height },
      { sourceWidth: 2, sourceHeight: 2, width: 2, height: 1 },
    );
    assert.deepEqual(rendered.crop, { left: 0, top: 0, right: 0.5, bottom: 1 });
    assert.deepEqual(rendered.cropPixels, { left: 0, top: 0, right: 1, bottom: 2 });
    assert.equal(rendered.rotation, 90);

    const output = decodeOriginal(pillow, rendered.bytes);
    try {
      assert.deepEqual(pixel(output, 0, 0), [0, 0, 255]); // bottom-left blue rotates to top-left
      assert.deepEqual(pixel(output, 1, 0), [255, 0, 0]); // top-left red rotates to top-right
    } finally { output.free(); }

    // Processing always starts from the caller-owned original, even after a crop/turn render.
    assert.equal(original.width, 2); assert.equal(original.height, 2);
    assert.deepEqual(pixel(original, 0, 0), [255, 0, 0]);
  } finally { original.free(); }
});

test('Pillow-RS validates normalized crop bounds and quarter-turn rotation', async () => {
  await pillow.default();
  const original = decodeOriginal(pillow, fourColorBmp());
  try {
    assert.throws(() => renderImage(original, {}, { crop: { left: 0, top: 0, right: 1.1, bottom: 1 } }), /crop edges/);
    assert.throws(() => renderImage(original, {}, { crop: { left: 0.5, top: 0, right: 0.5, bottom: 1 } }), /crop edges/);
    assert.throws(() => renderImage(original, {}, { rotation: 45 }), /quarter turns/);
    assert.throws(() => renderImage(original, {}, { rotation: 90.5 }), /quarter turns/);
  } finally { original.free(); }
});
