import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contextMenuItems, contextMenuNavigationTarget, focusFirstContextMenuItem, menuFocusReturnTarget, mobilePanelTabTarget, shouldDismissDesktopMenuOnTab } from '../src/menu-keyboard.js';

function menuFixture() {
  const items = [
    { role: 'menuitem', disabled: false, focused: false },
    { role: 'menuitem', disabled: true, focused: false },
    { role: 'menuitemradio', disabled: false, focused: false },
    { role: 'menuitemradio', disabled: false, focused: false },
    { role: 'menuitemradio', disabled: true, focused: false }
  ];
  const menu = {
    querySelectorAll(selector) {
      assert.match(selector, /button\[role="menuitem"\]/);
      assert.match(selector, /button\[role="menuitemradio"\]/);
      assert.match(selector, /:not\(:disabled\)/);
      return items.filter(item => !item.disabled);
    }
  };
  return { menu, items, enabled: items.filter(item => !item.disabled) };
}

test('context menu item collection includes enabled radio choices and skips disabled rows', () => {
  const { menu, enabled } = menuFixture();
  assert.deepEqual(contextMenuItems(menu), enabled);
});

test('initial context-menu focus includes radio choices and avoids scrolling', () => {
  const { menu, enabled } = menuFixture();
  const options = [];
  enabled[0].focus = value => options.push(value);

  assert.equal(focusFirstContextMenuItem(menu), enabled[0]);
  assert.deepEqual(options, [{ preventScroll: true }]);
});

test('Arrow, Home, and End navigation traverse menu items and Appearance radio choices', () => {
  const { menu, enabled } = menuFixture();
  const items = contextMenuItems(menu);
  assert.equal(items.length, 3);
  assert.equal(contextMenuNavigationTarget(items, items[0], 'ArrowDown'), items[1]);
  assert.equal(contextMenuNavigationTarget(items, items[1], 'ArrowDown'), items[2]);
  assert.equal(contextMenuNavigationTarget(items, items[2], 'ArrowDown'), items[0]);
  assert.equal(contextMenuNavigationTarget(items, items[0], 'ArrowUp'), items[2]);
  assert.equal(contextMenuNavigationTarget(items, items[2], 'ArrowUp'), items[1]);
  assert.equal(contextMenuNavigationTarget(items, items[2], 'Home'), items[0]);
  assert.equal(contextMenuNavigationTarget(items, items[0], 'End'), items[2]);
  assert.equal(contextMenuNavigationTarget(items, items[0], 'Escape'), null);
});

test('Tab closes an active desktop context menu but stays part of mobile drawer navigation', () => {
  const activeItem = { name: 'focused menu item' };
  const otherItem = { name: 'outside menu' };
  const menu = { hidden: false, contains: item => item === activeItem };
  assert.equal(shouldDismissDesktopMenuOnTab(menu, { key: 'Tab' }, activeItem, 1200), true);
  assert.equal(shouldDismissDesktopMenuOnTab(menu, { key: 'Tab' }, activeItem, 820), false);
  assert.equal(shouldDismissDesktopMenuOnTab(menu, { key: 'Tab' }, otherItem, 1200), false);
  assert.equal(shouldDismissDesktopMenuOnTab({ ...menu, hidden: true }, { key: 'Tab' }, activeItem, 1200), false);
  assert.equal(shouldDismissDesktopMenuOnTab(menu, { key: 'ArrowDown' }, activeItem, 1200), false);
});

test('mobile drawer Tab traversal includes menu items and wraps at the drawer boundary', () => {
  const panelFirst = { name: 'first panel control' };
  const panelLast = { name: 'last panel control' };
  const menuFirst = { name: 'first menu item' };
  const menuLast = { name: 'last menu item' };
  const closeToggle = { name: 'close drawer' };
  const stops = [panelFirst, panelLast, menuFirst, menuLast, closeToggle];

  assert.equal(mobilePanelTabTarget(stops, menuFirst), menuLast, 'Tab should continue through the open menu');
  assert.equal(mobilePanelTabTarget(stops, menuLast), closeToggle, 'Tab from the last menu item should remain in the drawer');
  assert.equal(mobilePanelTabTarget(stops, menuFirst, true), panelLast, 'Shift+Tab from the first menu item should return into the panel');
  assert.equal(mobilePanelTabTarget(stops, closeToggle), panelFirst, 'Tab from the close toggle should wrap inside the drawer');
  assert.equal(mobilePanelTabTarget(stops, panelFirst, true), closeToggle, 'Shift+Tab from the first panel control should wrap inside the drawer');
});

test('menu dismissal prefers its connected opener and falls back when the opener was removed or inert', () => {
  const opener = { isConnected: true, closest: () => null };
  const fallback = { name: 'recreated layer menu button' };
  assert.equal(menuFocusReturnTarget(opener, fallback), opener);
  assert.equal(menuFocusReturnTarget({ isConnected: false, closest: () => null }, fallback), fallback);
  assert.equal(menuFocusReturnTarget({ isConnected: true, closest: () => ({}) }, fallback), fallback);
});

test('editor menu opening and keyboard handling use the shared mixed-role focus helpers', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /focusFirstContextMenuItem\(menu\);/);
  assert.match(source, /contextMenuNavigationTarget\(menuItems, document\.activeElement, event\.key\)/);
  assert.match(source, /mobilePanelTabTarget\(focusStops, document\.activeElement, event\.shiftKey\)/);
  assert.match(source, /const menuItems = menu\.hidden \? \[\] : contextMenuItems\(menu\)/,
    'the drawer focus trap should treat its external popup menu as part of the focus sequence');
  assert.match(source, /function showMenu\(items, x, y, returnFocusElement = null, menuLabel = 'Editor actions'\)/);
  assert.match(source, /menu\.setAttribute\('aria-label', menuLabel\);/,
    'every context menu must have a contextual accessible name');
  assert.match(source, /shouldDismissDesktopMenuOnTab\(contextMenu, event, document\.activeElement, innerWidth\)/,
    'Tab should dismiss desktop menus while preserving the browser focus move');
  assert.match(source, /menu\._returnFocusElement = returnFocusElement/);
  assert.match(source, /menuFocusReturnTarget\(returnFocus, fallback\)/);
  assert.match(source, /openFileMenu\(event\.clientX \|\| 18, event\.clientY \|\| 45, null, event\.currentTarget\)/,
    'the mobile main menu should provide its opener for focus restoration');

  const escapeStart = source.indexOf("if (event.key === 'Escape' && !contextMenu.hidden)");
  const escapeEnd = source.indexOf("if (event.key === 'Escape' && state.imageCropMode", escapeStart);
  assert.ok(escapeStart >= 0 && escapeEnd > escapeStart, 'context-menu Escape handling should be bounded');
  const escapeHandler = source.slice(escapeStart, escapeEnd);
  assert.match(escapeHandler, /returnFocus\?\.closest\('\[data-layer-id\]'\)/,
    'Escape should retain a layer identity when selection rerenders detach the opener');
  assert.match(escapeHandler, /menuFocusReturnTarget\(returnFocus, fallback\)/,
    'Escape should restore focus to the current row/menu button when the original opener was detached');
});
