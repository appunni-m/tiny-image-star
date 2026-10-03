import { nodeToParentTransform, nodeLocalToPage, pageToParentLocal, transformPoint } from './transform-geometry.js';
import { isValidImageEraseStrokes } from './inpaint-mask.js';

const SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);

/** Normalize side amounts as fractions of the corresponding source dimension. */
export function normalizeImageExpansionRatio(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Image expansion needs top, right, bottom, and left percentages.');
  }
  const ratio = {};
  for (const side of SIDES) {
    const amount = value[side] ?? 0;
    if (!Number.isFinite(amount) || amount < 0 || amount > 1) {
      throw new RangeError(`Image expansion ${side} must be between 0 and 100 percent.`);
    }
    ratio[side] = amount;
  }
  if (!SIDES.some(side => ratio[side] > 0)) {
    throw new RangeError('Expand the image on at least one side.');
  }
  return Object.freeze(ratio);
}

export function isValidImageExpansionRatio(value) {
  try { normalizeImageExpansionRatio(value); return true; }
  catch { return false; }
}

/** Validate the persistent undo/source reference for an expanded image layer. */
export function isValidImageExpansionState(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.sourceImageAssetId !== 'string' || !value.sourceImageAssetId.trim()
      || !Number.isSafeInteger(value.sourceWidth) || value.sourceWidth < 1
      || !Number.isSafeInteger(value.sourceHeight) || value.sourceHeight < 1
      || !value.originalGeometry || typeof value.originalGeometry !== 'object' || Array.isArray(value.originalGeometry)) return false;
    normalizeImageExpansionRatio(value.paddingRatio);
    const { x, y, width, height } = value.originalGeometry;
    return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
      && (value.originalInpaintStrokes == null || isValidImageEraseStrokes(value.originalInpaintStrokes));
  } catch {
    return false;
  }
}

/** Convert a saved source-relative recipe into integer pixels for this image. */
export function imageExpansionPaddingFromRatio(sourceWidth, sourceHeight, value) {
  if (!Number.isSafeInteger(sourceWidth) || sourceWidth < 1
    || !Number.isSafeInteger(sourceHeight) || sourceHeight < 1) {
    throw new TypeError('Image expansion needs valid source dimensions.');
  }
  const ratio = normalizeImageExpansionRatio(value);
  return Object.freeze({
    top: ratio.top ? Math.max(1, Math.round(sourceHeight * ratio.top)) : 0,
    right: ratio.right ? Math.max(1, Math.round(sourceWidth * ratio.right)) : 0,
    bottom: ratio.bottom ? Math.max(1, Math.round(sourceHeight * ratio.bottom)) : 0,
    left: ratio.left ? Math.max(1, Math.round(sourceWidth * ratio.left)) : 0,
  });
}

/**
 * Grow an image layer around its source pixels. Existing source pixel locations
 * remain fixed in page space, including under node rotation, affine transforms,
 * and transformed ancestors.
 */
export function expandedImageLayerGeometry(node, ancestors, sourceWidth, sourceHeight, padding) {
  if (!node || typeof node !== 'object' || !Array.isArray(ancestors)
    || !Number.isFinite(node.width) || node.width <= 0
    || !Number.isFinite(node.height) || node.height <= 0
    || !Number.isSafeInteger(sourceWidth) || sourceWidth < 1
    || !Number.isSafeInteger(sourceHeight) || sourceHeight < 1
    || !padding || typeof padding !== 'object') {
    throw new TypeError('Image expansion needs a layer, its ancestors, source dimensions, and padding.');
  }
  const left = padding.left ?? 0;
  const top = padding.top ?? 0;
  const right = padding.right ?? 0;
  const bottom = padding.bottom ?? 0;
  if (![left, top, right, bottom].every(value => Number.isSafeInteger(value) && value >= 0)
    || left + right + top + bottom === 0) {
    throw new TypeError('Image expansion padding must contain non-negative integer pixels.');
  }
  const width = sourceWidth + left + right;
  const height = sourceHeight + top + bottom;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new RangeError('Expanded image geometry exceeds the safe integer limit.');
  }

  const oldOriginPage = nodeLocalToPage(node, { x: 0, y: 0 }, ancestors);
  const oldOriginParent = pageToParentLocal(oldOriginPage, ancestors);
  const expanded = {
    ...node,
    x: 0,
    y: 0,
    width: node.width * width / sourceWidth,
    height: node.height * height / sourceHeight,
  };
  if (![expanded.width, expanded.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Expanded image geometry is outside the supported layer bounds.');
  }
  const originalPixelOffset = {
    x: node.width * left / sourceWidth,
    y: node.height * top / sourceHeight,
  };
  const offsetInParent = transformPoint(nodeToParentTransform(expanded), originalPixelOffset);
  expanded.x = oldOriginParent.x - offsetInParent.x;
  expanded.y = oldOriginParent.y - offsetInParent.y;
  return Object.freeze({ x: expanded.x, y: expanded.y, width: expanded.width, height: expanded.height });
}

/** Map existing source-relative erase marks to the expanded pixel rectangle. */
export function remapImageEraseStrokesForExpansion(strokes, sourceWidth, sourceHeight, padding) {
  if (!Array.isArray(strokes)) throw new TypeError('Image erase strokes must be a list.');
  const left = padding?.left ?? 0;
  const top = padding?.top ?? 0;
  const right = padding?.right ?? 0;
  const bottom = padding?.bottom ?? 0;
  const expandedWidth = sourceWidth + left + right;
  const expandedHeight = sourceHeight + top + bottom;
  const sourceMinimum = Math.min(sourceWidth, sourceHeight);
  const expandedMinimum = Math.min(expandedWidth, expandedHeight);
  if (![sourceWidth, sourceHeight, expandedWidth, expandedHeight, sourceMinimum, expandedMinimum]
    .every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError('Image erase remapping needs valid source and expanded dimensions.');
  }
  return strokes.map(stroke => ({
    ...stroke,
    radius: stroke.radius * sourceMinimum / expandedMinimum,
    points: stroke.points.map(point => ({
      ...point,
      x: (left + point.x * sourceWidth) / expandedWidth,
      y: (top + point.y * sourceHeight) / expandedHeight,
    })),
  }));
}
