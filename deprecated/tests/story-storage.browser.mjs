import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function assertStoryStorage(browser, origin) {
  const font = await readFile(new URL("./fixtures/fonts/NotoSans.ttf", import.meta.url));
  const context = await browser.newContext(), page = await context.newPage(), second = await context.newPage();
  const errors = [];
  for (const tab of [page, second]) tab.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(origin);
    const initial = await page.evaluate(async (fontBase64) => {
      const store = await import("./src/project/storage.js"), { createSceneProject, canonicalJSON } = await import("./src/project/model.js");
      const { createPillowEngine } = await import("./src/engine/pillow.js"), api = await import("./wasm/pillow_rs_js.js");
      const engine = await createPillowEngine(), bank = new Map(), assets = {};
      const add = async (id, kind, bytes, width = null, height = null) => {
        bank.set(id, bytes); assets[id] = { id, kind, name: id, type: kind === "font" ? "font/ttf" : "image/png", byteLength: bytes.byteLength,
          sha256: await store.hashAsset(bytes), width, height, orientation: "upright" };
      };
      const photo = new api.Image("RGBA", 8, 8, 255, 0, 0, 255), mask = api.fromBytesFn("L", 8, 8, new Uint8Array(64).fill(128), "raw");
      try {
        // An offset view must save only the source bytes, not its backing buffer.
        const bytes = photo.saveWithInput("PNG", null), padded = new Uint8Array(bytes.length + 32);
        padded.fill(77); padded.set(bytes, 17); await add("photo", "image", padded.subarray(17, 17 + bytes.length), 8, 8);
        await add("mask", "mask", mask.saveWithInput("PNG", null), 8, 8);
      } finally { photo.free(); mask.free(); }
      await add("font", "font", Uint8Array.from(atob(fontBase64), (value) => value.charCodeAt(0)));
      assets.duplicate = { ...assets.photo, id: "duplicate" };
      const frame = { x: 0, y: 0, width: 1, height: 1 };
      const project = createSceneProject({ id: "storage-scene", assets, variants: [{ id: "portrait", width: 128, height: 160 }], nodes: {
        photo: { id: "photo", kind: "image", space: "slide", assetId: "photo", maskId: "mask", frame },
        caption: { id: "caption", kind: "text", space: "slide", fontId: "font", text: "Saved story", frame: { x: .1, y: .1, width: .8, height: .25 } },
      } });
      project.recipe = { id: "storage-test", version: 1, seed: 123 };
      const expected = canonicalJSON(project); let reads = 0;
      const pending = store.writeStoryProject(project, { readAsset: (id) => { reads++; return bank.get(id); } });
      project.revision = 50; project.nodes.caption.text = "mutated after save started";
      const saved = await pending;
      const arrayBuffer = Blob.prototype.arrayBuffer; let eagerReads = 0;
      Blob.prototype.arrayBuffer = function () { eagerReads++; return arrayBuffer.call(this); };
      let restored;
      try { restored = await store.readStoryProject(saved.key); }
      finally { Blob.prototype.arrayBuffer = arrayBuffer; }
      const packets = [];
      for (const id of ["photo", "mask", "font"]) packets.push({ id, bytes: await (await restored.readAsset(id)).arrayBuffer() });
      const output = await engine.renderSlide({ project: restored.project, slideId: restored.project.slides[0].id, assets: packets });
      return { saved, reads, eagerReads, preserved: canonicalJSON(restored.project) === expected, digest: await store.hashAsset(output.bytes) };
    }, font.toString("base64"));
    assert.deepEqual(initial.saved, { key: "story:storage-scene", revision: 0 });
    assert.equal(initial.reads, 3, "duplicate content is read only once during save");
    assert.equal(initial.eagerReads, 0, "opening metadata does not expand image/font Blobs");
    assert.equal(initial.preserved, true, "save freezes edit metadata at submission");
    await page.reload();
    const reopened = await page.evaluate(async () => {
      const store = await import("./src/project/storage.js"), { createPillowEngine } = await import("./src/engine/pillow.js");
      const engine = await createPillowEngine(), saved = await store.readStoryProject("story:storage-scene"), assets = [];
      for (const id of ["photo", "mask", "font"]) assets.push({ id, bytes: await (await saved.readAsset(id)).arrayBuffer() });
      const output = await engine.renderSlide({ project: saved.project, slideId: saved.project.slides[0].id, assets });
      return { digest: await store.hashAsset(output.bytes), revision: saved.revision };
    });
    assert.equal(reopened.digest, initial.digest, "a real page reload preserves exact Pillow output");

    await second.goto(origin);
    for (const tab of [page, second]) await tab.evaluate(async () => {
      const store = await import("./src/project/storage.js");
      window.storyProbe = await store.readStoryProject("story:storage-scene");
    });
    const contenders = await Promise.all([page, second].map((tab, index) => tab.evaluate(async (index) => {
      const store = await import("./src/project/storage.js"), candidate = structuredClone(window.storyProbe.project);
      candidate.revision += index + 1; candidate.nodes.caption.text = `Tab ${index}`;
      try { await store.writeStoryProject(candidate, { expectedRevision: window.storyProbe.revision }); return { ok: true, revision: candidate.revision, text: candidate.nodes.caption.text }; }
      catch (error) { return { ok: false, code: error.code }; }
    }, index)));
    assert.equal(contenders.filter((value) => value.ok).length, 1, "only one independent tab may commit from the same base revision");
    assert.equal(contenders.find((value) => !value.ok).code, "PROJECT_CONFLICT");
    const winner = contenders.find((value) => value.ok);

    const evidence = await page.evaluate(async () => {
      const store = await import("./src/project/storage.js"), { canonicalJSON, createSceneProject } = await import("./src/project/model.js");
      const request = (value) => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
      const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
      const db = await request(indexedDB.open(store.PROJECT_DB_NAME, 1));
      const raw = async () => {
        const tx = db.transaction(["records", "assets"], "readonly"), complete = done(tx);
        const records = await request(tx.objectStore("records").getAll()), assets = await request(tx.objectStore("assets").getAll());
        await complete; return { records, assets };
      };
      const mutate = async (name, value, key) => { const tx = db.transaction(name, "readwrite"), complete = done(tx); tx.objectStore(name).put(value, key); await complete; };
      const failure = async (fn) => { try { await fn(); return null; } catch (error) { return typeof error.code === "string" ? error.code : error.name; } };
      const current = await store.readStoryProject("story:storage-scene"), before = await raw();
      const originalDigest = current.project.assets.photo.sha256, source = await current.readAsset("photo");
      const candidate = structuredClone(current.project); candidate.revision++;
      const originalText = candidate.nodes.caption.text;
      const corrupt = new Uint8Array(await source.arrayBuffer()); corrupt[10] ^= 1;
      const changedRejected = Boolean(await failure(() => store.writeStoryProject(candidate, { expectedRevision: current.revision, readAsset: (id) => id === "photo" ? corrupt : current.readAsset(id) })));
      const stale = structuredClone(candidate); stale.revision += 100;
      const staleCode = await failure(() => store.writeStoryProject(stale, { expectedRevision: 0 }));
      const missing = structuredClone(candidate); missing.assets.extra = { ...missing.assets.photo, id: "extra", sha256: "f".repeat(64) };
      const missingRejected = Boolean(await failure(() => store.writeStoryProject(missing, { expectedRevision: current.revision })));
      const incompatible = structuredClone(candidate); incompatible.engine.compositor = "future";
      const engineRejected = Boolean(await failure(() => store.writeStoryProject(incompatible, { expectedRevision: current.revision })));
      const large = createSceneProject({ id: "oversized-story" }); large.assets.a = { ...candidate.assets.photo, id: "a", byteLength: 129 * 1024 * 1024 };
      let oversizedReads = 0;
      const oversizedRejected = Boolean(await failure(() => store.writeStoryProject(large, { readAsset: () => { oversizedReads++; } })));
      // Quota failure after adding a new asset must roll back that asset as well.
      const added = new Uint8Array([7, 8, 9]); candidate.assets.extra = { ...candidate.assets.photo, id: "extra", byteLength: added.length, sha256: await store.hashAsset(added) };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { if (this.name === "records") throw new DOMException("Injected quota", "QuotaExceededError"); return put.apply(this, args); };
      let quotaCode;
      try { quotaCode = await failure(() => store.writeStoryProject(candidate, { expectedRevision: current.revision, readAsset: (id) => id === "extra" ? added : current.readAsset(id) })); }
      finally { IDBObjectStore.prototype.put = put; }
      const afterFailure = await raw();
      const failuresPreserved = canonicalJSON(before.records) === canonicalJSON(afterFailure.records)
        && canonicalJSON(before.assets.map((a) => [a.sha256, a.blob.size])) === canonicalJSON(afterFailure.assets.map((a) => [a.sha256, a.blob.size]));

      // A second document shares the content-addressed images, mask and font.
      const other = structuredClone(current.project); other.id = "second-story"; other.revision = 0;
      await store.writeStoryProject(other);
      const dedupCount = (await raw()).assets.length;
      const replace = structuredClone(current.project); replace.revision++; delete replace.assets.duplicate;
      const api = await import("./wasm/pillow_rs_js.js"), green = new api.Image("RGBA", 8, 8, 0, 255, 0, 255);
      let replacement;
      try { replacement = green.saveWithInput("PNG", null); } finally { green.free(); }
      replace.assets.photo.sha256 = await store.hashAsset(replacement); replace.assets.photo.byteLength = replacement.length;
      await store.writeStoryProject(replace, { expectedRevision: current.revision, readAsset: (id) => id === "photo" ? replacement : current.readAsset(id) });
      const sharedRetained = (await raw()).assets.some((asset) => asset.sha256 === originalDigest);
      await store.clearRecoveryProject("story:second-story");
      const unreferencedCollected = !(await raw()).assets.some((asset) => asset.sha256 === originalDigest);
      const openRevisionStillReadable = await store.hashAsset(await (await current.readAsset("photo")).arrayBuffer()) === originalDigest;

      const active = await store.readStoryProject("story:storage-scene"), savedAssets = (await raw()).assets;
      const entry = savedAssets.find((asset) => asset.sha256 === active.project.assets.photo.sha256);
      const bad = new Uint8Array(await entry.blob.arrayBuffer()); bad[10] ^= 1;
      await mutate("assets", { ...entry, blob: new Blob([bad]) });
      const broken = await store.readStoryProject("story:storage-scene");
      const corruptReadRejected = Boolean(await failure(() => broken.readAsset("photo")));
      await mutate("assets", entry);
      const record = (await raw()).records[0], future = structuredClone(record); future.document.version = 99;
      await mutate("records", future, "story:storage-scene");
      const futureReadRejected = Boolean(await failure(() => store.readStoryProject("story:storage-scene")));
      const futureWriteRejected = Boolean(await failure(() => store.writeStoryProject(active.project, { expectedRevision: active.revision })));
      const backup = new Uint8Array(await (await store.exportRecoveryBackup()).arrayBuffer());
      const size = new DataView(backup.buffer).getUint32(7), header = JSON.parse(new TextDecoder().decode(backup.subarray(11, 11 + size)));
      let offset = 11 + size, backupValid = true;
      for (const asset of header.assets) { backupValid &&= await store.hashAsset(backup.subarray(offset, offset + asset.size)) === asset.sha256; offset += asset.size; }
      const futurePreserved = header.records.some((item) => item.kind === "story" && item.document.version === 99);
      await store.clearRecoveryProject("story:storage-scene");
      const cleanup = await raw(); db.close();
      return { revision: current.revision, originalText, changedRejected, staleCode, missingRejected, engineRejected, oversizedReads, oversizedRejected,
        quotaCode, failuresPreserved, dedupCount, sharedRetained, unreferencedCollected, openRevisionStillReadable, corruptReadRejected,
        futureReadRejected, futureWriteRejected, futurePreserved, backupValid: backupValid && offset === backup.length,
        cleanup: cleanup.records.length === 0 && cleanup.assets.length === 0 };
    });
    assert.equal(evidence.revision, winner.revision); assert.equal(evidence.originalText, winner.text);
    for (const key of ["changedRejected", "missingRejected", "engineRejected", "oversizedRejected", "failuresPreserved", "sharedRetained", "unreferencedCollected", "openRevisionStillReadable", "corruptReadRejected", "futureReadRejected", "futureWriteRejected", "futurePreserved", "backupValid", "cleanup"]) assert.equal(evidence[key], true, key);
    assert.equal(evidence.staleCode, "PROJECT_CONFLICT"); assert.equal(evidence.quotaCode, "QuotaExceededError");
    assert.equal(evidence.oversizedReads, 0); assert.equal(evidence.dedupCount, 3);
    assert.deepEqual(errors, []);
    console.log("  story storage: exact rendered reload, lazy verified assets, atomic quota rollback, real two-tab revision conflict, shared-asset GC and retained open revisions");
  } finally { await context.close(); }
}
