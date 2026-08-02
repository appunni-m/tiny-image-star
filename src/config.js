// Shared recipe values and per-image edits are merged deliberately. A batch
// item stores only the values that differ from its selected recipe, so changing
// the recipe later cannot erase a correction made to one image.

export const OVERRIDE_OPERATION_KEYS = Object.freeze([
  "crop",
  "rotation",
  "flipX",
  "flipY",
  "resizeWidth",
  "resizeHeight",
  "resizeMode",
  "aspectLocked",
  "brightness",
  "contrast",
  "grayscale",
  "textLayers",
  "lossy",
  "quality",
  "format",
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function mergeOperationConfig(shared, overridePatch = null) {
  const merged = clone(shared) ?? {};
  if (overridePatch && typeof overridePatch === "object") {
    for (const key of OVERRIDE_OPERATION_KEYS) {
      if (Object.prototype.hasOwnProperty.call(overridePatch, key)) {
        merged[key] = clone(overridePatch[key]);
      }
    }
  }

  // maxWidth/maxHeight are derived values used by the fit path. They must
  // follow an overridden size instead of silently retaining the recipe size.
  if (Number.isFinite(Number(merged.resizeWidth))) merged.maxWidth = merged.resizeWidth;
  if (Number.isFinite(Number(merged.resizeHeight))) merged.maxHeight = merged.resizeHeight;
  return merged;
}

export function diffOperationConfig(shared, effective) {
  const patch = {};
  for (const key of OVERRIDE_OPERATION_KEYS) {
    if (!sameValue(shared?.[key], effective?.[key])) {
      patch[key] = clone(effective?.[key]);
    }
  }
  return Object.keys(patch).length ? patch : null;
}

export function mergeOverridePatch(sharedAtOpen, priorPatch, initialEffective, edited) {
  const mergedPatch = clone(priorPatch) ?? {};
  const localPatch = diffOperationConfig(initialEffective ?? sharedAtOpen, edited);
  if (localPatch) {
    for (const key of OVERRIDE_OPERATION_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(localPatch, key)) continue;
      // Returning a value to the recipe that was active when the canvas was
      // opened removes that local override. Other changed values are retained
      // as the new per-image patch and merge onto the current shared recipe.
      if (sameValue(sharedAtOpen?.[key], edited?.[key])) delete mergedPatch[key];
      else mergedPatch[key] = clone(edited[key]);
    }
  }
  return Object.keys(mergedPatch).length ? mergedPatch : null;
}
