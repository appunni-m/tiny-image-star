import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { waitForAsync } from "./helpers/wait-for-async.mjs";

export async function assertMaskDetail(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(30_000); page.on("pageerror", (error) => errors.push(error.message));
  const ready = () => page.waitForFunction(() => !document.querySelector("#story-export").disabled && document.querySelector("#story-preview").complete);
  const saved = () => page.waitForFunction(() => document.querySelector("#story-status").textContent === "Saved on this device");
  const cutoutReady = () => page.waitForFunction(() => document.querySelector(".mask-editor canvas")?.getAttribute("aria-disabled") === "false"
    && document.querySelector(".mask-editor img").complete && document.querySelector(".mask-editor img").naturalWidth > 0);
  const digest = (selector = "#story-preview") => page.evaluate(async (selector) => (await import("./src/project/storage.js")).hashAsset(await (await fetch(document.querySelector(selector).src)).arrayBuffer()), selector);
  const detail = () => page.evaluate(() => {
    const image = document.querySelector(".mask-editor img"), canvas = document.querySelector(".mask-editor canvas"), box = canvas.getBoundingClientRect();
    const match = document.querySelector(".mask-editor").textContent.match(/Area (\d+)–(\d+), (\d+)–(\d+)/);
    return { x: Number(match[1]) - 1, y: Number(match[3]) - 1, width: image.naturalWidth, height: image.naturalHeight, cssWidth: box.width, cssHeight: box.height };
  });
  const maskPixels = () => page.evaluate(async () => {
    const bitmap = await createImageBitmap(await (await fetch(document.querySelector(".mask-editor img").src)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data, changed = [];
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== 255) changed.push({ x: i / 4 % canvas.width, y: Math.floor(i / 4 / canvas.width), value: pixels[i] });
    return changed;
  });
  try {
    await page.goto(origin); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
    const evidence = await page.evaluate(async () => {
      const engine = await (await import("./src/engine/pillow.js")).createPillowEngine(), api = await import("./wasm/pillow_rs_js.js");
      const { hashAsset } = await import("./src/project/storage.js"), { enqueueMask } = await import("./src/processing/mask-client.js"), { getProcessingScheduler } = await import("./src/processing/client.js");
      const width = 1537, height = 1109, pixels = new Uint8Array(width * height * 4), coverage = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { pixels.set([x % 17 * 15, y % 17 * 15, (x + y) % 17 * 15, 255], (y * width + x) * 4); coverage[y * width + x] = (x + y) % 2 * 255; }
      const photo = api.fromBytesFn("RGBA", width, height, pixels, "raw"), mask = api.fromBytesFn("L", width, height, coverage, "raw");
      const bytes = photo.saveWithInput("PNG", null), maskBytes = mask.saveWithInput("PNG", null); photo.free(); mask.free();
      const asset = { id: "detail-source", kind: "image", name: "Detail photo", type: "image/png", width, height, orientation: "upright", byteLength: bytes.length, sha256: await hashAsset(bytes) };
      const maskAsset = { ...asset, id: "detail-mask", kind: "mask", byteLength: maskBytes.length, sha256: await hashAsset(maskBytes) };
      const source = { asset, bytes }, savedMask = { asset: maskAsset, bytes: maskBytes };
      const regions = [{ x: 0, y: 0, width: 17, height: 13 }, { x: width - 17, y: height - 13, width: 17, height: 13 },
        { x: 1107, y: 9, width: 430, height: 800 }, { x: 641, y: 347, width: 91, height: 53 }];
      const crops = [];
      for (const region of regions) {
        const result = await engine.editMask({ source, mask: savedMask, previewOnly: true, previewRegion: region });
        const violations = [];
        for (const key of ["preview", "sourcePreview", "maskPreview"]) {
          const bitmap = await createImageBitmap(new Blob([result[key]], { type: "image/png" }));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0); bitmap.close();
          const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let wrong = 0;
          for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
            const input = (region.y + y) * width + region.x + x, output = (y * region.width + x) * 4;
            const alpha = key === "preview" ? coverage[input] : 255;
            if (actual[output + 3] !== alpha) wrong++;
            if (alpha) for (let c = 0; c < 3; c++) if (actual[output + c] !== (key === "maskPreview" ? coverage[input] : pixels[input * 4 + c])) wrong++;
          }
          violations.push({ key, wrong, width: canvas.width, height: canvas.height });
        }
        crops.push({ region: result.region, requested: region, noMask: !("mask" in result), violations });
      }
      const failures = [];
      for (const patch of [{ previewRegion: { x: 0, y: 0, width: 1025, height: 1 } }, { previewRegion: { x: -1, y: 0, width: 8, height: 8 } }, { reset: "hide" }]) {
        try { await engine.editMask({ source, mask: savedMask, previewOnly: true, ...patch }); failures.push("accepted"); } catch (error) { failures.push(error.message); }
      }
      const pool = getProcessingScheduler(), runs = [], region = regions[3];
      for (const count of [1, 2, 4, 8].filter((count) => count <= pool.budget.cpu)) {
        pool.configure({ fixedConcurrency: count }); let violations = 0;
        const stop = pool.subscribe((state) => { if (state.active > count || state.estimatedBytes > state.memoryBudget) violations++; });
        const results = await Promise.all(Array.from({ length: 4 }, () => enqueueMask({ source: { asset, blob: new Blob([bytes]) }, mask: { asset: maskAsset, blob: new Blob([maskBytes]) }, previewOnly: true, previewRegion: region }).promise));
        stop(); runs.push({ count, violations, noMasks: results.every((result) => !("mask" in result)), hashes: await Promise.all(results.map((result) => hashAsset(result.preview))) });
      }
      pool.configure({ mode: "auto" });
      return { crops, failures, runs, photo: [...bytes], width, height };
    });
    for (const crop of evidence.crops) {
      assert.deepEqual(crop.region, crop.requested); assert.equal(crop.noMask, true);
      for (const channel of crop.violations) { assert.equal(channel.wrong, 0, `${channel.key} has exact source pixels`); assert.equal(channel.width, crop.requested.width); assert.equal(channel.height, crop.requested.height); }
    }
    for (const failure of evidence.failures) assert.notEqual(failure, "accepted");
    const reference = evidence.runs[0].hashes[0];
    for (const run of evidence.runs) { assert.equal(run.violations, 0); assert.equal(run.noMasks, true); assert.deepEqual(run.hashes, Array(4).fill(reference)); }
    await page.locator("#empty-story-button").click(); await page.locator("#story-title").fill("Source detail study");
    await page.locator("#story-files").setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `detail-${i}.png`, mimeType: "image/png", buffer: Buffer.from(evidence.photo) })));
    await ready(); await saved(); const baseline = await digest();
    await page.locator('[data-story-tool="cutout"]').click(); await cutoutReady();
    const zoom = page.getByLabel("Cutout detail", { exact: true }), canvas = page.locator(".mask-editor canvas"), mode = page.getByLabel("Cutout tool", { exact: true });
    const undo = page.getByRole("button", { name: "Undo brush", exact: true }), redo = page.getByRole("button", { name: "Redo brush", exact: true });
    assert.equal(await undo.isDisabled(), true);
    for (const scale of [1, 2, 4]) {
      await zoom.selectOption(String(scale)); await cutoutReady(); const area = await detail();
      assert.equal(area.cssWidth, area.width * scale); assert.equal(area.cssHeight, area.height * scale);
      assert.ok(area.width <= 1024 && area.height <= 1024); assert.equal(await undo.isDisabled(), true, "inspection does not add brush history");
    }
    await page.getByLabel("Cutout preview mode", { exact: true }).selectOption("maskPreview"); await cutoutReady();
    for (const [label, value] of [["Brush size (source pixels)", "1"], ["Soft edge", "0"]]) await page.getByLabel(label, { exact: true }).evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); }, value);
    const area = await detail(); await page.locator(".mask-editor-viewport").scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
    await page.mouse.click(box.x + 17.9 * 4, box.y + 19.9 * 4); await cutoutReady();
    assert.deepEqual(await maskPixels(), [{ x: 17, y: 19, value: 0 }], "one source pixel is erased, even though the whole image exceeds preview resolution");
    await canvas.focus(); await canvas.press("ArrowRight"); await canvas.press(" "); await cutoutReady();
    assert.deepEqual(await maskPixels(), [{ x: 17, y: 19, value: 0 }, { x: 18, y: 19, value: 0 }], "keyboard movement is one original pixel");
    await undo.click(); await cutoutReady(); assert.deepEqual(await maskPixels(), [{ x: 17, y: 19, value: 0 }]);
    await page.getByRole("button", { name: "View right", exact: true }).click(); await cutoutReady();
    assert.ok((await detail()).x > area.x); assert.equal(await redo.isDisabled(), false, "panning preserves the redo branch");
    await redo.click(); await cutoutReady();
    await mode.selectOption("pan"); await page.locator(".mask-editor-viewport").scrollIntoViewIfNeeded(); const panBox = await canvas.boundingBox(), prior = await detail();
    await page.mouse.move(panBox.x + 140, panBox.y + 80); await page.mouse.down(); await page.mouse.move(panBox.x + 80, panBox.y + 120, { steps: 5 }); await page.mouse.up(); await cutoutReady();
    const afterPan = await detail(); assert.equal(afterPan.x - prior.x, 15); assert.equal(afterPan.y - prior.y, -10);
    await canvas.focus(); await canvas.press("ArrowDown"); await cutoutReady(); assert.ok((await detail()).y > afterPan.y);

    await mode.selectOption("erase");
    await page.getByLabel("Brush opacity", { exact: true }).evaluate((input) => { input.value = ".5"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    const opacityArea = await detail(), beforeDecodeFailure = await digest(".mask-editor img"), beforeStoryFailure = await digest();
    await page.evaluate(() => {
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () { HTMLImageElement.prototype.decode = decode; return Promise.reject(new DOMException("Injected image decode failure", "EncodingError")); };
    });
    await page.locator(".mask-editor-viewport").scrollIntoViewIfNeeded(); const opacityBox = await canvas.boundingBox();
    await page.mouse.click(opacityBox.x + 20.9 * 4, opacityBox.y + 20.9 * 4);
    await page.getByRole("button", { name: "Retry cutout", exact: true }).waitFor();
    assert.equal(await digest(".mask-editor img"), beforeDecodeFailure); assert.equal(await digest(), beforeStoryFailure);
    assert.equal(await page.locator("#story-sheet-apply").isDisabled(), true);
    await page.getByRole("button", { name: "Retry cutout", exact: true }).click(); await cutoutReady();
    assert.ok((await maskPixels()).some((pixel) => pixel.x === 20 && pixel.y === 20 && pixel.value === 128), "decode failure and Retry apply the half-opacity stroke exactly once");

    const beforeFailure = await digest(".mask-editor img");
    await page.evaluate(async () => {
      const pool = (await import("./src/processing/client.js")).getProcessingScheduler(), enqueue = pool.enqueue;
      pool.enqueue = function (options) {
        if (options.workClass?.startsWith("mask:")) { pool.enqueue = enqueue; const prepare = options.prepare; options.prepare = async () => { const packet = await prepare(); packet.message.request.source.bytes = new Uint8Array([0]).buffer; return packet; }; }
        return enqueue.call(this, options);
      };
    });
    await zoom.selectOption("2"); await page.getByRole("button", { name: "Retry cutout", exact: true }).waitFor();
    assert.equal(await digest(".mask-editor img"), beforeFailure); assert.equal(await zoom.inputValue(), "4"); assert.equal(await page.locator("#story-sheet-apply").isDisabled(), true);
    await page.getByRole("button", { name: "Retry cutout", exact: true }).click(); await cutoutReady(); assert.equal(await zoom.inputValue(), "2");
    await page.setViewportSize({ width: 320, height: 667 });
    await page.waitForFunction(() => { const img = document.querySelector(".mask-editor img"), viewport = document.querySelector(".mask-editor-viewport"); return img.naturalWidth * 2 <= viewport.clientWidth && document.querySelector(".mask-editor canvas").getAttribute("aria-disabled") === "false"; });
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    assert.equal(await page.locator("#story-sheet").evaluate((sheet) => sheet.scrollWidth > sheet.clientWidth), false);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; }); await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForFunction(() => { const img = document.querySelector(".mask-editor img"), viewport = document.querySelector(".mask-editor-viewport"); return img.naturalWidth === Math.floor(viewport.clientWidth / 2) && document.querySelector(".mask-editor canvas").getAttribute("aria-disabled") === "false"; });
    await mode.selectOption("erase"); await page.getByLabel("Cutout preview mode", { exact: true }).selectOption("preview"); await cutoutReady();
    if (process.env.TINY_IMAGE_STAR_MASK_ARTIFACTS) { const directory = new URL("../docs/research/2026-09-17/", import.meta.url); await mkdir(directory, { recursive: true }); await page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled); await page.locator("#story-sheet").evaluate((sheet) => sheet.scrollTo(0, 0)); await page.screenshot({ path: new URL("cutout-detail-phone.png", directory).pathname }); }
    await page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled); await page.locator("#story-sheet-apply").click(); await ready(); await saved();
    const committed = await page.evaluate(async () => {
      const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(), saved = await store.readStoryProject(entry.key);
      const node = Object.values(saved.project.nodes).find((node) => node.maskId), asset = saved.project.assets[node.maskId];
      const bytes = await (await saved.readAsset(asset.id)).arrayBuffer(), api = await import("./wasm/pillow_rs_js.js"), mask = api.Image.open(new Uint8Array(bytes));
      const pixels = mask.toBytes(), changed = [];
      for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 255) changed.push({ x: i % mask.width, y: Math.floor(i / mask.width), value: pixels[i] });
      const result = { changed, width: mask.width, height: mask.height }; mask.free(); return result;
    });
    assert.equal(committed.width, evidence.width); assert.equal(committed.height, evidence.height);
    const expected = [{ x: area.x + 17, y: area.y + 19, value: 0 }, { x: area.x + 18, y: area.y + 19, value: 0 }, { x: opacityArea.x + 20, y: opacityArea.y + 20, value: 128 }].sort((a, b) => a.y - b.y || a.x - b.x);
    assert.deepEqual(committed.changed, expected, "only the three intended original pixels reach the saved project, without applying a retried stroke twice");
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), baseline);

    await page.locator('[data-story-tool="cutout"]').click(); await cutoutReady();
    await page.evaluate(async () => {
      const pool = (await import("./src/processing/client.js")).getProcessingScheduler(), enqueue = pool.enqueue;
      pool.enqueue = function (options) {
        if (options.workClass?.startsWith("mask:")) { pool.enqueue = enqueue; const prepare = options.prepare; options.prepare = async () => { window.detailPreparing = true; await new Promise((resolve) => { window.releaseDetail = resolve; }); return prepare(); }; }
        return enqueue.call(this, options);
      };
    });
    await zoom.selectOption("4"); await page.waitForFunction(() => window.detailPreparing);
    await page.locator("#story-sheet-cancel").click(); await page.evaluate(() => window.releaseDetail()); await ready(); await saved();
    assert.equal(await page.locator(".mask-editor").count(), 0); assert.equal(await digest(), baseline);
    await waitForAsync(page, async () => (await import("./src/processing/client.js")).getProcessingScheduler().snapshot().active === 0);

    await page.locator('[data-story-tool="cutout"]').click(); await cutoutReady();
    await page.evaluate(() => {
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        HTMLImageElement.prototype.decode = decode; window.detailDecoding = this;
        return new Promise((resolve) => { window.releaseDetailDecode = resolve; }).then(() => decode.call(this));
      };
    });
    await zoom.selectOption("4"); await page.waitForFunction(() => Boolean(window.detailDecoding));
    await page.locator("#story-sheet-cancel").click();
    assert.equal(await page.evaluate(() => window.detailDecoding.hasAttribute("src")), false, "closing the panel detaches the pending image decode");
    const held = await page.evaluate(async () => [...(await import("./src/processing/client.js")).getProcessingScheduler().retained].filter(([owner]) => owner.startsWith("mask-editor-")).reduce((sum, [, bytes]) => sum + bytes, 0));
    assert.ok(held > 0, "pending decoded buffers remain in admission after the panel closes");
    await page.evaluate(() => { window.releaseDetailDecode(); window.detailDecoding = null; window.releaseDetailDecode = null; });
    await waitForAsync(page, async () => ![...(await import("./src/processing/client.js")).getProcessingScheduler().retained.keys()].some((owner) => owner.startsWith("mask-editor-")));
    await ready(); await saved(); assert.equal(await digest(), baseline);
    assert.deepEqual(errors, []);
    console.log(`  cutout detail: exact independently decoded source-pixel regions, ${evidence.runs.map((run) => run.count).join("/")} worker parity, one-pixel pointer/keyboard repair, read-only pan/zoom, worker/decode retry, resize, saved coordinates and cancellation`);
  } finally { await context.close(); }
}
