import { defaultImageAdjustments, isValidImageAdjustments } from './image-fills.js';
import { isValidImageEraseStrokes } from './inpaint-mask.js';

const directPdfRasterTypes = new Set(['image/png', 'image/jpeg']);

// SVG's self-contained data URLs expand by roughly 4/3 before the PDF writer
// consumes them. Keep the embedded raster payload comfortably below its
// aggregate 128 MiB SVG character ceiling, leaving room for vector markup.
export const MAX_VECTOR_PDF_EMBEDDED_IMAGE_BYTES = 80 * 1024 * 1024;

export class VectorPdfImageBudgetError extends RangeError {
  constructor(limitBytes = MAX_VECTOR_PDF_EMBEDDED_IMAGE_BYTES) {
    super(`Vector PDF embedded images exceed the ${Math.floor(limitBytes / (1024 * 1024))} MiB local image budget. Export fewer or smaller frames, or use raster PDF.`);
    this.name = 'VectorPdfImageBudgetError';
    this.limitBytes = limitBytes;
  }
}

/** Add one embedded raster payload while enforcing a bounded aggregate. */
export function addVectorPdfEmbeddedImageBytes(currentBytes, additionalBytes, { limitBytes = MAX_VECTOR_PDF_EMBEDDED_IMAGE_BYTES } = {}) {
  if (!Number.isSafeInteger(currentBytes) || currentBytes < 0
    || !Number.isSafeInteger(additionalBytes) || additionalBytes < 0
    || !Number.isSafeInteger(limitBytes) || limitBytes < 1) {
    throw new RangeError('Vector PDF image byte counts and budget must be nonnegative safe integers.');
  }
  if (currentBytes + additionalBytes > limitBytes) throw new VectorPdfImageBudgetError(limitBytes);
  return currentBytes + additionalBytes;
}

/** Report whether an SVG image must use a rendered pixel preview to preserve its edited appearance. */
export function hasRasterImageEdits(adjustments = {}, transforms = {}, inpaintStrokes = []) {
  return ['exposure', 'temperature', 'tint', 'brightness', 'contrast', 'highlights', 'shadows', 'saturation', 'sharpness', 'blur']
    .some(key => Number(adjustments[key] || 0) !== 0)
    || Boolean(adjustments.autoContrast || adjustments.solarize || adjustments.invert)
    || Number(adjustments.posterizeBits || 0) > 0
    || Boolean(transforms?.crop || transforms?.rotation || transforms?.flipHorizontal || transforms?.flipVertical)
    || (Array.isArray(inpaintStrokes) && inpaintStrokes.length > 0);
}

/**
 * Choose the image representation used by local vector-PDF export. Untouched
 * PNG/JPEG sources are retained verbatim; edited pixels must come from a local
 * lossless Pillow-RS PNG preview so the export matches the editor appearance.
 */
export function planVectorPdfRaster({ mimeType, adjustments = {}, transforms = {}, inpaintStrokes = [] } = {}) {
  const sourceMimeType = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (hasRasterImageEdits(adjustments, transforms, inpaintStrokes)) {
    return { kind: 'png-preview', sourceMimeType, outputMimeType: 'image/png' };
  }
  if (directPdfRasterTypes.has(sourceMimeType)) {
    return { kind: 'source', sourceMimeType, outputMimeType: sourceMimeType };
  }
  return { kind: 'unsupported', sourceMimeType, outputMimeType: null };
}

/** Include local-source and edit-data validation in the export preflight plan. */
export function planVectorPdfRasterSource({ asset, adjustments, transforms, inpaintStrokes } = {}) {
  const sourceBytes = asset?.sourceBytes;
  const hasSourceBytes = sourceBytes instanceof ArrayBuffer ? sourceBytes.byteLength > 0
    : ArrayBuffer.isView(sourceBytes) && sourceBytes.byteLength > 0;
  const sourceMimeType = String(asset?.type || asset?.mimeType || '').toLowerCase().split(';')[0].trim();
  if (!hasSourceBytes) return { kind: 'missing-source', sourceMimeType, outputMimeType: null };
  const imageAdjustments = adjustments ?? defaultImageAdjustments;
  if (!isValidImageAdjustments(imageAdjustments)) return { kind: 'invalid-adjustments', sourceMimeType, outputMimeType: null };
  const imageEraseStrokes = inpaintStrokes ?? [];
  if (!isValidImageEraseStrokes(imageEraseStrokes)) return { kind: 'invalid-inpaint-strokes', sourceMimeType, outputMimeType: null };
  return planVectorPdfRaster({ mimeType: sourceMimeType, adjustments: imageAdjustments, transforms, inpaintStrokes: imageEraseStrokes });
}
