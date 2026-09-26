import assert from "node:assert/strict";
import { waitForAsync } from "./helpers/wait-for-async.mjs";

async function seed(page, { raw = false, current = true, unsupported = false } = {}) {
  await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
  return page.evaluate(async ({ raw, current, unsupported }) => {
    const { createPillowEngine } = await import("./src/engine/pillow.js"), { createTextLayer } = await import("./src/compositor/text.js");
    const { hashAsset, writeRecoveryProject } = await import("./src/project/storage.js");
    const { readRecipeCatalog, mutateRecipeCatalog } = await import("./src/styles/catalog.js"), { recipeCommand } = await import("./src/styles/catalog-model.js");
    const operations = { crop: { x: 5, y: 3, width: 34, height: 25 }, rotation: 90, flipX: true, flipY: false, resizeWidth: 34, resizeHeight: 25,
      resizeMode: "fit", aspectLocked: true, brightness: .7, contrast: 1.2, grayscale: false, textLayers: [{ ...createTextLayer(), id: "old-caption", text: "Private", fontSize: .14 }], lossy: false, quality: 95, format: "png" };
    const files = [], expected = [], engine = await createPillowEngine();
    for (const [index, [width, height]] of [[58, 42], [42, 58]].entries()) {
      const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext("2d"), gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#ff5522"); gradient.addColorStop(1, "#2266dd"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#ffaa44"; ctx.fillRect(4, 7, 15, 10);
      const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer()), id = `old-${index}`;
      const config = { ...structuredClone(operations), flipX: index === 0, crop: index ? null : operations.crop, textLayers: index ? [] : operations.textLayers };
      files.push({ id, name: `${id}.png`, type: "image/png", lastModified: 1, bytes: bytes.buffer, width, height,
        override: index ? null : { flipX: true }, presetOverride: null, ...(!raw ? { resolvedOperations: config } : {}) });
      expected.push(await hashAsset((await engine.render({ name: `${id}.png`, bytes }, config)).bytes));
    }
    const record = { version: 1, savedAt: 10, activePresetId: "lost-recipe", batch: { presetId: "lost-recipe", recipeScope: "this", sharedOverride: null,
      formatOverride: unsupported === "compression" ? "jpeg" : unsupported ? "avif" : null,
      lossyOverride: unsupported === "compression" ? true : null, qualityOverride: unsupported === "compression" ? 80 : null,
      activeId: files[0].id, selected: files.map((file) => file.id), selectionTouched: false, files } };
    if (current) {
      const catalog = await readRecipeCatalog();
      await mutateRecipeCatalog(recipeCommand(catalog, "put", { id: "lost-recipe", name: "Changed current recipe", operations: { ...operations, crop: null, flipX: false, textLayers: [], brightness: 1.3 } }, null));
    }
    if (raw) {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open("tiny-image-star.session", 1); request.onupgradeneeded = () => request.result.createObjectStore("snapshots"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await new Promise((resolve, reject) => { const tx = db.transaction("snapshots", "readwrite"); tx.objectStore("snapshots").put(record, "active"); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
    } else await writeRecoveryProject(record, "active");
    return { expected, record };
  }, { raw, current, unsupported });
}

async function hashes(page) {
  return page.evaluate(async () => {
    const { hashAsset } = await import("./src/project/storage.js");
    return Promise.all([...document.querySelectorAll(".batch-card")].map(async (card) => {
      const image = card.querySelectorAll(".batch-card-compare img")[1];
      return image ? hashAsset(await (await fetch(image.src)).arrayBuffer()) : null;
    }));
  });
}
async function saved(page) { return page.evaluate(async () => (await import("./src/session.js")).readSession()); }
async function restored(page) {
  await page.waitForFunction(() => document.querySelector("#batch-status").textContent.includes("Ready — 2 previews"));
  await waitForAsync(page, async () => Boolean((await (await import("./src/session.js")).readSession())?.recipeReferences));
}

export async function assertHistoricalRecovery(browser, origin) {
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(origin); console.log("  historical recovery: seeding saved operations"); const baseline = await seed(page);
    console.log("  historical recovery: restoring saved operations");
    await page.reload(); await page.locator("#session-restore-button").click(); await restored(page);
    assert.deepEqual(await hashes(page), baseline.expected, "complete saved operations, including crop, rotation, caption and manual flip, render identically after the library changed");
    const first = await saved(page), recovered = first.frozenRecipes.filter((recipe) => recipe.recovery);
    assert.equal(recovered.length, 2);
    assert.equal(recovered[0].operations.crop.width, 34);
    assert.equal(first.batch.files[0].override.flipX, true);
    assert.equal(first.batch.qualityOverride, null, "absence of a quality override is not rewritten as zero or one");
    assert.ok(await page.locator("#tray-preset-picker option:checked").getAttribute("disabled") !== null, "source-specific recovered settings cannot be applied to other photos");
    assert.equal(await page.locator("#folder-job-recipe option").evaluateAll((options) => options.some((option) => option.textContent.includes("Recovered edits"))), false);
    await page.evaluate(async () => {
      const { readRecipeCatalog, mutateRecipeCatalog } = await import("./src/styles/catalog.js"), { recipeCommand } = await import("./src/styles/catalog-model.js");
      const catalog = await readRecipeCatalog(), entry = catalog.entries.find((entry) => entry.id === "lost-recipe");
      await mutateRecipeCatalog(recipeCommand(catalog, "delete", entry.id, entry.token));
    });
    await page.reload(); await page.locator("#session-restore-button").click(); await restored(page);
    assert.deepEqual(await hashes(page), baseline.expected, "second reload after deleting the library keeps the exact recovered state");
    const second = await saved(page); assert.deepEqual(second.recipeReferences, first.recipeReferences);
    await page.locator(".batch-card").first().locator("summary").click();
    await page.locator(".batch-card").first().getByRole("button", { name: "Edit on canvas", exact: true }).click();
    await page.locator("#flip-horizontal").click();
    await waitForAsync(page, async () => (await (await import("./src/session.js")).readSession())?.batch.files[0].override?.flipX === false);
    await page.locator("#batch-button").click(); await page.locator(".batch-card").first().locator("summary").click();
    await page.locator(".batch-card").first().getByRole("button", { name: "Reset to recovered edits", exact: true }).click();
    await waitForAsync(page, async (hash) => {
      const image = document.querySelector(".batch-card")?.querySelectorAll(".batch-card-compare img")[1];
      return image && await (await import("./src/project/storage.js")).hashAsset(await (await fetch(image.src)).arrayBuffer()) === hash;
    }, baseline.expected[0]);
    await page.locator("#batch-close-button").click();
    const neutralKey = await page.locator('#tray-preset-picker option[data-recipe-id="keep-original"]').last().getAttribute("value");
    await page.locator("#tray-preset-picker").selectOption(neutralKey);
    await waitForAsync(page, async () => {
      const record = await (await import("./src/session.js")).readSession();
      return record?.batch.files[0].presetOverride === "keep-original" || record?.recipeReferences?.items[record.batch.files[0].id] === null;
    });
    assert.equal((await saved(page)).batch.files[0].override.flipX, true, "explicit replacement keeps the known original manual correction");
    assert.equal((await hashes(page))[1], baseline.expected[1], "replacing this photo's recipe leaves the second recovered image unchanged");
    const archives = await page.evaluate(async () => {
      const db = await new Promise((resolve) => { const request = indexedDB.open("tiny-image-star.projects", 1); request.onsuccess = () => resolve(request.result); });
      const records = await new Promise((resolve) => { const request = db.transaction("records", "readonly").objectStore("records").getAll(); request.onsuccess = () => resolve(request.result); }); db.close(); return records.filter((record) => record.archiveOf === "active");
    });
    assert.equal(archives.length, 1); assert.equal(archives[0].version, 1);
    assert.equal(archives[0].session.activePresetId, "lost-recipe");
    assert.equal(archives[0].session.recipeReferences, undefined);
    assert.deepEqual(errors, []);
    console.log("  historical recovery: actual saved edits survive changed/deleted recipes, reset and per-image replacement; original schema archived");
  } catch (error) {
    console.error("Historical recovery browser state:", await page.evaluate(() => ({ recovery: document.querySelector("#session-recovery")?.textContent, status: document.querySelector("#batch-status")?.textContent, engine: document.querySelector("#engine-status")?.textContent })), errors);
    throw error;
  } finally { await context.close(); }

  for (const choice of ["current", "originals"]) {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true }), page = await context.newPage();
    page.setDefaultTimeout(15000);
    try {
      await page.goto(origin); await seed(page, { raw: true, current: choice === "current" });
      await page.reload(); await page.locator("#session-restore-button").click();
      await page.locator("#session-originals-button").waitFor({ state: "visible" });
      assert.match(await page.locator("#session-recovery-message").textContent(), /cannot be reconstructed exactly/);
      assert.equal(await page.locator("#session-current-recipes-button").isEnabled(), choice === "current");
      await page.waitForFunction(() => document.documentElement.dataset.mobileLayout === "true");
      await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
      const layout = await page.locator("#session-recovery").evaluate((banner) => ({ width: banner.clientWidth, scrollWidth: banner.scrollWidth,
        heights: [...banner.querySelectorAll("button:not([hidden])")].map((button) => button.getBoundingClientRect().height) }));
      assert.ok(layout.scrollWidth <= layout.width + 1, "phone recovery choices fit at 200% text size");
      assert.ok(layout.heights.every((height) => height >= 44), "recovery choices have reachable touch targets");
      if (process.env.TINY_IMAGE_STAR_RECOVERY_ARTIFACTS && choice === "current") await page.screenshot({ path: "docs/research/2026-09-17/historical-recovery-phone.png", fullPage: true });
      await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
      assert.equal((await saved(page)).recipeReferences, undefined, "the decision prompt does not overwrite the old raw record");
      await page.locator("#session-backup-button").click(); await page.locator("#local-data-dialog").waitFor({ state: "visible" });
      await page.locator("#local-data-close-button").click();
      await page.locator(choice === "current" ? "#session-current-recipes-button" : "#session-originals-button").click(); await restored(page);
      const recovered = await saved(page);
      assert.equal(recovered.batch.presetId, choice === "current" ? "lost-recipe" : "keep-original");
      assert.equal(recovered.batch.files[0].override.flipX, true);
      const raw = await page.evaluate(async () => (await (await import("./src/session.js")).readLegacySessionBackups()));
      assert.equal(raw.length, 1); assert.equal(raw[0].value.recipeReferences, undefined);
      console.log(`  oldest recovery: explicit ${choice} choice on a phone keeps known corrections and the raw backup`);
    } finally { await context.close(); }
  }

  for (const unsupported of ["avif", "compression"]) {
    const unavailable = await browser.newContext(), tab = await unavailable.newPage();
    tab.setDefaultTimeout(15000);
    try {
      await tab.goto(origin); await seed(tab, { raw: true, current: false, unsupported });
      await tab.reload(); await tab.locator("#session-restore-button").click(); await tab.locator("#session-originals-button").click();
      const message = unsupported === "avif" ? "avif output is unavailable" : "adjustable compression";
      await tab.waitForFunction((message) => document.querySelector("#batch-status").textContent.includes(message), message);
      assert.deepEqual(await hashes(tab), [null, null], "saved unsupported output intent is not silently converted");
      if (unsupported === "avif") assert.equal(await tab.locator("#batch-format-select option:checked").textContent(), "Saved AVIF — unavailable");
      await tab.evaluate(async () => {
        const engine = await (await import("./src/engine/pillow.js")).createPillowEngine();
        window.dispatchEvent(new CustomEvent("tinystar:capabilities", { detail: engine.capabilities }));
      });
      assert.match(await tab.locator("#batch-status").textContent(), new RegExp(message), "a subsequent capability handshake preserves the blocked output request");
      await tab.locator("#batch-format-select").selectOption("png"); await restored(tab);
      assert.ok((await hashes(tab)).every(Boolean), "choosing a supported replacement produces the requested outputs");
      const raw = await tab.evaluate(async () => (await (await import("./src/session.js")).readLegacySessionBackups()));
      assert.equal(raw[0].value.batch.formatOverride, unsupported === "avif" ? "avif" : "jpeg");
      assert.equal(raw[0].value.batch.lossyOverride, unsupported === "compression" ? true : null);
      console.log(`  historical recovery: saved ${unsupported} intent survives capability updates until explicitly replaced`);
    } finally { await unavailable.close(); }
  }
}
