import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, extname, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { root, exact } from "./spec.mjs";
import { collectionInput, profileConcurrency } from "./collection-input.mjs";

function randomized(values, seed) {
  const result = [...values]; let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const j = (state >>> 0) % (i + 1); [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let text = ""; for await (const chunk of process.stdin) text += chunk;
  const request = JSON.parse(text); exact(request, "profiles measurement artifactPath");
  await runCollectionMatrix({ ...request, inputPath: process.argv[2] });
}

export async function runCollectionMatrix({ inputPath, profiles, measurement, artifactPath }) {
  const input = await collectionInput(inputPath), records = [], external = [], errors = [];
  assert.equal(measurement.measurement_iterations, 1);
  assert.ok(measurement.samples >= 5); assert.equal(measurement.concurrency, 1);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>Collection benchmark</title>"); return; }
      const path = resolve(root, pathname.slice(1)), local = relative(root, path);
      assert.ok(path.startsWith(`${root}${sep}`) && ["src/", "wasm/", "scripts/migration/collection-page.js", "tests/fixtures/corpus/"].some((p) => local.startsWith(p)));
      response.setHeader("Content-Type", ({ ".js": "text/javascript", ".wasm": "application/wasm" })[extname(path)] ?? "application/octet-stream");
      response.end(await readFile(path));
    } catch { response.writeHead(404).end(); }
  });
  let browser, context, device;
  const result = { schema: "tinystar/collection-samples@1", inputPath, device: null, browser: null,
    destination: "Chromium OPFS with IndexedDB journal and Web Locks", seed: input.random_seed,
    cacheMeaning: "cold: fresh page and workers, no HTTP caching; warm: declared complete untimed jobs on the same page; OS disk cache is uncontrolled",
    timingBoundary: "job creation, source directory metadata scan, durable claims, admitted header inspection and source reads, render and normal output validation, journaled save through closed files and committed counters; excludes corpus installation, browser/page launch, warmups, and additional independent correctness reads",
    memoryMeaning: "scheduler reservations and reported Wasm linear memory; not total RSS, JS, GPU or native live allocations",
    subjects: profiles.map((p) => ({ id: p.id, concurrency: profileConcurrency(p), eligible: null, reason: null })),
    order: [], records, errors, external };
  const checkpoint = async () => writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
  try {
    await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() }); result.browser = browser.version();
    context = await browser.newContext();
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    async function page() {
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin);
      await page.evaluate(async () => { window.bench = await import("/scripts/migration/collection-page.js"); });
      return page;
    }
    const setup = await page();
    device = result.device = await setup.evaluate(() => bench.device());
    await setup.evaluate((input) => bench.install(input), input);
    await setup.close();
    for (const s of result.subjects) {
      s.eligible = s.concurrency === null || s.concurrency <= device.budget.cpu;
      s.reason = s.eligible ? null : `Requested ${s.concurrency} exceeds real CPU budget ${device.budget.cpu}`;
    }
    const eligible = result.subjects.filter((s) => s.eligible);
    async function trial(subject, phase, sample, reference = false) {
      const p = await page();
      const record = { subject: subject.id, phase, sample, status: "running", warmups: [], job: null, verification: null, error: null };
      records.push(record); await checkpoint();
      try {
        await p.evaluate(async (concurrency) => { await bench.reopen(); bench.configure(concurrency); }, subject.concurrency);
        if (phase === "measurement") for (let n = 0; n < measurement.warmup_iterations; n++) {
          const warmup = await p.evaluate((input) => bench.run(input), input);
          record.warmups.push(warmup);
          await p.evaluate(({ input, job }) => bench.verify(input, job), { input, job: warmup });
          await p.evaluate((id) => bench.cleanup(id), warmup.jobId);
        }
        record.job = await p.evaluate((input) => bench.run(input), input);
        record.verification = await p.evaluate(({ input, job, reference }) => bench.verify(input, job, { reference }), { input, job: record.job, reference });
        record.status = "pass";
        await p.evaluate((id) => bench.cleanup(id), record.job.jobId);
      } catch (error) { record.status = "fail"; record.error = error.message; }
      finally { await p.close(); await checkpoint(); }
      process.stderr.write(`${inputPath}: ${subject.id} ${phase} ${sample}: ${record.status}${record.job ? ` ${Math.round(record.job.elapsedMs)} ms` : ""}\n`);
      return record;
    }
    // A live serial execution is a concurrency-invariance reference, not an
    // independent migration oracle. Its outputs never become input fixtures.
    const one = eligible.find((s) => s.concurrency === 1); assert.ok(one);
    const reference = await trial(one, "reference", 0, true);
    if (reference.status !== "pass") return result;
    const qualified = [];
    for (const subject of eligible) {
      const gate = await trial(subject, "gate", 0);
      if (gate.status === "pass") qualified.push(subject);
    }
    for (let sample = 0; sample < measurement.samples; sample++) {
      const order = randomized(qualified, input.random_seed + sample);
      result.order.push(order.map((s) => s.id));
      for (const subject of order) await trial(subject, "measurement", sample);
    }
    return result;
  } finally {
    await checkpoint(); await context?.close(); await browser?.close();
    if (server.listening) await new Promise((done) => server.close(done));
  }
}
