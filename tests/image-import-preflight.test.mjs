import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeRasterDimensions,
  IMAGE_HEADER_SCAN_BYTES,
  inspectRasterDimensions,
  MAX_IMAGE_SOURCE_PIXELS,
} from '../src/image-engine.js';

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpegHeader(width, height) {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08,
    (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x01]);
  return bytes;
}

function gifHeader(width, height) {
  const bytes = new Uint8Array(10);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true); view.setUint16(8, height, true);
  return bytes;
}

function bmpHeader(width, height) {
  const bytes = new Uint8Array(26); const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]); view.setUint32(14, 40, true);
  view.setInt32(18, width, true); view.setInt32(22, height, true);
  return bytes;
}

function webpHeader(width, height) {
  const bytes = new Uint8Array(30); const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46]); view.setUint32(4, 22, true);
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8);
  view.setUint32(16, 10, true);
  const widthMinusOne = width - 1; const heightMinusOne = height - 1;
  bytes[24] = widthMinusOne & 0xff; bytes[25] = (widthMinusOne >> 8) & 0xff; bytes[26] = (widthMinusOne >> 16) & 0xff;
  bytes[27] = heightMinusOne & 0xff; bytes[28] = (heightMinusOne >> 8) & 0xff; bytes[29] = (heightMinusOne >> 16) & 0xff;
  return bytes;
}

function tiffHeader(width, height, orientation = 1) {
  const bytes = new Uint8Array(50);
  bytes.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
  const view = new DataView(bytes.buffer);
  view.setUint16(8, 3, true);
  view.setUint16(10, 256, true); view.setUint16(12, 4, true); view.setUint32(14, 1, true); view.setUint32(18, width, true);
  view.setUint16(22, 257, true); view.setUint16(24, 4, true); view.setUint32(26, 1, true); view.setUint32(30, height, true);
  view.setUint16(34, 274, true); view.setUint16(36, 3, true); view.setUint32(38, 1, true); view.setUint16(42, orientation, true);
  view.setUint32(46, 0, true);
  return bytes;
}

function jpegExifHeader(width, height, orientation) {
  const exif = Buffer.alloc(32);
  exif.write('Exif\0\0II', 0, 'binary'); exif.writeUInt16LE(42, 8); exif.writeUInt32LE(8, 10); exif.writeUInt16LE(1, 14);
  exif.writeUInt16LE(0x0112, 16); exif.writeUInt16LE(3, 18); exif.writeUInt32LE(1, 20); exif.writeUInt16LE(orientation, 24);
  const app1 = Buffer.alloc(4); app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(exif.length + 2, 2);
  const frame = Buffer.from([0xff, 0xc0, 0, 8, 8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 1]);
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), app1, exif, frame]));
}

function bmffHeader(brand) {
  const bytes = new Uint8Array(24); const view = new DataView(bytes.buffer);
  view.setUint32(0, 24); bytes.set([0x66, 0x74, 0x79, 0x70], 4);
  bytes.set(new TextEncoder().encode(brand), 8); bytes.set([0x00, 0x00, 0x00, 0x00], 12);
  bytes.set(new TextEncoder().encode('mif1'), 16);
  return bytes;
}

test('image import preflight accepts recognized sources within the Pillow pixel ceiling', () => {
  assert.equal(IMAGE_HEADER_SCAN_BYTES, 1024 * 1024);
  assert.deepEqual(assertSafeRasterDimensions(pngHeader(1920, 1080)), {
    width: 1920,
    height: 1080,
    pixels: 2_073_600,
  });
  assert.deepEqual(assertSafeRasterDimensions(pngHeader(MAX_IMAGE_SOURCE_PIXELS, 1)), {
    width: MAX_IMAGE_SOURCE_PIXELS,
    height: 1,
    pixels: MAX_IMAGE_SOURCE_PIXELS,
  });
});

test('image import preflight extracts bounded dimensions from every advertised raster header', () => {
  for (const [format, source, expected] of [
    ['JPEG', jpegHeader(320, 240), { width: 320, height: 240, pixels: 76_800 }],
    ['GIF', gifHeader(320, 240), { width: 320, height: 240, pixels: 76_800 }],
    ['BMP', bmpHeader(320, 240), { width: 320, height: 240, pixels: 76_800 }],
    ['WebP', webpHeader(320, 240), { width: 320, height: 240, pixels: 76_800 }],
    ['TIFF', tiffHeader(320, 240), { width: 320, height: 240, pixels: 76_800 }],
    ['JPEG with EXIF orientation', jpegExifHeader(320, 240, 6), { width: 240, height: 320, pixels: 76_800 }],
    ['PNM', new TextEncoder().encode('P6\n320 240\n'), { width: 320, height: 240, pixels: 76_800 }],
  ]) {
    assert.deepEqual(assertSafeRasterDimensions(source), expected, `${format} dimensions should be parsed before decoding`);
  }
});

test('image import preflight applies all eight EXIF orientations to visible JPEG dimensions', () => {
  for (let orientation = 1; orientation <= 8; orientation += 1) {
    const dimensions = assertSafeRasterDimensions(jpegExifHeader(3, 2, orientation));
    assert.deepEqual([dimensions.width, dimensions.height], orientation >= 5 ? [2, 3] : [3, 2]);
    assert.equal(dimensions.pixels, 6);
  }
});

test('image import preflight applies TIFF Orientation to visible dimensions', () => {
  for (let orientation = 1; orientation <= 8; orientation += 1) {
    const dimensions = assertSafeRasterDimensions(tiffHeader(3, 2, orientation));
    assert.deepEqual([dimensions.width, dimensions.height], orientation >= 5 ? [2, 3] : [3, 2]);
    assert.equal(dimensions.pixels, 6);
  }
});

test('image import preflight gives explicit local-decoder limits for HEIC and AVIF', () => {
  for (const [brand, message] of [['heic', /HEIC\/HEIF.*not supported.*Pillow-RS/i], ['avif', /AVIF.*not supported.*Pillow-RS/i]]) {
    assert.throws(() => assertSafeRasterDimensions(bmffHeader(brand)), error => {
      assert.match(error.message, message);
      assert.match(error.message, /JPEG or PNG/);
      return true;
    });
  }
});

test('image import preflight keeps JPEG metadata scanning within its fixed prefix bound', () => {
  const source = new Uint8Array(IMAGE_HEADER_SCAN_BYTES + 32);
  source[0] = 0xff; source[1] = 0xd8;
  let offset = 2;
  while (offset + 4 + 65_533 < IMAGE_HEADER_SCAN_BYTES) {
    source.set([0xff, 0xe1, 0xff, 0xff], offset);
    offset += 65_537;
  }
  source.set([0xff, 0xe1, 0xff, 0xff], offset);
  assert.equal(inspectRasterDimensions(source), null);
  assert.throws(() => assertSafeRasterDimensions(source), /could not verify this image size before decoding/i);
});

test('image import preflight rejects oversized sources before browser decoding', () => {
  const source = pngHeader(10_001, 8_000);
  assert.deepEqual(inspectRasterDimensions(source), { width: 10_001, height: 8_000, pixels: 80_008_000 });
  assert.throws(() => assertSafeRasterDimensions(source), error => {
    assert.equal(error.name, 'RangeError');
    assert.match(error.message, /10,001 × 8,000/);
    assert.match(error.message, /resize it before importing/i);
    return true;
  });
});

test('image import preflight fails closed with a user-facing message for unknown headers', () => {
  const source = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
  assert.equal(inspectRasterDimensions(source), null);
  assert.throws(() => assertSafeRasterDimensions(source), error => {
    assert.equal(error.name, 'Error');
    assert.match(error.message, /could not verify this image size before decoding/i);
    assert.match(error.message, /PNG, JPEG, GIF, BMP, WebP, TIFF, or PNM/);
    return true;
  });
});
