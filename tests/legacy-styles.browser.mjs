import { waitForAsync } from "./helpers/wait-for-async.mjs";
import assert from "node:assert/strict";

export async function assertLegacyStyles(browser, origin) {
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(origin);
    const originals = await page.evaluate(async () => {
      const { PRESETS } = await import("./src/presets.js"), { createTextLayer } = await import("./src/compositor/text.js");
      const good = { id: "old-private-recipe", name: "Private old print", destination: "Old print", description: "Before migration", oldMetadata: { preserved: true },
        operations: { ...structuredClone(PRESETS[0].operations), cropRelative: { x: .1, y: .1, width: .8, height: .8 }, rotation: 90, flipX: true,
          resizeWidth: 72, resizeHeight: 90, resizeMode: "crop", brightness: 1.12, contrast: .84,
          textLayers: [{ ...createTextLayer(), id: "caption", text: "Private words", fontSize: .08 }] } };
      const unsupported = { ...structuredClone(good), id: "old-avif", name: "Old AVIF intent", operations: { ...structuredClone(good.operations), format: "avif" } };
      const original = JSON.stringify([good, unsupported]); localStorage.setItem("tiny-image-star.presets.v1", original); return original;
    });
    await page.reload(); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
    await page.waitForFunction(() => document.querySelector('[data-preset-id="old-avif"]')?.dataset.styleRevision === "1");
    assert.equal(await page.evaluate(() => localStorage.getItem("tiny-image-star.presets.v1")), originals, "migration never rewrites the original records");
    const parity = await page.evaluate(async () => {
      const { readStyleLibrary } = await import("./src/styles/store.js"), { legacyRecipeOperations, withLegacyStyle } = await import("./src/styles/legacy.js");
      const { createPillowEngine } = await import("./src/engine/pillow.js"), { hashAsset } = await import("./src/project/storage.js"), { settingsForLargeJob, createLargeJob } = await import("./src/jobs/core.js");
      const engine = await createPillowEngine(), original = JSON.parse(localStorage.getItem("tiny-image-star.presets.v1"))[0];
      const style = (await readStyleLibrary()).records.find((record) => record.style.id === original.id).style, wrapper = withLegacyStyle(style);
      const rows = [];
      for (const [width, height] of [[96, 64], [64, 96], [80, 80]]) {
        const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext("2d"), gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#ff6633"); gradient.addColorStop(1, "#2266cc"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#ffdd44"; ctx.fillRect(0, 0, width / 3, height / 4);
        const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()), file = { name: "private.png", bytes };
        const legacy = await engine.render(file, original.operations), migrated = await engine.render(file, legacyRecipeOperations(wrapper));
        const job = createLargeJob({ id: "frozen", recipe: wrapper }), folder = await engine.render(file, settingsForLargeJob(job.recipe));
        const bitmap = await createImageBitmap(new Blob([migrated.bytes], { type: migrated.mime }));
        rows.push({ legacy: await hashAsset(legacy.bytes), migrated: await hashAsset(migrated.bytes), folder: await hashAsset(folder.bytes), width: bitmap.width, height: bitmap.height }); bitmap.close();
      }
      return { rows, original: style.recipe, order: style.order };
    });
    assert.deepEqual(parity.original, JSON.parse(originals)[0]);
    assert.deepEqual(parity.order, ["exif", "crop", "rotate", "flip", "resize", "adjust", "text", "encode"]);
    for (const row of parity.rows) { assert.equal(row.migrated, row.legacy); assert.equal(row.folder, row.legacy); assert.equal(row.width, 72); assert.equal(row.height, 90); }

    await page.getByRole("button", { name: "Presets", exact: true }).click();
    const unavailable = page.locator('[data-preset-id="old-avif"]');
    assert.equal(await unavailable.getAttribute("data-unavailable"), "true"); assert.match(await unavailable.textContent(), /avif output is unavailable/);
    await unavailable.getByRole("button", { name: "Keep edits · use JPEG", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-preset-id="old-avif"]')?.dataset.styleRevision === "2");
    const replacement = await page.evaluate(async () => {
      const { readStyleLibrary } = await import("./src/styles/store.js");
      return { recipes: (await (await import("./src/styles/catalog.js")).readRecipeCatalog()).recipes,
        original: localStorage.getItem("tiny-image-star.presets.v1"), versions: (await readStyleLibrary()).records.filter((record) => record.style.id === "old-avif").map((record) => record.style) };
    });
    assert.deepEqual(replacement.versions.map((style) => [style.revision, style.recipe.operations.format]), [[1, "avif"], [2, "jpeg"]]);
    assert.deepEqual(replacement.versions[0].recipe, JSON.parse(originals)[1]);
    assert.deepEqual(replacement.versions[1].recipe.operations.textLayers, JSON.parse(originals)[1].operations.textLayers);
    assert.equal(replacement.recipes[1].operations.format, "jpeg"); assert.equal(replacement.recipes[1].style.revision, 2);
    assert.equal(replacement.original, originals, "even an explicit update leaves the migration source untouched");
    assert.equal(await unavailable.getAttribute("data-unavailable"), null);
    await page.reload(); await page.waitForFunction(() => document.querySelector('[data-preset-id="old-avif"]')?.dataset.styleRevision === "2");

    await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(96, 64), ctx = canvas.getContext("2d"); ctx.fillStyle = "#cc8866"; ctx.fillRect(0, 0, 96, 64);
      await window.tinyImageStarEditor.loadFile(new File([await canvas.convertToBlob()], "editor-source.png", { type: "image/png" }));
    });
    await page.getByRole("button", { name: "Presets", exact: true }).click();
    const editable = page.locator('[data-preset-id="old-private-recipe"]');
    await editable.locator(".preset-more summary").click(); await editable.getByRole("button", { name: "Edit on canvas", exact: true }).click();
    await page.waitForFunction(() => window.tinyImageStarEditor.getSnapshot().project?.recipe?.definitions?.[0]?.style?.id === "old-private-recipe");
    const editorCopy = await page.evaluate(() => window.tinyImageStarEditor.getSnapshot().project.recipe.definitions[0].style);
    assert.deepEqual(editorCopy.recipe, JSON.parse(originals)[0]); assert.equal(editorCopy.revision, 1);
    await waitForAsync(page, async () => (await (await import("./src/session.js")).readEditorSession())?.project?.recipe?.definitions?.[0]?.style?.id === "old-private-recipe");

    const second = await context.newPage(); second.on("pageerror", (error) => errors.push(error.message)); await second.goto(origin);
    await second.waitForFunction(() => document.querySelector('[data-preset-id="old-avif"]')?.dataset.styleRevision === "2");
    const race = await Promise.all([page, second].map((tab, index) => tab.evaluate(async (index) => {
      const { putLegacyRecipe } = await import("./src/styles/store.js");
      const recipe = JSON.parse(localStorage.getItem("tiny-image-star.presets.v1"))[0]; recipe.id = "simultaneous-legacy"; recipe.name = `Revision from tab ${index}`;
      return (await putLegacyRecipe(recipe)).style;
    }, index)));
    assert.deepEqual(race.map((style) => style.revision).sort(), [1, 2]); assert.notEqual(race[0].name, race[1].name);
    await second.close();
    const storage = await page.evaluate(async () => {
      const store = await import("./src/styles/store.js"), { migrateLegacyRecipes } = await import("./src/styles/migrate.js");
      const raw = localStorage.getItem("tiny-image-star.presets.v1"), source = JSON.parse(raw)[0]; source.id = "quota-legacy";
      const before = JSON.stringify(await store.readStyleBackup()), add = IDBObjectStore.prototype.add;
      let failed;
      try {
        IDBObjectStore.prototype.add = function (...args) { if (this.name === "styles") throw new DOMException("Injected quota", "QuotaExceededError"); return add.apply(this, args); };
        failed = await migrateLegacyRecipes([source]);
      } finally { IDBObjectStore.prototype.add = add; }
      const unchanged = before === JSON.stringify(await store.readStyleBackup()), retry = await migrateLegacyRecipes([source]);
      source.id = "reopen-legacy"; const get = IDBObjectStore.prototype.get; let readFailure;
      try {
        IDBObjectStore.prototype.get = function (...args) { if (this.name === "styles") throw new Error("Injected reopen failure"); return get.apply(this, args); };
        readFailure = await migrateLegacyRecipes([source]);
      } finally { IDBObjectStore.prototype.get = get; }
      const reopened = await migrateLegacyRecipes([source]);
      const controller = new AbortController(), pending = migrateLegacyRecipes(Array.from({ length: 3 }, (_, i) => ({ ...source, id: `clear-race-${i}` })), { signal: controller.signal }).then(() => "saved", (error) => error.name);
      controller.abort(); await store.clearStyleLibrary();
      return { failure: failed.issues.join(" "), retained: failed.recipes[0], unchanged, retryRevision: retry.recipes[0].style.revision,
        reopenFailure: readFailure.issues.join(" "), unverifiedHasStyle: Boolean(readFailure.recipes[0].style), reopenedRevision: reopened.recipes[0].style.revision,
        originalUnchanged: raw === localStorage.getItem("tiny-image-star.presets.v1"), cleared: (await store.readStyleBackup()).length, interrupted: await pending };
    });
    assert.match(storage.failure, /Injected quota/); assert.equal(storage.retained.style, undefined); assert.equal(storage.unchanged, true); assert.equal(storage.retryRevision, 1);
    assert.match(storage.reopenFailure, /Injected reopen failure/); assert.equal(storage.unverifiedHasStyle, false); assert.equal(storage.reopenedRevision, 1);
    assert.equal(storage.originalUnchanged, true); assert.equal(storage.cleared, 0); assert.equal(storage.interrupted, "AbortError");
    assert.deepEqual(await page.evaluate(() => window.tinyImageStarEditor.getSnapshot().project.recipe.definitions[0].style), editorCopy, "removing library revisions leaves the applied project copy intact");
    assert.equal(await page.evaluate(() => {
      const editor = window.tinyImageStarEditor;
      editor.replaceOperations({ ...editor.getSnapshot().operations, brightness: .9 }, { kind: "preset-edit", presetId: "unmigrated" });
      return editor.getSnapshot().project.recipe;
    }), null, "an unversioned fallback cannot falsely inherit the previously applied style identity");
    assert.deepEqual(errors, []);
    console.log("  legacy styles: retained originals, exact three-aspect render parity, explicit output replacement, immutable revisions, two-tab migration, quota/reopen recovery and clear fencing");
  } catch (error) {
    console.error("legacy migration failure", await page.evaluate(() => ({ engine: document.querySelector("#engine-status")?.textContent,
      migration: document.querySelector("#preset-migration-status")?.textContent,
      cards: [...document.querySelectorAll(".preset-card")].slice(0, 3).map((card) => ({ id: card.dataset.presetId, revision: card.dataset.styleRevision, text: card.textContent })) })).catch(() => ({})), errors);
    throw error;
  } finally { await context.close(); }
}
