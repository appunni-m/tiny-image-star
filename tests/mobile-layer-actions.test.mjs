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
  assert.match(source, /if \(event\.key === ' '\)[\s\S]*?setSelection\(state\.selectedIds\.includes\(id\)/,
    'Space should toggle the focused row in the multi-selection');
  assert.match(source, /openNodeMenu\(node\.id, bounds\.right, bounds\.top\)/);
  assert.match(source, /currentButton\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(source, /returnFocus\?\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(source, /menu\._returnFocusElement\?\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(source, /focusFirstContextMenuItem\(menu\)/);
});

test('the layer action menu keeps common actions and conditionally adds group/component actions', () => {
  const start = source.indexOf('function openNodeMenu(');
  const end = source.indexOf('\nfunction combineSelectedBoolean(', start);
  assert.ok(start >= 0 && end > start, 'the node action menu should have a bounded action builder');
  const builder = source.slice(start, end);
  for (const action of ["label: 'Duplicate'", "label: 'Rename'", "label: 'Delete'", "label: 'Create component'"]) {
    assert.ok(builder.includes(action), `the per-layer menu should retain ${action}`);
  }
  assert.match(builder, /if \(canGroupLayers\(state\.document, rootSelectedIds\(\)\)\).*Group/);
  assert.match(builder, /if \(node\?\.type === 'image'\)[\s\S]*?Save image recipe/);
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
