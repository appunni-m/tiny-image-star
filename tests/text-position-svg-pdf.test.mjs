import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { createDocument, createNode, createFillLayer, createGradientFill } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { exportNodeToSvg, SvgExportError } from '../src/svg-export.js';
import { importSvgToLayers } from '../src/svg-import.js';
import { createVectorPdf, PdfVectorExportError } from '../src/pdf-vector-export.js';
import { assertVectorPdfTextSupported } from '../src/pdf-text-support.js';
import { createTextPathGeometry } from '../src/text-on-path.js';
import { TextPositionPendingError } from '../src/text-position.js';

const measure = (text, style) => [...text].length * style.fontSize * .5 + Math.max(0, [...text].length - 1) * (style.letterSpacing || 0);
const text = properties => createNode('text', { text: 'A2B', fontFamily: 'Arial', fontSize: 20, width: 120, height: 50, stroke: null, strokeWidth: 0, ...properties });
const all = nodes => nodes.flatMap(node => [node, ...all(node.children || [])]);
const decode = value => value.replace(/&quot;/gu, '"').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>');
function changeMetadata(svg, mutate) {
  return svg.replace(/(data-tiny-image-star-text-decoration-v1=")([^"]+)(")/u, (_, start, value, end) => {
    const payload = JSON.parse(decode(value)); mutate(payload);
    return start + JSON.stringify(payload).replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;') + end;
  });
}
function pdfMeasurer() {
  const result = (...args) => measure(...args);
  result.pdfNaturalWidth = result;
  result.pdfBaselineOffset = style => style.fontSize * .72;
  return result;
}
const pdfText = bytes => new TextDecoder('latin1').decode(bytes);
const metrics = { superscript: { xSize: 650, ySize: 600, xOffset: 20, yOffset: 350 }, subscript: { xSize: 650, ySize: 600, xOffset: -20, yOffset: 150 } };
function shape(text, style) {
  const active = style.fontFeatures?.sups || style.fontFeatures?.subs;
  return { upem: 1000, extents: { ascender: 800 }, positionMetrics: metrics, glyphs: [...text].map((character, cluster) => ({
    id: character.codePointAt(0) + (active && /\d/u.test(character) ? 1000 : 0), cluster,
    xAdvance: active && /\d/u.test(character) ? 400 : 600, yAdvance: 0, xOffset: 0, yOffset: 0,
    path: /\s/u.test(character) ? '' : active && /\d/u.test(character)
      ? 'M0 400 L250 400 L250 700 L0 700 Z' : 'M0 0 L500 0 L500 700 L0 700 Z' })) };
}
function localMeasure(shaper = shape) {
  const measured = (value, style) => { const result = shaper(value, style); return result.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0) * style.fontSize / result.upem + Math.max(0, value.length - 1) * (style.letterSpacing || 0); };
  measured.shapeText = shaper;
  return measured;
}

test('fontless synthesis emits measured editable sizes/offsets while preserving authored content and line metrics', () => {
  const node = text({ textPosition: 'superscript', text: 'AB\nCD' }); const original = structuredClone(node);
  const svg = exportNodeToSvg(node, { measureText: measure });
  assert.match(svg, /font-size="13"[^>]*x="0" y="0"/u);
  assert.match(svg, /<tspan x="0" y="25"/u, 'logical line height uses authored20px rather than synthesized13px');
  assert.doesNotMatch(svg, /font-feature-settings/u);
  assert.deepEqual(node, original);
  const restored = all(importSvgToLayers(svg).nodes).find(node => node.type === 'text');
  assert.equal(restored.textPosition, 'superscript'); assert.equal(restored.fontSize, 20);
  assert.equal(restored.text, 'AB\nCD');
});

test('rich source inheritance and normal overrides preserve exact run positions, sizes and manual shifts', () => {
  const node = text({ textPosition: 'subscript', textRuns: [
    { text: 'A', textPosition: 'normal' }, { text: '2', baselineShift: 2 }, { text: 'B', textPosition: 'superscript' }
  ] });
  const svg = exportNodeToSvg(node, { measureText: measure });
  assert.match(svg, /font-size="20"[^>]*x="0" y="0"/u);
  assert.match(svg, /font-size="13"[^>]*x="10" y="8"/u);
  assert.match(svg, /font-size="13"[^>]*x="16.5" y="0"/u);
  const restored = all(importSvgToLayers(svg).nodes).find(node => node.type === 'text');
  assert.equal(restored.textPosition, 'subscript'); assert.deepEqual(restored.textRuns, node.textRuns);
});

test('source recovery is bound to complete generated placement and never grants metadata authority over visible SVG', () => {
  const svg = exportNodeToSvg(text({ textPosition: 'subscript' }), { measureText: measure });
  for (const altered of [
    changeMetadata(svg, payload => { payload.source.textPosition = 'superscript'; }),
    changeMetadata(svg, payload => { payload.source.textRuns = [{ text: 'A2B', assetId: 'untrusted' }]; }),
    changeMetadata(svg, payload => { payload.source.textPosition = 'bogus'; }),
    svg.replace('font-size="13"', 'font-size="14"'), svg.replace('y="10"', 'y="11"')
  ]) {
    try { assert.ok(all(importSvgToLayers(altered).nodes).every(node => !node.textPosition), 'an altered graph cannot promote authored position'); }
    catch (error) { assert.notEqual(error.name, 'AssertionError'); }
  }
  const translated = svg.replace(/(<svg[^>]*>)/u, '$1<g transform="translate(12 15)" opacity=".4">').replace('</svg>', '</g></svg>');
  const imported = all(importSvgToLayers(translated).nodes);
  const restored = imported.find(node => node.type === 'text');
  assert.equal(restored.textPosition, 'subscript');
  assert.ok(imported.some(node => node.type === 'group' && node.opacity === .4 && node.x === 12 && node.y === 15));
});

test('invalid authored positions and pending local glyphs refuse export before emitting provisional text', () => {
  assert.throws(() => exportNodeToSvg({ ...text(), textPosition: 'super' }, { measureText: measure }), /valid text position/u);
  const pending = (...args) => measure(...args); pending.shapeText = () => null; pending.shapeText.fontStatus = () => 'pending';
  assert.throws(() => exportNodeToSvg(text({ textPosition: 'superscript' }), { measureText: pending }), TextPositionPendingError);
});

test('genuine substituted glyphs are self-contained actual contours and import as editable artwork without font authority', () => {
  const node = text({ text: '12', textPosition: 'superscript', fontFamily: 'Local', color: '#ee2200', fillOpacity: .4 });
  const svg = exportNodeToSvg(node, { measureText: localMeasure() });
  assert.match(svg, /data-tiny-image-star-positioned-glyph="1049" d="M 0 8 L 5 8 L 5 2 L 0 2 Z"/u);
  assert.match(svg, /fill="#ee2200" fill-opacity="0.4"/u);
  assert.doesNotMatch(svg, /<text\b|font-feature-settings|text-decoration-v1=/u);
  const restored = all(importSvgToLayers(svg).nodes);
  assert.ok(restored.some(node => node.type === 'path')); assert.ok(restored.every(node => !node.textPosition && node.type !== 'text'));
  const pdf = createVectorPdf(svg); assert.doesNotMatch(pdfText(pdf), /\/BaseFont|\/Subtype \/Image/u);
});

test('incomplete native coverage synthesizes the whole positioned layer with actual nonuniform font metrics', () => {
  const node = text({ text: '1A', textPosition: 'superscript', fontFamily: 'Local' });
  const svg = exportNodeToSvg(node, { measureText: localMeasure() });
  assert.match(svg, /data-tiny-image-star-positioned-glyph="49" d="M 0.4 9 L 6.9 9 L 6.9 0.6 L 0.4 0.6 Z"/u);
  assert.match(svg, /data-tiny-image-star-positioned-glyph="65"/u);
  assert.doesNotMatch(svg, /positioned-glyph="1049"/u, 'every run uses the same synthesis decision');
});

test('positioned glyph paints retain fill planes, independent underline color and authored stroke ordering once', () => {
  const node = text({ text: 'A', textPosition: 'superscript', fontFamily: 'Local', height: 2, opacity: .5,
    textDecoration: 'underline', textDecorationColor: { type: 'solid', color: '#00ff00', opacity: .3 },
    fills: [createFillLayer('solid', { color: '#ff0000', opacity: .2 }), createFillLayer('solid', { color: '#0000ff', opacity: .6 })],
    strokes: [createStroke({ width: 3, color: '#aabbcc', opacity: .4 }), createStroke({ width: 1, color: '#ccaa00' })] });
  const svg = exportNodeToSvg(node, { measureText: localMeasure() });
  assert.equal((svg.match(/fill="#00ff00"/gu) || []).length, 1);
  assert.match(svg, /glyph-fill-plane/u); assert.match(svg, /stroke-width="3"/u);
  assert.ok(svg.indexOf('fill="#0000ff"') < svg.indexOf('stroke="#aabbcc"'));
  assert.ok(svg.indexOf('stroke="#aabbcc"') < svg.indexOf('stroke="#ccaa00"'));
  assert.equal((svg.match(/opacity="0.5"/gu) || []).length, 1, 'layer opacity is applied once');
});

test('positioned explicit fills union opaque glyph coverage before applying each paint alpha', () => {
  const node = text({ text: 'AA', textPosition: 'subscript', fontFamily: 'Local', letterSpacing: -6,
    color: 'transparent', fills: [createFillLayer('solid', { color: '#0000ff', opacity: .3 })] });
  const svg = exportNodeToSvg(node, { measureText: localMeasure() });
  assert.equal((svg.match(/fill="#0000ff" fill-opacity="0.3"/gu) || []).length, 1);
  assert.match(svg, /<mask[^>]*mask-type="alpha"[^>]*>.*fill="#ffffff" fill-opacity="1".*fill="#ffffff" fill-opacity="1"/u);
  assert.match(svg, /<rect[^>]*mask="url\(#tis-positioned-glyph-fill-plane-/u);
  assert.doesNotThrow(() => createVectorPdf(svg));
});

test('compressed glyph strokes preserve their line paint basis without scaling font-metric widths twice', () => {
  const gradient = createGradientFill('linear', '#123456');
  const node = text({ text: 'W', width: 3, textPosition: 'superscript', fontFamily: 'Local', strokes: [createStroke({ width: 4, gradient })] });
  const svg = exportNodeToSvg(node, { measureText: localMeasure() });
  assert.match(svg, /<g[^>]*transform="matrix\(0.384615384615 0 0 1 0 0\)"><path[^>]*stroke-width="4"/u);
  assert.match(svg, /stroke="url\(#tis-gradient-0-stroke-0\)"/u);
  assert.match(svg, /<linearGradient[^>]*gradientUnits="userSpaceOnUse" x1="0" y1="25" x2="3" y2="25"/u);
  // The existing generic SVG/PDF subsets explicitly refuse gradient strokes;
  // they must not flatten this result to a misleading solid stroke.
  assert.throws(() => importSvgToLayers(svg), /unsupported|gradient/u);
  assert.throws(() => createVectorPdf(svg), PdfVectorExportError);
});

test('aligned glyph stroke overlap has one authored alpha and excludes rich underline coverage from alignment masks', () => {
  const node = text({ text: 'AA', letterSpacing: -6, textPosition: 'subscript', fontFamily: 'Local',
    textRuns: [{ text: 'AA', textDecoration: 'underline' }], strokes: [createStroke({ width: 4, opacity: .3, alignment: 'outside' })] });
  const svg = exportNodeToSvg(node, { measureText: localMeasure() });
  assert.match(svg, /<g[^>]*mask="url\(#tis-stroke-alignment-0-0\)"><g[^>]*opacity="0.3"/u);
  const mask = /<mask id="tis-stroke-alignment-0-0"[^>]*>(.*?)<\/mask>/u.exec(svg)[1];
  assert.doesNotMatch(mask, /data-tiny-image-star-text-decoration=/u);
  assert.equal((svg.match(/stroke-opacity="0.3"/gu) || []).length, 0);
  assert.doesNotThrow(() => createVectorPdf(svg));
});

test('positioned local text-on-path uses the shared placed glyph geometry and custom underline contours', () => {
  const node = text({ text: 'A2', textPosition: 'subscript', fontFamily: 'Local', textDecoration: 'underline', textDecorationStyle: 'wavy',
    textPath: createTextPathGeometry(createNode('line', { width: 140, height: 45 })) });
  const svg = exportNodeToSvg(node, { measureText: localMeasure() });
  assert.doesNotMatch(svg, /<text\b|<textPath\b/u); assert.match(svg, /positioned-glyph=/u);
  assert.match(svg, /data-tiny-image-star-text-decoration="underline"/u);
  assert.doesNotThrow(() => createVectorPdf(svg));
});

test('fontless text-on-path retains effective sizes and alphabetic offsets without invented native recovery', () => {
  const node = text({ text: 'A', textPosition: 'subscript', textPath: createTextPathGeometry(createNode('line', { width: 140, height: 45 })) });
  const svg = exportNodeToSvg(node, { measureText: measure });
  assert.match(svg, /font-size="13"[^>]*baseline-shift="-3px"/u); assert.match(svg, /<textPath\b/u);
  assert.doesNotMatch(svg, /text-decoration-v1=/u);
});

test('standard-font positioned PDF text uses each measured ascent, semantic size and top offset', () => {
  const node = text({ textRuns: [{ text: 'A' }, { text: '2', textPosition: 'superscript', baselineShift: 2 }, { text: 'B', textPosition: 'subscript' }] });
  assert.equal(assertVectorPdfTextSupported(createDocument(), node), true);
  const svg = exportNodeToSvg(node, { measureText: pdfMeasurer() }); const output = pdfText(createVectorPdf(svg));
  assert.match(svg, /data-tiny-image-star-pdf-text-position="superscript" data-tiny-image-star-pdf-run-ascent="9.36"/u);
  assert.match(output, /\/F\d+ 13 Tf/u); assert.match(output, /1 0 0 1 10 7.36 Tm/u);
  assert.match(output, /1 0 0 1 16.5 19.36 Tm/u);
  assert.doesNotMatch(output, /\/Subtype \/Image/u);
});

test('PDF verifies generated position coordinates and still refuses unsupported glyphs or custom fonts', () => {
  const node = text({ textPosition: 'subscript' }); const svg = exportNodeToSvg(node, { measureText: pdfMeasurer() });
  for (const altered of [svg.replace('data-tiny-image-star-pdf-run-ascent="9.36"', 'data-tiny-image-star-pdf-run-ascent="10000"'),
    svg.replace('data-tiny-image-star-pdf-x="0"', 'data-tiny-image-star-pdf-x="1"'),
    svg.replace('data-tiny-image-star-pdf-text-position="subscript"', 'data-tiny-image-star-pdf-text-position="bogus"')]) {
    assert.throws(() => createVectorPdf(altered), PdfVectorExportError);
  }
  assert.throws(() => assertVectorPdfTextSupported(createDocument(), text({ fontFamily: 'Local', textPosition: 'superscript' })), /custom text fonts/u);
  assert.throws(() => createVectorPdf(exportNodeToSvg(text({ text: '𝒳', textPosition: 'superscript' }), { measureText: pdfMeasurer() })), /glyph|WinAnsi|character/u);
});

test('actual HarfBuzz Inter contours use OS/2 recommended dimensions, remain nonuniform and are PDF-safe paths', async () => {
  const face = new hb.Face(new hb.Blob(await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))))));
  const font = new hb.Font(face); font.setScale(face.upem, face.upem);
  const native = (text, style) => { const buffer = new hb.Buffer(); buffer.addText(text); buffer.guessSegmentProperties();
    hb.shape(font, buffer, Object.entries(style.fontFeatures || {}).map(([tag, value]) => new hb.Feature(tag, value)));
    return { upem: face.upem, extents: font.hExtents(), positionMetrics: Object.fromEntries(['superscript', 'subscript'].map(position => [position,
      Object.fromEntries([['xSize','X_SIZE'], ['ySize','Y_SIZE'], ['xOffset','X_OFFSET'], ['yOffset','Y_OFFSET']].map(([key, suffix]) => [key, font.getMetricPosition(hb.MetricsTag[`${position.toUpperCase()}_EM_${suffix}`])]))])),
      glyphs: buffer.getGlyphInfosAndPositions().map(glyph => ({ ...glyph, id: glyph.codepoint, path: font.glyphToPath(glyph.codepoint) })) }; };
  const node = text({ text: '2A', textPosition: 'superscript', fontFamily: 'Inter', fontSize: 48 });
  const original = structuredClone(node); const svg = exportNodeToSvg(node, { measureText: localMeasure(native) });
  assert.doesNotMatch(svg, /<text\b|font-feature-settings/u); assert.match(svg, / Q /u);
  assert.equal((svg.match(/positioned-glyph=/gu) || []).length, 2); assert.deepEqual(node, original);
  const imported = all(importSvgToLayers(svg).nodes).filter(node => node.type === 'path'); assert.equal(imported.length, 2);
  assert.doesNotThrow(() => createVectorPdf(svg));
});
