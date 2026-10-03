/** Local ISNet inference and alpha-matte limits for the browser worker. */
export const MAX_BACKGROUND_REMOVAL_PIXELS = 4_194_304;
export const MAX_BACKGROUND_REMOVAL_SOURCE_BYTES = 64 * 1024 * 1024;
export const BACKGROUND_REMOVAL_MODEL_LONG_EDGE = 512;

/** Validate image dimensions before allocating pixels or tensors. */
export function validateBackgroundRemovalDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new TypeError('Background removal needs a valid source image size.');
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels)) throw new RangeError('Background-removal dimensions exceed the safe pixel-count limit.');
  if (pixels > MAX_BACKGROUND_REMOVAL_PIXELS) {
    throw new RangeError(`Local background removal supports images up to ${MAX_BACKGROUND_REMOVAL_PIXELS.toLocaleString()} pixels on this device. Resize the source image, then try again.`);
  }
  return pixels;
}

/** Choose a low-memory, aspect-preserving model input aligned to 32-pixel stages. */
export function backgroundRemovalModelDimensions(width, height, longEdge = BACKGROUND_REMOVAL_MODEL_LONG_EDGE) {
  validateBackgroundRemovalDimensions(width, height);
  if (!Number.isSafeInteger(longEdge) || longEdge < 32 || longEdge > 1024 || longEdge % 32 !== 0) {
    throw new RangeError('The local background-removal model size must be a multiple of 32 from 32 to 1024 pixels.');
  }
  // Keep one model scale for small and large sources. Leaving small inputs at
  // their native size and independently rounding both axes to a 32px stride
  // can badly distort them (for example, 100×50 became 96×64).
  const scale = longEdge / Math.max(width, height);
  const aligned = value => Math.max(32, Math.min(longEdge, Math.round(value * scale / 32) * 32));
  return { width: aligned(width), height: aligned(height) };
}

/** Apply a confidence matte to source alpha without changing source RGB. */
export function applyBackgroundRemovalMatte(sourcePixels, width, height, maskValues, maskWidth, maskHeight) {
  const pixelCount = validateBackgroundRemovalDimensions(width, height);
  if (!(sourcePixels instanceof Uint8ClampedArray) || sourcePixels.length !== pixelCount * 4) {
    throw new TypeError('Background removal needs one RGBA pixel for every source pixel.');
  }
  const maskPixelCount = maskWidth * maskHeight;
  if (!Number.isSafeInteger(maskWidth) || !Number.isSafeInteger(maskHeight)
    || maskWidth < 1 || maskHeight < 1 || !Number.isSafeInteger(maskPixelCount)
    || maskPixelCount > MAX_BACKGROUND_REMOVAL_PIXELS
    || !(maskValues instanceof Float32Array) || maskValues.length !== maskPixelCount) {
    throw new TypeError('The local background-removal model returned an invalid confidence mask.');
  }

  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of maskValues) {
    if (!Number.isFinite(value)) throw new TypeError('The local background-removal model returned a non-finite confidence value.');
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (!Number.isFinite(minimum) || maximum - minimum < 1e-6) {
    throw new Error('The local model could not separate this foreground from its background. Try another image or use Select area.');
  }

  const range = maximum - minimum;
  const scaleX = maskWidth / width;
  const scaleY = maskHeight / height;
  let visiblePixels = 0;
  for (let y = 0; y < height; y += 1) {
    const maskY = Math.max(0, Math.min(maskHeight - 1, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(maskY);
    const y1 = Math.min(maskHeight - 1, y0 + 1);
    const fy = maskY - y0;
    for (let x = 0; x < width; x += 1) {
      const maskX = Math.max(0, Math.min(maskWidth - 1, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(maskX);
      const x1 = Math.min(maskWidth - 1, x0 + 1);
      const fx = maskX - x0;
      const top = maskValues[y0 * maskWidth + x0] * (1 - fx) + maskValues[y0 * maskWidth + x1] * fx;
      const bottom = maskValues[y1 * maskWidth + x0] * (1 - fx) + maskValues[y1 * maskWidth + x1] * fx;
      const confidence = Math.max(0, Math.min(1, ((top * (1 - fy) + bottom * fy) - minimum) / range));
      const alphaIndex = (y * width + x) * 4 + 3;
      sourcePixels[alphaIndex] = Math.round(sourcePixels[alphaIndex] * confidence);
      if (sourcePixels[alphaIndex] > 0) visiblePixels += 1;
    }
  }
  if (!visiblePixels) throw new Error('The local model found no visible foreground. Try Select area to mark the subject manually.');
  return { pixels: sourcePixels, visiblePixels, minimum, maximum };
}
