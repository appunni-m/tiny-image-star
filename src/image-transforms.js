const transformKeys = new Set(['crop', 'rotation', 'flipHorizontal', 'flipVertical']);

/** Normalize portable image transforms that are applied from the immutable source. */
export function normalizeImageTransforms(transforms = {}) {
  if (!transforms || typeof transforms !== 'object' || Array.isArray(transforms)
    || Object.keys(transforms).some(key => !transformKeys.has(key))) {
    throw new TypeError('Image transforms must contain only crop, rotation, and flip settings.');
  }
  const requestedRotation = transforms.rotation ?? 0;
  if (!Number.isInteger(requestedRotation) || requestedRotation % 90 !== 0) {
    throw new RangeError('Image rotation must be a whole number of quarter turns.');
  }
  const rotation = ((requestedRotation % 360) + 360) % 360;
  const flipHorizontal = transforms.flipHorizontal ?? false;
  const flipVertical = transforms.flipVertical ?? false;
  if (typeof flipHorizontal !== 'boolean' || typeof flipVertical !== 'boolean') {
    throw new TypeError('Image flips must be Boolean settings.');
  }
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
  return { crop, rotation, flipHorizontal, flipVertical };
}

export function createImageTransforms(transforms = {}) {
  return normalizeImageTransforms(transforms);
}

/** Rotate the visible image clockwise or counterclockwise without changing its appearance. */
export function rotateImageTransforms(transforms, direction) {
  const current = normalizeImageTransforms(transforms);
  if (direction !== 'left' && direction !== 'right') throw new TypeError('Image rotation direction must be left or right.');
  return normalizeImageTransforms({
    ...current,
    rotation: current.rotation + (direction === 'left' ? -90 : 90),
    // Flips are expressed in the visible image axes after rotation. Rotating
    // the current result by a quarter turn swaps those axes.
    flipHorizontal: current.flipVertical,
    flipVertical: current.flipHorizontal,
  });
}

/** Mirror the visible image on its horizontal or vertical axis. */
export function flipImageTransforms(transforms, axis) {
  const current = normalizeImageTransforms(transforms);
  if (axis !== 'horizontal' && axis !== 'vertical') throw new TypeError('Image flip axis must be horizontal or vertical.');
  const key = axis === 'horizontal' ? 'flipHorizontal' : 'flipVertical';
  return normalizeImageTransforms({ ...current, [key]: !current[key] });
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
