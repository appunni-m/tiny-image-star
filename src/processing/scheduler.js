import { deviceBudget, INITIAL_HEAP_BYTES, MiB, normalizeEstimate } from "./policy.js";

const abortError = () => Object.assign(new Error("Processing cancelled."), { name: "AbortError" });
const AUTO_CONCURRENCY_PROBE_LIMIT = 8;

// One admission ledger covers every worker kind. Clients own intent; physical
// workers belong to this scheduler and can outlive a completed client/job.
export class ResourceScheduler {
  constructor({ workerFactory, hints = {}, now = () => performance.now(), startupTimeout = 20_000, taskTimeout = 120_000, idleTimeout = 30_000, admissionFactory } = {}) {
    this.workerFactory = workerFactory;
    this.now = now;
    this.budget = deviceBudget(hints);
    this.startupTimeout = startupTimeout;
    this.taskTimeout = taskTimeout;
    this.idleTimeout = idleTimeout;
    this.mode = "auto";
    this.limit = 1;
    this.fixed = null;
    this.bootstrapAvailable = true;
    this.bootstrapStarted = false;
    this.slots = new Set();
    this.queue = [];
    this.retained = new Map();
    this.preparing = new Map();
    this.sequence = 0;
    this.dispatchSequence = 0;
    this.capabilities = null;
    this.capabilityPromise = null;
    this.pendingPump = false;
    this.closed = false;
    this.listeners = new Set();
    this.samples = [];
    this.startups = [];
    this.windows = new Map();
    this.previousWindows = new Map();
    this.downProbe = null;
    this.cooldownUntil = 0;
    this.stats = { completed: 0, failed: 0, cancelled: 0, startedWorkers: 0, retiredWorkers: 0, limitingReason: "idle" };
    this.admission = admissionFactory?.(this) ?? null;
  }

  syncOrigin() {
    this.admission?.publish().catch((error) => { this.admissionError = error; this.pumpSoon(); });
  }

  releaseIdle() {
    for (const slot of [...this.slots]) if (slot.ready && !slot.task) this.retire(slot);
  }

  configure({ mode = this.mode, fixedConcurrency = null } = {}) {
    if (!["auto", "max-speed", "low-resource"].includes(mode)) throw new Error("Unknown processing mode.");
    if (fixedConcurrency !== null && (!Number.isInteger(fixedConcurrency) || fixedConcurrency < 1 || fixedConcurrency > this.budget.cpu)) throw new Error("Worker count exceeds the reported CPU budget.");
    const resetAuto = mode !== this.mode || fixedConcurrency !== this.fixed;
    if (!resetAuto && this.downProbe) this.limit = this.downProbe.baseline.limit;
    this.downProbe = null;
    if (resetAuto) { this.bootstrapAvailable = true; this.bootstrapStarted = false; }
    this.mode = mode;
    this.fixed = fixedConcurrency;
    this.limit = fixedConcurrency ?? (mode === "low-resource" ? 1 : mode === "max-speed" ? this.budget.cpu : resetAuto ? 1 : Math.min(this.limit, this.budget.cpu));
    this.windows.clear(); this.previousWindows.clear();
    this.pumpSoon();
    this.emit();
  }

  setRetainedBytes(owner, bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error("Invalid retained memory estimate.");
    if (bytes) this.retained.set(owner, bytes);
    else this.retained.delete(owner);
    this.syncOrigin();
    this.pumpSoon();
  }

  // Reserve before reading a bounded download/share window into memory. Other
  // tabs use the same admission ledger as workers; no source read precedes it.
  async reserveRetainedBytes(owner, bytes, { signal, reuseWorkers = false } = {}) {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || this.retained.has(owner)) throw new Error("Invalid retained-memory reservation.");
    if (!reuseWorkers || this.usedMemory() + bytes > this.budget.memory) this.releaseIdle();
    const desired = () => {
      if (signal?.aborted || this.closed) throw abortError();
      const memory = this.usedMemory() + bytes;
      if (memory > this.budget.memory) throw new Error("Not enough processing memory to prepare these files. Pause other work and retry, or choose a smaller group.");
      return { cpu: this.usedCpu(), memory };
    };
    const commit = () => { this.retained.set(owner, bytes); };
    if (this.admission) {
      while (!await this.admission.admit({ desired, commit, signal })) { /* Recheck a changing live ledger. */ }
    } else { desired(); commit(); }
    this.pumpSoon(); this.emit();
  }

  retainedBytes() { return [...this.retained.values()].reduce((sum, bytes) => sum + bytes, 0); }
  usedCpu() { return [...this.slots].reduce((sum, slot) => sum + (slot.task?.estimate.cpu ?? (slot.ready ? 0 : 1)), 0); }
  usedMemory() {
    return this.retainedBytes() + this.pendingReadBytes() + [...this.slots].reduce((sum, slot) => sum + Math.max(slot.heap, slot.task?.estimate.heap ?? 0) + (slot.task?.estimate.transient ?? 0), 0);
  }
  pendingReadBytes() {
    const attached = new Set([...this.slots].map((slot) => slot.task));
    return [...this.preparing.keys()].reduce((sum, task) => sum + (attached.has(task) ? 0 : task.estimate.heap + task.estimate.transient), 0);
  }
  snapshot() {
    return { ...this.stats, mode: this.mode, limit: this.limit, cpuBudget: this.budget.cpu, memoryBudget: this.budget.memory,
      estimatedBytes: this.usedMemory(), retainedBytes: this.retainedBytes(), active: [...this.slots].filter((slot) => slot.task).length,
      workers: this.slots.size, queued: this.queue.length,
      pendingReadBytes: this.pendingReadBytes(),
      pendingOutputBytes: [...this.slots].reduce((sum, slot) => sum + (slot.task?.estimate.output ?? 0), 0),
      recent: this.samples.map((sample) => ({ ...sample })),
      startups: this.startups.map((sample) => ({ ...sample })),
      coordination: this.admission?.snapshot() ?? { scope: "tab", waiting: false, reason: null } };
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) listener(this.snapshot()); }

  async ready() {
    if (this.closed) throw abortError();
    if (this.capabilities) return this.capabilities;
    if (!this.capabilityPromise) {
      const startup = this.enqueue({ priority: -1, estimate: { heap: INITIAL_HEAP_BYTES, transient: 0, output: 0, cpu: 1 }, workClass: "startup" });
      startup.startupOnly = true;
      this.capabilityPromise = startup.promise.catch((error) => { this.capabilityPromise = null; throw error; });
    }
    return this.capabilityPromise;
  }

  enqueue({ kind = "image", priority = 1, estimate, prepare, onMessage = () => {}, workClass = "other", signal } = {}) {
    const normalized = normalizeEstimate(estimate);
    const task = { id: ++this.sequence, kind, priority, estimate: normalized, prepare, onMessage, workClass, queuedAt: this.now(), state: "queued", signal, admissionController: new AbortController() };
    task.promise = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject; });
    task.cancel = () => this.cancel(task);
    // Cancellation is an expected outcome even if the caller installs its
    // rejection handler only after synchronous queue setup.
    task.promise.catch(() => {});
    if (this.closed || signal?.aborted) { task.state = "finished"; task.reject(abortError()); return task; }
    signal?.addEventListener("abort", task.cancel, { once: true });
    this.queue.push(task);
    this.admission?.wake();
    this.pumpSoon();
    return task;
  }

  cancel(task) {
    if (task.state === "finished") return;
    task.admissionController.abort();
    this.stats.cancelled += 1;
    const slot = [...this.slots].find((candidate) => candidate.task === task);
    if (slot) this.retire(slot); // synchronous WASM cannot process a cancel message
    this.finish(task, abortError());
  }

  finish(task, error, value) {
    if (task.state === "finished") return;
    task.state = "finished";
    clearTimeout(task.timer);
    task.signal?.removeEventListener("abort", task.cancel);
    this.queue = this.queue.filter((candidate) => candidate !== task);
    // Partial throughput windows measure continuous demand. Once all work
    // drains, their wall clock must not include the wait for another job.
    // Keep completed measurements and the learned limit for the next job.
    if (!this.queue.length && ![...this.slots].some((slot) => slot.task && slot.task.state !== "finished")) {
      this.windows.clear();
      if (this.bootstrapStarted) { this.bootstrapAvailable = false; this.bootstrapStarted = false; }
      // A partial lower-count trial is not evidence for retaining that count.
      if (this.downProbe) {
        this.limit = this.downProbe.baseline.limit; this.downProbe = null;
        this.cooldownUntil = this.now() + 30_000;
      }
    }
    if (error) task.reject(error); else task.resolve(value);
    this.syncOrigin();
    this.pumpSoon();
    this.emit();
  }

  retire(slot) {
    if (!this.slots.delete(slot)) return;
    clearTimeout(slot.idleTimer);
    clearTimeout(slot.startTimer);
    slot.worker.terminate();
    this.stats.retiredWorkers += 1;
    this.syncOrigin();
  }

  armIdle(slot) {
    clearTimeout(slot.idleTimer);
    slot.idleTimer = setTimeout(() => {
      if (!slot.task) { this.retire(slot); this.pumpSoon(); }
    }, this.idleTimeout);
    slot.idleTimer.unref?.();
  }

  startSlot(kind) {
    const started = this.now();
    const worker = this.workerFactory(kind);
    const slot = { worker, kind, ready: false, heap: INITIAL_HEAP_BYTES, task: null, lastUsed: this.now() };
    this.slots.add(slot);
    this.stats.startedWorkers += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        this.pressure("worker failure");
        this.retire(slot);
        if (!settled) { settled = true; reject(error); }
        if (slot.task) { this.stats.failed += 1; this.finish(slot.task, error); }
        this.pumpSoon();
      };
      slot.startTimer = setTimeout(() => fail(new Error("The image engine did not start in time.")), this.startupTimeout);
      worker.addEventListener("error", () => fail(new Error("The image worker stopped unexpectedly.")));
      worker.addEventListener("messageerror", () => fail(new Error("The image worker returned unreadable data.")));
      worker.addEventListener("message", (event) => {
        if (!this.slots.has(slot)) return;
        const message = event.data;
        if (!message || typeof message.type !== "string") { fail(new Error("The image worker returned unreadable data.")); return; }
        if (Number.isFinite(message?.heapBytes) && message.heapBytes > 0) { slot.heap = message.heapBytes; this.syncOrigin(); }
        if (message.type === "ready") {
          clearTimeout(slot.startTimer);
          slot.ready = true;
          this.startups.push({ kind, elapsedMs: this.now() - started, heapBytes: slot.heap });
          if (this.startups.length > 64) this.startups.shift();
          if (kind === "image") this.capabilities = message;
          if (!settled) { settled = true; resolve(slot); }
          return;
        }
        if (["fatal", "fatal-error"].includes(message.type) && !slot.ready) { fail(new Error(message.message || "The image engine could not start.")); return; }
        const task = slot.task;
        if (!task || task.state !== "running") return;
        if (kind === "image" && message.revision !== task.wireRevision) return;
        if (kind === "folder" && (message.jobId !== task.packet.jobId || message.index !== task.packet.entry.index)) return;
        const forwarded = kind === "image" ? { ...message, revision: task.originalRevision } : message;
        // Keep reservations until the terminal message: result bytes can arrive
        // before a worker's final cleanup or direct-folder write completes.
        const terminal = kind === "folder" ? ["result", "error", "inspect-result"] : ["done", "cancelled", "preview-result", "preview-error", "inspect-result", "inspect-error", "fatal-error"];
        if (message.type.includes("error") || message.type === "error") {
          task.failed = true;
          if (/memory|allocation/i.test(message.message ?? "")) this.pressure("memory pressure");
        }
        if (!terminal.includes(message.type)) { task.onMessage(forwarded); return; }
        slot.task = null;
        slot.lastUsed = this.now();
        this.stats[task.failed ? "failed" : "completed"] += 1;
        if (!task.failed) this.record(task);
        this.armIdle(slot);
        this.finish(task, null, forwarded);
        task.onMessage(forwarded);
      });
    });
  }

  pumpSoon() {
    if (this.pendingPump || this.closed) return;
    this.pendingPump = true;
    queueMicrotask(() => {
      this.pendingPump = false;
      if (this.pumping) { this.repump = true; return; }
      this.pumping = true;
      this.pump().catch((error) => {
        this.admissionError = error;
        for (const task of [...this.queue]) { this.stats.failed++; this.finish(task, error); }
      }).finally(() => {
        this.pumping = false;
        if (this.repump) { this.repump = false; this.pumpSoon(); }
      });
    });
  }

  async pump() {
    if (this.closed) return;
    if (this.admissionError) {
      const error = new Error(`Processing coordination failed: ${this.admissionError.message}`);
      for (const task of [...this.queue]) { this.stats.failed++; this.finish(task, error); }
      return;
    }
    await this.admission?.publish();
    const time = this.now();
    // One priority step every two seconds eventually admits background work.
    this.queue.sort((a, b) => (a.priority - Math.floor((time - a.queuedAt) / 2000)) - (b.priority - Math.floor((time - b.queuedAt) / 2000)) || a.id - b.id);
    // Initial render requests arrive behind asynchronous inspection/claims.
    // Until the first useful result, allow this one provisional cohort to grow
    // with real demand: two waves, half the reported CPU budget (at least two),
    // at most eight. Header-only work cannot trigger it. An absent memory hint
    // keeps a serial start. Every admission still reserves memory and CPU;
    // later changes require the normal comparable-throughput windows.
    if (this.bootstrapAvailable && this.mode === "auto" && this.fixed === null
      && time >= this.cooldownUntil && this.budget.cpu >= 3 && this.budget.memory >= 1024 * MiB) {
      const demand = [...this.queue, ...[...this.slots].map((slot) => slot.task).filter(Boolean)]
        .filter((task) => task.workClass !== "inspect" && task.workClass !== "startup" && task.state !== "finished");
      const wellProvisioned = this.budget.cpu >= AUTO_CONCURRENCY_PROBE_LIMIT && this.budget.memory >= 2 * 1024 * MiB;
      const startLimit = wellProvisioned ? Math.min(AUTO_CONCURRENCY_PROBE_LIMIT, this.budget.cpu) : Math.max(2, Math.floor(this.budget.cpu / 2));
      const initial = Math.min(startLimit, Math.floor(demand.length / 2));
      if (demand.length >= 4 && initial > this.limit) {
        this.limit = initial;
        this.bootstrapStarted = true;
        this.windows.clear();
      }
    }
    this.stats.limitingReason = this.queue.length ? "CPU budget" : "idle";
    for (const task of [...this.queue]) {
      if (task.state !== "queued") continue;
      if (task.estimate.heap + task.estimate.transient + this.retainedBytes() > this.budget.memory) {
        this.stats.failed += 1;
        this.finish(task, new Error("This image exceeds the processing memory budget. Close other images or choose smaller dimensions."));
        continue;
      }
      if (this.usedCpu() + task.estimate.cpu > this.limit) break;
      let slot = [...this.slots].find((candidate) => candidate.kind === task.kind && candidate.ready && !candidate.task);
      const required = () => Math.max(task.estimate.heap, slot?.heap ?? 0) + task.estimate.transient - (slot?.heap ?? 0);
      for (const idle of [...this.slots].filter((candidate) => candidate.ready && !candidate.task && candidate !== slot).sort((a, b) => a.lastUsed - b.lastUsed)) {
        if (this.usedMemory() + required() <= this.budget.memory) break;
        this.retire(idle);
      }
      if (slot && this.usedMemory() + required() > this.budget.memory && slot.heap > task.estimate.heap) {
        this.retire(slot);
        slot = null;
      }
      // Drain toward the oldest eligible request instead of letting an endless
      // stream of smaller tasks keep a larger/foreground task starved.
      if (this.usedMemory() + required() > this.budget.memory) { this.stats.limitingReason = "memory budget"; break; }
      if (this.admission) {
        try {
          let group = [];
          const admitted = await this.admission.admit({ signal: task.admissionController.signal,
            desired: (peers) => {
              if (this.closed || task.state !== "queued" || this.usedCpu() + task.estimate.cpu > this.limit) return null;
              const age = (candidate) => candidate.priority - Math.floor((this.now() - candidate.queuedAt) / 2000);
              const ordered = [...this.queue].filter((candidate) => candidate.state === "queued").sort((a, b) => age(a) - age(b) || a.id - b.id);
              if (ordered[0] !== task) return null;
              slot = [...this.slots].find((candidate) => candidate.kind === task.kind && candidate.ready && !candidate.task);
              const memory = this.usedMemory() + required();
              if (memory > this.budget.memory) return null;
              const first = { cpu: this.usedCpu() + task.estimate.cpu, memory };
              group = [];
              // Reserve a bounded group in one origin turn. This avoids a
              // round-trip lock transaction per tiny image while retaining
              // the shared ceiling and FIFO turns between tabs.
              let totalCpu = this.usedCpu(), totalMemory = this.usedMemory();
              const claimed = new Set();
              for (const next of ordered) {
                const idle = [...this.slots].find((candidate) => candidate.kind === next.kind && candidate.ready && !candidate.task && !claimed.has(candidate));
                const increment = Math.max(next.estimate.heap, idle?.heap ?? 0) + next.estimate.transient - (idle?.heap ?? 0);
                if (totalCpu + next.estimate.cpu > Math.min(this.limit, peers.cpuBudget - peers.cpu)
                  || totalMemory + increment > Math.min(this.budget.memory, peers.memoryBudget - peers.memory)) break;
                group.push({ task: next, slot: idle });
                if (idle) claimed.add(idle);
                totalCpu += next.estimate.cpu; totalMemory += increment;
              }
              return group.length ? { cpu: totalCpu, memory: totalMemory } : first;
            }, commit: () => { for (const entry of group) this.dispatch(entry.task, entry.slot); } });
          if (!admitted && task.state === "queued") { this.repump = true; break; }
        } catch (error) {
          if (task.state !== "finished") { this.stats.failed++; this.finish(task, error); }
          if (error.name !== "AbortError") throw error;
        }
      } else this.dispatch(task, slot);
    }
    this.emit();
  }

  dispatch(task, slot) {
    if (this.closed || task.state !== "queued") return;
    task.state = "starting";
    this.queue = this.queue.filter((candidate) => candidate !== task);
    if (slot) this.run(slot, task);
    else {
      // Reserve the task before another pump can start another worker.
      let promise;
      try { promise = this.startSlot(task.kind); }
      catch (error) { this.stats.failed += 1; this.finish(task, error); return; }
      slot = [...this.slots].at(-1);
      slot.task = task;
      promise.then((readySlot) => this.run(readySlot, task)).catch((error) => this.finish(task, error));
    }
  }

  async run(slot, task) {
    if (task.state === "finished" || !this.slots.has(slot)) return;
    if (task.startupOnly) {
      slot.task = null;
      this.armIdle(slot);
      this.finish(task, null, this.capabilities);
      return;
    }
    clearTimeout(slot.idleTimer);
    slot.task = task;
    if (this.usedMemory() > this.budget.memory) {
      this.retire(slot);
      this.stats.failed += 1;
      this.finish(task, new Error("The image engine exceeds the processing memory budget."));
      return;
    }
    task.startedAt = this.now();
    task.startedLimit = this.limit;
    task.timer = setTimeout(() => {
      this.retire(slot);
      this.stats.failed += 1;
      this.finish(task, new Error("Processing timed out. Retry this image."));
    }, this.taskTimeout);
    try {
      // Browser file/asset reads may not be abortable. If cancellation retires
      // the worker, keep a conservative memory credit until preparation really
      // settles; a late read must not allocate outside the shared ledger.
      const preparation = Promise.resolve().then(() => task.state === "finished" ? null : task.prepare());
      this.preparing.set(task, preparation);
      let prepared;
      try { prepared = await preparation; }
      finally { this.preparing.delete(task); this.syncOrigin(); this.pumpSoon(); }
      if (task.state === "finished") return;
      task.packet = { ...prepared.message };
      task.originalRevision = task.packet.revision;
      task.wireRevision = ++this.dispatchSequence;
      if (task.kind === "image") task.packet.revision = task.wireRevision;
      task.packet.memoryEstimate = task.estimate;
      task.state = "running";
      slot.worker.postMessage(task.packet, prepared.transfer ?? []);
    } catch (error) {
      if (task.state === "finished") return;
      slot.task = null;
      this.stats.failed += 1;
      this.armIdle(slot);
      this.finish(task, error);
    }
  }

  record(task) {
    const time = this.now();
    if (this.bootstrapStarted && !["inspect", "startup"].includes(task.workClass)) {
      this.bootstrapAvailable = false; this.bootstrapStarted = false;
    }
    const sample = { kind: task.kind, workClass: task.workClass, elapsedMs: Math.max(0, time - task.startedAt), queueMs: Math.max(0, task.startedAt - task.queuedAt), limit: task.startedLimit };
    this.samples.push(sample);
    if (this.samples.length > 64) this.samples.shift();
    if (this.mode !== "auto" || this.fixed !== null || time < this.cooldownUntil || !this.queue.length
      || task.workClass === "inspect" || task.startedLimit !== this.limit) return;
    // Header reads and other image sizes naturally interleave with renders.
    // Keep a bounded window per comparable class instead of erasing it at
    // every class transition. Windows use wall time, including intervening work.
    const key = `${task.kind}:${task.workClass}`;
    // A lower-count trial must be compared with the same work family. Another
    // class cannot certify or reverse a trial it has not measured.
    if (this.downProbe && key !== this.downProbe.key) return;
    let window = this.windows.get(key);
    if (!window || window.limit !== this.limit) window = { workClass: task.workClass, limit: this.limit, startedAt: task.startedAt, completed: 0 };
    this.windows.delete(key); this.windows.set(key, window);
    if (this.windows.size > 16) this.windows.delete(this.windows.keys().next().value);
    window.completed += 1;
    if (window.completed < 8 || time - window.startedAt < 250) return;
    this.bootstrapAvailable = false;
    const measured = { ...window, rate: window.completed / Math.max(1, time - window.startedAt) };
    const previous = this.previousWindows.get(key);
    measured.floor = Math.min(measured.limit, previous?.floor ?? measured.limit);
    if (this.downProbe) {
      const { baseline } = this.downProbe;
      if (measured.rate * 1.05 >= baseline.rate) {
        this.previousWindows.set(key, measured);
        this.limit = Math.max(1, Math.floor(measured.limit / 2));
        this.downProbe = measured.limit > 1 ? { key, baseline: measured } : null;
        if (!this.downProbe) this.cooldownUntil = time + 30_000;
      } else {
        this.limit = baseline.limit;
        this.previousWindows.set(key, { ...baseline, floor: measured.floor });
        this.downProbe = null; this.cooldownUntil = time + 30_000;
      }
    } else if (previous && previous.workClass === measured.workClass && measured.limit > previous.limit && measured.rate < previous.rate * 1.05) {
      // A resource-based starting guess has no measured smaller baseline.
      // When expansion fails, challenge that guess instead of permanently
      // keeping extra workers on serialized/one-worker-optimal workloads.
      if (previous.limit > 1 && previous.floor === previous.limit) {
        this.downProbe = { key, baseline: previous };
        this.limit = Math.max(1, Math.floor(previous.limit / 2));
      } else {
        this.limit = previous.limit;
        this.cooldownUntil = time + 30_000;
      }
    } else {
      this.previousWindows.delete(key); this.previousWindows.set(key, measured);
      if (this.previousWindows.size > 16) this.previousWindows.delete(this.previousWindows.keys().next().value);
      let nextLimit = Math.min(this.budget.cpu, this.limit * 2);
      const comparableQueued = this.queue.filter((candidate) => candidate.state === "queued"
        && candidate.kind === task.kind && candidate.workClass === task.workClass).length;
      if (nextLimit > AUTO_CONCURRENCY_PROBE_LIMIT && comparableQueued < AUTO_CONCURRENCY_PROBE_LIMIT) {
        // A short class can reach eight workers, but a larger pool only helps
        // when at least one full comparable wave is still waiting to start.
        nextLimit = this.limit < AUTO_CONCURRENCY_PROBE_LIMIT ? AUTO_CONCURRENCY_PROBE_LIMIT : this.limit;
      }
      this.limit = nextLimit;
    }
    this.windows.clear();
    this.pumpSoon();
  }

  pressure(reason = "interaction latency") {
    this.bootstrapAvailable = false; this.bootstrapStarted = false; this.downProbe = null;
    if (this.fixed === null) this.limit = Math.max(1, Math.floor(this.limit / 2));
    this.cooldownUntil = this.now() + 30_000;
    this.windows.clear(); this.previousWindows.clear();
    this.stats.limitingReason = reason;
    this.pumpSoon();
  }

  close() {
    this.closed = true;
    for (const task of [...this.queue, ...[...this.slots].map((slot) => slot.task).filter(Boolean)]) this.cancel(task);
    for (const slot of this.slots) this.retire(slot);
    this.listeners.clear();
    return Promise.allSettled([...this.preparing.values()]).then(() => this.admission?.close());
  }
}
