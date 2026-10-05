import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { createDocument, createNode, addNode } from '../src/model.js';
import { createTextPathGeometry, drawTextAlongPath, textPathSpans } from '../src/text-on-path.js';
import { collectTextOutlineGeometry, collectTextDecorationGeometry } from '../src/text-outline-geometry.js';
import { localTextInkBounds } from '../src/renderer.js';
import { textDecorationGeometry, parseLocalGlyphContours, nativeInkContoursForShapedText, canvasTextInkBounds, TextDecorationGeometryError } from '../src/text-decoration.js';

const pixels = value => ({ unit: 'pixels', value });
const paint = { type: 'solid', color: '#00ff00', opacity: .4 };
function shape(text) {
  return { upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 }, missingGlyph: false,
    glyphs: [...text].map((character, index) => ({ id: 1, cluster: index, xAdvance: 600, yAdvance: 0, xOffset: 0, yOffset: 0,
      path: /\s/u.test(character) ? '' : 'M0 0 L600 0 L600 700 L0 700 Z' })) };
}
function scene(properties = {}) {
  const document = createDocument(); const node = createNode('text', { text: 'ABA', fontSize: 20, width: 200, height: 100,
    fontFamily: 'Local', textDecoration: 'underline', ...properties }); addNode(document, node); return { document, node };
}

test('underline metrics keep legacy defaults and custom thickness, offset, dots and waves are bounded filled geometry', () => {
  const legacy = textDecorationGeometry({ width: 20, fontSize: 20 });
  assert.equal(legacy.lineY, 20.6); assert.equal(legacy.thickness, 1.25);
  const solid = textDecorationGeometry({ x: 2, y: 3, width: 20, fontSize: 20,
    style: { textDecorationThickness: { unit: 'percent', value: 10 }, textDecorationOffset: pixels(-4) } });
  assert.equal(solid.thickness, 2); assert.equal(solid.lineY, 19.6);
  assert.deepEqual(solid.bounds, { left: 2, right: 22, top: 18.6, bottom: 20.6 });
  const dots = textDecorationGeometry({ width: 20, style: { textDecorationStyle: 'dotted', textDecorationThickness: pixels(2) } });
  assert.equal(dots.contours.length, 5); assert.ok(dots.contours.every(item => item.commands.every(command => command.type === 'cubic')));
  const wave = textDecorationGeometry({ width: 20, style: { textDecorationStyle: 'wavy', textDecorationThickness: pixels(2) } });
  assert.equal(wave.contours.length, 1); assert.ok(wave.bounds.bottom - wave.bounds.top > 4);
  assert.equal(textDecorationGeometry({ width: 20, style: { textDecorationThickness: pixels(0) } }).contours.length, 0);
  assert.equal(textDecorationGeometry({ width: 20, decoration: 'line-through', style: { textDecorationStyle: 'wavy', textDecorationColor: paint } }).paint, 'auto');
});

test('skip ink intersects actual filled contour bands and retains a glyph hole instead of deleting its whole advance', () => {
  const ring = parseLocalGlyphContours('M0 0 L20 0 L20 20 L0 20 Z M5 5 L5 15 L15 15 L15 5 Z');
  const result = textDecorationGeometry({ x: -5, width: 30, fontSize: 20, inkContours: ring,
    style: { textDecorationSkipInk: true, textDecorationOffset: pixels(-10.6), textDecorationThickness: pixels(1) } });
  assert.deepEqual(result.segments, [[-5, -.5], [5.5, 14.5], [20.5, 25]]);
  const cubic = parseLocalGlyphContours('M0 0 C0 30 30 30 30 0 L30 -5 L0 -5 Z');
  const curved = textDecorationGeometry({ x: -5, width: 40, fontSize: 20, inkContours: cubic,
    style: { textDecorationSkipInk: true, textDecorationOffset: pixels(-.6), textDecorationThickness: pixels(1) } });
  assert.equal(curved.segments.length, 2); assert.ok(curved.segments[0][1] > 0 && curved.segments[1][0] < 30);
});

test('fallback skip ink uses actual per-grapheme bounds with measured prefix positioning and restores alignment', () => {
  const context = { textAlign: 'center', measureText(value) {
    const descender = value === 'q'; return { width: value.length * 10, actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: value.length * 8, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: descender ? 25 : 10 };
  } };
  const bounds = canvasTextInkBounds(context, 'AqA', {}, { x: 3, y: 0, letterSpacing: 2 });
  assert.deepEqual(bounds.map(item => item.left), [3, 15, 27]); assert.equal(context.textAlign, 'center');
  const result = textDecorationGeometry({ x: 3, width: 34, fontSize: 20, fallbackInkBounds: bounds, style: { textDecorationSkipInk: true } });
  assert.deepEqual(result.segments, [[3, 14.375], [23.625, 37]]);
});

test('native glyph projection preserves quadratic curves, tracking, offsets and cluster group holes', () => {
  const shaped = { upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 }, glyphs: [
    { cluster: 0, xAdvance: 600, xOffset: 50, yOffset: 100, path: 'M0 0 Q200 600 400 0 Z' },
    { cluster: 1, xAdvance: 600, path: 'M0 0 L200 0 L200 200 Z' }
  ] };
  const contours = nativeInkContoursForShapedText(shaped, { x: 10, y: 20, fontSize: 20, letterSpacing: 3 });
  assert.deepEqual(contours[0].start, { x: 11, y: 34 }); assert.equal(contours[0].commands[0].type, 'quadratic');
  assert.deepEqual(contours[1].start, { x: 25, y: 36 }); assert.notEqual(contours[0].group, contours[1].group);
});

test('rich and justified collection captures independently painted decorations without coloring glyphs or stroking decoration geometry', () => {
  const { document, node } = scene({ text: 'A B A B', width: 45, align: 'justify', fillOpacity: .2,
    textRuns: [{ text: 'A B ', color: '#ff0000', textDecorationStyle: 'wavy', textDecorationColor: paint },
      { text: 'A B', color: '#0000ff', textDecorationThickness: pixels(3), textDecorationColor: { ...paint, opacity: 0, visible: false } }] });
  const result = collectTextOutlineGeometry(document, node, { shapeText: shape });
  assert.ok(result.decorations.length >= 2); assert.ok(result.decorations.every(record => record.paint.independent));
  assert.ok(result.decorations.some(record => record.paint.opacity === .4));
  assert.ok(result.decorations.some(record => record.paint.visible === false && record.paint.opacity === 0));
  assert.ok(result.glyphs.every(record => ['#ff0000', '#0000ff'].includes(record.paint.color)));
  assert.equal(result.geometry.strokeContours.length, result.glyphGeometry.strokeContours.length);
});

test('text path callback receives local glyph contours under each actual transform with inherited custom styles', () => {
  const { document, node } = scene({ text: 'AA', textDecorationColor: paint, textDecorationStyle: 'dotted' });
  node.textPath = createTextPathGeometry(createNode('line', { width: 100, height: 0 }));
  const result = collectTextOutlineGeometry(document, node, { shapeText: shape });
  assert.equal(result.decorations.length, 2); assert.ok(result.decorations.every(record => record.paint.independent));
  assert.ok(result.decorations[1].geometry.fillGroups[0].contours[0].start.x > result.decorations[0].geometry.fillGroups[0].contours[0].start.x);
  assert.equal(textPathSpans('AA', node).length, 1, 'equal cloned metric/color maps do not split shaping spans');
  const measuredStyles = [];
  const fallback = collectTextDecorationGeometry(document, node, { measureText: (text, style) => { measuredStyles.push(style); return text.length * 12; } });
  assert.equal(fallback.decorations.length, 2);
  assert.ok(measuredStyles.every(style => style.fontSize === 20 && style.fontFamily === 'Local'), 'path fallback measures its own configured font');
  const calls = []; const context = { globalAlpha: .7, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, fillText() { throw new Error('unexpected glyph drawing'); } };
  drawTextAlongPath(context, 'AA', node, 0, 0, () => 12, { shapeText: shape, decorationsOnly: true, fillOpacity: .2,
    decorate: record => calls.push(record) });
  assert.equal(calls.length, 2); assert.equal(calls[0].parentAlpha, .7);
});

test('malformed paths, excessive dots/waves and excessive fallback work reject before unbounded allocation', () => {
  assert.throws(() => parseLocalGlyphContours('M0 0 A1 1 0 0 1 2 2 Z'), TextDecorationGeometryError);
  assert.throws(() => parseLocalGlyphContours('M0 0 L1 1'), /open/);
  assert.throws(() => textDecorationGeometry({ width: 1_000_000, style: { textDecorationStyle: 'dotted', textDecorationThickness: pixels(.1) } }), /bounded output/);
  assert.throws(() => textDecorationGeometry({ width: 1_000_000, style: { textDecorationStyle: 'wavy', textDecorationThickness: pixels(.1) } }), /bounded output/);
  assert.throws(() => canvasTextInkBounds({ measureText() {} }, 'A'.repeat(4097)), /bounded fallback glyph/);
  assert.throws(() => textDecorationGeometry({ x: 1e100, width: 10 }), /finite coordinate/);
});

test('independent decoration ink escapes explicit glyph paint planes but still obeys ending truncation bounds', () => {
  const { document, node } = scene({ width: 12, height: 15, fills: [], textDecorationColor: paint, textDecorationOffset: pixels(100) });
  const bounds = localTextInkBounds(document, node, shape);
  assert.ok(bounds.bottom > 100);
  node.textTruncation = 'ending'; assert.deepEqual(localTextInkBounds(document, node, shape), { left: 0, top: 0, right: 12, bottom: 15 });
});

test('decoration-only export collection reuses exact rich justified and compressed editor placement without glyph conversion', () => {
  const { document, node } = scene({ text: 'AA AA AA', width: 35, align: 'justify', textDecorationColor: paint,
    textDecorationStyle: 'wavy', textRuns: [{ text: 'AA ', fontSize: 20 }, { text: 'AA AA', fontSize: 26, baselineShift: 3 }] });
  const measurement = text => text.length * 12;
  const exact = collectTextOutlineGeometry(document, node, { shapeText: shape });
  const records = collectTextDecorationGeometry(document, node, { measureText: measurement, shapeText: shape, fillOpacity: 1 });
  assert.deepEqual(records.decorations, exact.decorations);
  const fallback = collectTextDecorationGeometry(document, node, { measureText: measurement });
  assert.ok(fallback.decorations.length > 1);
  node.textDecorationSkipInk = true;
  assert.throws(() => collectTextDecorationGeometry(document, node, { measureText: measurement }), /actual Canvas glyph bounds/);
  const withBounds = collectTextDecorationGeometry(document, node, { measureText: measurement,
    textInkBounds: text => [{ left: 0, top: 0, right: text.length * 10, bottom: 10 }] });
  assert.ok(withBounds.decorations.length > 1);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => collectTextDecorationGeometry(document, node, { measureText: measurement, signal: controller.signal }), { name: 'AbortError' });
});

test('nonpainting decorations need no skip-ink provider, and vector-mask collection uses visible typed geometry independent of alpha', () => {
  const { document, node } = scene({ textDecorationSkipInk: true, textDecorationColor: { ...paint, visible: false } });
  const measureText = text => text.length * 12;
  assert.equal(collectTextDecorationGeometry(document, node, { measureText }).decorations.length, 0);
  node.textDecorationColor = { ...paint, opacity: 0 };
  assert.equal(collectTextDecorationGeometry(document, node, { measureText }).decorations.length, 0);
  node.textDecorationThickness = pixels(0);
  assert.equal(collectTextDecorationGeometry(document, node, { measureText }).decorations.length, 0);
  node.textDecorationThickness = pixels(2); node.textDecorationSkipInk = false;
  const vector = collectTextDecorationGeometry(document, node, { measureText, shapeText: shape, forceDecorationGeometry: true });
  assert.equal(vector.decorations.length, 1);
  assert.deepEqual(vector.decorations[0].paint, { color: '#ffffff', opacity: 1, visible: true, independent: true });
  node.textDecorationColor.visible = false;
  assert.equal(collectTextDecorationGeometry(document, node, { measureText, shapeText: shape, forceDecorationGeometry: true }).decorations.length, 0);
});

test('real Inter glyphs drive skip ink and custom outlines while variable font changes retain exact contour identity', async () => {
  const sfnt = await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))));
  const face = new hb.Face(new hb.Blob(sfnt));
  const nativeShape = (text, style) => { const font = new hb.Font(face); font.setScale(face.upem, face.upem);
    font.setVariations(Object.entries(style.fontAxes || {}).map(([tag, value]) => new hb.Variation(tag, value)));
    const buffer = new hb.Buffer(); buffer.addText(text); buffer.guessSegmentProperties(); hb.shape(font, buffer);
    const glyphs = buffer.getGlyphInfosAndPositions(); return { upem: face.upem, extents: font.hExtents(), missingGlyph: glyphs.some(glyph => glyph.codepoint === 0),
      glyphs: glyphs.map(glyph => ({ ...glyph, id: glyph.codepoint, path: font.glyphToPath(glyph.codepoint) })) }; };
  const { document, node } = scene({ text: 'qgy', fontSize: 48, width: 200, height: 100, textDecorationSkipInk: true,
    textDecorationThickness: pixels(2), textDecorationColor: paint, fontAxes: { wght: 400, opsz: 14 } });
  const outlined = collectTextOutlineGeometry(document, node, { shapeText: nativeShape });
  const baseline = outlined.layout.lines[0].baselineY;
  const glyphs = nativeInkContoursForShapedText(nativeShape('qgy', node), { fontSize: 48, baselineY: baseline });
  const geometry = textDecorationGeometry({ y: baseline, baseline: true, width: outlined.layout.lines[0].width, fontSize: 48, style: node, inkContours: glyphs });
  assert.ok(geometry.segments.length > 1); assert.deepEqual(outlined.decorations[0].geometry.fillGroups[0].contours, geometry.contours);
  node.fontAxes.wght = 800; const changed = collectTextOutlineGeometry(document, node, { shapeText: nativeShape });
  assert.notDeepEqual(changed.glyphs[0].geometry, outlined.glyphs[0].geometry);
  assert.equal(changed.decorations[0].paint.color, '#00ff00');
});
