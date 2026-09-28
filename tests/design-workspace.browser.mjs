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
    try { await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready")); }
    catch (error) {
      console.error("design preview startup", await page.evaluate(() => ({ status: document.querySelector("#design-canvas-status")?.textContent,
        snapshot: window.tinyImageStarDesign.getSnapshot(), errors: window.__designErrors })), pageErrors);
      throw error;
    }
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

    const beforeFlip = await page.locator("#design-canvas").evaluate((canvas) => canvas.toDataURL());
    await page.locator("#design-flip-x").click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const flipped = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id], selectedId);
    const afterFlip = await page.locator("#design-canvas").evaluate((canvas) => canvas.toDataURL());
    assert.equal(flipped.flipX, true, "the image inspector stores a horizontal flip on the selected layer");
    assert.equal(flipped.assetId, sourceId, "flipping keeps the exact original image asset attached");
    assert.notEqual(afterFlip, beforeFlip, "the WASM preview redraws the same image layer after flipping");
    assert.equal(await page.locator("#design-flip-x").getAttribute("aria-pressed"), "true",
      "the image transform button exposes its current pressed state");
    await page.locator("#design-undo").click();
    assert.equal((await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id], selectedId)).flipX, undefined,
      "undo restores the source orientation without rewriting its bytes");
    await page.locator("#design-redo").click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));

    const frameBeforeResize = structuredClone(edited.frame);
    const canvasBox = await page.locator("#design-canvas").boundingBox();
    const resizeHandle = await page.evaluate((id) => {
      const state = window.tinyImageStarDesign.getSnapshot(), node = state.nodes[id], pageSize = { width: 1920, height: 1080 }, view = state.canvas.geometry;
      const canvasBounds = document.querySelector("#design-canvas").getBoundingClientRect();
      return { x: canvasBounds.left + view.x + (node.frame.x + node.frame.width) * pageSize.width * view.scale,
        y: canvasBounds.top + view.y + (node.frame.y + node.frame.height) * pageSize.height * view.scale };
    }, selectedId);
    await page.mouse.move(resizeHandle.x, resizeHandle.y);
    await page.mouse.down();
    await page.mouse.move(resizeHandle.x + 28, resizeHandle.y + 18, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const resized = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id], selectedId);
    assert.ok(resized.frame.width > frameBeforeResize.width && resized.frame.height > frameBeforeResize.height,
      "canvas corner handles resize the selected layer in both dimensions");
    assert.equal(resized.assetId, sourceId, "resizing retains the exact original image asset");
    assert.deepEqual(await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].frame, selectedId), resized.frame,
      "the same layer frame is the source of the visible canvas preview");
    await page.locator("#design-undo").click();
    assert.deepEqual(await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].frame, selectedId), frameBeforeResize,
      "one undo restores the exact pre-resize frame");
    await page.locator("#design-redo").click();
    await page.waitForFunction(({ id, expectedWidth }) => window.tinyImageStarDesign.getSnapshot().nodes[id].frame.width >= expectedWidth,
      { id: selectedId, expectedWidth: resized.frame.width });

    const rotationHandle = await page.evaluate((id) => {
      const state = window.tinyImageStarDesign.getSnapshot(), node = state.nodes[id], view = state.canvas.geometry;
      const x = view.x + (node.frame.x + node.frame.width / 2) * 1920 * view.scale;
      const y = view.y + node.frame.y * 1080 * view.scale;
      const radius = node.frame.height * 1080 * view.scale / 2 + 24;
      const bounds = document.querySelector("#design-canvas").getBoundingClientRect(), centerY = y + node.frame.height * 1080 * view.scale / 2;
      return { start: { x: bounds.left + x, y: bounds.top + y - 24 },
        target: { x: bounds.left + x + radius / Math.SQRT2, y: bounds.top + centerY - radius / Math.SQRT2 } };
    }, selectedId);
    await page.mouse.move(rotationHandle.start.x, rotationHandle.start.y);
    await page.mouse.down();
    await page.mouse.move(rotationHandle.target.x, rotationHandle.target.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const rotated = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id], selectedId);
    assert.ok(Math.abs(rotated.rotation - 45) < 1, `rotation handle applies an in-place 45° rotation: ${rotated.rotation}`);
    assert.equal(rotated.assetId, sourceId, "rotating preserves the source image bytes");

    await page.locator("#design-zoom-in").click();
    assert.equal((await page.evaluate(() => window.tinyImageStarDesign.getSnapshot().canvas.zoom)), 1.25,
      "zoom controls change canvas view scale without editing the document");
    const anchoredZoom = await page.evaluate(() => {
      const canvas = document.querySelector("#design-canvas"), rect = canvas.getBoundingClientRect(), point = { x: 170, y: 145 };
      const before = window.tinyImageStarDesign.getSnapshot().canvas;
      const worldBefore = { x: (point.x - before.geometry.x) / before.geometry.scale, y: (point.y - before.geometry.y) / before.geometry.scale };
      canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -50,
        clientX: rect.left + point.x, clientY: rect.top + point.y }));
      const after = window.tinyImageStarDesign.getSnapshot().canvas;
      return { before, after, worldBefore, worldAfter: { x: (point.x - after.geometry.x) / after.geometry.scale,
        y: (point.y - after.geometry.y) / after.geometry.scale } };
    });
    assert.ok(anchoredZoom.after.zoom > anchoredZoom.before.zoom, "trackpad modifier-wheel zooms in");
    assert.ok(Math.abs(anchoredZoom.worldAfter.x - anchoredZoom.worldBefore.x) < .001
      && Math.abs(anchoredZoom.worldAfter.y - anchoredZoom.worldBefore.y) < .001, "wheel zoom keeps the pointer anchored to the same page point");
    const beforePan = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot().canvas);
    const bounds = canvasBox;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(bounds.x + bounds.width / 2 + 30, bounds.y + bounds.height / 2 + 20);
    await page.mouse.up({ button: "middle" });
    const afterPan = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot().canvas);
    assert.equal(afterPan.panX, beforePan.panX + 30, "middle-button drag pans the canvas horizontally");
    assert.equal(afterPan.panY, beforePan.panY + 20, "middle-button drag pans the canvas vertically");
    await page.locator("#design-canvas").focus();
    await page.keyboard.down("Space");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 18, bounds.y + bounds.height / 2 - 12);
    await page.mouse.up();
    await page.keyboard.up("Space");
    const afterSpacePan = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot().canvas);
    assert.equal(afterSpacePan.panX, afterPan.panX + 18, "Space-drag pans the canvas horizontally");
    assert.equal(afterSpacePan.panY, afterPan.panY - 12, "Space-drag pans the canvas vertically");
    await page.locator("#design-zoom-label").click();
    assert.equal((await page.evaluate(() => window.tinyImageStarDesign.getSnapshot().canvas.zoom)), 1,
      "fit control restores the page view without changing layers");
    const sourceAfterGestures = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(sourceAfterGestures.nodes[selectedId].assetId, sourceId);
    assert.equal(sourceAfterGestures.retainedSourceBytes, image.byteLength * 2, "canvas transforms retain every original image byte");
    const pinch = await page.evaluate(() => {
      const canvas = document.querySelector("#design-canvas"), rect = canvas.getBoundingClientRect();
      const before = window.tinyImageStarDesign.getSnapshot();
      const fire = (type, pointerId, x, y) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true,
        pointerId, pointerType: "touch", isPrimary: pointerId === 51, button: 0, buttons: 1,
        clientX: rect.left + x, clientY: rect.top + y }));
      fire("pointerdown", 51, 110, 110); fire("pointerdown", 52, 210, 110);
      fire("pointermove", 52, 260, 130);
      const during = window.tinyImageStarDesign.getSnapshot();
      fire("pointerup", 52, 260, 130); fire("pointerup", 51, 110, 110);
      return { before, during };
    });
    assert.ok(pinch.during.canvas.zoom > pinch.before.canvas.zoom * 1.4, "two-finger pinch zooms the page on the canvas");
    assert.equal(pinch.during.revision, pinch.before.revision, "canvas gestures never rewrite image layers or original bytes");
    await page.locator("#design-zoom-label").click();

    await page.locator("#design-add-text").click();
    await page.locator("#design-add-rectangle").click();
    const withObjects = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.deepEqual(withObjects.pages[0].nodeIds.map((id) => withObjects.nodes[id].kind), ["image", "image", "text", "shape"]);
    assert.equal(await page.locator("#design-canvas").isVisible(), true);
    assert.equal(await page.locator("#design-inspector").isVisible(), true);

    const textId = withObjects.pages[0].nodeIds.find((id) => withObjects.nodes[id].kind === "text");
    const shapeId = withObjects.pages[0].nodeIds.find((id) => withObjects.nodes[id].kind === "shape");
    const imageIds = withObjects.pages[0].nodeIds.filter((id) => withObjects.nodes[id].kind === "image");
    for (const id of imageIds) await page.locator(`#design-layer-list [data-layer-id="${id}"] button[aria-label^="Hide"]`).click();
    await page.locator(`#design-layer-list [data-layer-id="${textId}"] .design-layer-select`).click();
    await page.locator(`#design-layer-list [data-layer-id="${shapeId}"] .design-layer-select`).click({ modifiers: ["Shift"] });
    assert.equal((await page.evaluate(() => window.tinyImageStarDesign.getSnapshot().selection.length)), 2);
    await page.locator("#design-frame-selection").click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    let framed = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    const frameId = framed.selection[0];
    assert.equal(framed.nodes[frameId].kind, "frame");
    assert.equal(framed.nodes[shapeId].parentId, frameId, "framing nests selected layers while preserving their identity");
    assert.equal(framed.resolvedFrames[shapeId].clipFrames.length, 1, "nested layers receive the frame's clipping geometry");
    await page.locator(`#design-layer-list [data-layer-id="${shapeId}"] .design-layer-select`).click();
    const beforeChildMove = framed.resolvedFrames[shapeId].frame;
    const childMove = await page.evaluate((id) => {
      const canvas = document.querySelector("#design-canvas"), bounds = canvas.getBoundingClientRect(), state = window.tinyImageStarDesign.getSnapshot();
      const frame = state.resolvedFrames[id].frame, view = state.canvas.geometry;
      const point = { x: bounds.left + view.x + (frame.x + frame.width / 2) * view.width * view.scale,
        y: bounds.top + view.y + (frame.y + frame.height / 2) * view.height * view.scale };
      const fire = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true,
        pointerId: 86, pointerType: "mouse", isPrimary: true, button: 0, buttons, clientX: x, clientY: y }));
      fire("pointerdown", point.x, point.y, 1); fire("pointermove", point.x + 18, point.y + 8, 1); fire("pointerup", point.x + 18, point.y + 8, 0);
      return { before: frame, after: window.tinyImageStarDesign.getSnapshot().resolvedFrames[id].frame, scale: view.scale };
    }, shapeId);
    assert.ok(childMove.after.x > beforeChildMove.x && Math.abs(childMove.after.x - beforeChildMove.x - 18 / (1920 * childMove.scale)) < 1e-5,
      "moving a nested child on the canvas updates its parent-local geometry without changing its page-space motion");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    framed = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    await page.locator("#design-constraint-horizontal").selectOption("left");
    await page.locator("#design-constraint-vertical").selectOption("top-bottom");
    await page.locator(`#design-layer-list [data-layer-id="${frameId}"] .design-layer-select`).click();
    const childBefore = structuredClone(framed.resolvedFrames[shapeId].frame);
    await page.locator("#design-width").fill("25");
    await page.locator("#design-width").press("Tab");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    framed = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    const parentFrame = framed.resolvedFrames[frameId].frame, childFrame = framed.resolvedFrames[shapeId].frame;
    assert.ok(childFrame.x + childFrame.width > parentFrame.x + parentFrame.width,
      "left constraint keeps the child at its original page position when its frame shrinks");
    assert.ok(Math.abs(childFrame.x - childBefore.x) < 1e-6 && Math.abs(childFrame.width - childBefore.width) < 1e-6);
    assert.ok(framed.resolvedFrames[shapeId].clipFrames.length === 1);
    const outsideClip = await page.evaluate(() => {
      const canvas = document.querySelector("#design-canvas"), context = canvas.getContext("2d"), state = window.tinyImageStarDesign.getSnapshot();
      const dpr = Math.min(2, window.devicePixelRatio || 1), view = state.canvas.geometry;
      const x = Math.round((view.x + .49 * 1920 * view.scale) * dpr), y = Math.round((view.y + .5 * 1080 * view.scale) * dpr);
      return [...context.getImageData(x, y, 1, 1).data];
    });
    assert.ok(outsideClip[0] > 220 && outsideClip[1] > 220 && outsideClip[2] > 220,
      `WASM page preview clips overflowing children to the frame: ${outsideClip}`);
    await page.locator("#design-frame-clip").uncheck();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const noClip = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().resolvedFrames[id].clipFrames.length, shapeId);
    assert.equal(noClip, 0, "the frame inspector can disable content clipping");
    const childBeforeLayout = framed.resolvedFrames[shapeId].frame;
    await page.locator("#design-frame-layout").selectOption("horizontal");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    let autoLayout = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(autoLayout.nodes[frameId].style.layout.direction, "horizontal");
    assert.ok(autoLayout.resolvedFrames[shapeId].frame.x > childBeforeLayout.x,
      "Auto Layout computes child positions from layer order inside the frame");
    await page.locator("#design-layout-gap").fill("12");
    await page.locator("#design-layout-gap").press("Tab");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    autoLayout = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(autoLayout.nodes[frameId].style.layout.gap, 12, "pixel spacing is editable and stored on the frame");
    await page.locator("#design-layout-wrap").check();
    await page.locator("#design-layout-row-gap").fill("9");
    await page.locator("#design-layout-row-gap").press("Tab");
    await page.locator("#design-layout-column-gap").fill("11");
    await page.locator("#design-layout-column-gap").press("Tab");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    autoLayout = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(autoLayout.nodes[frameId].style.layout.wrap, true, "wrapping is a persistent Auto Layout setting");
    assert.equal(autoLayout.nodes[frameId].style.layout.rowGap, 9);
    assert.equal(autoLayout.nodes[frameId].style.layout.columnGap, 11);
    await page.locator(`#design-layer-list [data-layer-id="${shapeId}"] .design-layer-select`).click();
    assert.equal(await page.locator("#design-x").isDisabled(), true, "Auto Layout owns the child's position fields");
    assert.equal(await page.locator("#design-resizing-options").isVisible(), true, "Auto Layout children expose per-axis resizing controls");
    await page.locator("#design-layout-sizing-width").selectOption("fill");
    autoLayout = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(autoLayout.nodes[shapeId].layoutSizing.width, "fill", "Fill container is stored on the child layer");
    await page.locator(`#design-layer-list [data-layer-id="${frameId}"] .design-layer-select`).click();
    for (const id of imageIds) await page.locator(`#design-layer-list [data-layer-id="${id}"] button[aria-label^="Show"]`).click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));

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
    await page.locator(`#design-layer-list [data-layer-id="${shapeId}"] .design-layer-select`).click();
    const mobileResizing = await page.evaluate(() => ({
      visible: !document.querySelector("#design-resizing-options")?.hidden,
      fields: [...document.querySelectorAll("#design-resizing-options select")].map((node) => node.getBoundingClientRect().toJSON()),
      width: innerWidth,
    }));
    assert.equal(mobileResizing.visible, true, "mobile inspector exposes Auto Layout resizing controls");
    assert.ok(mobileResizing.fields.length === 2 && mobileResizing.fields.every((box) => box.height >= 43 && box.left >= 0 && box.right <= mobileResizing.width),
      `Auto Layout sizing controls remain touch-sized and on-screen: ${JSON.stringify(mobileResizing.fields)}`);
    const mobile = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      layout: document.querySelector("#design-view").scrollWidth,
      canvas: document.querySelector("#design-canvas").getBoundingClientRect().toJSON(),
      buttons: [...document.querySelectorAll(".design-toolbar-actions .button, .design-zoom-controls .button, #design-layer-list button, #design-inspector .button")]
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
    assert.equal(reopened.pages[0].nodeIds.length, 5, "saved image, text, shape and frame layers reopen together");
    assert.equal(reopened.nodes[frameId].style.layout.direction, "horizontal", "Auto Layout settings survive local save and reload");
    assert.equal(reopened.nodes[frameId].style.layout.wrap, true, "wrap and axis gaps survive local save and reload");
    assert.equal(reopened.nodes[frameId].style.layout.rowGap, 9);
    assert.equal(reopened.nodes[frameId].style.layout.columnGap, 11);
    assert.equal(reopened.nodes[shapeId].layoutSizing.width, "fill", "child Fill sizing survives local save and reload");
    assert.equal(reopened.retainedSourceBytes, image.byteLength * 2, "reopen retains the original encoded image sources");
    await page.locator("#mobile-more-button").click();
    await page.locator("#design-button").click();
    await page.locator("#design-canvas").press("Control+a");
    await page.locator("#design-canvas").press("Backspace");
    await page.waitForFunction(() => window.tinyImageStarDesign.getSnapshot()?.pages[0].nodeIds.length === 0);
    const bulkDeleted = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.deepEqual(Object.keys(bulkDeleted.nodes), [], "keyboard bulk delete removes the whole canvas selection atomically");
    console.log("  design workspace: retained sources, live resize/rotate previews, Auto Layout wrap/Fill, undo, image recipes, autosave/reopen and phone layout");
  } finally { await context.close(); }
}
