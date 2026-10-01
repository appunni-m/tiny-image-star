import { identifyRasterContainer, rasterOrientation } from './raster-preflight.js';

const rasterFileExtension = /\.(?:png|jpe?g|gif|bmp|webp|tiff?|pnm|pbm|pgm|ppm|heic|heif|avif)$/i;

/** Include phone and desktop raster files whose browser supplied no MIME. */
export function isImageImportCandidate(file) {
  return Boolean(file && (String(file.type || '').toLowerCase().startsWith('image/')
    || (typeof file.name === 'string' && rasterFileExtension.test(file.name))));
}

/** Formats for which the editor must use its verified Pillow-RS decode path. */
export function requiresPillowFallback(sourceBytes) {
  const format = identifyRasterContainer(sourceBytes);
  return format === 'tiff' || ((format === 'jpeg' || format === 'webp') && rasterOrientation(sourceBytes) !== 1);
}

/** Turn a local Pillow failure into a useful action for TIFF variants. */
export function imageDecodeFailureMessage(sourceBytes, error) {
  if (identifyRasterContainer(sourceBytes) === 'tiff') {
    const reason = error?.message || '';
    if (/(?:cannot identify|cannot decode|decode(?:r|ing)? error|unsupported|not supported|unknown.*(?:TIFF|compression)|TIFF.*compression)/i.test(reason)) {
      return `This TIFF variant could not be decoded by the bundled local Pillow-RS build${reason ? ` (${reason})` : ''}. Export it as PNG or JPEG, then import that copy.`;
    }
  }
  return error?.message || 'Tiny Image Star could not decode this image locally.';
}
