import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { legacyStyleFromRecipe } from "../src/styles/legacy.js";

export async function assertRecipeCatalog(browser, origin) {
  const context = await browser.newContext(), pages = [await context.newPage(), await context.newPage()], errors = [];
  const [first, second] = pages;
  for (const page of pages) page.on("pageerror", (error) => errors.push(error.message));
  const read = (page) => page.evaluate(async () => (await import("./src/styles/catalog.js")).readRecipeCatalog());
  const run = (page, command) => page.evaluate(async (command) => {
    try { return { result: await (await import("./src/styles/catalog.js")).mutateRecipeCatalog(command) }; }
    catch (error) { return { error: error.message, code: error.code }; }
  }, command);
  const command = (page, snapshot, id, name, token = null, type = "put") => page.evaluate(async ({ snapshot, id, name, token, type }) => {
    const { recipeCommand } = await import("./src/styles/catalog-model.js");
    return recipeCommand(snapshot, type, type === "put" ? { id, name, operations: { format: "png", brightness: 1, contrast: 1, resizeMode: "fit" } } : id, token);
  }, { snapshot, id, name, token, type });
  try {
    await Promise.all(pages.map(async (page) => { await page.goto(origin); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready"); }));
    const bases = await Promise.all(pages.map(read));
    const creates = await Promise.all(pages.map((page, index) => command(page, bases[index], `concurrent-${index}`, `Created ${index}`)));
    const created = await Promise.all(pages.map((page, index) => run(page, creates[index])));
    assert.ok(created.every((entry) => entry.result), JSON.stringify(created));
    let snapshot = await read(first); assert.equal(snapshot.entries.length, 2); assert.equal(snapshot.revision, 2);
    assert.equal(await first.evaluate(() => localStorage.getItem("tiny-image-star.presets.v1")), null, "new saves never rewrite the legacy migration source");

    const sharedId = "concurrent-0", token = snapshot.entries.find((entry) => entry.id === sharedId).token;
    const edits = await Promise.all(pages.map((page, index) => command(page, snapshot, sharedId, `Concurrent edit ${index}`, token)));
    const raced = await Promise.all(pages.map((page, index) => run(page, edits[index])));
    assert.equal(raced.filter((entry) => entry.result).length, 1); assert.equal(raced.filter((entry) => entry.code === "CATALOG_CONFLICT").length, 1);
    snapshot = await read(first); assert.equal(snapshot.revision, 3);
    assert.equal(await first.evaluate(async () => (await (await import("./src/styles/store.js")).readStyleBackup()).length), 3, "the losing edit did not leave an orphan definition");
    await Promise.all(pages.map((page) => page.waitForFunction(() => document.querySelector('[data-preset-id="concurrent-0"]')?.dataset.styleRevision === "2")));

    // Open real editor drafts in two tabs before either saves. Background
    // catalog refreshes must not replace a draft's original conflict token.
    for (const page of pages) {
      await page.evaluate(async () => {
        const canvas = new OffscreenCanvas(64, 48), ctx = canvas.getContext("2d"); ctx.fillStyle = "#bd8866"; ctx.fillRect(0, 0, 64, 48);
        await window.tinyImageStarEditor.loadFile(new File([await canvas.convertToBlob()], "catalog.png", { type: "image/png" }));
      });
      await page.getByRole("button", { name: "Presets", exact: true }).click();
      const card = page.locator('[data-preset-id="concurrent-0"]'); await card.locator(".preset-more summary").click();
      await card.getByRole("button", { name: "Edit on canvas", exact: true }).click();
      await page.getByRole("button", { name: "Save recipe", exact: true }).click();
    }
    const appliedBefore = await second.evaluate(() => window.tinyImageStarEditor.getSnapshot().project.recipe);
    await first.locator("#preset-name-input").fill("Saved in first tab"); await second.locator("#preset-name-input").fill("Draft kept in second tab");
    await first.getByRole("button", { name: "Save preset", exact: true }).click(); await first.waitForFunction(() => !document.querySelector("#preset-dialog").open);
    await second.waitForFunction(() => document.querySelector('[data-preset-id="concurrent-0"]')?.dataset.styleRevision === "3");
    assert.equal(await second.locator("#preset-name-input").inputValue(), "Draft kept in second tab");
    await second.getByRole("button", { name: "Save preset", exact: true }).click();
    await second.locator("[data-preset-save-error]").waitFor();
    assert.match(await second.locator("[data-preset-save-error]").innerText(), /changed or was removed/);
    assert.equal(await second.locator("#preset-name-input").inputValue(), "Draft kept in second tab");
    assert.equal((await read(first)).recipes.find((entry) => entry.id === sharedId).name, "Saved in first tab");
    await second.setViewportSize({ width: 375, height: 667 });
    assert.equal(await second.locator("#preset-dialog").evaluate((element) => element.scrollWidth <= element.clientWidth), true, "phone conflict dialog fits its viewport");
    const copyAction = second.getByRole("button", { name: "Save as new recipe", exact: true });
    await copyAction.scrollIntoViewIfNeeded();
    const recoveryTarget = await copyAction.evaluate((element) => {
      const rect = element.getBoundingClientRect(); return { height: rect.height, reachable: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
    });
    assert.ok(recoveryTarget.height >= 44 && recoveryTarget.reachable, `the mobile recovery action has a reachable touch target: ${JSON.stringify(recoveryTarget)}`);
    if (process.env.TINY_IMAGE_STAR_CATALOG_ARTIFACTS) {
      await mkdir("docs/research/2026-09-17", { recursive: true });
      await second.screenshot({ path: "docs/research/2026-09-17/recipe-conflict-phone.png" });
    }
    await second.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    assert.equal(await second.locator("#preset-dialog").evaluate((element) => element.scrollWidth <= element.clientWidth), true, "200% text does not overflow the conflict dialog");
    await second.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await second.setViewportSize({ width: 1280, height: 720 });
    await second.getByRole("button", { name: "Save as new recipe", exact: true }).click(); await second.waitForFunction(() => !document.querySelector("#preset-dialog").open);
    snapshot = await read(first);
    assert.equal(snapshot.recipes.filter((entry) => entry.name === "Draft kept in second tab").length, 1);
    assert.notEqual(snapshot.recipes.find((entry) => entry.name === "Draft kept in second tab").id, sharedId);

    await first.getByRole("button", { name: "Presets", exact: true }).click();
    const current = first.locator('[data-preset-id="concurrent-0"]'); await current.locator(".preset-more summary").click();
    first.once("dialog", (dialog) => dialog.accept()); await current.getByRole("button", { name: "Delete", exact: true }).click();
    await second.waitForFunction(() => !document.querySelector('[data-preset-id="concurrent-0"]'));
    assert.deepEqual(await second.evaluate(() => window.tinyImageStarEditor.getSnapshot().project.recipe), appliedBefore, "remote deletion leaves the applied project revision intact");
    await second.getByRole("button", { name: "Save recipe", exact: true }).click(); await second.locator("#preset-name-input").fill("Stale deleted recipe");
    await second.getByRole("button", { name: "Save preset", exact: true }).click(); await second.locator("[data-preset-save-error]").waitFor();
    assert.equal((await read(first)).entries.some((entry) => entry.id === sharedId), false, "a stale editor cannot resurrect the deleted ID");
    await second.locator("#preset-cancel-button").click();

    const failures = await first.evaluate(async () => {
      const api = await import("./src/styles/catalog.js"), model = await import("./src/styles/catalog-model.js"), store = await import("./src/styles/store.js");
      const request = model.recipeCommand(await api.readRecipeCatalog(), "put", { id: "quota-catalog", name: "Quota draft", operations: { format: "png" } });
      const before = JSON.stringify([await store.readStyleBackup(), await store.readRecipeCatalogBackup()]), put = IDBObjectStore.prototype.put;
      let quota;
      try {
        IDBObjectStore.prototype.put = function (...args) { if (this.name === "recipeCatalog") throw new DOMException("Injected catalog quota", "QuotaExceededError"); return put.apply(this, args); };
        try { await api.mutateRecipeCatalog(request); } catch (error) { quota = error.name; }
      } finally { IDBObjectStore.prototype.put = put; }
      const rolledBack = before === JSON.stringify([await store.readStyleBackup(), await store.readRecipeCatalogBackup()]);
      const success = await api.mutateRecipeCatalog(request), receipt = await api.mutateRecipeCatalog(request);
      const uncertain = model.recipeCommand(success.snapshot, "put", { id: "reopen-catalog", name: "Reopen draft", operations: { format: "png" } });
      const getAll = IDBObjectStore.prototype.getAll; let failedRead;
      try {
        IDBObjectStore.prototype.getAll = function (...args) { if (this.name === "recipeCatalog" && this.transaction.mode === "readonly") throw new Error("Injected catalog reopen failure"); return getAll.apply(this, args); };
        try { await api.mutateRecipeCatalog(uncertain); } catch (error) { failedRead = error.message; }
      } finally { IDBObjectStore.prototype.getAll = getAll; }
      const retry = await api.mutateRecipeCatalog(uncertain);
      return { quota, rolledBack, firstRevision: success.snapshot.revision, replayRevision: receipt.snapshot.revision, failedRead,
        retryRevision: retry.recipe.style.revision, copies: (await store.readStyleBackup()).filter((entry) => entry.style?.id === "reopen-catalog").length };
    });
    assert.equal(failures.quota, "QuotaExceededError"); assert.equal(failures.rolledBack, true); assert.equal(failures.firstRevision, failures.replayRevision);
    assert.match(failures.failedRead, /Injected catalog reopen failure/); assert.equal(failures.retryRevision, 1); assert.equal(failures.copies, 1);

    const pending = await command(second, await read(second), "stale-after-clear", "Do not resurrect");
    await first.evaluate(async () => (await import("./src/local-data.js")).clearStoredLocalData());
    assert.equal((await run(second, pending)).code, "CATALOG_CONFLICT");
    assert.equal((await read(second)).entries.length, 0);
    assert.equal(await first.evaluate(async () => (await (await import("./src/styles/store.js")).readStyleBackup()).length), 0);
    assert.deepEqual(errors, []);
    console.log("  recipe catalog: concurrent creates, atomic stale-edit/delete refusal, retained UI drafts/save-copy, immutable applied copies, quota rollback, idempotent reopen retry and cross-tab clear fencing");
  } catch (error) {
    console.error("recipe catalog failure", await Promise.all(pages.map((page) => page.evaluate(() => ({
      notice: document.querySelector("#preset-migration-status")?.textContent, form: document.querySelector("[data-preset-save-error]")?.textContent,
      cards: [...document.querySelectorAll(".preset-card")].slice(0, 4).map((card) => ({ id: card.dataset.presetId, revision: card.dataset.styleRevision, name: card.querySelector("h2")?.textContent })),
    })).catch(() => ({})))), errors); throw error;
  } finally { await context.close(); }
  await assertCatalogFences(browser, origin);
}

async function backupHeader(page) {
  await page.getByRole("button", { name: "Local data", exact: true }).click();
  await page.locator("#local-data-dialog").waitFor({ state: "visible" });
  await page.evaluate(() => {
    const getAll = IDBObjectStore.prototype.getAll, transactions = new Map(); window.catalogBackupReads = [];
    window.restoreCatalogBackupProbe = () => { IDBObjectStore.prototype.getAll = getAll; };
    IDBObjectStore.prototype.getAll = function (...args) {
      if (this.transaction.db.name === "tiny-image-star.styles") {
        if (!transactions.has(this.transaction)) transactions.set(this.transaction, transactions.size);
        window.catalogBackupReads.push({ store: this.name, transaction: transactions.get(this.transaction) });
      }
      return getAll.apply(this, args);
    };
  });
  const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "Back up saved work", exact: true }).click();
  const download = await pending, buffer = await readFile(await download.path());
  const reads = await page.evaluate(() => { window.restoreCatalogBackupProbe(); return window.catalogBackupReads; });
  const styles = reads.find((entry) => entry.store === "styles"), catalog = reads.find((entry) => entry.store === "recipeCatalog");
  assert.ok(styles && catalog); assert.equal(styles.transaction, catalog.transaction, "private backup reads active pointers and their definitions from one transaction");
  assert.equal(buffer.subarray(0, 7).toString(), "TSTAR1\n");
  const header = JSON.parse(buffer.subarray(11, 11 + buffer.readUInt32BE(7)).toString());
  await page.locator("#local-data-close-button").click(); return header;
}

async function assertCatalogFences(browser, origin) {
  const original = { id: "old-catalog-entry", name: "Original recipe", operations: { format: "png", brightness: 1 } };
  for (const raw of ["{unreadable", JSON.stringify({ version: 99, futureRecipes: [original] }), JSON.stringify([original, original])]) {
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await context.addInitScript((raw) => localStorage.setItem("tiny-image-star.presets.v1", raw), raw);
      await page.goto(origin); await page.waitForFunction(() => document.querySelector("#preset-migration-status")?.textContent.includes("preserved"));
      const fenced = await page.evaluate(async () => {
        const api = await import("./src/styles/catalog.js"), { recipeCommand } = await import("./src/styles/catalog-model.js"), store = await import("./src/styles/store.js");
        const snapshot = await api.readRecipeCatalog(); let error;
        try { await api.mutateRecipeCatalog(recipeCommand({ generation: "initial", revision: 0 }, "put", { id: "new", name: "Must not save", operations: { format: "png" } })); } catch (failure) { error = failure.message; }
        return { readOnly: snapshot.readOnly, error, styles: (await store.readStyleBackup()).length, catalog: (await store.readRecipeCatalogBackup()).length, raw: localStorage.getItem("tiny-image-star.presets.v1") };
      });
      assert.equal(fenced.readOnly, true); assert.match(fenced.error, /preserved/); assert.equal(fenced.raw, raw); assert.equal(fenced.styles, 0); assert.equal(fenced.catalog, 0);
      await page.getByRole("button", { name: "Presets", exact: true }).click();
      const card = page.locator(".preset-card").first(); await card.locator(".preset-more summary").click();
      assert.equal(await card.getByRole("button", { name: "Duplicate", exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      assert.equal((await backupHeader(page)).extras.recipes, raw, "private backup retains the exact unreadable/future original text");
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }

  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const style = legacyStyleFromRecipe(original), record = { version: 1, key: `${style.id}@1`, style, origin: "legacy", favorite: false, savedAt: 1, lastUsed: 0 };
  try {
    // Seed the actual previous database schema before the app opens it.
    await context.addInitScript(({ record, original }) => {
      if (sessionStorage.getItem("catalog-v1-seeded")) return;
      localStorage.setItem("tiny-image-star.presets.v1", JSON.stringify([original]));
      window.catalogV1Seed = new Promise((resolve, reject) => {
        const request = indexedDB.open("tiny-image-star.styles", 1);
        request.onupgradeneeded = () => { request.result.createObjectStore("styles", { keyPath: "key" }).add(record); };
        request.onsuccess = () => { request.result.close(); sessionStorage.setItem("catalog-v1-seeded", "yes"); resolve(true); };
        request.onerror = () => reject(request.error);
      });
    }, { record, original });
    await page.goto(origin); await page.waitForFunction(() => document.querySelector('[data-preset-id="old-catalog-entry"]')?.dataset.styleRevision === "1");
    const upgraded = await page.evaluate(async () => {
      const store = await import("./src/styles/store.js"); return { version: await store.styleDatabaseVersion(), records: await store.readStyleBackup() };
    });
    assert.equal(upgraded.version, 2); assert.deepEqual(upgraded.records, [record], "the schema upgrade leaves the previous immutable definition untouched");

    const future = await page.evaluate(async () => {
      const store = await import("./src/styles/store.js");
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open(store.STYLE_DB_NAME, store.STYLE_DB_VERSION); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const saved = (await store.readRecipeCatalogBackup())[0], future = { ...saved, version: 99, futureSettings: { preserveExactly: [1, 2, 3] } };
      const tx = db.transaction("recipeCatalog", "readwrite"), done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      tx.objectStore("recipeCatalog").put(future); await done; db.close(); dispatchEvent(new Event(store.STYLE_CHANGE_EVENT)); return future;
    });
    await page.waitForFunction(() => document.querySelector("#preset-migration-status")?.textContent.includes("different app version"));
    const futureResult = await page.evaluate(async () => {
      const api = await import("./src/styles/catalog.js"), model = await import("./src/styles/catalog-model.js"), store = await import("./src/styles/store.js");
      let error; try { await api.mutateRecipeCatalog(model.recipeCommand({ generation: "initial", revision: 0 }, "put", { id: "must-not-save", name: "Blocked", operations: { format: "png" } })); } catch (failure) { error = failure.message; }
      return { readOnly: (await api.readRecipeCatalog()).readOnly, error, raw: await store.readRecipeCatalogBackup(), styles: await store.readStyleBackup() };
    });
    assert.equal(futureResult.readOnly, true); assert.match(futureResult.error, /preserved/); assert.deepEqual(futureResult.raw, [future]); assert.deepEqual(futureResult.styles, [record]);
    assert.deepEqual((await backupHeader(page)).extras.recipeCatalog, [future], "private backup includes the complete future catalog record");

    await page.evaluate(async () => {
      const store = await import("./src/styles/store.js");
      await new Promise((resolve, reject) => { const request = indexedDB.open(store.STYLE_DB_NAME, 3); request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); });
      dispatchEvent(new Event(store.STYLE_CHANGE_EVENT));
    });
    await page.waitForFunction(() => document.querySelector("#preset-migration-status")?.textContent.includes("newer app version"));
    const newer = await page.evaluate(async () => {
      const store = await import("./src/styles/store.js"), { curatedStyles } = await import("./src/styles/model.js"); let error;
      try { await store.putStyle(curatedStyles()[0]); } catch (failure) { error = failure.message; }
      return { error, version: await store.styleDatabaseVersion(), catalog: await store.readRecipeCatalogBackup(), records: await store.readStyleBackup() };
    });
    assert.match(newer.error, /newer app version/); assert.equal(newer.version, 3); assert.deepEqual(newer.catalog, [future]); assert.deepEqual(newer.records, [record]);
    const finalBackup = await backupHeader(page); assert.deepEqual(finalBackup.extras.recipeCatalog, [future]); assert.deepEqual(finalBackup.extras.styleLibrary, [record]);
    await page.evaluate(() => { window.catalogClearStarted = false; addEventListener("tinystar:local-data-clearing", () => { window.catalogClearStarted = true; }); });
    await page.getByRole("button", { name: "Local data", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept()); await page.locator("#local-data-clear-button").click();
    await page.waitForFunction(() => document.querySelector("#local-data-status")?.textContent.includes("newer app version"));
    assert.equal(await page.locator("#local-data-clear-button").isEnabled(), true, "a refused clear leaves controls usable");
    const refusedClear = await page.evaluate(async () => ({ started: window.catalogClearStarted,
      raw: localStorage.getItem("tiny-image-star.presets.v1"), backup: await (await import("./src/styles/store.js")).readStyleCatalogBackup() }));
    assert.equal(refusedClear.started, false); assert.equal(refusedClear.raw, JSON.stringify([original]));
    assert.deepEqual(refusedClear.backup, { styleLibrary: [record], recipeCatalog: [future] }, "newer database refusal happens before any saved data is cleared");
    assert.deepEqual(errors, []);
    console.log("  catalog fences: malformed/future/duplicate originals remain unchanged and downloadable; v1 database upgrade preserves definitions; future catalog/database versions remain read-only with lossless known-record backups");
  } finally { await context.close(); }
}
