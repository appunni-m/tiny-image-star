export class LocalImageEngine {
  constructor() {
    this.worker = new Worker(new URL('./image-worker.js', import.meta.url), { type: 'module', name: 'local-studio-pillow-rs' });
    this.nextRequestId = 1;
    this.pending = new Map();
    this.loadedIds = new Set();
    this.initialization = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.initialization.catch(() => {});
    this.worker.onmessage = event => this.#receive(event.data);
    this.worker.onerror = event => this.#failAll(new Error(event.message || 'The local image worker stopped unexpectedly.'));
  }

  #receive(message) {
    if (message.type === 'ready') { this.resolveReady(); return; }
    if (message.type === 'init-error') { this.#failAll(new Error(message.message)); this.rejectReady?.(new Error(message.message)); return; }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (message.type === 'error') {
      if (pending.firstLoad) this.loadedIds.delete(message.id);
      pending.reject(new Error(message.message));
    } else pending.resolve(message);
  }

  async render(node) {
    if (!(node.sourceBytes instanceof Uint8Array)) throw new Error('The image bytes are no longer available in this tab.');
    await this.initialization;
    const requestId = this.nextRequestId++;
    const firstLoad = !this.loadedIds.has(node.id);
    const sourceCopy = firstLoad ? node.sourceBytes.slice() : null;
    if (firstLoad) this.loadedIds.add(node.id);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, firstLoad });
      const transferable = sourceCopy ? [sourceCopy.buffer] : [];
      this.worker.postMessage({
        type: 'render', requestId, id: node.id,
        sourceBytes: sourceCopy?.buffer,
        adjustments: { ...(node.adjustments || {}) }
      }, transferable);
    });
  }

  dispose(id) {
    this.loadedIds.delete(id);
    this.worker.postMessage({ type: 'dispose', id });
  }

  destroy() {
    this.#failAll(new Error('The local image worker was stopped.'));
    this.worker.terminate();
    this.loadedIds.clear();
  }

  #failAll(error) {
    for (const item of this.pending.values()) item.reject(error);
    this.pending.clear();
  }
}
