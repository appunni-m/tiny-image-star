import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { waitForAsync } from "./helpers/wait-for-async.mjs";

export async function assertDepthTitles(browser, origin) {
  const font = await readFile(new URL("./fixtures/fonts/NotoSans.ttf", import.meta.url));
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(30_000); page.on("pageerror", (error) => errors.push(error.message));
  const ready = () => page.waitForFunction(() => !document.querySelector("#story-export").disabled && document.querySelector("#story-preview").complete);
  const saved = () => page.waitForFunction(() => document.querySelector("#story-status").textContent === "Saved on this device");
  const reviewed = () => page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled);
  const digest = () => page.evaluate(async () => (await import("./src/project/storage.js")).hashAsset(await (await fetch(document.querySelector("#story-preview").src)).arrayBuffer()));
  const document = () => page.evaluate(async () => { const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(); return (await store.readStoryProject(entry.key)).project; });
  const apply = async () => { await reviewed(); await page.locator("#story-sheet-apply").click(); await ready(); await saved(); };
  try {
    await page.goto(origin); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
    const evidence = await page.evaluate(async (fontBase64) => {
      const { createPillowEngine } = await import("./src/engine/pillow.js"), api = await import("./wasm/pillow_rs_js.js"), engine = await createPillowEngine();
      const { createSceneProject, resolveSlide } = await import("./src/project/model.js"), { planScene } = await import("./src/compositor/scene-spec.js");
      const { fontDigest: hash } = await import("./src/compositor/fonts.js"), { enqueueScene } = await import("./src/processing/scene-client.js"), { getProcessingScheduler } = await import("./src/processing/client.js");
      const width = 192, height = 240, rgba = new Uint8Array(width * height * 4), coverage = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        rgba.set(x < width / 2 ? [180, 60, 100, y < height / 2 ? 128 : 255] : [40, 130, 180, y < height / 2 ? 64 : 200], (y * width + x) * 4);
        coverage[y * width + x] = x < 70 ? 255 : x > 100 ? 0 : Math.round((100 - x) / 30 * 255);
      }
      const source = api.fromBytesFn("RGBA", width, height, rgba, "raw"), matte = api.fromBytesFn("L", width, height, coverage, "raw");
      const photo = source.saveWithInput("PNG", null), mask = matte.saveWithInput("PNG", null); source.free(); matte.free();
      const bank = new Map([["photo", photo], ["mask", mask], ["font", Uint8Array.from(atob(fontBase64), (v) => v.charCodeAt(0))]]), assets = {};
      for (const [id, bytes] of bank) assets[id] = { id, kind: id === "photo" ? "image" : id, name: id, type: id === "font" ? "font/ttf" : "image/png",
        byteLength: bytes.length, sha256: await hash(bytes), ...(id === "font" ? {} : { width, height }), orientation: "upright" };
      const full = { x: 0, y: 0, width: 1, height: 1 };
      const project = createSceneProject({ assets, nodes: {
        photo: { id: "photo", kind: "image", space: "slide", frame: full, assetId: "photo", maskId: "mask", depthTextId: "words", depthBackground: "photo" },
        words: { id: "words", kind: "text", space: "slide", frame: { x: .02, y: .1, width: .96, height: .8 }, text: "BEHIND\nYOU", fontId: "font", color: "#fff0d0",
          style: { fontBasis: "width", fontSize: .25, minFontSize: .03, fit: "shrink" } },
      }, slides: [{ id: "one", nodeIds: ["photo", "words"], overrides: {} }], variants: [{ id: "portrait", width, height }] });
      const render = (project, preview = false, slideId = "one") => { const plan = planScene(project, slideId, "portrait", { preview, previewEdge: 120 });
        return engine[preview ? "renderPreview" : "renderSlide"]({ project, slideId, variantId: "portrait", previewEdge: 120, assets: plan.assets.map((asset) => ({ id: asset.id, bytes: bank.get(asset.id) })) }); };
      const pixels = (result) => { const image = api.Image.open(result.bytes); try { return image.toBytes(); } finally { image.free(); } };
      const independent = async (result) => { const bitmap = await createImageBitmap(new Blob([result.bytes], { type: "image/png" })), canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0); bitmap.close(); return ctx.getImageData(0, 0, canvas.width, canvas.height).data; };
      const reports = [];
      for (const transform of [{}, { frame: { x: .13, y: .11, width: .74, height: .8 }, rotation: -17, opacity: .63, crop: { x: .1, y: .12, width: .8, height: .7 }, appearance: { contrast: .92, brightness: 1.04 } }]) {
        const current = structuredClone(project); Object.assign(current.nodes.photo, transform);
        const resolved = resolveSlide(current, "one").nodes.find((node) => node.id === "words");
        const reference = (kind) => {
          const value = structuredClone(current); delete value.nodes.photo.depthTextId; delete value.nodes.photo.depthBackground;
          if (kind === "photo") delete value.nodes.photo.maskId;
          value.nodes.words = { ...value.nodes.words, frame: resolved.frame, rotation: resolved.rotation, style: resolved.style };
          value.slides[0].nodeIds = [kind === "words" ? "words" : "photo"]; return value;
        };
        const background = await render(reference("photo")), foreground = await render(reference("subject")), words = await render(reference("words"));
        const p = pixels(background), f = pixels(foreground), t = pixels(words);
        const empty = structuredClone(current); empty.nodes.words.text = "";
        const unchanged = await render(empty);
        let sourceOpens = 0, maskOpens = 0; const open = api.Image.open;
        api.Image.open = function (bytes) { if (bytes.length === photo.length) sourceOpens++; if (bytes.length === mask.length) maskOpens++; return open.call(this, bytes); };
        let output; try { output = await render(current); } finally { api.Image.open = open; }
        const actual = await independent(output); let alphaError = 0, colorError = 0, changed = 0;
        for (let i = 0; i < p.length; i += 4) {
          const T = t[i + 3] / 255, A = p[i + 3] / 255, F = f[i + 3] / 255, outA = A + T * (1 - A);
          alphaError = Math.max(alphaError, Math.abs(actual[i + 3] - Math.round(outA * 255)));
          for (let c = 0; c < 3; c++) {
            const expected = p[i + c] * A * (1 - T) + T * (f[i + c] * F + t[i + c] * (1 - F));
            colorError = Math.max(colorError, Math.abs(actual[i + c] * actual[i + 3] / 255 - expected));
          }
          if (t[i + 3]) changed++;
        }
        const page = structuredClone(current); page.nodes.photo.depthBackground = "page";
        const stack = reference("subject"); stack.slides[0].nodeIds = ["words", "photo"];
        const onPage = pixels(await render(page)), stackPixels = pixels(await render(stack)); let pageDifference = 0;
        for (let i = 0; i < onPage.length; i++) pageDifference = Math.max(pageDifference, Math.abs(onPage[i] - stackPixels[i]));
        const pending = structuredClone(current); delete pending.nodes.photo.maskId; pending.nodes.photo.depthBackground = "page";
        const normal = reference("photo"); normal.slides[0].nodeIds = ["photo", "words"];
        const fallback = await render(pending), fallbackPixels = pixels(fallback), normalPixels = pixels(await render(normal)); let fallbackDifference = 0;
        for (let i = 0; i < fallbackPixels.length; i++) fallbackDifference = Math.max(fallbackDifference, Math.abs(fallbackPixels[i] - normalPixels[i]));
        const small = await render(current, true), opened = api.Image.open(output.bytes), downsample = opened.resize(96, 120, "LANCZOS");
        const expectedSmall = downsample.saveWithInput("PNG", null); downsample.free(); opened.free();
        reports.push({ sourceOpens, maskOpens, alphaError, colorError, changed, pageDifference, fallbackDifference, fallbackWarning: fallback.warnings.some((warning) => warning.code === "DEPTH_SUBJECT_NEEDED"),
          unchanged: await hash(unchanged.bytes) === await hash(background.bytes), preview: await hash(small.bytes) === await hash(expectedSmall) });
      }
      const corrupt = structuredClone(project); corrupt.assets.mask.sha256 = "0".repeat(64); let corruptMask;
      try { await render(corrupt); corruptMask = "accepted"; } catch (error) { corruptMask = error.message; }
      const connected = structuredClone(project);
      for (const node of Object.values(connected.nodes)) { node.space = "story"; node.anchorSlideId = "one"; }
      connected.nodes.photo.frame = { x: .6, y: .05, width: .8, height: .9 }; connected.nodes.photo.rotation = -8;
      connected.slides.push({ id: "two", nodeIds: ["photo", "words"], overrides: {} });
      const wide = structuredClone(connected); wide.slides.pop(); wide.variants[0].width *= 2; wide.nodes.photo.frame.x /= 2; wide.nodes.photo.frame.width /= 2;
      const parts = [pixels(await render(connected)), pixels(await render(connected, false, "two"))], all = pixels(await render(wide)); let seamDifference = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width * 2; x++) for (let c = 0; c < 4; c++) seamDifference = Math.max(seamDifference,
        Math.abs(parts[x < width ? 0 : 1][(y * width + x % width) * 4 + c] - all[(y * width * 2 + x) * 4 + c]));
      const pool = getProcessingScheduler(), runs = [];
      for (const count of [1, 2, 4, 8].filter((n) => n <= pool.budget.cpu)) {
        pool.configure({ fixedConcurrency: count }); let violations = 0;
        const stop = pool.subscribe((state) => { if (state.active > count || state.estimatedBytes > state.memoryBudget) violations++; });
        const results = await Promise.all(Array.from({ length: 12 }, () => enqueueScene({ project, slideId: "one", readAsset: (id) => bank.get(id) }).promise)); stop();
        runs.push({ count, violations, hashes: await Promise.all(results.map((output) => hash(new Uint8Array(output.output)))) });
      }
      pool.configure({ mode: "auto" });
      return { reports, runs, seamDifference, corruptMask, photo: [...photo], mask: [...mask] };
    }, font.toString("base64"));
    for (const report of evidence.reports) {
      assert.equal(report.sourceOpens, 1); assert.equal(report.maskOpens, 1); assert.equal(report.unchanged, true, "empty title never thickens photo alpha");
      assert.ok(report.changed > 100); assert.ok(report.alphaError <= 1, JSON.stringify(report)); assert.ok(report.colorError <= 2, JSON.stringify(report));
      assert.ok(report.pageDifference <= 2, JSON.stringify(report)); assert.equal(report.preview, true, "preview is one exact final downsample");
      assert.ok(report.fallbackDifference <= 2, JSON.stringify(report)); assert.equal(report.fallbackWarning, true);
    }
    assert.match(evidence.corruptMask, /integrity/, "a corrupt supplied mask fails instead of silently using the missing-mask fallback");
    const reference = evidence.runs[0].hashes[0];
    assert.ok(evidence.seamDifference <= 2, `connected depth group exceeds the existing two-level seam tolerance: ${evidence.seamDifference}`);
    for (const run of evidence.runs) { assert.equal(run.violations, 0); assert.deepEqual(run.hashes, Array(12).fill(reference)); }

    await page.locator("#empty-story-button").click(); await page.locator("#story-title").fill("Depth study");
    await page.locator("#story-files").setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `depth-${i}.png`, mimeType: "image/png", buffer: Buffer.from(evidence.photo) })));
    await ready(); await saved();
    await page.locator('[data-story-tool="text"]').click();
    await page.getByLabel("Slide caption", { exact: true }).fill("A fresh caption"); await reviewed();
    await page.getByRole("button", { name: "Depth title", exact: true }).click();
    const toggle = page.getByLabel("Text behind this subject", { exact: true }); assert.equal(await toggle.isDisabled(), true);
    await page.getByRole("button", { name: "Apply words & edit subject", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".mask-editor canvas")?.getAttribute("aria-disabled") === "false");
    await page.locator(".mask-editor details").filter({ hasText: "Import a mask" }).locator("summary").click();
    await page.locator("[data-mask-import]").setInputFiles({ name: "subject.png", mimeType: "image/png", buffer: Buffer.from(evidence.mask) }); await apply();
    const cutout = await digest();
    const setTitle = async () => {
      await page.locator('[data-story-tool="text"]').click(); await page.getByRole("button", { name: "Depth title", exact: true }).click(); await toggle.check();
      assert.equal(await toggle.evaluate((el) => el === document.activeElement), true, "enabling depth keeps keyboard focus");
      await page.getByLabel("Depth title", { exact: true }).fill("OUTSIDE");
      await page.locator(".story-depth-controls summary").click();
      await page.getByLabel("Depth typeface", { exact: true }).selectOption("system-sans");
      await page.getByLabel("Title up / down", { exact: true }).evaluate((input) => { input.value = ".25"; input.dispatchEvent(new Event("input", { bubbles: true })); });
      await reviewed();
    };
    await setTitle(); assert.notEqual(await digest(), cutout); await page.locator("#story-sheet-cancel").click(); await ready(); await saved(); assert.equal(await digest(), cutout);
    await setTitle(); await apply(); let committed = await digest();
    const first = await document(), photo = Object.values(first.nodes).find((node) => node.depthTextId), titleId = photo.depthTextId;
    assert.equal(first.nodes[titleId].text, "OUTSIDE"); assert.equal(first.nodes[`${first.slides[0].id}:caption`].text, "A fresh caption");
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), cutout);
    await page.locator("#story-redo").click(); await ready(); await saved(); assert.equal(await digest(), committed);
    await page.reload(); await page.locator("#empty-story-button").click(); await page.locator("#story-library").getByRole("button", { name: "Depth study", exact: true }).click();
    await ready(); await saved(); assert.equal(await digest(), committed);
    await page.locator('[data-story-tool="look"]').click(); await page.getByRole("button", { name: "Save my style", exact: true }).click();
    await page.getByLabel("Style name", { exact: true }).fill("Reusable depth type");
    await page.getByLabel("Include Look", { exact: true }).uncheck(); await page.getByLabel("Include Text style", { exact: true }).uncheck();
    await page.getByLabel("Include Depth title", { exact: true }).check(); await page.getByLabel("Depth title source", { exact: true }).selectOption(photo.id);
    await page.getByRole("button", { name: "Save style", exact: true }).click();
    await waitForAsync(page, async () => (await (await import("./src/styles/store.js")).readStyleLibrary()).records.some((entry) => entry.style.name === "Reusable depth type"));
    const savedStyle = await page.evaluate(async () => (await (await import("./src/styles/store.js")).readStyleLibrary()).records.find((entry) => entry.style.name === "Reusable depth type").style);
    assert.deepEqual(Object.keys(savedStyle.components), ["depthTitle"]);
    const styleCard = page.locator("[data-style-key]").filter({ hasText: "Reusable depth type" });
    await styleCard.click(); await reviewed();
    const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Export style", exact: true }).click();
    const styleText = await readFile(await (await downloaded).path(), "utf8");
    assert.deepEqual(JSON.parse(styleText), savedStyle);
    for (const privateValue of ["OUTSIDE", "A fresh caption", photo.id, photo.assetId, photo.maskId]) assert.equal(styleText.includes(privateValue), false);
    await page.locator("#story-sheet-cancel").click(); await ready(); await saved(); assert.equal(await digest(), committed);
    await page.locator('[data-story-tool="text"]').click(); await page.getByLabel("Depth title", { exact: true }).fill("SAME MOMENT");
    await page.getByLabel("Depth background", { exact: true }).selectOption("page");
    await page.locator(".story-depth-controls summary").click(); await page.getByLabel("Depth typeface", { exact: true }).selectOption("system-mono");
    await page.getByLabel("Title up / down", { exact: true }).evaluate((input) => { input.value = ".5"; input.dispatchEvent(new Event("input", { bubbles: true })); }); await apply();
    const beforeStyle = await digest();
    const chooseSavedDepth = async () => {
      await page.locator('[data-story-tool="look"]').click(); await page.getByRole("button", { name: "Saved", exact: true }).click();
      await page.getByLabel("Look scope", { exact: true }).selectOption("this"); await styleCard.click(); await reviewed();
    };
    await chooseSavedDepth(); assert.notEqual(await digest(), beforeStyle);
    assert.match(await page.locator(".story-style-tabs").locator("..").innerText(), /1 photo with a subject selection/);
    await page.locator("#story-sheet-cancel").click(); await ready(); await saved(); assert.equal(await digest(), beforeStyle);
    await chooseSavedDepth(); await apply();
    assert.equal((await document()).nodes[titleId].text, "SAME MOMENT"); assert.equal((await document()).nodes[titleId].frame.y, .5);
    assert.deepEqual((await document()).nodes[titleId].style, savedStyle.components.depthTitle.style);
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), beforeStyle);
    await chooseSavedDepth(); await page.getByLabel("Keep adjusted positions", { exact: true }).uncheck(); await reviewed();
    await page.evaluate(() => { window.document.documentElement.style.fontSize = "32px"; });
    assert.equal(await page.locator("#story-sheet").evaluate((sheet) => sheet.scrollWidth > sheet.clientWidth), false);
    await page.evaluate(() => { window.document.documentElement.style.fontSize = ""; });
    if (process.env.TINY_IMAGE_STAR_DEPTH_STYLE_ARTIFACTS) {
      const directory = new URL("../docs/research/2026-09-20/depth-styles/", import.meta.url); await mkdir(directory, { recursive: true });
      await page.getByLabel("Keep adjusted positions", { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: new URL("depth-style-phone.png", directory).pathname });
    }
    await apply(); const appliedStyle = await digest();
    assert.equal((await document()).nodes[titleId].text, "SAME MOMENT"); assert.deepEqual((await document()).nodes[titleId].frame, savedStyle.components.depthTitle.frame);
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), beforeStyle);
    await page.locator("#story-redo").click(); await ready(); await saved(); assert.equal(await digest(), appliedStyle);
    await page.reload(); await page.locator("#empty-story-button").click(); await page.locator("#story-library").getByRole("button", { name: "Depth study", exact: true }).click();
    await ready(); await saved(); assert.equal(await digest(), appliedStyle);
    await page.locator('[data-story-tool="text"]').click(); await toggle.uncheck(); await apply();
    assert.equal((await document()).nodes[photo.id].depthTextId, undefined);
    await chooseSavedDepth(); await apply();
    assert.equal((await document()).nodes[titleId].text, "Depth study", "a new title uses the destination story name");
    await page.locator('[data-story-tool="text"]').click(); await page.getByLabel("Depth title", { exact: true }).fill("OUTSIDE"); await apply();
    assert.equal(await digest(), committed, "reused depth settings reconstruct the original appearance with the same target words");
    await page.locator('[data-story-tool="photos"]').click(); await page.getByLabel("Crop zoom", { exact: true }).evaluate((input) => { input.value = "1.4"; input.dispatchEvent(new Event("input", { bubbles: true })); }); await apply();
    await page.locator('[data-story-tool="layout"]').click(); await page.getByLabel("Story shape", { exact: true }).selectOption("tall"); await apply();
    assert.equal((await document()).nodes[titleId].text, "OUTSIDE"); committed = await digest();
    if (process.env.TINY_IMAGE_STAR_DEPTH_ARTIFACTS) { const directory = new URL("../docs/research/2026-09-17/", import.meta.url); await mkdir(directory, { recursive: true });
      await page.waitForFunction(() => { const images = [...document.querySelectorAll("#story-filmstrip img")]; return images.length === 4 && images.every((image) => image.complete && image.naturalWidth); });
      await page.screenshot({ path: new URL("depth-story-phone.png", directory).pathname }); }
    await page.locator('[data-story-tool="text"]').click(); await page.getByLabel("Depth background", { exact: true }).selectOption("page"); await reviewed();
    assert.notEqual(await digest(), committed); await page.getByLabel("Depth background", { exact: true }).selectOption("photo"); await reviewed(); assert.equal(await digest(), committed);
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    const layout = await page.locator("#story-sheet").evaluate((sheet) => ({ overflow: sheet.scrollWidth > sheet.clientWidth,
      offenders: [...sheet.querySelectorAll("*")].filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > sheet.getBoundingClientRect().right + 1).map((el) => ({ tag: el.tagName, text: el.textContent.slice(0, 80), width: el.getBoundingClientRect().width })) }));
    assert.equal(layout.overflow, false, JSON.stringify(layout));
    const smallButtons = await page.locator("#story-sheet button:visible").evaluateAll((buttons) => buttons.filter((button) => button.getBoundingClientRect().height < 44).map((button) => button.textContent)); assert.deepEqual(smallButtons, []);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await page.getByLabel("Depth title", { exact: true }).fill("KEEP THIS"); await reviewed();
    await page.evaluate(() => {
      const transaction = IDBDatabase.prototype.transaction;
      window.restoreDepthQuota = () => { IDBDatabase.prototype.transaction = transaction; };
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) { if (this.name === "tiny-image-star.projects" && mode === "readwrite") throw new DOMException("Injected depth quota", "QuotaExceededError"); return transaction.call(this, stores, mode, ...rest); };
    });
    await page.locator("#story-sheet-apply").click(); await page.locator("#story-retry-save").waitFor({ state: "visible" });
    assert.equal((await document()).nodes[titleId].text, "OUTSIDE"); await page.evaluate(() => window.restoreDepthQuota()); await page.locator("#story-retry-save").click(); await ready(); await saved();
    assert.equal((await document()).nodes[titleId].text, "KEEP THIS"); committed = await digest();
    await page.locator('[data-story-tool="cutout"]').click(); await page.waitForFunction(() => document.querySelector(".mask-editor canvas")?.getAttribute("aria-disabled") === "false");
    await page.getByRole("button", { name: "Remove cutout", exact: true }).click(); await apply();
    assert.equal((await document()).nodes[titleId].text, "KEEP THIS"); assert.equal((await document()).nodes[photo.id].maskId, undefined);
    assert.match(await page.locator("#story-preview-message").innerText(), /new subject mask/); const fallback = await digest();
    await page.locator('[data-story-tool="look"]').click(); await page.getByRole("button", { name: "Saved", exact: true }).click();
    assert.equal(await styleCard.isDisabled(), true); assert.match(await styleCard.innerText(), /Choose a subject in Cutout/);
    await page.locator("#story-sheet-cancel").click(); await ready();
    await page.locator('[data-story-tool="text"]').click(); assert.equal(await toggle.evaluate((input) => input.indeterminate), true);
    assert.equal(await page.getByLabel("Depth title", { exact: true }).inputValue(), "KEEP THIS"); await page.locator("#story-sheet-cancel").click(); await ready();
    await page.reload(); await page.locator("#empty-story-button").click(); await page.locator("#story-library").getByRole("button", { name: "Depth study", exact: true }).click();
    await ready(); await saved(); assert.equal(await digest(), fallback); assert.equal((await document()).nodes[titleId].text, "KEEP THIS");
    await page.locator('[data-story-tool="cutout"]').click(); await page.waitForFunction(() => document.querySelector(".mask-editor canvas")?.getAttribute("aria-disabled") === "false");
    await page.locator(".mask-editor details").filter({ hasText: "Import a mask" }).locator("summary").click();
    await page.locator("[data-mask-import]").setInputFiles({ name: "subject.png", mimeType: "image/png", buffer: Buffer.from(evidence.mask) }); await apply();
    assert.equal(await digest(), committed, "selecting a new mask restores depth without rebuilding the title");
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), fallback);
    await page.locator("#story-redo").click(); await ready(); await saved(); assert.equal(await digest(), committed);
    await page.locator('[data-story-tool="photos"]').click(); const picker = page.getByLabel("Source photo", { exact: true });
    const ids = await picker.locator("option").evaluateAll((options) => options.map((option) => option.value)); await picker.selectOption(ids[1]); await apply();
    const replaced = await document(); assert.equal(replaced.nodes[titleId].text, "KEEP THIS"); assert.equal(replaced.nodes[photo.id].assetId, ids[1]); assert.equal(replaced.nodes[photo.id].maskId, undefined);
    assert.match(await page.locator("#story-preview-message").innerText(), /new subject mask/);
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), committed);
    await page.locator("#story-export").click(); await page.getByLabel("Story export format", { exact: true }).selectOption("png");
    await page.getByRole("button", { name: "Prepare files", exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll(".story-exports a").length === 4); await saved();
    const exported = await page.evaluate(async () => {
      const { hashAsset, listStoryProjects, readStoryProject } = await import("./src/project/storage.js"), { enqueueScene } = await import("./src/processing/scene-client.js");
      const [entry] = await listStoryProjects(), opened = await readStoryProject(entry.key), project = opened.project;
      const reference = await enqueueScene({ project, slideId: project.slides[0].id, variantId: project.recipe.outputVariant, format: "png", readAsset: opened.readAsset }).promise;
      const files = [];
      for (const link of document.querySelectorAll(".story-exports a")) { const blob = await (await fetch(link.href)).blob(), bitmap = await createImageBitmap(blob);
        files.push({ name: link.download, width: bitmap.width, height: bitmap.height, hash: await hashAsset(await blob.arrayBuffer()) }); bitmap.close(); }
      return { files, reference: await hashAsset(reference.output) };
    });
    assert.equal(exported.files[0].hash, exported.reference);
    for (const [i, file] of exported.files.entries()) { assert.equal(file.width, 1080); assert.equal(file.height, 1920); assert.ok(file.name.endsWith(`-${String(i + 1).padStart(2, "0")}.png`)); }
    assert.deepEqual(errors, []);
    console.log(`  depth titles: source alpha and soft-mask composition, one source decode, exact preview, ${evidence.runs.map((run) => run.count).join("/")} worker identity, phone setup/handoff/edit/cancel/undo, saved depth style capture/download/reuse, keep/reset placement, words preserved, missing-mask compatibility, reflow, exact recovery, quota retry, title-preserving mask/source changes and ordered exports`);
    console.log(`  depth rendering bounds: ${JSON.stringify({ cases: evidence.reports, seamDifference: evidence.seamDifference })}`);
  } finally { await context.close(); }
}
