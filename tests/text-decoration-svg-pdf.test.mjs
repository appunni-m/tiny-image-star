import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, createFillLayer } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { exportNodeToSvg, SvgExportError } from '../src/svg-export.js';
import { importSvgToLayers } from '../src/svg-import.js';
import { createTextPathGeometry } from '../src/text-on-path.js';
import { createVectorPdf, PdfVectorExportError } from '../src/pdf-vector-export.js';
import { assertVectorPdfTextSupported } from '../src/pdf-text-support.js';

const pixels = value => ({ unit: 'pixels', value });
const color = { type: 'solid', color: '#00cc88', opacity: .4 };
const measure = (text, style) => [...text].length * Number(style.fontSize || 20) * .5;
const text = properties => createNode('text', { text: 'ag', width: 120, height: 40, fontSize: 20,
  fontFamily: 'Arial', stroke: null, strokeWidth: 0, textDecoration: 'underline', ...properties });
const all = nodes => nodes.flatMap(node => [node, ...all(node.children || [])]);
const nativeText = svg => all(importSvgToLayers(svg).nodes).find(node => node.type === 'text');
const customPaths = svg => [...svg.matchAll(/<path data-tiny-image-star-text-decoration="underline"[^>]*>/gu)].map(match => match[0]);
const decode = source => source.replace(/&quot;/gu, '"').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>');
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

test('custom solid underline emits a filled rectangle with requested percent thickness and signed offset', () => {
  const svg = exportNodeToSvg(text({ textDecorationThickness: { unit: 'percent', value: 10 }, textDecorationOffset: pixels(-4) }), { measureText: measure });
  assert.match(customPaths(svg)[0], /d="M 0 15.6 L 20 15.6 L 20 17.6 L 0 17.6 Z"/);
  assert.match(customPaths(svg)[0], /fill="#1e1e1e" fill-opacity="1" stroke="none"/);
});

test('dotted and wavy underlines retain actual bounded closed curve and polygon paths', () => {
  const dotted = exportNodeToSvg(text({ textDecorationStyle: 'dotted', textDecorationThickness: pixels(2) }), { measureText: measure });
  const wavy = exportNodeToSvg(text({ textDecorationStyle: 'wavy', textDecorationThickness: pixels(2) }), { measureText: measure });
  assert.equal((customPaths(dotted)[0].match(/ Z/gu) || []).length, 5);
  assert.equal((customPaths(dotted)[0].match(/ C /gu) || []).length, 20);
  assert.ok((customPaths(wavy)[0].match(/ L /gu) || []).length > 40);
  assert.doesNotMatch(customPaths(wavy)[0], /stroke-dasharray/);
});

test('far offset and wave overshoot participate in SVG bounds before effects and rotation', () => {
  const svg = exportNodeToSvg(text({ height: 10, textDecorationOffset: pixels(100), textDecorationThickness: pixels(20), rotation: 25 }), { measureText: measure });
  const [, x, y, width, height] = /viewBox="([^ ]+) ([^ ]+) ([^ ]+) ([^"]+)"/u.exec(svg).map(Number);
  assert.ok(Number.isFinite(x) && Number.isFinite(y) && width > 120 && height > 120);
});

test('typed underline paint remains independent of scalar glyph opacity and appears once per fill stack', () => {
  for (const properties of [{ fillOpacity: 0 }, { fills: [] }, { fills: [createFillLayer('solid', { color: '#ff0000', opacity: .2 }), createFillLayer('solid', { color: '#0000ff', opacity: .6 })] }]) {
    const svg = exportNodeToSvg(text({ ...properties, textDecorationColor: color }), { measureText: measure });
    assert.equal(customPaths(svg).length, 1);
    assert.match(customPaths(svg)[0], /fill="#00cc88" fill-opacity="0.4"/);
  }
  const svg = exportNodeToSvg(text({ textDecorationColor: color, strokes: [createStroke({ width: 4, color: '#aabbcc' })] }), { measureText: measure });
  assert.equal(customPaths(svg).length, 1, 'glyph stroke passes never duplicate independent underlines');
});

test('hidden, zero-alpha and zero-thickness custom underlines emit no painted paths or unavailable ink requests', () => {
  for (const properties of [{ textDecorationColor: { ...color, visible: false } }, { textDecorationColor: { ...color, opacity: 0 } }, { textDecorationThickness: pixels(0) }]) {
    const svg = exportNodeToSvg(text({ ...properties, textDecorationSkipInk: true }), { measureText: measure });
    assert.equal(customPaths(svg).length, 0);
  }
});

test('rich inherited styles keep per-run baseline offsets and horizontal compression in the decoration transform', () => {
  const svg = exportNodeToSvg(text({ text: 'ab', width: 5, textDecorationStyle: 'dotted', textDecorationThickness: pixels(2),
    textRuns: [{ text: 'a', color: '#112233' }, { text: 'b', baselineShift: 3, textDecorationStyle: 'wavy' }] }), { measureText: measure });
  const paths = customPaths(svg);
  assert.equal(paths.length, 2);
  assert.match(paths[0], /d="M 1 20.6 C 1 21.1522847498 0.776142374915 21.6 0.5 21.6/);
  assert.match(paths[1], / Z" fill=/);
  assert.match(paths[0], /fill="#112233"/);
});

test('Skip ink uses actual placed glyph coverage and emits separated real paths without native recovery authority', () => {
  const shaped = { upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 }, glyphs: [{ id: 103, cluster: 0, xAdvance: 1000, yAdvance: 0, xOffset: 0, yOffset: 0,
    path: 'M200 -400 L400 -400 L400 0 L200 0 Z' }] };
  const measured = (value, style) => value.length * style.fontSize;
  measured.shapeText = () => shaped;
  const svg = exportNodeToSvg(text({ text: 'g', textDecorationSkipInk: true, textDecorationThickness: pixels(2) }), { measureText: measured });
  assert.match(customPaths(svg)[0], /M 0 16.6 L 3 16.6/);
  assert.match(customPaths(svg)[0], /M 9 16.6 L 20 16.6/);
  assert.doesNotMatch(svg, /data-tiny-image-star-text-decoration-v1=/);
  assert.ok(all(importSvgToLayers(svg).nodes).some(node => node.type === 'path'));
  assert.throws(() => exportNodeToSvg(text({ textDecorationSkipInk: true }), { measureText: measure }), error => error instanceof SvgExportError && /actual Canvas/.test(error.message));
});

test('Skip ink accepts actual Canvas bounds and refuses malformed bounds', () => {
  const measured = (...args) => measure(...args);
  measured.textInkBounds = () => [{ left: 5, right: 9, top: 15, bottom: 25 }];
  const svg = exportNodeToSvg(text({ textDecorationSkipInk: true, textDecorationThickness: pixels(2) }), { measureText: measured });
  assert.match(customPaths(svg)[0], /M 0 19.6 L 4 19.6/);
  measured.textInkBounds = () => [{ left: NaN, right: 9, top: 15, bottom: 25 }];
  assert.throws(() => exportNodeToSvg(text({ textDecorationSkipInk: true }), { measureText: measured }), /finite actual glyph bounds/);
});

test('generated plain and rich native properties recover only from their complete bound SVG graph', () => {
  for (const properties of [{}, { textRuns: [{ text: 'a', textDecorationThickness: pixels(3) }, { text: 'g', textDecorationColor: color }] }]) {
    const source = text({ ...properties, textDecorationStyle: 'wavy', textDecorationOffset: pixels(-3), textDecorationThickness: { unit: 'percent', value: 8 } });
    const svg = exportNodeToSvg(source, { measureText: measure });
    const recovered = nativeText(svg);
    assert.equal(recovered.textDecorationStyle, 'wavy');
    assert.deepEqual(recovered.textDecorationThickness, { unit: 'percent', value: 8 });
    assert.deepEqual(recovered.textDecorationOffset, pixels(-3));
    if (source.textRuns) assert.deepEqual(recovered.textRuns, source.textRuns);
    const modified = changeMetadata(svg, payload => { payload.source.textDecorationOffset = pixels(12); });
    assert.equal(nativeText(modified).textDecorationOffset, undefined, 'forged metadata cannot replace visible authored paths');
    assert.ok(all(importSvgToLayers(modified).nodes).some(node => node.type === 'path'));
  }
});

test('native recovery rejects smuggled references, edited path paint/geometry and inherited paint authority', () => {
  const svg = exportNodeToSvg(text({ textDecorationStyle: 'dotted', textDecorationThickness: pixels(2) }), { measureText: measure });
  const variants = [
    changeMetadata(svg, payload => { payload.source.assetId = 'injected'; }),
    changeMetadata(svg, payload => { payload.source.textDecorationThickness.assetId = 'injected'; }),
    svg.replace(/(<path data-tiny-image-star-text-decoration="underline"[^>]*fill=")#[^"]+"/u, '$1#ff0000"'),
    svg.replace(/(<path data-tiny-image-star-text-decoration="underline" d=")M/u, '$1M 3 4 L'),
    svg.replace('<svg ', '<svg stroke-opacity=".5" ')
  ];
  for (const modified of variants) {
    const imported = importSvgToLayers(modified);
    const node = all(imported.nodes).find(node => node.type === 'text');
    assert.equal(node.textDecorationStyle, undefined);
    assert.ok(all(imported.nodes).some(node => node.type === 'path'));
    assert.ok(all(imported.nodes).every(node => node.assetId === undefined));
  }
  assert.equal(all(importSvgToLayers(svg.replace('<svg ', '<svg visibility="hidden" ')).nodes).some(node => node.textDecorationStyle), false);
});

test('native recovery preserves translated/opacity wrappers and scales only pixel underline metrics', () => {
  const svg = exportNodeToSvg(text({ textDecorationStyle: 'solid', textDecorationOffset: pixels(4), textDecorationThickness: { unit: 'percent', value: 10 } }), { measureText: measure });
  const wrapped = svg.replace(/(<svg[^>]*>)/u, '$1<g transform="translate(10 20) scale(2)" opacity=".6">').replace('</svg>', '</g></svg>');
  const node = nativeText(wrapped);
  assert.deepEqual(node.textDecorationOffset, pixels(8));
  assert.deepEqual(node.textDecorationThickness, { unit: 'percent', value: 10 });
  assert.equal(node.fontSize, 40);
});

test('text-path custom decorations use the shared real segment transforms and ignore native CSS decoration duplication', () => {
  const node = text({ text: 'ag', textDecorationStyle: 'dotted', textDecorationColor: color,
    textRuns: [{ text: 'ag', textDecoration: 'underline' }], textPath: createTextPathGeometry(createNode('line', { width: 80, height: 40 })) });
  const svg = exportNodeToSvg(node, { measureText: measure });
  assert.equal(customPaths(svg).length, 2);
  assert.notEqual(customPaths(svg)[0], customPaths(svg)[1], 'placed segment contours have distinct transformed coordinates');
  assert.doesNotMatch(svg, /<tspan[^>]* text-decoration="underline"/);
});

test('alpha text masks preserve independent underline geometry with no glyph fills', () => {
  for (const maskMode of ['alpha']) {
    const source = text({ fills: [], textDecorationColor: { ...color, opacity: .3 } });
    const group = createNode('group', { width: 120, height: 40, mask: true, maskMode, maskSourceId: source.id,
      children: [createNode('rectangle', { fill: '#ff0000' }), source] });
    const svg = exportNodeToSvg(group, { measureText: measure });
    const paths = customPaths(svg);
    assert.equal(paths.length, 1);
    assert.match(paths[0], /fill="#00cc88" fill-opacity="0.3"/);
  }
});

test('custom underlines remain real vector PDF paths with independent color and alpha, including rich text', () => {
  const document = createDocument();
  for (const mode of ['solid', 'dotted', 'wavy']) {
    const node = text({ textDecorationStyle: mode, textDecorationThickness: pixels(2), textDecorationOffset: pixels(3), textDecorationColor: color,
      textRuns: [{ text: 'a', color: '#112233' }, { text: 'g' }] });
    assert.equal(assertVectorPdfTextSupported(document, node), true);
    const svg = exportNodeToSvg(node, { document, measureText: pdfMeasurer() });
    const pdf = Buffer.from(createVectorPdf(svg)).toString('latin1');
    assert.match(pdf, /0 0.8 0.533333333333 rg/);
    assert.match(pdf, /\/ca 0.4/);
    assert.match(pdf, /\(a\) Tj/);
    assert.match(pdf, mode === 'dotted' ? / c\n/ : / l\n/);
  }
  assert.throws(() => assertVectorPdfTextSupported(document, { ...text(), textDecorationThickness: pixels(Infinity) }), error => error instanceof PdfVectorExportError && /custom underline/.test(error.message));
});

test('custom underline ink and effect aprons remain inside the emitted SVG filter region', () => {
  const node = text({ height: 10, textDecorationOffset: pixels(100), textDecorationThickness: pixels(4),
    effects: [{ id: 'blur', type: 'layer-blur', visible: true, radius: 5 }] });
  const svg = exportNodeToSvg(node, { measureText: measure });
  const region = /<filter[^>]* x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/u.exec(svg).slice(1).map(Number);
  assert.ok(region[1] + region[3] >= 137.6, 'filter includes the outside underline and its 15px blur apron');
});

test('explicit glyph fill planes clip automatic decorations, while independent color bypasses the fill plane', () => {
  const automatic = text({ height: 10, fills: [createFillLayer('solid', { color: '#112233' })],
    textDecorationOffset: pixels(30), textDecorationThickness: pixels(2) });
  const autoSvg = exportNodeToSvg(automatic, { measureText: measure });
  assert.match(autoSvg, /tis-text-clip-[^\"]+-decoration-fill-plane/);
  const independent = text({ height: 10, fills: [], textDecorationColor: color, textDecorationOffset: pixels(30) });
  const independentSvg = exportNodeToSvg(independent, { measureText: measure });
  assert.equal(customPaths(independentSvg).length, 1);
  assert.doesNotMatch(independentSvg, /decoration-fill-plane/);
});

test('staged independent decoration paints retain their alpha when legacy scalar fill opacity is zero', () => {
  const decoration = createNode('path', { width: 20, height: 3, points: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],
    closed: true, fill: '#00cc88', fillOpacity: .4, stroke: null, strokeWidth: 0, effectPaintPhase: 'decoration' });
  const group = createNode('group', { width: 30, height: 20, effectPaintMode: 'staged', effectFillMode: 'legacy',
    fillOpacity: 0, children: [decoration] });
  const svg = exportNodeToSvg(group);
  assert.match(svg, /<g opacity="1" data-tiny-image-star-type="path"/);
  assert.match(svg, /fill="#00cc88" fill-opacity="0.4"/);
  const pdf = Buffer.from(createVectorPdf(svg)).toString('latin1');
  assert.match(pdf, /\/ca 0.4/);
});
