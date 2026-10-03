export const MAX_RASTER_VECTORIZE_PIXELS = 1_048_576;
export const MAX_RASTER_VECTORIZE_COLORS = 16;
export const MAX_RASTER_VECTORIZE_POINTS_PER_COLOR = 20_000;
export const MAX_RASTER_VECTORIZE_POINTS_TOTAL = 60_000;

const clampInteger = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : fallback;
};

/** Normalize the bounded local raster-to-vector controls before starting WASM work. */
export function normalizeRasterVectorizeOptions(options = {}) {
  const mode = options.mode ?? 'color';
  if (!['color', 'grayscale', 'black-white'].includes(mode)) {
    throw new TypeError('Choose color, grayscale, or black and white vectorization.');
  }
  const detail = clampInteger(options.detail, 1, 100, 68);
  // More detail preserves smaller bends. At the lowest detail, the maximum
  // 3.5 px tolerance remains below the half-width of a 1 px source feature.
  const normalizedDetail = detail / 100;
  const tolerancePixels = 0.12 + (1 - normalizedDetail) ** 2 * 3.38;
  return Object.freeze({
    mode,
    colorCount: clampInteger(options.colorCount, 2, MAX_RASTER_VECTORIZE_COLORS, 8),
    threshold: clampInteger(options.threshold, 0, 255, 128),
    toleranceMilliPixels: Math.round(tolerancePixels * 1000),
    detail
  });
}

/** Decode the worker's bounded binary contour format into editor-independent geometry. */
export function decodeRasterVectorizationResult(input, { width, height } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width * height > MAX_RASTER_VECTORIZE_PIXELS || bytes.byteLength < 4) {
    throw new TypeError('The local vectorizer returned invalid image dimensions or data.');
  }
  let offset = 0;
  const readU16 = () => {
    if (offset + 2 > bytes.length) throw new RangeError('The local vectorizer returned truncated path data.');
    const value = bytes[offset] | (bytes[offset + 1] << 8);
    offset += 2;
    return value;
  };
  const readU32 = () => {
    if (offset + 4 > bytes.length) throw new RangeError('The local vectorizer returned truncated path data.');
    const value = (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
    offset += 4;
    return value;
  };
  const layerCount = readU32();
  if (layerCount > MAX_RASTER_VECTORIZE_COLORS) throw new RangeError('The local vectorizer returned too many color layers.');
  const layers = [];
  let totalPoints = 0;
  for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
    if (offset + 4 > bytes.length) throw new RangeError('The local vectorizer returned truncated color data.');
    const color = `#${[bytes[offset], bytes[offset + 1], bytes[offset + 2]]
      .map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
    const opacity = bytes[offset + 3] / 255;
    offset += 4;
    const contourCount = readU16();
    if (contourCount > 10_000) throw new RangeError('The local vectorizer returned too many contours.');
    const contours = [];
    let colorPoints = 0;
    for (let contourIndex = 0; contourIndex < contourCount; contourIndex += 1) {
      const pointCount = readU32();
      colorPoints += pointCount;
      totalPoints += pointCount;
      if (pointCount < 3 || colorPoints > MAX_RASTER_VECTORIZE_POINTS_PER_COLOR || totalPoints > MAX_RASTER_VECTORIZE_POINTS_TOTAL) {
        throw new RangeError('The local vectorizer returned path geometry above the editor limits.');
      }
      const points = [];
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const x = readU16();
        const y = readU16();
        if (x > width || y > height) throw new RangeError('The local vectorizer returned points outside the source image.');
        points.push({ x: x / width, y: y / height, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } });
      }
      contours.push({ points, closed: true });
    }
    if (contours.length) layers.push({ color, opacity, contours });
  }
  if (offset !== bytes.length) throw new RangeError('The local vectorizer returned extra path data.');
  return { width, height, layers, pointCount: totalPoints };
}
