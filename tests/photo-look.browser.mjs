import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { waitForAsync } from "./helpers/wait-for-async.mjs";
import { selectRecipeRevision } from "./recipe-selection.browser.mjs";

const previewReady = (page) => page.waitForFunction(() => {
  const sheet = document.querySelector("#photo-look-sheet");
  return sheet && ![...sheet.querySelectorAll("button")].find((button) => button.textContent === "Apply photo look").disabled;
});
const ready = (page) => page.waitForFunction(() => document.querySelector("#batch-status").textContent.includes("Ready — 2 previews"));
const outputs = (page) => page.evaluate(async () => {
  const { hashAsset } = await import("./src/project/storage.js");
  return Promise.all([...document.querySelectorAll(".batch-card")].map(async (card) => hashAsset(await (await fetch(card.querySelectorAll(".batch-card-compare img")[1].src)).arrayBuffer())));
});
const saved = (page) => page.evaluate(async () => (await import("./src/session.js")).readSession());

export async function assertPhotoLooks(browser, origin) {
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(15000); page.on("pageerror", (error) => errors.push(error.message));
  let source;
  try {
    await page.goto(origin); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
    source = await page.evaluate(async () => {
      const rows = [];
      for (const [width, height] of [[144, 96], [96, 144]]) {
        const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext("2d"), gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#f04411"); gradient.addColorStop(1, "#2255dd"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#ccffaa"; ctx.fillRect(7, 11, 32, 27);
        rows.push([...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer())]);
      }
      return rows;
    });
    await page.locator("#file-input").setInputFiles(source.map((bytes, index) => ({ name: `look-${index}.png`, mimeType: "image/png", buffer: Buffer.from(bytes) })));
    await ready(page); await page.locator("#flip-horizontal").click();
    await waitForAsync(page, async () => (await (await import("./src/session.js")).readSession())?.batch.files[0].override?.flipX === true);
    await ready(page); const original = await outputs(page);
    const baselineRetained = await page.evaluate(async () => (await import("./src/processing/client.js")).getProcessingScheduler().snapshot().retainedBytes);
    await page.locator("#photo-look-open").click(); await previewReady(page);
    await page.locator('[data-photo-look-key="builtin:film-diary@1"]').click(); await previewReady(page);
    await page.getByRole("slider", { name: "Photo color strength", exact: true }).fill("0.5"); await previewReady(page);
    assert.deepEqual(await outputs(page), original, "browsing photo looks never commits image-set edits");
    await page.locator("#photo-look-sheet").getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await saved(page)).batch.sharedOverride?.photoLook, undefined);
    assert.equal(await page.evaluate(async () => (await import("./src/processing/client.js")).getProcessingScheduler().snapshot().retainedBytes), baselineRetained, "closing releases preview planes and sample retention");

    await page.locator("#photo-look-open").click(); await previewReady(page);
    await page.locator('[data-photo-look-key="builtin:film-diary@1"]').click(); await previewReady(page);
    await page.getByRole("slider", { name: "Photo color strength", exact: true }).fill("0.5"); await previewReady(page);
    await page.locator("#photo-look-sheet").getByRole("button", { name: "Apply photo look", exact: true }).click();
    await ready(page);
    await waitForAsync(page, async () => (await (await import("./src/session.js")).readSession())?.batch.sharedOverride?.photoLook?.strength === .5);
    const applied = await outputs(page); assert.notDeepEqual(applied, original);
    assert.equal((await saved(page)).batch.files[0].override.flipX, true);
    const expected = await page.evaluate(async (sources) => {
      const engine = await (await import("./src/engine/pillow.js")).createPillowEngine();
      const { photoLookFromStyle } = await import("./src/styles/photo-look.js"), { curatedStyles } = await import("./src/styles/model.js"), { hashAsset } = await import("./src/project/storage.js");
      const api = await import("./wasm/pillow_rs_js.js"), look = photoLookFromStyle(curatedStyles()[1], .5), rows = [];
      for (const [index, bytes] of sources.entries()) {
        const settings = { brightness: 1, contrast: 1, format: "png", flipX: index === 0, photoLook: look };
        const rendered = await engine.render({ name: "expected.png", bytes: new Uint8Array(bytes) }, settings);
        let input = api.Image.open(new Uint8Array(bytes));
        const replace = (next) => { input.free(); input = next; };
        if (!index) replace(input.transpose("FLIP_LEFT_RIGHT"));
        replace(input.enhanceBrightness(1.01)); replace(input.enhanceContrast(.95)); replace(input.enhanceColor(.88));
        const reference = input.saveWithInput("PNG", null); input.free();
        async function pixels(encoded) {
          const bitmap = await createImageBitmap(new Blob([encoded], { type: "image/png" })), canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d");
          ctx.drawImage(bitmap, 0, 0); const hash = await hashAsset(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data); bitmap.close(); return hash;
        }
        rows.push({ hash: await hashAsset(rendered.bytes), actual: await pixels(rendered.bytes), reference: await pixels(reference) });
      }
      return rows;
    }, source);
    assert.deepEqual(applied, expected.map((row) => row.hash)); for (const row of expected) assert.equal(row.actual, row.reference, "real Pillow primitives independently verify the look's strength and color operations");
    await page.locator("#tray-scope-select").selectOption("this"); await page.locator("#photo-look-open").click(); await previewReady(page);
    await page.locator('[data-photo-look-key="builtin:scrapbook@1"]').click(); await previewReady(page);
    await page.locator("#photo-look-sheet").getByRole("button", { name: "Apply photo look", exact: true }).click(); await ready(page);
    await waitForAsync(page, async () => (await (await import("./src/session.js")).readSession())?.batch.files[0].override?.photoLook?.definition.id === "builtin:scrapbook");
    const scoped = await outputs(page); assert.notEqual(scoped[0], applied[0]); assert.equal(scoped[1], applied[1]);
    await page.locator("#photo-look-undo").click(); await ready(page);
    await waitForAsync(page, async (hash) => {
      const image = document.querySelector(".batch-card").querySelectorAll(".batch-card-compare img")[1];
      return (await import("./src/project/storage.js")).hashAsset(await (await fetch(image.src)).arrayBuffer()).then((value) => value === hash);
    }, applied[0]);
    assert.deepEqual(await outputs(page), applied, "one undo restores the previous look without undoing the manual flip");
    await page.locator("#tray-scope-select").selectOption("all"); await selectRecipeRevision(page, "#tray-preset-picker", "keep-original", 1); await ready(page);
    assert.deepEqual(await outputs(page), applied, "choosing an output destination retains the creative look");
    await page.reload(); await page.locator("#session-restore-button").click(); await ready(page);
    assert.deepEqual(await outputs(page), applied, "recovery keeps the copied look and its strength");

    await page.evaluate(async (bytes) => {
      const root = await navigator.storage.getDirectory(), source = await root.getDirectoryHandle("look-source", { create: true }), output = await root.getDirectoryHandle("look-output", { create: true });
      const file = await source.getFileHandle("photo.png", { create: true }), writer = await file.createWritable(); await writer.write(new Uint8Array(bytes)); await writer.close();
      window.__tinystarDirectoryPicker = async ({ id }) => id === "tiny-image-star-source" ? source : output;
    }, source[1]);
    await page.locator("#batch-folder-button").click();
    await page.waitForFunction(() => !document.querySelector("#folder-job-look-button").disabled);
    await selectRecipeRevision(page, "#folder-job-recipe", "keep-original", 1);
    await page.waitForFunction(() => !document.querySelector("#folder-job-look-button").disabled);
    await page.locator("#folder-job-look-button").click(); await previewReady(page);
    await page.locator('[data-photo-look-key="builtin:film-diary@1"]').click(); await previewReady(page);
    await page.getByRole("slider", { name: "Photo color strength", exact: true }).fill("0.5"); await previewReady(page);
    assert.equal(await page.locator("#folder-job-output-button").isDisabled(), true);
    await page.evaluate(() => {
      const transaction = IDBDatabase.prototype.transaction; window.__lookQuota = true;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (this.name === "tiny-image-star.large-jobs" && mode === "readwrite" && window.__lookQuota) throw new DOMException("Photo look storage test quota", "QuotaExceededError");
        return transaction.call(this, stores, mode, ...rest);
      };
    });
    await page.locator("#photo-look-sheet").getByRole("button", { name: "Apply photo look", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#photo-look-status").textContent.includes("test quota"));
    assert.equal(await page.evaluate(async () => (await (await import("./src/jobs/store.js")).listLargeJobs())[0].recipe.operations.photoLook), undefined, "a failed look transaction preserves the job's original recipe");
    assert.equal(await page.locator("#folder-job-output-button").isDisabled(), true, "a failed commit keeps destination selection fenced while the draft is open");
    await page.evaluate(() => { window.__lookQuota = false; });
    await page.locator("#photo-look-sheet").getByRole("button", { name: "Apply photo look", exact: true }).click();
    await page.locator("#photo-look-sheet").waitFor({ state: "detached" });
    assert.match(await page.locator("#folder-job-look-summary").textContent(), /Film diary.*50%/);
    await page.locator("#folder-job-output-button").click(); await page.locator("#folder-job-start-button").click();
    await page.waitForFunction(() => document.querySelector("#folder-job-status").textContent.startsWith("Complete."));
    const folder = await page.evaluate(async () => {
      const job = (await (await import("./src/jobs/store.js")).listLargeJobs())[0], { hashAsset } = await import("./src/project/storage.js");
      const hashes = []; for await (const [, handle] of job.outputHandle.entries()) if (handle.kind === "file") hashes.push(await hashAsset(await (await handle.getFile()).arrayBuffer()));
      return { hashes, look: job.recipe.operations.photoLook };
    });
    assert.deepEqual(folder.hashes, [applied[1]], "folder worker and image-set worker produce identical output for the same frozen look");
    assert.equal(folder.look.strength, .5); assert.equal(await page.locator("#folder-job-look-button").isDisabled(), true);
    const rendering = await page.evaluate(async (bytes) => {
      const { createPillowEngine } = await import("./src/engine/pillow.js"), { getProcessingScheduler } = await import("./src/processing/client.js");
      const { curatedStyles } = await import("./src/styles/model.js"), { photoLookFromStyle } = await import("./src/styles/photo-look.js");
      const { renderPhotoLookPreview } = await import("./src/styles/photo-look-preview.js"), { hashAsset } = await import("./src/project/storage.js");
      const engine = await createPillowEngine(), api = await import("./wasm/pillow_rs_js.js"), binding = photoLookFromStyle(curatedStyles()[1]);
      const sample = { id: "parallel", name: "parallel.png", bytes: new Uint8Array(bytes), width: 96, height: 144, operations: { brightness: 1, contrast: 1, format: "png" } };
      const plain = await engine.render(sample, sample.operations), zero = await engine.render(sample, { ...sample.operations, photoLook: { ...binding, strength: 0 } });
      const canvas = new OffscreenCanvas(1100, 800), ctx = canvas.getContext("2d");
      ctx.fillStyle = "#dd9955aa"; ctx.fillRect(80, 90, 950, 600); ctx.fillStyle = "#2244ffaa"; ctx.fillRect(280, 220, 300, 200);
      const large = { name: "alpha.png", bytes: new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()) }, rows = [];
      let changedAlpha = 0;
      for (const format of ["png", "jpeg"]) {
        const settings = { brightness: 1, contrast: 1, format, photoLook: binding }, full = await engine.render(large, settings), preview = await engine.renderImagePreview(large, settings, 512);
        const opened = api.Image.open(full.bytes), resized = opened.resize(preview.width, preview.height, "LANCZOS");
        const reference = resized.saveWithInput("PNG", null); resized.free(); opened.free();
        rows.push({ format, width: preview.width, height: preview.height, actual: await hashAsset(preview.bytes), expected: await hashAsset(reference) });
        if (format === "png") {
          const original = await engine.render(large, { brightness: 1, contrast: 1, format: "png" });
          async function alpha(bytes) {
            const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" })), surface = new OffscreenCanvas(bitmap.width, bitmap.height), context = surface.getContext("2d");
            context.drawImage(bitmap, 0, 0); const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data; bitmap.close(); return pixels;
          }
          const a = await alpha(original.bytes), b = await alpha(full.bytes);
          for (let index = 3; index < a.length; index += 4) if (a[index] !== b[index]) changedAlpha++;
        }
      }
      const pool = getProcessingScheduler(), runs = [], initialRetained = pool.snapshot().retainedBytes;
      const baseline = await engine.renderImagePreview(sample, { ...sample.operations, photoLook: binding });
      for (const count of [1, 2, 4, 8].filter((count) => count <= pool.budget.cpu)) {
        pool.configure({ fixedConcurrency: count }); let peak = 0, violations = 0;
        const stop = pool.subscribe((state) => { peak = Math.max(peak, state.active); if (state.active > count || state.estimatedBytes > state.memoryBudget) violations++; });
        const previews = await Promise.all(Array.from({ length: 12 }, () => renderPhotoLookPreview(sample, binding)));
        const hashes = await Promise.all(previews.map(async (preview) => hashAsset(await (await fetch(preview.url)).arrayBuffer())));
        previews.forEach((preview) => preview.release()); stop(); runs.push({ count, peak, violations, hashes });
      }
      pool.configure({ mode: "auto" });
      return { zero: await hashAsset(zero.bytes), plain: await hashAsset(plain.bytes), changedAlpha, rows, runs, baseline: await hashAsset(baseline.bytes), initialRetained, retained: pool.snapshot().retainedBytes };
    }, source[1]);
    assert.equal(rendering.zero, rendering.plain, "zero strength produces exactly the original transform output");
    assert.equal(rendering.changedAlpha, 0, "photo color treatment preserves every transparency value");
    for (const row of rendering.rows) { assert.equal(row.width, 512); assert.equal(row.actual, row.expected, `${row.format} preview is an exact Pillow downsample of the actual encoded output`); }
    for (const run of rendering.runs) { assert.ok(run.peak <= run.count); assert.equal(run.violations, 0); assert.deepEqual(run.hashes, Array(12).fill(rendering.baseline)); }
    assert.equal(rendering.retained, rendering.initialRetained);
    assert.deepEqual(errors, []);
    console.log(`  photo looks: isolated previews, primitive color/strength parity, scopes/undo, destination independence, recovery, transactional folder retry and frozen output; exact PNG/JPEG downsample and ${rendering.runs.map((run) => run.count).join("/")} worker correctness`);
  } catch (error) {
    console.error("Photo look browser state:", await page.evaluate(() => ({ status: document.querySelector("#photo-look-status")?.textContent, batch: document.querySelector("#batch-status")?.textContent, folder: document.querySelector("#folder-job-status")?.textContent })), errors); throw error;
  } finally { await context.close(); }

  const phone = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true }), mobile = await phone.newPage();
  mobile.setDefaultTimeout(15000);
  try {
    await mobile.goto(origin); await mobile.waitForFunction(() => document.documentElement.dataset.mobileLayout === "true" && document.querySelector("#engine-status").textContent === "Ready");
    await mobile.locator("#file-input").setInputFiles(source.map((bytes, index) => ({ name: `phone-${index}.png`, mimeType: "image/png", buffer: Buffer.from(bytes) })));
    await ready(mobile);
    await mobile.evaluate(async () => {
      const { curatedStyles } = await import("./src/styles/model.js"), { putStyle } = await import("./src/styles/store.js");
      const style = curatedStyles()[1]; style.id = "saved-photo-look"; style.name = "My film colors"; await putStyle(style, { origin: "custom" });
      const post = Worker.prototype.postMessage;
      window.__lookPreviewFailure = true;
      Worker.prototype.postMessage = function (message, transfer) {
        if (window.__lookPreviewFailure && message.jobId === "photo-look-preview" && message.previewLongEdge === 512 && message.type === "process") {
          window.__lookPreviewFailure = false;
          message = { ...message, files: [{ ...message.files[0], bytes: new Uint8Array([1, 2, 3]).buffer }] };
        }
        return post.call(this, message, transfer);
      };
    });
    await mobile.locator("#mobile-batch-settings").click(); await mobile.locator("#photo-look-open").click();
    await mobile.getByRole("button", { name: "Retry preview", exact: true }).waitFor({ state: "visible" });
    assert.equal(await mobile.getByRole("button", { name: "Apply photo look", exact: true }).isDisabled(), true, "a failed actual worker preview cannot commit");
    await mobile.getByRole("button", { name: "Retry preview", exact: true }).click(); await previewReady(mobile);
    await mobile.waitForFunction(() => document.querySelectorAll("#photo-look-sheet [data-photo-look-key] img").length === 3);
    await mobile.locator("#photo-look-sheet").evaluate((sheet) => { sheet.scrollTop = 0; });
    const choices = await mobile.locator("#photo-look-sheet").evaluate((sheet) => {
      const top = sheet.querySelector("header").getBoundingClientRect().bottom, bottom = sheet.querySelector("footer").getBoundingClientRect().top;
      return [...sheet.querySelectorAll("[data-photo-look-key]")].map((button) => ({ top: button.getBoundingClientRect().top, bottom: button.getBoundingClientRect().bottom, areaTop: top, areaBottom: bottom }));
    });
    assert.ok(choices.every((choice) => choice.top >= choice.areaTop && choice.bottom <= choice.areaBottom + 1), "the three initial photo-look choices are visible above the sticky action without scrolling");
    if (process.env.TINY_IMAGE_STAR_PHOTO_LOOK_ARTIFACTS) { await mkdir("docs/research/2026-09-17", { recursive: true }); await mobile.screenshot({ path: "docs/research/2026-09-17/photo-look-phone-default.png", fullPage: true }); }
    await mobile.locator("#photo-look-sheet").getByRole("button", { name: "Saved", exact: true }).click();
    await mobile.locator('[data-photo-look-key="saved-photo-look@1"]').click(); await previewReady(mobile);
    await mobile.getByRole("button", { name: "Favorite My film colors", exact: true }).click();
    await mobile.getByRole("button", { name: "Unfavorite My film colors", exact: true }).waitFor({ state: "visible" });
    assert.equal(await mobile.evaluate(() => document.activeElement.dataset.photoLookFavorite), "saved-photo-look@1", "library refresh keeps keyboard focus on the favorite action");
    await mobile.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    const layout = await mobile.locator("#photo-look-sheet").evaluate((sheet) => ({ width: sheet.clientWidth, scroll: sheet.scrollWidth, buttons: [...sheet.querySelectorAll("button")].filter((button) => button.getClientRects().length).map((button) => button.getBoundingClientRect().height) }));
    assert.ok(layout.scroll <= layout.width + 1); assert.ok(layout.buttons.every((height) => height >= 44));
    if (process.env.TINY_IMAGE_STAR_PHOTO_LOOK_ARTIFACTS) { await mkdir("docs/research/2026-09-17", { recursive: true }); await mobile.screenshot({ path: "docs/research/2026-09-17/photo-look-phone.png", fullPage: true }); }
    await mobile.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await mobile.getByRole("button", { name: "Apply photo look", exact: true }).click(); await ready(mobile);
    await waitForAsync(mobile, async () => (await (await import("./src/session.js")).readSession())?.batch.sharedOverride?.photoLook?.definition.id === "saved-photo-look");
    const before = await outputs(mobile);
    await mobile.evaluate(async () => {
      const { curatedStyles } = await import("./src/styles/model.js"), { putStyle, removeStyle } = await import("./src/styles/store.js");
      const newer = curatedStyles()[1]; newer.id = "saved-photo-look"; newer.name = "Updated colors"; newer.revision = 2; newer.components.look.appearance.contrast = 1.7;
      await putStyle(newer, { origin: "custom" }); await removeStyle("saved-photo-look@1"); await removeStyle("saved-photo-look@2");
    });
    await mobile.reload(); await mobile.locator("#session-restore-button").click(); await ready(mobile);
    assert.deepEqual(await outputs(mobile), before, "saved custom photo colors survive a library revision and deletion");
    assert.equal((await saved(mobile)).batch.sharedOverride.photoLook.definition.name, "My film colors");
    console.log("  phone photo looks: native sheets, failed-preview retry, saved/favorite style focus, 200% text/touch targets and exact reload after library changes");
  } finally { await phone.close(); }
}
