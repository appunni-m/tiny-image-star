// Pure helpers for explaining when a shared fill-frame recipe may need a
// per-image framing correction. This never changes pixels or worker behavior.

export const FRAME_SHAPE_TOLERANCE = 0.04;

export function shapeRatio(width, height) {
  const numericWidth = Number(width);
  const numericHeight = Number(height);
  if (!(numericWidth > 0) || !(numericHeight > 0)) return null;
  return numericWidth / numericHeight;
}

export function shapesDiffer(left, right, tolerance = FRAME_SHAPE_TOLERANCE) {
  if (!(left > 0) || !(right > 0)) return false;
  return Math.abs(Math.log(left / right)) > tolerance;
}

export function framingReviewForItems(items, operationsForItem) {
  const validItems = Array.from(items ?? []).filter((item) => shapeRatio(item?.width, item?.height));
  const referenceAspect = shapeRatio(validItems[0]?.width, validItems[0]?.height);
  const mixedShapes = validItems.some((item) => shapesDiffer(shapeRatio(item.width, item.height), referenceAspect));
  const flaggedIds = new Set();
  if (!mixedShapes) return { mixedShapes, flaggedIds };

  for (const item of validItems) {
    const operations = operationsForItem?.(item) ?? {};
    const targetAspect = shapeRatio(operations.resizeWidth, operations.resizeHeight);
    const sourceAspect = shapeRatio(item.width, item.height);
    if (operations.resizeMode === "crop" && targetAspect && shapesDiffer(sourceAspect, targetAspect)) {
      flaggedIds.add(String(item.id));
    }
  }
  return { mixedShapes, flaggedIds };
}
