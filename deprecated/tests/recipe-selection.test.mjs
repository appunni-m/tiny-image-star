import assert from "node:assert/strict";
import test from "node:test";
import { legacyStyleFromRecipe, withLegacyStyle } from "../src/styles/legacy.js";
import { recipeByReference, recipeChoices, recipeKey, recipeLabel, restoreRecipeReferences, validateRecipeReferences } from "../src/styles/selection.js";
import { RecipeRecoveryChoice } from "../src/styles/session-recovery.js";
import { HISTORICAL_SESSION_PRESETS } from "../src/styles/session-presets-v1.js";
import { settingsForLargeJob } from "../src/jobs/core.js";

const recipe = (revision, brightness = revision, id = "same-id") => withLegacyStyle(legacyStyleFromRecipe({ id, name: "Same recipe", operations: { brightness, format: "png" } }, revision));
function snapshot() {
  const first = recipe(1), second = recipe(2);
  return { activePresetId: first.id, frozenRecipes: [first, second],
    recipeReferences: { version: 1, active: recipeKey(first), shared: recipeKey(first), items: { a: null, b: recipeKey(second) } },
    batch: { presetId: first.id, files: [{ id: "a", presetOverride: null }, { id: "b", presetOverride: second.id }] } };
}

test("one ID can have independently selected immutable revisions without rebinding to a library update", () => {
  const saved = snapshot(), current = recipe(3), choices = recipeChoices(saved.frozenRecipes, [current]);
  assert.equal(choices.length, 3);
  assert.equal(recipeByReference(choices, current.id, saved.recipeReferences.shared).style.revision, 1);
  assert.equal(recipeByReference(choices, current.id, saved.recipeReferences.items.b).style.revision, 2);
  assert.match(recipeLabel(choices[0], choices), /version 1/);
  assert.equal(validateRecipeReferences(saved), saved.recipeReferences);
});

test("selection identities distinguish separator-bearing IDs and unversioned saved copies", () => {
  const entries = [recipe(1, 1, 'a@2'), recipe(2, 1, 'a'), recipe(1, 1, '["a",2]')];
  entries.push({ ...entries[1].style.recipe });
  assert.equal(new Set(entries.map(recipeKey)).size, 4);
});

test("duplicate identities with different immutable definitions fail instead of picking one", () => {
  assert.throws(() => recipeChoices([recipe(1)], [recipe(1, 2)]), /different recipe definitions/);
  assert.equal(recipeChoices([recipe(1)], [recipe(1)]).length, 1);
});

test("new recovery references reject missing revisions, wrong IDs, extra items and future formats", () => {
  for (const mutate of [
    (s) => { s.frozenRecipes.pop(); },
    (s) => { s.batch.files[1].presetOverride = "other-id"; },
    (s) => { s.recipeReferences.items.extra = null; },
    (s) => { delete s.recipeReferences.items.a; },
    (s) => { s.recipeReferences.shared = null; },
    (s) => { s.recipeReferences.version = 99; },
    (s) => { s.frozenRecipes[1].operations.brightness = 1; },
  ]) {
    const saved = snapshot(); mutate(saved); assert.throws(() => validateRecipeReferences(saved));
    assert.throws(() => restoreRecipeReferences(saved, [recipe(1), recipe(2)]), "a library copy cannot silently repair malformed recovery");
  }
});

test("old ID-only recovery selects its frozen copy before consulting the library and keeps source buffers", () => {
  const old = { id: "same-id", name: "Original name", operations: { format: "png", brightness: .75 } }, bytes = new Uint8Array([1, 2, 3]);
  const saved = { activePresetId: old.id, frozenRecipes: [old], batch: { presetId: old.id, files: [{ id: "a", bytes, presetOverride: null }] } };
  const migrated = restoreRecipeReferences(saved, [recipe(4)]);
  assert.equal(migrated.recipeReferences.shared, recipeKey(old));
  assert.deepEqual(migrated.frozenRecipes, [old]);
  assert.equal(migrated.batch.files[0].bytes, bytes);
  assert.equal(saved.recipeReferences, undefined);
});

test("new snapshots reopen all selected revisions without a library and remain independent of its removal", () => {
  const saved = snapshot(), restored = restoreRecipeReferences(saved, []);
  assert.deepEqual(restored.recipeReferences, saved.recipeReferences);
  restored.frozenRecipes[0].operations.brightness = 0;
  assert.equal(saved.frozenRecipes[0].operations.brightness, 1);
});

function oldest(operations) {
  return { version: 1, activePresetId: "missing-custom", batch: { presetId: "missing-custom", files: [{ id: "a", name: "Photo.png", override: { flipX: true }, presetOverride: null,
    ...(operations ? { resolvedOperations: operations } : {}) }] } };
}
function completeOperations() {
  const operations = structuredClone(HISTORICAL_SESSION_PRESETS[0].operations);
  delete operations.cropRelative;
  return { ...operations, crop: { x: 3, y: 4, width: 18, height: 14 }, resizeWidth: 18, resizeHeight: 14, rotation: 90, brightness: .7, flipX: true };
}

test("oldest custom recipes require a deliberate choice even when a current copy has the same ID", () => {
  const saved = oldest(), before = structuredClone(saved), current = recipe(8, 1.4, "missing-custom");
  assert.throws(() => restoreRecipeReferences(saved, [current]), (error) => error instanceof RecipeRecoveryChoice && error.currentAvailable);
  assert.throws(() => restoreRecipeReferences(saved, []), (error) => error instanceof RecipeRecoveryChoice && !error.currentAvailable);
  assert.deepEqual(saved, before);
  const selected = restoreRecipeReferences(saved, [current], { missingRecipe: "current" });
  assert.equal(selected.recipeReferences.shared, recipeKey(current));
  assert.deepEqual(selected.batch.files[0].override, before.batch.files[0].override);
  assert.throws(() => restoreRecipeReferences(saved, [], { missingRecipe: "current" }), RecipeRecoveryChoice);
  const originals = restoreRecipeReferences(saved, [current], { missingRecipe: "originals" });
  assert.equal(originals.batch.presetId, "keep-original");
  assert.deepEqual(originals.batch.files[0].override, before.batch.files[0].override);
});

test("historical built-ins are resolved from the frozen baseline, independently of current catalog changes", () => {
  const saved = oldest(); saved.activePresetId = saved.batch.presetId = "instagram-square";
  const restored = restoreRecipeReferences(saved, [recipe(10, 3, "instagram-square")]);
  assert.deepEqual(restored.frozenRecipes, [HISTORICAL_SESSION_PRESETS.find((entry) => entry.id === "instagram-square")]);
  restored.frozenRecipes[0].operations.brightness = .2;
  assert.equal(restoreRecipeReferences(saved, []).frozenRecipes[0].operations.brightness, 1, "restoring or editing a copy cannot change the historical catalog");
});

test("complete saved image state preserves absolute edits without inventing the original custom definition", () => {
  const operations = completeOperations(), saved = oldest(operations), bytes = new Uint8Array([1, 2, 3]);
  saved.batch.files[0].bytes = bytes;
  saved.batch.files.push({ id: "b", name: "Other.png", presetOverride: null, override: null, resolvedOperations: { ...operations, crop: null, flipX: false } });
  const migrated = restoreRecipeReferences(saved, [recipe(99, 2, "missing-custom")]);
  const definitions = migrated.frozenRecipes.filter((entry) => entry.recovery);
  assert.equal(definitions.length, 2);
  assert.deepEqual(definitions[0].operations, operations);
  assert.deepEqual(definitions[0].recovery, { version: 1, fileId: "a", sourcePresetId: "missing-custom", originalOverride: { flipX: true } });
  assert.equal(migrated.batch.files[0].bytes, bytes);
  assert.equal(migrated.activePresetId, "keep-original");
  assert.notEqual(migrated.recipeReferences.items.a, migrated.recipeReferences.items.b);
  assert.deepEqual(restoreRecipeReferences(migrated, []).recipeReferences, migrated.recipeReferences);
  assert.throws(() => settingsForLargeJob(definitions[0]), /belong to one image/);
  const wrongSource = structuredClone(migrated);
  wrongSource.recipeReferences.items.b = wrongSource.recipeReferences.items.a;
  wrongSource.batch.files[1].presetOverride = wrongSource.batch.files[0].presetOverride;
  assert.throws(() => validateRecipeReferences(wrongSource), /different image/);
});

test("partial patches never masquerade as complete saved state, and malformed state is not silently replaced", () => {
  assert.throws(() => restoreRecipeReferences(oldest({ flipX: true }), []), RecipeRecoveryChoice);
  assert.throws(() => restoreRecipeReferences(oldest({ ...completeOperations(), futureOperation: true }), []), /unsupported|Unknown|unknown/i);
  const saved = restoreRecipeReferences(oldest(completeOperations()), []);
  saved.frozenRecipes.find((entry) => entry.recovery).recovery.version = 2;
  assert.throws(() => restoreRecipeReferences(saved, []), /different app version/);
  const ambiguous = oldest(); ambiguous.frozenRecipes = [recipe(1, 1, "missing-custom"), recipe(2, 2, "missing-custom")];
  assert.throws(() => restoreRecipeReferences(ambiguous, []), /ambiguous recipe revisions/);
});
