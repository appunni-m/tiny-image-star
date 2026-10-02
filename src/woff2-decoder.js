const MAX_WOFF2_BYTES = 20 * 1024 * 1024;
const MAX_PENDING_REQUESTS = 8;
const REQUEST_TIMEOUT_MS = 60_000;
const IDLE_SHUTDOWN_MS = 30_000;

function byteView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function makeError(message) { return new Error(String(message || 'The local WOFF2 decoder failed.')); }

/** Decode local WOFF2 data in one lazily-started, short-lived module worker. */
export class LocalWoff2Decoder {
  #workerFactory;
  #worker = null;
  #pending = new Map();
  #nextId = 0;
  #idleTimer = null;
  #timeoutMs;
  #idleShutdownMs;
  #closed = false;

  constructor({
    WorkerConstructor = globalThis.Worker,
    workerFactory = null,
    timeoutMs = REQUEST_TIMEOUT_MS,
    idleShutdownMs = IDLE_SHUTDOWN_MS
  } = {}) {
    if (workerFactory != null && typeof workerFactory !== 'function') throw new TypeError('A WOFF2 worker factory must be a function.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('The WOFF2 decode timeout must be a positive integer.');
    if (!Number.isInteger(idleShutdownMs) || idleShutdownMs < 0) throw new TypeError('The WOFF2 worker idle shutdown must be a non-negative integer.');
    this.#workerFactory = workerFactory || (() => {
      if (typeof WorkerConstructor !== 'function') throw new TypeError('This browser does not support local font workers.');
      return new WorkerConstructor(
        new URL('./workers/woff2-decompress-worker.bundle.js', import.meta.url),
        { type: 'module', name: 'tiny-image-star-local-font-decoder' }
      );
    });
    this.#timeoutMs = timeoutMs;
    this.#idleShutdownMs = idleShutdownMs;
  }

  decode(sourceBytes) {
    if (this.#closed) return Promise.reject(makeError('The local WOFF2 decoder is closed.'));
    const bytes = byteView(sourceBytes);
    if (!bytes || bytes.byteLength < 48 || bytes[0] !== 0x77 || bytes[1] !== 0x4f || bytes[2] !== 0x46 || bytes[3] !== 0x32) {
      return Promise.reject(new TypeError('Choose a valid WOFF2 font to inspect its variable axes.'));
    }
    if (bytes.byteLength > MAX_WOFF2_BYTES) return Promise.reject(new RangeError('The WOFF2 font is larger than the local decoder limit.'));
    if (this.#pending.size >= MAX_PENDING_REQUESTS) return Promise.reject(new Error('The local font decoder is busy. Wait for another font to finish, then retry.'));

    let worker;
    try { worker = this.#getWorker(); }
    catch (error) { return Promise.reject(error); }
    const id = ++this.#nextId;
    const copy = bytes.slice();
    const buffer = copy.buffer;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#failWorker(makeError('Local WOFF2 inspection took too long. Try a smaller font file.'));
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, bytes: buffer }, [buffer]); }
      catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
        this.#scheduleIdleShutdown();
      }
    });
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    this.#failWorker(makeError('The local WOFF2 decoder was closed.'));
  }

  #getWorker() {
    if (this.#worker) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
      return this.#worker;
    }
    const worker = this.#workerFactory();
    worker.addEventListener('message', event => this.#handleMessage(event.data));
    worker.addEventListener('error', event => this.#failWorker(makeError(event.message || 'The local WOFF2 worker stopped unexpectedly.')));
    worker.addEventListener('messageerror', () => this.#failWorker(makeError('The local WOFF2 worker returned an unreadable result.')));
    this.#worker = worker;
    return worker;
  }

  #handleMessage(message) {
    const pending = this.#pending.get(message?.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok !== true) pending.reject(makeError(message.error));
    else {
      const bytes = byteView(message.bytes);
      if (!bytes) pending.reject(makeError('The local WOFF2 worker returned invalid font bytes.'));
      else pending.resolve(bytes);
    }
    this.#scheduleIdleShutdown();
  }

  #failWorker(error) {
    clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    this.#worker?.terminate();
    this.#worker = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #scheduleIdleShutdown() {
    if (!this.#worker || this.#pending.size || this.#idleShutdownMs === 0) return;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => {
      if (this.#pending.size) return;
      this.#worker?.terminate();
      this.#worker = null;
      this.#idleTimer = null;
    }, this.#idleShutdownMs);
  }
}
