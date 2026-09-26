import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

export async function assertStoryDesigns(browser, origin) {
  const files = await Promise.all(["./fixtures/corpus/story-design-v1/astronaut.png", "./fixtures/corpus/collections-v1/derived/coast-small.jpg",
    "./fixtures/corpus/collections-v1/derived/food-small.jpg"].map(async (path) => readFile(new URL(path, import.meta.url))));
  const mask = await readFile(new URL("./fixtures/corpus/story-design-v1/portrait-mask.png", import.meta.url));
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true }), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(90_000); page.on("pageerror", (error) => errors.push(error.message));
  const ready = () => page.waitForFunction(() => !document.querySelector("#story-export").disabled && document.querySelector("#story-preview").complete);
  const saved = () => page.waitForFunction(() => document.querySelector("#story-status").textContent === "Saved on this device");
  const reviewed = () => page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled);
  const apply = async () => { await reviewed(); await page.locator("#story-sheet-apply").click(); await ready(); await saved(); };
  const current = () => page.evaluate(async () => { const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(); return (await store.readStoryProject(entry.key)).project; });
  const digest = () => page.evaluate(async () => (await import("./src/project/storage.js")).hashAsset(await (await fetch(document.querySelector("#story-preview").src)).arrayBuffer()));
  const directory = new URL("../docs/research/2026-09-20/story-fonts/", import.meta.url);
  try {
    await page.goto(origin); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
    await page.locator("#empty-story-button").click(); await page.locator("#story-title").fill("ORBIT");
    await page.locator("#story-files").setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `study-${i}.${i % 3 ? "jpg" : "png"}`, mimeType: i % 3 ? "image/jpeg" : "image/png", buffer: files[i % 3] })));
    await ready(); await saved();
    const original = await current(), first = original.slides[0].id, photoId = original.slides[0].nodeIds.find((id) => original.nodes[id].kind === "image");
    assert.equal(original.recipe.style.definition.id, "builtin:story-scrapbook");
    assert.equal(original.recipe.style.definition.revision, 2); assert.equal(original.recipe.style.definition.assets.length, 2);
    assert.equal(original.recipe.storyDesign.decorations.length, 6);
    await page.locator('[data-story-tool="look"]').click();
    assert.equal(await page.locator(".story-style-card").count(), 3);
    assert.equal(await page.getByLabel("Look scope", { exact: true }).isVisible(), false, "whole-story recipes do not need a redundant scope picker");
    assert.equal(await page.getByLabel("Photo color strength", { exact: true }).isVisible(), false, "choose a preview before adjusting recipe parameters");
    assert.equal(await page.locator('[data-look="story-depth-cover"]').isDisabled(), true);
    assert.match(await page.locator('[data-look="story-depth-cover"]').innerText(), /cover subject.*Scrapbook or Film diary/);
    await page.getByRole("button", { name: "Photo looks", exact: true }).click(); assert.equal(await page.locator('[data-look="clean"]').isEnabled(), true);
    assert.equal(await page.getByLabel("Look scope", { exact: true }).isVisible(), true);
    await page.locator("#story-sheet-cancel").click(); await ready();
    await page.locator('[data-story-tool="cutout"]').click();
    await page.waitForFunction(() => document.querySelector(".mask-editor canvas")?.getAttribute("aria-disabled") === "false");
    await page.locator(".mask-editor details").filter({ hasText: "Import a mask" }).locator("summary").click();
    await page.locator("[data-mask-import]").setInputFiles({ name: "portrait-mask.png", mimeType: "image/png", buffer: mask }); await apply();
    const maskedProject = await current(), before = await digest();
    await page.locator('[data-story-tool="look"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".story-looks img").length === 3 && [...document.querySelectorAll(".story-looks img")].every((img) => img.complete && img.naturalWidth));
    await page.locator('[data-look="story-film-diary"]').click(); await reviewed(); assert.notEqual(await digest(), before);
    await page.getByRole("button", { name: "Favorite Film diary", exact: true }).click();
    await page.getByRole("button", { name: "Unfavorite Film diary", exact: true }).waitFor();
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export style", exact: true }).click();
    const recipeText = await readFile(await (await download).path(), "utf8"), recipeFile = JSON.parse(recipeText);
    assert.equal(recipeFile.id, "builtin:story-film-diary"); assert.ok(recipeFile.components.storyDesign);
    assert.equal(recipeFile.revision, 2); assert.equal(recipeFile.assets.length, 1); assert.equal(recipeFile.assets[0].license, "OFL-1.1");
    for (const value of ["ORBIT", photoId, maskedProject.nodes[photoId].maskId, maskedProject.assets[maskedProject.nodes[photoId].assetId].sha256]) assert.equal(recipeText.includes(value), false);
    await page.locator("#story-sheet-cancel").click(); await ready(); await saved(); assert.equal(await digest(), before);
    await page.locator('[data-story-tool="look"]').click(); await page.locator('[data-look="story-film-diary"]').click(); await apply();
    const filmHash = await digest(); assert.equal((await current()).recipe.storyDesign.decorations.length, 48);
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), before);
    await page.locator("#story-redo").click(); await ready(); await saved(); assert.equal(await digest(), filmHash);
    await page.reload(); await page.locator("#empty-story-button").click(); await page.locator("#story-library").getByRole("button", { name: "ORBIT", exact: true }).click();
    await ready(); await saved(); assert.equal(await digest(), filmHash);
    await page.locator('[data-story-tool="look"]').click(); await page.locator('[data-look="story-depth-cover"]').click(); await reviewed();
    assert.equal(await page.getByLabel("Look scope", { exact: true }).isDisabled(), true);
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    assert.equal(await page.locator("#story-sheet").evaluate((sheet) => sheet.scrollWidth > sheet.clientWidth), false);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    if (process.env.TINY_IMAGE_STAR_DESIGN_ARTIFACTS) {
      await mkdir(directory, { recursive: true }); await page.locator("#story-sheet-content").evaluate((node) => { node.scrollTop = 0; });
      await page.screenshot({ path: new URL("recipes-phone.png", directory).pathname });
    }
    await apply(); const depth = await current(), depthHash = await digest();
    assert.equal(Object.values(depth.nodes).filter((node) => node.depthTextId).length, 1);
    assert.equal(depth.nodes[depth.nodes[photoId].depthTextId].text, "ORBIT");
    assert.equal(depth.nodes[photoId].maskId, maskedProject.nodes[photoId].maskId);
    assert.equal(depth.recipe.storyDesign.decorations.length, 0);
    assert.equal(depth.recipe.layout.slides[first].fit, "cover");
    await page.waitForFunction(() => { const images = [...document.querySelectorAll("#story-filmstrip img")]; return images.length === 4 && images.every((image) => image.complete && image.naturalWidth); });
    const evidence = await page.evaluate(async (baseProject) => {
      const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(), opened = await store.readStoryProject(entry.key);
      const { curatedStoryStyles, storyStyleCommand } = await import("./src/styles/model.js"), { applyProjectCommand } = await import("./src/project/history.js");
      const { resolveSlide } = await import("./src/project/model.js"), { planScene } = await import("./src/compositor/scene-spec.js"), { createPillowEngine } = await import("./src/engine/pillow.js");
      const { enqueueScene } = await import("./src/processing/scene-client.js"), { getProcessingScheduler } = await import("./src/processing/client.js");
      const engine = await createPillowEngine(), reports = [], previews = [], jobs = [];
      for (const style of curatedStoryStyles()) {
        const project = applyProjectCommand(baseProject, storyStyleCommand(baseProject, style)).project;
        for (const variant of project.variants) for (const index of [0, 1, project.slides.length - 1]) {
          const slide = project.slides[index], plan = planScene(project, slide.id, variant.id, { preview: true, previewEdge: 480 });
          const assets = await Promise.all(plan.assets.map(async (asset) => ({ id: asset.id, bytes: await (await opened.readAsset(asset.id)).arrayBuffer() })));
          const render = (value) => engine.renderPreview({ project: value, slideId: slide.id, variantId: variant.id, previewEdge: 480, format: "png", assets });
          const actual = await render(project), flat = structuredClone(project), resolved = resolveSlide(project, slide.id, variant.id);
          for (const node of Object.values(flat.nodes).filter((node) => node.attachment && slide.nodeIds.includes(node.id))) {
            const placed = resolved.nodes.find((entry) => entry.id === node.id);
            node.frame = placed.frame; node.rotation = placed.rotation; delete node.attachment; delete node.variantFrames;
          }
          const reference = await render(flat), exact = await store.hashAsset(actual.bytes) === await store.hashAsset(reference.bytes);
          const bitmap = await createImageBitmap(new Blob([actual.bytes], { type: "image/png" }));
          reports.push({ recipe: style.name, variant: variant.id, page: index + 1, width: bitmap.width, height: bitmap.height, exact, warnings: actual.warnings }); bitmap.close();
          previews.push({ name: `${style.id.replace("builtin:story-", "")}-${variant.id}-${index + 1}.png`, bytes: [...actual.bytes] });
          if (variant.id === "portrait" && (index !== project.slides.length - 1 || style.id !== "builtin:story-depth-cover")) jobs.push({ project, slideId: slide.id, hash: await store.hashAsset(actual.bytes) });
        }
      }
      const pool = getProcessingScheduler(), concurrency = [];
      for (const count of [1, 4, 8].filter((value) => value <= pool.budget.cpu)) {
        pool.configure({ fixedConcurrency: count }); let violations = 0, peak = 0;
        const stop = pool.subscribe((state) => { peak = Math.max(peak, state.active); if (state.active > count || state.estimatedBytes > state.memoryBudget) violations++; });
        let results;
        try { results = await Promise.all(jobs.map((job) => enqueueScene({ project: job.project, slideId: job.slideId, variantId: "portrait", preview: true, previewEdge: 480, format: "png", readAsset: opened.readAsset }).promise)); }
        finally { stop(); }
        concurrency.push({ count, peak, violations, hashes: await Promise.all(results.map((result) => store.hashAsset(result.output))) });
      }
      pool.configure({ mode: "auto" });
      const forged = curatedStoryStyles()[0]; forged.components.storyDesign.roles.cover.caption.fontSize = .12;
      let impersonation;
      try { await (await import("./src/styles/store.js")).putStyle(forged, { origin: "imported" }); impersonation = "accepted"; } catch (error) { impersonation = error.message; }
      return { reports, previews, concurrency, referenceHashes: jobs.map((job) => job.hash), impersonation };
    }, maskedProject);
    assert.equal(evidence.reports.length, 18); assert.ok(evidence.reports.every((entry) => entry.exact && entry.height === 480));
    assert.ok(evidence.reports.every((entry) => entry.warnings.length === 0));
    assert.equal(evidence.referenceHashes.length, 8); assert.ok(evidence.concurrency.length > 0);
    for (const run of evidence.concurrency) { assert.equal(run.violations, 0); assert.deepEqual(run.hashes, evidence.referenceHashes); }
    assert.match(evidence.impersonation, /built-in style/);
    if (process.env.TINY_IMAGE_STAR_DESIGN_ARTIFACTS) {
      await mkdir(directory, { recursive: true });
      for (const preview of evidence.previews) await writeFile(new URL(preview.name, directory), Buffer.from(preview.bytes));
      await writeFile(new URL("renders.json", directory), `${JSON.stringify(evidence.reports, null, 2)}\n`);
      await writeFile(new URL("concurrency.json", directory), `${JSON.stringify({ referenceHashes: evidence.referenceHashes, runs: evidence.concurrency }, null, 2)}\n`);
    }
    assert.equal(await digest(), depthHash, "offscreen recipe rendering does not change the open story");
    await page.locator('[data-story-tool="layout"]').click(); assert.equal(await page.getByLabel("Photo fit", { exact: true }).inputValue(), "cover");
    await page.getByLabel("Photo fit", { exact: true }).selectOption("contain"); await apply(); assert.notEqual(await digest(), depthHash);
    assert.equal((await current()).nodes[photoId].maskId, maskedProject.nodes[photoId].maskId);
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await digest(), depthHash);
    await page.locator("#story-export").click(); await page.getByLabel("Story export format", { exact: true }).selectOption("png");
    await page.getByRole("button", { name: "Prepare files", exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll(".story-exports a").length === 4);
    const output = await page.evaluate(async () => { const link = document.querySelector(".story-exports a"), blob = await (await fetch(link.href)).blob();
      const bitmap = await createImageBitmap(blob); const result = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return result; });
    assert.deepEqual(output, { width: 1080, height: 1350 }); assert.equal((await current()).slides[0].id, first);
    assert.deepEqual(errors, []);
    console.log(`  authored story recipes: default Scrapbook, distinct role/framing/decorations, cover-mask preflight, safe recipe download/identity, 18 real-photo renders with exact flattened-decoration references, ${evidence.concurrency.map((run) => `${run.count} workers (peak ${run.peak})`).join(" / ")} match live serial output, phone previews/cancel/undo/reload, 200% text and ordered PNG export`);
  } finally { await context.close(); }
}
