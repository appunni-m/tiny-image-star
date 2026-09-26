import { clone, ENGINE_IDENTITY } from "../project/model.js";
import { styleCompatibility, validateStyle } from "./model.js";
import { photoLookAppearance, validatePhotoLook } from "../compositor/photo-look.js";
import { legacyRecipeOperations, legacyStyleFromRecipe, withLegacyStyle } from "./legacy.js";

export function photoLookProblem(style) {
  try {
    validateStyle(style);
    const problem = styleCompatibility(style, null);
    if (problem) return problem;
    if (!style.components.look) return "This style has no photo-color settings. Choose a style with a Look component.";
    return "";
  } catch (error) { return error.message; }
}

export function photoLookFromStyle(style, strength = 1) {
  const problem = photoLookProblem(style); if (problem) throw new Error(problem);
  const binding = validatePhotoLook({ version: 1, definition: { id: style.id, revision: style.revision, name: style.name,
    engine: clone(style.engine), appearance: clone(style.components.look.appearance) }, strength });
  photoLookAppearance(binding, ENGINE_IDENTITY);
  return binding;
}

export function recipeWithPhotoLook(recipe, look) {
  if (look) photoLookAppearance(look, ENGINE_IDENTITY);
  const source = clone(recipe.photoLookSource ?? recipe);
  const operations = legacyRecipeOperations(source);
  operations.photoLook = clone(look);
  return withLegacyStyle(legacyStyleFromRecipe({ id: `photo-look-recipe-${crypto.randomUUID()}`,
    name: `${source.name.slice(0, 400)} · ${look?.definition.name ?? "No photo look"}`, operations, photoLookSource: source }));
}
