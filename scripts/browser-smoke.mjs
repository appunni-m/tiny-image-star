import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";

const root = resolve(process.env.TINY_STAR_BROWSER_ROOT ?? fileURLToPath(new URL("..", import.meta.url)));
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".wasm": "application/wasm", ".json": "application/json" };

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(name, payload) {
  const type = Buffer.from(name); const output = Buffer.alloc(12 + payload.length);
  output.writeUInt32BE(payload.length, 0); type.copy(output, 4); payload.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([type, payload])), 8 + payload.length);
  return output;
}
function makePhoto(width = 640, height = 480) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1); pixels[row] = 0;
    for (let x = 0; x < width; x++) {
      const offset = row + 1 + x * 4;
      pixels[offset] = Math.round(30 + 180 * x / width);
      pixels[offset + 1] = Math.round(45 + 150 * y / height);
      pixels[offset + 2] = Math.round(110 + 100 * Math.sin(x / width * Math.PI));
      pixels[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const path = resolve(root, relative);
    if (!path.startsWith(`${root}${sep}`)) throw new Error("Invalid path");
    const bytes = await readFile(path);
    response.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    response.end(bytes);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end("Not found");
  }
});
await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 768 } });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: "networkidle" });
  assert.equal(await page.locator("#layer-tree .layer-row[data-id]").count(), 26, "starter file exposes editable layer rows");
  assert.equal(await page.locator("#canvas-stage").evaluate((element) => element.clientHeight > 500), true, "canvas stage fills the desktop workspace");
  await page.evaluate(() => { window.__canvasBeforeImageEdit = document.querySelector("#design-canvas"); });

  await page.locator('#layer-tree .layer-row[data-id="hero-heading"]').click();
  const originalWidth = Number(await page.locator('[data-prop="w"]').inputValue());
  const handle = await page.evaluate(() => {
    const canvas = document.querySelector("#design-canvas"); const bounds = canvas.getBoundingClientRect();
    const scale = Number.parseFloat(document.querySelector("#zoom-value").textContent) / 100;
    return {
      x: bounds.left + (canvas.clientWidth - 1440 * scale) / 2 + (92 + 592) * scale,
      y: bounds.top + (canvas.clientHeight - 1000 * scale) / 2 + (286 + 176) * scale,
      scale,
    };
  });
  await page.mouse.move(handle.x, handle.y); await page.mouse.down();
  await page.mouse.move(handle.x + 40, handle.y + 18); await page.mouse.up();
  const resizedWidth = Number(await page.locator('[data-prop="w"]').inputValue());
  assert.ok(resizedWidth > originalWidth + 30, "canvas corner handle resizes the selected text layer");
  await page.locator("#design-canvas").focus();
  const originalX = Number(await page.locator('[data-prop="x"]').inputValue());
  await page.keyboard.press("ArrowRight");
  assert.equal(Number(await page.locator('[data-prop="x"]').inputValue()), originalX + 1, "arrow key nudges the selected layer by one design pixel");

  await page.locator("#add-page").click();
  assert.equal(await page.locator("#page-list .page-row").count(), 2, "a design can contain multiple pages");
  assert.equal(await page.locator("#active-page-name").textContent(), "Page 2", "new page becomes active immediately");
  await page.locator('[data-tool="rectangle"]').click();
  const stageBox = await page.locator("#design-canvas").boundingBox();
  await page.mouse.click(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
  assert.equal(await page.locator("#layer-tree .layer-row[data-id]").count(), 1, "new page layers are independent");
  await page.locator("#page-list .page-row").last().click({ button: "right" });
  const renameDialogPromise = page.waitForEvent("dialog").then(async (dialog) => { assert.equal(dialog.type(), "prompt"); await dialog.accept("Layouts"); });
  await page.locator('#context-menu [data-action="rename-page"]').click();
  await renameDialogPromise;
  assert.equal(await page.locator("#page-list .page-row").last().locator(".page-name").textContent(), "Layouts", "pages can be renamed locally");
  await page.locator("#page-list .page-row").first().click();
  assert.equal(await page.locator("#layer-tree .layer-row[data-id]").count(), 26, "switching pages restores the first page's layer tree");
  await page.locator("#page-list .page-row").last().click();
  assert.equal(await page.locator("#layer-tree .layer-row[data-id]").count(), 1, "switching back restores the new page's own layers");
  await page.locator("#page-list .page-row").first().click();

  const photo = makePhoto();
  await page.locator("#image-input").setInputFiles([
    { name: "north-coast.png", mimeType: "image/png", buffer: photo },
    { name: "pine-ridge.png", mimeType: "image/png", buffer: photo },
  ]);
  const first = page.locator("#layer-tree .layer-row[data-id]").filter({ hasText: "north-coast" });
  const second = page.locator("#layer-tree .layer-row[data-id]").filter({ hasText: "pine-ridge" });
  await first.waitFor({ state: "visible" }); await first.click();
  await page.locator('[data-adjustment="brightness"]').evaluate((input) => {
    input.value = "25"; input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector(".image-engine-status")?.textContent.includes("WASM preview ready"), null, { timeout: 30_000 });
  assert.match(await page.locator(".image-engine-status").textContent(), /original held in memory/, "local WASM rendering keeps the editable source in memory");

  await page.locator('[data-action="save-recipe"]').click();
  await page.locator("#recipe-name-input").fill("Alpine morning");
  await page.locator("#recipe-save-button").click();
  await second.click({ modifiers: ["Meta"] });
  assert.equal(await page.locator("#layer-tree .layer-row.selected").count(), 2, "Command-click selects multiple image layers");
  await second.click({ button: "right" });
  await page.locator('#context-menu button[data-action="apply-recipe"]').filter({ hasText: "Alpine morning" }).click();
  await page.waitForFunction(() => document.querySelector("#job-bar")?.hidden === true
    && document.querySelector("#canvas-message")?.textContent.includes("Recipe applied to 2 images"), null, { timeout: 30_000 });
  assert.equal(await page.evaluate(() => document.querySelector("#design-canvas") === window.__canvasBeforeImageEdit), true, "adjusted previews remain on the same live canvas");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tiny-image-star-design-recipes-v1"))?.[0]?.name), "Alpine morning");
  await page.locator("#file-menu-button").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator('#file-menu [data-action="save-file"]').click();
  const download = await downloadPromise;
  const savedProject = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(savedProject.pages.length, 2, "local project export keeps every design page");
  assert.equal(savedProject.assets.length, 2, "local project export carries in-memory image originals");
  const invalidLayers = savedProject.pages.flatMap((savedPage) => savedPage.nodes.filter((node) => !node || typeof node.id !== "string"
    || !["text", "rect", "ellipse", "frame", "image", "landscape"].includes(node.type)
    || ![node.x, node.y, node.w, node.h].every(Number.isFinite) || node.w <= 0 || node.h <= 0).map((node) => ({ page: savedPage.name, id: node?.id, type: node?.type, x: node?.x, y: node?.y, w: node?.w, h: node?.h })));
  assert.deepEqual(invalidLayers, [], "project export contains only valid editable layers");
  await page.evaluate(() => document.querySelector("#toast").classList.remove("visible"));
  await page.locator("#project-input").setInputFiles({ name: "round-trip.tstar", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(savedProject)) });
  await page.waitForFunction(() => document.querySelector("#toast")?.classList.contains("visible"), null, { timeout: 10_000 });
  assert.equal(await page.locator("#toast").textContent(), "Local project opened", "project round-trip reports successful open");
  assert.equal(await page.locator("#page-list .page-row").count(), 2, "multi-page local project opens with both pages");
  await page.locator("#page-list .page-row").last().click();
  assert.equal(await page.locator("#layer-tree .layer-row[data-id]").count(), 1, "local project round-trip retains each page's content");
  await page.locator("#page-list .page-row").last().click({ button: "right" });
  const deleteDialogPromise = page.waitForEvent("dialog").then(async (dialog) => { assert.equal(dialog.type(), "confirm"); await dialog.accept(); });
  await page.locator('#context-menu [data-action="delete-page"]').click();
  await deleteDialogPromise;
  assert.equal(await page.locator("#page-list .page-row").count(), 1, "a page can be removed without deleting another page");
  assert.deepEqual(errors, [], "desktop editor has no console or runtime errors");
  console.log("  design workspace: canvas transforms and keyboard nudging; independent pages with image-inclusive local project round-trip; WASM edits and multi-image recipe bar");
  await page.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.goto(origin, { waitUntil: "networkidle" });
  const dimensions = await phone.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, stage: document.querySelector("#canvas-stage").getBoundingClientRect().width }));
  assert.equal(dimensions.document, dimensions.width, "phone layout has no horizontal overflow");
  assert.equal(dimensions.stage, dimensions.width, "canvas uses the available phone width");
  await phone.locator("#mobile-layers").click();
  assert.equal(await phone.locator(".app").evaluate((element) => element.classList.contains("show-layers")), true, "phone can open the layer panel");
  await phone.locator("#mobile-backdrop").click({ position: { x: 350, y: 100 } });
  await phone.locator("#mobile-inspector").click();
  assert.equal(await phone.locator(".app").evaluate((element) => element.classList.contains("show-inspector")), true, "phone can open the design inspector");
  console.log("  mobile workspace: phone-width canvas with reachable layers and inspector panels");
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
