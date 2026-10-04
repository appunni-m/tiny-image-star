import { imageCropPixels, normalizeImageTransforms } from './image-transforms.js';

const CROP_HANDLES = new Set(['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw']);

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

function imageDisplaySize(source, rotation) {
  return rotation % 180 === 0
    ? { width: source.width, height: source.height }
    : { width: source.height, height: source.width };
}

function checkedAspectRatio(aspectRatio) {
  if (aspectRatio == null) return null;
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new TypeError('Crop aspect ratio must be a finite positive width-to-height ratio.');
  }
  return aspectRatio;
}

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

function flipDisplayRect(rect, width, height, flipHorizontal, flipVertical) {
  return {
    left: flipHorizontal ? width - rect.right : rect.left,
    top: flipVertical ? height - rect.bottom : rect.top,
    right: flipHorizontal ? width - rect.left : rect.right,
    bottom: flipVertical ? height - rect.top : rect.bottom,
  };
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
  flipHorizontal = false,
  flipVertical = false,
  fit = 'cover',
}) {
  if (![frameWidth, frameHeight].every(Number.isFinite) || frameWidth <= 0 || frameHeight <= 0) {
    throw new TypeError('Image layer dimensions must be finite and positive.');
  }
  const source = checkedSourceSize(sourceWidth, sourceHeight);
  if (!['cover', 'contain'].includes(fit)) throw new TypeError('Image fit must be cover or contain.');
  const transforms = normalizeImageTransforms({ crop, rotation, flipHorizontal, flipVertical });
  const sourceCropPixels = imageCropPixels(transforms.crop, source.width, source.height)
    ?? { left: 0, top: 0, right: source.width, bottom: source.height };
  const orientedSourceWidth = transforms.rotation % 180 === 0 ? source.width : source.height;
  const orientedSourceHeight = transforms.rotation % 180 === 0 ? source.height : source.width;
  const displayCropPixels = flipDisplayRect(
    sourcePixelRectToDisplay(sourceCropPixels, source.width, source.height, transforms.rotation),
    orientedSourceWidth, orientedSourceHeight, transforms.flipHorizontal, transforms.flipVertical,
  );
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
export function imageCropToDisplayRect(crop, rotation = 0, flips = {}) {
  const source = normalizeRect(crop ?? { left: 0, top: 0, right: 1, bottom: 1 });
  const transforms = normalizeImageTransforms({ rotation, ...flips });
  let displayed;
  switch (transforms.rotation) {
    case 90:
      displayed = { left: 1 - source.bottom, top: source.left, right: 1 - source.top, bottom: source.right }; break;
    case 180:
      displayed = { left: 1 - source.right, top: 1 - source.bottom, right: 1 - source.left, bottom: 1 - source.top }; break;
    case 270:
      displayed = { left: source.top, top: 1 - source.right, right: source.bottom, bottom: 1 - source.left }; break;
    default:
      displayed = source;
  }
  if (transforms.flipHorizontal) displayed = { ...displayed, left: 1 - displayed.right, right: 1 - displayed.left };
  if (transforms.flipVertical) displayed = { ...displayed, top: 1 - displayed.bottom, bottom: 1 - displayed.top };
  return displayed;
}

/** Invert an oriented display-space rectangle into the original source axes. */
export function imageCropFromDisplayRect(rect, rotation = 0, flips = {}) {
  let displayed = normalizeRect(rect);
  const transforms = normalizeImageTransforms({ rotation, ...flips });
  if (transforms.flipHorizontal) displayed = { ...displayed, left: 1 - displayed.right, right: 1 - displayed.left };
  if (transforms.flipVertical) displayed = { ...displayed, top: 1 - displayed.bottom, bottom: 1 - displayed.top };
  switch (transforms.rotation) {
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
 * Constrain a drag to the selected width-to-height ratio in the image's
 * currently displayed orientation. The returned points are in the original
 * display coordinate system so they can also be used for a live crop marquee.
 * A null ratio keeps the drag free-form.
 */
export function constrainImageCropDisplayDrag({ start, end, bounds: rawBounds, rotation = 0, flipHorizontal = false, flipVertical = false, sourceWidth, sourceHeight, aspectRatio = null }) {
  const bounds = checkedBounds(rawBounds);
  const source = checkedSourceSize(sourceWidth, sourceHeight);
  const transforms = normalizeImageTransforms({ rotation, flipHorizontal, flipVertical });
  const ratio = checkedAspectRatio(aspectRatio);
  const size = imageDisplaySize(source, transforms.rotation);
  const a = pointInDisplay(start, bounds);
  const b = pointInDisplay(end, bounds);
  if (!ratio) {
    return {
      start: { x: bounds.left + a.x * bounds.width, y: bounds.top + a.y * bounds.height },
      end: { x: bounds.left + b.x * bounds.width, y: bounds.top + b.y * bounds.height },
    };
  }

  const anchorX = a.x * size.width;
  const anchorY = a.y * size.height;
  const directionX = Math.sign(b.x - a.x) || 1;
  const directionY = Math.sign(b.y - a.y) || 1;
  const rawWidth = Math.abs((b.x - a.x) * size.width);
  const rawHeight = Math.abs((b.y - a.y) * size.height);
  if (rawWidth === 0 && rawHeight === 0) return null;

  let width; let height;
  if (rawWidth / Math.max(rawHeight, Number.EPSILON) > ratio) {
    width = rawWidth;
    height = width / ratio;
  } else {
    height = rawHeight;
    width = height * ratio;
  }

  const minWidth = Math.max(1, ratio);
  const maxWidth = Math.min(
    directionX > 0 ? size.width - anchorX : anchorX,
    (directionY > 0 ? size.height - anchorY : anchorY) * ratio,
  );
  if (maxWidth < minWidth) return null;
  width = clamp(Math.max(width, minWidth), minWidth, maxWidth);
  height = width / ratio;
  const endX = (anchorX + directionX * width) / size.width;
  const endY = (anchorY + directionY * height) / size.height;
  return {
    start: { x: bounds.left + a.x * bounds.width, y: bounds.top + a.y * bounds.height },
    end: { x: bounds.left + endX * bounds.width, y: bounds.top + endY * bounds.height },
  };
}

/**
 * Convert a drag in the displayed, full-source image bounds into a portable
 * crop rectangle normalized against the unrotated source. Bounds must describe
 * the full source image after its current quarter-turn rotation, not the
 * destination layer's clipped Fill/Fit box. Pointer coordinates outside those
 * bounds are clamped. Returns null for a selection smaller than one source
 * pixel along either source axis.
 */
export function imageCropFromDisplayDrag({ start, end, bounds: rawBounds, rotation = 0, flipHorizontal = false, flipVertical = false, sourceWidth, sourceHeight, aspectRatio = null }) {
  const bounds = checkedBounds(rawBounds);
  const source = checkedSourceSize(sourceWidth, sourceHeight);
  const transforms = normalizeImageTransforms({ rotation, flipHorizontal, flipVertical });
  const constrained = constrainImageCropDisplayDrag({
    start, end, bounds, rotation: transforms.rotation, flipHorizontal: transforms.flipHorizontal,
    flipVertical: transforms.flipVertical, sourceWidth: source.width, sourceHeight: source.height, aspectRatio,
  });
  if (!constrained) return null;
  const turn = transforms.rotation;
  const a = pointInDisplay(constrained.start, bounds);
  const b = pointInDisplay(constrained.end, bounds);
  const displayed = {
    left: Math.min(a.x, b.x), top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y),
  };
  if (turn % 180 !== 0) {
    if ((displayed.right - displayed.left) * source.height < 1
      || (displayed.bottom - displayed.top) * source.width < 1) return null;
  } else if ((displayed.right - displayed.left) * source.width < 1
    || (displayed.bottom - displayed.top) * source.height < 1) return null;
  return imageCropFromDisplayRect(displayed, turn, transforms);
}

/**
 * Move one or more crop handles in displayed coordinates and return the
 * resulting source-normalized crop. A moved edge cannot cross its opposite
 * edge; it is clamped to leave at least one source pixel in each axis.
 */
function moveAspectLockedCropHandle(displayed, handle, position, size, ratio) {
  const left = displayed.left * size.width;
  const right = displayed.right * size.width;
  const top = displayed.top * size.height;
  const bottom = displayed.bottom * size.height;
  const minWidth = Math.max(1, ratio);
  const minHeight = Math.max(1, 1 / ratio);
  let rect;

  if (handle.length === 2) {
    const anchorX = handle.includes('w') ? right : left;
    const anchorY = handle.includes('n') ? bottom : top;
    const directionX = handle.includes('w') ? -1 : 1;
    const directionY = handle.includes('n') ? -1 : 1;
    const rawWidth = Math.abs(position.x * size.width - anchorX);
    const rawHeight = Math.abs(position.y * size.height - anchorY);
    let width; let height;
    if (rawWidth / Math.max(rawHeight, Number.EPSILON) > ratio) {
      width = rawWidth;
      height = width / ratio;
    } else {
      height = rawHeight;
      width = height * ratio;
    }
    const maxWidth = Math.min(
      directionX > 0 ? size.width - anchorX : anchorX,
      (directionY > 0 ? size.height - anchorY : anchorY) * ratio,
    );
    if (maxWidth < minWidth) return displayed;
    width = clamp(Math.max(width, minWidth), minWidth, maxWidth);
    height = width / ratio;
    const movingX = anchorX + directionX * width;
    const movingY = anchorY + directionY * height;
    rect = {
      left: Math.min(anchorX, movingX) / size.width,
      top: Math.min(anchorY, movingY) / size.height,
      right: Math.max(anchorX, movingX) / size.width,
      bottom: Math.max(anchorY, movingY) / size.height,
    };
  } else if (handle === 'e' || handle === 'w') {
    const anchorX = handle === 'w' ? right : left;
    const direction = handle === 'w' ? -1 : 1;
    const centerY = (top + bottom) / 2;
    const availableX = direction > 0 ? size.width - anchorX : anchorX;
    const availableY = 2 * Math.min(centerY, size.height - centerY);
    const maxWidth = Math.min(availableX, availableY * ratio);
    if (maxWidth < minWidth) return displayed;
    const width = clamp(Math.abs(position.x * size.width - anchorX), minWidth, maxWidth);
    const height = width / ratio;
    const movingX = anchorX + direction * width;
    rect = {
      left: Math.min(anchorX, movingX) / size.width,
      top: (centerY - height / 2) / size.height,
      right: Math.max(anchorX, movingX) / size.width,
      bottom: (centerY + height / 2) / size.height,
    };
  } else {
    const anchorY = handle === 'n' ? bottom : top;
    const direction = handle === 'n' ? -1 : 1;
    const centerX = (left + right) / 2;
    const availableY = direction > 0 ? size.height - anchorY : anchorY;
    const availableX = 2 * Math.min(centerX, size.width - centerX);
    const maxHeight = Math.min(availableY, availableX / ratio);
    if (maxHeight < minHeight) return displayed;
    const height = clamp(Math.abs(position.y * size.height - anchorY), minHeight, maxHeight);
    const width = height * ratio;
    const movingY = anchorY + direction * height;
    rect = {
      left: (centerX - width / 2) / size.width,
      top: Math.min(anchorY, movingY) / size.height,
      right: (centerX + width / 2) / size.width,
      bottom: Math.max(anchorY, movingY) / size.height,
    };
  }
  return {
    left: clamp(rect.left, 0, 1),
    top: clamp(rect.top, 0, 1),
    right: clamp(rect.right, 0, 1),
    bottom: clamp(rect.bottom, 0, 1),
  };
}

export function moveImageCropHandle({ crop, handle, point, bounds: rawBounds, rotation = 0, flipHorizontal = false, flipVertical = false, sourceWidth, sourceHeight, aspectRatio = null }) {
  if (!CROP_HANDLES.has(handle)) throw new TypeError('Choose a crop handle: n, e, s, w, nw, ne, se, or sw.');
  const bounds = checkedBounds(rawBounds);
  const source = checkedSourceSize(sourceWidth, sourceHeight);
  const transforms = normalizeImageTransforms({ rotation, flipHorizontal, flipVertical });
  const turn = transforms.rotation;
  const displayed = imageCropToDisplayRect(crop, turn, transforms);
  const position = pointInDisplay(point, bounds);
  const ratio = checkedAspectRatio(aspectRatio);
  if (ratio) {
    return imageCropFromDisplayRect(
      moveAspectLockedCropHandle(displayed, handle, position, imageDisplaySize(source, turn), ratio),
      turn, transforms,
    );
  }
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
  return imageCropFromDisplayRect(displayed, turn, transforms);
}
