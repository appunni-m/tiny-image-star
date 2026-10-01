const TAB_SELECTOR = '[role="tab"]';

function enabledTabs(tabList) {
  return [...tabList.querySelectorAll(TAB_SELECTOR)].filter(tab =>
    !tab.disabled && tab.getAttribute('aria-disabled') !== 'true'
  );
}

/**
 * Install horizontal WAI-ARIA tab-list keyboard navigation.
 *
 * Left/Right wrap through enabled tabs, while Home/End move to the first/last
 * enabled tab. Navigation focuses and clicks the target tab (automatic
 * activation). Returns a cleanup function that removes the key handler.
 */
export function installHorizontalTabListKeyboard(tabList) {
  if (!tabList?.addEventListener || !tabList?.querySelectorAll) {
    throw new TypeError('A tab-list element is required.');
  }

  const onKeyDown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

    const target = event.target?.closest?.(TAB_SELECTOR);
    if (!target || !tabList.contains(target)) return;

    const tabs = enabledTabs(tabList);
    const currentIndex = tabs.indexOf(target);
    if (currentIndex < 0 || !tabs.length) return;

    let targetIndex;
    if (event.key === 'Home') targetIndex = 0;
    else if (event.key === 'End') targetIndex = tabs.length - 1;
    else {
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      targetIndex = (currentIndex + direction + tabs.length) % tabs.length;
    }

    event.preventDefault();
    const nextTab = tabs[targetIndex];
    nextTab.focus({ preventScroll: true });
    nextTab.click();
  };

  tabList.addEventListener('keydown', onKeyDown);
  return () => tabList.removeEventListener('keydown', onKeyDown);
}
