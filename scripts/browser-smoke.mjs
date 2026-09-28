import { waitForAsync } from "../tests/helpers/wait-for-async.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { assertProjectStorage } from "../tests/project-storage.browser.mjs";
import { assertTextCompositor } from "../tests/text-compositor.browser.mjs";
import { assertCreatorStamp } from "../tests/creator-stamp.browser.mjs";
import { assertFolderContracts } from "../tests/folder-contract.browser.mjs";
import { assertFolderSamples } from "../tests/folder-sample.browser.mjs";
import { assertFolderSources } from "../tests/folder-source.browser.mjs";
import { assertSceneCollections } from "../tests/scene-collection.browser.mjs";
import { assertStagedScenes } from "../tests/staged-scene.browser.mjs";
import { assertSceneCompositor } from "../tests/scene-compositor.browser.mjs";
import { assertStoryStorage } from "../tests/story-storage.browser.mjs";
import { assertStoryWorkspace } from "../tests/story-workspace.browser.mjs";
import { assertStoryExports } from "../tests/story-export.browser.mjs";
import { assertStyleStorage } from "../tests/style-storage.browser.mjs";
import { assertLegacyStyles } from "../tests/legacy-styles.browser.mjs";
import { assertRecipeCatalog } from "../tests/recipe-catalog.browser.mjs";
import { assertRecipeSelections, selectRecipeRevision } from "../tests/recipe-selection.browser.mjs";
import { assertHistoricalRecovery } from "../tests/historical-recovery.browser.mjs";
import { assertPhotoLooks } from "../tests/photo-look.browser.mjs";
import { assertOriginAdmission } from "../tests/origin-admission.browser.mjs";
import { assertMasks } from "../tests/masks.browser.mjs";
import { assertMaskDetail } from "../tests/mask-detail.browser.mjs";
import { assertDepthTitles } from "../tests/depth.browser.mjs";
import { assertConnectedCutouts } from "../tests/connections.browser.mjs";
import { assertCutoutEffects } from "../tests/cutout-effects.browser.mjs";
import { assertStoryDesigns } from "../tests/story-designs.browser.mjs";
import { assertStoryFonts } from "../tests/story-fonts.browser.mjs";
import { assertWorkingCopies } from "../tests/working-copies.browser.mjs";
import { assertSourceResolution } from "../tests/source-resolution.browser.mjs";
import { assertDesignWorkspace } from "../tests/design-workspace.browser.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const serverRoot = resolve(process.env.TINY_IMAGE_STAR_BROWSER_ROOT ?? projectRoot);

function assertPngBytes(bytes, label) {
  assert.deepEqual(Array.from(bytes.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], `${label} is PNG`);
}

async function assertPublishedExports(page) {
  const evidence = await page.evaluate(async () => {
    const { createPillowEngine } = await import("./src/engine/pillow.js");
    const engine = await createPillowEngine();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d");
    context.fillStyle = "rgba(80,120,160,0.5)";
    context.fillRect(0, 0, 32, 32);
    const inputPixel = Array.from(context.getImageData(16, 16, 1, 1).data);
    const input = new Uint8Array(await (await new Promise((resolve) => canvas.toBlob(resolve, "image/png"))).arrayBuffer());
    const outputs = [];
    for (const format of engine.capabilities.outputFormats) {
      const result = await engine.render({ name: "transparency.png", bytes: input }, {
        format, rotation: 0, brightness: 1, contrast: 1,
      });
      const bitmap = await createImageBitmap(new Blob([result.bytes], { type: result.mime }));
      context.clearRect(0, 0, 32, 32);
      context.drawImage(bitmap, 0, 0);
      outputs.push({ format, mime: result.mime, width: bitmap.width, height: bitmap.height,
        pixel: Array.from(context.getImageData(16, 16, 1, 1).data) });
      bitmap.close();
    }
    return { capabilities: engine.capabilities, inputPixel, outputs };
  });
  assert.deepEqual(evidence.capabilities.outputFormats, ["png", "jpeg"]);
  assert.equal(evidence.capabilities.compression.quality, false, "published API has fixed settings");
  for (const output of evidence.outputs) {
    assert.equal(output.width, 32, `${output.format} independent decode width`);
    assert.equal(output.height, 32, `${output.format} independent decode height`);
    const expected = output.format === "png" ? evidence.inputPixel : [
      ...evidence.inputPixel.slice(0, 3).map((channel) => Math.round(channel * evidence.inputPixel[3] / 255 + 255 - evidence.inputPixel[3])), 255,
    ];
    const tolerance = output.format === "jpeg" ? 3 : 1; // JPEG rounding; canvas premultiplication rounding.
    output.pixel.forEach((channel, index) => assert.ok(Math.abs(channel - expected[index]) <= tolerance,
      `${output.format} decoded channel ${index}: ${channel} versus ${expected[index]}`));
  }
}

async function assertAppearance(page) {
  for (const theme of ["light", "dark"]) {
    await page.locator("#appearance-select").selectOption(theme);
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    const contrast = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const luminance = (token) => {
        const hex = style.getPropertyValue(token).trim().slice(1);
        const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
          .map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      return [["--text", "--bg"], ["--text", "--panel"], ["--muted", "--panel"],
        ["--accent", "--selected-bg"], ["--accent-ink", "--accent"], ["--warning", "--warning-bg"], ["--danger", "--danger-bg"]]
        .map(([a, b]) => { const x = luminance(a), y = luminance(b); return { pair: `${a}/${b}`, ratio: (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }; });
    });
    for (const pair of contrast) assert.ok(pair.ratio >= 4.5, `${theme} text contrast ${pair.pair}: ${pair.ratio}`);
  }
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("#appearance-select").inputValue(), "dark", "appearance survives reload");
  await page.emulateMedia({ colorScheme: "light" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark", "explicit appearance overrides system");
  await page.locator("#appearance-select").selectOption("system");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
}

async function assertSharedScheduler(page, fixtureSource) {
  const report = await page.evaluate(async (source) => {
    const { getProcessingScheduler } = await import("./src/processing/client.js");
    const { imageWork } = await import("./src/processing/policy.js");
    const pool = getProcessingScheduler();
    await pool.ready();
    const original = Uint8Array.from(atob(source.trim()), (char) => char.charCodeAt(0));
    const runs = [];
    for (const count of [1, 2, 4, 8, 16].filter((count) => count <= pool.budget.cpu)) {
      pool.configure({ fixedConcurrency: count });
      let peak = 0;
      let violations = 0;
      const outputs = [];
      const unsubscribe = pool.subscribe((snapshot) => {
        peak = Math.max(peak, snapshot.active);
        if (snapshot.estimatedBytes > snapshot.memoryBudget || snapshot.active > count) violations++;
      });
      const jobs = Array.from({ length: 24 }, (_, index) => pool.enqueue({
        estimate: imageWork({ width: 8, height: 8, encodedBytes: original.byteLength }),
        prepare: () => {
          const bytes = original.slice().buffer;
          return { message: { type: "process", revision: index, jobId: "concurrency-check", files: [{ id: index, name: "fixture.png", bytes }], settings: { format: "png", brightness: 1, contrast: 1 } }, transfer: [bytes] };
        },
        onMessage: (message) => { if (message.type === "result") outputs.push({ index: message.fileId, revision: message.revision, bytes: message.output }); },
      }));
      await Promise.all(jobs.map((job) => job.promise));
      unsubscribe();
      const hashes = await Promise.all(outputs.map(async (output) => ({ index: output.index, revision: output.revision,
        hash: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", output.bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("") })));
      runs.push({ count, peak, violations, hashes });
    }
    pool.configure({ mode: "auto" });
    return { runs, snapshot: pool.snapshot() };
  }, fixtureSource);
  const reference = report.runs[0].hashes[0]?.hash;
  assert.ok(reference, "one-worker baseline produces real output");
  for (const run of report.runs) {
    assert.equal(run.violations, 0, `${run.count} workers obey shared admission`);
    assert.equal(run.peak, run.count, `${run.count} simultaneous jobs are admitted`);
    assert.deepEqual(run.hashes.map((output) => output.index).sort((a, b) => a - b), Array.from({ length: 24 }, (_, index) => index), "concurrency neither drops nor duplicates outputs");
    for (const output of run.hashes) {
      assert.equal(output.hash, reference, "worker count does not alter encoded output");
      assert.equal(output.revision, output.index, "client revisions survive worker reuse and remapping");
    }
  }
  assert.equal(report.snapshot.limit, 1, "returning to Auto restarts conservative calibration");
  assert.equal(report.snapshot.active, 0);
  assert.equal(report.snapshot.queued, 0);
  assert.ok(report.snapshot.recent.length <= 64, "diagnostics remain bounded");
  assert.doesNotMatch(JSON.stringify(report.snapshot), /fixture\.png|concurrency-check/, "diagnostics omit source names and user identifiers");
  console.log(`  shared scheduler: 24 images each at ${report.runs.map((run) => run.count).join("/")} workers; identical outputs, no missing/duplicate items or admission violations`);
}

async function seedStoredFontRecord(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("tiny-image-star-fonts", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("fonts")) request.result.createObjectStore("fonts", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error ?? new Error("font test store could not open"));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("fonts", "readwrite");
      transaction.objectStore("fonts").put({
        id: "browser-smoke-font",
        name: "Browser smoke font",
        fileName: "browser-smoke.ttf",
        family: "BrowserSmokeFont",
        bytes: new ArrayBuffer(1),
      });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error("font test record could not be stored"));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error("font test record was aborted"));
      };
    };
  }));
}

async function readLatestGeneratedBytes(page, label) {
  const payload = await page.evaluate(async () => {
    const candidate = window.__tinystarImageBlobUrls?.at(-1);
    if (!candidate) return { error: "no generated image blob was recorded" };
    const response = await fetch(candidate.url);
    if (!response.ok) return { error: `generated image blob could not be read (${response.status})` };
    return {
      type: candidate.type,
      bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
    };
  });
  assert.equal(payload.error, undefined, `${label}: ${payload.error ?? "generated output could not be read"}`);
  const bytes = Buffer.from(payload.bytes);
  assertPngBytes(bytes, label);
  return bytes;
}

async function assertPreviewMatchesGeneratedBytes(page, label) {
  const parity = await page.evaluate(async () => {
    const candidate = window.__tinystarImageBlobUrls?.at(-1);
    if (!candidate) return { error: "no generated image blob was recorded" };
    const response = await fetch(candidate.url);
    if (!response.ok) return { error: `generated image blob could not be read (${response.status})` };
    const bytes = new Uint8Array(await response.arrayBuffer());
    const image = new Image();
    image.src = candidate.url;
    await image.decode();

    const canvas = document.querySelector("#editor-canvas");
    const shell = document.querySelector(".canvas-shell");
    if (!canvas || !shell) return { error: "editor canvas is unavailable" };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = shell.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const reference = document.createElement("canvas");
    reference.width = canvas.width;
    reference.height = canvas.height;
    const context = reference.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const scale = Math.max(0.01, Math.min((width - 56) / image.naturalWidth, (height - 56) / image.naturalHeight));
    context.save();
    context.translate(width / 2, height / 2);
    context.filter = "brightness(1) contrast(1)";
    context.drawImage(
      image,
      0,
      0,
      image.naturalWidth,
      image.naturalHeight,
      -(image.naturalWidth * scale) / 2,
      -(image.naturalHeight * scale) / 2,
      image.naturalWidth * scale,
      image.naturalHeight * scale,
    );
    context.restore();

    const expected = context.getImageData(0, 0, reference.width, reference.height).data;
    const actualContext = canvas.getContext("2d");
    let differingPixels = Number.POSITIVE_INFINITY;
    let maximumChannelDifference = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const actual = actualContext.getImageData(0, 0, canvas.width, canvas.height).data;
      differingPixels = 0;
      maximumChannelDifference = 0;
      for (let index = 0; index < actual.length; index += 4) {
        const difference = Math.max(
          Math.abs(actual[index] - expected[index]),
          Math.abs(actual[index + 1] - expected[index + 1]),
          Math.abs(actual[index + 2] - expected[index + 2]),
          Math.abs(actual[index + 3] - expected[index + 3]),
        );
        maximumChannelDifference = Math.max(maximumChannelDifference, difference);
        if (difference > 0) differingPixels += 1;
      }
      if (differingPixels === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return {
      bytes: bytes.byteLength,
      signature: Array.from(bytes.slice(0, 8)),
      width: image.naturalWidth,
      height: image.naturalHeight,
      differingPixels,
      maximumChannelDifference,
    };
  });
  assert.equal(parity.error, undefined, `${label}: ${parity.error ?? "preview parity setup failed"}`);
  assert.deepEqual(parity.signature, [137, 80, 78, 71, 13, 10, 26, 10], `${label}: generated output is PNG`);
  assert.ok(parity.bytes > 0, `${label}: generated output has bytes`);
  assert.ok(parity.width > 0 && parity.height > 0, `${label}: generated output has dimensions`);
  assert.equal(parity.differingPixels, 0, `${label}: rendered preview differs from generated output (${parity.differingPixels} pixels, max channel delta ${parity.maximumChannelDifference})`);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
};

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
      const filePath = join(serverRoot, relativePath);
      if (!filePath.startsWith(`${serverRoot}/`)) {
        response.writeHead(403);
        response.end();
        return;
      }
      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile()) throw new Error("not a file");
      response.writeHead(200, { "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function assertNoLayoutCollisions(page, label, selectors) {
  await page.waitForFunction(() => document.documentElement.dataset.mobileLayout === String(matchMedia("(max-width: 1000px), (max-height: 800px) and (max-width: 1200px)").matches));
  const report = await page.evaluate((requestedSelectors) => {
    const nodes = [...document.querySelectorAll(requestedSelectors.join(","))]
      .filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
    const rects = nodes.map((node) => ({
      name: node.id || node.textContent?.trim().slice(0, 32) || node.tagName,
      rect: node.getBoundingClientRect().toJSON(),
    }));
    const overlaps = [];
    for (let left = 0; left < rects.length; left += 1) {
      for (let right = left + 1; right < rects.length; right += 1) {
        const a = rects[left].rect;
        const b = rects[right].rect;
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (width > 1 && height > 1) overlaps.push(`${rects[left].name} / ${rects[right].name}`);
      }
    }
    // Generic secondary views are intentionally scrollable. Their controls
    // may be below a short viewport, so this helper proves overlap and
    // horizontal escape; fixed editor/tray controls get explicit bounds
    // assertions in their dedicated checks.
    const horizontalOutside = rects
      .filter(({ rect }) => rect.left < -1 || rect.right > innerWidth + 1)
      .map(({ name, rect }) => `${name} (${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)})`);
    return { overlaps, horizontalOutside, bodyOverflow: document.body.scrollWidth > innerWidth + 1 };
  }, selectors);
  assert.deepEqual(report.overlaps, [], `${label}: overlapping controls: ${report.overlaps.join(", ")}`);
  assert.deepEqual(report.horizontalOutside, [], `${label}: controls escape viewport horizontally: ${report.horizontalOutside.join(", ")}`);
  assert.equal(report.bodyOverflow, false, `${label}: page has horizontal overflow`);
}

async function assertBulkRecipeContext(browser, address) {
  const isolated = await browser.newContext();
  await isolated.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value: 4 });
    window.__tinystarDisableLargeFolderJobs = true;
    window.__tinystarTestDelayWorkers = false;
    const NativeWorker = window.Worker;
    window.Worker = class DelayedWorker extends NativeWorker {
      postMessage(message, transfer) {
        if (!window.__tinystarTestDelayWorkers) return super.postMessage(message, transfer);
        setTimeout(() => super.postMessage(message, transfer), 700);
      }
    };
  });
  const page = await isolated.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
    const files = await page.evaluate(async () => {
      const files = [];
      for (let index = 0; index < 10; index += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 18;
        const context = canvas.getContext("2d");
        context.fillStyle = `hsl(${index * 31} 70% 55%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        files.push({ name: `context-${index}.png`, mimeType: "image/png", buffer: [...new Uint8Array(await blob.arrayBuffer())] });
      }
      return files;
    });
    const firstFile = files[0];
    const editorIsolated = await browser.newContext();
    await editorIsolated.addInitScript(() => {
      Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value: 4 });
      window.__tinystarDisableLargeFolderJobs = true;
    });
    const editorPage = await editorIsolated.newPage();
    await editorPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await editorPage.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
    await editorPage.locator("#file-input").setInputFiles({ ...firstFile, buffer: Buffer.from(firstFile.buffer) });
    const waitForEditorPreview = async () => {
      await editorPage.waitForFunction(() => document.querySelector("#processing-status")?.textContent === "Ready to download.", null, { timeout: 15_000 });
      await editorPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    await waitForEditorPreview();
    const sourceDigest = await editorPage.evaluate(async () => {
      const bytes = window.tinyImageStarEditor.getSnapshot().file.bytes;
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      window.__tinystarEditorCanvas = document.querySelector("#editor-canvas");
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    });
    const previewAtBrightness = async (value) => {
      await editorPage.locator("#brightness-input").evaluate((input, nextValue) => {
        input.value = String(nextValue);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
      await waitForEditorPreview();
      return editorPage.evaluate(async () => {
        const canvas = document.querySelector("#editor-canvas");
        const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        const digest = await crypto.subtle.digest("SHA-256", pixels);
        const source = window.tinyImageStarEditor.getSnapshot().file.bytes;
        const sourceHash = await crypto.subtle.digest("SHA-256", source);
        return {
          sameCanvas: canvas === window.__tinystarEditorCanvas,
          sameSource: [...new Uint8Array(sourceHash)].map((byte) => byte.toString(16).padStart(2, "0")).join("") === window.__tinystarExpectedSourceDigest,
          pixels: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
        };
      });
    };
    await editorPage.evaluate((digest) => { window.__tinystarExpectedSourceDigest = digest; }, sourceDigest);
    const firstPreview = await previewAtBrightness(1.25);
    await previewAtBrightness(0.75);
    const repeatedPreview = await previewAtBrightness(1.25);
    assert.equal(firstPreview.sameCanvas, true, "edit previews stay on the same canvas object");
    assert.equal(firstPreview.sameSource, true, "the original image bytes stay pinned in memory while editing");
    assert.equal(repeatedPreview.sameSource, true, "every slider edit keeps the original source bytes unchanged");
    assert.equal(repeatedPreview.pixels, firstPreview.pixels, "changing an edit away and back rerenders deterministically from the original image");
    await editorIsolated.close();

    await page.locator("#batch-file-input").setInputFiles(files.map((file) => ({ ...file, buffer: Buffer.from(file.buffer) })));
    await page.waitForFunction((count) => document.querySelectorAll(".batch-card").length === count
      && document.querySelector("#batch-status")?.textContent?.includes(`Ready — ${count} previews`), 10, { timeout: 30_000 });
    await page.locator("#batch-button").click();
    const firstCard = page.locator(".batch-card").first();
    await firstCard.click({ button: "right" });
    assert.equal(await page.getByRole("menu").isVisible(), true, "image right-click opens the app context menu");
    await page.getByRole("menuitem", { name: "Save this image as recipe…", exact: true }).click();
    assert.equal(await page.locator("#preset-dialog").isVisible(), true, "image context action opens recipe save");
    assert.equal(await page.locator("#preset-dialog-heading").textContent(), "Save image recipe");
    await page.locator("#preset-name-input").fill("Context recipe smoke");
    await page.locator("#preset-save-button").click();
    await page.waitForFunction(() => !document.querySelector("#preset-dialog")?.open);

    const selectAll = page.locator("#batch-select-all");
    if (await selectAll.textContent() === "Select all") await selectAll.click();
    assert.equal(await selectAll.textContent(), "Clear selection", "all page images can be selected before the recipe action");
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = true; });
    await page.locator(".batch-card").first().click({ button: "right" });
    const contextMenu = page.getByRole("menu");
    assert.match(await contextMenu.textContent(), /10 images selected/);
    await contextMenu.getByRole("menuitem", { name: "Profile Photo", exact: true }).click();
    await page.locator("#batch-job-bar").waitFor({ state: "visible" });
    await page.locator("#batch-job-speed").selectOption("max-speed");
    assert.equal(await page.locator("#processing-mode-select").inputValue(), "max-speed", "job-bar speed updates the shared processing scheduler live");
    await page.locator("#batch-job-pause").click();
    await page.waitForFunction(() => document.querySelector("#batch-job-pause")?.textContent === "Resume", null, { timeout: 15_000 });
    const paused = await page.evaluate(() => ({
      value: Number(document.querySelector("#batch-job-progress")?.value),
      max: Number(document.querySelector("#batch-job-progress")?.max),
      label: document.querySelector("#batch-job-title")?.textContent,
    }));
    assert.equal(paused.label, "Recipe job paused");
    assert.ok(paused.value > 0 && paused.value < paused.max, `pause drains active renders and holds queued images: ${JSON.stringify(paused)}`);
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = false; });
    await page.locator("#batch-job-pause").click();
    await page.waitForFunction(() => document.querySelector("#batch-job-bar")?.hidden === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 10 previews"));
    const results = await page.locator(".batch-card").allTextContents();
    assert.equal(results.length, 10, "bulk recipe keeps all image objects on the page");
    assert.ok(results.every((text) => text.includes("512 × 512") && text.includes("PNG")), "the selected recipe updates each image object and retains its recipe output format");
    await page.getByRole("button", { name: "Back to editor", exact: true }).click();
    assert.equal(await page.locator(".tray-item").count(), 10, "the selected image objects stay available in the editor page layer list");
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = true; });
    await page.locator(".tray-item").first().click({ button: "right" });
    assert.match(await page.getByRole("menu").textContent(), /10 images selected/);
    await page.getByRole("menuitem", { name: "Profile Photo", exact: true }).click();
    await page.locator("#batch-job-bar").waitFor({ state: "visible" });
    assert.equal(await page.locator("#editor-view").isVisible(), true, "the recipe job remains on the page with the canvas open");
    await page.locator("#batch-job-speed").selectOption("low-resource");
    assert.equal(await page.locator("#processing-mode-select").inputValue(), "low-resource", "the workspace job bar changes the shared speed mode");
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileJobBar = await page.evaluate(() => {
      const bar = document.querySelector("#batch-job-bar");
      const bounds = bar.getBoundingClientRect();
      const controls = [...bar.querySelectorAll("button, select")].filter((node) => !node.hidden);
      return {
        bounds: { left: bounds.left, right: bounds.right, bottom: bounds.bottom },
        viewport: innerWidth,
        controls: controls.map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right, height: rect.height };
        }),
      };
    });
    assert.ok(mobileJobBar.bounds.left >= 0 && mobileJobBar.bounds.right <= mobileJobBar.viewport, `the in-place job bar fits a phone viewport: ${JSON.stringify(mobileJobBar)}`);
    assert.ok(mobileJobBar.controls.every((control) => control.left >= 0 && control.right <= mobileJobBar.viewport && control.height >= 40), `job-bar controls fit phone touch targets: ${JSON.stringify(mobileJobBar)}`);
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = false; });
    await page.waitForFunction(() => document.querySelector("#batch-job-bar")?.hidden === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 10 previews"));
    assert.deepEqual(errors, [], `bulk recipe context browser errors: ${errors.join(" | ")}`);
    console.log("  editor page and result cards support recipe context actions; source bytes/pixels stay stable, multi-selection previews update in place, and the fixed speed/pause job bar fits mobile");
  } finally {
    await isolated.close();
  }
}

async function assertResultsResponsiveGeometry(page, label) {
  const report = await page.evaluate(() => {
    const root = document.querySelector('#batch-view[data-review="true"]');
    const isRendered = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const closedDetails = node.closest("details:not([open])");
      if (closedDetails && node !== closedDetails.querySelector(":scope > summary")) return false;
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const controls = root
      ? [...root.querySelectorAll("button:not([hidden]), select:not([hidden]), summary")].filter(isRendered)
      : [];
    const textNodes = root
      ? [...root.querySelectorAll("button:not([hidden]), summary, .batch-preset-name, .batch-card-meta span, #batch-status, #batch-selection-count")]
        .filter(isRendered)
      : [];
    const describe = (node) => node.id || node.getAttribute("aria-label") || node.textContent?.trim().replace(/\s+/g, " ").slice(0, 48) || node.tagName;
    const outside = controls
      .map((node) => ({ name: describe(node), rect: node.getBoundingClientRect().toJSON() }))
      .filter(({ rect }) => rect.left < -1 || rect.right > innerWidth + 1)
      .map(({ name, rect }) => `${name} (${Math.round(rect.left)}..${Math.round(rect.right)})`);
    const clippedText = textNodes
      .filter((node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
      .map((node) => `${describe(node)} (${node.clientWidth}x${node.clientHeight} < ${node.scrollWidth}x${node.scrollHeight})`);
    const undersizedTargets = innerWidth <= 650
      ? controls
        .filter((node) => node.getBoundingClientRect().height < 43)
        .map((node) => `${describe(node)} (${Math.round(node.getBoundingClientRect().height)}px)`)
      : [];
    const rootRect = root?.getBoundingClientRect();
    const visibleHiddenControls = root
      ? [...root.querySelectorAll("[hidden]")]
        .filter((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        })
        .map(describe)
      : [];
    const openMenus = root
      ? [...root.querySelectorAll("details[open]")].flatMap((details) => [...details.querySelectorAll(":scope > :not(summary), :scope > :not(summary) button")])
        .filter(isRendered)
        .map((node) => ({ name: describe(node), rect: node.getBoundingClientRect().toJSON() }))
        .filter(({ rect }) => rect.left < (rootRect?.left ?? 0) - 1 || rect.right > (rootRect?.right ?? innerWidth) + 1)
        .map(({ name, rect }) => `${name} (${Math.round(rect.left)}..${Math.round(rect.right)})`)
      : [];
    return {
      rootPresent: Boolean(root),
      bodyOverflow: document.body.scrollWidth > innerWidth + 1,
      outside,
      clippedText,
      undersizedTargets,
      openMenus,
      visibleHiddenControls,
    };
  });
  assert.equal(report.rootPresent, true, `${label}: Results review drawer is present`);
  assert.equal(report.bodyOverflow, false, `${label}: page has horizontal overflow`);
  assert.deepEqual(report.outside, [], `${label}: Results controls escape the viewport: ${report.outside.join(", ")}`);
  assert.deepEqual(report.openMenus, [], `${label}: open Results menus escape the drawer: ${report.openMenus.join(", ")}`);
  assert.deepEqual(report.clippedText, [], `${label}: Results text is clipped: ${report.clippedText.join(", ")}`);
  assert.deepEqual(report.undersizedTargets, [], `${label}: mobile Results targets are below 44px: ${report.undersizedTargets.join(", ")}`);
  assert.deepEqual(report.visibleHiddenControls, [], `${label}: hidden Results controls became visible: ${report.visibleHiddenControls.join(", ")}`);
}

async function assertResultsViewportMatrix(page, label) {
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width <= 1024 ? 844 : 720 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertResultsResponsiveGeometry(page, `${label} ${width}px`);
  }
}

async function editorChromeGeometry(page) {
  return page.evaluate(() => {
    const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
    const workspace = document.querySelector("#editor-workspace")?.getBoundingClientRect();
    const save = document.querySelector("#save-button");
    const saveStyle = save ? getComputedStyle(save) : null;
    return {
      topbarHeight: topbar?.height ?? 0,
      workspaceDocumentTop: (workspace?.top ?? 0) + scrollY,
      saveVisible: Boolean(save && saveStyle?.display !== "none" && saveStyle?.visibility !== "hidden" && save.getBoundingClientRect().width > 0),
    };
  });
}

function assertStableEditorChrome(before, after, label) {
  assert.ok(Math.abs(after.topbarHeight - before.topbarHeight) <= 1, `${label}: header height moved from ${before.topbarHeight}px to ${after.topbarHeight}px`);
  assert.ok(Math.abs(after.workspaceDocumentTop - before.workspaceDocumentTop) <= 1, `${label}: workspace moved from ${before.workspaceDocumentTop}px to ${after.workspaceDocumentTop}px`);
}

async function assertEditorResponsiveGeometry(page, label) {
  const report = await page.evaluate(() => {
    const rail = document.querySelector(".tool-rail");
    const footer = document.querySelector(".stage-footer");
    const buttons = rail
      ? [...rail.querySelectorAll("button:not([hidden])")].filter((button) => {
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      : [];
    const rects = buttons.map((button) => ({
      name: button.id || button.textContent?.trim().slice(0, 24),
      rect: button.getBoundingClientRect().toJSON(),
    }));
    const overlaps = [];
    for (let left = 0; left < rects.length; left += 1) {
      for (let right = left + 1; right < rects.length; right += 1) {
        const a = rects[left].rect;
        const b = rects[right].rect;
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (width > 1 && height > 1) overlaps.push(`${rects[left].name} / ${rects[right].name}`);
      }
    }
    const footerRect = footer?.getBoundingClientRect();
    const railRect = rail?.getBoundingClientRect();
    const mobileActions = [...document.querySelectorAll("#mobile-canvas-actions .button")].filter((button) => {
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    const clippedLabels = buttons
      .map((button) => button.querySelector("span"))
      .filter((label) => label && label.scrollWidth > label.clientWidth + 1)
      .map((label) => label.textContent?.trim());
    return {
      buttonCount: buttons.length,
      buttonIds: buttons.map((button) => button.id),
      mobileActionCount: mobileActions.length,
      storedActionCount: document.querySelectorAll("#mobile-more-sheet #mobile-canvas-actions .button").length,
      compactLayout: document.documentElement.dataset.mobileLayout,
      moreButtonVisible: document.querySelector("#mobile-more-button").getBoundingClientRect().width > 0,
      batchControlsStored: Boolean(document.querySelector("#mobile-batch-content .tray-heading")),
      inspectorStored: Boolean(document.querySelector("#mobile-inspector-content #editor-inspector")),
      canvas: document.querySelector("#canvas-shell").getBoundingClientRect().toJSON(),
      viewportHeight: innerHeight,
      clippedLabels,
      footerPosition: footer ? getComputedStyle(footer).position : "",
      railPosition: rail ? getComputedStyle(rail).position : "",
      overlaps,
      railOverflow: Boolean(rail && rail.scrollWidth > rail.clientWidth + 1),
      pageOverflow: document.body.scrollWidth > innerWidth + 1,
      footerRailOverlap: Boolean(footerRect && railRect && Math.min(footerRect.bottom, railRect.bottom) - Math.max(footerRect.top, railRect.top) > 1),
      footerRect,
      railRect,
      rightOutside: rects.filter(({ rect }) => rect.right > innerWidth + 1).map(({ name, rect }) => `${name} (${Math.round(rect.right)})`),
    };
  });
  assert.deepEqual(report.buttonIds, ["move-tool", "text-tool", "crop-tool", "size-tool", "adjust-tool", "format-tool"], `${label}: the intentional editor tools, including Text and discoverable Format, remain visible`);
  assert.equal(report.mobileActionCount, 0, `${label}: quick actions leave room for the canvas when their sheet is closed`);
  assert.equal(report.storedActionCount, 7, `${label}: quick actions are available in More`);
  assert.equal(report.compactLayout, "true", `${label}: compact-width layout uses the canvas-first shell`);
  assert.equal(report.moreButtonVisible, true, `${label}: secondary actions are reachable through More`);
  assert.equal(report.batchControlsStored, true, `${label}: batch controls stay available in their sheet`);
  assert.equal(report.inspectorStored, true, `${label}: editor controls stay available in their sheet`);
  assert.ok(report.canvas.height >= report.viewportHeight * .55 - 1, `${label}: canvas occupies at least 55% of the compact viewport`);
  assert.deepEqual(report.clippedLabels, [], `${label}: compact editor labels are readable: ${report.clippedLabels.join(", ")}`);
  assert.equal(report.footerPosition, "static", `${label}: stage footer stays in document flow`);
  assert.equal(report.railPosition, "static", `${label}: editing rail stays in document flow`);
  assert.deepEqual(report.overlaps, [], `${label}: editor buttons overlap: ${report.overlaps.join(", ")}`);
  assert.equal(report.railOverflow, false, `${label}: tool rail has hidden horizontal overflow`);
  assert.equal(report.pageOverflow, false, `${label}: page has horizontal overflow`);
  assert.equal(report.footerRailOverlap, false, `${label}: stage footer overlaps the tool rail (footer=${JSON.stringify(report.footerRect)}, rail=${JSON.stringify(report.railRect)})`);
  assert.deepEqual(report.rightOutside, [], `${label}: editor buttons escape viewport: ${report.rightOutside.join(", ")}`);
}

async function assertMobileSheets(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const initial = await editorChromeGeometry(page);
  assert.ok(initial.topbarHeight <= 58, "phone header fits one 56px row");
  const canvas = await page.locator("#canvas-shell").boundingBox();
  assert.ok(canvas.y <= 110, "phone canvas starts near the top of the screen");
  await page.locator("#mobile-more-button").click();
  assert.equal(await page.locator("#mobile-more-sheet").evaluate((node) => node.matches(":modal")), true, "More uses native modal focus containment");
  await page.locator("#appearance-select").focus();
  await page.keyboard.press("Tab");
  // Chromium may visit browser chrome at the end of a native dialog before
  // returning to its first control. Workspace navigation can add controls to
  // this sheet, so assert focus containment instead of one exact tab target.
  if (await page.evaluate(() => document.activeElement === document.body)) await page.keyboard.press("Tab");
  assert.equal(await page.locator("#mobile-more-sheet").evaluate((node) => node.contains(document.activeElement)), true, "Tab remains contained within More");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.id === "mobile-more-button");
  await page.locator("#adjust-tool").click();
  assert.equal(await page.locator("#mobile-inspector-sheet").isVisible(), true, "tool opens its settings sheet");
  await page.locator("#grayscale-input").check();
  await page.locator("#mobile-inspector-sheet [data-close-sheet]").click();
  await page.waitForFunction(() => document.activeElement?.id === "adjust-tool");
  assert.equal(await page.evaluate(() => window.tinyImageStarEditor.getSnapshot().operations.grayscale), true, "closing sheet preserves edits");
  await assertStableEditorChrome(initial, await editorChromeGeometry(page), "phone after editing");
  await page.locator("#mobile-inspector-toggle").click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => document.documentElement.dataset.mobileLayout === "false");
  assert.equal(await page.locator("#editor-workspace > #editor-inspector").count(), 1, "desktop restores the same inspector");
  assert.equal(await page.locator("#grayscale-input").isChecked(), true, "desktop keeps phone edits");
  assert.equal(await page.locator("dialog[open]").count(), 0, "resizing releases modal inertness");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.locator("#move-tool").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#mobile-more-button").click();
  await page.locator("#presets-button").click();
  assert.equal(await page.locator("#mobile-more-sheet").isVisible(), false, "navigation dismisses More");
  assert.equal(await page.locator("#presets-view").isVisible(), true, "presets remain reachable on phones");
  await page.locator("#presets-view").getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#mobile-batch-settings").click();
  assert.equal(await page.locator("#tray-quality-control").isVisible(), false, "phone sheet keeps unsupported encoder quality hidden");
  assert.equal(await page.locator("#tray-lossy-control").isVisible(), false, "phone sheet keeps unsupported lossy setting hidden");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const smallPhone = await page.evaluate(() => ({
    canvas: document.querySelector("#canvas-shell").getBoundingClientRect().toJSON(),
    tools: document.querySelector(".tool-rail").getBoundingClientRect().toJSON(),
  }));
  assert.ok(smallPhone.canvas.height >= 667 * .55, "small phone keeps a dominant canvas");
  assert.ok(smallPhone.tools.bottom <= 669, `small phone keeps the editing dock in the viewport: ${JSON.stringify(smallPhone)}`);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth + 1), false, "phone editor supports 200% text without horizontal scrolling");
  await page.locator("#mobile-more-button").click();
  await page.locator("#appearance-select").scrollIntoViewIfNeeded();
  const appearance = await page.locator("#appearance-select").boundingBox();
  assert.ok(appearance.x >= 0 && appearance.x + appearance.width <= 376, "200% sheet controls stay reachable");
  await page.keyboard.press("Escape");
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function assertEmptyEditorResponsiveGeometry(page, label) {
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    const height = width <= 1024 ? 844 : 720;
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertNoLayoutCollisions(page, `${label} ${width}px`, ["#empty-editor-actions .button"]);
    const report = await page.evaluate(() => {
      const visible = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      return {
        emptyVisible: visible("#empty-editor"),
        footerVisible: visible(".stage-footer"),
        quickActionsVisible: visible("#mobile-canvas-actions"),
        railVisible: visible(".tool-rail"),
        inspectorVisible: visible(".inspector"),
        bodyOverflow: document.body.scrollWidth > innerWidth + 1,
      };
    });
    assert.equal(report.emptyVisible, true, `${label} ${width}px: empty editor remains visible`);
    assert.equal(report.footerVisible, false, `${label} ${width}px: empty editor has no disabled floating footer`);
    assert.equal(report.quickActionsVisible, false, `${label} ${width}px: empty editor has no disabled quick actions`);
    assert.equal(report.railVisible, false, `${label} ${width}px: empty editor has no editing rail`);
    assert.equal(report.inspectorVisible, false, `${label} ${width}px: empty editor has no inspector`);
    assert.equal(report.bodyOverflow, false, `${label} ${width}px: page has horizontal overflow`);
  }
}

async function assertTabletEditorResponsiveGeometry(page, label) {
  const report = await page.evaluate(() => {
    const tray = document.querySelector("#image-tray");
    const stage = document.querySelector(".stage-panel");
    const toolRail = document.querySelector(".tool-rail");
    const rect = (node) => node?.getBoundingClientRect().toJSON();
    const trayRect = rect(tray);
    const stageRect = rect(stage);
    const toolRailRect = rect(toolRail);
    return {
      bodyOverflow: document.body.scrollWidth > innerWidth + 1,
      trayRect,
      stageRect,
      toolRailRect,
      compactLayout: document.documentElement.dataset.mobileLayout,
      moreButtonVisible: document.querySelector("#mobile-more-button").getBoundingClientRect().width > 0,
      movedBatchControls: Boolean(document.querySelector("#mobile-batch-content .tray-heading")),
      movedInspector: Boolean(document.querySelector("#mobile-inspector-content #editor-inspector")),
    };
  });
  assert.equal(report.bodyOverflow, false, `${label}: page has horizontal overflow`);
  assert.equal(report.compactLayout, "true", `${label}: portrait tablet uses the compact canvas-first shell`);
  assert.equal(report.moreButtonVisible, true, `${label}: tablet actions are reachable through More`);
  assert.equal(report.movedBatchControls, true, `${label}: tablet batch controls move into the batch sheet`);
  assert.equal(report.movedInspector, true, `${label}: tablet inspector moves into its contextual sheet`);
  assert.ok(report.stageRect?.width > 600, `${label}: canvas remains wide enough for tablet editing (${JSON.stringify(report.stageRect)})`);
  assert.ok(report.trayRect?.width > 600, `${label}: image tray spans the tablet workspace (${JSON.stringify(report.trayRect)})`);
  assert.ok(report.toolRailRect?.width > 600, `${label}: tablet dock spans the workspace (${JSON.stringify(report.toolRailRect)})`);
}

async function assertViewportMatrix(page, label, selectors, editor = false) {
  for (const width of [320, 375, 390, 768, 900, 1000, 1024, 1440]) {
    // Tablet-sized layouts commonly have a taller portrait viewport; keep the
    // generic control check focused on horizontal escape/overlap rather than
    // treating ordinary scrollable content below a short desktop fold as a bug.
    const height = width <= 1024 ? 844 : 720;
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertNoLayoutCollisions(page, `${label} ${width}px`, selectors);
    if (editor && width <= 1000) await assertEditorResponsiveGeometry(page, `${label} editor controls ${width}px`);
    if (editor && width === 768) await assertTabletEditorResponsiveGeometry(page, `${label} tablet editor`);
  }
  if (editor) {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForFunction(() => document.documentElement.dataset.mobileLayout === "true");
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertEditorResponsiveGeometry(page, `${label} short landscape tablet editor`);
    await page.setViewportSize({ width: 1024, height: 844 });
    await page.waitForFunction(() => document.documentElement.dataset.mobileLayout === "false");
  }
}

async function clearSessionOfferIfPresent(page) {
  const offer = page.locator("#session-recovery");
  if (await offer.isVisible()) {
    await page.getByRole("button", { name: "Clear saved session", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#session-recovery")?.hidden);
  }
}

async function leaveReviewAndEnsureEditor(page) {
  const review = page.locator('#batch-view[data-review="true"]');
  if (await review.isVisible()) {
    await page.getByRole("button", { name: "Back to editor", exact: true }).click();
  }
  await page.waitForFunction(() => !document.querySelector("#editor-view")?.hidden);
}

async function openTrayItemNamed(page, name) {
  const item = page.locator("#tray-list .tray-item").filter({ hasText: name }).first();
  try {
    await page.waitForFunction((expected) => {
      const rows = [...document.querySelectorAll("#tray-list .tray-item")];
      const row = rows.find((candidate) => candidate.textContent?.includes(expected));
      return Boolean(row?.querySelector(".tray-item-open") && !row.querySelector(".tray-item-open").disabled);
    }, name, { timeout: 10000 });
  } catch (error) {
    console.error("tray item readiness", await page.evaluate(() => ({
      status: document.querySelector("#batch-status")?.textContent,
      items: [...document.querySelectorAll("#tray-list .tray-item")].map((row) => ({
        text: row.textContent,
        disabled: row.querySelector(".tray-item-open")?.disabled,
      })),
    })));
    throw error;
  }
  await item.locator(".tray-item-open").click();
  await page.waitForFunction((expected) => document.querySelector("#file-name")?.textContent === expected, name);
}

const topActionSelectors = [
  ".workspace-nav > button:not([hidden])",
  ".topbar-actions > .button:not([hidden])",
];
const imageActionSelectors = [
  "#batch-view .batch-actions > .button:not([hidden])",
  "#batch-view .batch-selection-actions > .button:not([hidden])",
  "#batch-view #batch-selection-count",
];
const imagePresetSelectors = [
  "#batch-view .batch-preset-bar > .control-label",
  "#batch-view #batch-preset-picker",
  "#batch-view #batch-preset-name",
  "#batch-view #batch-scope-control",
];
const traySelectors = [
  "#image-tray .tray-heading",
  "#image-tray .tray-recipe",
  "#image-tray .tray-output-controls",
  "#image-tray .tray-list",
  "#image-tray .tray-footer",
];

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("verify:browser requires the Playwright development dependency; run npm install, then rerun this command.");
    return 2;
  }

  const fixtureSource = await readFile(join(projectRoot, "tests/fixtures/rgb-small.png.base64"), "utf8");
  const jpegFixtureSource = await readFile(join(projectRoot, "tests/fixtures/rgb-small.jpg.base64"), "utf8");
  const exifFixtureSource = await readFile(join(projectRoot, "tests/fixtures/exif-orientation6.jpg.base64"), "utf8");
  const tiffFixtureSource = await readFile(join(projectRoot, "tests/fixtures/rgb-small.tiff.base64"), "utf8");
  const icoFixtureSource = await readFile(join(projectRoot, "tests/fixtures/rgb-small.ico.base64"), "utf8");
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "tiny-image-star-browser-"));
  const folderDirectory = join(fixtureDirectory, "folder");
  const firstFixture = join(fixtureDirectory, "one.png");
  const secondFixture = join(fixtureDirectory, "two.png");
  const thirdFixture = join(fixtureDirectory, "three.png");
  const longNameFixture = join(fixtureDirectory, "a-very-long-image-name-that-must-remain-readable-in-results-without-breaking-actions.png");
  const jpegFixture = join(fixtureDirectory, "fixture.jpg");
  const exifFixture = join(fixtureDirectory, "orientation6.jpg");
  const tiffFixture = join(fixtureDirectory, "fixture.tiff");
  const icoFixture = join(fixtureDirectory, "fixture.ico");
  const animatedFixture = join(fixtureDirectory, "animated.gif");
  await writeFile(firstFixture, Buffer.from(fixtureSource.trim(), "base64"));
  await writeFile(secondFixture, Buffer.from(fixtureSource.trim(), "base64"));
  await writeFile(thirdFixture, Buffer.from(fixtureSource.trim(), "base64"));
  await writeFile(longNameFixture, Buffer.from(fixtureSource.trim(), "base64"));
  await writeFile(jpegFixture, Buffer.from(jpegFixtureSource.trim(), "base64"));
  await writeFile(exifFixture, Buffer.from(exifFixtureSource.trim(), "base64"));
  await mkdir(folderDirectory);
  await writeFile(join(folderDirectory, "one.png"), Buffer.from(fixtureSource.trim(), "base64"));
  await writeFile(join(folderDirectory, "two.png"), Buffer.from(fixtureSource.trim(), "base64"));
  await writeFile(tiffFixture, Buffer.from(tiffFixtureSource.trim(), "base64"));
  await writeFile(icoFixture, Buffer.from(icoFixtureSource.trim(), "base64"));
  await writeFile(animatedFixture, Buffer.from([
    ...Buffer.from("GIF89a", "ascii"), 1, 0, 1, 0, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0,
  ]));

  const server = await startStaticServer();
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  if (process.argv.includes("--bulk-recipe-context-only")) {
    try {
      await assertBulkRecipeContext(browser, address);
      console.log("verify:bulk-context PASS");
      return 0;
    } catch (error) {
      console.error("verify:bulk-context FAIL", error);
      return 1;
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  }
  if (process.argv.includes("--design-workspace-only")) {
    try {
      await assertDesignWorkspace(browser, address);
      console.log("verify:design-workspace PASS");
      return 0;
    } catch (error) {
      console.error("verify:design-workspace FAIL", error);
      return 1;
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  }
  // Keep the complete browser suite reproducible on small CI runners and
  // model the same CPU limits on every isolated page, not just one test.
  const hardwareConcurrencyOverride = Number(process.env.TINY_IMAGE_STAR_TEST_HARDWARE_CONCURRENCY);
  const hasHardwareConcurrencyOverride = Number.isSafeInteger(hardwareConcurrencyOverride) && hardwareConcurrencyOverride > 0;
  if (hasHardwareConcurrencyOverride) {
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...options) => {
      const context = await newContext(...options);
      await context.addInitScript((value) => Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value }), hardwareConcurrencyOverride);
      return context;
    };
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__tinystarRecoveryErrors = [];
    window.addEventListener("tinystar:recovery-write-error", (event) => window.__tinystarRecoveryErrors.push(event.detail.message));
    window.__tinystarDisableLargeFolderJobs = true;
    const NativeWorker = window.Worker;
    window.__tinystarWorkerUrls = [];
    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    window.__tinystarImageBlobUrls = [];
    URL.createObjectURL = (blob) => {
      const url = nativeCreateObjectURL(blob);
      if (blob?.type?.startsWith("image/")) window.__tinystarImageBlobUrls.push({ url, type: blob.type, size: blob.size });
      return url;
    };
    window.Worker = class DelayedWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        window.__tinystarWorkerUrls.push(String(url));
      }

      postMessage(message, transfer) {
        if (!window.__tinystarTestDelayWorkers) return super.postMessage(message, transfer);
        setTimeout(() => super.postMessage(message, transfer), 250);
      }
    };
  });
  const consoleErrors = [];
  const networkRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("request", (request) => {
    const postData = request.postData();
    networkRequests.push({
      url: request.url(),
      method: request.method(),
      hasBody: Boolean(postData && postData.length),
    });
  });

  try {
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
    await assertDesignWorkspace(browser, address);
    await assertPublishedExports(page);
    await assertAppearance(page);
    await assertSharedScheduler(page, fixtureSource);
    await assertTextCompositor(browser, page.url(), hasHardwareConcurrencyOverride
      ? { hardwareConcurrency: hardwareConcurrencyOverride } : undefined);
    await assertCreatorStamp(browser, page.url());
    await assertFolderContracts(browser, page.url());
    await assertFolderSamples(browser, page.url());
    await assertFolderSources(browser, page.url());
    await assertSceneCollections(browser, page.url());
    await assertStagedScenes(browser, page.url());
    await assertSceneCompositor(browser, page.url());
    await assertStoryStorage(browser, page.url());
    await assertStoryDesigns(browser, page.url());
    await assertStoryFonts(browser, page.url());
    await assertWorkingCopies(browser, page.url());
    await assertSourceResolution(browser, page.url());
    await assertStyleStorage(browser, page.url());
    await assertLegacyStyles(browser, page.url());
    await assertRecipeCatalog(browser, page.url());
    await assertRecipeSelections(browser, page.url());
    await assertHistoricalRecovery(browser, page.url());
    await assertPhotoLooks(browser, page.url());
    await assertOriginAdmission(browser, page.url());
    await assertMasks(browser, page.url());
    await assertMaskDetail(browser, page.url());
    await assertDepthTitles(browser, page.url());
    await assertConnectedCutouts(browser, page.url());
    await assertCutoutEffects(browser, page.url());
    await assertStoryWorkspace(browser, page.url());
    await assertStoryExports(browser, page.url());
    await assertProjectStorage(page, fixtureSource);
    assert.equal(await page.locator("#engine-status").textContent(), "Ready", "fresh readiness");
    assert.equal(await page.locator("#engine-status").isVisible(), false, "healthy readiness badge stays quiet");
    assert.equal(await page.locator(".github-link").getAttribute("href"), "https://github.com/appunni-m/tiny-image-star", "footer links back to the project repository");
    assert.equal(await page.locator(".github-link").isVisible(), true, "project repository link is visible");
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active", contrast: "more" });
    const accessibilityMedia = await page.evaluate(() => {
      const spinner = document.querySelector(".spinner");
      const primary = document.querySelector(".button.primary");
      return {
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        forcedColors: matchMedia("(forced-colors: active)").matches,
        contrast: matchMedia("(prefers-contrast: more)").matches,
        animationDuration: spinner ? getComputedStyle(spinner).animationDuration : "",
        animationDurationMs: spinner
          ? (() => {
            const value = getComputedStyle(spinner).animationDuration;
            const number = Number.parseFloat(value);
            return value.endsWith("ms") ? number : number * 1000;
          })()
          : Number.POSITIVE_INFINITY,
        primaryBackground: primary ? getComputedStyle(primary).backgroundColor : "",
      };
    });
    assert.equal(accessibilityMedia.reducedMotion, true, "reduced-motion preference reaches the page");
    assert.equal(accessibilityMedia.forcedColors, true, "forced-colors preference reaches the page");
    assert.equal(accessibilityMedia.contrast, true, "high-contrast preference reaches the page");
    assert.ok(accessibilityMedia.animationDurationMs <= 1, `reduced motion disables spinner animation (${accessibilityMedia.animationDuration})`);
    assert.notEqual(accessibilityMedia.primaryBackground, "rgba(0, 0, 0, 0)", "high-contrast Save remains visibly filled");
    await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none", contrast: "no-preference" });
    await assertViewportMatrix(page, "empty editor header", topActionSelectors);
    await assertViewportMatrix(page, "empty editor actions", ["#empty-editor-actions .button"]);
    await assertEmptyEditorResponsiveGeometry(page, "empty editor chrome");
    await page.setViewportSize({ width: 390, height: 844 });
    const emptyMobileTargets = await page.evaluate(() => [...document.querySelectorAll("#empty-editor-actions .button, #mobile-more-button, .footer-actions .button")]
      .filter((button) => {
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return !button.disabled && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0;
      })
      .map((button) => ({ name: button.id || button.textContent?.trim(), height: button.getBoundingClientRect().height })));
    assert.ok(emptyMobileTargets.length >= 4, "empty mobile screen keeps its primary actions visible");
    assert.ok(emptyMobileTargets.every(({ height }) => height >= 43), `empty mobile actions keep 44px targets: ${JSON.stringify(emptyMobileTargets)}`);
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.locator("#file-input").setInputFiles(firstFixture);
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));
    assert.match(await page.locator("#output-summary").textContent(), /Ready/);
    assert.equal(await page.locator("#format-tool").isVisible(), true, "Format stays discoverable even when PNG is the only verified choice");
    await page.getByRole("button", { name: "Rotate right", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#dirty-state")?.hidden && document.querySelector("#output-summary")?.textContent?.includes("Ready"));
    await waitForAsync(page, async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("tiny-image-star.projects", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const record = await new Promise((resolve, reject) => {
        const transaction = database.transaction("records", "readonly");
        const request = transaction.objectStore("records").get("active");
        let value = null;
        request.onsuccess = () => { value = request.result; };
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve(value);
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      return record?.session?.batch?.files?.length === 1 && record.session.batch.files[0]?.override?.rotation === 90;
    });
    // Allow the browser's storage commit to settle before simulating a refresh.
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
    await page.waitForFunction(() => !document.querySelector("#session-recovery")?.hidden);
    assert.match(await page.locator("#session-recovery-message").textContent(), /Restore 1 image/, "one-image workspace recovery offer");
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#session-recovery")?.hidden && document.querySelector("#batch-status")?.textContent?.includes("Ready — 1 preview"));
    await leaveReviewAndEnsureEditor(page);
    try {
      await page.waitForFunction(() => document.querySelector("#file-name")?.textContent === "one.png" && document.querySelector("#output-summary")?.textContent?.includes("8 × 8"), null, { timeout: 10000 });
    } catch (error) {
      console.error("one-image restore state", await page.evaluate(() => ({
        fileName: document.querySelector("#file-name")?.textContent,
        outputSummary: document.querySelector("#output-summary")?.textContent,
        processingStatus: document.querySelector("#processing-status")?.textContent,
        batchStatus: document.querySelector("#batch-status")?.textContent,
        snapshot: window.tinyImageStarEditor?.getSnapshot?.(),
      })));
      throw error;
    }
    assert.equal(await page.locator("#dirty-state").isVisible(), false, "restored one-image workspace is clean until edited");
    assert.equal(await page.evaluate(() => window.tinyImageStarEditor.getSnapshot().operations.rotation), 90, "one-image workspace recovery preserves its edit configuration");
    await page.evaluate(() => window.tinyImageStarEditor.setCapabilities({
      inputFormats: ["png"],
      outputFormats: ["png", "jpeg"],
      compression: { lossy: true, lossyFormats: ["jpeg"], quality: true },
    }));
    await page.waitForFunction(() => !document.querySelector("#format-tool")?.hidden);
    await page.getByRole("button", { name: "Format", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-format-details")?.open === true);
    await page.waitForFunction(() => !document.querySelector("#output-format-details")?.hidden);
    assert.ok(await page.locator("#output-format-select option").allTextContents().then((options) => options.includes("JPEG")), "single-image output format picker exposes verified formats");
    await page.locator("#output-format-select").selectOption("jpeg");
    await page.waitForFunction(() => document.querySelector("#compression-options")?.hidden === false);
    assert.equal(await page.locator("#lossy-toggle").isChecked(), false, "single-image format selection does not silently enable lossy compression");
    assert.equal(await page.locator('[data-quality-preset="95"]').getAttribute("aria-pressed"), "true", "Medium quality (95) is the friendly default");
    await page.locator('[data-quality-preset="80"]').click();
    assert.equal(await page.locator("#quality-input").inputValue(), "80", "Low quality maps to 80");
    await page.locator('[data-quality-preset="95"]').click();
    assert.equal(await page.locator("#quality-input").inputValue(), "95", "Medium quality maps to 95");
    await page.locator('[data-quality-preset="100"]').click();
    assert.equal(await page.locator("#quality-input").inputValue(), "100", "High quality maps to 100");
    assert.equal(await page.locator("#lossy-toggle").isChecked(), true, "choosing a quality explicitly enables smaller-file compression");
    await page.locator("#lossy-toggle").uncheck();
    assert.equal(await page.locator("#output-format-select").inputValue(), "jpeg", "turning compression off does not silently change the chosen format");
    await page.locator("#lossy-toggle").check();
    await page.waitForFunction(() => document.querySelector("#processing-status")?.textContent?.includes("Ready to download"));
    // Deliberately overclaim AVIF to verify worker-side validation and recovery.
    await page.evaluate(() => window.tinyImageStarEditor.setCapabilities({ outputFormats: ["png", "jpeg", "avif"] }));
    await page.locator("#output-format-select").selectOption("avif");
    await page.waitForFunction(() => document.querySelector("#processing-status")?.textContent?.includes("output format is not available yet"));
    assert.equal(await page.locator("#save-button").isDisabled(), true, "single-image Download stays disabled when the selected format fails");
    await page.locator("#output-format-select").selectOption("png");
    await page.waitForFunction(() => document.querySelector("#processing-status")?.textContent?.includes("Ready to download") && document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));
    assert.equal(await page.locator("#save-button").isDisabled(), false, "single-image Download re-enables after returning to a verified format");
    // Multiple verified output choices keep the metadata-only download sheet, but
    // the sheet must not duplicate the image preview.
    const choicePreviewBytes = await readLatestGeneratedBytes(page, "choice-required preview");
    const choiceSaveDownloadPromise = page.waitForEvent("download", { timeout: 3000 }).catch(() => null);
    await page.getByRole("button", { name: "Download current PNG", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "Download your image", exact: true }).count(), 1, "multiple output choices keep the download sheet");
    assert.equal(await page.locator("#export-dialog img").count(), 0, "download sheet never renders a second image preview");
    assert.equal(await page.locator("#export-preview-frame").count(), 0, "download sheet has no preview frame");
    await page.getByRole("button", { name: "Download PNG", exact: true }).click();
    const choiceSaveDownload = await choiceSaveDownloadPromise;
    if (choiceSaveDownload) assert.deepEqual(await readFile(await choiceSaveDownload.path()), choicePreviewBytes, "choice-required Download uses the current preview bytes");
    await page.waitForFunction(() => document.querySelector("#processing-status")?.textContent?.includes("Download started for the current PNG image."));
    await page.evaluate(() => window.tinyImageStarEditor.setCapabilities({
      inputFormats: ["jpeg", "png", "gif", "bmp", "webp", "tiff", "ico"],
      outputFormats: ["png"],
      compression: { lossy: false, lossyFormats: [], quality: false },
    }));
    await page.waitForFunction(() => document.querySelector("#output-format-details")?.hidden === false);
    assert.equal(await page.locator("#output-format-select").inputValue(), "png", "PNG remains visibly selected after a capability downgrade");
    assert.equal(await page.locator("#lossy-toggle").isChecked(), false, "PNG-only capability downgrade clears stale lossy choice");
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 1 preview"));
    await page.evaluate(() => {
      const file = new File([Uint8Array.from([0, 0, 0, 32, 102, 116, 121, 112, 97, 118, 105, 102])], "future.avif", { type: "image/avif" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = document.querySelector("#file-input");
      Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      delete input.files;
    });
    try {
      await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Use JPEG, PNG, GIF, BMP, WebP, TIFF, ICO images here"), null, { timeout: 5000 });
    } catch (error) {
      console.error("unsupported input state", await page.evaluate(() => ({
        batchStatus: document.querySelector("#batch-status")?.textContent,
        canvasStatus: document.querySelector("#canvas-status")?.textContent,
        accept: document.querySelector("#file-input")?.accept,
        trayCount: document.querySelector("#tray-count")?.textContent,
      })));
      throw error;
    }
    assert.equal(await page.locator("#file-name").textContent(), "one.png", "unsupported AVIF input does not replace the current image");
    await page.locator("#file-input").setInputFiles(tiffFixture);
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "2 images");
    await openTrayItemNamed(page, "fixture.tiff");
    await page.waitForFunction(() => document.querySelector("#processing-status")?.textContent?.includes("Ready to download") && document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));
    assert.match(await page.locator("#processing-status").textContent(), /Ready to download/ , "engine preview proxy accepts TIFF input");
    await assertPreviewMatchesGeneratedBytes(page, "TIFF proxy preview");
    await page.locator("#file-input").setInputFiles(icoFixture);
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "3 images");
    await openTrayItemNamed(page, "fixture.ico");
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));
    assert.match(await page.locator("#processing-status").textContent(), /Ready to download|Image ready/, "ICO input reaches a usable preview");
    await assertPreviewMatchesGeneratedBytes(page, "ICO preview");
    await page.locator("#file-input").setInputFiles(jpegFixture);
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "4 images");
    await openTrayItemNamed(page, "fixture.jpg");
    await page.waitForFunction(() => document.querySelector("#processing-status")?.textContent?.includes("Ready to download"));
    await assertPreviewMatchesGeneratedBytes(page, "JPEG preview");
    await page.locator("#file-input").setInputFiles(exifFixture);
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "5 images");
    await openTrayItemNamed(page, "orientation6.jpg");
    await page.waitForFunction(() => document.querySelector("#processing-status")?.textContent?.includes("Ready to download"));
    await assertPreviewMatchesGeneratedBytes(page, "EXIF-oriented JPEG preview");
    // Recovery above deliberately preserved a rotated image. Start a clean
    // set for the independent editor-operation matrix so crop/resize expected
    // dimensions are not coupled to that recovery assertion.
    await page.locator("#batch-button").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "New set", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#image-tray")?.hidden);
    await page.locator("#file-input").setInputFiles(firstFixture);
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));
    const canvasLabel = await page.locator("#editor-canvas").getAttribute("aria-label");
    assert.match(canvasLabel ?? "", /one\.png/ , "canvas has an image-specific accessible label");
    assert.match(canvasLabel ?? "", /8 × 8 pixels/ , "canvas label includes the current output size");
    assert.match(canvasLabel ?? "", /Keep whole/ , "canvas label includes the resize behavior");
    assert.equal(await page.locator("#export-tool").isVisible(), false, "single-image Download has one visible primary route");
    assert.equal(await page.locator("#output-heading").textContent(), "Format & quality", "format and quality are visible before download");
    await assertViewportMatrix(page, "loaded editor header", topActionSelectors, true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#mobile-more-button").click();
    await page.locator("#mobile-rotate-right").click();
    await page.waitForFunction(() => !document.querySelector("#dirty-state")?.hidden);
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#dirty-state")?.hidden);
    await page.locator("#mobile-more-sheet [data-close-sheet]").click();
    await assertMobileSheets(page);
    await page.evaluate(() => {
      const canvas = document.querySelector("#editor-canvas");
      const rect = canvas.getBoundingClientRect();
      canvas.setPointerCapture = () => {};
      canvas.releasePointerCapture = () => {};
      const point = (x, y, pointerId) => new PointerEvent("pointerdown", { bubbles: true, pointerId, clientX: rect.left + x, clientY: rect.top + y, isPrimary: pointerId === 21 });
      canvas.dispatchEvent(point(rect.width * 0.35, rect.height * 0.5, 21));
      canvas.dispatchEvent(point(rect.width * 0.65, rect.height * 0.5, 22));
      canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 22, clientX: rect.left + rect.width * 0.8, clientY: rect.top + rect.height * 0.5 }));
      canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 21, clientX: rect.left + rect.width * 0.35, clientY: rect.top + rect.height * 0.5 }));
      canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 22, clientX: rect.left + rect.width * 0.8, clientY: rect.top + rect.height * 0.5 }));
    });
    assert.notEqual(await page.locator("#zoom-value").textContent(), "100%", "two-pointer pinch changes zoom");
    await page.evaluate(() => {
      const canvas = document.querySelector("#editor-canvas");
      const rect = canvas.getBoundingClientRect();
      canvas.setPointerCapture = () => {};
      canvas.releasePointerCapture = () => {};
      const tap = () => {
        canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 31, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, isPrimary: true }));
        canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 31, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, isPrimary: true }));
      };
      tap();
      tap();
    });
    assert.equal(await page.locator("#zoom-value").textContent(), "100%", "double tap fits the image");
    await page.setViewportSize({ width: 1280, height: 720 });

    const tools = page.getByRole("complementary", { name: "Editing tools" });
    await tools.getByRole("button", { name: "Adjust", exact: true }).click();
    assert.equal(await page.locator("#resize-panel").isVisible(), false, "contextual resize panel hides during adjust");
    assert.equal(await page.locator("#adjust-panel").isVisible(), true, "contextual adjust panel");
    await tools.getByRole("button", { name: "Move", exact: true }).click();
    await page.locator("#zoom-in").click();
    assert.equal(await page.locator("#zoom-value").textContent(), "125%", "zoom in");
    await page.locator("#zoom-out").click();
    await tools.getByRole("button", { name: "Fit screen", exact: true }).click();
    assert.equal(await page.locator("#zoom-value").textContent(), "100%", "fit view");
    const panBefore = await page.locator("#editor-canvas").evaluate((canvas) => canvas.toDataURL());
    const panBox = await page.locator("#editor-canvas").boundingBox();
    assert.ok(panBox, "editor canvas has geometry for Space-pan");
    await page.keyboard.down("Space");
    await page.mouse.move(panBox.x + panBox.width / 2, panBox.y + panBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(panBox.x + panBox.width / 2 + 48, panBox.y + panBox.height / 2 + 24);
    await page.mouse.up();
    await page.keyboard.up("Space");
    const panAfter = await page.locator("#editor-canvas").evaluate((canvas) => canvas.toDataURL());
    assert.notEqual(panAfter, panBefore, "Space-drag pan moves the canvas image");
    await tools.getByRole("button", { name: "Fit screen", exact: true }).click();
    assert.equal(await page.locator("#zoom-value").textContent(), "100%", "Fit resets the panned view");
    await page.keyboard.press("+");
    assert.equal(await page.locator("#zoom-value").textContent(), "125%", "keyboard plus zooms the canvas");
    await page.keyboard.press("-");
    assert.equal(await page.locator("#zoom-value").textContent(), "100%", "keyboard minus zooms the canvas back");
    await page.keyboard.press("f");
    assert.equal(await page.locator("#zoom-value").textContent(), "100%", "keyboard F fits the canvas");
    await page.keyboard.press("c");
    assert.equal(await page.locator("#crop-panel").isVisible(), true, "keyboard C opens Crop");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#crop-panel").isVisible(), false, "keyboard Escape leaves Crop without applying a frame");
    await tools.getByRole("button", { name: "Size", exact: true }).click();
    assert.equal(await page.locator("#resize-panel").isVisible(), true, "contextual size panel opens only when Size is chosen");
    const destinationPicker = page.locator("#destination-picker");
    assert.equal(await destinationPicker.getByRole("button", { name: "Profile Photo", exact: true }).count(), 1, "single-image destination picker");
    await destinationPicker.getByRole("button", { name: "Profile Photo", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("512 × 512"));
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));
    assert.equal(await destinationPicker.getByText("More destinations", { exact: true }).count(), 1, "destination picker keeps less-common choices behind More");
    await destinationPicker.getByText("More destinations", { exact: true }).click();
    await destinationPicker.getByRole("button", { name: "Website Banner", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("1600 × 600"));
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));
    await page.waitForFunction(() => document.querySelector("#dirty-state")?.hidden);
    assert.equal(await page.locator("#resize-panel").isVisible(), true, "Reset keeps the user in the Size context");

    await page.locator("details.resize-advanced summary").click();
    const aspectLock = page.locator("#aspect-lock");
    assert.equal(await aspectLock.isChecked(), true, "aspect lock starts enabled");
    await page.locator("#width-input").fill("6");
    await page.waitForFunction(() => document.querySelector("#height-input")?.value === "6");
    assert.equal(await page.locator("#height-input").inputValue(), "6", "aspect lock follows width changes");
    await aspectLock.uncheck();
    await page.locator("#height-input").fill("3");
    await page.waitForFunction(() => document.querySelector("#height-input")?.value === "3");
    assert.equal(await page.locator("#width-input").inputValue(), "6", "unlocked sizing leaves width independent");
    await aspectLock.check();
    await page.waitForFunction(() => document.querySelector("#height-input")?.value === "6");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#dirty-state")?.hidden && document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));
    const cleanChrome = await editorChromeGeometry(page);
    assert.equal(cleanChrome.saveVisible, true, "loaded editor keeps the Download action visible");
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = true; });
    await page.locator("#width-input").fill("4");
    await page.waitForFunction(() => document.querySelector("#processing-status")?.textContent?.includes("Updating preview"));
    assert.equal(await page.locator("#save-button").isDisabled(), true, "stale output cannot be exported during an edit");
    const processingChrome = await editorChromeGeometry(page);
    assert.equal(processingChrome.saveVisible, true, "Download remains visible but disabled while the preview updates");
    assertStableEditorChrome(cleanChrome, processingChrome, "processing and dirty state");
    await page.locator("#height-input").fill("4");
    try {
      await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("4 × 4"), null, { timeout: 5000 });
    } catch (error) {
      const resizeDiagnostics = await page.evaluate(() => ({
        operations: window.tinyImageStarEditor?.getSnapshot?.().operations,
        engine: document.querySelector("#engine-status")?.textContent,
        processing: document.querySelector("#processing-status")?.textContent,
        summary: document.querySelector("#output-summary")?.textContent,
        dirty: !document.querySelector("#dirty-state")?.hidden,
      }));
      throw new Error(`Resize preview did not settle: ${JSON.stringify(resizeDiagnostics)}`, { cause: error });
    }
    const dirtyReadyChrome = await editorChromeGeometry(page);
    assert.equal(dirtyReadyChrome.saveVisible, true, "Download is visible when the changed preview is ready");
    assertStableEditorChrome(cleanChrome, dirtyReadyChrome, "ready dirty state");
    await assertPreviewMatchesGeneratedBytes(page, "resized editor preview");
    const editedCanvas = await page.locator("#editor-canvas").evaluate((canvas) => canvas.toDataURL());
    await page.getByRole("button", { name: "Original", exact: true }).click();
    const originalCanvas = await page.locator("#editor-canvas").evaluate((canvas) => canvas.toDataURL());
    assert.notEqual(editedCanvas, originalCanvas, "original and generated previews differ after a resize");
    await page.getByRole("button", { name: "Edited", exact: true }).click();
    await page.locator("#compare-hold-button").dispatchEvent("pointerdown");
    assert.equal(await page.locator("#show-original").getAttribute("aria-pressed"), "true", "hold comparison shows original");
    await page.locator("#compare-hold-button").dispatchEvent("pointerup");
    assert.equal(await page.locator("#show-edited").getAttribute("aria-pressed"), "true", "hold comparison restores edited preview");
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = false; });
    await page.locator("#resize-crop").click();
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("4 × 4"));
    await page.locator("#resize-fit").click();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#dirty-state")?.hidden && document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));

    await tools.getByRole("button", { name: "Crop", exact: true }).click();
    const cropShapeGroup = page.getByRole("group", { name: "Crop shape" });
    const cropPresetExpectations = [
      ["Original", (width, height) => width === 8 && height === 8],
      ["Square", (width, height) => width === height],
      ["4:3", (width, height) => width > height],
      ["3:4", (width, height) => height > width],
      ["16:9", (width, height) => width > height],
      ["9:16", (width, height) => height > width],
    ];
    for (const [label, matchesShape] of cropPresetExpectations) {
      const button = cropShapeGroup.getByRole("button", { name: label, exact: true });
      await button.click();
      assert.equal(await button.getAttribute("aria-pressed"), "true", `${label} crop preset is selected`);
      const frame = await page.evaluate(() => ({
        width: Number(document.querySelector("#crop-width-input")?.value),
        height: Number(document.querySelector("#crop-height-input")?.value),
      }));
      assert.ok(frame.width > 0 && frame.height > 0 && matchesShape(frame.width, frame.height), `${label} crop preset creates the expected frame shape (${frame.width} × ${frame.height})`);
    }
    await cropShapeGroup.getByRole("button", { name: "16:9", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("8 × 6"));
    await assertPreviewMatchesGeneratedBytes(page, "16:9 crop preset preview");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#dirty-state")?.hidden && document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));
    await tools.getByRole("button", { name: "Crop", exact: true }).click();
    await cropShapeGroup.getByRole("button", { name: "16:9", exact: true }).click();
    await page.locator("details.crop-advanced summary").click();
    const cropYBeforeKeyboard = Number(await page.locator("#crop-y-input").inputValue());
    await page.locator("#editor-canvas").focus();
    await page.keyboard.press("Shift+ArrowDown");
    await page.waitForFunction((before) => Number(document.querySelector("#crop-y-input")?.value) > before, cropYBeforeKeyboard);
    assert.ok(Number(await page.locator("#crop-y-input").inputValue()) > cropYBeforeKeyboard, "keyboard crop nudge moves the frame");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#crop-panel").getAttribute("hidden"), "", "Escape cancels a keyboard crop draft");
    await tools.getByRole("button", { name: "Crop", exact: true }).click();
    const canvasBox = await page.locator("#editor-canvas").boundingBox();
    assert.ok(canvasBox, "editor canvas has geometry for direct crop");
    const cropScale = Math.min((canvasBox.width - 56) / 8, (canvasBox.height - 56) / 8);
    const cropCenterX = canvasBox.x + canvasBox.width / 2;
    const cropBottomY = canvasBox.y + canvasBox.height / 2 + cropScale * 4;
    await page.mouse.move(cropCenterX, cropBottomY);
    await page.mouse.down();
    await page.mouse.move(cropCenterX, canvasBox.y + canvasBox.height / 2 + cropScale * 2);
    await page.mouse.up();
    await page.locator("#editor-canvas").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("8 × 6"));
    await assertPreviewMatchesGeneratedBytes(page, "direct crop preview");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));
    await tools.getByRole("button", { name: "Crop", exact: true }).click();
    const cropAdvancedFields = page.locator("details.crop-advanced");
    await cropAdvancedFields.evaluate((details) => { details.open = true; });
    await page.locator("#crop-x-input").fill("2");
    await page.locator("#crop-y-input").fill("2");
    await page.locator("#crop-width-input").fill("4");
    await page.locator("#crop-height-input").fill("4");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("4 × 4"));
    await assertPreviewMatchesGeneratedBytes(page, "advanced crop preview");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));
    await tools.getByRole("button", { name: "Rotate left", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#dirty-state")?.hidden);
    const editorShortcutModifier = process.platform === "darwin" ? "Meta" : "Control";
    await tools.getByRole("button", { name: "Size", exact: true }).click();
    await page.locator("#width-input").focus();
    await page.keyboard.press(`${editorShortcutModifier}+Z`);
    assert.equal(await page.locator("#dirty-state").isVisible(), true, "text-entry undo does not undo the canvas");
    await page.locator("#editor-canvas").focus();
    await page.keyboard.press(`${editorShortcutModifier}+Z`);
    await page.waitForFunction(() => document.querySelector("#dirty-state")?.hidden);
    await page.keyboard.press(`${editorShortcutModifier}+Shift+Z`);
    await page.waitForFunction(() => !document.querySelector("#dirty-state")?.hidden);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#dirty-state")?.hidden);
    await page.locator("#zoom-in").click();
    assert.equal(await page.locator("#zoom-value").textContent(), "125%", "shortcut isolation setup zooms the canvas");
    await page.keyboard.press(`${editorShortcutModifier}+F`);
    assert.equal(await page.locator("#zoom-value").textContent(), "125%", "browser Find shortcut is not repurposed as Fit");
    await tools.getByRole("button", { name: "Move", exact: true }).click();
    await page.keyboard.press(`${editorShortcutModifier}+C`);
    assert.equal(await page.locator("#crop-panel").isVisible(), false, "browser Copy shortcut is not repurposed as Crop");
    await page.locator("#fit-view").click();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#dirty-state")?.hidden);
    await tools.getByRole("button", { name: "Rotate right", exact: true }).click();
    await tools.getByRole("button", { name: "Rotate right", exact: true }).click();
    await tools.getByRole("button", { name: "Flip horizontal", exact: true }).click();
    await tools.getByRole("button", { name: "Flip vertical", exact: true }).click();
    await tools.getByRole("button", { name: "Adjust", exact: true }).click();
    await page.locator("#brightness-input").fill("1.25");
    assert.equal(await page.locator("#brightness-value").textContent(), "+25%", "brightness uses a human percentage");
    await page.getByRole("button", { name: "Reset brightness", exact: true }).click();
    assert.equal(await page.locator("#brightness-value").textContent(), "0", "brightness reset is immediate and visible");
    await page.locator("#brightness-input").fill("1.25");
    await page.locator("#contrast-input").fill("1.2");
    assert.equal(await page.locator("#contrast-value").textContent(), "+20%", "contrast uses a human percentage");
    await page.getByRole("checkbox", { name: "Grayscale", exact: true }).check();
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("Ready"));
    await assertPreviewMatchesGeneratedBytes(page, "compound rotate-flip-adjust preview");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#dirty-state")?.hidden && document.querySelector("#output-summary")?.textContent?.includes("8 × 8"));

    // Text is a browser-owned composition layer: the worker still produces the
    // image transform, then the final downloadable PNG is composed with the
    // same visible text. Prove the output bytes change and exercise direct
    // canvas movement rather than checking labels alone.
    const textBaselineBytes = await readLatestGeneratedBytes(page, "text baseline");
    await tools.getByRole("button", { name: "Text", exact: true }).click();
    assert.equal(await page.locator("#text-panel").isVisible(), true, "Text panel opens as a contextual tool");
    await page.locator("#add-text-button").click();
    await page.waitForFunction(() => document.querySelectorAll("#text-layer-list .text-layer-item").length === 1);
    await page.locator("#text-content").fill("Tiny Image Star");
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("Ready"));
    const textBytes = await readLatestGeneratedBytes(page, "text output");
    assert.notDeepEqual(textBytes, textBaselineBytes, "adding text changes the generated PNG bytes");
    assert.equal(await page.locator("#text-font").isVisible(), true, "built-in font choices are visible");
    assert.ok((await page.locator("#text-font option").count()) >= 4, "text has friendly built-in font choices");
    assert.equal(await page.locator("#font-drop-zone").getAttribute("role"), "button", "font drop zone is keyboard-addressable");
    assert.match(await page.locator("#font-drop-zone").textContent(), /Google Fonts/, "font drop explains the download-then-drop path");
    const textSnapshotBeforeMove = await page.evaluate(() => window.tinyImageStarEditor.getSnapshot().operations.textLayers[0]);
    const textCanvasBox = await page.locator("#editor-canvas").boundingBox();
    assert.ok(textCanvasBox, "text canvas has geometry for direct manipulation");
    await page.mouse.move(textCanvasBox.x + textCanvasBox.width / 2, textCanvasBox.y + textCanvasBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(textCanvasBox.x + textCanvasBox.width / 2 + 42, textCanvasBox.y + textCanvasBox.height / 2 + 18);
    await page.mouse.up();
    await page.waitForFunction((before) => {
      const layer = window.tinyImageStarEditor.getSnapshot().operations.textLayers[0];
      return layer && (layer.x !== before.x || layer.y !== before.y);
    }, textSnapshotBeforeMove);
    assert.equal(await page.locator("#dirty-state").isVisible(), true, "moving text marks the image as changed");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("8 × 8") && document.querySelector("#dirty-state")?.hidden);
    assert.equal(await page.evaluate(() => window.tinyImageStarEditor.getSnapshot().operations.textLayers.length), 0, "Reset removes the local text layer");
    await tools.getByRole("button", { name: "Move", exact: true }).click();

    const directSaveDownloadPromise = page.waitForEvent("download", { timeout: 3000 }).catch(() => null);
    const directPreviewBytes = await readLatestGeneratedBytes(page, "direct single-image preview");
    await page.getByRole("button", { name: "Download current PNG", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "Download your image", exact: true }).count(), 0, "single verified format downloads without a redundant sheet");
    const directSaveDownload = await directSaveDownloadPromise;
    if (directSaveDownload) assert.deepEqual(await readFile(await directSaveDownload.path()), directPreviewBytes, "direct single-format Download downloads the current preview bytes");
    await page.waitForFunction(() => document.querySelector("#processing-status")?.textContent?.includes("Download started for the current PNG image."));
    const singleKeyboardDownloadPromise = page.waitForEvent("download", { timeout: 3000 }).catch(() => null);
    await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+S`);
    const singleKeyboardDownload = await singleKeyboardDownloadPromise;
    if (singleKeyboardDownload) assert.deepEqual(await readFile(await singleKeyboardDownload.path()), directPreviewBytes, "single-format keyboard Save downloads the current preview bytes");
    await page.waitForFunction(() => document.querySelector("#processing-status")?.textContent?.includes("Download started for the current PNG image."));

    await page.getByRole("button", { name: "Save recipe", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Smoke recipe");
    await page.locator("#preset-destination-input").selectOption("instagram-square");
    await page.locator("#preset-resize-mode-input").selectOption("crop");
    await page.getByRole("button", { name: "Save preset", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#preset-dialog").open);
    await page.getByRole("button", { name: "Presets", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Create a preset", exact: true }).count(), 1, "preset drawer create action");
    const savedRecipe = page.locator(".preset-card").filter({ hasText: "Smoke recipe" }).first();
    assert.equal(await savedRecipe.count(), 1, "custom preset saved");
    assert.match(await savedRecipe.textContent(), /1080 × 1080/, "destination choice becomes saved dimensions");
    await savedRecipe.locator(".preset-more summary").click();
    await savedRecipe.getByRole("button", { name: "Duplicate", exact: true }).click();
    await page.getByRole("heading", { name: "Smoke recipe copy", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Smoke recipe copy", exact: true }).count(), 1, "custom preset duplicated");
    page.once("dialog", (dialog) => dialog.accept());
    await savedRecipe.locator(".preset-more summary").click();
    await savedRecipe.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("heading", { name: "Smoke recipe", exact: true }).waitFor({ state: "detached" });
    const copiedRecipe = page.locator(".preset-card").filter({ hasText: "Smoke recipe copy" }).first();
    await copiedRecipe.locator(".preset-more summary").click();
    page.once("dialog", (dialog) => dialog.accept());
    await copiedRecipe.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("heading", { name: "Smoke recipe copy", exact: true }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.locator("#batch-button").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "New set", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#image-tray")?.hidden && document.querySelector("#batch-button")?.hidden);
    await page.locator("#file-input").setInputFiles([firstFixture, secondFixture]);
    await page.waitForFunction(() => !document.querySelector("#image-tray")?.hidden && document.querySelector("#tray-count")?.textContent === "2 images");
    assert.equal(await page.locator("#batch-view").isVisible(), false, "multiple import stays in the canvas workspace");
    assert.equal(await page.locator("#tray-list .tray-item").count(), 2, "workspace tray contains both images");
    await page.waitForFunction(() => !document.querySelector("#tray-save-button")?.disabled);
    await selectRecipeRevision(page, "#tray-preset-picker", "instagram-square");
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 2 previews"));
    await page.locator("#batch-file-input").setInputFiles([exifFixture]);
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "3 images" && document.querySelector("#batch-status")?.textContent?.includes("Ready — 3 previews"));
    assert.match(await page.locator("#tray-list").textContent(), /Review framing/, "the canvas tray also marks the shape-mismatched image");
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-view")?.getAttribute("data-review") === "true");
    assert.equal(await page.locator("#batch-framing-notice").isVisible(), true, "mixed source shapes show a framing review notice");
    const framingCard = page.locator(".batch-card").filter({ hasText: "orientation6.jpg" }).first();
    assert.equal(await framingCard.getAttribute("data-review-framing"), "true", "the shape-mismatched card is marked for framing review");
    assert.match(await framingCard.textContent(), /Review framing/, "the marked card explains the next action");
    await framingCard.locator(".batch-card-more summary").click();
    await framingCard.getByRole("button", { name: "Remove image", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "2 images" && document.querySelector("#batch-framing-notice")?.hidden === true);
    await leaveReviewAndEnsureEditor(page);
    await selectRecipeRevision(page, "#tray-preset-picker", "keep-original");
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 2 previews"));
    const traySelectAll = page.locator("#tray-select-all-button");
    assert.equal(await traySelectAll.textContent(), "Clear selection", "tray reflects default all-ready selection");
    await traySelectAll.click();
    assert.equal(await page.locator("#tray-save-button").isDisabled(), true, "tray clear selection disables save");
    await traySelectAll.click();
    assert.equal(await page.locator("#tray-save-button").isDisabled(), false, "tray select all enables save");
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator("#mobile-batch-settings").click();
      assert.equal(await page.locator("#tray-footer").isVisible(), true, `batch settings keeps save footer reachable at ${width}px`);
      assert.equal(await page.getByRole("button", { name: /Save selected/ }).isVisible(), true, `batch settings keeps Save selected reachable at ${width}px`);
      await page.locator("#tray-save-button").scrollIntoViewIfNeeded();
      const saveRect = await page.locator("#tray-save-button").boundingBox();
      const saveRight = saveRect ? saveRect.x + saveRect.width : null;
      const saveBottom = saveRect ? saveRect.y + saveRect.height : null;
      assert.ok(saveRect && saveRight <= width + 1 && saveBottom <= 844 + 1, `workspace tray save action stays in viewport at ${width}px: ${JSON.stringify(saveRect)}`);
      await page.keyboard.press("Escape");
    }
    await assertViewportMatrix(page, "loaded workspace tray", traySelectors, true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = true; });
    await selectRecipeRevision(page, "#tray-preset-picker", "website-banner");
    await page.waitForFunction(() => !document.querySelector("#batch-cancel-button")?.hidden);
    await page.locator("#batch-cancel-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-cancel-button")?.hidden && document.querySelector("#batch-status")?.textContent?.includes("Updates cancelled"));
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = false; });
    assert.equal(await page.locator("#batch-button").textContent(), "Results (2)", "an active image set uses one contextual Results action");
    assert.equal(await page.locator("#batch-button").getAttribute("aria-label"), "View results for 2 images", "Results action names the active set for assistive technology");
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-view")?.getAttribute("data-review") === "true");
    for (let index = 0; index < 2; index += 1) {
      const cancelledCard = page.locator(".batch-card").nth(index);
      await cancelledCard.locator(".batch-card-more summary").click();
      await cancelledCard.getByRole("button", { name: "Retry", exact: true }).click();
      await page.waitForFunction((expected) => document.querySelector("#batch-status")?.textContent?.includes(`Ready — ${expected} preview`), index + 1);
    }
    await leaveReviewAndEnsureEditor(page);
    await page.waitForFunction(() => !document.querySelector("#image-tray")?.hidden);
    await page.locator("#tray-list .tray-item").nth(1).locator(".tray-item-open").click();
    await page.waitForFunction(() => document.querySelector("#file-name")?.textContent === "two.png");
    await tools.getByRole("button", { name: "Rotate right", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#tray-apply-edits-button")?.disabled);
    assert.equal(await page.locator("#tray-scope-select").inputValue(), "all", "multi-image edits default to the whole set");
    await page.locator("#tray-apply-edits-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Applied the current canvas changes to all images"));
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 2 previews"));
    await page.locator("#tray-list .tray-item").nth(0).locator(".tray-item-open").click();
    await page.waitForFunction(() => document.querySelector("#file-name")?.textContent === "one.png" && window.tinyImageStarEditor?.getSnapshot?.().operations?.rotation === 90);
    assert.equal(await page.evaluate(() => window.tinyImageStarEditor.getSnapshot().operations.rotation), 90, "Apply to all merges the current rotation into every image");
    await page.locator("#tray-list .tray-item").nth(1).locator(".tray-item-open").click();
    await page.waitForFunction(() => document.querySelector("#file-name")?.textContent === "two.png" && window.tinyImageStarEditor?.getSnapshot?.().operations?.rotation === 90);
    assert.equal(await page.evaluate(() => window.tinyImageStarEditor.getSnapshot().operations.rotation), 90, "the edited image keeps the same shared rotation");
    await tools.getByRole("button", { name: "Flip horizontal", exact: true }).click();
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.querySelectorAll(".batch-card")[1]?.textContent?.includes("Edited for this image"));
    await leaveReviewAndEnsureEditor(page);
    await page.waitForFunction(() => !document.querySelector("#image-tray")?.hidden);
    assert.ok(await page.locator("#tray-preset-picker option").allTextContents().then((options) => options.includes("Website Banner")), "tray destination picker uses human-readable names");
    await selectRecipeRevision(page, "#tray-preset-picker", "website-banner");
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 2 previews"));
    await page.waitForFunction(() => document.querySelector("#output-summary")?.textContent?.includes("1600 × 600"));
    await page.locator("#batch-button").click();
    assert.equal(await page.locator("#editor-view").isVisible(), true, "review keeps the canvas workspace visible");
    assert.equal(await page.locator("#batch-view").getAttribute("data-review"), "true", "active image review opens as a contextual drawer");
    assert.equal(await page.getByRole("button", { name: "Back to editor", exact: true }).isVisible(), true, "results drawer has an explicit return action");
    assert.equal(await page.locator("#batch-preset-more").getAttribute("open"), null, "Results keeps secondary destinations collapsed until requested");
    const reviewGeometry = await page.evaluate(() => {
      const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
      const drawer = document.querySelector('#batch-view[data-review="true"]')?.getBoundingClientRect();
      return { topbarBottom: topbar?.bottom ?? 0, drawerTop: drawer?.top ?? 0 };
    });
    assert.ok(reviewGeometry.drawerTop >= reviewGeometry.topbarBottom - 1, "review drawer starts below the responsive header");
    const trayEditedCard = page.locator(".batch-card").nth(1);
    assert.match(await trayEditedCard.textContent(), /1600 × 600/, "tray edit keeps the shared destination result");
    assert.match(await trayEditedCard.textContent(), /Edited for this image/, "tray edit is marked as a local override");

    await page.getByRole("button", { name: "Presets", exact: true }).click();
    assert.equal(await page.locator("#presets-view").isVisible(), true, "Presets opens above the active canvas workspace");
    assert.equal(await page.locator("#batch-view").isVisible(), false, "opening Presets closes the contextual review drawer");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await page.locator("#editor-view").isVisible(), true, "closing Presets returns to the canvas workspace");
    await page.locator("#batch-button").click();
    assert.equal(await page.locator("#batch-view").getAttribute("data-review"), "true", "the active review can be reopened after Presets");

    await leaveReviewAndEnsureEditor(page);
    await page.waitForFunction(() => !document.querySelector("#image-tray")?.hidden);
    assert.equal(await page.locator("#batch-view").isVisible(), false, "closing review returns to the same canvas workspace");
    await page.evaluate(() => window.tinyImageStarEditor.setCapabilities({
      inputFormats: ["png"],
      outputFormats: ["png", "jpeg"],
      compression: { lossy: true, lossyFormats: ["jpeg"], quality: true },
    }));
    await page.waitForFunction(() => !document.querySelector("#format-tool")?.hidden);
    await page.setViewportSize({ width: 390, height: 844 });
    const formatToolBounds = await page.locator("#format-tool").boundingBox();
    const formatGroupBounds = await page.locator(".tool-primary-group").boundingBox();
    const formatToolRight = formatToolBounds ? formatToolBounds.x + formatToolBounds.width : null;
    const formatGroupRight = formatGroupBounds ? formatGroupBounds.x + formatGroupBounds.width : null;
    assert.ok(formatToolBounds && formatGroupBounds && formatToolBounds.x >= formatGroupBounds.x - 1 && formatToolRight <= formatGroupRight + 1, `capability-gated Format action stays inside the mobile primary tools (${JSON.stringify({ formatToolBounds, formatGroupBounds })})`);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: "Format", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-format-details")?.open === true);
    await page.waitForFunction(() => !document.querySelector("#tray-format-control")?.hidden);
    assert.ok(await page.locator("#tray-format-select option").allTextContents().then((options) => options.includes("JPEG")), "workspace tray exposes verified output formats");
    await page.locator("#tray-format-select").selectOption("jpeg");
    await page.waitForFunction(() => document.querySelector("#tray-lossy-control")?.hidden === false);
    assert.equal(await page.locator("#tray-lossy-toggle").isChecked(), false, "lossy starts off for a newly selected format");
    assert.equal(await page.locator("#tray-quality-select").isVisible(), true, "shared quality is visible beside the shared format");
    await page.locator("#tray-quality-select").selectOption("80");
    assert.equal(await page.locator("#tray-lossy-toggle").isChecked(), true, "choosing shared Low quality enables smaller-file compression");
    assert.equal(await page.locator("#tray-quality-select").inputValue(), "80", "shared Low quality maps to 80");
    await page.locator("#tray-quality-select").selectOption("95");
    assert.equal(await page.locator("#tray-quality-select").inputValue(), "95", "shared Medium quality maps to 95");
    await page.locator("#tray-quality-select").selectOption("100");
    assert.equal(await page.locator("#tray-quality-select").inputValue(), "100", "shared High quality maps to 100");
    await page.evaluate(() => window.tinyImageStarEditor.setCapabilities({
      outputFormats: ["png", "jpeg", "avif"],
      compression: { lossy: true, lossyFormats: ["jpeg", "avif"], quality: true },
    }));
    await page.locator("#tray-format-select").selectOption("avif");
    try {
      await page.waitForFunction(() => {
        const status = document.querySelector("#batch-status")?.textContent ?? "";
        const processing = !document.querySelector("#batch-cancel-button")?.hidden;
        const errorCard = [...document.querySelectorAll(".batch-card")].some((card) => /output format is not available/i.test(card.textContent ?? ""));
        return !processing && (status.includes("could not be updated") || errorCard);
      }, { timeout: 10000 });
    } catch (error) {
      console.error("format flow state", await page.evaluate(() => ({
        status: document.querySelector("#batch-status")?.textContent,
        cancelHidden: document.querySelector("#batch-cancel-button")?.hidden,
        cards: [...document.querySelectorAll(".batch-card")].map((card) => card.textContent),
      })));
      throw error;
    }
    assert.match(await page.locator(".batch-card").first().textContent(), /AVIF/, "failed shared format remains visible in the card metadata");
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => !document.querySelector("#batch-format-control")?.hidden);
    assert.ok(await page.locator("#batch-format-select option").allTextContents().then((options) => options.includes("JPEG")), "image-set surface exposes the same output formats");
    assert.equal(await page.locator("#batch-lossy-control").isVisible(), true, "image-set surface exposes the same compression toggle");
    if (!(await page.locator("#batch-preset-more").getAttribute("open"))) await page.locator("#batch-preset-more summary").click();
    const multiFormatCardMenu = page.locator(".batch-card").first().locator(".batch-card-more");
    if (!(await multiFormatCardMenu.getAttribute("open"))) await multiFormatCardMenu.locator("summary").click();
    await assertResultsViewportMatrix(page, "multi-format Results responsive surface");
    await page.locator("#batch-format-reset").click();
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 2 previews"));
    assert.equal(await page.locator("#tray-lossy-toggle").isChecked(), false, "resetting to a PNG recipe clears stale shared lossy state");
    await leaveReviewAndEnsureEditor(page);
    await page.waitForFunction(() => !document.querySelector("#image-tray")?.hidden);
    await page.locator("#tray-list .tray-item").nth(0).locator(".tray-item-open").click();
    await page.waitForFunction(() => document.querySelector("#file-name")?.textContent === "one.png");
    await page.evaluate(() => window.tinyImageStarEditor.setCapabilities({
      inputFormats: ["png"],
      outputFormats: ["png", "jpeg"],
      compression: { lossy: true, lossyFormats: ["jpeg"], quality: true },
    }));
    await tools.getByRole("button", { name: "Format", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-format-details")?.open === true);
    await page.locator("#output-format-select").selectOption("jpeg");
    await page.waitForFunction(() => document.querySelector("#compression-options")?.hidden === false);
    await page.locator("#quality-details summary").click();
    await page.locator("#quality-input").fill("55");
    await page.waitForFunction(() => document.querySelector("#quality-value")?.textContent === "55");
    await page.locator("#lossy-toggle").check();
    await page.waitForFunction(() => document.querySelector("#processing-status")?.textContent?.includes("Ready to download"));
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.querySelector(".batch-card")?.textContent?.includes("JPEG"));
    assert.match(await page.locator(".batch-card").first().textContent(), /JPEG/, "manual format override returns to the image set");
    await page.locator("#batch-format-select").selectOption("png");
    await page.waitForFunction(() => {
      const cancel = document.querySelector("#batch-cancel-button");
      const untouchedResult = document.querySelectorAll(".batch-card")[1]?.querySelector(".batch-pane-after img");
      return Boolean(cancel?.hidden && untouchedResult && document.querySelector(".batch-card")?.textContent?.includes("JPEG"));
    });
    assert.match(await page.locator(".batch-card").first().textContent(), /JPEG/, "shared format change does not silently replace a manual format override");
    assert.match(await page.locator(".batch-card").nth(1).textContent(), /PNG|Ready/, "shared format change still applies to an untouched image");
    const formatOverrideCard = page.locator(".batch-card").first();
    await formatOverrideCard.locator(".batch-card-more summary").click();
    await formatOverrideCard.getByRole("button", { name: "Edit on canvas", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#file-name")?.textContent === "one.png");
    await tools.getByRole("button", { name: "Format", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#output-format-details")?.open === true);
    assert.equal(await page.locator("#output-format-select").inputValue(), "jpeg", "manual format remains selected after a shared format change");
    assert.equal(await page.locator("#lossy-toggle").isChecked(), true, "manual compression remains selected after a shared format change");
    assert.equal(await page.locator("#quality-input").inputValue(), "55", "manual quality remains selected after a shared format change");
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.querySelector(".batch-card")?.textContent?.includes("JPEG"));
    await page.waitForFunction(() => {
      const status = document.querySelector("#batch-status")?.textContent ?? "";
      return Boolean(document.querySelector("#batch-cancel-button")?.hidden && (/Ready/.test(status) || /could not be updated/.test(status)));
    });
    const refreshedFormatOverrideCard = page.locator(".batch-card").first();
    await refreshedFormatOverrideCard.locator(".batch-card-more summary").click();
    await refreshedFormatOverrideCard.getByRole("button", { name: "Reset to preset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 2 previews"));
    await page.getByRole("button", { name: "Save recipe", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Format recipe");
    await page.locator("#preset-dialog details.advanced-details summary").click();
    await page.locator("#preset-format-input").selectOption("jpeg");
    await page.waitForFunction(() => document.querySelector("#preset-compression-options")?.hidden === false);
    assert.equal(await page.locator("#preset-lossy-input").isChecked(), false, "preset format selection does not silently enable lossy compression");
    await page.locator("#preset-lossy-input").check();
    await page.locator("#preset-quality-input").selectOption("95");
    await page.getByRole("button", { name: "Save preset", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#preset-dialog").open);
    const savedFormatRecipe = await page.evaluate(async () => {
      const entries = (await (await import("./src/styles/catalog.js")).readRecipeCatalog()).recipes;
      return entries.find((entry) => entry.name === "Format recipe");
    });
    assert.equal(savedFormatRecipe?.operations?.format, "jpeg", "saved preset retains selected output format");
    assert.equal(savedFormatRecipe?.operations?.lossy, true, "saved preset retains explicit compression choice");
    assert.equal(savedFormatRecipe?.operations?.quality, 95, "saved preset retains Medium quality (95)");
    await page.getByRole("button", { name: "Presets", exact: true }).click();
    const savedFormatCard = page.locator(".preset-card").filter({ hasText: "Format recipe" }).first();
    assert.match(await savedFormatCard.textContent(), /JPEG output/, "saved preset exposes final format in its details");
    await savedFormatCard.locator(".preset-more summary").click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#presets-view")?.hidden && !document.querySelector("#image-tray")?.hidden);
    await page.locator("#tray-preset-picker").selectOption({ label: "Format recipe · version 1" });
    await page.waitForFunction(() => {
      const status = document.querySelector("#batch-status")?.textContent ?? "";
      const cards = [...document.querySelectorAll(".batch-card")].map((card) => card.textContent ?? "");
      return !status.includes("Updating") && cards.some((text) => /JPEG/.test(text));
    });
    assert.match(await page.locator("#batch-grid").textContent(), /JPEG/, "applying a saved final-format recipe carries its format into the active batch");
    // Restore the shared destination used by the session-recovery assertions
    // before deleting the temporary custom recipe and reloading the page.
    await selectRecipeRevision(page, "#tray-preset-picker", "website-banner");
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 2 previews"));
    await page.getByRole("button", { name: "Presets", exact: true }).click();
    const savedFormatCardAfterApply = page.locator(".preset-card").filter({ hasText: "Format recipe" }).first();
    page.once("dialog", (dialog) => dialog.accept());
    await savedFormatCardAfterApply.locator(".preset-more summary").click();
    await savedFormatCardAfterApply.getByRole("button", { name: "Delete", exact: true }).click();
    await savedFormatCardAfterApply.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
    await page.waitForFunction(() => !document.querySelector("#session-recovery")?.hidden);
    assert.match(await page.locator("#session-recovery-message").textContent(), /Restore 2 images/ , "last image set recovery offer");
    await assertViewportMatrix(page, "session recovery actions", [".session-recovery-actions .button"]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#session-recovery")?.hidden && document.querySelectorAll(".batch-card").length === 2 && document.querySelector("#batch-status")?.textContent?.includes("Ready — 2 previews"));
    await page.waitForFunction(() => !document.querySelector("#editor-view")?.hidden && !document.querySelector("#image-tray")?.hidden && document.querySelector("#batch-view")?.getAttribute("data-review") === "true");
    assert.equal(await page.locator("#batch-button").textContent(), "Results (2)", "restoring an active set opens its current item in the shared workspace");
    assert.match(await page.locator("#batch-grid").textContent(), /Website Banner/, "restored shared destination");
    assert.match(await page.locator("#batch-grid").textContent(), /Edited for this image/, "restored per-item override");
    assert.equal(await page.locator("#batch-selection-count").textContent(), "2 selected to download", "restored selection");
    await page.getByRole("button", { name: "Back to editor", exact: true }).click();
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#editor-canvas");
      const name = document.querySelector("#file-name")?.textContent ?? "";
      return Boolean(canvas && !canvas.hidden && /\.png$/i.test(name));
    });
    assert.equal(await page.locator("#empty-editor").isVisible(), false, "Editor navigation reopens the active restored image");
    assert.equal(await page.locator("#image-tray").isVisible(), true, "reopened editor keeps the restored image tray");
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-view")?.getAttribute("data-review") === "true");
    const restoredOverrideCard = page.locator(".batch-card").nth(1);
    await restoredOverrideCard.locator(".batch-card-more summary").click();
    await restoredOverrideCard.getByRole("button", { name: "Reset to preset", exact: true }).click();
    await page.waitForFunction(() => !document.querySelectorAll(".batch-card")[1]?.textContent?.includes("Edited for this image"), "restored override reset");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "New set", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".batch-card").length === 0);

    assert.equal(await page.locator("#batch-button").isHidden(), true, "Results disappears when there is no active image set");
    assert.equal(await page.getByRole("button", { name: "Choose images", exact: true }).count(), 1, "the empty workspace returns to one intentional image chooser");
    assert.equal(await page.getByRole("button", { name: "Add images", exact: true }).count(), 0, "the empty workspace does not leave a stale active-set action");
    await page.evaluate(() => window.tinyImageStarEditor.setCapabilities({
      inputFormats: ["png"],
      outputFormats: ["png", "jpeg"],
      compression: { lossy: true, lossyFormats: ["jpeg"], quality: true },
    }));
    await page.locator("#batch-file-input").setInputFiles([firstFixture]);
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "1 image");
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-view")?.getAttribute("data-review") === "true");
    await page.waitForFunction(() => !document.querySelector("#batch-format-control")?.hidden);
    assert.ok(await page.locator("#batch-format-select option").allTextContents().then((options) => options.includes("JPEG")), "capability-gated batch format option");
    await page.evaluate(() => window.tinyImageStarEditor.setCapabilities({ outputFormats: ["png", "jpeg", "avif"] }));
    await page.locator("#batch-format-select").selectOption("avif");
    assert.match(await page.locator("#batch-preset-name").textContent(), /AVIF/, "batch format override label");
    assert.equal(await page.locator("#batch-format-reset").isVisible(), true, "batch recipe format reset");
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("could not be updated"));
    assert.match(await page.locator(".batch-card").first().textContent(), /output format is not available yet/i, "unsupported claimed format fails honestly");
    assert.equal(await page.locator("#batch-save-button").isDisabled(), true, "batch Download stays disabled when no selected output completed");
    await page.locator("#batch-format-reset").click();
    assert.equal(await page.locator("#batch-format-reset").isVisible(), false, "batch format override cleared");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
    await clearSessionOfferIfPresent(page);
    await page.locator("#empty-folder-button").click();
    await page.locator("#batch-folder-input").setInputFiles(folderDirectory);
    try {
      // The filename/tray metadata arrive before the asynchronous first-image
      // decode. Wait for the actual canvas to replace the empty editor too.
      await page.waitForFunction(() => /^(one|two)\.png$/.test(document.querySelector("#file-name")?.textContent ?? "") && !document.querySelector("#image-tray")?.hidden && document.querySelector("#tray-count")?.textContent === "2 images" && document.querySelector("#empty-editor")?.hidden, null, { timeout: 10000 });
    } catch (error) {
      const folderState = await page.evaluate(() => ({
        fileName: document.querySelector("#file-name")?.textContent,
        trayHidden: document.querySelector("#image-tray")?.hidden,
        trayCount: document.querySelector("#tray-count")?.textContent,
        batchStatus: document.querySelector("#batch-status")?.textContent,
        editorHidden: document.querySelector("#empty-editor")?.hidden,
        batchHidden: document.querySelector("#batch-view")?.hidden,
      }));
      throw new Error(`folder import did not settle: ${JSON.stringify(folderState)}; ${error.message}`);
    }
    assert.equal(await page.locator("#batch-view").isVisible(), false, "folder import uses the same canvas workspace");
    assert.equal(await page.locator("#empty-editor").isVisible(), false, "folder import opens the first image");
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-view")?.getAttribute("data-review") === "true");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "New set", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".batch-card").length === 0);
    await assertViewportMatrix(page, "empty editor import actions", ["#empty-editor-actions .button", "#batch-button"]);
    await assertViewportMatrix(page, "empty editor recipe navigation", [".workspace-nav > .button:not([hidden])"]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = true; });
    await page.locator("#batch-file-input").setInputFiles([firstFixture, secondFixture]);
    await page.waitForFunction(() => !document.querySelector("#batch-cancel-button")?.hidden);
    assert.equal(await page.locator("#tray-cancel-button").isHidden(), true, "the global processing bar owns cancellation while the set is active");
    await page.getByRole("button", { name: "Cancel updates", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Updates cancelled"));
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = false; });
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-view")?.getAttribute("data-review") === "true");
    const cancelledCard = page.locator(".batch-card").first();
    await cancelledCard.locator(".batch-card-more summary").click();
    await cancelledCard.getByRole("button", { name: "Retry", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 1 preview"));
    assert.equal(await page.getByRole("button", { name: "Clear completed", exact: true }).isDisabled(), false, "completed retry can be cleared");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
    await clearSessionOfferIfPresent(page);
    assert.equal(await page.locator("#empty-folder-button").textContent(), "Choose folder (up to 40)", "the fallback folder path discloses the interactive limit before selection");
    await page.locator("#batch-file-input").setInputFiles(Array.from({ length: 41 }, () => firstFixture));
    await page.waitForFunction(() => document.querySelector("#canvas-status")?.textContent?.includes("up to 40 images") && document.querySelector("#canvas-status")?.textContent?.includes("Chrome or Edge"));
    await page.locator("#batch-file-input").setInputFiles([firstFixture, animatedFixture]);
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "2 images" && document.querySelector("#tray-save-button")?.disabled === false);
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 1 preview"));
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 1 preview"));
    assert.equal(await page.locator(".batch-card").count(), 2, "unsupported animated input remains visible as an error card");
    assert.match(await page.locator(".batch-card").nth(1).textContent(), /Animated images are not supported/, "animated input explains the loss boundary");
    await page.getByRole("button", { name: "Clear completed", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".batch-card").length === 1 && document.querySelector("#batch-status")?.textContent?.includes("Cleared 1 completed preview"));
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "New set", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".batch-card").length === 0);
    await page.locator("#batch-file-input").setInputFiles([firstFixture, secondFixture]);
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "2 images" && document.querySelector("#batch-status")?.textContent?.includes("Ready — 2 previews"));
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-view")?.getAttribute("data-review") === "true");
    assert.equal(await page.locator("#batch-preset-picker > button", { hasText: "Edit without resizing" }).count(), 0, "no-resize utility is not presented as a primary destination");
    assert.equal(await page.locator("#batch-preset-more").getAttribute("open"), null, "a utility recipe is summarized without expanding every secondary destination");
    await page.getByRole("button", { name: "Instagram Post (Square)", exact: true }).click();
    await page.getByRole("button", { name: "Profile Photo", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#batch-grid")?.textContent?.includes("512 × 512"));
    assert.match(await page.locator("#batch-grid").textContent(), /512 × 512/, "quick destination applies before More is opened");
    assert.equal(await page.locator("#batch-preset-more").count(), 1, "batch destinations keep less-common choices behind More");
    await page.locator("#batch-preset-more summary").click();
    assert.equal(await page.locator("#batch-preset-more").getByRole("button", { name: "YouTube Thumbnail", exact: true }).count(), 1, "batch More exposes less-common destinations");
    await page.getByRole("button", { name: "Website Banner", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 2 previews. 2 selected to download."));
    assert.match(await page.locator("#batch-grid").textContent(), /1600 × 600/);
    await page.locator("#batch-file-input").setInputFiles([thirdFixture]);
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 3 previews. 3 selected to download."));
    assert.equal(await page.locator(".batch-card").count(), 3, "appending keeps the existing batch items");

    const duplicateDialogPromise = page.waitForEvent("dialog");
    await page.locator("#batch-file-input").setInputFiles([thirdFixture]);
    const duplicateDialog = await duplicateDialogPromise;
    assert.match(duplicateDialog.message(), /already in this image set/, "duplicate input warning");
    await duplicateDialog.accept();
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 4 previews. 4 selected to download."));
    assert.equal(await page.locator(".batch-card").count(), 4, "the same file can be selected again after the input resets");
    const fourCards = page.locator(".batch-card");
    const fourCardCount = await fourCards.count();
    assert.equal(fourCardCount, 4, "four cards before removal");
    const duplicateCard = fourCards.nth(3);
    await duplicateCard.locator(".batch-card-more summary").click();
    await duplicateCard.getByRole("button", { name: "Remove image", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".batch-card") && document.querySelectorAll(".batch-card").length === 3);
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 3 previews. 3 selected to download."));
    assert.match(await page.locator("#batch-status").textContent(), /Ready — 3 previews/);

    await page.locator("#batch-file-input").setInputFiles([longNameFixture]);
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 4 previews. 4 selected to download."));
    const longNameCard = page.locator(".batch-card").filter({ hasText: "a-very-long-image-name" }).first();
    assert.equal(await longNameCard.count(), 1, "Results renders an imported long filename");
    assert.match(await longNameCard.locator(".batch-card-title").getAttribute("title"), /a-very-long-image-name/, "truncated long filenames remain available as a native tooltip");
    await longNameCard.locator(".batch-card-more summary").click();
    assert.equal(await longNameCard.locator(".batch-card-actions").isVisible(), true, "long-name card actions can be opened");

    await assertViewportMatrix(page, "loaded Results actions", imageActionSelectors);
    await assertViewportMatrix(page, "loaded Results recipe", imagePresetSelectors);
    await assertResultsViewportMatrix(page, "loaded Results responsive surface");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await assertResultsResponsiveGeometry(page, "loaded Results at 200% text size");
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    const mobileLongNameMenu = longNameCard.locator(".batch-card-more");
    await mobileLongNameMenu.evaluate((details) => { details.open = false; });
    const mobileLongNameSummary = mobileLongNameMenu.locator("summary");
    await mobileLongNameSummary.scrollIntoViewIfNeeded();
    assert.equal(await mobileLongNameSummary.evaluate((summary) => {
      const rect = summary.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(hit && (hit === summary || summary.contains(hit)));
    }), true, "mobile Results card menu is not covered by the underlying editor controls");
    await mobileLongNameSummary.click();
    assert.equal(await mobileLongNameMenu.getAttribute("open"), "", "mobile Results card menu opens from a real click");
    assert.equal(await mobileLongNameMenu.getByRole("button", { name: "Remove image", exact: true }).isVisible(), true, "mobile Results actions are visible after opening the menu");
    await longNameCard.getByRole("button", { name: "Remove image", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".batch-card").length === 3 && document.querySelector("#batch-status")?.textContent?.includes("Ready — 3 previews. 3 selected to download."));
    await page.setViewportSize({ width: 390, height: 844 });
    const compareButton = page.getByRole("button", { name: "Compare original for one.png", exact: true });
    assert.equal(await compareButton.count(), 1, "mobile original comparison control exists");
    assert.equal(await compareButton.isVisible(), true, "mobile original comparison control is visible");
    await assertNoLayoutCollisions(page, "loaded Results mobile actions", imageActionSelectors);
    await page.setViewportSize({ width: 1280, height: 720 });
    const resultFirstCard = page.locator(".batch-card").first();
    assert.equal(await resultFirstCard.locator(".batch-pane-after").isVisible(), true, "batch cards show the result first");
    assert.equal(await resultFirstCard.locator(".batch-pane-before").isVisible(), false, "batch cards hide the duplicate original by default");
    await resultFirstCard.getByRole("button", { name: "Compare original for one.png", exact: true }).dispatchEvent("pointerdown");
    assert.equal(await resultFirstCard.locator(".batch-pane-before").isVisible(), true, "batch hold comparison reveals the original");
    assert.equal(await resultFirstCard.locator(".batch-pane-after").isVisible(), false, "batch hold comparison hides the result");
    await resultFirstCard.getByRole("button", { name: "Compare original for one.png", exact: true }).dispatchEvent("pointerup");
    assert.equal(await resultFirstCard.locator(".batch-pane-after").isVisible(), true, "batch hold comparison restores the result");

    await page.locator(".batch-card").first().locator(".batch-card-more summary").click();
    const individualDownloadPromise = page.waitForEvent("download", { timeout: 3000 }).catch(() => null);
    await page.getByRole("button", { name: "Download PNG", exact: true }).first().click();
    const individualDownload = await individualDownloadPromise;
    if (individualDownload) {
      const individualBytes = await readFile(await individualDownload.path());
      assertPngBytes(individualBytes, "individual batch download");
      assert.match(individualDownload.suggestedFilename(), /^one-\d{8}-\d{6}-website-banner\.png$/, "individual download uses source, timestamp, destination, and actual extension");
    }
    assert.match(await page.locator("#batch-status").textContent(), /Download started for the selected PNG image\./);
    await page.locator(".batch-card").first().locator(".batch-card-more summary").click();

    await page.locator("#batch-select-all").click();
    const saveChecks = page.getByRole("checkbox", { name: "Select", exact: true });
    await saveChecks.nth(0).check();
    assert.equal(await page.getByRole("button", { name: "Save image", exact: true }).isDisabled(), false, "single batch selection enables save");
    await saveChecks.nth(1).check();
    assert.equal(await page.getByRole("button", { name: "Save 2 images", exact: true }).isDisabled(), false, "batch selection enables direct folder save");
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry("selected-output", { recursive: true }).catch(() => {});
      window.__tinystarSelectedOutputHandle = await root.getDirectoryHandle("selected-output", { create: true });
      window.__tinystarPickerCalls = 0;
      window.__tinystarDirectoryPicker = async () => {
        window.__tinystarPickerCalls += 1;
        return window.__tinystarSelectedOutputHandle;
      };
    });
    await page.getByRole("button", { name: "Save 2 images", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Saved 2 images directly into"));
    const directFolderSave = await page.evaluate(async () => {
      const folders = [];
      for await (const [name, handle] of window.__tinystarSelectedOutputHandle.entries()) {
        if (handle.kind !== "directory") continue;
        const files = [];
        for await (const [fileName, fileHandle] of handle.entries()) {
          const file = await fileHandle.getFile();
          files.push({ name: fileName, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
        }
        folders.push({ name, files });
      }
      return folders;
    });
    assert.equal(directFolderSave.length, 1, "selected results create one unique output folder");
    assert.match(directFolderSave[0].name, /^tiny-image-star-\d{8}-\d{6}-website-banner$/, "selected results use a timestamped destination folder");
    assert.equal(directFolderSave[0].files.length, 2, "direct folder save contains exactly the selected results");
    for (const file of directFolderSave[0].files) assertPngBytes(Buffer.from(file.bytes), `direct folder result ${file.name}`);
    assert.equal(directFolderSave[0].files.some((file) => file.name.endsWith(".zip")), false, "multi-image save does not create an archive");
    const keyboardShortcut = process.platform === "darwin" ? "Meta+S" : "Control+S";
    const editorStatusBeforeBatchSave = await page.locator("#processing-status").textContent();
    const pickerCallsBeforeShortcut = await page.evaluate(() => window.__tinystarPickerCalls);
    await page.keyboard.press(keyboardShortcut);
    await page.waitForFunction((before) => window.__tinystarPickerCalls === before + 1 && document.querySelector("#batch-status")?.textContent?.includes("Saved 2 images directly into"), pickerCallsBeforeShortcut);
    assert.equal(await page.evaluate(() => window.__tinystarPickerCalls), pickerCallsBeforeShortcut + 1, "Results keyboard save opens exactly one destination picker");
    assert.equal(await page.locator("#processing-status").textContent(), editorStatusBeforeBatchSave, "Results keyboard save does not trigger the hidden editor download path");
    assert.match(await page.locator("#batch-status").textContent(), /Saved 2 images directly into/);

    // Browsers without writable-folder access must never launch a burst of
    // downloads from one gesture. Each fallback download gets its own click.
    await page.evaluate(() => {
      window.__tinystarDisableDirectorySave = true;
      window.__tinystarDownloadClicks = 0;
      if (!window.__tinystarOriginalAnchorClick) {
        window.__tinystarOriginalAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function countedDownloadClick() {
          if (this.download) window.__tinystarDownloadClicks += 1;
          return window.__tinystarOriginalAnchorClick.call(this);
        };
      }
    });
    await page.getByRole("button", { name: "Save 2 images", exact: true }).click();
    const individualSaveDialog = page.locator("#individual-save-dialog");
    await individualSaveDialog.waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => window.__tinystarDownloadClicks), 0, "opening the fallback does not launch blocked automatic downloads");
    assert.match(await individualSaveDialog.textContent(), /cannot create an output folder/i, "fallback explains the browser limitation truthfully");
    assert.equal(await page.locator("#individual-save-progress").textContent(), "0 of 2 downloads started", "fallback starts at zero downloads");
    assert.equal(await individualSaveDialog.locator("img").count(), 0, "selected-save fallback does not duplicate image previews");
    const fallbackDownloads = [];
    for (let index = 0; index < 2; index += 1) {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: `Save next image (${index + 1} of 2)`, exact: true }).click();
      const download = await downloadPromise;
      const bytes = await readFile(await download.path());
      assertPngBytes(bytes, `explicit fallback download ${index + 1}`);
      assert.match(download.suggestedFilename(), new RegExp(`^00${index + 1}-.+-\\d{8}-\\d{6}-website-banner\\.png$`), "fallback filename preserves order, source, timestamp, and destination");
      fallbackDownloads.push(download.suggestedFilename());
    }
    assert.equal(new Set(fallbackDownloads).size, 2, "fallback downloads have unique names");
    assert.equal(await page.evaluate(() => window.__tinystarDownloadClicks), 2, "each explicit fallback click starts exactly one download");
    assert.equal(await page.locator("#individual-save-progress").textContent(), "2 of 2 downloads started", "fallback reports all downloads started");
    assert.match(await page.locator("#individual-save-status").textContent(), /All 2 downloads started/, "fallback reports completion without claiming disk writes");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.evaluate(() => {
      window.__tinystarDisableDirectorySave = false;
    });

    // Recipe scope is explicit and shared by the Images view and the editor
    // tray. A scoped destination is stored separately from manual edits.
    await leaveReviewAndEnsureEditor(page);
    await page.waitForFunction(() => !document.querySelector("#image-tray")?.hidden);
    assert.equal(await page.locator("#tray-scope-select").isVisible(), true, "editor tray exposes recipe scope for a multi-image set");
    assert.deepEqual(await page.locator("#tray-scope-select option").allTextContents(), ["All images", "Selected images", "This image"], "recipe scope choices are plain language");
    await page.locator("#tray-scope-select").selectOption("selected");
    await selectRecipeRevision(page, "#tray-preset-picker", "profile-photo");
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 3 previews"));
    assert.match(await page.locator(".batch-card").nth(0).textContent(), /512 × 512/, "tray recipe applies to selected first image");
    assert.match(await page.locator(".batch-card").nth(1).textContent(), /512 × 512/, "tray recipe applies to selected second image");
    assert.match(await page.locator(".batch-card").nth(0).textContent(), /Different destination/, "scoped destination is visible on the result card");
    assert.match(await page.locator(".batch-card").nth(2).textContent(), /1600 × 600/, "unselected image keeps its previous destination");
    await page.locator("#batch-button").click();
    const scopedDestinationCard = page.locator(".batch-card").first();
    await scopedDestinationCard.locator(".batch-card-more summary").click();
    assert.equal(await scopedDestinationCard.getByRole("button", { name: "Use shared destination", exact: true }).count(), 1, "scoped destination has an explicit reset action");
    await scopedDestinationCard.getByRole("button", { name: "Use shared destination", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".batch-card")?.textContent?.includes("1600 × 600"));
    await page.locator("#batch-scope-select").selectOption("all");
    await page.locator("#batch-view").getByRole("button", { name: "Website Banner", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 3 previews"));

    await page.locator(".batch-card").first().locator(".batch-card-more summary").click();
    await page.getByRole("button", { name: "Edit on canvas", exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector("#file-name")?.textContent === "one.png");
    await page.getByRole("button", { name: "Rotate right", exact: true }).click();
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.body.textContent.includes("Edited for this image"));
    await page.locator("#batch-view").getByRole("button", { name: "Website Banner", exact: true }).click();
    await page.waitForFunction(() => {
      const text = document.querySelector("#batch-status")?.textContent ?? "";
      return text.includes("Ready") || text.includes("could not be updated") || text.includes("could not be updated.");
    });
    assert.match(await page.locator("#batch-status").textContent(), /Ready — 3 previews\. 2 selected to download\./);
    assert.match(await page.locator(".batch-card").first().textContent(), /1600 × 600/, "shared destination still applies after a per-image edit");
    assert.match(await page.locator(".batch-card").first().textContent(), /Edited for this image/, "per-image edit survives shared batch reprocessing");
    const overriddenPreviewBytes = Buffer.from(await page.locator(".batch-card").first().locator(".batch-pane-after img").evaluate(async (image) => {
      const response = await fetch(image.src);
      return Array.from(new Uint8Array(await response.arrayBuffer()));
    }));
    assertPngBytes(overriddenPreviewBytes, "per-image override preview");
    await page.locator(".batch-card").first().locator(".batch-card-more summary").click();
    const overriddenIndividualDownloadPromise = page.waitForEvent("download", { timeout: 3000 }).catch(() => null);
    await page.locator(".batch-card").first().getByRole("button", { name: "Download PNG", exact: true }).click();
    const overriddenIndividualDownload = await overriddenIndividualDownloadPromise;
    if (overriddenIndividualDownload) {
      const overriddenIndividualBytes = await readFile(await overriddenIndividualDownload.path());
      assert.deepEqual(overriddenIndividualBytes, overriddenPreviewBytes, "individual export uses the overridden output bytes");
    }
    assert.match(await page.locator("#batch-status").textContent(), /Download started for the selected PNG image\./, "individual override export reports success");
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry("selected-output", { recursive: true }).catch(() => {});
      window.__tinystarSelectedOutputHandle = await root.getDirectoryHandle("selected-output", { create: true });
    });
    await page.getByRole("button", { name: "Save 2 images", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Saved 2 images directly into"));
    const overriddenFolderEntry = await page.evaluate(async () => {
      for await (const [, folderHandle] of window.__tinystarSelectedOutputHandle.entries()) {
        if (folderHandle.kind !== "directory") continue;
        for await (const [name, fileHandle] of folderHandle.entries()) {
          if (!/(?:^|-)one-/.test(name)) continue;
          const file = await fileHandle.getFile();
          return { name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) };
        }
      }
      return null;
    });
    assert.ok(overriddenFolderEntry, "direct folder save includes the edited first output");
    assert.deepEqual(Buffer.from(overriddenFolderEntry.bytes), overriddenPreviewBytes, "direct folder save uses the overridden output bytes");
    assert.match(await page.locator("#batch-status").textContent(), /Saved 2 images directly into/, "direct override save reports success");
    await page.locator(".batch-card").first().locator(".batch-card-more summary").click();
    await page.getByRole("button", { name: "Save adjustment as recipe", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "Save override as preset", exact: true }).count(), 1, "save override dialog");
    await page.locator("#preset-name-input").fill("Saved image correction");
    await page.locator("#preset-destination-input").selectOption("custom");
    await page.getByRole("button", { name: "Save preset", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#preset-dialog").open);
    const savedOverride = await page.evaluate(async () => {
      const entries = (await (await import("./src/styles/catalog.js")).readRecipeCatalog()).recipes;
      return entries.find((entry) => entry.name === "Saved image correction");
    });
    assert.equal(savedOverride?.operations?.rotation, 90, "saved override keeps the manual rotation");
    assert.equal(savedOverride?.destination, "Saved image correction", "saved override has a clear local name");
    await page.getByRole("button", { name: "Reset to preset", exact: true }).click();
    await page.waitForFunction(() => !document.body.textContent.includes("Edited for this image"));
    await page.waitForFunction(() => !document.querySelector("#batch-clear-completed-button")?.disabled && document.querySelector("#batch-status")?.textContent?.includes("Ready — 3 previews"));

    await page.getByRole("button", { name: "Clear completed", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".batch-card").length === 0 && document.querySelector("#batch-status")?.textContent?.includes("Cleared 3 completed previews"));
    assert.equal(await page.locator("#batch-save-button").isDisabled(), true, "clearing completed previews clears save selection");
    assert.equal(await page.locator("#batch-view").isVisible(), false, "clearing the last reviewed result returns to the canvas");
    await page.locator("#batch-file-input").setInputFiles([tiffFixture]);
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 1 preview"));
    assert.match(await page.locator(".batch-card").first().textContent(), /1600 × 600/, "batch preview proxy accepts TIFF input");
    await page.locator("#batch-button").click();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "New set", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".batch-card").length === 0 && document.querySelector("#batch-status")?.textContent?.includes("New image set ready"));
    assert.equal(await page.locator("#batch-save-button").isDisabled(), true, "new set clears export selection");
    assert.equal(await page.locator("#file-name").textContent(), "Open an image to begin", "new set clears the previous canvas and stale output state");

    await leaveReviewAndEnsureEditor(page);
    await page.locator("#file-input").setInputFiles(firstFixture);
    await page.waitForFunction(() => document.querySelector("#file-name")?.textContent === "one.png" && document.querySelector("#output-summary")?.textContent?.includes("1600 × 600"));
    assert.match(await page.locator("#output-summary").textContent(), /1600 × 600/, "a new set keeps the chosen reusable destination");
    await page.getByRole("button", { name: "Save recipe", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Local data recipe");
    await page.getByRole("button", { name: "Save preset", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#preset-dialog").open);
    await page.waitForTimeout(500);
    // Seed only the storage record so the cleanup contract has a non-zero
    // custom-font case without pretending that a bundled third-party font is
    // a portable decode fixture.
    await seedStoredFontRecord(page);
    await page.getByRole("button", { name: "Local data", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#local-data-dialog")?.open);
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoLayoutCollisions(page, "local data dialog mobile", ["#local-data-dialog .local-data-summary", "#local-data-dialog .dialog-actions .button"]);
    await page.setViewportSize({ width: 1280, height: 720 });
    assert.equal(await page.locator("#local-data-preset-count").textContent(), "2 saved styles and recipes", "local data reports both saved recipes");
    assert.equal(await page.locator("#local-data-font-count").textContent(), "1 saved font", "local data reports saved custom fonts");
    assert.equal(await page.locator("#local-data-recovery-count").textContent(), "1 recovery copy", "local data reports one recovery copy");
    assert.match(await page.locator("#local-data-recovery-size").textContent(), /B|KB|MB/, "local data reports recovery storage");
    const [projectBackup] = await Promise.all([
      page.waitForEvent("download"), page.getByRole("button", { name: "Back up saved work", exact: true }).click(),
    ]);
    assert.match(projectBackup.suggestedFilename(), /^tiny-image-star-backup-.*\.tstar$/);
    const backupFile = join(fixtureDirectory, "recovery-backup.tstar");
    await projectBackup.saveAs(backupFile);
    const backupBytes = await readFile(backupFile);
    assert.equal(backupBytes.subarray(0, 7).toString(), "TSTAR1\n");
    const backupHeader = JSON.parse(backupBytes.subarray(11, 11 + backupBytes.readUInt32BE(7)).toString());
    assert.equal(backupHeader.records.length, 1, "backup contains the saved project");
    assert.equal(backupHeader.extras.fonts.length, 1, "backup includes custom font data");
    assert.equal(backupHeader.extras.recipeCatalog[0].entries.length, 2, "backup includes the active recipe catalog");
    assert.equal(backupHeader.extras.styleLibrary.filter((entry) => entry.style?.kind === "tiny-image-star/legacy-style").length, 2, "backup includes saved recipe definitions");
    assert.ok(backupHeader.assets.length >= 2, "backup contains original image and font binaries");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Clear saved data", exact: true }).click();
    assert.equal(await page.locator("#local-data-preset-count").textContent(), "2 saved styles and recipes", "cancelled local-data clear keeps both recipes");
    assert.equal(await page.locator("#local-data-font-count").textContent(), "1 saved font", "cancelled local-data clear keeps saved font count");
    assert.equal(await page.locator("#local-data-recovery-count").textContent(), "1 recovery copy", "cancelled local-data clear keeps recovery");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Clear saved data", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#local-data-status")?.textContent?.includes("Cleared saved data"));
    assert.equal(await page.locator("#local-data-preset-count").textContent(), "0 saved styles and recipes", "clearing local data removes recipes");
    assert.equal(await page.locator("#local-data-font-count").textContent(), "0 saved fonts", "clearing local data removes saved fonts");
    assert.equal(await page.locator("#local-data-recovery-count").textContent(), "0 recovery copies", "clearing local data removes recovery copies");
    assert.equal(await page.locator("#local-data-recovery-size").textContent(), "0 B", "clearing local data removes stored bytes");
    assert.equal(await page.locator("#file-name").textContent(), "one.png", "clearing local data keeps the open image available");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
    assert.equal(await page.locator("#session-recovery").isVisible(), false, "cleared local data does not offer stale recovery");
    assert.equal(await page.evaluate(() => localStorage.getItem("tiny-image-star.presets.v1")), null, "cleared local data removes the recipe store");

    const textPastePrevented = await page.evaluate((source) => {
      const input = document.createElement("input");
      input.type = "text";
      document.body.append(input);
      const bytes = Uint8Array.from(atob(source.trim()), (character) => character.charCodeAt(0));
      const file = new File([bytes], "typed-paste.png", { type: "image/png" });
      const data = new DataTransfer();
      data.items.add(file);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: data });
      input.dispatchEvent(event);
      input.remove();
      return event.defaultPrevented;
    }, fixtureSource);
    assert.equal(textPastePrevented, false, "image paste does not hijack text entry");
    await page.evaluate(({ png, tiff }) => {
      const fileFromBase64 = (source, name, type) => {
        const bytes = Uint8Array.from(atob(source.trim()), (character) => character.charCodeAt(0));
        return new File([bytes], name, { type });
      };
      const data = new DataTransfer();
      data.items.add(fileFromBase64(png, "pasted.png", "image/png"));
      data.items.add(fileFromBase64(tiff, "pasted.tiff", "image/tiff"));
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: data });
      document.body.dispatchEvent(event);
    }, { png: fixtureSource, tiff: tiffFixtureSource });
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "2 images");
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 2 previews"));
    assert.equal(await page.locator("#file-name").textContent(), "pasted.png", "pasted image opens in the shared canvas");
    assert.equal(await page.locator("#batch-view").isVisible(), false, "multi-image paste stays in the shared canvas workspace");
    assert.equal(await page.locator("#image-tray").isVisible(), true, "multi-image paste creates the image tray");
    await page.locator("#batch-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-view")?.getAttribute("data-review") === "true");
    const keyboardImportChooser = page.waitForEvent("filechooser");
    await page.locator("#batch-drop-zone").press("Enter");
    await (await keyboardImportChooser).setFiles(jpegFixture);
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "3 images");
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 3 previews"));
    await page.evaluate((source) => {
      const bytes = Uint8Array.from(atob(source.trim()), (character) => character.charCodeAt(0));
      const file = new File([bytes], "dropped.jpg", { type: "image/jpeg" });
      const data = new DataTransfer();
      data.items.add(file);
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: data });
      document.querySelector("#batch-drop-zone")?.dispatchEvent(event);
    }, exifFixtureSource);
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "4 images");
    await page.waitForFunction(() => document.querySelector("#batch-status")?.textContent?.includes("Ready — 4 previews"));
    assert.match(await page.locator("#batch-grid").textContent(), /dropped\.jpg/, "drop import appends to the shared image set");

    await page.evaluate(async (source) => {
      const bytes = Uint8Array.from(atob(source.trim()), (character) => character.charCodeAt(0));
      const root = await navigator.storage.getDirectory();
      await root.removeEntry("large-source", { recursive: true }).catch(() => {});
      await root.removeEntry("large-output", { recursive: true }).catch(() => {});
      const sourceRoot = await root.getDirectoryHandle("large-source", { create: true });
      const nested = await sourceRoot.getDirectoryHandle("nested", { create: true });
      const write = async (directory, name, payload) => {
        const handle = await directory.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(payload);
        await writable.close();
      };
      await write(sourceRoot, "one.png", bytes);
      await write(nested, "two.png", bytes);
      await write(sourceRoot, "animated.gif", Uint8Array.from([
        ...new TextEncoder().encode("GIF89a"), 1, 0, 1, 0, 0, 0, 0,
        0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0, 0, 0,
        0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0,
      ]));
      await write(sourceRoot, "ignore.txt", "not an image");
      window.__tinystarLargeSourceHandle = sourceRoot;
      window.__tinystarLargeOutputHandle = await root.getDirectoryHandle("large-output", { create: true });
      window.__tinystarDisableLargeFolderJobs = false;
      window.__tinystarDirectoryPicker = async ({ id } = {}) => id === "tiny-image-star-source"
        ? window.__tinystarLargeSourceHandle
        : window.__tinystarLargeOutputHandle;
    }, fixtureSource);
    await page.locator("#batch-folder-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-view")?.dataset.largeJob === "true" && !document.querySelector("#folder-job-panel")?.hidden);
    await page.waitForFunction(() => document.querySelector("#folder-job-discovered")?.textContent === "3");
    assert.equal(await page.locator("#folder-job-source-name").textContent(), "large-source", "large-folder source is visible");
    await page.evaluate(async () => {
      const { openLargeJobDatabase } = await import("./src/jobs/store.js"), database = await openLargeJobDatabase();
      const transaction = database.transaction(["jobs", "entries"], "readwrite");
      window.__tinystarHoldRecipeCommit = true;
      const keepOpen = () => {
        const request = transaction.objectStore("jobs").get("recipe-commit-probe");
        request.onsuccess = () => { if (window.__tinystarHoldRecipeCommit) keepOpen(); };
      };
      keepOpen();
    });
    try {
      await selectRecipeRevision(page, "#folder-job-recipe", "instagram-square");
      assert.equal(await page.locator("#folder-job-output-button").isDisabled(), true, "save-folder selection waits for the recipe commit");
      assert.equal(await page.locator("#folder-job-recipe").isDisabled(), true, "overlapping recipe changes are disabled during the commit");
      assert.equal(await page.locator("#folder-job-status").textContent(), "Saving your recipe choice…");
    } finally { await page.evaluate(() => { window.__tinystarHoldRecipeCommit = false; }); }
    await page.waitForFunction(() => !document.querySelector("#folder-job-recipe").disabled && document.querySelector("#folder-job-recipe-summary").textContent.includes("Fill frame · 1080 × 1080 · PNG"));
    assert.equal(await page.evaluate(async () => (await (await import("./src/jobs/store.js")).listLargeJobs())[0].recipe.id), "instagram-square", "folder summary describes the durable recipe selection");
    assert.match(await page.locator("#folder-job-recipe-summary").textContent(), /Fill frame · 1080 × 1080 · PNG/, "large folder uses the same human-readable recipes");
    await page.locator("#folder-job-output-button").click();
    await page.waitForFunction(() => !document.querySelector("#folder-job-start-button")?.disabled);
    assert.match(await page.locator("#folder-job-output-name").textContent(), /^tiny-image-star-\d{8}-\d{6}-instagram-post-square-[a-f0-9]{8}$/, "large output folder has a job-specific suffix and recipe name");
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = true; });
    await page.locator("#folder-job-start-button").click();
    await page.waitForFunction(() => !document.querySelector("#folder-job-pause-button")?.hidden);
    await page.getByRole("button", { name: "Pause after active images", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#folder-job-status")?.textContent?.startsWith("Paused."));
    assert.equal(await page.getByRole("button", { name: "Resume remaining", exact: true }).isVisible(), true, "paused jobs expose a working continuation action");
    assert.equal(await page.getByRole("button", { name: /Retry .* failed/ }).isHidden(), true, "paused jobs do not compete with Retry failed");
    const secondTab = await page.context().newPage();
    await secondTab.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await secondTab.waitForFunction(() => document.querySelector("#folder-job-status")?.textContent?.includes("open in another tab"));
    for (const selector of ["#folder-job-start-button", "#folder-job-forget-button", "#folder-job-source-button"]) {
      assert.equal(await secondTab.locator(selector).isDisabled(), true, "another tab cannot mutate the owned job");
    }
    assert.match(await page.locator("#folder-job-status").textContent(), /^Paused\./, "opening a second tab leaves the owner's state intact");
    await secondTab.close();
    await page.evaluate(() => {
      window.__tinystarTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (mode === "readwrite") throw new DOMException("Test storage quota exhausted", "QuotaExceededError");
        return window.__tinystarTransaction.call(this, stores, mode, ...rest);
      };
    });
    await page.getByRole("button", { name: "Resume remaining", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#folder-job-status")?.textContent?.includes("out of space"));
    assert.equal(await page.getByRole("button", { name: "Resume", exact: true }).isEnabled(), true, "a storage failure still leaves a usable recovery action");
    await page.evaluate(() => { IDBDatabase.prototype.transaction = window.__tinystarTransaction; });
    await page.evaluate(() => { window.__tinystarTestDelayWorkers = false; });
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    try {
      await page.waitForFunction(() => /^(Complete\.|.*need attention)/.test(document.querySelector("#folder-job-status")?.textContent ?? ""), null, { timeout: 20000 });
    } catch (error) {
      const snapshot = await page.evaluate(() => ({
        status: document.querySelector("#folder-job-status")?.textContent,
        progress: document.querySelector("#folder-job-progress-text")?.textContent,
        discovered: document.querySelector("#folder-job-discovered")?.textContent,
        completed: document.querySelector("#folder-job-completed")?.textContent,
        failed: document.querySelector("#folder-job-failed")?.textContent,
        rows: [...document.querySelectorAll(".folder-result-row")].map((row) => row.textContent),
      }));
      throw new Error(`Large folder did not reach a terminal state: ${JSON.stringify(snapshot)}`, { cause: error });
    }
    assert.match(await page.locator("#folder-job-status").textContent(), /need attention/, "large folder reports a real failed image");
    assert.equal(await page.locator("#folder-job-completed").textContent(), "2", "large folder saves every supported source");
    assert.equal(await page.locator("#folder-job-failed").textContent(), "1", "large folder counts failed outputs");
    assert.equal(await page.getByRole("button", { name: "Resume", exact: true }).isHidden(), true, "failed terminal work does not expose a no-op Resume action");
    assert.equal(await page.getByRole("button", { name: "Retry 1 failed", exact: true }).isVisible(), true, "failed terminal work exposes one clear retry action");
    await page.evaluate(async (source) => {
      const bytes = Uint8Array.from(atob(source.trim()), (character) => character.charCodeAt(0));
      const handle = await window.__tinystarLargeSourceHandle.getFileHandle("animated.gif");
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
    }, fixtureSource);
    await page.getByRole("button", { name: "Retry 1 failed", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#folder-job-status")?.textContent?.startsWith("Complete."));
    assert.equal(await page.locator("#folder-job-completed").textContent(), "3", "retry completes the repaired failed image");
    assert.equal(await page.locator("#folder-job-failed").textContent(), "0", "retry clears the failed count only after resetting the entry");
    const largeFolderOutputs = await page.evaluate(async () => {
      const outputs = [];
      const visit = async (directory, prefix = "") => {
        for await (const [name, handle] of directory.entries()) {
          const path = prefix ? `${prefix}/${name}` : name;
          if (handle.kind === "directory") await visit(handle, path);
          else {
            const file = await handle.getFile();
            const bitmap = await createImageBitmap(file);
            outputs.push({ path, bytes: Array.from(new Uint8Array(await file.arrayBuffer())), width: bitmap.width, height: bitmap.height });
            bitmap.close();
          }
        }
      };
      await visit(window.__tinystarLargeOutputHandle);
      return outputs;
    });
    assert.equal(largeFolderOutputs.length, 3, "large folder writes every repaired output file directly");
    for (const output of largeFolderOutputs) {
      assertPngBytes(Buffer.from(output.bytes), `large folder output ${output.path}`);
      assert.equal(output.width, 1080, `large folder output ${output.path} width`);
      assert.equal(output.height, 1080, `large folder output ${output.path} height`);
      assert.equal(output.path.endsWith(".zip"), false, "large folder never writes an archive");
    }
    assert.ok(await page.locator(".folder-result-row").count() <= 24, "large result DOM stays bounded to a virtual window");
    await page.setViewportSize({ width: 390, height: 844 });
    const largeMobileGeometry = await page.evaluate(() => ({
      bodyOverflow: document.body.scrollWidth > innerWidth + 1,
      panelRight: document.querySelector("#folder-job-panel")?.getBoundingClientRect().right,
      buttons: [...document.querySelectorAll("#folder-job-panel button:not([hidden])")].map((button) => button.getBoundingClientRect().height),
    }));
    assert.equal(largeMobileGeometry.bodyOverflow, false, "large folder UI has no mobile horizontal overflow");
    assert.ok(largeMobileGeometry.panelRight <= 391, "large folder panel remains inside the mobile viewport");
    assert.ok(largeMobileGeometry.buttons.every((height) => height >= 43), "large folder mobile actions keep touch-sized targets");
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.evaluate(() => window.__tinystarLargeSourceHandle.removeEntry("animated.gif"));

    // Simulate a tab closing during discovery. Restore clears the incomplete
    // metadata pages, walks the durable source handle again, and never stores
    // source or output image bytes in the manifest.
    await page.locator("#folder-job-source-button").click();
    await page.waitForFunction(() => document.querySelector("#folder-job-discovered")?.textContent === "2" && document.querySelector("#folder-job-status")?.textContent?.includes("Choose a save folder"));
    await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("tiny-image-star.large-jobs");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction("jobs", "readwrite");
      const store = transaction.objectStore("jobs");
      const jobs = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const current = jobs.sort((left, right) => right.updatedAt - left.updatedAt)[0];
      store.put({ ...current, status: "scanning", scanComplete: false, discovered: 2, updatedAt: Date.now() });
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
    await clearSessionOfferIfPresent(page);
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      window.__tinystarLargeSourceHandle = await root.getDirectoryHandle("large-source");
      window.__tinystarLargeOutputHandle = await root.getDirectoryHandle("large-output");
      window.__tinystarDisableLargeFolderJobs = false;
      window.__tinystarDirectoryPicker = async ({ id } = {}) => id === "tiny-image-star-source"
        ? window.__tinystarLargeSourceHandle
        : window.__tinystarLargeOutputHandle;
    });
    await page.waitForFunction(() => !document.querySelector("#folder-job-button")?.hidden);
    await page.locator("#folder-job-button").click();
    await page.waitForFunction(() => document.querySelector("#batch-view")?.dataset.largeJob === "true");
    await page.waitForFunction(() => document.querySelector("#folder-job-discovered")?.textContent === "2" && document.querySelector("#folder-job-status")?.textContent?.includes("Choose a save folder"));
    assert.equal(await page.locator("#folder-job-discovered").textContent(), "2", "interrupted discovery rebuilds the durable manifest after reload");
    assert.match(await page.locator("#folder-job-status").textContent(), /Choose a save folder/, "restored discovery returns to a ready metadata-only job");
    const largeManifestShape = await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("tiny-image-star.large-jobs");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction("entries", "readonly");
      const entries = await new Promise((resolve, reject) => {
        const request = transaction.objectStore("entries").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return entries.map((entry) => ({ hasBytes: "bytes" in entry, hasOutput: "output" in entry }));
    });
    assert.ok(largeManifestShape.every((entry) => !entry.hasBytes && !entry.hasOutput), "large manifest stores metadata only after recovery");

    await assertBulkRecipeContext(browser, address);
    const localOrigin = `http://127.0.0.1:${address.port}/`;
    const uploadRequests = networkRequests.filter((request) => request.hasBody || ["POST", "PUT", "PATCH"].includes(request.method));
    assert.deepEqual(uploadRequests, [], "image bytes are never sent in a request body");
    assert.deepEqual(networkRequests.filter((request) => !request.url.startsWith(localOrigin) && !request.url.startsWith("blob:")), [], "the app makes no external network requests");
    assert.equal(consoleErrors.length, 0, `browser console errors: ${consoleErrors.join(" | ")}`);
    console.log("verify:browser PASS");
    console.log("  editor/batch/folder workflows, six-tool phone layout and native sheets, theme/200% text checks, imports, real PNG/JPEG output, presets/overrides, edits/history, cancellation/retry, folder pause/resume, repaired-source retry, recovery, and local-data controls");
    console.log("  no image uploads, external network requests, or browser console errors");
    console.log(`  individual download event: ${individualDownload ? "observed" : "not observed (browser sandbox boundary)"}`);
    return 0;
  } catch (error) {
    console.error("verify:browser FAIL");
    console.error("browser state", await page.evaluate(() => ({
      batch: document.querySelector("#batch-status")?.textContent,
      processing: document.querySelector("#processing-status")?.textContent,
      recovery: document.querySelector("#session-recovery-message")?.textContent,
      recoveryErrors: window.__tinystarRecoveryErrors,
    })).catch(() => null), consoleErrors);
    console.error(error);
    return 1;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
}

process.exitCode = await main();
