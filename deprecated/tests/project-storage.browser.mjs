import assert from "node:assert/strict";

export async function assertProjectStorage(page, fixture) {
  const evidence = await page.evaluate(async (fixture) => {
    const store = await import("./src/project/storage.js");
    const sessions = await import("./src/session.js");
    const source = Uint8Array.from(atob(fixture.trim()), (character) => character.charCodeAt(0));
    const operations = { rotation: 90, brightness: 1, contrast: 1, crop: { x: 1.25, y: .5, width: 4.5, height: 6 }, format: "png" };
    const built = sessions.buildEditorSessionSnapshot({ file: { id: "legacy-image", name: "original.png", type: "image/png", lastModified: 100, bytes: source }, operations });
    const request = (value) => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
    const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
    // Seed an actual legacy record. New saves must leave it intact, including
    // original bytes and operation order, until an explicit user cleanup.
    const legacy = await request(indexedDB.open(sessions.SESSION_DB_NAME, 1));
    let tx = legacy.transaction("snapshots", "readwrite"), finished = done(tx);
    tx.objectStore("snapshots").put(built.snapshot, "project-probe"); await finished;
    const legacyBefore = (await sessions.readLegacySessionBackups()).find((entry) => entry.key === "project-probe");
    const readLegacy = await sessions.readSession("project-probe");
    const saved = await store.writeRecoveryProject(readLegacy, "project-probe");
    const restored = await store.readRecoveryProject("project-probe");
    const legacyAfter = (await sessions.readLegacySessionBackups()).find((entry) => entry.key === "project-probe");
    const db = await request(indexedDB.open(store.PROJECT_DB_NAME, 1));
    const raw = async (key) => {
      const tx = db.transaction(["records", "assets"], "readonly"), finished = done(tx);
      const record = await request(tx.objectStore("records").get(key));
      const assets = await request(tx.objectStore("assets").getAll());
      await finished;
      return { record, assets };
    };
    const first = await raw("project-probe");
    const snapshot = sessions.buildEditorSessionSnapshot({ file: { ...restored.editor, bytes: source }, operations: restored.editor.operations, project: restored.project }).snapshot;
    snapshot.project.revision += 1;
    snapshot.project.nodes[snapshot.project.slides[0].nodeIds[0]].operations.rotation = 180;
    await store.writeRecoveryProject(snapshot, "project-probe");
    const second = await raw("project-probe");
    const conflict = structuredClone(snapshot);
    conflict.project.nodes[conflict.project.slides[0].nodeIds[0]].operations.contrast = 1.2;
    let conflictingRevisionRejected = false;
    try { await store.writeRecoveryProject(conflict, "project-probe"); } catch { conflictingRevisionRejected = true; }
    const stableIds = first.record.document.slides[0].id === second.record.document.slides[0].id
      && first.record.document.slides[0].nodeIds[0] === second.record.document.slides[0].nodeIds[0];
    // A failed metadata write must roll back all asset mutations atomically.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "records") throw new DOMException("Injected quota failure", "QuotaExceededError");
      return put.apply(this, args);
    };
    snapshot.project.revision += 1;
    let quotaRejected = false;
    try { await store.writeRecoveryProject(snapshot, "project-probe"); } catch { quotaRejected = true; }
    finally { IDBObjectStore.prototype.put = put; }
    const afterFailure = await raw("project-probe");
    // A renderer change must archive the exact former record before replacing
    // it. Read alone upgrades only the in-memory document, leaving storage raw.
    const oldRenderer = structuredClone(afterFailure.record); delete oldRenderer.document.engine.compositor;
    tx = db.transaction("records", "readwrite"); finished = done(tx); tx.objectStore("records").put(oldRenderer, "renderer-probe"); await finished;
    const migratedRenderer = await store.readRecoveryProject("renderer-probe");
    const rendererReadPreserved = JSON.stringify((await raw("renderer-probe")).record) === JSON.stringify(oldRenderer);
    await store.writeRecoveryProject(migratedRenderer, "renderer-probe");
    const archiveKey = `renderer-probe:renderer-backup:${oldRenderer.document.id}:${oldRenderer.document.revision}`;
    const archived = (await raw(archiveKey)).record;
    const rendererArchived = archived.archiveOf === "renderer-probe" && JSON.stringify(archived.document) === JSON.stringify(oldRenderer.document)
      && migratedRenderer.project.revision === oldRenderer.document.revision + 1;
    await store.clearRecoveryProject("renderer-probe");
    const rendererCleanup = !(await raw(archiveKey)).record;
    // Exercise the version fence and lossless archival path for future data.
    const future = structuredClone(afterFailure.record); future.document.version = 99;
    tx = db.transaction("records", "readwrite"); finished = done(tx); tx.objectStore("records").put(future, "project-probe"); await finished;
    let futureReadRejected = false, futureWriteRejected = false;
    try { await store.readRecoveryProject("project-probe"); } catch { futureReadRejected = true; }
    try { await store.writeRecoveryProject(snapshot, "project-probe"); } catch { futureWriteRejected = true; }
    const backup = new Uint8Array(await (await store.exportRecoveryBackup({ legacy: [legacyBefore], fonts: [{ id: "test-font", bytes: source.buffer }], recipes: "saved recipe metadata" })).arrayBuffer());
    const headerLength = new DataView(backup.buffer).getUint32(7);
    const header = JSON.parse(new TextDecoder().decode(backup.subarray(11, 11 + headerLength)));
    let offset = 11 + headerLength, backupAssetsValid = true;
    for (const asset of header.assets) {
      backupAssetsValid &&= await store.hashAsset(backup.subarray(offset, offset + asset.size)) === asset.sha256;
      offset += asset.size;
    }
    const output = {
      saved, rendererReadPreserved, rendererArchived, rendererCleanup, restoredOperations: restored.editor.operations,
      restoredDigest: await store.hashAsset(restored.editor.bytes), originalDigest: await store.hashAsset(source),
      originalPreserved: JSON.stringify(legacyBefore.value) === JSON.stringify(legacyAfter.value)
        && await store.hashAsset(legacyBefore.value.editor.bytes) === await store.hashAsset(legacyAfter.value.editor.bytes),
      hasEmbeddedBytes: "bytes" in first.record.session.editor || JSON.stringify(first.record.document).includes('"bytes"'),
      assetsBefore: first.assets.length, assetsAfter: second.assets.length, stableIds, quotaRejected, conflictingRevisionRejected,
      failurePreserved: JSON.stringify(second.record) === JSON.stringify(afterFailure.record),
      futureReadRejected, futureWriteRejected, futurePreserved: (await raw("project-probe")).record.document.version,
      backupMagic: new TextDecoder().decode(backup.subarray(0, 7)), backupAssetsValid, backupSizeValid: offset === backup.length,
      backupVersion: header.records.find((record) => record.document.version === 99)?.document.version,
      backupFont: header.extras.fonts[0].bytes.binaryAsset,
      backupLegacy: header.extras.legacy[0].value.editor.bytes.binaryAsset,
    };
    await sessions.clearSession("project-probe");
    db.close(); legacy.close();
    return output;
  }, fixture);
  assert.equal(evidence.saved, true);
  assert.equal(evidence.rendererReadPreserved, true);
  assert.equal(evidence.rendererArchived, true);
  assert.equal(evidence.rendererCleanup, true);
  assert.deepEqual(evidence.restoredOperations, { rotation: 90, brightness: 1, contrast: 1, crop: { x: 1.25, y: .5, width: 4.5, height: 6 }, format: "png" });
  assert.equal(evidence.restoredDigest, evidence.originalDigest);
  assert.equal(evidence.originalPreserved, true);
  assert.equal(evidence.hasEmbeddedBytes, false);
  assert.equal(evidence.assetsBefore, 1);
  assert.equal(evidence.assetsAfter, 1);
  assert.equal(evidence.stableIds, true);
  assert.equal(evidence.quotaRejected, true);
  assert.equal(evidence.conflictingRevisionRejected, true);
  assert.equal(evidence.failurePreserved, true);
  assert.equal(evidence.futureReadRejected, true);
  assert.equal(evidence.futureWriteRejected, true);
  assert.equal(evidence.futurePreserved, 99);
  assert.equal(evidence.backupMagic, "TSTAR1\n");
  assert.equal(evidence.backupAssetsValid, true);
  assert.equal(evidence.backupSizeValid, true);
  assert.equal(evidence.backupVersion, 99);
  assert.equal(evidence.backupFont, evidence.originalDigest);
  assert.equal(evidence.backupLegacy, evidence.originalDigest);
  console.log("  project storage: separate deduplicated assets, legacy preservation, atomic quota failure, future-version fence and lossless binary backup");
}
