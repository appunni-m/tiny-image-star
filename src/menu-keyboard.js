const contextMenuItemSelector = 'button[role="menuitem"]:not(:disabled), button[role="menuitemradio"]:not(:disabled)';

/** Return enabled actionable menu rows, including radio-style choices. */
export function contextMenuItems(menu) {
  return [...(menu?.querySelectorAll?.(contextMenuItemSelector) || [])];
}

/** Return the menu row that should receive focus for a navigation key. */
export function contextMenuNavigationTarget(items, activeItem, key) {
  if (!Array.isArray(items) || !items.length) return null;
  const activeIndex = items.indexOf(activeItem);
  if (key === 'ArrowDown') return items[(activeIndex + 1 + items.length) % items.length];
  if (key === 'ArrowUp') return items[(activeIndex - 1 + items.length) % items.length];
  if (key === 'Home') return items[0];
  if (key === 'End') return items.at(-1);
  return null;
}

/** Return whether Tab should close a desktop popup menu without consuming Tab. */
export function shouldDismissDesktopMenuOnTab(menu, event, activeElement, viewportWidth) {
  return event?.key === 'Tab' && Number(viewportWidth) > 820
    && Boolean(menu) && !menu.hidden && Boolean(menu.contains?.(activeElement));
}

/** Return the next focus stop in a bounded drawer sequence for Tab. */
export function mobilePanelTabTarget(items, activeItem, shiftKey = false) {
  if (!Array.isArray(items) || !items.length) return null;
  const activeIndex = items.indexOf(activeItem);
  const direction = shiftKey ? -1 : 1;
  const nextIndex = activeIndex < 0
    ? (shiftKey ? items.length - 1 : 0)
    : (activeIndex + direction + items.length) % items.length;
  return items[nextIndex];
}

/** Prefer the menu opener, falling back when it was removed or made inert. */
export function menuFocusReturnTarget(opener, fallback = null) {
  return opener && opener.isConnected !== false && !opener.closest?.('[inert]')
    ? opener
    : fallback;
}

/** Focus the first enabled actionable row when a context menu opens. */
export function focusFirstContextMenuItem(menu) {
  const first = contextMenuItems(menu)[0] || null;
  first?.focus?.({ preventScroll: true });
  return first;
}
