export const FALLBACK_IMAGE_MAX_EDGE = 1200;

export function fallbackImageDimensions(width, height, maxEdge = FALLBACK_IMAGE_MAX_EDGE) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1
    || !Number.isSafeInteger(width * height)) {
    throw new RangeError('Fallback image dimensions must be positive safe integers.');
  }
  if (!Number.isSafeInteger(maxEdge) || maxEdge < 1) {
    throw new RangeError('The fallback image edge limit must be a positive safe integer.');
  }

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function makeResizeCanvas(width, height) {
  if (typeof globalThis.OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = globalThis.document?.createElement('canvas');
  if (!canvas) throw new Error('This browser cannot create a downsampled image preview.');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function resizeWithCanvas(source, dimensions, createBitmap, createCanvas) {
  const canvas = createCanvas(dimensions.width, dimensions.height);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot create a downsampled image preview.');
    context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
    const bitmap = await createBitmap(canvas);
    if (bitmap.width !== dimensions.width || bitmap.height !== dimensions.height) {
      bitmap.close?.();
      throw new Error('This browser could not downsample the image preview.');
    }
    return bitmap;
  } finally {
    // Drop the temporary canvas backing store as soon as its ImageBitmap is ready.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Decode an image for canvas fallback, retaining at most a 1200px long edge.
 * The full-resolution decode is temporary and always closed after resizing.
 * Pillow-RS still receives the original bytes; this bitmap is only for display
 * while an edited preview is unavailable.
 */
export async function createFallbackImage(source, {
  createBitmap = globalThis.createImageBitmap,
  createCanvas = makeResizeCanvas,
  maxEdge = FALLBACK_IMAGE_MAX_EDGE,
} = {}) {
  if (typeof createBitmap !== 'function') throw new Error('This browser cannot decode local images.');
  const decoded = await createBitmap(source);
  const sourceWidth = decoded.width;
  const sourceHeight = decoded.height;
  let output;
  try {
    const dimensions = fallbackImageDimensions(sourceWidth, sourceHeight, maxEdge);
    if (dimensions.width === sourceWidth && dimensions.height === sourceHeight) {
      output = decoded;
    } else {
      try {
        output = await createBitmap(decoded, {
          resizeWidth: dimensions.width,
          resizeHeight: dimensions.height,
          resizeQuality: 'high',
        });
      } catch {
        // Older engines may reject resize options; use a small canvas instead.
        output = null;
      }
      if (output && (output.width !== dimensions.width || output.height !== dimensions.height)) {
        output.close?.();
        output = null;
      }
      if (!output) output = await resizeWithCanvas(decoded, dimensions, createBitmap, createCanvas);
    }
    return { bitmap: output, sourceWidth, sourceHeight };
  } catch (error) {
    output?.close?.();
    throw error;
  } finally {
    if (output !== decoded) decoded.close?.();
  }
}

/**
 * Build the bounded canvas fallback from an already-rendered local Pillow-RS
 * PNG. This keeps TIFF and EXIF-oriented JPEGs on the same decoder and pixel
 * orientation as subsequent edits without changing the retained source bytes.
 */
export async function createPillowFallbackImage(renderPreview, { sourceDimensions, ...options } = {}) {
  if (typeof renderPreview !== 'function') throw new TypeError('A local Pillow-RS preview renderer is required.');
  const rendered = await renderPreview();
  if (!rendered?.bytes || !Number.isSafeInteger(rendered.width) || !Number.isSafeInteger(rendered.height)) {
    throw new TypeError('The local Pillow-RS preview is missing valid image bytes or dimensions.');
  }
  const source = new Blob([rendered.bytes], { type: rendered.mimeType || 'image/png' });
  const fallback = await createFallbackImage(source, options);
  if (sourceDimensions === undefined) return fallback;
  if (!Number.isSafeInteger(sourceDimensions?.width) || sourceDimensions.width < 1
    || !Number.isSafeInteger(sourceDimensions?.height) || sourceDimensions.height < 1) {
    fallback.bitmap.close?.();
    throw new TypeError('The verified source image dimensions are required for a Pillow-RS fallback.');
  }
  return { ...fallback, sourceWidth: sourceDimensions.width, sourceHeight: sourceDimensions.height };
}
