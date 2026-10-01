import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as pillow from '../wasm/pillow_rs_js.js';
import { decodeOriginal, renderImage } from '../src/image-processing.js';
import { createPillowFallbackImage } from '../src/fallback-image-bitmap.js';
import { imageDecodeFailureMessage, isImageImportCandidate, requiresPillowFallback } from '../src/image-intake.js';
import { assertSafeRasterDimensions, IMAGE_HEADER_SCAN_BYTES, inspectRasterDimensions } from '../src/image-engine.js';
import { assertImagePayloadMatchesPreflight } from '../src/image-memory-budget.js';

await pillow.default({ module_or_path: await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url)) });

test('mobile raster files with an empty browser MIME still reach safe format preflight', () => {
  for (const name of ['photo.HEIC', 'photo.heif', 'scan.tif', 'scan.tiff', 'photo.avif']) {
    assert.equal(isImageImportCandidate({ name, type: '' }), true, `${name} should reach the decoder capability message`);
  }
  assert.equal(isImageImportCandidate({ name: 'archive.zip', type: '' }), false);
  assert.equal(isImageImportCandidate({ name: 'blob', type: 'IMAGE/JPEG' }), true);
});

function rgbTiff(orientation = 1) {
  const bytes = Buffer.alloc(146);
  bytes.write('II', 0, 'ascii'); bytes.writeUInt16LE(42, 2); bytes.writeUInt32LE(8, 4); bytes.writeUInt16LE(10, 8);
  const entries = [
    [256, 4, 1, 2], [257, 4, 1, 1], [258, 3, 3, 134], [259, 3, 1, 1], [262, 3, 1, 2],
    [273, 4, 1, 140], [277, 3, 1, 3], [278, 4, 1, 1], [279, 4, 1, 6], [274, 3, 1, orientation],
  ];
  let offset = 10;
  for (const [tag, type, count, value] of entries) {
    bytes.writeUInt16LE(tag, offset); bytes.writeUInt16LE(type, offset + 2); bytes.writeUInt32LE(count, offset + 4);
    if (type === 3 && count === 1) bytes.writeUInt16LE(value, offset + 8);
    else bytes.writeUInt32LE(value, offset + 8);
    offset += 12;
  }
  bytes.writeUInt32LE(0, offset);
  bytes.writeUInt16LE(8, 134); bytes.writeUInt16LE(8, 136); bytes.writeUInt16LE(8, 138);
  bytes.set([255, 0, 0, 0, 255, 0], 140);
  return new Uint8Array(bytes);
}

function exifJpeg(jpeg, orientation) {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt16LE(0, 20); tiff.writeUInt32LE(0, 22);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const marker = Buffer.alloc(4); marker[0] = 0xff; marker[1] = 0xe1; marker.writeUInt16BE(payload.length + 2, 2);
  return new Uint8Array(Buffer.concat([Buffer.from(jpeg.slice(0, 2)), marker, payload, Buffer.from(jpeg.slice(2))]));
}

function jpegFixture() {
  const image = new pillow.Image('RGB', 3, 2, null);
  const colors = [
    [250, 10, 20], [20, 240, 30], [15, 30, 245],
    [235, 220, 15], [20, 210, 225], [225, 15, 220],
  ];
  let bytes;
  try {
    colors.forEach((color, index) => image.putpixel(index % 3, Math.floor(index / 3), ...color));
    bytes = new Uint8Array(image.saveWithQuality('JPEG', null, 100));
  } finally { image.free(); }
  return bytes;
}

function webpChunk(type, payload) {
  const chunk = Buffer.alloc(8 + payload.length + (payload.length & 1));
  chunk.write(type, 0, 'ascii');
  chunk.writeUInt32LE(payload.length, 4);
  Buffer.from(payload).copy(chunk, 8);
  return chunk;
}

function webpWithExif(base, orientation, largeMetadata) {
  const imageChunks = [];
  for (let offset = 12; offset + 8 <= base.length;) {
    const size = new DataView(base.buffer, base.byteOffset + offset).getUint32(4, true);
    const end = offset + 8 + size + (size & 1);
    imageChunks.push(Buffer.from(base.subarray(offset, end)));
    offset = end;
  }
  const view = pillow.Image.open(base);
  const width = view.width; const height = view.height;
  view.free();
  const extendedHeader = Buffer.alloc(10);
  extendedHeader[0] = 0x08; // VP8X says the WebP includes an EXIF chunk.
  extendedHeader.writeUIntLE(width - 1, 4, 3);
  extendedHeader.writeUIntLE(height - 1, 7, 3);
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt16LE(0, 20); tiff.writeUInt32LE(0, 22);
  const body = Buffer.concat([
    Buffer.from('WEBP'),
    webpChunk('VP8X', extendedHeader),
    ...imageChunks,
    webpChunk('XMP ', largeMetadata),
    webpChunk('EXIF', Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff])),
  ]);
  const container = Buffer.alloc(8 + body.length);
  container.write('RIFF', 0, 'ascii'); container.writeUInt32LE(body.length, 4); body.copy(container, 8);
  return new Uint8Array(container);
}

function expectedSourcePoint(orientation, x, y, width, height) {
  if (orientation === 2) return [width - 1 - x, y];
  if (orientation === 3) return [width - 1 - x, height - 1 - y];
  if (orientation === 4) return [x, height - 1 - y];
  if (orientation === 5) return [y, x];
  if (orientation === 6) return [y, height - 1 - x];
  if (orientation === 7) return [width - 1 - y, height - 1 - x];
  if (orientation === 8) return [width - 1 - y, x];
  return [x, y];
}

test('latest checked-in Pillow-RS WASM decodes a bounded classic TIFF source locally', () => {
  const bytes = rgbTiff();
  assert.deepEqual(assertSafeRasterDimensions(bytes), { width: 2, height: 1, pixels: 2 });
  const original = decodeOriginal(pillow, bytes);
  try {
    assert.deepEqual([original.width, original.height, original.mode], [2, 1, 'RGB']);
    assert.deepEqual([...original.getpixel(0, 0)].slice(0, 3), [255, 0, 0]);
    assert.deepEqual([...original.getpixel(1, 0)].slice(0, 3), [0, 255, 0]);
  } finally { original.free(); }
});

test('all eight TIFF Orientation values are applied in Pillow-RS without changing encoded sources', () => {
  const reference = decodeOriginal(pillow, rgbTiff(1));
  try {
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      const bytes = rgbTiff(orientation);
      const retainedOriginalBytes = bytes.slice();
      assert.equal(requiresPillowFallback(bytes), true);
      const dimensions = assertSafeRasterDimensions(bytes);
      const width = orientation >= 5 ? 1 : 2;
      const height = orientation >= 5 ? 2 : 1;
      assert.deepEqual([dimensions.width, dimensions.height], [width, height]);
      const original = decodeOriginal(pillow, bytes);
      try {
        assert.deepEqual([original.width, original.height], [width, height]);
        for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
          const [sourceX, sourceY] = expectedSourcePoint(orientation, x, y, 2, 1);
          assert.deepEqual([...original.getpixel(x, y)], [...reference.getpixel(sourceX, sourceY)], `TIFF orientation ${orientation} pixel (${x}, ${y})`);
        }
        const preview = renderImage(original, { brightness: 10 });
        assert.deepEqual([preview.width, preview.height], [width, height]);
        assert.deepEqual(bytes, retainedOriginalBytes, 'edits are derived from an immutable retained source');
      } finally { original.free(); }
    }
  } finally { reference.free(); }
});

test('Pillow-RS applies all eight JPEG EXIF orientations to the same original pixels', () => {
  const jpeg = jpegFixture();
  const reference = decodeOriginal(pillow, exifJpeg(jpeg, 1));
  try {
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      const bytes = exifJpeg(jpeg, orientation);
      assert.equal(requiresPillowFallback(bytes), orientation !== 1);
      assert.deepEqual(assertSafeRasterDimensions(bytes), {
        width: orientation >= 5 ? 2 : 3,
        height: orientation >= 5 ? 3 : 2,
        pixels: 6,
      });
      const oriented = decodeOriginal(pillow, bytes);
      try {
        const width = orientation >= 5 ? 2 : 3;
        const height = orientation >= 5 ? 3 : 2;
        assert.deepEqual([oriented.width, oriented.height], [width, height], `EXIF orientation ${orientation} dimensions`);
        for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
          const [sourceX, sourceY] = expectedSourcePoint(orientation, x, y, 3, 2);
          assert.deepEqual([...oriented.getpixel(x, y)], [...reference.getpixel(sourceX, sourceY)], `EXIF orientation ${orientation} pixel (${x}, ${y})`);
        }
      } finally { oriented.free(); }
    }
  } finally { reference.free(); }
});

test('WebP EXIF orientations 5–8 are read beyond the bounded prefix and applied to pixels', () => {
  const image = new pillow.Image('RGB', 3, 2, null);
  const colors = [
    [250, 10, 20], [20, 240, 30], [15, 30, 245],
    [235, 220, 15], [20, 210, 225], [225, 15, 220],
  ];
  let base;
  try {
    colors.forEach((color, index) => image.putpixel(index % 3, Math.floor(index / 3), ...color));
    base = new Uint8Array(image.saveWithQuality('WEBP', null, 100));
  } finally { image.free(); }
  const largeMetadata = Buffer.alloc(1_050_000);
  largeMetadata.write('<x:xmpmeta', 0, 'ascii');
  const reference = decodeOriginal(pillow, base);
  try {
    for (let orientation = 5; orientation <= 8; orientation += 1) {
      const bytes = webpWithExif(base, orientation, largeMetadata);
      assert.ok(bytes.byteLength > IMAGE_HEADER_SCAN_BYTES);
      const prefixDimensions = assertSafeRasterDimensions(bytes.subarray(0, IMAGE_HEADER_SCAN_BYTES));
      assert.deepEqual([prefixDimensions.width, prefixDimensions.height], [3, 2]);
      assert.equal(prefixDimensions.orientation, null, 'the prefix records unresolved orientation metadata');
      assert.equal(prefixDimensions.orientationPending, true);

      const dimensions = assertSafeRasterDimensions(bytes);
      assert.deepEqual([dimensions.width, dimensions.height, dimensions.pixels], [2, 3, 6]);
      assert.equal(dimensions.orientation, orientation);
      assert.equal(requiresPillowFallback(bytes), true);
      assert.equal(assertImagePayloadMatchesPreflight({
        expectedDimensions: prefixDimensions,
        expectedByteLength: bytes.byteLength,
        actualDimensions: dimensions,
        actualByteLength: bytes.byteLength,
      }), true);

      const oriented = decodeOriginal(pillow, bytes);
      try {
        assert.deepEqual([oriented.width, oriented.height], [2, 3], `WebP orientation ${orientation} dimensions`);
        for (let y = 0; y < oriented.height; y += 1) for (let x = 0; x < oriented.width; x += 1) {
          const [sourceX, sourceY] = expectedSourcePoint(orientation, x, y, 3, 2);
          assert.deepEqual([...oriented.getpixel(x, y)], [...reference.getpixel(sourceX, sourceY)],
            `WebP orientation ${orientation} pixel (${x}, ${y})`);
        }
      } finally { oriented.free(); }
    }
  } finally { reference.free(); }
});

test('Pillow-RS rendered fallback follows its local TIFF decoder and remains bounded', async () => {
  const sourceBytes = rgbTiff(6);
  const retainedSource = sourceBytes.slice();
  let renderCalls = 0;
  const fallback = await createPillowFallbackImage(async () => {
    renderCalls += 1;
    const source = decodeOriginal(pillow, sourceBytes);
    try { return renderImage(source, {}); }
    finally { source.free(); }
  }, {
    maxEdge: 1200,
    createBitmap: async input => {
      const renderedBytes = new Uint8Array(await input.arrayBuffer());
      const preview = decodeOriginal(pillow, renderedBytes);
      try { return { width: preview.width, height: preview.height, close() {} }; }
      finally { preview.free(); }
    },
  });
  assert.equal(renderCalls, 1);
  assert.deepEqual([fallback.sourceWidth, fallback.sourceHeight], [1, 2]);
  assert.deepEqual([fallback.bitmap.width, fallback.bitmap.height], [1, 2]);
  assert.deepEqual(sourceBytes, retainedSource, 'fallback decode must not rewrite or detach retained originals');
  fallback.bitmap.close();
});

test('pinned Pillow-RS WASM rejects HEIC/AVIF and importer messages explain the local limit', () => {
  for (const [brand, format] of [['heic', 'heif'], ['avif', 'avif']]) {
    const bytes = new Uint8Array(24);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 24); bytes.set([0x66, 0x74, 0x79, 0x70], 4);
    bytes.set(new TextEncoder().encode(brand), 8); bytes.set(new TextEncoder().encode('mif1'), 16);
    assert.throws(() => pillow.Image.open(bytes), /cannot identify image file/i);
    assert.throws(() => assertSafeRasterDimensions(bytes), format === 'heif' ? /HEIC\/HEIF.*not supported.*Pillow-RS/i : /AVIF.*not supported.*Pillow-RS/i);
    assert.match(imageDecodeFailureMessage(bytes, new Error('cannot identify image file')), /cannot identify image file/);
  }
});

test('unsupported TIFF compression gets a conversion action after Pillow-RS decode failure', () => {
  const bytes = rgbTiff();
  assert.match(imageDecodeFailureMessage(bytes, new Error('unknown TIFF compression')), /TIFF variant.*unknown TIFF compression.*PNG or JPEG/i);
  assert.equal(imageDecodeFailureMessage(bytes, new Error('This browser cannot create a downsampled image preview.')),
    'This browser cannot create a downsampled image preview.');
});
