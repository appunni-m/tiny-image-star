import { MAX_INPAINT_SOURCE_PIXELS } from './inpaint-mask.js';

const PADDING_SIDES = ['top', 'right', 'bottom', 'left'];

function validateDimension(value, name, { allowZero = false } = {}) {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new TypeError(`${name} must be a finite ${allowZero ? 'non-negative' : 'positive'} integer.`);
  }
  return value;
}

function validatePixelCount(width, height, label) {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels)) {
    throw new RangeError(`${label} dimensions exceed the safe pixel-count limit.`);
  }
  if (pixels > MAX_INPAINT_SOURCE_PIXELS) {
    throw new RangeError(`${label} supports at most ${MAX_INPAINT_SOURCE_PIXELS.toLocaleString()} pixels.`);
  }
  return pixels;
}

function normalizePadding(padding) {
  if (!padding || typeof padding !== 'object' || Array.isArray(padding)) {
    throw new TypeError('Image expansion padding must specify top, right, bottom, and left pixels.');
  }
  const normalized = {};
  for (const side of PADDING_SIDES) {
    normalized[side] = validateDimension(padding[side] ?? 0, `${side} padding`, { allowZero: true });
  }
  if (!PADDING_SIDES.some(side => normalized[side] > 0)) {
    throw new RangeError('Image expansion needs positive padding on at least one side.');
  }
  return normalized;
}

/**
 * Plan an integer-aligned expanded canvas and its non-overlapping unknown bands.
 * The region list covers every added pixel exactly once and never covers source pixels.
 */
export function planImageExpansion(sourceWidth, sourceHeight, padding) {
  validateDimension(sourceWidth, 'Source width');
  validateDimension(sourceHeight, 'Source height');
  validatePixelCount(sourceWidth, sourceHeight, 'Source image');
  const normalizedPadding = normalizePadding(padding);
  const width = sourceWidth + normalizedPadding.left + normalizedPadding.right;
  const height = sourceHeight + normalizedPadding.top + normalizedPadding.bottom;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new RangeError('Expanded canvas dimensions exceed the safe integer limit.');
  }
  const pixelCount = validatePixelCount(width, height, 'Expanded canvas');
  const offsetX = normalizedPadding.left;
  const offsetY = normalizedPadding.top;
  const sourceRight = offsetX + sourceWidth;
  const sourceBottom = offsetY + sourceHeight;
  const unknownRegions = [];

  if (normalizedPadding.top) {
    unknownRegions.push({ x: 0, y: 0, width, height: normalizedPadding.top });
  }
  if (normalizedPadding.bottom) {
    unknownRegions.push({ x: 0, y: sourceBottom, width, height: normalizedPadding.bottom });
  }
  if (normalizedPadding.left) {
    unknownRegions.push({ x: 0, y: offsetY, width: normalizedPadding.left, height: sourceHeight });
  }
  if (normalizedPadding.right) {
    unknownRegions.push({ x: sourceRight, y: offsetY, width: normalizedPadding.right, height: sourceHeight });
  }

  const sourceRect = Object.freeze({ x: offsetX, y: offsetY, width: sourceWidth, height: sourceHeight });
  const frozenRegions = Object.freeze(unknownRegions.map(region => Object.freeze(region)));
  return Object.freeze({
    sourceWidth,
    sourceHeight,
    width,
    height,
    pixelCount,
    offsetX,
    offsetY,
    padding: Object.freeze(normalizedPadding),
    sourceRect,
    unknownRegions: frozenRegions,
  });
}

export function validateImageExpansionPlan(plan) {
  if (!plan || typeof plan !== 'object') throw new TypeError('Image expansion needs a valid canvas plan.');
  const rebuilt = planImageExpansion(plan.sourceWidth, plan.sourceHeight, plan.padding);
  for (const key of ['width', 'height', 'pixelCount', 'offsetX', 'offsetY']) {
    if (plan[key] !== rebuilt[key]) throw new TypeError('Image expansion plan dimensions do not match its source and padding.');
  }
  return rebuilt;
}

/** Create MI-GAN's mask convention: 255 keeps known source pixels; 0 fills added pixels. */
export function createImageExpansionMask(plan) {
  const validPlan = validateImageExpansionPlan(plan);
  const mask = new Uint8Array(validPlan.pixelCount);
  for (let row = 0; row < validPlan.sourceHeight; row += 1) {
    const start = (validPlan.offsetY + row) * validPlan.width + validPlan.offsetX;
    mask.fill(255, start, start + validPlan.sourceWidth);
  }
  return mask;
}

function isRgbaBytes(value) {
  return (value instanceof Uint8Array || value instanceof Uint8ClampedArray)
    && value.BYTES_PER_ELEMENT === 1;
}

/**
 * Use generated RGBA for the expanded canvas, then restore original RGBA pixels
 * exactly so model drift or alpha changes cannot alter the source rectangle.
 */
export function compositeExpandedImageRgba(sourceRgba, generatedRgba, plan) {
  const validPlan = validateImageExpansionPlan(plan);
  if (!isRgbaBytes(sourceRgba) || sourceRgba.byteLength !== validPlan.sourceWidth * validPlan.sourceHeight * 4
    || !isRgbaBytes(generatedRgba) || generatedRgba.byteLength !== validPlan.pixelCount * 4) {
    throw new TypeError('Image expansion needs matching source and generated RGBA pixel buffers.');
  }

  const output = new Uint8ClampedArray(generatedRgba);
  for (let row = 0; row < validPlan.sourceHeight; row += 1) {
    const sourceStart = row * validPlan.sourceWidth * 4;
    const destinationStart = ((validPlan.offsetY + row) * validPlan.width + validPlan.offsetX) * 4;
    output.set(sourceRgba.subarray(sourceStart, sourceStart + validPlan.sourceWidth * 4), destinationStart);
  }
  return output;
}
