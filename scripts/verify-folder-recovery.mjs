import { waitForAsync } from "../tests/helpers/wait-for-async.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (path === "/") { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>Folder recovery verification</title>"); return; }
    const filename = resolve(root, `.${path}`);
    if (!filename.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
    response.setHeader("Content-Type", extname(filename) === ".js" ? "text/javascript" : "application/octet-stream");
    response.end(await readFile(filename));
  } catch { response.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const context = await browser.newContext();
  const a = await context.newPage(), b = await context.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fixture = (await readFile(resolve(root, "tests/fixtures/rgb-small.png.base64"), "utf8")).trim();
  for (const page of [a, b]) {
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.evaluate(async (fixture) => {
      window.store = await import("/src/jobs/store.js");
      window.locks = await import("/src/jobs/ownership.js");
      window.output = await import("/src/jobs/output.js");
      window.core = await import("/src/jobs/core.js");
      window.bytes = Uint8Array.from(atob(fixture), (value) => value.charCodeAt(0));
      window.result = { bytes, outputBytes: bytes.length, width: 8, height: 8, format: "png" };
      window.sourceDigest = await output.digestBytes(bytes);
      window.setup = async (id, count = 1) => {
        await window.ownership?.release();
        const root = await navigator.storage.getDirectory();
        window.outputRoot = await root.getDirectoryHandle(id, { create: true });
        const job = core.createLargeJob({ id, sourceName: id, recipe: { name: "test", operations: { format: "png" } } });
        await store.putLargeJob(job);
        window.ownership = await locks.acquireJobOwnership(id);
        window.jobId = id;
        await store.patchLargeJob(id, { status: "running", discovered: count, scanComplete: true }, ownership.owner);
        await store.putManifestEntries(Array.from({ length: count }, (_, index) => core.createManifestEntry({ jobId: id, index,
          relativePath: `${index}.png`, file: { name: `${index}.png`, size: bytes.length, lastModified: 1 } })), ownership.owner);
        window.entry = (await store.claimPendingEntries(id, 1, ownership.owner))[0];
      };
      window.saveArgs = (entry = window.entry, owner = ownership.owner) => ({ jobId, entry, owner, outputRoot,
        outputPath: `${entry.index}.png`, result, sourceDigest });
      window.startFault = async (fault) => {
        window.writer = new Worker(`/tests/helpers/folder-write-worker.js?fault=${fault}`, { type: "module" });
        await new Promise((resolve, reject) => {
          writer.onmessage = ({ data }) => data.stage === fault ? resolve() : reject(new Error(data.error || "Unexpected worker completion"));
          writer.onerror = reject;
          writer.postMessage(saveArgs());
        });
      };
    }, fixture);
  }

  await a.evaluate(() => setup("ownership", 24));
  assert.equal(await b.evaluate(async () => await locks.acquireJobOwnership("ownership") === null), true, "a second tab cannot own the same job");
  const oldOwner = await a.evaluate(() => ownership.owner);
  const claimed = await a.evaluate(async () => {
    const groups = await Promise.all(Array.from({ length: 8 }, () => store.claimPendingEntries(jobId, 4, ownership.owner)));
    return [entry, ...groups.flat()].map(({ index, claimId }) => ({ index, claimId }));
  });
  assert.equal(new Set(claimed.map((entry) => entry.index)).size, 24, "parallel claims cover each index once");
  assert.equal(new Set(claimed.map((entry) => entry.claimId)).size, 24, "every attempt gets its own identity");
  await a.evaluate(async () => { await ownership.release(); window.ownership = null; });
  const epoch = await b.evaluate(async () => { window.ownership = await locks.acquireJobOwnership("ownership"); return ownership.owner.epoch; });
  assert.ok(epoch > oldOwner.epoch, "handoff advances the durable fence");
  const rejections = await a.evaluate(async (oldOwner) => {
    const actions = [() => store.patchLargeJob(jobId, { status: "paused" }, oldOwner),
      () => store.resetInterruptedEntries(jobId, oldOwner), () => store.deleteLargeJob(jobId, oldOwner),
      () => store.claimPendingEntries(jobId, 1, oldOwner), () => store.releaseClaimedEntries(jobId, [entry], oldOwner),
      () => store.commitManifestEntry(jobId, entry.index, entry.claimId, { status: "failed" }, oldOwner)];
    return Promise.all(actions.map(async (action) => { try { await action(); return false; } catch { return true; } }));
  }, oldOwner);
  assert.ok(rejections.every(Boolean), "stale owners cannot mutate claims, counters, recovery or deletion");
  await b.evaluate(async () => { await ownership.release(); window.ownership = null; });
  console.log("  cross-tab exclusion, monotonic fences, 24 unique parallel claims, stale-owner rejection: PASS");

  const closingTab = await context.newPage();
  await closingTab.goto(origin);
  const closingOwner = await closingTab.evaluate(async () => {
    const store = await import("/src/jobs/store.js"), locks = await import("/src/jobs/ownership.js"), core = await import("/src/jobs/core.js");
    await store.putLargeJob(core.createLargeJob({ id: "closed-tab", recipe: { name: "Closure test", operations: { format: "png" } } }));
    window.ownership = await locks.acquireJobOwnership("closed-tab");
    return ownership.owner;
  });
  assert.equal(await b.evaluate(async () => await locks.acquireJobOwnership("closed-tab") === null), true);
  await closingTab.close();
  // Page.close() can return before the browser publishes the released Web Lock
  // to another tab. Poll the non-blocking acquisition instead of assuming the
  // lock manager has completed that handoff in the same task.
  await waitForAsync(b, async () => {
    window.ownership = await locks.acquireJobOwnership("closed-tab");
    return window.ownership !== null;
  }, undefined, { label: "closed owner tab releases its Web Lock" });
  const automaticHandoff = await b.evaluate(async () => {
    const epoch = ownership.owner.epoch;
    await ownership.release(); window.ownership = null;
    return epoch;
  });
  assert.ok(automaticHandoff > closingOwner.epoch, "closing the tab releases ownership without a heartbeat or explicit unlock");
  console.log("  actual owner-tab closure releases its lock for recovery: PASS");

  await a.evaluate(() => setup("parallel", 24));
  const parallel = await a.evaluate(async () => {
    const all = [entry, ...await store.claimPendingEntries(jobId, 23, ownership.owner)];
    await Promise.all(all.map((item) => output.saveJournaledOutput(saveArgs(item))));
    await Promise.all(all.map((item) => store.commitManifestEntry(jobId, item.index, item.claimId, { status: "failed", error: "late error" }, ownership.owner)));
    await store.patchLargeJob(jobId, { status: "paused" }, ownership.owner);
    const job = await store.getLargeJob(jobId);
    return { completed: job.completed, failed: job.failed, bytes: job.outputBytes, expectedBytes: bytes.length * all.length };
  });
  assert.deepEqual(parallel, { completed: 24, failed: 0, bytes: parallel.expectedBytes, expectedBytes: parallel.expectedBytes });
  console.log("  24 concurrent journaled writes, idempotent completion, late-error and stale-UI counter protection: PASS");

  // The owner may die before its worker. Handoff must wait for admitted writes.
  await a.evaluate(async () => {
    window.gate = locks.withJobWriteGate(jobId, async () => { window.gateHeld = true; await new Promise((done) => { window.releaseGate = done; }); });
  });
  await a.waitForFunction(() => window.gateHeld);
  await a.evaluate(async () => { await ownership.release(); window.ownership = null; });
  await b.evaluate(() => { window.handoff = locks.acquireJobOwnership("parallel").then((value) => { window.ownership = value; window.handedOff = true; }); });
  await waitForAsync(b, async () => (await navigator.locks.query()).pending.some((lock) => lock.name === "tiny-image-star:folder-write:parallel"));
  assert.equal(await b.evaluate(() => Boolean(window.handedOff)), false, "handoff waits behind an old shared write gate");
  await a.evaluate(async () => { releaseGate(); await gate; });
  await b.evaluate(() => handoff);
  await b.evaluate(async () => { await ownership.release(); window.ownership = null; });
  console.log("  ownership handoff waits for outstanding writes: PASS");

  for (const fault of ["after-close", "during-write"]) {
    await a.evaluate((id) => setup(id), fault);
    await a.evaluate((fault) => startFault(fault), fault);
    const before = await a.evaluate(async () => {
      const file = await (await outputRoot.getFileHandle("0.png")).getFile();
      return { size: file.size, lastModified: file.lastModified, completed: (await store.getLargeJob(jobId)).completed };
    });
    assert.equal(before.completed, 0, "interrupted output has not been falsely counted");
    assert.equal(before.size, fault === "after-close" ? Buffer.from(fixture, "base64").length : 0);
    await a.evaluate(async () => { writer.terminate(); await ownership.release(); window.ownership = null; });
    const recovered = await b.evaluate(async (id) => {
      window.jobId = id;
      window.ownership = await locks.acquireJobOwnership(id);
      window.outputRoot = await (await navigator.storage.getDirectory()).getDirectoryHandle(id);
      await store.resetInterruptedEntries(id, ownership.owner);
      window.entry = (await store.claimPendingEntries(id, 1, ownership.owner))[0];
      const saved = await output.saveJournaledOutput(saveArgs());
      const file = await (await outputRoot.getFileHandle("0.png")).getFile();
      const repeated = await output.saveJournaledOutput(saveArgs());
      const job = await store.getLargeJob(id);
      return { recovered: saved.recovered, repeated: repeated.recovered, completed: job.completed,
        outputBytes: job.outputBytes, lastModified: file.lastModified, digest: await output.digestBytes(await file.arrayBuffer()), expected: sourceDigest };
    }, fault);
    assert.equal(recovered.completed, 1);
    assert.equal(recovered.digest, recovered.expected);
    assert.equal(recovered.outputBytes, Buffer.from(fixture, "base64").length);
    assert.equal(recovered.recovered, fault === "after-close");
    assert.equal(recovered.repeated, true);
    if (fault === "after-close") assert.equal(recovered.lastModified, before.lastModified, "a completed file is reconciled without rewriting");
    await b.evaluate(async () => { await ownership.release(); window.ownership = null; });
    console.log(`  terminated worker ${fault}: recovery and exactly-once counters PASS`);
  }

  await a.evaluate(() => setup("conflicts"));
  const conflicts = await a.evaluate(async () => {
    const handle = await outputRoot.getFileHandle("0.png", { create: true });
    const writer = await handle.createWritable(); await writer.write("KEEP ME"); await writer.close();
    let unrelatedRejected = false;
    try { await output.saveJournaledOutput(saveArgs()); } catch { unrelatedRejected = true; }
    const untouched = await (await handle.getFile()).text();
    await outputRoot.removeEntry("0.png");
    await startFault("after-close");
    window.writer.terminate();
    // Failure handling can run after a file closes but before success is sent.
    await store.commitManifestEntry(jobId, entry.index, entry.claimId, { status: "failed" }, ownership.owner);
    const failed = (await store.getLargeJob(jobId)).failed;
    await store.retryFailedEntries(jobId, ownership.owner);
    const staleEntry = entry;
    window.entry = (await store.claimPendingEntries(jobId, 1, ownership.owner))[0];
    let staleAttemptRejected = false, changedSourceRejected = false;
    try { await output.saveJournaledOutput(saveArgs(staleEntry)); } catch { staleAttemptRejected = true; }
    try { await output.saveJournaledOutput({ ...saveArgs(), sourceDigest: "changed" }); } catch { changedSourceRejected = true; }
    const committed = await output.saveJournaledOutput(saveArgs());
    const job = await store.getLargeJob(jobId);
    return { unrelatedRejected, untouched, failed, staleAttemptRejected, changedSourceRejected,
      recovered: committed.recovered, completed: job.completed, finalFailed: job.failed };
  });
  assert.deepEqual(conflicts, { unrelatedRejected: true, untouched: "KEEP ME", failed: 1, staleAttemptRejected: true,
    changedSourceRejected: true, recovered: true, completed: 1, finalFailed: 0 });
  console.log("  unrelated-file protection, changed-source rejection, old-attempt fencing and retry-only-failed: PASS");

  await a.evaluate(() => setup("changed-output"));
  const changedOutput = await a.evaluate(async () => {
    await startFault("after-close"); writer.terminate();
    const handle = await outputRoot.getFileHandle("0.png");
    const writable = await handle.createWritable(); await writable.write("USER EDIT"); await writable.close();
    let rejected = false;
    try { await output.saveJournaledOutput(saveArgs()); } catch { rejected = true; }
    return { rejected, text: await (await handle.getFile()).text(), completed: (await store.getLargeJob(jobId)).completed };
  });
  assert.deepEqual(changedOutput, { rejected: true, text: "USER EDIT", completed: 0 });
  console.log("  a changed journaled output is preserved and never counted as recovered: PASS");

  await a.evaluate(() => setup("unsupported-locking"));
  const unsupported = await a.evaluate(async () => {
    // output.js caches capability checks per realm, so use a fresh module
    // instance while simulating a browser that ignores the new mode option.
    const freshOutput = await import("/src/jobs/output.js?exclusive-probe");
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = function () { return original.call(this); };
    try {
      let message = "";
      try { await freshOutput.saveJournaledOutput(saveArgs()); } catch (error) { message = error.message; }
      const file = await (await outputRoot.getFileHandle("0.png")).getFile();
      return { message, size: file.size, completed: (await store.getLargeJob(jobId)).completed };
    } finally { FileSystemFileHandle.prototype.createWritable = original; }
  });
  assert.match(unsupported.message, /cannot lock saved files safely/);
  assert.equal(unsupported.size, 0);
  assert.equal(unsupported.completed, 0);
  console.log("  browsers that ignore exclusive-write mode fail safely before writing: PASS");
  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.log("verify:folder-recovery PASS (Chromium, real IndexedDB, OPFS, Web Locks and terminated workers)");
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
