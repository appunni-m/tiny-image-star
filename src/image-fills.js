import { createImageTransforms, isValidImageTransforms } from './image-transforms.js';
import { vectorPathContours } from './vector-path.js';
import { DEFAULT_IMAGE_TILE_SCALE, isValidImageTileScale } from './image-tile.js';

export const imageFillNodeTypes = new Set(['frame', 'section', 'group', 'boolean', 'rectangle', 'ellipse', 'star', 'polygon', 'path', 'network', 'text']);
export const imageFillAdjustmentRanges = Object.freeze({
  exposure: [-100, 100],
  temperature: [-100, 100],
  tint: [-100, 100],
  brightness: [-100, 100],
  contrast: [-100, 100],
  saturation: [-100, 100],
  sharpness: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  blur: [0, 24],
  posterizeBits: [0, 8],
  solarizeThreshold: [0, 255]
});
export const defaultImageAdjustments = Object.freeze({
  exposure: 0, temperature: 0, tint: 0,
  brightness: 0, contrast: 0, saturation: 0, sharpness: 0, highlights: 0, shadows: 0, blur: 0,
  autoContrast: false, posterizeBits: 0, solarize: false, solarizeThreshold: 0, invert: false
});
const booleanAdjustmentFields = new Set(['autoContrast', 'solarize', 'invert']);

export function isValidImageAdjustments(adjustments) {
  if (!adjustments || typeof adjustments !== 'object' || Array.isArray(adjustments)
    || Object.keys(adjustments).some(key => !Object.hasOwn(defaultImageAdjustments, key))) return false;
  for (const [field, value] of Object.entries(adjustments)) {
    if (booleanAdjustmentFields.has(field)) {
      if (typeof value !== 'boolean') return false;
      continue;
    }
    const range = imageFillAdjustmentRanges[field];
    if (!range || !Number.isFinite(value) || value < range[0] || value > range[1]) return false;
    if (['posterizeBits', 'solarizeThreshold'].includes(field) && !Number.isInteger(value)) return false;
  }
  return true;
}

export function normalizeImageAdjustments(adjustments = {}) {
  if (!isValidImageAdjustments(adjustments)) throw new TypeError('Image adjustments contain an unsupported or invalid setting.');
  return { ...defaultImageAdjustments, ...adjustments };
}

export function isImageFillSupported(node) {
  return Boolean(node && imageFillNodeTypes.has(node.type)
    && (node.type !== 'path' || vectorPathContours(node).some(contour => contour.closed && contour.points.length >= 2))
    && (node.type !== 'network' || node.faces?.length));
}

export function createImageFill(assetId, overrides = {}) {
  if (typeof assetId !== 'string' || !assetId.trim() || assetId.length > 256) throw new TypeError('Choose an image already placed in this design.');
  const fit = overrides.fit ?? 'cover';
  return {
    assetId,
    fit: 'cover',
    ...overrides,
    ...(fit === 'tile' && overrides.scalingFactor == null ? { scalingFactor: DEFAULT_IMAGE_TILE_SCALE } : {}),
    transforms: createImageTransforms(overrides.transforms || {}),
    adjustments: normalizeImageAdjustments(overrides.adjustments || {})
  };
}

export function isValidImageFill(fill) {
  if (!fill || typeof fill !== 'object' || Array.isArray(fill)
    || typeof fill.assetId !== 'string' || !fill.assetId.trim() || fill.assetId.length > 256
    || !['cover', 'contain', 'tile'].includes(fill.fit)
    || (fill.scalingFactor != null && !isValidImageTileScale(fill.scalingFactor))
    || (fill.transforms != null && !isValidImageTransforms(fill.transforms))
    || !isValidImageAdjustments(fill.adjustments)) return false;
  return Object.entries(imageFillAdjustmentRanges).every(([field, [minimum, maximum]]) => {
    // Newly added settings may be absent from older local image fills.
    const value = fill.adjustments[field] ?? defaultImageAdjustments[field];
    return Number.isFinite(value) && value >= minimum && value <= maximum;
  });
}
