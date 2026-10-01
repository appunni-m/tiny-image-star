import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
]);
const stylesheet = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

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

test('recipe save dialog is named by its visible heading', () => {
  assert.match(html, /<dialog\b[^>]*id="recipe-dialog"[^>]*aria-labelledby="recipe-dialog-title"/);
  assert.match(html, /<h2\s+id="recipe-dialog-title">Save recipe<\/h2>/);
});

test('canvas tool buttons expose the active tool at startup and when it changes', () => {
  const toolbar = html.match(/<div class="bottom-toolbar" id="bottom-toolbar"[\s\S]*?<\/div>/)?.[0] || '';
  const toolButtons = [...toolbar.matchAll(/<button\b[^>]*>/g)].map(([tag]) => ({
    tag,
    className: tag.match(/\bclass="([^"]*)"/)?.[1] || '',
    tool: tag.match(/\bdata-tool="([^"]+)"/)?.[1] || '',
    pressed: tag.match(/\baria-pressed="(true|false)"/)?.[1],
  }));
  assert.ok(toolButtons.length >= 15, 'the toolbar should expose its canvas tools');
  for (const button of toolButtons) {
    assert.ok(button.tool, 'each toolbar button should identify its tool');
    assert.notEqual(button.pressed, undefined, `${button.tool} should have an initial pressed state`);
    assert.equal(button.pressed, String(button.className.split(/\s+/).includes('is-selected')),
      `${button.tool} should expose the same initial selection that the UI shows`);
  }
  assert.equal(toolButtons.filter(button => button.pressed === 'true').length, 1,
    'exactly one canvas tool should be active at startup');

  const setTool = main.match(/function setTool\(tool\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(setTool, /button\.setAttribute\('aria-pressed', String\(selected\)\)/,
    'choosing another canvas tool should update its accessible pressed state');
  assert.match(setTool, /const selected = button\.dataset\.tool === tool/,
    'the selected state should follow the active canvas tool');
});

test('presentation controls meet the 44px coarse-pointer target without toolbar clipping', () => {
  const coarseQuery = '@media (max-width: 820px) and (pointer: coarse) {';
  const coarseStart = stylesheet.lastIndexOf(coarseQuery);
  assert.notEqual(coarseStart, -1, 'expected the final coarse-pointer phone overrides');
  const coarsePointerRules = ruleBlock(stylesheet.slice(coarseStart), coarseQuery);
  assert.match(coarsePointerRules, /\.presentation-control\s*\{[^}]*width:\s*44px[^}]*min-width:\s*44px[^}]*height:\s*44px[^}]*min-height:\s*44px[^}]*flex-basis:\s*44px/);
  assert.match(coarsePointerRules, /\.presentation-toolbar\s*\{[^}]*height:\s*60px/);
});
