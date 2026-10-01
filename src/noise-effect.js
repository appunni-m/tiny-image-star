export const noiseColorModes = new Set(['mono', 'duo', 'multi']);
export const MAX_NOISE_PIXEL_SIZE = 100;
export const MAX_NOISE_GRID_PIXELS = 4_000_000;

const sixDigitColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export function isValidNoiseEffect(effect) {
  if (!effect || effect.type !== 'noise' || !noiseColorModes.has(effect.mode)
    || !Number.isFinite(effect.sizeX) || effect.sizeX < 1 || effect.sizeX > MAX_NOISE_PIXEL_SIZE
    || !Number.isFinite(effect.sizeY) || effect.sizeY < 1 || effect.sizeY > MAX_NOISE_PIXEL_SIZE
    || !Number.isFinite(effect.density) || effect.density < 0 || effect.density > 100
    || !Number.isFinite(effect.opacity) || effect.opacity < 0 || effect.opacity > 1) return false;
  if (effect.mode === 'mono') return sixDigitColor(effect.color);
  if (effect.mode === 'duo') return sixDigitColor(effect.color) && sixDigitColor(effect.color2);
  return true;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A stable layer-and-stack-slot seed, unchanged across rerenders and animation frames. */
export function noiseSeedForLayer(layerId, effectIndex) {
  return hashString(`${String(layerId)}\u0000${Math.max(0, Math.trunc(Number(effectIndex) || 0))}`);
}

function cellHash(seed, column, row, salt = 0) {
  let value = (seed >>> 0) ^ Math.imul(column + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b) ^ salt;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

function rgb(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

/**
 * Build a deterministic, low-resolution RGBA grain map for nearest-neighbor
 * drawing over a layer. Its bounded output size tracks the renderer's surface.
 */
export function createNoisePixelGrid(effect, pixelWidth, pixelHeight, rasterScale = 1, seed = 0) {
  if (!isValidNoiseEffect(effect)) throw new TypeError('Cannot render an invalid noise effect.');
  if (!Number.isInteger(pixelWidth) || !Number.isInteger(pixelHeight) || pixelWidth < 1 || pixelHeight < 1
    || pixelWidth * pixelHeight > MAX_NOISE_GRID_PIXELS) throw new RangeError('Noise preview exceeds its bounded pixel budget.');
  const scale = Number.isFinite(rasterScale) && rasterScale > 0 ? rasterScale : 1;
  const cellWidth = Math.max(1, Math.round(effect.sizeX * scale));
  const cellHeight = Math.max(1, Math.round(effect.sizeY * scale));
  const width = Math.ceil(pixelWidth / cellWidth);
  const height = Math.ceil(pixelHeight / cellHeight);
  const data = new Uint8ClampedArray(width * height * 4);
  const primary = effect.mode === 'multi' ? null : rgb(effect.color);
  const secondary = effect.mode === 'duo' ? rgb(effect.color2) : primary;
  const alpha = Math.round(effect.opacity * 255);
  const densityThreshold = effect.density / 100 * 0x1_0000_0000;
  const stableSeed = seed >>> 0;

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (cellHash(stableSeed, column, row, 0x27d4eb2f) >= densityThreshold) continue;
      let color;
      if (effect.mode === 'multi') {
        color = [cellHash(stableSeed, column, row, 0x165667b1) & 255,
          cellHash(stableSeed, column, row, 0xd3a2646c) & 255,
          cellHash(stableSeed, column, row, 0xfd7046c5) & 255];
      } else if (effect.mode === 'duo' && (cellHash(stableSeed, column, row, 0xb5297a4d) & 1)) color = secondary;
      else color = primary;
      const offset = (row * width + column) * 4;
      data[offset] = color[0]; data[offset + 1] = color[1]; data[offset + 2] = color[2]; data[offset + 3] = alpha;
    }
  }
  return { width, height, cellWidth, cellHeight, data };
}
