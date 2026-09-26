import { clone } from "../project/model.js";
import { withLegacyStyle } from "./legacy.js";
import { putLegacyRecipe } from "./store.js";

/** The caller owns the old records; migration never edits or deletes them. */
export async function migrateLegacyRecipes(recipes, { signal } = {}) {
  const frozen = clone(recipes), migrated = [], issues = [];
  for (const recipe of frozen) {
    if (signal?.aborted) throw new DOMException("Recipe migration was cancelled.", "AbortError");
    try { migrated.push(withLegacyStyle((await putLegacyRecipe(recipe, { signal })).style)); }
    catch (error) {
      if (error.name === "AbortError") throw error;
      migrated.push(recipe);
      issues.push(`${recipe.name ?? "Saved recipe"}: ${error.message}`);
    }
  }
  return { recipes: migrated, issues };
}
