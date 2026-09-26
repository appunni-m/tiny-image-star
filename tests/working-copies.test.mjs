import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPhotoStory } from "../src/story/recipes.js";
import { importStoryPhotos } from "../src/story/assets.js";
import { validateProject, canonicalJSON } from "../src/project/model.js";
import { applyProjectCommand } from "../src/project/history.js";
import { imageWork } from "../src/processing/policy.js";
import { hashAsset } from "../src/project/storage.js";

const input = await readFile(new URL("./fixtures/corpus/collections-v1/derived/coast-small.jpg", import.meta.url));
const file = (name = "Coast.jpg") => new File([input], name, { type: "image/jpeg", lastModified: 123 });
const tick = () => new Promise(setImmediate);
const abortError = () => new DOMException("Cancelled", "AbortError");

// Isolate import ownership/transaction behavior. Pixel decoding and resize
// quality are covered separately by the real-engine browser workflow.
function fakePool({ width = 4032, height = 3024, rejectCopy = false, afterInspect, beforeCopy, badOutput = false } = {}) {
  const tasks = [];
  return { tasks, enqueue(task) {
    tasks.push(task);
    const promise = Promise.resolve().then(async () => {
      if (task.signal?.aborted) throw abortError();
      if (task.workClass === "story-working-copy" && rejectCopy) throw new Error("Processing memory budget exceeded before read");
      await beforeCopy?.(task);
      const packet = await task.prepare();
      if (task.signal?.aborted) throw abortError();
      if (packet.message.type === "inspect") { await afterInspect?.(); return { type: "inspect-result", width, height }; }
      const output = new Uint8Array([137, 80, 78, 71]).buffer;
      task.onMessage({ type: "result", output, format: "png", mime: "image/png", width: badOutput ? 2047 : 2048, height: 1536 });
      task.onMessage({ type: "done" });
      return { type: "done" };
    });
    return { promise };
  } };
}

test("editing copies keep original identity and dimensions; invalid lineage and original deletion are atomic failures", () => {
  const original = { id: "original", kind: "image", name: "Coast.jpg", type: "image/jpeg", width: 4032, height: 3024,
    sha256: "1".repeat(64), byteLength: 100, orientation: "exif-to-upright" };
  const assets = Array.from({ length: 6 }, (_, index) => ({ ...original, id: `copy-${index}`, type: "image/png", width: 2048, height: 1536,
    orientation: "upright", sha256: "2".repeat(64), workingCopy: { sourceAssetId: original.id, maxEdge: 2048, method: "pillow-rs-lanczos-png@1" } }));
  const project = createPhotoStory(assets, { originals: [original] }), before = canonicalJSON(project);
  assert.deepEqual(project.assets.original, original); assert.equal(project.recipe.photoOrder.includes("original"), false);
  assert.throws(() => applyProjectCommand(project, { type: "asset", id: "original", value: null }), /original source/);
  assert.equal(canonicalJSON(project), before);
  for (const change of [a => a.workingCopy.sourceAssetId = a.id, a => a.width++, a => a.workingCopy.method = "unknown",
    a => a.orientation = "exif-to-upright", a => a.workingCopy.maxEdge = 1024, a => a.workingCopy.url = "https://example.com/image"]) {
    const bad = structuredClone(project); change(bad.assets["copy-0"]); assert.throws(() => validateProject(bad));
  }
  const chain = structuredClone(project); chain.assets["copy-0"].workingCopy.sourceAssetId = "copy-1"; assert.throws(() => validateProject(chain));
  assert.throws(() => createPhotoStory(assets), /original source/);
});

test("reducing is explicit; original imports and already-small images keep their exact bytes", async () => {
  for (const [smallerCopies, width, height] of [[false, 4032, 3024], [true, 1200, 900]]) {
    const source = file(), pool = fakePool({ width, height }), retained = [];
    const [entry] = await importStoryPhotos([source], { smallerCopies, pool, onRetainedBytes: bytes => retained.push(bytes) });
    assert.equal(entry.source, source); assert.equal(entry.original, undefined); assert.equal(entry.asset.workingCopy, undefined);
    assert.equal(entry.asset.sha256, await hashAsset(input)); assert.equal(pool.tasks.length, 1);
    assert.equal(retained.at(-1), source.size);
  }
});

test("copy generation reserves the full source decode, rereads only after admission and transfers output ownership", async () => {
  const source = file(), pool = fakePool(), retained = [];
  let reads = 0; const originalRead = source.arrayBuffer.bind(source); source.arrayBuffer = () => { reads++; return originalRead(); };
  const promise = importStoryPhotos([source], { smallerCopies: true, pool, onRetainedBytes: bytes => retained.push(bytes) });
  assert.equal(reads, 0); const [entry] = await promise;
  assert.equal(reads, 2); assert.equal(entry.original.source, source); assert.equal(entry.original.asset.sha256, await hashAsset(input));
  assert.equal(entry.asset.orientation, "upright"); assert.equal(entry.asset.workingCopy.sourceAssetId, entry.original.asset.id);
  assert.equal(entry.asset.sha256, await hashAsset(await entry.source.arrayBuffer()));
  const estimate = pool.tasks[1].estimate;
  const full = imageWork({ width: 4032, height: 3024, encodedBytes: source.size,
    settings: { format: "png", maxWidth: 2048, maxHeight: 2048, brightness: 1, contrast: 1 } });
  assert.equal(estimate.heap, full.heap); assert.equal(estimate.output, full.output);
  assert.ok(estimate.transient >= full.transient + 2048 * 1536 * 4 * 2, "Blob and hash snapshots are reserved before decoding");
  assert.ok(estimate.heap > 300 * 1024 * 1024, "full camera decode stays in admission");
  assert.ok(retained.includes(source.size + entry.source.size * 3), "temporary output/hash/Blob copies stay accounted after done");
  assert.equal(retained.at(-1), source.size + entry.source.size);
});

test("memory rejection precedes the second source read; changed originals and malformed copy output cannot be accepted", async () => {
  const source = file(), read = source.arrayBuffer.bind(source); let reads = 0;
  source.arrayBuffer = () => { reads++; return read(); };
  await assert.rejects(importStoryPhotos([source], { smallerCopies: true, pool: fakePool({ rejectCopy: true }) }), /memory budget/);
  assert.equal(reads, 1);
  const changed = file(); let inspected = false;
  changed.arrayBuffer = async () => { const b = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength); if (inspected) new Uint8Array(b)[20] ^= 1; return b; };
  await assert.rejects(importStoryPhotos([changed], { smallerCopies: true, pool: fakePool({ afterInspect: () => { inspected = true; } }) }), /original photo changed/);
  await assert.rejects(importStoryPhotos([file()], { smallerCopies: true, pool: fakePool({ badOutput: true }) }), /requested size and format/);
});

test("cancelled imports drain all consumers before releasing retained originals and leave no partial project", async () => {
  const controller = new AbortController(), retained = []; let copiesStarted = 0;
  const pool = fakePool({ beforeCopy: async task => {
    if (task.workClass !== "story-working-copy") return;
    copiesStarted++;
    await new Promise(resolve => task.signal.addEventListener("abort", resolve, { once: true }));
  } });
  const pending = importStoryPhotos([file("one.jpg"), file("two.jpg")], { smallerCopies: true, signal: controller.signal, pool, onRetainedBytes: n => retained.push(n) });
  for (let n = 0; copiesStarted < 2 && n < 100; n++) await tick();
  assert.equal(copiesStarted, 2); controller.abort();
  await assert.rejects(pending, { name: "AbortError" }); assert.equal(retained.at(-1), 0);
  const before = pool.tasks.length;
  await assert.rejects(importStoryPhotos([file()], { smallerCopies: true, signal: controller.signal, pool }), { name: "AbortError" });
  assert.equal(pool.tasks.length, before + 1, "aborted inspection never reaches preparation or copy creation");
});
