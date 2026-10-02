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
  const storageChip = declarations(narrowPhone, '.storage-mode-chip');
  const title = declarations(narrowPhone, '.document-title-wrap');
  const name = declarations(narrowPhone, '.document-name');

  assert.equal(storageChip.width, '36px', 'the storage cue should remain visible in a compact fixed slot');
  assert.equal(storageChip['flex'], '0 0 36px', 'the storage cue should not steal the filename space');
  assert.equal(title.flex, '1 1 0', 'the editable filename should receive the remaining header space');
  assert.equal(name['min-width'], '0', 'the filename input must be allowed to shrink without forcing overflow');
  assert.equal(name['max-width'], 'none', 'the filename should use the available phone width');

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
});
