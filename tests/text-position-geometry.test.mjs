import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { resolveTextPositionPlan, resolveTextPositionView, hasCompleteTextPositionGlyphs, TextPositionPendingError } from '../src/text-position.js';
import { createDocument, createNode, addNode } from '../src/model.js';
import { collectTextOutlineGeometry, collectTextDecorationGeometry } from '../src/text-outline-geometry.js';
import { createTextPathGeometry } from '../src/text-on-path.js';
import { layoutTextRuns } from '../src/text-layout.js';
import { canvasTextInkBounds } from '../src/text-decoration.js';
import { SceneRenderer, localTextInkBounds } from '../src/renderer.js';

const metrics = { superscript: { xSize: 650, ySize: 600, xOffset: 20, yOffset: 350 }, subscript: { xSize: 650, ySize: 600, xOffset: -20, yOffset: 150 } };
function shape(text, style) {
  const active = style.fontFeatures?.sups || style.fontFeatures?.subs;
  return { upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 }, positionMetrics: metrics, glyphs: [...text].map((char, cluster) => ({
    id: char.codePointAt(0) + (active && /\d/u.test(char) ? 1000 : 0), cluster, xAdvance: 600, yAdvance: 0, xOffset: 0, yOffset: 0,
    path: /\s/u.test(char) ? '' : 'M0 0 L500 0 L500 700 L0 700 Z' })) };
}
function scene(properties = {}) {
  const document = createDocument(); const node = createNode('text', { text: '123', fontSize: 20, fontFamily: 'Local', width: 300, height: 100, ...properties });
  addNode(document, node); return { document, node };
}

test('genuine variants require substitution of every non-whitespace glyph cluster, including unsupported characters across rich runs', () => {
  const digits = scene({ textPosition: 'superscript' }); const original = structuredClone(digits.node);
  const plan = resolveTextPositionPlan(digits.node, { shapeText: shape });
  assert.equal(plan.mode, 'font'); assert.equal(plan.resolveStyle(digits.node).fontSize, 20);
  assert.equal(plan.resolveStyle(digits.node).fontFeatures.sups, 1); assert.deepEqual(digits.node, original);
  digits.node.text = '1 2'; assert.equal(resolveTextPositionPlan(digits.node, { shapeText: shape }).mode, 'font');
  digits.node.text = '1A'; digits.node.textRuns = [{ text: '1', textPosition: 'superscript' }, { text: 'A', textPosition: 'subscript' }];
  const mixed = resolveTextPositionPlan(digits.node, { shapeText: shape });
  assert.equal(mixed.mode, 'synthesized'); assert.equal(mixed.resolveStyle({ ...digits.node, textPosition: 'superscript' }).fontFeatures.sups, 0);
  assert.equal(hasCompleteTextPositionGlyphs('A', { upem: 1000, glyphs: [] }, { upem: 1000, glyphs: [] }), false);
});

test('synthesis uses actual recommended x/y dimensions and offsets while preserving manual shift and original baseline', () => {
  const { node } = scene({ text: 'A', textPosition: 'superscript', baselineShift: 4 });
  const resolved = resolveTextPositionPlan(node, { shapeText: shape }).resolveStyle(node);
  assert.equal(resolved.fontSize, 12); assert.equal(resolved.authoredFontSize, 20);
  assert.ok(Math.abs(resolved.textPositionScaleX - 650 / 600) < 1e-10); assert.equal(resolved.textPositionOffsetX, .4);
  assert.equal(resolved.textPositionBaselineOffset, -7); assert.ok(Math.abs(resolved.textPositionTopOffset + .6) < 1e-10);
  assert.equal(resolved.baselineShift, 4);
  const authoredBaseline = 20 * .8; const effectiveBaseline = resolved.textPositionTopOffset + resolved.fontSize * .8;
  assert.ok(Math.abs(effectiveBaseline - (authoredBaseline - 7)) < 1e-10);
  node.textPosition = 'subscript'; const sub = resolveTextPositionPlan(node, { shapeText: shape }).resolveStyle(node);
  assert.equal(sub.textPositionBaselineOffset, 3); assert.equal(sub.textPositionOffsetX, -.4);
});

test('runtime views retain logical authored line height and leave unaffected explicit OpenType behavior untouched', () => {
  const { node } = scene({ text: 'AA', textPosition: 'superscript', lineHeight: 1.5 });
  const view = resolveTextPositionView(node, { shapeText: shape });
  assert.equal(view.node.textRuns[0].fontSize, 12); assert.equal(node.fontSize, 20);
  const layout = layoutTextRuns(view.node.textRuns, 300, node, text => text.length * 10);
  assert.equal(layout.height, 30);
  node.textPosition = 'normal'; node.fontFeatures = { sups: 1, subs: 0, kern: 0 };
  const normal = resolveTextPositionView(node, { shapeText: shape });
  assert.equal(normal.node, node); assert.deepEqual(normal.plan.resolveStyle(node).fontFeatures, node.fontFeatures);
});

test('queued local glyphs produce a typed pending export error and browser-only fonts use explicit fallback synthesis', () => {
  const { document, node } = scene({ textPosition: 'superscript' }); const pending = () => null;
  pending.fontStatus = () => 'pending';
  assert.equal(resolveTextPositionPlan(node, { shapeText: pending }).mode, 'pending');
  assert.throws(() => resolveTextPositionView(node, { shapeText: pending, strict: true }), TextPositionPendingError);
  assert.throws(() => collectTextOutlineGeometry(document, node, { shapeText: pending }), TextPositionPendingError);
  assert.throws(() => collectTextDecorationGeometry(document, node, { shapeText: pending, measureText: text => text.length * 10 }), TextPositionPendingError);
  pending.fontStatus = () => 'none'; const fallback = resolveTextPositionPlan(node, { shapeText: pending });
  assert.equal(fallback.mode, 'synthesized'); assert.equal(fallback.resolveStyle(node).fontSize, 13);
  assert.throws(() => resolveTextPositionPlan({ ...node, text: 'x'.repeat(32769) }), /bounded source/);
});

test('positioned collectors expose queued wrapped-substring queries as typed pending, after whole-layer coverage is ready', () => {
  const { document, node } = scene({ text: '1 2 3', width: 20, textPosition: 'superscript', textDecoration: 'underline' });
  const wholeReady = (text, style) => text === node.text ? shape(text, style) : null;
  wholeReady.fontStatus = () => 'ready';
  assert.equal(resolveTextPositionPlan(node, { shapeText: wholeReady }).mode, 'font');
  assert.throws(() => collectTextOutlineGeometry(document, node, { shapeText: wholeReady }), TextPositionPendingError);
  assert.throws(() => collectTextDecorationGeometry(document, node, { shapeText: wholeReady, measureText: text => text.length * 10 }), TextPositionPendingError);
});

test('fractional text and staged-text layer opacity isolates the completed paint stack in the full renderer path', () => {
  const { document, node } = scene({ opacity: .7 });
  const group = createNode('group', { opacity: .7, effectPaintMode: 'staged', children: [] }); addNode(document, group);
  const instance = Object.create(SceneRenderer.prototype); instance.getState = () => ({ document, zoom: 1 });
  const isolated = []; instance.drawNodeWithEffects = (_context, source) => isolated.push(source.id);
  instance.drawNode({}, node, 0, 0, new Map()); instance.drawNode({}, group, 0, 0, new Map());
  assert.deepEqual(isolated, [node.id, group.id], 'layer opacity is applied once to combined fills and strokes, through bounded isolation');
});

test('browser fallback ink replay keeps short-box glyph and underline coverage inside fractional opacity surfaces', () => {
  const { document, node } = scene({ text: 'H', fontSize: 80, width: 12, height: 15, textDecoration: 'underline' });
  const states = []; const measureContext = { font: '400 20px Local', textAlign: 'right', textBaseline: 'alphabetic',
    save() { states.push({ font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline }); },
    restore() { Object.assign(this, states.pop()); },
    measureText(text) { const size = Number(this.font.match(/([\d.]+)px/u)[1]); return { width: text.length * size * .6,
      actualBoundingBoxLeft: 0, actualBoundingBoxRight: size * .6, actualBoundingBoxAscent: 4, actualBoundingBoxDescent: size - 4 }; } };
  const original = measureContext.font;
  const normal = localTextInkBounds(document, node, null, { measureContext });
  const glyphOnly = localTextInkBounds(document, node, null, { measureContext, forStroke: true });
  assert.ok(normal.bottom > 82); assert.equal(glyphOnly.bottom, 76);
  assert.equal(measureContext.font, original); assert.equal(measureContext.textAlign, 'right');
  assert.equal(measureContext.textBaseline, 'alphabetic');
});

test('normal large text bypasses position budgets and a small positioned span does not budget the normal body', () => {
  let queries = 0; const counted = (text, style) => { queries++; return shape(text, style); };
  const runs = Array.from({ length: 4096 }, () => ({ text: 'normal body ', textPosition: 'normal' }));
  const { node } = scene({ text: runs.map(run => run.text).join(''), textRuns: runs });
  const untouched = resolveTextPositionView(node, { shapeText: counted });
  assert.equal(untouched.node, node); assert.equal(untouched.plan.mode, 'normal'); assert.equal(queries, 0);
  node.textRuns.push({ text: '1', textPosition: 'superscript' }); node.text += '1';
  assert.equal(resolveTextPositionPlan(node, { shapeText: counted }).mode, 'font'); assert.equal(queries, 2);
  assert.throws(() => resolveTextPositionPlan({ ...node, text: 'A'.repeat(32769), textRuns: undefined, textPosition: 'subscript' }), /bounded source/);
});

test('canonical axis/features maps deduplicate probes and path-derived variable weight keeps real metrics', () => {
  const style = { textPosition: 'superscript', fontAxes: { wght: 700, opsz: 14 }, fontFeatures: { kern: 0, liga: 1 }, fontWeight: 400 };
  const reordered = { ...style, fontWeight: 700, fontAxes: { opsz: 14, wght: 700 }, fontFeatures: { liga: 1, kern: 0 } };
  const { node } = scene({ text: 'A A', textRuns: [{ text: 'A', ...style }, { text: ' ', textPosition: 'normal' }, { text: 'A', ...reordered }] });
  let queries = 0; const counted = (text, fontStyle) => { queries++; return shape(text, fontStyle); };
  const plan = resolveTextPositionPlan(node, { shapeText: counted }); assert.equal(plan.mode, 'synthesized'); assert.equal(queries, 2);
  const resolved = plan.resolveStyle({ ...node, ...reordered });
  assert.equal(resolved.fontSize, 12); assert.ok(Math.abs(resolved.textPositionScaleX - 650 / 600) < 1e-10);
  assert.equal(resolved.textPositionOffsetX, .4, 'uses the font metric rather than generic fallback');
});

test('feature coverage probes the same displayed capitalization across a rich-run word boundary as layout', () => {
  const { node } = scene({ text: 'fooa', textCase: 'capitalize', textRuns: [{ text: 'foo', textPosition: 'normal' }, { text: 'a', textPosition: 'superscript' }] });
  const queried = []; const actual = (text, style) => { queried.push(text); const result = shape(text, style);
    if (style.fontFeatures.sups && text === 'a') result.glyphs[0].id += 1; return result; };
  assert.equal(resolveTextPositionPlan(node, { shapeText: actual }).mode, 'font'); assert.deepEqual(queried, ['a', 'a']);
});

test('browser fallback skip-ink bounds scale glyph X coordinates while preserving pixel tracking', () => {
  const context = { textAlign: 'center', measureText: text => ({ width: text.length * 10,
    actualBoundingBoxLeft: 1, actualBoundingBoxRight: 9, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 3 }) };
  assert.deepEqual(canvasTextInkBounds(context, 'ab', { x: 4, y: 10, letterSpacing: 2, scaleX: 1.5 }), [
    { left: 2.5, right: 17.5, top: 3, bottom: 13 }, { left: 19.5, right: 34.5, top: 3, bottom: 13 }]);
  assert.equal(context.textAlign, 'center');
});

test('native editable contour collection applies nonuniform glyph scale and top/path baseline shifts once', () => {
  const { document, node } = scene({ text: 'A', textPosition: 'superscript', textRuns: [{ text: 'A', baselineShift: 4 }], textDecoration: 'underline' });
  const outlined = collectTextOutlineGeometry(document, node, { shapeText: shape });
  const glyph = outlined.glyphs[0].geometry.strokeContours[0];
  assert.deepEqual(outlined.glyphs[0].strokeTransform, [1, 0, 0, 1, 0, 0], 'font metric X scaling remains baked into glyph geometry');
  assert.ok(Math.abs(glyph.start.x - .4) < 1e-10); assert.ok(Math.abs(glyph.start.y - 5) < 1e-10);
  assert.ok(Math.abs(glyph.commands[0].end.x - 6.9) < 1e-10);
  assert.equal(outlined.layout.height, 20, 'Auto line spacing keeps the actual20px authored font envelope');
  node.textPath = createTextPathGeometry(createNode('line', { width: 100, height: 0 }));
  node.textPath.points[1].y = 0;
  const path = collectTextOutlineGeometry(document, node, { shapeText: shape });
  assert.ok(Math.abs(path.glyphs[0].geometry.strokeContours[0].start.y - (node.textPath.points[0].y * node.textPath.height - 11)) < 1e-10);
});

test('real Inter fixture reports genuine synthesis metrics and lacks actual superscript substitution', async () => {
  const face = new hb.Face(new hb.Blob(await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))))));
  const font = new hb.Font(face); font.setScale(face.upem, face.upem);
  const native = (text, style) => { const buffer = new hb.Buffer(); buffer.addText(text); buffer.guessSegmentProperties();
    hb.shape(font, buffer, Object.entries(style.fontFeatures || {}).map(([tag, value]) => new hb.Feature(tag, value)));
    return { upem: face.upem, extents: font.hExtents(), positionMetrics: Object.fromEntries(['superscript', 'subscript'].map(position => [position,
      Object.fromEntries([['xSize','X_SIZE'], ['ySize','Y_SIZE'], ['xOffset','X_OFFSET'], ['yOffset','Y_OFFSET']].map(([key, suffix]) => [key,font.getMetricPosition(hb.MetricsTag[`${position.toUpperCase()}_EM_${suffix}`])]))])),
      glyphs: buffer.getGlyphInfosAndPositions().map(glyph => ({ ...glyph, id: glyph.codepoint, path: font.glyphToPath(glyph.codepoint) })) }; };
  const { document, node } = scene({ textPosition: 'superscript', fontSize: 48 });
  assert.equal(resolveTextPositionPlan(node, { shapeText: native }).mode, 'synthesized');
  const resolved = resolveTextPositionPlan(node, { shapeText: native }).resolveStyle(node);
  assert.equal(resolved.fontSize, 48 * 1229 / 2048); assert.equal(resolved.textPositionScaleX, 1331 / 1229);
  const outlined = collectTextOutlineGeometry(document, node, { shapeText: native }); assert.equal(outlined.glyphs.length, 3);
});
