import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { waitForAsync } from "./helpers/wait-for-async.mjs";

export async function selectRecipeRevision(page, selector, id, revision = 1) {
  const query = { selector, id, revision: String(revision) };
  await page.waitForFunction(({ selector, id, revision }) => [...document.querySelector(selector).options].some((option) => option.dataset.recipeId === id && option.dataset.recipeRevision === revision), query);
  const value = await page.evaluate(({ selector, id, revision }) => [...document.querySelector(selector).options].find((option) => option.dataset.recipeId === id && option.dataset.recipeRevision === revision).value, query);
  await page.locator(selector).selectOption(value);
}

export async function assertRecipeSelections(browser, origin) {
  const context = await browser.newContext(), page = await context.newPage(), other = await context.newPage(), errors = [];
  for (const tab of [page, other]) tab.on("pageerror", (error) => errors.push(error.message));
  const ready = () => page.waitForFunction(() => document.querySelector("#batch-status").textContent.includes("Ready — 2 previews"));
  const outputs = () => page.evaluate(async () => {
    const { hashAsset } = await import("./src/project/storage.js");
    return Promise.all([...document.querySelectorAll(".batch-card")].map(async (card) => ({ key: card.dataset.recipeKey,
      hash: await hashAsset(await (await fetch(card.querySelectorAll(".batch-card-compare img")[1].src)).arrayBuffer()) })));
  });
  const mutate = (brightness, type = "put", name = "Shared look") => other.evaluate(async ({ brightness, type, name }) => {
    const { readRecipeCatalog, mutateRecipeCatalog } = await import("./src/styles/catalog.js"), { recipeCommand } = await import("./src/styles/catalog-model.js");
    const snapshot = await readRecipeCatalog(), entry = snapshot.entries.find((entry) => entry.id === "revision-choice");
    const recipe = { id: "revision-choice", name, operations: { format: "png", brightness, contrast: 1, resizeMode: "fit", flipX: false, flipY: false, rotation: 0, grayscale: false } };
    return mutateRecipeCatalog(recipeCommand(snapshot, type, type === "put" ? recipe : recipe.id, entry?.token ?? null));
  }, { brightness, type, name });
  try {
    await Promise.all([page, other].map(async (tab) => { await tab.goto(origin); await tab.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready"); }));
    await mutate(.7);
    const bytes = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(48, 32), ctx = canvas.getContext("2d"), gradient = ctx.createLinearGradient(0, 0, 48, 32);
      gradient.addColorStop(0, "#fa9944"); gradient.addColorStop(1, "#225588"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 48, 32);
      return [...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer())];
    });
    await page.locator("#file-input").setInputFiles(["first.png", "second.png"].map((name) => ({ name, mimeType: "image/png", buffer: Buffer.from(bytes) })));
    await ready(); await selectRecipeRevision(page, "#tray-preset-picker", "revision-choice", 1); await ready();
    await page.waitForFunction(() => window.tinyImageStarEditor.getSnapshot().context?.style?.revision === 1);
    const flippedHash = await page.evaluate(async (bytes) => {
      const engine = await (await import("./src/engine/pillow.js")).createPillowEngine();
      const rendered = await engine.render({ name: "expected.png", bytes: new Uint8Array(bytes) }, { brightness: .7, contrast: 1, flipX: true, format: "png" });
      return (await import("./src/project/storage.js")).hashAsset(rendered.bytes);
    }, bytes);
    await page.locator("#flip-horizontal").click();
    await waitForAsync(page, async () => (await (await import("./src/session.js")).readSession())?.batch.files[0].override?.flipX === true);
    await waitForAsync(page, async (expected) => {
      const image = document.querySelector(".batch-card")?.querySelectorAll(".batch-card-compare img")[1];
      return image && await (await import("./src/project/storage.js")).hashAsset(await (await fetch(image.src)).arrayBuffer()) === expected;
    }, flippedHash);
    await ready(); const firstVersion = await outputs();
    assert.equal(firstVersion[0].hash, flippedHash);
    await mutate(1.3);
    await page.locator("#tray-scope-select").selectOption("this");
    await selectRecipeRevision(page, "#tray-preset-picker", "revision-choice", 2); await ready();
    await page.waitForFunction(() => window.tinyImageStarEditor.getSnapshot().context?.style?.revision === 2);
    const mixed = await outputs();
    assert.notEqual(mixed[0].hash, firstVersion[0].hash); assert.deepEqual(mixed[1], firstVersion[1], "applying version two to this image leaves the other output byte-identical");
    assert.equal(await page.evaluate(() => window.tinyImageStarEditor.getSnapshot().operations.flipX), true, "a recipe revision change retains the image's manual correction");
    await page.locator("#tray-scope-select").selectOption("selected");
    assert.equal(await page.locator("#tray-preset-picker").inputValue(), "", "two selected revisions of one ID are a mixed selection");

    // A folder job holds version two while the library moves to version three.
    await page.evaluate(async (bytes) => {
      const root = await navigator.storage.getDirectory(), source = await root.getDirectoryHandle("revision-input", { create: true }), output = await root.getDirectoryHandle("revision-output", { create: true });
      const file = await source.getFileHandle("photo.png", { create: true }), writer = await file.createWritable(); await writer.write(new Uint8Array(bytes)); await writer.close();
      window.__tinystarDirectoryPicker = async ({ id }) => id === "tiny-image-star-source" ? source : output;
    }, bytes);
    await page.locator("#batch-button").click(); await page.locator("#batch-folder-button").click();
    await page.waitForFunction(() => document.querySelector("#folder-job-discovered").textContent === "1");
    await selectRecipeRevision(page, "#folder-job-recipe", "revision-choice", 2);
    await waitForAsync(page, async () => (await (await import("./src/jobs/store.js")).listLargeJobs())[0]?.recipe.style?.revision === 2 && !document.querySelector("#folder-job-recipe").disabled);
    await mutate(.9, "put", "Renamed latest look");
    await page.waitForFunction(() => [...document.querySelector("#folder-job-recipe").options].some((option) => option.dataset.recipeRevision === "3"));
    assert.equal(await page.locator("#folder-job-recipe option:checked").textContent(), "Shared look · version 2", "folder selection names the saved definition, not the newer library entry");
    await mutate(1, "delete");
    await page.waitForFunction(() => !document.querySelector('[data-preset-id="revision-choice"]'));
    assert.equal(await page.locator("#folder-job-recipe option:checked").textContent(), "Shared look · version 2", "deleting the library entry keeps the frozen folder choice visible");
    await page.locator("#folder-job-format").selectOption("jpeg");
    await waitForAsync(page, async () => (await (await import("./src/jobs/store.js")).listLargeJobs())[0]?.format === "jpeg");
    const desktopViewport = page.viewportSize();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator("#folder-job-format").scrollIntoViewIfNeeded();
    const mobileFormat = await page.locator("#folder-job-format").evaluate((element) => { const rect = element.getBoundingClientRect(); return { height: rect.height, fits: rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth }; });
    assert.equal(mobileFormat.fits, true, "the folder output format stays within a phone viewport");
    assert.ok(mobileFormat.height >= 44, `mobile output format target height: ${mobileFormat.height}`);
    await page.setViewportSize(desktopViewport);
    assert.match(await page.locator("#folder-job-recipe-summary").textContent(), /JPEG$/, "the job summary reflects its independent output format");
    await page.locator("#folder-job-output-button").click(); await page.waitForFunction(() => !document.querySelector("#folder-job-start-button").disabled);
    assert.equal(await page.locator("#folder-job-format").isDisabled(), true, "choosing a destination freezes the job format");
    await page.locator("#folder-job-start-button").click(); await page.waitForFunction(() => document.querySelector("#folder-job-status").textContent.startsWith("Complete."));
    const folder = await page.evaluate(async (source) => {
      const job = (await (await import("./src/jobs/store.js")).listLargeJobs())[0], { createPillowEngine } = await import("./src/engine/pillow.js"), { settingsForLargeJob } = await import("./src/jobs/core.js");
      const expected = await (await createPillowEngine()).render({ name: "photo.png", bytes: new Uint8Array(source) }, settingsForLargeJob(job.recipe, job.format));
      const files = [], names = []; for await (const [name, handle] of job.outputHandle.entries()) if (handle.kind === "file") { names.push(name); files.push([...new Uint8Array(await (await handle.getFile()).arrayBuffer())]); }
      return { files, names, expected: [...expected.bytes], revision: job.recipe.style.revision, format: job.format, recipeFormat: job.recipe.style.recipe.operations.format };
    }, bytes);
    assert.equal(folder.revision, 2); assert.equal(folder.format, "jpeg"); assert.deepEqual(folder.files, [folder.expected], "the deleted library recipe's frozen revision and job format render through the folder worker");
    assert.equal(folder.recipeFormat, "png", "a job-specific choice does not mutate its saved recipe revision");
    assert.match(folder.names[0], /\.(?:jpg|jpeg)$/i);
    await waitForAsync(page, async () => {
      const saved = await (await import("./src/session.js")).readSession();
      return saved?.recipeReferences?.items[saved.batch.files[0].id] === '["revision-choice",2]';
    });
    await page.reload(); await page.waitForFunction(() => !document.querySelector("#session-recovery").hidden);
    await page.getByRole("button", { name: "Restore", exact: true }).click(); await ready();
    assert.deepEqual(await outputs(), mixed, "reloading after library removal preserves both applied revisions and exact output bytes");
    const saved = await page.evaluate(async () => (await (await import("./src/session.js")).readSession()));
    assert.deepEqual(saved.frozenRecipes.filter((recipe) => recipe.id === "revision-choice").map((recipe) => recipe.style.revision).sort(), [1, 2]);

    // Unknown or incomplete revision references must never fall back to a live
    // library recipe, even if the ID would still be resolvable there.
    const fence = await page.evaluate(async () => {
      const { readRecoveryProject, writeRecoveryProject } = await import("./src/project/storage.js");
      const saved = await readRecoveryProject("active");
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open("tiny-image-star.projects", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const read = () => new Promise((resolve, reject) => { const tx = db.transaction("records", "readonly"), request = tx.objectStore("records").get("active"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const original = await read(), broken = structuredClone(original); broken.session.recipeReferences.shared = '["revision-choice",999]';
      await new Promise((resolve, reject) => { const tx = db.transaction("records", "readwrite"); tx.objectStore("records").put(broken, "active"); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      let readError, writeError; try { await readRecoveryProject("active"); } catch (error) { readError = error.message; }
      try { await writeRecoveryProject({ ...saved, projectRevision: saved.projectRevision + 1 }, "active"); } catch (error) { writeError = error.message; }
      const unchanged = JSON.stringify(await read()) === JSON.stringify(broken); db.close(); return { version: original.version, readError, writeError, unchanged };
    });
    assert.equal(fence.version, 2); assert.match(fence.readError, /missing/); assert.match(fence.writeError, /missing/); assert.equal(fence.unchanged, true);
    await page.evaluate(async () => (await import("./src/local-data.js")).clearStoredLocalData());
    assert.deepEqual(await outputs(), mixed, "clearing saved data leaves recipes and manual corrections in the open image set intact");
    await page.getByRole("button", { name: "Back to editor", exact: true }).click();
    await page.locator("#tray-scope-select").selectOption("selected");
    await selectRecipeRevision(page, "#tray-preset-picker", "revision-choice", 1); await ready();
    assert.deepEqual(await outputs(), firstVersion, "selected-scope revision changes preserve the independent manual correction");
    await page.waitForFunction(() => !document.querySelector("#save-button").disabled);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForFunction(() => document.documentElement.dataset.mobileLayout === "true");
    await page.locator("#mobile-batch-settings").click();
    await page.locator("#tray-preset-picker").waitFor({ state: "visible" });
    const phone = await page.locator("#tray-preset-picker").evaluate((element) => { const rect = element.getBoundingClientRect(); return { height: rect.height, fits: rect.left >= 0 && rect.right <= innerWidth }; });
    assert.equal(phone.fits, true); assert.ok(phone.height >= 44, `mobile recipe target height: ${phone.height}`);
    if (process.env.TINY_IMAGE_STAR_SELECTION_ARTIFACTS) {
      await mkdir("docs/research/2026-09-17", { recursive: true });
      await page.screenshot({ path: "docs/research/2026-09-17/recipe-version-phone.png" });
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    assert.equal(await page.locator("#mobile-batch-sheet").evaluate((element) => element.scrollWidth <= element.clientWidth), true, "recipe selection stays within the sheet at 200% text");
    assert.deepEqual(errors, []);
    console.log("  recipe selections: mixed revisions of one ID, preserved manual correction, exact reload after library removal, frozen folder labels/output and corrupt-reference fences");
  } catch (error) {
    console.error("recipe selection state", await page.evaluate(() => ({ status: document.querySelector("#batch-status").textContent, folder: document.querySelector("#folder-job-status").textContent, recovery: document.querySelector("#session-recovery-message").textContent })), errors); throw error;
  } finally { await context.close(); }
  await assertLegacySelectionRecovery(browser, origin);
}

async function assertLegacySelectionRecovery(browser, origin) {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    await page.goto(origin); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
    const original = await page.evaluate(async () => {
      const { buildSessionSnapshot } = await import("./src/session.js"), { writeRecoveryProject } = await import("./src/project/storage.js");
      const canvas = new OffscreenCanvas(8, 6); canvas.getContext("2d").fillRect(0, 0, 8, 6);
      const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()), recipe = { id: "legacy-selection", name: "Original selection", operations: { format: "png", brightness: .7 } };
      const batch = { projectId: "old-selection-project", projectRevision: 1, projectCreatedAt: 1, presetId: recipe.id,
        activeId: "old-file", selected: new Set(["old-file"]), files: [{ id: "old-file", name: "old.png", width: 8, height: 6, bytes, presetOverride: null }] };
      const snapshot = buildSessionSnapshot({ batch, activePresetId: recipe.id, recipes: [recipe], operationsForItem: () => ({ ...recipe.operations, resizeWidth: 8, resizeHeight: 6 }) }).snapshot;
      await writeRecoveryProject(snapshot, "active");
      const db = await new Promise((resolve) => { const request = indexedDB.open("tiny-image-star.projects", 1); request.onsuccess = () => resolve(request.result); });
      const record = await new Promise((resolve) => { const request = db.transaction("records", "readonly").objectStore("records").get("active"); request.onsuccess = () => resolve(request.result); }); db.close(); return record;
    });
    assert.equal(original.version, 1);
    await page.reload(); await page.getByRole("button", { name: "Restore", exact: true }).click();
    await waitForAsync(page, async () => (await (await import("./src/session.js")).readSession())?.recipeReferences?.shared === '["legacy-selection",null]');
    const upgrade = await page.evaluate(async () => {
      const db = await new Promise((resolve) => { const request = indexedDB.open("tiny-image-star.projects", 1); request.onsuccess = () => resolve(request.result); });
      const entries = await new Promise((resolve) => { const request = db.transaction("records", "readonly").objectStore("records").getAll(); request.onsuccess = () => resolve(request.result); }); db.close();
      return { current: entries.find((entry) => entry.version === 2), archive: entries.find((entry) => entry.archiveOf === "active") };
    });
    assert.ok(upgrade.current); assert.deepEqual(upgrade.archive, { ...original, archiveOf: "active" }, "the reference migration archives the complete original record atomically");
    assert.equal(upgrade.current.session.frozenRecipes[0].name, "Original selection");
    console.log("  recipe recovery upgrade: version-one ID selections retain frozen settings and archive their exact original before version-two recovery");
  } finally { await context.close(); }
}
