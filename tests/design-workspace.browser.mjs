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

    const initialFrame = initial.resolvedFrames[selectedId].frame, initialX = initialFrame.x, initialY = initialFrame.y;
    await page.locator("#design-canvas").press("ArrowRight");
    await page.waitForFunction(({ id, start }) => window.tinyImageStarDesign.getSnapshot().resolvedFrames[id].frame.x > start,
      { id: selectedId, start: initialX }, { timeout: 5000 });
    const nudgedRight = await page.evaluate((ids) => {
      const snapshot = window.tinyImageStarDesign.getSnapshot();
      return Object.fromEntries(ids.map((id) => [id, snapshot.resolvedFrames[id].frame.x]));
    }, initial.selection);
    for (const id of initial.selection) {
      assert.ok(Math.abs(nudgedRight[id] - initial.resolvedFrames[id].frame.x - 1 / initial.variant.width) < 1e-8,
        "Arrow moves every selected image by one page pixel");
    }
    await page.keyboard.press("Shift+ArrowDown");
    await page.waitForFunction(({ id, start }) => window.tinyImageStarDesign.getSnapshot().resolvedFrames[id].frame.y > start,
      { id: selectedId, start: initialY }, { timeout: 5000 });
    assert.ok(Math.abs((await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().resolvedFrames[id].frame.y, selectedId))
      - initialY - 10 / initial.variant.height) < 1e-8, "Shift+Arrow moves the selected images by ten page pixels");
    await page.keyboard.press("Control+z");
    await page.waitForFunction(({ id, start }) => Math.abs(window.tinyImageStarDesign.getSnapshot().resolvedFrames[id].frame.y - start) < 1e-9,
      { id: selectedId, start: initialY }, { timeout: 5000 });
    assert.ok(Math.abs((await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().resolvedFrames[id].frame.x, selectedId))
      - initialX - 1 / initial.variant.width) < 1e-8, "undo first restores only the preceding nudge");
    await page.keyboard.press("Control+z");
    await page.waitForFunction(({ id, start }) => Math.abs(window.tinyImageStarDesign.getSnapshot().resolvedFrames[id].frame.x - start) < 1e-9,
      { id: selectedId, start: initialX }, { timeout: 5000 });

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

    const beforeOpacity = await page.locator("#design-canvas").evaluate((canvas) => canvas.toDataURL());
    await page.locator("#design-opacity").evaluate((input) => {
      input.value = "50"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const translucent = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id], selectedId);
    const afterOpacity = await page.locator("#design-canvas").evaluate((canvas) => canvas.toDataURL());
    assert.equal(translucent.opacity, .5, "the shared inspector stores layer opacity in the design model");
    assert.equal(translucent.assetId, sourceId, "opacity edits retain the original image layer asset");
    assert.notEqual(afterOpacity, beforeOpacity, "Pillow-RS redraws the same page with the updated layer opacity");
    await page.locator("#design-undo").click();
    assert.equal((await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id], selectedId)).opacity, undefined,
      "one undo restores full layer opacity");
    await page.locator("#design-redo").click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));

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

    const beforeCrop = await page.locator("#design-canvas").evaluate((canvas) => canvas.toDataURL());
    await page.locator("#design-crop-tool").click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().cropModeId === id, selectedId);
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const otherImageId = initial.pages[0].nodeIds.find((id) => id !== selectedId);
    const selectionPreviewStarted = page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Updating page preview"));
    await page.locator(`#design-layer-list [data-layer-id="${otherImageId}"] .design-layer-select`).click();
    await selectionPreviewStarted;
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().cropModeId === null
      && window.tinyImageStarDesign.getSnapshot().selection[0] === id, otherImageId);
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    assert.equal((await page.evaluate(() => window.tinyImageStarDesign.getSnapshot().cropModeId)), null,
      "selecting another layer closes crop mode and schedules the normal page preview");
    await page.locator(`#design-layer-list [data-layer-id="${selectedId}"] .design-layer-select`).click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().selection[0] === id, selectedId);
    await page.locator("#design-crop-tool").click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().cropModeId === id, selectedId);
    const cropCenter = await page.evaluate((id) => {
      const state = window.tinyImageStarDesign.getSnapshot(), frame = state.resolvedFrames[id].frame, view = state.canvas.geometry;
      const bounds = document.querySelector("#design-canvas").getBoundingClientRect();
      return { x: bounds.left + view.x + (frame.x + frame.width / 2) * view.width * view.scale,
        y: bounds.top + view.y + (frame.y + frame.height / 2) * view.height * view.scale };
    }, selectedId);
    await page.mouse.move(cropCenter.x - 18, cropCenter.y - 18);
    await page.mouse.down();
    await page.mouse.move(cropCenter.x + 18, cropCenter.y + 18, { steps: 4 });
    await page.mouse.up();
    try {
      await page.waitForFunction((id) => {
        const crop = window.tinyImageStarDesign.getSnapshot().nodes[id]?.crop;
        return crop && crop.width < 1 && crop.height < 1;
      }, selectedId, { timeout: 5000 });
    } catch (error) {
      console.error("crop drag diagnostics", await page.evaluate((id) => ({
        id, cropModeId: window.tinyImageStarDesign.getSnapshot().cropModeId,
        selected: window.tinyImageStarDesign.getSnapshot().selection,
        frame: window.tinyImageStarDesign.getSnapshot().resolvedFrames[id]?.frame,
        geometry: window.tinyImageStarDesign.getSnapshot().canvas.geometry,
        bounds: document.querySelector("#design-canvas").getBoundingClientRect().toJSON(),
        node: window.tinyImageStarDesign.getSnapshot().nodes[id],
        status: document.querySelector("#design-canvas-status")?.textContent,
      }), selectedId), pageErrors);
      throw error;
    }
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const cropped = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id], selectedId);
    assert.ok(cropped.crop.x > 0 && cropped.crop.y > 0 && cropped.crop.width > 0 && cropped.crop.height > 0,
      `on-canvas crop creation stores a bounded normalized source rectangle: ${JSON.stringify(cropped.crop)}`);
    assert.equal(cropped.assetId, sourceId, "cropping preserves the original encoded image asset");
    await page.locator("#design-undo").click();
    await page.waitForFunction((id) => !window.tinyImageStarDesign.getSnapshot().nodes[id]?.crop, selectedId);
    await page.locator("#design-redo").click();
    await page.waitForFunction((id) => Boolean(window.tinyImageStarDesign.getSnapshot().nodes[id]?.crop), selectedId);
    await page.locator("#design-crop-tool").click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const afterCrop = await page.locator("#design-canvas").evaluate((canvas) => canvas.toDataURL());
    assert.notEqual(afterCrop, beforeCrop, "committing a crop redraws the same layer's page preview");
    assert.equal(await page.locator("#design-crop-reset").isDisabled(), false, "the inspector can reset a committed source crop");
    await page.locator("#design-crop-reset").click();
    await page.waitForFunction((id) => !window.tinyImageStarDesign.getSnapshot().nodes[id]?.crop, selectedId);
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    assert.equal(await page.locator("#design-canvas").evaluate((canvas) => canvas.toDataURL()), beforeCrop,
      "reset restores the original full-source preview without changing the image layer");

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

    await page.locator("#design-crop-tool").click();
    const rotatedCropCenter = await page.evaluate((id) => {
      const state = window.tinyImageStarDesign.getSnapshot(), frame = state.resolvedFrames[id].frame, view = state.canvas.geometry;
      const bounds = document.querySelector("#design-canvas").getBoundingClientRect();
      return { x: bounds.left + view.x + (frame.x + frame.width / 2) * view.width * view.scale,
        y: bounds.top + view.y + (frame.y + frame.height / 2) * view.height * view.scale };
    }, selectedId);
    await page.mouse.move(rotatedCropCenter.x - 18, rotatedCropCenter.y - 18);
    await page.mouse.down();
    await page.mouse.move(rotatedCropCenter.x + 18, rotatedCropCenter.y + 18, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction((id) => Boolean(window.tinyImageStarDesign.getSnapshot().nodes[id]?.crop), selectedId);
    const rotatedCrop = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id], selectedId);
    assert.equal(rotatedCrop.assetId, sourceId, "cropping a rotated layer still edits the retained source asset");
    await page.locator("#design-crop-tool").click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    await page.locator("#design-crop-reset").click();
    await page.waitForFunction((id) => !window.tinyImageStarDesign.getSnapshot().nodes[id]?.crop, selectedId);

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

    await page.locator(`#design-layer-list [data-layer-id="${selectedId}"] .design-layer-select`).click();
    await page.locator(`#design-layer-list [data-layer-id="${otherImageId}"] .design-layer-select`).click({ modifiers: ["Shift"] });
    await page.waitForFunction(() => window.tinyImageStarDesign.getSnapshot().selection.length === 2);
    assert.equal(await page.locator("#design-multi-inspector").isVisible(), true, "multi-selection shows shared editable properties");
    const beforeMultiGeometry = await page.evaluate((ids) => {
      const state = window.tinyImageStarDesign.getSnapshot(), { width, height } = state.variant;
      const frames = ids.map((id) => state.resolvedFrames[id].frame);
      return { size: { width, height }, frames: Object.fromEntries(ids.map((id) => [id, state.nodes[id].frame])),
        bounds: { x: Math.min(...frames.map((frame) => frame.x * width)), y: Math.min(...frames.map((frame) => frame.y * height)),
          width: Math.max(...frames.map((frame) => (frame.x + frame.width) * width)) - Math.min(...frames.map((frame) => frame.x * width)),
          height: Math.max(...frames.map((frame) => (frame.y + frame.height) * height)) - Math.min(...frames.map((frame) => frame.y * height)) } };
    }, [selectedId, otherImageId]);
    const targetSelectionX = Math.round((beforeMultiGeometry.bounds.x + 20) * 10) / 10;
    await page.locator("#design-multi-x").fill(String(targetSelectionX));
    await page.locator("#design-multi-x").press("Tab");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    let movedMulti = await page.evaluate((ids) => {
      const state = window.tinyImageStarDesign.getSnapshot(), width = state.variant.width;
      return ids.map((id) => state.nodes[id].frame.x * width);
    }, [selectedId, otherImageId]);
    for (const [index, id] of [selectedId, otherImageId].entries()) {
      assert.ok(Math.abs(movedMulti[index] - beforeMultiGeometry.frames[id].x * beforeMultiGeometry.size.width - 20) < .11,
        "editing the selection X field moves each selected layer by the same pixel offset");
    }
    await page.locator("#design-undo").click();
    assert.deepEqual(await page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, window.tinyImageStarDesign.getSnapshot().nodes[id].frame])),
      [selectedId, otherImageId]), beforeMultiGeometry.frames, "one undo restores all selected frames");
    await page.locator("#design-redo").click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    movedMulti = await page.evaluate((ids) => {
      const state = window.tinyImageStarDesign.getSnapshot(), width = state.variant.width;
      return ids.map((id) => state.nodes[id].frame.x * width);
    }, [selectedId, otherImageId]);
    assert.ok(movedMulti.every((x, index) => Math.abs(x - (beforeMultiGeometry.frames[[selectedId, otherImageId][index]].x * beforeMultiGeometry.size.width + 20)) < .11),
      "redo reapplies the shared geometry change to the selection");
    assert.equal(await page.locator("#design-multi-opacity-value").textContent(), "Mixed", "mixed values are visible before a shared edit");
    const beforeMultiOpacity = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, {
      opacity: window.tinyImageStarDesign.getSnapshot().nodes[id].opacity,
      assetId: window.tinyImageStarDesign.getSnapshot().nodes[id].assetId,
    }])), [selectedId, otherImageId]);
    await page.locator("#design-multi-opacity").evaluate((input) => {
      input.value = "65"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    let multiOpacity = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, window.tinyImageStarDesign.getSnapshot().nodes[id]])),
      [selectedId, otherImageId]);
    assert.deepEqual(Object.values(multiOpacity).map((node) => node.opacity), [.65, .65], "one mixed-value edit updates every selected image");
    assert.deepEqual(Object.values(multiOpacity).map((node) => node.assetId), [sourceId, beforeMultiOpacity[otherImageId].assetId],
      "shared opacity preserves the distinct source asset for each layer");
    await page.locator("#design-undo").click();
    multiOpacity = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, window.tinyImageStarDesign.getSnapshot().nodes[id]])),
      [selectedId, otherImageId]);
    assert.deepEqual(Object.fromEntries(Object.entries(multiOpacity).map(([id, node]) => [id, node.opacity])),
      Object.fromEntries(Object.entries(beforeMultiOpacity).map(([id, value]) => [id, value.opacity])),
      "one undo restores every selected layer's original opacity");
    await page.locator("#design-redo").click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    await page.locator(`#design-layer-list [data-layer-id="${selectedId}"] .design-layer-select`).click();
    await page.waitForFunction(() => window.tinyImageStarDesign.getSnapshot().selection.length === 1);

    await page.locator("#design-add-text").click();
    await page.locator("#design-add-shape").click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const beforePen = await page.locator("#design-canvas").evaluate((canvas) => canvas.toDataURL());
    await page.locator("#design-add-pen").click();
    assert.equal(await page.locator("#design-add-pen").getAttribute("aria-pressed"), "true", "Pen announces its active drawing mode");
    const penPoint = async (x, y) => page.evaluate(({ x, y }) => {
      const canvas = document.querySelector("#design-canvas"), state = window.tinyImageStarDesign.getSnapshot(), view = state.canvas.geometry;
      const bounds = canvas.getBoundingClientRect();
      return { x: bounds.left + view.x + x * view.scale, y: bounds.top + view.y + y * view.scale };
    }, { x, y });
    const firstPenPoint = await penPoint(150, 720), curvePenPoint = await penPoint(390, 720), lastPenPoint = await penPoint(300, 940);
    await page.mouse.click(firstPenPoint.x, firstPenPoint.y);
    await page.mouse.move(curvePenPoint.x, curvePenPoint.y); await page.mouse.down();
    await page.mouse.move(curvePenPoint.x + 24, curvePenPoint.y + 10, { steps: 4 }); await page.mouse.up();
    await page.mouse.click(lastPenPoint.x, lastPenPoint.y); await page.mouse.click(firstPenPoint.x, firstPenPoint.y);
    await page.waitForFunction(() => window.tinyImageStarDesign.getSnapshot().pages[0].nodeIds.length === 5);
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    let penState = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    const afterPen = await page.locator("#design-canvas").evaluate((canvas) => canvas.toDataURL());
    const vectorId = penState.pages[0].nodeIds.at(-1), vectorNode = penState.nodes[vectorId];
    assert.notEqual(afterPen, beforePen, "a closed Pen path renders into the existing Pillow-RS page preview");
    assert.equal(vectorNode.style.shape, "path"); assert.equal(vectorNode.style.path.closed, true);
    assert.equal(vectorNode.style.path.points.length, 3);
    assert.ok(vectorNode.style.path.points.some((point) => point.handleIn && point.handleOut), "dragging an anchor creates editable Bezier handles");
    await page.locator("#design-edit-vector").click();
    const vectorAnchor = await page.evaluate((id) => {
      const canvas = document.querySelector("#design-canvas"), bounds = canvas.getBoundingClientRect(), state = window.tinyImageStarDesign.getSnapshot();
      const frame = state.resolvedFrames[id].frame, point = state.nodes[id].style.path.points[0], view = state.canvas.geometry;
      return { x: bounds.left + view.x + (frame.x + point.x * frame.width) * view.width * view.scale,
        y: bounds.top + view.y + (frame.y + point.y * frame.height) * view.height * view.scale };
    }, vectorId);
    await page.mouse.move(vectorAnchor.x, vectorAnchor.y); await page.mouse.down();
    await page.mouse.move(vectorAnchor.x + 12, vectorAnchor.y + 8, { steps: 3 }); await page.mouse.up();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const movedVector = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path, vectorId);
    assert.notDeepEqual(movedVector, vectorNode.style.path, "dragging a selected path anchor previews a point edit");
    await page.locator("#design-undo").click();
    assert.deepEqual(await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path, vectorId), vectorNode.style.path,
      "undo restores the vector path points");
    await page.locator("#design-redo").click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const beforePointInsert = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path, vectorId);
    const previousViewport = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    const addPointBox = await page.locator("#design-vector-add-point").boundingBox();
    assert.ok(addPointBox?.height >= 43 && addPointBox.x >= 0 && addPointBox.x + addPointBox.width <= 390,
      `mobile anchor editing exposes a touch-sized Add point action: ${JSON.stringify(addPointBox)}`);
    await page.locator("#design-vector-add-point").click();
    assert.equal(await page.locator("#design-vector-add-point").getAttribute("aria-pressed"), "true", "Add point enters an explicit segment insertion mode");
    const curveMidpoint = await page.evaluate((id) => {
      const state = window.tinyImageStarDesign.getSnapshot(), path = state.nodes[id].style.path, frame = state.resolvedFrames[id].frame;
      const start = path.points[1], end = path.points[2], p0 = { x: start.x, y: start.y }, p1 = start.handleOut ?? p0;
      const p3 = { x: end.x, y: end.y }, p2 = end.handleIn ?? p3, t = .5;
      const mix = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const a = mix(p0, p1), b = mix(p1, p2), c = mix(p2, p3), d = mix(a, b), e = mix(b, c), point = mix(d, e);
      const canvas = document.querySelector("#design-canvas"), bounds = canvas.getBoundingClientRect(), view = state.canvas.geometry;
      const size = state.variant, angle = (state.resolvedFrames[id].rotation ?? 0) * Math.PI / 180;
      const center = { x: (frame.x + frame.width / 2) * size.width, y: (frame.y + frame.height / 2) * size.height };
      const local = { x: (point.x - .5) * frame.width * size.width, y: (point.y - .5) * frame.height * size.height };
      const pagePoint = { x: center.x + local.x * Math.cos(angle) - local.y * Math.sin(angle), y: center.y + local.x * Math.sin(angle) + local.y * Math.cos(angle) };
      return { x: bounds.left + view.x + pagePoint.x * view.scale, y: bounds.top + view.y + pagePoint.y * view.scale };
    }, vectorId);
    await page.mouse.click(curveMidpoint.x, curveMidpoint.y);
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path.points.length === 4, vectorId);
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const insertedPath = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path, vectorId);
    assert.equal(insertedPath.points.length, 4, "tapping a curved segment splits it in place");
    const insertedPointIndex = insertedPath.points.findIndex((point) => !beforePointInsert.points.some((old) => old.x === point.x && old.y === point.y));
    assert.ok(insertedPointIndex >= 0, "the split inserts a distinct node between the original anchors");
    await page.locator("#design-undo").click();
    assert.deepEqual(await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path, vectorId), beforePointInsert,
      "undo removes the inserted anchor and restores the unsplit handles");
    await page.locator("#design-redo").click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path.points.length === 4, vectorId);
    assert.equal(await page.locator("#design-edit-vector").getAttribute("aria-pressed"), "true", "history leaves the active path editor open");
    const insertedAnchor = await page.evaluate((index) => {
      const state = window.tinyImageStarDesign.getSnapshot(), point = state.vectorEditing.points[index];
      const bounds = document.querySelector("#design-canvas").getBoundingClientRect();
      return { x: bounds.left + point.x, y: bounds.top + point.y };
    }, insertedPointIndex);
    assert.equal((await page.evaluate(() => window.tinyImageStarDesign.getSnapshot().vectorEditing?.layerId)), vectorId,
      "path node editing remains active after anchor insertion and history replay");
    await page.mouse.click(insertedAnchor.x, insertedAnchor.y);
    assert.equal(await page.locator("#design-vector-delete-point").isEnabled(), true,
      `selecting anchor ${insertedPointIndex} at ${JSON.stringify(insertedAnchor)} enables its deletion control (state: ${JSON.stringify(await page.evaluate(() => window.tinyImageStarDesign.getSnapshot().vectorEditing))}; status: ${await page.locator("#design-vector-point-status").textContent()})`);
    assert.equal(await page.locator("#design-vector-handle-mode-field").isVisible(), true, "selected curved anchors expose tangent behavior");
    await page.locator("#design-vector-handle-mode").selectOption("mirrored");
    await page.waitForFunction(({ id, index }) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path.points[index].handleMode === "mirrored",
      { id: vectorId, index: insertedPointIndex });
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const handleStart = await page.evaluate((index) => {
      const state = window.tinyImageStarDesign.getSnapshot(), handle = state.vectorEditing.handles[index].handleOut;
      const bounds = document.querySelector("#design-canvas").getBoundingClientRect();
      return { x: bounds.left + handle.x, y: bounds.top + handle.y };
    }, insertedPointIndex);
    const beforeHandleDrag = await page.evaluate(({ id, index }) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path.points[index],
      { id: vectorId, index: insertedPointIndex });
    await page.mouse.move(handleStart.x, handleStart.y); await page.mouse.down();
    await page.mouse.move(handleStart.x + 24, handleStart.y + 16, { steps: 4 }); await page.mouse.up();
    await page.waitForFunction(({ id, index }) => {
      const point = window.tinyImageStarDesign.getSnapshot().nodes[id].style.path.points[index];
      return Math.abs((point.handleIn.x + point.handleOut.x) / 2 - point.x) < 1e-8
        && Math.abs((point.handleIn.y + point.handleOut.y) / 2 - point.y) < 1e-8;
    }, { id: vectorId, index: insertedPointIndex });
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    await page.locator("#design-undo").click();
    assert.deepEqual(await page.evaluate(({ id, index }) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path.points[index],
      { id: vectorId, index: insertedPointIndex }), beforeHandleDrag, "undo restores both handles together");
    await page.locator("#design-redo").click();
    await page.waitForFunction(({ id, index }) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path.points[index].handleMode === "mirrored",
      { id: vectorId, index: insertedPointIndex });
    const selectedAnchor = await page.evaluate((index) => {
      const state = window.tinyImageStarDesign.getSnapshot(), point = state.vectorEditing.points[index], bounds = document.querySelector("#design-canvas").getBoundingClientRect();
      return { x: bounds.left + point.x, y: bounds.top + point.y };
    }, insertedPointIndex);
    await page.mouse.click(selectedAnchor.x, selectedAnchor.y);
    await page.waitForFunction(({ id, index }) => window.tinyImageStarDesign.getSnapshot().vectorEditing.selectedPoint === index,
      { id: vectorId, index: insertedPointIndex });
    const deletePointBox = await page.locator("#design-vector-delete-point").boundingBox();
    assert.ok(deletePointBox?.height >= 43 && deletePointBox.x >= 0 && deletePointBox.x + deletePointBox.width <= 390,
      `mobile anchor editing exposes a touch-sized Delete point action: ${JSON.stringify(deletePointBox)}`);
    await page.locator("#design-vector-delete-point").click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path.points.length === 3, vectorId);
    await page.locator("#design-undo").click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path.points.length === 4, vectorId);
    await page.locator("#design-redo").click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.path.points.length === 3, vectorId);
    await page.setViewportSize(previousViewport);
    await page.locator("#design-add-pen").click();
    assert.equal(await page.locator("#design-add-pen").getAttribute("aria-pressed"), "false", "Pen mode can be exited before selecting layers");
    const withObjects = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.deepEqual(withObjects.pages[0].nodeIds.map((id) => withObjects.nodes[id].kind), ["image", "image", "text", "shape", "shape"]);
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
    await page.locator("#design-width").fill("480");
    await page.locator("#design-width").press("Tab");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    framed = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    const parentFrame = framed.resolvedFrames[frameId].frame, childFrame = framed.resolvedFrames[shapeId].frame;
    assert.ok(childFrame.x + childFrame.width > parentFrame.x + parentFrame.width,
      `left constraint keeps the child at its original page position when its frame shrinks: ${JSON.stringify({ parentFrame, childFrame, childBefore })}`);
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
    await page.locator("#design-layout-justify").selectOption("space-evenly");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    autoLayout = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(autoLayout.nodes[frameId].style.layout.justify, "space-evenly", "the inspector stores the selected free-space distribution mode");
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
    await page.locator("#design-layout-min-width").fill("80");
    await page.locator("#design-layout-min-width").press("Tab");
    await page.locator("#design-layout-max-width").fill("120");
    await page.locator("#design-layout-max-width").press("Tab");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    autoLayout = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.deepEqual(autoLayout.nodes[shapeId].layoutMinMax, { minWidth: 80, maxWidth: 120 },
      "Auto Layout size limits persist on the same selected child");
    const constrainedWidth = autoLayout.resolvedFrames[shapeId].frame.width * autoLayout.variant.width;
    assert.ok(constrainedWidth >= 80 - 1e-6 && constrainedWidth <= 120 + 1e-6,
      `the same page preview clamps Fill sizing to its min/max width: ${constrainedWidth}px`);
    await page.locator("#design-canvas").focus();
    await page.keyboard.press("Control+z");
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].layoutMinMax?.maxWidth == null, shapeId);
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    autoLayout = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.ok(autoLayout.resolvedFrames[shapeId].frame.width * autoLayout.variant.width > 120,
      "undo restores the unconstrained live Fill size");
    await page.keyboard.press("Control+y");
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].layoutMinMax?.maxWidth === 120, shapeId);
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    await page.locator("#design-layout-min-width").fill("130");
    await page.locator("#design-layout-min-width").press("Tab");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("minimum size cannot exceed"));
    autoLayout = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.deepEqual(autoLayout.nodes[shapeId].layoutMinMax, { minWidth: 80, maxWidth: 120 },
      "invalid min/max edits are rejected without changing the saved layer");
    for (const field of ["#design-layout-min-width", "#design-layout-max-width"]) {
      await page.locator(field).fill(""); await page.locator(field).press("Tab");
    }
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    autoLayout = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(autoLayout.nodes[shapeId].layoutMinMax, undefined, "clearing both bounds removes the optional size-limit record");
    await page.locator(`#design-layer-list [data-layer-id="${frameId}"] .design-layer-select`).click();
    await page.locator("#design-frame-layout").selectOption("grid");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    await page.locator(`#design-layer-list [data-layer-id="${frameId}"] .design-layer-select`).click();
    let gridState = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(gridState.nodes[frameId].style.layout.direction, "grid");
    assert.equal(gridState.nodes[frameId].style.layout.columns, 2);
    assert.equal(gridState.nodes[frameId].style.layout.rows, 0, "grid starts with content-sized auto rows");
    assert.equal(await page.locator('#design-layout-justify option[value="space-evenly"]').evaluate((option) => option.disabled), true,
      "grid layouts disable flow-only spacing distribution modes");
    await page.locator("#design-layout-columns").fill("3");
    await page.locator("#design-layout-columns").press("Tab");
    await page.locator("#design-layout-justify").selectOption("stretch");
    await page.locator("#design-layout-align").selectOption("stretch");
    const firstGridTrackMode = '#design-grid-column-tracks [data-grid-track-index="0"][data-grid-track-control="mode"]';
    await page.locator(firstGridTrackMode).selectOption("fixed");
    await page.locator('#design-grid-column-tracks [data-grid-track-index="0"][data-grid-track-control="value"]').fill("96");
    await page.locator('#design-grid-column-tracks [data-grid-track-index="0"][data-grid-track-control="value"]').press("Tab");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    await page.locator(`#design-layer-list [data-layer-id="${shapeId}"] .design-layer-select`).click();
    assert.equal(await page.locator("#design-grid-placement").isVisible(), true, "grid children expose editable cell and span controls");
    await page.locator("#design-grid-column").fill("1");
    await page.locator("#design-grid-column").press("Tab");
    await page.locator("#design-grid-column-span").fill("2");
    await page.locator("#design-grid-column-span").press("Tab");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    gridState = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.deepEqual(gridState.nodes[frameId].style.layout.columnTracks.slice(0, 3), [
      { mode: "fixed", value: 96 }, { mode: "fill", value: 1 }, { mode: "fill", value: 1 },
    ], "track values retain fixed pixels and fractional Fill settings");
    const gridOtherId = gridState.pages[0].nodeIds.find((id) => gridState.nodes[id].parentId === frameId && id !== shapeId);
    assert.deepEqual(gridState.nodes[shapeId].gridPlacement, { row: 1, column: 1, rowSpan: 1, columnSpan: 2 });
    assert.ok(gridState.resolvedFrames[shapeId].frame.width > gridState.resolvedFrames[gridOtherId].frame.width,
      "the live WASM page preview lays a spanning child across its fixed and fractional grid columns");
    assert.ok(gridState.resolvedFrames[gridOtherId].frame.x > gridState.resolvedFrames[shapeId].frame.x,
      "grid auto-placement skips cells occupied by a spanning child");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(`#design-layer-list [data-layer-id="${frameId}"] .design-layer-select`).click();
    await page.locator("#design-layout-columns").scrollIntoViewIfNeeded();
    const mobileGridTracks = await page.evaluate(() => [...document.querySelectorAll("#design-grid-tracks > label input")]
      .map((input) => input.getBoundingClientRect().toJSON()));
    assert.ok(mobileGridTracks.length === 2 && mobileGridTracks.every((box) => box.height >= 43 && box.left >= 0 && box.right <= 390),
      `grid track controls remain touch-sized on a phone: ${JSON.stringify(mobileGridTracks)}`);
    const mobileGridSizing = await page.evaluate(() => [...document.querySelectorAll("#design-grid-column-tracks select, #design-grid-column-tracks input")]
      .map((input) => input.getBoundingClientRect().toJSON()));
    assert.ok(mobileGridSizing.length === 6 && mobileGridSizing.every((box) => box.height >= 43 && box.left >= 0 && box.right <= 390),
      `fixed and Fill sizing controls remain touch-sized on a phone: ${JSON.stringify(mobileGridSizing)}`);
    const mobileGridTrackActions = await page.evaluate(() => [...document.querySelectorAll("#design-grid-tracks [data-grid-track-action]")]
      .map((button) => button.getBoundingClientRect().toJSON()));
    assert.ok(mobileGridTrackActions.length === 12 && mobileGridTrackActions.every((box) => box.height >= 43 && box.width >= 43 && box.left >= 0 && box.right <= 390),
      `track reorder/delete actions remain touch-sized on a phone: ${JSON.stringify(mobileGridTrackActions)}`);
    await page.locator(`#design-layer-list [data-layer-id="${gridOtherId}"] .design-layer-select`).click();
    const mobileGridPlacement = await page.evaluate(() => [...document.querySelectorAll("#design-grid-placement input")]
      .map((input) => input.getBoundingClientRect().toJSON()));
    assert.ok(mobileGridPlacement.length === 4 && mobileGridPlacement.every((box) => box.height >= 43 && box.left >= 0 && box.right <= 390),
      `grid cell/span controls remain touch-sized on a phone: ${JSON.stringify(mobileGridPlacement)}`);
    assert.equal(await page.locator("#design-grid-alignment").isVisible(), true, "grid children expose per-cell alignment overrides");
    const mobileGridAlignment = await page.evaluate(() => [...document.querySelectorAll("#design-grid-alignment select")]
      .map((input) => input.getBoundingClientRect().toJSON()));
    assert.ok(mobileGridAlignment.length === 2 && mobileGridAlignment.every((box) => box.height >= 43 && box.left >= 0 && box.right <= 390),
      `per-cell alignment controls remain touch-sized on a phone: ${JSON.stringify(mobileGridAlignment)}`);
    await page.locator("#design-grid-align-horizontal").selectOption("end");
    await page.locator("#design-grid-align-vertical").selectOption("center");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    gridState = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.deepEqual(gridState.nodes[gridOtherId].gridAlignment, { horizontal: "end", vertical: "center" },
      "per-cell alignment is stored on the selected child independently of its parent settings");
    await page.locator("#design-grid-align-horizontal").selectOption("auto");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    gridState = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.deepEqual(gridState.nodes[gridOtherId].gridAlignment, { vertical: "center" }, "Auto removes one axis override while preserving the other");
    const gridFrameBeforeAbsolute = gridState.resolvedFrames[shapeId].frame;
    await page.locator(`#design-layer-list [data-layer-id="${shapeId}"] .design-layer-select`).click();
    assert.equal(await page.locator("#design-layout-positioning-field").isVisible(), true, "Auto Layout children expose flow/absolute positioning");
    const mobilePositionControl = await page.locator("#design-layout-positioning").evaluate((control) => control.getBoundingClientRect().toJSON());
    assert.ok(mobilePositionControl.height >= 43 && mobilePositionControl.left >= 0 && mobilePositionControl.right <= 390,
      `the positioning control remains touch-sized on a phone: ${JSON.stringify(mobilePositionControl)}`);
    await page.locator("#design-layout-positioning").selectOption("absolute");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    gridState = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(gridState.nodes[shapeId].layoutPositioning, "absolute");
    assert.deepEqual(gridState.nodes[shapeId].flowGrid?.placement, { row: 1, column: 1, rowSpan: 1, columnSpan: 2 },
      "the previous cell placement is retained while the child is absolute");
    for (const key of ["x", "y", "width", "height"])
      assert.ok(Math.abs(gridState.resolvedFrames[shapeId].frame[key] - gridFrameBeforeAbsolute[key]) < 1e-8,
        `switching to absolute preserves the live grid child's ${key}`);
    assert.equal(await page.locator("#design-x").isDisabled(), false, "absolute Auto Layout children can edit X position");
    assert.equal(await page.locator("#design-grid-placement").isVisible(), false, "absolute children hide flow-only grid controls");
    const absoluteX = gridState.resolvedFrames[shapeId].frame.x, pageWidth = gridState.variant.width;
    await page.locator("#design-x").fill(String((absoluteX + 18 / pageWidth) * pageWidth));
    await page.locator("#design-x").press("Tab");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    gridState = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.ok(Math.abs(gridState.resolvedFrames[shapeId].frame.x - absoluteX - 18 / pageWidth) < 1e-6,
      "an absolute child's position edit updates the live page preview");
    await page.locator("#design-layout-positioning").selectOption("auto");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    gridState = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(gridState.nodes[shapeId].layoutPositioning, undefined);
    assert.deepEqual(gridState.nodes[shapeId].gridPlacement, { row: 1, column: 1, rowSpan: 1, columnSpan: 2 },
      "returning to flow restores the saved grid cell");
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.locator(`#design-layer-list [data-layer-id="${frameId}"] .design-layer-select`).click();
    await page.locator("#design-layout-columns").fill("2");
    await page.locator("#design-layout-columns").press("Tab");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    gridState = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(gridState.nodes[frameId].style.layout.columns, 2);
    assert.ok(gridState.resolvedFrames[gridOtherId].frame.y > gridState.resolvedFrames[shapeId].frame.y,
      "reducing the picker count keeps automatic children and flows the overflow into an auto row");
    await page.locator(`#design-layer-list [data-layer-id="${frameId}"] .design-layer-select`).click();
    await page.locator("#design-frame-layout").selectOption("horizontal");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const restoredFlow = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(restoredFlow.nodes[frameId].style.layout.columns, undefined, "switching out of grid removes grid-only track settings");
    assert.equal(restoredFlow.nodes[shapeId].gridPlacement, undefined, "switching flow removes stale per-cell placement data");
    await page.locator("#design-layout-wrap").check();
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
    await page.locator(`#design-layer-list [data-layer-id="${selectedId}"] .design-layer-select`).click();
    await page.locator("#design-opacity").scrollIntoViewIfNeeded();
    const mobileOpacity = await page.locator("#design-opacity").boundingBox();
    assert.ok(mobileOpacity?.height >= 43 && mobileOpacity.x >= 0 && mobileOpacity.x + mobileOpacity.width <= 390,
      `mobile layer opacity stays touch-sized and on-screen: ${JSON.stringify(mobileOpacity)}`);
    await page.locator(`#design-layer-list [data-layer-id="${otherImageId}"] .design-layer-select`).click({ modifiers: ["Shift"] });
    await page.waitForFunction(() => window.tinyImageStarDesign.getSnapshot().selection.length === 2);
    const mobileMulti = await page.evaluate(() => ({ width: innerWidth,
      fields: [...document.querySelectorAll("#design-multi-transform input, #design-multi-opacity")]
        .map((input) => input.getBoundingClientRect().toJSON()) }));
    assert.equal(mobileMulti.fields.length, 5);
    assert.ok(mobileMulti.fields.every((box) => box.height >= 43 && box.left >= 0 && box.right <= mobileMulti.width),
      `multi-selection geometry and opacity stay touch-sized and in viewport: ${JSON.stringify(mobileMulti.fields)}`);
    await page.locator(`#design-layer-list [data-layer-id="${selectedId}"] .design-layer-select`).click();
    await page.waitForFunction(() => window.tinyImageStarDesign.getSnapshot().selection.length === 1);
    await page.locator("#design-crop-tool").scrollIntoViewIfNeeded();
    const mobileCropLayout = await page.evaluate(() => ({ width: innerWidth,
      buttons: [...document.querySelectorAll("#design-image-adjustments .design-image-crop-actions .button")]
        .map((button) => button.getBoundingClientRect().toJSON()) }));
    assert.equal(mobileCropLayout.buttons.length, 2, "mobile image inspector exposes crop and reset actions");
    assert.ok(mobileCropLayout.buttons.every((box) => box.height >= 43 && box.left >= 0 && box.right <= mobileCropLayout.width),
      `mobile crop actions remain touch-sized and on-screen: ${JSON.stringify(mobileCropLayout.buttons)}`);
    await page.locator("#design-crop-tool").click();
    assert.equal(await page.locator("#design-crop-tool").getAttribute("aria-pressed"), "true", "crop mode is directly reachable on a phone");
    await page.locator("#design-crop-tool").click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().cropModeId !== id, selectedId);
    await page.locator(`#design-layer-list [data-layer-id="${shapeId}"] .design-layer-select`).click();
    const mobileResizing = await page.evaluate(() => ({
      visible: !document.querySelector("#design-resizing-options")?.hidden,
      fields: [...document.querySelectorAll("#design-resizing-options select")].map((node) => node.getBoundingClientRect().toJSON()),
      boundsVisible: !document.querySelector("#design-layout-min-max")?.hidden,
      bounds: [...document.querySelectorAll("#design-layout-min-max input")].map((node) => node.getBoundingClientRect().toJSON()),
      width: innerWidth,
    }));
    assert.equal(mobileResizing.visible, true, "mobile inspector exposes Auto Layout resizing controls");
    assert.ok(mobileResizing.fields.length === 2 && mobileResizing.fields.every((box) => box.height >= 43 && box.left >= 0 && box.right <= mobileResizing.width),
      `Auto Layout sizing controls remain touch-sized and on-screen: ${JSON.stringify(mobileResizing.fields)}`);
    assert.equal(mobileResizing.boundsVisible, true, "mobile inspector exposes Auto Layout min/max sizing controls");
    assert.ok(mobileResizing.bounds.length === 4 && mobileResizing.bounds.every((box) => box.height >= 43 && box.left >= 0 && box.right <= mobileResizing.width),
      `Auto Layout size limits remain touch-sized and on-screen: ${JSON.stringify(mobileResizing.bounds)}`);
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
    const shapeToolbar = await page.evaluate(() => ({
      selector: document.querySelector("#design-shape-type").getBoundingClientRect().toJSON(),
      add: document.querySelector("#design-add-shape").getBoundingClientRect().toJSON(),
    }));
    assert.ok(shapeToolbar.selector.height >= 43 && shapeToolbar.add.height >= 43
      && shapeToolbar.selector.left >= 0 && shapeToolbar.add.right <= 390,
    `mobile shape controls are large enough to tap and stay in view: ${JSON.stringify(shapeToolbar)}`);
    for (const [index, shape] of ["rectangle", "rounded", "ellipse", "line", "arrow", "polygon", "star"].entries()) {
      await page.locator("#design-shape-type").selectOption(shape);
      await page.locator("#design-add-shape").click();
      await page.waitForFunction((count) => window.tinyImageStarDesign.getSnapshot().pages[1].nodeIds.length === count, index + 1);
      await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    }
    const shapePage = await page.evaluate(() => {
      const snapshot = window.tinyImageStarDesign.getSnapshot();
      return snapshot.pages[1].nodeIds.map((id) => snapshot.nodes[id]);
    });
    assert.deepEqual(shapePage.map((node) => node.name), ["Rectangle", "Rounded rectangle", "Ellipse", "Line", "Arrow", "Polygon", "Star"]);
    assert.equal(shapePage[3].style.path.closed, false, "Line is an open stroked path");
    assert.ok(shapePage[3].style.strokeWidth > 0);
    assert.ok(shapePage.slice(4).every((node) => node.style.shape === "path" && node.style.path.closed),
      "Arrow, polygon and star are normal editable closed vector paths");
    assert.deepEqual(shapePage[5].style.primitive, { type: "polygon", sides: 6 }, "polygons retain editable side-count metadata");
    assert.deepEqual(shapePage[6].style.primitive, { type: "star", sides: 5, innerRadius: .46 }, "stars retain their editable geometry parameters");
    await page.locator(`#design-layer-list [data-layer-id="${shapePage[6].id}"] .design-layer-select`).click();
    assert.equal(await page.locator("#design-vector-primitive").isVisible(), true, "parametric vector controls appear for an untouched star");
    assert.equal(await page.locator("#design-vector-inner-radius-field").isVisible(), true);
    await page.locator("#design-vector-count").fill("7");
    await page.locator("#design-vector-count").press("Tab");
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.primitive.sides === 7, shapePage[6].id);
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    let tunedStar = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id], shapePage[6].id);
    assert.equal(tunedStar.style.path.points.length, 14, "increasing the point count regenerates the same star layer");
    const innerRadiusBox = await page.locator("#design-vector-inner-radius").boundingBox();
    await page.mouse.click(innerRadiusBox.x + innerRadiusBox.width * ((.3 - .12) / (.85 - .12)), innerRadiusBox.y + innerRadiusBox.height / 2);
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.primitive.innerRadius < .4, shapePage[6].id);
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    tunedStar = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id], shapePage[6].id);
    assert.ok(tunedStar.style.primitive.innerRadius < .4 && tunedStar.style.path.points.length === 14,
      "the star inner-radius control updates its live polygon points");
    await page.locator("#design-undo").click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.primitive.innerRadius === .46, shapePage[6].id);
    await page.locator("#design-redo").click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.primitive.innerRadius < .4, shapePage[6].id);
    await page.locator("#design-edit-vector").click();
    const starAnchor = await page.evaluate((id) => {
      const canvas = document.querySelector("#design-canvas"), bounds = canvas.getBoundingClientRect(), state = window.tinyImageStarDesign.getSnapshot();
      const frame = state.resolvedFrames[id].frame, point = state.nodes[id].style.path.points[0], view = state.canvas.geometry;
      return { x: bounds.left + view.x + (frame.x + point.x * frame.width) * view.width * view.scale,
        y: bounds.top + view.y + (frame.y + point.y * frame.height) * view.height * view.scale };
    }, shapePage[6].id);
    await page.mouse.move(starAnchor.x, starAnchor.y); await page.mouse.down();
    await page.mouse.move(starAnchor.x + 12, starAnchor.y + 8, { steps: 3 }); await page.mouse.up();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.primitive === undefined, shapePage[6].id);
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    await page.locator("#design-undo").click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.primitive.innerRadius < .4, shapePage[6].id);
    await page.locator("#design-redo").click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.primitive === undefined, shapePage[6].id);
    await page.locator(`#design-layer-list [data-layer-id="${shapePage[5].id}"] .design-layer-select`).click();
    assert.equal(await page.locator("#design-vector-inner-radius-field").isVisible(), false,
      "polygon controls do not show star-only settings");
    await page.locator(`#design-layer-list [data-layer-id="${shapePage[0].id}"] .design-layer-select`).click();
    await page.locator(`#design-layer-list [data-layer-id="${shapePage[1].id}"] .design-layer-select`).click({ modifiers: ["Shift"] });
    await page.locator("#design-frame-selection").click();
    await page.waitForFunction(() => window.tinyImageStarDesign.getSnapshot().pages[1].nodeIds.length === 8);
    const gridFrameId = await page.evaluate(() => {
      const snapshot = window.tinyImageStarDesign.getSnapshot();
      return snapshot.pages[1].nodeIds.find((id) => snapshot.nodes[id].kind === "frame");
    });
    await page.locator(`#design-layer-list [data-layer-id="${gridFrameId}"] .design-layer-select`).click();
    await page.locator("#design-frame-layout").selectOption("grid");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    await page.locator('#design-grid-column-tracks [data-grid-track-index="0"][data-grid-track-control="mode"]').selectOption("fixed");
    await page.locator('#design-grid-column-tracks [data-grid-track-index="0"][data-grid-track-control="value"]').fill("72");
    await page.locator('#design-grid-column-tracks [data-grid-track-index="0"][data-grid-track-control="value"]').press("Tab");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    await page.locator('#design-grid-column-tracks [data-grid-track-index="0"][data-grid-track-action="move-after"]').click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    let trackState = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.deepEqual(trackState.nodes[gridFrameId].style.layout.columnTracks.slice(0, 2), [
      { mode: "fill", value: 1 }, { mode: "fixed", value: 72 },
    ], "track controls reorder the sizing rule and cells as one undoable operation");
    await page.locator("#design-grid-add-column").click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    trackState = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(trackState.nodes[gridFrameId].style.layout.columns, 3, "the inspector can append a responsive track");
    await page.locator('#design-grid-column-tracks [data-grid-track-index="2"][data-grid-track-action="delete"]').click();
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    trackState = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(trackState.nodes[gridFrameId].style.layout.columns, 2, "deleting an empty track preserves the other tracks");
    const gridTrackDrag = await page.evaluate((id) => {
      const state = window.tinyImageStarDesign.getSnapshot(), metrics = state.gridTracks;
      const canvas = document.querySelector("#design-canvas"), rect = canvas.getBoundingClientRect(), view = state.canvas.geometry;
      const frame = state.resolvedFrames[id].frame, center = { x: (frame.x + frame.width / 2) * state.variant.width,
        y: (frame.y + frame.height / 2) * state.variant.height };
      const angle = metrics.rotation * Math.PI / 180;
      const screenForLocal = (local) => {
        const dx = local.x - metrics.width / 2, dy = local.y - metrics.height / 2;
        const pagePoint = { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
        return { x: rect.left + view.x + pagePoint.x * view.scale, y: rect.top + view.y + pagePoint.y * view.scale };
      };
      const screen = screenForLocal({ x: metrics.columns[0].end, y: metrics.height / 2 });
      const target = screenForLocal({ x: metrics.columns[0].end + 18 / view.scale, y: metrics.height / 2 });
      const fire = (type, pointerId, x, y, pointerType = "touch", buttons = 1) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true,
        cancelable: true, pointerId, pointerType, isPrimary: true, button: 0, buttons, clientX: x, clientY: y }));
      const before = state.nodes[id].style.layout.columnTracks?.[0] ?? { mode: "fill", value: 1 };
      fire("pointerdown", 84, screen.x, screen.y);
      fire("pointermove", 84, target.x, target.y);
      const preview = window.tinyImageStarDesign.getSnapshot().nodes[id].style.layout.columnTracks[0];
      fire("pointercancel", 84, target.x, target.y, "touch", 0);
      const cancelled = window.tinyImageStarDesign.getSnapshot().nodes[id].style.layout.columnTracks?.[0] ?? { mode: "fill", value: 1 };
      fire("pointerdown", 85, screen.x, screen.y);
      fire("pointermove", 85, target.x, target.y);
      const during = window.tinyImageStarDesign.getSnapshot().nodes[id].style.layout.columnTracks[0];
      fire("pointerup", 85, target.x, target.y, "touch", 0);
      return { before, preview, cancelled, during, after: window.tinyImageStarDesign.getSnapshot().nodes[id].style.layout.columnTracks[0],
        expected: Math.round((metrics.columns[0].size + 18 / view.scale) * 100) / 100 };
    }, gridFrameId);
    assert.equal(gridTrackDrag.preview.mode, "fixed", "dragging a grid divider previews a fixed pixel track on the canvas");
    assert.deepEqual(gridTrackDrag.cancelled, gridTrackDrag.before, "pointer cancellation restores the original track definition");
    assert.deepEqual(gridTrackDrag.after, { mode: "fixed", value: gridTrackDrag.expected }, "touch dragging resizes a track using page-pixel units");
    assert.equal(gridTrackDrag.during.mode, "fixed", "the mobile divider handle previews before the gesture commits");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const afterGridTrackDrag = await page.evaluate((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].style.layout.columnTracks[0], gridFrameId);
    assert.deepEqual(afterGridTrackDrag, gridTrackDrag.after, "the committed canvas track size remains applied after the live preview");
    await page.locator("#design-undo").click();
    await page.waitForFunction((expected) => window.tinyImageStarDesign.getSnapshot().nodes[expected.id].style.layout.columnTracks[0].mode === expected.mode,
      { id: gridFrameId, mode: gridTrackDrag.before.mode });
    await page.locator("#design-redo").click();
    await page.waitForFunction((expected) => window.tinyImageStarDesign.getSnapshot().nodes[expected.id].style.layout.columnTracks[0].value === expected.value,
      { id: gridFrameId, value: gridTrackDrag.after.value });
    const gridTrackReorder = await page.evaluate((id) => {
      const state = window.tinyImageStarDesign.getSnapshot(), metrics = state.gridTracks;
      const canvas = document.querySelector("#design-canvas"), rect = canvas.getBoundingClientRect(), view = state.canvas.geometry;
      const frame = state.resolvedFrames[id].frame, center = { x: (frame.x + frame.width / 2) * state.variant.width,
        y: (frame.y + frame.height / 2) * state.variant.height };
      const angle = metrics.rotation * Math.PI / 180;
      const screenForLocal = (local) => {
        const dx = local.x - metrics.width / 2, dy = local.y - metrics.height / 2;
        const pagePoint = { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
        return { x: rect.left + view.x + pagePoint.x * view.scale, y: rect.top + view.y + pagePoint.y * view.scale };
      };
      const gripY = Math.min(metrics.height / 2, Math.max(8, metrics.padding.top / 2));
      const start = screenForLocal({ x: metrics.columns[0].start + metrics.columns[0].size / 2, y: gripY });
      const target = screenForLocal({ x: metrics.columns[1].start + metrics.columns[1].size * .75, y: gripY });
      const fire = (type, pointerId, x, y, buttons = 1) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true,
        pointerId, pointerType: "touch", isPrimary: true, button: 0, buttons, clientX: x, clientY: y }));
      const childIds = state.pages[1].nodeIds.filter((childId) => state.nodes[childId].parentId === id);
      const childColumns = (snapshot) => childIds.map((childId, index) => snapshot.nodes[childId].gridPlacement?.column ?? index + 1);
      const before = state.nodes[id].style.layout.columnTracks.map((track) => ({ ...track }));
      const beforeColumns = childColumns(state);
      fire("pointerdown", 87, start.x, start.y); fire("pointermove", 87, target.x, target.y);
      const during = window.tinyImageStarDesign.getSnapshot(), duringTracks = during.nodes[id].style.layout.columnTracks;
      const duringColumns = childColumns(during);
      fire("pointerup", 87, target.x, target.y, 0);
      const after = window.tinyImageStarDesign.getSnapshot();
      return { before, beforeColumns, duringTracks, duringColumns, expectedColumns: [...beforeColumns].reverse(),
        after: after.nodes[id].style.layout.columnTracks };
    }, gridFrameId);
    assert.deepEqual(gridTrackReorder.beforeColumns, [2, 1], "track grips begin from the current rendered grid cell order");
    assert.deepEqual(gridTrackReorder.duringTracks, [...gridTrackReorder.before].reverse(), "dragging a canvas grip previews track order in place");
    assert.deepEqual(gridTrackReorder.duringColumns, gridTrackReorder.expectedColumns, "objects attached to the moved tracks retain their cell relationship");
    assert.deepEqual(gridTrackReorder.after, gridTrackReorder.duringTracks, "the drop commits the canvas track order");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    await page.locator("#design-undo").click();
    await page.waitForFunction((expected) => JSON.stringify(window.tinyImageStarDesign.getSnapshot().nodes[expected.id].style.layout.columnTracks)
      === JSON.stringify(expected.tracks), { id: gridFrameId, tracks: gridTrackReorder.before });
    await page.locator("#design-redo").click();
    await page.waitForFunction((expected) => window.tinyImageStarDesign.getSnapshot().nodes[expected.id].style.layout.columnTracks[0].value
      === expected.value, { id: gridFrameId, value: gridTrackReorder.after[0].value });
    await page.locator("#design-undo").click();
    await page.waitForFunction((expected) => JSON.stringify(window.tinyImageStarDesign.getSnapshot().nodes[expected.id].style.layout.columnTracks)
      === JSON.stringify(expected.tracks), { id: gridFrameId, tracks: gridTrackReorder.before });
    const gridChildId = await page.evaluate((id) => {
      const snapshot = window.tinyImageStarDesign.getSnapshot();
      return snapshot.pages[1].nodeIds.find((childId) => snapshot.nodes[childId].parentId === id);
    }, gridFrameId);
    await page.locator(`#design-layer-list [data-layer-id="${gridChildId}"] .design-layer-select`).click();
    await page.locator("#design-grid-align-horizontal").selectOption("center");
    await page.locator("#design-grid-align-vertical").selectOption("end");
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const gridSaved = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(gridSaved.nodes[gridFrameId].style.layout.direction, "grid");
    assert.equal(gridSaved.nodes[gridFrameId].style.layout.rows, 0, "saved grid layouts retain auto-row behavior");
    assert.deepEqual(gridSaved.nodes[gridFrameId].style.layout.columnTracks[1], { mode: "fixed", value: 72 },
      "custom fixed track sizing survives track reordering and is stored with the local page");
    assert.deepEqual(gridSaved.nodes[gridChildId].gridAlignment, { horizontal: "center", vertical: "end" },
      "per-cell alignment is saved with the page child");
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
    assert.equal(reopened.pages[0].nodeIds.length, 6, "saved image, text, shapes, vector path and frame layers reopen together");
    assert.equal(reopened.pages[1].nodeIds.length, 8, "all mobile-added shapes and their grid frame survive local save and reload");
    assert.equal(reopened.nodes[gridFrameId].style.layout.direction, "grid", "grid flow survives local project reload");
    assert.equal(reopened.nodes[gridFrameId].style.layout.columns, 2);
    assert.deepEqual(reopened.nodes[gridFrameId].style.layout.columnTracks[1], { mode: "fixed", value: 72 },
      "per-track size modes and their reordered positions survive local project reload");
    assert.deepEqual(reopened.nodes[gridChildId].gridAlignment, { horizontal: "center", vertical: "end" },
      "per-cell alignment survives local project reload");
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
    assert.equal(bulkDeleted.pages[1].nodeIds.length, 8, "keyboard bulk delete leaves layers on the other page untouched");
    assert.deepEqual(Object.keys(bulkDeleted.nodes).sort(), [...bulkDeleted.pages[1].nodeIds].sort(),
      "keyboard bulk delete removes every selected canvas layer and preserves other-page shapes");

    await page.waitForFunction(() => document.querySelector("#design-save-status")?.textContent === "Saved on this device");
    const story = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const source = new File([bytes], "shared-story-photo.png", { type: "image/png" });
      const [{ importStoryPhotos }, { createSceneProject }, { writeStoryProject }] = await Promise.all([
        import("/src/story/assets.js"), import("/src/project/model.js"), import("/src/project/storage.js"),
      ]);
      const [photo] = await importStoryPhotos([source]);
      const layerId = "shared-story-photo-layer", slideId = "shared-story-slide";
      const project = createSceneProject({ id: "shared-story-document", name: "Shared story document", assets: { [photo.asset.id]: photo.asset },
        nodes: { [layerId]: { id: layerId, kind: "image", name: "Story photo", visible: true, locked: false, assetId: photo.asset.id,
          space: "slide", frame: { x: .1, y: .1, width: .8, height: .8 }, fit: "contain", focal: { x: .5, y: .5 } } },
        slides: [{ id: slideId, name: "Story page", nodeIds: [layerId], overrides: {} }],
        variants: [{ id: "story-page", width: 1920, height: 1080 }] });
      const saved = await writeStoryProject(project, { readAsset: (id) => id === photo.asset.id ? photo.source : null });
      return { key: saved.key, assetId: photo.asset.id, layerId, sha256: photo.asset.sha256 };
    }, image.toString("base64"));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction((key) => window.tinyImageStarDesign.getSnapshot()?.key === key, story.key);
    await page.locator("#mobile-more-button").click();
    await page.locator("#design-button").click();
    await page.waitForFunction(() => !document.querySelector("#design-view")?.hidden);
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    const shared = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(shared.name, "Shared story document", "the page workspace opens a saved story document");
    assert.equal(shared.retainedSourceBytes, image.byteLength, "the opened story's original image is retained for live editing");
    assert.equal(shared.assets[story.assetId].sha256, story.sha256, "opening keeps the story's original asset identity");
    assert.ok(await page.locator("#design-open-file option").filter({ hasText: "Story · Shared story document" }).count(),
      "the local document picker identifies saved story projects");
    await page.locator(`#design-layer-list [data-layer-id="${story.layerId}"] .design-layer-select`).click();
    await page.locator("#design-brightness").evaluate((input) => {
      input.value = "1.25"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    await page.waitForFunction(() => document.querySelector("#design-save-status")?.textContent === "Saved on this device");
    const reopenedStory = await page.evaluate(async ({ key, assetId }) => {
      const { readStoryProject } = await import("/src/project/storage.js");
      const saved = await readStoryProject(key);
      return { revision: saved.revision, node: saved.project.nodes["shared-story-photo-layer"], asset: saved.project.assets[assetId] };
    }, { key: story.key, assetId: story.assetId });
    assert.equal(reopenedStory.node.appearance.brightness, 1.25, "edits through the shared page canvas save back as a story project");
    assert.ok(reopenedStory.revision > 0, "editing the shared story advances its saved revision");
    assert.equal(reopenedStory.asset.sha256, story.sha256, "saving through the page canvas preserves the story's verified original asset");

    await page.locator(`#design-layer-list [data-layer-id="${story.layerId}"]`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Create component", exact: true }).click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].componentDefinition === true, story.layerId);
    await page.locator(`#design-layer-list [data-layer-id="${story.layerId}"]`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Create instance", exact: true }).click();
    await page.waitForFunction(() => Object.values(window.tinyImageStarDesign.getSnapshot().nodes).some((node) => node.componentInstanceOf));
    let componentSnapshot = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    const componentInstanceId = Object.values(componentSnapshot.nodes).find((node) => node.componentInstanceOf === story.layerId).id;
    assert.equal(componentSnapshot.nodes[componentInstanceId].assetId, componentSnapshot.nodes[story.layerId].assetId,
      "component instances keep the retained original image attached");
    assert.equal(componentSnapshot.retainedSourceBytes, image.byteLength, "component creation does not copy or release the retained source");
    await page.locator(`#design-layer-list [data-layer-id="${story.layerId}"] .design-layer-select`).click();
    await page.locator("#design-brightness").evaluate((input) => {
      input.value = "1.5"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].appearance.brightness === 1.5
      && document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"), componentInstanceId);
    componentSnapshot = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(componentSnapshot.nodes[componentInstanceId].appearance.brightness, 1.5, "a master edit updates its in-page preview instance");
    await page.locator(`#design-layer-list [data-layer-id="${componentInstanceId}"] .design-layer-select`).click();
    await page.locator("#design-brightness").evaluate((input) => {
      input.value = "1.75"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].componentOverrides.includes("appearance"), componentInstanceId);
    await page.locator(`#design-layer-list [data-layer-id="${story.layerId}"] .design-layer-select`).click();
    await page.locator("#design-brightness").evaluate((input) => {
      input.value = "1.6"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(({ masterId, instanceId }) => {
      const snapshot = window.tinyImageStarDesign.getSnapshot();
      return snapshot.nodes[masterId].appearance.brightness === 1.6
        && snapshot.nodes[instanceId].appearance.brightness === 1.75
        && document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready");
    }, { masterId: story.layerId, instanceId: componentInstanceId });
    componentSnapshot = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(componentSnapshot.nodes[story.layerId].appearance.brightness, 1.6);
    assert.equal(componentSnapshot.nodes[componentInstanceId].appearance.brightness, 1.75, "master edits preserve an instance override");
    await page.waitForFunction(() => document.querySelector("#design-save-status")?.textContent === "Saved on this device");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction((key) => window.tinyImageStarDesign.getSnapshot()?.key === key, story.key);
    await page.locator("#mobile-more-button").click();
    await page.locator("#design-button").click();
    await page.waitForFunction(() => !document.querySelector("#design-view")?.hidden);
    await page.waitForFunction(() => document.querySelector("#design-canvas-status")?.textContent?.includes("Preview ready"));
    componentSnapshot = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(componentSnapshot.nodes[story.layerId].componentDefinition, true, "component definitions survive local save and reload");
    assert.equal(componentSnapshot.nodes[componentInstanceId].componentInstanceOf, story.layerId, "linked instances survive local save and reload");
    assert.ok(componentSnapshot.nodes[componentInstanceId].componentOverrides.includes("appearance"), "instance property overrides survive local save and reload");
    assert.ok(componentSnapshot.nodes[componentInstanceId].componentOverrides.includes("frame.x")
      && componentSnapshot.nodes[componentInstanceId].componentOverrides.includes("frame.y"), "independent instance placement survives local save and reload");
    await page.locator(`#design-layer-list [data-layer-id="${componentInstanceId}"]`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Reset overrides", exact: true }).click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].appearance.brightness === 1.6, componentInstanceId);
    await page.locator(`#design-layer-list [data-layer-id="${componentInstanceId}"]`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Detach instance", exact: true }).click();
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].componentInstanceOf == null, componentInstanceId);
    await page.locator(`#design-layer-list [data-layer-id="${story.layerId}"] .design-layer-select`).click();
    await page.locator("#design-brightness").evaluate((input) => {
      input.value = "1.9"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction((id) => window.tinyImageStarDesign.getSnapshot().nodes[id].appearance.brightness === 1.9, story.layerId);
    componentSnapshot = await page.evaluate(() => window.tinyImageStarDesign.getSnapshot());
    assert.equal(componentSnapshot.nodes[componentInstanceId].appearance.brightness, 1.6, "a detached local copy stops following master edits");
    await page.setViewportSize({ width: 390, height: 844 });
    const componentRow = page.locator(`#design-layer-list [data-layer-id="${story.layerId}"]`);
    await componentRow.evaluate((row) => {
      const bounds = row.getBoundingClientRect();
      row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 7, pointerType: "touch", button: 0,
        clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
    });
    await page.waitForTimeout(600);
    await componentRow.evaluate((row) => row.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, pointerType: "touch", button: 0 })));
    assert.equal(await page.getByRole("menuitem", { name: "Create instance", exact: true }).isVisible(), true,
      "a phone long-press opens the component menu without a mouse right-click");
    await page.keyboard.press("Escape");
    await page.locator(`#design-layer-list [data-layer-id="${story.layerId}"] .design-layer-select`).focus();
    await page.locator(`#design-layer-list [data-layer-id="${story.layerId}"] .design-layer-select`).press("Shift+F10");
    assert.equal(await page.getByRole("menuitem", { name: "Create instance", exact: true }).isVisible(), true,
      "the same component menu is keyboard accessible");
    await page.keyboard.press("Escape");
    console.log("  design workspace: retained sources, live image/vector previews, Pen Béziers, shape tools, Auto Layout, linked components, recipes, autosave and phone layout");
  } finally { await context.close(); }
}
