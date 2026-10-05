import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { resolvedLetterSpacing, resolvedTextLetterSpacing, convertLetterSpacing, inheritedTextLetterSpacing } from '../src/text-letter-spacing.js';
import { layoutTextRuns, calculateTextBox, measureTrackedText } from '../src/text-layout.js';
import { createDocument, createNode, addNode } from '../src/model.js';
import { collectTextOutlineGeometry, prepareTextOutlineGeometry } from '../src/text-outline-geometry.js';
import { resolveTextPositionView } from '../src/text-position.js';
import { createTextPathGeometry, textPathSpans } from '../src/text-on-path.js';

const base = { fontFamily: 'Local', fontSize: 20, fontWeight: 400, lineHeight: 24, lineHeightUnit: 'pixels', letterSpacing: 10, letterSpacingUnit: 'percent' };
const shape = (text, style) => ({ upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 },
  glyphs: [...text].map((char, cluster) => ({ id: char.codePointAt(0), cluster, xAdvance: 500, yAdvance: 0, xOffset: 0, yOffset: 0,
    path: /\s/u.test(char) ? '' : 'M0 0L400 0L400 700L0 700Z' })) });
const context = () => ({ font: '', measureText(text) { return { width: [...text].length * (Number(/([\d.]+)px/u.exec(this.font)?.[1]) || 20) / 2 }; } });
const measure = (text, style) => [...text].length * style.fontSize / 2 + Math.max(0, [...text].length - 1) * resolvedTextLetterSpacing(style);
const scene = props => { const document = createDocument(); const node = createNode('text', { ...base, text: 'HH', width: 200, height: 100, ...props }); addNode(document, node); return { document, node }; };

test('letter spacing resolves effective percentages and signed pixels without changing authored numbers', () => {
  assert.equal(resolvedLetterSpacing(10, 20, 'percent'), 2);
  assert.equal(resolvedLetterSpacing(-10, 40, 'percent'), -4);
  assert.equal(resolvedLetterSpacing(2, 100), 2);
  const style = { fontSize: 40, letterSpacing: 7.5, letterSpacingUnit: 'percent' };
  assert.equal(resolvedTextLetterSpacing(style), 3); assert.equal(style.letterSpacing, 7.5);
  assert.equal(convertLetterSpacing(3, 40, 'pixels', 'percent'), 7.5);
  assert.equal(convertLetterSpacing(7.5, 40, 'percent', 'pixels'), 3);
  assert.equal(convertLetterSpacing(-1.25, 12, 'pixels', 'pixels'), -1.25);
  assert.throws(() => resolvedLetterSpacing(10, 0, 'percent'), /positive/u);
  assert.throws(() => resolvedLetterSpacing(Infinity, 20), /finite/u);
  assert.throws(() => resolvedLetterSpacing(1, 20, 'em'), /pixels or percent/u);
});

test('legacy rich run numbers reset inherited percentage while absent runs inherit the authored pair', () => {
  assert.deepEqual(inheritedTextLetterSpacing(base, {}), { letterSpacing: 10, letterSpacingUnit: 'percent' });
  assert.deepEqual(inheritedTextLetterSpacing(base, { letterSpacing: 1 }), { letterSpacing: 1, letterSpacingUnit: 'pixels' });
  assert.deepEqual(inheritedTextLetterSpacing(base, { letterSpacing: 5, letterSpacingUnit: 'percent' }), { letterSpacing: 5, letterSpacingUnit: 'percent' });
  const layout = layoutTextRuns([{ text: 'HH' }, { text: 'HH', fontSize: 40 }, { text: 'HH', letterSpacing: 1 }], 500, base, measure, { shapeText: shape });
  assert.deepEqual(layout.lines[0].parts.map(part => [part.style.letterSpacing, part.style.letterSpacingUnit, part.width]), [[10, 'percent', 22], [10, 'percent', 44], [1, 'pixels', 21]]);
});

test('percent and equivalent per-run pixels wrap, justify and truncate identically', () => {
  const percent = [{ text: 'HH HH ', fontSize: 20 }, { text: 'HH HH HH', fontSize: 40 }];
  const pixels = percent.map(run => ({ ...run, letterSpacing: run.fontSize / 10, letterSpacingUnit: 'pixels' }));
  for (const align of ['left', 'justify']) {
    const opts = { textTruncation: 'ending', maxLines: 2, shapeText: shape };
    const a = layoutTextRuns(percent, 75, { ...base, align }, measure, opts);
    const b = layoutTextRuns(pixels, 75, { ...base, align, letterSpacing: 2, letterSpacingUnit: 'pixels' }, measure, opts);
    assert.deepEqual(a.lines.map(line => [line.displayText, line.width, line.justificationExtraSpace, line.baselineY]), b.lines.map(line => [line.displayText, line.width, line.justificationExtraSpace, line.baselineY]));
  }
});

test('auto-size resolves each effective style once and does not relabel pixels as percentages', () => {
  const { node } = scene({ textFit: 'auto-width', text: 'HHHH' }); const authored = structuredClone(node);
  const a = calculateTextBox(context(), node, { shapeText: shape });
  const b = calculateTextBox(context(), { ...node, letterSpacing: 2, letterSpacingUnit: 'pixels' }, { shapeText: shape });
  assert.deepEqual(a, b); assert.equal(a.width, 48); assert.deepEqual(node, authored);
  const rich = { ...node, text: 'HHHH', textRuns: [{ text: 'HH' }, { text: 'HH', fontSize: 40 }] };
  const richPixels = { ...rich, letterSpacing: 2, letterSpacingUnit: 'pixels', textRuns: [{ text: 'HH', letterSpacing: 2 }, { text: 'HH', fontSize: 40, letterSpacing: 4 }] };
  assert.deepEqual(calculateTextBox(context(), rich, { shapeText: shape }), calculateTextBox(context(), richPixels, { shapeText: shape }));
});

test('semantic script styles retain authored percent and resolve spacing from reduced effective font size', () => {
  const { node } = scene({ text: 'HHHH', textRuns: [{ text: 'HH', textPosition: 'superscript' }, { text: 'HH', letterSpacing: 3, textPosition: 'subscript' }] });
  const view = resolveTextPositionView(node).node;
  const styles = layoutTextRuns(view.textRuns, 500, view, measure).lines[0].parts.map(part => part.style);
  assert.equal(styles[0].letterSpacing, 10); assert.equal(styles[0].letterSpacingUnit, 'percent');
  assert.equal(resolvedTextLetterSpacing(styles[0]), 1.3);
  assert.equal(styles[1].letterSpacingUnit, 'pixels'); assert.equal(resolvedTextLetterSpacing(styles[1]), 3);
  assert.deepEqual(node.textRuns[0], { text: 'HH', textPosition: 'superscript' });
});

test('native contour collection and paths retain percent metadata while emitting identical equivalent-pixel geometry', () => {
  const { document, node } = scene({ text: 'HH HH', textDecoration: 'underline', textDecorationStyle: 'wavy', textDecorationSkipInk: true });
  const collect = value => collectTextOutlineGeometry(document, value, { shapeText: shape });
  const a = collect(node); const b = collect({ ...node, letterSpacing: 2, letterSpacingUnit: 'pixels' });
  assert.deepEqual(a.geometry, b.geometry); assert.deepEqual(a.decorations, b.decorations);
  node.textPath = createTextPathGeometry(createNode('line', { width: 180, height: 30 }));
  const pathA = collect(node); const pathB = collect({ ...node, letterSpacing: 2, letterSpacingUnit: 'pixels' });
  assert.deepEqual(pathA.geometry, pathB.geometry);
  assert.equal(textPathSpans(node.text, node)[0].style.letterSpacingUnit, 'percent');
});

test('async outlining replays authored units without freezing a resolved spacing override', async () => {
  const { document, node } = scene({ text: 'HH HH HH', width: 50 }); const original = structuredClone(node);
  const sync = collectTextOutlineGeometry(document, node, { shapeText: shape });
  const asyncResult = await prepareTextOutlineGeometry(document, node, { shapeText: async (text, style) => shape(text, style) });
  assert.deepEqual(asyncResult.geometry, sync.geometry); assert.deepEqual(node, original);
});

test('low-level Canvas measurement continues accepting scalar pixel spacing', () => {
  const ctx = context(); ctx.font = '400 20px Local';
  assert.equal(measureTrackedText(ctx, 'HH', resolvedTextLetterSpacing(base)), 22);
  assert.equal(measureTrackedText(ctx, 'HH', -2), 18);
});

test('actual local Inter variable-font contours match percentage and equivalent pixels across rich sizes', async () => {
  const bytes = await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))));
  const face = new hb.Face(new hb.Blob(bytes));
  const nativeShape = (text, style) => { const font = new hb.Font(face); font.setScale(face.upem, face.upem);
    font.setVariations(Object.entries(style.fontAxes || {}).map(([key, value]) => new hb.Variation(key, value)));
    const buffer = new hb.Buffer(); buffer.addText(text); buffer.guessSegmentProperties(); hb.shape(font, buffer);
    return { upem: face.upem, extents: font.hExtents(), glyphs: buffer.getGlyphInfosAndPositions().map(item => ({ ...item, id: item.codepoint, path: font.glyphToPath(item.codepoint) })) }; };
  const { document, node } = scene({ text: 'To qg', fontFamily: 'Inter', fontSize: 20, fontAxes: { wght: 600, opsz: 28 },
    textRuns: [{ text: 'To ' }, { text: 'qg', fontSize: 40 }] });
  const a = collectTextOutlineGeometry(document, node, { shapeText: nativeShape });
  const b = collectTextOutlineGeometry(document, { ...node, letterSpacing: 2, letterSpacingUnit: 'pixels',
    textRuns: [{ text: 'To ', letterSpacing: 2 }, { text: 'qg', fontSize: 40, letterSpacing: 4 }] }, { shapeText: nativeShape });
  assert.deepEqual(a.geometry, b.geometry); assert.equal(a.glyphs.length, 4);
});
