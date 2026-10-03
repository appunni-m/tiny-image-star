import { invertAffine, multiplyAffine, nodeLocalToPageTransform, transformPoint, transformVector } from './transform-geometry.js';

const scrollableBehaviors = new Set(['vertical', 'horizontal', 'both']);
const stickyBehaviors = new Set(['vertical', 'both']);
const scrollPositions = new Set(['scroll', 'fixed', 'sticky']);

export function isScrollableFrame(frame) {
  return frame?.type === 'frame' && scrollableBehaviors.has(frame.overflowBehavior);
}

/** Resolve the saved scroll position, reading the legacy fixed flag as needed. */
export function scrollPositionForNode(node) {
  if (scrollPositions.has(node?.scrollPosition)) return node.scrollPosition;
  return node?.fixedPositionWhenScrolling === true ? 'fixed' : 'scroll';
}

/** Fixed positioning only applies to a direct child of an enabled scroll frame. */
export function isFixedPositionWhenScrolling(node, parentFrame) {
  return scrollPositionForNode(node) === 'fixed'
    && isScrollableFrame(parentFrame)
    && (!parentFrame.autoLayout || node.layoutPositioning === 'absolute');
}

/** Sticky positioning is available only in a vertical scroll container. */
export function isStickyPositionWhenScrolling(node, parentFrame) {
  return scrollPositionForNode(node) === 'sticky'
    && parentFrame?.type === 'frame'
    && stickyBehaviors.has(parentFrame.overflowBehavior);
}

export function isStickyScrollFrame(frame) {
  return frame?.type === 'frame' && stickyBehaviors.has(frame.overflowBehavior);
}

/** Figma paints fixed children above children that move with the frame. */
export function presentationChildrenInPaintOrder(frame) {
  const children = Array.isArray(frame?.children) ? frame.children : [];
  if (!isScrollableFrame(frame)) return children;
  const scrolling = [];
  const fixed = [];
  for (const child of children) {
    (isFixedPositionWhenScrolling(child, frame) ? fixed : scrolling).push(child);
  }
  return fixed.length ? [...scrolling, ...fixed] : children;
}

function transformedBounds(matrix, width, height) {
  const points = [
    transformPoint(matrix, { x: 0, y: 0 }),
    transformPoint(matrix, { x: width, y: 0 }),
    transformPoint(matrix, { x: width, y: height }),
    transformPoint(matrix, { x: 0, y: height })
  ];
  return {
    top: Math.min(...points.map(point => point.y)),
    bottom: Math.max(...points.map(point => point.y))
  };
}

function nestedStickyCompensation(parent, child, stickyContext, parentAncestors, scrollY) {
  const frame = stickyContext?.frame;
  if (!isStickyPositionWhenScrolling(child, frame) || parent.id === frame.id) return null;
  const frameMatrix = nodeLocalToPageTransform(frame, stickyContext.ancestors || []);
  const frameInverse = invertAffine(frameMatrix);
  const parentMatrix = nodeLocalToPageTransform(parent, parentAncestors);
  const childMatrix = nodeLocalToPageTransform(child, [...parentAncestors, parent]);
  const parentInFrame = multiplyAffine(frameInverse, parentMatrix);
  const childInFrame = multiplyAffine(frameInverse, childMatrix);
  const parentBounds = transformedBounds(parentInFrame, parent.width, parent.height);
  const childBounds = transformedBounds(childInFrame, child.width, child.height);
  const naturalTop = childBounds.top - scrollY;
  const parentBottom = parentBounds.bottom - scrollY;
  const childExtent = childBounds.bottom - childBounds.top;
  const stickyTop = Math.min(Math.max(naturalTop, 0), parentBottom - childExtent);
  const frameSpaceY = stickyTop - naturalTop;
  if (!Number.isFinite(frameSpaceY) || Math.abs(frameSpaceY) <= 1e-12) return { x: 0, y: 0 };
  const pageVector = transformVector(frameMatrix, { x: 0, y: frameSpaceY });
  return transformVector(invertAffine(parentMatrix), pageVector);
}

/** Return the effective scroll offset for one child in its parent's viewport. */
export function scrollOffsetForPresentationChild(parentFrame, child, offset, stickyContext = null, parentAncestors = []) {
  if (isFixedPositionWhenScrolling(child, parentFrame)) return { x: 0, y: 0 };
  const scrollX = Number.isFinite(offset?.x) ? Math.max(0, offset.x) : 0;
  const scrollY = Number.isFinite(offset?.y) ? Math.max(0, offset.y) : 0;
  const directSticky = isStickyPositionWhenScrolling(child, parentFrame);
  const nestedSticky = !directSticky && isStickyPositionWhenScrolling(child, stickyContext?.frame);
  if (!directSticky && !nestedSticky) return { x: scrollX, y: scrollY };

  if (nestedSticky) {
    const compensation = nestedStickyCompensation(parentFrame, child, stickyContext, parentAncestors, stickyContext.offset?.y || 0);
    if (compensation) return { x: scrollX - compensation.x, y: scrollY - compensation.y };
  }

  // A direct child first follows the content, then stays pinned to the frame's
  // top edge for the rest of that frame's scroll range.
  const childY = Number.isFinite(child?.y) ? child.y : 0;
  const compensation = Math.max(0, scrollY - childY);
  return { x: scrollX, y: scrollY - compensation };
}
