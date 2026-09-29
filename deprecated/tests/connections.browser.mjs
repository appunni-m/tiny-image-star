import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

export async function assertConnectedCutouts(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(30_000); page.on("pageerror", (error) => errors.push(error.message));
  const ready = () => page.waitForFunction(() => !document.querySelector("#story-export").disabled && document.querySelector("#story-preview").complete);
  const saved = () => page.waitForFunction(() => document.querySelector("#story-status").textContent === "Saved on this device");
  const reviewed = () => page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled);
  const apply = async () => { await reviewed(); await page.locator("#story-sheet-apply").click(); await ready(); await saved(); };
  const project = () => page.evaluate(async () => { const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(); return (await store.readStoryProject(entry.key)).project; });
  const digest = () => page.evaluate(async () => (await import("./src/project/storage.js")).hashAsset(await (await fetch(document.querySelector("#story-preview").src)).arrayBuffer()));
  const slider = (label, value) => page.getByLabel(label, { exact: true }).evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event("input", { bubbles: true })); }, value);
  try {
    await page.goto(origin); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
    const evidence = await page.evaluate(async () => {
      const { createPillowEngine } = await import("./src/engine/pillow.js"), api = await import("./wasm/pillow_rs_js.js"), engine = await createPillowEngine();
      const { fontDigest: hash } = await import("./src/compositor/fonts.js"), { createPhotoStory, moveStorySlide } = await import("./src/story/recipes.js");
      const { applyProjectCommand } = await import("./src/project/history.js"), { createConnectedCutout } = await import("./src/story/connections.js");
      const { storyDepthCommand } = await import("./src/story/depth.js"), { planScene } = await import("./src/compositor/scene-spec.js");
      const { enqueueScene } = await import("./src/processing/scene-client.js"), { getProcessingScheduler } = await import("./src/processing/client.js");
      const width = 96, height = 128, rgba = new Uint8Array(width * height * 4), coverage = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        rgba.set([25 + x * 2, 210 - y, 60 + y, y < height / 2 ? 155 : 255], (y * width + x) * 4);
        const edge = Math.min(x - 8, width - 9 - x, y - 4, height - 5 - y); coverage[y * width + x] = Math.round(Math.max(0, Math.min(1, edge / 8)) * 255);
      }
      const image = api.fromBytesFn("RGBA", width, height, rgba, "raw"), matte = api.fromBytesFn("L", width, height, coverage, "raw");
      const photo = image.saveWithInput("PNG", null), mask = matte.saveWithInput("PNG", null); image.free(); matte.free();
      const source = { kind: "image", name: "Study", type: "image/png", width, height, orientation: "upright", byteLength: photo.length, sha256: await hash(photo) };
      const maskAsset = { ...source, id: "subject", kind: "mask", byteLength: mask.length, sha256: await hash(mask) };
      let project = createPhotoStory(Array.from({ length: 6 }, (_, i) => ({ ...source, id: `source-${i}` })));
      project.variants = [{ id: "portrait", width: 160, height: 200 }, { id: "tall", width: 160, height: 284 }];
      const first = Object.values(project.nodes).find((node) => node.kind === "image"); project.assets.subject = maskAsset; first.maskId = "subject";
      const created = createConnectedCutout(project, first.id, project.slides[0].id); project = applyProjectCommand(project, created.command).project;
      project = applyProjectCommand(project, storyDepthCommand(project, created.id)).project;
      const titleId = project.nodes[created.id].depthTextId; project.nodes[titleId].text = "JOIN";
      project.nodes = Object.fromEntries([created.id, titleId].map((id) => [id, project.nodes[id]]));
      for (const slide of project.slides) slide.nodeIds = slide.nodeIds.filter((id) => project.nodes[id]);
      const bank = (id) => id === "subject" ? mask : photo;
      const render = async (project, slideId, variantId) => {
        const plan = planScene(project, slideId, variantId);
        return engine.renderSlide({ project, slideId, variantId, assets: plan.assets.map((asset) => ({ id: asset.id, bytes: bank(asset.id) })) });
      };
      const pixels = async (result) => { const bitmap = await createImageBitmap(new Blob([result.bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0); bitmap.close(); return ctx.getImageData(0, 0, canvas.width, canvas.height).data; };
      const reports = [];
      for (const variant of project.variants) for (const transformed of [false, true]) {
        const current = structuredClone(project), node = current.nodes[created.id];
        if (transformed) Object.assign(node, { rotation: 17, opacity: .73, crop: { x: .12, y: .09, width: .75, height: .82 }, appearance: { brightness: 1.08, contrast: .92 } });
        const leftId = node.anchorSlideId, rightId = node.connection.rightSlideId;
        const left = await render(current, leftId, variant.id), right = await render(current, rightId, variant.id);
        const wide = structuredClone(current); wide.slides = [wide.slides.find((slide) => slide.id === leftId)]; wide.variants = [{ ...variant, width: variant.width * 2 }];
        const widePhoto = wide.nodes[created.id]; widePhoto.frame = { ...widePhoto.variantFrames[variant.id] }; widePhoto.frame.x /= 2; widePhoto.frame.width /= 2;
        delete widePhoto.variantFrames; delete widePhoto.connection;
        const parts = [await pixels(left), await pixels(right)], reference = await pixels(await render(wide, leftId, variant.id));
        let difference = 0;
        for (let y = 0; y < variant.height; y++) for (let x = 0; x < variant.width * 2; x++) for (let c = 0; c < 4; c++) difference = Math.max(difference,
          Math.abs(parts[x < variant.width ? 0 : 1][(y * variant.width + x % variant.width) * 4 + c] - reference[(y * variant.width * 2 + x) * 4 + c]));
        const moved = applyProjectCommand(current, moveStorySlide(current, rightId, 1)).project;
        reports.push({ variant: variant.id, transformed, difference, leftExact: await hash(left.bytes) === await hash((await render(moved, leftId, variant.id)).bytes),
          rightExact: await hash(right.bytes) === await hash((await render(moved, rightId, variant.id)).bytes) });
      }
      const missing = structuredClone(project); delete missing.nodes[created.id].maskId;
      const warning = (await render(missing, missing.nodes[created.id].anchorSlideId, "portrait")).warnings.some((item) => item.code === "CONNECTION_SUBJECT_NEEDED");
      const unloaded = planScene(project, project.slides[3].id).assets.length;
      const pool = getProcessingScheduler(), runs = [];
      for (const count of [1, 2, 4, 8].filter((value) => value <= pool.budget.cpu)) {
        pool.configure({ fixedConcurrency: count }); let violations = 0;
        const stop = pool.subscribe((state) => { if (state.active > count || state.estimatedBytes > state.memoryBudget) violations++; });
        const results = await Promise.all(Array.from({ length: 12 }, (_, i) => enqueueScene({ project, slideId: project.slides[i % 2].id, variantId: "portrait", readAsset: bank }).promise)); stop();
        runs.push({ count, violations, hashes: await Promise.all(results.map((result) => hash(new Uint8Array(result.output)))) });
      }
      pool.configure({ mode: "auto" }); return { photo: [...photo], mask: [...mask], reports, runs, unloaded, warning };
    });
    for (const report of evidence.reports) { assert.ok(report.difference <= 2, JSON.stringify(report)); assert.ok(report.leftExact && report.rightExact, `reorder changes pixels: ${JSON.stringify(report)}`); }
    assert.equal(evidence.unloaded, 0); assert.equal(evidence.warning, true);
    for (const run of evidence.runs) { assert.equal(run.violations, 0); assert.deepEqual(run.hashes, evidence.runs[0].hashes); }
    await page.locator("#empty-story-button").click(); await page.locator("#story-title").fill("Connected study");
    await page.locator("#story-files").setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `photo-${i}.png`, mimeType: "image/png", buffer: Buffer.from(evidence.photo) })));
    await ready(); await saved(); const original = await project(), [a, b, c, d] = original.slides.map((slide) => slide.id);
    await page.locator('[data-story-tool="cutout"]').click(); await page.locator(".story-connection-controls summary").click();
    assert.equal(await page.getByRole("button", { name: "Add connected cutout", exact: true }).isDisabled(), true);
    await page.waitForFunction(() => document.querySelector(".mask-editor canvas")?.getAttribute("aria-disabled") === "false");
    await page.locator(".mask-editor details").filter({ hasText: "Import a mask" }).locator("summary").click();
    await page.locator("[data-mask-import]").setInputFiles({ name: "subject.png", mimeType: "image/png", buffer: Buffer.from(evidence.mask) }); await reviewed();
    await page.getByRole("button", { name: "Add connected cutout", exact: true }).click();
    await page.getByLabel("Across the join", { exact: true }).waitFor(); await reviewed();
    const spreadReady = () => page.waitForFunction(() => { const images = [...document.querySelectorAll("[data-connection-slide]")]; return images.length === 2 && images.every((image) => image.complete && image.naturalWidth && image.style.visibility === "visible"); });
    await spreadReady(); await slider("Across the join", .95); await slider("Connected cutout size", 1.15); await reviewed(); await spreadReady();
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    const layout = await page.locator("#story-sheet").evaluate((sheet) => ({ overflow: sheet.scrollWidth > sheet.clientWidth,
      small: [...sheet.querySelectorAll("button")].filter((button) => button.getClientRects().length && button.getBoundingClientRect().height < 44).map((button) => button.textContent) }));
    assert.equal(layout.overflow, false); assert.deepEqual(layout.small, []); await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    if (process.env.TINY_IMAGE_STAR_CONNECTION_ARTIFACTS) { const directory = new URL("../docs/research/2026-09-17/", import.meta.url); await mkdir(directory, { recursive: true });
      await page.locator(".story-connection-controls summary").scrollIntoViewIfNeeded(); await page.screenshot({ path: new URL("connected-cutout-phone.png", directory).pathname }); }
    await apply(); const connected = await project(), copy = Object.values(connected.nodes).find((node) => node.connection), originalPhoto = original.slides[0].nodeIds.find((id) => original.nodes[id].kind === "image");
    assert.ok(copy); assert.equal(copy.maskId, connected.nodes[originalPhoto].maskId); const initialCopy = structuredClone(copy), firstHash = await digest();
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.ok(!Object.values((await project()).nodes).some((node) => node.connection));
    await page.locator("#story-redo").click(); await ready(); await saved(); assert.equal(await digest(), firstHash);
    await page.locator('[data-story-tool="cutout"]').click(); await page.getByLabel("Photo to edit", { exact: true }).selectOption(copy.id); await reviewed();
    await slider("Across the join", .1); await reviewed(); assert.match(await page.locator("[data-connection-warning]").innerText(), /no longer crosses/);
    await page.goBack(); await page.waitForFunction(() => !document.querySelector("#story-sheet").open); await ready(); await saved(); assert.equal(await digest(), firstHash);
    await page.locator('[data-story-tool="photos"]').click(); await page.getByLabel("Photo to edit", { exact: true }).selectOption(copy.id);
    await slider("Crop zoom", 1.3); await apply(); assert.ok((await project()).nodes[copy.id].crop.width < 1); assert.notEqual(await digest(), firstHash);
    await page.locator('[data-story-tool="layout"]').click(); await page.getByLabel("Story shape", { exact: true }).selectOption("tall"); await apply();
    await page.locator('[data-story-tool="cutout"]').click(); await page.getByLabel("Photo to edit", { exact: true }).selectOption(copy.id); await reviewed();
    await slider("Cutout up / down", .6); await apply(); assert.deepEqual((await project()).nodes[copy.id].variantFrames.portrait, initialCopy.variantFrames.portrait);
    await page.locator(`[data-slide-id="${b}"]`).click(); await ready(); await page.locator('[data-story-tool="layout"]').click();
    assert.match(await page.locator("#story-sheet-content").innerText(), /2 slides share connected cutouts/);
    assert.equal(await page.getByRole("button", { name: "Move slide earlier", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Move slide later", exact: true }).click(); await apply();
    assert.deepEqual((await project()).slides.map((slide) => slide.id), [c, a, b, d]); const reordered = await digest();
    await page.reload(); await page.locator("#empty-story-button").click(); await page.locator("#story-library").getByRole("button", { name: "Connected study", exact: true }).click();
    await ready(); await saved(); await page.locator(`[data-slide-id="${b}"]`).click(); await ready(); assert.equal(await digest(), reordered);
    await page.locator('[data-story-tool="cutout"]').click(); await page.getByLabel("Photo to edit", { exact: true }).selectOption(copy.id); await reviewed();
    await page.getByLabel("Connected slides", { exact: true }).selectOption(b); await apply();
    assert.equal((await project()).nodes[copy.id].anchorSlideId, b); assert.equal((await project()).nodes[copy.id].connection.rightSlideId, d);
    await page.locator('[data-story-tool="cutout"]').click(); await page.getByLabel("Photo to edit", { exact: true }).selectOption(copy.id); await reviewed();
    await page.getByRole("button", { name: "Remove connected copy", exact: true }).click(); await apply(); assert.equal((await project()).nodes[copy.id], undefined);
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.ok((await project()).nodes[copy.id]);
    await page.locator('[data-story-tool="cutout"]').click(); await page.getByLabel("Photo to edit", { exact: true }).selectOption(copy.id); await reviewed();
    await page.locator(".story-connection-refine > summary").click(); await page.getByRole("button", { name: "Remove cutout", exact: true }).click(); await apply();
    assert.match(await page.locator("#story-preview-message").innerText(), /connected cutout needs a new subject mask/);
    assert.ok((await project()).nodes[originalPhoto].maskId, "removing the copy mask leaves the original mask");
    await page.locator("#story-undo").click(); await ready(); await saved();
    await page.locator("#story-export").click(); await page.getByLabel("Story export format", { exact: true }).selectOption("png"); await page.getByRole("button", { name: "Prepare files", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".story-exports a").length === 4);
    const files = await page.locator(".story-exports a").evaluateAll(async (links) => Promise.all(links.map(async (link) => {
      const blob = await (await fetch(link.href)).blob(), bitmap = await createImageBitmap(blob), { hashAsset } = await import("./src/project/storage.js");
      const result = { name: link.download, width: bitmap.width, height: bitmap.height, hash: await hashAsset(await blob.arrayBuffer()) }; bitmap.close(); return result;
    })));
    assert.deepEqual(files.map((file) => file.name), [1, 2, 3, 4].map((index) => `connected-study-0${index}.png`));
    assert.ok(files.every((file) => file.width === 1080 && file.height === 1920)); assert.deepEqual(errors, []);
    const expected = await page.evaluate(async () => {
      const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(), opened = await store.readStoryProject(entry.key), project = opened.project;
      const { createPillowEngine } = await import("./src/engine/pillow.js"), { planScene } = await import("./src/compositor/scene-spec.js"), engine = await createPillowEngine();
      const copy = Object.values(project.nodes).find((node) => node.connection), results = [];
      for (const slideId of [copy.anchorSlideId, copy.connection.rightSlideId]) {
        const plan = planScene(project, slideId, project.recipe.outputVariant);
        const assets = await Promise.all(plan.assets.map(async (asset) => ({ id: asset.id, bytes: await (await opened.readAsset(asset.id)).arrayBuffer() })));
        const output = await engine.renderSlide({ project, slideId, variantId: project.recipe.outputVariant, assets });
        results.push({ index: project.slides.findIndex((slide) => slide.id === slideId), hash: await store.hashAsset(output.bytes) });
      }
      return results;
    });
    for (const item of expected) assert.equal(files[item.index].hash, item.hash, "each exported half matches a separate render of the saved spread");
    console.log(`  connected cutouts: spread references ${JSON.stringify(evidence.reports)}, exact reorder, ${evidence.runs.map((run) => run.count).join("/")} worker identity, phone setup/position/crop/variants/Back/undo/reload/boundary/removal and ordered exports`);
  } finally { await context.close(); }
}
