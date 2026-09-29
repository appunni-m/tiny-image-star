import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { waitForAsync } from "./helpers/wait-for-async.mjs";

export async function assertMasks(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(30_000); page.on("pageerror", (error) => errors.push(error.message));
  const ready = () => page.waitForFunction(() => !document.querySelector("#story-export").disabled && document.querySelector("#story-preview").complete);
  const saved = () => page.waitForFunction(() => document.querySelector("#story-status").textContent === "Saved on this device");
  const cutoutReady = () => page.waitForFunction(() => document.querySelector(".mask-editor canvas")?.getAttribute("aria-disabled") === "false"
    && document.querySelector(".mask-editor img").complete && document.querySelector(".mask-editor img").naturalWidth > 0);
  const digest = (selector = "#story-preview") => page.evaluate(async (selector) => (await import("./src/project/storage.js")).hashAsset(await (await fetch(document.querySelector(selector).src)).arrayBuffer()), selector);
  const document = () => page.evaluate(async () => { const store = await import("./src/project/storage.js"), [saved] = await store.listStoryProjects(); return (await store.readStoryProject(saved.key)).project; });
  const apply = async () => { await page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled); await page.locator("#story-sheet-apply").click(); await ready(); await saved(); };
  const open = async () => { await page.locator('[data-story-tool="cutout"]').click(); await cutoutReady(); };
  try {
    await page.goto(origin); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
    const evidence = await page.evaluate(async () => {
      const engine = await (await import("./src/engine/pillow.js")).createPillowEngine(), api = await import("./wasm/pillow_rs_js.js");
      const { hashAsset } = await import("./src/project/storage.js"), { enqueueMask } = await import("./src/processing/mask-client.js"), { getProcessingScheduler } = await import("./src/processing/client.js");
      const width = 96, height = 128;
      const pixels = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height; i++) pixels.set([220, 65, 110, 128], i * 4);
      const photo = api.fromBytesFn("RGBA", width, height, pixels, "raw"), mask = new api.Image("L", width, height, 0, 0, 0, 255);
      for (let y = 0; y < height; y++) for (let x = width / 2; x < width; x++) mask.putpixel(x, y, 255, 255, 255, 255);
      const bytes = photo.saveWithInput("PNG", null), imported = mask.saveWithInput("PNG", null); photo.free(); mask.free();
      const asset = { id: "test-source", kind: "image", name: "Photo", type: "image/png", width, height, orientation: "upright", byteLength: bytes.length, sha256: await hashAsset(bytes) };
      const source = { asset, bytes };
      const result = await engine.editMask({ source, importMask: { bytes: imported, mode: "luminance" } });
      const opened = api.Image.open(result.mask), preview = api.Image.open(result.preview), maskPixels = opened.toBytes(), previewPixels = preview.toBytes();
      const mode = opened.mode; opened.free(); preview.free();
      let alphaErrors = 0;
      for (let i = 0; i < width * height; i++) if (previewPixels[i * 4 + 3] !== Math.floor(128 * maskPixels[i] / 255)) alphaErrors++;
      const transparency = await engine.editMask({ source, importMask: { bytes, mode: "alpha" } });
      const alphaMask = api.Image.open(transparency.mask), alphaValues = [...new Set(alphaMask.toBytes())]; alphaMask.free();
      const brushed = await engine.editMask({ source, mask: { asset: { ...asset, kind: "mask", byteLength: result.mask.length, sha256: await hashAsset(result.mask) }, bytes: result.mask },
        stroke: { mode: "erase", radius: .15, opacity: .5, hardness: .5, points: [[.75, .5]] } });
      const soft = api.Image.open(brushed.mask), softValues = [...new Set(soft.toBytes())]; soft.free();
      const wrong = new api.Image("L", 8, 8, 255, 255, 255, 255), wrongBytes = wrong.saveWithInput("PNG", null); wrong.free();
      const deep = api.fromBytesFn("I;16", width, height, new Uint8Array(width * height * 2).fill(128), "raw"), deepBytes = deep.saveWithInput("PNG", null); deep.free();
      const failures = [];
      for (const request of [{ source, importMask: { bytes: wrongBytes, mode: "luminance" } }, { source: { asset: { ...asset, sha256: "0".repeat(64) }, bytes } }, { source, importMask: { bytes: deepBytes, mode: "luminance" } }]) {
        try { await engine.editMask(request); failures.push("accepted"); } catch (error) { failures.push(error.message); }
      }
      const pool = getProcessingScheduler(), runs = [];
      for (const count of [1, 2, 4, 8].filter((count) => count <= pool.budget.cpu)) {
        pool.configure({ fixedConcurrency: count }); let violations = 0;
        const stop = pool.subscribe((state) => { if (state.active > count || state.estimatedBytes > state.memoryBudget) violations++; });
        const jobs = Array.from({ length: 12 }, () => enqueueMask({ source: { asset, blob: new Blob([bytes]) }, imported: new Blob([imported]) }));
        const outputs = await Promise.all(jobs.map((job) => job.promise)); stop();
        runs.push({ count, violations, hashes: await Promise.all(outputs.map((output) => hashAsset(output.mask))) });
      }
      pool.configure({ mode: "auto" });
      return { mode, alphaErrors, alphaValues, softValues, failures, runs, hash: await hashAsset(result.mask), photo: [...bytes], mask: [...imported], wrong: [...wrongBytes] };
    });
    assert.equal(evidence.mode, "L"); assert.equal(evidence.alphaErrors, 0); assert.deepEqual(evidence.alphaValues, [128]);
    assert.ok(evidence.softValues.some((value) => value > 128 && value < 255));
    assert.match(evidence.failures[0], /96 × 128/); assert.match(evidence.failures[1], /integrity/);
    assert.match(evidence.failures[2], /16-bit masks are not supported/);
    for (const run of evidence.runs) { assert.equal(run.violations, 0); assert.deepEqual(run.hashes, Array(12).fill(evidence.hash)); }
    await page.locator("#empty-story-button").click(); await page.locator("#story-title").fill("Cutout study");
    await page.locator("#story-files").setInputFiles(Array.from({ length: 6 }, (_, index) => ({ name: `photo-${index}.png`, mimeType: "image/png", buffer: Buffer.from(evidence.photo) })));
    await ready(); await saved(); const baseline = await digest();
    await open(); await page.locator(".mask-editor details").filter({ hasText: "Import a mask" }).locator("summary").click();
    const input = page.locator("[data-mask-import]");
    await input.setInputFiles({ name: "wrong.png", mimeType: "image/png", buffer: Buffer.from(evidence.wrong) });
    await page.getByRole("button", { name: "Retry cutout", exact: true }).waitFor();
    assert.match(await page.locator(".mask-editor").innerText(), /96 × 128/); assert.equal(await digest(), baseline);
    assert.equal(await page.locator("#story-sheet-apply").isDisabled(), true, "a failed cutout request cannot be committed");
    await input.setInputFiles({ name: "subject.png", mimeType: "image/png", buffer: Buffer.from(evidence.mask) }); await cutoutReady();
    await page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled);
    const importedPreview = await digest(".mask-editor img");
    const canvas = page.locator(".mask-editor canvas"); await canvas.focus(); await canvas.press("ArrowRight"); await canvas.press(" "); await cutoutReady();
    const repairedPreview = await digest(".mask-editor img"); assert.notEqual(repairedPreview, importedPreview);
    await page.getByRole("button", { name: "Undo brush", exact: true }).click(); await cutoutReady(); assert.equal(await digest(".mask-editor img"), importedPreview);
    await page.getByRole("button", { name: "Redo brush", exact: true }).click(); await cutoutReady(); assert.equal(await digest(".mask-editor img"), repairedPreview);
    await page.locator("#story-sheet-cancel").click(); await ready(); await saved(); assert.equal(await digest(), baseline, "Cancel restores the exact original story");

    await page.evaluate(async () => {
      const pool = (await import("./src/processing/client.js")).getProcessingScheduler(), enqueue = pool.enqueue;
      pool.enqueue = function (options) {
        if (options.workClass?.startsWith("mask:")) {
          pool.enqueue = enqueue;
          const prepare = options.prepare;
          options.prepare = async () => { const packet = await prepare(); packet.message.request.source.bytes = new Uint8Array([0]).buffer; return packet; };
        }
        return enqueue.call(this, options);
      };
    });
    await page.locator('[data-story-tool="cutout"]').click(); await page.getByRole("button", { name: "Retry cutout", exact: true }).waitFor();
    assert.equal(await page.locator("#story-sheet-apply").isDisabled(), true);
    await page.locator(".mask-editor details").filter({ hasText: "Import a mask" }).locator("summary").click();
    await input.setInputFiles({ name: "subject.png", mimeType: "image/png", buffer: Buffer.from(evidence.mask) }); await cutoutReady();
    await page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled);
    assert.notEqual(await digest(), baseline, "a successful import after first-load failure really changes the story");
    const beforePointer = await digest(".mask-editor img");
    await page.locator(".mask-editor-viewport").scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * .7, box.y + box.height * .25); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .8, box.y + box.height * .4, { steps: 8 }); await page.mouse.up(); await cutoutReady();
    assert.notEqual(await digest(".mask-editor img"), beforePointer, "the actual pointer stroke changes the rendered mask");
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    const layout = await page.locator("#story-sheet").evaluate((sheet) => ({ overflow: sheet.scrollWidth > sheet.clientWidth,
      small: [...sheet.querySelectorAll("button")].filter((button) => button.getClientRects().length).filter((button) => button.getBoundingClientRect().height < 44).map((button) => button.textContent) }));
    assert.equal(layout.overflow, false); assert.deepEqual(layout.small, []);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; document.querySelector("#story-sheet").scrollTop = 0; });
    await page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled);
    if (process.env.TINY_IMAGE_STAR_MASK_ARTIFACTS) { const directory = new URL("../docs/research/2026-09-17/", import.meta.url); await mkdir(directory, { recursive: true }); await page.screenshot({ path: new URL("cutout-phone.png", directory).pathname }); }
    await apply(); let committed = await digest(); const project = await document();
    const node = Object.values(project.nodes).find((node) => node.maskId);
    assert.ok(node); assert.equal(project.assets[node.maskId].kind, "mask"); assert.notEqual(committed, baseline);
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), baseline, "one story undo removes import and brush repair together");
    await page.locator("#story-redo").click(); await ready(); await saved(); assert.equal(await digest(), committed);
    await page.reload(); await page.locator("#empty-story-button").click(); await page.locator("#story-library").getByRole("button", { name: "Cutout study", exact: true }).click();
    await ready(); await saved(); assert.equal(await digest(), committed, "mask bytes and their exact scene survive saved recovery");
    const priorMask = (await document()).nodes[node.id].maskId;
    await open(); await page.getByLabel("Cutout tool", { exact: true }).selectOption("restore");
    await canvas.focus(); await canvas.press(" "); await cutoutReady();
    await page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled);
    await page.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      window.restoreMaskQuota = () => { IDBDatabase.prototype.transaction = original; };
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name === "tiny-image-star.projects" && mode === "readwrite") throw new DOMException("Injected mask storage quota", "QuotaExceededError");
        return original.call(this, stores, mode, ...rest);
      };
    });
    await page.locator("#story-sheet-apply").click(); await page.locator("#story-retry-save").waitFor({ state: "visible" });
    assert.equal((await document()).nodes[node.id].maskId, priorMask, "failed storage keeps the prior mask and source transaction intact");
    await page.evaluate(() => window.restoreMaskQuota()); await page.locator("#story-retry-save").click(); await ready(); await saved();
    assert.notEqual((await document()).nodes[node.id].maskId, priorMask); committed = await digest();
    await page.locator('[data-story-tool="photos"]').click();
    const sourcePicker = page.getByLabel("Source photo", { exact: true }), values = await sourcePicker.locator("option").evaluateAll((options) => options.map((option) => option.value));
    await sourcePicker.selectOption(values[1]); await apply();
    assert.equal((await document()).nodes[node.id].maskId, undefined, "a new photo cannot inherit the previous subject mask");
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), committed);
    await waitForAsync(page, async () => (await import("./src/processing/client.js")).getProcessingScheduler().snapshot().active === 0);
    assert.deepEqual(errors, []);
    console.log("  cutouts: L/alpha import, preserved source alpha, soft brushes, 1/2/4/8 worker parity, phone pointer/keyboard repair, failed import, local/story undo, cancel, exact recovery, quota rollback/retry and source replacement");
  } finally { await context.close(); }
}
