import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode } from '../src/model.js';
import { exportNodeToSvg, SvgExportError } from '../src/svg-export.js';
import { importSvgToLayers } from '../src/svg-import.js';
import { assertVectorPdfTextSupported } from '../src/pdf-text-support.js';
import { createVectorPdf, PdfVectorExportError } from '../src/pdf-vector-export.js';

const text = properties => createNode('text', { text: 'Hg\nHp', fontFamily: 'Arial', fontSize: 20, lineHeight: 1.25, lineHeightUnit: 'ratio', width: 180, height: 90, stroke: null, strokeWidth: 0, ...properties });
const measure = (value, style) => [...value].length * style.fontSize * .5;
const metrics = style => ({ ascent: style.fontSize * .8, descent: style.fontSize * .2, lineGap: style.fontSize * .1, topBaseline: style.fontSize * .7 });
function browserMeasure() { const result = (...args) => measure(...args); result.textLineMetrics = metrics; return result; }
function pdfMeasure() { const result = browserMeasure(); result.pdfNaturalWidth = result; result.pdfBaselineOffset = style => style.fontSize * .7; return result; }
const all = nodes => nodes.flatMap(node => [node, ...all(node.children || [])]);
const decode = value => value.replace(/&quot;/gu, '"').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>');
function alter(svg, mutate) {
  return svg.replace(/(data-tiny-image-star-text-decoration-v1=")([^"]+)(")/u, (_, start, value, end) => {
    const payload = JSON.parse(decode(value)); mutate(payload);
    return start + JSON.stringify(payload).replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;') + end;
  });
}
function shape(value, style) {
  return { upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 100 }, leadingTrimMetrics: { capHeight: 700 },
    glyphs: [...value].map((character, cluster) => ({ id: character.codePointAt(0), cluster, xAdvance: 500, yAdvance: 0, xOffset: 0, yOffset: 0,
      path: /\s/u.test(character) ? '' : 'M0 0 L500 0 L500 700 L0 700 Z' })) };
}
function localMeasure() { const result = (...args) => measure(...args); result.shapeText = shape; return result; }
const pdfText = bytes => new TextDecoder('latin1').decode(bytes);

test('browser text emits measured alphabetic baselines with half leading and preserves authored layout', () => {
  const node = text({ lineHeight: 40, lineHeightUnit: 'pixels' }); const original = structuredClone(node);
  const svg = exportNodeToSvg(node, { measureText: browserMeasure() });
  assert.match(svg, /dominant-baseline="alphabetic"/u);
  assert.match(svg, /<tspan x="0" y="26"[^>]*>Hg<\/tspan><tspan x="0" y="66"/u);
  assert.deepEqual(node, original);
  const restored = all(importSvgToLayers(svg).nodes).find(node => node.type === 'text');
  assert.equal(restored.fontSize, 20); assert.equal(restored.lineHeight, 40); assert.equal(restored.lineHeightUnit, 'pixels');
});

test('mixed sizes share one alphabetic baseline and manual shifts are applied exactly once', () => {
  const node = text({ text: 'A2\nB', textRuns: [{ text: 'A' }, { text: '2\n', fontSize: 40, baselineShift: 3 }, { text: 'B' }] });
  const svg = exportNodeToSvg(node, { measureText: browserMeasure() });
  assert.match(svg, /font-size="20"[^>]*x="0" y="37"/u);
  assert.match(svg, /font-size="40"[^>]*x="10" y="34"/u);
  assert.match(svg, /font-size="20"[^>]*x="0" y="66"/u);
  const restored = all(importSvgToLayers(svg).nodes).find(node => node.type === 'text'); assert.deepEqual(restored.textRuns, node.textRuns);
});

test('Auto uses measured font ascent, descent and line gap instead of a fixed font-size ratio', () => {
  const svg = exportNodeToSvg(text({ lineHeightUnit: 'auto', lineHeight: 1.25 }), { measureText: browserMeasure() });
  assert.match(svg, /<tspan x="0" y="17"[^>]*>Hg<\/tspan><tspan x="0" y="39"/u);
});

test('fallback metric recovery binds the measured text as well as font style', () => {
  const measured = browserMeasure(); const requested = [];
  measured.textLineMetrics = (style, value) => {
    requested.push(value);
    return value === '\u03a9' ? { ascent: 18, descent: 6, lineGap: 0, topBaseline: 16 } : metrics(style);
  };
  const node = text({ text: 'H\n\u03a9', lineHeight: 25, lineHeightUnit: 'pixels' });
  const svg = exportNodeToSvg(node, { measureText: measured });
  assert.ok(requested.includes('\u03a9'));
  assert.match(svg, /<tspan x="0" y="18.5"[^>]*>H<\/tspan><tspan x="0" y="41.5"/u);
  const restored = all(importSvgToLayers(svg).nodes).find(node => node.type === 'text');
  assert.equal(restored.text, node.text); assert.equal(restored.lineHeight, 25);
});

test('optional native recovery metadata does not cap large ordinary browser text exports', () => {
  const svg = exportNodeToSvg(text({ text: '"'.repeat(100_000), width: 100_000, height: 1000 }), { measureText: browserMeasure() });
  assert.match(svg, /dominant-baseline="alphabetic"/u);
  assert.doesNotMatch(svg, /text-decoration-v1=/u, 'oversized optional recovery evidence is omitted');
  assert.equal((svg.match(/&quot;/gu) || []).length, 100_000, 'all authored text is retained after dropping optional metadata');
});

test('native baseline recovery binds metric evidence, visible coordinates, fonts, paragraph lists and inherited context', () => {
  const node = text({ paragraphStyles: [{ listStyle: 'numbered' }, { listStyle: 'bulleted' }] });
  const svg = exportNodeToSvg(node, { measureText: browserMeasure() });
  const restored = all(importSvgToLayers(svg).nodes).find(node => node.type === 'text'); assert.deepEqual(restored.paragraphStyles, node.paragraphStyles);
  for (const altered of [
    alter(svg, payload => { payload.textLineMetrics[0][1].ascent += 2; }),
    alter(svg, payload => { payload.textLineMetrics[0][1].assetId = 'private'; }),
    alter(svg, payload => { payload.source.paragraphStyles[0].componentId = 'private'; }),
    svg.replace('dominant-baseline="alphabetic"', 'dominant-baseline="hanging"'),
    svg.replace(/(<svg[^>]+)/u, '$1 font-size="25"')
  ]) {
    try { assert.equal(all(importSvgToLayers(altered).nodes).some(node => node.type === 'text' && node.paragraphStyles), false); }
    catch (error) { assert.notEqual(error.name, 'AssertionError'); }
  }
});

test('retained ordinary fonts export real glyphs without recipient font dependencies or metadata authority', () => {
  const svg = exportNodeToSvg(text({ fontFamily: 'Retained Font', text: 'AB' }), { measureText: localMeasure() });
  assert.doesNotMatch(svg, /<text\b|font-family|text-decoration-v1=/u);
  assert.equal((svg.match(/data-tiny-image-star-positioned-glyph=/gu) || []).length, 2);
  const imported = all(importSvgToLayers(svg).nodes); assert.ok(imported.some(node => node.type === 'path'));
  assert.ok(imported.every(node => node.type !== 'text'));
  assert.doesNotThrow(() => createVectorPdf(svg));
});

test('ordinary retained-font SVG collection has an export budget separate from editable outline conversion', () => {
  const svg = exportNodeToSvg(text({ fontFamily: 'Retained Font', text: 'A'.repeat(1400), width: 20_000, height: 40 }), { measureText: localMeasure() });
  assert.equal((svg.match(/data-tiny-image-star-positioned-glyph=/gu) || []).length, 1400);
});

test('partial local-font coverage refuses a font-dependent substitution and queued ordinary fonts preserve typed pending', () => {
  const measured = browserMeasure(); measured.shapeText = (value, style) => value === 'AB'
    ? { mixedRuns: [{ text: 'A', shaped: shape('A', style) }, { text: 'B', shaped: null }] } : shape(value, style);
  assert.throws(() => exportNodeToSvg(text({ text: 'AB' }), { measureText: measured }), error => error instanceof SvgExportError && /mixed.*coverage.*raster/u.test(error.message));
  measured.shapeText = () => null; measured.shapeText.fontStatus = () => 'pending';
  assert.throws(() => exportNodeToSvg(text(), { measureText: measured }), error => String(error.code).endsWith('_PENDING'));
});

test('standard rich PDF reads the visible alphabetic baseline without adding font ascent again', () => {
  const node = text({ text: 'A2\nB', textRuns: [{ text: 'A' }, { text: '2\n', fontSize: 40, baselineShift: 3 }, { text: 'B' }] });
  assert.equal(assertVectorPdfTextSupported(createDocument(), node), true);
  const svg = exportNodeToSvg(node, { measureText: pdfMeasure() }); const pdf = pdfText(createVectorPdf(svg));
  assert.match(pdf, /1 0 0 1 0 37 Tm/u); assert.match(pdf, /1 0 0 1 10 34 Tm/u); assert.match(pdf, /1 0 0 1 0 66 Tm/u);
  assert.match(pdf, /\/F\d+ 40 Tf/u); assert.doesNotMatch(pdf, /\/Subtype \/Image/u);
  assert.throws(() => createVectorPdf(svg.replace('data-tiny-image-star-pdf-baseline="alphabetic"', 'data-tiny-image-star-pdf-baseline="bogus"')), PdfVectorExportError);
  assert.throws(() => createVectorPdf(svg.replace('data-tiny-image-star-pdf-x="10"', 'data-tiny-image-star-pdf-x="11"')), PdfVectorExportError);
  assert.throws(() => assertVectorPdfTextSupported(createDocument(), text({ fontFamily: 'Retained Font' })), /custom text fonts/u);
});

test('standard plain and listed PDF text preserve exact baseline spacing without rasterization', () => {
  const svg = exportNodeToSvg(text({ paragraphStyles: [{ listStyle: 'bulleted' }, { listStyle: 'numbered' }] }), { measureText: pdfMeasure() });
  const output = pdfText(createVectorPdf(svg));
  assert.equal((output.match(/ 18\.5 Tm/gu) || []).length, 2); assert.equal((output.match(/ 43\.5 Tm/gu) || []).length, 2);
  assert.doesNotMatch(output, /\/Subtype \/Image/u);
});
