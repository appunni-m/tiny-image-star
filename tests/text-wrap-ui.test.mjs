import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, renderer, svgExport] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/svg-export.js', import.meta.url), 'utf8')
]);

test('text wrapping modes are exposed and reflowed in the editor, Canvas, and SVG export', () => {
  assert.match(main, /data-prop="textWrapStyle"/);
  assert.match(main, /value="balance"[\s\S]*?Balance[\s\S]*?value="pretty"[\s\S]*?Pretty/);
  assert.ok(main.includes("'textWrapStyle'"), 'changing the wrap mode must trigger the text reflow path');
  assert.match(main, /setProperty\('text-wrap-style'/);
  assert.match(renderer, /textWrapStyle: node\.textWrapStyle \|\| 'auto'/);
  assert.match(renderer, /textWrapStyle: baseStyle\.textWrapStyle \|\| 'auto'/);
  assert.match(svgExport, /textWrapStyle: node\.textWrapStyle \|\| 'auto'/);
});
