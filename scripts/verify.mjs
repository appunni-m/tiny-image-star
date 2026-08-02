import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import * as pillowApi from "../wasm/pillow_rs_js.js";
import { CAPABILITIES, exifOrientationFromBytes, previewWithApi, renderWithApi, runtimeCapabilities } from "../src/engine/pillow.js";
import { formatAccept, formatLabel, normalizeCapabilities } from "../src/formats.js";
import { CROP_PRESETS, createEditorState } from "../src/editor/state.js";
import { createTextLayer, normalizeTextLayers } from "../src/editor/text.js";
import { DESTINATION_PRESETS, settingsForPreset } from "../src/presets.js";
import {
  downloadedFileName,
  exportFolderName,
  exportTimestamp,
  filenameStem,
  outputFileName,
  readableSlug,
} from "../src/names.js";
import {
  MAX_LARGE_FOLDER_FILES,
  createLargeJob,
  createManifestEntry,
  jobProgress,
  largeJobActionState,
  largeOutputFileName,
  largeWorkerCount,
  outputRelativePath,
  settingsForLargeJob,
  virtualWindow,
} from "../src/jobs/core.js";
import { diffOperationConfig, mergeOperationConfig, mergeOverridePatch } from "../src/config.js";
import { DEFAULT_QUALITY, normalizeQuality, qualityLabel, QUALITY_LEVELS } from "../src/quality.js";
import { applyRelativeEditPatch, mergeRelativeSharedEdit, relativeEditPatch, removeAppliedKeys } from "../src/scoped-edits.js";
import { batchBytesExceedLimit, duplicateKey, fingerprintBytes, imagePixelCount, inputProblem, isAnimatedImage, MAX_BATCH_BYTES, processingWorkerCount } from "../src/input.js";
import { buildEditorSessionSnapshot, buildSessionSnapshot, editorSessionRecordIsUsable, MAX_SESSION_BYTES, SESSION_VERSION, sessionRecordIsUsable } from "../src/session.js";
import { formatLocalBytes, PRESETS_STORAGE_KEY } from "../src/local-data.js";
import { framingReviewForItems, shapeRatio, shapesDiffer } from "../src/framing.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixturePath = join(projectRoot, "tests/fixtures/rgb-small.png.base64");
const fixtureBytes = Buffer.from((await readFile(fixturePath, "utf8")).trim(), "base64");
const wasmBytes = await readFile(join(projectRoot, "wasm/pillow_rs_js_bg.wasm"));

function assertPng(bytes, label) {
  assert.deepEqual(Array.from(bytes.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], `${label} is not PNG`);
}

function assertDecodedDimensions(bytes, width, height, label) {
  let image;
  try {
    image = pillowApi.Image.open(bytes);
    assert.equal(image.width, width, `${label} decoded width`);
    assert.equal(image.height, height, `${label} decoded height`);
  } finally {
    image?.free();
  }
}

function assertDimensions(result, width, height, label) {
  assert.equal(result.width, width, `${label} width`);
  assert.equal(result.height, height, `${label} height`);
  assertPng(result.bytes, label);
  assertDecodedDimensions(result.bytes, width, height, label);
  assert.ok(result.outputBytes > 0, `${label} has output bytes`);
}

function settings(overrides = {}) {
  return {
    format: "png",
    rotation: 0,
    flipX: false,
    flipY: false,
    resizeMode: "fit",
    resizeWidth: 8,
    resizeHeight: 8,
    brightness: 1,
    contrast: 1,
    grayscale: false,
    ...overrides,
  };
}

function hasBytesChanged(a, b, label) {
  assert.notDeepEqual(Array.from(a), Array.from(b), `${label} should change output bytes`);
}

function decodedPixelRows(bytes) {
  let image;
  try {
    image = pillowApi.Image.open(bytes);
    return Array.from({ length: image.height }, (_, y) => (
      Array.from({ length: image.width }, (_, x) => Array.from(image.getpixel(x, y)))
    ));
  } finally {
    image?.free();
  }
}

function makePatternFile() {
  const image = new pillowApi.Image("RGBA", 3, 2, 0, 0, 0, 255);
  const values = [
    [[10, 0, 0, 255], [20, 0, 0, 128], [30, 0, 0, 0]],
    [[40, 0, 0, 64], [50, 0, 0, 200], [60, 0, 0, 255]],
  ];
  try {
    for (let y = 0; y < values.length; y += 1) {
      for (let x = 0; x < values[y].length; x += 1) image.putpixel(x, y, ...values[y][x]);
    }
    return { name: "pattern.png", bytes: image.save() };
  } finally {
    image.free();
  }
}

function withExifOrientation(bytes, orientation) {
  const copy = new Uint8Array(bytes);
  for (let index = 0; index + 12 <= copy.length; index += 1) {
    if (copy[index] !== 0x01 || copy[index + 1] !== 0x12 || copy[index + 2] !== 0x00 || copy[index + 3] !== 0x03) continue;
    copy[index + 8] = (orientation >>> 8) & 0xff;
    copy[index + 9] = orientation & 0xff;
    return copy;
  }
  throw new Error("EXIF orientation tag not found in fixture");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBytes = Buffer.from(type, "ascii");
  const data = Buffer.from(payload);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function makeIndexedPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 3;
  const palette = Uint8Array.from([
    255, 0, 0,
    0, 255, 0,
    0, 0, 255,
    255, 255, 255,
  ]);
  const transparency = Uint8Array.from([255, 128, 0, 255]);
  const scanlines = Uint8Array.from([0, 0, 1, 0, 2, 3]);
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("PLTE", palette),
    pngChunk("tRNS", transparency),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", []),
  ]));
}

class FakeImage {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.mode = "RGBA";
  }

  crop(left, top, right, bottom) {
    return new FakeImage(Math.max(1, right - left), Math.max(1, bottom - top));
  }

  transpose(operation) {
    const rotated = operation === "ROTATE_90" || operation === "ROTATE_270";
    return new FakeImage(rotated ? this.height : this.width, rotated ? this.width : this.height);
  }

  resize(width, height) {
    return new FakeImage(width, height);
  }

  convert(mode) {
    const next = new FakeImage(this.width, this.height);
    next.mode = mode;
    return next;
  }

  enhanceBrightness() { return new FakeImage(this.width, this.height); }
  enhanceContrast() { return new FakeImage(this.width, this.height); }

  encode(format, quality) {
    if (format === "jpeg") return Uint8Array.from([0xff, 0xd8, 0xff, this.width, this.height, quality ?? 0]);
    return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, this.width, this.height]);
  }

  save() {
    return this.encode("png");
  }

  free() {}
}

function fakeImageOpen(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length === 6 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
    return new FakeImage(view[3], view[4]);
  }
  if (view.length === 10 && view[0] === 137 && view[1] === 80 && view[2] === 78 && view[3] === 71) {
    return new FakeImage(view[8], view[9]);
  }
  return new FakeImage(8, 8);
}

function fakePngOnlyApi() {
  return {
    Image: {
      open: () => ({
        width: 8,
        height: 8,
        mode: "RGBA",
        save: () => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
        free() {},
      }),
    },
  };
}

async function run() {
  pillowApi.initSync({ module: wasmBytes });
  const file = { name: "fixture.png", bytes: new Uint8Array(fixtureBytes) };

  const original = await renderWithApi(pillowApi, file, settings());
  assertDimensions(original, 8, 8, "original");
  assert.equal(original.name, "fixture-edited.png", "fallback output name");
  assert.equal(original.format, "png", "output format is carried through the worker result");
  assert.equal(original.mime, "image/png", "output MIME is carried through the worker result");

  const runtime = runtimeCapabilities(pillowApi);
  assert.ok(runtime.outputFormats.includes("png"), "runtime probe keeps PNG operational");
  assert.throws(() => runtimeCapabilities(fakePngOnlyApi()), /verified output format/i, "a binding with no verified encoder cannot claim PNG");
  for (const format of runtime.outputFormats) {
    const result = await renderWithApi(
      pillowApi,
      file,
      settings({ format, resizeWidth: 4, resizeHeight: 4 }),
      runtime,
    );
    assert.equal(result.format, format, `${format} runtime result format`);
    assert.equal(typeof result.mime, "string", `${format} runtime MIME is present`);
    assert.equal(result.outputBytes, result.bytes.byteLength, `${format} runtime byte count is authoritative`);
    assertDecodedDimensions(result.bytes, result.width, result.height, `${format} runtime output`);
  }

  const animatedGif = Uint8Array.from([
    ...Buffer.from("GIF89a", "ascii"), 1, 0, 1, 0, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0,
  ]);
  const animatedWebp = Uint8Array.from([
    ...Buffer.from("RIFF", "ascii"), 20, 0, 0, 0, ...Buffer.from("WEBPVP8X", "ascii"),
    10, 0, 0, 0, 0x02, 0, 0, 0, 0, 0, 0, 0,
  ]);
  assert.equal(isAnimatedImage(animatedGif), true, "animated GIF is rejected before decode");
  assert.equal(isAnimatedImage(animatedWebp), true, "animated WebP is rejected before decode");
  const singleGif = new Uint8Array(Buffer.from((await readFile(join(projectRoot, "tests/fixtures/p-small.gif.base64"), "utf8")).trim(), "base64"));
  assert.equal(isAnimatedImage(singleGif), false, "single-frame GIF remains accepted");
  const commentGif = Uint8Array.from([
    ...singleGif.slice(0, 13),
    0x21, 0xfe, 0x01, 0x2c, 0x00,
    ...singleGif.slice(13),
  ]);
  assert.equal(isAnimatedImage(commentGif), false, "a comma inside a GIF comment is not a second frame");
  assert.equal(inputProblem(new Uint8Array([1, 2, 3])), null, "unknown non-animated bytes are left for the decoder");
  assert.equal(inputProblem(fixtureBytes, { width: 10000, height: 10000 })?.code, "too-large", "decoded pixel guard rejects oversized input");
  assert.equal(imagePixelCount(4, 4), 16, "pixel count is deterministic");
  assert.equal(processingWorkerCount([{ width: 1000, height: 1000 }, { width: 1000, height: 1000 }], 8, 4), 2, "small image sets use available parallel workers");
  assert.equal(processingWorkerCount([{ width: 10000, height: 8000 }, { width: 10000, height: 8000 }, { width: 10000, height: 8000 }], 8, 4), 2, "large image sets limit concurrent workers by pixel budget");
  assert.equal(processingWorkerCount([{ width: 10000, height: 8000 }], 8, 4), 1, "one large image uses one worker");
  assert.equal(duplicateKey({ name: "a.png", size: 4 }, "hash"), duplicateKey({ name: "a.png", size: 4 }, "hash"), "same file identity is stable");
  assert.notEqual(duplicateKey({ name: "a.png", size: 4 }, "hash"), duplicateKey({ name: "b.png", size: 4 }, "hash"), "different names remain separately selectable");
  assert.equal(await fingerprintBytes(new Uint8Array([1, 2, 3])), await fingerprintBytes(new Uint8Array([1, 2, 3])), "content fingerprint is stable");
  assert.equal(batchBytesExceedLimit(MAX_BATCH_BYTES - 1, 1), false, "batch byte limit accepts the exact boundary");
  assert.equal(batchBytesExceedLimit(MAX_BATCH_BYTES, 1), true, "batch byte limit rejects one byte over the boundary");
  assert.equal(batchBytesExceedLimit(-10, 10), false, "batch byte limit clamps invalid negative sizes");

  const orientationBytes = new Uint8Array(Buffer.from((await readFile(join(projectRoot, "tests/fixtures/exif-orientation6.jpg.base64"), "utf8")).trim(), "base64"));
  const orientationResults = [];
  for (let orientation = 1; orientation <= 8; orientation += 1) {
    const bytes = orientation === 6 ? orientationBytes : withExifOrientation(orientationBytes, orientation);
    assert.equal(exifOrientationFromBytes(bytes), orientation, `EXIF orientation ${orientation} is detected`);
    const result = await renderWithApi(pillowApi, { name: `orientation${orientation}.jpg`, bytes }, settings({ resizeWidth: 4, resizeHeight: 4 }));
    const expectedWidth = [5, 6, 7, 8].includes(orientation) ? 3 : 4;
    const expectedHeight = [5, 6, 7, 8].includes(orientation) ? 4 : 3;
    assertDimensions(result, expectedWidth, expectedHeight, `EXIF orientation ${orientation} output`);
    orientationResults.push(decodedPixelRows(result.bytes));
  }
  assert.equal(new Set(orientationResults.map((pixels) => JSON.stringify(pixels))).size, 8, "all EXIF orientations produce distinct normalized pixels");
  const inputFixtures = [
    ["rgb-small.jpg.base64", "fixture.jpg", 4, 4],
    ["rgb-small.bmp.base64", "fixture.bmp", 4, 4],
    ["rgb-small.webp.base64", "fixture.webp", 4, 4],
    ["p-small.gif.base64", "fixture.gif", 4, 4],
    ["rgb-small.tiff.base64", "fixture.tiff", 4, 4],
    ["exif-orientation6.jpg.base64", "orientation6.jpg", 3, 4],
    ["rgb-small.ico.base64", "fixture.ico", 4, 4],
  ];
  for (const [fixtureName, name, width, height] of inputFixtures) {
    const bytes = new Uint8Array(Buffer.from((await readFile(join(projectRoot, "tests/fixtures", fixtureName), "utf8")).trim(), "base64"));
    const decoded = await renderWithApi(pillowApi, { name, bytes }, settings({ resizeWidth: 4, resizeHeight: 4 }));
    assertDimensions(decoded, width, height, `${name} input decode`);
  }
  const tiffBytes = new Uint8Array(Buffer.from((await readFile(join(projectRoot, "tests/fixtures/rgb-small.tiff.base64"), "utf8")).trim(), "base64"));
  const proxy = previewWithApi(pillowApi, { name: "fixture.tiff", bytes: tiffBytes });
  assertDimensions({ ...proxy, outputBytes: proxy.bytes.byteLength }, 8, 8, "browser preview proxy");
  await assert.rejects(
    () => renderWithApi(pillowApi, { name: "corrupt.png", bytes: new Uint8Array([1, 2, 3, 4]) }, settings()),
    /unidentified|invalid|decode|format/i,
    "corrupt input is rejected",
  );
  await assert.rejects(
    () => renderWithApi(pillowApi, { name: "truncated.png", bytes: fixtureBytes.slice(0, Math.floor(fixtureBytes.length / 2)) }, settings()),
    /unidentified|invalid|decode|format|truncated|malformed|rejected/i,
    "truncated PNG input is rejected",
  );
  await assert.rejects(
    () => renderWithApi(pillowApi, { name: "truncated.jpg", bytes: orientationBytes.slice(0, Math.floor(orientationBytes.length / 2)) }, settings()),
    /unidentified|invalid|decode|format|truncated|malformed|rejected/i,
    "truncated JPEG input is rejected",
  );

  const indexedBytes = makeIndexedPng();
  const indexed = await renderWithApi(pillowApi, { name: "indexed.png", bytes: indexedBytes }, settings({ resizeWidth: 2, resizeHeight: 2 }));
  assertDimensions(indexed, 2, 2, "indexed PNG input decode");
  assert.equal(decodedPixelRows(indexed.bytes).length, 2, "indexed PNG output contains decoded rows");

  const fit = await renderWithApi(pillowApi, file, settings({ resizeWidth: 4, resizeHeight: 4 }));
  assertDimensions(fit, 4, 4, "fit resize");

  const explicitCrop = await renderWithApi(pillowApi, file, settings({
    crop: { x: 0, y: 0, width: 8, height: 4 },
    resizeMode: "crop",
    resizeWidth: 4,
    resizeHeight: 2,
  }));
  assertDimensions(explicitCrop, 4, 2, "explicit crop");

  const automaticCrop = await renderWithApi(pillowApi, file, settings({
    resizeMode: "crop",
    resizeWidth: 2,
    resizeHeight: 4,
  }));
  assertDimensions(automaticCrop, 2, 4, "automatic crop");
  await assert.rejects(
    () => renderWithApi(pillowApi, file, settings({ resizeMode: "crop", resizeWidth: 10000, resizeHeight: 10000 })),
    /output too large/i,
    "oversized output dimensions are rejected before allocation",
  );

  const rotated = await renderWithApi(pillowApi, file, settings({
    crop: { x: 0, y: 0, width: 8, height: 4 },
    rotation: 90,
    resizeWidth: 8,
    resizeHeight: 8,
  }));
  assertDimensions(rotated, 4, 8, "rotate");

  const flipped = await renderWithApi(pillowApi, file, settings({ flipX: true }));
  assertDimensions(flipped, 8, 8, "flip");
  hasBytesChanged(flipped.bytes, original.bytes, "flip");
  const flippedVertical = await renderWithApi(pillowApi, file, settings({ flipY: true }));
  assertDimensions(flippedVertical, 8, 8, "vertical flip");
  hasBytesChanged(flippedVertical.bytes, original.bytes, "vertical flip");

  const adjusted = await renderWithApi(pillowApi, file, settings({ brightness: 1.25, contrast: 1.2, grayscale: true }));
  assertDimensions(adjusted, 8, 8, "adjustments");
  hasBytesChanged(adjusted.bytes, original.bytes, "adjustments");

  const compound = await renderWithApi(pillowApi, file, settings({
    crop: { x: 1, y: 0, width: 6, height: 8 },
    rotation: 90,
    flipX: true,
    resizeMode: "crop",
    resizeWidth: 5,
    resizeHeight: 3,
    brightness: 1.15,
    contrast: 1.1,
    grayscale: true,
  }));
  assertDimensions(compound, 5, 3, "compound crop/rotate/flip/resize/adjust output");
  hasBytesChanged(compound.bytes, original.bytes, "compound output");

  const patternFile = makePatternFile();
  const patternOriginal = await renderWithApi(pillowApi, patternFile, settings());
  assert.deepEqual(decodedPixelRows(patternOriginal.bytes), [
    [[10, 0, 0, 255], [20, 0, 0, 128], [30, 0, 0, 0]],
    [[40, 0, 0, 64], [50, 0, 0, 200], [60, 0, 0, 255]],
  ], "PNG output preserves source color and alpha pixels");
  const patternRotated = await renderWithApi(pillowApi, patternFile, settings({ rotation: 90 }));
  assert.deepEqual(decodedPixelRows(patternRotated.bytes), [
    [[30, 0, 0, 0], [60, 0, 0, 255]],
    [[20, 0, 0, 128], [50, 0, 0, 200]],
    [[10, 0, 0, 255], [40, 0, 0, 64]],
  ], "rotation output pixels follow the visible clockwise transform");
  const patternFlipped = await renderWithApi(pillowApi, patternFile, settings({ flipX: true }));
  assert.deepEqual(decodedPixelRows(patternFlipped.bytes), [
    [[30, 0, 0, 0], [20, 0, 0, 128], [10, 0, 0, 255]],
    [[60, 0, 0, 255], [50, 0, 0, 200], [40, 0, 0, 64]],
  ], "horizontal flip output pixels follow the visible transform");
  const patternCrop = await renderWithApi(pillowApi, patternFile, settings({ crop: { x: 1, y: 0, width: 2, height: 2 } }));
  assert.deepEqual(decodedPixelRows(patternCrop.bytes), [
    [[20, 0, 0, 128], [30, 0, 0, 0]],
    [[50, 0, 0, 200], [60, 0, 0, 255]],
  ], "crop output pixels match the selected frame");

  await assert.rejects(
    () => renderWithApi(pillowApi, file, settings({ format: "avif" })),
    /format unavailable/,
    "unsupported output format",
  );

  const fitLetterboxed = await renderWithApi(pillowApi, file, settings({ resizeWidth: 4, resizeHeight: 2 }));
  assertDimensions(fitLetterboxed, 2, 2, "fit preserves aspect ratio");
  const clampedCrop = await renderWithApi(pillowApi, file, settings({ crop: { x: -4, y: -4, width: 30, height: 30 } }));
  assertDimensions(clampedCrop, 8, 8, "out-of-bounds crop is clamped");
  const emptyCrop = await renderWithApi(pillowApi, file, settings({ crop: { x: 2, y: 2, width: 0, height: 0 } }));
  assertDimensions(emptyCrop, 8, 8, "empty crop leaves the source intact");

  const verifiedMultiFormat = normalizeCapabilities({
    inputFormats: ["png"],
    outputFormats: ["png", "jpeg"],
    compression: { lossy: true, lossyFormats: ["jpeg"], quality: true },
  });
  const jpegResult = await renderWithApi(
    { Image: { open: fakeImageOpen } },
    file,
    settings({ format: "jpeg", presetName: "Profile Photo", lossy: true, quality: 55, resizeWidth: 4, resizeHeight: 2 }),
    verifiedMultiFormat,
  );
  assert.deepEqual(Array.from(jpegResult.bytes.slice(0, 3)), [0xff, 0xd8, 0xff], "JPEG signature");
  assert.equal(jpegResult.mime, "image/jpeg", "JPEG MIME");
  assert.equal(jpegResult.format, "jpeg", "JPEG format");
  assert.equal(jpegResult.name, "fixture-profile-photo.jpg", "readable preset output name");
  assert.equal(jpegResult.width, 2, "JPEG result width");
  assert.equal(jpegResult.height, 2, "JPEG result height");
  const jpegLowerQuality = await renderWithApi(
    { Image: { open: fakeImageOpen } },
    file,
    settings({ format: "jpeg", presetName: "Profile Photo", lossy: true, quality: 20, resizeWidth: 4, resizeHeight: 2 }),
    verifiedMultiFormat,
  );
  assert.notDeepEqual(Array.from(jpegLowerQuality.bytes), Array.from(jpegResult.bytes), "quality reaches the verified encoder path");
  assert.equal(jpegLowerQuality.bytes.at(-1), 20, "lower quality reaches the encoder");
  await assert.rejects(
    () => renderWithApi(fakePngOnlyApi(), file, settings({ format: "jpeg" }), verifiedMultiFormat),
    /format unavailable/,
    "a PNG-only save method cannot masquerade as JPEG",
  );

  assert.equal(filenameStem("folder/Über.final.png"), "Über.final", "filename stem drops only the final extension");
  assert.equal(filenameStem("no-extension"), "no-extension", "filename stem accepts extensionless files");
  assert.equal(readableSlug("Website Banner"), "website-banner", "recipe slug is readable");
  assert.equal(outputFileName("folder/Über.final.png", "Website Banner", "jpeg"), "Über.final-website-banner.jpg", "single output name is readable and uses the actual extension");
  const downloadMoment = new Date("2026-08-02T09:08:07Z");
  assert.equal(exportTimestamp(downloadMoment), "20260802-090807", "download timestamp is filesystem safe and deterministic");
  assert.equal(downloadedFileName("folder/Über.final.png", "Website Banner", "jpeg", downloadMoment), "Über.final-20260802-090807-website-banner.jpg", "downloaded image names include source, timestamp, destination, and actual extension");
  assert.equal(exportFolderName("Website Banner", downloadMoment), "tiny-image-star-20260802-090807-website-banner", "download folder name is unique and destination-aware");
  assert.ok(outputFileName(`${"a".repeat(200)}.png`, "Website Banner", "png").length < 150, "long source names are bounded");

  const largeName = largeOutputFileName("nested/photo.JPG", "Website Banner", "png");
  assert.match(largeName, /^photo-jpg-website-banner-[a-z0-9]{7}\.png$/, "large-folder output names are deterministic and collision-resistant");
  assert.equal(outputRelativePath("nested/photo.JPG", "Website Banner", "png"), `nested/${largeName}`, "large-folder output preserves relative directories");
  const largeRecipe = { id: "web", name: "Website Banner", operations: { ...settings({ resizeWidth: 1600, resizeHeight: 600 }), cropRelative: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 } } };
  const largeJob = createLargeJob({ id: "job-1", sourceHandle: null, sourceName: "Photos", recipe: largeRecipe, createdAt: downloadMoment.getTime() });
  assert.equal(largeJob.outputFolderName, "tiny-image-star-20260802-090807-website-banner", "large jobs get one unique destination folder");
  assert.deepEqual(settingsForLargeJob(largeRecipe).cropRelative, largeRecipe.operations.cropRelative, "large jobs preserve relative crop recipes until source dimensions are known");
  let syntheticBytes = 0;
  for (let index = 0; index < MAX_LARGE_FOLDER_FILES; index += 1) {
    const entry = createManifestEntry({ jobId: largeJob.id, index, relativePath: `set/image-${index}.png`, file: { name: `image-${index}.png`, size: 64, lastModified: index, type: "image/png" } });
    syntheticBytes += entry.sourceBytes;
    assert.equal("bytes" in entry, false, "manifest entries never retain source bytes");
    assert.equal("output" in entry, false, "manifest entries never retain output bytes");
  }
  assert.equal(syntheticBytes, MAX_LARGE_FOLDER_FILES * 64, "100k metadata entries retain byte counts only");
  const virtual = virtualWindow({ total: MAX_LARGE_FOLDER_FILES, scrollTop: 3_400_000, viewportHeight: 680 });
  assert.ok(virtual.count <= 26, "100k results render only a bounded visible window");
  assert.equal(virtual.totalHeight, MAX_LARGE_FOLDER_FILES * 68, "virtual result height represents every manifest entry");
  assert.equal(largeWorkerCount({ preference: "balanced", hardwareConcurrency: 16, deviceMemory: 16 }), 2, "balanced processing stays bounded even on large machines");
  assert.equal(largeWorkerCount({ preference: "fast", hardwareConcurrency: 16, deviceMemory: 16 }), 4, "fast processing has a hard worker ceiling");
  assert.deepEqual(jobProgress({ discovered: 100_000, completed: 99_998, failed: 1, skipped: 1, scanComplete: true }), { discovered: 100_000, finished: 100_000, remaining: 0, ratio: 1, complete: true }, "100k job completion includes failures and skips without retaining results");
  assert.deepEqual(
    largeJobActionState({ status: "paused", discovered: 10, completed: 4, failed: 1 }),
    { startHidden: false, startLabel: "Resume remaining", retryHidden: true, retryLabel: "Retry 1 failed" },
    "paused jobs continue pending work without presenting a competing failed-file action",
  );
  assert.deepEqual(
    largeJobActionState({ status: "needs-attention", discovered: 10, completed: 9, failed: 1 }),
    { startHidden: true, startLabel: "Resume", retryHidden: false, retryLabel: "Retry 1 failed" },
    "failed terminal jobs show Retry failed instead of a no-op Resume action",
  );
  assert.deepEqual(
    largeJobActionState({ status: "needs-attention", discovered: 10, completed: 4, failed: 0 }),
    { startHidden: false, startLabel: "Resume", retryHidden: true, retryLabel: "Retry 0 failed" },
    "permission and scheduler interruptions still expose Resume",
  );
  assert.equal(
    largeJobActionState({ status: "pausing", discovered: 10, completed: 4, failed: 0 }).startHidden,
    true,
    "Resume stays hidden until active writes finish",
  );

  const editorState = createEditorState();
  assert.equal(editorState.enginePhase, "starting", "fresh state starts before readiness");
  assert.equal(editorState.revision, 0, "fresh state revision");
  assert.deepEqual(CROP_PRESETS.map((preset) => preset.label), ["Original", "Square", "4:3", "3:4", "16:9", "9:16"], "crop presets");
  assert.equal(CAPABILITIES.outputFormats.join(","), "png", "PNG is the only operational output");
  assert.deepEqual(CAPABILITIES.inputFormats, ["jpeg", "png", "gif", "bmp", "webp", "tiff", "ico"], "declared input formats");
  assert.equal(CAPABILITIES.avif.output, false, "AVIF output remains disabled");
  assert.equal(formatLabel("jpeg"), "JPEG", "format labels");
  assert.match(formatAccept(CAPABILITIES.inputFormats), /\.tiff/ , "format picker accepts declared inputs");
  assert.deepEqual(normalizeCapabilities({ inputFormats: ["jpg", "png"], outputFormats: ["jpg"] }).inputFormats, ["jpeg", "png"], "format aliases normalize");
  assert.deepEqual(normalizeCapabilities({
    inputFormats: ["png"],
    outputFormats: ["png", "jpeg"],
    compression: { lossy: true, lossyFormats: ["jpeg", "avif"], quality: true },
  }).compression, { lossy: true, lossyFormats: ["jpeg"], quality: true }, "lossy capabilities stay tied to output formats");
  assert.deepEqual(settingsForPreset("instagram-square").resizeWidth, 1080, "destination preset dimensions");
  assert.ok(DESTINATION_PRESETS.some((preset) => preset.name === "Edit without resizing"), "no-resize recipe describes the editing outcome");
  assert.deepEqual(QUALITY_LEVELS.map(({ label, value }) => [label, value]), [["Low", 80], ["Medium", 95], ["High", 100]], "quality choices use the promised friendly mapping");
  assert.equal(DEFAULT_QUALITY, 95, "medium quality is the default");
  assert.equal(normalizeQuality(102), 100, "quality is capped at 100");
  assert.equal(normalizeQuality(79.6), 80, "quality values are rounded consistently");
  assert.equal(qualityLabel(95), "Medium", "known quality values use friendly labels");
  assert.equal(qualityLabel(91), "Custom (91)", "advanced custom values remain inspectable");

  const sharedConfig = settings({
    presetId: "instagram-square",
    resizeWidth: 1080,
    resizeHeight: 1080,
    maxWidth: 1080,
    maxHeight: 1080,
  });
  const editedConfig = {
    ...sharedConfig,
    crop: { x: 2, y: 1, width: 5, height: 6 },
    rotation: 90,
    brightness: 1.2,
    resizeWidth: 640,
    resizeHeight: 640,
  };
  const overridePatch = diffOperationConfig(sharedConfig, editedConfig);
  assert.ok(overridePatch, "a manual image edit creates an override patch");
  const changedSharedConfig = {
    ...sharedConfig,
    resizeWidth: 1200,
    resizeHeight: 627,
    maxWidth: 1200,
    maxHeight: 627,
    contrast: 1.1,
  };
  const mergedConfig = mergeOperationConfig(changedSharedConfig, overridePatch);
  assert.deepEqual(mergedConfig.crop, editedConfig.crop, "custom crop survives a shared recipe change");
  assert.equal(mergedConfig.rotation, 90, "custom rotation survives a shared recipe change");
  assert.equal(mergedConfig.brightness, 1.2, "custom adjustment survives a shared recipe change");
  assert.equal(mergedConfig.resizeWidth, 640, "custom size survives a shared recipe change");
  assert.equal(mergedConfig.maxWidth, 640, "derived fit width follows the custom size");
  assert.equal(mergedConfig.contrast, 1.1, "new shared values remain available when not overridden");
  assert.equal(mergedConfig.presetId, "instagram-square", "the selected recipe identity remains visible");
  assert.equal(diffOperationConfig(sharedConfig, sharedConfig), null, "unchanged image has no override patch");
  const priorPatch = { rotation: 90 };
  const initialEffective = mergeOperationConfig(sharedConfig, priorPatch);
  const editedDuringSession = { ...initialEffective, brightness: 1.3 };
  const mergedPatch = mergeOverridePatch(sharedConfig, priorPatch, initialEffective, editedDuringSession);
  const mergedAfterDestinationChange = mergeOperationConfig(changedSharedConfig, mergedPatch);
  assert.equal(mergedAfterDestinationChange.rotation, 90, "existing per-image rotation survives a later canvas session");
  assert.equal(mergedAfterDestinationChange.brightness, 1.3, "new canvas changes join the existing patch");
  assert.equal(mergedAfterDestinationChange.resizeWidth, 1200, "untouched shared size remains changeable");
  const formatPatchedConfig = { ...sharedConfig, format: "jpeg", lossy: true, quality: 55 };
  const formatPatch = diffOperationConfig(sharedConfig, formatPatchedConfig);
  assert.equal(formatPatch.format, "jpeg", "format changes are stored in the per-image patch");
  assert.equal(formatPatch.lossy, true, "lossy choice is stored in the per-image patch");
  assert.equal(formatPatch.quality, 55, "quality choice is stored in the per-image patch");
  assert.equal(mergeOperationConfig({ ...sharedConfig, format: "png" }, formatPatch).format, "jpeg", "format override survives recipe merge");
  const mergedFormatConfig = mergeOperationConfig({ ...sharedConfig, format: "png", lossy: false, quality: 80 }, formatPatch);
  assert.equal(mergedFormatConfig.lossy, true, "lossy override survives a shared format change");
  assert.equal(mergedFormatConfig.quality, 55, "quality override survives a shared format change");

  const relativeInitial = settings({ resizeWidth: 8, resizeHeight: 8 });
  const relativeEdited = settings({
    resizeWidth: 8,
    resizeHeight: 8,
    crop: { x: 2, y: 1, width: 4, height: 6 },
    rotation: 90,
    brightness: 1.2,
  });
  const relativePatch = relativeEditPatch(relativeInitial, relativeEdited, 8, 8);
  assert.deepEqual(relativePatch.cropRelative, { x: 0.25, y: 0.125, width: 0.5, height: 0.75 }, "shared crop is captured relative to the edited source");
  const portraitTarget = applyRelativeEditPatch(settings({ resizeWidth: 4, resizeHeight: 8 }), relativePatch, 4, 8);
  assert.deepEqual(portraitTarget.crop, { x: 1, y: 1, width: 2, height: 6 }, "shared crop scales to each target image");
  assert.equal(portraitTarget.rotation, 90, "shared rotation applies to each target");
  assert.equal(portraitTarget.brightness, 1.2, "shared adjustment applies to each target");
  const mergedSharedPatch = mergeRelativeSharedEdit({
    baseOperations: relativeInitial,
    currentRelativePatch: { contrast: 1.1 },
    initialOperations: relativeInitial,
    editedOperations: relativeEdited,
    width: 8,
    height: 8,
  });
  assert.equal(mergedSharedPatch.contrast, 1.1, "new shared edits merge without losing an earlier shared edit");
  assert.equal(mergedSharedPatch.rotation, 90, "new shared edits are added to the shared recipe");
  assert.deepEqual(removeAppliedKeys({ rotation: 180, contrast: 1.4, flipX: true }, relativePatch), { contrast: 1.4, flipX: true }, "applying current edits to all removes only matching keys from a local override");

  const sessionBuild = buildSessionSnapshot({
    activePresetId: "instagram-square",
    batch: {
      presetId: "instagram-square",
      recipeScope: "selected",
      formatOverride: null,
      lossyOverride: true,
      qualityOverride: 95,
      sharedOverride: { rotation: 180 },
      activeId: "fixture-1",
      selected: new Set(["fixture-1"]),
      selectionTouched: true,
      files: [{
        id: "fixture-1",
        name: "fixture.png",
        file: { type: "image/png", lastModified: 123 },
        bytes: new Uint8Array(fixtureBytes),
        fingerprint: "fixture-hash",
        duplicateKey: "fixture-key",
        presetOverride: "profile-photo",
        override: { rotation: 90 },
      }],
    },
  });
  assert.equal(sessionBuild.reason, null, "active image set fits the recovery budget");
  assert.equal(sessionBuild.snapshot.version, SESSION_VERSION, "session schema is versioned");
  assert.ok(sessionBuild.snapshot.batch.files[0].bytes instanceof ArrayBuffer, "session stores source bytes, not object URLs");
  assert.equal(sessionBuild.snapshot.batch.files[0].override.rotation, 90, "session retains per-image overrides");
  assert.equal(sessionBuild.snapshot.batch.files[0].presetOverride, "profile-photo", "session retains per-image destination scope");
  assert.equal(sessionBuild.snapshot.batch.recipeScope, "selected", "session retains recipe scope");
  assert.equal(sessionBuild.snapshot.batch.lossyOverride, true, "session retains shared compression choice");
  assert.equal(sessionBuild.snapshot.batch.qualityOverride, 95, "session retains shared quality choice");
  assert.equal(sessionBuild.snapshot.batch.sharedOverride.rotation, 180, "session retains shared canvas edits");
  assert.equal(sessionRecordIsUsable(sessionBuild.snapshot), true, "session record is restorable");
  assert.ok(MAX_SESSION_BYTES > fixtureBytes.byteLength, "session budget exceeds the deterministic fixture");

  const editorSessionBuild = buildEditorSessionSnapshot({
    file: {
      id: "editor-1",
      name: "one.png",
      type: "image/png",
      lastModified: 456,
      bytes: new Uint8Array(fixtureBytes),
    },
    operations: settings({ rotation: 90, resizeWidth: 4, resizeHeight: 8 }),
  });
  assert.equal(editorSessionBuild.reason, null, "single-image recovery fits the recovery budget");
  assert.equal(editorSessionBuild.snapshot.kind, "editor", "single-image recovery has an explicit record kind");
  assert.ok(editorSessionBuild.snapshot.editor.bytes instanceof ArrayBuffer, "single-image recovery stores source bytes");
  assert.equal(editorSessionBuild.snapshot.editor.operations.rotation, 90, "single-image recovery stores the current recipe");
  assert.equal(editorSessionRecordIsUsable(editorSessionBuild.snapshot), true, "single-image recovery record is restorable");
  assert.equal(PRESETS_STORAGE_KEY, "tiny-image-star.presets.v1", "local data uses the shared recipe storage key");
  assert.equal(formatLocalBytes(0), "0 B", "local data formats an empty recovery budget");
  assert.equal(formatLocalBytes(fixtureBytes.byteLength), `${fixtureBytes.byteLength} B`, "local data reports small recovery copies exactly");
  assert.equal(shapeRatio(8, 8), 1, "square source shape is normalized");
  assert.equal(shapesDiffer(1, 1), false, "matching source shapes do not need a framing warning");
  const framingReview = framingReviewForItems(
    [{ id: "square", width: 8, height: 8 }, { id: "portrait", width: 3, height: 4 }],
    () => ({ resizeMode: "crop", resizeWidth: 1, resizeHeight: 1 }),
  );
  assert.equal(framingReview.mixedShapes, true, "mixed source shapes are detected");
  assert.deepEqual([...framingReview.flaggedIds], ["portrait"], "only the source that needs a different crop is marked");
  assert.equal(
    framingReviewForItems(
      [{ id: "square", width: 8, height: 8 }, { id: "portrait", width: 3, height: 4 }],
      () => ({ resizeMode: "fit", resizeWidth: 1, resizeHeight: 1 }),
    ).flaggedIds.size,
    0,
    "keep-whole recipes never create a framing warning",
  );

  const textLayer = createTextLayer(800, 600);
  const normalizedText = normalizeTextLayers([{ ...textLayer, text: "Hello", x: 2, color: "not-a-color" }]);
  assert.equal(normalizedText[0].text, "Hello", "text layers preserve user words");
  assert.equal(normalizedText[0].x, 1, "text layer position is bounded");
  assert.equal(normalizedText[0].color, "#ffffff", "text layer colors stay valid");

  const mainSource = await readFile(join(projectRoot, "src/main.js"), "utf8");
  const indexSource = await readFile(join(projectRoot, "index.html"), "utf8");
  const stylesSource = await readFile(join(projectRoot, "styles.css"), "utf8");
  const viewSource = await readFile(join(projectRoot, "src/editor/view.js"), "utf8");
  const eventsSource = await readFile(join(projectRoot, "src/editor/events.js"), "utf8");
  const canvasSource = await readFile(join(projectRoot, "src/editor/canvas.js"), "utf8");
  const processingSource = await readFile(join(projectRoot, "src/editor/processing.js"), "utf8");
  const textSource = await readFile(join(projectRoot, "src/editor/text.js"), "utf8");
  const fontsSource = await readFile(join(projectRoot, "src/editor/fonts.js"), "utf8");
  const operationsSource = await readFile(join(projectRoot, "src/editor/operations.js"), "utf8");
  const workerSource = await readFile(join(projectRoot, "src/worker.js"), "utf8");
  const batchSource = await readFile(join(projectRoot, "src/batch.js"), "utf8");
  const sessionSource = await readFile(join(projectRoot, "src/session.js"), "utf8");
  const localDataSource = await readFile(join(projectRoot, "src/local-data.js"), "utf8");
  const largeCoreSource = await readFile(join(projectRoot, "src/jobs/core.js"), "utf8");
  const largeStoreSource = await readFile(join(projectRoot, "src/jobs/store.js"), "utf8");
  const largeControllerSource = await readFile(join(projectRoot, "src/jobs/controller.js"), "utf8");
  const largeWorkerSource = await readFile(join(projectRoot, "src/jobs/large-worker.js"), "utf8");
  const largePlanSource = await readFile(join(projectRoot, "LARGE_FOLDER_PLAN.md"), "utf8");
  const inputSource = await readFile(join(projectRoot, "src/input.js"), "utf8");
  const framingSource = await readFile(join(projectRoot, "src/framing.js"), "utf8");
  const engineSource = await readFile(join(projectRoot, "src/engine/pillow.js"), "utf8");
  const configSource = await readFile(join(projectRoot, "src/config.js"), "utf8");
  const qualitySource = await readFile(join(projectRoot, "src/quality.js"), "utf8");
  const scopedEditsSource = await readFile(join(projectRoot, "src/scoped-edits.js"), "utf8");
  const namesSource = await readFile(join(projectRoot, "src/names.js"), "utf8");
  const packageSource = await readFile(join(projectRoot, "package.json"), "utf8");
  const makeSource = await readFile(join(projectRoot, "Makefile"), "utf8");
  const workflowSource = await readFile(join(projectRoot, ".github/workflows/pages.yml"), "utf8");
  const docsCheckerSource = await readFile(join(projectRoot, "scripts/check-doc-links.mjs"), "utf8");
  const pagesCheckerSource = await readFile(join(projectRoot, "scripts/check-pages-artifact.mjs"), "utf8");
  const pagesAssemblerSource = await readFile(join(projectRoot, "scripts/assemble-pages.mjs"), "utf8");
  const browserSmokeSource = await readFile(join(projectRoot, "scripts/browser-smoke.mjs"), "utf8");
  assert.ok(mainSource.split("\n").length <= 100, "main.js remains a small composition entry point");
  assert.doesNotMatch(indexSource, /id="editor-button"/, "the editor is the one primary workspace, not a competing mode");
  assert.match(indexSource, /id="history-actions"/);
  assert.match(indexSource, /id="export-dialog"/);
  assert.match(indexSource, /Download your image/);
  assert.match(indexSource, /id="save-button"[^>]*aria-label="Download PNG"/);
  assert.match(indexSource, /id="export-tool"[^>]*hidden/);
  assert.match(indexSource, /id="format-tool"[^>]*hidden/);
  assert.match(indexSource, /id="size-tool"/);
  assert.match(indexSource, /id="text-tool"/);
  assert.match(indexSource, /id="add-text-button"/);
  assert.match(indexSource, /id="font-drop-zone"/);
  assert.match(indexSource, /fonts\.google\.com/);
  assert.match(indexSource, /<h2 id="output-heading">Format &amp; quality<\/h2>/);
  assert.match(indexSource, /Keep whole image/);
  assert.match(indexSource, /Fill frame/);
  assert.match(indexSource, /id="mobile-inspector-toggle"/);
  assert.match(indexSource, /Fit screen/);
  assert.match(indexSource, /id="zoom-value">No image/);
  assert.match(canvasSource, /elements\.zoomValue\.textContent = "No image"/);
  assert.match(indexSource, /id="individual-save-dialog"/);
  assert.match(indexSource, /id="individual-save-next"/);
  assert.doesNotMatch(indexSource.match(/<dialog id="individual-save-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? "", /<img\b/, "multi-save fallback contains no redundant preview");
  assert.match(indexSource, /id="empty-folder-button"/);
  assert.match(indexSource, /id="empty-editor-actions"/);
  assert.match(indexSource, /Drop images here, paste an image, or choose files or a folder/);
  assert.match(indexSource, /Create a preset/);
  assert.match(indexSource, /accept="image\/png,image\/jpeg,image\/gif,image\/bmp,image\/webp,image\/tiff,image\/x-icon/);
  assert.doesNotMatch(indexSource, /accept="image\/\*,\.avif/);
  assert.doesNotMatch(indexSource, /id="export-preview"/);
  assert.doesNotMatch(indexSource, /export-preview-frame/);
  assert.match(indexSource, /id="output-format-select"/);
  assert.match(indexSource, /id="lossy-toggle"/);
  assert.match(indexSource, /data-quality-preset="80"/);
  assert.match(indexSource, /data-quality-preset="95"/);
  assert.match(indexSource, /data-quality-preset="100"/);
  assert.match(indexSource, /id="batch-lossy-toggle"/);
  assert.match(indexSource, /id="batch-quality-select"/);
  assert.match(indexSource, /id="tray-quality-select"/);
  assert.match(indexSource, /id="batch-framing-notice"/);
  assert.match(indexSource, /Smaller file \(lossy\)/);
  assert.match(indexSource, /id="preset-format-input"/);
  assert.match(indexSource, /id="preset-resize-mode-input"/);
  assert.match(indexSource, /id="preset-lossy-input"/);
  assert.match(indexSource, /id="preset-quality-input"/);
  const htmlIds = [...indexSource.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(htmlIds).size, htmlIds.length, "HTML ids remain unique");
  assert.match(indexSource, /id="batch-cancel-button"/);
  assert.match(indexSource, /id="batch-close-button"/);
  assert.match(indexSource, /id="folder-job-panel"/);
  assert.match(indexSource, /id="folder-job-source-button"/);
  assert.match(indexSource, /id="folder-job-output-button"/);
  assert.match(indexSource, /id="folder-job-recipe"/);
  assert.match(indexSource, /id="folder-job-progress"/);
  assert.match(indexSource, /id="folder-job-results-layer"/);
  assert.match(indexSource, /No archive and no upload/);
  assert.match(indexSource, /id="batch-clear-completed-button"/);
  assert.match(indexSource, /id="compare-hold-button"/);
  assert.match(indexSource, /id="editor-canvas"[^>]*tabindex="0"/);
  assert.match(indexSource, /use arrow keys to move the frame/);
  assert.match(indexSource, /id="crop-width-input"/);
  assert.match(indexSource, /id="destination-picker"/);
  assert.match(indexSource, /id="image-tray"/);
  assert.match(indexSource, /id="tray-preset-picker"/);
  assert.match(indexSource, /id="tray-format-select"/);
  assert.match(indexSource, /id="tray-lossy-toggle"/);
  assert.match(indexSource, /id="tray-apply-edits-button"/);
  assert.match(indexSource, /id="tray-select-all-button"/);
  assert.match(indexSource, /id="tray-cancel-button"/);
  assert.match(indexSource, /id="tray-save-button"/);
  assert.match(indexSource, /id="session-recovery"/);
  assert.match(indexSource, /id="session-restore-button"/);
  assert.match(indexSource, /id="session-clear-button"/);
  assert.match(indexSource, /Recover your last work/);
  assert.match(indexSource, /id="local-data-button"/);
  assert.match(indexSource, /id="local-data-clear-button"/);
  assert.match(indexSource, /id="local-data-font-count"/);
  assert.match(indexSource, /id="local-data-recovery-size"/);
  assert.match(indexSource, /id="mobile-canvas-actions"/);
  assert.match(indexSource, /id="mobile-rotate-right"/);
  assert.match(indexSource, /Edit one image or many/);
  assert.match(indexSource, /id="batch-button"[^>]*>Results/);
  assert.doesNotMatch(indexSource, /id="return-batch-button"/, "the image tray and Results action replace Return-to-set mode switching");
  assert.match(indexSource, /Apply changes to/);
  assert.match(indexSource, /Changes update the preview\. <strong>Download<\/strong> creates the file\./);
  assert.match(indexSource, /id="file-input"[^>]*multiple/);
  assert.match(stylesSource, /processing-indicator\[hidden\]/);
  assert.match(stylesSource, /status-pill\[data-state="ready"\]/);
  assert.match(stylesSource, /presets-drawer/);
  assert.match(stylesSource, /editor-workspace\[data-inspector-open="true"\]/);
  assert.match(stylesSource, /data-empty="true"/);
  assert.match(stylesSource, /\.empty-editor-actions/);
  assert.match(stylesSource, /\.topbar-actions[^\n]*flex-wrap: nowrap/, "desktop header actions keep a stable row");
  assert.match(stylesSource, /\.dirty-state-slot/, "the unsaved badge has a stable layout slot");
  assert.match(stylesSource, /\.batch-selection-actions[^\n]*flex-wrap: wrap/);
  assert.match(stylesSource, /\.batch-toolbar[^\n]*flex-direction: column/);
  assert.match(stylesSource, /prefers-reduced-motion/);
  assert.match(stylesSource, /prefers-contrast/);
  assert.match(stylesSource, /forced-colors/);
  assert.match(stylesSource, /\.batch-framing-notice/);
  assert.match(stylesSource, /#batch-view\[data-review="true"\]/);
  assert.match(stylesSource, /\.topbar \{ position: relative; z-index: 30;/, "topbar stays clickable above the review drawer");
  assert.match(stylesSource, /\.presets-drawer \{ position: fixed; z-index: 35;/, "preset drawer stays above the review drawer");
  assert.match(stylesSource, /\.tool-button\[hidden\] \{ display: none; \}/, "hidden legacy tool controls cannot reappear from display rules");
  assert.match(stylesSource, /\.tool-primary-group \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(44px, 1fr\)\)/, "mobile primary tools adapt when Text and Format are available");
  assert.match(stylesSource, /flex: 1 0 44px/);
  assert.match(mainSource, /attachEditorCanvas/);
  assert.match(mainSource, /attachEditorProcessing/);
  assert.match(mainSource, /setCapabilities: \(raw\) => editor\.setCapabilities\(raw\)/);
  assert.match(mainSource, /composeTextOutput:/, "batch composition can use the editor text compositor");
  assert.match(viewSource, /function setEngineStatus/);
  assert.match(viewSource, /function setProcessingStatus/);
  assert.match(viewSource, /function setInspectorOpen/);
  assert.match(viewSource, /function setCapabilities/);
  assert.match(viewSource, /renderFormatOptions\(\);\n    updateEditorAvailability\(\);/);
  assert.match(viewSource, /elements\.exportFormat\.textContent/);
  assert.match(viewSource, /elements\.formatTool\.hidden = !state\.image/);
  assert.match(viewSource, /elements\.outputFormatDetails\.hidden = false/);
  assert.match(viewSource, /state\.operations\.lossy = false/, "capability downgrade clears stale compression state");
  assert.match(viewSource, /elements\.resizePanel\.hidden = state\.tool !== "size"/);
  assert.match(viewSource, /\["move", "text", "size", "adjust", "format", "export"\]/);
  assert.match(viewSource, /formatCanBeLossy/);
  assert.doesNotMatch(viewSource, /exportPreview/);
  assert.match(viewSource, /\["Change", result && state\.file\?\.bytes/);
  assert.match(eventsSource, /event\.code === "Space"/);
  assert.match(eventsSource, /clipboardImageFiles/);
  assert.match(eventsSource, /tinystar:paste-images/);
  assert.match(eventsSource, /compareHoldButton/);
  assert.match(eventsSource, /mobileRotateRight/);
  assert.match(eventsSource, /mobileFitView/);
  assert.match(eventsSource, /elements\.sizeTool\.addEventListener/);
  assert.match(eventsSource, /elements\.formatTool\.addEventListener/);
  assert.match(eventsSource, /editor\.saveOrOpenExport/);
  assert.match(eventsSource, /function editorOwnsShortcuts/);
  assert.match(eventsSource, /event\.defaultPrevented \|\| !editorOwnsShortcuts\(\)/, "editor shortcuts yield to dialogs and Results");
  assert.match(eventsSource, /hasNoCommandModifiers\(event\) && key === "f"/, "Fit never steals a modified browser shortcut");
  assert.match(viewSource, /elements\.saveButton\.hidden = !enabled/, "Download stays visible while a changed preview updates");
  assert.match(eventsSource, /ArrowLeft/);
  assert.match(canvasSource, /state\.spacePressed/);
  assert.match(canvasSource, /That image format is not supported yet/);
  assert.match(canvasSource, /operations\?\.resizeMode === "crop"/);
  assert.match(canvasSource, /function updateCanvasLabel/);
  assert.match(canvasSource, /const generatedImage/);
  assert.match(canvasSource, /layout\.image \?\? state\.image/);
  assert.match(canvasSource, /\["tm",/);
  assert.match(canvasSource, /for \(const fraction of \[1 \/ 3, 2 \/ 3\]\)/);
  assert.match(canvasSource, /function updateCropDraftField/);
  assert.match(canvasSource, /function nudgeCrop/);
  assert.match(canvasSource, /function pointerDistance/);
  assert.match(canvasSource, /kind: "text-move"/);
  assert.match(canvasSource, /kind: "text-resize"/);
  assert.match(canvasSource, /lastTapAt/);
  assert.match(processingSource, /setEngineStatus\("Ready", "ready"\)/);
  assert.match(processingSource, /state\.processingError = message\.message/);
  assert.match(processingSource, /state\.processingError \?\? "The preview could not be created\."/);
  assert.match(processingSource, /function invalidateResult/);
  assert.match(processingSource, /state\.result\.image = image/);
  assert.match(processingSource, /function requestPreviewProxy/);
  assert.match(processingSource, /function openExportDialog/);
  assert.match(processingSource, /function saveOrOpenExport/);
  assert.match(processingSource, /composeTextOutput/);
  assert.match(browserSmokeSource, /async function assertPreviewMatchesGeneratedBytes/);
  assert.match(browserSmokeSource, /async function readLatestGeneratedBytes/);
  assert.match(browserSmokeSource, /direct single-format Download downloads the current preview bytes/);
  assert.match(browserSmokeSource, /opening the fallback does not launch blocked automatic downloads/);
  assert.match(browserSmokeSource, /each explicit fallback click starts exactly one download/);
  assert.match(browserSmokeSource, /getImageData\(0, 0, canvas\.width, canvas\.height\)/, "browser smoke compares rendered pixels");
  assert.match(browserSmokeSource, /differingPixels/, "browser smoke fails on preview/output pixel differences");
  assert.match(browserSmokeSource, /adding text changes the generated PNG bytes/);
  assert.match(browserSmokeSource, /moving text marks the image as changed/);
  assert.match(browserSmokeSource, /async function seedStoredFontRecord/);
  assert.match(browserSmokeSource, /Editor navigation reopens the active restored image/);
  assert.match(operationsSource, /function setFormat/);
  assert.match(operationsSource, /next\.lossy = Boolean\(next\.lossy &&/);
  assert.match(operationsSource, /function applyDestination/);
  assert.match(operationsSource, /next\.lossy = Boolean\(next\.lossy && state\.capabilities\.compression\.lossyFormats\.includes\(format\)\)/);
  assert.match(textSource, /export async function composeTextOutput/);
  assert.match(textSource, /Download the font file from Google Fonts/);
  assert.match(fontsSource, /new FontFace/);
  assert.match(fontsSource, /indexedDB\.open/);
  assert.match(fontsSource, /export async function clearStoredFonts/);
  assert.match(workerSource, /type: "cancelled", revision, jobId/);
  assert.match(workerSource, /newestRevision/);
  assert.match(workerSource, /type: "preview-result"/);
  assert.match(workerSource, /\.\.\.engine\.capabilities/);
  assert.match(workerSource, /format: result\.format/);
  assert.match(batchSource, /formatAccept/);
  assert.match(batchSource, /batch-format-control/);
  assert.match(batchSource, /state\.batch\.formatOverride/);
  assert.match(batchSource, /state\.batch\.lossyOverride/);
  assert.match(batchSource, /trayFormat/);
  assert.match(batchSource, /function setBatchLossy/);
  assert.match(batchSource, /function setBatchFormat[\s\S]*?state\.batch\.lossyOverride = null/, "batch format changes clear stale compression state");
  assert.match(batchSource, /function applyCapabilities[\s\S]*?state\.batch\.lossyOverride = null/, "capability downgrade clears batch compression state");
  assert.match(batchSource, /function applyPresetDestinationToDialog/);
  assert.match(batchSource, /function syncPresetCompression/);
  assert.match(batchSource, /if \(!lossy\) elements\.presetLossy\.checked = false/);
  assert.match(batchSource, /function startNewBatch/);
  assert.match(batchSource, /function removeBatchItem/);
  assert.match(batchSource, /Hold to compare original/);
  assert.match(batchSource, /batchFileInput\.value = ""/);
  assert.match(batchSource, /downloadedFileName/);
  assert.match(batchSource, /saveResultsToFolder/);
  assert.match(batchSource, /createUniqueOutputFolder/);
  assert.match(batchSource, /createWritable\(\)/);
  assert.match(batchSource, /__tinystarDisableDirectorySave/);
  assert.match(batchSource, /function openIndividualSaveQueue/);
  assert.match(batchSource, /function saveNextIndividualResult/);
  assert.doesNotMatch(batchSource, /for \(const item of items\) saveSingleBatchItem\(item\)/, "folder fallback never launches several downloads from one gesture");
  assert.doesNotMatch(batchSource, /makeZip|zip-worker|application\/zip/, "multi-image save never creates an archive");
  assert.doesNotMatch(namesSource, /zipEntryName|zipArchiveName|downloadedZip/, "dead archive naming paths stay removed");
  assert.match(batchSource, /state\.batchWorkers/);
  assert.match(batchSource, /processingWorkerCount\(/, "batch processing is memory-aware");
  assert.match(batchSource, /function createBatchWorker/);
  assert.match(batchSource, /function retireBatchWorker/);
  assert.match(batchSource, /function cancelActiveBatch/);
  assert.match(batchSource, /function requestBatchPreview/);
  assert.match(batchSource, /item\.retryable/);
  assert.match(batchSource, /async function retryBatchItem/);
  assert.match(batchSource, /function clearCompletedBatchItems/);
  assert.match(batchSource, /function renderWorkspaceTray/);
  assert.match(batchSource, /open\.disabled = !item\.width \|\| !item\.height/, "tray items cannot open before their real dimensions are known");
  assert.match(batchSource, /function captureCurrentBatchEditorOverride/);
  assert.match(batchSource, /function applyCurrentEditsToScope/);
  assert.match(batchSource, /mergeRelativeSharedEdit/);
  assert.match(batchSource, /removeAppliedKeys/);
  assert.match(batchSource, /function refreshActiveBatchEditor/);
  assert.match(batchSource, /function openActiveBatchItemIfNeeded/);
  assert.match(batchSource, /function editBatchItem\(item\) \{[\s\S]*?if \(!item\?\.width \|\| !item\?\.height\)/, "rapid tray clicks cannot create a 1 × 1 configuration");
  assert.match(batchSource, /openActiveBatchItemIfNeeded\(\);/, "Editor navigation reopens an active collection item");
  assert.match(batchSource, /const effectiveFormat = effectiveOperationsForItem\(item, activePreset\)\.format/, "batch cards show the merged per-image format when a result is unavailable");
  assert.match(batchSource, /if \(state\.batch\.activeId === item\.id\) refreshActiveBatchEditor\(\);/, "resetting an active override refreshes the canvas config");
  assert.match(batchSource, /trayPresetPicker/);
  assert.match(batchSource, /traySelectAllButton/);
  assert.match(batchSource, /Select all/);
  assert.match(batchSource, /focusFirst/);
  assert.match(batchSource, /batch-clear-completed-button/);
  assert.match(batchSource, /Updates cancelled/);
  assert.match(batchSource, /trayCancelButton/);
  assert.match(batchSource, /state\.view === "batch"/, "review owns the visible batch cancellation action");
  assert.match(batchSource, /message.type === "fatal-error"/);
  assert.match(batchSource, /state\.batch\.selected/);
  assert.match(batchSource, /selectedReadyCount/);
  assert.match(batchSource, /selectionTouched/);
  assert.match(batchSource, /function openPresets/);
  assert.match(batchSource, /function renderWorkspaceNavigation/);
  assert.match(batchSource, /hasActiveSetItem/);
  assert.match(batchSource, /dataset\.workspaceAction = "results"/);
  assert.match(batchSource, /if \(view === "batch" && state\.batch\.files\.length === 0 && !state\.folderJobActive\)/, "an empty collection stays on the editor start surface unless a folder job is active");
  assert.match(batchSource, /window\.addEventListener\("tinystar:add-images"/i, "Add images opens the same native import path");
  assert.match(batchSource, /window\.addEventListener\("tinystar:paste-images"/i, "pasted images use the shared collection path");
  assert.match(batchSource, /if \(view === "batch" && state\.batch\.files\.length > 0 && !snapshot\?\.file && !state\.folderJobActive\)/, "active collections return to the shared canvas before review");
  assert.match(batchSource, /if \(openActiveBatchItemIfNeeded\(\)\) \{[\s\S]*?showView\("batch"\)/, "review re-enters after restoring the active collection item");
  assert.match(batchSource, /if \(elements\.batchView\?\.dataset\.review === "true"\) showView\("editor"\);/);
  assert.match(batchSource, /function syncReviewOffset/);
  assert.match(eventsSource, /tinystar:choose-folder/);
  assert.match(batchSource, /folderImportFromEditor/);
  assert.match(batchSource, /importBatchFiles\(files, \{ focusFirst \}\)/, "folder entry preserves the editor focus contract");
  assert.match(batchSource, /--review-top/);
  assert.match(batchSource, /batch-card-more/);
  assert.doesNotMatch(batchSource, /more\.open = morePresets\.some/, "Results does not expand secondary destinations from the selected recipe");
  assert.match(batchSource, /Download started for/);
  assert.match(batchSource, /state\.batch\.files\.push\(\.\.\.newItems\)/, "batch additions preserve existing items");
  assert.match(batchSource, /existingCount \+ prepared\.length > MAX_BATCH_FILES/, "batch additions respect file limit after duplicate filtering");
  assert.match(batchSource, /formatSizeChange\(item\.file\.size, result\.outputBytes\)/, "batch previews show file-size impact");
  assert.match(batchSource, /MAX_BATCH_FILES/);
  assert.match(batchSource, /function interactiveBatchLimitMessage/);
  assert.match(batchSource, /For a larger collection, use Process large folder/);
  assert.match(batchSource, /desktop Chrome or Edge/);
  assert.match(batchSource, /function renderImportCapacity/);
  assert.match(batchSource, /MAX_BATCH_BYTES/);
  assert.match(batchSource, /const incomingBytes/);
  assert.match(batchSource, /batchBytesExceedLimit\(existingBytes, incomingBytes, MAX_BATCH_BYTES\)/);
  assert.match(batchSource, /batchBytesExceedLimit\(existingBytes, totalBytes - existingBytes, MAX_BATCH_BYTES\)/);
  assert.match(batchSource, /item\.override/);
  assert.match(batchSource, /state\.batch\.presetId/);
  assert.match(batchSource, /state\.batch\.recipeScope/);
  assert.match(batchSource, /item\.presetOverride/);
  assert.match(batchSource, /function applyPresetToScope/);
  assert.match(batchSource, /state\.activePresetId = scope === "all" \? preset\.id : state\.activePresetId;[\s\S]*?state\.batch\.formatOverride = null;[\s\S]*?state\.batch\.lossyOverride = null;/, "choosing a complete recipe clears stale output overrides");
  assert.match(batchSource, /function recipeScopeTargets/);
  assert.match(batchSource, /function resetBatchRecipe/);
  assert.match(batchSource, /tinyImageStarEditor\?\.clearFile\?\.\(\)/, "New set clears the stale canvas as well as collection results");
  assert.match(batchSource, /Use shared destination/);
  assert.match(batchSource, /attachLargeFolderJobs/);
  assert.match(batchSource, /supportsLargeFolderJobs/);
  assert.match(largeControllerSource, /async function\* walkDirectory/);
  assert.match(largeControllerSource, /claimPendingEntries\(state\.job\.id, available\.length\)/, "scheduler claims no more entries than idle workers");
  assert.match(largeControllerSource, /virtualWindow/);
  assert.match(largeControllerSource, /resetInterruptedEntries/);
  assert.match(largeControllerSource, /function continueJob/);
  assert.match(largeControllerSource, /function finishPauseIfIdle/);
  assert.match(
    largeControllerSource,
    /workersActive\(\) > 0[\s\S]*?status: "pausing"/,
    "active workers cannot be reset to pending by a quick Resume",
  );
  assert.match(largeControllerSource, /continueJob\(\{ retryFailed: true \}\)/, "retry and resume share permission and restart checks");
  assert.match(largeControllerSource, /!job\?\.scanComplete/, "processing cannot start before durable discovery completes");
  assert.match(largeControllerSource, /clearManifestEntries\(state\.job\.id\)/, "interrupted discovery is cleared before deterministic rescan");
  assert.match(largeControllerSource, /if \(state\.job\) await deleteLargeJob\(state\.job\.id\)/, "replacing a folder job removes its now-inaccessible metadata manifest");
  assert.match(largeStoreSource, /\["jobId", "index"\]/, "manifest entries use durable compound keys");
  assert.match(largeStoreSource, /export async function clearManifestEntries/, "manifest entries can be reset without deleting the durable job");
  assert.match(largeStoreSource, /completedDelta[\s\S]*Number\(job\.completed/, "parallel completion counters increment from durable transaction state");
  assert.match(largeControllerSource, /completedDelta: 1/, "workers commit completion deltas instead of stale absolute counters");
  assert.match(largeStoreSource, /status: "processing"/, "manifest claims are persisted before worker dispatch");
  assert.match(largeWorkerSource, /OUTPUT_WRITE_CHUNK_BYTES = 4 \* 1024 \* 1024/);
  assert.match(largeWorkerSource, /bytes\.subarray\(offset/, "large output is written through bounded stream chunks");
  assert.match(largeWorkerSource, /await writable\.close\(\)/, "output is committed before completion is reported");
  assert.doesNotMatch(largeWorkerSource, /output: result\.bytes|output: transfer/, "large workers never return output image bytes to the main thread");
  assert.match(largeCoreSource, /MAX_LARGE_FOLDER_FILES = 100_000/);
  assert.match(largePlanSource, /source and result bytes are never retained/);
  assert.match(largePlanSource, /ZIP is not part/);
  assert.match(indexSource, /id="batch-scope-select"/);
  assert.match(indexSource, /id="tray-scope-select"/);
  assert.match(batchSource, /offerSessionRecovery/);
  assert.match(batchSource, /restoreSession/);
  assert.match(batchSource, /scheduleSessionSave/);
  assert.match(batchSource, /prepareBatchItem/);
  assert.match(batchSource, /function effectiveOperationsForItem/);
  assert.match(batchSource, /framingReviewForItems/);
  assert.match(batchSource, /Review framing/);
  assert.match(batchSource, /sharedOperations/);
  assert.match(batchSource, /mergeOverridePatch/);
  assert.match(configSource, /export function mergeOperationConfig/);
  assert.match(configSource, /export function diffOperationConfig/);
  assert.match(configSource, /export function mergeOverridePatch/);
  assert.match(qualitySource, /Low/);
  assert.match(qualitySource, /Medium/);
  assert.match(qualitySource, /High/);
  assert.match(scopedEditsSource, /export function relativeEditPatch/);
  assert.match(scopedEditsSource, /export function mergeRelativeSharedEdit/);
  assert.match(scopedEditsSource, /export function removeAppliedKeys/);
  assert.match(engineSource, /export function previewWithApi/);
  assert.match(engineSource, /export function exifOrientationFromBytes/);
  assert.match(engineSource, /5: "TRANSPOSE"/);
  assert.match(engineSource, /7: "TRANSVERSE"/);
  assert.match(engineSource, /function verifyEncodedOutput/);
  assert.match(engineSource, /export function runtimeCapabilities/);
  assert.match(engineSource, /MAX_IMAGE_PIXELS/);
  assert.match(engineSource, /settings\.cropRelative/);
  assert.match(processingSource, /function clearImage\(\)/, "editor exposes a real empty-state transition for New set");
  assert.match(inputSource, /MAX_BATCH_PIXELS/);
  assert.match(inputSource, /MAX_BATCH_BYTES/);
  assert.match(inputSource, /export function batchBytesExceedLimit/);
  assert.match(inputSource, /skipSubBlocks/);
  assert.match(inputSource, /export function processingWorkerCount/);
  assert.match(inputSource, /export function isAnimatedImage/);
  assert.match(framingSource, /export function framingReviewForItems/);
  assert.match(inputSource, /export async function fingerprintBytes/);
  assert.match(stylesSource, /\.tool-group/);
  assert.match(stylesSource, /\.batch-compare-button/);
  assert.match(stylesSource, /\.session-recovery/);
  assert.match(stylesSource, /\.folder-job-results/);
  assert.match(stylesSource, /contain: strict/);
  assert.match(stylesSource, /\.mobile-canvas-actions/);
  assert.match(stylesSource, /position: fixed; z-index: 30/);
  assert.match(sessionSource, /indexedDB\.open/);
  assert.match(sessionSource, /lossyOverride/);
  assert.match(sessionSource, /qualityOverride/);
  assert.match(sessionSource, /sharedOverride/);
  assert.match(sessionSource, /presetOverride/);
  assert.match(sessionSource, /recipeScope/);
  assert.match(sessionSource, /buildEditorSessionSnapshot/);
  assert.match(sessionSource, /EDITOR_SESSION_KEY/);
  assert.match(sessionSource, /generated outputs are deliberately excluded/);
  assert.match(localDataSource, /export async function readLocalDataSummary/);
  assert.match(localDataSource, /export async function clearStoredLocalData/);
  assert.match(localDataSource, /tinystar:local-data-cleared/);
  assert.match(packageSource, /"verify:all": "npm run verify && npm run verify:browser && npm run check:docs"/, "the full npm gate includes documentation links");
  assert.match(makeSource, /\.DEFAULT_GOAL := help/);
  assert.match(makeSource, /package-pages:/);
  assert.match(makeSource, /check-docs:/);
  assert.match(workflowSource, /make verify/);
  assert.match(workflowSource, /make package-pages PAGES_DIR=_site/);
  assert.match(workflowSource, /actions\/checkout@v7/);
  assert.match(workflowSource, /actions\/setup-node@v7/);
  assert.match(workflowSource, /actions\/configure-pages@v6/);
  assert.match(workflowSource, /if: github\.event_name != 'pull_request'\s+uses: actions\/upload-pages-artifact@v5/);
  assert.match(workflowSource, /actions\/deploy-pages@v5/);
  assert.match(docsCheckerSource, /Broken local documentation links/);
  assert.match(pagesCheckerSource, /pillow_rs_js_bg\.wasm/);
  assert.match(pagesAssemblerSource, /must be a child of the repository/);

  console.log("verify: PASS");
  console.log("  real WASM transforms: PNG fit/crop/rotate/flip/adjustments, exact decoded pixels, PNG bytes, decoded dimensions, output-size guard");
  console.log("  real input decoders: JPEG, BMP, WebP, GIF, TIFF, ICO, EXIF-JPEG fixture paths, corrupt-input rejection");
  console.log(`  real format contract: runtime-verified output formats ${runtimeCapabilities(pillowApi).outputFormats.join(", ")}; synthetic JPEG signature path and rejection of PNG-only masquerading`);
  console.log("  large-folder contract: 100k metadata-only manifest, bounded virtual rows/workers, collision-safe paths, direct folder output, no archive path");
  console.log("  contract checks: editor modules, readiness separation, revisions, capability-driven formats, Low/Medium/High quality gating, metadata-only download, presets, selection, append imports, animated-input safety, duplicate identity, byte/output pixel guards, memory-aware worker parallelism, bounded worker failure handling, relative apply-to-all edits, shared-recipe/per-item override merge, explicit recipe scope, mixed-shape framing review, unified tray selection, versioned session and large-job recovery");
}

try {
  await run();
} catch (error) {
  console.error("verify: FAIL");
  console.error(error);
  process.exitCode = 1;
}
