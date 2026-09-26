import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { waitForAsync } from "./helpers/wait-for-async.mjs";

export async function assertFolderSamples(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__tinystarDisableLargeFolderJobs = false;
    window.__tinystarDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("sample-destination", { create: true });
  });
  try {
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
    const fontBase64 = (await readFile(new URL("./fixtures/fonts/NotoSans.ttf", import.meta.url))).toString("base64");
    const setup = await page.evaluate(async fontBase64 => {
      const core = await import("./src/jobs/core.js"), store = await import("./src/jobs/store.js"), fonts = await import("./src/editor/fonts.js");
      const { acquireJobOwnership } = await import("./src/jobs/ownership.js"), { createTextLayer } = await import("./src/compositor/text.js");
      const { createPillowEngine } = await import("./src/engine/pillow.js"), { renderFolderSample, selectFolderSamples } = await import("./src/jobs/sample-preview.js");
      const { getProcessingScheduler } = await import("./src/processing/client.js"), { digestBytes } = await import("./src/jobs/output.js");
      const font = await fonts.registerFontFile(new File([Uint8Array.from(atob(fontBase64), c => c.charCodeAt(0))], "NotoSans.ttf"));
      const originalFont = await fonts.readFontRecord(font.id);
      const replaceLibraryFont = async record => {
        const database = await new Promise((resolve, reject) => { const request = indexedDB.open("tiny-image-star-fonts", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        try { await new Promise((resolve, reject) => { const transaction = database.transaction("fonts", "readwrite"); transaction.objectStore("fonts").put(record); transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); }); }
        finally { database.close(); }
      };
      await replaceLibraryFont({ ...originalFont, fontFace: { weight: "unbound", style: "unsupported" } });
      const root = await navigator.storage.getDirectory(), sourceHandle = await root.getDirectoryHandle("sample-source", { create: true });
      const recipe = { id: "sample-recipe", name: "Warm signature", operations: { format: "jpeg", resizeWidth: 160, resizeHeight: 120, resizeMode: "crop", brightness: 1.1, contrast: 1.05,
        textLayers: [{ ...createTextLayer(), text: "Summer 2026", fontId: font.id, fontBytes: font.bytes.byteLength, fontSha256: font.sha256, fontSize: .12, y: .8 }] } };
      let job = core.createLargeJob({ id: "sample-job", sourceHandle, sourceName: sourceHandle.name, recipe });
      await store.putLargeJob(job); const lock = await acquireJobOwnership(job.id), entries = [], sourceBytes = [];
      const canvas = document.createElement("canvas"), c = canvas.getContext("2d");
      for (let index = 0; index < 10; index++) {
        canvas.width = index % 3 === 1 ? 80 : 120; canvas.height = index % 3 === 0 ? 80 : 120;
        const gradient = c.createLinearGradient(0, 0, canvas.width, canvas.height); gradient.addColorStop(0, `hsl(${index * 30},70%,35%)`); gradient.addColorStop(1, "#eee0cb"); c.fillStyle = gradient; c.fillRect(0, 0, canvas.width, canvas.height);
        const type = index % 2 ? "image/jpeg" : "image/png", bytes = await (await new Promise(done => canvas.toBlob(done, type))).arrayBuffer(); sourceBytes.push(bytes);
        const name = index === 9 ? "09-corrupt.png" : `${String(index).padStart(2,"0")}.${index % 2 ? "jpg" : "png"}`;
        const handle = await sourceHandle.getFileHandle(name, { create: true }), writer = await handle.createWritable(); await writer.write(index === 9 ? "corrupt" : bytes); await writer.close();
        entries.push(core.createManifestEntry({ jobId: job.id, index, relativePath: name, file: await handle.getFile() }));
      }
      await store.putManifestEntries(entries, lock.owner);
      job = await store.patchLargeJob(job.id, { discovered: entries.length, sourceBytes: entries.reduce((sum, item) => sum + item.sourceBytes, 0), scanComplete: true, status: "ready" }, lock.owner);
      const selected = await selectFolderSamples(job), pool = getProcessingScheduler(); await pool.ready();
      const engine = await createPillowEngine(), reference = {}, metadata = {};
      for (const entry of entries.slice(0, 9)) {
        const file = { name: entry.sourceName, bytes: sourceBytes[entry.index], fontRecords: [{ id: font.id, sha256: font.sha256, bytes: font.bytes.slice(0) }], diagnostics: true };
        const output = await engine.renderImagePreview(file, core.settingsForLargeJob(recipe), 512);
        reference[entry.index] = await digestBytes(output.bytes); metadata[entry.index] = output.fullOutput;
      }
      const runs = [];
      for (const concurrency of [1, 2, 4, 8].filter(value => value <= pool.budget.cpu)) {
        pool.configure({ fixedConcurrency: concurrency }); let peak = 0, violations = 0;
        const unsubscribe = pool.subscribe(state => { peak = Math.max(peak, state.active); if (state.active > concurrency || state.estimatedBytes > state.memoryBudget) violations++; });
        const outputs = await Promise.all(entries.slice(0, 9).map(async entry => {
          const output = await renderFolderSample(job, entry);
          try { return { index: entry.index, hash: await digestBytes(await (await fetch(output.url)).arrayBuffer()), fullOutput: output.fullOutput }; }
          finally { output.release(); }
        }));
        unsubscribe(); runs.push({ concurrency, peak, violations, outputs });
      }
      pool.configure({ mode: "auto" }); await replaceLibraryFont(originalFont); await lock.release();
      window.sampleSources = sourceBytes;
      return { selected: selected.map(entry => entry.index), reference, metadata, runs };
    }, fontBase64);
    for (const run of setup.runs) {
      assert.equal(run.peak, run.concurrency); assert.equal(run.violations, 0);
      for (const output of run.outputs) {
        assert.equal(output.hash, setup.reference[output.index]);
        for (const key of ["width", "height", "bytes", "format"]) assert.equal(output.fullOutput[key], setup.metadata[output.index][key]);
      }
    }
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => !document.querySelector("#folder-job-button").hidden); await page.locator("#mobile-more-button").click(); await page.locator("#folder-job-button").click();
    assert.match(await page.locator("#folder-job-estimate").innerText(), /10 planned files/);
    await page.evaluate(async () => {
      const pool = (await import("./src/processing/client.js")).getProcessingScheduler(), original = pool.enqueue;
      window.sampleCalls = 0;
      pool.enqueue = function(request) { if (request.workClass?.startsWith("folder-sample:") && ++sampleCalls === 2) throw new Error("Injected sample admission failure"); return original.call(this, request); };
      window.restoreSampleQueue = () => { pool.enqueue = original; };
    });
    await page.locator("#folder-job-sample-button").click();
    const sheet = page.locator("#folder-sample-sheet");
    await page.waitForFunction(() => document.querySelectorAll('.folder-sample-card[data-state="failed"]').length === 2 && document.querySelectorAll('.folder-sample-card[data-state="processing"]').length === 0);
    const readyBefore = await sheet.locator('[data-state="ready"]').evaluateAll(nodes => nodes.map(node => ({ index: node.dataset.index, url: node.querySelector("img").src })));
    await page.evaluate(() => restoreSampleQueue()); await sheet.getByRole("button", { name: "Retry failed samples" }).click();
    await page.waitForFunction(() => document.querySelectorAll('.folder-sample-card[data-state="failed"]').length === 1 && document.querySelectorAll('.folder-sample-card[data-state="processing"]').length === 0);
    for (const item of readyBefore) assert.equal(await sheet.locator(`[data-index="${item.index}"] img`).getAttribute("src"), item.url);
    const displayed = await sheet.locator('[data-state="ready"]').evaluateAll(async nodes => Promise.all(nodes.map(async node => {
      const image = node.querySelector("img"), bytes = await (await fetch(image.src)).arrayBuffer(); await image.decode();
      return { index: node.dataset.index, hash: [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2,"0")).join(""), width: image.naturalWidth, height: image.naturalHeight };
    })));
    for (const output of displayed) { assert.equal(output.hash, setup.reference[output.index]); assert.deepEqual([output.width, output.height], [160, 120]); }
    await page.locator("#folder-sample-attention").check();
    assert.equal(await sheet.locator(".folder-sample-card:visible").count(), setup.selected.length, "cropped previews are marked for framing review alongside failures");
    const untouched = await page.evaluate(async () => {
      const s = await import("./src/jobs/store.js"), job = await s.getLargeJob("sample-job"), entries = await s.getManifestPage(job.id, 0, 10);
      return { completed: job.completed, failed: job.failed, fonts: job.renderContract.recipeSha256, attempts: entries.map(e => e.attempts), destination: Boolean(job.outputHandle) };
    });
    assert.deepEqual(untouched, { completed: 0, failed: 0, fonts: null, attempts: Array(10).fill(0), destination: false });
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    assert.equal(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth), true);
    if (process.env.TINY_IMAGE_STAR_SAMPLE_ARTIFACTS) { await mkdir(process.env.TINY_IMAGE_STAR_SAMPLE_ARTIFACTS, { recursive: true }); await page.screenshot({ path: `${process.env.TINY_IMAGE_STAR_SAMPLE_ARTIFACTS}/folder-sample-phone-200.png` }); }
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    if (process.env.TINY_IMAGE_STAR_SAMPLE_ARTIFACTS) await page.screenshot({ path: `${process.env.TINY_IMAGE_STAR_SAMPLE_ARTIFACTS}/folder-sample-phone.png` });
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.id === "folder-job-sample-button").catch(async error => {
      console.error("folder sample focus", await page.evaluate(() => ({ active: document.activeElement?.outerHTML?.slice(0, 120), disabled: document.querySelector("#folder-job-sample-button").disabled, sheet: Boolean(document.querySelector("#folder-sample-sheet")), panelHidden: document.querySelector("#folder-job-panel").hidden, rect: document.querySelector("#folder-job-sample-button").getBoundingClientRect().toJSON() })));
      throw error;
    });
    await page.locator("#folder-job-output-button").click(); await page.locator("#folder-job-start-button").click();
    await page.waitForFunction(() => document.querySelector("#folder-job-failed").textContent === "1" && document.querySelector("#folder-job-completed").textContent === "9");
    await page.locator("#folder-job-review-failures").check();
    await page.waitForFunction(() => document.querySelectorAll(".folder-result-row").length === 1 && document.querySelector(".folder-result-row")?.dataset.index === "9");
    assert.match(await page.locator(".folder-result-row").innerText(), /09-corrupt.png/);
    await page.getByRole("button", { name: "Review problem with 09-corrupt.png" }).focus(); await page.keyboard.press("Enter");
    assert.match(await page.locator("#folder-failure-sheet").innerText(), /09-corrupt.png/);
    assert.match(await page.locator("#folder-failure-sheet").innerText(), /could not|invalid|read/i);
    await page.locator("#folder-failure-sheet").getByRole("button", { name: "Done", exact: true }).click();
    await page.evaluate(async () => {
      const s = await import("./src/jobs/store.js"), job = await s.getLargeJob("sample-job"), valid = await (await job.sourceHandle.getFileHandle("00.png")).getFile();
      const broken = await job.sourceHandle.getFileHandle("09-corrupt.png"), writer = await broken.createWritable(); await writer.write(valid); await writer.close();
    });
    await page.locator("#folder-job-retry-button").click();
    await page.waitForFunction(() => document.querySelector("#folder-job-completed").textContent === "10");
    await page.waitForFunction(() => document.querySelectorAll(".folder-result-row").length === 0 && !document.querySelector("#folder-job-results-empty").hidden);
    assert.equal(await page.locator("#folder-job-results-empty").innerText(), "No files need attention.");
    await page.evaluate(async () => { await (await import("./src/editor/fonts.js")).clearStoredFonts(); });
    await page.reload({ waitUntil: "networkidle" }); await page.locator("#mobile-more-button").click(); await page.locator("#folder-job-button").click(); await page.locator("#folder-job-sample-button").click();
    await page.waitForFunction(() => document.querySelectorAll('.folder-sample-card[data-state="ready"]').length > 0 && document.querySelectorAll('.folder-sample-card[data-state="processing"],.folder-sample-card[data-state="pending"]').length === 0);
    assert.equal(await sheet.locator('[data-state="failed"]').count(), 0, "saved job-owned fonts survive library clearing and reload for previews");
    await sheet.getByRole("button", { name: "Done", exact: true }).click();

    await page.evaluate(async () => {
      const pool = (await import("./src/processing/client.js")).getProcessingScheduler(), original = pool.enqueue;
      const gate = new Promise(resolve => { window.releaseSampleGate = resolve; }); window.heldSamplePrepares = 0;
      window.sampleRetentionBefore = pool.snapshot().retainedBytes;
      pool.enqueue = function(request) {
        if (!request.workClass?.startsWith("folder-sample:")) return original.call(this, request);
        const prepare = request.prepare;
        return original.call(this, { ...request, prepare: async () => { window.heldSamplePrepares++; await gate; return prepare(); } });
      };
      window.restoreSampleQueue = () => { pool.enqueue = original; };
    });
    await page.locator("#folder-job-sample-button").click(); await page.waitForFunction(() => window.heldSamplePrepares > 0);
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await page.evaluate(() => { releaseSampleGate(); restoreSampleQueue(); });
    await waitForAsync(page, async () => { const pool = (await import("./src/processing/client.js")).getProcessingScheduler(); return pool.snapshot().active === 0 && pool.snapshot().queued === 0; });
    assert.equal(await page.locator("#folder-sample-sheet").count(), 0);
    assert.equal(await page.evaluate(async () => (await import("./src/processing/client.js")).getProcessingScheduler().snapshot().retainedBytes), await page.evaluate(() => sampleRetentionBefore));

    const scale = await page.evaluate(async () => {
      const s = await import("./src/jobs/store.js"), core = await import("./src/jobs/core.js"), { acquireJobOwnership } = await import("./src/jobs/ownership.js");
      const job = core.createLargeJob({ id: "sample-index-scale", recipe: { name: "Scale", operations: { format: "png" } } }); await s.putLargeJob(job); const lock = await acquireJobOwnership(job.id);
      for (let start = 0; start < 100000; start += 500) await s.putManifestEntries(Array.from({ length: 500 }, (_, offset) => ({ ...core.createManifestEntry({ jobId: job.id, index: start + offset, relativePath: `${start + offset}.png`, file: { size: 10 } }), status: (start + offset) % 2 ? "failed" : "completed" })), lock.owner);
      const original = IDBObjectStore.prototype.getAll; IDBObjectStore.prototype.getAll = function(...args) { if (this.name === "entries") throw new Error("Failure review must use its status index"); return original.apply(this, args); };
      let rows;
      try { rows = await s.getFailedManifestPage(job.id, 49990, 20); }
      finally { IDBObjectStore.prototype.getAll = original; }
      await s.deleteLargeJob(job.id, lock.owner); await lock.release();
      return rows.map(row => row.index);
    });
    assert.deepEqual(scale, Array.from({ length: 10 }, (_, index) => 99981 + index * 2));
    await waitForAsync(page, async () => { const pool = (await import("./src/processing/client.js")).getProcessingScheduler(); return pool.snapshot().active === 0 && pool.snapshot().queued === 0; });
    assert.deepEqual(errors, []);
    console.log(`folder sample observations: ${JSON.stringify({ selected: setup.selected, concurrency: setup.runs.map(run => ({ workers: run.concurrency, peak: run.peak, violations: run.violations })), independentOutputs: 27, failedReview: true, retryPreservesSuccess: true, pinnedFontReload: true, unboundLibraryMetadataIgnored: true, cancellationCleanup: true, indexedManifestEntries: 100000 })}`);
  } finally { await context.close(); }
}
