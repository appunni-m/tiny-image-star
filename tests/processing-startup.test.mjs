import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { ResourceScheduler } from "../src/processing/scheduler.js";
import { MiB } from "../src/processing/policy.js";

const tick = async () => { await setImmediate(); await setImmediate(); };
const small = { cpu: 1, heap: 40 * MiB, transient: 8 * MiB, output: 2 * MiB };
function fixture(t, options = {}) {
  let now = 0, next = 0; const workers = [], tasks = [];
  class Worker extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.send({ type: "ready", heapBytes: 32 * MiB })); }
    send(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
    postMessage(data) { this.packet = data; }
    terminate() { this.closed = true; }
    finish() { const packet = this.packet; this.packet = null; this.send({ type: "done", revision: packet.revision, heapBytes: 40 * MiB }); }
  }
  const pool = new ResourceScheduler({ workerFactory: () => { const worker = new Worker(); workers.push(worker); return worker; },
    now: () => now, hints: { hardwareConcurrency: 12, deviceMemory: 16 }, ...options });
  t.after(() => pool.close());
  const add = (count, extra = {}) => {
    const added = Array.from({ length: count }, () => pool.enqueue({ kind: "image", estimate: small, workClass: "same-render",
      prepare: () => ({ message: { type: "process", revision: ++next } }), ...extra })); tasks.push(...added); return added;
  };
  const active = () => workers.filter(w => w.packet && !w.closed);
  const advance = milliseconds => { now += milliseconds; };
  const stop = async () => { tasks.forEach(task => task.cancel()); await Promise.allSettled(tasks.map(task => task.promise)); await tick(); };
  return { pool, add, active, advance, stop, tasks };
}

test("initial Auto admission follows real arrivals, then stops speculative growth at the first useful result", async t => {
  const { pool, add, active, advance, stop } = fixture(t);
  add(4); await tick(); assert.equal(active().length, 2);
  add(6); await tick(); assert.equal(active().length, 5, "five workers fit two waves of substantive work and half the reported CPU budget");
  advance(500); active()[0].finish(); await tick();
  add(64); await tick(); assert.equal(pool.snapshot().limit, 5, "later growth still needs a completed throughput window");
  await stop();
});

test("a completed short probe cannot be enlarged merely by later arrivals or header inspection", async t => {
  const { pool, add, active, advance, stop } = fixture(t);
  add(4); await tick(); advance(100); active()[0].finish(); await tick();
  add(40, { workClass: "inspect" }); add(40); await tick();
  assert.equal(pool.snapshot().limit, 2); await stop();
});

test("cancelled initial work and pressure do not reopen the speculative arrival phase", async t => {
  const { pool, add, advance, stop } = fixture(t);
  add(4); await tick(); await stop();
  add(40); await tick(); assert.equal(pool.snapshot().limit, 2, "a cancelled initial probe is not restarted by another batch");
  pool.pressure("interaction latency"); advance(31_000); pool.configure({ mode: "auto" });
  add(40); await tick(); assert.equal(pool.snapshot().limit, 1); await stop();
});

test("a wider initial limit still counts retained sources, terminal outputs and actual reads against memory", async t => {
  const { pool, add, active, stop } = fixture(t, { hints: { hardwareConcurrency: 12, deviceMemory: 8 } });
  pool.setRetainedBytes("project", 200 * MiB); let reads = 0;
  pool.subscribe(s => assert.ok(s.estimatedBytes <= s.memoryBudget));
  add(10, { estimate: { cpu: 1, heap: 420 * MiB, transient: 80 * MiB, output: 40 * MiB }, prepare: () => { reads++; return { message: { type: "process" } }; } });
  await tick(); assert.equal(active().length, 1); assert.equal(reads, 1);
  const worker = active()[0]; worker.send({ type: "file-result", revision: worker.packet.revision }); await tick();
  assert.equal(reads, 1, "an uncommitted output cannot release its reservation"); await stop();
});

for (const capacity of [1, 2]) {
  test(`Auto challenges an unproven initial size when ${capacity} workers already saturate useful throughput`, async t => {
    const { pool, add, active, advance, stop } = fixture(t);
    add(200); await tick();
    let reached = false;
    for (let wave = 0; wave < 60 && active().length; wave++) {
      const cohort = active(); advance(100 * Math.max(1, cohort.length / capacity));
      for (const worker of cohort) worker.finish(); await tick();
      if (pool.snapshot().limit === capacity && pool.cooldownUntil > 0) { reached = true; break; }
    }
    assert.ok(reached, `a resource hint must not permanently retain a needlessly large pool when only ${capacity} workers help`);
    await stop();
  });
}

for (const ending of ["cancel", "drain"]) test(`an unfinished downward probe restores the measured good limit on ${ending}`, async t => {
  const { pool, add, active, advance, stop, tasks } = fixture(t);
  add(100); await tick(); const initial = pool.snapshot().limit;
  let lower = false;
  for (let wave = 0; wave < 15 && active().length; wave++) {
    const cohort = active(); advance(100 * cohort.length); for (const worker of cohort) worker.finish(); await tick();
    if (pool.snapshot().limit < initial) { lower = true; break; }
  }
  assert.ok(lower, "failed expansion should test whether fewer than the provisional initial workers suffice");
  if (ending === "cancel") await stop();
  else { tasks.filter(task => task.state === "queued").forEach(task => task.cancel()); advance(100); for (const worker of active()) worker.finish(); await tick(); }
  assert.equal(pool.snapshot().limit, initial, "no incomplete measurement becomes a retained concurrency choice");
});

test("the initial eight-worker bound does not cap later measured concurrency on a larger budget", async t => {
  const { pool, add, active, advance, stop } = fixture(t, { hints: { hardwareConcurrency: 33, deviceMemory: 16 } });
  add(80); await tick(); assert.equal(active().length, 8);
  advance(300); for (const worker of active()) worker.finish(); await tick();
  assert.equal(pool.snapshot().limit, 16); assert.equal(active().length, 16);
  pool.subscribe(s => { assert.ok(s.estimatedBytes <= s.memoryBudget); assert.ok(s.active <= s.cpuBudget); });
  await stop();
});

test("another work class cannot certify a lower-count trial, and pressure cancels its old baseline", async t => {
  // Keep this policy trace on the conservative start; it isolates class fencing.
  const { pool, add, active, advance, stop } = fixture(t, { hints: { hardwareConcurrency: 12, deviceMemory: 8 } });
  add(100); await tick();
  for (let wave = 0; wave < 15 && !pool.downProbe; wave++) {
    const cohort = active(); advance(100 * cohort.length); for (const worker of cohort) worker.finish(); await tick();
  }
  assert.ok(pool.downProbe); const trial = pool.snapshot().limit;
  // Keep this injected family ahead of already-aged queued work so the probe
  // receives fewer than eight completions of its own class during this check.
  add(20, { priority: -10, workClass: "different-render" });
  for (let wave = 0; wave < 10; wave++) { advance(100); for (const worker of active()) worker.finish(); await tick(); }
  assert.ok(pool.samples.filter(s => s.workClass === "different-render").length >= 8);
  assert.equal(pool.snapshot().limit, trial); assert.ok(pool.downProbe);
  pool.pressure("slow input"); assert.equal(pool.downProbe, null); const reduced = pool.snapshot().limit;
  await stop(); assert.equal(pool.snapshot().limit, reduced, "draining cannot resurrect the pre-pressure baseline");
});
