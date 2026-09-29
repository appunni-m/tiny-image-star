import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function assertCreatorStamp(browser, origin) {
  const encoded = await readFile(new URL("./fixtures/rgb-small.png.base64", import.meta.url), "utf8");
  const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(origin);
    await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
    await page.locator("#file-input").setInputFiles({
      name: "creator-stamp.png",
      mimeType: "image/png",
      buffer: Buffer.from(encoded.trim(), "base64"),
    });
    await page.waitForFunction(() => document.querySelector("#tray-count")?.textContent === "1 image");
    await page.locator("#mobile-batch-settings").click();
    await page.locator("#tray-text-stamp").click();
    await page.getByLabel("Typography preset").selectOption("film-title");
    assert.equal(await page.getByLabel("Overlay font").inputValue(), "system-display");
    assert.equal(await page.getByLabel("Text size").inputValue(), "headline");
    assert.equal(await page.getByLabel("Text weight").inputValue(), "800");
    assert.equal(await page.getByLabel("Text style").inputValue(), "normal");
    assert.equal(await page.getByLabel("Text placement").inputValue(), "middle");
    await page.getByRole("textbox", { name: "Text overlay", exact: true }).fill("Summer studio 2026");
    await page.getByLabel("Text alignment").selectOption("left");
    assert.equal(await page.getByLabel("Typography preset").inputValue(), "custom", "manual tuning marks the starter as Custom");
    const overlay = page.locator("dialog.creator-stamp-sheet");
    const bounds = await overlay.boundingBox();
    assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= 321, `overlay sheet fits a 320px phone viewport: ${JSON.stringify(bounds)}`);
    await page.getByRole("button", { name: "Apply & save recipe", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#preset-dialog")?.open === true);
    await page.locator("#preset-name-input").fill("Creator stamp smoke recipe");
    await page.getByRole("button", { name: "Save preset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#preset-dialog")?.open === false);

    const saved = await page.evaluate(async () => {
      const catalog = await (await import("./src/styles/catalog.js")).readRecipeCatalog();
      const recipe = catalog.recipes.find((item) => item.name === "Creator stamp smoke recipe");
      return { readOnly: catalog.readOnly, recipe };
    });
    assert.equal(saved.readOnly, false, "the recipe catalog remains writable");
    assert.ok(saved.recipe, "the overlay sheet saves a recipe in the shared catalog");
    const stamp = saved.recipe.operations.textLayers.find((layer) => layer.id === "tinystar:creator-stamp:v1");
    assert.ok(stamp, "the saved recipe retains the text overlay layer");
    assert.equal(stamp.text, "Summer studio 2026");
    assert.equal(stamp.fontId, "system-display");
    assert.equal(stamp.fontSize, 0.08);
    assert.equal(stamp.weight, "800");
    assert.equal(stamp.align, "left");
    assert.ok(await page.locator("#tray-preset-picker option").filter({ hasText: "Creator stamp smoke recipe" }).count(), "the saved recipe is offered to the active batch");
    assert.deepEqual(errors, [], `creator stamp browser errors: ${errors.join(" | ")}`);
    console.log("  creator typography: mobile starter tuning and saved recipe catalog round-trip");
  } finally {
    await context.close();
  }
}
