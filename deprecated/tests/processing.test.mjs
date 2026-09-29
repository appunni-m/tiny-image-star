import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { ResourceScheduler } from "../src/processing/scheduler.js";
import { deviceBudget, imageWork, inspectionWork, MiB } from "../src/processing/policy.js";

const small = { heap: 40 * MiB, transient: 8 * MiB, output: 2 * MiB, cpu: 1 };
const tick = async () => { await nextTurn(); await nextTurn(); };

function harness(options = {}) {
  const workers = [];
  class FakeWorker extends EventTarget {
    constructor(kind) {
      super(); this.kind = kind; this.packets = []; this.terminated = false;
      queueMicrotask(() => this.send({ type: "ready", inputFormats: ["png"], outputFormats: ["png"], heapBytes: 32 * MiB }));
    }
    send(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
    postMessage(packet) { assert.equal(this.terminated, false); this.packets.push(packet); this.current = packet; }
    terminate() { this.terminated = true; }
    finish(extra = {}) {
      const packet = this.current;
      assert.ok(packet, "only running work can finish"); this.current = null;
      this.send({ type: this.kind === "folder" ? "result" : "done", revision: packet.revision, jobId: packet.jobId, index: packet.entry?.index, heapBytes: 40 * MiB, ...extra });
    }
  }
  const pool = new ResourceScheduler({ hints: { hardwareConcurrency: 16, deviceMemory: 16 },
    workerFactory: (kind) => { const worker = new FakeWorker(kind); workers.push(worker); return worker; }, ...options });
  const submit = (id, extra = {}) => pool.enqueue({ kind: "image", estimate: small,
    prepare: () => ({ message: { type: "process", revision: id, jobId: `job-${id}`, files: [{ id }] } }), ...extra });
  const active = () => workers.filter((worker) => worker.current && !worker.terminated);
  return { pool, workers, submit, active };
}

test("admission defers copies, shares CPU across worker kinds, and reuses an idle engine", async (t) => {
  const { pool, submit, workers, active } = harness(); t.after(() => pool.close());
  pool.configure({ fixedConcurrency: 1 });
  let prepared = 0;
  const first = submit(10, { prepare: () => { prepared++; return { message: { type: "process", revision: 10 } }; } });
  const second = submit(1, { kind: "folder", prepare: () => { prepared++; return { message: { type: "process", jobId: "folder", entry: { index: 1 } } }; } });
  await tick(); assert.equal(prepared, 1); assert.equal(active().length, 1);
  active()[0].finish(); await first.promise; await tick();
  assert.equal(prepared, 2); assert.equal(active().length, 1); assert.equal(active()[0].kind, "folder");
  active()[0].finish(); await second.promise;
  const third = submit(0); await tick();
  assert.equal(workers.length, 2, "one engine per kind is reused across jobs");
  assert.ok(active()[0].current.revision > 1, "wire revisions grow even when client revisions go backwards");
  active()[0].finish(); await third.promise;
});

test("current-image priority, FIFO ties, and aging prevent starvation", async (t) => {
  let time = 0;
  const { pool, submit, active } = harness({ now: () => time }); t.after(() => pool.close());
  const blocker = submit(1); await tick();
  const background = submit(2, { priority: 2 });
  const foreground = submit(3, { priority: 0 });
  active()[0].finish(); await blocker.promise; await tick();
  assert.equal(active()[0].current.jobId, "job-3");
  time = 8000;
  const newer = submit(4, { priority: 0 });
  active()[0].finish(); await foreground.promise; await tick();
  assert.equal(active()[0].current.jobId, "job-2", "aged background work precedes a new foreground request");
  active()[0].finish(); await background.promise; await tick();
  active()[0].finish(); await newer.promise;
});

test("memory admission counts retained data, active output and idle heaps", async (t) => {
  const { pool, submit, active } = harness(); t.after(() => pool.close());
  pool.budget.memory = 180 * MiB;
  pool.configure({ fixedConcurrency: 8 });
  pool.setRetainedBytes("previews", 40 * MiB);
  let maximum = 0;
  pool.subscribe((snapshot) => { maximum = Math.max(maximum, snapshot.estimatedBytes); assert.ok(snapshot.estimatedBytes <= pool.budget.memory); });
  const jobs = Array.from({ length: 5 }, (_, i) => submit(i)); await tick();
  assert.equal(active().length, 2);
  assert.equal(pool.snapshot().queued, 3);
  assert.equal(pool.snapshot().pendingOutputBytes, 4 * MiB);
  while (pool.snapshot().active || pool.snapshot().queued) {
    for (const worker of active()) worker.finish();
    await tick();
  }
  await Promise.all(jobs.map((job) => job.promise));
  assert.ok(maximum > 100 * MiB);
  const tooLarge = submit(6, { estimate: { ...small, heap: 200 * MiB } });
  await assert.rejects(tooLarge.promise, /memory budget/);
});

test("explicit high concurrency is not capped at four and never exceeds CPU tokens", async (t) => {
  const { pool, submit, active } = harness(); t.after(() => pool.close());
  pool.configure({ mode: "max-speed" });
  const jobs = Array.from({ length: 24 }, (_, i) => submit(i)); await tick();
  assert.equal(active().length, 15);
  assert.equal(pool.snapshot().queued, 9);
  while (pool.snapshot().active || pool.snapshot().queued) { for (const worker of active()) worker.finish(); await tick(); }
  await Promise.all(jobs.map((job) => job.promise));
  assert.equal(pool.snapshot().completed, 24);
});

test("text admission includes its RGBA surfaces and custom fonts before dispatch", async (t) => {
  const source = { width: 1920, height: 1080, encodedBytes: MiB };
  const plain = imageWork(source);
  const text = imageWork({ ...source, settings: { textLayers: [{ fontId: "font-0123456789abcdef", fontBytes: 2 * MiB }] } });
  assert.ok(text.heap > plain.heap && text.transient > plain.transient + 12 * MiB);
  const { pool, submit, active } = harness(); t.after(() => pool.close());
  pool.budget.memory = text.heap + text.transient + text.output + 4 * MiB;
  pool.configure({ fixedConcurrency: 8 });
  const tasks = [submit(1, { estimate: text }), submit(2, { estimate: text })];
  await tick(); assert.equal(active().length, 1, "text surface reservations reduce concurrency before allocating");
  active()[0].finish(); await tasks[0].promise; await tick();
  active()[0].finish(); await tasks[1].promise;
  assert.throws(() => imageWork({ ...source, settings: { textLayers: [{ fontId: "font-0123456789abcdef", fontBytes: 17 * MiB }] } }), /font limit/);
  assert.throws(() => imageWork({ ...source, settings: { textLayers: Array.from({ length: 101 }, () => ({})) } }), /100 text/);
});

test("cancel kills synchronous work, drops stale messages, and does not prepare queued sources", async (t) => {
  const { pool, submit, active, workers } = harness(); t.after(() => pool.close());
  let forwarded = 0;
  const first = submit(1, { onMessage: () => forwarded++ }); await tick();
  const old = active()[0];
  const neverRead = submit(2, { prepare: () => { throw new Error("cancelled task was prepared"); } });
  neverRead.cancel(); first.cancel();
  await assert.rejects(first.promise, { name: "AbortError" });
  await assert.rejects(neverRead.promise, { name: "AbortError" });
  assert.equal(old.terminated, true);
  old.finish(); assert.equal(forwarded, 0);
  const replacement = submit(3); await tick();
  assert.equal(workers.length, 2); active()[0].finish(); await replacement.promise;
});

test("worker death and task timeout release all reservations and permit retry", async (t) => {
  const { pool, submit, active } = harness({ taskTimeout: 25 }); t.after(() => pool.close());
  const failed = submit(1); await tick();
  active()[0].dispatchEvent(new Event("error"));
  await assert.rejects(failed.promise, /stopped unexpectedly/);
  assert.equal(pool.snapshot().active, 0);
  const timedOut = submit(2);
  await assert.rejects(timedOut.promise, /timed out/);
  assert.equal(pool.snapshot().workers, 0);
  const retry = submit(3); await tick(); active()[0].finish(); await retry.promise;
});

test("cancelled asynchronous source reads retain memory credit until they settle", async (t) => {
  const { pool, submit, active } = harness(); t.after(() => pool.close());
  pool.budget.memory = 70 * MiB;
  let releaseRead, reads = 0;
  const reading = new Promise((resolve) => { releaseRead = resolve; });
  const first = submit(1, { prepare: async () => { reads++; await reading; return { message: { type: "process", revision: 1 } }; } });
  await tick(); assert.equal(reads, 1);
  first.cancel(); await assert.rejects(first.promise, { name: "AbortError" });
  assert.equal(pool.snapshot().workers, 0);
  assert.equal(pool.snapshot().pendingReadBytes, small.heap + small.transient);
  const next = submit(2, { prepare: () => { reads++; return { message: { type: "process", revision: 2 } }; } });
  await tick(); assert.equal(reads, 1, "a cancelled read cannot overlap an unbudgeted new read");
  releaseRead(); await tick();
  assert.equal(pool.snapshot().pendingReadBytes, 0); assert.equal(reads, 2);
  active()[0].finish(); await next.promise;
});

test("reentrant completion can close a logical client without destroying reusable workers", async (t) => {
  const { pool, submit, active, workers } = harness(); t.after(() => pool.close());
  let job;
  job = submit(1, { onMessage: () => job.cancel() }); await tick();
  active()[0].finish(); await job.promise;
  assert.equal(workers[0].terminated, false);
  assert.equal(pool.snapshot().cancelled, 0);
});

test("closing during a grouped worker-start failure cannot dispatch later cancelled tasks", async () => {
  let starts = 0;
  const { pool, submit } = harness({ workerFactory: () => { starts++; throw new Error("Engine startup denied"); },
    admissionFactory: (pool) => ({ publish: async () => {}, wake() {}, snapshot: () => ({ scope: "origin" }), close() {},
      async admit({ desired, commit }) { desired({ cpu: 0, memory: 0, cpuBudget: pool.budget.cpu, memoryBudget: pool.budget.memory }); commit(); return true; } }) });
  pool.configure({ fixedConcurrency: 3 });
  pool.subscribe((state) => { if (state.failed && !pool.closed) void pool.close(); });
  const first = submit(1), second = submit(2);
  const results = await Promise.allSettled([first.promise, second.promise]);
  assert.equal(results[0].reason.message, "Engine startup denied");
  assert.equal(results[1].reason.name, "AbortError");
  assert.equal(starts, 1, "a grouped admission must respect synchronous close/cancel during dispatch");
  assert.equal(pool.snapshot().active, 0);
});

test("allocation estimates reject oversized sources and budget the full current preview path", () => {
  assert.throws(() => inspectionWork(161 * MiB), /too large/);
  assert.throws(() => imageWork({ width: 10_000, height: 10_000 }), /too large/);
  const preview = imageWork({ width: 4000, height: 3000, encodedBytes: MiB, preview: true });
  assert.ok(preview.heap > 12_000_000 * 16);
  assert.ok(preview.output > 12_000_000 * 4);
  assert.equal(deviceBudget({ hardwareConcurrency: 1 }).cpu, 1);
  assert.equal(deviceBudget({ hardwareConcurrency: 32, deviceMemory: 16 }).cpu, 31);
});

test("Auto grows on useful work, retreats without throughput gain, and observes cooldown", async (t) => {
  let time = 0;
  const { pool, submit, active } = harness({ now: () => time, hints: { hardwareConcurrency: 16 } }); t.after(() => pool.close());
  const jobs = Array.from({ length: 64 }, (_, i) => submit(i, { workClass: "same-render" }));
  await tick();
  for (let i = 0; i < 8; i++) { time += 100; active()[0].finish(); await tick(); }
  assert.equal(pool.snapshot().limit, 2);
  // Two workers take twice as long per image: no completion-rate improvement.
  for (let i = 0; i < 4; i++) { time += 200; for (const worker of active()) worker.finish(); await tick(); }
  assert.equal(pool.snapshot().limit, 1);
  for (let i = 0; i < 10; i++) { time += 100; active()[0].finish(); await tick(); }
  assert.equal(pool.snapshot().limit, 1, "cooldown prevents immediate oscillation");
  pool.configure({ mode: "max-speed" });
  pool.pressure("interaction latency");
  assert.equal(pool.snapshot().limit, 7);
  for (const job of jobs) job.cancel();
  await Promise.allSettled(jobs.map((job) => job.promise));
});

test("interleaved header inspection and mixed image sizes do not erase Auto calibration", async (t) => {
  let time = 0;
  const { pool, submit, active } = harness({ now: () => time, hints: { hardwareConcurrency: 16 } }); t.after(() => pool.close());
  const jobs = Array.from({ length: 96 }, (_, i) => submit(i, { workClass: ["inspect", "render:small", "render:camera"][i % 3] }));
  await tick();
  for (let i = 0; i < 24; i++) { time += 100; active()[0].finish(); await tick(); }
  assert.ok(pool.snapshot().limit > 1, "comparable image completions accumulate across normal preflight and mixed-source work");
  for (const job of jobs) job.cancel(); await Promise.allSettled(jobs.map((j) => j.promise));
});

test("Auto probes eight workers before expanding beyond a short comparable backlog", async (t) => {
  let time = 0;
  const { pool, submit, active } = harness({ now: () => time, hints: { hardwareConcurrency: 12, deviceMemory: 16 } }); t.after(() => pool.close());
  const jobs = Array.from({ length: 16 }, (_, i) => submit(i, { workClass: "same-render" }));
  await tick();
  assert.equal(pool.budget.cpu, 11);
  while (pool.snapshot().active > 0) {
    time += 100;
    for (const worker of active()) worker.finish();
    await tick();
    assert.ok(pool.snapshot().limit <= 8);
    assert.ok(active().length <= 8);
  }
  await Promise.all(jobs.map((job) => job.promise));
  assert.equal(pool.snapshot().limit, 8, "a measured burst can still use the eight-worker probe");
});

test("header-only work does not calibrate image throughput", async (t) => {
  let time = 0;
  const { pool, submit, active } = harness({ now: () => time }); t.after(() => pool.close());
  const jobs = Array.from({ length: 24 }, (_, i) => submit(i, { workClass: "inspect" }));
  await tick();
  for (let i = 0; i < 12; i++) { time += 100; active()[0].finish(); await tick(); }
  assert.equal(pool.snapshot().limit, 1, "cheap metadata reads are not evidence for a larger rendering pool");
  for (const job of jobs) job.cancel(); await Promise.allSettled(jobs.map((j) => j.promise));
});

test("Auto keeps the eight-sample growth gate and checks whether fewer provisional workers suffice", async (t) => {
  let time = 0;
  const { pool, submit, active } = harness({ now: () => time, hints: { hardwareConcurrency: 5, deviceMemory: 16 } }); t.after(() => pool.close());
  const jobs = Array.from({ length: 64 }, (_, i) => submit(i, { workClass: "same-render" }));
  await tick();
  assert.equal(active().length, 2, "a large queued batch can start a bounded two-worker probe");
  for (let round = 0; round < 3; round++) {
    time += 100; for (const worker of active()) worker.finish(); await tick();
    assert.equal(pool.snapshot().limit, 2, "six completions cannot bypass the eight-sample calibration gate");
  }
  time += 100; for (const worker of active()) worker.finish(); await tick();
  assert.equal(pool.snapshot().limit, 4);
  // The probe above two must still retreat if twice as many workers produce
  // the same completion rate, including preparation and terminal output writes.
  for (let round = 0; round < 2; round++) {
    time += 200; for (const worker of active()) worker.finish(); await tick();
  }
  assert.equal(pool.snapshot().limit, 1, "failed expansion challenges the unmeasured initial two-worker guess");
  for (let i = 0; i < 8; i++) { time += 100; active()[0].finish(); await tick(); }
  assert.equal(pool.snapshot().limit, 2, "one worker is slower, so the measured two-worker limit is retained");
  for (const job of jobs) job.cancel(); await Promise.allSettled(jobs.map((job) => job.promise));
});

for (const [label, hints] of [
  ["missing memory hint", { hardwareConcurrency: 16 }],
  ["small memory hint", { hardwareConcurrency: 16, deviceMemory: 4 }],
  ["small CPU hint", { hardwareConcurrency: 2, deviceMemory: 16 }],
]) {
  test(`Auto preserves a serial start with a ${label}`, async (t) => {
    const { pool, submit, active } = harness({ hints }); t.after(() => pool.close());
    const jobs = Array.from({ length: 12 }, (_, i) => submit(i, { workClass: "same-render" }));
    await tick(); assert.equal(active().length, 1); assert.equal(pool.snapshot().limit, 1);
    for (const job of jobs) job.cancel(); await Promise.allSettled(jobs.map((job) => job.promise));
  });
}

test("Auto does not start an extra worker for short edits or from queued inspections", async (t) => {
  const { pool, submit, active } = harness(); t.after(() => pool.close());
  const short = [submit(1), submit(2)];
  const headers = Array.from({ length: 12 }, (_, i) => submit(i + 3, { workClass: "inspect" }));
  await tick(); assert.equal(active().length, 1); assert.equal(pool.snapshot().limit, 1);
  for (const job of [...short, ...headers]) job.cancel();
  await Promise.allSettled([...short, ...headers].map((job) => job.promise));
  const batch = Array.from({ length: 4 }, (_, i) => submit(i + 20));
  await tick(); assert.equal(active().length, 2, "a later substantive batch can use the initial probe");
  for (const job of batch) job.cancel(); await Promise.allSettled(batch.map((job) => job.promise));
});

test("the initial Auto probe cannot bypass retained memory or output reservations", async (t) => {
  const { pool, submit, active } = harness({ hints: { hardwareConcurrency: 8, deviceMemory: 8 } });
  t.after(() => pool.close());
  pool.setRetainedBytes("open-project", 200 * MiB);
  const estimate = { heap: 420 * MiB, transient: 80 * MiB, output: 40 * MiB, cpu: 1 };
  pool.subscribe((state) => assert.ok(state.estimatedBytes <= state.memoryBudget));
  const jobs = Array.from({ length: 6 }, (_, i) => submit(i, { estimate }));
  await tick();
  assert.equal(active().length, 1, "two camera-sized reservations do not fit beside the open project");
  active()[0].send({ type: "file-result", revision: active()[0].current.revision });
  await tick(); assert.equal(active().length, 1, "output arrival does not release the worker's terminal-write credit");
  active()[0].finish(); await jobs[0].promise; await tick();
  assert.equal(active().length, 1);
  for (const job of jobs) job.cancel(); await Promise.allSettled(jobs.map((job) => job.promise));
});

test("pressure suppresses the initial Auto probe even after cooldown and an unchanged configure call", async (t) => {
  let time = 0;
  const { pool, submit, active } = harness({ now: () => time }); t.after(() => pool.close());
  pool.pressure("interaction latency");
  time += 31_000;
  pool.configure({ mode: "auto" });
  const jobs = Array.from({ length: 8 }, (_, i) => submit(i));
  await tick(); assert.equal(active().length, 1); assert.equal(pool.snapshot().limit, 1);
  for (const job of jobs) job.cancel(); await Promise.allSettled(jobs.map((job) => job.promise));
});

test("Auto retains useful concurrency without counting idle time between collections", async (t) => {
  let time = 0;
  const { pool, submit, active } = harness({ now: () => time, hints: { hardwareConcurrency: 16 } }); t.after(() => pool.close());
  const first = Array.from({ length: 26 }, (_, i) => submit(i, { workClass: "same-render" }));
  await tick();
  while (first.some((job) => job.state !== "finished")) {
    time += 100; for (const worker of active()) worker.finish(); await tick();
  }
  await Promise.all(first.map((job) => job.promise));
  assert.equal(pool.snapshot().limit, 4);
  time += 10_000;
  const second = Array.from({ length: 64 }, (_, i) => submit(i, { workClass: "same-render" }));
  await tick();
  for (let round = 0; round < 4; round++) {
    time += 100; for (const worker of active()) worker.finish(); await tick();
    assert.ok(pool.snapshot().limit >= 4, "idle time must not manufacture a throughput regression");
  }
  assert.ok(pool.snapshot().limit > 4, "fresh comparable work can resume calibration");
  for (const job of second) job.cancel(); await Promise.allSettled(second.map((job) => job.promise));
});

for (const ending of ["success", "render-error", "cancel", "prepare-error", "cancel-queued"]) {
  test(`Auto discards an unfinished measurement when the queue drains by ${ending}`, async (t) => {
    let time = 0;
    const { pool, submit, active } = harness({ now: () => time }); t.after(() => pool.close());
    const first = submit(1, { workClass: "same-render" });
    const last = submit(2, { workClass: "same-render",
      ...(ending === "prepare-error" ? { prepare: () => { throw new Error("Source unavailable"); } } : {}) });
    await tick(); time += 100;
    active()[0].finish();
    if (ending === "cancel-queued") { assert.equal(last.state, "queued"); last.cancel(); }
    await first.promise;
    await tick();
    if (ending === "cancel") last.cancel();
    if (ending === "success") active()[0].finish();
    if (ending === "render-error") active()[0].finish({ type: "fatal-error", message: "Invalid source" });
    await Promise.allSettled([last.promise]);
    assert.equal(pool.snapshot().active, 0);
    assert.equal(pool.snapshot().queued, 0);
    assert.equal(pool.windows.size, 0, "partial wall-time windows cannot span an idle interval");
  });
}

test("an oversized idle WASM heap is retired before admitting smaller work", async (t) => {
  const { pool, submit, active, workers } = harness(); t.after(() => pool.close());
  pool.budget.memory = 200 * MiB;
  const first = submit(1); await tick();
  active()[0].finish({ heapBytes: 180 * MiB }); await first.promise;
  pool.setRetainedBytes("new-preview", 40 * MiB);
  const second = submit(2); await tick();
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  active()[0].finish(); await second.promise;
});

test("download windows reserve memory before reads and reject cancelled or oversized reservations",async t=>{
 const {pool}=harness();t.after(()=>pool.close());pool.budget.memory=100*MiB;
 pool.setRetainedBytes("existing",40*MiB);
 await assert.rejects(()=>pool.reserveRetainedBytes("too-big",61*MiB),/Not enough/);
 assert.equal(pool.retainedBytes(),40*MiB);
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>pool.reserveRetainedBytes("cancelled",MiB,{signal:controller.signal}),{name:"AbortError"});
 await pool.reserveRetainedBytes("downloads",60*MiB);assert.equal(pool.retainedBytes(),100*MiB);
 await assert.rejects(()=>pool.reserveRetainedBytes("downloads",1),/Invalid/);
 pool.setRetainedBytes("downloads",0);assert.equal(pool.retainedBytes(),40*MiB);
});
