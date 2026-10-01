import { fillStackForNode } from './fills.js';

export const MAX_GLASS_EFFECTS_PER_LAYER = 1;
export const MAX_GLASS_PIXELS = 1_000_000;
export const MAX_GLASS_AXIS = 1536;
export const MAX_GLASS_OVERSCAN = 96;

const glassParameters = ['lightIntensity', 'refraction', 'depth', 'dispersion', 'frost', 'splay'];

export function isValidGlassEffect(effect) {
  return Boolean(effect && effect.type === 'glass'
    && Number.isFinite(effect.lightAngle) && effect.lightAngle >= 0 && effect.lightAngle <= 360
    && glassParameters.every(name => Number.isFinite(effect[name]) && effect[name] >= 0 && effect[name] <= 100));
}

/** Glass and background blur compete for one backdrop-rendering slot. */
export function firstBackdropEffect(effects) {
  return (effects || []).find(effect => effect?.visible !== false
    && (effect.type === 'glass' || effect.type === 'background-blur')) || null;
}

/** Figma Glass is hidden whenever any visible fill is fully opaque. */
export function glassVisibleForNode(node) {
  return !fillStackForNode(node).some(fill => {
    if (fill?.visible === false || Number(fill.opacity ?? 1) < 1) return false;
    if (fill.type === 'solid' && String(fill.color).toLowerCase() === 'transparent') return false;
    return true;
  });
}

/** Editable SVG and vector PDF cannot sample the scene backdrop for this effect. */
export function glassVectorExportBlockReason(node) {
  return node?.effects?.some(effect => effect?.type === 'glass' && effect.visible !== false)
    ? 'backdrop refraction and transparency cannot be represented by editable vector output; rasterize the layer or hide/remove the effect'
    : null;
}

export function glassEffectOverscan(effect) {
  const frost = (effect.frost / 100) * 12;
  const refraction = (effect.refraction / 100) * 16;
  const dispersion = (effect.dispersion / 100) * 4;
  const depth = (effect.depth / 100) * 12;
  const splay = (effect.splay / 100) * 2;
  return Math.min(MAX_GLASS_OVERSCAN, Math.ceil(frost * 3 + refraction * 1.95 + dispersion + depth + splay + 2));
}

function channelAt(data, width, height, x, y, channel) {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const top = data[(y0 * width + x0) * 4 + channel] * (1 - tx) + data[(y0 * width + x1) * 4 + channel] * tx;
  const bottom = data[(y1 * width + x0) * 4 + channel] * (1 - tx) + data[(y1 * width + x1) * 4 + channel] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Refract a sampled backdrop along the glass contour, with bounded local pixel work. */
export function refractGlassBackdrop(sourceImageData, edgeImageData, width, height, effect, pixelScale = 1) {
  if (!isValidGlassEffect(effect)) throw new TypeError('Cannot render an invalid Glass effect.');
  const byteLength = width * height * 4;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width * height > MAX_GLASS_PIXELS
    || sourceImageData?.data?.length !== byteLength || edgeImageData?.data?.length !== byteLength) {
    throw new RangeError('Glass preview exceeds its bounded pixel budget.');
  }
  const source = sourceImageData.data;
  const edge = edgeImageData.data;
  const output = Uint8ClampedArray.from(source);
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const edgeDepth = Math.max(1, (effect.depth / 100) * 48 * scale);
  const maximumOffset = (effect.refraction / 100) * edgeDepth * 0.65;
  const dispersion = (effect.dispersion / 100) * 4 * scale;
  const radians = effect.lightAngle * Math.PI / 180;
  const lightX = Math.cos(radians);
  const lightY = Math.sin(radians);
  const splay = effect.splay / 100;
  const intensity = effect.lightIntensity / 100;
  const edgeThreshold = 255 / edgeDepth;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const left = edge[(y * width + Math.max(0, x - 1)) * 4 + 3];
      const right = edge[(y * width + Math.min(width - 1, x + 1)) * 4 + 3];
      const top = edge[(Math.max(0, y - 1) * width + x) * 4 + 3];
      const bottom = edge[(Math.min(height - 1, y + 1) * width + x) * 4 + 3];
      const gradientX = (right - left) / 2;
      const gradientY = (bottom - top) / 2;
      const gradientLength = Math.hypot(gradientX, gradientY);
      if (gradientLength < 0.5) continue;
      const alpha = edge[index + 3] / 255;
      if (alpha <= 0) continue;
      const edgeStrength = Math.min(1, gradientLength / edgeThreshold) * Math.min(1, alpha * 1.5);
      const normalX = -gradientX / gradientLength;
      const normalY = -gradientY / gradientLength;
      const offset = maximumOffset * edgeStrength;
      const sampleX = x + normalX * offset;
      const sampleY = y + normalY * offset;
      const red = channelAt(source, width, height, sampleX + normalX * dispersion, sampleY + normalY * dispersion, 0);
      const green = channelAt(source, width, height, sampleX, sampleY, 1);
      const blue = channelAt(source, width, height, sampleX - normalX * dispersion, sampleY - normalY * dispersion, 2);
      const directLight = Math.max(0, normalX * lightX + normalY * lightY);
      const lightSpread = directLight * (1 - splay) + (0.35 + 0.65 * directLight) * splay;
      const highlight = Math.min(0.72, intensity * edgeStrength * lightSpread * 0.7);
      output[index] = red + (255 - red) * highlight;
      output[index + 1] = green + (255 - green) * highlight;
      output[index + 2] = blue + (255 - blue) * highlight;
    }
  }
  return { width, height, data: output };
}
