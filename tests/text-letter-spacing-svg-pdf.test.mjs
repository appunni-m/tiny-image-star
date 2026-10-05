import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, findNode } from '../src/model.js';
import { buildInspectOutput } from '../src/inspect.js';
import { resolvedTextLetterSpacing } from '../src/text-letter-spacing.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { importSvgToLayers } from '../src/svg-import.js';
import { assertVectorPdfTextSupported } from '../src/pdf-text-support.js';
import { createVectorPdf, PdfVectorExportError } from '../src/pdf-vector-export.js';

const text = properties => createNode('text', { text: 'AB', width: 200, height: 90, fontFamily: 'Arial', fontSize: 20,
  lineHeight: 1.25, lineHeightUnit: 'ratio', stroke: null, strokeWidth: 0, ...properties });
const measure = (value, style) => [...value].length * style.fontSize * .5 + Math.max(0, [...value].length - 1) * resolvedTextLetterSpacing(style);
function measured() {
  const result = (...args) => measure(...args);
  result.textLineMetrics = style => ({ ascent: style.fontSize * .8, descent: style.fontSize * .2, lineGap: 0, topBaseline: style.fontSize * .7 });
  return result;
}
const all = nodes => nodes.flatMap(node => [node, ...all(node.children || [])]);
const nativeText = svg => all(importSvgToLayers(svg).nodes).find(node => node.type === 'text');
const decode = value => value.replace(/&quot;/gu, '"').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>');
function alter(svg, mutate) {
  return svg.replace(/(data-tiny-image-star-text-decoration-v1=")([^"]+)(")/u, (_, start, value, end) => {
    const payload = JSON.parse(decode(value)); mutate(payload);
    return start + JSON.stringify(payload).replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;') + end;
  });
}
const generic = content => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100">${content}</svg>`;

test('percentage SVG resolves physical tracking once and recovers authored value and unit', () => {
  const node = text({ letterSpacing: 10, letterSpacingUnit: 'percent' }); const original = structuredClone(node);
  const svg = exportNodeToSvg(node, { measureText: measured() });
  assert.match(svg, /letter-spacing="2"/u); assert.match(svg, /textLength="22"/u);
  const imported = nativeText(svg); assert.equal(imported.letterSpacing, 10); assert.equal(imported.letterSpacingUnit, 'percent');
  assert.deepEqual(node, original);
});

test('rich percentage inheritance follows effective size while a legacy numeric run stays pixels', () => {
  const node = text({ text: 'ABCD', letterSpacing: 10, letterSpacingUnit: 'percent', textRuns: [
    { text: 'AB', fontSize: 40 }, { text: 'CD', letterSpacing: 1 }
  ] });
  const svg = exportNodeToSvg(node, { measureText: measured() });
  assert.match(svg, /font-size="40"[^>]*letter-spacing="4"[^>]*textLength="44"/u);
  assert.match(svg, /font-size="20"[^>]*letter-spacing="1"[^>]*x="44"[^>]*textLength="21"/u);
  assert.deepEqual(nativeText(svg).textRuns, node.textRuns);
});

test('synthesized scripts resolve percentages against effective glyph size and retain authored spacing', () => {
  const node = text({ textPosition: 'superscript', letterSpacing: 10, letterSpacingUnit: 'percent' });
  const svg = exportNodeToSvg(node, { measureText: measured() });
  assert.match(svg, /font-size="13"[^>]*letter-spacing="1.3"/u);
  assert.equal(nativeText(svg).letterSpacing, 10); assert.equal(nativeText(svg).fontSize, 20);
});

test('legacy missing units remain pixels and percentage source recovery scales only font size', () => {
  const old = text({ letterSpacing: 2 }); delete old.letterSpacingUnit;
  const svg = exportNodeToSvg(old, { measureText: measured() }); assert.match(svg, /letter-spacing="2"/u);
  const node = text({ text: 'ABCD', letterSpacing: 10, letterSpacingUnit: 'percent', textRuns: [{ text: 'AB' }, { text: 'CD', letterSpacing: 2 }] });
  const scaled = exportNodeToSvg(node, { measureText: measured() }).replace(/(<svg[^>]*>)/u, '$1<g transform="scale(2)">').replace('</svg>', '</g></svg>');
  const imported = nativeText(scaled);
  assert.equal(imported.fontSize, 40); assert.equal(imported.letterSpacing, 10); assert.equal(imported.letterSpacingUnit, 'percent');
  assert.equal(imported.textRuns[1].letterSpacing, 4);
});

test('generic SVG em tracking resolves after font-size declarations and inherits computed pixels', () => {
  for (const attributes of ['letter-spacing=".1em" font-size="20"', 'style="letter-spacing:.1em;font-size:20px"']) {
    const imported = nativeText(generic(`<text dominant-baseline="text-before-edge" ${attributes}>A<tspan font-size="40">B</tspan><tspan letter-spacing=".1em" font-size="40">C</tspan></text>`));
    assert.equal(imported.letterSpacing, 2);
    assert.equal(imported.textRuns[1].fontSize, 40); assert.equal(imported.textRuns[1].letterSpacing, undefined);
    assert.equal(imported.textRuns[2].letterSpacing, 4); assert.equal(imported.textRuns[2].letterSpacingUnit ?? 'pixels', 'pixels');
  }
  assert.throws(() => importSvgToLayers(generic('<text dominant-baseline="text-before-edge" letter-spacing="10%">AB</text>')), /unitless|px|length/u);
});

test('SVG source unit recovery rejects forged units, altered visible tracking and unrelated fields', () => {
  const svg = exportNodeToSvg(text({ letterSpacing: 10, letterSpacingUnit: 'percent' }), { measureText: measured() });
  for (const modified of [
    alter(svg, payload => { payload.source.letterSpacingUnit = 'pixels'; }),
    alter(svg, payload => { payload.source.letterSpacingUnit = 'em'; }),
    alter(svg, payload => { payload.source.letterSpacingUnit = { assetId: 'private' }; }),
    svg.replace('letter-spacing="2"', 'letter-spacing="3"')
  ]) {
    try { assert.equal(nativeText(modified)?.letterSpacingUnit === 'percent', false); }
    catch (error) { assert.notEqual(error.name, 'AssertionError'); }
  }
  assert.throws(() => exportNodeToSvg({ ...text(), letterSpacingUnit: 'em' }, { measureText: measured() }), /letter spacing unit/u);
});

test('standard PDF accepts zero percentage tracking and refuses nonzero tracking rather than dropping it', () => {
  const document = createDocument(); const zero = text({ letterSpacing: 0, letterSpacingUnit: 'percent', textRuns: [
    { text: 'A' }, { text: 'B', fontSize: 40, letterSpacing: 0, letterSpacingUnit: 'percent' }
  ] });
  assert.equal(assertVectorPdfTextSupported(document, zero), true);
  const resolver = measured(); resolver.pdfNaturalWidth = resolver; resolver.pdfBaselineOffset = style => style.fontSize * .7;
  const pdf = new TextDecoder('latin1').decode(createVectorPdf(exportNodeToSvg(zero, { measureText: resolver })));
  assert.match(pdf, /\/F\d+ 40 Tf/u); assert.doesNotMatch(pdf, /\/Subtype \/Image/u);
  const tracked = text({ letterSpacing: 10, letterSpacingUnit: 'percent' });
  assert.throws(() => assertVectorPdfTextSupported(document, tracked), error => error instanceof PdfVectorExportError && error.feature === 'letter spacing');
  assert.throws(() => createVectorPdf(exportNodeToSvg(tracked, { measureText: resolver })), error => error instanceof PdfVectorExportError && error.feature === 'letter spacing');
  assert.throws(() => assertVectorPdfTextSupported(document, { ...zero, letterSpacingUnit: 'em' }), /letter spacing units/u);
});

test('Inspect preserves authored percentage spacing and emits font-relative CSS', () => {
  const document = createDocument(); const node = text({ letterSpacing: 12.5, letterSpacingUnit: 'percent' }); addNode(document, node);
  const output = buildInspectOutput(document, [findNode(document, node.id)]);
  assert.match(output.css, /letter-spacing: 0.125em;/u);
  assert.equal(output.layers[0].typography.letterSpacing, 12.5); assert.equal(output.layers[0].typography.letterSpacingUnit, 'percent');
  const old = text({ letterSpacing: 2 }); delete old.letterSpacingUnit; addNode(document, old);
  assert.match(buildInspectOutput(document, [findNode(document, old.id)]).css, /letter-spacing: 2px;/u);
});
