import { DEFAULT_DECODED_SOURCE_PIXEL_BUDGET } from './decoded-source-cache.js';
import { ImageMemoryLimitError } from './image-memory-budget.js';
import { identifyRasterContainer, inspectJpegMetadata, inspectTiffDimensions, inspectWebpExifOrientation, tiffOrientation } from './raster-preflight.js';

const MIB_PIXELS = 1_000_000;
const MIB_BYTES = 1024 * 1024;
const MAX_RENDER_SOURCE_PIXELS = 80_000_000;
// Let fitting jobs use otherwise idle workers, but stop bypassing any older
// memory-blocked job after a small fixed number of admissions. That bounds
// starvation when the queue contains a steady stream of small images.
const MAX_MEMORY_BLOCKED_JOB_BYPASSES = 3;
// Retry worker crashes a small, fixed number of times per replacement chain.
// If WASM initialization keeps failing, the pool degrades and reports the
// number of ready workers instead of respawning forever.
const MAX_WORKER_RECOVERY_ATTEMPTS = 2;
// Source + mutable Pillow copy + filter/encoder temporaries. This deliberately
// overestimates the common 4-byte-per-pixel path so parallel jobs leave room
// for WASM allocator and PNG output overhead.
const ACTIVE_BYTES_PER_PIXEL = 32;
const MAX_SINGLE_RENDER_WORKING_SET_BYTES = 512 * MIB_BYTES;
const MAX_HEADER_SCAN_BYTES = 1024 * 1024;

function bytesView(sourceBytes) {
  if (sourceBytes instanceof ArrayBuffer) return new DataView(sourceBytes);
  if (ArrayBuffer.isView(sourceBytes)) return new DataView(sourceBytes.buffer, sourceBytes.byteOffset, sourceBytes.byteLength);
  return null;
}

function sameSourceBytes(left, right) {
  const leftBytes = bytesView(left);
  const rightBytes = bytesView(right);
  if (!leftBytes || !rightBytes || leftBytes.byteLength !== rightBytes.byteLength) return false;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    if (leftBytes.getUint8(index) !== rightBytes.getUint8(index)) return false;
  }
  return true;
}

function weakSourceBytes(sourceBytes) {
  return typeof WeakRef === 'function' ? new WeakRef(sourceBytes) : sourceBytes;
}

function dereferenceSourceBytes(reference) {
  return typeof reference?.deref === 'function' ? reference.deref() : reference;
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

function withOrientation(dimensions, orientation, pending = false) {
  if (!dimensions) return null;
  Object.defineProperties(dimensions, {
    orientation: { value: orientation, enumerable: false },
    orientationPending: { value: pending, enumerable: false },
  });
  return dimensions;
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
  const metadata = inspectJpegMetadata(view);
  return metadata && withOrientation(imageDimensions(metadata.width, metadata.height), metadata.orientation);
}

function webpDimensions(view) {
  if (view.byteLength < 20 || !hasAscii(view, 0, 'RIFF') || !hasAscii(view, 8, 'WEBP')) return null;
  const riffEnd = view.getUint32(4, true) + 8;
  const end = Math.min(view.byteLength, riffEnd, MAX_HEADER_SCAN_BYTES);
  let offset = 12;
  while (offset + 8 <= end) {
    const type = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    const data = offset + 8;
    const chunkEnd = data + size + (size & 1);
    if (chunkEnd > riffEnd) return null;
    if (type === 'VP8X' && size >= 10 && data + 10 <= end) {
      const width = 1 + view.getUint8(data + 4) + (view.getUint8(data + 5) << 8) + (view.getUint8(data + 6) << 16);
      const height = 1 + view.getUint8(data + 7) + (view.getUint8(data + 8) << 8) + (view.getUint8(data + 9) << 16);
      const rawDimensions = imageDimensions(width, height);
      const metadata = inspectWebpExifOrientation(view);
      if (metadata.orientation === null && !metadata.pending) return null;
      if (metadata.orientation >= 5) {
        return withOrientation(imageDimensions(height, width), metadata.orientation);
      }
      return withOrientation(rawDimensions, metadata.orientation, metadata.pending);
    }
    if (type === 'VP8 ' && size >= 10 && data + 10 <= end
      && view.getUint8(data + 3) === 0x9d && view.getUint8(data + 4) === 0x01 && view.getUint8(data + 5) === 0x2a) {
      return withOrientation(imageDimensions(view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff), 1);
    }
    if (type === 'VP8L' && size >= 5 && data + 5 <= end && view.getUint8(data) === 0x2f) {
      const b1 = view.getUint8(data + 1); const b2 = view.getUint8(data + 2);
      const b3 = view.getUint8(data + 3); const b4 = view.getUint8(data + 4);
      const width = 1 + b1 + ((b2 & 0x3f) << 8);
      const height = 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10);
      return withOrientation(imageDimensions(width, height), 1);
    }
    if (chunkEnd > end) return null;
    offset = chunkEnd;
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
  const jpeg = jpegDimensions(view);
  if (jpeg) return jpeg;
  const webp = webpDimensions(view);
  if (webp) return webp;
  const tiff = inspectTiffDimensions(view);
  if (tiff) return withOrientation(tiff, tiffOrientation(view));
  return withOrientation(pngDimensions(view) || gifDimensions(view) || bmpDimensions(view) || pnmDimensions(view), 1);
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
    const container = identifyRasterContainer(sourceBytes);
    if (container === 'heif') {
      throw new Error('HEIC/HEIF photos are not supported by the current local Pillow-RS decoder. Export the photo as JPEG or PNG, then import that copy.');
    }
    if (container === 'avif') {
      throw new Error('AVIF images are not supported by the current local Pillow-RS decoder. Export the image as JPEG or PNG, then import that copy.');
    }
    if (container === 'tiff') {
      throw new Error('Tiny Image Star could not verify this TIFF variant safely. Export it as PNG or JPEG, then import that copy.');
    }
    throw new Error('Tiny Image Star could not verify this image size before decoding. Use a PNG, JPEG, GIF, BMP, WebP, TIFF, or PNM image.');
  }
  if (dimensions.pixels > MAX_IMAGE_SOURCE_PIXELS) {
    throw new RangeError(`This image is ${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()} (${dimensions.pixels.toLocaleString()} pixels). The local editor supports images up to ${MAX_IMAGE_SOURCE_PIXELS.toLocaleString()} pixels; resize it before importing.`);
  }
  return dimensions;
}

/**
 * Estimate transient Pillow-RS memory from the source header. Unknown formats
 * receive the decoder's full pixel ceiling and therefore run alone; compressed
 * source bytes are also counted for their transferable worker copy.
 */
export function estimateImageWorkingSetBytes(sourceBytes) {
  const view = bytesView(sourceBytes);
  const dimensions = rasterDimensions(view);
  const pixels = Math.min(dimensions?.pixels ?? MAX_RENDER_SOURCE_PIXELS, MAX_RENDER_SOURCE_PIXELS);
  // Keep room for both the decoded Pillow surfaces and the transferable
  // compressed input copy. The latter is easy to miss for images with large
  // metadata or unusually incompressible data, where pixel dimensions alone
  // would understate the worker's peak memory.
  return pixels * ACTIVE_BYTES_PER_PIXEL + (view?.byteLength || 0);
}

function transferableSourceBytes(sourceBytes) {
  const view = bytesView(sourceBytes);
  if (!view) throw new TypeError('Image source data must be an ArrayBuffer or an ArrayBuffer view.');
  // Normalize DataView, typed-array slices, and SharedArrayBuffer-backed
  // views to a fresh, exact-range transferable ArrayBuffer. Transferring the
  // caller's buffer would detach the retained original used for later edits.
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
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

/** A hard singleton ceiling; unlike the shared budget, this cannot be exceeded by running one job alone. */
export function defaultSingleImageRenderMemoryBudget({ deviceMemory = globalThis.navigator?.deviceMemory } = {}) {
  const memory = Number(deviceMemory);
  if (Number.isFinite(memory) && memory > 0) {
    if (memory <= 2) return 192 * MIB_BYTES;
    if (memory <= 4) return 320 * MIB_BYTES;
  }
  return MAX_SINGLE_RENDER_WORKING_SET_BYTES;
}

/**
 * Retained decoded images share one engine-wide budget. Reported device-memory
 * tiers derive this ceiling from the hard single-render allowance and the
 * conservative 32-byte-per-pixel working-set estimate (roughly 6M/10M/16M
 * pixels, or 24/40/64 MiB at four bytes per retained pixel). The active
 * selection receives the full allowance in one worker; worker concurrency
 * never multiplies it. This remains a cache ceiling, not a total process
 * memory ceiling. Devices that do not report memory keep the smaller
 * hardware-concurrency fallback.
 */
export function defaultImageCachePixelBudget({
  deviceMemory = globalThis.navigator?.deviceMemory,
  hardwareConcurrency = globalThis.navigator?.hardwareConcurrency,
} = {}) {
  const memory = Number(deviceMemory);
  if (Number.isFinite(memory) && memory > 0) {
    // The one-image render ceilings admit up to roughly 6M/10M/16M pixels
    // across these tiers at ACTIVE_BYTES_PER_PIXEL. Give the selected source
    // enough of the shared cache to survive the next adjustment, while keeping
    // the total worker-local cache bounded to a modest fraction of the render
    // ceiling. The active source still gets this one shared allowance in one
    // worker; batch workers never multiply it.
    if (memory <= 2) return Math.floor((192 * MIB_BYTES) / ACTIVE_BYTES_PER_PIXEL);
    if (memory <= 4) return Math.floor((320 * MIB_BYTES) / ACTIVE_BYTES_PER_PIXEL);
    return DEFAULT_DECODED_SOURCE_PIXEL_BUDGET;
  }
  const cores = Number(hardwareConcurrency);
  if (Number.isFinite(cores) && cores > 0 && cores <= 4) return 4 * MIB_PIXELS;
  return 8 * MIB_PIXELS;
}

export class LocalImageEngine {
  constructor({ maxWorkers = Math.min(8, Math.max(1, globalThis.navigator?.hardwareConcurrency || 4)), maxCachedPixels = defaultImageCachePixelBudget(), maxActiveRenderBytes = defaultActiveRenderMemoryBudget(), maxSingleRenderBytes = defaultSingleImageRenderMemoryBudget(), lazyWorkers = false, onChange = () => {} } = {}) {
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1) {
      throw new RangeError('The image worker limit must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(maxCachedPixels) || maxCachedPixels < 0) {
      throw new RangeError('The image cache pixel budget must be a nonnegative safe integer.');
    }
    if (!Number.isSafeInteger(maxActiveRenderBytes) || maxActiveRenderBytes < 1) {
      throw new RangeError('The active render memory budget must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(maxSingleRenderBytes) || maxSingleRenderBytes < 1) {
      throw new RangeError('The maximum single-image render memory limit must be a positive safe integer.');
    }
    this.maxWorkers = maxWorkers;
    this.maxCachedPixels = maxCachedPixels;
    this.maxActiveRenderBytes = maxActiveRenderBytes;
    this.maxSingleRenderBytes = maxSingleRenderBytes;
    this.lazyWorkers = Boolean(lazyWorkers);
    this.activeRenderBytes = 0;
    this.externalCpuReservations = 0;
    this.concurrency = Math.min(2, maxWorkers);
    this.workers = [];
    this.queue = [];
    this.queueHead = 0;
    this.queuedCount = 0;
    this.queueTombstones = 0;
    this.queuedByGroup = new Map();
    this.queuedByKey = new Map();
    this.pausedQueueGroups = new Set();
    this.exhaustedQueueGroups = new Set();
    this.pending = new Map();
    this.nextRequestId = 1;
    // A worker cache is keyed by asset ID, so retain a weak reference to the
    // exact source object sent for that ID. If a caller replaces an asset's
    // bytes, equal copies may keep the decode; changed bytes must invalidate
    // every worker before the next job can reuse that cache entry.
    this.sourceBytesByAssetId = new Map();
    this.onChange = onChange;
    this.paused = false;
    this.dead = false;
    this.cacheGeneration = 0;
    this.cacheConfigurationPending = new Set();
    this.poolConfigured = true;
    this.cachePoolReconfigurePending = false;
    this.workerPoolTarget = 0;
    this.workerRecoverySuppressed = false;
    this.activeSourceAssetId = null;
    // The selected image gets one worker-local cache with the complete shared
    // cache allowance. Splitting the allowance evenly across a large worker
    // pool can make a perfectly ordinary camera image uncacheable and force a
    // full decode on every slider update.
    this.activeSourceSlot = null;
  }

  setConcurrency(value) {
    const previousConcurrency = this.concurrency;
    const previousPoolSize = this.workers.length;
    const next = Math.max(1, Math.min(this.maxWorkers, Math.trunc(value) || 1));
    this.concurrency = next;
    if (!this.lazyWorkers) while (this.workers.length < next) this.#createWorker();
    this.#retireExcessWorkers();
    if (next !== previousConcurrency || this.workers.length !== previousPoolSize) {
      if (this.lazyWorkers) this.#reconfigureCachePoolWhenIdle();
      else this.#configureCachePool();
    }
    this.#dispatch();
    this.#notify();
    return next;
  }

  /** Temporarily reserve whole-device CPU slots for other local workers. */
  setExternalCpuReservations(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('External CPU reservations must be a nonnegative safe integer.');
    }
    const next = Math.min(this.maxWorkers, value);
    if (next === this.externalCpuReservations) return this.activeWorkerLimit;
    this.externalCpuReservations = next;
    this.#dispatch();
    this.#notify();
    return this.activeWorkerLimit;
  }

  get activeWorkerLimit() {
    return Math.max(0, this.concurrency - this.externalCpuReservations);
  }

  #createWorker(recoveryAttempts = 0) {
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
      retireWhenIdle: false,
      recoveryAttempts,
    };
    slot.worker.onmessage = event => this.#receive(slot, event.data);
    slot.worker.onerror = event => this.#failWorker(slot, new Error(event.message || 'The local image worker stopped unexpectedly.'));
    this.workers.push(slot);
    return slot;
  }

  #reconfigureCachePoolWhenIdle() {
    if (this.workers.some(slot => slot.busy)) {
      this.cachePoolReconfigurePending = true;
      return false;
    }
    this.cachePoolReconfigurePending = false;
    if (this.workers.length) this.#configureCachePool();
    else {
      this.poolConfigured = true;
      this.cacheConfigurationPending.clear();
    }
    return true;
  }

  /** Keep the currently edited source resident when it fits the worker cache budget. */
  setActiveSource(assetId = null) {
    if (assetId !== null && (typeof assetId !== 'string' || !assetId)) {
      throw new TypeError('An active image source needs an asset ID or null.');
    }
    if (this.activeSourceAssetId === assetId) return;
    this.activeSourceAssetId = assetId;
    for (const slot of this.workers) this.#sendActiveSource(slot);
    const pool = this.workers.filter(slot => !slot.failed && !slot.retireWhenIdle);
    this.activeSourceSlot = assetId == null
      ? null
      : pool.find(slot => slot.loaded.has(assetId)) || pool[0] || null;
    if (this.lazyWorkers) this.#reconfigureCachePoolWhenIdle();
    else this.#configureCachePool();
    this.#dispatch();
  }

  #sendActiveSource(slot) {
    if (!slot.failed) slot.worker.postMessage({ type: 'set-active-source', assetId: this.activeSourceAssetId });
  }

  #receive(slot, message) {
    if (message.type === 'ready') {
      slot.initialized = true;
      this.#sendActiveSource(slot);
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
    if (this.lazyWorkers && this.pending.size === 0 && this.queuedCount === 0) {
      this.workerPoolTarget = 0;
      this.workerRecoverySuppressed = false;
    }
    const previousPoolSize = this.workers.length;
    this.#retireExcessWorkers();
    if (this.lazyWorkers) {
      if (this.cachePoolReconfigurePending || (previousPoolSize !== this.workers.length && !this.workers.some(workerSlot => workerSlot.busy))) {
        this.#reconfigureCachePoolWhenIdle();
      }
    }
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
    const failedQueueGroups = new Set(entries.map(([, job]) => job.queueGroup).filter(Boolean));
    for (const [id, job] of entries) {
      this.pending.delete(id);
      this.activeRenderBytes = Math.max(0, this.activeRenderBytes - job.activeRenderBytes);
      slot.busy = false;
      job.reject(error);
    }
    const previousPoolSize = this.workers.length;
    this.#retireExcessWorkers();
    const availableWorkers = this.workers.filter(workerSlot => !workerSlot.failed && !workerSlot.retireWhenIdle).length;
    if (this.lazyWorkers) {
      const busyWorkers = this.workers.filter(workerSlot => workerSlot.busy).length;
      const pendingDemand = this.#plannedQueueDemand(Math.max(0, this.activeWorkerLimit - busyWorkers));
      this.workerPoolTarget = busyWorkers + pendingDemand;
      if (!this.dead && availableWorkers < this.workerPoolTarget) {
        if (slot.recoveryAttempts < MAX_WORKER_RECOVERY_ATTEMPTS) {
          this.#addWorkerCapacity(this.workerPoolTarget, slot.recoveryAttempts + 1);
        } else this.workerRecoverySuppressed = true;
      }
      if (this.cachePoolReconfigurePending || (previousPoolSize !== this.workers.length && !this.workers.some(workerSlot => workerSlot.busy))) {
        this.#reconfigureCachePoolWhenIdle();
      } else if (!this.workers.some(workerSlot => workerSlot.busy) && !this.cacheConfigurationPending.size) {
        this.#reconfigureCachePoolWhenIdle();
      }
    } else {
      if (!this.dead && availableWorkers < this.concurrency
        && slot.recoveryAttempts < MAX_WORKER_RECOVERY_ATTEMPTS) this.#createWorker(slot.recoveryAttempts + 1);
      this.#configureCachePool();
    }
    const schedulableWorkers = this.workers.filter(workerSlot => !workerSlot.failed && !workerSlot.retireWhenIdle).length;
    if (schedulableWorkers === 0) {
      const queuedError = new Error('All local image workers stopped unexpectedly.');
      const queued = this.queue.filter(Boolean);
      this.queue = [];
      this.queueHead = 0;
      this.queuedCount = 0;
      this.queueTombstones = 0;
      this.queuedByGroup.clear();
      for (const job of queued) {
        if (job.queueGroup) failedQueueGroups.add(job.queueGroup);
      }
      for (const queueGroup of failedQueueGroups) {
        this.exhaustedQueueGroups.add(queueGroup);
        this.pausedQueueGroups.delete(queueGroup);
      }
      for (const job of queued) {
        if (job.replaceKey !== undefined && this.queuedByKey.get(job.replaceKey) === job) {
          this.queuedByKey.delete(job.replaceKey);
        }
        job.reject(queuedError);
      }
    }
    this.#notify();
  }

  render(assetId, sourceBytes, adjustments, transforms = {}, options = {}) {
    return this.#enqueueRender(assetId, sourceBytes, adjustments, transforms, options, 'preview');
  }

  /** Render the recipe into its requested standalone PNG/JPEG/WebP encoding. */
  renderOutput(assetId, sourceBytes, adjustments, transforms = {}, options = {}) {
    return this.#enqueueRender(assetId, sourceBytes, adjustments, transforms, options, 'export');
  }

  #enqueueRender(assetId, sourceBytes, adjustments, transforms, { replaceKey, format = 'png', quality = 90, queueGroup = null, previewMaxDimension } = {}, outputMode) {
    if (this.dead) return Promise.reject(new Error('The local image engine is closed.'));
    if (replaceKey !== undefined && (typeof replaceKey !== 'string' || !replaceKey)) {
      return Promise.reject(new TypeError('A queued render replacement key must be a nonempty string.'));
    }
    if (queueGroup !== null && (typeof queueGroup !== 'string' || !queueGroup)) {
      return Promise.reject(new TypeError('A queued render group must be a nonempty string or null.'));
    }
    if (!['png', 'jpeg', 'webp'].includes(format)) return Promise.reject(new TypeError('Image output format must be PNG, JPEG, or WebP.'));
    if (!Number.isInteger(quality) || quality < 1 || quality > 100) return Promise.reject(new TypeError('Image output quality must be an integer from 1 to 100.'));
    if (previewMaxDimension !== undefined && (!Number.isSafeInteger(previewMaxDimension) || previewMaxDimension < 1 || previewMaxDimension > 16_384)) {
      return Promise.reject(new TypeError('An interactive preview dimension cap must be a positive safe integer no greater than 16384.'));
    }
    if (queueGroup && this.exhaustedQueueGroups.has(queueGroup)) {
      return Promise.reject(new Error('All local image workers stopped unexpectedly. Start a new batch to retry.'));
    }
    if (this.workers.length && !this.workers.some(slot => !slot.failed)) {
      return Promise.reject(new Error('All local image workers stopped unexpectedly.'));
    }
    let activeRenderBytes;
    try {
      if (!bytesView(sourceBytes)) throw new TypeError('Image source data must be an ArrayBuffer or an ArrayBuffer view.');
      activeRenderBytes = estimateImageWorkingSetBytes(sourceBytes);
    } catch (error) {
      return Promise.reject(error);
    }
    if (activeRenderBytes > this.maxSingleRenderBytes) {
      const needed = Math.ceil(activeRenderBytes / MIB_BYTES);
      const limit = Math.floor(this.maxSingleRenderBytes / MIB_BYTES);
      return Promise.reject(new ImageMemoryLimitError(
        `This image needs an estimated ${needed} MiB of temporary Pillow-RS memory, above the ${limit} MiB per-image processing limit. Resize the image before applying edits.`,
        'wasm-working-set',
      ));
    }
    const previousReference = this.sourceBytesByAssetId.get(assetId);
    if (previousReference) {
      const previousSourceBytes = dereferenceSourceBytes(previousReference);
      if (!previousSourceBytes || !sameSourceBytes(previousSourceBytes, sourceBytes)) this.dispose(assetId);
    }
    this.sourceBytesByAssetId.set(assetId, weakSourceBytes(sourceBytes));
    return new Promise((resolve, reject) => {
      const job = {
        assetId,
        sourceBytes,
        activeRenderBytes,
        adjustments: { ...adjustments },
        transforms: {
          ...transforms,
          ...(transforms?.crop ? { crop: { ...transforms.crop } } : {}),
        },
        format,
        quality,
        outputMode,
        previewMaxDimension: outputMode === 'preview' ? previewMaxDimension : undefined,
        resolve,
        reject,
        replaceKey,
        queueGroup,
      };
      if (replaceKey !== undefined) {
        const previous = this.queuedByKey.get(replaceKey);
        if (previous) this.#removeQueuedJob(previous, new DOMException('A newer image preview replaced this queued render.', 'AbortError'));
        this.queuedByKey.set(replaceKey, job);
      }
      this.queue.push(job);
      this.queuedCount += 1;
      if (queueGroup !== null) this.queuedByGroup.set(queueGroup, (this.queuedByGroup.get(queueGroup) || 0) + 1);
      if (this.lazyWorkers && this.queuedCount === 1 && this.pending.size === 0) {
        this.workerPoolTarget = 0;
        this.workerRecoverySuppressed = false;
      }
      if (!this.workers.length && !this.lazyWorkers) this.setConcurrency(this.concurrency);
      this.#dispatch();
      this.#notify();
    });
  }

  #removeQueuedJob(job, error) {
    const index = this.queue.indexOf(job, this.queueHead);
    if (index < 0) return false;
    this.#removeQueueAt(index);
    if (job.replaceKey !== undefined && this.queuedByKey.get(job.replaceKey) === job) this.queuedByKey.delete(job.replaceKey);
    job.reject(error);
    return true;
  }

  #removeQueueAt(index) {
    const removed = this.queue[index];
    if (removed == null) return false;
    this.queue[index] = null;
    this.queuedCount -= 1;
    if (removed.queueGroup !== null) {
      const groupCount = this.queuedByGroup.get(removed.queueGroup) || 0;
      if (groupCount <= 1) this.queuedByGroup.delete(removed.queueGroup);
      else this.queuedByGroup.set(removed.queueGroup, groupCount - 1);
    }
    this.queueTombstones += 1;
    while (this.queueHead < this.queue.length && this.queue[this.queueHead] == null) this.queueHead += 1;
    if (this.queuedCount === 0) {
      this.queue = [];
      this.queueHead = 0;
      this.queueTombstones = 0;
    } else if (this.queueTombstones >= 1024 && this.queueTombstones * 2 >= this.queue.length) {
      this.queue = this.queue.slice(this.queueHead).filter(Boolean);
      this.queueHead = 0;
      this.queueTombstones = 0;
    }
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

  /** Drop every not-yet-started render that still owns a disposed source buffer. */
  cancelQueuedByAsset(assetId, error = new DOMException('The source image was disposed.', 'AbortError')) {
    if (typeof assetId !== 'string' || !assetId) throw new TypeError('A disposed image needs a nonempty asset ID.');
    const survivors = [];
    let cancelled = 0;
    for (let index = this.queueHead; index < this.queue.length; index += 1) {
      const job = this.queue[index];
      if (!job) continue;
      if (job.assetId !== assetId) {
        survivors.push(job);
        continue;
      }
      this.queuedCount -= 1;
      if (job.queueGroup !== null) {
        const groupCount = this.queuedByGroup.get(job.queueGroup) || 0;
        if (groupCount <= 1) this.queuedByGroup.delete(job.queueGroup);
        else this.queuedByGroup.set(job.queueGroup, groupCount - 1);
      }
      if (job.replaceKey !== undefined && this.queuedByKey.get(job.replaceKey) === job) this.queuedByKey.delete(job.replaceKey);
      job.reject(error);
      cancelled += 1;
    }
    if (!cancelled) return 0;
    this.queue = survivors;
    this.queueHead = 0;
    this.queueTombstones = 0;
    this.#dispatch();
    this.#notify();
    return cancelled;
  }

  #plannedQueueDemand(maxJobs) {
    if (maxJobs <= 0 || this.queuedCount === 0) return 0;
    let simulatedBytes = this.activeRenderBytes;
    // A decoded source belongs to one worker. The dispatcher will wait for
    // that worker to become idle instead of decoding the same source in a
    // second slot, so queued edits for a source with a busy owner are not
    // worker demand yet.
    const simulatedBusyAssetIds = new Set(this.workers
      .filter(slot => slot.busy)
      .flatMap(slot => [...slot.loaded]));
    let simulatedActiveSourceBusy = this.activeSourceAssetId == null
      ? false
      : Boolean((this.workers.find(item => !item.failed && item.loaded.has(this.activeSourceAssetId)) || this.activeSourceSlot)?.busy);
    let count = 0;
    const selectedIndices = new Set();
    const simulatedBypasses = new Map();

    while (count < maxJobs) {
      let selectedIndex = -1;
      let selectedJob = null;
      const memoryBlocked = [];
      for (let index = this.queueHead; index < this.queue.length; index += 1) {
        const candidate = this.queue[index];
        if (candidate == null || selectedIndices.has(index)) continue;
        if (candidate.queueGroup !== null && this.pausedQueueGroups.has(candidate.queueGroup)) continue;
        if (simulatedBusyAssetIds.has(candidate.assetId)) continue;
        if (candidate.assetId === this.activeSourceAssetId && simulatedActiveSourceBusy) continue;
        if (simulatedBytes !== 0 && simulatedBytes + candidate.activeRenderBytes > this.maxActiveRenderBytes) {
          memoryBlocked.push(index);
          continue;
        }
        if (memoryBlocked.some(indexOfBlocked => {
          const blocked = this.queue[indexOfBlocked];
          return blocked && (blocked.memoryBypasses || 0) + (simulatedBypasses.get(indexOfBlocked) || 0) >= MAX_MEMORY_BLOCKED_JOB_BYPASSES;
        })) return count;
        selectedIndex = index;
        selectedJob = candidate;
        break;
      }
      if (!selectedJob) return count;
      count += 1;
      selectedIndices.add(selectedIndex);
      simulatedBusyAssetIds.add(selectedJob.assetId);
      simulatedBytes += selectedJob.activeRenderBytes;
      if (selectedJob.assetId === this.activeSourceAssetId) simulatedActiveSourceBusy = true;
      for (const indexOfBlocked of memoryBlocked) {
        simulatedBypasses.set(indexOfBlocked, (simulatedBypasses.get(indexOfBlocked) || 0) + 1);
      }
    }
    return count;
  }

  #addWorkerCapacity(targetCount, recoveryAttempts = 0) {
    const pool = this.workers.filter(slot => !slot.failed && !slot.retireWhenIdle);
    const missing = Math.max(0, targetCount - pool.length);
    if (!missing) return false;
    const hasBusyWorkers = pool.some(slot => slot.busy);
    const additions = [];
    let unallocatedCachePixels = this.activeSourceAssetId == null
      ? Math.max(0, this.maxCachedPixels - pool.reduce((sum, slot) => sum + slot.cacheBudget, 0))
      : 0;
    for (let index = 0; index < missing; index += 1) {
      const slot = this.#createWorker(recoveryAttempts);
      additions.push(slot);
      if (hasBusyWorkers) {
        const remaining = missing - index;
        slot.cacheBudget = Math.floor(unallocatedCachePixels / remaining);
        unallocatedCachePixels -= slot.cacheBudget;
        this.cacheConfigurationPending.add(slot);
      }
    }
    if (hasBusyWorkers) this.poolConfigured = false;
    else this.#configureCachePool();
    return true;
  }

  #dispatch() {
    if (this.dead || this.paused) return;
    if (this.lazyWorkers && this.cachePoolReconfigurePending && !this.workers.some(slot => slot.busy)) this.#reconfigureCachePoolWhenIdle();
    const active = this.workers.filter(slot => slot.busy).length;
    if (active >= this.activeWorkerLimit) return;
    if (this.queuedCount === 0) return;
    if (this.lazyWorkers) {
      const demand = this.#plannedQueueDemand(this.activeWorkerLimit - active);
      if (demand === 0) return;
      const desiredPoolSize = active + demand;
      this.workerPoolTarget = desiredPoolSize;
      const schedulableCount = this.workers.filter(slot => !slot.failed && !slot.retireWhenIdle).length;
      if (!this.workerRecoverySuppressed && schedulableCount < desiredPoolSize) this.#addWorkerCapacity(desiredPoolSize);
    } else if (!this.poolConfigured) return;
    const idle = this.workers.filter(item => item.ready && !item.busy && !item.retireWhenIdle);
    if (!idle.length) return;
    // A job may exceed the shared concurrency budget only when alone. Every
    // job has already passed the non-overridable per-image hard ceiling. If
    // the queue head cannot fit beside active work, let the first fitting job
    // use an idle worker unless an older blocked job has reached its bounded
    // bypass allowance. This prevents mixed-size queues from leaving capacity
    // idle while preserving a finite wait for large images.
    const fitsAvailableMemory = job => this.activeRenderBytes === 0
      || this.activeRenderBytes + job.activeRenderBytes <= this.maxActiveRenderBytes;
    // A paused queue group remains in place for resume, but must not block
    // unrelated work. Keep original queue indices so FIFO ordering is
    // preserved among all jobs eligible to run at this moment.
    // Scan only through the first admissible job. Most recipe workloads have
    // a fitting FIFO head, so building mapped and filtered copies of the full
    // queue here turns each completed image into work proportional to the
    // remaining batch size (quadratic total queue bookkeeping).
    let queueIndex = -1;
    let job;
    let affinitySlot = null;
    let blockedJobs = null;
    for (let index = this.queueHead; index < this.queue.length; index += 1) {
      const candidate = this.queue[index];
      if (candidate == null) continue;
      if (candidate.queueGroup !== null && this.pausedQueueGroups.has(candidate.queueGroup)) continue;
      if (!fitsAvailableMemory(candidate)) {
        (blockedJobs ||= []).push(candidate);
        continue;
      }
      const sourceOwner = candidate.assetId === this.activeSourceAssetId
        ? this.workers.find(item => !item.failed && item.loaded.has(candidate.assetId))
        : null;
      const preferred = sourceOwner || (candidate.assetId === this.activeSourceAssetId ? this.activeSourceSlot : null);
      if (preferred?.busy) continue;
      affinitySlot = preferred;
      queueIndex = index;
      job = candidate;
      break;
    }
    if (queueIndex < 0) return;
    if (blockedJobs) {
      if (blockedJobs.some(job => (job.memoryBypasses || 0) >= MAX_MEMORY_BLOCKED_JOB_BYPASSES)) return;
    }
    // Keep jobs FIFO, but prefer the worker that already owns this decoded
    // source. An arbitrary free worker would request another byte copy and
    // decode the same original into a second worker-local cache.
    const slot = affinitySlot || idle.find(item => item.loaded.has(job.assetId)) || idle[0];
    if (!slot) return;
    this.#removeQueueAt(queueIndex);
    if (job.replaceKey !== undefined && this.queuedByKey.get(job.replaceKey) === job) this.queuedByKey.delete(job.replaceKey);
    const requestId = this.nextRequestId++;
    const firstLoad = !slot.loaded.has(job.assetId);
    // A retained preview source can be downsampled to fit a constrained cache.
    // Exports still need the immutable original bytes even when that preview is
    // already resident in this worker.
    const sendSourceBytes = firstLoad || job.outputMode === 'export';
    let bytes = null;
    if (sendSourceBytes) {
      try {
        bytes = transferableSourceBytes(job.sourceBytes);
      } catch (error) {
        job.reject(error);
        this.#dispatch();
        return;
      }
    }
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
        format: job.format,
        quality: job.quality,
        outputMode: job.outputMode,
        ...(job.previewMaxDimension === undefined ? {} : { previewMaxDimension: job.previewMaxDimension }),
      }, bytes ? [bytes.buffer] : []);
      if (blockedJobs) {
        for (const blockedJob of blockedJobs) blockedJob.memoryBypasses = (blockedJob.memoryBypasses || 0) + 1;
      }
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
    const pool = this.workers.filter(slot => !slot.failed && !slot.retireWhenIdle);
    const activeCount = Math.min(this.concurrency, pool.length);
    if (this.activeSourceAssetId != null && (!this.activeSourceSlot || !pool.includes(this.activeSourceSlot))) {
      this.activeSourceSlot = pool.find(slot => slot.loaded.has(this.activeSourceAssetId)) || pool[0] || null;
    }
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
      if (this.activeSourceAssetId != null) {
        slot.cacheBudget = slot === this.activeSourceSlot ? this.maxCachedPixels : 0;
      } else {
        slot.cacheBudget = index < activeCount ? baseBudget + (remainder-- > 0 ? 1 : 0) : 0;
      }
      if (slot.initialized) this.#sendCacheConfiguration(slot);
    }
  }

  #sendCacheConfiguration(slot) {
    if (slot.failed || !this.cacheConfigurationPending.has(slot) || slot.cacheGenerationSent === this.cacheGeneration) return;
    slot.cacheGenerationSent = this.cacheGeneration;
    slot.worker.postMessage({ type: 'configure-cache', generation: this.cacheGeneration, pixelBudget: slot.cacheBudget });
  }

  #retireExcessWorkers() {
    let retired = false;
    let retained = 0;
    for (const slot of [...this.workers]) {
      if (!slot.failed && retained < this.concurrency) {
        slot.retireWhenIdle = false;
        retained += 1;
        continue;
      }
      if (slot.busy) {
        slot.retireWhenIdle = true;
        continue;
      }
      slot.retireWhenIdle = true;
      slot.ready = false;
      slot.loaded.clear();
      slot.worker.terminate();
      this.cacheConfigurationPending.delete(slot);
      const index = this.workers.indexOf(slot);
      if (index >= 0) this.workers.splice(index, 1);
      retired = true;
    }
    if (this.cacheConfigurationPending.size === 0 && !this.poolConfigured) {
      this.poolConfigured = true;
      for (const slot of this.workers) {
        slot.ready = !slot.failed && slot.initialized && slot.cacheGeneration === this.cacheGeneration;
      }
    }
    return retired;
  }

  pause() { this.paused = true; this.#notify(); }
  resume() { this.paused = false; this.#dispatch(); this.#notify(); }

  /** Hold queued jobs in one group while allowing active and unrelated jobs to drain. */
  pauseQueueGroup(queueGroup) {
    if (typeof queueGroup !== 'string' || !queueGroup) throw new TypeError('A paused render group must be a nonempty string.');
    if (this.pausedQueueGroups.has(queueGroup)) return false;
    this.pausedQueueGroups.add(queueGroup);
    this.#notify();
    return true;
  }

  /** Resume one held group, preserving its original queue order. */
  resumeQueueGroup(queueGroup) {
    if (typeof queueGroup !== 'string' || !queueGroup) throw new TypeError('A resumed render group must be a nonempty string.');
    if (!this.pausedQueueGroups.delete(queueGroup)) return false;
    this.#dispatch();
    this.#notify();
    return true;
  }

  /** Release per-run failure state after a batch has fully drained. */
  releaseQueueGroup(queueGroup) {
    if (typeof queueGroup !== 'string' || !queueGroup) throw new TypeError('A released render group must be a nonempty string.');
    const wasPaused = this.pausedQueueGroups.delete(queueGroup);
    const wasExhausted = this.exhaustedQueueGroups.delete(queueGroup);
    const changed = wasPaused || wasExhausted;
    if (changed) this.#notify();
    return changed;
  }

  cancelQueued(error = new DOMException('The image operation was cancelled.', 'AbortError')) {
    for (const job of this.queue) job?.reject(error);
    this.queue = [];
    this.queueHead = 0;
    this.queuedCount = 0;
    this.queueTombstones = 0;
    this.queuedByGroup.clear();
    this.queuedByKey.clear();
    this.#notify();
  }

  dispose(assetId) {
    if (typeof assetId !== 'string' || !assetId) throw new TypeError('A disposed image needs a nonempty asset ID.');
    this.sourceBytesByAssetId.delete(assetId);
    for (const slot of this.workers) { slot.worker.postMessage({ type: 'dispose', assetId }); slot.loaded.delete(assetId); }
    this.cancelQueuedByAsset(assetId);
  }

  metrics() {
    return { concurrency: this.concurrency, workersReady: this.workers.filter(item => item.ready).length, active: this.workers.filter(item => item.busy).length, activeRenderBytes: this.activeRenderBytes, maxActiveRenderBytes: this.maxActiveRenderBytes, queued: this.queuedCount, paused: this.paused };
  }

  queueGroupMetrics(queueGroup) {
    if (typeof queueGroup !== 'string' || !queueGroup) throw new TypeError('A queue group needs a nonempty ID.');
    return {
      active: [...this.pending.values()].filter(job => job.queueGroup === queueGroup).length,
      queued: this.queuedByGroup.get(queueGroup) || 0,
    };
  }

  #notify() { this.onChange(this.metrics()); }

  destroy() {
    this.dead = true;
    this.cancelQueued(new Error('The local image engine was closed.'));
    this.pausedQueueGroups.clear();
    this.exhaustedQueueGroups.clear();
    for (const slot of this.workers) slot.worker.terminate();
    for (const job of this.pending.values()) job.reject(new Error('The local image engine was closed.'));
    this.pending.clear(); this.workers.length = 0;
    this.sourceBytesByAssetId.clear();
    this.activeRenderBytes = 0;
  }
}
