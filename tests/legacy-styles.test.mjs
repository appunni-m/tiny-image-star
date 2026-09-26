import assert from "node:assert/strict";
import test from "node:test";
import { PRESETS } from "../src/presets.js";
import { ENGINE_IDENTITY, LEGACY_ORDER, clone } from "../src/project/model.js";
import { createLargeJob, settingsForLargeJob } from "../src/jobs/core.js";
import { legacyStyleFromRecipe, legacyRecipeOperations, legacyRecipeProblem, originalRecipe, validateLegacyStyle, withLegacyStyle } from "../src/styles/legacy.js";
import { parseStyle } from "../src/styles/model.js";

const recipe = () => ({ id: "custom-old", name: "My old print", destination: "Paper", description: "Saved before migration", builtIn: false,
  operations: { ...clone(PRESETS[0].operations), cropRelative: { x: .1, y: .2, width: .6, height: .5 }, rotation: 90, flipX: true,
    resizeWidth: 24, resizeHeight: 30, brightness: 1.2, contrast: .8, grayscale: true } });

test("all destination presets become versioned outputs with identical identity, parameters and order", () => {
  for (const preset of PRESETS) {
    const source = { ...preset, builtIn: true }, style = legacyStyleFromRecipe(source, 1, "output");
    assert.equal(style.id, preset.id); assert.equal(style.name, preset.name); assert.equal(style.category, "output");
    assert.deepEqual(style.recipe, source); assert.deepEqual(style.order, LEGACY_ORDER); assert.deepEqual(style.engine, ENGINE_IDENTITY);
    assert.deepEqual(originalRecipe(withLegacyStyle(style)), source);
  }
});

test("private legacy definitions preserve original fields and text, and do not enter public style sharing", () => {
  const source = recipe(); source.oldMetadata = { kept: true }; source.operations.textLayers = [{ id: "title", text: "Private caption" }];
  const frozen = clone(source), style = legacyStyleFromRecipe(source, 4); source.operations.brightness = 3;
  assert.deepEqual(style.recipe, frozen); assert.equal(style.revision, 4);
  assert.deepEqual(validateLegacyStyle(JSON.parse(JSON.stringify(style))), style);
  assert.throws(() => parseStyle(JSON.stringify(style)), /different app version/);
});

test("a consumer resolves the copied revision rather than mutable wrapper operations", () => {
  const style = legacyStyleFromRecipe(recipe()), wrapper = withLegacyStyle(style);
  wrapper.operations.brightness = 4;
  assert.equal(legacyRecipeOperations(wrapper).brightness, 1.2);
  const result = legacyRecipeOperations(wrapper); result.contrast = 3;
  assert.equal(legacyRecipeOperations(wrapper).contrast, .8);
  assert.deepEqual(style.recipe, recipe());
});

test("unsupported output and compression intents remain identifiable until an explicit replacement", () => {
  const source = recipe(); source.operations.format = "avif";
  const style = legacyStyleFromRecipe(source), frozen = withLegacyStyle(style);
  assert.equal(frozen.operations.format, "avif"); assert.match(legacyRecipeProblem(frozen), /avif output is unavailable/);
  assert.equal(createLargeJob({ id: "job", recipe: frozen }).recipe.operations.format, "avif");
  assert.throws(() => settingsForLargeJob(frozen), /avif output is unavailable/);
  source.operations.format = "future-format"; assert.match(legacyRecipeProblem(source), /future-format output/);
  source.operations.format = "jpeg"; source.operations.lossy = true; assert.match(legacyRecipeProblem(source), /adjustable compression/);
  source.operations.lossy = false; assert.equal(legacyRecipeProblem(source), "");
  assert.equal(style.recipe.operations.format, "avif", "a replacement cannot mutate the old copy");
});

test("folder jobs freeze the complete style and preserve relative crop, transforms and local recipe parameters", () => {
  const wrapper = withLegacyStyle(legacyStyleFromRecipe(recipe(), 2));
  const job = createLargeJob({ id: "job", recipe: wrapper }); wrapper.style.recipe.operations.brightness = 3;
  const output = settingsForLargeJob(job.recipe);
  assert.equal(job.recipe.style.revision, 2); assert.deepEqual(job.recipe.style.order, LEGACY_ORDER);
  assert.equal(output.brightness, 1.2); assert.equal(output.rotation, 90); assert.equal(output.flipX, true);
  assert.deepEqual(output.cropRelative, recipe().operations.cropRelative); assert.equal(output.resizeWidth, 24); assert.equal(output.format, "png");
});

test("unknown engine identities remain preserved but cannot execute as the current renderer", () => {
  const style = legacyStyleFromRecipe(recipe()); style.engine.wasmSha256 = "a".repeat(64);
  validateLegacyStyle(style); assert.match(legacyRecipeProblem(withLegacyStyle(style)), /original renderer/);
  assert.throws(() => settingsForLargeJob(withLegacyStyle(style)), /original renderer/);
  style.order.reverse(); assert.throws(() => validateLegacyStyle(style), /execution order/);
});

test("migration rejects malformed executable, oversized and out-of-range data without coercing intent", () => {
  for (const edit of [
    (item) => { item.operations.run = () => {}; },
    (item) => { item.operations.brightness = 999; },
    (item) => { item.operations.flipX = "false"; },
    (item) => { item.operations.cropRelative.width = 4; },
    (item) => { item.operations.quality = 0; },
    (item) => { item.name = ""; },
    (item) => { item.style = { kind: "tiny-image-star/legacy-style", version: 99, future: "preserve" }; },
    (item) => { item.large = Array.from({ length: 10 }, () => "x".repeat(40_000)); },
  ]) { const source = recipe(); edit(source); assert.throws(() => legacyStyleFromRecipe(source)); }
});
