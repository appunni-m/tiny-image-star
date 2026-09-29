import { imageCropPixels, normalizeImageTransforms } from './image-transforms.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function replaceImage(current, next) {
  if (next !== current) current.free();
  return next;
}

/**
 * Resolve an optional normalized crop and clockwise quarter-turn rotation
 * against the original source dimensions. Normalized crop edges make saved
 * recipes portable across sources with different pixel dimensions.
 */
export function decodeOriginal(api, bytes, { maxPixels = 80_000_000 } = {}) {
  let image;
  try {
    image = api.Image.open(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > maxPixels) throw new RangeError('This image is too large to edit in this browser.');
    image.load();
    return image;
  } catch (error) {
    image?.free?.();
    throw error;
  }
}

/**
 * Render a fresh preview from the immutable decoded source.
 *
 * Crop edges are normalized fractions of the original source, with right and
 * bottom exclusive. Crop is applied before clockwise quarter-turn rotation;
 * color adjustments follow both geometry operations. The result dimensions
 * describe the encoded PNG, while source dimensions and resolved crop pixels
 * let callers keep layer geometry and recipe metadata in sync.
 */
export function renderImage(source, adjustments = {}, transforms = {}) {
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const normalizedTransforms = normalizeImageTransforms(transforms);
  const resolved = { ...normalizedTransforms, cropPixels: imageCropPixels(normalizedTransforms.crop, sourceWidth, sourceHeight) };
  let image = source.copy();
  const brightness = clamp(adjustments.brightness, -100, 100);
  const contrast = clamp(adjustments.contrast, -100, 100);
  const saturation = clamp(adjustments.saturation, -100, 100);
  const blur = clamp(adjustments.blur, 0, 24);
  try {
    if (resolved.cropPixels) {
      const { left, top, right, bottom } = resolved.cropPixels;
      image = replaceImage(image, image.crop(left, top, right, bottom));
    }
    if (resolved.rotation) {
      // Pillow's ROTATE_90 operation is counter-clockwise. The public API uses
      // clockwise degrees to match the canvas transform convention.
      const method = ({ 90: 'ROTATE_270', 180: 'ROTATE_180', 270: 'ROTATE_90' })[resolved.rotation];
      image = replaceImage(image, image.transpose(method));
    }
    if (brightness) image = replaceImage(image, image.enhanceBrightness(1 + brightness / 100));
    if (contrast) image = replaceImage(image, image.enhanceContrast(1 + contrast / 100));
    if (saturation) image = replaceImage(image, image.enhanceColor(1 + saturation / 100));
    if (blur) image = replaceImage(image, image.gaussianBlur(blur));
    const output = image.saveWithInput('PNG', null);
    return {
      bytes: new Uint8Array(output),
      width: image.width,
      height: image.height,
      sourceWidth,
      sourceHeight,
      crop: resolved.crop,
      cropPixels: resolved.cropPixels,
      rotation: resolved.rotation,
    };
  } finally { image.free(); }
}
