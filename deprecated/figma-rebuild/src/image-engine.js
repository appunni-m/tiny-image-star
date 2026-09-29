export class LocalImageEngine {
  constructor({ maxWorkers = Math.min(8, Math.max(1, globalThis.navigator?.hardwareConcurrency || 4)), onChange = () => {} } = {}) {
    this.maxWorkers = maxWorkers;
    this.concurrency = Math.min(2, maxWorkers);
    this.workers = [];
    this.queue = [];
    this.pending = new Map();
    this.nextRequestId = 1;
    this.onChange = onChange;
    this.paused = false;
    this.dead = false;
  }

  setConcurrency(value) {
    const next = Math.max(1, Math.min(this.maxWorkers, Math.trunc(value) || 1));
    this.concurrency = next;
    while (this.workers.length < next) this.#createWorker();
    this.#dispatch();
    this.#notify();
    return next;
  }

  #createWorker() {
    const slot = { worker: new Worker(new URL('./image-worker.js', import.meta.url), { type: 'module', name: `figma-local-image-${this.workers.length + 1}` }), ready: false, busy: false, loaded: new Set() };
    slot.worker.onmessage = event => this.#receive(slot, event.data);
    slot.worker.onerror = event => this.#failWorker(slot, new Error(event.message || 'The local image worker stopped unexpectedly.'));
    this.workers.push(slot);
  }

  #receive(slot, message) {
    if (message.type === 'ready') { slot.ready = true; this.#dispatch(); this.#notify(); return; }
    if (message.type === 'init-error') { this.#failWorker(slot, new Error(message.message)); return; }
    const job = this.pending.get(message.requestId);
    if (!job) return;
    this.pending.delete(message.requestId);
    slot.busy = false;
    if (message.type === 'error') {
      if (job.firstLoad) slot.loaded.delete(job.assetId);
      job.reject(new Error(message.message));
    } else job.resolve(message);
    this.#dispatch();
    this.#notify();
  }

  #failWorker(slot, error) {
    slot.ready = false;
    const entries = [...this.pending.entries()].filter(([, job]) => job.slot === slot);
    for (const [id, job] of entries) { this.pending.delete(id); slot.busy = false; job.reject(error); }
    this.#notify();
  }

  render(assetId, sourceBytes, adjustments) {
    if (this.dead) return Promise.reject(new Error('The local image engine is closed.'));
    return new Promise((resolve, reject) => {
      this.queue.push({ assetId, sourceBytes, adjustments: { ...adjustments }, resolve, reject });
      if (!this.workers.length) this.setConcurrency(this.concurrency);
      this.#dispatch();
      this.#notify();
    });
  }

  #dispatch() {
    if (this.dead || this.paused) return;
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
    this.pending.set(requestId, { ...job, slot, firstLoad });
    slot.worker.postMessage({ type: 'render', requestId, assetId: job.assetId, sourceBytes: bytes?.buffer, adjustments: job.adjustments }, bytes ? [bytes.buffer] : []);
    this.#dispatch();
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
