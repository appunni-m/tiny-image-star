const scrollableBehaviors = new Set(['vertical', 'horizontal', 'both']);

export function isScrollableFrame(frame) {
  return frame?.type === 'frame' && scrollableBehaviors.has(frame.overflowBehavior);
}

/** Fixed positioning only applies to a direct child of an enabled scroll frame. */
export function isFixedPositionWhenScrolling(node, parentFrame) {
  return node?.fixedPositionWhenScrolling === true
    && isScrollableFrame(parentFrame)
    && (!parentFrame.autoLayout || node.layoutPositioning === 'absolute');
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

/** Apply the frame's scroll offset unless this immediate child is fixed. */
export function scrollOffsetForPresentationChild(parentFrame, child, offset) {
  if (isFixedPositionWhenScrolling(child, parentFrame)) return { x: 0, y: 0 };
  return offset;
}
