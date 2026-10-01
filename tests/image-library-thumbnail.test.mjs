import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageLibraryThumbnailBlob, IMAGE_LIBRARY_THUMBNAIL_EDGE, MAX_IMAGE_LIBRARY_THUMBNAIL_BYTES } from '../src/image-library-thumbnail.js';

function canvasDocument({ encodedSizes = [2], context = true } = {}) {
  const draws = [];
  const qualities = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      if (!context) return null;
      return {
        fillRect() {},
        drawImage(...args) { draws.push(args); }
      };
    },
    toBlob(callback, type, quality) {
      qualities.push(quality);
      const size = encodedSizes[Math.min(qualities.length - 1, encodedSizes.length - 1)];
      callback(new Blob([new Uint8Array(size)], { type }));
    }
  };
  return { documentObject: { createElement: () => canvas }, canvas, draws, qualities };
}

test('thumbnail generation scales within a 128px square, retries quality under its storage cap and releases canvas memory', async () => {
  const harness = canvasDocument({ encodedSizes: [MAX_IMAGE_LIBRARY_THUMBNAIL_BYTES + 1, 4096] });
  const source = { width: 800, height: 400 };
  const blob = await createImageLibraryThumbnailBlob(source, harness);

  assert.equal(blob.type, 'image/jpeg');
  assert.equal(blob.size, 4096);
  assert.equal(IMAGE_LIBRARY_THUMBNAIL_EDGE, 128);
  assert.deepEqual(harness.qualities, [.78, .52]);
  assert.deepEqual(harness.draws[0], [source, 6, 35, 116, 58]);
  assert.equal(harness.canvas.width, 0);
  assert.equal(harness.canvas.height, 0);
});

test('thumbnail generation fails safely when decoding or canvas support is missing', async () => {
  const harness = canvasDocument({ context: false });
  await assert.rejects(() => createImageLibraryThumbnailBlob({ width: 12, height: 10 }, harness), /cannot create image thumbnails/);
  assert.equal(harness.canvas.width, 0);
  assert.equal(harness.canvas.height, 0);
  await assert.rejects(() => createImageLibraryThumbnailBlob({ width: 0, height: 10 }, harness), /decoded image is required/);
});
