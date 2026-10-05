import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { createDocument, createNode, addNode } from '../src/model.js';
import { layoutPlainText, layoutTextRuns, calculateTextBox } from '../src/text-layout.js';
import { createTextLeadingTrimResolver, resolveTextLeadingTrim, canvasLeadingTrimMetrics, TextLeadingTrimPendingError, TEXT_LEADING_TRIM_LIMITS } from '../src/text-leading-trim.js';
import { collectTextOutlineGeometry, collectTextDecorationGeometry, prepareTextOutlineGeometry } from '../src/text-outline-geometry.js';
import { localTextInkBounds } from '../src/renderer.js';
import { createTextPathGeometry } from '../src/text-on-path.js';

const CAP = Object.freeze({ type: 'CAP_HEIGHT' });
const measure = (text, style = { fontSize: 20 }) => text.length * style.fontSize * .5;
const metrics = style => ({ capHeight: style.fontSize * .7, ascender: style.fontSize * .8 });
const base = { fontFamily: 'Local', fontSize: 20, lineHeight: 1.5, leadingTrim: CAP };
function shaped(text, style = base) {
  return { upem: 1000, extents: { ascender: 800 }, leadingTrimMetrics: { capHeight: 700 },
    glyphs: [...text].map((char, cluster) => ({ id: char.codePointAt(0), cluster, xAdvance: 500, yAdvance: 0, xOffset: 0, yOffset: 0,
      path: /\s/u.test(char) ? '' : char === 'g' ? 'M0 -200 L500 -200 L500 700 L0 700 Z' : 'M0 0 L500 0 L500 700 L0 700 Z' })) };
}
function scene(properties = {}) {
  const document = createDocument(); const node = createNode('text', { text: 'Hg\nHp', width: 200, height: 60, ...base, ...properties });
  addNode(document, node); return { document, node };
}
const plain = (text, options = {}) => layoutPlainText(text, 200, text => measure(text, base), {
  lineHeight: 30, leadingTrim: CAP, leadingTrimStyle: base, leadingTrimMetrics: metrics, strictLeadingTrim: true, ...options });

test('block trim uses actual first cap and final baseline, retaining internal and paragraph distances immutably', () => {
  const layout = plain('Hg\nHp', { paragraphSpacing: 5 });
  assert.deepEqual(layout.lines.map(line => line.y), [-2, 33]);
  assert.equal(layout.height, 49); assert.deepEqual(layout.leadingTrim, { topInset: 2, bottomInset: 14, metricSource: 'actual' });
  const untrimmed = { lines: [{ y: 0, lineHeight: 30, displayText: 'Hg' }, { y: 35, lineHeight: 30, displayText: 'Hp' }], width: 20, height: 65 };
  const original = structuredClone(untrimmed);
  assert.equal(resolveTextLeadingTrim(untrimmed, { node: base, measureMetrics: metrics, strict: true }).height, 49);
  assert.deepEqual(untrimmed, original);
});

test('truncation evaluates each candidate trimmed block before dropping lines or adding ellipsis', () => {
  const fitting = plain('Hg\nHp', { textTruncation: 'ending', boxHeight: 44 });
  assert.equal(fitting.lines.length, 2); assert.equal(fitting.height, 44); assert.equal(fitting.lines[1].displayText, 'Hp');
  const shorter = plain('Hg\nHp', { textTruncation: 'ending', boxHeight: 43 });
  assert.equal(shorter.lines.length, 1); assert.equal(shorter.lines[0].displayText, 'Hg…'); assert.equal(shorter.height, 14);
  const capped = plain('Hg\nHp', { textTruncation: 'ending', maxLines: 1, maxHeight: 44 });
  assert.equal(capped.lines.length, 1); assert.equal(capped.height, 14);
});

test('mixed rich NONE overrides preserve the full line edge and manual shifts remain additive', () => {
  const firstNormal = layoutTextRuns([{ text: 'Hg\n', leadingTrim: { type: 'NONE' } }, { text: 'Hp' }], 200, base, measure,
    { leadingTrimMetrics: metrics, strictLeadingTrim: true });
  assert.deepEqual(firstNormal.lines.map(line => line.y), [0, 30]); assert.equal(firstNormal.height, 46);
  const lastNormal = layoutTextRuns([{ text: 'Hg\n' }, { text: 'Hp', leadingTrim: { type: 'NONE' } }], 200, base, measure,
    { leadingTrimMetrics: metrics, strictLeadingTrim: true });
  assert.deepEqual(lastNormal.lines.map(line => line.y), [-2, 28]); assert.equal(lastNormal.height, 58);
  const shifted = layoutTextRuns([{ text: 'H', baselineShift: 4 }], 200, base, measure,
    { leadingTrimMetrics: metrics, strictLeadingTrim: true });
  assert.equal(shifted.leadingTrim.topInset, -2); assert.equal(shifted.height, 14);
});

test('paragraph marker metrics and list spacing participate without trimming between list items', () => {
  const layout = plain('H\nH', { listSpacing: 7, markerStyle: base, paragraphStyles: [{ listStyle: 'numbered' }, { listStyle: 'numbered' }] });
  assert.equal(layout.lines[1].y - layout.lines[0].y, 37); assert.equal(layout.height, 51);
  assert.ok(layout.lines.every(line => line.marker?.text));
});

test('normal long documents bypass trim-specific budgets and text-path placement ignores block trim', () => {
  const layout = { lines: [{ y: 0, lineHeight: 30, displayText: 'x'.repeat(100_000) }], height: 30 };
  const none = createTextLeadingTrimResolver({ text: 'x'.repeat(100_000), textRuns: Array.from({ length: 5000 }, () => ({ text: 'x' })) });
  assert.equal(none.active, false); assert.equal(none.resolve(layout), layout);
  const path = createTextLeadingTrimResolver({ ...base, textPath: {} }); assert.equal(path.active, false); assert.equal(path.resolve(layout), layout);
  const { document, node } = scene({ text: 'Hg', textPath: createTextPathGeometry(createNode('line', { width: 180, height: 20 })) });
  const trimmed = collectTextOutlineGeometry(document, node, { shapeText: shaped }); delete node.leadingTrim;
  assert.deepEqual(collectTextOutlineGeometry(document, node, { shapeText: shaped }).geometry, trimmed.geometry);
});

test('Canvas cap metrics measure the same top-to-alphabetic origin and restore caller state', () => {
  const context = { font: 'saved', textAlign: 'right', textBaseline: 'middle', measureText(value) {
    assert.equal(value, 'H'); assert.match(this.font, /600 20px Local/u); return { actualBoundingBoxAscent: this.textBaseline === 'top' ? -2 : 14 }; } };
  assert.deepEqual(canvasLeadingTrimMetrics(context, { ...base, fontAxes: { wght: 600 } }), { capHeight: 14, ascender: 16, source: 'canvas' });
  assert.equal(context.font, 'saved'); assert.equal(context.textAlign, 'right'); assert.equal(context.textBaseline, 'middle');
  assert.equal(canvasLeadingTrimMetrics({ measureText: () => ({ width: 10 }) }, base), null, 'missing actual ink metrics cannot become a ratio');
});

test('pending native metrics propagate through collectors and ink bounds while ready unsupported fonts use real Canvas metrics', () => {
  const { document, node } = scene({ textDecoration: 'underline', textDecorationStyle: 'wavy' });
  const pending = () => null; pending.fontStatus = () => 'pending';
  assert.throws(() => collectTextOutlineGeometry(document, node, { shapeText: pending }), TextLeadingTrimPendingError);
  assert.throws(() => collectTextDecorationGeometry(document, node, { shapeText: pending, measureText: measure }), TextLeadingTrimPendingError);
  pending.isPreparedTextExport = true;
  assert.throws(() => localTextInkBounds(document, node, pending), TextLeadingTrimPendingError);
  pending.isPreparedTextExport = false;
  pending.fontStatus = () => 'none'; const fallbackMeasure = (...args) => measure(...args); fallbackMeasure.leadingTrimMetrics = metrics;
  const collected = collectTextDecorationGeometry(document, node, { shapeText: pending, measureText: fallbackMeasure });
  assert.equal(collected.decorations.length, 2); assert.equal(collected.layout.height, 44);
  assert.throws(() => createTextLeadingTrimResolver(base, { strict: true }).resolve({ lines: [{ y: 0, lineHeight: 30, displayText: 'H' }], height: 30 }), /actual cap-height/u);
});

test('a fallback run missing native cap metrics cannot be silently omitted from the block envelope', () => {
  const shape = text => ({ mixedRuns: [{ text: text.slice(0, 1), shaped: shaped(text.slice(0, 1)) }, { text: text.slice(1), shaped: null }] });
  const layout = { lines: [{ y: 0, lineHeight: 30, displayText: 'HΩ' }], height: 30 };
  assert.throws(() => createTextLeadingTrimResolver(base, { shapeText: shape, strict: true }).resolve(layout), /actual cap-height/u);
  const resolved = createTextLeadingTrimResolver(base, { shapeText: shape, strict: true, measureMetrics: () => ({ capHeight: 18, ascender: 20 }) }).resolve(layout);
  assert.equal(resolved.height, 18); assert.equal(resolved.leadingTrim.topInset, 2);
});

test('active trim bounds native fallback complexity and query memory without budgeting normal part text', () => {
  const style = { ...base };
  const tooLong = { lines: [{ y: 0, lineHeight: 30, displayText: 'H'.repeat(TEXT_LEADING_TRIM_LIMITS.maxTextPerQuery + 1) }], height: 30 };
  assert.throws(() => createTextLeadingTrimResolver(base, { measureMetrics: metrics }).resolve(tooLong), /query budget/u);
  const tooMany = { mixedRuns: Array.from({ length: TEXT_LEADING_TRIM_LIMITS.maxMetricRuns }, () => ({ shaped: shaped('H') })) };
  assert.throws(() => createTextLeadingTrimResolver(base, { shapeText: () => tooMany }).resolve({ lines: [{ y: 0, lineHeight: 30, displayText: 'H' }], height: 30 }), /run budget/u);
  const parts = Array.from({ length: 5000 }, () => ({ text: 'x'.repeat(100), style: { ...style, leadingTrim: { type: 'NONE' } } }));
  parts.push({ text: 'H', style });
  assert.doesNotThrow(() => createTextLeadingTrimResolver(base, { measureMetrics: metrics }).resolve({ lines: [{ y: 0, lineHeight: 30, parts }], height: 30 }));
});

test('auto-fit uses cap-box height without old minimum or padding, while normal and fixed boxes keep their behavior', () => {
  const context = { font: '', measureText: value => ({ width: value.length * 10 }) };
  const { node } = scene({ text: 'H', textFit: 'auto-height', height: 200 });
  assert.equal(calculateTextBox(context, node, { shapeText: shaped }).height, 14);
  node.textFit = 'auto-width'; assert.equal(calculateTextBox(context, node, { shapeText: shaped }).height, 14);
  node.textFit = 'fixed'; assert.equal(calculateTextBox(context, node, { shapeText: shaped }).height, 200);
  node.textFit = 'auto-height'; delete node.leadingTrim; assert.equal(calculateTextBox(context, node, { shapeText: shaped }).height, 36);
});

test('editable glyphs retain unclipped descenders beyond the trimmed cap box and decorations follow shared placement', async () => {
  const { document, node } = scene({ text: 'Hg', height: 14, textDecoration: 'underline', textDecorationStyle: 'wavy', textDecorationColor: { type: 'solid', color: '#ff00aa', opacity: .4 } });
  const result = collectTextOutlineGeometry(document, node, { shapeText: shaped });
  assert.equal(result.layout.height, 14); assert.equal(result.glyphs[0].geometry.strokeContours[0].start.y, 14);
  assert.equal(result.glyphs[1].geometry.strokeContours[0].start.y, 18); assert.equal(result.clipGeometry, undefined);
  assert.ok(localTextInkBounds(document, node, shaped).bottom > node.height);
  const measureShape = (text, style) => text.length * style.fontSize * .5; measureShape.shapeText = shaped;
  const decorations = collectTextDecorationGeometry(document, node, { measureText: measureShape });
  assert.deepEqual(decorations.decorations, result.decorations);
  const prepared = await prepareTextOutlineGeometry(document, node, { shapeText: async (text, style) => shaped(text, style) });
  assert.deepEqual(prepared.geometry, result.geometry); assert.equal(node.height, 14);
});

test('real retained Inter cap metrics drive first/last local glyph baselines without font-ratio estimates', async () => {
  const face = new hb.Face(new hb.Blob(await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))))));
  const shape = (text, style) => {
    const font = new hb.Font(face); font.setScale(face.upem, face.upem); font.setVariations([new hb.Variation('opsz', 32), new hb.Variation('wght', 650)]);
    const buffer = new hb.Buffer(); buffer.addText(text); buffer.guessSegmentProperties(); hb.shape(font, buffer);
    return { upem: face.upem, extents: font.hExtents(), leadingTrimMetrics: { capHeight: font.getMetricPosition(hb.MetricsTag.CAP_HEIGHT) },
      glyphs: buffer.getGlyphInfosAndPositions().map(glyph => ({ ...glyph, id: glyph.codepoint, path: font.glyphToPath(glyph.codepoint) })) };
  };
  const { document, node } = scene({ text: 'Hg\nHp', fontSize: 48, width: 300, height: 10, fontAxes: { opsz: 32, wght: 650 } });
  const result = collectTextOutlineGeometry(document, node, { shapeText: shape });
  const font = shape('H', node); const expectedCap = font.leadingTrimMetrics.capHeight * 48 / font.upem;
  assert.equal(result.layout.height, expectedCap + 72); assert.equal(result.clipGeometry, undefined);
  assert.ok(result.glyphs[0].geometry.strokeContours[0].start.y <= expectedCap);
  assert.ok(localTextInkBounds(document, node, shape).bottom > result.layout.height);
  node.text = 'H2\nAg'; node.textRuns = [{ text: 'H', textPosition: 'normal' }, { text: '2\n', textPosition: 'superscript' }, { text: 'Ag', textPosition: 'normal' }];
  const prepared = await prepareTextOutlineGeometry(document, node, { shapeText: async (value, style) => {
    assert.doesNotMatch(value, /[\r\n\t]/u, 'layout controls must not be queried as editable glyphs');
    return shape(value, style);
  } });
  assert.ok(prepared.glyphs.length >= 4); assert.equal(node.text, 'H2\nAg');
});


test('cold raw previews retain actual Canvas ink bounds while strict exports wait for native metrics', () => {
  const { document, node } = scene();
  const pending = () => null; pending.fontStatus = () => 'pending';
  let measured = 0;
  const context = { font: '', textAlign: 'left', textBaseline: 'top', save() {}, restore() {}, measureText(text) {
    measured++; return { width: text.length * 10, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 10,
      actualBoundingBoxAscent: this.textBaseline === 'top' ? -2 : 14,
      actualBoundingBoxDescent: this.textBaseline === 'top' ? 20 : 4 };
  } };
  const bounds = localTextInkBounds(document, node, pending, { measureContext: context });
  assert.ok(bounds && [bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite));
  assert.ok(measured > 2, 'preview fallback must replay the actual measured text');
  pending.isPreparedTextExport = true;
  assert.throws(() => localTextInkBounds(document, node, pending, { measureContext: context }), TextLeadingTrimPendingError);
});
