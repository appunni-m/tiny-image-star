import test from 'node:test';
import assert from 'node:assert/strict';
import { createFallbackImage, fallbackImageDimensions } from '../src/fallback-image-bitmap.js';

test('fallback bitmap dimensions preserve aspect ratio and cap the long edge without upscaling', () => {
  assert.deepEqual(fallbackImageDimensions(4000, 2000), { width: 1200, height: 600 });
  assert.deepEqual(fallbackImageDimensions(2000, 4000), { width: 600, height: 1200 });
  assert.deepEqual(fallbackImageDimensions(1200, 700), { width: 1200, height: 700 });
  assert.deepEqual(fallbackImageDimensions(320, 240), { width: 320, height: 240 });
  assert.deepEqual(fallbackImageDimensions(1, 4000), { width: 1, height: 1200 });
  assert.deepEqual(fallbackImageDimensions(4000, 2000, 800), { width: 800, height: 400 });
});

test('fallback bitmap sizing rejects invalid source dimensions and limits', () => {
  for (const dimensions of [[0, 1], [1, 0], [-1, 10], [1.5, 10], [Number.MAX_SAFE_INTEGER, 2]]) {
    assert.throws(() => fallbackImageDimensions(...dimensions), RangeError);
  }
  assert.throws(() => fallbackImageDimensions(10, 10, 0), RangeError);
  assert.throws(() => fallbackImageDimensions(10, 10, 1.5), RangeError);
});

test('fallback decode closes the full-resolution bitmap and preserves its source dimensions', async () => {
  const source = { width: 4000, height: 2000, closed: false, close() { this.closed = true; } };
  const fallback = { width: 1200, height: 600, closed: false, close() { this.closed = true; } };
  const calls = [];
  const result = await createFallbackImage({ name: 'source' }, {
    createBitmap: async (...args) => {
      calls.push(args);
      return args.length === 1 ? source : fallback;
    },
  });

  assert.equal(result.bitmap, fallback);
  assert.equal(result.sourceWidth, 4000);
  assert.equal(result.sourceHeight, 2000);
  assert.equal(source.closed, true);
  assert.equal(fallback.closed, false);
  assert.deepEqual(calls[1][1], { resizeWidth: 1200, resizeHeight: 600, resizeQuality: 'high' });
});

test('small source bitmaps are retained directly without an unnecessary resize copy', async () => {
  const bitmap = { width: 640, height: 480, closed: false, close() { this.closed = true; } };
  let calls = 0;
  const result = await createFallbackImage({ name: 'small' }, {
    createBitmap: async () => { calls += 1; return bitmap; },
  });

  assert.equal(result.bitmap, bitmap);
  assert.equal(result.sourceWidth, 640);
  assert.equal(result.sourceHeight, 480);
  assert.equal(bitmap.closed, false);
  assert.equal(calls, 1);
});

test('fallback uses a bounded canvas if the browser cannot resize ImageBitmaps', async () => {
  const source = { width: 3000, height: 1500, closed: false, close() { this.closed = true; } };
  const fallback = { width: 1200, height: 600, closed: false, close() { this.closed = true; } };
  const drawn = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: (...args) => drawn.push(args) }),
  };
  const calls = [];
  const result = await createFallbackImage({ name: 'source' }, {
    createBitmap: async (...args) => {
      calls.push(args);
      if (args.length === 1 && calls.length === 1) return source;
      if (args.length === 2) throw new Error('resize options unsupported');
      return fallback;
    },
    createCanvas: (width, height) => {
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
  });

  assert.equal(result.bitmap, fallback);
  assert.equal(source.closed, true);
  assert.deepEqual(drawn, [[source, 0, 0, 1200, 600]]);
  assert.equal(calls.length, 3);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
});
