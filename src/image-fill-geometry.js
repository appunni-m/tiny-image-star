import { normalizeImageTransforms } from './image-transforms.js';
import { imageCropFromDisplayRect, imageCropToDisplayRect } from './image-crop-geometry.js';

function checkedSourceSize(sourceWidth, sourceHeight) {
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight)
    || sourceWidth < 1 || sourceHeight < 1) {
    throw new TypeError('Image source dimensions must be positive safe integers.');
  }
  return { width: sourceWidth, height: sourceHeight };
}

function checkedFrameSize(frameWidth, frameHeight) {
  if (![frameWidth, frameHeight].every(Number.isFinite) || frameWidth <= 0 || frameHeight <= 0) {
    throw new TypeError('Image fill frame dimensions must be finite and positive.');
  }
  return { width: frameWidth, height: frameHeight };
}

function checkedBounds(bounds) {
  const { left, top, width, height } = bounds || {};
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new TypeError('Full-source display bounds must have finite coordinates and positive dimensions.');
  }
  return { left, top, width, height };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampRect(rect) {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const left = clamp(rect.left, 0, 1 - width);
  const top = clamp(rect.top, 0, 1 - height);
  return { left, top, right: left + width, bottom: top + height };
}

function orientedSize(source, rotation) {
  return rotation % 180 === 0
    ? { width: source.width, height: source.height }
    : { width: source.height, height: source.width };
}

function fitCropWindow(crop, source, frame, fit) {
  if (fit === 'contain') return crop;

  const width = crop.right - crop.left;
  const height = crop.bottom - crop.top;
  const physicalAspect = (width * source.width) / (height * source.height);
  const frameAspect = frame.width / frame.height;
  const centeredCrop = (axis, fittedSize) => {
    const size = axis === 'x' ? width : height;
    if (!Number.isFinite(fittedSize) || fittedSize <= 0 || fittedSize > size) return null;
    const inset = (size - fittedSize) / 2;
    const fitted = axis === 'x'
      ? { ...crop, left: crop.left + inset, right: crop.right - inset }
      : { ...crop, top: crop.top + inset, bottom: crop.bottom - inset };
    return fitted.left < fitted.right && fitted.top < fitted.bottom ? fitted : null;
  };

  // Keep the direct arithmetic for ordinary image sizes. If an aspect ratio
  // overflows/underflows, or an intermediate product loses the crop, recover
  // using log ratios so finite input dimensions do not create a zero-width
  // or zero-height result.
  if (Number.isFinite(physicalAspect) && physicalAspect > 0
    && Number.isFinite(frameAspect) && frameAspect > 0) {
    if (physicalAspect > frameAspect) {
      const fittedWidth = height * frameAspect * source.height / source.width;
      const direct = centeredCrop('x', fittedWidth);
      if (direct) return direct;
    } else if (physicalAspect < frameAspect) {
      const fittedHeight = width * source.width / frameAspect / source.height;
      const direct = centeredCrop('y', fittedHeight);
      if (direct) return direct;
    } else {
      return crop;
    }
  }

  const logPhysicalAspect = Math.log(width) + Math.log(source.width)
    - Math.log(height) - Math.log(source.height);
  const logFrameAspect = Math.log(frame.width) - Math.log(frame.height);
  const aspectDifference = logPhysicalAspect - logFrameAspect;
  if (aspectDifference > 0) {
    const fittedWidth = width * Math.exp(-aspectDifference);
    const recovered = centeredCrop('x', fittedWidth);
    if (recovered) return recovered;
  } else if (aspectDifference < 0) {
    const fittedHeight = height * Math.exp(aspectDifference);
    const recovered = centeredCrop('y', fittedHeight);
    if (recovered) return recovered;
  } else {
    return crop;
  }

  throw new RangeError('Image fill aspect ratio is too extreme to represent a non-empty crop.');
}

function sourceCropToDisplayed(crop, transforms) {
  return imageCropToDisplayRect(crop, transforms.rotation, transforms);
}

function displayedCropToSource(crop, transforms) {
  return imageCropFromDisplayRect(crop, transforms.rotation, transforms);
}

/**
 * Return the visible image window in displayed-oriented normalized coordinates.
 * Explicit source crops are mapped through rotation and flips. Fill (`cover`)
 * trims that crop to the frame's aspect ratio; with no explicit crop, this is
 * the centered cover window. Fit (`contain`) keeps the whole image when there
 * is no explicit crop.
 */
export function calculateImageFillCropWindow({
  frameWidth,
  frameHeight,
  sourceWidth,
  sourceHeight,
  transforms = {},
  fit = 'cover',
} = {}) {
  const frame = checkedFrameSize(frameWidth, frameHeight);
  const source = checkedSourceSize(sourceWidth, sourceHeight);
  if (!['cover', 'contain'].includes(fit)) throw new TypeError('Image fill fit must be cover or contain.');
  const imageTransforms = normalizeImageTransforms(transforms || {});
  const displaySource = orientedSize(source, imageTransforms.rotation);
  const sourceCrop = imageTransforms.crop
    ? sourceCropToDisplayed(imageTransforms.crop, imageTransforms)
    : { left: 0, top: 0, right: 1, bottom: 1 };
  return fitCropWindow(sourceCrop, displaySource, frame, fit);
}

/**
 * Pan the visible crop window by a node-local pointer delta. Dragging the image
 * right reveals pixels to its right, so the source window moves left.
 */
export function moveImageFillCropWindow({
  crop,
  deltaX,
  deltaY,
  bounds: rawBounds,
  sourceWidth,
  sourceHeight,
  rotation = 0,
  flipHorizontal = false,
  flipVertical = false,
} = {}) {
  checkedSourceSize(sourceWidth, sourceHeight);
  const bounds = checkedBounds(rawBounds);
  if (![deltaX, deltaY].every(Number.isFinite)) throw new TypeError('Image fill pan deltas must be finite.');
  const transforms = normalizeImageTransforms({ rotation, flipHorizontal, flipVertical });
  const displayed = sourceCropToDisplayed(crop, transforms);
  const width = displayed.right - displayed.left;
  const height = displayed.bottom - displayed.top;
  const moved = clampRect({
    ...displayed,
    left: displayed.left - deltaX / bounds.width,
    top: displayed.top - deltaY / bounds.height,
    right: displayed.left - deltaX / bounds.width + width,
    bottom: displayed.top - deltaY / bounds.height + height,
  });
  return displayedCropToSource(moved, transforms);
}

/**
 * Zoom around a node-local focal point. `zoom > 1` shrinks the visible window;
 * zooming out is bounded by the full source. The focal point is held in place
 * until a source edge prevents further movement.
 */
export function zoomImageFillCropWindow({
  crop,
  zoom,
  focal,
  bounds: rawBounds,
  sourceWidth,
  sourceHeight,
  rotation = 0,
  flipHorizontal = false,
  flipVertical = false,
} = {}) {
  const source = checkedSourceSize(sourceWidth, sourceHeight);
  const bounds = checkedBounds(rawBounds);
  if (!Number.isFinite(zoom) || zoom <= 0) throw new TypeError('Image fill zoom must be finite and positive.');
  if (!focal || !Number.isFinite(focal.x) || !Number.isFinite(focal.y)) {
    throw new TypeError('Image fill zoom focal coordinates must be finite.');
  }
  const transforms = normalizeImageTransforms({ rotation, flipHorizontal, flipVertical });
  const displayed = sourceCropToDisplayed(crop, transforms);
  const currentWidth = displayed.right - displayed.left;
  const currentHeight = displayed.bottom - displayed.top;
  const focalX = clamp((focal.x - bounds.left) / bounds.width, 0, 1);
  const focalY = clamp((focal.y - bounds.top) / bounds.height, 0, 1);

  // Do not zoom beyond one source pixel on either axis. This also protects the
  // normalized rectangle from collapsing under very large finite zoom values.
  const displaySource = orientedSize(source, transforms.rotation);
  const maxZoomX = currentWidth >= 1 / displaySource.width ? currentWidth * displaySource.width : 1;
  const maxZoomY = currentHeight >= 1 / displaySource.height ? currentHeight * displaySource.height : 1;
  const maxZoom = Math.max(1, Math.min(maxZoomX, maxZoomY));
  // A crop cannot grow beyond the full source when zooming out.
  const minZoom = Math.max(currentWidth, currentHeight);
  const effectiveZoom = clamp(zoom, minZoom, maxZoom);
  const width = currentWidth / effectiveZoom;
  const height = currentHeight / effectiveZoom;
  const left = focalX - (focalX - displayed.left) / effectiveZoom;
  const top = focalY - (focalY - displayed.top) / effectiveZoom;
  const zoomed = clampRect({ left, top, right: left + width, bottom: top + height });
  return displayedCropToSource(zoomed, transforms);
}
