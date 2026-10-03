export const DEFAULT_IMAGE_TILE_SCALE = 1;
export const MIN_IMAGE_TILE_SCALE = 0.01;
export const MAX_IMAGE_TILE_SCALE = 16;

export function isValidImageTileScale(value) {
  return Number.isFinite(value) && value >= MIN_IMAGE_TILE_SCALE && value <= MAX_IMAGE_TILE_SCALE;
}

export function imageTileSourceDimensions(width, height, rotation = 0) {
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0
    || !Number.isInteger(rotation) || rotation % 90 !== 0) return null;
  const quarterTurn = Math.abs(rotation % 180) === 90;
  return quarterTurn ? { width: height, height: width } : { width, height };
}

/** Map one image bitmap into a repeating, source-sized tile in the fill's local space. */
export function imageTilePatternTransform(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
  const {
    imageWidth, imageHeight, sourceWidth = imageWidth, sourceHeight = imageHeight,
    scalingFactor = DEFAULT_IMAGE_TILE_SCALE, rotation = 0,
    flipHorizontal = false, flipVertical = false, x = 0, y = 0
  } = options;
  if (![imageWidth, imageHeight, sourceWidth, sourceHeight, x, y].every(Number.isFinite)
    || imageWidth <= 0 || imageHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0
    || !isValidImageTileScale(scalingFactor)
    || !Number.isInteger(rotation) || rotation % 90 !== 0
    || typeof flipHorizontal !== 'boolean' || typeof flipVertical !== 'boolean') return null;

  const tileWidth = sourceWidth * scalingFactor;
  const tileHeight = sourceHeight * scalingFactor;
  const scaleX = tileWidth / imageWidth;
  const scaleY = tileHeight / imageHeight;
  const turn = ((rotation % 360) + 360) % 360;
  const outputWidth = turn === 90 || turn === 270 ? tileHeight : tileWidth;
  const outputHeight = turn === 90 || turn === 270 ? tileWidth : tileHeight;
  if (![tileWidth, tileHeight, scaleX, scaleY, outputWidth, outputHeight].every(Number.isFinite)
    || tileWidth <= 0 || tileHeight <= 0 || scaleX <= 0 || scaleY <= 0
    || outputWidth <= 0 || outputHeight <= 0) return null;

  // Flips are in source-image coordinates and are applied before rotation,
  // matching drawImageWithTransforms. Reflecting a rotated output instead
  // would swap horizontal and vertical flip behavior at quarter turns.
  const matrix = turn === 90 ? { a: 0, b: scaleX, c: -scaleY, d: 0, e: x + outputWidth, f: y }
    : turn === 180 ? { a: -scaleX, b: 0, c: 0, d: -scaleY, e: x + outputWidth, f: y + outputHeight }
      : turn === 270 ? { a: 0, b: -scaleX, c: scaleY, d: 0, e: x, f: y + outputHeight }
        : { a: scaleX, b: 0, c: 0, d: scaleY, e: x, f: y };
  if (flipHorizontal) {
    const sourceXAxisX = matrix.a;
    const sourceXAxisY = matrix.b;
    matrix.a = -sourceXAxisX;
    matrix.b = -sourceXAxisY;
    matrix.e += sourceXAxisX * imageWidth;
    matrix.f += sourceXAxisY * imageWidth;
  }
  if (flipVertical) {
    const sourceYAxisX = matrix.c;
    const sourceYAxisY = matrix.d;
    matrix.c = -sourceYAxisX;
    matrix.d = -sourceYAxisY;
    matrix.e += sourceYAxisX * imageHeight;
    matrix.f += sourceYAxisY * imageHeight;
  }
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Object.values(matrix).every(Number.isFinite) || !Number.isFinite(determinant) || determinant === 0) return null;
  return { matrix, width: outputWidth, height: outputHeight, tileWidth, tileHeight };
}
