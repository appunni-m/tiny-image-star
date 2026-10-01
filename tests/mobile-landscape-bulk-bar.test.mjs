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
  assert.notEqual(open, -1, `expected an opening brace for ${marker}`);
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

test('short landscape phones keep the live image-recipe bar compact and its controls reachable', () => {
  const query = '@media (max-width: 820px) and (max-height: 520px) {';
  const phoneLandscape = ruleBlock(stylesheet, query);

  assert.match(phoneLandscape, /\.bulk-bar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(130px,\s*1fr\)[^}]*grid-template-rows:\s*auto auto[^}]*gap:\s*4px 8px[^}]*padding:\s*6px 8px/,
    'the batch panel should fit status/progress and controls/speed into two compact rows');
  assert.match(phoneLandscape, /\.bulk-info\s*\{[^}]*grid-column:\s*1[^}]*grid-row:\s*1/);
  assert.match(phoneLandscape, /\.bulk-progress-wrap\s*\{[^}]*grid-column:\s*2[^}]*grid-row:\s*1/);
  assert.match(phoneLandscape, /\.bulk-actions\s*\{[^}]*grid-column:\s*1[^}]*grid-row:\s*2[^}]*overflow-x:\s*auto/);
  assert.match(phoneLandscape, /\.speed-control\s*\{[^}]*grid-column:\s*2[^}]*grid-row:\s*2/);
  assert.match(phoneLandscape, /\.bulk-actions \.bar-action\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/);
  assert.match(phoneLandscape, /\.speed-control input\s*\{[^}]*min-height:\s*44px/);
  assert.match(phoneLandscape, /\.speed-control output\s*\{[^}]*font-size:\s*9px/,
    'the compact worker-count readout should remain legible in landscape');
  assert.doesNotMatch(phoneLandscape, /\.bulk-info span\s*\{[^}]*display:\s*none/,
    'status and live rate remain visible while the panel is compact');

  for (const id of ['bulk-title', 'bulk-subtitle', 'bulk-rate', 'bulk-progress-label', 'bulk-speed', 'bulk-pause', 'bulk-cancel']) {
    assert.match(html, new RegExp(`id="${id}"`), `the mobile batch bar should retain ${id}`);
  }
  assert.match(html, /<span>Workers<\/span><input id="bulk-speed"[^>]*aria-label="Maximum concurrent image workers"/,
    'the batch slider should describe the worker limit it actually controls');
});
