import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRenderedImageOutput, MAX_CANVAS_OUTPUT_PIXELS } from '../src/image-output.js';

function rendered(width = 2, height = 1) {
  return { bytes: new Uint8Array([137, 80, 78, 71]), width, height };
}

test('PNG output keeps the full-resolution Pillow bytes without allocating a canvas', async () => {
  let canvasCreated = false;
  const result = await encodeRenderedImageOutput(rendered(1200, 800), { format: 'png', quality: 41 }, {
    createBitmap: () => { throw new Error('PNG export should not decode its result.'); },
    createCanvas: () => { canvasCreated = true; return null; },
  });
  assert.equal(result.blob.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await result.blob.arrayBuffer())], [137, 80, 78, 71]);
  assert.deepEqual([result.width, result.height, result.qualityApplied], [1200, 800, null]);
  assert.equal(canvasCreated, false);
});

for (const format of ['jpeg', 'webp']) {
  test(`${format.toUpperCase()} output applies requested browser quality at source resolution and releases surfaces`, async () => {
    const observed = { decodedBlobType: null, alpha: null, fill: null, painted: false, draw: false, quality: null, bitmapClosed: false, canvasWidth: null, canvasHeight: null };
    let canvas;
    const result = await encodeRenderedImageOutput(rendered(64, 32), { format, quality: 73 }, {
      createBitmap: async blob => {
        observed.decodedBlobType = blob.type;
        return { width: 64, height: 32, close() { observed.bitmapClosed = true; } };
      },
      createCanvas: () => {
        canvas = {
          width: 0, height: 0,
          getContext(type, options) {
            assert.equal(type, '2d');
            observed.alpha = options.alpha;
            return {
              set fillStyle(value) { observed.fill = value; },
              fillRect() { observed.painted = true; },
              drawImage(_bitmap, x, y) { observed.draw = x === 0 && y === 0; },
            };
          },
          toBlob(callback, mime, quality) {
            observed.quality = quality;
            observed.canvasWidth = this.width;
            observed.canvasHeight = this.height;
            callback(new Blob(['encoded'], { type: mime }));
          },
        };
        return canvas;
      },
    });
    assert.deepEqual([result.width, result.height, result.qualityApplied], [64, 32, true]);
    assert.equal(result.blob.type, format === 'jpeg' ? 'image/jpeg' : 'image/webp');
    assert.equal(observed.decodedBlobType, 'image/png');
    assert.equal(observed.alpha, format !== 'jpeg');
    assert.equal(observed.painted, format === 'jpeg');
    if (format === 'jpeg') assert.equal(observed.fill, '#fff');
    assert.equal(observed.draw, true);
    assert.equal(observed.quality, 0.73);
    assert.deepEqual([observed.canvasWidth, observed.canvasHeight], [64, 32]);
    assert.equal(observed.bitmapClosed, true);
    assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  });
}

test('lossy output rejects work above the bounded browser-encoding surface', async () => {
  await assert.rejects(
    encodeRenderedImageOutput(rendered(MAX_CANVAS_OUTPUT_PIXELS + 1, 1), { format: 'webp' }),
    /Resize the source/,
  );
});

test('lossy output rejects an unavailable browser codec and still releases the canvas', async () => {
  let canvas;
  await assert.rejects(encodeRenderedImageOutput(rendered(), { format: 'webp' }, {
    createBitmap: async () => ({ width: 2, height: 1, close() {} }),
    createCanvas: () => (canvas = {
      width: 0, height: 0,
      getContext: () => ({ drawImage() {} }),
      toBlob(callback) { callback(new Blob(['fallback'], { type: 'image/png' })); },
    }),
  }), /WEBP export is not supported/);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
});
