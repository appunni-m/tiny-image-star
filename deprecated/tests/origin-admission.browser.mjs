import assert from "node:assert/strict";
import { waitForAsync } from "./helpers/wait-for-async.mjs";

const MiB = 1024 * 1024;
const small = { heap: 40 * MiB, transient: 8 * MiB, output: MiB, cpu: 1 };

async function pageFor(context, origin, { broadcast = true, idleTimeout = 30_000, ready = true } = {}) {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(`${origin}__admission_test__`);
  await page.evaluate(async ({ broadcast, idleTimeout, ready }) => {
    const { ResourceScheduler } = await import("./src/processing/scheduler.js");
    const { createOriginAdmission } = await import("./src/processing/origin-admission.js");
    window.pool = new ResourceScheduler({ hints: { hardwareConcurrency: 4, deviceMemory: 2 }, idleTimeout,
      admissionFactory: (pool) => createOriginAdmission(pool, broadcast ? {} : { channelFactory: null }),
      workerFactory: () => new Worker(new URL("./src/worker.js", location.href), { type: "module" }) });
    pool.configure({ fixedConcurrency: 3 });
    window.jobs = new Map(); window.prepared = []; window.results = []; window.failures = [];
    const canvas = new OffscreenCanvas(96, 64), ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ec5533"; ctx.fillRect(0, 0, 96, 64); ctx.fillStyle = "#aaee99"; ctx.fillRect(5, 7, 38, 21);
    window.source = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
    window.engineReady = pool.ready();
    if (ready) await engineReady;
  }, { broadcast, idleTimeout, ready });
  return page;
}

async function submit(page, ids, estimate = small, priority = 1) {
  await page.evaluate(({ ids, estimate, priority }) => {
    for (const id of ids) {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const task = pool.enqueue({ estimate, priority, workClass: "origin-test", prepare: async () => {
        prepared.push(id); await gate;
        const bytes = source.slice();
        return { message: { type: "process", revision: id, files: [{ id, name: "fixture.png", bytes, settings: { brightness: 1, contrast: 1, format: "png" } }] }, transfer: [bytes.buffer] };
      }, onMessage: (message) => {
        if (message.type === "result") results.push({ id, bytes: [...new Uint8Array(message.output)] });
      } });
      task.promise.catch((error) => failures.push({ id, name: error.name, message: error.message }));
      jobs.set(id, { task, release });
    }
  }, { ids, estimate, priority });
}

const release = (page, ids) => page.evaluate((ids) => { for (const id of ids) jobs.get(id).release(); }, ids);
const cancel = (page, id) => page.evaluate((id) => jobs.get(id).task.cancel(), id);
const prepared = (page, count) => page.waitForFunction((count) => window.prepared.length === count, count);
const settle = (page, ids) => page.evaluate(async (ids) => Promise.allSettled(ids.map((id) => jobs.get(id).task.promise)), ids);
const flush = (page) => page.evaluate(() => pool.admission.publish());

export async function assertOriginAdmission(browser, origin) {
  const context = await browser.newContext(), errors = [];
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  await context.route(`${origin}__admission_test__`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Processing admission verification</title>" }));
  let a, b;
  try {
    a = await pageFor(context, origin); b = await pageFor(context, origin);
    await submit(a, [1, 2, 3]); await prepared(a, 3);
    await submit(b, [4, 5, 6]);
    await b.waitForFunction(() => pool.snapshot().coordination.reason === "CPU in other tabs");
    assert.deepEqual(await b.evaluate(() => prepared), [], "another tab cannot copy sources before shared CPU admission");
    assert.equal(await a.evaluate(() => pool.snapshot().active), 3);
    await cancel(b, 5); await cancel(a, 1); await release(a, [1]); await prepared(b, 1);
    assert.deepEqual(await b.evaluate(() => prepared), [4], "queued cancellation never prepares its source");
    assert.equal(await a.evaluate(() => pool.snapshot().active) + await b.evaluate(() => pool.snapshot().active), 3, "both tabs may run together within one CPU budget");
    await release(a, [2, 3]); await release(b, [4, 6]);
    await settle(a, [1, 2, 3]); await settle(b, [4, 5, 6]);
    const rows = [...await a.evaluate(() => results), ...await b.evaluate(() => results)];
    assert.deepEqual(rows.map((row) => row.id).sort((x, y) => x - y), [2, 3, 4, 6]);
    assert.ok(rows[0].bytes.length > 0);
    for (const row of rows) assert.deepEqual(row.bytes, rows[0].bytes, "real Pillow output is identical across tabs and reused workers");

    // Memory blocks work even when CPU tokens remain. Peer idle engines are
    // retired on demand, but retained sources cannot be silently discarded.
    await a.evaluate(() => { pool.setRetainedBytes("test-source", 220 * 1024 * 1024); }); await flush(a);
    await submit(b, [7]);
    await b.waitForFunction(() => pool.snapshot().coordination.reason === "memory in other tabs");
    await a.waitForFunction(() => pool.snapshot().workers === 0);
    assert.equal(await b.evaluate(() => prepared.includes(7)), false);
    await a.evaluate(() => pool.setRetainedBytes("test-source", 0)); await prepared(b, 3);
    await release(b, [7]); await settle(b, [7]);

    // A slow admitted task holds its complete reservation; reducing a local
    // worker limit or waiting longer does not grant its tokens to another tab.
    await submit(a, [8], { ...small, heap: 170 * MiB, transient: 10 * MiB }); await prepared(a, 4);
    await submit(b, [9], { ...small, heap: 100 * MiB, transient: 10 * MiB });
    await b.waitForFunction(() => pool.snapshot().coordination.reason === "memory in other tabs");
    await a.evaluate(() => pool.configure({ mode: "low-resource" }));
    assert.equal(await b.evaluate(() => prepared.includes(9)), false);
    await cancel(a, 8); await flush(a);
    assert.equal(await a.evaluate(() => pool.snapshot().pendingReadBytes), 180 * MiB);
    assert.equal(await b.evaluate(() => prepared.includes(9)), false, "cancelled in-flight reads retain their global memory credit");
    await release(a, [8]); await prepared(b, 4); await release(b, [9]); await settle(b, [9]);

    // Context destruction, not a heartbeat timeout, releases active claims.
    await a.evaluate(() => pool.configure({ fixedConcurrency: 3 }));
    await submit(a, [10, 11, 12]); await prepared(a, 7);
    await submit(b, [13]); await b.waitForFunction(() => pool.snapshot().coordination.reason === "CPU in other tabs");
    await a.close(); a = null; await prepared(b, 5); await release(b, [13]); await settle(b, [13]);
    await b.evaluate(() => pool.close()); await b.close(); b = null;

    // BroadcastChannel is an optimization. Lock snapshots + bounded polling
    // still release capacity after cancellation and context termination.
    a = await pageFor(context, origin, { broadcast: false, idleTimeout: 50 });
    b = await pageFor(context, origin, { broadcast: false, idleTimeout: 50 });
    await submit(a, [20, 21, 22]); await prepared(a, 3);
    await submit(b, [23], small, 2); await b.waitForFunction(() => pool.snapshot().coordination.waiting);
    await submit(b, [24], small, 0);
    await cancel(a, 20); await release(a, [20]); await prepared(b, 1);
    assert.deepEqual(await b.evaluate(() => prepared), [24], "foreground work supersedes a still-waiting background request");
    await a.close(); a = null; await prepared(b, 2); await release(b, [23, 24]); await settle(b, [23, 24]);

    a = await pageFor(context, origin);
    await submit(a, [30, 31, 32]); await prepared(a, 3);
    const starting = await pageFor(context, origin, { ready: false });
    await starting.waitForFunction(() => pool.snapshot().coordination.reason === "CPU in other tabs");
    assert.equal(await starting.evaluate(() => pool.snapshot().workers), 0, "engine startup cannot bypass origin CPU admission");
    await cancel(a, 30); await release(a, [30]); await starting.evaluate(() => engineReady);
    assert.equal(await starting.evaluate(() => pool.snapshot().workers), 1);
    await starting.close(); await a.close(); a = null;

    // A supported lock service that fails must not silently switch to an
    // independent pool and over-admit. Source preparation remains untouched.
    await b.evaluate(async () => {
      await pool.close();
      const { ResourceScheduler } = await import("./src/processing/scheduler.js");
      const { createOriginAdmission } = await import("./src/processing/origin-admission.js");
      window.broken = new ResourceScheduler({ hints: { hardwareConcurrency: 4, deviceMemory: 2 },
        workerFactory: () => { throw new Error("worker must not start"); },
        admissionFactory: (pool) => createOriginAdmission(pool, { locks: { request: navigator.locks.request.bind(navigator.locks), query: () => Promise.reject(new Error("Injected lock query failure")) }, channelFactory: null }) });
      window.brokenRead = false;
      broken.enqueue({ estimate: { heap: 40 * 1024 * 1024, transient: 0, output: 0, cpu: 1 }, prepare: () => { brokenRead = true; } }).promise.catch((error) => { window.brokenError = error.message; });
    });
    await b.waitForFunction(() => window.brokenError);
    assert.match(await b.evaluate(() => brokenError), /Injected lock query failure/);
    assert.equal(await b.evaluate(() => brokenRead), false);
    await b.evaluate(() => broken.close());
    await waitForAsync(b, async () => !(await navigator.locks.query()).held.some((lock) => lock.name.startsWith("tiny-image-star.processing.v1/")));
    assert.deepEqual(errors, []);
    console.log("  origin admission: real two-tab Pillow output, shared CPU/memory and startup admission, deferred copies, idle retirement, priority/cancellation, closed-context recovery, no-broadcast fallback and fail-closed lock errors");
  } finally { await context.close(); }
}
