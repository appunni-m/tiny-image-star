import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

export async function assertWorkingCopies(browser, origin) {
  const camera = await readFile(new URL("./fixtures/corpus/collections-v1/originals/coast.jpg", import.meta.url));
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(90_000); page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(origin); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
    const evidence = await page.evaluate(async (base64) => {
      const { ResourceScheduler } = await import("./src/processing/scheduler.js");
      const { importStoryPhotos } = await import("./src/story/assets.js");
      const { hashAsset } = await import("./src/project/storage.js");
      const { createPillowEngine } = await import("./src/engine/pillow.js");
      const engine = await createPillowEngine(), api = await import("./wasm/pillow_rs_js.js");
      const makePool = (memory = 4, count = 1) => {
        const pool = new ResourceScheduler({ hints: { hardwareConcurrency: 9, deviceMemory: memory },
          workerFactory: () => new Worker(new URL("./src/worker.js", location.href), { type: "module" }) });
        pool.configure({ fixedConcurrency: count }); return pool;
      };
      const nativePixels = async blob => {
        const bitmap = await createImageBitmap(blob), canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0); bitmap.close();
        return { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
      };
      const source = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], "Camera.jpg", { type: "image/jpeg" });
      const pool = makePool(), samples = []; const unwatch = pool.subscribe(value => samples.push(value));
      let entry;
      try {
        [entry] = await importStoryPhotos([source], { smallerCopies: true, pool, onRetainedBytes: n => pool.setRetainedBytes("import", n) });
        const decoded = await nativePixels(entry.source);
        if (decoded.width !== 2048 || decoded.height !== 1536) throw new Error("Camera copy size");
        if (await hashAsset(await entry.original.source.arrayBuffer()) !== await hashAsset(await source.arrayBuffer())) throw new Error("Original changed");
        if (samples.some(sample => sample.estimatedBytes > sample.memoryBudget)) throw new Error("Import admission exceeded its fallback budget");
      } finally { unwatch(); await pool.close(); }

      // A >2048px JPEG with known asymmetric content, plus independently
      // constructed pixel-coordinate orientation references for all 8 tags.
      const width = 2052, height = 1026, rgb = new Uint8Array(width * height * 3);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgb.set([x % 251, y % 239, (x * 3 + y * 7) % 253], (y * width + x) * 3);
      let image = api.fromBytesFn("RGB", width, height, rgb, "raw"), jpeg;
      try { jpeg = image.saveWithInput("JPEG", null); } finally { image.free(); }
      image = api.Image.open(jpeg); let raw;
      try { raw = image.toBytes(); } finally { image.free(); }
      const fixtures = [], references = [];
      for (let orientation = 1; orientation <= 8; orientation++) {
        // Big-endian TIFF with one SHORT orientation entry, inserted before
        // the original JPEG segments. This fixture construction does no rotate.
        const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,77,77,0,42,0,0,0,8,0,1,1,18,0,3,0,0,0,1,0,orientation,0,0,0,0,0,0]);
        const bytes = new Uint8Array(jpeg.length + exif.length); bytes.set(jpeg.subarray(0,2)); bytes.set(exif,2); bytes.set(jpeg.subarray(2),2+exif.length);
        fixtures.push(new File([bytes], `Orientation-${orientation}.jpg`, { type: "image/jpeg" }));
        const w = orientation >= 5 ? height : width, h = orientation >= 5 ? width : height, oriented = new Uint8Array(w * h * 3);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const [sx, sy] = [null, [x,y], [width-1-x,y], [width-1-x,height-1-y], [x,height-1-y], [y,x], [y,height-1-x], [width-1-y,height-1-x], [width-1-y,x]][orientation];
          oriented.set(raw.subarray((sy * width + sx) * 3, (sy * width + sx) * 3 + 3), (y * w + x) * 3);
        }
        image = api.fromBytesFn("RGB", w, h, oriented, "raw");
        let resized;
        try { resized = image.resize(Math.round(w * 2048 / Math.max(w,h)), Math.round(h * 2048 / Math.max(w,h)), "LANCZOS"); references.push(new Blob([resized.saveWithInput("PNG", null)], { type: "image/png" })); }
        finally { resized?.free(); image.free(); }
      }
      const runs = [];
      for (const count of [1,4,8]) {
        const p = makePool(16, count); let peak = 0, violations = 0;
        const stop = p.subscribe(snapshot => { peak = Math.max(peak, [...p.slots].filter(slot => slot.task?.workClass === "story-working-copy").length); if (snapshot.estimatedBytes > snapshot.memoryBudget) violations++; });
        try {
          const entries = await importStoryPhotos(fixtures, { smallerCopies: true, pool: p, onRetainedBytes: n => p.setRetainedBytes("import", n) });
          const hashes = [], differences = [];
          for (let n = 0; n < entries.length; n++) {
            const actual = await nativePixels(entries[n].source), expected = await nativePixels(references[n]);
            if (actual.width !== expected.width || actual.height !== expected.height) throw new Error("Orientation dimensions");
            let maximum = 0; for (let k = 0; k < actual.pixels.length; k++) maximum = Math.max(maximum, Math.abs(actual.pixels[k] - expected.pixels[k]));
            differences.push(maximum); hashes.push(await hashAsset(await entries[n].source.arrayBuffer()));
          }
          runs.push({ count, peak, violations, hashes, differences });
        } finally { stop(); await p.close(); }
      }
      // Transparent PNGs remain transparent after the explicit reduction.
      image = new api.Image("RGBA", 2052, 12, 80, 120, 200, 128);
      let transparent; try { transparent = new File([image.saveWithInput("PNG", null)], "alpha.png", { type: "image/png" }); } finally { image.free(); }
      const alphaPool = makePool(); let alpha;
      try { const [a] = await importStoryPhotos([transparent], { smallerCopies: true, pool: alphaPool, onRetainedBytes: n => alphaPool.setRetainedBytes("import", n) }); const decoded = await nativePixels(a.source); alpha = [...new Set(decoded.pixels.filter((_, index) => index % 4 === 3))]; }
      finally { await alphaPool.close(); }
      const { createPhotoStory, slidePhotos } = await import("./src/story/recipes.js"), { storyMaskCommand } = await import("./src/story/masks.js");
      const { storyDepthCommand } = await import("./src/story/depth.js"), { applyProjectCommand } = await import("./src/project/history.js");
      const { planScene } = await import("./src/compositor/scene-spec.js"), { sceneWork } = await import("./src/processing/policy.js");
      const { enqueueScene } = await import("./src/processing/scene-client.js");
      const apply = (p, command) => applyProjectCommand(p, command).project, mask = { id: "camera-mask", kind: "mask", name: "Test coverage", type: "image/png", orientation: "upright" };
      image = new api.Image("L", entry.asset.width, entry.asset.height, 128, 128, 128, 255);
      let maskBytes; try { maskBytes = image.saveWithInput("PNG", null); } finally { image.free(); }
      Object.assign(mask, { width: entry.asset.width, height: entry.asset.height, byteLength: maskBytes.length, sha256: await hashAsset(maskBytes) });
      const copies = Array.from({ length: 6 }, (_, index) => ({ ...entry.asset, id: `camera-copy-${index}` }));
      let project = createPhotoStory(copies, { originals: [entry.original.asset] });
      const slideId = project.slides[0].id, photoId = slidePhotos(project, slideId)[0].id;
      project = apply(project, storyMaskCommand(project, photoId, mask)); project = apply(project, storyDepthCommand(project, photoId));
      project.nodes[photoId].cutoutEffects = { schema: 1, outline: { color: "#ffffff", width: .02 }, shadow: { color: "#000000", opacity: .6, blur: .03, x: -.045, y: .035 } };
      const request = { project, slideId, variantId: "tall", preview: true, previewEdge: 512 };
      const maximumEstimate = sceneWork(planScene(project, slideId, "tall", request));
      const heavyPool = makePool(), held = source.size + entry.source.size + maskBytes.length;
      heavyPool.setRetainedBytes("sources", held);
      let heavy;
      try {
        let rejected = false, reads = 0;
        try { await enqueueScene({ ...request, pool: heavyPool, readAsset: () => { reads++; throw new Error("Unsafe source read"); } }).promise; }
        catch (error) { rejected = /memory budget/.test(error.message); }
        if (!rejected || reads) throw new Error("Maximum effects must remain rejected before source reads at this budget");
        // Preserve the maximum-effects failure boundary. Also check the actual
        // controls' default outline/shadow values as a distinct supported case.
        project.nodes[photoId].cutoutEffects = { schema: 1, outline: { color: "#ffffff", width: .006 }, shadow: { color: "#000000", opacity: .25, blur: .008, x: .004, y: .008 } };
        const estimate = sceneWork(planScene(project, slideId, "tall", request));
        const rendered = await enqueueScene({ ...request, pool: heavyPool, readAsset: id => id === mask.id ? maskBytes : entry.source }).promise;
        const decoded = await nativePixels(new Blob([rendered.output], { type: "image/png" }));
        heavy = { estimatedBytes: estimate.heap + estimate.transient + held, budget: heavyPool.budget.memory, outputWidth: decoded.width, outputHeight: decoded.height,
          maximumEffects: { estimatedBytes: maximumEstimate.heap + maximumEstimate.transient + held, rejectedBeforeRead: rejected && reads === 0 } };
      } finally { await heavyPool.close(); }
      engine.dispose();
      return { camera: { originalWidth: entry.original.asset.width, originalHeight: entry.original.asset.height, width: entry.asset.width, height: entry.asset.height,
        sourceBytes: source.size, copyBytes: entry.source.size, peakReserved: Math.max(...samples.map(sample => sample.estimatedBytes)), budget: 512 * 1024 * 1024 }, runs, alpha, heavy };
    }, camera.toString("base64"));
    assert.equal(evidence.camera.originalWidth, 4032); assert.equal(evidence.camera.originalHeight, 3024);
    for (const run of evidence.runs) { assert.equal(run.violations, 0); assert.equal(run.peak, run.count); assert.deepEqual(run.hashes, evidence.runs[0].hashes); assert.ok(run.differences.every(value => value === 0), JSON.stringify(run.differences)); }
    assert.deepEqual(evidence.alpha, [128]);
    assert.ok(evidence.heavy.estimatedBytes <= evidence.heavy.budget); assert.equal(evidence.heavy.outputHeight, 512);

    await page.locator("#empty-story-button").click(); await page.locator(".story-import-options summary").click();
    await page.locator("#story-small-copies").check(); await page.locator("#story-title").fill("Camera copies");
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    assert.equal(await page.locator("#story-intro").evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert.ok((await page.locator(".story-import-options summary").boundingBox()).height >= 44);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await page.locator("#story-files").setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `Camera-${i}.jpg`, mimeType: "image/jpeg", buffer: camera })));
    const ready = () => page.waitForFunction(() => !document.querySelector("#story-export").disabled && document.querySelector("#story-status").textContent === "Saved on this device");
    await ready();
    const state = () => page.evaluate(async () => {
      const store = await import("./src/project/storage.js"), [saved] = await store.listStoryProjects(), record = await store.readStoryProject(saved.key), p = record.project;
      const photo = Object.values(p.nodes).find(node => node.kind === "image"), asset = p.assets[photo.assetId];
      return { asset, photoId: photo.id, count: Object.values(p.assets).filter(a => a.workingCopy).length,
        originals: Object.values(p.assets).filter(a => a.kind === "image" && !a.workingCopy).length,
        previewHash: await store.hashAsset(await (await fetch(document.querySelector("#story-preview").src)).arrayBuffer()),
        originalHash: asset.workingCopy ? await store.hashAsset(await (await record.readAsset(asset.workingCopy.sourceAssetId)).arrayBuffer()) : asset.sha256 };
    });
    const original = await state(); assert.equal(original.count, 6); assert.equal(original.originals, 6);
    await page.locator("#story-export").click(); assert.match(await page.locator("#story-sheet-content").innerText(), /smaller editing copies/);
    await page.locator("#story-sheet-cancel").click();
    await page.reload(); await page.locator("#empty-story-button").click(); await page.locator("#story-library").getByRole("button", { name: "Camera copies", exact: true }).click(); await ready();
    assert.deepEqual(await state(), original);
    await page.locator('[data-story-tool="photos"]').click();
    assert.match(await page.locator("#story-sheet-content").innerText(), /smaller editing copy/);
    await page.getByLabel("Source photo", { exact: true }).selectOption(original.asset.workingCopy.sourceAssetId);
    await page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled);
    await page.locator("#story-sheet-apply").click(); await ready(); assert.equal((await state()).asset.workingCopy, undefined);
    await page.locator("#story-undo").click(); await ready(); assert.deepEqual(await state(), original);
    if (process.env.TINY_IMAGE_STAR_WORKING_COPY_ARTIFACTS) {
      const dir = new URL("../docs/research/2026-09-20/working-copies/", import.meta.url); await mkdir(dir, { recursive: true });
      await writeFile(new URL("browser-observations.json", dir), JSON.stringify(evidence, null, 2) + "\n");
      await page.locator('[data-story-tool="photos"]').click(); await page.screenshot({ path: new URL("photos-phone.png", dir).pathname });
    }
    assert.deepEqual(errors, []);
    console.log(`  editing copies: 12MP original retained, 2048px copy under a 512MiB admission budget; EXIF 1–8 match independent pixel-orientation references; alpha preserved; exact 1/4/8 worker output; explicit phone opt-in, saved originals, reload, source switch and undo`);
  } finally { await context.close(); }
}
