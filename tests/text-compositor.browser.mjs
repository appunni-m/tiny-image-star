import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function assertTextCompositor(browser, origin) {
  const fixture = await readFile(new URL("./fixtures/fonts/NotoSans.ttf", import.meta.url));
  const provenance = JSON.parse(await readFile(new URL("./fixtures/fonts/provenance.json", import.meta.url), "utf8"));
  assert.equal(createHash("sha256").update(fixture).digest("hex"), provenance.files[0].sha256, "pinned custom font fixture integrity");
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  context.on("request", (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(origin).origin) external.push(request.url()); });
  try {
    await page.goto(origin);
    await page.waitForFunction(() => window.tinyImageStarEditor && document.querySelector("#engine-status").textContent === "Ready");
    const evidence = await page.evaluate(async (encodedFont) => {
      const { createPillowEngine } = await import("./src/engine/pillow.js");
      const { createProcessingClient, getProcessingScheduler } = await import("./src/processing/client.js");
      const { registerFontFile, readFontRecord, clearStoredFonts } = await import("./src/editor/fonts.js");
      const { createTextLayer } = await import("./src/compositor/text.js");
      const core = await import("./src/jobs/core.js"), store = await import("./src/jobs/store.js");
      const { acquireJobOwnership } = await import("./src/jobs/ownership.js");
      const { digestBytes } = await import("./src/jobs/output.js");
      const engine = await createPillowEngine(), pool = getProcessingScheduler();
      const font = await registerFontFile(new File([Uint8Array.from(atob(encodedFont), (v) => v.charCodeAt(0))], "NotoSans.ttf"));
      const faceCount = document.fonts.size;
      const surface = new OffscreenCanvas(480, 320), ctx = surface.getContext("2d");
      const gradient = ctx.createLinearGradient(0, 0, 480, 320);
      gradient.addColorStop(0, "rgba(30,100,190,.4)"); gradient.addColorStop(1, "rgba(220,50,30,.9)");
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 480, 320);
      const input = new Uint8Array(await (await surface.convertToBlob()).arrayBuffer());
      const layers = [
        { ...createTextLayer(240, 300), id: "custom", text: "office café AVATAR", y: .28, width: .9, rotation: -8,
          fontId: font.id, fontBytes: font.bytes.byteLength, fontSha256: font.sha256, opacity: .7 },
        { ...createTextLayer(240, 300), id: "system", text: "Hello\nمرحبا नमस्ते 👋", y: .67, width: .8, align: "left", fontSize: .07, color: "#ffcc44", style: "italic" },
      ];
      const operations = { format: "png", brightness: 1.13, contrast: .91, grayscale: false, rotation: 90, flipX: true,
        cropRelative: { x: .1, y: .1, width: .8, height: .8 }, resizeMode: "crop", resizeWidth: 240, resizeHeight: 300, textLayers: layers };
      const render = (settings) => engine.render({ name: "photo.png", bytes: input }, settings);
      const plain = await render({ ...operations, textLayers: [] }), png = await render(operations), jpeg = await render({ ...operations, format: "jpeg" });
      const expected = { png: await digestBytes(png.bytes), jpeg: await digestBytes(jpeg.bytes) };
      const decoded = [];
      const gray = await render({ ...operations, grayscale: true });
      for (const output of [png, jpeg, gray]) {
        const bitmap = await createImageBitmap(new Blob([output.bytes], { type: output.mime }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0); bitmap.close();
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        decoded.push({ format: output.format, grayscale: output === gray, width: canvas.width, height: canvas.height,
          alpha: Array.from(pixels).filter((_, index) => index % 4 === 3).some((value) => value !== 255),
          color: Array.from(pixels).some((_, index) => index % 4 === 0 && Math.abs(pixels[index] - pixels[index + 1]) > 10) });
      }
      // The JPEG must be precisely Pillow's one-pass encoding of the final
      // PNG pixels. A browser second encode, or text after flattening, fails.
      const api = await import("./wasm/pillow_rs_js.js");
      const openedPng = api.Image.open(png.bytes);
      const finalPng = openedPng.convert("RGBA", null); openedPng.free();
      const flat = new api.Image("RGBA", png.width, png.height, 255, 255, 255, 255);
      let rgb;
      let jpegHash;
      try { flat.alphaComposite(finalPng); rgb = flat.convert("RGB", null); jpegHash = await digestBytes(rgb.saveWithInput("JPEG", null)); }
      finally { finalPng.free(); flat.free(); rgb?.free(); }

      const submit = (client, message, source = { width: 480, height: 320, encodedBytes: input.length }) => new Promise((resolve, reject) => {
        const messages = [];
        const listener = ({ data }) => {
          if (data.revision !== message.revision && data.jobId !== message.jobId) return;
          if (["result", "file-error", "error"].includes(data.type)) messages.push(data);
          if (["done", "error"].includes(data.type) || message.type === "process" && client.folder && data.type === "result") {
            client.removeEventListener("message", listener); clearTimeout(timer); resolve(messages);
          }
        };
        const timer = setTimeout(() => { client.removeEventListener("message", listener); reject(new Error("Text worker timed out")); }, 20000);
        client.addEventListener("message", listener);
        client.submit({ message, source, prepare: () => {
          if (client.folder) return { message };
          const bytes = input.slice().buffer;
          return { message: { ...message, files: [{ ...message.files[0], bytes }] }, transfer: [bytes] };
        } });
      });
      const runs = [];
      for (const count of [1, 4, 8]) {
        pool.configure({ fixedConcurrency: count });
        let peak = 0, violations = 0;
        const stop = pool.subscribe((value) => { peak = Math.max(peak, value.active); if (value.active > count || value.estimatedBytes > value.memoryBudget) violations++; });
        const tasks = Array.from({ length: 12 }, async (_, index) => {
          const client = createProcessingClient();
          const format = index % 2 ? "jpeg" : "png";
          const settings = { ...operations, format };
          try {
            const messages = await submit(client, { type: "process", revision: index + 1, jobId: `text-${index}`, files: [{ id: index, name: "photo.png", settings }], settings: null });
            const result = messages.find((data) => data.type === "result");
            return { format, hash: result ? await digestBytes(result.output) : null, error: messages.find((data) => data.type === "file-error")?.message };
          } finally { client.terminate(); }
        });
        const outputs = await Promise.all(tasks); stop(); runs.push({ count, peak, violations, outputs });
      }
      const root = await navigator.storage.getDirectory();
      const sourceRoot = await root.getDirectoryHandle("text-source", { create: true });
      const handle = await sourceRoot.getFileHandle("photo.png", { create: true });
      const writable = await handle.createWritable(); await writable.write(input); await writable.close();
      const source = await handle.getFile();
      const folders = [];
      for (const format of ["png", "jpeg"]) {
        const id = `text-folder-${format}`;
        const recipe = { id, name: "Caption", operations: { ...operations, format } };
        const outputRoot = await root.getDirectoryHandle(id, { create: true });
        await store.putLargeJob(core.createLargeJob({ id, recipe, sourceHandle: sourceRoot, sourceName: "test" }));
        const ownership = await acquireJobOwnership(id);
        const client = createProcessingClient({ kind: "folder" }); client.folder = true;
        try {
          await store.patchLargeJob(id, { status: "running", outputHandle: outputRoot, discovered: 1, scanComplete: true }, ownership.owner);
          await store.putManifestEntries([core.createManifestEntry({ jobId: id, index: 0, relativePath: "photo.png", file: source })], ownership.owner);
          const [entry] = await store.claimPendingEntries(id, 1, ownership.owner);
          const messages = await submit(client, { type: "process", jobId: id, entry, owner: ownership.owner, recipe, sourceRoot, outputRoot }, {});
          const result = messages.find((data) => data.type === "result");
          if (!result) throw new Error(messages[0]?.message || "Folder text failed");
          const saved = await (await outputRoot.getFileHandle(result.outputPath)).getFile();
          folders.push({ format, hash: await digestBytes(await saved.arrayBuffer()), completed: (await store.getLargeJob(id)).completed });
        } finally { client.terminate(); await store.deleteLargeJob(id, ownership.owner); await ownership.release(); }
      }
      const rejectRender = async (settings) => { try { await render(settings); return null; } catch (error) { return { code: error.code, message: error.message }; } };
      const missing = await rejectRender({ ...operations, textLayers: [{ ...layers[0], fontId: `font-${"0".repeat(16)}` }] });
      const bounded = await rejectRender({ ...operations, textLayers: [{ ...layers[0], fontBytes: 1 }] });
      const corrupted = await readFontRecord(font.id); new Uint8Array(corrupted.bytes)[100] ^= 1;
      await clearStoredFonts();
      const activeClient = createProcessingClient();
      const activeMessages = await submit(activeClient, { type: "process", revision: 122, jobId: "active-font", files: [{ id: "active", name: "photo.png" }], settings: operations });
      activeClient.terminate();
      const activeResult = activeMessages.find((value) => value.type === "result");
      const activeFontAfterClear = activeResult ? await digestBytes(activeResult.output) : null;
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("tiny-image-star-fonts", 1);
        request.onsuccess = () => { const db = request.result, tx = db.transaction("fonts", "readwrite"); tx.objectStore("fonts").put(corrupted);
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject; };
        request.onerror = reject;
      });
      const corrupt = await rejectRender(operations);
      const client = createProcessingClient();
      const missingWorker = await submit(client, { type: "process", revision: 123, jobId: "bad-font", files: [{ id: "bad", name: "photo.png" }], settings: { ...operations, textLayers: [{ ...layers[0], fontId: `font-${"0".repeat(16)}` }] } });
      client.terminate();
      pool.configure({ mode: "auto" });
      return { expected, changed: expected.png !== await digestBytes(plain.bytes), jpegHash, decoded, runs, folders, missing, bounded, corrupt, activeFontAfterClear,
        noFontLeak: document.fonts.size === faceCount,
        failedWorker: missingWorker.map(({ type, message }) => ({ type, message })), idle: pool.snapshot().active === 0 && pool.snapshot().queued === 0 };
    }, fixture.toString("base64"));
    assert.equal(evidence.changed, true, "text alters actual exported pixels");
    assert.equal(evidence.jpegHash, evidence.expected.jpeg, "final JPEG is encoded exactly once by Pillow after composition and alpha flattening");
    for (const output of evidence.decoded) {
      assert.equal(output.width, 240); assert.equal(output.height, 300);
      assert.equal(output.color, true, "colored text remains colored after grayscale image treatment");
      assert.equal(output.alpha, output.format === "png" && !output.grayscale, "PNG preserves alpha, JPEG flattens after text; legacy grayscale drops source alpha");
    }
    for (const run of evidence.runs) {
      assert.equal(run.violations, 0); assert.equal(run.peak, run.count);
      assert.equal(run.outputs.length, 12);
      for (const output of run.outputs) assert.equal(output.hash, evidence.expected[output.format], output.error || "main/worker output bytes agree");
    }
    for (const folder of evidence.folders) { assert.equal(folder.hash, evidence.expected[folder.format]); assert.equal(folder.completed, 1); }
    assert.equal(evidence.missing.code, "font-missing"); assert.equal(evidence.bounded.code, "font-limit"); assert.equal(evidence.corrupt.code, "font-integrity");
    assert.deepEqual(evidence.failedWorker.map((message) => message.type), ["file-error"], "invalid text fails the worker task without publishing an uncaptioned result");
    assert.match(evidence.failedWorker[0].message, /font used by this edit is missing/);
    assert.equal(evidence.activeFontAfterClear, evidence.expected.png, "clearing saved fonts preserves the active edit's pinned font bytes");
    assert.equal(evidence.noFontLeak, true); assert.equal(evidence.idle, true);
    assert.deepEqual(errors, []); assert.deepEqual(external, [], "font shaping and text export make no external requests");
    console.log("  shared text compositor: exact PNG/JPEG across editor engine, 1/4/8 workers and journaled folder output; custom-font integrity and bounded failure checks");
  } finally { await context.close(); }
}
