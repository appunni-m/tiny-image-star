export const MAX_IMAGE_OUTPUT_BYTES = 128 * 1024 * 1024;

const mimeTypes = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' });

/**
 * Wrap a final Pillow-RS worker result for download. Codec selection and lossy
 * quality are already applied in WASM before these bytes cross the worker
 * boundary; the main thread only creates the download Blob.
 */
export function encodeRenderedImageOutput(rendered, { format = 'png', quality = 90 } = {}) {
  if (!rendered || !(rendered.bytes instanceof Uint8Array)
    || !Number.isSafeInteger(rendered.width) || rendered.width < 1
    || !Number.isSafeInteger(rendered.height) || rendered.height < 1) {
    throw new TypeError('A full-resolution Pillow-RS image result is required.');
  }
  if (rendered.bytes.byteLength > MAX_IMAGE_OUTPUT_BYTES) {
    throw new RangeError(`This image output is larger than the ${Math.floor(MAX_IMAGE_OUTPUT_BYTES / (1024 * 1024))} MiB local export limit.`);
  }
  if (!Object.hasOwn(mimeTypes, format)) throw new TypeError('Image output format must be PNG, JPEG, or WebP.');
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new RangeError('Image output quality must be an integer from 1 to 100.');
  if (rendered.outputFormat !== format || rendered.outputQuality !== quality
    || rendered.mimeType !== mimeTypes[format]) {
    throw new Error('The Pillow-RS worker result does not match the requested output format and quality.');
  }
  const qualityApplied = format === 'png' ? null : rendered.qualityApplied;
  if (format !== 'png' && qualityApplied !== true) {
    throw new Error('The Pillow-RS worker did not apply the requested lossy output quality.');
  }

  const blob = new Blob([rendered.bytes], { type: mimeTypes[format] });
  rendered.bytes = new Uint8Array(0);
  return { blob, width: rendered.width, height: rendered.height, qualityApplied };
}
