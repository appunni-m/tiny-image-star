export const imageFillNodeTypes = new Set(['frame', 'section', 'group', 'boolean', 'rectangle', 'ellipse', 'star', 'polygon', 'path', 'network']);
export const imageFillAdjustmentRanges = Object.freeze({
  brightness: [-100, 100],
  contrast: [-100, 100],
  saturation: [-100, 100],
  blur: [0, 24]
});

export function isImageFillSupported(node) {
  return Boolean(node && imageFillNodeTypes.has(node.type)
    && (node.type !== 'path' || node.closed)
    && (node.type !== 'network' || node.faces?.length));
}

export function createImageFill(assetId, overrides = {}) {
  if (typeof assetId !== 'string' || !assetId.trim() || assetId.length > 256) throw new TypeError('Choose an image already placed in this design.');
  return {
    assetId,
    fit: 'cover',
    adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 },
    ...overrides,
    adjustments: {
      brightness: 0, contrast: 0, saturation: 0, blur: 0,
      ...(overrides.adjustments || {})
    }
  };
}

export function isValidImageFill(fill) {
  if (!fill || typeof fill !== 'object' || Array.isArray(fill)
    || typeof fill.assetId !== 'string' || !fill.assetId.trim() || fill.assetId.length > 256
    || !['cover', 'contain'].includes(fill.fit)
    || !fill.adjustments || typeof fill.adjustments !== 'object' || Array.isArray(fill.adjustments)
    || Object.keys(fill.adjustments).some(key => !Object.hasOwn(imageFillAdjustmentRanges, key))) return false;
  return Object.entries(imageFillAdjustmentRanges).every(([field, [minimum, maximum]]) => {
    const value = fill.adjustments[field];
    return Number.isFinite(value) && value >= minimum && value <= maximum;
  });
}
