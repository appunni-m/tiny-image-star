export const MAX_TEXTURE_SIZE = 100;
export const MAX_TEXTURE_RADIUS = 100;
export const MAX_TEXTURE_MASK_PIXELS = 1_000_000;

export function isValidTextureEffect(effect) {
  return Boolean(effect && effect.type === 'texture'
    && Number.isFinite(effect.sizeX) && effect.sizeX >= 0.1 && effect.sizeX <= MAX_TEXTURE_SIZE
    && Number.isFinite(effect.sizeY) && effect.sizeY >= 0.1 && effect.sizeY <= MAX_TEXTURE_SIZE
    && Number.isFinite(effect.radius) && effect.radius >= 0 && effect.radius <= MAX_TEXTURE_RADIUS
    && typeof effect.clipToShape === 'boolean');
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A stable layer-and-stack-slot seed for edge distress across preview redraws. */
export function textureSeedForLayer(layerId, effectIndex) {
  return hashString(`${String(layerId)}\u0000${Math.max(0, Math.trunc(Number(effectIndex) || 0))}`);
}

function cellHash(seed, column, row) {
  let value = (seed >>> 0) ^ Math.imul(column + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

/**
 * Apply a deterministic per-cell displacement to the blurred alpha contour.
 * Input/output buffers are compact RGBA ImageData and are bounded by the
 * renderer's one-megapixel texture-mask budget.
 */
export function createTextureEdgeAlphas(baseImageData, blurredImageData, width, height, effect, pixelScale = 1, seed = 0) {
  if (!isValidTextureEffect(effect)) throw new TypeError('Cannot render an invalid texture effect.');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width * height > MAX_TEXTURE_MASK_PIXELS
    || !baseImageData?.data || !blurredImageData?.data
    || baseImageData.data.length !== width * height * 4 || blurredImageData.data.length !== width * height * 4) {
    throw new RangeError('Texture mask exceeds its bounded pixel budget.');
  }
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const cellWidth = Math.max(1, Math.round(effect.sizeX * scale));
  const cellHeight = Math.max(1, Math.round(effect.sizeY * scale));
  const inside = new Uint8ClampedArray(width * height);
  const outside = new Uint8ClampedArray(width * height);
  const stableSeed = seed >>> 0;
  for (let y = 0; y < height; y += 1) {
    const row = Math.floor(y / cellHeight);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const index = y * width + x;
      const baseAlpha = baseImageData.data[offset + 3];
      const blurredAlpha = blurredImageData.data[offset + 3];
      const random = cellHash(stableSeed, Math.floor(x / cellWidth), row) / 0xffff_ffff;
      const edgeStrength = Math.max(0, 1 - Math.abs(blurredAlpha - 128) / 128);
      const roughAlpha = Math.max(0, Math.min(255, Math.round(blurredAlpha + (random * 2 - 1) * 112 * edgeStrength)));
      const desiredInside = Math.min(baseAlpha, roughAlpha);
      const desiredOutside = Math.max(0, roughAlpha - baseAlpha);
      // These are masks to be destination-in composited over the source and
      // blurred source, respectively, so divide by their existing alpha here.
      inside[index] = baseAlpha ? Math.min(255, Math.round(desiredInside * 255 / baseAlpha)) : 0;
      outside[index] = effect.clipToShape || !blurredAlpha ? 0 : Math.min(255, Math.round(desiredOutside * 255 / blurredAlpha));
    }
  }
  return { inside, outside, cellWidth, cellHeight };
}
