import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

export async function assertSceneCompositor(browser, origin) {
  const font = await readFile(new URL("./fixtures/fonts/NotoSans.ttf", import.meta.url));
  const orientedSource = await readFile(new URL("./fixtures/exif-orientation6.jpg.base64", import.meta.url), "utf8");
  const context = await browser.newContext(), page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(origin);
    await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
    const report = await page.evaluate(async ({ fontBase64, orientedSource }) => {
      const { createPillowEngine } = await import("./src/engine/pillow.js");
      const { createSceneProject, validateProject } = await import("./src/project/model.js");
      const { planScene } = await import("./src/compositor/scene-spec.js");
      const { createPhotoStory } = await import("./src/story/recipes.js");
      const { adaptStoryLayoutCommand } = await import("./src/story/layout.js");
      const { applyProjectCommand } = await import("./src/project/history.js");
      const { resolveSlide } = await import("./src/project/model.js");
      const { layoutSceneText } = await import("./src/compositor/vector.js");
      const { enqueueScene } = await import("./src/processing/scene-client.js");
      const { getProcessingScheduler } = await import("./src/processing/client.js");
      const { sceneWork } = await import("./src/processing/policy.js");
      const { fontDigest: hash } = await import("./src/compositor/fonts.js");
      const api = await import("./wasm/pillow_rs_js.js");
      const engine = await createPillowEngine(), pool = getProcessingScheduler();
      const bank = new Map(), metadata = {};
      const add = async (id, kind, bytes, width, height) => {
        bank.set(id, bytes); metadata[id] = { id, kind, name: id, type: kind === "font" ? "font/ttf" : "image/png", byteLength: bytes.length,
          sha256: await hash(bytes), width: width ?? null, height: height ?? null, orientation: "upright" };
      };
      const make = async (id, width, height, pixel, mode = "RGBA") => {
        const channels = mode === "L" ? 1 : 4, data = new Uint8Array(width * height * channels);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * channels);
        const image = api.fromBytesFn(mode, width, height, data, "raw");
        try { await add(id, mode === "L" ? "mask" : "image", image.saveWithInput("PNG", null), width, height); }
        finally { image.free(); }
      };
      await make("red", 8, 8, () => [255, 0, 0, 255]);
      await make("alpha", 8, 8, () => [200, 100, 50, 128]);
      await make("wide", 8, 4, (x) => x < 4 ? [255, 0, 0, 255] : [0, 255, 0, 255]);
      await make("quadrants", 8, 8, (x, y) => y < 4 ? x < 4 ? [255, 0, 0, 255] : [0, 255, 0, 255] : x < 4 ? [0, 0, 255, 255] : [255, 255, 255, 255]);
      await make("mask", 8, 8, (x) => [x < 3 ? 255 : x < 5 ? 128 : 0], "L");
      await add("font", "font", Uint8Array.from(atob(fontBase64), (v) => v.charCodeAt(0)));
      const orientationBytes = Uint8Array.from(atob(orientedSource.trim()), (v) => v.charCodeAt(0));
      const rawJpeg = api.Image.open(orientationBytes);
      await add("oriented", "image", orientationBytes, rawJpeg.height, rawJpeg.width); rawJpeg.free();
      metadata.oriented.orientation = "exif-to-upright";
      const node = (id, kind, frame, extra = {}) => ({ id, kind, frame, space: "slide", ...extra });
      const full = { x: 0, y: 0, width: 1, height: 1 };
      const doc = (nodes, width = 128, height = 128) => {
        const project = createSceneProject({});
        project.assets = structuredClone(metadata); project.nodes = Object.fromEntries(nodes.map((entry) => [entry.id, entry]));
        project.slides = [{ id: "one", nodeIds: nodes.map((entry) => entry.id), overrides: {} }];
        project.variants = [{ id: "portrait", width, height }];
        return validateProject(project);
      };
      const packets = (project, slideId = "one", options = {}) => planScene(project, slideId, undefined, options).assets.map((asset) => ({ id: asset.id, bytes: bank.get(asset.id) }));
      const render = (project, slideId = "one", options = {}) => engine[options.preview ? "renderPreview" : "renderSlide"]({ project, slideId, ...options, assets: packets(project, slideId, options) });
      const pixels = async (output) => {
        const bitmap = await createImageBitmap(new Blob([output.bytes ?? output.output], { type: output.mime }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0); bitmap.close();
        return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
      };
      const pixel = (image, x, y) => Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
      const base = node("background", "shape", full, { color: "#0000ff" });
      const portrait = node("photo", "image", { x: .25, y: .25, width: .5, height: .5 }, { assetId: "red", maskId: "mask", opacity: .5 });
      const layered = doc([base, portrait, node("top", "shape", { x: .45, y: .45, width: .1, height: .1 }, { color: "#00ff00" })]);
      const layerPixels = await pixels(await render(layered));
      const samples = { outside: pixel(layerPixels, 8, 8), maskedLeft: pixel(layerPixels, 40, 64), maskedRight: pixel(layerPixels, 88, 64), orderedTop: pixel(layerPixels, 64, 64) };
      const positions = {};
      for (const [label, extra] of [["left", { focal: { x: 0, y: .5 } }], ["right", { focal: { x: 1, y: .5 } }], ["crop", { crop: { x: .5, y: 0, width: .5, height: 1 } }], ["contain", { fit: "contain" }]]) {
        const result = await pixels(await render(doc([node("p", "image", full, { assetId: "wide", ...extra })])));
        positions[label] = { center: pixel(result, 64, 64), top: pixel(result, 64, 8) };
      }
      const rotated = await pixels(await render(doc([node("p", "image", full, { assetId: "quadrants", rotation: 90 })])));
      const gray = await pixels(await render(doc([node("p", "image", full, { assetId: "alpha", appearance: { grayscaleMix: 1 } })])));
      const groupOpacity = await pixels(await render(doc([node("shape", "shape", { x: .2, y: .2, width: .6, height: .6 }, {
        opacity: .5, color: "#ff0000", style: { shape: "rounded", strokeColor: "#000000", strokeWidth: .1 } })])));
      const maximumGroupAlpha = Math.max(...Array.from(groupOpacity.data).filter((_, index) => index % 4 === 3));
      samples.rotatedTopLeft = pixel(rotated, 24, 24); samples.rotatedTopRight = pixel(rotated, 104, 24); samples.grayAlpha = pixel(gray, 64, 64);
      const upright = await pixels(await engine.preview({ bytes: orientationBytes }));
      const oriented = await pixels(await render(doc([node("p", "image", full, { assetId: "oriented" })], upright.width, upright.height)));
      const orientationMatches = oriented.data.every((value, index) => value === upright.data[index]);
      const depth = doc([
        node("back", "image", full, { assetId: "quadrants" }),
        node("words", "text", { x: .03, y: .2, width: .94, height: .6 }, { fontId: "font", text: "HELLOOOO", color: "#202124", style: { fontSize: .35 } }),
        node("front", "image", full, { assetId: "quadrants", maskId: "mask" }),
      ]);
      const withoutText = structuredClone(depth); withoutText.slides[0].nodeIds = ["back", "front"];
      const depthPixels = await pixels(await render(depth)), depthBase = await pixels(await render(withoutText));
      let occludedDifference = 0, revealedPixels = 0;
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const changed = pixel(depthPixels, x, y).some((value, channel) => value !== pixel(depthBase, x, y)[channel]);
        if (x < 32 && changed) occludedDifference++; if (x >= 96 && changed) revealedPixels++;
      }

      const story = doc([
        node("paper", "shape", { x: 0, y: 0, width: 2, height: 1 }, { color: "#f4eee4" }),
        node("connected-photo", "image", { x: .6, y: .15, width: .8, height: .7 }, { assetId: "quadrants", maskId: "mask", rotation: -12 }),
        node("ellipse", "shape", { x: .9, y: .72, width: .25, height: .2 }, { color: "#c88b5bbb", rotation: 12, style: { shape: "ellipse", strokeColor: "#202124", strokeWidth: .05 } }),
        node("caption", "text", { x: .72, y: .13, width: .6, height: .3 }, { text: "HI TEAM", fontId: "font", color: "#202124", rotation: -5,
          style: { fontSize: .12, minFontSize: .02, shadow: { color: "#00000088", blur: .015, x: .008, y: .01 } } }),
      ], 128, 160);
      for (const layer of Object.values(story.nodes)) Object.assign(layer, { space: "story", anchorSlideId: "one" });
      story.slides.push({ ...structuredClone(story.slides[0]), id: "two" });
      const wideStory = structuredClone(story); wideStory.slides.pop(); wideStory.variants[0].width *= 2;
      for (const layer of Object.values(wideStory.nodes)) { layer.frame.x /= 2; layer.frame.width /= 2; }
      const left = await pixels(await render(story)), right = await pixels(await render(story, "two"));
      const stitchedResult = await render(wideStory), stitched = await pixels(stitchedResult);
      let maxDifference = 0, seamDifference = 0;
      for (let y = 0; y < 160; y++) for (let x = 0; x < 256; x++) for (let channel = 0; channel < 4; channel++) {
        const part = x < 128 ? left : right;
        const difference = Math.abs(part.data[(y * 128 + x % 128) * 4 + channel] - stitched.data[(y * 256 + x) * 4 + channel]);
        maxDifference = Math.max(maxDifference, difference); if (x >= 122 && x <= 133) seamDifference = Math.max(seamDifference, difference);
      }
      const diagnostics = [];
      if (maxDifference > 2) for (const id of ["connected-photo", "ellipse", "caption"]) {
        const a = structuredClone(story), b = structuredClone(wideStory);
        for (const slide of [...a.slides, ...b.slides]) slide.nodeIds = ["paper", id];
        const parts = [await pixels(await render(a)), await pixels(await render(a, "two"))], all = await pixels(await render(b));
        let maximum = 0, count = 0, sample;
        for (let y = 0; y < 160; y++) for (let x = 0; x < 256; x++) {
          const actual = pixel(parts[x < 128 ? 0 : 1], x % 128, y), expected = pixel(all, x, y);
          const difference = Math.max(...actual.map((value, channel) => Math.abs(value - expected[channel])));
          if (difference > 2) count++;
          if (difference > maximum) { maximum = difference; sample = { x, y, actual, expected }; }
        }
        diagnostics.push({ id, maximum, count, sample });
      }
      const twoEstimate = sceneWork(planScene(story, "one"));
      const manyStory = structuredClone(story);
      for (let index = 2; index < 8; index++) manyStory.slides.push({ ...structuredClone(story.slides[0]), id: `slide-${index}` });
      const eightEstimate = sceneWork(planScene(manyStory, "one"));

      // Odd-sized viewports cross several raster tiles. Anchor on the middle
      // slide so the first viewport is culled and later ones share world edges.
      const offsetStory = structuredClone(story);
      offsetStory.variants[0] = { id: "odd", width: 257, height: 321 };
      offsetStory.slides.push({ ...structuredClone(story.slides[0]), id: "three" });
      for (const layer of Object.values(offsetStory.nodes)) layer.anchorSlideId = "two";
      const offsetReference = structuredClone(offsetStory);
      offsetReference.slides.splice(1); offsetReference.variants[0].width *= 3;
      for (const layer of Object.values(offsetReference.nodes)) {
        layer.anchorSlideId = "one"; layer.frame.x = (1 + layer.frame.x) / 3; layer.frame.width /= 3;
      }
      const offsetAll = await pixels(await render(offsetReference));
      let offsetDifference = 0;
      for (const [index, slide] of offsetStory.slides.entries()) {
        const part = await pixels(await render(offsetStory, slide.id));
        for (let y = 0; y < 321; y++) for (let x = 0; x < 257; x++) for (let channel = 0; channel < 4; channel++) {
          offsetDifference = Math.max(offsetDifference, Math.abs(part.data[(y * 257 + x) * 4 + channel] - offsetAll.data[(y * 771 + index * 257 + x) * 4 + channel]));
        }
      }
      const culledAssets = planScene(offsetStory, "one").assets.length;
      if (offsetDifference > 2) for (const id of ["connected-photo", "ellipse", "caption"]) {
        const a = structuredClone(offsetStory), b = structuredClone(offsetReference);
        for (const slide of [...a.slides, ...b.slides]) slide.nodeIds = ["paper", id];
        const all = await pixels(await render(b)); let maximum = 0;
        for (const [index, slide] of a.slides.entries()) {
          const part = await pixels(await render(a, slide.id));
          for (let y = 0; y < 321; y++) for (let x = 0; x < 257; x++) for (let channel = 0; channel < 4; channel++) maximum = Math.max(maximum,
            Math.abs(part.data[(y * 257 + x) * 4 + channel] - all.data[(y * 771 + index * 257 + x) * 4 + channel]));
        }
        diagnostics.push({ offsetNode: id, maximum });
      }

      const large = doc([node("p", "image", full, { assetId: "quadrants" }), node("t", "text", { x: .1, y: .1, width: .8, height: .2 }, { fontId: "font", text: "A real preview", style: { fontSize: .08 } })], 1600, 2000);
      const largeOutput = await render(large), preview = await render(large, "one", { preview: true });
      let opened, resized, previewReference;
      try { opened = api.Image.open(largeOutput.bytes); resized = opened.resize(preview.width, preview.height, "LANCZOS"); previewReference = await hash(resized.saveWithInput("PNG", null)); }
      finally { opened?.free(); resized?.free(); }
      const tall = structuredClone(layered); tall.variants = [{ id: "tall", width: 108, height: 192 }];
      const tallPixels = await pixels(await render(tall));
      const jpeg = await render(story, "one", { format: "jpeg" });
      const jpegPixels = await pixels(jpeg);
      const overflow = await render(doc([node("tiny", "text", { x: .1, y: .1, width: .01, height: .01 }, { text: "A long caption that must be reviewed", style: { fontSize: .1, minFontSize: .05 } })]));
      const baseline = await render(story), baselineHash = await hash(baseline.bytes), runs = [];
      for (const count of [1, 2, 4, 8].filter(value => value <= pool.budget.cpu)) {
        pool.configure({ fixedConcurrency: count });
        let peak = 0, violations = 0;
        const stop = pool.subscribe((value) => { peak = Math.max(peak, value.active); if (value.estimatedBytes > value.memoryBudget || value.active > count) violations++; });
        const tasks = Array.from({ length: 12 }, () => enqueueScene({ project: story, slideId: "one", readAsset: (id) => bank.get(id) }));
        const outputs = await Promise.all(tasks.map((task) => task.promise)); stop();
        runs.push({ count, peak, violations, hashes: await Promise.all(outputs.map((output) => hash(output.output))), revisions: outputs.map((output) => output.projectRevision) });
      }
      const fail = async (request) => { try { await engine.renderSlide(request); return null; } catch (error) { return error.code ?? error.message; } };
      const badBytes = packets(story).map((asset) => ({ ...asset, bytes: asset.bytes.slice() })); badBytes[0].bytes[10] ^= 1;
      const changed = await fail({ project: story, slideId: "one", assets: badBytes });
      const missing = await fail({ project: story, slideId: "one", assets: packets(story).slice(1) });
      const wrongDimensions = structuredClone(story); wrongDimensions.assets.quadrants.width = 16; wrongDimensions.assets.quadrants.height = 4;
      delete wrongDimensions.nodes["connected-photo"].maskId;
      const dimensions = await fail({ project: wrongDimensions, slideId: "one", assets: packets(wrongDimensions) });
      const badMask = structuredClone(layered); badMask.assets.red.kind = "mask"; badMask.nodes.photo.assetId = "quadrants"; badMask.nodes.photo.maskId = "red";
      const maskMode = await fail({ project: badMask, slideId: "one", assets: packets(badMask) });
      const tooLarge = structuredClone(story); tooLarge.variants[0] = { id: "huge", width: 16384, height: 4096 };
      let oversizedReads = 0, oversized = false;
      try { await enqueueScene({ project: tooLarge, slideId: "one", readAsset: (id) => { oversizedReads++; return bank.get(id); } }).promise; } catch (error) { oversized = /memory budget/.test(error.message); }

      pool.configure({ fixedConcurrency: 1 });
      let release, started;
      const gate = new Promise((resolve) => { release = resolve; });
      const admitted = new Promise((resolve) => { started = resolve; });
      const active = enqueueScene({ project: story, slideId: "one", readAsset: async (id) => { started(); await gate; return bank.get(id); } });
      const activeOutcome = active.promise.catch((error) => error.name);
      await admitted;
      let cancelledReads = 0;
      const queued = enqueueScene({ project: story, slideId: "one", readAsset: (id) => { cancelledReads++; return bank.get(id); } });
      const queuedOutcome = queued.promise.catch((error) => error.name);
      queued.cancel(); active.cancel(); release();
      const cancellations = [await activeOutcome, await queuedOutcome];
      const immutable = structuredClone(story); immutable.revision = 7;
      const pending = enqueueScene({ project: immutable, slideId: "one", readAsset: (id) => bank.get(id) });
      immutable.revision = 8; immutable.nodes.caption.text = "Changed after submit";
      const immutableResult = await pending.promise;
      // Compare variant-aware, width-sized story rendering with a plain graph
      // whose coordinates and physical text sizes are baked into one variant.
      for (let index = 0; index < 6; index++) await make(`layout-${index}`, 48, 64, (x, y) => [x * 5, y * 3, index * 40, 255]);
      let adaptive = createPhotoStory(Array.from({ length: 6 }, (_, index) => metadata[`layout-${index}`]));
      adaptive.variants = [{ id: "portrait", width: 216, height: 270 }, { id: "tall", width: 216, height: 384 }];
      adaptive.nodes[`${adaptive.slides[1].id}:caption`].text = "Mornings together";
      for (const slide of adaptive.slides) adaptive = applyProjectCommand(adaptive, adaptStoryLayoutCommand(adaptive, slide.id)).project;
      const layoutRenders = [];
      for (const variant of adaptive.variants) {
        const slideId = adaptive.slides[1].id, flat = structuredClone(adaptive), resolved = resolveSlide(adaptive, slideId, variant.id);
        for (const node of Object.values(flat.nodes)) {
          node.frame = node.variantFrames?.[variant.id] ?? node.frame; delete node.variantFrames;
          if (node.style?.fontBasis === "width") {
            node.style.fontSize *= variant.width / variant.height; node.style.minFontSize *= variant.width / variant.height; delete node.style.fontBasis;
          }
        }
        flat.variants = [variant];
        const actual = await render(adaptive, slideId, { variantId: variant.id }), reference = await render(flat, slideId);
        const ctx = new OffscreenCanvas(1, 1).getContext("2d"), number = resolved.nodes.find((node) => node.id.endsWith(":number"));
        layoutRenders.push({ variant: variant.id, matches: await hash(actual.bytes) === await hash(reference.bytes),
          width: actual.width, height: actual.height, numberSize: layoutSceneText(ctx, number, variant.height, new Map(), variant.width).size });
      }
      pool.configure({ mode: "auto" }); engine.dispose();
      let disposed = false; try { await engine.renderSlide({}); } catch (error) { disposed = error.code === "DISPOSED"; }
      return { samples, positions, maximumGroupAlpha, orientationMatches, depth: { occludedDifference, revealedPixels }, maxDifference, seamDifference, offsetDifference, culledAssets, diagnostics, sameMemory: JSON.stringify(twoEstimate) === JSON.stringify(eightEstimate),
        preview: { width: preview.width, height: preview.height, canonicalWidth: preview.canonicalWidth, canonicalHeight: preview.canonicalHeight,
          matches: await hash(preview.bytes) === previewReference }, tall: { width: tallPixels.width, height: tallPixels.height, top: pixel(tallPixels, 54, 96) },
        jpeg: { width: jpegPixels.width, height: jpegPixels.height, opaque: Array.from(jpegPixels.data).every((value, index) => index % 4 !== 3 || value === 255) },
        warnings: overflow.warnings, runs, baselineHash, changed, missing, dimensions, maskMode, oversized, oversizedReads, cancellations, cancelledReads,
        immutable: { revision: immutableResult.projectRevision, hash: await hash(immutableResult.output) }, disposed, layoutRenders,
        art: btoa(String.fromCharCode(...stitchedResult.bytes)) };
    }, { fontBase64: font.toString("base64"), orientedSource });
    assert.deepEqual(report.samples.outside, [0, 0, 255, 255]);
    report.samples.maskedLeft.forEach((value, index) => assert.ok(Math.abs(value - [128, 0, 127, 255][index]) <= 1));
    assert.deepEqual(report.samples.maskedRight, [0, 0, 255, 255]); assert.deepEqual(report.samples.orderedTop, [0, 255, 0, 255]);
    assert.deepEqual(report.positions.left.center, [255, 0, 0, 255]); assert.deepEqual(report.positions.right.center, [0, 255, 0, 255]);
    assert.deepEqual(report.positions.crop.center, [0, 255, 0, 255]); assert.equal(report.positions.contain.top[3], 0);
    assert.deepEqual(report.samples.rotatedTopLeft, [0, 0, 255, 255]); assert.deepEqual(report.samples.rotatedTopRight, [255, 0, 0, 255]);
    assert.equal(report.samples.grayAlpha[3], 128); assert.ok(Math.max(...report.samples.grayAlpha.slice(0, 3)) - Math.min(...report.samples.grayAlpha.slice(0, 3)) <= 1);
    assert.equal(report.maximumGroupAlpha, 128, "layer opacity applies once even where its fill and stroke overlap");
    assert.equal(report.orientationMatches, true, "scene EXIF normalization agrees with the established upright preview");
    assert.equal(report.depth.occludedDifference, 0, "the foreground mask completely covers text in its opaque region");
    assert.ok(report.depth.revealedPixels > 5, "text remains visible through the transparent foreground region");
    assert.ok(report.maxDifference <= 2, `per-slide render versus one reference viewport differs by ${report.maxDifference}: ${JSON.stringify(report.diagnostics)}`);
    assert.ok(report.seamDifference <= 2, `connected seam difference ${report.seamDifference}`);
    assert.ok(report.offsetDifference <= 2, `offset anchor and odd viewport difference ${report.offsetDifference}: ${JSON.stringify(report.diagnostics)}`);
    assert.equal(report.culledAssets, 0, "an offscreen connected scene does not load its photos, masks or fonts");
    assert.equal(report.sameMemory, true, "eight-slide metadata does not allocate an eight-slide canvas");
    assert.deepEqual(report.preview, { width: 1024, height: 1280, canonicalWidth: 1600, canonicalHeight: 2000, matches: true });
    assert.deepEqual(report.tall, { width: 108, height: 192, top: [0, 255, 0, 255] });
    assert.deepEqual(report.jpeg, { width: 128, height: 160, opaque: true });
    assert.deepEqual(report.warnings, [{ code: "TEXT_OVERFLOW", nodeId: "tiny" }]);
    for (const run of report.runs) { assert.equal(run.peak, run.count); assert.equal(run.violations, 0); assert.ok(run.hashes.every((hash) => hash === report.baselineHash)); assert.ok(run.revisions.every((revision) => revision === 0)); }
    assert.equal(report.changed, "ASSET_CHANGED"); assert.equal(report.missing, "MISSING_ASSET"); assert.equal(report.dimensions, "ASSET_CHANGED"); assert.equal(report.maskMode, "UNSUPPORTED_OPERATION");
    assert.equal(report.oversized, true); assert.equal(report.oversizedReads, 0);
    assert.deepEqual(report.cancellations, ["AbortError", "AbortError"]); assert.equal(report.cancelledReads, 0);
    assert.deepEqual(report.immutable, { revision: 7, hash: report.baselineHash }); assert.equal(report.disposed, true); assert.deepEqual(errors, []);
    assert.deepEqual(report.layoutRenders.map(({ numberSize, ...entry }) => entry), [
      { variant: "portrait", matches: true, width: 216, height: 270 }, { variant: "tall", matches: true, width: 216, height: 384 },
    ], "adaptive variant frames and width-sized text render identically to a flattened plain graph");
    assert.equal(report.layoutRenders[0].numberSize, report.layoutRenders[1].numberSize, "same-width outputs retain the same physical type size");
    if (process.env.TINY_IMAGE_STAR_SCENE_ARTIFACT) {
      const output = new URL("../docs/research/2026-09-17/", import.meta.url);
      await mkdir(output, { recursive: true }); await writeFile(new URL("scene-seam.png", output), Buffer.from(report.art, "base64"));
    }
    console.log(`  scene compositor: layers/masks/focal crops/rotation/alpha, ${report.seamDifference}-level seam and ${report.offsetDifference}-level odd-viewport difference, exact 1280px preview, 1/4/8 workers, immutable revisions and pre-read cancellation/budget checks`);
  } finally { await context.close(); }
}
