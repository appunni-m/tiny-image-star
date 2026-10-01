/** Keep one mobile inpaint request inside a conservative transient-pixel bound. */
export const MAX_INPAINT_SOURCE_PIXELS = 4_194_304;
export const MAX_INPAINT_STROKES = 256;
export const MAX_INPAINT_POINTS = 8192;
export const MAX_INPAINT_RASTER_STEPS = 64_000_000;
const MAX_NORMALIZED_BRUSH_RADIUS = 0.25;

/** Normalize portable source-relative brush strokes for saved image edits and recipes. */
export function normalizeImageEraseStrokes(strokes) {
  if (!Array.isArray(strokes) || strokes.length > MAX_INPAINT_STROKES) {
    throw new TypeError('Saved object-erase strokes must be a list within the stroke limit.');
  }
  let pointCount = 0;
  return strokes.map(stroke => {
    if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)
      || !Number.isFinite(stroke.radius) || stroke.radius <= 0 || stroke.radius > MAX_NORMALIZED_BRUSH_RADIUS
      || !Array.isArray(stroke.points) || stroke.points.length < 1) {
      throw new TypeError('A saved object-erase stroke is malformed.');
    }
    pointCount += stroke.points.length;
    if (pointCount > MAX_INPAINT_POINTS) throw new RangeError('Saved object-erase strokes contain too many points.');
    return {
      radius: stroke.radius,
      points: stroke.points.map(point => {
        if (!point || typeof point !== 'object' || Array.isArray(point)
          || !Number.isFinite(point.x) || !Number.isFinite(point.y)
          || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
          throw new TypeError('A saved object-erase point must be normalized within the source image.');
        }
        return { x: point.x, y: point.y };
      })
    };
  });
}

/** Resolve a portable recipe's normalized strokes to pixels for one target image. */
export function resolveImageEraseStrokes(strokes, width, height) {
  validateInpaintDimensions(width, height);
  const normalized = normalizeImageEraseStrokes(strokes);
  const minimumEdge = Math.min(width, height);
  return normalized.map(stroke => ({
    radius: Math.max(1, stroke.radius * minimumEdge),
    points: stroke.points.map(point => ({ x: point.x * width, y: point.y * height })),
  }));
}

export function isValidImageEraseStrokes(strokes) {
  try { normalizeImageEraseStrokes(strokes); return true; }
  catch { return false; }
}

export function validateInpaintDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new TypeError('Object erase needs a valid image size.');
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels)) throw new RangeError('Object erase image dimensions exceed the safe pixel-count limit.');
  if (pixels > MAX_INPAINT_SOURCE_PIXELS) {
    throw new RangeError(`Object erase currently supports source images up to ${MAX_INPAINT_SOURCE_PIXELS.toLocaleString()} pixels. Import a smaller source image, then try again.`);
  }
  return pixels;
}

export function normalizeInpaintStrokes(strokes, width, height) {
  validateInpaintDimensions(width, height);
  if (!Array.isArray(strokes) || strokes.length < 1 || strokes.length > MAX_INPAINT_STROKES) {
    throw new TypeError('Draw at least one erase stroke and keep the selection within the stroke limit.');
  }
  let pointCount = 0;
  return strokes.map(stroke => {
    if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)
      || !Number.isFinite(stroke.radius) || stroke.radius < 1 || stroke.radius > Math.max(width, height) / 4
      || !Array.isArray(stroke.points) || stroke.points.length < 1) {
      throw new TypeError('An erase stroke is malformed.');
    }
    pointCount += stroke.points.length;
    if (pointCount > MAX_INPAINT_POINTS) throw new RangeError('This erase selection has too many points. Undo a stroke or apply the erase, then continue.');
    return {
      radius: stroke.radius,
      points: stroke.points.map(point => {
        if (!point || typeof point !== 'object' || Array.isArray(point)
          || !Number.isFinite(point.x) || !Number.isFinite(point.y)
          || point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
          throw new TypeError('An erase stroke point is outside the image.');
        }
        return { x: point.x, y: point.y };
      })
    };
  });
}

function paintSegment(mask, width, height, from, to, radius) {
  const radiusSquared = radius * radius;
  const minX = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + radius));
  const minY = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + radius));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const segmentLengthSquared = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y += 1) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const projection = segmentLengthSquared
        ? Math.max(0, Math.min(1, ((px - from.x) * dx + (py - from.y) * dy) / segmentLengthSquared))
        : 0;
      const nearestX = from.x + projection * dx;
      const nearestY = from.y + projection * dy;
      const diffX = px - nearestX;
      const diffY = py - nearestY;
      if (diffX * diffX + diffY * diffY <= radiusSquared) mask[y * width + x] = 0;
    }
  }
}

function segmentRasterWork(width, height, from, to, radius) {
  const minX = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + radius));
  const minY = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + radius));
  return maxX < minX || maxY < minY ? 0 : (maxX - minX + 1) * (maxY - minY + 1);
}

/** Rasterize brush strokes to MI-GAN's mask convention: 0 erases, 255 keeps. */
export function rasterizeInpaintMask(width, height, strokes) {
  const pixels = validateInpaintDimensions(width, height);
  const normalizedStrokes = normalizeInpaintStrokes(strokes, width, height);
  let rasterSteps = 0;
  for (const stroke of normalizedStrokes) {
    const points = stroke.points.length === 1 ? [stroke.points[0], stroke.points[0]] : stroke.points;
    for (let index = 1; index < points.length; index += 1) {
      rasterSteps += segmentRasterWork(width, height, points[index - 1], points[index], stroke.radius);
      if (rasterSteps > MAX_INPAINT_RASTER_STEPS) {
        throw new RangeError('This erase selection is too detailed for safe local processing. Use a smaller brush or split it into shorter strokes.');
      }
    }
  }
  const mask = new Uint8Array(pixels);
  mask.fill(255);
  for (const stroke of normalizedStrokes) {
    if (stroke.points.length === 1) {
      paintSegment(mask, width, height, stroke.points[0], stroke.points[0], stroke.radius);
      continue;
    }
    for (let index = 1; index < stroke.points.length; index += 1) {
      paintSegment(mask, width, height, stroke.points[index - 1], stroke.points[index], stroke.radius);
    }
  }
  if (!mask.some(value => value === 0)) throw new TypeError('The erase brush did not cover any image pixels.');
  return mask;
}

/** Replace only erased RGB pixels so model drift cannot touch unmasked source pixels or alpha. */
export function compositeInpaintRgbPixels(originalRgba, generatedRgb, mask, width, height) {
  const pixels = validateInpaintDimensions(width, height);
  if (!(originalRgba instanceof Uint8ClampedArray) || originalRgba.byteLength !== pixels * 4
    || !(generatedRgb instanceof Uint8Array) || generatedRgb.byteLength !== pixels * 3
    || !(mask instanceof Uint8Array) || mask.byteLength !== pixels) {
    throw new TypeError('Object erase needs matching original pixels, generated RGB, and mask data.');
  }
  for (let pixelIndex = 0, sourceIndex = 0; pixelIndex < pixels; pixelIndex += 1, sourceIndex += 4) {
    if (mask[pixelIndex] !== 0) continue;
    originalRgba[sourceIndex] = generatedRgb[pixelIndex];
    originalRgba[sourceIndex + 1] = generatedRgb[pixels + pixelIndex];
    originalRgba[sourceIndex + 2] = generatedRgb[pixels * 2 + pixelIndex];
  }
  return originalRgba;
}
