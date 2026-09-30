import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as pillow from '../wasm/pillow_rs_js.js';
import { decodeOriginal, renderImage, renderImageOutput } from '../src/image-processing.js';
import { createImageFill } from '../src/image-fills.js';

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

test('vendored Pillow-RS WebAssembly opens a local source and emits adjusted PNG bytes', async () => {
  const wasm = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  await pillow.default({ module_or_path: wasm });
  const original = decodeOriginal(pillow, twoPixelBmp());
  try {
    const baseline = renderImage(original, {});
    const adjusted = renderImage(original, { brightness: -35, contrast: 10, saturation: 18, blur: 1 });
    assert.equal(adjusted.width, 2); assert.equal(adjusted.height, 1);
    assert.ok(adjusted.bytes.length > 50); assert.notDeepEqual(adjusted.bytes, baseline.bytes);
    const reopened = decodeOriginal(pillow, adjusted.bytes);
    assert.equal(reopened.width, 2); assert.equal(reopened.height, 1); reopened.free();
  } finally { original.free(); }
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
