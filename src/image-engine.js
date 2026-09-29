import { DEFAULT_DECODED_SOURCE_PIXEL_BUDGET } from './decoded-source-cache.js';

const MIB_PIXELS = 1_000_000;

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
  constructor({ maxWorkers = Math.min(8, Math.max(1, globalThis.navigator?.hardwareConcurrency || 4)), maxCachedPixels = defaultImageCachePixelBudget(), onChange = () => {} } = {}) {
    if (!Number.isSafeInteger(maxCachedPixels) || maxCachedPixels < 0) {
      throw new RangeError('The image cache pixel budget must be a nonnegative safe integer.');
    }
    this.maxWorkers = maxWorkers;
    this.maxCachedPixels = maxCachedPixels;
    this.concurrency = Math.min(2, maxWorkers);
    this.workers = [];
    this.queue = [];
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
    for (const [id, job] of entries) { this.pending.delete(id); slot.busy = false; job.reject(error); }
    this.#configureCachePool();
    if (!this.workers.some(workerSlot => !workerSlot.failed)) {
      const queuedError = new Error('All local image workers stopped unexpectedly.');
      for (const job of this.queue.splice(0)) job.reject(queuedError);
    }
    this.#notify();
  }

  render(assetId, sourceBytes, adjustments) {
    if (this.dead) return Promise.reject(new Error('The local image engine is closed.'));
    if (this.workers.length && !this.workers.some(slot => !slot.failed)) {
      return Promise.reject(new Error('All local image workers stopped unexpectedly.'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ assetId, sourceBytes, adjustments: { ...adjustments }, resolve, reject });
      if (!this.workers.length) this.setConcurrency(this.concurrency);
      this.#dispatch();
      this.#notify();
    });
  }

  #dispatch() {
    if (this.dead || this.paused || !this.poolConfigured) return;
    const active = this.workers.filter(slot => slot.busy).length;
    if (active >= this.concurrency) return;
    const slot = this.workers.find(item => item.ready && !item.busy);
    if (!slot || !this.queue.length) return;
    const job = this.queue.shift();
    const requestId = this.nextRequestId++;
    const firstLoad = !slot.loaded.has(job.assetId);
    const bytes = firstLoad ? job.sourceBytes.slice() : null;
    if (firstLoad) slot.loaded.add(job.assetId);
    slot.busy = true;
    this.pending.set(requestId, { ...job, slot });
    slot.worker.postMessage({ type: 'render', requestId, assetId: job.assetId, sourceBytes: bytes?.buffer, adjustments: job.adjustments }, bytes ? [bytes.buffer] : []);
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
    this.#notify();
  }

  dispose(assetId) {
    for (const slot of this.workers) { slot.worker.postMessage({ type: 'dispose', assetId }); slot.loaded.delete(assetId); }
  }

  metrics() {
    return { concurrency: this.concurrency, workersReady: this.workers.filter(item => item.ready).length, active: this.workers.filter(item => item.busy).length, queued: this.queue.length, paused: this.paused };
  }

  #notify() { this.onChange(this.metrics()); }

  destroy() {
    this.dead = true;
    this.cancelQueued(new Error('The local image engine was closed.'));
    for (const slot of this.workers) slot.worker.terminate();
    for (const job of this.pending.values()) job.reject(new Error('The local image engine was closed.'));
    this.pending.clear(); this.workers.length = 0;
  }
}
