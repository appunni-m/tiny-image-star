import test from "node:test";
import assert from "node:assert/strict";
import { createPhotoStory, slidePhotos } from "../src/story/recipes.js";
import { storyMaskCommand } from "../src/story/masks.js";
import { createConnectedCutout, removeConnectedCutout } from "../src/story/connections.js";
import { storyDepthCommand } from "../src/story/depth.js";
import { planSourceResolution, prepareSourceResolution } from "../src/story/source-resolution.js";
import { validateProject, canonicalJSON } from "../src/project/model.js";
import { applyProjectCommand, ProjectHistory } from "../src/project/history.js";
import { imageWork } from "../src/processing/policy.js";
import { resampleSourceWithApi } from "../src/engine/pillow.js";

const apply = (p, command) => applyProjectCommand(p, command).project;
const tick = () => new Promise(setImmediate);
const abortError = () => new DOMException("Cancelled", "AbortError");
function fixture({ connected = false, masked = true } = {}) {
  const asset = { id: "image", kind: "image", name: "Photo", type: "image/png", width: 4032, height: 3024,
    sha256: "a".repeat(64), byteLength: 4, orientation: "upright" };
  let project = createPhotoStory(Array.from({ length: 6 }, (_, i) => ({ ...asset, id: `image-${i}` })));
  const originalId = slidePhotos(project, project.slides[0].id)[0].id; let photoId = originalId;
  if (masked) project = apply(project, storyMaskCommand(project, photoId, { ...asset, id: "mask", kind: "mask", sha256: "b".repeat(64) }));
  if (connected) { const made = createConnectedCutout(project, photoId, project.slides[0].id); project = apply(project, made.command); photoId = made.id; }
  if (masked) project = apply(project, storyDepthCommand(project, photoId));
  project.nodes[photoId].crop = { x: .1, y: .05, width: .8, height: .7 };
  project.nodes[photoId].appearance = { brightness: 1.2, contrast: .8 };
  validateProject(project);
  return { project, photoId, originalId };
}
// Transaction/admission fixture only. Browser tests exercise actual bytes and
// the deployed engine; this fake never serves as an image-quality oracle.
function fakePool({ reject, before, malformed } = {}) {
  const tasks = [];
  return { tasks, enqueue(task) {
    tasks.push(task);
    return { promise: Promise.resolve().then(async () => {
      if (task.signal.aborted) throw abortError();
      if (reject?.(task)) throw new Error("Memory admission failed before read");
      const { message } = await task.prepare();
      await before?.(task, message);
      if (task.signal.aborted) throw abortError();
      const { asset, width, height } = message.request;
      task.onMessage({ type: "source-copy-result", output: new Uint8Array([width % 255, height % 255, asset.kind === "mask" ? 1 : 2]).buffer,
        format: "png", mime: "image/png", mode: asset.kind === "mask" ? "L" : "RGB", width: malformed ? width + 1 : width, height });
      task.onMessage({ type: "done" }); return { type: "done" };
    }) };
  } };
}
const source = () => new Blob([new Uint8Array(4)]);
const comparable = p => { const copy = structuredClone(p); delete copy.revision; return copy; };

test("one conversion preserves edited and connected scene metadata, parent masks and one-step undo", async () => {
  for (const connected of [false, true]) {
    const { project, photoId, originalId } = fixture({ connected }), before = canonicalJSON(project), history = new ProjectHistory(project);
    const pool = fakePool(), retained = [];
    const result = await prepareSourceResolution(project, photoId, "working", { readAsset: source, pool, onRetainedBytes: n => retained.push(n) });
    assert.equal(canonicalJSON(project), before); assert.equal(result.sources.size, 2); assert.equal(pool.tasks.length, 2);
    history.preview(result.command); const reduced = history.document, node = reduced.nodes[photoId];
    assert.deepEqual({ ...node, assetId: project.nodes[photoId].assetId, maskId: project.nodes[photoId].maskId }, project.nodes[photoId]);
    for (const field of ["slides", "shared", "variants", "recipe"]) assert.deepEqual(reduced[field], project[field]);
    if (connected) assert.deepEqual(reduced.nodes[originalId], project.nodes[originalId]);
    assert.deepEqual(reduced.assets.mask, project.assets.mask);
    assert.equal(reduced.assets[node.maskId].workingCopy.sourceSha256, project.assets.mask.sha256);
    assert.equal(reduced.assets[node.assetId].width, 2048); assert.equal(reduced.assets[node.maskId].height, 1536);
    assert.ok(retained.some(n => n >= 9)); assert.equal(retained.at(-1), 6);
    history.commit("Change source size"); assert.equal(history.past.length, 1); history.undo(); assert.deepEqual(comparable(history.document), comparable(project));
    history.redo(); assert.deepEqual(comparable(history.document), comparable(reduced));
    const restore = await prepareSourceResolution(reduced, photoId, "original", { readAsset: () => { throw new Error("Unexpected read"); }, pool });
    assert.equal(restore.restoredMask, true); assert.equal(restore.sources.size, 0); assert.equal(pool.tasks.length, 2);
    history.preview(restore.command); assert.deepEqual(history.document.nodes[photoId], project.nodes[photoId]);
    history.cancel(); assert.deepEqual(comparable(history.document), comparable(reduced));
    const restored = apply(reduced, restore.command), repeat = await prepareSourceResolution(restored, photoId, "working", { pool });
    assert.equal(repeat.sources.size, 0); assert.equal(pool.tasks.length, 2, "unchanged toggles reuse both copies");
    assert.equal(Object.keys(apply(restored, repeat.command).assets).length, Object.keys(reduced.assets).length);
  }
});

test("restoring after cutout painting resizes the current mask instead of restoring a stale parent", async () => {
  const { project, photoId } = fixture(), pool = fakePool();
  let next = apply(project, (await prepareSourceResolution(project, photoId, "working", { readAsset: source, pool })).command);
  const edited = { ...next.assets[next.nodes[photoId].maskId], id: "painted", sha256: "c".repeat(64), byteLength: 4 }; delete edited.workingCopy;
  next = apply(next, storyMaskCommand(next, photoId, edited));
  const plan = planSourceResolution(next, photoId, "original"); assert.equal(plan.mask.source.id, "painted"); assert.equal(plan.mask.existing, undefined);
  const result = await prepareSourceResolution(next, photoId, "original", { readAsset: source, pool });
  const restored = apply(next, result.command), mask = restored.assets[restored.nodes[photoId].maskId];
  assert.equal(result.upsampledMask, true); assert.equal(result.restoredMask, false); assert.equal(result.sources.size, 1);
  assert.equal(mask.width, 4032); assert.equal(mask.height, 3024); assert.equal(mask.workingCopy, undefined);
  assert.deepEqual({ ...restored.nodes[photoId], maskId: project.nodes[photoId].maskId }, project.nodes[photoId]);
});

test("old copies remain readable, verified parent hashes control caching, and referenced masks cannot be deleted", async () => {
  const { project, photoId, originalId } = fixture({ connected: true }), pool = fakePool();
  const reduced = apply(project, (await prepareSourceResolution(project, photoId, "working", { readAsset: source, pool })).command);
  const originalMask = project.nodes[originalId].maskId;
  const replaced = apply(reduced, storyMaskCommand(reduced, originalId, { ...reduced.assets[originalMask], id: "new-mask", sha256: "d".repeat(64) }));
  assert.ok(replaced.assets[originalMask], "a live working copy still needs its parent");
  const changed = structuredClone(reduced); changed.assets[originalMask].sha256 = "d".repeat(64); assert.throws(() => validateProject(changed), /original source changed/);
  const legacy = structuredClone(reduced); for (const asset of Object.values(legacy.assets)) if (asset.workingCopy) delete asset.workingCopy.sourceSha256;
  validateProject(legacy);
  assert.equal(planSourceResolution(legacy, photoId, "original").mask.existing, undefined, "unverified legacy mask lineage is not an exact restoration");
  const restored = apply(legacy, { type: "node", id: photoId, value: project.nodes[photoId] });
  assert.equal(planSourceResolution(restored, photoId, "working").image.existing, undefined);
  // A parent on the connected node may be retained only by another copy asset.
  const removed = apply(restored, storyMaskCommand(restored, originalId, null));
  assert.ok(apply(removed, removeConnectedCutout(removed, photoId)).assets[originalMask]);
});

test("admission includes full source and upscaled target before reads; malformed output never changes the input", async () => {
  const { project, photoId } = fixture(), before = canonicalJSON(project); let reads = 0;
  const pool = fakePool({ reject: () => true });
  await assert.rejects(prepareSourceResolution(project, photoId, "working", { pool, readAsset: () => { reads++; return source(); } }), /admission/);
  assert.equal(reads, 0);
  const base = imageWork({ width: 4032, height: 3024, encodedBytes: 4, settings: { resizeWidth: 2048, resizeHeight: 1536 } });
  assert.equal(pool.tasks[0].estimate.heap, base.heap); assert.ok(pool.tasks[0].estimate.transient > base.transient + 2048 * 1536 * 8);
  await assert.rejects(prepareSourceResolution(project, photoId, "working", { pool: fakePool({ malformed: true }), readAsset: source }), /dimensions and format/);
  await assert.rejects(prepareSourceResolution(project, photoId, "working", { pool: fakePool(), readAsset: () => new Blob(["wrong"]) }), /missing or changed/);
  assert.equal(canonicalJSON(project), before);
});

test("partial failure and cancellation drain all copy tasks before releasing output ownership", async () => {
  for (const fail of [false, true]) {
    const { project, photoId } = fixture(), controller = new AbortController(), retained = []; let maskStarted = false, drained = false;
    const pool = fakePool({ before: async (task, message) => {
      if (message.request.asset.kind !== "mask") return;
      maskStarted = true;
      await new Promise(resolve => controller.signal.addEventListener("abort", resolve, { once: true }));
      await tick(); drained = true;
      if (fail) throw new Error("Cutout conversion failed");
    } });
    const pending = prepareSourceResolution(project, photoId, "working", { readAsset: source, pool,
      signal: fail ? undefined : controller.signal, onRetainedBytes: n => retained.push(n) });
    for (let i = 0; i < 100 && (!maskStarted || retained.at(-1) !== 3); i++) await tick();
    assert.ok(maskStarted); assert.equal(retained.at(-1), 3, "finished photo stays reserved while its cutout is pending");
    controller.abort(); await assert.rejects(pending, fail ? /Cutout conversion failed/ : { name: "AbortError" });
    assert.ok(drained); assert.equal(retained.at(-1), 0);
  }
});

test("conversion without a mask stays mask-free; copies reject invalid direction, geometry and reservations before decoding", async () => {
  const { project, photoId } = fixture({ masked: false }), pool = fakePool();
  const result = await prepareSourceResolution(project, photoId, "working", { pool, readAsset: source });
  assert.equal(result.sources.size, 1); assert.equal(apply(project, result.command).nodes[photoId].maskId, undefined);
  assert.throws(() => planSourceResolution(project, photoId, "original"), /already uses/);
  assert.throws(() => planSourceResolution(project, photoId, "huge"), /Choose/);
  let opens = 0; const api = { Image: { open: () => { opens++; throw new Error("Unexpected decode"); } } };
  const request = { asset: project.assets[project.nodes[photoId].assetId], bytes: new Uint8Array(4).buffer, width: 2048, height: 1536 };
  for (const memoryEstimate of [{ heap: 0, transient: 0 }, { heap: NaN, transient: Infinity }, {}])
    await assert.rejects(resampleSourceWithApi(api, { ...request, memoryEstimate }), /memory/);
  await assert.rejects(resampleSourceWithApi(api, { ...request, width: .5 }), /Invalid/);
  await assert.rejects(resampleSourceWithApi(api, { ...request, memoryEstimate: { heap: 2 ** 40, transient: 2 ** 40 } }), /changed/);
  assert.equal(opens, 0);
});

test("story byte limits and sibling failure leave no partial assets or retained copies", async () => {
  const { project, photoId } = fixture();
  project.assets.retained = { ...project.assets[project.nodes[photoId].assetId], id: "retained", sha256: "e".repeat(64), byteLength: 128 * 1024 * 1024 };
  const before = canonicalJSON(project), retained = [];
  await assert.rejects(prepareSourceResolution(project, photoId, "working", { pool: fakePool(), readAsset: source, onRetainedBytes: n => retained.push(n) }), /128 MiB/);
  assert.equal(retained.at(-1), 0); assert.equal(canonicalJSON(project), before);
  let drained = false, started = false;
  const pool = fakePool({ before: async (task, message) => {
    if (message.request.asset.kind === "mask") { started = true; await new Promise(resolve => task.signal.addEventListener("abort", resolve, { once: true })); await tick(); drained = true; }
    else { for (let i = 0; i < 100 && !started; i++) await tick(); throw new Error("Photo conversion failed"); }
  } });
  await assert.rejects(prepareSourceResolution(project, photoId, "working", { pool, readAsset: source, onRetainedBytes: n => retained.push(n) }), /Photo conversion failed/);
  assert.ok(started && drained); assert.equal(retained.at(-1), 0); assert.equal(canonicalJSON(project), before);
});
