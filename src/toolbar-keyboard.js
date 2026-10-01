/** Return the enabled toolbar item targeted by a horizontal roving-focus key. */
export function toolbarNavigationTarget(items, activeItem, key, direction = 'ltr') {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (key === 'Home') return items[0];
  if (key === 'End') return items.at(-1);

  const rtl = direction === 'rtl';
  const delta = key === 'ArrowRight' ? (rtl ? -1 : 1)
    : key === 'ArrowLeft' ? (rtl ? 1 : -1)
      : 0;
  if (!delta) return null;
  const activeIndex = items.indexOf(activeItem);
  const start = activeIndex < 0 ? (delta > 0 ? -1 : 0) : activeIndex;
  return items[(start + delta + items.length) % items.length];
}
