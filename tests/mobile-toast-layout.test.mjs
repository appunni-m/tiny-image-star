import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stylesheet = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

function declarationsFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesheet.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `expected a CSS rule for ${selector}`);
  return Object.fromEntries(match[1].split(';').map(declaration => declaration.trim()).filter(Boolean).map(declaration => {
    const separator = declaration.indexOf(':');
    return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()];
  }));
}

test('toast feedback clears phone safe areas on every edge', () => {
  const toastRegion = declarationsFor('.toast-region');
  assert.equal(toastRegion.position, 'fixed');
  assert.equal(toastRegion.left, 'max(12px, calc(env(safe-area-inset-left) + 12px))');
  assert.equal(toastRegion.right, 'max(12px, calc(env(safe-area-inset-right) + 12px))');
  assert.equal(toastRegion.bottom, 'max(24px, calc(env(safe-area-inset-bottom) + 12px))');
  assert.equal(toastRegion['pointer-events'], 'none', 'status messages do not block canvas gestures');
});

test('long status messages wrap inside the safe visible viewport', () => {
  const toast = declarationsFor('.toast');
  assert.equal(toast['max-width'], 'min(560px, 100%)');
  assert.equal(toast['overflow-wrap'], 'anywhere');
  assert.equal(toast['text-align'], 'center');
  assert.equal(declarationsFor('.toast-region')['align-items'], 'center');
});
