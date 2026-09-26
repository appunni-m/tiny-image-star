import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

export async function assertStoryFonts(browser, origin) {
  const photo = await readFile(new URL("./fixtures/corpus/story-design-v1/astronaut.png", import.meta.url));
  const files = Array.from({ length: 6 }, (_, i) => ({ name: `font-study-${i}.png`, mimeType: "image/png", buffer: photo }));
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true }), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(90_000); page.on("pageerror", error => errors.push(error.message));
  let mode = "allow", held, release, requests = 0;
  await context.route("**/src/assets/story-type-v1/**/*.ttf", async (route) => {
    requests++;
    if (mode === "hold") { held = true; await new Promise(resolve => { release = resolve; }); }
    if (mode === "fail" || mode === "offline") await route.fulfill({ status: 503, body: "Font unavailable" });
    else await route.continue().catch(() => {});
  });
  const ready = () => page.waitForFunction(() => !document.querySelector("#story-export").disabled && document.querySelector("#story-preview").complete);
  const saved = () => page.waitForFunction(() => document.querySelector("#story-status").textContent === "Saved on this device");
  const reviewed = () => page.waitForFunction(() => !document.querySelector("#story-sheet-apply").disabled);
  const apply = async () => { await reviewed(); await page.locator("#story-sheet-apply").click(); await ready(); await saved(); };
  const hash = () => page.evaluate(async () => (await import("./src/project/storage.js")).hashAsset(await (await fetch(document.querySelector("#story-preview").src)).arrayBuffer()));
  const current = () => page.evaluate(async () => { const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(); return (await store.readStoryProject(entry.key)).project; });
  try {
    await page.goto(origin); await page.waitForFunction(() => document.querySelector("#engine-status").textContent === "Ready");
    await page.locator("#empty-story-button").click(); await page.locator("#story-title").fill("TYPE STUDY"); await page.locator("#story-files").setInputFiles(files);
    await ready(); await saved(); const original = await current(), originalHash = await hash();
    assert.equal(original.recipe.style.definition.revision, 2); assert.equal(requests, 2);
    assert.equal(Object.values(original.assets).filter(asset => asset.kind === "font").length, 2);
    const variable = await page.evaluate(async () => {
      const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(), opened = await store.readStoryProject(entry.key);
      const asset = Object.values(opened.project.assets).find(asset => asset.name === "Source Serif 4");
      const { verifyFontRecord, loadFontFace } = await import("./src/compositor/fonts.js");
      const raw = { id: `font-${asset.sha256.slice(0, 16)}`, sha256: asset.sha256, bytes: await (await opened.readAsset(asset.id)).arrayBuffer() };
      const checked = await verifyFontRecord(raw, { id: raw.id, sha256: asset.sha256, bytes: asset.byteLength });
      const variable = await loadFontFace({ ...checked, fontFace: asset.fontFace }), legacy = await loadFontFace(checked);
      try {
        const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 90; const ctx = canvas.getContext("2d");
        const hashes = [];
        for (const weight of [400, 700]) { ctx.clearRect(0, 0, 640, 90); ctx.font = `${weight} 48px ${variable.family}`; ctx.fillText("Hamburgefonts 0123", 0, 65); hashes.push(await store.hashAsset(ctx.getImageData(0, 0, 640, 90).data)); }
        return { weight: variable.face.weight, status: variable.face.status, isolated: variable.family !== legacy.family, hashes };
      } finally { document.fonts.delete(variable.face); document.fonts.delete(legacy.face); }
    });
    assert.equal(variable.weight, "200 900"); assert.equal(variable.status, "loaded"); assert.equal(variable.isolated, true); assert.notEqual(variable.hashes[0], variable.hashes[1]);
    const newStyle = await page.evaluate(async () => {
      const store = await import("./src/project/storage.js"), [entry] = await store.listStoryProjects(), project = (await store.readStoryProject(entry.key)).project;
      const font = (await import("./src/styles/font-pack.js")).storyFont("sans"); project.assets[font.id] = font;
      Object.values(project.nodes).find(node => node.id.endsWith(":caption")).fontId = font.id;
      return (await import("./src/styles/model.js")).captureStoryStyle(project, project.slides[0].id, "New sans", { text: true });
    });
    const styleButton = () => page.locator(`[data-style-key="${newStyle.id}@${newStyle.revision}"]`);
    mode = "fail"; await page.locator('[data-story-tool="look"]').click();
    assert.ok((await page.locator("#story-sheet-content details summary").first().boundingBox()).height >= 44, "font options have a phone-sized touch target");
    await page.getByLabel("Import style file").setInputFiles({ name: "new-sans.tstyle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(newStyle)) });
    await styleButton().waitFor(); await styleButton().click();
    await page.waitForFunction(() => document.querySelector("#story-sheet-content").textContent.includes("could not be loaded"));
    assert.equal(await hash(), originalHash); assert.equal((await current()).revision, original.revision);
    await page.locator("#story-sheet-cancel").click(); await ready();
    mode = "hold"; held = false; await page.locator('[data-story-tool="look"]').click(); await page.getByRole("button", { name: "Saved", exact: true }).click();
    await styleButton().click(); await page.waitForFunction(() => document.querySelector("#story-sheet-apply").disabled);
    // Wait for the held network operation, then close both preview consumers.
    for (let i = 0; i < 100 && !held; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(held); await page.locator("#story-sheet-cancel").click(); mode = "allow"; release(); await ready();
    assert.equal(await hash(), originalHash); assert.equal((await current()).revision, original.revision);
    await page.locator('[data-story-tool="look"]').click(); await page.getByRole("button", { name: "Saved", exact: true }).click(); await styleButton().click(); await apply();
    const sansHash = await hash(); assert.notEqual(sansHash, originalHash);
    const withSans = await current(); assert.equal(Object.values(withSans.assets).filter(asset => asset.kind === "font").length, 3);
    await page.locator('[data-story-tool="look"]').click(); await page.getByRole("button", { name: "Save my style", exact: true }).click();
    await page.getByLabel("Style name", { exact: true }).fill("Saved licensed type");
    // Existing defaults capture both the look and typography, including font references.
    await page.getByRole("button", { name: "Save style", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".story-style-form").hidden && document.querySelector("#story-sheet-content").textContent.includes("Saved Saved licensed type."));
    await page.locator("[data-style-key]").filter({ hasText: "Saved licensed type" }).click(); await reviewed();
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export style", exact: true }).click();
    const exported = JSON.parse(await readFile(await (await download).path(), "utf8"));
    assert.equal(exported.name, "Saved licensed type"); assert.ok(exported.assets.length); assert.ok(exported.assets.every(asset => asset.kind === "font" && asset.license === "OFL-1.1"));
    assert.equal(JSON.stringify(exported).includes("TYPE STUDY"), false);
    await page.locator("#story-sheet-cancel").click(); await ready();
    mode = "offline"; const beforeOffline = requests;
    await page.reload(); await page.locator("#empty-story-button").click(); await page.locator("#story-library").getByRole("button", { name: "TYPE STUDY", exact: true }).click();
    await ready(); await saved(); assert.equal(await hash(), sansHash); assert.equal(requests, beforeOffline, "saved font bytes render without a font network request");
    await page.locator('[data-story-tool="text"]').click(); await page.getByLabel("Slide caption", { exact: true }).fill("東京 🌈");
    await page.waitForFunction(() => document.querySelector("#story-sheet-preview-status").textContent.includes("every character"));
    assert.equal(await page.locator("#story-sheet-apply").isDisabled(), true);
    await page.getByRole("button", { name: "Use device fonts for this story", exact: true }).click(); await reviewed();
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    assert.equal(await page.locator("#story-sheet").evaluate(sheet => sheet.scrollWidth > sheet.clientWidth), false);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    if (process.env.TINY_IMAGE_STAR_FONT_ARTIFACTS) {
      const dir = new URL("../docs/research/2026-09-20/story-fonts/", import.meta.url); await mkdir(dir, { recursive: true });
      await page.screenshot({ path: new URL("font-fallback-phone.png", dir).pathname });
      await writeFile(new URL("shared-style.tstyle", dir), JSON.stringify(exported, null, 2) + "\n");
    }
    await apply(); const fallback = await current();
    assert.equal(Object.values(fallback.nodes).find(node => node.id.endsWith(":caption")).text, "東京 🌈");
    assert.ok(Object.values(fallback.nodes).every(node => !node.fontId));
    await page.locator("#story-undo").click(); await ready(); await saved(); assert.equal(await hash(), sansHash);
    assert.equal(requests, beforeOffline); assert.deepEqual(errors, []);
  } finally { release?.(); await context.close(); }
  const fallbackContext = await browser.newContext({ viewport: { width: 375, height: 667 } }), fallbackPage = await fallbackContext.newPage();
  let unwanted = 0;
  await fallbackContext.route("**/src/assets/story-type-v1/**/*.ttf", async route => { unwanted++; await route.abort(); });
  try {
    await fallbackPage.goto(origin); await fallbackPage.locator("#empty-story-button").click();
    assert.ok((await fallbackPage.locator("#story-intro .story-font-options summary").boundingBox()).height >= 44, "creation font options have a phone-sized touch target");
    await fallbackPage.locator("#story-intro .story-font-options summary").click(); await fallbackPage.locator("#story-device-fonts").check();
    assert.ok((await fallbackPage.locator("#story-device-fonts").locator("..").boundingBox()).height >= 44);
    await fallbackPage.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    assert.equal(await fallbackPage.locator("#story-intro").evaluate(intro => intro.scrollWidth > intro.clientWidth), false, "creation font options fit at 200% text");
    if (process.env.TINY_IMAGE_STAR_FONT_ARTIFACTS) await fallbackPage.screenshot({ path: new URL("../docs/research/2026-09-20/story-fonts/font-options-200-phone.png", import.meta.url).pathname, fullPage: true });
    await fallbackPage.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await fallbackPage.locator("#story-files").setInputFiles(files);
    await fallbackPage.waitForFunction(() => !document.querySelector("#story-export").disabled && document.querySelector("#story-status").textContent === "Saved on this device");
    assert.equal(unwanted, 0);
    const revision = await fallbackPage.evaluate(async () => { const s = await import("./src/project/storage.js"), [p] = await s.listStoryProjects(); return (await s.readStoryProject(p.key)).project.recipe.style.definition.revision; });
    assert.equal(revision, 1);
  } finally { await fallbackContext.close(); }
  console.log("  licensed story fonts: pinned variable faces, downloaded style references, shared/cancelled/failed font loads, explicit device-font creation, no-network saved-font reload, unsupported-character preflight, 200% text, fallback and exact undo");
}
