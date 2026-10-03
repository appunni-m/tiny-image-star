import { validateImageExpansionPlan } from './image-expansion-plan.js';

function abortError(message = 'The object-erase request was cancelled.') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function sourceBytesBuffer(sourceBytes) {
  if (sourceBytes instanceof ArrayBuffer) return sourceBytes.slice(0);
  if (ArrayBuffer.isView(sourceBytes)) {
    return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
  }
  throw new TypeError('Object erase needs the original image bytes.');
}

function isImageBytes(sourceBytes) {
  return sourceBytes instanceof ArrayBuffer || ArrayBuffer.isView(sourceBytes);
}

/** One persistent local inference worker, with serialized jobs and drain-safe cancellation. */
export class LocalInpaintEngine {
  constructor({
    workerFactory = () => new Worker(new URL('./workers/inpaint-worker.bundle.js', import.meta.url), {
      type: 'module', name: 'Tiny Image Star local object erase',
    }),
    readinessTimeoutMs = 120_000,
  } = {}) {
    if (typeof workerFactory !== 'function') throw new TypeError('Object erase needs a worker factory.');
    if (!Number.isFinite(readinessTimeoutMs) || readinessTimeoutMs < 1) throw new RangeError('Object-erase worker readiness timeout must be positive.');
    this.workerFactory = workerFactory;
    this.readinessTimeoutMs = readinessTimeoutMs;
    this.worker = null;
    this.ready = null;
    this.queue = [];
    this.active = null;
    this.nextId = 0;
    this.closed = false;
  }

  run(sourceBytes, strokes, { signal, onStage } = {}) {
    if (this.closed) return Promise.reject(new Error('The local object-erase worker is closed.'));
    if (!Array.isArray(strokes) || !strokes.length) return Promise.reject(new TypeError('Draw at least one erase stroke first.'));
    if (signal?.aborted) return Promise.reject(abortError());
    if (!isImageBytes(sourceBytes)) {
      return Promise.reject(new TypeError('Object erase needs the original image bytes.'));
    }

    return this.#enqueue(sourceBytes, { type: 'inpaint', strokes }, { signal, onStage });
  }

  /** Run local unprompted expansion through the same serialized MI-GAN worker. */
  expand(sourceBytes, plan, { signal, onStage } = {}) {
    if (this.closed) return Promise.reject(new Error('The local object-erase worker is closed.'));
    if (!isImageBytes(sourceBytes)) {
      return Promise.reject(new TypeError('Image expansion needs the original image bytes.'));
    }
    if (signal?.aborted) return Promise.reject(abortError());
    let validPlan;
    try {
      validPlan = validateImageExpansionPlan(plan);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#enqueue(sourceBytes, {
      type: 'expand',
      plan: {
        sourceWidth: validPlan.sourceWidth,
        sourceHeight: validPlan.sourceHeight,
        padding: { ...validPlan.padding },
      },
      expectedWidth: validPlan.width,
      expectedHeight: validPlan.height,
    }, { signal, onStage });
  }

  #enqueue(sourceBytes, operation, { signal, onStage } = {}) {
    if (this.closed) return Promise.reject(new Error('The local object-erase worker is closed.'));
    if (signal?.aborted) return Promise.reject(abortError());

    const request = {
      requestId: `erase-${++this.nextId}`,
      ...operation,
      sourceBytes,
      buffer: null,
      signal,
      onStage,
      sent: false,
      aborted: false,
      resolve: null,
      reject: null,
      abortListener: null,
    };
    const promise = new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;
    });
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
    try {
      this.worker = this.workerFactory();
    } catch (error) {
      this.ready = Promise.reject(error);
      return this.ready;
    }
    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('The local object-erase model did not start in time.'));
        this.worker?.terminate?.();
        this.worker = null;
        this.ready = null;
      }, this.readinessTimeoutMs);
      this.worker.onmessage = event => {
        const message = event.data;
        if (message?.type === 'ready' && !settled) {
          settled = true;
          clearTimeout(timeout);
          resolve();
          this.#dispatch();
          return;
        }
        if (message?.type === 'init-error' && !settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(message.message || 'The local object-erase model could not start.'));
          this.#failAll(new Error(message.message || 'The local object-erase model could not start.'));
          return;
        }
        this.#onWorkerMessage(message);
      };
      this.worker.onerror = event => {
        clearTimeout(timeout);
        const error = new Error(event.message || 'The local object-erase worker stopped unexpectedly.');
        if (!settled) {
          settled = true;
          reject(error);
        }
        this.#failAll(error);
      };
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
      request.sent = true;
      request.buffer = sourceBytesBuffer(request.sourceBytes);
      const message = {
        type: request.type,
        requestId: request.requestId,
        sourceBytes: request.buffer,
      };
      if (request.type === 'inpaint') message.strokes = request.strokes;
      if (request.type === 'expand') message.plan = request.plan;
      this.worker.postMessage(message, [request.buffer]);
      request.buffer = null;
      request.sourceBytes = null;
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
      catch { /* Worker failure will reject the active request. */ }
      return;
    }
    const index = this.queue.indexOf(request);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.#finish(request, abortError());
    }
  }

  #onWorkerMessage(message) {
    const request = this.active;
    if (!request || message?.requestId !== request.requestId) return;
    if (message.type === 'stage') {
      try { request.onStage?.({ stage: message.stage, detail: message.detail || '' }); }
      catch { /* User interface progress callbacks must not break inference. */ }
      return;
    }
    if (message.type === 'rendered') {
      if (!(message.bytes instanceof ArrayBuffer)
        || !Number.isSafeInteger(message.width) || message.width < 1
        || !Number.isSafeInteger(message.height) || message.height < 1
        || (request.type === 'expand' && (message.width !== request.expectedWidth || message.height !== request.expectedHeight))) {
        this.#complete(request, new TypeError('The object-erase worker returned an invalid image.'));
        return;
      }
      this.#complete(request, null, { bytes: new Uint8Array(message.bytes), width: message.width, height: message.height });
      return;
    }
    if (message.type === 'cancelled') {
      this.#complete(request, abortError());
      return;
    }
    if (message.type === 'error') this.#complete(request, new Error(message.message || 'Local object erase failed.'));
  }

  #complete(request, error, result) {
    if (this.active !== request) return;
    this.active = null;
    this.#finish(request, error, result);
    this.#dispatch();
  }

  #finish(request, error, result) {
    if (request.signal && request.abortListener) request.signal.removeEventListener('abort', request.abortListener);
    request.buffer = null;
    request.sourceBytes = null;
    if (error) request.reject(error);
    else request.resolve(result);
  }

  #failAll(error) {
    const active = this.active;
    this.active = null;
    if (active) this.#finish(active, error);
    for (const request of this.queue.splice(0)) this.#finish(request, error);
    this.worker?.terminate?.();
    this.worker = null;
    this.ready = null;
  }

  dispose() {
    if (this.closed) return false;
    this.closed = true;
    this.#failAll(new Error('The local object-erase worker was stopped.'));
    return true;
  }
}
