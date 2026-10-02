/** Mobile memory and interaction limits for local MagicTouch object isolation. */
export const MAX_OBJECT_ISOLATION_SOURCE_PIXELS = 4_194_304;
export const MAX_OBJECT_ISOLATION_STROKES = 128;
export const MAX_OBJECT_ISOLATION_POINTS = 8192;
export const OBJECT_ISOLATION_BRUSH_MODE = Object.freeze({ POSITIVE: 1, NEGATIVE: 2, LASSO: 3 });

const allowedBrushModes = new Set(Object.values(OBJECT_ISOLATION_BRUSH_MODE));

/** Validate source dimensions before decode allocations or model inference. */
export function validateObjectIsolationDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new TypeError('Object isolation needs a valid source image size.');
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels)) throw new RangeError('Object isolation image dimensions exceed the safe pixel-count limit.');
  if (pixels > MAX_OBJECT_ISOLATION_SOURCE_PIXELS) {
    throw new RangeError(`Object isolation supports images up to ${MAX_OBJECT_ISOLATION_SOURCE_PIXELS.toLocaleString()} pixels on this device. Use a smaller image, then try again.`);
  }
  return pixels;
}

/** Normalize completed positive, negative, and lasso strokes for MediaPipe. */
export function normalizeObjectIsolationStrokes(strokes) {
  if (!Array.isArray(strokes) || strokes.length < 1 || strokes.length > MAX_OBJECT_ISOLATION_STROKES) {
    throw new TypeError('Draw at least one isolation stroke and keep the selection within the stroke limit.');
  }
  let pointCount = 0;
  return strokes.map(stroke => {
    if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)
      || !allowedBrushModes.has(stroke.brushMode) || stroke.isCompleted !== true
      || !Array.isArray(stroke.point) || !stroke.point.length
      || (stroke.brushMode === OBJECT_ISOLATION_BRUSH_MODE.LASSO && stroke.point.length < 3)) {
      throw new TypeError('An object-isolation stroke is malformed or incomplete.');
    }
    pointCount += stroke.point.length;
    if (pointCount > MAX_OBJECT_ISOLATION_POINTS) {
      throw new RangeError(`Object isolation is limited to ${MAX_OBJECT_ISOLATION_POINTS.toLocaleString()} points per image.`);
    }
    return {
      brushMode: stroke.brushMode,
      isCompleted: true,
      point: stroke.point.map(point => {
        if (!point || typeof point !== 'object' || Array.isArray(point)
          || !Number.isFinite(point.x) || !Number.isFinite(point.y)
          || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
          throw new TypeError('Object-isolation points must be normalized within the source image.');
        }
        return { x: point.x, y: point.y };
      })
    };
  });
}

/**
 * Apply MediaPipe's confidence mask to decoded source pixels without changing RGB.
 * The caller owns this decoded buffer, so only its alpha channel is modified;
 * the source file bytes and the editor's source asset stay untouched.
 */
export function applyObjectIsolationMaskToRgba(sourcePixels, width, height, maskValues, maskWidth, maskHeight) {
  const pixelCount = validateObjectIsolationDimensions(width, height);
  if (!(sourcePixels instanceof Uint8ClampedArray) || sourcePixels.length !== pixelCount * 4) {
    throw new TypeError('Object isolation needs one RGBA pixel for every source pixel.');
  }
  const maskPixelCount = maskWidth * maskHeight;
  if (!Number.isSafeInteger(maskWidth) || !Number.isSafeInteger(maskHeight) || maskWidth < 1 || maskHeight < 1
    || !Number.isSafeInteger(maskPixelCount) || maskPixelCount > MAX_OBJECT_ISOLATION_SOURCE_PIXELS
    || !ArrayBuffer.isView(maskValues) || maskValues.length !== maskPixelCount
    || !(maskValues instanceof Float32Array || maskValues instanceof Uint8Array || maskValues instanceof Uint8ClampedArray)) {
    throw new TypeError('The local object-isolation model returned an invalid confidence mask.');
  }
  if (maskValues instanceof Float32Array && maskValues.some(value => !Number.isFinite(value))) {
    throw new TypeError('The local object-isolation model returned a non-finite confidence value.');
  }

  let selectedPixels = 0;
  const scaleX = maskWidth / width;
  const scaleY = maskHeight / height;
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
      const top = Number(maskValues[y0 * maskWidth + x0]) * (1 - fx)
        + Number(maskValues[y0 * maskWidth + x1]) * fx;
      const bottom = Number(maskValues[y1 * maskWidth + x0]) * (1 - fx)
        + Number(maskValues[y1 * maskWidth + x1]) * fx;
      // MediaPipe confidence masks use float values in [0, 1]. Uint8 masks are
      // accepted for adapter testing and are interpreted using their full range.
      const rawConfidence = top * (1 - fy) + bottom * fy;
      const confidence = maskValues instanceof Float32Array ? rawConfidence : rawConfidence / 255;
      const index = (y * width + x) * 4 + 3;
      sourcePixels[index] = Math.round(sourcePixels[index] * Math.max(0, Math.min(1, confidence)));
      if (sourcePixels[index] > 0) selectedPixels += 1;
    }
  }
  if (!selectedPixels) throw new Error('The selection did not contain any visible pixels. Add a positive stroke and try again.');
  return { pixels: sourcePixels, selectedPixels };
}
