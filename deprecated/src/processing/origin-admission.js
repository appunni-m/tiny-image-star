// Web Locks are the live ledger, not just a mutex around expiring records.
// A closed/crashed context releases its reservations through the browser.
const PREFIX = "tiny-image-star.processing.v1/";
const abortError = () => Object.assign(new Error("Processing cancelled."), { name: "AbortError" });
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;

function hold(locks, name) {
  let release, granted, failed;
  const lifetime = new Promise((resolve) => { release = resolve; });
  const ready = new Promise((resolve, reject) => { granted = resolve; failed = reject; });
  const released = locks.request(name, () => { granted(); return lifetime; });
  released.catch(failed);
  return ready.then(() => ({ name, release: async () => { release(); await released; } }));
}

function row(name) {
  if (!name.startsWith(`${PREFIX}held/`)) return null;
  const parts = name.slice(PREFIX.length).split("/");
  if (parts.length !== 7) throw new Error("Unrecognized processing reservation. Reload other editor tabs.");
  const [cpu, memory, cpuBudget, memoryBudget] = parts.slice(3).map(Number);
  if (![cpu, memory, cpuBudget, memoryBudget].every(validCount) || !cpuBudget || !memoryBudget) {
    throw new Error("Invalid processing reservation. Reload other editor tabs.");
  }
  return { cpu, memory, cpuBudget, memoryBudget };
}

export class OriginAdmission {
  constructor({ locks, budget, usage, onPressure = () => {}, onChange = () => {}, channelFactory,
    id = crypto.randomUUID(), pollMs = 250 } = {}) {
    this.locks = locks;
    this.budget = budget;
    this.usage = usage;
    this.onPressure = onPressure;
    this.onChange = onChange;
    this.prefix = `${PREFIX}held/${id}/`;
    this.sequence = 0;
    this.serial = Promise.resolve();
    this.controller = new AbortController();
    this.waiters = new Set();
    this.pollMs = pollMs;
    this.status = { scope: "origin", waiting: false, reason: null };
    try { this.channel = channelFactory?.(`${PREFIX}changes`); } catch { this.channel = null; }
    if (this.channel) this.channel.onmessage = ({ data }) => {
      if (data !== "changed" && data !== "pressure") return;
      if (data === "pressure") this.onPressure();
      this.wake();
    };
  }

  snapshot() { return { ...this.status }; }
  exclusive(operation) {
    const result = this.serial.then(operation);
    this.serial = result.catch(() => {});
    return result;
  }
  wake() { for (const resolve of [...this.waiters]) resolve(); }
  changed() { this.channel?.postMessage("changed"); this.wake(); }

  async replace(usage) {
    const next = { cpu: Math.ceil(usage.cpu), memory: Math.ceil(usage.memory) };
    if (![next.cpu, next.memory, this.budget.cpu, this.budget.memory].every(validCount)) throw new Error("Invalid processing resource count.");
    const suffix = `${next.cpu}/${next.memory}/${this.budget.cpu}/${this.budget.memory}`;
    if (this.reservation?.name.endsWith(`/${suffix}`)) return;
    const replacement = await hold(this.locks, `${this.prefix}${++this.sequence}/${suffix}`);
    const previous = this.reservation;
    this.reservation = replacement;
    await previous?.release();
    this.changed();
  }

  // Observations may grow after an estimate (retained previews, actual heaps).
  // Publish them even over budget; no subsequent work may ignore that debt.
  publish() {
    if (this.controller.signal.aborted) return Promise.resolve();
    this.dirty = true;
    if (!this.publishing) this.publishing = (async () => {
      while (this.dirty && !this.controller.signal.aborted) {
        this.dirty = false;
        await this.exclusive(async () => {
          if (!this.controller.signal.aborted) await this.replace(this.usage());
        });
      }
    })().finally(() => { this.publishing = null; });
    return this.publishing;
  }

  async totals() {
    const { held } = await this.locks.query();
    const result = { cpu: 0, memory: 0, cpuBudget: this.budget.cpu, memoryBudget: this.budget.memory, peers: 0 };
    for (const lock of held) {
      if (lock.name.startsWith(this.prefix)) continue;
      const value = row(lock.name);
      if (!value) continue;
      result.cpu += value.cpu; result.memory += value.memory; result.peers++;
      result.cpuBudget = Math.min(result.cpuBudget, value.cpuBudget);
      result.memoryBudget = Math.min(result.memoryBudget, value.memoryBudget);
    }
    return result;
  }

  wait(signal) {
    return new Promise((resolve) => {
      let timer;
      const done = () => { clearTimeout(timer); this.waiters.delete(done); signal?.removeEventListener("abort", done); this.controller.signal.removeEventListener("abort", done); resolve(); };
      this.waiters.add(done);
      signal?.addEventListener("abort", done, { once: true });
      this.controller.signal.addEventListener("abort", done, { once: true });
      timer = setTimeout(done, this.pollMs);
      if (signal?.aborted || this.controller.signal.aborted) done();
    });
  }

  async admit({ desired, commit, signal }) {
    const controller = new AbortController();
    const abort = () => { controller.abort(); this.wake(); };
    signal?.addEventListener("abort", abort, { once: true });
    this.controller.signal.addEventListener("abort", abort, { once: true });
    if (signal?.aborted || this.controller.signal.aborted) abort();
    this.status.waiting = true; this.status.reason = "resource admission";
    this.onChange();
    try {
      // Hold the FIFO admission turn while draining toward this request. Other
      // tabs can publish reductions and release workers without this lock.
      return await this.locks.request(`${PREFIX}admit`, { signal: controller.signal }, async () => {
        while (!controller.signal.aborted) {
          const result = await this.exclusive(async () => {
            if (controller.signal.aborted) throw abortError();
            const totals = await this.totals();
            const requested = desired(totals);
            if (!requested) return "changed";
            const current = this.usage();
            const reason = totals.cpu + requested.cpu > totals.cpuBudget ? "CPU in other tabs"
              : totals.memory + requested.memory > totals.memoryBudget ? "memory in other tabs" : null;
            this.status = { scope: "origin", waiting: Boolean(reason), reason, ...totals,
              cpu: totals.cpu + current.cpu, memory: totals.memory + current.memory };
            if (reason) return false;
            await this.replace(requested);
            const latest = desired(totals);
            if (controller.signal.aborted || !latest || latest.cpu > requested.cpu || latest.memory > requested.memory) {
              await this.replace(this.usage()); return "changed";
            }
            commit();
            return true;
          });
          this.onChange();
          if (result) return result === true;
          this.onPressure();
          this.channel?.postMessage("pressure");
          await this.wait(controller.signal);
        }
        throw abortError();
      });
    } finally {
      this.status.waiting = false; this.status.reason = null;
      signal?.removeEventListener("abort", abort);
      this.controller.signal.removeEventListener("abort", abort);
    }
  }

  close() {
    this.controller.abort(); this.wake(); this.channel?.close(); this.channel = null;
    return this.exclusive(async () => { await this.reservation?.release(); this.reservation = null; });
  }
}

export function createOriginAdmission(pool, { locks = globalThis.navigator?.locks, channelFactory = globalThis.BroadcastChannel ? (name) => new BroadcastChannel(name) : null } = {}) {
  if (!locks?.request || !locks?.query) return null;
  return new OriginAdmission({ locks, budget: pool.budget, channelFactory,
    usage: () => ({ cpu: pool.usedCpu(), memory: pool.usedMemory() }),
    onPressure: () => pool.releaseIdle(), onChange: () => pool.emit() });
}
