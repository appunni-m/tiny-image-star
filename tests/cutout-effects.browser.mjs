import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { waitForAsync } from "./helpers/wait-for-async.mjs";

export async function assertCutoutEffects(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true }), page = await context.newPage(), errors = [];
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
      const width = 64, height = 96, rgba = new Uint8Array(width * height * 4), coverage = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        rgba.set([60 + x * 2, 180 - y, 40 + y * 2, y < 48 ? 160 : 255], (y * width + x) * 4);
        const distance = Math.hypot((x - 32) / 25, (y - 48) / 40); coverage[y * width + x] = Math.round(Math.max(0, Math.min(1, (1 - distance) * 6)) * 255);
      }
      const image = api.fromBytesFn("RGBA", width, height, rgba, "raw"), matte = api.fromBytesFn("L", width, height, coverage, "raw");
      const photo = image.saveWithInput("PNG", null), mask = matte.saveWithInput("PNG", null); image.free(); matte.free();
      const source = { kind: "image", name: "Effects study", type: "image/png", width, height, orientation: "upright", byteLength: photo.length, sha256: await hash(photo) };
      let project = createPhotoStory(Array.from({ length: 6 }, (_, i) => ({ ...source, id: `source-${i}` })));
      project.variants = [{ id: "portrait", width: 257, height: 321 }, { id: "tall", width: 257, height: 457 }];
      const first = Object.values(project.nodes).find((node) => node.kind === "image");
      project.assets.subject = { ...source, id: "subject", kind: "mask", byteLength: mask.length, sha256: await hash(mask) }; first.maskId = "subject";
      const created = createConnectedCutout(project, first.id, project.slides[0].id); project = applyProjectCommand(project, created.command).project;
      const copy = project.nodes[created.id]; copy.opacity = .67; copy.rotation = 17; copy.crop = { x: .1, y: .08, width: .8, height: .86 };
      copy.cutoutEffects = { schema: 1, outline: { color: "#f2eee5", width: .02 }, shadow: { color: "#162b43", opacity: .6, blur: .03, x: -.045, y: .035 } };
      project.nodes = { [created.id]: copy }; for (const slide of project.slides) slide.nodeIds = slide.nodeIds.filter((id) => id === created.id);
      const bank = (id) => id === "subject" ? mask : photo;
      const render = async (current, slideId, variantId, options = {}) => { const plan = planScene(current, slideId, variantId, options);
        return engine[options.preview ? "renderPreview" : "renderSlide"]({ project: current, slideId, variantId, ...options, assets: plan.assets.map((asset) => ({ id: asset.id, bytes: bank(asset.id) })) }); };
      const pixels = async (result) => { const bitmap = await createImageBitmap(new Blob([result.bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0); bitmap.close(); return ctx.getImageData(0, 0, canvas.width, canvas.height).data; };
      const pointProject = structuredClone(project), pointNode = pointProject.nodes[created.id], pointCoverage = new Uint8Array(width * height);
      pointProject.shared.appearance = {};
      pointCoverage[64 * width + 16] = 255; pointCoverage[40 * width + 40] = 128;
      const pointImage = api.fromBytesFn("L", width, height, pointCoverage, "raw"), pointMask = pointImage.saveWithInput("PNG", null); pointImage.free();
      pointProject.assets.subject = { ...pointProject.assets.subject, byteLength: pointMask.length, sha256: await hash(pointMask) };
      pointProject.variants = [{ id: "portrait", width, height }];
      Object.assign(pointNode, { frame: { x: 0, y: 0, width: 1, height: 1 }, space: "slide", opacity: .5, rotation: 0 });
      for (const key of ["connection", "anchorSlideId", "variantFrames", "crop"]) delete pointNode[key];
      for (const slide of pointProject.slides.slice(1)) slide.nodeIds = [];
      const pointReports = [];
      for (const mode of ["outline", "shadow", "both"]) {
        pointNode.cutoutEffects = { schema: 1 };
        if (mode !== "shadow") pointNode.cutoutEffects.outline = { color: "#ffffff", width: .02 };
        if (mode !== "outline") pointNode.cutoutEffects.shadow = { color: "#142436", opacity: .5, blur: 0, x: .05, y: -.05 };
        const plan = planScene(pointProject, pointProject.slides[0].id, "portrait");
        const result = await engine.renderSlide({ project: pointProject, slideId: pointProject.slides[0].id, variantId: "portrait", assets: plan.assets.map((asset) => ({ id: asset.id, bytes: asset.id === "subject" ? pointMask : photo })) });
        const decoded = api.Image.open(result.bytes), data = decoded.toBytes(); decoded.free();
        const at = (x, y) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
        pointReports.push({ mode, center: at(16, 64), border: at(18, 64), diagonal: at(18, 66), shadow: at(21, 59), softBorder: at(42, 40), softShadow: at(45, 35) });
      }
      const reports = [];
      for (const variant of project.variants) for (const background of [null, "photo", "page"]) {
        let current = structuredClone(project); if (background) current = applyProjectCommand(current, storyDepthCommand(current, created.id, { background })).project;
        const node = current.nodes[created.id], leftId = node.anchorSlideId, rightId = node.connection.rightSlideId;
        if (node.depthTextId) current.nodes[node.depthTextId].text = "LIGHT";
        const left = await render(current, leftId, variant.id), right = await render(current, rightId, variant.id);
        const wide = structuredClone(current); wide.slides = [wide.slides.find((slide) => slide.id === leftId)]; wide.variants = [{ ...variant, width: variant.width * 2 }];
        const widePhoto = wide.nodes[created.id]; widePhoto.frame = { ...widePhoto.variantFrames[variant.id] }; widePhoto.frame.x /= 2; widePhoto.frame.width /= 2;
        delete widePhoto.variantFrames; delete widePhoto.connection;
        const parts = [await pixels(left), await pixels(right)], reference = await pixels(await render(wide, leftId, variant.id));
        let difference = 0, maxAlpha = 0;
        for (let y = 0; y < variant.height; y++) for (let x = 0; x < variant.width * 2; x++) for (let c = 0; c < 4; c++) {
          const value = parts[x < variant.width ? 0 : 1][(y * variant.width + x % variant.width) * 4 + c];
          difference = Math.max(difference, Math.abs(value - reference[(y * variant.width * 2 + x) * 4 + c])); if (c === 3) maxAlpha = Math.max(maxAlpha, value);
        }
        const moved = applyProjectCommand(current, moveStorySlide(current, rightId, 1)).project;
        reports.push({ variant: variant.id, background, difference, maxAlpha, leftExact: await hash(left.bytes) === await hash((await render(moved, leftId, variant.id)).bytes),
          rightExact: await hash(right.bytes) === await hash((await render(moved, rightId, variant.id)).bytes) });
      }
      const missing = structuredClone(project); delete missing.nodes[created.id].maskId;
      const warning = (await render(missing, missing.nodes[created.id].anchorSlideId, "portrait")).warnings.some((item) => item.code === "CUTOUT_EFFECTS_SUBJECT_NEEDED");
      const zero = structuredClone(project); zero.nodes[created.id].cutoutEffects = { schema: 1, outline: { color: "#ffffff", width: 0 }, shadow: { color: "#000000", opacity: 0, blur: 0, x: 0, y: 0 } };
      const plain = structuredClone(zero); delete plain.nodes[created.id].cutoutEffects;
      const zeroExact = await hash((await render(zero, copy.anchorSlideId, "portrait")).bytes) === await hash((await render(plain, copy.anchorSlideId, "portrait")).bytes);
      const result = await render(project, copy.anchorSlideId, "portrait"), preview = await render(project, copy.anchorSlideId, "portrait", { preview: true, previewEdge: 120 });
      const full = api.Image.open(result.bytes), reduced = full.resize(preview.width, preview.height, "LANCZOS");
      const previewExact = await hash(reduced.saveWithInput("PNG", null)) === await hash(preview.bytes); reduced.free(); full.free();
      const pool = getProcessingScheduler(), runs = [];
      for (const count of [1, 2, 4].filter((n) => n <= pool.budget.cpu)) {
        pool.configure({ fixedConcurrency: count }); let violations = 0;
        const stop = pool.subscribe((state) => { if (state.active > count || state.estimatedBytes > state.memoryBudget) violations++; });
        const outputs = await Promise.all(Array.from({ length: 4 }, () => enqueueScene({ project, slideId: copy.anchorSlideId, variantId: "portrait", readAsset: bank }).promise));
        stop(); runs.push({ count, hashes: await Promise.all(outputs.map((output) => hash(output.output))), violations });
      }
      pool.configure({ mode: "auto" }); return { photo: [...photo], mask: [...mask], pointReports, reports, warning, zeroExact, previewExact, runs };
    });
    console.log(`  cutout effects native: ${JSON.stringify(evidence.reports)}`);
    for (const report of evidence.reports) { assert.ok(report.difference <= 2, JSON.stringify(report)); assert.ok(report.leftExact && report.rightExact); if (!report.background) assert.equal(report.maxAlpha, 171, "opacity applies once to the completed cutout/effect group"); }
    assert.ok(evidence.warning && evidence.zeroExact && evidence.previewExact);
    for (const point of evidence.pointReports) {
      assert.deepEqual(point.center, [92, 116, 168, 128], `${point.mode}: opaque subject protected, group opacity once`);
      assert.equal(point.diagonal[3], 0, "outline uses a disk, not square corners");
      if (point.mode !== "shadow") { assert.deepEqual(point.border, [255, 255, 255, 128]); assert.deepEqual(point.softBorder, [255, 255, 255, 40]); }
      if (point.mode !== "outline") { assert.deepEqual(point.shadow, [20, 36, 54, 64]); assert.deepEqual(point.softShadow, [20, 36, 54, 20]); }
    }
    for (const run of evidence.runs) { assert.equal(run.violations, 0); assert.deepEqual(run.hashes, evidence.runs[0].hashes); }
    if (process.env.TINY_IMAGE_STAR_EFFECTS_NATIVE_ONLY) return;
    await page.locator("#empty-story-button").click(); await page.locator("#story-title").fill("Cutout finish study");
    await page.locator("#story-files").setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `photo-${i}.png`, mimeType: "image/png", buffer: Buffer.from(evidence.photo) })));
    await ready(); await saved(); const initial = await project(), photoId = initial.slides[0].nodeIds.find((id) => initial.nodes[id].kind === "image");
    await page.locator('[data-story-tool="cutout"]').click(); await page.locator(".story-cutout-effects > summary").click(); await reviewed();
    assert.equal(await page.getByLabel("Outline around subject", { exact: true }).isDisabled(), true);
    await page.locator(".mask-editor details").filter({ hasText: "Import a mask" }).locator("summary").click();
    await page.locator("[data-mask-import]").setInputFiles({ name: "subject.png", mimeType: "image/png", buffer: Buffer.from(evidence.mask) }); await reviewed();
    await page.getByLabel("Outline around subject", { exact: true }).check(); await reviewed();
    await page.locator(".story-cutout-effects details > summary").click();
    await slider("Outline width", 1.2); await reviewed();
    await page.getByLabel("Shadow around subject", { exact: true }).check(); await reviewed();
    await slider("Shadow strength", 42); await slider("Shadow left / right", -1.5); await slider("Shadow softness", 1.2); await reviewed();
    await page.getByLabel("Shadow around subject", { exact: true }).uncheck(); await reviewed();
    await page.getByLabel("Shadow around subject", { exact: true }).check(); await reviewed(); assert.equal(await page.getByLabel("Shadow strength", { exact: true }).inputValue(), "42");
    await page.waitForFunction(() => { const image = document.querySelector("[data-cutout-effect-preview]"); return !image.hidden && image.complete && image.naturalWidth > 0; });
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    assert.equal(await page.locator("#story-sheet").evaluate((sheet) => sheet.scrollWidth > sheet.clientWidth), false);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    if (process.env.TINY_IMAGE_STAR_EFFECTS_ARTIFACTS) { const directory = new URL("../docs/research/2026-09-17/", import.meta.url); await mkdir(directory, { recursive: true });
      await page.locator(".story-cutout-effects details > summary").click();
      await page.locator(".story-cutout-effects > summary").scrollIntoViewIfNeeded(); await page.screenshot({ path: new URL("cutout-effects-phone.png", directory).pathname }); }
    await apply(); const edited = await project(), firstHash = await digest(), effect = edited.nodes[photoId].cutoutEffects;
    assert.equal(await page.locator("[data-cutout-effect-preview]").getAttribute("src"), null, "closing releases the extra decoded preview");
    assert.equal(effect.outline.width, .012); assert.equal(effect.shadow.opacity, .42); assert.equal(effect.shadow.x, -.015);
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal((await project()).nodes[photoId].cutoutEffects, undefined); assert.equal((await project()).nodes[photoId].maskId, undefined);
    await page.locator("#story-redo").click(); await ready(); await saved(); assert.equal(await digest(), firstHash);
    await page.locator('[data-story-tool="cutout"]').click(); await page.locator(".story-cutout-effects > summary").click(); await reviewed();
    await page.locator(".story-cutout-effects details > summary").click();
    await slider("Outline width", 2); await reviewed(); await page.goBack(); await page.waitForFunction(() => !document.querySelector("#story-sheet").open);
    await ready(); await saved(); assert.equal(await digest(), firstHash);
    await page.locator('[data-story-tool="layout"]').click(); await page.getByLabel("Story shape", { exact: true }).selectOption("tall"); await apply();
    const tallHash = await digest(); assert.deepEqual((await project()).nodes[photoId].cutoutEffects, effect);
    await page.reload(); await page.locator("#empty-story-button").click(); await page.locator("#story-library").getByRole("button", { name: "Cutout finish study", exact: true }).click();
    await ready(); await saved(); assert.equal(await digest(), tallHash);
    await page.locator('[data-story-tool="look"]').click(); await page.getByRole("button", { name: "Save my style", exact: true }).click();
    await page.getByLabel("Style name", { exact: true }).fill("Reusable border"); await page.getByLabel("Include Look", { exact: true }).uncheck();
    await page.getByLabel("Include Text style", { exact: true }).uncheck(); await page.getByLabel("Include Cutout finish", { exact: true }).check();
    await page.getByLabel("Cutout finish source", { exact: true }).selectOption(photoId); await page.getByRole("button", { name: "Save style", exact: true }).click();
    await waitForAsync(page, async () => (await (await import("./src/styles/store.js")).readStyleLibrary()).records.some((entry) => entry.style.name === "Reusable border"));
    const savedFinish = await page.evaluate(async () => (await (await import("./src/styles/store.js")).readStyleLibrary()).records.find((entry) => entry.style.name === "Reusable border").style);
    assert.deepEqual(savedFinish.components, { cutoutEffects: effect }); assert.deepEqual(savedFinish.assets, []);
    await page.locator("#story-sheet-cancel").click(); await ready(); await saved();
    await page.locator('[data-story-tool="cutout"]').click(); await page.locator(".story-cutout-effects > summary").click(); await reviewed();
    await page.getByLabel("Outline around subject", { exact: true }).uncheck(); await reviewed(); await page.getByLabel("Shadow around subject", { exact: true }).uncheck(); await apply();
    assert.equal((await project()).nodes[photoId].cutoutEffects, undefined);
    await page.locator('[data-story-tool="look"]').click(); await page.getByRole("button", { name: "Saved", exact: true }).click();
    await page.getByLabel("Look scope", { exact: true }).selectOption("this");
    await page.locator("[data-style-key]").filter({ hasText: "Reusable border" }).click(); await apply();
    assert.deepEqual((await project()).nodes[photoId].cutoutEffects, effect); assert.equal(await digest(), tallHash);
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal((await project()).nodes[photoId].cutoutEffects, undefined);
    await page.locator("#story-redo").click(); await ready(); await saved(); assert.equal(await digest(), tallHash);
    await page.locator('[data-story-tool="cutout"]').click(); await reviewed(); await page.getByRole("button", { name: "Remove cutout", exact: true }).click(); await apply();
    assert.deepEqual((await project()).nodes[photoId].cutoutEffects, effect); assert.match(await page.locator("#story-preview-message").innerText(), /Outline and shadow need a new subject/);
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), tallHash);
    await page.locator("#story-export").click(); await page.getByLabel("Story export format", { exact: true }).selectOption("png"); await page.getByRole("button", { name: "Prepare files", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".story-exports a").length === 4);
    const exportEvidence = await page.evaluate(async () => {
      const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(), opened = await store.readStoryProject(entry.key), project = opened.project;
      const { createPillowEngine } = await import("./src/engine/pillow.js"), { planScene } = await import("./src/compositor/scene-spec.js"), engine = await createPillowEngine();
      const slideId = project.slides[0].id, variantId = project.recipe.outputVariant, plan = planScene(project, slideId, variantId);
      const assets = await Promise.all(plan.assets.map(async (asset) => ({ id: asset.id, bytes: await (await opened.readAsset(asset.id)).arrayBuffer() })));
      const result = await engine.renderSlide({ project, slideId, variantId, assets }), link = document.querySelector(".story-exports a");
      return { actual: await store.hashAsset(await (await fetch(link.href)).arrayBuffer()), expected: await store.hashAsset(result.bytes), width: result.width, height: result.height };
    });
    assert.equal(exportEvidence.actual, exportEvidence.expected); assert.equal(exportEvidence.width, 1080); assert.equal(exportEvidence.height, 1920);
    assert.deepEqual(errors, []); console.log("  cutout effects phone: mask-to-effects, own-slide preview/cleanup, 200% text, grouped undo/redo, Back, shapes, reload, saved finish reuse, missing-mask fallback and exact saved PNG export");
  } finally { await context.close(); }
}
