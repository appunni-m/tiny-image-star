import { MAX_OBJECT_ISOLATION_SOURCE_PIXELS, normalizeObjectIsolationStrokes } from './object-isolation-mask.js';

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

function abortError() {
  const error = new Error('Object isolation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function copySourceBytes(sourceBytes) {
  if (sourceBytes instanceof ArrayBuffer) return sourceBytes.slice(0);
  if (ArrayBuffer.isView(sourceBytes)) {
    return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
  }
  throw new TypeError('Object isolation needs the original image bytes.');
}

/** One lazy, local MediaPipe worker. Inference is serialized and never runs on the UI thread. */
export class LocalObjectIsolationEngine {
  constructor({
    // MediaPipe loads its pinned WASM factory with importScripts. Keep this a
    // classic worker so the upstream loader exposes ModuleFactory globally.
    workerFactory = () => new Worker(new URL('./workers/object-isolation-worker.bundle.js', import.meta.url), {
      name: 'Tiny Image Star local object isolation',
    }),
    readinessTimeoutMs = 120_000,
    jobTimeoutMs = 180_000,
  } = {}) {
    if (typeof workerFactory !== 'function') throw new TypeError('Object isolation needs a worker factory.');
    if (!Number.isFinite(readinessTimeoutMs) || readinessTimeoutMs < 1) throw new RangeError('Object-isolation worker readiness timeout must be positive.');
    if (!Number.isFinite(jobTimeoutMs) || jobTimeoutMs < 1) throw new RangeError('Object-isolation job timeout must be positive.');
    this.workerFactory = workerFactory;
    this.readinessTimeoutMs = readinessTimeoutMs;
    this.jobTimeoutMs = jobTimeoutMs;
    this.worker = null;
    this.ready = null;
    this.readyReject = null;
    this.readyTimeout = null;
    this.active = null;
    this.nextId = 0;
    this.closed = false;
  }

  run(sourceBytes, strokes, { signal, onStage } = {}) {
    if (this.closed) return Promise.reject(new Error('The local object-isolation worker is closed.'));
    if (this.active) return Promise.reject(new Error('Object isolation is already processing another image. Wait for it to finish, then retry.'));
    if (signal?.aborted) return Promise.reject(abortError());
    if (!(sourceBytes instanceof ArrayBuffer) && !ArrayBuffer.isView(sourceBytes)) {
      return Promise.reject(new TypeError('Object isolation needs the original image bytes.'));
    }
    if (sourceBytes.byteLength < 1 || sourceBytes.byteLength > MAX_SOURCE_BYTES) {
      return Promise.reject(new RangeError('Object isolation source bytes exceed the local memory limit.'));
    }
    let normalizedStrokes;
    try { normalizedStrokes = normalizeObjectIsolationStrokes(strokes); }
    catch (error) { return Promise.reject(error); }

    const request = {
      requestId: `isolate-${++this.nextId}`,
      sourceBytes,
      strokes: normalizedStrokes,
      signal,
      onStage,
      sent: false,
      aborted: false,
      resolve: null,
      reject: null,
      abortListener: null,
    };
    const promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    this.active = request;
    if (signal) {
      request.abortListener = () => this.#abort(request);
      signal.addEventListener('abort', request.abortListener, { once: true });
    }
    this.#dispatch(request);
    return promise;
  }

  #ensureWorker() {
    if (this.ready) return this.ready;
    try { this.worker = this.workerFactory(); }
    catch (error) { return Promise.reject(error); }

    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      this.readyReject = reject;
      this.readyTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.#terminateWorker(new Error('The local object-isolation model did not start in time.'));
      }, this.readinessTimeoutMs);
      this.worker.onmessage = event => {
        const message = event.data;
        if (message?.type === 'ready' && !settled) {
          settled = true;
          clearTimeout(this.readyTimeout);
          this.readyTimeout = null;
          this.readyReject = null;
          this.ready = Promise.resolve();
          resolve();
          return;
        }
        if (message?.type === 'init-error' && !settled) {
          settled = true;
          const error = new Error(message.message || 'The local object-isolation model could not start.');
          this.#terminateWorker(error);
          return;
        }
        this.#onWorkerMessage(message);
      };
      this.worker.onerror = event => {
        const error = new Error(event.message || 'The local object-isolation worker stopped unexpectedly.');
        if (!settled) {
          settled = true;
        }
        this.#terminateWorker(error);
        this.#complete(this.active, error);
      };
      try { this.worker.postMessage({ type: 'initialize' }); }
      catch (error) {
        settled = true;
        this.#terminateWorker(error);
      }
    });
    return this.ready;
  }

  #dispatch(request) {
    this.#ensureWorker().then(() => {
      if (this.active !== request) return;
      if (request.aborted || request.signal?.aborted) {
        this.#complete(request, abortError());
        return;
      }
      const sourceBuffer = copySourceBytes(request.sourceBytes);
      request.sent = true;
      this.worker.postMessage({
        type: 'isolate', requestId: request.requestId,
        sourceBytes: sourceBuffer, strokes: request.strokes,
      }, [sourceBuffer]);
      request.jobTimeout = setTimeout(() => {
        if (this.active !== request) return;
        this.#complete(request, new Error('Local object isolation exceeded its time limit. The worker was stopped to release memory.'));
      }, this.jobTimeoutMs);
      request.sourceBytes = null;
    }).catch(error => {
      if (this.active === request) this.#complete(request, error);
    });
  }

  #abort(request) {
    if (request.aborted) return;
    request.aborted = true;
    if (this.active !== request) return;
    // MediaPipe's segment() is synchronous inside the worker. Terminating the
    // worker is the only reliable way to stop an active inference and release
    // model/embedding memory immediately after the user cancels.
    this.#terminateWorker();
    this.#complete(request, abortError());
  }

  #onWorkerMessage(message) {
    const request = this.active;
    if (!request || message?.requestId !== request.requestId) return;
    if (message.type === 'stage') {
      try { request.onStage?.({ stage: message.stage, detail: message.detail || '' }); }
      catch { /* Progress callbacks must not interrupt inference. */ }
      return;
    }
    if (message.type === 'rendered') {
      if (!(message.bytes instanceof ArrayBuffer)
        || message.mimeType !== 'image/png'
        || !Number.isSafeInteger(message.width) || message.width < 1
        || !Number.isSafeInteger(message.height) || message.height < 1
        || message.width * message.height > MAX_OBJECT_ISOLATION_SOURCE_PIXELS) {
        this.#complete(request, new TypeError('The local object-isolation worker returned an invalid transparent image.'));
        return;
      }
      this.#complete(request, null, {
        bytes: new Uint8Array(message.bytes), mimeType: message.mimeType,
        width: message.width, height: message.height,
      });
      return;
    }
    if (message.type === 'error') this.#complete(request, new Error(message.message || 'Local object isolation failed.'));
  }

  #complete(request, error, result) {
    if (!request || this.active !== request) return;
    // Release the roughly 42 MiB bundled model/WASM working set after every
    // job. A browser session may keep the engine object, but not an idle model
    // worker resident on a memory-constrained phone.
    this.#terminateWorker();
    this.active = null;
    this.#finish(request, error, result);
  }

  #finish(request, error, result) {
    clearTimeout(request.jobTimeout);
    request.jobTimeout = null;
    if (request.signal && request.abortListener) request.signal.removeEventListener('abort', request.abortListener);
    request.sourceBytes = null;
    request.strokes = null;
    if (error) request.reject(error);
    else request.resolve(result);
  }

  #terminateWorker(error = null) {
    const worker = this.worker;
    this.worker = null;
    const rejectReady = this.readyReject;
    this.readyReject = null;
    clearTimeout(this.readyTimeout);
    this.readyTimeout = null;
    this.ready = null;
    try { worker?.terminate?.(); } catch { /* The worker is already stopping. */ }
    if (rejectReady) rejectReady(error || new Error('The local object-isolation worker was stopped.'));
  }

  dispose() {
    if (this.closed) return false;
    this.closed = true;
    this.#terminateWorker();
    if (this.active) this.#complete(this.active, new Error('The local object-isolation worker was stopped.'));
    return true;
  }
}
