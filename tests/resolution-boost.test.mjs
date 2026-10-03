import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyResolutionBoostTile,
  MAX_RESOLUTION_BOOST_OUTPUT_PIXELS,
  MAX_RESOLUTION_BOOST_SOURCE_PIXELS,
  RESOLUTION_BOOST_SCALE,
  resolutionBoostTiles,
  rgbaPixelsToNchw,
  upscaleRgbaAlpha,
  validateResolutionBoostDimensions,
} from '../src/resolution-boost.js';

test('resolution boost rejects oversized dimensions before allocating output', () => {
  const admitted = validateResolutionBoostDimensions(1024, 512);
  assert.equal(admitted.sourcePixels, MAX_RESOLUTION_BOOST_SOURCE_PIXELS);
  assert.equal(admitted.outputWidth * admitted.outputHeight, MAX_RESOLUTION_BOOST_OUTPUT_PIXELS);
  assert.throws(() => validateResolutionBoostDimensions(1025, 512), /524,288 source pixels/);
  assert.throws(() => validateResolutionBoostDimensions(2049, 16), /2,048 pixels per edge/);
  assert.throws(() => validateResolutionBoostDimensions(15, 16), /16 through 2,048/);
  assert.throws(() => validateResolutionBoostDimensions(1.5, 32), /16 through 2,048/);
});

test('resolution boost tile cores cover every source pixel exactly once and retain bounded overlap', () => {
  const width = 401;
  const height = 273;
  const tileSize = 128;
  const halo = 16;
  const tiles = resolutionBoostTiles(width, height, { tileSize, halo });
  const coverage = new Uint8Array(width * height);
  for (const tile of tiles) {
    assert.ok(tile.input.width <= tileSize && tile.input.height <= tileSize);
    assert.equal(tile.outputWidth, tile.core.width * RESOLUTION_BOOST_SCALE);
    assert.equal(tile.outputHeight, tile.core.height * RESOLUTION_BOOST_SCALE);
    assert.equal(tile.fullOutputWidth, width * RESOLUTION_BOOST_SCALE);
    assert.equal(tile.fullOutputHeight, height * RESOLUTION_BOOST_SCALE);
    assert.equal(tile.input.left + tile.core.inputOffsetX, tile.core.left);
    assert.equal(tile.input.top + tile.core.inputOffsetY, tile.core.top);
    for (let y = tile.core.top; y < tile.core.top + tile.core.height; y += 1) {
      for (let x = tile.core.left; x < tile.core.left + tile.core.width; x += 1) {
        coverage[y * width + x] += 1;
      }
    }
  }
  assert.ok(tiles.length > 1);
  assert.ok(coverage.every(count => count === 1), 'tile output cores must have no gaps or overlaps');
  assert.throws(() => resolutionBoostTiles(width, height, { tileSize: 64, halo: 32 }), /tile geometry/);
});

test('RGBA tiles become normalized planar RGB tensors without modifying source alpha', () => {
  const rgba = new Uint8ClampedArray([
    255, 64, 0, 0,
    0, 128, 255, 127,
  ]);
  const tensor = rgbaPixelsToNchw(rgba, 2, 1);
  assert.deepEqual([tensor[0], tensor[1], tensor[4], tensor[5]], [1, 0, 0, 1]);
  assert.ok(Math.abs(tensor[2] - 64 / 255) < 1e-7);
  assert.ok(Math.abs(tensor[3] - 128 / 255) < 1e-7);
  assert.deepEqual([...rgba], [255, 64, 0, 0, 0, 128, 255, 127]);
  assert.throws(() => rgbaPixelsToNchw(rgba, 1.5, 1), /positive integers/);
  assert.throws(() => rgbaPixelsToNchw(rgba.subarray(1), 2, 1), /complete RGBA/);
});

test('multi-tile RGB results copy only their cores into the full output buffer', () => {
  const width = 160;
  const height = 80;
  const tiles = resolutionBoostTiles(width, height, { tileSize: 128, halo: 16 });
  const output = new Uint8ClampedArray(width * 4 * height * 4 * 4);
  for (const tile of tiles) {
    const inputWidth = tile.input.width;
    const inputHeight = tile.input.height;
    const planeSize = inputWidth * inputHeight * 16;
    const rgb = new Float32Array(planeSize * 3);
    rgb.fill(0.25, 0, planeSize);
    rgb.fill(0.5, planeSize, planeSize * 2);
    rgb.fill(0.75, planeSize * 2);
    copyResolutionBoostTile(output, rgb, inputWidth, tile);
  }
  for (let pixel = 0; pixel < output.length; pixel += 4) {
    assert.deepEqual([...output.subarray(pixel, pixel + 3)], [64, 128, 191]);
    assert.equal(output[pixel + 3], 0, 'the model RGB copy must not invent output alpha');
  }
  const invalid = { ...tiles[0], core: { ...tiles[0].core, left: width } };
  assert.throws(() => copyResolutionBoostTile(output, new Float32Array(1), tiles[0].input.width, invalid), /invalid tile|outside its destination/);
});

test('resolution boost alpha is bilinearly expanded from the original image', () => {
  const source = new Uint8ClampedArray(16 * 16 * 4);
  source.set([10, 20, 30, 0], 0);
  source.set([40, 50, 60, 255], 4);
  source.set([70, 80, 90, 128], 16 * 4);
  source.set([100, 110, 120, 64], (16 + 1) * 4);
  const output = new Uint8ClampedArray(64 * 64 * 4);
  upscaleRgbaAlpha(output, source, 16, 16);
  const alphaAt = (x, y) => output[(y * 64 + x) * 4 + 3];
  assert.equal(alphaAt(0, 0), 0);
  assert.equal(alphaAt(3, 3), 99, 'interior alpha uses bilinear interpolation between the four source pixels');
  assert.ok([...output].every((_, index) => index % 4 !== 3 || Number.isInteger(output[index])));
  assert.throws(() => upscaleRgbaAlpha(new Uint8ClampedArray(4), source, 16, 16), /dimensions/);
});
