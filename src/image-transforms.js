const transformKeys = new Set(['crop', 'rotation']);

/** Normalize portable image transforms that are applied from the immutable source. */
export function normalizeImageTransforms(transforms = {}) {
  if (!transforms || typeof transforms !== 'object' || Array.isArray(transforms)
    || Object.keys(transforms).some(key => !transformKeys.has(key))) {
    throw new TypeError('Image transforms must contain only crop and rotation settings.');
  }
  const requestedRotation = transforms.rotation ?? 0;
  if (!Number.isInteger(requestedRotation) || requestedRotation % 90 !== 0) {
    throw new RangeError('Image rotation must be a whole number of quarter turns.');
  }
  const rotation = ((requestedRotation % 360) + 360) % 360;
  let crop = null;
  if (transforms.crop != null) {
    const input = transforms.crop;
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['left', 'top', 'right', 'bottom'].includes(key))) {
      throw new TypeError('Image crop must contain normalized left, top, right, and bottom edges.');
    }
    const { left, top, right, bottom } = input;
    if (![left, top, right, bottom].every(Number.isFinite)
      || left < 0 || top < 0 || right > 1 || bottom > 1 || left >= right || top >= bottom) {
      throw new RangeError('Image crop edges must form a non-empty rectangle within the source image.');
    }
    crop = { left, top, right, bottom };
  }
  return { crop, rotation };
}

export function createImageTransforms(transforms = {}) {
  return normalizeImageTransforms(transforms);
}

export function isValidImageTransforms(transforms) {
  try { normalizeImageTransforms(transforms); return true; }
  catch { return false; }
}

export function imageCropPixels(crop, width, height) {
  if (crop == null) return null;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new TypeError('Image source dimensions must be positive integers.');
  }
  return {
    left: Math.floor(crop.left * width),
    top: Math.floor(crop.top * height),
    right: Math.min(width, Math.ceil(crop.right * width)),
    bottom: Math.min(height, Math.ceil(crop.bottom * height))
  };
}
