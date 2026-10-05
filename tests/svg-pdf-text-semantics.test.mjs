import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { createDocument, createNode } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { createTextPathGeometry } from '../src/text-on-path.js';
import { resolvedTextLetterSpacing } from '../src/text-letter-spacing.js';
import { exportNodeToSvg, exportPageToSvg } from '../src/svg-export.js';

const face = new hb.Face(new hb.Blob(await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))))));
function shapeText(value, style = {}) {
  const font = new hb.Font(face); font.setScale(face.upem, face.upem);
  font.setVariations(Object.entries(style.fontAxes || {}).map(([tag, number]) => new hb.Variation(tag, number)));
  const buffer = new hb.Buffer(); buffer.addText(value); buffer.guessSegmentProperties();
  hb.shape(font, buffer, Object.entries(style.fontFeatures || {}).map(([tag, number]) => new hb.Feature(tag, number)));
  return { upem: face.upem, extents: font.hExtents(),
    leadingTrimMetrics: { capHeight: font.getMetricPosition(hb.MetricsTag.CAP_HEIGHT) },
    glyphs: buffer.getGlyphInfosAndPositions().map(glyph => ({ ...glyph, id: glyph.codepoint, path: font.glyphToPath(glyph.codepoint) })) };
}
function measureWith(shaper = shapeText) {
  const measure = (value, style = {}) => {
    const shaped = shaper(value, style);
    return shaped?.glyphs ? shaped.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0) * (style.fontSize || 24) / shaped.upem
      + Math.max(0, [...value].length - 1) * resolvedTextLetterSpacing(style) : value.length * 10;
  };
  measure.shapeText = shaper; return measure;
}
const document = createDocument();
const text = properties => createNode('text', { text: ' O ffi q́ ', fontFamily: 'Retained Inter', fontSize: 32,
  width: 300, height: 150, color: '#123456', ...properties });
const options = { document, measureText: measureWith(), pdfTextSemantics: true };
const decode = value => value.replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&');
const count = svg => (svg.match(/data-tiny-image-star-pdf-text="1"/gu) || []).length;
function runs(svg) {
  return [...svg.matchAll(/<g data-tiny-image-star-pdf-run="([^"]*)">([\s\S]*?)<\/g>/gu)].map(([, header, content]) => ({
    ...JSON.parse(decode(header)), glyphs: [...content.matchAll(/<path d="([^"]*)" data-tiny-image-star-pdf-glyph="([^"]*)"\/>/gu)]
      .map(([, path, glyph]) => ({ path: decode(path), ...JSON.parse(decode(glyph)) })) }));
}

test('PDF semantics is opt-in and records actual raw glyph contours, shared clusters and whitespace', () => {
  const node = text(); const before = structuredClone(node);
  const ordinary = exportNodeToSvg(node, { ...options, pdfTextSemantics: false });
  assert.equal(ordinary, exportNodeToSvg(node, { document, measureText: options.measureText }));
  assert.equal(count(ordinary), 0);
  const svg = exportNodeToSvg(node, options); assert.equal(count(svg), 1);
  assert.match(svg, /data-tiny-image-star-pdf-text="1" opacity="0"/u);
  const [run] = runs(svg); const shaped = shapeText(node.text);
  assert.equal(run.text, node.text); assert.equal(run.upem, face.upem);
  assert.equal(run.ascender, shaped.extents.ascender); assert.equal(run.descender, shaped.extents.descender);
  assert.equal(run.glyphs.length, shaped.glyphs.length);
  assert.ok(run.glyphs.some((glyph, index) => index && glyph.cluster === run.glyphs[index - 1].cluster), 'base and combining mark keep their shared shaped cluster');
  assert.ok(run.glyphs.some(glyph => glyph.path === '' && glyph.text === ' '), 'space advance and placement survive without ink');
  for (const [index, glyph] of run.glyphs.entries()) {
    assert.equal(glyph.path, shaped.glyphs[index].path); assert.equal(glyph.cluster, shaped.glyphs[index].cluster);
    assert.equal(glyph.xAdvance, shaped.glyphs[index].xAdvance); assert.equal(glyph.yAdvance, shaped.glyphs[index].yAdvance);
    assert.equal(glyph.matrix[0], node.fontSize / face.upem); assert.equal(glyph.matrix[3], -node.fontSize / face.upem);
    assert.equal(run.text.slice(glyph.cluster, glyph.cluster + glyph.text.length), glyph.text);
  }
  assert.deepEqual(node, before);
});

test('one semantic block survives multiple fills, ordered strokes, masks and staged shadow snapshots', () => {
  const node = text({ fills: [{ id: 'f1', type: 'solid', color: '#abcdef', opacity: .7, visible: true },
    { id: 'f2', type: 'solid', color: '#345678', opacity: .6, visible: true }],
  strokes: [createStroke({ width: 2, color: '#ff0000' }), createStroke({ width: 4, color: '#0000ff', alignment: 'outside' })] });
  assert.equal(count(exportNodeToSvg(node, options)), 1);
  const staged = createNode('group', { width: 300, height: 150, effectPaintMode: 'staged', children: [node,
    createNode('rectangle', { width: 100, height: 100, fill: '#123456', effectPaintPhase: 'stroke' })],
  effects: [{ id: 'shadow', type: 'inner-shadow', color: '#345678', opacity: .6, blur: 4, offsetX: 3, offsetY: 2, visible: true }] });
  const stagedSvg = exportNodeToSvg(staged, options);
  assert.equal(count(stagedSvg), 1); assert.equal(runs(stagedSvg).length, 1);
  const secret = createNode('group', { width: 300, height: 150, children: [text({ text: 'MASK SECRET' })] });
  const content = text({ text: 'Visible content' });
  const mask = createNode('group', { width: 300, height: 150, mask: true, maskMode: 'alpha', maskSourceId: secret.id, children: [secret, content] });
  const maskSvg = exportNodeToSvg(mask, options); assert.equal(count(maskSvg), 1);
  assert.equal(runs(maskSvg).map(run => run.text).join(''), 'Visible content');
  assert.doesNotMatch(maskSvg.match(/<mask\b[\s\S]*?<\/mask>/u)?.[0] || '', /data-tiny-image-star-pdf-/u);
});

test('hidden text, hidden ancestors, empty glyphs and independent underline-only paint expose no text', () => {
  for (const properties of [{ visible: false }, { opacity: 0 }, { fills: [], strokes: [] }, { color: 'transparent' },
    { text: '   ' }, { fills: [], textDecoration: 'underline', textDecorationColor: { type: 'solid', color: '#ff0000', opacity: 1 } }]) {
    assert.equal(count(exportNodeToSvg(text(properties), options)), 0, JSON.stringify(properties));
  }
  assert.equal(count(exportNodeToSvg(createNode('group', { width: 300, height: 150, opacity: 0, children: [text()] }), options)), 0);
});

test('intrinsic transparent rich runs are excluded unless visible explicit fill or stroke paints their glyphs', () => {
  const node = text({ text: 'shown secret', textRuns: [{ text: 'shown ', color: '#123456' }, { text: 'secret', color: 'transparent' }] });
  assert.equal(runs(exportNodeToSvg(node, options)).map(run => run.text).join(''), 'shown ');
  assert.equal(count(exportNodeToSvg({ ...node, fillOpacity: 0 }, options)), 0);
  for (const painted of [{ ...node, strokes: [createStroke({ width: 2, color: '#ff0000' })] },
    { ...node, fills: [{ id: 'visible', type: 'solid', color: '#abcdef', opacity: 1, visible: true }] }]) {
    assert.equal(runs(exportNodeToSvg(painted, options)).map(run => run.text).join(''), node.text);
  }
});

test('actual Inter ink outside an explicit fill-only box emits no text, while partial ink and authored strokes retain it', () => {
  const plane = [{ id: 'paint-plane', type: 'solid', color: '#ffffff', opacity: 1, visible: true }];
  const node = text({ text: 'H', fontSize: 80, width: 12, height: 15, fills: plane, strokes: [] });
  assert.equal(count(exportNodeToSvg(node, options)), 0, 'real H ink begins below this paint box');
  const partial = exportNodeToSvg({ ...node, height: 30 }, options);
  assert.equal(count(partial), 1); assert.equal(runs(partial)[0].text, 'H');
  assert.match(partial, /<rect x="0" y="0" width="12" height="30"\/><\/clipPath><\/defs><g clip-path="url\(#tis-text-clip-[^"]*-pdf-semantics-\d+\)"><g data-tiny-image-star-pdf-text/u);
  const stroked = exportNodeToSvg({ ...node, strokes: [createStroke({ width: 3, color: '#ff0000' })] }, options);
  assert.equal(count(stroked), 1); assert.doesNotMatch(stroked, /tis-text-clip-[^"]*-pdf-semantics/u, 'untruncated strokes paint beyond the fill plane');
  const legacy = { ...node }; delete legacy.fills;
  assert.equal(count(exportNodeToSvg(legacy, options)), 1, 'legacy fills retain their unbounded glyph domain');
});

test('paint-domain checks respect holes bounded by native lines, quadratics and cubics', () => {
  const outer = 'M-1000 -1000L2000 -1000L2000 2000L-1000 2000Z';
  const holes = ['M-500 0L-500 1000L500 1000L500 0Z',
    'M-500 700Q-500 1200 0 1200Q500 1200 500 700Q500 200 0 200Q-500 200 -500 700Z',
    'M-500 700C-500 976 -276 1200 0 1200C276 1200 500 976 500 700C500 424 276 200 0 200C-276 200 -500 424 -500 700Z'];
  for (const hole of holes) {
    const shaper = value => ({ upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 },
      glyphs: [...value].map((_, cluster) => ({ id: 1, cluster, path: outer + hole, xAdvance: 1000, yAdvance: 0, xOffset: 0, yOffset: 0 })) });
    const node = text({ text: 'O', fontSize: 80, width: 12, height: 15, strokes: [],
      fills: [{ id: 'paint-plane', type: 'solid', color: '#ffffff', opacity: 1, visible: true }] });
    const measureText = measureWith(shaper);
    assert.equal(count(exportNodeToSvg(node, { ...options, measureText })), 0, 'the paint box lies wholly inside an actual glyph hole');
    assert.equal(count(exportNodeToSvg({ ...node, width: 60, height: 30 }, { ...options, measureText })), 1, 'a wider box crosses real curved glyph ink');
  }
});

test('fully clipped clusters split and rebase logical fragments while preserving adjacent spaces and native placements', () => {
  const shaper = value => ({ upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 },
    glyphs: [...value].map((character, cluster) => ({ id: 1, cluster,
      path: /\s/u.test(character) ? '' : 'M0 0L600 0L600 700L0 700Z',
      xAdvance: 600, yAdvance: 0, xOffset: character === 'B' ? 10000 : 0, yOffset: 0 })) });
  const measureText = measureWith(shaper); const node = text({ text: ' A B C ', fontSize: 20, width: 100, height: 30,
    fills: [{ id: 'paint-plane', type: 'solid', color: '#ffffff', opacity: 1, visible: true }], strokes: [] });
  const clipped = runs(exportNodeToSvg(node, { ...options, measureText }));
  assert.deepEqual(clipped.map(run => run.text), [' A ', ' C ']);
  assert.deepEqual(clipped.map(run => run.glyphs.map(glyph => glyph.cluster)), [[0, 1, 2], [0, 1, 2]]);
  const unclipped = runs(exportNodeToSvg({ ...node, strokes: [createStroke({ width: 2, color: '#ff0000' })] }, { ...options, measureText }))[0];
  assert.deepEqual(clipped.flatMap(run => run.glyphs.map(glyph => glyph.matrix)), unclipped.glyphs.filter(glyph => glyph.text !== 'B').map(glyph => glyph.matrix));
  assert.doesNotMatch(JSON.stringify(clipped), /"text":"B"/u);
});

test('displayed text, truncation clipping, transforms and path placements are retained instead of original source strings', () => {
  const node = text({ text: 'one two three four', textCase: 'uppercase', width: 100, height: 45,
    textTruncation: 'ending', x: 21, y: 17, rotation: 12, affineTransform: { a: 1, b: .2, c: .1, d: 1 } });
  const svg = exportPageToSvg({ children: [node] }, options);
  const displayed = runs(svg).map(run => run.text).join(''); assert.match(displayed, /…/u); assert.doesNotMatch(displayed, /four|one/u);
  assert.match(svg, /clip-path="url\(#tis-text-clip-[^"]*-pdf-semantics-\d+\)"><g data-tiny-image-star-pdf-text/u);
  assert.match(svg, /<g transform="matrix\([^"]+\)" opacity="1"[^>]*>[^]*data-tiny-image-star-pdf-text/u);
  const path = text({ text: 'O ffi', textPath: createTextPathGeometry(createNode('line', { width: 300, height: 60 })) });
  const pathRuns = runs(exportNodeToSvg(path, options)); assert.equal(pathRuns.map(run => run.text).join(''), path.text);
  assert.ok(pathRuns.some(run => run.glyphs.some(glyph => Math.abs(glyph.matrix[1]) > 0)), 'font geometry carries actual path rotation');
});

test('semantic attributes safely escape XML and do not authorize font catalog entries, missing glyphs or pending work', () => {
  const node = text({ text: '<&"script>' }); const svg = exportNodeToSvg(node, options);
  assert.equal(runs(svg)[0].text, node.text); assert.doesNotMatch(svg, /<script>/u);
  const none = () => null; none.fontStatus = () => 'none'; const fallback = measureWith(none);
  fallback.textLineMetrics = style => ({ ascent: style.fontSize * .8, descent: style.fontSize * .2, lineGap: 0, topBaseline: style.fontSize * .8 });
  assert.equal(count(exportNodeToSvg(text({ fontFamily: 'Arial' }), { ...options, measureText: fallback })), 0);
  const pending = () => null; pending.fontStatus = () => 'pending';
  assert.throws(() => exportNodeToSvg(node, { ...options, measureText: measureWith(pending) }), error => error.code?.endsWith('_PENDING'));
  const missing = (value, style) => ({ ...shapeText(value, style), missingGlyph: true });
  assert.throws(() => exportNodeToSvg(node, { ...options, measureText: measureWith(missing) }), /coverage|missing/u);
  assert.throws(() => exportNodeToSvg(node, { ...options, pdfTextSemantics: 'true' }), /boolean/u);
});

test('semantic markup has an incremental export-wide byte budget without limiting ordinary contour SVG', () => {
  const path = `M0 0L1.${'0'.repeat(30_000)} 0L1 1Z`;
  const shaper = value => ({ upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 },
    glyphs: [...value].map((_, cluster) => ({ id: 1, cluster, path, xAdvance: 1, yAdvance: 0, xOffset: 0, yOffset: 0 })) });
  const node = text({ text: 'A'.repeat(150), width: 10000 }); const measureText = measureWith(shaper);
  assert.doesNotMatch(exportNodeToSvg(node, { document, measureText }), /data-tiny-image-star-pdf-/u);
  assert.throws(() => exportPageToSvg({ children: [node, { ...node, id: 'second', y: 150 }] },
    { document, measureText, pdfTextSemantics: true }), /semantics larger than 8 MiB/u);
});
