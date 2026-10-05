import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDocument, createNode, addNode, findNode, getNodePropertyValue, createVariableCollection, createVariable, bindVariable } from '../src/model.js';
import { normalizeTextParagraphStyles } from '../src/text-layout.js';
import { resolvedTextLetterSpacing } from '../src/text-letter-spacing.js';
import { convertTextRunLetterSpacingUnit, convertTextLayerLetterSpacingUnit, transformTextRunsInRange, normalizeTextRunBaselineShift } from '../src/text-run-editing.js';
import { resolveTextPositionPlan } from '../src/text-position.js';
import { TEXT_DECORATION_PROPERTIES, isValidTextDecorationProperty } from '../src/text-decoration-style.js';
import { textStyleValuesEqual } from '../src/text-decoration-controls.js';
import { parseFontFeatureSettings, isValidFontFeatureValues } from '../src/font-features.js';
import { isValidFontVariationValues } from '../src/font-variation.js';
import { isValidTextPosition } from '../src/text-position-style.js';
import { isValidLeadingTrim } from '../src/text-leading-trim-style.js';

// Production adapters, without browser automation or claims about DOM layout.
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const extract = (start, end) => {
  const a = main.indexOf(start); const b = main.indexOf(end, a);
  assert.ok(a >= 0 && b > a); return main.slice(a, b);
};
const decoder = new Function('TEXT_DECORATION_PROPERTIES', 'isValidTextDecorationProperty', 'normalizeTextRunBaselineShift',
  'textStyleValuesEqual', 'parseFontFeatureSettings', 'isValidFontFeatureValues', 'isValidFontVariationValues', 'isValidTextPosition', 'isValidLeadingTrim', 'resolvedTextLetterSpacing', 'Node', 'normalizeTextParagraphStyles',
  extract('const textRunStyleKeys =', 'function editorListMarkerLabels(') + 'return { textRunStyleForElement, textRunLetterSpacingForElement, readTextEditorContent };'
)(TEXT_DECORATION_PROPERTIES, isValidTextDecorationProperty, normalizeTextRunBaselineShift,
  textStyleValuesEqual, parseFontFeatureSettings, isValidFontFeatureValues, isValidFontVariationValues, isValidTextPosition, isValidLeadingTrim, resolvedTextLetterSpacing, { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11 }, normalizeTextParagraphStyles);
const element = ({ value, unit, css, preview = false, fontSize } = {}) => ({ tagName: 'SPAN',
  dataset: preview ? { runPreview: 'true' } : {}, style: { letterSpacing: css || '' },
  getAttribute(name) { return ({ 'data-run-letter-spacing': value, 'data-run-letter-spacing-unit': unit,
    'data-run-font-size': fontSize })[name] ?? null; }
});

test('editor decoding retains authored percentage and legacy pixel runs without promoting derived preview CSS', () => {
  const base = { letterSpacing: 10, letterSpacingUnit: 'percent' };
  assert.deepEqual(decoder.textRunStyleForElement(element({ value: '8.5', unit: 'percent', css: '2.55px', preview: true }), base),
    { letterSpacing: 8.5, letterSpacingUnit: 'percent' });
  assert.deepEqual(decoder.textRunStyleForElement(element({ value: '1.25', css: '1.25px', preview: true }), base),
    { letterSpacing: 1.25, letterSpacingUnit: 'pixels' });
  assert.deepEqual(decoder.textRunStyleForElement(element({ css: '2.4px', preview: true }), base), base);
  assert.deepEqual(decoder.textRunStyleForElement(element({ unit: 'pixels', preview: true }), base), base);
  assert.deepEqual(decoder.textRunStyleForElement(element({ css: '.125em' }), {}, 32), { letterSpacing: 4, letterSpacingUnit: 'pixels' });
  const parent = decoder.textRunStyleForElement(element({ css: '.1em', fontSize: '20' }), {});
  const child = decoder.textRunStyleForElement(element({ fontSize: '40' }), parent);
  assert.equal(parent.letterSpacing, 2); assert.equal(child.letterSpacing, 2);
  assert.equal(child.fontSize, 40); assert.equal(child.letterSpacingUnit, 'pixels');
  assert.deepEqual(decoder.textRunStyleForElement(element({ css: '-1.25px' }), base), { letterSpacing: -1.25, letterSpacingUnit: 'pixels' });
  for (const fields of [{ unit: 'em', value: '2' }, { unit: '', value: '2' }, { unit: 'percent', value: '' }, { value: 'Infinity' }, { value: '10001' }, { css: '12%' }]) {
    assert.equal(decoder.textRunLetterSpacingForElement(element(fields)), null);
  }
});

test('foreign paragraph styles compute em spacing before a differently sized child inherits it', () => {
  const glyph = { nodeType: 3, nodeValue: 'B' };
  const span = { ...element(), nodeType: 1, childNodes: [glyph], style: { fontSize: '40px' } };
  const paragraph = { ...element(), nodeType: 1, tagName: 'P', childNodes: [span], style: { fontSize: '20px', letterSpacing: '.1em' } };
  const root = { dataset: { authoredFontSize: '32' }, childNodes: [paragraph] };
  const content = decoder.readTextEditorContent(root);
  assert.equal(content.text, 'B');
  assert.deepEqual(content.runs, [{ text: 'B', fontSize: 40, letterSpacing: 2, letterSpacingUnit: 'pixels' }]);
});

test('editor paint resolves spacing from each effective font size and zoom without changing authored styles', () => {
  const state = { zoom: 2 };
  const preview = new Function('state', 'resolvedTextLetterSpacing', extract('function applyTextEditorLetterSpacingPreview(', 'function textStyleLineHeight(')
    + 'return applyTextEditorLetterSpacingPreview;')(state, resolvedTextLetterSpacing);
  for (const [style, expected] of [
    [{ fontSize: 24, letterSpacing: 10, letterSpacingUnit: 'percent' }, '4.8px'],
    [{ fontSize: 40, letterSpacing: 10, letterSpacingUnit: 'percent' }, '8px'],
    [{ fontSize: 15.6, letterSpacing: 10, letterSpacingUnit: 'percent' }, '3.12px'],
    [{ fontSize: 40, letterSpacing: -1.25 }, '-2.5px']
  ]) {
    const source = structuredClone(style); const span = { style: {} };
    preview(span, style); assert.equal(span.style.letterSpacing, expected); assert.deepEqual(style, source);
  }
});

function layerHarness(nodes, design = createDocument()) {
  for (const node of nodes) addNode(design, node);
  const state = { document: design, controlEdit: false, shapeLocalTextRun: () => null };
  state.shapeLocalTextRun.fontStatus = () => 'none';
  const overrides = []; const messages = []; let checkpoints = 0; let paints = 0;
  const baseStyle = node => ({ ...node, fontSize: getNodePropertyValue(design, node, 'fontSize'),
    letterSpacing: getNodePropertyValue(design, node, 'letterSpacing') });
  const deps = { state, selectedNodes: () => nodes, findNode, textBaseStyle: baseStyle, getNodePropertyValue,
    resolveTextPositionPlan, convertTextLayerLetterSpacingUnit, textStyleValuesEqual,
    showToast: text => messages.push(text), renderInspector() {}, checkpoint() { checkpoints++; },
    resizeTextNode() {}, recordNodeComponentOverrides: (_node, properties) => overrides.push(properties),
    applyAutoLayout() {}, renderer: { invalidate() { paints++; } } };
  const apply = new Function(...Object.keys(deps), extract('function applyTextLetterSpacingUnitToSelection(', 'function updateInspectorInput(')
    + 'return applyTextLetterSpacingUnitToSelection;')(...Object.values(deps));
  return { apply, design, overrides, messages, counts: () => ({ checkpoints, paints }) };
}

test('layer unit conversion records scalar, unit, ranges and binding overrides together without changing shared variables', () => {
  const design = createDocument(); const node = createNode('text', { text: 'AB', fontSize: 20,
    letterSpacing: 0, textRuns: [{ text: 'A' }, { text: 'B', fontSize: 40 }] });
  const collection = createVariableCollection(design, 'Type'); const variable = createVariable(design, collection.id, 'Tracking', 'number', 2);
  const originalVariable = structuredClone(variable); const h = layerHarness([node], design);
  assert.equal(bindVariable(design, node.id, variable.id, 'letterSpacing'), true);
  h.apply('percent');
  assert.equal(node.letterSpacing, 10); assert.equal(node.letterSpacingUnit, 'percent');
  assert.equal(node.variableBindings.letterSpacing, undefined); assert.deepEqual(variable, originalVariable);
  assert.deepEqual(node.textRuns.map(run => [run.text, run.letterSpacing, run.letterSpacingUnit]), [['A', 10, 'percent'], ['B', 5, 'percent']]);
  assert.deepEqual(h.overrides, [['letterSpacing', 'letterSpacingUnit', 'textRuns', 'variableBindings']]);
  assert.deepEqual(h.counts(), { checkpoints: 1, paints: 1 });
});

test('choosing the existing unit preserves shared tracking bindings and creates no history entry', () => {
  const design = createDocument(); const node = createNode('text', { letterSpacing: 0 });
  const collection = createVariableCollection(design, 'Type'); const variable = createVariable(design, collection.id, 'Tracking', 'number', 2);
  const h = layerHarness([node], design); assert.equal(bindVariable(design, node.id, variable.id, 'letterSpacing'), true);
  const saved = structuredClone(design); h.apply('pixels');
  assert.deepEqual(design, saved); assert.deepEqual(h.counts(), { checkpoints: 0, paints: 0 }); assert.deepEqual(h.overrides, []);
});

test('an overflowing conversion or locked selected layer prevents every layer mutation and checkpoint', () => {
  for (const locked of [false, true]) {
    const first = createNode('text', { letterSpacing: 1, fontSize: 24 });
    const second = createNode('text', locked ? { locked: true } : { letterSpacing: 10000, fontSize: .01 });
    const h = layerHarness([first, second]); const saved = structuredClone(h.design);
    h.apply('percent'); assert.deepEqual(h.design, saved); assert.deepEqual(h.counts(), { checkpoints: 0, paints: 0 });
    assert.deepEqual(h.overrides, []); if (!locked) assert.equal(h.messages.length, 1);
  }
});

function rangeHarness() {
  const node = createNode('text', { text: 'ABCD', fontSize: 20, letterSpacing: 2,
    textRuns: [{ text: 'AB' }, { text: 'CD', fontSize: 40 }] });
  const design = createDocument(); addNode(design, node);
  const state = { document: design, textNodeId: node.id, shapeLocalTextRun: () => null }; state.shapeLocalTextRun.fontStatus = () => 'none';
  const range = { start: 1, end: 3 }; const editor = { focus() {} }; const unit = { value: 'percent' }; const rendered = [];
  const deps = { state, $: selector => selector === '#text-format-spacing-unit' ? unit : editor, findNode,
    readTextEditorContent: () => ({ text: node.text, runs: node.textRuns, paragraphStyles: [] }), rememberTextSelection: () => range,
    updateTextFormatToolbar() {}, textBaseStyle: () => node, resolveTextPositionPlan, convertTextRunLetterSpacingUnit, transformTextRunsInRange,
    renderTextEditorRuns: (_editor, runs) => rendered.push(runs), setTextEditorSelection() {}, showToast: text => { throw new Error(text); } };
  const apply = new Function(...Object.keys(deps), extract('function applyTextSpacingFormat(', 'function applyTextFormat(')
    + 'return applyTextSpacingFormat;')(...Object.values(deps));
  return { apply, node, rendered };
}

test('selected-range unit changes preserve per-size spacing and numeric changes set value and unit atomically', () => {
  const h = rangeHarness(); const original = structuredClone(h.node);
  h.apply('percent', { convertUnit: true });
  assert.deepEqual(h.rendered[0], [{ text: 'A' }, { text: 'B', letterSpacing: 10, letterSpacingUnit: 'percent' },
    { text: 'C', fontSize: 40, letterSpacing: 5, letterSpacingUnit: 'percent' }, { text: 'D', fontSize: 40 }]);
  h.apply(12.5);
  assert.deepEqual(h.rendered[1].map(run => [run.text, run.letterSpacing, run.letterSpacingUnit]),
    [['A', undefined, undefined], ['B', 12.5, 'percent'], ['C', 12.5, 'percent'], ['D', undefined, undefined]]);
  assert.deepEqual(h.node, original, 'live selected formatting remains staged until text commit');
});
