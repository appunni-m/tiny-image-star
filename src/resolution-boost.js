export const RESOLUTION_BOOST_SCALE = 4;
export const RESOLUTION_BOOST_TILE_SIZE = 256;
export const RESOLUTION_BOOST_TILE_HALO = 32;
export const MAX_RESOLUTION_BOOST_SOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_RESOLUTION_BOOST_OUTPUT_BYTES = 64 * 1024 * 1024;
export const MAX_RESOLUTION_BOOST_SOURCE_PIXELS = 524_288;
export const MAX_RESOLUTION_BOOST_SOURCE_EDGE = 2_048;
export const MAX_RESOLUTION_BOOST_OUTPUT_PIXELS = 8_388_608;

export function validateResolutionBoostDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 16 || height < 16
    || width > MAX_RESOLUTION_BOOST_SOURCE_EDGE || height > MAX_RESOLUTION_BOOST_SOURCE_EDGE) {
    throw new RangeError('Resolution boost supports image dimensions from 16 through 2,048 pixels per edge.');
  }
  const sourcePixels = width * height;
  const outputWidth = width * RESOLUTION_BOOST_SCALE;
  const outputHeight = height * RESOLUTION_BOOST_SCALE;
  const outputPixels = outputWidth * outputHeight;
  if (!Number.isSafeInteger(sourcePixels) || sourcePixels > MAX_RESOLUTION_BOOST_SOURCE_PIXELS
    || !Number.isSafeInteger(outputPixels) || outputPixels > MAX_RESOLUTION_BOOST_OUTPUT_PIXELS) {
    throw new RangeError('Resolution boost is limited to 524,288 source pixels and 8,388,608 output pixels on this device.');
  }
  return { sourcePixels, outputWidth, outputHeight, outputPixels };
}

export function resolutionBoostTiles(width, height, {
  tileSize = RESOLUTION_BOOST_TILE_SIZE,
  halo = RESOLUTION_BOOST_TILE_HALO,
} = {}) {
  validateResolutionBoostDimensions(width, height);
  if (!Number.isSafeInteger(tileSize) || tileSize < 64 || tileSize > 512
    || !Number.isSafeInteger(halo) || halo < 0 || halo * 2 >= tileSize) {
    throw new RangeError('Resolution boost tile geometry is invalid.');
  }
  const coreSize = tileSize - halo * 2;
  const tiles = [];
  for (let top = 0; top < height; top += coreSize) {
    const coreHeight = Math.min(coreSize, height - top);
    const inputTop = Math.max(0, top - halo);
    const inputBottom = Math.min(height, top + coreHeight + halo);
    for (let left = 0; left < width; left += coreSize) {
      const coreWidth = Math.min(coreSize, width - left);
      const inputLeft = Math.max(0, left - halo);
      const inputRight = Math.min(width, left + coreWidth + halo);
      tiles.push({
        input: { left: inputLeft, top: inputTop, width: inputRight - inputLeft, height: inputBottom - inputTop },
        core: {
          left,
          top,
          width: coreWidth,
          height: coreHeight,
          inputOffsetX: left - inputLeft,
          inputOffsetY: top - inputTop,
        },
        outputWidth: coreWidth * RESOLUTION_BOOST_SCALE,
        outputHeight: coreHeight * RESOLUTION_BOOST_SCALE,
        fullOutputWidth: width * RESOLUTION_BOOST_SCALE,
        fullOutputHeight: height * RESOLUTION_BOOST_SCALE,
      });
    }
  }
  return tiles;
}

export function rgbaPixelsToNchw(rgba, width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Resolution boost tile dimensions must be positive integers.');
  }
  const pixels = width * height;
  if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== pixels * 4) {
    throw new TypeError('Resolution boost needs a complete RGBA image tile.');
  }
  const chw = new Float32Array(pixels * 3);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const source = pixel * 4;
    chw[pixel] = rgba[source] / 255;
    chw[pixels + pixel] = rgba[source + 1] / 255;
    chw[pixels * 2 + pixel] = rgba[source + 2] / 255;
  }
  return chw;
}

export function copyResolutionBoostTile(outputRgba, outputNchw, inputWidth, tile) {
  if (!tile || !Number.isSafeInteger(inputWidth) || inputWidth < 1
    || !Number.isSafeInteger(tile.input?.height) || tile.input.height < 1
    || !Number.isSafeInteger(tile.input?.width) || tile.input.width !== inputWidth
    || !Number.isSafeInteger(tile.fullOutputWidth) || tile.fullOutputWidth < 1
    || !Number.isSafeInteger(tile.fullOutputHeight) || tile.fullOutputHeight < 1
    || !Number.isSafeInteger(tile.core?.left) || tile.core.left < 0
    || !Number.isSafeInteger(tile.core?.top) || tile.core.top < 0
    || !Number.isSafeInteger(tile.core?.width) || tile.core.width < 1
    || !Number.isSafeInteger(tile.core?.height) || tile.core.height < 1
    || !Number.isSafeInteger(tile.core?.inputOffsetX) || tile.core.inputOffsetX < 0
    || !Number.isSafeInteger(tile.core?.inputOffsetY) || tile.core.inputOffsetY < 0) {
    throw new TypeError('Resolution boost returned invalid tile geometry.');
  }
  const outputWidth = inputWidth * RESOLUTION_BOOST_SCALE;
  const inputHeight = tile.input.height;
  const outputHeight = inputHeight * RESOLUTION_BOOST_SCALE;
  const inputPixels = inputWidth * inputHeight;
  if (!(outputRgba instanceof Uint8ClampedArray) || outputRgba.length !== tile.fullOutputWidth * tile.fullOutputHeight * 4
    || !(outputNchw instanceof Float32Array) || outputNchw.length !== inputPixels * RESOLUTION_BOOST_SCALE ** 2 * 3
    || tile.outputWidth !== tile.core.width * RESOLUTION_BOOST_SCALE
    || tile.outputHeight !== tile.core.height * RESOLUTION_BOOST_SCALE) {
    throw new TypeError('Resolution boost returned an invalid tile.');
  }
  if (tile.fullOutputWidth % RESOLUTION_BOOST_SCALE !== 0
    || tile.fullOutputHeight % RESOLUTION_BOOST_SCALE !== 0
    || tile.core.left + tile.core.width > tile.fullOutputWidth / RESOLUTION_BOOST_SCALE
    || tile.core.top + tile.core.height > tile.fullOutputHeight / RESOLUTION_BOOST_SCALE
    || tile.core.inputOffsetX + tile.core.width > inputWidth
    || tile.core.inputOffsetY + tile.core.height > inputHeight
    || tile.input.left + tile.core.inputOffsetX !== tile.core.left
    || tile.input.top + tile.core.inputOffsetY !== tile.core.top) {
    throw new TypeError('Resolution boost tile lies outside its destination image.');
  }
  const inputOffsetX = tile.core.inputOffsetX * RESOLUTION_BOOST_SCALE;
  const inputOffsetY = tile.core.inputOffsetY * RESOLUTION_BOOST_SCALE;
  const coreWidth = tile.core.width * RESOLUTION_BOOST_SCALE;
  const coreHeight = tile.core.height * RESOLUTION_BOOST_SCALE;
  const planeSize = outputWidth * outputHeight;
  for (let row = 0; row < coreHeight; row += 1) {
    const sourceStart = (inputOffsetY + row) * outputWidth + inputOffsetX;
    const targetStart = ((tile.core.top * RESOLUTION_BOOST_SCALE + row) * tile.fullOutputWidth
      + tile.core.left * RESOLUTION_BOOST_SCALE) * 4;
    for (let column = 0; column < coreWidth; column += 1) {
      const source = sourceStart + column;
      const target = targetStart + column * 4;
      outputRgba[target] = Math.round(Math.max(0, Math.min(1, outputNchw[source])) * 255);
      outputRgba[target + 1] = Math.round(Math.max(0, Math.min(1, outputNchw[planeSize + source])) * 255);
      outputRgba[target + 2] = Math.round(Math.max(0, Math.min(1, outputNchw[planeSize * 2 + source])) * 255);
    }
  }
}

export function upscaleRgbaAlpha(outputRgba, sourceRgba, width, height) {
  const { outputWidth, outputHeight } = validateResolutionBoostDimensions(width, height);
  if (!(sourceRgba instanceof Uint8Array || sourceRgba instanceof Uint8ClampedArray)
    || sourceRgba.length !== width * height * 4
    || !(outputRgba instanceof Uint8ClampedArray) || outputRgba.length !== outputWidth * outputHeight * 4) {
    throw new TypeError('Resolution boost alpha inputs do not match the image dimensions.');
  }
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = Math.max(0, Math.min(height - 1, (y + 0.5) / RESOLUTION_BOOST_SCALE - 0.5));
    const top = Math.floor(sourceY);
    const bottom = Math.min(height - 1, top + 1);
    const fy = sourceY - top;
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = Math.max(0, Math.min(width - 1, (x + 0.5) / RESOLUTION_BOOST_SCALE - 0.5));
      const left = Math.floor(sourceX);
      const right = Math.min(width - 1, left + 1);
      const fx = sourceX - left;
      const topLeft = sourceRgba[(top * width + left) * 4 + 3];
      const topRight = sourceRgba[(top * width + right) * 4 + 3];
      const bottomLeft = sourceRgba[(bottom * width + left) * 4 + 3];
      const bottomRight = sourceRgba[(bottom * width + right) * 4 + 3];
      const alphaTop = topLeft + (topRight - topLeft) * fx;
      const alphaBottom = bottomLeft + (bottomRight - bottomLeft) * fx;
      outputRgba[(y * outputWidth + x) * 4 + 3] = Math.round(alphaTop + (alphaBottom - alphaTop) * fy);
    }
  }
}
