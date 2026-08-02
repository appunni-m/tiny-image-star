import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import * as pillowApi from "../wasm/pillow_rs_js.js";
import { renderWithApi, runtimeCapabilities } from "../src/engine/pillow.js";
import { settingsForPreset } from "../src/presets.js";

function readUnsignedLeb(bytes, start) {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < bytes.length) {
    const byte = bytes[offset];
    offset += 1;
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return { value: value >>> 0, offset };
    shift += 7;
  }
  throw new Error("Invalid WASM section length.");
}

function wasmSections(bytes) {
  const sections = [];
  let offset = 8;
  while (offset < bytes.length) {
    const id = bytes[offset];
    const size = readUnsignedLeb(bytes, offset + 1);
    const end = size.offset + size.value;
    let name = null;
    if (id === 0) {
      const nameLength = readUnsignedLeb(bytes, size.offset);
      name = new TextDecoder().decode(bytes.subarray(nameLength.offset, nameLength.offset + nameLength.value));
    }
    sections.push({ id, name, bytes: size.value });
    offset = end;
  }
  return sections;
}

async function walk(folder) {
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(folder);
  return files.sort();
}

function samplesAcross(files, count) {
  const sampleCount = Math.max(1, Math.min(files.length, count));
  return Array.from({ length: sampleCount }, (_, index) => files[Math.floor(index * files.length / sampleCount)]);
}

function metric(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    totalMs: Number(total.toFixed(2)),
    averageMs: Number((total / Math.max(1, values.length)).toFixed(2)),
    p95Ms: Number(ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))].toFixed(2)),
  };
}

const folder = resolve(process.argv[2] ?? "tiny-image-star-20260802-050216-my-image-recipe");
const requestedSamples = Number.parseInt(process.argv[3] ?? "64", 10) || 64;
const discoveryStarted = performance.now();
const files = (await walk(folder)).filter((path) => /\.(png|jpe?g|gif|bmp|webp|tiff?|ico)$/i.test(path));
const discoveryMs = performance.now() - discoveryStarted;
if (!files.length) throw new Error(`No supported images found in ${folder}`);

const metadataStarted = performance.now();
let totalBytes = 0;
for (const path of files) totalBytes += (await stat(path)).size;
const metadataMs = performance.now() - metadataStarted;

const wasmBytes = await readFile(new URL("../wasm/pillow_rs_js_bg.wasm", import.meta.url));
const sections = wasmSections(wasmBytes);
const initializationStarted = performance.now();
pillowApi.initSync({ module: wasmBytes });
const capabilities = runtimeCapabilities(pillowApi);
const initializationMs = performance.now() - initializationStarted;
const selected = samplesAcross(files, requestedSamples);
const outputFolder = await mkdtemp(join(tmpdir(), "tiny-image-star-profile-"));
const timings = { read: [], decode: [], encode: [], verifyDecode: [], write: [], fullRender: [] };
const dimensions = new Map();
const keepOriginal = {
  ...settingsForPreset("keep-original"),
  presetName: "Edit without resizing",
  format: capabilities.outputFormats[0],
};

try {
  // Warm the module and allocator before collecting timings.
  const warmBytes = await readFile(selected[0]);
  let warmImage = pillowApi.Image.open(warmBytes);
  const warmEncoded = warmImage.save();
  warmImage.free();
  warmImage = pillowApi.Image.open(warmEncoded);
  warmImage.free();

  for (let index = 0; index < selected.length; index += 1) {
    const path = selected[index];
    let started = performance.now();
    const source = await readFile(path);
    timings.read.push(performance.now() - started);

    started = performance.now();
    const image = pillowApi.Image.open(source);
    timings.decode.push(performance.now() - started);
    dimensions.set(`${image.width}×${image.height}`, (dimensions.get(`${image.width}×${image.height}`) ?? 0) + 1);

    started = performance.now();
    const encoded = image.save();
    timings.encode.push(performance.now() - started);
    image.free();

    started = performance.now();
    const verified = pillowApi.Image.open(encoded);
    timings.verifyDecode.push(performance.now() - started);
    verified.free();

    started = performance.now();
    await writeFile(join(outputFolder, `${String(index).padStart(4, "0")}.png`), encoded);
    timings.write.push(performance.now() - started);

    started = performance.now();
    await renderWithApi(pillowApi, { name: basename(path), bytes: source }, keepOriginal, capabilities);
    timings.fullRender.push(performance.now() - started);
  }
} finally {
  await rm(outputFolder, { recursive: true, force: true });
}

const stageMetrics = Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, metric(values)]));
const directStageNames = ["read", "decode", "encode", "verifyDecode", "write"];
const directTotal = directStageNames.reduce((sum, name) => sum + stageMetrics[name].totalMs, 0);
const largestStage = directStageNames
  .map((name) => ({ name, totalMs: stageMetrics[name].totalMs }))
  .sort((left, right) => right.totalMs - left.totalMs)[0];
const singleWorkerPerSecond = 1000 / stageMetrics.fullRender.averageMs;

console.log(JSON.stringify({
  folder,
  files: files.length,
  totalBytes,
  averageBytes: Math.round(totalBytes / files.length),
  sampleFiles: selected.length,
  dimensions: Object.fromEntries(dimensions),
  discovery: { listMs: Number(discoveryMs.toFixed(2)), sequentialMetadataMs: Number(metadataMs.toFixed(2)) },
  wasm: {
    bytes: wasmBytes.length,
    initializationMs: Number(initializationMs.toFixed(2)),
    customSections: sections.filter((section) => section.id === 0),
    debugSections: sections.filter((section) => section.id === 0 && /^\.debug/.test(section.name ?? "")),
    codeSectionBytes: sections.find((section) => section.id === 10)?.bytes ?? null,
  },
  stages: stageMetrics,
  largestMeasuredDirectStage: {
    ...largestStage,
    percent: Number((largestStage.totalMs / directTotal * 100).toFixed(1)),
  },
  measuredSingleWorkerImagesPerSecond: Number(singleWorkerPerSecond.toFixed(2)),
  idealTwoWorkerImagesPerSecond: Number((singleWorkerPerSecond * 2).toFixed(2)),
  idealFourWorkerImagesPerSecond: Number((singleWorkerPerSecond * 4).toFixed(2)),
}, null, 2));
