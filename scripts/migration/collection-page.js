// Browser transport and job orchestration only. All image work, admission,
// claims and output commits use the same modules as folder jobs in the app.
import { createProcessingClient, getProcessingScheduler } from "/src/processing/client.js";
import * as core from "/src/jobs/core.js";
import * as store from "/src/jobs/store.js";
import { acquireJobOwnership } from "/src/jobs/ownership.js";

const demand = (condition, message) => { if (!condition) throw new Error(message); };
const pool = getProcessingScheduler();
let sourceRoot, root;

export function device() {
  return { hardwareConcurrency: navigator.hardwareConcurrency ?? null, deviceMemory: navigator.deviceMemory ?? null,
    userAgent: navigator.userAgent, budget: { ...pool.budget } };
}

export async function install(input) {
  root = await navigator.storage.getDirectory();
  sourceRoot = await root.getDirectoryHandle("sources", { create: true });
  for (const [index, id] of input.sequence.entries()) {
    const asset = input.assets.find((a) => a.id === id);
    const response = await fetch(`/${asset.path}`);
    demand(response.ok, "Corpus input unavailable");
    const bytes = await response.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
    demand(digest === asset.sha256, "Corpus input changed");
    const file = await sourceRoot.getFileHandle(`${index}--${id}.${asset.media_type === "image/png" ? "png" : "jpg"}`, { create: true });
    const writer = await file.createWritable(); await writer.write(bytes); await writer.close();
  }
}

export async function reopen() {
  root = await navigator.storage.getDirectory(); sourceRoot = await root.getDirectoryHandle("sources");
}

export function configure(concurrency) {
  pool.configure({ mode: "auto", fixedConcurrency: concurrency });
}

export async function run(input, { diagnostics = true } = {}) {
  const jobId = crypto.randomUUID(), items = [], failures = [], samples = [], scheduler = [];
  const clients = []; let owner, outputRoot, interval, unsubscribe;
  let previousTick = performance.now(), maxLag = 0;
  const observe = (snapshot) => {
    demand(snapshot.estimatedBytes <= snapshot.memoryBudget, "Memory reservation exceeds device budget");
    demand(snapshot.active <= snapshot.cpuBudget, "CPU admission exceeds device budget");
    // Keep changes in resource state, not arbitrary unbounded event payloads.
    const point = { atMs: performance.now(), active: snapshot.active, workers: snapshot.workers, limit: snapshot.limit,
      estimatedBytes: snapshot.estimatedBytes, pendingReadBytes: snapshot.pendingReadBytes, pendingOutputBytes: snapshot.pendingOutputBytes,
      reason: snapshot.limitingReason };
    const last = scheduler.at(-1);
    if (!last || Object.keys(point).some((k) => k !== "atMs" && point[k] !== last[k])) scheduler.push(point);
  };
  const before = pool.snapshot(), started = performance.now();
  try {
    unsubscribe = pool.subscribe(observe);
    interval = setInterval(() => { const now = performance.now(); const lag = Math.max(0, now - previousTick - 50); samples.push(lag); maxLag = Math.max(maxLag, lag); previousTick = now; }, 50);
    outputRoot = await root.getDirectoryHandle(jobId, { create: true });
    await store.putLargeJob(core.createLargeJob({ id: jobId, sourceName: "benchmark", sourceHandle: sourceRoot, recipe: input.recipe }));
    owner = await acquireJobOwnership(jobId); demand(owner, "Could not own benchmark job");
    const entries = [];
    for await (const [name, handle] of sourceRoot.entries()) {
      demand(handle.kind === "file", "Unexpected corpus directory");
      const index = Number(name.split("--")[0]);
      entries.push(core.createManifestEntry({ jobId, index, relativePath: name, file: await handle.getFile() }));
    }
    entries.sort((a, b) => a.index - b.index);
    demand(entries.length === input.sequence.length && entries.every((e, i) => e.index === i), "Source inventory differs from declared sequence");
    await store.putManifestEntries(entries, owner.owner);
    await store.patchLargeJob(jobId, { status: "running", discovered: entries.length, scanComplete: true, outputHandle: outputRoot }, owner.owner);
    const scanMs = performance.now() - started;
    // The app likewise uses CPU-budget logical clients; the shared scheduler
    // chooses how many physical workers may run and when bytes may be read.
    async function drain() {
      const client = createProcessingClient({ kind: "folder", priority: 2 }); clients.push(client);
      await new Promise((resolve, reject) => client.addEventListener("message", ({ data }) => {
        if (data.type === "ready") resolve(); if (data.type === "fatal") reject(new Error(data.message));
      }));
      while (true) {
        const [entry] = await store.claimPendingEntries(jobId, 1, owner.owner);
        if (!entry) return;
        const queued = performance.now(); let terminal = null;
        const listener = ({ data }) => {
          if (["result", "error"].includes(data.type) && data.index === entry.index) {
            demand(!terminal, "Duplicate terminal result"); terminal = data;
          }
        };
        client.addEventListener("message", listener);
        try {
          const message = { type: "process", jobId, entry, owner: owner.owner, sourceRoot, outputRoot, recipe: input.recipe, diagnostics };
          await client.submit({ message });
          demand(terminal, "Missing terminal result");
          const item = { index: entry.index, elapsedMs: performance.now() - queued, result: terminal };
          items.push(item);
          if (terminal.type === "error") {
            failures.push(item);
            await store.commitManifestEntry(jobId, entry.index, entry.claimId, { status: "failed", error: terminal.message }, owner.owner);
          }
        } finally { client.removeEventListener("message", listener); }
      }
    }
    await Promise.all(Array.from({ length: pool.budget.cpu }, drain));
    await store.patchLargeJob(jobId, { status: failures.length ? "needs-attention" : "completed" }, owner.owner);
    const job = await store.getLargeJob(jobId), elapsedMs = performance.now() - started;
    demand(items.length === input.sequence.length && new Set(items.map((i) => i.index)).size === items.length, "Missing or duplicate source result");
    demand(job.completed + job.failed === items.length, "Durable counters disagree with terminal results");
    const after = pool.snapshot();
    return { jobId, elapsedMs, scanMs, items, failures, outputBytes: job.outputBytes, completed: job.completed,
      eventLoopLagMs: samples, maxEventLoopLagMs: maxLag,
      scheduler: scheduler.map((s) => ({ ...s, atMs: s.atMs - started })),
      workersStarted: after.startedWorkers - before.startedWorkers,
      startups: after.startedWorkers > before.startedWorkers ? after.startups.slice(-Math.min(64, after.startedWorkers - before.startedWorkers)) : [],
      startupSamplesTruncated: after.startedWorkers - before.startedWorkers > 64,
      finalScheduler: { estimatedBytes: after.estimatedBytes, retainedBytes: after.retainedBytes, active: after.active,
        workers: after.workers, queued: after.queued, limit: after.limit, cpuBudget: after.cpuBudget, memoryBudget: after.memoryBudget } };
  } finally {
    clearInterval(interval); unsubscribe?.(); clients.forEach((c) => c.terminate()); await owner?.release();
  }
}

export async function verify(input, result, { reference = false } = {}) {
  demand(!result.failures.length && result.completed === input.sequence.length, "Some inputs failed; speed measurement is not qualified");
  const directory = await root.getDirectoryHandle(result.jobId);
  const references = await root.getDirectoryHandle("references", { create: true });
  const records = await store.getManifestPage(result.jobId, 0, input.sequence.length);
  demand(records.length === input.sequence.length && records.every((record, index) => record.index === index), "Missing or unexpected durable manifest row");
  const outputNames = [];
  for await (const [name] of directory.entries()) outputNames.push(name);
  demand(outputNames.length === input.sequence.length, "Missing or extra saved output");
  let bytesTotal = 0;
  for (const record of records) {
    const assetId = input.sequence[record.index], asset = input.assets.find((a) => a.id === assetId);
    const file = await (await directory.getFileHandle(record.outputPath)).getFile();
    const bytes = new Uint8Array(await file.arrayBuffer()); bytesTotal += bytes.length;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, input.recipe.operations.resizeWidth / asset.width, input.recipe.operations.resizeHeight / asset.height);
    demand(bitmap.width === Math.round(asset.width * scale) && bitmap.height === Math.round(asset.height * scale), "Independent decoder found incorrect output dimensions");
    demand(bitmap.width === record.width && bitmap.height === record.height && bytes.length === record.outputBytes, "Saved file differs from durable journal");
    bitmap.close();
    const key = `${assetId}.${record.format}`;
    let existing;
    try { existing = await references.getFileHandle(key); } catch (e) { if (e.name !== "NotFoundError") throw e; }
    if (reference && !existing) {
      const handle = await references.getFileHandle(key, { create: true });
      const writer = await handle.createWritable(); await writer.write(bytes); await writer.close();
    } else {
      demand(existing, "Live reference output missing");
      const baseline = new Uint8Array(await (await existing.getFile()).arrayBuffer());
      demand(baseline.length === bytes.length && baseline.every((b, i) => b === bytes[i]), "Output bytes differ from live one-worker execution");
    }
  }
  demand(bytesTotal === result.outputBytes, "Saved byte total differs from durable counters");
  return { decoded: records.length, exactByteComparisons: reference ? records.length - new Set(input.sequence).size : records.length, bytesTotal };
}

export async function cleanup(jobId) {
  const owner = await acquireJobOwnership(jobId); demand(owner, "Could not clean benchmark job");
  try { await store.deleteLargeJob(jobId, owner.owner); await root.removeEntry(jobId, { recursive: true }); }
  finally { await owner.release(); }
}
