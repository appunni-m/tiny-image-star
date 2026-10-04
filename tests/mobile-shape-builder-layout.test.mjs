import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [stylesheet, html] = await Promise.all([
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);

function ruleBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `expected ${marker}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, 'expected an opening CSS block');
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  assert.fail(`expected ${marker} block to close`);
}

test('phone Shape Builder keeps its action bar and canvas tools independently reachable', () => {
  const canvasRegion = html.match(/<main class="canvas-region" id="canvas-region"[\s\S]*?<\/main>/)?.[0] || '';
  assert.match(canvasRegion, /<div class="shape-builder-bar" id="shape-builder-bar"[^>]*hidden>/,
    'Shape Builder should expose a dedicated temporary action bar');
  assert.match(canvasRegion, /<div class="bottom-toolbar bottom-toolbar-shell"[^>]*role="group"[^>]*>[\s\S]*?<div class="bottom-toolbar-viewport" id="bottom-toolbar"/,
    'the normal tool palette should remain available while Shape Builder is active');

  const shapeBuilderRule = stylesheet.indexOf('/* Shape Builder has its own temporary action bar.');
  assert.notEqual(shapeBuilderRule, -1, 'expected a mobile Shape Builder layout rule');
  const phoneMediaStart = stylesheet.lastIndexOf('@media (max-width: 820px) {', shapeBuilderRule);
  assert.notEqual(phoneMediaStart, -1, 'Shape Builder layout should be scoped to phone widths');
  const phoneRules = ruleBlock(stylesheet.slice(phoneMediaStart), '@media (max-width: 820px) {');
  assert.match(phoneRules, /#shape-builder-bar\s*\{\s*bottom:\s*max\(8px,\s*env\(safe-area-inset-bottom\)\)/,
    'the temporary bar should clear the phone home indicator');
  assert.match(phoneRules, /#canvas-region:has\(#shape-builder-bar:not\(\[hidden\]\)\)\s*>\s*\.bottom-toolbar\s*\{\s*bottom:\s*calc\(116px\s*\+\s*max\(env\(safe-area-inset-bottom\),\s*8px\)\)/,
    'the normal canvas toolbar should move above the temporary action bar instead of occupying the same bottom strip');
  assert.match(stylesheet, /\.shape-builder-actions button\s*\{[^}]*min-height:\s*44px/,
    'Shape Builder mode actions should remain finger-sized on phones');
});
