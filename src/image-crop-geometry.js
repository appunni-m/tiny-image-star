import { imageCropPixels, normalizeImageTransforms } from './image-transforms.js';

const CROP_HANDLES = new Set(['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw']);

function normalizedRotation(rotation) {
  return normalizeImageTransforms({ rotation }).rotation;
}

function checkedBounds(bounds) {
  const { left, top, width, height } = bounds || {};
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new TypeError('Displayed image bounds must have finite coordinates and positive dimensions.');
  }
  return { left, top, width, height };
}

function checkedSourceSize(sourceWidth, sourceHeight) {
  if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight)
    || sourceWidth < 1 || sourceHeight < 1) {
    throw new TypeError('Image source dimensions must be positive safe integers.');
  }
  return { width: sourceWidth, height: sourceHeight };
}

function checkedPoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError('Crop pointer coordinates must be finite.');
  }
  return point;
}

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

function sourcePixelRectToDisplay(rect, sourceWidth, sourceHeight, rotation) {
  switch (rotation) {
    case 90:
      return { left: sourceHeight - rect.bottom, top: rect.left, right: sourceHeight - rect.top, bottom: rect.right };
    case 180:
      return { left: sourceWidth - rect.right, top: sourceHeight - rect.bottom, right: sourceWidth - rect.left, bottom: sourceHeight - rect.top };
    case 270:
      return { left: rect.top, top: sourceWidth - rect.right, right: rect.bottom, bottom: sourceWidth - rect.left };
    default:
      return rect;
  }
}

/**
 * Compute both the rendered crop bitmap bounds and the virtual full-source
 * bounds in image-layer-local coordinates. The crop is applied to source
 * pixels before rotation, matching Pillow; the cropped result is then fit and
 * centered inside the layer exactly like the renderer's drawFittedImage().
 * `drawBounds` may extend outside the layer for `cover`. `virtualBounds`
 * locates the complete rotated source behind the current crop, which lets a
 * crop overlay expose pixels outside that crop while preserving its mapping.
 */
export function calculateImageCropDisplayBounds({
  frameWidth,
  frameHeight,
  sourceWidth,
  sourceHeight,
  crop = null,
  rotation = 0,
  fit = 'cover',
}) {
  if (![frameWidth, frameHeight].every(Number.isFinite) || frameWidth <= 0 || frameHeight <= 0) {
    throw new TypeError('Image layer dimensions must be finite and positive.');
  }
  const source = checkedSourceSize(sourceWidth, sourceHeight);
  if (!['cover', 'contain'].includes(fit)) throw new TypeError('Image fit must be cover or contain.');
  const transforms = normalizeImageTransforms({ crop, rotation });
  const sourceCropPixels = imageCropPixels(transforms.crop, source.width, source.height)
    ?? { left: 0, top: 0, right: source.width, bottom: source.height };
  const orientedSourceWidth = transforms.rotation % 180 === 0 ? source.width : source.height;
  const orientedSourceHeight = transforms.rotation % 180 === 0 ? source.height : source.width;
  const displayCropPixels = sourcePixelRectToDisplay(sourceCropPixels, source.width, source.height, transforms.rotation);
  const croppedWidth = displayCropPixels.right - displayCropPixels.left;
  const croppedHeight = displayCropPixels.bottom - displayCropPixels.top;
  const scale = fit === 'contain'
    ? Math.min(frameWidth / croppedWidth, frameHeight / croppedHeight)
    : Math.max(frameWidth / croppedWidth, frameHeight / croppedHeight);
  const drawWidth = croppedWidth * scale;
  const drawHeight = croppedHeight * scale;
  const drawBounds = {
    left: (frameWidth - drawWidth) / 2,
    top: (frameHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
  const virtualBounds = {
    left: drawBounds.left - displayCropPixels.left * scale,
    top: drawBounds.top - displayCropPixels.top * scale,
    width: orientedSourceWidth * scale,
    height: orientedSourceHeight * scale,
  };
  return {
    drawBounds,
    virtualBounds,
    scale,
    orientedSourceSize: { width: orientedSourceWidth, height: orientedSourceHeight },
    croppedImageSize: { width: croppedWidth, height: croppedHeight },
    cropInDisplayPixels: displayCropPixels,
  };
}

function pointInDisplay(point, bounds) {
  checkedPoint(point);
  return {
    x: clamp((point.x - bounds.left) / bounds.width, 0, 1),
    y: clamp((point.y - bounds.top) / bounds.height, 0, 1),
  };
}

function normalizeRect(rect) {
  const { left, top, right, bottom } = rect || {};
  if (![left, top, right, bottom].every(Number.isFinite)
    || left < 0 || top < 0 || right > 1 || bottom > 1 || left >= right || top >= bottom) {
    throw new RangeError('Crop edges must form a non-empty rectangle within the image.');
  }
  return { left, top, right, bottom };
}

/**
 * Express a source-space crop rectangle in the image's displayed orientation.
 * Rotation follows the editor convention: positive 90 degrees is clockwise.
 */
export function imageCropToDisplayRect(crop, rotation = 0) {
  const source = normalizeRect(crop ?? { left: 0, top: 0, right: 1, bottom: 1 });
  switch (normalizedRotation(rotation)) {
    case 90:
      return { left: 1 - source.bottom, top: source.left, right: 1 - source.top, bottom: source.right };
    case 180:
      return { left: 1 - source.right, top: 1 - source.bottom, right: 1 - source.left, bottom: 1 - source.top };
    case 270:
      return { left: source.top, top: 1 - source.right, right: source.bottom, bottom: 1 - source.left };
    default:
      return source;
  }
}

/** Invert an oriented display-space rectangle into the original source axes. */
export function imageCropFromDisplayRect(rect, rotation = 0) {
  const displayed = normalizeRect(rect);
  switch (normalizedRotation(rotation)) {
    case 90:
      return { left: displayed.top, top: 1 - displayed.right, right: displayed.bottom, bottom: 1 - displayed.left };
    case 180:
      return { left: 1 - displayed.right, top: 1 - displayed.bottom, right: 1 - displayed.left, bottom: 1 - displayed.top };
    case 270:
      return { left: 1 - displayed.bottom, top: displayed.left, right: 1 - displayed.top, bottom: displayed.right };
    default:
      return displayed;
  }
}

/**
 * Convert a drag in the displayed, full-source image bounds into a portable
 * crop rectangle normalized against the unrotated source. Bounds must describe
 * the full source image after its current quarter-turn rotation, not the
 * destination layer's clipped Fill/Fit box. Pointer coordinates outside those
 * bounds are clamped. Returns null for a selection smaller than one source
 * pixel along either source axis.
 */
export function imageCropFromDisplayDrag({ start, end, bounds: rawBounds, rotation = 0, sourceWidth, sourceHeight }) {
  const bounds = checkedBounds(rawBounds);
  const source = checkedSourceSize(sourceWidth, sourceHeight);
  const turn = normalizedRotation(rotation);
  const a = pointInDisplay(start, bounds);
  const b = pointInDisplay(end, bounds);
  const displayed = {
    left: Math.min(a.x, b.x), top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y),
  };
  if (turn % 180 !== 0) {
    if ((displayed.right - displayed.left) * source.height < 1
      || (displayed.bottom - displayed.top) * source.width < 1) return null;
  } else if ((displayed.right - displayed.left) * source.width < 1
    || (displayed.bottom - displayed.top) * source.height < 1) return null;
  return imageCropFromDisplayRect(displayed, turn);
}

/**
 * Move one or more crop handles in displayed coordinates and return the
 * resulting source-normalized crop. A moved edge cannot cross its opposite
 * edge; it is clamped to leave at least one source pixel in each axis.
 */
export function moveImageCropHandle({ crop, handle, point, bounds: rawBounds, rotation = 0, sourceWidth, sourceHeight }) {
  if (!CROP_HANDLES.has(handle)) throw new TypeError('Choose a crop handle: n, e, s, w, nw, ne, se, or sw.');
  const bounds = checkedBounds(rawBounds);
  const source = checkedSourceSize(sourceWidth, sourceHeight);
  const turn = normalizedRotation(rotation);
  const displayed = imageCropToDisplayRect(crop, turn);
  const position = pointInDisplay(point, bounds);
  const minWidth = 1 / (turn % 180 === 0 ? source.width : source.height);
  const minHeight = 1 / (turn % 180 === 0 ? source.height : source.width);

  if (handle.includes('w')) displayed.left = Math.min(position.x, displayed.right - minWidth);
  if (handle.includes('e')) displayed.right = Math.max(position.x, displayed.left + minWidth);
  if (handle.includes('n')) displayed.top = Math.min(position.y, displayed.bottom - minHeight);
  if (handle.includes('s')) displayed.bottom = Math.max(position.y, displayed.top + minHeight);
  displayed.left = clamp(displayed.left, 0, 1 - minWidth);
  displayed.right = clamp(displayed.right, displayed.left + minWidth, 1);
  displayed.top = clamp(displayed.top, 0, 1 - minHeight);
  displayed.bottom = clamp(displayed.bottom, displayed.top + minHeight, 1);
  return imageCropFromDisplayRect(displayed, turn);
}
