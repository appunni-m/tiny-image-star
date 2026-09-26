import test from "node:test";
import assert from "node:assert/strict";
import { curatedStyles } from "../src/styles/model.js";
import { photoLookFromStyle, photoLookProblem, recipeWithPhotoLook } from "../src/styles/photo-look.js";
import { photoLookAppearance, validatePhotoLook } from "../src/compositor/photo-look.js";
import { applyPhotoLookEdit, undoPhotoLookEdit } from "../src/styles/photo-look-edits.js";
import { ENGINE_IDENTITY, validateLegacyOperations } from "../src/project/model.js";
import { PRESETS } from "../src/presets.js";
import { settingsForLargeJob } from "../src/jobs/core.js";
import { imageWork, workClass } from "../src/processing/policy.js";
import { restoreRecipeReferences } from "../src/styles/selection.js";

const film = () => photoLookFromStyle(curatedStyles()[1]);
test("photo colors are frozen independently of story layout, typography and output", () => {
  const style = curatedStyles()[1], binding = photoLookFromStyle(style, .5);
  assert.equal(binding.definition.id, style.id); assert.equal(binding.definition.revision, style.revision);
  assert.deepEqual(Object.keys(binding.definition).sort(), ["appearance", "engine", "id", "name", "revision"]);
  style.components.look.appearance.contrast = 2;
  assert.equal(binding.definition.appearance.contrast, .9);
  assert.equal(photoLookAppearance(binding, ENGINE_IDENTITY).contrast, .95);
  binding.strength = 0;
  assert.deepEqual(photoLookAppearance(binding, ENGINE_IDENTITY), { brightness: 1, contrast: 1, saturation: 1 });
});
test("malformed, out-of-range and unsupported photo looks fail before rendering", () => {
  for (const mutate of [(look) => { look.version = 99; }, (look) => { look.strength = -1; }, (look) => { look.definition.appearance.saturation = Infinity; },
    (look) => { look.definition.script = "run()"; }, (look) => { look.definition.appearance.remote = "https://example.test/photo"; }]) {
    const look = film(); mutate(look); assert.throws(() => validatePhotoLook(look)); assert.throws(() => validateLegacyOperations({ photoLook: look }));
  }
  const look = film(); look.definition.engine.versions = ["unsupported"];
  assert.throws(() => photoLookAppearance(look, ENGINE_IDENTITY), /different renderer/);
  const style = curatedStyles()[1]; style.requires.push("future-cutout");
  assert.match(photoLookProblem(style), /Unavailable requirement/);
});
test("all/selected/this look application and undo preserve unrelated manual corrections", () => {
  const crop = { x: 2, y: 4, width: 50, height: 20 };
  const batch = { files: [{ id: "a", override: { crop, flipX: true } }, { id: "b", override: { brightness: 1.2 } }], selected: new Set(["b"]), activeId: "a", sharedOverride: { rotation: 90 } };
  const all = applyPhotoLookEdit(batch, film(), "all");
  assert.deepEqual(batch.files[0].override, { crop, flipX: true }); assert.equal(batch.sharedOverride.rotation, 90);
  const selected = applyPhotoLookEdit(batch, null, "selected"); assert.equal(batch.files[1].override.photoLook, null); assert.equal(batch.files[0].override.photoLook, undefined);
  const one = applyPhotoLookEdit(batch, photoLookFromStyle(curatedStyles()[0]), "this");
  batch.files[0].override.rotation = 270;
  undoPhotoLookEdit(batch, one); undoPhotoLookEdit(batch, selected); undoPhotoLookEdit(batch, all);
  assert.deepEqual(batch.sharedOverride, { rotation: 90 }); assert.deepEqual(batch.files[0].override, { crop, flipX: true, rotation: 270 });
  assert.deepEqual(batch.files[1].override, { brightness: 1.2 });
});
test("a stale look undo cannot overwrite a later look and empty selections do not mutate", () => {
  const batch = { files: [{ id: "a", override: null }], selected: new Set(), activeId: "a", sharedOverride: null };
  assert.throws(() => applyPhotoLookEdit(batch, film(), "selected"), /at least one/); assert.equal(batch.sharedOverride, null);
  const change = applyPhotoLookEdit(batch, film(), "all"); applyPhotoLookEdit(batch, null, "all");
  assert.throws(() => undoPhotoLookEdit(batch, change), /changed after/);
});
test("folder recipes copy the chosen look and its base output recipe without following library updates", () => {
  const original = structuredClone(PRESETS[1]), look = film(), recipe = recipeWithPhotoLook(original, look);
  original.operations.resizeWidth = 8; look.definition.appearance.contrast = 2;
  const settings = settingsForLargeJob(recipe);
  assert.equal(settings.resizeWidth, 1080); assert.equal(settings.photoLook.definition.appearance.contrast, .9);
  assert.equal(recipe.style.recipe.operations.photoLook.definition.id, "builtin:film-diary");
  const cleared = recipeWithPhotoLook(recipe, null);
  assert.equal(settingsForLargeJob(cleared).photoLook, undefined); assert.equal(cleared.photoLookSource.photoLookSource, undefined);
  assert.equal(settingsForLargeJob(cleared).resizeWidth, 1080);
});
test("look and downsampled output previews reserve their additional memory and have distinct timing classes", () => {
  const input = { width: 3000, height: 2000, encodedBytes: 2_000_000, settings: { brightness: 1, contrast: 1, format: "png" } };
  const base = imageWork(input), styledInput = { ...input, settings: { ...input.settings, photoLook: film() } }, styled = imageWork(styledInput), preview = imageWork({ ...styledInput, imagePreview: true });
  assert.ok(styled.heap > base.heap); assert.ok(preview.heap > styled.heap);
  assert.notEqual(workClass(input), workClass(styledInput)); assert.notEqual(workClass(styledInput), workClass({ ...styledInput, imagePreview: true }));
});

test("recovery rejects future shared and per-image look metadata before restoring the set", () => {
  const before = restoreRecipeReferences({ activePresetId: "keep-original", frozenRecipes: [structuredClone(PRESETS[0])],
    batch: { presetId: "keep-original", files: [{ id: "a", presetOverride: null, override: null }] } }, []);
  before.batch.sharedOverride = { photoLook: film() };
  assert.equal(restoreRecipeReferences(before, []).batch.sharedOverride.photoLook.definition.id, "builtin:film-diary");
  for (const shared of [true, false]) {
    const record = structuredClone(before), look = film(); look.version = 2;
    if (shared) record.batch.sharedOverride.photoLook = look; else record.batch.files[0].override = { photoLook: look };
    assert.throws(() => restoreRecipeReferences(record, []), /different app version/);
  }
});
