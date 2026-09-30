import { imageCropPixels, normalizeImageTransforms } from './image-transforms.js';
import { isValidImageAdjustments, normalizeImageAdjustments } from './image-fills.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const outputFormats = new Set(['png', 'jpeg', 'webp']);
const outputEncoderNames = Object.freeze({ png: 'PNG', jpeg: 'JPEG', webp: 'WEBP' });
const outputMimeTypes = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' });

function replaceImage(current, next) {
  if (next !== current) current.free();
  return next;
}

function applyToneEffect(api, image, effect, value) {
  const operations = api?.ImageOps;
  const method = effect === 'autoContrast' ? 'autocontrast' : effect;
  if (typeof operations?.[method] !== 'function') throw new TypeError('This Pillow-RS worker does not provide the requested tone effect.');
  const apply = effect === 'autoContrast' ? current => operations.autocontrast(current, 0)
    : effect === 'posterize' ? current => operations.posterize(current, value)
      : effect === 'solarize' ? current => operations.solarize(current, value)
        : effect === 'invert' ? current => operations.invert(current)
          : null;
  if (!apply) throw new TypeError('This Pillow-RS worker does not provide the requested tone effect.');

  // Pillow-RS ImageOps currently rejects RGBA inputs. Process only color
  // channels and restore the untouched alpha band so PNG transparency stays
  // byte-for-byte stable through every creative tone operation.
  if (image.mode === 'P') {
    const rgba = image.convert('RGBA');
    try { return applyToneEffect(api, rgba, effect, value); }
    finally { rgba.free(); }
  }
  const bands = image.getbands();
  const alphaIndex = bands.indexOf('A');
  if (alphaIndex >= 0) {
    const colorMode = bands.length === 2 ? 'L' : 'RGB';
    let color;
    let alpha;
    let result;
    let preserveColor = false;
    try {
      color = image.convert(colorMode);
      alpha = image.getchannel(alphaIndex);
      result = apply(color);
      result.putalphaImageInput(alpha);
      preserveColor = result === color;
      return result;
    } catch (error) {
      if (result && result !== color) result.free();
      throw error;
    } finally {
      // ImageOps returns a new image today, but keep ownership correct if a
      // future Pillow-RS implementation returns the input image in place.
      if (color && !preserveColor) color.free();
      alpha?.free();
    }
  }
  return apply(image);
}

/**
 * JPEG cannot represent alpha. Match the editor's raster-export behavior by
 * compositing transparent pixels over white before passing pixels to Pillow.
 * The temporary color and mask surfaces are always freed, including when an
 * encoder or mask operation fails.
 */
function encodeJpeg(image, api, quality) {
  const hasAlphaBand = image.getbands().includes('A');
  const hasTransparency = hasAlphaBand || Boolean(image.hasTransparencyData?.());
  if (!hasTransparency) return image.saveWithQuality('JPEG', null, quality);
  if (typeof api?.Image !== 'function') throw new TypeError('Pillow-RS cannot flatten transparency for JPEG output.');

  let rgba;
  let rgb;
  let alpha;
  let matte;
  try {
    rgba = image.mode === 'RGBA' ? image.copy() : image.convert('RGBA');
    rgb = rgba.convert('RGB');
    alpha = rgba.getchannel(3);
    matte = new api.Image('RGB', image.width, image.height, null);
    matte.pasteColor(255, 255, 255, 255, 0, 0, image.width, image.height);
    matte.pasteImageMasked(rgb, 0, 0, alpha);
    return matte.saveWithQuality('JPEG', null, quality);
  } finally {
    matte?.free?.();
    alpha?.free?.();
    rgb?.free?.();
    rgba?.free?.();
  }
}

function encodeImageOutput(image, api, format, quality) {
  if (format === 'jpeg') return encodeJpeg(image, api, quality);
  if (format === 'webp') return image.saveWithQuality('WEBP', null, quality);
  return image.saveWithInput(outputEncoderNames[format], null);
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
export function renderImage(source, adjustments = {}, transforms = {}, api = null, output = {}) {
  const format = output.format ?? 'png';
  const quality = output.quality ?? 90;
  const mode = output.mode ?? 'preview';
  if (!outputFormats.has(format)) throw new TypeError('Image output format must be PNG, JPEG, or WebP.');
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new TypeError('Image output quality must be an integer from 1 to 100.');
  if (mode !== 'preview' && mode !== 'export') throw new TypeError('Image render mode must be preview or export.');
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  if (!isValidImageAdjustments(adjustments)) throw new TypeError('Image adjustments contain an unsupported or invalid setting.');
  const settings = normalizeImageAdjustments(adjustments);
  const normalizedTransforms = normalizeImageTransforms(transforms);
  const resolved = { ...normalizedTransforms, cropPixels: imageCropPixels(normalizedTransforms.crop, sourceWidth, sourceHeight) };
  let image = source.copy();
  const brightness = clamp(settings.brightness, -100, 100);
  const contrast = clamp(settings.contrast, -100, 100);
  const saturation = clamp(settings.saturation, -100, 100);
  // Pillow-RS sharpness uses 1 as the unchanged image, 0 as softened, and
  // values above 1 to strengthen edges. Map the centered editor value onto
  // that factor range so 0 remains a no-op and ±100 span 0–2.
  const sharpness = clamp(settings.sharpness, -100, 100);
  const blur = clamp(settings.blur, 0, 24);
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
    if (settings.autoContrast) image = replaceImage(image, applyToneEffect(api, image, 'autoContrast'));
    if (brightness) image = replaceImage(image, image.enhanceBrightness(1 + brightness / 100));
    if (contrast) image = replaceImage(image, image.enhanceContrast(1 + contrast / 100));
    if (saturation) image = replaceImage(image, image.enhanceColor(1 + saturation / 100));
    if (sharpness) image = replaceImage(image, image.enhanceSharpness(1 + sharpness / 100));
    if (settings.posterizeBits > 0) image = replaceImage(image, applyToneEffect(api, image, 'posterize', settings.posterizeBits));
    if (settings.solarize) image = replaceImage(image, applyToneEffect(api, image, 'solarize', settings.solarizeThreshold));
    if (settings.invert) image = replaceImage(image, applyToneEffect(api, image, 'invert'));
    if (blur) image = replaceImage(image, image.gaussianBlur(blur));
    // Keep editor previews lossless PNG so the chosen export codec never
    // compounds across edits. Standalone exports run their final codec and
    // JPEG/WebP quality settings inside the local Pillow-RS WASM worker.
    const bytes = new Uint8Array(mode === 'export'
      ? encodeImageOutput(image, api, format, quality)
      : image.saveWithInput('PNG', null));
    return {
      bytes,
      mimeType: mode === 'export' ? outputMimeTypes[format] : 'image/png',
      outputFormat: format,
      outputQuality: quality,
      qualityApplied: mode === 'export' && format !== 'png' ? true : null,
      mode,
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

/** Render the saved recipe from the immutable decoded source as an output file. */
export function renderImageOutput(source, adjustments = {}, transforms = {}, api = null, output = {}) {
  return renderImage(source, adjustments, transforms, api, { ...output, mode: 'export' });
}
