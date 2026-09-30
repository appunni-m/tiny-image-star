export const MAX_CANVAS_OUTPUT_PIXELS = 16_000_000;
export const MAX_CANVAS_OUTPUT_EDGE = 16_384;
export const MAX_IMAGE_OUTPUT_BYTES = 128 * 1024 * 1024;

const mimeTypes = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' });

/**
 * Encode a full-resolution Pillow-RS PNG result as the requested image output.
 * PNG stays byte-exact; the browser's local canvas encoder applies JPEG/WebP
 * quality because the deployed Pillow-RS JS binding has no quality argument.
 */
export async function encodeRenderedImageOutput(rendered, { format = 'png', quality = 90 } = {}, {
  createBitmap = globalThis.createImageBitmap,
  createCanvas = () => globalThis.document?.createElement('canvas'),
} = {}) {
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

  if (format === 'png') {
    const blob = new Blob([rendered.bytes], { type: mimeTypes.png });
    rendered.bytes = new Uint8Array(0);
    return { blob, width: rendered.width, height: rendered.height, qualityApplied: null };
  }

  if (rendered.width > MAX_CANVAS_OUTPUT_EDGE || rendered.height > MAX_CANVAS_OUTPUT_EDGE
    || rendered.width * rendered.height > MAX_CANVAS_OUTPUT_PIXELS) {
    throw new RangeError(`This ${format.toUpperCase()} export is ${rendered.width.toLocaleString()} × ${rendered.height.toLocaleString()} px. Resize the source below ${MAX_CANVAS_OUTPUT_PIXELS.toLocaleString()} pixels to encode it with the selected quality.`);
  }
  if (typeof createBitmap !== 'function') throw new Error('This browser cannot decode the full-resolution local image for export.');
  let png = new Blob([rendered.bytes], { type: mimeTypes.png });
  rendered.bytes = new Uint8Array(0);
  let bitmap;
  let canvas;
  try {
    bitmap = await createBitmap(png);
    if (bitmap.width !== rendered.width || bitmap.height !== rendered.height) {
      throw new Error('The full-resolution local image changed size while it was being exported.');
    }
    canvas = createCanvas();
    if (!canvas) throw new Error('This browser could not create a local export surface.');
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    const context = canvas.getContext('2d', { alpha: format !== 'jpeg' });
    if (!context) throw new Error('This browser could not create a local export surface.');
    if (format === 'jpeg') {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise((resolve, reject) => {
      try {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('The browser could not encode this export.')), mimeTypes[format], quality / 100);
      } catch (error) { reject(error); }
    });
    if (blob.type !== mimeTypes[format]) throw new Error(`${format.toUpperCase()} export is not supported by this browser.`);
    if (blob.size > MAX_IMAGE_OUTPUT_BYTES) throw new RangeError(`This image output is larger than the ${Math.floor(MAX_IMAGE_OUTPUT_BYTES / (1024 * 1024))} MiB local export limit.`);
    return { blob, width: rendered.width, height: rendered.height, qualityApplied: true };
  } finally {
    png = null;
    try { bitmap?.close?.(); } catch { /* Finish releasing the canvas even if a browser close fails. */ }
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
