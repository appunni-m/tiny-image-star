import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

export async function assertSourceResolution(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = []; page.setDefaultTimeout(90_000);
  page.on("pageerror", error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => !document.querySelector("#story-export").disabled && document.querySelector("#story-status").textContent === "Saved on this device");
  const reviewed = () => page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled);
  const apply = async () => { await reviewed(); await page.locator("#story-sheet-apply").click(); await ready(); };
  const open = async photoId => { await page.locator('[data-story-tool="photos"]').click(); await page.getByLabel("Photo to edit", { exact: true }).selectOption(photoId); };
  const state = () => page.evaluate(async () => {
    const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(), saved = await store.readStoryProject(entry.key);
    const hashes = {}; for (const asset of Object.values(saved.project.assets)) hashes[asset.id] = await store.hashAsset(await (await saved.readAsset(asset.id)).arrayBuffer());
    return { project: saved.project, hashes };
  });
  const shape = value => { const p = structuredClone(value); delete p.revision; return p; };
  try {
    await page.goto(origin); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
    const evidence = await page.evaluate(async () => {
      const { createPillowEngine } = await import("./src/engine/pillow.js"), engine = await createPillowEngine(), api = await import("./wasm/pillow_rs_js.js");
      const { createPhotoStory, slidePhotos } = await import("./src/story/recipes.js"), { storyMaskCommand } = await import("./src/story/masks.js");
      const { storyDepthCommand } = await import("./src/story/depth.js"), { createConnectedCutout } = await import("./src/story/connections.js");
      const { applyProjectCommand } = await import("./src/project/history.js"), { prepareSourceResolution } = await import("./src/story/source-resolution.js");
      const { hashAsset, writeStoryProject } = await import("./src/project/storage.js"), { ResourceScheduler } = await import("./src/processing/scheduler.js");
      const width = 2052, height = 513, rgb = new Uint8Array(width * height * 3), coverage = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        rgb.set([x % 251, y % 239, (x + y) % 253], (y * width + x) * 3);
        coverage[y * width + x] = Math.max(0, Math.min(255, Math.round(128 + (x - width / 2) / 3)));
      }
      const encode = (mode, bytes, format = "PNG") => { const image = api.fromBytesFn(mode, width, height, bytes, "raw"); try { return image.saveWithInput(format, null); } finally { image.free(); } };
      const imageBytes = encode("RGB", rgb), maskBytes = encode("L", coverage), original = { id: "source", kind: "image", name: "Original photo", type: "image/png",
        width, height, sha256: await hashAsset(imageBytes), byteLength: imageBytes.length, orientation: "upright" };
      const mask = { ...original, id: "mask", kind: "mask", name: "Soft cutout", sha256: await hashAsset(maskBytes), byteLength: maskBytes.length };
      const assets = Array.from({ length: 6 }, (_, i) => ({ ...original, id: `source-${i}` }));
      let project = createPhotoStory(assets, { title: "Resolution story" });
      const originalId = slidePhotos(project, project.slides[0].id)[0].id;
      project = applyProjectCommand(project, storyMaskCommand(project, originalId, mask)).project;
      const connection = createConnectedCutout(project, originalId, project.slides[0].id), photoId = connection.id;
      project = applyProjectCommand(project, connection.command).project;
      project = applyProjectCommand(project, storyDepthCommand(project, photoId)).project;
      project.nodes[photoId].crop = { x: .1, y: .1, width: .8, height: .75 };
      project.nodes[photoId].appearance = { brightness: 1.1, contrast: .9 };
      const sources = new Map(assets.map(a => [a.id, new Blob([imageBytes], { type: "image/png" })])); sources.set(mask.id, new Blob([maskBytes], { type: "image/png" }));
      const nativePixels = async blob => { const bitmap = await createImageBitmap(blob), canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0); bitmap.close(); return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data }; };
      const reference = bytes => { const image = api.Image.open(bytes), resized = image.resize(2048, 512, "LANCZOS"); try { return new Blob([resized.saveWithInput("PNG", null)], { type: "image/png" }); } finally { resized.free(); image.free(); } };
      const references = [await nativePixels(reference(imageBytes)), await nativePixels(reference(maskBytes))], runs = [];
      let reduced;
      for (const count of [1, 4, 8]) {
        const pool = new ResourceScheduler({ hints: { hardwareConcurrency: 9, deviceMemory: 16 }, workerFactory: () => new Worker(new URL("./src/worker.js", location.href), { type: "module" }) });
        pool.configure({ fixedConcurrency: count }); let peak = 0, violations = 0;
        const stop = pool.subscribe(s => { peak = Math.max(peak, [...pool.slots].filter(slot => slot.task?.workClass?.startsWith("story-source-copy:")).length); if (s.estimatedBytes > s.memoryBudget) violations++; });
        try {
          const results = await Promise.all(Array.from({ length: 4 }, (_, i) => prepareSourceResolution(project, photoId, "working", {
            pool, readAsset: id => sources.get(id), onRetainedBytes: n => pool.setRetainedBytes(`copy-${i}`, n),
          })));
          const hashes = [], differences = [];
          for (const result of results) {
            const p = applyProjectCommand(project, result.command).project, photo = p.nodes[photoId], values = [];
            for (const [i, id] of [photo.assetId, photo.maskId].entries()) {
              const bytes = new Uint8Array(await result.sources.get(id).arrayBuffer()), actual = await nativePixels(result.sources.get(id)), expected = references[i];
              if (i === 1 && (bytes[24] !== 8 || bytes[25] !== 0)) throw new Error("Copy lost grayscale mask encoding");
              if (actual.width !== expected.width || actual.height !== expected.height) throw new Error("Copy dimensions differ");
              let maximum = 0; for (let k = 0; k < actual.data.length; k++) maximum = Math.max(maximum, Math.abs(actual.data[k] - expected.data[k]));
              differences.push(maximum); values.push(await hashAsset(bytes));
            }
            hashes.push(values);
          }
          reduced = { result: results[0], project: applyProjectCommand(project, results[0].command).project };
          runs.push({ concurrency: count, peak, violations, hashes, maximumPixelDifferences: differences });
        } finally { stop(); await pool.close(); }
      }
      const reducedPhoto = reduced.project.nodes[photoId], reducedMask = reduced.project.assets[reducedPhoto.maskId];
      const editedBytes = await reduced.result.sources.get(reducedMask.id).arrayBuffer(), image = api.Image.open(new Uint8Array(editedBytes));
      let edited;
      try { const pixels = image.toBytes(); pixels.fill(0, 100 * 2048, 120 * 2048); const next = api.fromBytesFn("L", 2048, 512, pixels, "raw"); try { edited = next.saveWithInput("PNG", null); } finally { next.free(); } }
      finally { image.free(); }
      const editedMask = { ...reducedMask, id: "painted", byteLength: edited.length, sha256: await hashAsset(edited) }; delete editedMask.workingCopy;
      const painted = applyProjectCommand(reduced.project, storyMaskCommand(reduced.project, photoId, editedMask)).project;
      const currentSources = new Map([...sources, ...reduced.result.sources, [editedMask.id, new Blob([edited])]]);
      const pool = new ResourceScheduler({ hints: { hardwareConcurrency: 3, deviceMemory: 4 }, workerFactory: () => new Worker(new URL("./src/worker.js", location.href), { type: "module" }) });
      let restoredPixels;
      try {
        const restored = await prepareSourceResolution(painted, photoId, "original", { pool, readAsset: id => currentSources.get(id) }), p = applyProjectCommand(painted, restored.command).project;
        if (!restored.upsampledMask || restored.restoredMask) throw new Error("Edited mask restoration classification");
        const actual = await nativePixels(restored.sources.get(p.nodes[photoId].maskId));
        const input = api.Image.open(edited), resized = input.resize(width, height, "LANCZOS"); let expected;
        try { expected = await nativePixels(new Blob([resized.saveWithInput("PNG", null)])); } finally { resized.free(); input.free(); }
        let maximum = 0; for (let i = 0; i < actual.data.length; i++) maximum = Math.max(maximum, Math.abs(actual.data[i] - expected.data[i]));
        restoredPixels = { maximum, width: actual.width, height: actual.height, editedBand: actual.data[(110 * width + 1900) * 4] };
      } finally { await pool.close(); }
      // Upright metadata must not apply an embedded EXIF tag for a second time.
      const jpeg = encode("RGB", rgb, "JPEG"), exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,77,77,0,42,0,0,0,8,0,1,1,18,0,3,0,0,0,1,0,6,0,0,0,0,0,0]);
      const tagged = new Uint8Array(jpeg.length + exif.length); tagged.set(jpeg.subarray(0,2)); tagged.set(exif,2); tagged.set(jpeg.subarray(2),2 + exif.length);
      const taggedAsset = { ...original, type: "image/jpeg", byteLength: tagged.length, sha256: await hashAsset(tagged) };
      const upright = await engine.resampleSource({ asset: taggedAsset, bytes: tagged.buffer.slice(0), width: 2048, height: 512 });
      const untagged = await engine.resampleSource({ asset: { ...taggedAsset, byteLength: jpeg.length, sha256: await hashAsset(jpeg) }, bytes: jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength), width: 2048, height: 512 });
      const exifApplied = await engine.resampleSource({ asset: { ...taggedAsset, orientation: "exif-to-upright", width: height, height: width }, bytes: tagged.buffer.slice(0), width: 512, height: 2048 });
      const orientation = { uprightHash: await hashAsset(upright.bytes), untaggedHash: await hashAsset(untagged.bytes), exifWidth: exifApplied.width, exifHeight: exifApplied.height };
      let invalidMaskRejected = false;
      try { await engine.resampleSource({ asset: { ...original, kind: "mask" }, bytes: imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength), width: 2048, height: 512 }); }
      catch (error) { invalidMaskRejected = error.code === "INVALID_MASK"; }
      const saved = await writeStoryProject(project, { readAsset: id => sources.get(id) }); engine.dispose();
      return { photoId, originalId, key: saved.key, runs, restoredPixels, orientation, invalidMaskRejected };
    });
    for (const run of evidence.runs) {
      assert.equal(run.peak, run.concurrency); assert.equal(run.violations, 0); assert.ok(run.maximumPixelDifferences.every(n => n === 0));
      for (const hashes of run.hashes) assert.deepEqual(hashes, evidence.runs[0].hashes[0]);
    }
    assert.deepEqual(evidence.restoredPixels, { maximum: 0, width: 2052, height: 513, editedBand: 0 });
    assert.equal(evidence.orientation.uprightHash, evidence.orientation.untaggedHash); assert.equal(evidence.orientation.exifWidth, 512); assert.equal(evidence.orientation.exifHeight, 2048);
    assert.equal(evidence.invalidMaskRejected, true);
    await page.reload(); await page.locator("#empty-story-button").click(); await page.locator("#story-library").getByRole("button", { name: "Resolution story", exact: true }).click(); await ready();
    const original = await state();
    await open(evidence.photoId);
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    const reduce = page.getByRole("button", { name: "Make smaller editing copy", exact: true });
    assert.ok((await reduce.boundingBox()).height >= 44); assert.equal(await page.locator("#story-sheet-content").evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert.equal(await page.locator("#story-sheet-cancel").evaluate(el => getComputedStyle(el).whiteSpace), "nowrap");
    await reduce.click(); await reviewed();
    if (process.env.TINY_IMAGE_STAR_SOURCE_RESOLUTION_ARTIFACTS) {
      const dir = new URL("../docs/research/2026-09-20/source-resolution/", import.meta.url); await mkdir(dir, { recursive: true });
      await page.screenshot({ path: new URL("photos-200-percent.png", dir).pathname });
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await page.locator("#story-sheet-cancel").click(); await ready(); assert.deepEqual(shape((await state()).project), shape(original.project));
    await open(evidence.photoId); await reduce.click(); await apply();
    const smaller = await state(), p = smaller.project, node = p.nodes[evidence.photoId], old = original.project.nodes[evidence.photoId];
    assert.deepEqual({ ...node, assetId: old.assetId, maskId: old.maskId }, old);
    assert.deepEqual(p.nodes[evidence.originalId], original.project.nodes[evidence.originalId]); assert.deepEqual(p.slides, original.project.slides);
    assert.equal(p.assets[node.assetId].width, 2048); assert.equal(p.assets[node.maskId].height, 512);
    assert.equal(smaller.hashes[old.maskId], original.hashes[old.maskId]);
    await page.locator("#story-undo").click(); await ready(); assert.deepEqual(shape((await state()).project), shape(original.project));
    await page.locator("#story-redo").click(); await ready(); assert.deepEqual(shape((await state()).project), shape(smaller.project));
    await page.reload(); await page.locator("#empty-story-button").click(); await page.locator("#story-library").getByRole("button", { name: "Resolution story", exact: true }).click(); await ready();
    assert.deepEqual((await state()).hashes, smaller.hashes);
    await open(evidence.photoId); await page.getByRole("button", { name: "Use original with current cutout", exact: true }).click(); await reviewed();
    assert.match(await page.locator("[data-source-resolution-note]").innerText(), /Original photo and original cutout restored/); await apply();
    const restored = await state(); assert.deepEqual(restored.project.nodes[evidence.photoId], old); assert.equal(restored.hashes[old.maskId], original.hashes[old.maskId]);
    // Worker preparation is deliberately held so Cancel and photo selection
    // exercise late completion, rather than relying on machine speed.
    await page.evaluate(async () => {
      const pool = (await import("./src/processing/client.js")).getProcessingScheduler(), enqueue = pool.enqueue.bind(pool);
      window.__copyGate = { mode: "hold", entered: 0, restore: () => { pool.enqueue = enqueue; } };
      pool.enqueue = task => {
        if (!task.workClass?.startsWith("story-source-copy:")) return enqueue(task);
        if (window.__copyGate.mode === "fail") return { promise: Promise.reject(new Error("Injected copy failure")) };
        return enqueue({ ...task, prepare: async (...args) => {
          window.__copyGate.entered++;
          await new Promise(resolve => { if (task.signal.aborted) resolve(); else task.signal.addEventListener("abort", resolve, { once: true }); });
          return task.prepare(...args);
        } });
      };
    });
    // Another slide contains distinct original assets without cached copies.
    await page.locator("#story-filmstrip button").nth(1).click(); await ready();
    await page.locator('[data-story-tool="photos"]').click();
    await reduce.click(); await page.waitForFunction(() => window.__copyGate.entered > 0);
    assert.equal(await page.locator("#story-sheet-apply").isDisabled(), true);
    await page.locator("#story-sheet-cancel").click(); await ready(); assert.deepEqual(shape((await state()).project), shape(restored.project));
    await page.evaluate(() => { window.__copyGate.entered = 0; });
    await page.locator('[data-story-tool="photos"]').click(); await reduce.click(); await page.waitForFunction(() => window.__copyGate.entered > 0);
    const options = await page.getByLabel("Photo to edit", { exact: true }).locator("option").evaluateAll(nodes => nodes.map(n => n.value));
    await page.getByLabel("Photo to edit", { exact: true }).selectOption(options[1]); await reviewed();
    assert.equal(await reduce.isEnabled(), true);
    await page.locator("#story-sheet-cancel").click(); await ready(); assert.deepEqual(shape((await state()).project), shape(restored.project));
    await page.evaluate(() => { window.__copyGate.mode = "fail"; });
    await page.locator('[data-story-tool="photos"]').click(); await reduce.click();
    await page.waitForFunction(() => document.querySelector("#story-sheet-preview-status").textContent.includes("Injected copy failure"));
    assert.equal(await page.locator("#story-sheet-apply").isDisabled(), true); assert.equal(await reduce.isEnabled(), true);
    await page.evaluate(() => window.__copyGate.restore()); await reduce.click(); await reviewed();
    await page.locator("#story-sheet-cancel").click(); await ready(); assert.deepEqual(shape((await state()).project), shape(restored.project));
    if (process.env.TINY_IMAGE_STAR_SOURCE_RESOLUTION_ARTIFACTS) {
      const dir = new URL("../docs/research/2026-09-20/source-resolution/", import.meta.url);
      await writeFile(new URL("browser-observations.json", dir), JSON.stringify(evidence, null, 2) + "\n");
    }
    assert.deepEqual(errors, []);
    console.log("  source resolution: grayscale mask/reference pixels, original/edited restoration, exact 1/4/8-worker output, EXIF policy, mobile Apply/Cancel/undo/reload, failure retry and late cancellation");
  } finally { await context.close(); }
}
