import { clone, validateLegacyOperations } from "../project/model.js";
import { isCompleteImageOperations, validateLegacyRecipe, originalRecipe } from "./legacy.js";
import { HISTORICAL_SESSION_PRESETS } from "./session-presets-v1.js";

export function hasCompleteSavedOperations(file) {
  return isCompleteImageOperations(file.resolvedOperations);
}

export class RecipeRecoveryChoice extends Error {
  constructor(ids, currentAvailable) {
    super("This older session did not save its original recipe definitions. Some edits cannot be reconstructed exactly. You can use today's recipes, or restore the originals with the saved corrections. The old recovery copy stays available in Local data.");
    this.name = "RecipeRecoveryChoice";
    this.ids = ids;
    this.currentAvailable = currentAvailable;
  }
}

/** Complete saved image state is private and belongs to its source image. */
export function recoveredRecipeForFile(file, sourcePresetId) {
  validateLegacyOperations(file.resolvedOperations);
  const recipe = {
    id: `recovered-${crypto.randomUUID()}`,
    name: `Recovered edits: ${String(file.name ?? "image").slice(0, 470)}`,
    operations: clone(file.resolvedOperations),
    recovery: { version: 1, fileId: file.id, sourcePresetId: sourcePresetId ?? null, originalOverride: clone(file.override ?? null) },
  };
  validateLegacyRecipe(recipe);
  return recipe;
}

/** Never infer an old custom definition from the current mutable library. */
export function resolveHistoricalRecipes(snapshot, library, { missingRecipe } = {}) {
  const frozen = snapshot.frozenRecipes ?? [];
  if (!Array.isArray(frozen) || frozen.length > 100) throw new Error("Invalid saved recipe definitions.");
  if (new Set(frozen.map((recipe) => recipe.id)).size !== frozen.length) throw new Error("This older session contains ambiguous recipe revisions. Its original recovery copy is preserved.");
  for (const recipe of frozen) validateLegacyRecipe(originalRecipe(recipe));
  const known = (id) => frozen.find((recipe) => recipe.id === id) ?? HISTORICAL_SESSION_PRESETS.find((recipe) => recipe.id === id);
  const neutral = known("keep-original");
  const missing = [...new Set(snapshot.batch.files.map((file) => file.presetOverride ?? snapshot.batch.presetId ?? snapshot.activePresetId ?? "keep-original")
    .filter((id, index) => !known(id) && !hasCompleteSavedOperations(snapshot.batch.files[index])))];
  if (missing.length && !["current", "originals"].includes(missingRecipe)) {
    throw new RecipeRecoveryChoice(missing, missing.every((id) => library.some((recipe) => recipe.id === id)));
  }
  const choose = (id) => {
    const recipe = known(id);
    if (recipe) return recipe;
    if (missingRecipe === "current" && missing.includes(id)) {
      const current = library.find((entry) => entry.id === id);
      if (!current) throw new RecipeRecoveryChoice(missing, false);
      validateLegacyRecipe(originalRecipe(current));
      return current;
    }
    return null;
  };
  const active = choose(snapshot.activePresetId) ?? neutral;
  const shared = choose(snapshot.batch.presetId ?? snapshot.activePresetId) ?? neutral;
  const items = snapshot.batch.files.map((file) => {
    const id = file.presetOverride ?? snapshot.batch.presetId ?? snapshot.activePresetId ?? "keep-original";
    return frozen.find((recipe) => recipe.id === id) ?? (hasCompleteSavedOperations(file) ? recoveredRecipeForFile(file, id) : choose(id) ?? neutral);
  });
  return { active, shared, items };
}
