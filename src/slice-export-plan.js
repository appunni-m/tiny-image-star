/** Export multipliers shown by the editor's raster export controls. */
export const SUPPORTED_SLICE_EXPORT_SCALES = Object.freeze([0.5, 0.75, 1, 1.5, 2, 3, 4]);

export const MAX_SLICE_EXPORT_AXIS = 16_384;
export const MAX_SLICE_EXPORT_PIXELS = 16_000_000;

const paddingSides = Object.freeze(['top', 'right', 'bottom', 'left']);

/** Return whether two finite axis-aligned rectangles overlap with positive area. */
export function sliceRasterBoundsIntersect(first, second) {
  if (![first?.x, first?.y, first?.width, first?.height,
    second?.x, second?.y, second?.width, second?.height].every(Number.isFinite)
    || first.width <= 0 || first.height <= 0 || second.width <= 0 || second.height <= 0) {
    // Invalid bounds are kept in the export dependency set: callers should
    // prefer an unnecessary refresh over accidentally exporting stale pixels.
    return true;
  }
  return first.x < second.x + second.width && first.x + first.width > second.x
    && first.y < second.y + second.height && first.y + first.height > second.y;
}

/** Check the editable numeric input accepted for slice width or height. */
export function isValidSliceDimensionInput(value) {
  if (value == null || String(value).trim() === '') return false;
  const dimension = Number(value);
  return Number.isFinite(dimension) && dimension >= 1 && dimension <= 100_000;
}

/** Convert world-space backdrop sampling support to padded render-canvas pixels. */
export function sliceRenderBleedPixels(worldBleed, scale) {
  if (!Number.isFinite(worldBleed) || worldBleed < 0 || !Number.isFinite(scale) || scale <= 0) {
    throw new TypeError('Slice backdrop bleed and scale must be finite nonnegative/positive numbers.');
  }
  return worldBleed > 0 ? Math.ceil(worldBleed * scale) + 2 : 0;
}

/** Compactly fingerprint JSON-compatible page content for async export fencing. */
export function sliceExportContentSignature(content) {
  const serialized = JSON.stringify(content);
  if (typeof serialized !== 'string') return null;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  let third = 0x85ebca6b;
  let fourth = 0xc2b2ae35;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    third = Math.imul(third ^ code, 0xc2b2ae35);
    fourth = Math.imul(fourth ^ code, 0x27d4eb2d);
  }
  return `${serialized.length}:${first >>> 0}:${second >>> 0}:${third >>> 0}:${fourth >>> 0}`;
}

/** Plan the bounded canvas used to retain backdrop samples beyond a slice crop. */
export function planSliceRenderSurface(slicePlan, bleed = 0) {
  const { width: outputWidth, height: outputHeight } = slicePlan?.outputSize || {};
  if (!Number.isSafeInteger(outputWidth) || !Number.isSafeInteger(outputHeight) || outputWidth < 1 || outputHeight < 1) {
    throw new TypeError('A slice render surface requires a valid output size.');
  }
  if (!Number.isSafeInteger(bleed) || bleed < 0) {
    throw new TypeError('Slice render bleed must be a nonnegative safe integer number of pixels.');
  }
  const width = outputWidth + bleed * 2;
  const height = outputHeight + bleed * 2;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new RangeError('Slice render surface dimensions exceed the safe integer range.');
  }
  if (width > MAX_SLICE_EXPORT_AXIS || height > MAX_SLICE_EXPORT_AXIS) {
    throw new RangeError(`Slice render surface dimensions exceed the ${MAX_SLICE_EXPORT_AXIS.toLocaleString()} px axis limit.`);
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_SLICE_EXPORT_PIXELS) {
    throw new RangeError(`Slice render surface exceeds the ${MAX_SLICE_EXPORT_PIXELS.toLocaleString()} pixel limit.`);
  }
  return { width, height, bleed, pixels };
}

/** Validate and copy a finite, positive, axis-aligned slice rectangle. */
export function validateSliceRect(slice) {
  if (!slice || typeof slice !== 'object' || Array.isArray(slice)) {
    throw new TypeError('A slice must be an object with finite x, y, width, and height values.');
  }
  const { x, y, width, height } = slice;
  if (![x, y, width, height].every(Number.isFinite)) {
    throw new TypeError('A slice must have finite x, y, width, and height values.');
  }
  if (width <= 0 || height <= 0) {
    throw new RangeError('A slice must have positive width and height.');
  }
  if (![x, y, x + width, y + height].every(value => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Slice bounds exceed the safe coordinate range.');
  }
  return { x, y, width, height };
}

function normalizePadding(padding) {
  if (padding === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (Number.isSafeInteger(padding) && padding >= 0) {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  if (!padding || typeof padding !== 'object' || Array.isArray(padding)) {
    throw new TypeError('Slice export padding must be a nonnegative integer or a side map of nonnegative pixel integers.');
  }
  for (const side of Object.keys(padding)) {
    if (!paddingSides.includes(side)) throw new TypeError(`Unknown slice export padding side: ${side}.`);
  }
  const normalized = Object.fromEntries(paddingSides.map(side => [side, padding[side] ?? 0]));
  if (paddingSides.some(side => !Number.isSafeInteger(normalized[side]) || normalized[side] < 0)) {
    throw new TypeError('Slice export padding values must be nonnegative safe integers.');
  }
  return normalized;
}

/**
 * Plan a bounded raster export for a slice. Coordinates stay in canvas units
 * (including fractional positions); padding is added in output pixels.
 */
export function planSliceRasterExport(slice, { scale = 1, padding = 0 } = {}) {
  const sourceCrop = validateSliceRect(slice);
  if (!SUPPORTED_SLICE_EXPORT_SCALES.includes(scale)) {
    throw new RangeError(`Slice export scale must be one of: ${SUPPORTED_SLICE_EXPORT_SCALES.join(', ')}.`);
  }
  const pixelPadding = normalizePadding(padding);
  if (![sourceCrop.x * scale, sourceCrop.y * scale, (sourceCrop.x + sourceCrop.width) * scale,
    (sourceCrop.y + sourceCrop.height) * scale].every(value => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Scaled slice coordinates exceed the safe range.');
  }
  const width = Math.ceil(sourceCrop.width * scale) + pixelPadding.left + pixelPadding.right;
  const height = Math.ceil(sourceCrop.height * scale) + pixelPadding.top + pixelPadding.bottom;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new RangeError('Slice export dimensions exceed the safe integer range.');
  }
  if (width > MAX_SLICE_EXPORT_AXIS || height > MAX_SLICE_EXPORT_AXIS) {
    throw new RangeError(`Slice export dimensions exceed the ${MAX_SLICE_EXPORT_AXIS.toLocaleString()} px axis limit.`);
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_SLICE_EXPORT_PIXELS) {
    throw new RangeError(`Slice export exceeds the ${MAX_SLICE_EXPORT_PIXELS.toLocaleString()} pixel limit.`);
  }
  return {
    sourceCrop,
    scale,
    padding: pixelPadding,
    outputSize: { width, height },
    pixels,
  };
}
