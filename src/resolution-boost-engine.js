import {
  MAX_RESOLUTION_BOOST_OUTPUT_BYTES,
  MAX_RESOLUTION_BOOST_SOURCE_BYTES,
  validateResolutionBoostDimensions,
} from './resolution-boost.js';

function abortError() {
  const error = new Error('Resolution boost was cancelled.');
  error.name = 'AbortError';
  return error;
}

function sourceBytesBuffer(sourceBytes) {
  if (sourceBytes instanceof ArrayBuffer) return sourceBytes.slice(0);
  if (ArrayBuffer.isView(sourceBytes)) {
    return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
  }
  throw new TypeError('Resolution boost needs the original image bytes.');
}

/** A serialized, drain-safe ONNX/WASM worker with bounded input and output sizes. */
export class LocalResolutionBoostEngine {
  constructor({
    workerFactory = () => new Worker(new URL('./workers/resolution-boost-worker.bundle.js', import.meta.url), {
      type: 'module', name: 'Tiny Image Star local resolution boost',
    }),
    numThreads = 1,
    readinessTimeoutMs = 120_000,
    jobTimeoutMs = 600_000,
    idleTimeoutMs = 15_000,
  } = {}) {
    if (typeof workerFactory !== 'function') throw new TypeError('Resolution boost needs a worker factory.');
    if (!Number.isSafeInteger(numThreads) || numThreads < 1 || numThreads > 4) {
      throw new RangeError('Resolution boost supports one through four WebAssembly threads.');
    }
    for (const [name, value] of Object.entries({ readinessTimeoutMs, jobTimeoutMs, idleTimeoutMs })) {
      if (!Number.isFinite(value) || value < 1) throw new RangeError(`Resolution-boost ${name} must be positive.`);
    }
    this.workerFactory = workerFactory;
    this.numThreads = numThreads;
    this.readinessTimeoutMs = readinessTimeoutMs;
    this.jobTimeoutMs = jobTimeoutMs;
    this.idleTimeoutMs = idleTimeoutMs;
    this.worker = null;
    this.ready = null;
    this.readyReject = null;
    this.readyTimer = null;
    this.idleTimer = null;
    this.queue = [];
    this.active = null;
    this.nextId = 0;
    this.closed = false;
  }

  run(sourceBytes, { width, height, signal, onStage } = {}) {
    if (this.closed) return Promise.reject(new Error('The local resolution-boost worker is closed.'));
    if (signal?.aborted) return Promise.reject(abortError());
    if (!(sourceBytes instanceof ArrayBuffer) && !ArrayBuffer.isView(sourceBytes)) {
      return Promise.reject(new TypeError('Resolution boost needs the original image bytes.'));
    }
    if (sourceBytes.byteLength < 1 || sourceBytes.byteLength > MAX_RESOLUTION_BOOST_SOURCE_BYTES) {
      return Promise.reject(new RangeError('Resolution-boost source bytes exceed the local memory limit.'));
    }
    try { validateResolutionBoostDimensions(width, height); }
    catch (error) { return Promise.reject(error); }
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const request = {
      requestId: `resolution-${++this.nextId}`,
      sourceBytes,
      width,
      height,
      signal,
      onStage,
      sent: false,
      aborted: false,
      resolve: null,
      reject: null,
      abortListener: null,
    };
    const promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    if (signal) {
      request.abortListener = () => this.#abort(request);
      signal.addEventListener('abort', request.abortListener, { once: true });
    }
    this.queue.push(request);
    this.#dispatch();
    return promise;
  }

  #ensureWorker() {
    if (this.ready) return this.ready;
    try { this.worker = this.workerFactory(); }
    catch (error) { return Promise.reject(error); }
    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      this.readyReject = reject;
      this.readyTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.#terminateWorker(new Error('The local resolution-boost model did not start in time.'));
      }, this.readinessTimeoutMs);
      this.worker.onmessage = event => {
        const message = event.data;
        if (message?.type === 'ready' && !settled) {
          settled = true;
          clearTimeout(this.readyTimer);
          this.readyTimer = null;
          this.readyReject = null;
          this.ready = Promise.resolve();
          resolve();
          this.#dispatch();
          return;
        }
        if (message?.type === 'init-error' && !settled) {
          settled = true;
          this.#terminateWorker(new Error(message.message || 'The local resolution-boost model could not start.'));
          return;
        }
        this.#onWorkerMessage(message);
      };
      this.worker.onerror = event => {
        const error = new Error(event.message || 'The local resolution-boost worker stopped unexpectedly.');
        settled = true;
        this.#terminateWorker(error);
        this.#failAll(error);
      };
      try { this.worker.postMessage({ type: 'initialize', numThreads: this.numThreads }); }
      catch (error) {
        settled = true;
        this.#terminateWorker(error);
      }
    });
    return this.ready;
  }

  #dispatch() {
    if (this.closed || this.active || !this.queue.length) return;
    const request = this.queue.shift();
    if (request.aborted || request.signal?.aborted) {
      this.#finish(request, abortError());
      this.#dispatch();
      return;
    }
    this.active = request;
    this.#ensureWorker().then(() => {
      if (this.active !== request) return;
      if (request.aborted || request.signal?.aborted) {
        this.active = null;
        this.#finish(request, abortError());
        this.#dispatch();
        return;
      }
      const buffer = sourceBytesBuffer(request.sourceBytes);
      request.sent = true;
      this.worker.postMessage({
        type: 'boost', requestId: request.requestId, sourceBytes: buffer,
        width: request.width, height: request.height, numThreads: this.numThreads,
      }, [buffer]);
      request.sourceBytes = null;
      request.jobTimer = setTimeout(() => {
        if (this.active !== request) return;
        this.#failAll(new Error('Local resolution boost exceeded its time limit. The worker was stopped to release memory.'));
      }, this.jobTimeoutMs);
    }).catch(error => {
      if (this.active === request) this.active = null;
      this.#finish(request, error);
      this.#dispatch();
    });
  }

  #abort(request) {
    if (request.aborted) return;
    request.aborted = true;
    if (this.active === request && request.sent) {
      try { this.worker?.postMessage({ type: 'cancel', requestId: request.requestId }); }
      catch { /* Worker failure rejects the request and drains its queue. */ }
      return;
    }
    const index = this.queue.indexOf(request);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.#finish(request, abortError());
      if (!this.active && !this.queue.length) this.#scheduleIdleTermination();
    }
  }

  #onWorkerMessage(message) {
    const request = this.active;
    if (!request || message?.requestId !== request.requestId) return;
    if (message.type === 'stage') {
      try { request.onStage?.({ stage: message.stage, detail: message.detail || '' }); }
      catch { /* Progress callbacks must not interrupt model inference. */ }
      return;
    }
    if (message.type === 'boosted') {
      const expectedWidth = request.width * 4;
      const expectedHeight = request.height * 4;
      const expectedPixels = expectedWidth * expectedHeight;
      if (!(message.bytes instanceof ArrayBuffer) || message.mimeType !== 'image/png'
        || message.bytes.byteLength < 1 || message.bytes.byteLength > MAX_RESOLUTION_BOOST_OUTPUT_BYTES
        || !Number.isSafeInteger(message.width) || !Number.isSafeInteger(message.height)
        || message.width !== expectedWidth || message.height !== expectedHeight
        || expectedPixels > 8_388_608) {
        this.#complete(request, new TypeError('The resolution-boost worker returned an invalid PNG.'));
        return;
      }
      this.#complete(request, null, {
        bytes: new Uint8Array(message.bytes), mimeType: message.mimeType,
        width: message.width, height: message.height,
      });
      return;
    }
    if (message.type === 'cancelled') { this.#complete(request, abortError()); return; }
    if (message.type === 'error') this.#complete(request, new Error(message.message || 'Local resolution boost failed.'));
  }

  #complete(request, error, result) {
    if (this.active !== request) return;
    clearTimeout(request.jobTimer);
    this.active = null;
    this.#finish(request, error, result);
    if (this.queue.length) this.#dispatch();
    else this.#scheduleIdleTermination();
  }

  #finish(request, error, result) {
    clearTimeout(request.jobTimer);
    request.jobTimer = null;
    if (request.signal && request.abortListener) request.signal.removeEventListener('abort', request.abortListener);
    request.sourceBytes = null;
    if (error) request.reject(error);
    else request.resolve(result);
  }

  #scheduleIdleTermination() {
    if (this.closed || this.active || this.queue.length || !this.worker) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.active && !this.queue.length) this.#terminateWorker();
    }, this.idleTimeoutMs);
  }

  #terminateWorker(error = null) {
    const worker = this.worker;
    this.worker = null;
    const rejectReady = this.readyReject;
    this.readyReject = null;
    clearTimeout(this.readyTimer);
    clearTimeout(this.idleTimer);
    this.readyTimer = null;
    this.idleTimer = null;
    this.ready = null;
    try { worker?.terminate?.(); } catch { /* The worker may already have stopped. */ }
    if (rejectReady) rejectReady(error || new Error('The local resolution-boost worker was stopped.'));
  }

  #failAll(error) {
    const active = this.active;
    this.active = null;
    if (active) this.#finish(active, error);
    for (const request of this.queue.splice(0)) this.#finish(request, error);
    this.#terminateWorker(error);
  }

  dispose() {
    if (this.closed) return false;
    this.closed = true;
    this.#failAll(new Error('The local resolution-boost worker was stopped.'));
    return true;
  }
}
