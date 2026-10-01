import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stylesheet = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

function ruleBlock(startIndex) {
  const open = stylesheet.indexOf('{', startIndex);
  assert.notEqual(open, -1, 'expected a CSS declaration block');
  let depth = 0;
  for (let index = open; index < stylesheet.length; index += 1) {
    if (stylesheet[index] === '{') depth += 1;
    if (stylesheet[index] === '}') {
      depth -= 1;
      if (depth === 0) return stylesheet.slice(open + 1, index);
    }
  }
  assert.fail('expected the CSS declaration block to close');
}

test('phone chrome uses theme surfaces, readable controls, and full-size touch targets', () => {
  const lightTokens = ruleBlock(stylesheet.indexOf(':root {'));
  const darkTokens = ruleBlock(stylesheet.indexOf(':root[data-theme="dark"] {'));
  assert.match(lightTokens, /--topbar-shadow:/);
  assert.match(darkTokens, /--topbar-shadow:/);
  assert.match(lightTokens, /--floating-panel-background:/);
  assert.match(darkTokens, /--floating-panel-background:/);
  assert.match(lightTokens, /--floating-panel-border:/);
  assert.match(darkTokens, /--floating-panel-border:/);

  const hierarchyStart = stylesheet.indexOf('/* Phone workspace hierarchy:');
  assert.notEqual(hierarchyStart, -1);
  const phoneHierarchy = stylesheet.slice(hierarchyStart, stylesheet.indexOf('@media (max-width: 420px)', hierarchyStart));
  assert.match(phoneHierarchy, /\.topbar\s*\{[^}]*border-bottom-color:\s*var\(--border\)[^}]*box-shadow:\s*var\(--topbar-shadow\)/);
  assert.match(phoneHierarchy, /\.left-panel, \.right-panel\s*\{[^}]*border-color:\s*var\(--border\)[^}]*background:\s*var\(--panel\)/);
  assert.match(phoneHierarchy, /\.zoom-controls, \.bottom-toolbar\s*\{[^}]*border-color:\s*var\(--floating-panel-border\)[^}]*background:\s*var\(--floating-panel-background\)/);
  assert.match(phoneHierarchy, /\.sidebar-tab, \.inspector-tab, \.property-heading, \.field-label\s*\{\s*font-size:\s*12px/);
  assert.match(stylesheet, /\.storage-mode-chip\s*\{[^}]*color:\s*var\(--muted\)[^}]*font-size:\s*10px/);

  const navigationStart = stylesheet.indexOf('@media (max-width: 820px) {\n  html, body, .app-shell');
  assert.notEqual(navigationStart, -1, 'expected the safe-area-aware phone control layout');
  const navigation = ruleBlock(navigationStart);
  assert.match(navigation, /\.icon-button, \.mobile-panel-toggle, \.present-button\s*\{\s*min-width:\s*44px;\s*min-height:\s*44px/);
  assert.match(navigation, /\.canvas-action-button\s*\{\s*width:\s*44px;\s*min-width:\s*44px;\s*height:\s*44px;\s*min-height:\s*44px/);

  const coarseStart = stylesheet.lastIndexOf('@media (max-width: 820px) and (pointer: coarse) {');
  const coarsePhone = ruleBlock(coarseStart);
  assert.match(coarsePhone, /\.presentation-flow-picker select\s*\{[^}]*height:\s*44px[^}]*font-size:\s*16px/);
  assert.match(stylesheet, /\.app-shell\s*\{\s*grid-template-rows:\s*calc\(45px \+ env\(safe-area-inset-top\)\)/);
});
