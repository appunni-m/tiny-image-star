import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { basename, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import * as ort from 'onnxruntime-web';

const modelPath = process.argv[2];
if (!modelPath) {
  throw new TypeError('Pass the path to a local ONNX super-resolution model.');
}
const threadCount = Number(process.argv[4] || 1);
if (!Number.isSafeInteger(threadCount) || threadCount < 1 || threadCount > 8) {
  throw new RangeError('Probe WASM threads must be an integer from 1 through 8.');
}
const sizes = (process.argv[3] || '64,128,256,384').split(',').map(Number);
if (sizes.length < 1 || sizes.length > 12 || sizes.some(size =>
  !Number.isSafeInteger(size) || size < 16 || size > 512)) {
  throw new RangeError('Probe sizes must be 1–12 integer values from 16 through 512 pixels.');
}

ort.env.wasm.numThreads = threadCount;
ort.env.wasm.proxy = false;
const modelBytes = new Uint8Array(await readFile(resolve(modelPath)));
const modelSha256 = createHash('sha256').update(modelBytes).digest('hex');
function rssMiB() { return Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1)); }
const processRssBeforeSessionMiB = rssMiB();
const session = await ort.InferenceSession.create(modelBytes, {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all'
});

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return Number((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2).toFixed(1));
}
function inputFor(size) {
  const values = new Float32Array(3 * size * size);
  for (let index = 0; index < values.length; index += 1) values[index] = ((index * 37) % 256) / 255;
  return new ort.Tensor('float32', values, [1, 3, size, size]);
}

try {
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const warmupStart = performance.now();
  await session.run({ [inputName]: inputFor(32) });
  const warmupMs = Number((performance.now() - warmupStart).toFixed(1));
  const observations = [];

  for (const size of sizes) {
    const input = inputFor(size);
    const elapsedMs = [];
    let outputShape = null;
    let finiteSamples = false;
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const started = performance.now();
      const result = await session.run({ [inputName]: input });
      elapsedMs.push(performance.now() - started);
      const output = result[outputName];
      outputShape = output.dims;
      finiteSamples = output.data.length > 0 && Number.isFinite(output.data[0])
        && Number.isFinite(output.data.at(-1));
    }
    observations.push({ size, medianMs: median(elapsedMs), samplesMs: elapsedMs.map(value => Number(value.toFixed(1))),
      outputShape, finiteSamples, processRssMiB: rssMiB() });
  }

  console.log(JSON.stringify({
    probe: 'single-thread ONNX Runtime Web WASM CPU',
    model: basename(resolve(modelPath)),
    modelBytes: modelBytes.byteLength,
    modelSha256,
    runtime: 'onnxruntime-web 1.30.0',
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    logicalCpuCount: os.cpus().length,
    wasmThreads: threadCount,
    warmup32PxMs: warmupMs,
    processRssBeforeSessionMiB,
    processRssAfterSessionMiB: rssMiB(),
    observations
  }, null, 2));
} finally {
  await session.release();
}
