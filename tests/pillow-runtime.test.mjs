import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initPillow, { Image } from '../wasm/pillow_rs_js.js';

const wasmBytes = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
await initPillow({ module_or_path: wasmBytes });

test('the pinned Pillow-RS WASM loads, applies color enhancement, and encodes quality-controlled JPEGs', () => {
  const source = new Image('RGB', 2, 2, 220, 80, 20, 255);
  let adjusted;
  try {
    adjusted = source.enhanceColor(0.5);
    assert.equal(adjusted.getFlattenedData().length, 12);

    const png = source.saveWithQuality('PNG', null, null);
    assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const lowQuality = source.saveWithQuality('JPEG', null, 40);
    const highQuality = source.saveWithQuality('JPEG', null, 90);
    assert.deepEqual([...lowQuality.slice(0, 2)], [255, 216]);
    assert.deepEqual([...highQuality.slice(0, 2)], [255, 216]);
    assert.notDeepEqual([...lowQuality], [...highQuality], 'JPEG quality should affect the encoded output');
  } finally {
    adjusted?.free();
    source.free();
  }
});

test('the latest Pillow-RS WASM preserves native-L RankFilter output', () => {
  const source = new Image('L', 3, 3, 0, 0, 0, 255);
  let filtered;
  try {
    for (let value = 0; value < 9; value += 1) {
      source.putpixelValue(value % 3, Math.floor(value / 3), value);
    }
    filtered = source.rankFilter(3, 1);
    assert.deepEqual([...filtered.getFlattenedData()], [0, 0, 1, 0, 1, 2, 3, 4, 5]);
  } finally {
    filtered?.free();
    source.free();
  }
});
