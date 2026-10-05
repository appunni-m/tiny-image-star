import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { createDocument, createNode, addNode, findNode, validateDocument } from '../src/model.js';
import { interpolateSmartFrame, splitSmartFrameMatches, smartAnimateOverlaySwapPlan } from '../src/smart-animate.js';
import { createLayerClipboard, pasteLayerClipboard } from '../src/layer-clipboard.js';
import { replaceTextRunRange } from '../src/text-find-replace.js';
import { collectTextOutlineGeometry } from '../src/text-outline-geometry.js';

const text = properties => createNode('text', { name: 'Title', text: 'H2', fontSize: 20, width: 500, height: 150, ...properties });
const frame = node => createNode('frame', { children: [node] });
const spacing = node => [node.letterSpacing, node.letterSpacingUnit];

test('Smart Animate interpolates physical tracking and preserves exact authored unit endpoints', () => {
  const from = frame(text({ fontSize: 20, letterSpacing: 10, letterSpacingUnit: 'percent' }));
  const to = frame(text({ fontSize: 40, letterSpacing: -4, letterSpacingUnit: 'pixels' }));
  const originals = structuredClone([from, to]);
  assert.deepEqual(spacing(interpolateSmartFrame(from, to, .25).children[0]), [.5, 'pixels']);
  assert.deepEqual(spacing(interpolateSmartFrame(from, to, .5).children[0]), [-1, 'pixels']);
  assert.deepEqual(interpolateSmartFrame(from, to, 0), from);
  assert.deepEqual(interpolateSmartFrame(from, to, 1), to);
  assert.deepEqual([from, to], originals);
  const bothPercent = interpolateSmartFrame(from, frame(text({ fontSize: 40, letterSpacing: 20, letterSpacingUnit: 'percent' })), .5).children[0];
  assert.deepEqual(spacing(bothPercent), [5, 'pixels'], 'interpolate 2px and 8px rather than multiplying averaged authored values');
});

test('rich tracking resolves inherited percentages per font size and legacy numeric runs as pixels', () => {
  const from = frame(text({ text: 'HHHHHH', letterSpacing: 10, letterSpacingUnit: 'percent', textRuns: [
    { text: 'HH', fontSize: 20 }, { text: 'HH', fontSize: 40 }, { text: 'HH', letterSpacing: 1 }
  ] }));
  const to = frame(text({ text: 'HHHHHH', fontSize: 40, letterSpacing: 20, letterSpacingUnit: 'percent', textRuns: [
    { text: 'HH', fontSize: 40 }, { text: 'HH', fontSize: 60 }, { text: 'HH', letterSpacing: 3 }
  ] }));
  const middle = interpolateSmartFrame(from, to, .5).children[0];
  assert.deepEqual(spacing(middle), [5, 'pixels']);
  assert.deepEqual(middle.textRuns.map(spacing), [[5, 'pixels'], [8, 'pixels'], [2, 'pixels']]);
  assert.deepEqual(middle.textRuns.map(run => run.fontSize), [30, 50, undefined]);
});

test('incompatible rich range snapshots preserve their physical percentage and unit-only override', () => {
  const from = frame(text({ text: 'HHHH', letterSpacing: 10, letterSpacingUnit: 'percent', textRuns: [
    { text: 'HH', fontSize: 40 }, { text: 'HH', letterSpacingUnit: 'pixels' }
  ] }));
  const to = frame(text({ text: 'HHHH', fontSize: 60, letterSpacing: 1, textRuns: [{ text: 'HHHH', fontSize: 60 }] }));
  const quarter = interpolateSmartFrame(from, to, .25).children[0];
  assert.deepEqual(spacing(quarter), [1.75, 'pixels']);
  assert.deepEqual(quarter.textRuns.map(spacing), [[4, 'pixels'], [10, 'pixels']]);
  assert.deepEqual(quarter.textRuns.map(run => run.text), ['HH', 'HH']);
  assert.deepEqual(from.children[0].textRuns[0], { text: 'HH', fontSize: 40 });
});

test('compatible unit-only rich overrides resolve the inherited authored number before interpolation', () => {
  const from = frame(text({ letterSpacing: 10, letterSpacingUnit: 'percent', textRuns: [{ text: 'H2', letterSpacingUnit: 'pixels' }] }));
  const to = frame(text({ fontSize: 40, letterSpacing: 3, textRuns: [{ text: 'H2' }] }));
  const middle = interpolateSmartFrame(from, to, .5).children[0];
  assert.deepEqual(spacing(middle), [2.5, 'pixels']);
  assert.deepEqual(spacing(middle.textRuns[0]), [6.5, 'pixels'], 'a pixel override inherits the authored 10px, not the parent\'s 2px');
});

test('variable-bound text keeps categorical scalar values, runs and units without querying a shaper', () => {
  const from = frame(text({ letterSpacing: 10, letterSpacingUnit: 'percent', variableBindings: { letterSpacing: 'tracking-one' }, textRuns: [{ text: 'H2', fontSize: 40 }] }));
  const to = frame(text({ letterSpacing: 4, letterSpacingUnit: 'pixels', variableBindings: { letterSpacing: 'tracking-two' }, textRuns: [{ text: 'H2', fontSize: 60 }] }));
  const shapeText = () => { throw new Error('Bound typography must remain an authored snapshot.'); };
  for (const [progress, endpoint] of [[.25, from], [.75, to]]) {
    const result = interpolateSmartFrame(from, to, progress, { shapeText }).children[0];
    assert.deepEqual(spacing(result), spacing(endpoint.children[0]));
    assert.deepEqual(result.textRuns, endpoint.children[0].textRuns);
    assert.deepEqual(result.variableBindings, endpoint.children[0].variableBindings);
  }
});

test('implicit text-name matching compares the authored tracking unit in layer and run styles', () => {
  const implicit = (value, properties = {}) => text({ name: value, text: value, letterSpacing: 10, ...properties });
  assert.equal(splitSmartFrameMatches(frame(implicit('A', { letterSpacingUnit: 'percent' })), frame(implicit('B', { letterSpacingUnit: 'pixels' })), .5).matchCount, 0);
  const source = implicit('A', { letterSpacingUnit: 'percent', textRuns: [{ text: 'A', letterSpacing: 10 }] });
  const target = implicit('B', { letterSpacingUnit: 'percent', textRuns: [{ text: 'B', letterSpacing: 10, letterSpacingUnit: 'percent' }] });
  assert.equal(splitSmartFrameMatches(frame(source), frame(target), .5).matchCount, 0, 'a legacy pixel run differs from a percent run');
});

test('find/replace retains tracking units when inserted text inherits the matched rich style', () => {
  const source = [{ text: 'HHHH', letterSpacing: 10, letterSpacingUnit: 'percent', fontSize: 40 }];
  const result = replaceTextRunRange(source, 'HHHH', 1, 3, 'AA');
  assert.equal(result.map(run => run.text).join(''), 'HAAH');
  assert.ok(result.every(run => run.letterSpacing === 10 && run.letterSpacingUnit === 'percent' && run.fontSize === 40));
  assert.deepEqual(source, [{ text: 'HHHH', letterSpacing: 10, letterSpacingUnit: 'percent', fontSize: 40 }]);
});

test('layer copy/paste retains authored tracking units and sparse legacy rich overrides', () => {
  const document = createDocument();
  const original = text({ text: 'HHHHHH', letterSpacing: 10, letterSpacingUnit: 'percent', textRuns: [
    { text: 'HH', fontSize: 40 }, { text: 'HH', letterSpacing: 1 }, { text: 'HH', letterSpacing: 20, letterSpacingUnit: 'percent' }
  ] });
  addNode(document, original);
  const clipboard = createLayerClipboard(document, [findNode(document, original.id)]);
  const result = pasteLayerClipboard(document, clipboard);
  assert.deepEqual(spacing(result.nodes[0]), [10, 'percent']);
  assert.deepEqual(result.nodes[0].textRuns, original.textRuns);
  assert.equal(validateDocument(result.document), true);
});

test('native local-font metrics determine percent tracking for scripts across full, split and overlay paths', async () => {
  const face = new hb.Face(new hb.Blob(await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))))));
  const shapeText = (value, style) => {
    const font = new hb.Font(face); font.setScale(face.upem, face.upem);
    const buffer = new hb.Buffer(); buffer.addText(value); buffer.guessSegmentProperties();
    hb.shape(font, buffer, Object.entries(style.fontFeatures || {}).map(([key, setting]) => new hb.Feature(key, setting)));
    return { upem: face.upem, extents: font.hExtents(), positionMetrics: { superscript: {
      xSize: font.getMetricPosition(hb.MetricsTag.SUPERSCRIPT_EM_X_SIZE), ySize: font.getMetricPosition(hb.MetricsTag.SUPERSCRIPT_EM_Y_SIZE),
      xOffset: font.getMetricPosition(hb.MetricsTag.SUPERSCRIPT_EM_X_OFFSET), yOffset: font.getMetricPosition(hb.MetricsTag.SUPERSCRIPT_EM_Y_OFFSET)
    } }, glyphs: buffer.getGlyphInfosAndPositions().map(glyph => ({ ...glyph, id: glyph.codepoint, path: font.glyphToPath(glyph.codepoint) })) };
  };
  const fromText = text({ fontFamily: 'Inter', fontSize: 36, letterSpacing: 12, letterSpacingUnit: 'percent', textRuns: [{ text: 'H', fontSize: 48 }, { text: '2', fontSize: 48, textPosition: 'superscript' }] });
  const toText = text({ fontFamily: 'Inter', fontSize: 54, letterSpacing: 3, textRuns: [{ text: 'H', fontSize: 60, letterSpacing: 6 }, { text: '2', fontSize: 60, textPosition: 'superscript', letterSpacing: 5, letterSpacingUnit: 'percent' }] });
  const from = frame(createNode('frame', { name: 'Nested', children: [fromText] }));
  const to = frame(createNode('frame', { name: 'Nested', children: [toText] }));
  const superscriptRatio = new hb.Font(face).getMetricPosition(hb.MetricsTag.SUPERSCRIPT_EM_Y_SIZE) / face.upem;
  assert.ok(superscriptRatio > 0 && superscriptRatio !== .65, 'use actual font metrics rather than the provisional synthesis ratio');
  const expected = [5.88, 4.38 * superscriptRatio];
  const results = [
    interpolateSmartFrame(from, to, .5, { shapeText }).children[0].children[0],
    splitSmartFrameMatches(from, to, .5, { shapeText }).matchingFrame.children[0].children[0],
    smartAnimateOverlaySwapPlan(from, to, .5, { shapeText }).frame.children[0].children[0]
  ];
  for (const result of results) {
    assert.equal(result.letterSpacingUnit, 'pixels');
    result.textRuns.forEach((run, index) => { assert.equal(run.letterSpacingUnit, 'pixels'); assert.ok(Math.abs(run.letterSpacing - expected[index]) < 1e-12); });
    const document = createDocument(); addNode(document, result);
    const reference = { ...result, textRuns: result.textRuns.map((run, index) => ({ ...run, letterSpacing: expected[index], letterSpacingUnit: 'pixels' })) };
    assert.deepEqual(collectTextOutlineGeometry(document, result, { shapeText }).geometry,
      collectTextOutlineGeometry(document, reference, { shapeText }).geometry);
  }
});
