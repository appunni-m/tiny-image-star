import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextLineMetricResolver, canvasTextLineMetrics, resolveTextLineLayout, TextLineMetricsPendingError } from '../src/text-line-metrics.js';
import { layoutPlainText, layoutTextRuns, textGraphemes } from '../src/text-layout.js';
import { createDocument, createNode, addNode } from '../src/model.js';
import { collectTextOutlineGeometry } from '../src/text-outline-geometry.js';
import { nativeInkContoursForShapedText } from '../src/text-decoration.js';

const base = { fontFamily: 'Primary', fontSize: 20, fontWeight: 400, lineHeight: 1, lineHeightUnit: 'auto', letterSpacing: 0 };
const glyph = { id: 1, cluster: 0, xAdvance: 500, yAdvance: 0, xOffset: 0, yOffset: 0, path: 'M0 0L400 0L400 700L0 700Z' };
const shape = (text, style) => ({ upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 100 },
  leadingTrimMetrics: { capHeight: 700 }, glyphs: [...text].map((_, cluster) => ({ ...glyph, cluster })) });
const measure = (text, style = base) => [...text].length * style.fontSize / 2;
const options = { shapeText: shape, strictTextLineMetrics: true };

test('first line splits leading, subsequent lines place it above, and explicit pixels never expand to ink', () => {
  const layout = layoutPlainText('H\nH\nH', 200, measure, { ...options, lineHeight: 30, textStyle: { ...base, lineHeight: 30, lineHeightUnit: 'pixels' } });
  assert.deepEqual(layout.lines.map(line => line.y), [0, 30, 60]);
  assert.deepEqual(layout.lines.map(line => line.baselineY), [21, 51, 81]);
  assert.deepEqual(layout.lines.map(line => line.topOffset), [5, 5, 5]);
  assert.equal(layout.height, 90);
  const small = layoutPlainText('H\nH', 200, measure, { ...options, lineHeight: 10, textStyle: { ...base, lineHeight: 10, lineHeightUnit: 'pixels' } });
  assert.deepEqual(small.lines.map(line => line.baselineY), [11, 21]);
  assert.equal(small.height, 20, 'negative leading is retained; glyph ink can escape the logical box');
});

test('rich sizes share an alphabetic baseline and variable line heights preserve the first half leading', () => {
  const runs = [{ text: 'H', fontSize: 40, lineHeight: 50, lineHeightUnit: 'pixels' }, { text: 'H\nH', lineHeight: 24, lineHeightUnit: 'pixels' }];
  const layout = layoutTextRuns(runs, 200, base, measure, options);
  assert.deepEqual(layout.lines.map(line => [line.y, line.lineHeight, line.baselineY]), [[0, 50, 37], [50, 24, 65]]);
  assert.deepEqual(layout.lines[0].parts.map(part => part.topOffset), [5, 21]);
  assert.equal(layout.height, 74);
  assert.equal(layout.lines.at(-1).baselineY + layout.lines.at(-1).descent + layout.textLineMetrics.firstHalfLeading, 74);
  assert.equal(runs[0].fontSize, 40, 'authored typography is unchanged');
});

test('Auto takes real native gap, empty paragraph struts, and authored superscript envelope', () => {
  const plain = layoutPlainText('H\n\nH', 200, measure, { ...options, lineHeight: 24, textStyle: base });
  assert.deepEqual(plain.lines.map(line => line.lineHeight), [22, 22, 22]);
  const rich = layoutTextRuns([{ text: 'H', fontSize: 12, authoredFontSize: 20, textPositionBaselineOffset: -7, baselineShift: 3 }], 200, base, measure, options);
  assert.equal(rich.height, 22); assert.equal(rich.lines[0].baselineY, 17);
  assert.equal(rich.lines[0].parts[0].baselineOffset, -10);
  assert.equal(rich.lines[0].parts[0].topOffset, 17 - 10 - 9.6);
});

test('legacy rich lineHeight without a unit remains a ratio when the layer defaults to Auto', () => {
  const layout = layoutTextRuns([{ text: 'H', lineHeight: 2 }], 200, base, measure, options);
  assert.equal(layout.height, 40); assert.equal(layout.lines[0].parts[0].style.lineHeightUnit, 'ratio');
});

test('ellipsis reconstruction retains actual last-line part baselines before cap trim', () => {
  const layout = layoutTextRuns([{ text: 'HH\n' }, { text: 'HH', fontSize: 40 }, { text: ' HH\nHH' }], 55, base, measure,
    { ...options, textTruncation: 'ending', maxLines: 2, boxHeight: 1000 });
  assert.equal(layout.lines.length, 2); assert.ok(layout.lines.at(-1).displayText.endsWith('…'));
  for (const part of layout.lines.at(-1).parts) {
    assert.ok(Number.isFinite(part.topOffset));
    assert.equal(layout.lines.at(-1).y + part.topOffset + part.textLineMetrics.topBaseline, layout.lines.at(-1).baselineY + part.baselineOffset);
  }
  const trimmed = layoutTextRuns([{ text: 'H\nH', fontSize: 40 }], 200, { ...base, leadingTrim: { type: 'CAP_HEIGHT' } }, measure, options);
  assert.equal(trimmed.lines[0].baselineY, 28); assert.equal(trimmed.lines.at(-1).baselineY, trimmed.height);
});

test('declared retained metrics do not inherit emoji or fallback font box inflation', () => {
  const mixed = () => ({ primaryFontMetrics: { upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 100 } }, mixedRuns: [
    { text: 'H', shaped: shape('H', base) }, { text: '🙂', shaped: { ...shape('🙂', base), extents: { ascender: 1800, descender: -700, lineGap: 500 } } }
  ] });
  const metrics = createTextLineMetricResolver({ shapeText: mixed, strict: true }).metricsFor('H🙂', base);
  assert.deepEqual([metrics.ascent, metrics.descent, metrics.lineGap], [16, 4, 2]);
});

test('emoji-only fallback uses actual displayed paint baseline while retaining declared native line height', () => {
  const requests = []; const shaper = (text, style) => { requests.push(text); return text === '🙂' ? null : shape(text, style); };
  shaper.fontStatus = (_, text) => text === '🙂' ? 'none' : 'ready';
  shaper.fontMetrics = () => ({ upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 100 } });
  shaper.fontMetricsStatus = () => 'ready';
  const resolver = createTextLineMetricResolver({ shapeText: shaper, strict: true,
    measureMetrics: (_, text) => ({ ascent: 30, descent: 10, lineGap: 0, topBaseline: text === '🙂' ? 12 : 16 }) });
  const actual = resolver.metricsFor('🙂', base);
  assert.deepEqual([actual.ascent, actual.descent, actual.lineGap, actual.topBaseline], [16, 4, 2, 12]);
  assert.deepEqual(requests, [], 'the space glyph must not stand in for an uncovered displayed emoji');
});

test('Canvas top origin uses actual alphabetic delta, not a cap-height or full-ascent ratio', () => {
  const context = { font: 'saved', textAlign: 'right', textBaseline: 'middle', measureText() { return {
    fontBoundingBoxAscent: 19.375, fontBoundingBoxDescent: 4.82421875,
    actualBoundingBoxAscent: this.textBaseline === 'alphabetic' ? 14 : -.609375 } } };
  const value = canvasTextLineMetrics(context, base, 'H');
  assert.equal(value.topBaseline, 14.609375); assert.equal(value.ascent, 19.375); assert.equal(value.lineGap, 0);
  assert.deepEqual([context.font, context.textAlign, context.textBaseline], ['saved', 'right', 'middle']);
});

test('cold metrics fail strictly but preview can keep actual Canvas measurements while warming', () => {
  const cold = () => null; cold.fontStatus = () => 'pending'; cold.fontMetricsStatus = () => 'pending';
  const measureMetrics = () => ({ ascent: 16, descent: 4, lineGap: 0, topBaseline: 14 });
  assert.throws(() => createTextLineMetricResolver({ shapeText: cold, measureMetrics, strict: true }).metricsFor('H', base), TextLineMetricsPendingError);
  const resolver = createTextLineMetricResolver({ shapeText: cold, measureMetrics });
  assert.equal(resolver.metricsFor('H', base).topBaseline, 14); assert.equal(resolver.provisional, true);
  const document = createDocument(); const node = createNode('text', { ...base, text: 'H' }); addNode(document, node);
  cold.fontStatus = () => 'ready';
  assert.throws(() => collectTextOutlineGeometry(document, node, { shapeText: cold }), TextLineMetricsPendingError,
    'ready cmap coverage does not pretend a queued ordinary glyph query is ready');
});

test('fallback metrics remain text-sensitive, and large ordinary text is not capped by outline or semantic budgets', () => {
  const metrics = (_, value) => ({ ascent: value.startsWith('A') ? 16 : 18, descent: 4, lineGap: 0, topBaseline: 14 });
  const resolver = createTextLineMetricResolver({ measureMetrics: metrics, strict: true });
  assert.equal(resolver.metricsFor('A', base).ascent, 16); assert.equal(resolver.metricsFor('B', base).ascent, 18);
  const text = ('ordinary line\n').repeat(8000);
  const layout = layoutPlainText(text, 200, measure, { lineHeight: 24, textStyle: base, textLineMetrics: metrics, strictTextLineMetrics: true });
  assert.equal(layout.lines.length, 8001); assert.ok(layout.textLineMetrics); assert.equal(layout.height, 8001 * 22);
});

test('mixed native glyph contours share the line baseline and skip-ink contour placement uses that same baseline', () => {
  const secondary = { ...shape('B', base), extents: { ascender: 600, descender: -400, lineGap: 0 } };
  const mixed = { primaryFontMetrics: { upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 100 } },
    mixedRuns: [{ text: 'A', shaped: shape('A', base) }, { text: 'B', shaped: secondary }] };
  const document = createDocument(); const node = createNode('text', { ...base, text: 'AB', width: 200, height: 100 }); addNode(document, node);
  const shaper = text => text === 'AB' ? mixed : shape(text, base);
  const collected = collectTextOutlineGeometry(document, node, { shapeText: shaper });
  assert.deepEqual(collected.glyphs.map(item => item.geometry.strokeContours[0].start.y), [17, 17]);
  const contours = nativeInkContoursForShapedText(mixed, { fontSize: 20, baselineY: 17 });
  assert.deepEqual(contours.map(item => item.start.y), [17, 17]);
});

test('unknown width-only callers retain provisional legacy layout instead of inventing actual metrics', () => {
  const old = { lines: [{ y: 0, lineHeight: 25, displayText: 'H' }], height: 25 };
  assert.equal(resolveTextLineLayout(old, { baseStyle: base }), old);
});

test('large grapheme segmentation projects each segment before advancing the iterator', () => {
  let current = 0; const count = 100_000;
  const segmenter = { segment() { return { *[Symbol.iterator]() {
    for (let index = 0; index < count; index++) {
      current = index;
      yield { get segment() { assert.equal(current, index, 'never retain SegmentData objects until the whole input is materialized'); return 'a'; },
        get input() { throw new Error('full input strings must not be copied from SegmentData'); } };
    }
  } }; } };
  const result = textGraphemes('a'.repeat(count), segmenter);
  assert.equal(result.length, count); assert.equal(result.join(''), 'a'.repeat(count));
});
