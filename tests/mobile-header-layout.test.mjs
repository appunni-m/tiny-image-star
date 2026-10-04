import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [stylesheet, document, appSource] = await Promise.all([
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
]);

function blockAt(source, start) {
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, 'expected a CSS block');
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  assert.fail('expected the CSS block to close');
}

function lastMediaBlock(query) {
  const marker = `@media ${query} {`;
  const start = stylesheet.lastIndexOf(marker);
  assert.notEqual(start, -1, `expected ${marker}`);
  return blockAt(stylesheet, start);
}

function firstMediaBlock(query) {
  const marker = `@media ${query} {`;
  const start = stylesheet.indexOf(marker);
  assert.notEqual(start, -1, `expected ${marker}`);
  return blockAt(stylesheet, start);
}

function declarations(block, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `expected responsive rule for ${selector}`);
  return Object.fromEntries(match[1].split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const colon = part.indexOf(':');
    return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
  }));
}

test('narrow phone header keeps the filename readable beside essential editor controls', () => {
  const narrowPhone = lastMediaBlock('(max-width: 420px)');
  const narrowestPhone = lastMediaBlock('(max-width: 360px)');
  const mobile = firstMediaBlock('(max-width: 820px)');
  const storageChip = declarations(narrowPhone, '.storage-mode-chip');
  const title = declarations(narrowPhone, '.document-title-wrap');
  const name = declarations(narrowPhone, '.document-name');
  const saveState = declarations(narrowPhone, '.save-state');

  assert.equal(storageChip.width, '36px', 'the storage cue should remain visible in a compact fixed slot');
  assert.equal(storageChip['flex'], '0 0 36px', 'the storage cue should not steal the filename space');
  assert.equal(title.flex, '1 1 0', 'the editable filename should receive the remaining header space');
  assert.equal(name['min-width'], '28px', 'the filename keeps a small readable slot on compact phones');
  assert.equal(name['max-width'], 'none', 'the filename should use the available phone width');
  assert.equal(saveState.display, undefined, 'the save state keeps its compact mobile display from the main phone rule');
  assert.match(mobile, /\.save-state\s*\{[^}]*display:\s*flex/,
    'phones should retain a visible save status instead of hiding it with desktop-only header controls');
  assert.match(mobile, /\.save-state-full\s*\{[^}]*clip:\s*rect\(0, 0, 0, 0\)/,
    'the full save status remains available to assistive technology when its compact label is visible');
  assert.match(mobile, /\.save-state-compact\s*\{\s*display:\s*inline/);
  assert.match(stylesheet, /\.topbar #share-button\s*\{[^}]*display:\s*flex/,
    'the named Share action stays directly available in the phone header');
  assert.match(stylesheet, /\.topbar #share-button\s*\{[^}]*min-width:\s*48px/,
    'the direct Share action keeps a usable phone-sized target');
  assert.match(stylesheet, /\.topbar #main-menu-button::after\s*\{[^}]*content:\s*'Menu'/,
    'the compact brand button should visibly identify the file and export menu on phones');
  assert.match(document, /id="main-menu-button"[^>]*aria-label="Open file and export menu"[^>]*title="Menu · file, export, and appearance actions"/,
    'the menu keeps a task-oriented accessible name and hover label');
  assert.match(narrowestPhone, /\.document-name\s*\{[^}]*min-width:\s*24px/,
    'the name remains editable in a constrained 320px layout while storage yields its slot');
  assert.match(narrowestPhone, /\.storage-mode-chip\s*\{\s*display:\s*none/,
    'the storage cue yields its narrowest slot so the save state, filename, and core actions can fit');

  assert.match(narrowPhone, /\.storage-mode-chip:not\(\[data-mode\]\)::before,[\s\S]*?\.storage-mode-chip\[data-mode="browser"\]::before\s*\{\s*content:\s*"WEB"/);
  assert.match(narrowPhone, /\.storage-mode-chip\[data-mode="folder"\]::before\s*\{\s*content:\s*"DIR"/);
  assert.match(narrowPhone, /\.storage-mode-chip\[data-mode="reconnect"\]::before\s*\{\s*content:\s*"FIX"/);
  assert.match(appSource, /chip\.title\s*=\s*folderMode\s*\?[\s\S]*?chip\.setAttribute\('aria-label',\s*chip\.title\)/,
    'the compact visual labels must retain the full accessible and hover labels');
  assert.match(appSource, /chip\.dataset\.mode\s*=\s*pendingFolder\s*\?\s*'reconnect'\s*:\s*mode/);

  for (const id of ['document-name', 'sidebar-toggle', 'inspector-toggle', 'present-button', 'share-button']) {
    assert.match(document, new RegExp(`id="${id}"`), `${id} should remain available in the phone header`);
  }
  assert.match(document, /id="storage-mode-chip"[^>]*aria-live="polite"/);
  assert.match(document, /id="save-state"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(document, /class="save-state-full">Saved locally<\/span><span class="save-state-compact" aria-hidden="true">Saved<\/span>/);
  assert.match(appSource, /function compactSaveStateText\(kind\)[\s\S]*?return 'Saved'/);
  assert.match(appSource, /querySelector\('\.save-state-full'\)\.textContent = text/);
  assert.match(appSource, /querySelector\('\.save-state-compact'\)\.textContent = compactSaveStateText\(kind\)/);
});

test('wide coarse-pointer landscape keeps overflowing canvas tools named and pageable', () => {
  const wideLandscape = lastMediaBlock('(min-width: 821px) and (max-height: 560px) and (pointer: coarse)');
  assert.match(wideLandscape, /\.bottom-toolbar\s*\{[^}]*max-width:\s*calc\(100vw - max\(8px, env\(safe-area-inset-left\) \+ 8px\) - max\(8px, env\(safe-area-inset-right\) \+ 8px\)\)/,
    'the strip should fit between landscape device cutouts');
  assert.match(wideLandscape, /\.bottom-toolbar \.tool-button\s*\{[^}]*width:\s*60px[^}]*min-width:\s*60px[^}]*height:\s*48px[^}]*flex-basis:\s*60px/,
    'landscape tool controls should retain their 60 by 48px finger target');
  assert.match(wideLandscape, /\.bottom-toolbar \.tool-button::after\s*\{[^}]*content:\s*attr\(data-tool-label\)/,
    'touch tools should remain visibly named when hover labels are unavailable');
  assert.match(wideLandscape, /\.bottom-toolbar \.toolbar-more-tools:not\(\[hidden\]\)\s*\{[^}]*display:\s*grid[^}]*width:\s*76px[^}]*min-height:\s*44px/,
    'the overflow pager should stay visible and finger-sized');
  assert.match(document, /id="toolbar-more-tools"[^>]*aria-controls="bottom-toolbar"/,
    'the pager should continue to identify and control the scrolling tool viewport');
});
