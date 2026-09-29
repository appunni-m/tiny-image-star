import { DEFAULT_DECODED_SOURCE_PIXEL_BUDGET } from './decoded-source-cache.js';

const MIB_PIXELS = 1_000_000;
const MIB_BYTES = 1024 * 1024;
const MAX_RENDER_SOURCE_PIXELS = 80_000_000;
// Source + mutable Pillow copy + filter/encoder temporaries. This deliberately
// overestimates the common 4-byte-per-pixel path so parallel jobs leave room
// for WASM allocator and PNG output overhead.
const ACTIVE_BYTES_PER_PIXEL = 32;
const MAX_HEADER_SCAN_BYTES = 1024 * 1024;
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function bytesView(sourceBytes) {
  if (sourceBytes instanceof ArrayBuffer) return new DataView(sourceBytes);
  if (ArrayBuffer.isView(sourceBytes)) return new DataView(sourceBytes.buffer, sourceBytes.byteOffset, sourceBytes.byteLength);
  return null;
}

function hasAscii(view, offset, text) {
  if (offset < 0 || offset + text.length > view.byteLength) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (view.getUint8(offset + index) !== text.charCodeAt(index)) return false;
  }
  return true;
}

function imageDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return null;
  const pixels = width * height;
  return Number.isSafeInteger(pixels) ? { width, height, pixels } : null;
}

function pngDimensions(view) {
  if (view.byteLength < 24 || !hasAscii(view, 1, 'PNG\r\n\u001a\n') || view.getUint8(0) !== 0x89 || !hasAscii(view, 12, 'IHDR')) return null;
  return imageDimensions(view.getUint32(16), view.getUint32(20));
}

function gifDimensions(view) {
  if (view.byteLength < 10 || !(hasAscii(view, 0, 'GIF87a') || hasAscii(view, 0, 'GIF89a'))) return null;
  return imageDimensions(view.getUint16(6, true), view.getUint16(8, true));
}

function bmpDimensions(view) {
  if (view.byteLength < 26 || !hasAscii(view, 0, 'BM')) return null;
  const headerSize = view.getUint32(14, true);
  if (headerSize === 12) return imageDimensions(view.getUint16(18, true), view.getUint16(20, true));
  if (headerSize < 40 || view.byteLength < 26) return null;
  const width = view.getInt32(18, true);
  const height = view.getInt32(22, true);
  return imageDimensions(Math.abs(width), Math.abs(height));
}

function jpegDimensions(view) {
  if (view.byteLength < 4 || view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) return null;
  let offset = 2;
  const limit = Math.min(view.byteLength, MAX_HEADER_SCAN_BYTES);
  while (offset + 4 <= limit) {
    if (view.getUint8(offset) !== 0xff) return null;
    while (offset < limit && view.getUint8(offset) === 0xff) offset += 1;
    if (offset >= limit) return null;
    const marker = view.getUint8(offset++);
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > limit) return null;
    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > limit) return null;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) return null;
      return imageDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(view) {
  if (view.byteLength < 20 || !hasAscii(view, 0, 'RIFF') || !hasAscii(view, 8, 'WEBP')) return null;
  const end = Math.min(view.byteLength, view.getUint32(4, true) + 8, MAX_HEADER_SCAN_BYTES);
  let offset = 12;
  while (offset + 8 <= end) {
    const type = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    const data = offset + 8;
    if (size > end - data) return null;
    if (type === 'VP8X' && size >= 10) {
      const width = 1 + view.getUint8(data + 4) + (view.getUint8(data + 5) << 8) + (view.getUint8(data + 6) << 16);
      const height = 1 + view.getUint8(data + 7) + (view.getUint8(data + 8) << 8) + (view.getUint8(data + 9) << 16);
      return imageDimensions(width, height);
    }
    if (type === 'VP8 ' && size >= 10 && view.getUint8(data + 3) === 0x9d && view.getUint8(data + 4) === 0x01 && view.getUint8(data + 5) === 0x2a) {
      return imageDimensions(view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff);
    }
    if (type === 'VP8L' && size >= 5 && view.getUint8(data) === 0x2f) {
      const b1 = view.getUint8(data + 1); const b2 = view.getUint8(data + 2);
      const b3 = view.getUint8(data + 3); const b4 = view.getUint8(data + 4);
      const width = 1 + b1 + ((b2 & 0x3f) << 8);
      const height = 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10);
      return imageDimensions(width, height);
    }
    offset = data + size + (size & 1);
  }
  return null;
}

function pnmDimensions(view) {
  if (view.byteLength < 4 || view.getUint8(0) !== 0x50) return null;
  const magic = String.fromCharCode(view.getUint8(1));
  if (!'123456'.includes(magic)) return null;
  let offset = 2;
  const limit = Math.min(view.byteLength, MAX_HEADER_SCAN_BYTES);
  const nextToken = () => {
    while (offset < limit) {
      const byte = view.getUint8(offset);
      if (byte === 0x23) { while (offset < limit && view.getUint8(offset) !== 0x0a) offset += 1; }
      else if (byte <= 0x20) offset += 1;
      else break;
    }
    const start = offset;
    while (offset < limit) {
      const byte = view.getUint8(offset);
      if (byte <= 0x20 || byte === 0x23) break;
      offset += 1;
    }
    if (start === offset) return null;
    let value = 0;
    for (let index = start; index < offset; index += 1) {
      const digit = view.getUint8(index) - 0x30;
      if (digit < 0 || digit > 9) return null;
      value = value * 10 + digit;
      if (!Number.isSafeInteger(value)) return null;
    }
    return value > 0 ? value : null;
  };
  const width = nextToken(); const height = nextToken();
  return width && height ? imageDimensions(width, height) : null;
}

function rasterDimensions(view) {
  if (!view) return null;
  return pngDimensions(view) || jpegDimensions(view) || gifDimensions(view) || bmpDimensions(view) || webpDimensions(view) || pnmDimensions(view);
}

/** The source-pixel ceiling enforced by the local Pillow-RS decoder. */
export const MAX_IMAGE_SOURCE_PIXELS = MAX_RENDER_SOURCE_PIXELS;

/** Maximum prefix needed by the supported image-header scanners. */
export const IMAGE_HEADER_SCAN_BYTES = MAX_HEADER_SCAN_BYTES;

/** Read dimensions without asking the browser to decode or allocate image pixels. */
export function inspectRasterDimensions(sourceBytes) {
  return rasterDimensions(bytesView(sourceBytes));
}

/**
 * Verify an image's dimensions before browser decoding. Unknown headers fail closed
 * because compressed size is not a safe estimate of the decoded pixel allocation.
 */
export function assertSafeRasterDimensions(sourceBytes) {
  const dimensions = inspectRasterDimensions(sourceBytes);
  if (!dimensions) {
    throw new Error('Tiny Image Star could not verify this image size before decoding. Use a PNG, JPEG, GIF, BMP, WebP, or PNM image.');
  }
  if (dimensions.pixels > MAX_IMAGE_SOURCE_PIXELS) {
    throw new RangeError(`This image is ${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()} (${dimensions.pixels.toLocaleString()} pixels). The local editor supports images up to ${MAX_IMAGE_SOURCE_PIXELS.toLocaleString()} pixels; resize it before importing.`);
  }
  return dimensions;
}

/**
 * Estimate transient Pillow-RS memory from the source header. Unknown formats
 * receive the decoder's full pixel ceiling and therefore run alone; the
 * compressed byte length is intentionally not treated as a decoded-size proxy.
 */
export function estimateImageWorkingSetBytes(sourceBytes) {
  const dimensions = rasterDimensions(bytesView(sourceBytes));
  const pixels = Math.min(dimensions?.pixels ?? MAX_RENDER_SOURCE_PIXELS, MAX_RENDER_SOURCE_PIXELS);
  return pixels * ACTIVE_BYTES_PER_PIXEL;
}

/** A separate ceiling for live renders; retained decoded sources have their own cache budget. */
export function defaultActiveRenderMemoryBudget({ deviceMemory = globalThis.navigator?.deviceMemory } = {}) {
  const memory = Number(deviceMemory);
  if (Number.isFinite(memory) && memory > 0) {
    if (memory <= 2) return 192 * MIB_BYTES;
    if (memory <= 4) return 320 * MIB_BYTES;
    if (memory <= 8) return 640 * MIB_BYTES;
    return 1024 * MIB_BYTES;
  }
  return 256 * MIB_BYTES;
}

/**
 * Retained decoded images share one engine-wide budget. Prefer a smaller cache
 * on lower-memory devices because Pillow-RS also needs live render copies and
 * output buffers outside this retained-source budget. The 4M/8M/16M pixel
 * tiers are about 16/32/64 MiB at four bytes per pixel; transient render and
 * encoder memory is additional, so this is a retained-cache ceiling, not a
 * total process-memory ceiling.
 */
export function defaultImageCachePixelBudget({
  deviceMemory = globalThis.navigator?.deviceMemory,
  hardwareConcurrency = globalThis.navigator?.hardwareConcurrency,
} = {}) {
  const memory = Number(deviceMemory);
  if (Number.isFinite(memory) && memory > 0) {
    if (memory <= 4) return 4 * MIB_PIXELS;
    if (memory <= 8) return 8 * MIB_PIXELS;
    return DEFAULT_DECODED_SOURCE_PIXEL_BUDGET;
  }
  const cores = Number(hardwareConcurrency);
  if (Number.isFinite(cores) && cores > 0 && cores <= 4) return 4 * MIB_PIXELS;
  return 8 * MIB_PIXELS;
}

export class LocalImageEngine {
  constructor({ maxWorkers = Math.min(8, Math.max(1, globalThis.navigator?.hardwareConcurrency || 4)), maxCachedPixels = defaultImageCachePixelBudget(), maxActiveRenderBytes = defaultActiveRenderMemoryBudget(), onChange = () => {} } = {}) {
    if (!Number.isSafeInteger(maxCachedPixels) || maxCachedPixels < 0) {
      throw new RangeError('The image cache pixel budget must be a nonnegative safe integer.');
    }
    if (!Number.isSafeInteger(maxActiveRenderBytes) || maxActiveRenderBytes < 1) {
      throw new RangeError('The active render memory budget must be a positive safe integer.');
    }
    this.maxWorkers = maxWorkers;
    this.maxCachedPixels = maxCachedPixels;
    this.maxActiveRenderBytes = maxActiveRenderBytes;
    this.activeRenderBytes = 0;
    this.concurrency = Math.min(2, maxWorkers);
    this.workers = [];
    this.queue = [];
    this.queuedByKey = new Map();
    this.pending = new Map();
    this.nextRequestId = 1;
    this.onChange = onChange;
    this.paused = false;
    this.dead = false;
    this.cacheGeneration = 0;
    this.cacheConfigurationPending = new Set();
    this.poolConfigured = true;
  }

  setConcurrency(value) {
    const previousConcurrency = this.concurrency;
    const previousPoolSize = this.workers.length;
    const next = Math.max(1, Math.min(this.maxWorkers, Math.trunc(value) || 1));
    this.concurrency = next;
    while (this.workers.length < next) this.#createWorker();
    if (next !== previousConcurrency || this.workers.length !== previousPoolSize) this.#configureCachePool();
    this.#dispatch();
    this.#notify();
    return next;
  }

  #createWorker() {
    const slot = {
      worker: new Worker(new URL('./image-worker.js', import.meta.url), { type: 'module', name: `tiny-image-star-image-${this.workers.length + 1}` }),
      initialized: false,
      ready: false,
      busy: false,
      failed: false,
      loaded: new Set(),
      cacheGeneration: 0,
      cacheGenerationSent: 0,
      cacheBudget: 0,
    };
    slot.worker.onmessage = event => this.#receive(slot, event.data);
    slot.worker.onerror = event => this.#failWorker(slot, new Error(event.message || 'The local image worker stopped unexpectedly.'));
    this.workers.push(slot);
  }

  #receive(slot, message) {
    if (message.type === 'ready') {
      slot.initialized = true;
      this.#sendCacheConfiguration(slot);
      this.#notify();
      return;
    }
    if (message.type === 'init-error') { this.#failWorker(slot, new Error(message.message)); return; }
    if (message.type === 'cache-config-error') { this.#failWorker(slot, new Error(message.message)); return; }
    if (message.type === 'cache-configured') {
      this.#syncWorkerCache(slot, message);
      if (message.generation !== this.cacheGeneration || slot.failed) return;
      slot.cacheGeneration = message.generation;
      this.cacheConfigurationPending.delete(slot);
      if (this.cacheConfigurationPending.size === 0) {
        this.poolConfigured = true;
        for (const workerSlot of this.workers) {
          workerSlot.ready = !workerSlot.failed && workerSlot.initialized && workerSlot.cacheGeneration === this.cacheGeneration;
        }
        this.#dispatch();
        this.#notify();
      }
      return;
    }
    if (message.type === 'disposed') { slot.loaded.delete(message.assetId); return; }
    this.#syncWorkerCache(slot, message);
    const job = this.pending.get(message.requestId);
    if (!job) return;
    this.pending.delete(message.requestId);
    this.activeRenderBytes = Math.max(0, this.activeRenderBytes - job.activeRenderBytes);
    slot.busy = false;
    if (message.type === 'error') {
      // An error without cache metadata cannot prove that the source remains
      // resident. Forget it so the next retry can recover by resending bytes.
      if (message.sourceRetained === undefined) slot.loaded.delete(job.assetId);
      job.reject(new Error(message.message));
    } else job.resolve(message);
    this.#dispatch();
    this.#notify();
  }

  #failWorker(slot, error) {
    if (slot.failed) return;
    slot.failed = true;
    slot.ready = false;
    slot.loaded.clear();
    slot.worker.terminate();
    const entries = [...this.pending.entries()].filter(([, job]) => job.slot === slot);
    for (const [id, job] of entries) {
      this.pending.delete(id);
      this.activeRenderBytes = Math.max(0, this.activeRenderBytes - job.activeRenderBytes);
      slot.busy = false;
      job.reject(error);
    }
    this.#configureCachePool();
    if (!this.workers.some(workerSlot => !workerSlot.failed)) {
      const queuedError = new Error('All local image workers stopped unexpectedly.');
      for (const job of this.queue.splice(0)) job.reject(queuedError);
    }
    this.#notify();
  }

  render(assetId, sourceBytes, adjustments, transforms = {}, { replaceKey } = {}) {
    if (this.dead) return Promise.reject(new Error('The local image engine is closed.'));
    if (this.workers.length && !this.workers.some(slot => !slot.failed)) {
      return Promise.reject(new Error('All local image workers stopped unexpectedly.'));
    }
    if (replaceKey !== undefined && (typeof replaceKey !== 'string' || !replaceKey)) {
      return Promise.reject(new TypeError('A queued render replacement key must be a nonempty string.'));
    }
    return new Promise((resolve, reject) => {
      const job = {
        assetId,
        sourceBytes,
        activeRenderBytes: estimateImageWorkingSetBytes(sourceBytes),
        adjustments: { ...adjustments },
        transforms: {
          ...transforms,
          ...(transforms?.crop ? { crop: { ...transforms.crop } } : {}),
        },
        resolve,
        reject,
        replaceKey,
      };
      if (replaceKey !== undefined) {
        const previous = this.queuedByKey.get(replaceKey);
        if (previous) this.#removeQueuedJob(previous, new DOMException('A newer image preview replaced this queued render.', 'AbortError'));
        this.queuedByKey.set(replaceKey, job);
      }
      this.queue.push(job);
      if (!this.workers.length) this.setConcurrency(this.concurrency);
      this.#dispatch();
      this.#notify();
    });
  }

  #removeQueuedJob(job, error) {
    const index = this.queue.indexOf(job);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    if (job.replaceKey !== undefined && this.queuedByKey.get(job.replaceKey) === job) this.queuedByKey.delete(job.replaceKey);
    job.reject(error);
    return true;
  }

  /** Remove one not-yet-started render, for example after its layer is deleted. */
  cancelQueuedByKey(replaceKey, error = new DOMException('The image render was cancelled.', 'AbortError')) {
    const job = this.queuedByKey.get(replaceKey);
    if (!job) return false;
    const removed = this.#removeQueuedJob(job, error);
    if (!removed && this.queuedByKey.get(replaceKey) === job) this.queuedByKey.delete(replaceKey);
    if (removed) { this.#dispatch(); this.#notify(); }
    return removed;
  }

  #dispatch() {
    if (this.dead || this.paused || !this.poolConfigured) return;
    const active = this.workers.filter(slot => slot.busy).length;
    if (active >= this.concurrency) return;
    if (!this.queue.length) return;
    const job = this.queue[0];
    // An over-budget job is allowed only when no render is active. This avoids
    // deadlocking a single large image while preventing it from overlapping
    // other large allocations; smaller FIFO jobs wait behind it as well.
    if (this.activeRenderBytes > 0 && this.activeRenderBytes + job.activeRenderBytes > this.maxActiveRenderBytes) return;
    const idle = this.workers.filter(item => item.ready && !item.busy);
    // Keep jobs FIFO, but prefer the worker that already owns this decoded
    // source. An arbitrary free worker would request another byte copy and
    // decode the same original into a second worker-local cache.
    const slot = idle.find(item => item.loaded.has(job.assetId)) || idle[0];
    if (!slot) return;
    this.queue.shift();
    if (job.replaceKey !== undefined && this.queuedByKey.get(job.replaceKey) === job) this.queuedByKey.delete(job.replaceKey);
    const requestId = this.nextRequestId++;
    const firstLoad = !slot.loaded.has(job.assetId);
    const bytes = firstLoad ? job.sourceBytes.slice() : null;
    if (firstLoad) slot.loaded.add(job.assetId);
    slot.busy = true;
    this.activeRenderBytes += job.activeRenderBytes;
    this.pending.set(requestId, { ...job, slot });
    try {
      slot.worker.postMessage({
        type: 'render',
        requestId,
        assetId: job.assetId,
        sourceBytes: bytes?.buffer,
        adjustments: job.adjustments,
        transforms: job.transforms,
      }, bytes ? [bytes.buffer] : []);
    } catch (error) {
      this.pending.delete(requestId);
      slot.busy = false;
      this.activeRenderBytes = Math.max(0, this.activeRenderBytes - job.activeRenderBytes);
      if (firstLoad) slot.loaded.delete(job.assetId);
      job.reject(error);
    }
    this.#dispatch();
  }

  #syncWorkerCache(slot, message) {
    if (Array.isArray(message.evictedAssetIds)) {
      for (const assetId of message.evictedAssetIds) slot.loaded.delete(assetId);
    }
    if (message.assetId == null || typeof message.sourceRetained !== 'boolean') return;
    if (message.sourceRetained) slot.loaded.add(message.assetId);
    else slot.loaded.delete(message.assetId);
  }

  #configureCachePool() {
    const pool = this.workers.filter(slot => !slot.failed);
    const activeCount = Math.min(this.concurrency, pool.length);
    const generation = ++this.cacheGeneration;
    this.poolConfigured = pool.length === 0;
    this.cacheConfigurationPending = new Set(pool);
    for (const slot of this.workers) {
      slot.ready = false;
      slot.cacheGenerationSent = 0;
      slot.cacheGeneration = 0;
      slot.cacheBudget = 0;
    }

    if (activeCount === 0) {
      this.cacheConfigurationPending.clear();
      return;
    }
    const baseBudget = Math.floor(this.maxCachedPixels / activeCount);
    let remainder = this.maxCachedPixels % activeCount;
    for (const [index, slot] of pool.entries()) {
      slot.cacheBudget = index < activeCount ? baseBudget + (remainder-- > 0 ? 1 : 0) : 0;
      if (slot.initialized) this.#sendCacheConfiguration(slot);
    }
  }

  #sendCacheConfiguration(slot) {
    if (slot.failed || !this.cacheConfigurationPending.has(slot) || slot.cacheGenerationSent === this.cacheGeneration) return;
    slot.cacheGenerationSent = this.cacheGeneration;
    slot.worker.postMessage({ type: 'configure-cache', generation: this.cacheGeneration, pixelBudget: slot.cacheBudget });
  }

  pause() { this.paused = true; this.#notify(); }
  resume() { this.paused = false; this.#dispatch(); this.#notify(); }

  cancelQueued(error = new DOMException('The image operation was cancelled.', 'AbortError')) {
    for (const job of this.queue.splice(0)) job.reject(error);
    this.queuedByKey.clear();
    this.#notify();
  }

  dispose(assetId) {
    for (const slot of this.workers) { slot.worker.postMessage({ type: 'dispose', assetId }); slot.loaded.delete(assetId); }
  }

  metrics() {
    return { concurrency: this.concurrency, workersReady: this.workers.filter(item => item.ready).length, active: this.workers.filter(item => item.busy).length, activeRenderBytes: this.activeRenderBytes, maxActiveRenderBytes: this.maxActiveRenderBytes, queued: this.queue.length, paused: this.paused };
  }

  #notify() { this.onChange(this.metrics()); }

  destroy() {
    this.dead = true;
    this.cancelQueued(new Error('The local image engine was closed.'));
    for (const slot of this.workers) slot.worker.terminate();
    for (const job of this.pending.values()) job.reject(new Error('The local image engine was closed.'));
    this.pending.clear(); this.workers.length = 0;
    this.activeRenderBytes = 0;
  }
}
