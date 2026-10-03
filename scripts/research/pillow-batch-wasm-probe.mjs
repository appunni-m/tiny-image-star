#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { defaultActiveRenderMemoryBudget, defaultImageCachePixelBudget, estimateImageWorkingSetBytes } from '../../src/image-engine.js';

const parse = (key, fallback) => {
  const match = process.argv.slice(2).find(argument => argument.startsWith(`--${key}=`));
  return match ? match.slice(key.length + 3) : fallback;
};
const imagesPerRun = Number(parse('images', '24'));
const sizeText = parse('size', '1024x768');
const workerText = parse('workers', '1,2,4');
const [width, height] = sizeText.split('x').map(Number);
const requestedWorkerCounts = workerText.split(',').map(Number);
if (!Number.isSafeInteger(imagesPerRun) || imagesPerRun < 1 || imagesPerRun > 256) throw new RangeError('--images must be an integer from 1 to 256.');
if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 32 || height < 32 || width * height > 4_194_304) {
  throw new RangeError('--size must be widthxheight with positive dimensions and no more than 4,194,304 pixels.');
}
if (!requestedWorkerCounts.length || requestedWorkerCounts.some(value => !Number.isSafeInteger(value) || value < 1 || value > 8)) {
  throw new RangeError('--workers must be a comma-separated list of integers from 1 to 8.');
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function makeRgbaPng(sourceWidth, sourceHeight, seed) {
  const rowBytes = sourceWidth * 4;
  const raw = Buffer.alloc(sourceHeight * (rowBytes + 1));
  let value = seed >>> 0;
  const nextByte = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value >>> 24;
  };
  for (let y = 0; y < sourceHeight; y += 1) {
    const offset = y * (rowBytes + 1);
    raw[offset] = 0;
    for (let index = 0; index < rowBytes; index += 1) raw[offset + index + 1] = nextByte();
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(sourceWidth, 0); header.writeUInt32BE(sourceHeight, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 3 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const images = Array.from({ length: imagesPerRun }, (_, index) => ({
  assetId: `image-${index}`,
  sourceBytes: new Uint8Array(makeRgbaPng(width, height, 0x41524742 + index * 17)),
  adjustments: {
    brightness: (index % 9 - 4) * 5,
    contrast: (index % 7 - 3) * 4,
    saturation: (index % 5 - 2) * 6,
    sharpness: index % 2 ? 10 : 0,
  },
  transforms: {},
}));

const cores = Math.max(1, cpus().length);
const cpuBudget = Math.min(8, cores);
const activeRenderBudget = defaultActiveRenderMemoryBudget({ deviceMemory: null });
const cachePixelBudget = defaultImageCachePixelBudget({ deviceMemory: null, hardwareConcurrency: cores });
const perImageWorkingSet = Math.max(...images.map(image => estimateImageWorkingSetBytes(image.sourceBytes)));
const memoryWorkerLimit = Math.max(1, Math.floor(activeRenderBudget / perImageWorkingSet));
const effectiveRuns = [...new Set(requestedWorkerCounts)].map(requested => ({
  requested,
  poolSize: Math.min(requested, cpuBudget),
  activeWorkers: Math.min(requested, cpuBudget, memoryWorkerLimit),
}));
const referenceHashes = new Map();
const runs = [];

for (const run of effectiveRuns) {
  const workers = Array.from({ length: run.poolSize }, (_, workerId) => new Worker(
    new URL('./pillow-batch-worker.mjs', import.meta.url),
    { workerData: { workerId, cachePixelBudget: Math.floor(cachePixelBudget / run.poolSize) } },
  ));
  const startedAt = performance.now();
  const readyAt = await Promise.all(workers.map(worker => new Promise((resolve, reject) => {
    const onMessage = message => {
      if (message.type === 'ready') { worker.off('error', reject); resolve(performance.now()); }
      else if (message.type === 'error') reject(new Error(message.message));
    };
    worker.on('message', onMessage);
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`Pillow probe worker exited with code ${code}.`)); });
  })));
  const readyMs = Math.max(...readyAt) - startedAt;
  const renderStartedAt = performance.now();
  const actualWorkerCount = Math.max(1, run.activeWorkers);
  const assigned = Array.from({ length: run.poolSize }, () => []);
  for (let index = 0; index < images.length; index += 1) {
    const workerId = index % actualWorkerCount;
    assigned[workerId].push(images[index]);
  }

  const received = new Map();
  let remaining = images.length;
  let failed = null;
  const allResults = new Promise((resolve, reject) => {
    const stop = error => {
      if (failed) return;
      failed = error;
      reject(error);
    };
    for (const worker of workers) {
      worker.on('message', message => {
        if (message.type === 'error') { stop(new Error(message.message)); return; }
        if (message.type !== 'result') return;
        const bytes = new Uint8Array(message.bytes);
        const hash = createHash('sha256').update(bytes).digest('hex');
        received.set(message.assetId, hash);
        remaining -= 1;
        if (remaining === 0) resolve();
      });
      worker.once('error', stop);
    }
  });

  for (let workerId = 0; workerId < workers.length; workerId += 1) {
    const tasks = assigned[workerId];
    if (!tasks.length) continue;
    const copies = tasks.map(image => ({ ...image, sourceBytes: image.sourceBytes.slice() }));
    workers[workerId].postMessage({ type: 'render', images: copies }, copies.map(image => image.sourceBytes.buffer));
  }
  await allResults;
  const renderMs = performance.now() - renderStartedAt;
  const coldMs = performance.now() - startedAt;
  for (const [assetId, hash] of received) {
    if (referenceHashes.has(assetId) && referenceHashes.get(assetId) !== hash) {
      throw new Error(`Pillow-RS output differed at ${assetId} between worker counts.`);
    }
    referenceHashes.set(assetId, hash);
  }
  for (const worker of workers) await worker.terminate();
  runs.push({
    requestedWorkers: run.requested,
    poolWorkers: run.poolSize,
    memoryLimitedActiveWorkers: run.activeWorkers,
    wasmReadyMs: Number(readyMs.toFixed(1)),
    warmRenderMs: Number(renderMs.toFixed(1)),
    coldTotalMs: Number(coldMs.toFixed(1)),
    imagesPerSecond: Number((images.length / (renderMs / 1000)).toFixed(2)),
    equivalentOutputs: received.size === images.length,
    peakProcessRssMiB: Number((process.memoryUsage().rss / 1048576).toFixed(1)),
  });
}

console.log(JSON.stringify({
  probe: 'real Pillow-RS WASM in Node worker_threads; diagnostic only, not a browser/device guarantee',
  host: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpuModel: cpus()[0]?.model || null,
    logicalCores: cores,
  },
  size: `${width}x${height}`,
  images: images.length,
  cpuBudget,
  activeRenderBudgetMiB: Number((activeRenderBudget / 1048576).toFixed(1)),
  decodedCacheBudgetMiB: Number((cachePixelBudget * 4 / 1048576).toFixed(1)),
  perImageWorkingSetMiB: Number((perImageWorkingSet / 1048576).toFixed(1)),
  runs,
  identicalOutputsAcrossWorkers: referenceHashes.size === images.length,
}, null, 2));
