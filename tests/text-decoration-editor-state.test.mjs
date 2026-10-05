import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TEXT_DECORATION_PROPERTIES, isValidTextDecorationProperty } from '../src/text-decoration-style.js';
import { isValidTextPosition } from '../src/text-position-style.js';
import { textStyleValuesEqual } from '../src/text-decoration-controls.js';
import { isValidFontVariationValues } from '../src/font-variation.js';
import { isValidFontFeatureValues, parseFontFeatureSettings } from '../src/font-features.js';
import { normalizeTextRunBaselineShift } from '../src/text-run-editing.js';

// Execute the production editor's data-attribute decoder without a browser.
// This proves storage semantics only; focus, layout and gestures remain deferred.
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const start = main.indexOf('const textRunStyleKeys =');
const end = main.indexOf('function readTextEditorContent(', start);
assert.ok(start >= 0 && end > start);
const { textRunStyleForElement, textRunDataAttribute, appendTextRun } = new Function(
  'TEXT_DECORATION_PROPERTIES', 'isValidTextDecorationProperty', 'textStyleValuesEqual', 'isValidTextPosition',
  'isValidFontVariationValues', 'isValidFontFeatureValues', 'parseFontFeatureSettings', 'normalizeTextRunBaselineShift',
  `${main.slice(start, end)}\nreturn { textRunStyleForElement, textRunDataAttribute, appendTextRun };`
)(TEXT_DECORATION_PROPERTIES, isValidTextDecorationProperty, textStyleValuesEqual, isValidTextPosition,
  isValidFontVariationValues, isValidFontFeatureValues, parseFontFeatureSettings, normalizeTextRunBaselineShift);

function element({ encoded = {}, style = {}, preview = false, tag = 'SPAN' } = {}) {
  const attributes = Object.fromEntries(Object.entries(encoded).map(([property, value]) => [textRunDataAttribute(property), value]));
  return { tagName: tag, style, dataset: preview ? { runPreview: 'true' } : {}, getAttribute: key => attributes[key] ?? null };
}

test('browser preview CSS cannot turn inherited layer underline settings into permanent range overrides', () => {
  const decoded = textRunStyleForElement(element({ preview: true, style: {
    textDecoration: 'underline', textDecorationStyle: 'wavy', textDecorationThickness: '3px',
    textDecorationColor: 'rgba(17, 51, 85, 0.2)', textDecorationSkipInk: 'auto'
  } }), {});
  assert.deepEqual(decoded, {}, 'an unchanged editor range must still follow future layer/style updates');
});

test('explicit range settings retain zero values, false, Auto, and custom color alpha through DOM encoding', () => {
  const saved = {
    textDecorationStyle: 'dotted', textDecorationThickness: { unit: 'pixels', value: 0 },
    textDecorationOffset: { unit: 'percent', value: -20 },
    textDecorationColor: { type: 'solid', color: '#113355', opacity: 0, visible: false },
    textDecorationSkipInk: false
  };
  const decoded = textRunStyleForElement(element({ preview: true,
    encoded: Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, JSON.stringify(value)])),
    style: { textDecorationStyle: 'solid' }
  }), {});
  assert.deepEqual(decoded, saved);
  const reset = textRunStyleForElement(element({ preview: true, encoded: { textDecorationColor: '"auto"' } }), saved);
  assert.equal(reset.textDecorationColor, 'auto');
});

test('corrupt encoded underline objects cannot overwrite valid inherited settings', () => {
  const inherited = { textDecorationColor: 'auto', textDecorationOffset: { unit: 'pixels', value: 3 } };
  const decoded = textRunStyleForElement(element({ preview: true, encoded: {
    textDecorationColor: '{"type":"solid","color":"#113355","opacity":2}',
    textDecorationOffset: '{broken', textDecorationSkipInk: '"false"'
  } }), inherited);
  assert.deepEqual(decoded, inherited);
});

test('editor normalization merges equivalent encoded objects without changing selected-text content', () => {
  const runs = [];
  appendTextRun(runs, 'A', { textDecorationThickness: { unit: 'pixels', value: 3 } });
  appendTextRun(runs, 'B', { textDecorationThickness: { value: 3, unit: 'pixels' } });
  assert.equal(runs.length, 1); assert.equal(runs[0].text, 'AB');
  assert.equal(textRunStyleForElement(element({ tag: 'U' }), {}).textDecoration, 'underline');
  assert.equal(textRunStyleForElement(element({ tag: 'DEL' }), {}).textDecoration, 'line-through');
});

test('positioned preview CSS cannot compound authored font size, baseline shift or OpenType settings on reopen', () => {
  const inherited = { fontSize: 24, baselineShift: 2, textPosition: 'superscript', fontFeatures: { kern: 0 } };
  const preview = { preview: true, style: { fontSize: '14.4px', top: '-10px', baselineShift: '-10',
    fontFeatureSettings: '"sups" 1', fontVariantPosition: 'super' } };
  let decoded = inherited;
  for (let reopen = 0; reopen < 5; reopen++) decoded = textRunStyleForElement(element(preview), decoded);
  assert.deepEqual(decoded, inherited);
  const explicit = textRunStyleForElement(element({ ...preview, encoded: {
    fontSize: '24', baselineShift: '2', textPosition: 'superscript', fontFeatures: '{"kern":0}'
  } }), {});
  assert.deepEqual(explicit, inherited);
});

test('superscript and subscript markup retain source characters and explicit Normal clears semantic inheritance', () => {
  assert.equal(textRunStyleForElement(element({ tag: 'SUP' }), {}).textPosition, 'superscript');
  assert.equal(textRunStyleForElement(element({ tag: 'SUB' }), {}).textPosition, 'subscript');
  assert.equal(textRunStyleForElement(element({ style: { fontVariantPosition: 'sub' } }), {}).textPosition, 'subscript');
  assert.equal(textRunStyleForElement(element({ preview: true, encoded: { textPosition: 'normal' } }), { textPosition: 'superscript' }).textPosition, 'normal');
  assert.equal(textRunStyleForElement(element({ encoded: { textPosition: 'super' } }), { textPosition: 'subscript' }).textPosition, 'subscript');
  const runs = [];
  appendTextRun(runs, '1', { textPosition: 'superscript' }); appendTextRun(runs, '2', { textPosition: 'subscript' });
  assert.equal(runs.map(run => run.text).join(''), '12'); assert.equal(runs.length, 2);
});
