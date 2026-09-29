export class PillowWorkerPool {
  constructor({ maxWorkers = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) } = {}) {
    this.maxWorkers = Math.max(1, Math.min(8, maxWorkers));
    this.slots = [];
    this.assignments = new Map();
    this.nextIndex = 0;
    this.nextRequest = 1;
    this.pending = new Map();
    this.ready = false;
    this.error = null;
  }
  async #slotFor(id) {
    let index = this.assignments.get(id);
    if (index === undefined) { index = this.nextIndex++ % this.maxWorkers; this.assignments.set(id, index); }
    while (this.slots.length <= index) this.#createSlot();
    const slot = this.slots[index];
    if (slot.failed) throw new Error(slot.failed);
    await slot.ready;
    return slot;
  }
  #createSlot() {
    const worker = new Worker(new URL("./pillow-worker.js", import.meta.url), { type: "module", name: `tiny-star-pillow-${this.slots.length + 1}` });
    const slot = { worker, ready: null, queue: [], running: false, loadedIds: new Set(), index: this.slots.length };
    slot.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The local image engine took too long to start")), 20_000);
      slot.resolveReady = () => { clearTimeout(timer); resolve(); };
      slot.rejectReady = reject;
    });
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "ready") { this.ready = true; slot.isReady = true; slot.resolveReady(); return; }
      if (message.type === "error" && !slot.isReady) {
        slot.isReady = true;
        this.error = message.message || "The local WebAssembly image engine could not start";
        slot.rejectReady(new Error(this.error));
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (pending) {
        this.pending.delete(message.requestId);
        if (message.type === "error") pending.reject(new Error(message.message));
        else pending.resolve(message);
      }
      slot.running = false; this.#drain(slot);
    };
    worker.onerror = (event) => {
      this.error = event.message || "The local WebAssembly image engine failed";
      slot.failed = this.error;
      slot.rejectReady?.(new Error(this.error));
      const failure = new Error(this.error);
      const active = slot.currentRequestId && this.pending.get(slot.currentRequestId);
      if (active) { this.pending.delete(slot.currentRequestId); active.reject(failure); }
      for (const item of slot.queue.splice(0)) { this.pending.delete(item.requestId); item.reject(failure); }
    };
    this.slots.push(slot);
  }
  async render(node, adjustments) {
    if (!node.sourceBytes) throw new Error("The original image bytes are no longer available in this tab");
    const slot = await this.#slotFor(node.id);
    const requestId = this.nextRequest++;
    const firstLoad = !slot.loadedIds.has(node.id);
    const sourceBytes = firstLoad ? node.sourceBytes.slice().buffer : null;
    slot.loadedIds.add(node.id);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      slot.queue.push({ requestId, node, adjustments, sourceBytes, reject });
      this.#drain(slot);
    });
  }
  #drain(slot) {
    if (slot.running || !slot.queue.length) return;
    const task = slot.queue.shift(); slot.running = true; slot.currentRequestId = task.requestId;
    slot.worker.postMessage({ type: "render", requestId: task.requestId, id: task.node.id, sourceBytes: task.sourceBytes, adjustments: { ...task.adjustments } }, task.sourceBytes ? [task.sourceBytes] : []);
  }
  dispose(id) {
    const index = this.assignments.get(id); if (index === undefined) return;
    const slot = this.slots[index]; this.assignments.delete(id); slot.loadedIds?.delete(id);
    slot?.worker.postMessage({ type: "dispose", id });
  }
  setMaxWorkers(count) { this.maxWorkers = Math.max(1, Math.min(8, Math.floor(count))); }
  destroy() {
    const failure = new Error("The local image worker was stopped");
    for (const entry of this.pending.values()) entry.reject(failure);
    this.pending.clear();
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = []; this.assignments.clear();
  }
}
