import { ENGINE_IDENTITY } from "../project/model.js";
import { photoLookAppearance } from "../compositor/photo-look.js";
import { legacyRecipeOperations } from "../styles/legacy.js";

function visualSettings(operations) {
  const appearance = operations.photoLook ? photoLookAppearance(operations.photoLook, ENGINE_IDENTITY) : {};
  const brightness = operations.brightness ?? 1, contrast = operations.contrast ?? 1;
  if (brightness !== 1) appearance.brightness = (appearance.brightness ?? 1) * brightness;
  if (contrast !== 1) appearance.contrast = (appearance.contrast ?? 1) * contrast;
  if (operations.grayscale) appearance.grayscaleMix = 1;
  return appearance;
}

export function designRecipeProblem(recipe) {
  try {
    if (!recipe || recipe.recovery) return "Recovered edits belong to their original image and cannot be reused here.";
    const operations = legacyRecipeOperations(recipe);
    if (operations.flipX || operations.flipY) return "This recipe flips image pixels, which this layer renderer cannot apply yet.";
    if (operations.textLayers?.length) return "This recipe adds text to exported files. Add text as an editable page layer instead.";
    if (operations.crop && operations.cropRelative) return "This recipe contains conflicting crop settings.";
    if (operations.photoLook) visualSettings(operations);
    const hasVisualEdit = Boolean(operations.photoLook || operations.grayscale || operations.crop || operations.cropRelative
      || operations.rotation || operations.brightness != null && operations.brightness !== 1
      || operations.contrast != null && operations.contrast !== 1);
    if (!hasVisualEdit) return "This recipe only changes exported file settings.";
    return "";
  } catch (error) { return error.message || "This recipe is not available in the design workspace."; }
}

/** Map only non-destructive image-layer edits from a saved recipe. */
export function designRecipePatch(node, asset, recipe) {
  const issue = designRecipeProblem(recipe);
  if (issue) throw new Error(issue);
  if (node?.kind !== "image" || !asset || asset.kind !== "image" || node.assetId !== asset.id) throw new Error("Choose an image layer with its original source.");
  const operations = legacyRecipeOperations(recipe), appearance = visualSettings(operations), patch = { appearance };
  const crop = operations.cropRelative ?? (operations.crop ? {
    x: operations.crop.x / asset.width, y: operations.crop.y / asset.height,
    width: operations.crop.width / asset.width, height: operations.crop.height / asset.height,
  } : null);
  if (crop) patch.crop = { ...crop };
  else patch.crop = null;
  if (operations.rotation) patch.rotation = operations.rotation;
  else patch.rotation = null;
  return patch;
}
