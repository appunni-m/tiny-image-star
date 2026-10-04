import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import * as pillow from '../wasm/pillow_rs_js.js';
import { decodeOriginal, imagePreviewDimensions, imagePreviewResolutionMatches, renderImage, renderImageOutput } from '../src/image-processing.js';
import { createImageFill } from '../src/image-fills.js';
import { rotateImageTransforms } from '../src/image-transforms.js';
import { estimatePreviewMemoryReservationBytes } from '../src/image-memory-budget.js';
import { DecodedSourceCache } from '../src/decoded-source-cache.js';
import { addNode, applyImageRecipe, createDocument, createImageRecipe, createNode, findNode } from '../src/model.js';
import { imagePreviewKey, imagePreviewRenderSettingsForNode } from '../src/image-preview-runtime.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = PNG_CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function memoryBoundPngFixture(mode, width = 384, height = 257) {
  const bitDepth = mode === 'I;16' ? 16 : 8;
  const colorType = ({ RGB: 2, RGBA: 6, P: 3, 'I;16': 0 })[mode];
  const channels = ({ RGB: 3, RGBA: 4, P: 1, 'I;16': 1 })[mode];
  const bytesPerSample = bitDepth / 8;
  let seed = 0x475abf11;
  const nextByte = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 24;
  };
  const rowBytes = width * channels * bytesPerSample;
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (rowBytes + 1);
    raw[rowOffset] = 0;
    for (let index = 0; index < rowBytes; index += 1) {
      if (mode === 'P') raw[rowOffset + index + 1] = nextByte() & 31;
      else raw[rowOffset + index + 1] = nextByte();
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = bitDepth; header[9] = colorType;
  const chunks = [PNG_SIGNATURE, pngChunk('IHDR', header)];
  if (mode === 'P') {
    const palette = Buffer.alloc(256 * 3);
    for (let index = 0; index < 256; index += 1) {
      palette[index * 3] = (index * 73) & 255;
      palette[index * 3 + 1] = (index * 29 + 19) & 255;
      palette[index * 3 + 2] = (index * 111 + 7) & 255;
    }
    const transparency = Buffer.alloc(32);
    for (let index = 0; index < transparency.length; index += 1) transparency[index] = (index * 7) & 255;
    chunks.push(pngChunk('PLTE', palette), pngChunk('tRNS', transparency));
  }
  chunks.push(pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(chunks));
}

function twoPixelBmp() {
  const bytes = Buffer.alloc(62);
  bytes.write('BM', 0, 'ascii'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(2, 18); bytes.writeInt32LE(1, 22); bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(8, 34);
  bytes.set([0, 0, 255, 0, 255, 0, 0, 0], 54); return new Uint8Array(bytes);
}

function fourColorBmp() {
  // BMP rows are stored bottom-up and each row is padded to a four-byte edge.
  const bytes = Buffer.alloc(70);
  bytes.write('BM', 0, 'ascii'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(2, 18); bytes.writeInt32LE(2, 22); bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(16, 34);
  bytes.set([255, 0, 0, 0, 255, 255, 0, 0], 54); // blue, yellow, padding
  bytes.set([0, 0, 255, 0, 255, 0, 0, 0], 62); // red, green, padding
  return new Uint8Array(bytes);
}

function edgeBandsBmp() {
  const width = 12; const height = 8;
  const rowBytes = Math.ceil(width * 3 / 4) * 4;
  const pixelBytes = rowBytes * height;
  const bytes = Buffer.alloc(54 + pixelBytes);
  bytes.write('BM', 0, 'ascii'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22); bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(pixelBytes, 34);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = x < 4 ? 0 : x < 8 ? 128 : 255;
      const offset = 54 + (height - 1 - y) * rowBytes + x * 3;
      bytes[offset] = value; bytes[offset + 1] = value; bytes[offset + 2] = value;
    }
  }
  return new Uint8Array(bytes);
}

function sharpnessScalePng(width = 128, height = 64) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const edge = x < Math.floor(width * 0.46) ? 30
        : x < Math.floor(width * 0.5) ? 30 + (x - Math.floor(width * 0.46)) * 38 : 220;
      const texture = ((x * 17 + y * 31 + x * y * 7) % 29) - 14;
      const value = Math.max(0, Math.min(255, edge + texture));
      const offset = row + 1 + x * 3;
      raw[offset] = value;
      raw[offset + 1] = Math.max(0, Math.min(255, value + (x % 13)));
      raw[offset + 2] = value;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  return new Uint8Array(Buffer.concat([
    PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function fourPixelRgbaPng() {
  const image = new pillow.Image('RGBA', 4, 1, null);
  try {
    image.putpixel(0, 0, 10, 20, 30, 0);
    image.putpixel(1, 0, 50, 100, 150, 64);
    image.putpixel(2, 0, 100, 150, 200, 128);
    image.putpixel(3, 0, 250, 240, 230, 255);
    return new Uint8Array(image.saveWithInput('PNG', null));
  } finally { image.free(); }
}

function pixel(image, x, y) { return [...image.getpixel(x, y)].slice(0, 3); }

test('preview dimension planning matches Pillow-RS thumbnail bounds including aspect-ratio ties', () => {
  assert.deepEqual(imagePreviewDimensions(4000, 2000, 1000), { width: 1000, height: 500 });
  assert.deepEqual(imagePreviewDimensions(16, 9, 8), { width: 8, height: 5 });
  assert.deepEqual(imagePreviewDimensions(2, 4, 3), { width: 2, height: 3 }, 'floating-point-equivalent ratio choices match Pillow-RS');
  assert.deepEqual(imagePreviewDimensions(3, 4, 2), { width: 1, height: 2 }, 'exact aspect-error ties choose the lower dimension');
  assert.deepEqual(imagePreviewDimensions(4, 3, 2), { width: 2, height: 2 });
  assert.deepEqual(imagePreviewDimensions(384, 257), { width: 384, height: 257 }, 'omitting the optional cap preserves legacy full-size previews');
  assert.deepEqual(imagePreviewDimensions(384, 257, 512), { width: 384, height: 257 }, 'preview bounds never upscale small images');
  assert.throws(() => imagePreviewDimensions(0, 1, 10), /positive safe integers/);
  assert.throws(() => imagePreviewDimensions(1, 1, 0), /positive safe integer/);
});

test('preview resolution validation rejects aspect drift beyond one pixel at the fitted scale', () => {
  assert.equal(imagePreviewResolutionMatches(2048, 1, 2048, 1), true);
  assert.equal(imagePreviewResolutionMatches(999, 499, 1000, 500), true,
    'independent integer rounding may shift the fitted width by one pixel');
  assert.equal(imagePreviewResolutionMatches(3000, 2, 4000, 4), false,
    'a tiny-axis panorama must not accept hundreds of pixels of width error when the short axis is scaled');
  assert.equal(imagePreviewResolutionMatches(1000, 499, 1000, 500), false,
    'the best uniform scale still differs by two pixels on the long axis');
  assert.equal(imagePreviewResolutionMatches(1001, 500, 1000, 500), false,
    'preview output cannot exceed its reserved dimensions');
});

test('bounded Pillow-RS previews scale blur after geometry while exports stay full resolution', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, memoryBoundPngFixture('RGB', 128, 64));
  try {
    const preview = renderImage(original, { blur: 8 }, {}, pillow, { previewMaxDimension: 32 });
    assert.deepEqual([preview.width, preview.height], [32, 16]);
    assert.deepEqual([preview.sourceWidth, preview.sourceHeight], [128, 64], 'preview bounds do not replace original source metadata');
    assert.deepEqual([original.width, original.height], [128, 64], 'preview rendering leaves the retained decoded source unchanged');

    // Compare against Pillow-RS's exact operation order: thumbnail the render
    // copy, then apply blur radius 8 * (32 / 128) = 2 in preview pixels.
    let reduced = original.copy();
    let expected;
    try {
      reduced.thumbnail(32, 32);
      expected = reduced.gaussianBlur(2);
      assert.deepEqual(preview.bytes, new Uint8Array(expected.saveWithInput('PNG', null)),
        'blur radius follows the preview scale and filters run after thumbnailing');
    } finally {
      expected?.free();
      reduced.free();
    }

    const uncappedPreview = renderImage(original, {}, {}, pillow);
    assert.deepEqual([uncappedPreview.width, uncappedPreview.height], [128, 64]);

    const rotated = renderImage(original, { blur: 4 }, { rotation: 90 }, pillow, { previewMaxDimension: 32 });
    assert.deepEqual([rotated.width, rotated.height], [16, 32], 'the cap applies after rotation');
    assert.deepEqual([rotated.sourceWidth, rotated.sourceHeight, rotated.rotation], [128, 64, 90]);

    const crop = { left: 0.125, top: 0.125, right: 0.75, bottom: 0.75 };
    const cropped = renderImage(original, {}, { crop, rotation: 90 }, pillow, { previewMaxDimension: 32 });
    assert.deepEqual([cropped.width, cropped.height], [16, 32]);
    assert.deepEqual(cropped.crop, crop, 'preview bounds leave normalized recipe crop metadata intact');
    assert.deepEqual(cropped.cropPixels, { left: 16, top: 8, right: 96, bottom: 48 });

    const exported = renderImageOutput(original, {}, { rotation: 90 }, pillow, {
      format: 'png', previewMaxDimension: 32,
    });
    assert.deepEqual([exported.width, exported.height], [64, 128], 'standalone export ignores the interactive preview cap');
    const reopened = decodeOriginal(pillow, exported.bytes);
    try { assert.deepEqual([reopened.width, reopened.height], [64, 128]); }
    finally { reopened.free(); }
  } finally { original.free(); }
});

test('latest Pillow-RS RGBA thumbnail resize preserves pixels from the previous pinned runtime', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const image = new pillow.Image('RGBA', 37, 29, null);
  let seed = 0x41524742;
  const nextByte = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 24;
  };
  try {
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        image.putpixel(x, y, nextByte(), nextByte(), nextByte(), nextByte());
      }
    }
    image.thumbnail(11, 11);
    const pixels = Array.from({ length: image.height }, (_, y) =>
      Array.from({ length: image.width }, (_, x) => [...image.getpixel(x, y)])
    );
    const digest = createHash('sha256').update(JSON.stringify(pixels)).digest('hex');
    assert.deepEqual([image.width, image.height], [11, 9]);
    assert.equal(digest, 'f4d0fe91245ff188fdb31bffa232b047028c2507ff02e1f12ae3cf98d47a17ea',
      'RGBA downsampling stays byte-identical to the previous pinned Pillow-RS build');
  } finally { image.free(); }
});

test('vendored Pillow-RS WebAssembly opens a local source and emits adjusted PNG bytes', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, twoPixelBmp());
  try {
    const baseline = renderImage(original, {});
    const adjusted = renderImage(original, { brightness: -35, contrast: 10, saturation: 18, blur: 1 });
    assert.equal(adjusted.width, 2); assert.equal(adjusted.height, 1);
    assert.ok(adjusted.bytes.length > 50); assert.notDeepEqual(adjusted.bytes, baseline.bytes);
    assert.ok(adjusted.bytes.byteLength <= estimatePreviewMemoryReservationBytes(adjusted).encodedByteLength,
      'the preview admission bound covers the actual local Pillow-RS PNG output');
    const reopened = decodeOriginal(pillow, adjusted.bytes);
    assert.equal(reopened.width, 2); assert.equal(reopened.height, 1); reopened.free();
  } finally { original.free(); }
});

test('preview admission covers actual Pillow-RS RGB, RGBA, palette, and 16-bit PNG outputs', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  for (const [sourceMode, decodedMode] of [['RGB', 'RGB'], ['RGBA', 'RGBA'], ['P', 'P'], ['I;16', 'I;16']]) {
    const original = decodeOriginal(pillow, memoryBoundPngFixture(sourceMode));
    try {
      assert.equal(original.mode, decodedMode);
      const rendered = renderImage(original, {}, {}, pillow);
      const admission = estimatePreviewMemoryReservationBytes(rendered);
      assert.ok(rendered.bytes.byteLength <= admission.encodedByteLength,
        `${sourceMode} input output (${rendered.bytes.byteLength} bytes) fits the pre-render ${admission.encodedByteLength}-byte PNG estimate`);
      const reopened = decodeOriginal(pillow, rendered.bytes);
      try {
        assert.deepEqual([reopened.width, reopened.height], [rendered.width, rendered.height]);
        if (sourceMode === 'I;16') assert.equal(reopened.mode, 'RGB', '16-bit browser previews normalize to the reserved 8-bit channel depth');
      } finally { reopened.free(); }
    } finally { original.free(); }
  }
});

test('recipe output format and quality travel through Pillow jobs without lossy editor previews', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, fourPixelRgbaPng());
  try {
    for (const [format, quality] of [['png', 90], ['jpeg', 73], ['webp', 62]]) {
      const rendered = renderImage(original, { brightness: 12 }, {}, pillow, { format, quality });
      assert.equal(rendered.mimeType, 'image/png', 'the editable preview remains lossless PNG');
      assert.deepEqual([rendered.outputFormat, rendered.outputQuality], [format, quality]);
      assert.deepEqual([...rendered.bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
    assert.throws(() => renderImage(original, {}, {}, pillow, { format: 'gif' }), /PNG, JPEG, or WebP/);
    assert.throws(() => renderImage(original, {}, {}, pillow, { quality: 0 }), /1 to 100/);
  } finally { original.free(); }
});

test('Pillow-RS standalone output encodes PNG, JPEG, and WebP at the cropped and rotated source dimensions', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, fourColorBmp());
  const formatCases = [
    { format: 'png', mimeType: 'image/png', signature: [137, 80, 78, 71, 13, 10, 26, 10] },
    { format: 'jpeg', mimeType: 'image/jpeg', signature: [255, 216, 255] },
    { format: 'webp', mimeType: 'image/webp', signature: [82, 73, 70, 70] },
  ];
  try {
    for (const output of formatCases) {
      const rendered = renderImageOutput(original, { brightness: 12 }, {
        crop: { left: 0, top: 0, right: 0.5, bottom: 1 }, rotation: 90,
      }, pillow, { format: output.format, quality: 73 });
      assert.equal(rendered.mode, 'export');
      assert.equal(rendered.mimeType, output.mimeType);
      assert.deepEqual([rendered.width, rendered.height], [2, 1]);
      assert.deepEqual([...rendered.bytes.slice(0, output.signature.length)], output.signature);
      assert.equal(rendered.outputFormat, output.format);
      assert.equal(rendered.outputQuality, 73, 'the requested recipe quality remains attached to the result');
      if (output.format === 'png') assert.equal(rendered.qualityApplied, null, 'PNG has no lossy quality setting');
      else assert.equal(rendered.qualityApplied, true, 'the Pillow-RS WASM encoder applies the requested quality');

      const reopened = decodeOriginal(pillow, rendered.bytes);
      try { assert.deepEqual([reopened.width, reopened.height], [2, 1], 'the selected Pillow encoder preserves full cropped/rotated pixels'); }
      finally { reopened.free(); }
    }
    assert.deepEqual(pixel(original, 0, 0), [255, 0, 0], 'all output formats render a copy and preserve the decoded original');
  } finally { original.free(); }
});

test('Pillow-RS WASM quality controls produce distinct JPEG and WebP output from one source', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const source = new pillow.Image('RGB', 128, 128, null);
  const pixels = new Uint8Array(128 * 128 * 3);
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index * 73 + Math.floor(index / 11) * 29) % 256;
  source.putdata(pixels);
  const original = decodeOriginal(pillow, new Uint8Array(source.saveWithInput('PNG', null)));
  source.free();
  try {
    for (const format of ['jpeg', 'webp']) {
      const low = renderImageOutput(original, {}, {}, pillow, { format, quality: 20 });
      const high = renderImageOutput(original, {}, {}, pillow, { format, quality: 90 });
      assert.equal(low.qualityApplied, true);
      assert.equal(high.qualityApplied, true);
      assert.notDeepEqual(low.bytes, high.bytes, `${format.toUpperCase()} encoder must apply the selected quality`);
    }
    assert.equal(original.width, 128, 'quality exports must keep the decoded source reusable');
  } finally { original.free(); }
});

test('Pillow-RS JPEG output flattens transparent source pixels on white before encoding', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, fourPixelRgbaPng());
  try {
    const rendered = renderImageOutput(original, {}, {}, pillow, { format: 'jpeg', quality: 90 });
    assert.equal(rendered.mimeType, 'image/jpeg');
    assert.deepEqual([...rendered.bytes.slice(0, 3)], [255, 216, 255]);
    const reopened = decodeOriginal(pillow, rendered.bytes);
    try {
      assert.equal(reopened.mode, 'RGB');
      assert.ok(pixel(reopened, 0, 0).every(channel => channel >= 240), 'fully transparent pixels composite to white');
      assert.ok(pixel(reopened, 1, 0)[0] > 150, 'partially transparent pixels blend with the white matte');
      assert.deepEqual([reopened.width, reopened.height], [4, 1]);
    } finally { reopened.free(); }
    assert.equal(original.mode, 'RGBA');
    assert.equal([...original.getpixel(0, 0)][3], 0, 'JPEG encoding must not mutate source alpha');
  } finally { original.free(); }
});

test('Pillow-RS WebP output retains RGBA alpha samples', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, fourPixelRgbaPng());
  try {
    const rendered = renderImageOutput(original, { contrast: 12 }, {}, pillow, { format: 'webp', quality: 80 });
    const reopened = decodeOriginal(pillow, rendered.bytes);
    try {
      assert.equal(reopened.mode, 'RGBA');
      assert.deepEqual(Array.from({ length: 4 }, (_, x) => [...reopened.getpixel(x, 0)][3]), [0, 64, 128, 255]);
    } finally { reopened.free(); }
  } finally { original.free(); }
});

test('Pillow-RS sharpness strengthens or softens edges from the unchanged source', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, edgeBandsBmp());
  try {
    const baseline = renderImage(original, {});
    const sharpened = renderImage(original, { sharpness: 100 });
    const softened = renderImage(original, { sharpness: -100 });
    const baselineImage = decodeOriginal(pillow, baseline.bytes);
    const sharpenedImage = decodeOriginal(pillow, sharpened.bytes);
    const softenedImage = decodeOriginal(pillow, softened.bytes);
    try {
      assert.deepEqual([sharpened.width, sharpened.height], [12, 8]);
      assert.ok(pixel(sharpenedImage, 4, 3)[0] > pixel(baselineImage, 4, 3)[0], 'positive sharpness should strengthen the transition edge');
      assert.ok(pixel(softenedImage, 4, 3)[0] < pixel(baselineImage, 4, 3)[0], 'negative sharpness should soften the transition edge');
      assert.equal(pixel(original, 4, 3)[0], 128, 'preview rendering must leave the original WASM image unchanged');
    } finally {
      baselineImage.free(); sharpenedImage.free(); softenedImage.free();
    }
  } finally { original.free(); }
});

test('sharpness preview strength tracks full-resolution sharpness at the displayed scale', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, sharpnessScalePng());
  const cases = [
    { adjustments: { sharpness: 100 }, maxDifference: 3 },
    { adjustments: { sharpness: -100 }, maxDifference: 3 },
    { adjustments: { sharpness: 100, brightness: 20, saturation: 20 }, maxDifference: 4 },
    { adjustments: { sharpness: -100, brightness: -15, saturation: 25 }, maxDifference: 4 },
  ];
  try {
    for (const { adjustments, maxDifference } of cases) {
      const neutralAdjustments = { ...adjustments, sharpness: 0 };
      const fullEdited = decodeOriginal(pillow, renderImage(original, adjustments).bytes);
      const fullNeutral = decodeOriginal(pillow, renderImage(original, neutralAdjustments).bytes);
      fullEdited.thumbnail(32, 32); fullNeutral.thumbnail(32, 32);
      const previewEdited = decodeOriginal(pillow, renderImage(original, adjustments, {}, pillow, { previewMaxDimension: 32 }).bytes);
      const previewNeutral = decodeOriginal(pillow, renderImage(original, neutralAdjustments, {}, pillow, { previewMaxDimension: 32 }).bytes);
      try {
        assert.deepEqual([previewEdited.width, previewEdited.height], [32, 16]);
        let maximum = 0; let total = 0; let samples = 0;
        for (let y = 0; y < previewEdited.height; y += 1) {
          for (let x = 0; x < previewEdited.width; x += 1) {
            const fullEditedPixel = pixel(fullEdited, x, y);
            const fullNeutralPixel = pixel(fullNeutral, x, y);
            const previewEditedPixel = pixel(previewEdited, x, y);
            const previewNeutralPixel = pixel(previewNeutral, x, y);
            for (const [channel, value] of previewEditedPixel.entries()) {
              const expectedSharpness = fullEditedPixel[channel] - fullNeutralPixel[channel];
              const previewSharpness = value - previewNeutralPixel[channel];
              const difference = Math.abs(expectedSharpness - previewSharpness);
              maximum = Math.max(maximum, difference);
              total += difference;
              samples += 1;
            }
          }
        }
        assert.ok(maximum <= maxDifference,
          `sharpness preview max channel difference ${maximum} exceeds ${maxDifference} for ${JSON.stringify(adjustments)}`);
        assert.ok(total / samples < maxDifference / 2,
          `sharpness preview mean effect difference is too large for ${JSON.stringify(adjustments)}`);
        assert.deepEqual([original.width, original.height], [128, 64], 'preview comparison must keep the retained source intact');
      } finally {
        fullEdited.free(); fullNeutral.free(); previewEdited.free(); previewNeutral.free();
      }
    }
  } finally { original.free(); }
});

test('Pillow-RS rejects image pixel budgets before editing', async () => {
  await pillow.default();
  assert.throws(() => decodeOriginal(pillow, twoPixelBmp(), { maxPixels: 1 }), /too large/);
});

test('Pillow-RS crops normalized source bounds, rotates clockwise, and reports output metadata', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, fourColorBmp());
  try {
    const rendered = renderImage(original, {}, {
      crop: { left: 0, top: 0, right: 0.5, bottom: 1 },
      rotation: 90,
    });
    assert.deepEqual(
      { sourceWidth: rendered.sourceWidth, sourceHeight: rendered.sourceHeight, width: rendered.width, height: rendered.height },
      { sourceWidth: 2, sourceHeight: 2, width: 2, height: 1 },
    );
    assert.deepEqual(rendered.crop, { left: 0, top: 0, right: 0.5, bottom: 1 });
    assert.deepEqual(rendered.cropPixels, { left: 0, top: 0, right: 1, bottom: 2 });
    assert.equal(rendered.rotation, 90);

    const output = decodeOriginal(pillow, rendered.bytes);
    try {
      assert.deepEqual(pixel(output, 0, 0), [0, 0, 255]); // bottom-left blue rotates to top-left
      assert.deepEqual(pixel(output, 1, 0), [255, 0, 0]); // top-left red rotates to top-right
    } finally { output.free(); }

    // Processing always starts from the caller-owned original, even after a crop/turn render.
    assert.equal(original.width, 2); assert.equal(original.height, 2);
    assert.deepEqual(pixel(original, 0, 0), [255, 0, 0]);
  } finally { original.free(); }
});

test('latest Pillow-RS WASM flips pixels horizontally and vertically after crop and rotation', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, fourColorBmp());
  try {
    const horizontal = renderImage(original, {}, { flipHorizontal: true }, pillow);
    assert.deepEqual(horizontal.bytes.slice(0, 8), Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.deepEqual([horizontal.flipHorizontal, horizontal.flipVertical], [true, false]);
    const horizontalPixels = decodeOriginal(pillow, horizontal.bytes);
    try {
      assert.deepEqual(pixel(horizontalPixels, 0, 0), [0, 255, 0]);
      assert.deepEqual(pixel(horizontalPixels, 1, 0), [255, 0, 0]);
      assert.deepEqual(pixel(horizontalPixels, 0, 1), [255, 255, 0]);
      assert.deepEqual(pixel(horizontalPixels, 1, 1), [0, 0, 255]);
    } finally { horizontalPixels.free(); }

    const verticalAfterClockwiseRotation = renderImage(original, {}, {
      rotation: 90, flipHorizontal: true,
    }, pillow);
    const verticalPixels = decodeOriginal(pillow, verticalAfterClockwiseRotation.bytes);
    try {
      assert.deepEqual([verticalAfterClockwiseRotation.width, verticalAfterClockwiseRotation.height], [2, 2]);
      assert.deepEqual(pixel(verticalPixels, 0, 0), [255, 0, 0]);
      assert.deepEqual(pixel(verticalPixels, 1, 0), [0, 0, 255]);
      assert.deepEqual(pixel(verticalPixels, 0, 1), [0, 255, 0]);
      assert.deepEqual(pixel(verticalPixels, 1, 1), [255, 255, 0]);
    } finally { verticalPixels.free(); }

    const vertical = renderImage(original, {}, { flipVertical: true }, pillow);
    const verticalOnlyPixels = decodeOriginal(pillow, vertical.bytes);
    try {
      assert.deepEqual(pixel(verticalOnlyPixels, 0, 0), [0, 0, 255]);
      assert.deepEqual(pixel(verticalOnlyPixels, 1, 0), [255, 255, 0]);
      assert.deepEqual(pixel(verticalOnlyPixels, 0, 1), [255, 0, 0]);
      assert.deepEqual(pixel(verticalOnlyPixels, 1, 1), [0, 255, 0]);
    } finally { verticalOnlyPixels.free(); }

    const rotatedFlippedState = rotateImageTransforms({ flipHorizontal: true }, 'right');
    const carriedFlip = renderImage(original, {}, rotatedFlippedState, pillow);
    const carriedPixels = decodeOriginal(pillow, carriedFlip.bytes);
    try {
      assert.deepEqual(rotatedFlippedState, { crop: null, rotation: 90, flipHorizontal: false, flipVertical: true });
      assert.deepEqual(pixel(carriedPixels, 0, 0), [255, 255, 0]);
      assert.deepEqual(pixel(carriedPixels, 1, 0), [0, 255, 0]);
      assert.deepEqual(pixel(carriedPixels, 0, 1), [0, 0, 255]);
      assert.deepEqual(pixel(carriedPixels, 1, 1), [255, 0, 0]);
    } finally { carriedPixels.free(); }

    assert.deepEqual(pixel(original, 0, 0), [255, 0, 0], 'flips leave the retained original unchanged');
  } finally { original.free(); }
});

test('editor previews normalize high-depth Pillow modes into the reserved 8-bit PNG bound', async () => {
  await pillow.default();
  const original = new pillow.Image('I', 2, 1, null);
  original.putpixel(0, 0, 0x1234, 0, 0, 255);
  original.putpixel(1, 0, 0xabcd, 0, 0, 255);
  const originalPixels = [original.getpixel(0, 0), original.getpixel(1, 0)].map(pixel => [...pixel]);
  try {
    const rendered = renderImage(original, {}, {}, pillow);
    assert.ok(rendered.bytes.byteLength <= estimatePreviewMemoryReservationBytes(rendered).encodedByteLength,
      'the output fits the pre-dispatch upper bound even when the source is high depth');
    const output = decodeOriginal(pillow, rendered.bytes);
    try {
      assert.equal(output.mode, 'RGB', 'the browser preview uses standard 8-bit RGB samples');
      assert.equal(output.width, 2);
      assert.equal(output.height, 1);
    } finally { output.free(); }
    assert.deepEqual([original.getpixel(0, 0), original.getpixel(1, 0)].map(pixel => [...pixel]), originalPixels,
      'preview normalization leaves the retained decoded original unchanged');
  } finally { original.free(); }
});

test('successive edits and previews always render from the same retained original image', async () => {
  await pillow.default();
  const original = decodeOriginal(pillow, fourColorBmp());
  const originalPixels = Array.from({ length: 2 }, (_, y) => Array.from({ length: 2 }, (_, x) => [...original.getpixel(x, y)]));
  let earlierPreview;
  let incorrectlyCompounded;
  try {
    earlierPreview = renderImage(original, { invert: true }, {}, pillow);
    const changedSettings = renderImage(original, { brightness: 24, saturation: -15 }, { rotation: 90 }, pillow);

    // Model the bug where an editor decodes its previous preview as the next
    // render source. The correct render has to match a fresh render of the
    // current settings against the retained original, not that compounded one.
    const previousPreviewImage = decodeOriginal(pillow, earlierPreview.bytes);
    try {
      incorrectlyCompounded = renderImage(previousPreviewImage, { brightness: 24, saturation: -15 }, { rotation: 90 }, pillow);
    } finally { previousPreviewImage.free(); }

    assert.notDeepEqual(changedSettings.bytes, incorrectlyCompounded.bytes, 'the current preview is not progressively edited from the previous preview');
    assert.deepEqual(
      Array.from({ length: 2 }, (_, y) => Array.from({ length: 2 }, (_, x) => [...original.getpixel(x, y)])),
      originalPixels,
      'Pillow-RS preview renders preserve the retained decoded original across repeated edits'
    );
  } finally { original.free(); }
});

test('warm decoded-source cache keeps previews and exports anchored to immutable asset bytes', async () => {
  await pillow.default();
  const sourceBytes = fourColorBmp();
  const sourceSnapshot = sourceBytes.slice();
  const document = createDocument();
  const layer = createNode('image', {
    id: 'edited-layer', assetId: 'edited-layer-asset', adjustments: {}, transforms: {}
  });
  addNode(document, layer);
  const originalLayer = findNode(document, layer.id).node;
  const previewKey = imagePreviewKey(layer.id);
  const cache = new DecodedSourceCache({ pixelBudget: 4 });
  cache.setActive(layer.assetId);
  let decodeCount = 0;

  const renderFromCache = (adjustments, transforms, render) => cache.withSource(
    layer.assetId,
    () => {
      decodeCount += 1;
      return decodeOriginal(pillow, sourceBytes);
    },
    decodedOriginal => render(decodedOriginal, adjustments, transforms),
  );
  const renderFresh = (adjustments, transforms, render) => {
    const decodedOriginal = decodeOriginal(pillow, sourceBytes);
    try { return render(decodedOriginal, adjustments, transforms); }
    finally { decodedOriginal.free(); }
  };

  try {
    const previewCases = [
      { adjustments: { invert: true }, transforms: {} },
      { adjustments: { brightness: 24, saturation: -15 }, transforms: { rotation: 90 } },
      { adjustments: { blur: 2, temperature: 35 }, transforms: { crop: { left: 0, top: 0, right: 0.5, bottom: 1 } } },
    ];
    for (const { adjustments, transforms } of previewCases) {
      // This is the inspector's in-place update shape: edit properties on the
      // existing layer while leaving its node ID and source asset untouched.
      layer.adjustments = { ...layer.adjustments, ...adjustments };
      layer.transforms = transforms;
      const currentLayer = findNode(document, layer.id).node;
      assert.equal(currentLayer, originalLayer, 'an adjustment edit keeps the same node object in the document');
      assert.equal(currentLayer.id, 'edited-layer');
      assert.equal(currentLayer.assetId, 'edited-layer-asset');
      assert.equal(imagePreviewKey(currentLayer.id), previewKey, 'successive edits reuse the same per-layer preview slot');
      const current = imagePreviewRenderSettingsForNode(currentLayer, previewKey);
      const renderer = (source, currentAdjustments, currentTransforms) =>
        renderImage(source, currentAdjustments, currentTransforms, pillow);
      const warm = renderFromCache(current.adjustments, current.transforms, renderer);
      const expected = renderFresh(current.adjustments, current.transforms, renderer);
      assert.deepEqual(warm.result.bytes, expected.bytes,
        'a warm-cache preview matches a fresh decode rendered from the original asset bytes');
      assert.equal(warm.retained, true);
    }

    layer.adjustments = { ...layer.adjustments, brightness: -18, contrast: 12 };
    layer.transforms = { rotation: 270 };
    assert.equal(findNode(document, layer.id).node, originalLayer);
    const outputSettings = imagePreviewRenderSettingsForNode(layer, previewKey);
    const warmOutput = renderFromCache(outputSettings.adjustments, outputSettings.transforms, (source, adjustments, transforms) =>
      renderImageOutput(source, adjustments, transforms, pillow, { format: 'png' }));
    const freshOutput = renderFresh(outputSettings.adjustments, outputSettings.transforms, (source, adjustments, transforms) =>
      renderImageOutput(source, adjustments, transforms, pillow, { format: 'png' }));
    assert.deepEqual(warmOutput.result.bytes, freshOutput.bytes,
      'a full-resolution export also starts from the original asset, independent of prior previews');
    assert.equal(warmOutput.retained, true);
    assert.equal(decodeCount, 1, 'all fitting edits reuse one warm decoded source');
    assert.deepEqual(sourceBytes, sourceSnapshot, 'worker-style decoding leaves the editor-owned asset bytes unchanged');

    const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
    const inputStart = mainSource.indexOf('function updateInspectorInput(event)');
    const inputEnd = mainSource.indexOf('\nfunction ', inputStart + 10);
    assert.ok(inputStart >= 0 && inputEnd > inputStart, 'the inspector update handler is present');
    const inputHandler = mainSource.slice(inputStart, inputEnd);
    assert.match(inputHandler, /node\.adjustments = \{ \.\.\.node\.adjustments, \[key\]: value \}/,
      'the live inspector mutates adjustment state on the existing image node');
    assert.match(inputHandler, /schedulePreview\(node\)/,
      'the same image node is passed to its stable-key preview scheduler');
  } finally {
    cache.clear();
  }
});

test('saved crop and rotation recipes render repeatedly from one retained original source', async () => {
  await pillow.default();
  const sourceBytes = fourColorBmp();
  const sourceSnapshot = sourceBytes.slice();
  const document = createDocument();
  const recipeSource = createNode('image', {
    id: 'recipe-source', assetId: 'recipe-source-asset',
    adjustments: { brightness: 28, saturation: -18 },
    transforms: {
      crop: { left: 0, top: 0, right: 0.5, bottom: 1 },
      rotation: 90, flipHorizontal: true,
    },
  });
  const target = createNode('image', {
    id: 'recipe-target', assetId: 'recipe-target-asset',
    adjustments: { invert: true }, transforms: { rotation: 270 },
  });
  addNode(document, recipeSource);
  addNode(document, target);
  const savedRecipe = createImageRecipe(recipeSource, 'Crop and rotate', {}, document);
  const currentTarget = findNode(document, target.id).node;
  const previewKey = imagePreviewKey(target.id);
  const cache = new DecodedSourceCache({ pixelBudget: 4 });
  cache.setActive(target.assetId);
  let decodeCount = 0;
  const renderTarget = () => {
    const settings = imagePreviewRenderSettingsForNode(currentTarget, previewKey);
    return cache.withSource(currentTarget.assetId, () => {
      decodeCount += 1;
      return decodeOriginal(pillow, sourceBytes);
    }, source => renderImage(source, settings.adjustments, settings.transforms, pillow)).result;
  };

  let retainedOriginal;
  let previousPreviewSource;
  let expectedFromOriginal;
  try {
    const earlierPreview = renderTarget();
    previousPreviewSource = decodeOriginal(pillow, earlierPreview.bytes);
    const compounded = renderImage(previousPreviewSource, savedRecipe.adjustments, savedRecipe.transforms, pillow);

    assert.equal(applyImageRecipe(document, target.id, savedRecipe), true);
    const firstRecipePreview = renderTarget();
    retainedOriginal = decodeOriginal(pillow, sourceBytes);
    expectedFromOriginal = renderImage(retainedOriginal, savedRecipe.adjustments, savedRecipe.transforms, pillow);
    assert.deepEqual(firstRecipePreview.bytes, expectedFromOriginal.bytes,
      'applying the saved crop, rotation, and color settings matches one render from the imported bytes');
    assert.notDeepEqual(firstRecipePreview.bytes, compounded.bytes,
      'the recipe is not layered on the previously displayed image preview');

    currentTarget.adjustments = { brightness: -40, invert: true };
    currentTarget.transforms = { rotation: 180 };
    assert.equal(applyImageRecipe(document, target.id, savedRecipe), true,
      'a repeated batch-style recipe application replaces all prior image settings');
    const repeatedRecipePreview = renderTarget();
    assert.deepEqual(repeatedRecipePreview.bytes, firstRecipePreview.bytes,
      'reapplying a saved recipe is pixel-idempotent while reusing the decoded original');
    assert.equal(decodeCount, 1, 'all recipe previews share one retained decoded source');
    assert.equal(currentTarget.assetId, 'recipe-target-asset', 'non-destructive recipe application keeps the target asset identity');
    assert.deepEqual(sourceBytes, sourceSnapshot, 'recipe previews never mutate the retained imported bytes');
  } finally {
    cache.clear();
    previousPreviewSource?.free();
    retainedOriginal?.free();
  }
});

test('Pillow-RS validates normalized crop bounds and quarter-turn rotation', async () => {
  await pillow.default();
  const original = decodeOriginal(pillow, fourColorBmp());
  try {
    assert.throws(() => renderImage(original, {}, { crop: { left: 0, top: 0, right: 1.1, bottom: 1 } }), /crop edges/);
    assert.throws(() => renderImage(original, {}, { crop: { left: 0.5, top: 0, right: 0.5, bottom: 1 } }), /crop edges/);
    assert.throws(() => renderImage(original, {}, { rotation: 45 }), /quarter turns/);
    assert.throws(() => renderImage(original, {}, { rotation: 90.5 }), /quarter turns/);
  } finally { original.free(); }
});

test('Pillow-RS creative tone effects change RGBA pixels while preserving alpha and the decoded source', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, fourPixelRgbaPng());
  const sourcePixels = Array.from({ length: 4 }, (_, x) => [...original.getpixel(x, 0)]);
  const cases = [
    { settings: { autoContrast: true }, expected: [[0, 0, 0, 0], [42, 92, 153, 64], [95, 150, 216, 128], [255, 255, 255, 255]] },
    { settings: { posterizeBits: 2 }, expected: [[0, 0, 0, 0], [0, 64, 128, 64], [64, 128, 192, 128], [192, 192, 192, 255]] },
    { settings: { solarize: true, solarizeThreshold: 100 }, expected: [[10, 20, 30, 0], [50, 155, 105, 64], [155, 105, 55, 128], [5, 15, 25, 255]] },
    { settings: { invert: true }, expected: [[245, 235, 225, 0], [205, 155, 105, 64], [155, 105, 55, 128], [5, 15, 25, 255]] },
  ];
  try {
    assert.equal(original.mode, 'RGBA');
    for (const { settings, expected } of cases) {
      const rendered = renderImage(original, settings, {}, pillow);
      const output = decodeOriginal(pillow, rendered.bytes);
      try {
        const actual = Array.from({ length: 4 }, (_, x) => [...output.getpixel(x, 0)]);
        assert.deepEqual(actual, expected, `${Object.keys(settings).join(', ')} output pixels`);
        assert.deepEqual(actual.map(pixel => pixel[3]), sourcePixels.map(pixel => pixel[3]), 'all original alpha values, including zero and partial transparency, remain exact');
      } finally { output.free(); }
      assert.deepEqual(Array.from({ length: 4 }, (_, x) => [...original.getpixel(x, 0)]), sourcePixels, 'each render starts from and preserves the decoded source');
    }
  } finally { original.free(); }
});

test('Pillow-RS photographic exposure, temperature, and tint work in linear light and preserve alpha', async () => {
  await pillow.default();
  const original = new pillow.Image('RGBA', 4, 1, null);
  original.putpixel(0, 0, 128, 128, 128, 0);
  original.putpixel(1, 0, 128, 128, 128, 64);
  original.putpixel(2, 0, 128, 128, 128, 128);
  original.putpixel(3, 0, 128, 128, 128, 255);
  try {
    const sourcePixels = Array.from({ length: 4 }, (_, x) => [...original.getpixel(x, 0)]);
    const exposure = decodeOriginal(pillow, renderImage(original, { exposure: 50 }, {}, pillow).bytes);
    const warm = decodeOriginal(pillow, renderImage(original, { temperature: 100 }, {}, pillow).bytes);
    const magenta = decodeOriginal(pillow, renderImage(original, { tint: 100 }, {}, pillow).bytes);
    try {
      assert.ok([...exposure.getpixel(3, 0)].slice(0, 3).every(channel => channel > 128), 'one positive exposure stop brightens neutral midtones');
      assert.ok(exposure.getpixel(3, 0)[0] < 200, 'exposure clips gradually in linear light instead of doubling gamma-encoded values');
      assert.ok(warm.getpixel(3, 0)[0] > warm.getpixel(3, 0)[2], 'positive temperature warms the image');
      assert.ok(magenta.getpixel(3, 0)[0] > magenta.getpixel(3, 0)[1] && magenta.getpixel(3, 0)[2] > magenta.getpixel(3, 0)[1], 'positive tint shifts toward magenta');
      for (const output of [exposure, warm, magenta]) {
        assert.deepEqual(Array.from({ length: 4 }, (_, x) => output.getpixel(x, 0)[3]), [0, 64, 128, 255], 'zero and partial alpha samples stay exact');
      }
      assert.deepEqual(Array.from({ length: 4 }, (_, x) => [...original.getpixel(x, 0)]), sourcePixels, 'every setting is recomputed from the retained source image');
    } finally { exposure.free(); warm.free(); magenta.free(); }
  } finally { original.free(); }
});

test('Pillow-RS highlight and shadow controls target their tonal ranges and preserve alpha', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, fourPixelRgbaPng());
  const sourcePixels = Array.from({ length: 4 }, (_, x) => [...original.getpixel(x, 0)]);
  const highlights = decodeOriginal(pillow, renderImage(original, { highlights: 100 }, {}, pillow).bytes);
  const shadows = decodeOriginal(pillow, renderImage(original, { shadows: 100 }, {}, pillow).bytes);
  const reducedHighlights = decodeOriginal(pillow, renderImage(original, { highlights: -100 }, {}, pillow).bytes);
  const reducedShadows = decodeOriginal(pillow, renderImage(original, { shadows: -100 }, {}, pillow).bytes);
  const colorDelta = (left, right) => left.slice(0, 3).reduce((sum, channel, index) => sum + Math.abs(channel - right[index]), 0);
  try {
    assert.ok(colorDelta([...highlights.getpixel(3, 0)], sourcePixels[3]) > colorDelta([...highlights.getpixel(1, 0)], sourcePixels[1]),
      'highlight lift affects bright source pixels more than dark source pixels');
    assert.ok(colorDelta([...shadows.getpixel(1, 0)], sourcePixels[1]) > colorDelta([...shadows.getpixel(3, 0)], sourcePixels[3]),
      'shadow lift affects dark source pixels more than bright source pixels');
    assert.ok(reducedHighlights.getpixel(3, 0)[0] < sourcePixels[3][0], 'negative highlights lower bright source pixels');
    assert.ok(reducedShadows.getpixel(1, 0)[0] < sourcePixels[1][0], 'negative shadows lower dark source pixels');
    for (const output of [highlights, shadows, reducedHighlights, reducedShadows]) {
      assert.deepEqual(Array.from({ length: 4 }, (_, x) => output.getpixel(x, 0)[3]), sourcePixels.map(pixel => pixel[3]),
        'zero, partial, and opaque alpha samples stay exact');
    }
    assert.deepEqual(Array.from({ length: 4 }, (_, x) => [...original.getpixel(x, 0)]), sourcePixels,
      'tonal adjustments are always rendered from the retained original');
  } finally { highlights.free(); shadows.free(); reducedHighlights.free(); reducedShadows.free(); original.free(); }
});

test('RGBA tone-effect setup frees the color intermediate when alpha extraction fails', () => {
  let colorFreed = false;
  const color = { free() { colorFreed = true; } };
  const source = {
    mode: 'RGBA', width: 1, height: 1,
    copy() { return this; },
    getbands() { return ['R', 'G', 'B', 'A']; },
    convert() { return color; },
    getchannel() { throw new Error('synthetic alpha allocation failure'); },
    free() {},
  };

  assert.throws(() => renderImage(source, { invert: true }, {}, { ImageOps: { invert() {} } }), /synthetic alpha allocation failure/);
  assert.equal(colorFreed, true, 'the allocated RGB intermediate is released even when extracting alpha fails');
});

test('creative tone settings validate and image-fill recipes use the same local renderer', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, fourPixelRgbaPng());
  try {
    for (const settings of [
      { autoContrast: 1 }, { posterizeBits: -1 }, { posterizeBits: 2.5 },
      { solarize: true, solarizeThreshold: 256 }, { invert: 'yes' }, { inventedTone: true },
      { exposure: 101 }, { temperature: -101 }, { tint: NaN }, { highlights: 101 }, { shadows: -101 },
    ]) assert.throws(() => renderImage(original, settings, {}, pillow), /invalid setting/);
    assert.throws(() => renderImage(original, { invert: true }), /does not provide the requested tone effect/);

    const fill = createImageFill('asset-tone', { adjustments: { posterizeBits: 2, invert: true } });
    const rendered = renderImage(original, fill.adjustments, fill.transforms, pillow);
    const output = decodeOriginal(pillow, rendered.bytes);
    try {
      assert.deepEqual([...output.getpixel(1, 0)], [255, 191, 127, 64]);
      assert.deepEqual([...output.getpixel(2, 0)], [191, 127, 63, 128]);
      assert.deepEqual([...output.getpixel(3, 0)], [63, 63, 63, 255]);
    } finally { output.free(); }

    const photoFill = createImageFill('asset-photo', { adjustments: { exposure: 35, temperature: -30, tint: 25 } });
    const photoOutput = decodeOriginal(pillow, renderImage(original, photoFill.adjustments, photoFill.transforms, pillow).bytes);
    try {
      assert.notDeepEqual([...photoOutput.getpixel(1, 0)], [...original.getpixel(1, 0)], 'image fills use the same local photographic treatment pipeline');
      assert.deepEqual([...photoOutput.getpixel(1, 0)][3], 64, 'image-fill color controls preserve source transparency');
    } finally { photoOutput.free(); }

    const rgb = decodeOriginal(pillow, twoPixelBmp());
    try {
      assert.equal(rgb.mode, 'RGB');
      const inverted = decodeOriginal(pillow, renderImage(rgb, { invert: true }, {}, pillow).bytes);
      try {
        assert.deepEqual([...inverted.getpixel(0, 0)].slice(0, 3), [0, 255, 255]);
        assert.deepEqual([...inverted.getpixel(1, 0)].slice(0, 3), [255, 0, 255]);
      } finally { inverted.free(); }
    } finally { rgb.free(); }
  } finally { original.free(); }
});
