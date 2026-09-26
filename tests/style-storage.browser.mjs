import { waitForAsync } from "./helpers/wait-for-async.mjs";
import assert from "node:assert/strict";

export async function assertStyleStorage(browser, origin) {
  const context = await browser.newContext(), page = await context.newPage(), second = await context.newPage(), errors = [];
  for (const tab of [page, second]) tab.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(origin); await second.goto(origin);
    const style = await page.evaluate(async () => {
      const { curatedStyles } = await import("./src/styles/model.js"), { putStyle, readStyleLibrary } = await import("./src/styles/store.js");
      const input = curatedStyles()[1]; input.id = "style-storage-probe"; input.name = "Warm evenings";
      const pending = putStyle(input); input.name = "Changed after submission";
      await pending; return (await readStyleLibrary()).records[0].style;
    });
    assert.equal(style.name, "Warm evenings", "style definition is frozen before asynchronous storage");
    await second.evaluate(async () => {
      const store = await import("./src/styles/store.js"); await store.readStyleLibrary();
      window.styleChanges = 0; addEventListener(store.STYLE_CHANGE_EVENT, () => window.styleChanges++);
    });
    await page.evaluate(async (style) => (await import("./src/styles/store.js")).putStyle(style, { favorite: true, used: true }), style);
    await second.waitForFunction(() => window.styleChanges > 0);
    const saved = await second.evaluate(async () => (await import("./src/styles/store.js")).readStyleLibrary());
    assert.equal(saved.records.length, 1); assert.equal(saved.records[0].favorite, true); assert.ok(saved.records[0].lastUsed > 0);

    const choices = await Promise.all([page, second].map((tab, index) => tab.evaluate(async ({ style, index }) => {
      const { putStyle } = await import("./src/styles/store.js"); style.id = "same-revision-race"; style.name = `Candidate ${index}`;
      try { await putStyle(style, { origin: "imported" }); return "saved"; } catch (error) { return error.message; }
    }, { style, index })));
    assert.equal(choices.filter((value) => value === "saved").length, 1);
    assert.ok(choices.some((value) => /different settings/.test(value)), "same ID/revision conflicts cannot silently replace another tab's style");

    const report = await page.evaluate(async (style) => {
      const store = await import("./src/styles/store.js"), model = await import("./src/styles/model.js");
      const before = JSON.stringify(await store.readStyleBackup()), put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { if (this.name === "styles") throw new DOMException("Injected full storage", "QuotaExceededError"); return put.apply(this, args); };
      let quota;
      try { await store.putStyle({ ...style, id: "quota-probe" }); } catch (error) { quota = error.name; }
      finally { IDBObjectStore.prototype.put = put; }
      const unchanged = before === JSON.stringify(await store.readStyleBackup());
      await store.putStyle({ ...style, id: "quota-probe" });
      let impostor;
      const badBuiltin = model.curatedStyles()[0]; badBuiltin.components.look.paper = "#123456";
      try { await store.putStyle(badBuiltin, { origin: "imported" }); } catch (error) { impostor = error.message; }
      await store.putStyle({ ...style, revision: 2, name: "Second immutable revision" });
      const versions = (await store.readStyleLibrary()).records.filter((record) => record.style.id === style.id).map((record) => record.style.revision).sort();
      await store.removeStyle(`${style.id}@2`);
      const originalPreserved = (await store.readStyleLibrary()).records.find((record) => record.style.id === style.id).style.name === style.name;
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open(store.STYLE_DB_NAME, store.STYLE_DB_VERSION); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const tx = db.transaction("styles", "readwrite"), done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      tx.objectStore("styles").put({ version: 99, key: "future-style@1", privateFutureData: { preserved: true } }); await done; db.close();
      const future = await store.readStyleBackup(), opened = await store.readStyleLibrary();
      const backup = new Uint8Array(await (await (await import("./src/project/storage.js")).exportRecoveryBackup({ styleLibrary: future })).arrayBuffer());
      const headerLength = new DataView(backup.buffer).getUint32(7), header = JSON.parse(new TextDecoder().decode(backup.subarray(11, 11 + headerLength)));
      const privateBackup = JSON.stringify(header.extras.styleLibrary) === JSON.stringify(future);
      await store.clearStyleLibrary();
      for (let index = 0; index < store.MAX_STORED_STYLES; index++) await store.putStyle({ ...style, id: `capacity-${index}` });
      let full;
      try { await store.putStyle({ ...style, id: "over-capacity" }); } catch (error) { full = error.message; }
      const count = (await store.readStyleBackup()).length;
      await store.clearStyleLibrary();
      const now = Date.now; let monotonic, promoted;
      try {
        Date.now = () => 1000;
        const first = await store.putStyle({ ...style, id: "recent-first" }, { origin: "recent", used: true }), second = await store.putStyle({ ...style, id: "recent-second" }, { used: true });
        monotonic = second.lastUsed > first.lastUsed;
        const imported = await store.putStyle(first.style, { origin: "imported" }); promoted = imported.origin === "imported" && imported.lastUsed === first.lastUsed;
      } finally { Date.now = now; }
      const pending = store.putStyle({ ...style, id: "pending-during-clear" }).then(() => "saved", (error) => error.message);
      await store.clearStyleLibrary(); const clearedPending = await pending;
      return { quota, unchanged, impostor, versions, originalPreserved, issues: opened.issues, privateBackup, count, full, monotonic, promoted, clearedPending, cleared: (await store.readStyleBackup()).length };
    }, style);
    assert.equal(report.quota, "QuotaExceededError"); assert.equal(report.unchanged, true);
    assert.match(report.impostor, /built-in style/); assert.deepEqual(report.versions, [1, 2]); assert.equal(report.originalPreserved, true);
    assert.equal(report.issues.length, 1); assert.equal(report.privateBackup, true);
    assert.equal(report.count, 100); assert.match(report.full, /100 style revisions/); assert.equal(report.cleared, 0);
    assert.equal(report.monotonic, true); assert.equal(report.promoted, true); assert.match(report.clearedPending, /cleared while saving/);
    const fallback = await page.evaluate(async () => {
      const { mountStylePanel } = await import("./src/story/style-panel.js"), { createPhotoStory } = await import("./src/story/recipes.js");
      const store = await import("./src/styles/store.js");
      const project = createPhotoStory(Array.from({ length: 6 }, (_, index) => ({ id: `p${index}`, kind: "image", name: "Photo", type: "image/png",
        byteLength: 1, sha256: "a".repeat(64), width: 600, height: 800, orientation: "upright" })));
      const sheet = document.createElement("dialog"), content = document.createElement("div"); sheet.append(content); document.body.append(sheet); sheet.showModal();
      const panel = mountStylePanel({ content, sheet, project, getProject: () => project, slideId: project.slides[0].id,
        onPreview(style) { if (style.id === "builtin:clean") throw new Error("Injected unsupported operation"); return true; },
        renderThumbnail: async () => { throw new Error("Thumbnails are outside this UI failure test"); }, releaseThumbnail() {}, onError() {} });
      [...content.querySelectorAll("nav button")].find((button) => button.textContent === "Photo looks").click();
      content.querySelector('[data-look="clean"]').click(); panel.commit();
      const failedOnlyCount = (await store.readStyleLibrary()).records.length;
      content.querySelector('[data-look="film-diary"]').click(); content.querySelector('[data-look="clean"]').click();
      const selected = content.querySelector('[data-style-key][aria-pressed="true"]').dataset.look;
      const message = content.querySelector('[role="status"]').textContent;
      panel.commit(); panel.dispose(); sheet.close(); sheet.remove();
      return { failedOnlyCount, selected, message };
    });
    assert.deepEqual(fallback, { failedOnlyCount: 0, selected: "film-diary", message: "Injected unsupported operation" });
    await waitForAsync(page, async () => (await (await import("./src/styles/store.js")).readStyleLibrary()).records.some((record) => record.lastUsed > 0));
    assert.deepEqual(await page.evaluate(async () => (await (await import("./src/styles/store.js")).readStyleLibrary()).records.filter((record) => record.lastUsed > 0).map((record) => record.style.id)), ["builtin:film-diary"]);
    assert.deepEqual(errors, []);
    console.log("  style library: immutable revisions, two-tab conflict/notifications, favorites/recent metadata, quota rollback/retry, 100-revision cap, unknown-data preservation and lossless private backup");
  } finally { await context.close(); }
}
