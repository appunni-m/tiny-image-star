import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export async function assertDesignWorkspace(browser, address) {
  const image = Buffer.from((await readFile(join(projectRoot, "tests/fixtures/rgb-small.png.base64"), "utf8")).trim(), "base64");
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__tinystarTestDelayWorkers = false;
    const NativeWorker = window.Worker;
    window.Worker = class DelayedWorker extends NativeWorker {
      postMessage(message, transfer) {
        if (!window.__tinystarTestDelayWorkers) return super.postMessage(message, transfer);
        setTimeout(() => super.postMessage(message, transfer), 700);
      }
    };
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
  try {
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    try { await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready", null, { timeout: 15000 }); }
    catch (error) {
      console.error("design workspace startup", await page.evaluate(() => ({
        status: document.querySelector("#engine-status")?.textContent, scripts: [...document.scripts].map((script) => script.src),
        designButton: Boolean(document.querySelector("#design-button")), bridge: Boolean(window.tinyImageStarEditor),
      })), pageErrors);
      throw error;
    }
    await page.locator("#design-button").click();
    await page.locator("#design-file-input").setInputFiles([
      { name: "first.png", mimeType: "image/png", buffer: image },
      { name: "second.png", mimeType: "image/png", buffer: image },
    ]);
    await page.waitForFunction(() => document.querySelector("#design-layer-count")?.textContent === "2");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const initial = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(initial.pages.length, 1);
    assert.equal(initial.selection.length, 2, "new images are selected together in the shared page");
    const selectedId = initial.pages[0].nodeIds.at(-1), sourceId = initial.nodes[selectedId].assetId;
    assert.equal(initial.retainedSourceBytes, image.byteLength * 2, "original encoded sources stay retained in the workspace");

    await page.locator("#design-layer-list .design-layer-select").first().click();
    await page.waitForFunction(() => window.tinyImageStarDesign.getSnapshot().selection.length === 1);
    const before = await page.locator("#design-canvas").evaluate((canvas) => canvas.toDataURL());
    await page.locator("#design-brightness").evaluate((input) => {
      input.value = "1.5"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const after = await page.locator("#design-canvas").evaluate((canvas) => canvas.toDataURL());
    assert.notEqual(after, before, "image adjustment updates the same in-place page preview");
    const edited = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id], selectedId);
    assert.equal(edited.id, selectedId, "preview edits retain the same layer identity");
    assert.equal(edited.assetId, sourceId, "preview edits retain the same original source asset");
    assert.equal(edited.appearance.brightness, 1.5);

    await page.locator("#design-add-text").click();
    await page.locator("#design-add-rectangle").click();
    const withObjects = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.deepEqual(withObjects.pages[0].nodeIds.map((id) => withObjects.nodes[id].kind), ["image", "image", "text", "shape"]);
    assert.equal(await page.locator("#design-canvas").isVisible(), true);
    assert.equal(await page.locator("#design-inspector").isVisible(), true);

    await page.locator(`#design-layer-list [data-layer-id="${selectedId}"]`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Save this image as recipe…", exact: true }).click();
    assert.equal(await page.locator("#preset-dialog-heading").textContent(), "Save design image recipe");
    await page.locator("#preset-name-input").fill("Design recipe smoke");
    await page.locator("#preset-save-button").click();
    await page.waitForFunction(() => !document.querySelector("#preset-dialog")?.open);
    await page.evaluate(() => {
      window.__tinystarTestDelayWorkers = true;
      const mode = document.querySelector("#processing-mode-select");
      mode.value = "low-resource"; mode.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator("#design-canvas").press("Control+a");
    await page.locator(`#design-layer-list [data-layer-id="${selectedId}"]`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Design recipe smoke", exact: true }).click();
    await page.locator("#design-recipe-job").waitFor({ state: "visible" });
    await page.locator("#design-recipe-job-pause").click();
    await page.waitForFunction(() => document.querySelector("#design-recipe-job-pause")?.textContent === "Resume");
    await page.locator("#design-recipe-job-speed").selectOption("max-speed");
    await page.waitForFunction(() => document.querySelector("#batch-job-speed")?.value === "max-speed");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector("#design-canvas")?.getBoundingClientRect().width > 0);
    const mobile = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      layout: document.querySelector("#design-view").scrollWidth,
      canvas: document.querySelector("#design-canvas").getBoundingClientRect().toJSON(),
      buttons: [...document.querySelectorAll(".design-toolbar-actions .button, #design-layer-list button, #design-inspector .button")]
        .filter((button) => !button.hidden && button.getClientRects().length).map((button) => button.getBoundingClientRect().height),
    }));
    assert.ok(mobile.layout <= mobile.viewport + 1, "mobile design workspace has no horizontal page overflow");
    assert.ok(mobile.canvas.width >= 280 && mobile.canvas.height >= 180, "mobile canvas retains a useful editing area");
    assert.ok(mobile.buttons.every((height) => height >= 43), `mobile layer and editing actions remain touch sized: ${JSON.stringify(mobile.buttons)}`);
    const mobileJob = await page.evaluate(() => {
      const bar = document.querySelector("#design-recipe-job"), bounds = bar.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, width: innerWidth,
        controls: [...bar.querySelectorAll("button, select")].map((node) => ({ left: node.getBoundingClientRect().left,
          right: node.getBoundingClientRect().right, height: node.getBoundingClientRect().height })) };
    });
    assert.ok(mobileJob.left >= 0 && mobileJob.right <= mobileJob.width, "the in-place recipe bar fits a phone viewport");
    assert.ok(mobileJob.controls.every((control) => control.left >= 0 && control.right <= mobileJob.width && control.height >= 40), "recipe controls remain usable by touch");
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = false; });
    await page.locator("#design-recipe-job-pause").click();
    await page.locator("#design-recipe-job").waitFor({ state: "hidden" });
    const recipeApplied = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    const imageNodes = recipeApplied.pages[0].nodeIds.map((id) => recipeApplied.nodes[id]).filter((node) => node.kind === "image");
    assert.equal(imageNodes.length, 2);
    assert.ok(imageNodes.every((node) => node.appearance.brightness === 1.5), "saved photo recipe applies to the selected image layers in place");

    await page.locator("#mobile-more-button").click();
    await page.locator("#design-button").click();
    await page.waitForFunction(() => !document.querySelector("#mobile-more-sheet")?.open && !document.querySelector("#design-view")?.hidden);
    await page.locator("#design-new-page").click();
    await page.waitForFunction(() => window.tinyImageStarDesign.getSnapshot().pages.length === 2);
    const pages = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot().pages.map((entry) => entry.name));
    assert.deepEqual(pages, ["Page 1", "Page 2"]);
    await page.locator("#design-document-name").fill("Mobile Figma draft");
    await page.locator("#design-document-name").press("Enter");
    await page.waitForFunction(() => document.querySelector("#design-save-status")?.textContent === "Saved on this device");
    const saved = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(saved.savedRevision, saved.revision, "design document and original image assets are autosaved locally");

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.tinyImageStarDesign.getSnapshot()?.name === "Mobile Figma draft");
    const reopened = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(reopened.pages.length, 2, "saved pages reopen after a browser reload");
    assert.equal(reopened.pages[0].nodeIds.length, 4, "saved image, text and shape layers reopen together");
    assert.equal(reopened.retainedSourceBytes, image.byteLength * 2, "reopen retains the original encoded image sources");
    await page.locator("#mobile-more-button").click();
    await page.locator("#design-button").click();
    await page.locator("#design-canvas").press("Control+a");
    await page.locator("#design-canvas").press("Backspace");
    await page.waitForFunction(() => window.tinyImageStarDesign.getSnapshot()?.pages[0].nodeIds.length === 0);
    const bulkDeleted = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.deepEqual(Object.keys(bulkDeleted.nodes), [], "keyboard bulk delete removes the whole canvas selection atomically");
    console.log("  design workspace: retained sources, in-place photo recipes, live WASM job speed/pause bar, autosave/reopen, multi-delete and phone layout");
  } finally { await context.close(); }
}
