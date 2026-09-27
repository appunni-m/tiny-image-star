import { canonicalJSON, clone, ENGINE_IDENTITY, LEGACY_ORDER, validateData, validateLegacyOperations } from "../project/model.js";
import { normalizeFormat } from "../formats.js";
import { photoLookAppearance } from "../compositor/photo-look.js";

// Private compatibility styles retain the saved crop and text intentionally.
// They belong in the private backup, never in the public parameter-file flow.
export const LEGACY_STYLE_KIND = "tiny-image-star/legacy-style";
export const MAX_LEGACY_STYLE_BYTES = 256 * 1024;
const plain = (value) => value && Object.getPrototypeOf(value) === Object.prototype;
const check = (condition, message) => { if (!condition) throw new Error(message); };
const finite = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const COMPLETE_IMAGE_KEYS = ["crop", "rotation", "flipX", "flipY", "resizeWidth", "resizeHeight", "resizeMode", "aspectLocked", "brightness", "contrast", "grayscale", "textLayers", "lossy", "quality", "format"];
export function isCompleteImageOperations(operations) {
  return plain(operations) && COMPLETE_IMAGE_KEYS.every((key) => Object.hasOwn(operations, key));
}

export function originalRecipe(recipe) {
  const original = clone(recipe);
  if (original.style?.kind === LEGACY_STYLE_KIND && original.style.version === 1) {
    try { validateLegacyStyle(original.style); delete original.style; }
    catch { /* Preserve unknown/corrupt nested data for the migration fence. */ }
  }
  return original;
}

export function validateLegacyRecipe(recipe) {
  validateData(recipe);
  check(plain(recipe) && typeof recipe.id === "string" && recipe.id.length > 0 && recipe.id.length <= 512
    && !["__proto__", "constructor", "prototype"].includes(recipe.id), "This saved recipe has an invalid identity. Its original is preserved.");
  check(typeof recipe.name === "string" && recipe.name.trim().length > 0 && recipe.name.length <= 512, "This saved recipe has an invalid name. Its original is preserved.");
  check(!Object.hasOwn(recipe, "style"), "A migrated definition cannot contain another style.");
  const operations = recipe.operations;
  validateLegacyOperations(operations);
  if (Object.hasOwn(recipe, "recovery")) {
    const recovery = recipe.recovery;
    check(plain(recovery) && recovery.version === 1 && Object.keys(recovery).every((key) => ["version", "fileId", "sourcePresetId", "originalOverride"].includes(key))
      && ["sourcePresetId", "originalOverride"].every((key) => Object.hasOwn(recovery, key))
      && typeof recovery.fileId === "string" && recovery.fileId.length > 0 && recovery.fileId.length <= 512
      && (recovery.sourcePresetId === null || typeof recovery.sourcePresetId === "string" && recovery.sourcePresetId.length <= 512), "These recovered image settings need a different app version.");
    check(isCompleteImageOperations(operations) && operations.cropRelative == null, "These recovered image settings are incomplete. The original recovery copy is preserved.");
    if (recovery.originalOverride != null) validateLegacyOperations(recovery.originalOverride);
  }
  for (const key of ["flipX", "flipY", "aspectLocked", "grayscale", "lossy"]) if (operations[key] != null) check(typeof operations[key] === "boolean", `Invalid saved ${key} setting.`);
  if (operations.resizeMode != null) check(["fit", "crop"].includes(operations.resizeMode), "This saved resize mode needs a different app version.");
  if (operations.quality != null) check(finite(operations.quality, 1, 100), "Invalid saved output quality.");
  if (operations.format != null) check(typeof operations.format === "string" && operations.format.length > 0 && operations.format.length <= 64, "Invalid saved output format.");
  if (operations.cropRelative != null) {
    const crop = operations.cropRelative;
    check(plain(crop) && Object.keys(crop).every((key) => ["x", "y", "width", "height"].includes(key))
      && ["x", "y", "width", "height"].every((key) => finite(crop[key], 0, 1)) && crop.width > 0 && crop.height > 0
      && crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001, "Invalid saved relative crop.");
  }
  if (operations.jpegBackground != null) check(typeof operations.jpegBackground === "string" && /^#[0-9a-f]{6}$/i.test(operations.jpegBackground), "Invalid saved JPEG background.");
  return recipe;
}

export function legacyStyleFromRecipe(recipe, revision = 1, category = "recipe") {
  const original = originalRecipe(recipe);
  return validateLegacyStyle({ kind: LEGACY_STYLE_KIND, version: 1, id: original.id, name: original.name, revision,
    category, engine: clone(ENGINE_IDENTITY), execution: "per-image", order: [...LEGACY_ORDER], recipe: original });
}

export function validateLegacyStyle(style) {
  validateData(style);
  check(new TextEncoder().encode(JSON.stringify(style)).byteLength <= MAX_LEGACY_STYLE_BYTES, "This saved recipe is too large to migrate. Its original is preserved in the private backup.");
  check(plain(style) && style.kind === LEGACY_STYLE_KIND && style.version === 1
    && Object.keys(style).every((key) => ["kind", "version", "id", "name", "revision", "category", "engine", "execution", "order", "recipe"].includes(key)), "This saved recipe needs a different app version.");
  validateLegacyRecipe(style.recipe);
  check(style.id === style.recipe.id && style.name === style.recipe.name && Number.isSafeInteger(style.revision) && style.revision >= 1 && style.revision <= 1_000_000, "Invalid saved recipe revision.");
  check(["recipe", "output"].includes(style.category) && style.execution === "per-image"
    && canonicalJSON(style.order) === canonicalJSON(LEGACY_ORDER), "This saved recipe has an unsupported execution order.");
  check(plain(style.engine) && Object.keys(style.engine).length === Object.keys(ENGINE_IDENTITY).length
    && Object.keys(ENGINE_IDENTITY).every((key) => typeof style.engine[key] === "string" && style.engine[key].length > 0 && style.engine[key].length <= 128), "Invalid saved recipe engine identity.");
  return style;
}

export function legacyRecipeOperations(recipe) {
  return clone(recipe.style ? validateLegacyStyle(recipe.style).recipe.operations : recipe.operations);
}

export function legacyRecipeProblem(recipe, capabilities = { outputFormats: ["png", "jpeg"], compression: { quality: false } }, formatOverride = null) {
  try {
    const source = recipe.style ? validateLegacyStyle(recipe.style).recipe : validateLegacyRecipe(originalRecipe(recipe));
    if (recipe.style && canonicalJSON(recipe.style.engine) !== canonicalJSON(ENGINE_IDENTITY)) return "This saved recipe needs its original renderer. Choose a current recipe instead.";
    const operations = source.operations, format = normalizeFormat(formatOverride ?? operations.format ?? "png");
    if (operations.photoLook) photoLookAppearance(operations.photoLook, ENGINE_IDENTITY);
    if (!format || !capabilities.outputFormats.includes(format)) return `Saved ${operations.format ?? "PNG"} output is unavailable. Choose a supported replacement below.`;
    if (operations.lossy && !capabilities.compression?.quality) return "This recipe requests adjustable compression. Choose a supported fixed-setting output below.";
    return "";
  } catch (error) { return error.message; }
}

export function withLegacyStyle(style) {
  validateLegacyStyle(style);
  return { ...clone(style.recipe), style: clone(style) };
}
