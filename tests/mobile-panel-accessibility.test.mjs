import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, smoke] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('./mobile-recipe-smoke.mjs', import.meta.url), 'utf8'),
]);

test('an open phone drawer hides the covered canvas from focus and screen readers', () => {
  assert.match(source, /canvasRegion\.inert = anyOpen;[\s\S]*?canvasRegion\.setAttribute\('aria-hidden', String\(anyOpen\)\)/);
  assert.match(smoke, /canvas behind an open phone panel should be removed from keyboard and screen-reader navigation/);
});

test('phone drawer keyboard focus wraps through the open panel and its close toggle', () => {
  const start = source.indexOf('function trapMobilePanelTab(event)');
  const end = source.indexOf('\nfunction initEvents()', start);
  assert.ok(start >= 0 && end > start, 'the mobile focus trap should have a bounded implementation');
  const focusTrap = source.slice(start, end);
  assert.match(focusTrap, /\.\.\.openPanel\.querySelectorAll\(/);
  assert.match(focusTrap, /summary:not\(\[tabindex="-1"\]\)/,
    'native disclosure summaries must participate in the phone drawer Tab sequence');
  assert.match(focusTrap, /\.\.\.menuItems/);
  assert.match(focusTrap, /const menuItems = menu\.hidden \? \[\] : contextMenuItems\(menu\)/,
    'an external context menu must join the open drawer focus sequence');
  assert.match(focusTrap, /^\s+toggle$/m);
  assert.match(focusTrap, /mobilePanelTabTarget\(focusStops, document\.activeElement, event\.shiftKey\)/);
  assert.match(focusTrap, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(focusTrap, /menu\.contains\(document\.activeElement\)/,
    'menu focus must not bypass the drawer trap');
  assert.match(source, /if \(trapMobilePanelTab\(event\)\) return;/);
  assert.match(smoke, /Tab from the last panel control should reach its close toggle/);
  assert.match(smoke, /Shift\+Tab from the close toggle should return to the last panel control/);
});
