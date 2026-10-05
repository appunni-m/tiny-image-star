import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, stylesheet, mobileSmoke] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('./mobile-recipe-smoke.mjs', import.meta.url), 'utf8'),
]);

test('layer rows expose a named, keyboard-focusable action-menu button', () => {
  assert.match(source, /class="layer-actions-menu" data-action="layer-actions-menu" tabindex="-1" aria-label="More actions for \$\{escapeHtml\(node\.name\)\}" aria-haspopup="menu" aria-expanded="false" aria-controls="context-menu"/);
  assert.match(source, /const actionMenuButton = event\.target\.closest\('\[data-action="layer-actions-menu"\]'\)/);
  assert.match(source, /event\.key === 'ContextMenu' \|\| \(event\.key === 'F10' && event\.shiftKey\)/,
    'the tree row must expose its action menu from the keyboard context-menu shortcut');
  assert.match(source, /menu\._returnFocusElement = menuButton \|\| row;[\s\S]*?menuButton\?\.setAttribute\('aria-expanded', 'true'\)/,
    'the keyboard-opened menu should restore focus and expose its expanded state');
  assert.match(source, /if \(event\.key === 'Enter'\)[\s\S]*?setSelection\(\[row\.dataset\.layerId\]/,
    'Enter should select the focused tree row');
  assert.match(source, /if \(event\.key === ' '\)[\s\S]*?setSelection\(toggleLayerSelection\(state\.selectedIds, id\)/,
    'Space should toggle the focused row in the multi-selection');
  assert.match(source, /openNodeMenu\(node\.id, bounds\.right, bounds\.top\)/);
  assert.match(source, /currentButton\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(source, /returnFocus\?\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(source, /menu\._returnFocusElement\?\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(source, /focusFirstContextMenuItem\(menu\)/);
});

test('keyboard deletion targets the focused layer when focus and selection differ', () => {
  assert.match(source, /const focusedLayer = event\.target\.closest\?\.\('#layers-list \[data-layer-id\]'\)\s*\|\| document\.activeElement\?\.closest\?\.\('#layers-list \[data-layer-id\]'\);\s*const targetIds = layerDeleteTargets\(state\.selectedIds, focusedLayer\?\.dataset\.layerId\);\s*event\.preventDefault\(\); deleteSelected\(targetIds\)/,
    'Delete and Backspace should act on the focused layer instead of a stale selection');
});

test('Delete and Backspace on a layer row directly delete that row or its active multi-selection', () => {
  const start = source.indexOf("$('#layers-list').addEventListener('keydown', event => {");
  const end = source.indexOf("$('#layers-list').addEventListener('click'", start);
  assert.ok(start >= 0 && end > start, 'layer-list keyboard handling should have a bounded event handler');
  const handler = source.slice(start, end);
  assert.match(handler, /if \(event\.key === 'Delete' \|\| event\.key === 'Backspace'\)[\s\S]*?layerDeleteTargets\(state\.selectedIds, row\.dataset\.layerId\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?deleteSelected\(targetIds\)/,
    'focused layer rows should take the direct delete path before other tree shortcuts');
  assert.match(source, /document\.activeElement\?\.closest\?\.\('#layers-list \[data-layer-id\]'\)/,
    'the document keyboard fallback should also resolve the active layer row');
});

test('the shared delete command reports an empty target and confirms the exact removed count', () => {
  const start = source.indexOf('function deleteSelected(selectionIds = null) {');
  const end = source.indexOf('\nfunction copySelected()', start);
  assert.ok(start >= 0 && end > start, 'the shared layer delete command should have a bounded function body');
  const command = source.slice(start, end);
  assert.match(command, /if \(!ids\.length\)\s*\{\s*showToast\('Select a layer to delete\.'\);\s*return false;/,
    'a stale or empty target must be visible instead of silently doing nothing');
  assert.match(command, /if \(ids\.some\(id => findNode\(result\.document, id, pageId\)\)\)[\s\S]*?throw new Error\(/,
    'the command must verify every requested top-level layer is absent before installing the result');
  assert.match(command, /showToast\(`Deleted \$\{ids\.length\} layer\$\{ids\.length === 1 \? '' : 's'\}\.`\);\s*return true;/,
    'successful deletion should confirm the number of layers actually removed');
});

test('canvas pointer selection takes keyboard focus away from a stale layer row', () => {
  const start = source.indexOf('function onCanvasPointerDown(event) {');
  const end = source.indexOf('\nfunction onCanvasPointerMove(event)', start);
  assert.ok(start >= 0 && end > start, 'canvas pointer handling should have a bounded event handler');
  assert.match(source.slice(start, end), /canvas\.focus\(\{ preventScroll: true \}\)/,
    'canvas selection should make the canvas the keyboard target so Delete follows the current selection');
});

test('choosing a layer row exits vector-anchor editing before layer selection', () => {
  const start = source.indexOf("$('#layers-list').addEventListener('click', event => {");
  const end = source.indexOf("$('#layers-list').addEventListener('dblclick'", start);
  assert.ok(start >= 0 && end > start, 'layer-row click handling should have a bounded event handler');
  const handler = source.slice(start, end);
  assert.match(handler, /if \(event\.target\.closest\('\[data-action="visibility"\]'\)\)[\s\S]*?clearVectorAnchorSelection\(\);[\s\S]*?if \(state\.layerSelectionMode\)/,
    'clicking a layer row, including the already-selected path, must clear stale anchor selection before Delete');
});

test('placing imported images resets selection through the shared invariant path', () => {
  const start = source.indexOf('async function importImageFiles(');
  const end = source.indexOf('\nasync function restoreImageAssets', start);
  assert.ok(start >= 0 && end > start, 'image import should have a bounded function body');
  const importer = source.slice(start, end);
  assert.match(importer, /let lastPlacedNodeId = null;/,
    'bulk image import should defer selection updates until all files have been processed');
  assert.match(importer, /if \(place && lastPlacedNodeId\) setSelection\(\[lastPlacedNodeId\], \{ keepInspector: true, refreshLayers: false \}\)/,
    'the final placed image must pass through selection cleanup before Delete can run');
  assert.doesNotMatch(importer, /state\.selectedIds\s*=\s*\[node\.id\]/,
    'direct selection assignment would preserve stale vector-anchor state');

  const startKeydown = source.indexOf('function onKeyDown(event) {');
  const endKeydown = source.indexOf('\nfunction ', startKeydown + 1);
  const keydown = source.slice(startKeydown, endKeydown);
  assert.doesNotMatch(keydown, /shouldDeleteSelectedVectorAnchor|deleteSelectedVectorPoint\(\)/,
    'keyboard Delete should remove the selected layer instead of silently retaining it after a point deletion');
});

test('the layer action menu keeps common actions and conditionally adds group/component actions', () => {
  const start = source.indexOf('function openNodeMenu(');
  const end = source.indexOf('\nasync function combineSelectedBoolean(', start);
  assert.ok(start >= 0 && end > start, 'the node action menu should have a bounded action builder');
  const builder = source.slice(start, end);
  for (const action of ["label: 'Duplicate'", "label: 'Rename'", "label: 'Delete'", "label: 'Create component'"]) {
    assert.ok(builder.includes(action), `the per-layer menu should retain ${action}`);
  }
  assert.match(builder, /if \(canGroupLayers\(state\.document, rootSelectedIds\(\)\)\).*Group/);
  assert.match(builder, /if \(node\?\.type === 'image'\)[\s\S]*?Save image recipe/);
  assert.match(builder, /const deleteTargetIds = layerMenuDeleteTargets\(state\.selectedIds, nodeId\)[\s\S]*?action: \(\) => deleteSelected\(deleteTargetIds\)/,
    'Delete should use the layer or multi-selection captured when its context menu opened');
  assert.match(builder, /getNodePropertyValue\(state\.document, node, 'visible'\) \? 'Hide layer' : 'Show layer'/,
    'visibility remains available from the action menu on very narrow phones');
});

test('mobile and coarse-pointer rows keep layer actions visible and finger-sized', () => {
  const phoneStart = stylesheet.indexOf('@media (max-width: 820px) {');
  assert.ok(phoneStart >= 0);
  const phoneEnd = stylesheet.indexOf('\n}', phoneStart);
  const phone = stylesheet.slice(phoneStart, phoneEnd);
  assert.match(phone, /\.layer-row \.layer-actions-menu\s*\{[^}]*display:\s*grid[^}]*width:\s*40px[^}]*height:\s*40px/);
  assert.match(stylesheet, /@media \(max-width: 820px\) and \(pointer: coarse\)\s*\{[\s\S]*?\.layer-row \.layer-actions-menu\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
  assert.match(stylesheet, /\.layer-row:focus-within \.layer-actions-menu\s*\{\s*display:\s*grid;\s*\}/);
});

test('deep layer rows cap phone indentation and preserve reachable fixed-size controls', () => {
  assert.match(source, /row\.style\.setProperty\('--layer-indent', `\$\{7 \+ depth \* 13\}px`\)/,
    'rows expose their normal nested indentation so phone CSS can cap it without changing desktop tree spacing');
  assert.match(stylesheet, /\.layer-row\s*\{[^}]*gap:\s*3px[^}]*padding-left:\s*min\(var\(--layer-indent\),\s*18px\)\s*!important/);
  assert.match(stylesheet, /\.layer-row \.layer-order-control, \.layer-row \.layer-visibility, \.layer-row \.layer-actions-menu\s*\{\s*flex-shrink:\s*0;/);
  assert.match(stylesheet, /\.layer-row \.layer-actions-menu\s*\{[^}]*flex:\s*0 0 40px/);
  assert.match(stylesheet, /\.layer-row \.layer-actions-menu\s*\{[^}]*flex:\s*0 0 44px/);
  assert.match(stylesheet, /@media \(max-width: 360px\)\s*\{[^}]*\.layer-row\s*\{[^}]*gap:\s*2px[^}]*padding-left:\s*min\(var\(--layer-indent\),\s*10px\)\s*!important/);
  assert.match(stylesheet, /@media \(max-width: 360px\) and \(pointer: coarse\)\s*\{[\s\S]*?\.layer-row \.layer-visibility\s*\{\s*display:\s*none !important/);
  assert.match(stylesheet, /@media \(max-width: 360px\) and \(pointer: coarse\)\s*\{[\s\S]*?\.layer-row \.layer-actions-menu\s*\{[^}]*flex:\s*0 0 44px/);

  // The fixed columns plus the maximum mobile indent fit within the layer
  // panel on narrow 320px and 280px screens, even for a deeply nested row.
  const widePhoneRequired = 18 + 18 + 4 * 44 + 6 * 3 + 18 + 5;
  const widePhoneContent = Math.min(290, 320 * 0.86) - 16;
  assert.ok(widePhoneRequired <= widePhoneContent, '44px coarse-pointer controls fit without flex-shrinking at 320px');
  const compactPhoneRequired = 14 + 14 + 3 * 44 + 6 * 2 + 10 + 5;
  const compactPhoneContent = Math.min(290, 280 * 0.86) - 16;
  assert.ok(compactPhoneRequired <= compactPhoneContent, '44px controls fit with visibility available in the action menu at 280px');
});

test('the phone workflow exercises action discovery, keyboard dismissal, and applicable group actions', () => {
  assert.match(mobileSmoke, /Per-layer actions button/);
  assert.match(mobileSmoke, /aria-haspopup/);
  assert.match(mobileSmoke, /ArrowDown should move through layer menu items/);
  assert.match(mobileSmoke, /Escape should close the layer menu and restore focus/);
  assert.match(mobileSmoke, /duplicate from mobile layer actions/);
  assert.match(mobileSmoke, /Rename should work from the touch-accessible menu/);
  assert.match(mobileSmoke, /delete from mobile layer actions/);
  assert.match(mobileSmoke, /Group 3 layers/);
});
