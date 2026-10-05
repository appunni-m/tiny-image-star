import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { createDocument, createNode, createGradientFill } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { createTextPathGeometry } from '../src/text-on-path.js';
import { assertLocalTextGlyphExportReady, exportNodeToSvg } from '../src/svg-export.js';
import { assertVectorPdfTextSupported } from '../src/pdf-text-support.js';
import { createVectorPdf, PdfVectorExportError } from '../src/pdf-vector-export.js';
import { resolvedTextLetterSpacing } from '../src/text-letter-spacing.js';

const face = new hb.Face(new hb.Blob(await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))))));
function shapeText(text, style = {}) {
  const font = new hb.Font(face); font.setScale(face.upem, face.upem);
  font.setVariations(Object.entries(style.fontAxes || {}).map(([tag, value]) => new hb.Variation(tag, value)));
  const buffer = new hb.Buffer(); buffer.addText(text); buffer.guessSegmentProperties();
  hb.shape(font, buffer, Object.entries(style.fontFeatures || {}).map(([tag, value]) => new hb.Feature(tag, value)));
  return { upem: face.upem, extents: font.hExtents(),
    leadingTrimMetrics: { capHeight: font.getMetricPosition(hb.MetricsTag.CAP_HEIGHT) },
    positionMetrics: Object.fromEntries(['superscript', 'subscript'].map(position => [position,
      Object.fromEntries([['xSize', 'X_SIZE'], ['ySize', 'Y_SIZE'], ['xOffset', 'X_OFFSET'], ['yOffset', 'Y_OFFSET']]
        .map(([name, suffix]) => [name, font.getMetricPosition(hb.MetricsTag[`${position.toUpperCase()}_EM_${suffix}`])]))])),
    glyphs: buffer.getGlyphInfosAndPositions().map(glyph => ({ ...glyph, id: glyph.codepoint, path: font.glyphToPath(glyph.codepoint) })) };
}
function measureWith(shaper = shapeText) {
  const measure = (text, style = {}) => {
    const shaped = shaper(text, style);
    return shaped?.glyphs ? shaped.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0) * (style.fontSize || 24) / shaped.upem
      + Math.max(0, [...text].length - 1) * resolvedTextLetterSpacing(style) : [...text].length * (style.fontSize || 24) / 2;
  };
  measure.shapeText = shaper;
  return measure;
}
function localText(properties = {}) {
  return createNode('text', { name: 'Retained typography', text: 'O ffi q́', width: 240, height: 120,
    fontFamily: 'Retained Inter', fontSize: 40, color: '#123456', ...properties });
}
const document = createDocument();

test('native PDF preflight accepts the same complete retained glyph layouts emitted by SVG', () => {
  const measureText = measureWith();
  const cases = [
    {},
    { fontWeight: 550, fontAxes: { wght: 550, opsz: 24 }, fontFeatures: { liga: 0 }, letterSpacing: 12, letterSpacingUnit: 'percent' },
    { text: 'H2O', textRuns: [{ text: 'H', fontSize: 48 }, { text: '2', textPosition: 'superscript' }, { text: 'O', baselineShift: -3 }] },
    { text: 'One two three four', width: 100, align: 'justify', letterSpacing: 1 },
    { textPath: createTextPathGeometry(createNode('line', { width: 250, height: 50 })), letterSpacing: 5, letterSpacingUnit: 'percent' },
    { textDecoration: 'underline', textDecorationStyle: 'wavy', textDecorationThickness: { unit: 'pixels', value: 2 },
      textDecorationSkipInk: true, leadingTrim: { type: 'CAP_HEIGHT' }, strokes: [createStroke({ width: 3, color: '#ff0000', alignment: 'outside' })] }
  ];
  for (const properties of cases) {
    const node = localText(properties); const before = structuredClone(node);
    assert.equal(assertLocalTextGlyphExportReady(document, node, measureText), true);
    assert.equal(assertVectorPdfTextSupported(document, node, { measureText }), true);
    const markup = exportNodeToSvg(node, { document, measureText });
    assert.doesNotMatch(markup, /<text\b|font-family/u, 'local fonts are preserved as self-contained contours');
    const pdf = Buffer.from(createVectorPdf(markup)).toString('latin1');
    assert.doesNotMatch(pdf, /\/BaseFont| Tj|\/Subtype \/Image/u);
    assert.deepEqual(node, before);
  }
});

test('standard fallback keeps its original font, tracking, glyph and path restrictions', () => {
  const shaper = () => null; shaper.fontStatus = () => 'none'; const measureText = measureWith(shaper);
  measureText.textLineMetrics = style => ({ ascent: style.fontSize * .8, descent: style.fontSize * .2,
    lineGap: 0, topBaseline: style.fontSize * .72 });
  measureText.pdfNaturalWidth = measureText;
  measureText.pdfBaselineOffset = style => style.fontSize * .72;
  const standard = localText({ fontFamily: 'Arial, sans-serif', text: 'Cafe' });
  assert.equal(assertLocalTextGlyphExportReady(document, standard, measureText), false);
  assert.equal(assertVectorPdfTextSupported(document, standard, { measureText }), true);
  assert.throws(() => assertVectorPdfTextSupported(document, localText(), { measureText }), /custom text fonts/u);
  assert.throws(() => assertVectorPdfTextSupported(document, { ...standard, letterSpacing: 1 }, { measureText }), /letter spacing/u);
  assert.throws(() => assertVectorPdfTextSupported(document, { ...standard,
    textPath: createTextPathGeometry(createNode('line', { width: 200, height: 20 })) }, { measureText }), /text on a path/u);
  const cjk = { ...standard, text: '漢字' };
  assert.equal(assertVectorPdfTextSupported(document, cjk, { measureText }), true);
  assert.throws(() => createVectorPdf(exportNodeToSvg(cjk, { document, measureText })), /text glyph coverage/u);
});

test('native font metadata cannot replace actual ready and complete glyph coverage', () => {
  const node = localText({ text: 'AB' });
  for (const status of ['ready', 'pending']) {
    const shaper = () => null; shaper.fontStatus = () => status;
    assert.throws(() => assertVectorPdfTextSupported(document, node, { measureText: measureWith(shaper) }),
      error => String(error.code || '').endsWith('_PENDING'), status);
  }
  const missing = (value, style) => ({ ...shapeText(value, style), missingGlyph: true });
  assert.throws(() => assertVectorPdfTextSupported(document, node, { measureText: measureWith(missing) }),
    error => error instanceof PdfVectorExportError && error.feature === 'local text glyph coverage');
  const partial = (value, style) => ({ mixedRuns: [{ text: 'A', shaped: shapeText('A', style) }, { text: 'B', shaped: null }] });
  assert.throws(() => assertVectorPdfTextSupported(document, node, { measureText: measureWith(partial) }), /mixed.*coverage/u);
  const unretainedRun = shapeText.bind(null); unretainedRun.fontStatus = style => style.fontFamily === 'Browser Font' ? 'none' : 'ready';
  assert.throws(() => assertVectorPdfTextSupported(document, { ...node,
    textRuns: [{ text: 'A' }, { text: 'B', fontFamily: 'Browser Font' }] }, { measureText: measureWith(unretainedRun) }), /mixed.*coverage/u);
});

test('native preflight validates actual emitted contours rather than only the eligibility probe', () => {
  const malformed = (value, style) => { const shaped = shapeText(value, style);
    return { ...shaped, glyphs: shaped.glyphs.map(glyph => ({ ...glyph, path: 'M 0 0 L 10 10' })) }; };
  assert.throws(() => assertVectorPdfTextSupported(document, localText(), { measureText: measureWith(malformed) }),
    error => error instanceof PdfVectorExportError && /open filled contour/u.test(error.message));
  const wrapped = (value, style) => value === 'AB' ? shapeText(value, style)
    : { ...shapeText(value, style), missingGlyph: true };
  assert.throws(() => assertVectorPdfTextSupported(document, localText({ text: 'AB', width: 20 }),
    { measureText: measureWith(wrapped) }), error => error instanceof PdfVectorExportError,
  'ready whole-run metadata cannot authorize a wrapped subline whose actual glyphs are missing');
});

test('native contours preserve existing paint and blend refusals and invalid typography guards', () => {
  const measureText = measureWith();
  for (const properties of [
    { fills: [{ id: 'gradient', type: 'linear', gradient: createGradientFill('linear', '#123456'), visible: true, opacity: 1 }] },
    { fills: [{ id: 'blend', type: 'solid', color: '#123456', visible: true, opacity: 1, blendMode: 'multiply' }] },
    { blendMode: 'multiply' }
  ]) assert.throws(() => assertVectorPdfTextSupported(document, localText(properties), { measureText }), PdfVectorExportError);
  for (const properties of [{ fontSize: 0 }, { fontSize: Infinity }, { letterSpacing: Infinity },
    { text: 'A', textRuns: [{ text: 'A', baselineShift: Infinity }] }, { letterSpacingUnit: 'em' }]) {
    assert.throws(() => assertVectorPdfTextSupported(document, { ...localText(), ...properties }, { measureText }), PdfVectorExportError);
  }
});
