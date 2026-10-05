import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { createDocument, createNode } from '../src/model.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { importSvgToLayers } from '../src/svg-import.js';
import { createVectorPdf, PdfVectorExportError } from '../src/pdf-vector-export.js';
import { assertVectorPdfTextSupported } from '../src/pdf-text-support.js';
import { createTextPathGeometry } from '../src/text-on-path.js';

const text = properties => createNode('text', { text: 'Hg\nHp', fontFamily: 'Arial', fontSize: 20, width: 160, height: 60, stroke: null, strokeWidth: 0, leadingTrim: { type: 'CAP_HEIGHT' }, ...properties });
const measure = (value, style) => [...value].length * style.fontSize * .5;
measure.leadingTrimMetrics = style => ({ capHeight: style.fontSize * .7, ascender: style.fontSize * .8 });
const all = nodes => nodes.flatMap(node => [node, ...all(node.children || [])]);
const decode = value => value.replace(/&quot;/gu, '"').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>');
function alterMetadata(svg, mutate) {
  return svg.replace(/(data-tiny-image-star-text-decoration-v1=")([^"]+)(")/u, (_, start, value, end) => {
    const payload = JSON.parse(decode(value)); mutate(payload);
    return start + JSON.stringify(payload).replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;') + end;
  });
}
const hasTrim = svg => all(importSvgToLayers(svg).nodes).some(node => node.leadingTrim?.type === 'CAP_HEIGHT');
function pdfMeasure() { const result = (...args) => measure(...args); result.leadingTrimMetrics = measure.leadingTrimMetrics;
  result.pdfNaturalWidth = result; result.pdfBaselineOffset = style => style.fontSize * .8; return result; }
const pdfText = bytes => new TextDecoder('latin1').decode(bytes);

test('cap trim moves block edges with measured metrics, preserves internal baseline distances and descenders', () => {
  const node = text(); const snapshot = structuredClone(node); const svg = exportNodeToSvg(node, { measureText: measure });
  assert.match(svg, /<tspan x="0" y="-2"[^>]*>Hg<\/tspan><tspan x="0" y="23"/u);
  assert.doesNotMatch(svg, /clipPath/u, 'trim is layout rather than glyph clipping');
  assert.match(svg, /font-size="20"/u); assert.deepEqual(node, snapshot);
  const restored = all(importSvgToLayers(svg).nodes).find(node => node.type === 'text');
  assert.deepEqual(restored.leadingTrim, { type: 'CAP_HEIGHT' }); assert.equal(restored.text, node.text);
  assert.equal(restored.lineHeight, node.lineHeight); assert.equal(restored.fontSize, 20);
});

test('trimmed content height determines middle/bottom alignment without changing authored line height', () => {
  const middle = exportNodeToSvg(text({ verticalAlign: 'middle' }), { measureText: measure });
  const bottom = exportNodeToSvg(text({ verticalAlign: 'bottom' }), { measureText: measure });
  assert.match(middle, /<tspan x="0" y="8.5"/u); assert.match(bottom, /<tspan x="0" y="19"/u);
});

test('native fallback trim recovery is bound to visible placement and rejects metric/reference smuggling', () => {
  const svg = exportNodeToSvg(text(), { measureText: measure }); assert.ok(hasTrim(svg));
  for (const altered of [
    alterMetadata(svg, payload => { payload.leadingTrimMetrics[0][1].capHeight = 1; }),
    alterMetadata(svg, payload => { payload.leadingTrimMetrics[0][1].assetId = 'private-font'; }),
    alterMetadata(svg, payload => { payload.source.leadingTrim = { type: 'NONE' }; }),
    alterMetadata(svg, payload => { payload.source.textRuns = [{ text: payload.source.text, leadingTrim: { type: 'CAP_HEIGHT', fontId: 'private' } }]; }),
    svg.replace('y="-2"', 'y="-3"'), svg.replace('font-size="20"', 'font-size="21"')
  ]) {
    try { assert.equal(hasTrim(altered), false); } catch (error) { assert.notEqual(error.name, 'AssertionError'); }
  }
  const translated = svg.replace(/(<svg[^>]*>)/u, '$1<g transform="translate(7 9)" opacity=".4">').replace('</svg>', '</g></svg>');
  assert.ok(hasTrim(translated));
});

test('rich normal override retains the line box while trimmed runs preserve manual and semantic positions', () => {
  const node = text({ text: 'A2\nBg', textPosition: 'subscript', textRuns: [
    { text: 'A', leadingTrim: { type: 'NONE' }, textPosition: 'normal' },
    { text: '2\n', textPosition: 'superscript', baselineShift: 2 },
    { text: 'Bg', textPosition: 'normal', fontSize: 24 }
  ] });
  const svg = exportNodeToSvg(node, { measureText: measure });
  const restored = all(importSvgToLayers(svg).nodes).find(node => node.type === 'text');
  assert.deepEqual(restored.textRuns, node.textRuns); assert.deepEqual(restored.leadingTrim, node.leadingTrim);
  assert.match(svg, /font-size="24"/u); assert.match(svg, /font-size="13"/u);
});

test('trimmed height is considered before ending truncation and decorations use final shared line positions', () => {
  const node = text({ height: 39, textTruncation: 'ending', textDecoration: 'underline', textDecorationStyle: 'wavy',
    textDecorationColor: { type: 'solid', color: '#ee22aa', opacity: .4 } });
  const svg = exportNodeToSvg(node, { measureText: measure });
  assert.match(svg, />Hp<\/tspan>/u); assert.doesNotMatch(svg.replace(/data-tiny-image-star-text-decoration-v1="[^"]+"/u, ''), /…/u);
  assert.equal((svg.match(/data-tiny-image-star-text-decoration="underline"/gu) || []).length, 2);
  assert.match(svg, /clipPath/u, 'ending truncation alone retains its explicit logical clip');
});

test('text on a path retains authored trim without applying block-edge offsets to alphabetic placement', () => {
  const path = createTextPathGeometry(createNode('line', { width: 160, height: 30 }));
  const plain = exportNodeToSvg(text({ id: 'trim-path', text: 'Hg', leadingTrim: undefined, textPath: path }), { measureText: measure });
  const trimmed = exportNodeToSvg(text({ id: 'trim-path', text: 'Hg', textPath: path }), { measureText: measure });
  assert.equal(trimmed, plain);
});

test('trim metrics are mandatory, pending failures survive export and NONE uses the legacy path without limits', () => {
  const noMetrics = (...args) => measure(...args);
  assert.throws(() => exportNodeToSvg(text(), { measureText: noMetrics }), /metric|cap|trim/u);
  const pending = (...args) => measure(...args); pending.leadingTrimMetrics = () => { const error = new Error('queued trim'); error.code = 'TEXT_LEADING_TRIM_PENDING'; throw error; };
  assert.throws(() => exportNodeToSvg(text(), { measureText: pending }), error => error.code === 'TEXT_LEADING_TRIM_PENDING');
  assert.throws(() => exportNodeToSvg({ ...text(), leadingTrim: { type: 'CAP_HEIGHT', fontId: 'unsafe' } }, { measureText: measure }), /valid leading trim/u);
  const old = text({ text: 'x'.repeat(40_000), leadingTrim: undefined, width: 100_000 });
  assert.doesNotThrow(() => exportNodeToSvg(old, { measureText: noMetrics }));
});

test('standard-font PDF trims use actual per-run baselines and preserve different sizes', () => {
  const node = text({ text: 'A\nBg', textRuns: [{ text: 'A\n' }, { text: 'Bg', fontSize: 24, baselineShift: 2 }] });
  assert.equal(assertVectorPdfTextSupported(createDocument(), node), true);
  const svg = exportNodeToSvg(node, { measureText: pdfMeasure() }); const pdf = pdfText(createVectorPdf(svg));
  assert.match(svg, /data-tiny-image-star-pdf-leading-trim="CAP_HEIGHT"/u);
  assert.match(pdf, /\/F\d+ 24 Tf/u); assert.match(pdf, /1 0 0 1 0 14 Tm/u); assert.match(pdf, /1 0 0 1 0 40.2 Tm/u);
  assert.doesNotMatch(pdf, /\/Subtype \/Image/u);
  assert.throws(() => createVectorPdf(svg.replace('data-tiny-image-star-pdf-leading-trim="CAP_HEIGHT"', 'data-tiny-image-star-pdf-leading-trim="bogus"')), PdfVectorExportError);
  assert.throws(() => assertVectorPdfTextSupported(createDocument(), text({ fontFamily: 'Private Local' })), /custom text fonts/u);
  assert.throws(() => assertVectorPdfTextSupported(createDocument(), { ...text(), leadingTrim: { type: 'CAP' } }), /leading trim/u);
});

test('real HarfBuzz Inter cap metrics export actual unclipped contours without authoritative font metadata', async () => {
  const face = new hb.Face(new hb.Blob(await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))))));
  const shape = (value, style) => { const font = new hb.Font(face); font.setScale(face.upem, face.upem);
    const buffer = new hb.Buffer(); buffer.addText(value); buffer.guessSegmentProperties(); hb.shape(font, buffer);
    return { upem: face.upem, extents: font.hExtents(), leadingTrimMetrics: { capHeight: font.getMetricPosition(hb.MetricsTag.CAP_HEIGHT) },
      glyphs: buffer.getGlyphInfosAndPositions().map(glyph => ({ ...glyph, id: glyph.codepoint, path: font.glyphToPath(glyph.codepoint) })) }; };
  const measured = (value, style) => { const shaped = shape(value, style); return shaped.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0) * style.fontSize / shaped.upem; }; measured.shapeText = shape;
  const node = text({ fontFamily: 'Retained Local', fontSize: 48, text: 'Hg\nHp', width: 200, height: 30 });
  const svg = exportNodeToSvg(node, { measureText: measured });
  assert.doesNotMatch(svg, /<text\b|text-decoration-v1=|clipPath/u);
  assert.match(svg, /data-tiny-image-star-positioned-glyph=/u);
  const restored = all(importSvgToLayers(svg).nodes); assert.ok(restored.some(node => node.type === 'path'));
  assert.ok(restored.every(node => !node.leadingTrim && node.type !== 'text'));
  const pdf = pdfText(createVectorPdf(svg)); assert.doesNotMatch(pdf, /\/BaseFont|\/Subtype \/Image/u);
});
