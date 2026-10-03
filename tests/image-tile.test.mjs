import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_IMAGE_TILE_SCALE,
  MAX_IMAGE_TILE_SCALE,
  MIN_IMAGE_TILE_SCALE,
  imageTilePatternTransform,
  imageTileSourceDimensions,
  isValidImageTileScale
} from '../src/image-tile.js';

function transformPoint(matrix, x, y) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f
  };
}

function expectedPoint({ u, v, imageWidth, imageHeight, tileWidth, tileHeight, rotation, flipHorizontal, flipVertical, x, y }) {
  const px = (flipHorizontal ? imageWidth - u : u) / imageWidth * tileWidth;
  const py = (flipVertical ? imageHeight - v : v) / imageHeight * tileHeight;
  const turn = ((rotation % 360) + 360) % 360;
  const point = turn === 90 ? { x: tileHeight - py, y: px }
    : turn === 180 ? { x: tileWidth - px, y: tileHeight - py }
      : turn === 270 ? { x: py, y: tileWidth - px }
        : { x: px, y: py };
  return { x: x + point.x, y: y + point.y };
}

test('image-tile scale limits are finite, inclusive, and match the UI bounds', () => {
  assert.equal(DEFAULT_IMAGE_TILE_SCALE, 1);
  assert.equal(isValidImageTileScale(MIN_IMAGE_TILE_SCALE), true);
  assert.equal(isValidImageTileScale(MAX_IMAGE_TILE_SCALE), true);
  assert.equal(isValidImageTileScale(MIN_IMAGE_TILE_SCALE - Number.EPSILON), false);
  assert.equal(isValidImageTileScale(MAX_IMAGE_TILE_SCALE + 1), false);
  for (const value of [0, -1, NaN, Infinity, '1', null]) assert.equal(isValidImageTileScale(value), false);
});

test('source dimensions swap only for quarter turns and normalize signed rotations', () => {
  assert.deepEqual(imageTileSourceDimensions(640, 360, 0), { width: 640, height: 360 });
  assert.deepEqual(imageTileSourceDimensions(640, 360, 90), { width: 360, height: 640 });
  assert.deepEqual(imageTileSourceDimensions(640, 360, 180), { width: 640, height: 360 });
  assert.deepEqual(imageTileSourceDimensions(640, 360, 270), { width: 360, height: 640 });
  assert.deepEqual(imageTileSourceDimensions(640, 360, -90), { width: 360, height: 640 });
  assert.deepEqual(imageTileSourceDimensions(640, 360, 450), { width: 360, height: 640 });
  for (const [width, height, rotation] of [[0, 4, 0], [4, -1, 0], [4, 2, 45], [4, 2, Infinity]]) {
    assert.equal(imageTileSourceDimensions(width, height, rotation), null);
  }
});

test('tile transforms map all bitmap corners correctly for quarter turns and source-axis flips', () => {
  const imageWidth = 4;
  const imageHeight = 2;
  const tileWidth = 20;
  const tileHeight = 10;
  const x = 7;
  const y = 11;
  const corners = [
    [0, 0], [imageWidth, 0], [imageWidth, imageHeight], [0, imageHeight]
  ];

  for (const rotation of [0, 90, 180, 270]) {
    for (const flipHorizontal of [false, true]) {
      for (const flipVertical of [false, true]) {
        const geometry = imageTilePatternTransform({
          imageWidth, imageHeight, sourceWidth: tileWidth, sourceHeight: tileHeight,
          rotation, flipHorizontal, flipVertical, x, y
        });
        assert.ok(geometry, `geometry exists for ${rotation}° / ${flipHorizontal} / ${flipVertical}`);
        assert.deepEqual([geometry.width, geometry.height], rotation === 90 || rotation === 270
          ? [tileHeight, tileWidth] : [tileWidth, tileHeight]);
        for (const [u, v] of corners) {
          const actual = transformPoint(geometry.matrix, u, v);
          const expected = expectedPoint({
            u, v, imageWidth, imageHeight, tileWidth, tileHeight,
            rotation, flipHorizontal, flipVertical, x, y
          });
          assert.ok(Math.abs(actual.x - expected.x) < 1e-10, `x at ${rotation}° corner (${u},${v})`);
          assert.ok(Math.abs(actual.y - expected.y) < 1e-10, `y at ${rotation}° corner (${u},${v})`);
        }
      }
    }
  }
});

test('tile period uses original source dimensions while scaling the preview bitmap', () => {
  const geometry = imageTilePatternTransform({
    imageWidth: 400, imageHeight: 200,
    sourceWidth: 1600, sourceHeight: 800,
    scalingFactor: 0.5, rotation: 90, x: 3, y: 5
  });
  assert.deepEqual(geometry, {
    matrix: { a: 0, b: 2, c: -2, d: 0, e: 403, f: 5 },
    width: 400, height: 800,
    tileWidth: 800, tileHeight: 400
  });

  const sourceSize = imageTilePatternTransform({ imageWidth: 1600, imageHeight: 800, scalingFactor: 0.5 });
  const previewSize = imageTilePatternTransform({ imageWidth: 400, imageHeight: 200, sourceWidth: 1600, sourceHeight: 800, scalingFactor: 0.5 });
  assert.deepEqual([sourceSize.width, sourceSize.height], [800, 400]);
  assert.deepEqual([previewSize.width, previewSize.height], [800, 400]);
  assert.deepEqual([sourceSize.matrix.a, sourceSize.matrix.d], [0.5, 0.5]);
  assert.deepEqual([previewSize.matrix.a, previewSize.matrix.d], [2, 2]);
});

test('tile scale bounds and rotations remain valid for repeated pattern periods', () => {
  for (const scalingFactor of [MIN_IMAGE_TILE_SCALE, MAX_IMAGE_TILE_SCALE]) {
    for (const rotation of [0, 90, 180, 270]) {
      const geometry = imageTilePatternTransform({
        imageWidth: 80, imageHeight: 45, sourceWidth: 320, sourceHeight: 180,
        scalingFactor, rotation
      });
      assert.ok(geometry);
      assert.equal(geometry.width > 0 && Number.isFinite(geometry.width), true);
      assert.equal(geometry.height > 0 && Number.isFinite(geometry.height), true);
      assert.equal(Object.values(geometry.matrix).every(Number.isFinite), true);
      assert.notEqual(geometry.matrix.a * geometry.matrix.d - geometry.matrix.b * geometry.matrix.c, 0);
    }
  }
});

test('malformed and unrepresentable tile geometry is rejected without throwing', () => {
  for (const options of [
    null,
    [],
    { imageWidth: 0, imageHeight: 10 },
    { imageWidth: 10, imageHeight: -1 },
    { imageWidth: 10, imageHeight: 10, sourceWidth: 0 },
    { imageWidth: 10, imageHeight: 10, scalingFactor: 0 },
    { imageWidth: 10, imageHeight: 10, scalingFactor: 16.01 },
    { imageWidth: 10, imageHeight: 10, rotation: 45 },
    { imageWidth: 10, imageHeight: 10, flipHorizontal: 1 },
    { imageWidth: 10, imageHeight: 10, flipVertical: null },
    { imageWidth: 10, imageHeight: 10, x: Infinity },
    { imageWidth: Number.MAX_VALUE, imageHeight: Number.MAX_VALUE, sourceWidth: 10, sourceHeight: 10 },
    { imageWidth: Number.MAX_VALUE, imageHeight: Number.MAX_VALUE, sourceWidth: 0.01, sourceHeight: 10 },
    { imageWidth: 1, imageHeight: 1, sourceWidth: 1e200, sourceHeight: 1e200 }
  ]) {
    assert.doesNotThrow(() => assert.equal(imageTilePatternTransform(options), null));
  }
});
