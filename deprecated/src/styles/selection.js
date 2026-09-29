import { canonicalJSON, clone, validateData } from "../project/model.js";
import { originalRecipe, validateLegacyRecipe, validateLegacyStyle } from "./legacy.js";
import { resolveHistoricalRecipes } from "./session-recovery.js";
import { validatePhotoLook } from "../compositor/photo-look.js";

/** An unambiguous selection identity; IDs may themselves contain separators. */
export function recipeKey(recipe) { return JSON.stringify([recipe.id, recipe.style?.revision ?? null]); }

export function recipeChoices(frozen, library = []) {
  const choices = new Map();
  for (const recipe of [...frozen, ...library]) {
    const key = recipeKey(recipe), prior = choices.get(key);
    if (prior && canonicalJSON(prior.style ?? originalRecipe(prior)) !== canonicalJSON(recipe.style ?? originalRecipe(recipe))) {
      throw new Error("Two different recipe definitions claim the same revision. Their saved copies need review.");
    }
    if (!prior) choices.set(key, recipe);
  }
  return [...choices.values()];
}

export function recipeLabel(recipe, choices = []) {
  if (recipe.recovery) return recipe.name;
  const showVersion = !recipe.builtIn || choices.filter((entry) => entry.id === recipe.id).length > 1;
  return `${recipe.name}${showVersion ? recipe.style ? ` · version ${recipe.style.revision}` : " · saved copy" : ""}`;
}

export function recipeByReference(choices, id, key = null) {
  const recipe = key == null ? choices.find((entry) => entry.id === id) : choices.find((entry) => recipeKey(entry) === key && entry.id === id);
  if (!recipe) throw new Error("A saved recipe revision is missing. Its recovery data has been preserved; use Local data to back it up.");
  return recipe;
}

/** References are private recovery metadata; every definition travels with them. */
export function validateRecipeReferences(snapshot) {
  const references = snapshot.recipeReferences;
  if (!references || references.version !== 1 || Object.keys(references).some((key) => !["version", "active", "shared", "items"].includes(key))) {
    throw new Error("These saved recipe references need a different app version. Their recovery data has been preserved.");
  }
  validateData(references);
  if (!Array.isArray(snapshot.frozenRecipes) || snapshot.frozenRecipes.length > 100) throw new Error("Invalid saved recipe definitions.");
  for (const recipe of snapshot.frozenRecipes) {
    validateLegacyRecipe(originalRecipe(recipe));
    if (recipe.style) {
      validateLegacyStyle(recipe.style);
      if (recipe.id !== recipe.style.id || canonicalJSON(originalRecipe(recipe)) !== canonicalJSON(recipe.style.recipe)) throw new Error("A saved recipe wrapper disagrees with its immutable definition.");
    }
  }
  const definitions = recipeChoices(snapshot.frozenRecipes);
  if (definitions.length !== snapshot.frozenRecipes.length) throw new Error("Duplicate saved recipe definitions.");
  recipeByReference(definitions, snapshot.activePresetId, references.active);
  recipeByReference(definitions, snapshot.batch.presetId, references.shared);
  if ([references.active, references.shared].some((key) => definitions.find((recipe) => recipeKey(recipe) === key)?.recovery)) throw new Error("Recovered image settings cannot become a shared recipe.");
  if (typeof references.active !== "string" || typeof references.shared !== "string" || !references.items || Array.isArray(references.items)) throw new Error("Missing saved recipe selection.");
  const files = snapshot.batch.files;
  if (snapshot.batch.sharedOverride?.photoLook != null) validatePhotoLook(snapshot.batch.sharedOverride.photoLook);
  if (Object.keys(references.items).length !== files.length || new Set(files.map((file) => file.id)).size !== files.length) throw new Error("Saved image selections do not match their files.");
  for (const file of files) {
    if (file.override?.photoLook != null) validatePhotoLook(file.override.photoLook);
    const key = references.items[file.id];
    if (file.presetOverride == null ? key !== null : typeof key !== "string") throw new Error("Missing per-image recipe revision.");
    if (key !== null) {
      const recipe = recipeByReference(definitions, file.presetOverride, key);
      if (recipe.recovery && recipe.recovery.fileId !== file.id) throw new Error("Recovered edits belong to a different image. The saved copy is preserved.");
    }
  }
  return references;
}

/** Resolve old ID-only snapshots once; new snapshots never consult the library. */
export function restoreRecipeReferences(snapshot, library, options) {
  // Reuse immutable source buffers; restoring metadata must not double the
  // image set's source-byte budget.
  const restored = { ...snapshot, batch: { ...snapshot.batch, files: snapshot.batch.files.map((file) => ({ ...file })) },
    frozenRecipes: clone(snapshot.frozenRecipes ?? []) };
  if (snapshot.recipeReferences) { validateRecipeReferences(snapshot); restored.recipeReferences = clone(snapshot.recipeReferences); return restored; }
  recipeChoices(restored.frozenRecipes); // Reject conflicting definitions before any recovery choice.
  const { active, shared, items: resolvedItems } = resolveHistoricalRecipes(restored, library, options);
  restored.activePresetId = active.id; restored.batch.presetId = shared.id;
  const used = [active, shared];
  const items = Object.fromEntries(restored.batch.files.map((file, index) => {
    const recipe = resolvedItems[index];
    used.push(recipe);
    file.presetOverride = recipeKey(recipe) === recipeKey(shared) ? null : recipe.id;
    return [file.id, file.presetOverride ? recipeKey(recipe) : null];
  }));
  restored.frozenRecipes = clone(recipeChoices(used));
  restored.recipeReferences = { version: 1, active: recipeKey(active), shared: recipeKey(shared), items };
  validateRecipeReferences(restored); return restored;
}
