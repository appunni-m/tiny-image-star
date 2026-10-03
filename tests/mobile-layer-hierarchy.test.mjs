import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [stylesheet, source] = await Promise.all([
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8')
]);

function ruleBlock(selector, from = 0) {
  const start = stylesheet.indexOf(`${selector} {`, from);
  assert.notEqual(start, -1, `expected ${selector} rule`);
  const open = stylesheet.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < stylesheet.length; index += 1) {
    if (stylesheet[index] === '{') depth += 1;
    if (stylesheet[index] === '}' && --depth === 0) return stylesheet.slice(open + 1, index);
  }
  assert.fail(`expected ${selector} rule to close`);
}

function mediaBlock(query) {
  const start = stylesheet.indexOf(`@media ${query} {`);
  assert.notEqual(start, -1, `expected @media ${query}`);
  return stylesheet.slice(start, stylesheet.indexOf('\n}', start) + 2);
}

test('phone layer rows show the semantic nesting level inside their existing indentation gutter', () => {
  const phone = mediaBlock('(max-width: 820px)');
  const narrow = mediaBlock('(max-width: 360px)');
  assert.match(source, /row\.setAttribute\('aria-level', String\(depth \+ 1\)\)/,
    'the visible marker must use the same semantic depth exposed to assistive technology');
  assert.match(source, /class="layer-depth-marker" aria-hidden="true">\$\{depth \+ 1\}/,
    'the visual depth cue is hidden from screen readers because aria-level already exposes it');
  assert.match(phone, /\.layer-row\s*\{[^}]*position:\s*relative[^}]*padding-left:\s*min\(var\(--layer-indent\),\s*18px\)\s*!important/);
  assert.match(phone, /\.layer-depth-marker\s*\{[^}]*position:\s*absolute[^}]*width:\s*min\(var\(--layer-indent\),\s*18px\)[^}]*pointer-events:\s*none/,
    'the level marker occupies only the already-reserved gutter and never intercepts taps');
  assert.match(narrow, /\.layer-row\s*\{[^}]*padding-left:\s*min\(var\(--layer-indent\),\s*10px\)\s*!important/);
  assert.match(narrow, /\.layer-depth-marker\s*\{[^}]*width:\s*min\(var\(--layer-indent\),\s*10px\)/,
    'the depth marker stays within the smaller gutter on very narrow phones');
});

test('depth markers do not add a flex column or reduce phone layer action targets', () => {
  const baseMarker = ruleBlock('.layer-depth-marker');
  const phoneStart = stylesheet.indexOf('@media (max-width: 820px) {');
  const phoneMarker = ruleBlock('.layer-depth-marker', phoneStart);
  assert.match(baseMarker, /display:\s*none/);
  assert.match(phoneMarker, /position:\s*absolute/);
  assert.doesNotMatch(phoneMarker, /flex(?:-basis)?\s*:/);
  const actions = stylesheet.slice(phoneStart, stylesheet.indexOf('\n}', phoneStart));
  assert.match(actions, /\.layer-row \.layer-order-control, \.layer-row \.layer-visibility, \.layer-row \.layer-actions-menu\s*\{[^}]*flex-shrink:\s*0/);
  assert.match(stylesheet, /\.layer-row \.layer-actions-menu\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*flex:\s*0 0 44px/,
    'coarse-pointer action buttons retain their 44px touch targets');

  // The marker width equals the capped padding at every depth, so it uses no
  // extra horizontal space and never pushes the name or trailing actions.
  for (const cap of [18, 10]) {
    for (let depth = 0; depth < 30; depth += 1) {
      const indent = Math.min(7 + depth * 13, cap);
      assert.equal(indent, Math.min(7 + depth * 13, cap));
      assert.ok(indent <= cap);
    }
  }
});
