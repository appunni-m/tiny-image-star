import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolvedLineHeight } from '../src/text-layout.js';
import { canvasTextLineMetrics } from '../src/text-line-metrics.js';
import { localFontAxisValues } from '../src/local-font-style.js';
import { createDocument, createNode, addNode, createVariableCollection, createVariable, canBindVariable, bindVariable } from '../src/model.js';

// Run the production editor adapters without DOM layout. Native font and actual
// browser line placement remain separate fidelity controls.
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const extract = (start, end) => {
  const a = main.indexOf(start); const b = main.indexOf(end, a);
  assert.ok(a >= 0 && b > a); return main.slice(a, b);
};
function previewHarness() {
  let native = null; let status = 'none';
  const context = { font: '20px Arial', textBaseline: 'top', textAlign: 'left', measureText: () => ({
    fontBoundingBoxAscent: 17, fontBoundingBoxDescent: 4,
    actualBoundingBoxAscent: context.textBaseline === 'alphabetic' ? 14 : -2
  }) };
  const shape = () => null; shape.fontMetrics = () => native; shape.fontMetricsStatus = () => status;
  const state = { zoom: 2, shapeLocalTextRun: shape };
  const api = new Function('state', 'resolvedLineHeight', 'canvasTextLineMetrics',
    `let textMeasureContext = arguments[3];\n${extract('function textStyleLineHeight(', 'let textPositionPreviewFrame =')}\nreturn { textStyleLineHeight, applyTextEditorLineHeightPreview };`
  )(state, resolvedLineHeight, canvasTextLineMetrics, context);
  return { api, setNative: value => { native = value; status = value ? 'ready' : 'pending'; } };
}

test('editor Auto line height uses retained font extents and gap, with measured browser fallback', () => {
  const h = previewHarness(); const style = { fontFamily: 'Inter', fontSize: 20, lineHeight: 1, lineHeightUnit: 'auto' };
  const saved = structuredClone(style);
  assert.equal(h.api.textStyleLineHeight(style), 21);
  h.setNative(null);
  assert.equal(h.api.textStyleLineHeight(style, { settledOnly: true }), null, 'unit conversion waits for native metrics');
  h.setNative({ upem: 1000, extents: { ascender: 950, descender: -240, lineGap: 25 } });
  assert.equal(h.api.textStyleLineHeight(style), 24.3);
  const element = { style: {} }; h.api.applyTextEditorLineHeightPreview(element, style);
  assert.equal(element.style.lineHeight, '48.6px'); assert.deepEqual(style, saved);
});

test('explicit editor line-height units preserve authored sizes and semantic position envelope', () => {
  const h = previewHarness();
  for (const [lineHeightUnit, lineHeight] of [['pixels', 30], ['percent', 150], ['ratio', 1.5]]) {
    const style = { fontSize: 12, authoredFontSize: 20, lineHeight, lineHeightUnit };
    assert.equal(h.api.textStyleLineHeight(style), 30);
    const element = { style: {} }; h.api.applyTextEditorLineHeightPreview(element, style);
    assert.equal(element.style.lineHeight, '60px');
  }
});

test('production font metric adapter queries declared face and optical size independently of glyph coverage', () => {
  const font = { id: 'declared', family: 'Local', weight: 400, axes: [
    { tag: 'opsz', min: 8, max: 72, defaultValue: 14 }, { tag: 'wght', min: 100, max: 900, defaultValue: 400 }
  ] };
  const requests = []; const metrics = new Map();
  const state = { fontShapeFailures: new Set(), fontShaper: {
    getFontMetrics(id, request) { return metrics.get(JSON.stringify([id, request.variations])) || null; }
  } };
  const shaper = () => null;
  new Function('state', 'shapeLocalTextRun', 'localFontsForTextStyle', 'localFontVariations', 'requestLocalFontShape',
    extract('shapeLocalTextRun.fontMetrics =', 'function createTextOutlinePreparation(')
  )(state, shaper, () => [font], localFontAxisValues, (selected, request) => requests.push({ selected, request }));
  const style = { fontSize: 20, fontWeight: 500 };
  assert.equal(shaper.fontMetricsStatus(style), 'pending');
  assert.equal(shaper.fontMetrics(style, 'not covered by the declared font'), null);
  assert.equal(requests.length, 1); assert.equal(requests[0].request.text, ' ');
  assert.deepEqual(requests[0].request.variations, { opsz: 20, wght: 500 });
  const actual = { upem: 1000, extents: { ascender: 900, descender: -200, lineGap: 20 } };
  metrics.set(JSON.stringify([font.id, requests[0].request.variations]), actual);
  assert.equal(shaper.fontMetricsStatus(style), 'ready'); assert.deepEqual(shaper.fontMetrics(style), actual);
  assert.equal(shaper.fontMetricsStatus({ ...style, fontSize: 40 }), 'pending');
  state.fontShapeFailures.add(font.id);
  assert.equal(shaper.fontMetricsStatus(style), 'none'); assert.equal(shaper.fontMetrics(style), null);
  assert.equal(requests.length, 1);
});

test('production numeric variable binding records the new ratio unit with a component override in one save', () => {
  const design = createDocument(); const node = createNode('text'); addNode(design, node);
  const collection = createVariableCollection(design, 'Typography');
  const variable = createVariable(design, collection.id, 'Leading', 'number', 1.4);
  const state = { document: design, selectedIds: [node.id] }; const overrides = []; let saves = 0; let checkpoints = 0;
  const bind = new Function('state', 'showToast', 'selectedNodes', 'booleanSourceAncestor', 'renderUI',
    'canBindVariable', 'checkpoint', 'bindVariable', 'resizeTextLayers', 'componentInstanceRoot', 'recordComponentOverride',
    'relayoutVariableBoundFrames', 'queueSave', 'renderer',
    `${extract('function applyVariablePropertyToSelection(', 'function createColorVariableFromSelection(')}\nreturn applyVariablePropertyToSelection;`
  )(state, message => { throw new Error(message); }, () => [node], () => null, () => {}, canBindVariable,
    () => checkpoints++, bindVariable, () => {}, () => ({ id: 'component' }),
    (_root, target, property) => overrides.push({ property, value: structuredClone(target[property]) }),
    () => {}, () => saves++, { invalidate() {} });
  bind('lineHeight', variable.id);
  assert.equal(node.lineHeightUnit, 'ratio'); assert.equal(node.variableBindings.lineHeight, variable.id);
  assert.deepEqual(overrides, [{ property: 'variableBindings', value: { lineHeight: variable.id } },
    { property: 'lineHeightUnit', value: 'ratio' }]);
  assert.equal(checkpoints, 1); assert.equal(saves, 1);
});
