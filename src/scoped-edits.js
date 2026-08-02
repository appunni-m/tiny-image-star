import { diffOperationConfig, mergeOperationConfig, OVERRIDE_OPERATION_KEYS } from "./config.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function relativeCrop(crop, width, height) {
  if (!crop) return null;
  return {
    x: crop.x / width,
    y: crop.y / height,
    width: crop.width / width,
    height: crop.height / height,
  };
}

function absoluteCrop(crop, width, height) {
  if (!crop) return null;
  return {
    x: crop.x * width,
    y: crop.y * height,
    width: crop.width * width,
    height: crop.height * height,
  };
}

export function relativeEditPatch(initial, edited, width, height) {
  const patch = diffOperationConfig(initial, edited);
  if (!patch) return null;
  if (Object.prototype.hasOwnProperty.call(patch, "crop")) {
    patch.cropRelative = relativeCrop(patch.crop, width, height);
    delete patch.crop;
  }
  return patch;
}

export function editPatchForTarget(relativePatch, width, height) {
  if (!relativePatch) return null;
  const patch = clone(relativePatch);
  if (Object.prototype.hasOwnProperty.call(patch, "cropRelative")) {
    patch.crop = absoluteCrop(patch.cropRelative, width, height);
    delete patch.cropRelative;
  }
  return patch;
}

export function applyRelativeEditPatch(operations, relativePatch, width, height) {
  return mergeOperationConfig(operations, editPatchForTarget(relativePatch, width, height));
}

export function mergeRelativeSharedEdit({
  baseOperations,
  currentRelativePatch,
  initialOperations,
  editedOperations,
  width,
  height,
}) {
  const changed = relativeEditPatch(initialOperations, editedOperations, width, height);
  if (!changed) return clone(currentRelativePatch);
  const merged = { ...(clone(currentRelativePatch) ?? {}), ...changed };
  const effective = applyRelativeEditPatch(baseOperations, merged, width, height);
  return relativeEditPatch(baseOperations, effective, width, height);
}

export function removeAppliedKeys(patch, relativePatch) {
  if (!patch || !relativePatch) return clone(patch);
  const next = clone(patch);
  for (const key of Object.keys(relativePatch)) {
    const operationKey = key === "cropRelative" ? "crop" : key;
    if (OVERRIDE_OPERATION_KEYS.includes(operationKey)) delete next[operationKey];
  }
  return Object.keys(next).length ? next : null;
}
