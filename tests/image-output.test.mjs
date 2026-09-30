import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRenderedImageOutput, MAX_IMAGE_OUTPUT_BYTES } from '../src/image-output.js';

const mimeTypes = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

function rendered(format = 'png', quality = 90, bytes = new Uint8Array([1, 2, 3, 4])) {
  return {
    bytes, width: 1200, height: 800,
    format, outputFormat: format, outputQuality: quality,
    mimeType: mimeTypes[format],
    qualityApplied: format === 'png' ? null : true,
  };
}

test('final Pillow-RS PNG bytes become a download Blob without image re-encoding', async () => {
  const input = rendered('png', 41);
  const result = encodeRenderedImageOutput(input, { format: 'png', quality: 41 });
  assert.equal(result.blob.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await result.blob.arrayBuffer())], [1, 2, 3, 4]);
  assert.deepEqual([result.width, result.height, result.qualityApplied], [1200, 800, null]);
  assert.equal(input.bytes.byteLength, 0, 'release transferred bytes after creating the download Blob');
});

for (const format of ['jpeg', 'webp']) {
  test(`${format.toUpperCase()} output requires WASM-applied quality and preserves the encoded bytes`, async () => {
    const input = rendered(format, 73, new Uint8Array([9, 8, 7, 6]));
    const result = encodeRenderedImageOutput(input, { format, quality: 73 });
    assert.equal(result.blob.type, mimeTypes[format]);
    assert.deepEqual([...new Uint8Array(await result.blob.arrayBuffer())], [9, 8, 7, 6]);
    assert.deepEqual([result.width, result.height, result.qualityApplied], [1200, 800, true]);
    assert.equal(input.bytes.byteLength, 0);
  });
}

test('output rejects a mismatched worker result or a lossy result without applied quality', () => {
  assert.throws(() => encodeRenderedImageOutput(rendered('jpeg', 73), { format: 'jpeg', quality: 72 }), /does not match/);
  const unqualified = rendered('webp', 73);
  unqualified.qualityApplied = false;
  assert.throws(() => encodeRenderedImageOutput(unqualified, { format: 'webp', quality: 73 }), /did not apply/);
});

test('output enforces the local encoded-byte limit without allocating a canvas', () => {
  assert.equal(MAX_IMAGE_OUTPUT_BYTES, 128 * 1024 * 1024);
  const input = rendered('png');
  input.bytes = new Proxy(new Uint8Array(0), {
    get(target, property) {
      return property === 'byteLength' ? MAX_IMAGE_OUTPUT_BYTES + 1 : Reflect.get(target, property, target);
    },
  });
  assert.throws(() => encodeRenderedImageOutput(input), /128 MiB local export limit/);
});
