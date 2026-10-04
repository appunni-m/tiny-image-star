import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, smoke, commentsSmoke] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('./mobile-recipe-smoke.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./comments-smoke.mjs', import.meta.url), 'utf8'),
]);
const stylesheet = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('an open phone drawer hides the covered canvas from focus and screen readers', () => {
  assert.match(source, /canvasRegion\.inert = hostViewOnly \? false : anyOpen && !commentPanelCanvasAccess;[\s\S]*?canvasRegion\.setAttribute\('aria-hidden', String\(!hostViewOnly && anyOpen && !commentPanelCanvasAccess\)\)/);
  assert.match(smoke, /canvas behind an open phone panel should be removed from keyboard and screen-reader navigation/);
  assert.match(commentsSmoke, /The mobile Comments list should leave the canvas available for selection without an open thread/,
    'the Comments list should leave the visible phone canvas interactive so users can select a component or frame');
});

test('the live owner view dock keeps a safe canvas accessible while locking editing panels', () => {
  const sync = source.match(/function syncMobilePanelAccessibility\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  const pointerStart = source.indexOf('function onCanvasPointerDown(event)');
  const pointerEnd = source.indexOf('\nfunction onCanvasPointerMove(event)', pointerStart);
  const pointerDown = source.slice(pointerStart, pointerEnd);
  assert.match(sync, /const hostViewOnly = isLiveHostViewOnly\(\)/);
  assert.match(sync, /panel\.inert = closed/);
  assert.match(sync, /canvasRegion\.inert = hostViewOnly \? false : anyOpen && !commentPanelCanvasAccess/);
  assert.match(pointerDown, /if \(isLiveHostViewOnly\(\)\) \{/);
  assert.match(pointerDown, /kind: 'pan'/);
  assert.match(pointerDown, /event\.stopImmediatePropagation\(\)/,
    'the owner can navigate the canvas without entering edit handlers');
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
  const portraitStart = stylesheet.indexOf('/* Keep the edited artwork visible above the phone properties sheet. */');
  const landscapeStart = stylesheet.indexOf('/* Landscape phones need the inspector', portraitStart);
  assert.ok(portraitStart >= 0 && landscapeStart > portraitStart, 'portrait and short-landscape layouts should have separate rules');
  const portraitSheet = stylesheet.slice(portraitStart, landscapeStart);
  const panelStart = portraitSheet.indexOf('  .right-panel {');
  assert.ok(panelStart >= 0, 'the mobile inspector should have an explicit sheet layout');
  const panelOpen = portraitSheet.indexOf('  .right-panel.is-open { transform: translateY(0); }', panelStart);
  assert.ok(panelOpen > panelStart, 'opening the inspector should slide the sheet up from the bottom');
  const sheet = portraitSheet.slice(panelStart, panelOpen);
  assert.match(sheet, /top:\s*auto/);
  assert.match(sheet, /left:\s*0/);
  assert.match(sheet, /width:\s*100%/);
  assert.match(sheet, /height:\s*min\(50dvh,\s*500px\)/);
  assert.match(portraitSheet, /\.app-shell\.mobile-inspector-open > \.mobile-scrim\.is-visible\s*\{[^}]*bottom:\s*min\(50dvh,\s*500px\)/,
    'the scrim must stop at the sheet edge so the edited canvas remains visible');
  assert.match(portraitSheet, /\.app-shell\.mobile-inspector-open > \.mobile-scrim\.is-visible\s*\{[^}]*backdrop-filter:\s*none/,
    'the preview area must not be blurred while adjustment controls are open');
  assert.match(smoke, /canvas behind an open phone panel should be removed from keyboard and screen-reader navigation/,
    'the visible preview must remain non-interactive while the properties sheet is open');
});

test('inspector content stays inside the sidebar without horizontal page overflow', () => {
  assert.match(stylesheet, /\.right-panel\s*\{[^}]*box-sizing:\s*border-box[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*overflow:\s*hidden/);
  assert.match(stylesheet, /\.inspector-content\s*\{[^}]*box-sizing:\s*border-box[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/);
  assert.match(stylesheet, /\.inspector-content\s*>\s*\*\s*\{[^}]*box-sizing:\s*border-box[^}]*min-width:\s*0[^}]*max-width:\s*100%/);
  assert.match(stylesheet, /\.inspect-code-card pre\s*\{[^}]*box-sizing:\s*border-box[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*max-width:\s*100%/);
});

test('phone Assets content uses the available sidebar width while the catalog scrolls as one panel', () => {
  assert.match(stylesheet, /\.assets-section\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/,
    'the Assets catalog should own vertical scrolling so all collections remain reachable');
  const mobileAssets = stylesheet.match(/@media \(max-width: 820px\)\s*\{\s*\.assets-section\s*\{[^}]*scrollbar-gutter:\s*auto;[^}]*\}\s*\.assets-section\s*>\s*\*\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/);
  assert.ok(mobileAssets,
    'phone Assets content should reclaim the narrow scrollbar gutter and keep each section within the sidebar');
});

test('short landscape inspector stays inside very narrow phone viewports', () => {
  const shortLandscape = stylesheet.match(/@media \(max-width: 820px\) and \(max-height: 560px\)\s*\{\s*\.right-panel\s*\{[^}]*width:\s*min\(400px,\s*max\(280px,\s*54vw\)\);[^}]*max-width:\s*100%/);
  assert.ok(shortLandscape,
    'the landscape inspector may prefer a 280px minimum but must clamp to the workspace on narrower phones');
});

test('touch toolbars keep action labels visible across phone and small-tablet widths', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-tool="image" data-tool-label="Add image"/,
    'the image tool should say that it adds an image rather than only naming its content');
  assert.match(html, /data-tool="eyedropper" data-tool-label="Pick color"/,
    'the eyedropper should use an action label that makes sense without its desktop tooltip');
  const coarseStart = stylesheet.lastIndexOf('@media (max-width: 820px) and (pointer: coarse) {');
  const coarseEnd = stylesheet.indexOf('\n}', coarseStart);
  assert.ok(coarseStart >= 0 && coarseEnd > coarseStart, 'expected the touch-viewport toolbar rules');
  const coarseRules = stylesheet.slice(coarseStart, coarseEnd);
  assert.match(coarseRules, /\.bottom-toolbar \.tool-button::after\s*\{[^}]*content:\s*attr\(data-tool-label\)/,
    'touch users should not need hover to identify canvas tools');
  assert.match(coarseRules, /\.bottom-toolbar \.tool-button\s*\{[^}]*width:\s*60px[^}]*flex-direction:\s*column/,
    'labels need enough room on landscape phones and small tablets');
});

test('descriptive numeric-field labels stay within their input instead of spilling into adjacent controls', () => {
  assert.match(source, /function propertyFieldLabelClass\(label\)\s*\{\s*return String\(label\)\.trim\(\)\.length > 2 \? ' property-field--descriptive' : '';/);
  assert.match(source, /property-field\$\{propertyFieldLabelClass\(label\)\}[\s\S]*?<label title="\$\{escapeHtml\(label\)\}">/,
    'numeric inspector fields should mark longer visible labels for their responsive layout');
  assert.equal((source.match(/property-field\$\{propertyFieldLabelClass\(label\)\}/g) || []).length, 2,
    'single and multi-selection numeric controls should use the same bounded label layout');
  assert.match(source, /numberField\('Horizontal gap'/,
    'the regression case must retain its real long inspector label');
  assert.match(stylesheet, /\.property-field label\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
  assert.match(stylesheet, /\.property-field--descriptive label\s*\{[^}]*max-width:\s*52%[^}]*flex:\s*0 1 auto/);
  assert.match(stylesheet, /\.property-field--descriptive input\s*\{[^}]*min-width:\s*0[^}]*flex:\s*1 1 0/);
});
