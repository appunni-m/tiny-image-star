import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, smoke] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('./mobile-recipe-smoke.mjs', import.meta.url), 'utf8'),
]);
const stylesheet = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

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

test('phone properties use a bottom sheet and leave the live canvas preview visible', () => {
  const sync = source.match(/function syncMobilePanelAccessibility\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(sync, /const inspectorOpen = mobile && panels\[1\]\.panel\.classList\.contains\('is-open'\)/);
  assert.match(sync, /appShell\.classList\.toggle\('mobile-inspector-open', inspectorOpen\)/);
  const panelStart = stylesheet.lastIndexOf('  .right-panel {');
  assert.ok(panelStart >= 0, 'the mobile inspector should have an explicit sheet layout');
  const panelOpen = stylesheet.indexOf('  .right-panel.is-open { transform: translateY(0); }', panelStart);
  assert.ok(panelOpen > panelStart, 'opening the inspector should slide the sheet up from the bottom');
  const sheet = stylesheet.slice(panelStart, panelOpen);
  assert.match(sheet, /top:\s*auto/);
  assert.match(sheet, /left:\s*0/);
  assert.match(sheet, /width:\s*100%/);
  assert.match(sheet, /height:\s*min\(50dvh,\s*500px\)/);
  assert.match(stylesheet, /\.app-shell\.mobile-inspector-open > \.mobile-scrim\.is-visible\s*\{[^}]*bottom:\s*min\(50dvh,\s*500px\)/,
    'the scrim must stop at the sheet edge so the edited canvas remains visible');
  assert.match(stylesheet, /\.app-shell\.mobile-inspector-open > \.mobile-scrim\.is-visible\s*\{[^}]*backdrop-filter:\s*none/,
    'the preview area must not be blurred while adjustment controls are open');
  assert.match(smoke, /canvas behind an open phone panel should be removed from keyboard and screen-reader navigation/,
    'the visible preview must remain non-interactive while the properties sheet is open');
});
