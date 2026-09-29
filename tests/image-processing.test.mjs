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
