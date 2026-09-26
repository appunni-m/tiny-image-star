import { waitForAsync } from "./helpers/wait-for-async.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";

export async function assertStoryWorkspace(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: ({ files }) => Boolean(files?.length), configurable: true });
    Object.defineProperty(navigator, "share", { value: async ({ files }) => { window.storyShared = { active: navigator.userActivation.isActive, names: files.map((file) => file.name), types: files.map((file) => file.type) }; }, configurable: true });
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ready = () => page.waitForFunction(() => !document.querySelector("#story-export").disabled && document.querySelector("#story-preview").complete, null, { timeout: 90_000 });
  const saved = () => page.waitForFunction(() => document.querySelector("#story-status").textContent === "Saved on this device", null, { timeout: 90_000 });
  const digest = () => page.evaluate(async () => {
    const { hashAsset } = await import("./src/project/storage.js"); return hashAsset(await (await fetch(document.querySelector("#story-preview").src)).arrayBuffer());
  });
  const tool = async (kind) => { await page.locator(`[data-story-tool="${kind}"]`).click();
    if (kind === "look") await page.getByRole("navigation", { name: "Style library", exact: true }).getByRole("button", { name: "Photo looks", exact: true }).click(); };
  const apply = async () => { await page.locator("#story-sheet-apply").click(); await page.waitForFunction(() => !document.querySelector("#story-sheet").open); await ready(); await saved(); };
  const document = () => page.evaluate(async () => {
    const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(); return (await store.readStoryProject(entry.key)).project;
  });
  const setRange = (label, value) => page.getByLabel(label, { exact: true }).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  try {
    await page.goto(origin); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
    const fixtures = await page.evaluate(() => Array.from({ length: 6 }, (_, index) => {
      const canvas = document.createElement("canvas"); canvas.width = index % 2 ? 480 : 640; canvas.height = index % 2 ? 640 : 480;
      const ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
      ctx.fillStyle = ["#f4be91", "#99cad2", "#ebc980", "#bbb1ce", "#b2c0a1", "#f0b9ad"][index]; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff0c9"; ctx.beginPath(); ctx.arc(w * .7, h * .26, w * .11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ["#a57059", "#548584", "#6a8164"][index % 3]; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h * .65); ctx.lineTo(w * .35, h * .4); ctx.lineTo(w, h * .8); ctx.lineTo(w, h); ctx.fill();
      ctx.fillStyle = "#384e50"; ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w * .7, h * .6); ctx.lineTo(w, h * .69); ctx.lineTo(w, h); ctx.fill();
      return canvas.toDataURL("image/png").split(",")[1];
    }));
    await page.locator("#empty-story-button").click(); await page.locator("#story-title").fill("September notes");
    await page.locator("#story-files").setInputFiles(fixtures.map((data, index) => ({ name: `moment-${index + 1}.png`, mimeType: "image/png", buffer: Buffer.from(data, "base64") })));
    await ready(); await saved();
    assert.equal(await page.locator("#story-filmstrip button").count(), 4);
    await page.waitForFunction(() => document.querySelectorAll("#story-filmstrip img").length === 4, null, { timeout: 90_000 });
    assert.equal(await page.locator("#story-intro").isVisible(), false);
    const layout = await page.evaluate(() => {
      const preview = document.querySelector(".story-stage").getBoundingClientRect(), dock = document.querySelector(".story-dock").getBoundingClientRect();
      const root = document.querySelector("#story-workspace");
      return { stage: preview.height, height: innerHeight, dockBottom: dock.bottom, overflow: root.scrollWidth > root.clientWidth,
        buttons: [...root.querySelectorAll(".story-head button, .story-dock button")].map((button) => ({ h: button.getBoundingClientRect().height, w: button.getBoundingClientRect().width })) };
    });
    assert.ok(layout.stage >= layout.height * .55, `story stage occupies ${layout.stage}/${layout.height}`);
    assert.ok(layout.dockBottom <= layout.height); assert.equal(layout.overflow, false);
    assert.ok(layout.buttons.every((button) => button.h >= 44 && button.w >= 44));
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    assert.equal(await page.locator("#story-workspace").evaluate((element) => element.scrollWidth <= element.clientWidth), true, "200% text does not overflow the workspace");
    await tool("text");
    assert.equal(await page.locator("#story-sheet").evaluate((element) => element.scrollWidth <= element.clientWidth), true, "200% text sheet stays within the viewport");
    await page.locator("#story-sheet-cancel").click(); await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    const baseline = await digest();
    for (const fault of ["source read", "scene admission"]) {
      await tool("text");
      await page.evaluate(async (kind) => {
        const target = kind === "source read" ? Blob.prototype : (await import("./src/processing/client.js")).getProcessingScheduler();
        const key = kind === "source read" ? "arrayBuffer" : "enqueue", original = target[key];
        window.restoreStoryFailure = () => { target[key] = original; };
        target[key] = kind === "source read" ? async () => { throw new Error("Injected source read failure"); }
          : () => { throw new Error("Injected scene admission failure"); };
      }, fault);
      try {
        const disabledWhileQueued = await page.getByLabel("Slide caption", { exact: true }).evaluate((input) => {
          input.value = "An unreviewed change"; input.dispatchEvent(new Event("input", { bubbles: true })); return document.querySelector("#story-sheet-apply").disabled;
        });
        assert.equal(disabledWhileQueued, true, "Apply waits for the current preview, including its queued phase");
        await page.getByRole("button", { name: "Retry preview", exact: true }).waitFor();
        assert.equal(await page.locator("#story-sheet-apply").isDisabled(), true);
        assert.match(await page.locator("#story-sheet-preview-status").innerText(), new RegExp(`Injected ${fault} failure`));
        const stored = await document();
        assert.equal(stored.nodes[`${stored.slides[0].id}:caption`].text, "September notes", "failed preview never becomes a saved edit");
      } finally { await page.evaluate(() => { window.restoreStoryFailure(); delete window.restoreStoryFailure; }); }
      await page.getByRole("button", { name: "Retry preview", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled);
      await page.locator("#story-sheet-cancel").click(); await ready(); await saved(); assert.equal(await digest(), baseline, `${fault}: retry followed by cancel restores the original scene`);
    }
    await tool("text"); await page.getByLabel("Slide caption", { exact: true }).fill("September mornings"); await apply();
    const caption = await digest(); assert.notEqual(caption, baseline);
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), baseline);
    await page.locator("#story-redo").click(); await ready(); await saved(); assert.equal(await digest(), caption);

    // Styles are separate, bounded parameter files; library mutations do not
    // implicitly commit a scene preview or erase copies already in projects.
    await tool("look"); await page.waitForFunction(() => document.querySelectorAll(".story-looks img").length === 3, null, { timeout: 90_000 });
    if (process.env.TINY_IMAGE_STAR_STORY_ARTIFACTS) {
      await page.waitForFunction(() => [...document.querySelectorAll(".story-looks img")].every((image) => image.complete && image.naturalWidth > 0));
      const directory = new URL("../docs/research/2026-09-17/", import.meta.url); await mkdir(directory, { recursive: true });
      await page.screenshot({ path: new URL("story-styles-phone.png", directory).pathname });
    }
    const styleTabs = page.getByRole("navigation", { name: "Style library", exact: true });
    await page.getByRole("button", { name: "Favorite Film diary", exact: true }).click();
    await page.getByRole("button", { name: "Unfavorite Film diary", exact: true }).waitFor();
    await styleTabs.getByRole("button", { name: "Saved", exact: true }).click();
    await page.getByLabel("Saved style filter", { exact: true }).selectOption("favorites");
    assert.equal(await page.locator(".story-style-card").count(), 1);
    await styleTabs.getByRole("button", { name: "Photo looks", exact: true }).click();
    await page.locator('[data-look="film-diary"]').click();
    await page.getByRole("button", { name: "Save my style", exact: true }).click();
    await page.getByLabel("Style name", { exact: true }).fill("Pocket prints");
    await page.getByLabel("Include Layout", { exact: true }).check(); await page.getByLabel("Include Output", { exact: true }).check();
    await page.getByRole("button", { name: "Save style", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".story-style-form").hidden);
    const savedStyle = await page.evaluate(async () => (await (await import("./src/styles/store.js")).readStyleLibrary()).records.find((record) => record.style.name === "Pocket prints"));
    assert.equal(savedStyle.lastUsed, 0, "saving a style is not committing it");
    const styleCard = () => page.locator("[data-style-key]").filter({ hasText: "Pocket prints" });
    await styleCard().click();
    const styleDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Export style", exact: true }).click();
    const downloadedStyle = await styleDownload; assert.equal(downloadedStyle.suggestedFilename(), "pocket-prints.tstyle");
    const styleFile = await readFile(await downloadedStyle.path(), "utf8"), sharedStyle = JSON.parse(styleFile);
    assert.deepEqual(sharedStyle, savedStyle.style);
    for (const secret of ["September notes", "September mornings", '"crop"', '"maskId"', '"assetId"', '"nodeIds"']) assert.equal(styleFile.includes(secret), false, secret);
    await page.getByRole("button", { name: "Remove Pocket prints", exact: true }).click();
    await page.getByLabel("Import style file", { exact: true }).setInputFiles({ name: "shared.tstyle", mimeType: "application/json", buffer: Buffer.from(styleFile) });
    await styleCard().waitFor(); await styleCard().click(); await apply();
    const customDigest = await digest(); assert.notEqual(customDigest, caption);
    const withStyle = await document(); assert.deepEqual(withStyle.recipe.style.definition, sharedStyle);
    await tool("look"); await styleTabs.getByRole("button", { name: "Recent", exact: true }).click(); await styleCard().waitFor();
    await styleTabs.getByRole("button", { name: "Saved", exact: true }).click();
    await page.getByRole("button", { name: "Remove Pocket prints", exact: true }).click();
    await page.locator("#story-sheet-cancel").click(); await ready(); await saved();
    assert.equal(await digest(), customDigest, "library deletion leaves the applied project copy intact");
    assert.deepEqual((await document()).recipe.style.definition, sharedStyle);
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), caption, "one undo removes the complete multi-component style");
    await tool("look");
    await page.getByLabel("Import style file", { exact: true }).setInputFiles({ name: "too-large.tstyle", mimeType: "application/json", buffer: Buffer.alloc(32769, 32) });
    await page.getByText(/Import stopped: Style files must be 32 KiB/).waitFor();
    const unavailable = { ...sharedStyle, id: "style-missing-model", name: "Needs a cutout model", requires: [...sharedStyle.requires, "portrait-segmentation-v99"] };
    await page.getByLabel("Import style file", { exact: true }).setInputFiles({ name: "missing-model.tstyle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(unavailable)) });
    const unavailableCard = page.locator("[data-style-key]").filter({ hasText: "Needs a cutout model" }); await unavailableCard.waitFor();
    assert.equal(await unavailableCard.isDisabled(), true); assert.match(await unavailableCard.innerText(), /Unavailable requirement/);
    await page.locator("#story-sheet-cancel").click(); await ready(); await saved(); assert.equal(await digest(), caption);
    await page.evaluate(async (style) => {
      const store = await import("./src/styles/store.js");
      for (let index = 0; index < 18; index++) await store.putStyle({ ...style, id: `style-scroll-${index}`, name: `Saved look ${index}` });
    }, sharedStyle);
    await waitForAsync(page, async () => { const state = (await import("./src/processing/client.js")).getProcessingScheduler().snapshot(); return state.active === 0 && state.queued === 0; });
    const beforeLibraryBytes = await page.evaluate(async () => (await import("./src/processing/client.js")).getProcessingScheduler().snapshot().retainedBytes);
    await tool("look"); await styleTabs.getByRole("button", { name: "Saved", exact: true }).click();
    await page.getByLabel("Saved style filter", { exact: true }).selectOption("custom");
    await page.waitForFunction(() => document.querySelectorAll(".story-style-card").length === 12 && document.querySelectorAll(".story-looks img").length >= 3);
    assert.ok(await page.locator(".story-looks img").count() <= 9, "only nearby cards retain decoded thumbnails");
    await page.locator(".story-style-card").nth(11).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll(".story-style-card")[11].querySelector("img"));
    assert.equal(await page.locator(".story-style-card").first().locator("img").count(), 0, "offscreen cards release their thumbnails");
    await page.getByRole("button", { name: "Show more styles", exact: true }).click(); assert.equal(await page.locator(".story-style-card").count(), 18);
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    assert.equal(await page.locator("#story-sheet").evaluate((element) => element.scrollWidth <= element.clientWidth), true, "saved styles remain within the viewport at 200% text");
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await page.locator("#story-sheet-cancel").click(); await ready(); await saved();
    const afterLibraryBytes = await page.evaluate(async () => (await import("./src/processing/client.js")).getProcessingScheduler().snapshot().retainedBytes);
    assert.equal(afterLibraryBytes, beforeLibraryBytes, "closing the library releases all retained look previews");

    await tool("look"); await page.waitForFunction(() => document.querySelectorAll(".story-looks img").length === 3, null, { timeout: 90_000 });
    await page.locator('[data-look="film-diary"]').click();
    await page.waitForFunction(() => document.querySelector('[data-look="film-diary"]').getAttribute("aria-pressed") === "true");
    await page.locator("#story-sheet-cancel").click(); await ready(); await saved(); assert.equal(await digest(), caption, "cancel restores the pre-sheet scene");
    await tool("look"); await page.locator('[data-look="film-diary"]').click(); await page.locator('[data-look="clean"]').click(); await page.locator('[data-look="film-diary"]').click(); await apply();
    assert.notEqual(await digest(), caption); await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), caption, "several look previews commit one undo step");
    await tool("adjust"); await setRange("Brightness", 1.4); await apply();
    await tool("look"); await page.getByLabel("Look scope", { exact: true }).selectOption("this"); await page.locator('[data-look="film-diary"]').click(); await apply();
    const scopedStyle = await document(), scopedPhotoId = scopedStyle.slides[0].nodeIds.find((id) => id.endsWith(":photo-0"));
    assert.equal(scopedStyle.nodes[scopedPhotoId].appearance.brightness, 1.4, "scoped preset keeps the manual color correction");
    assert.equal(scopedStyle.nodes[scopedPhotoId].appearanceBase.saturation, .76);
    await tool("adjust"); assert.equal(await page.getByLabel("Contrast", { exact: true }).inputValue(), "0.9", "controls show the resolved scoped look");
    await page.getByRole("button", { name: "Use the story look", exact: true }).click(); await apply();
    const resetLook = await document(); assert.equal(resetLook.nodes[scopedPhotoId].appearanceBase, undefined); assert.equal(resetLook.nodes[scopedPhotoId].appearance, undefined);
    for (let index = 0; index < 3; index++) { await page.locator("#story-undo").click(); await ready(); await saved(); }
    assert.equal(await digest(), caption, "each scope/correction/reset action remains individually reversible");

    const beforeReplacement = await document();
    const photoId = beforeReplacement.slides[0].nodeIds.find((id) => id.endsWith(":photo-0"));
    await tool("photos"); await page.getByLabel("Source photo", { exact: true }).selectOption({ index: 1 }); await apply();
    assert.notEqual(await digest(), caption);
    const afterReplacement = await document();
    assert.notDeepEqual(afterReplacement.nodes[photoId].variantFrames, beforeReplacement.nodes[photoId].variantFrames, "new source aspect reflows both output frames");
    for (const slide of afterReplacement.slides.slice(1)) for (const id of slide.nodeIds) assert.deepEqual(afterReplacement.nodes[id], beforeReplacement.nodes[id]);
    await tool("photos"); await setRange("Crop zoom", 1.7); await setRange("Frame left / right", .8); await apply();
    const cropped = await document(); assert.ok(cropped.nodes[photoId].crop.width < .6 && cropped.nodes[photoId].crop.x > .3);
    const beforePosition = await digest();
    await tool("layout"); await setRange("Position left / right", .02); await setRange("Print size", 1.2);
    assert.match(await page.locator("[data-layout-note]").innerText(), /overlap or leave the page/); await apply();
    const positioned = await document(), manual = positioned.slides[0].overrides[photoId].variantFrames;
    assert.deepEqual(Object.keys(manual), ["portrait"], "position changes are local to the selected output");
    assert.deepEqual(positioned.nodes[photoId].variantFrames.tall, cropped.nodes[photoId].variantFrames.tall);
    const positionedDigest = await digest(); await page.reload(); await page.locator("#empty-story-button").click();
    await page.locator("#story-library").getByRole("button", { name: "September notes", exact: true }).click(); await ready(); await saved();
    assert.equal(await digest(), positionedDigest, "saved manual frames reopen with identical rendered pixels");
    await tool("layout"); await page.getByLabel("Photo arrangement", { exact: true }).selectOption("stack"); await apply();
    assert.deepEqual((await document()).slides[0].overrides[photoId].variantFrames, manual, "reflow keeps manually adjusted positions");
    await tool("layout"); await page.getByRole("button", { name: "Reset adjusted positions", exact: true }).click();
    await page.locator("#story-sheet-cancel").click(); await ready(); await saved();
    assert.deepEqual((await document()).slides[0].overrides[photoId].variantFrames, manual, "reset can be cancelled");
    await tool("layout"); await page.getByRole("button", { name: "Reset adjusted positions", exact: true }).click(); await apply();
    const reset = await document(); assert.equal(reset.slides[0].overrides[photoId], undefined);
    assert.deepEqual(reset.nodes[photoId].crop, cropped.nodes[photoId].crop, "position reset preserves crop");
    assert.equal(await digest(), beforePosition, "reset returns to the authored layout without losing the photo edit");
    await page.locator("#story-undo").click(); await ready(); await saved();
    assert.deepEqual((await document()).slides[0].overrides[photoId].variantFrames, manual, "one undo restores manual position");
    await page.locator("#story-redo").click(); await ready(); await saved();
    await tool("layout"); await page.getByLabel("Story shape", { exact: true }).selectOption("tall"); await page.locator("#story-sheet-cancel").click(); await ready(); await saved();
    assert.equal(await page.locator("#story-preview").evaluate((image) => image.naturalWidth / image.naturalHeight), .8, "cancel restores the output variant");
    await tool("layout"); await page.getByLabel("Story shape", { exact: true }).selectOption("tall"); await apply();
    const tallDigest = await digest();
    assert.equal(await page.locator("#story-preview").evaluate((image) => image.naturalWidth / image.naturalHeight), 720 / 1280);
    await page.locator("#story-export").click(); await page.getByRole("button", { name: "Prepare files", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".story-exports a").length === 4, null, { timeout: 90_000 });
    const exported = await page.locator(".story-exports a").evaluateAll(async (links) => Promise.all(links.map(async (link) => {
      const blob = await (await fetch(link.href)).blob(), bitmap = await createImageBitmap(blob);
      const value = { name: link.download, width: bitmap.width, height: bitmap.height, type: blob.type }; bitmap.close(); return value;
    })));
    assert.deepEqual(exported.map((entry) => entry.name), [1, 2, 3, 4].map((index) => `september-notes-0${index}.jpg`));
    assert.ok(exported.every((entry) => entry.width === 1080 && entry.height === 1920 && entry.type === "image/jpeg"));
    await page.getByRole("button", { name: "Share all slides", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.storyShared), { active: true, names: exported.map((entry) => entry.name), types: Array(4).fill("image/jpeg") });
    const download = page.waitForEvent("download"); await page.locator(".story-exports a").first().click(); assert.equal((await download).suggestedFilename(), "september-notes-01.jpg");
    await page.locator("#story-sheet-cancel").click();
    await page.waitForFunction(() => document.querySelectorAll("#story-filmstrip img").length === 4, null, { timeout: 90_000 });

    if (process.env.TINY_IMAGE_STAR_STORY_ARTIFACTS) {
      const directory = new URL("../docs/research/2026-09-17/", import.meta.url); await mkdir(directory, { recursive: true });
      await page.screenshot({ path: new URL("story-phone-light.png", directory).pathname });
      await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
      await page.waitForFunction(() => getComputedStyle(document.querySelector("#story-back")).color === "rgb(245, 240, 250)");
      await page.screenshot({ path: new URL("story-phone-dark.png", directory).pathname });
    }
    await tool("text"); await page.getByLabel("Slide caption", { exact: true }).fill("Cancelled with Back");
    await page.goBack(); await page.waitForFunction(() => !document.querySelector("#story-sheet").open); await ready(); await saved();
    assert.equal(await digest(), tallDigest, "browser Back cancels the tool first");
    await page.goBack(); await page.waitForFunction(() => !document.querySelector("#story-workspace").open);
    await page.goBack(); assert.equal(await page.locator("#story-workspace").evaluate((element) => element.open), false, "entries from before reload never reopen stale modals");
    await page.reload(); await page.locator("#empty-story-button").click();
    await page.locator("#story-library").getByRole("button", { name: "September notes", exact: true }).click();
    await ready(); await saved(); assert.equal(await digest(), tallDigest, "story workspace resumes the exact selected variant and edits");

    // A competing writer must surface a usable copy action, not destroy either edit.
    const competitor = await context.newPage(); await competitor.goto(origin);
    await competitor.evaluate(async () => {
      const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(), opened = await store.readStoryProject(entry.key);
      opened.project.revision++; opened.project.nodes[opened.project.slides[0].nodeIds.find((id) => id.endsWith(":caption"))].text = "Another tab's words";
      await store.writeStoryProject(opened.project, { key: opened.key, expectedRevision: opened.revision });
    });
    await tool("text"); await page.getByLabel("Slide caption", { exact: true }).fill("My own words"); await page.locator("#story-sheet-apply").click();
    await page.locator("#story-save-copy").waitFor({ state: "visible" }); await page.locator("#story-save-copy").click(); await ready(); await saved();
    const copies = await page.evaluate(async () => {
      const store = await import("./src/project/storage.js"), entries = await store.listStoryProjects(), captions = [];
      for (const entry of entries) { const opened = await store.readStoryProject(entry.key); captions.push(Object.values(opened.project.nodes).find((node) => node.id.endsWith(":caption")).text); }
      return captions.sort();
    });
    assert.deepEqual(copies, ["Another tab's words", "My own words"]);
    const cleared = await page.evaluate(async () => {
      const { clearStoredLocalData } = await import("./src/local-data.js"), store = await import("./src/project/storage.js");
      const summary = await clearStoredLocalData(); return { count: (await store.listStoryProjects()).length, recoveryCount: summary.recoveryCount,
        styles: (await (await import("./src/styles/store.js")).readStyleBackup()).length, preview: !document.querySelector("#story-preview").hidden };
    });
    assert.deepEqual(cleared, { count: 0, recoveryCount: 0, styles: 0, preview: true }, "local data cleanup includes stories/styles and keeps the open composition usable");
    await competitor.close(); assert.deepEqual(errors, []);
    console.log("  mobile story workspace: favorites/recent/custom styles, bounded lazy previews, safe style files, preserved scoped corrections, crop/reflow/positions, one-step undo, exact recovery, conflict copies, ordered JPEGs and fresh-gesture sharing");
  } catch (failure) {
    console.error("story workspace failure", await page.evaluate(async () => ({ status: document.querySelector("#story-status")?.textContent,
      preview: document.querySelector("#story-preview-message")?.textContent, sheet: document.querySelector("#story-sheet-title")?.textContent,
      open: document.querySelector("#story-workspace")?.open, scheduler: (await import("./src/processing/client.js")).getProcessingScheduler().snapshot() })).catch(() => ({})), errors);
    await page.screenshot({ path: "/tmp/tiny-image-star-story-failure.png" }).catch(() => {});
    throw failure;
  } finally { await context.close(); }
}
