/** Return the scroll destination for the small-screen toolbar's More/Start control. */
export function toolbarOverflowDestination({ scrollLeft, clientWidth, scrollWidth, tolerance = 2 }) {
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  if (maxScroll <= tolerance) return 0;
  if (maxScroll - scrollLeft <= tolerance) return 0;

  const step = Math.max(1, clientWidth);
  return Math.min(maxScroll, scrollLeft + step);
}

/** Whether more content is available and the viewport has reached its end. */
export function toolbarOverflowState({ scrollLeft, clientWidth, scrollWidth, tolerance = 2 }) {
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  const hasOverflow = maxScroll > tolerance;
  return {
    hasOverflow,
    atEnd: hasOverflow && maxScroll - scrollLeft <= tolerance
  };
}
