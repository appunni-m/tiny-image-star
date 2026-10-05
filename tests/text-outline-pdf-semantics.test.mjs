import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { createDocument, createNode, addNode } from '../src/model.js';
import { createTextPathGeometry } from '../src/text-on-path.js';
import { drawTextLayerContent } from '../src/renderer.js';
import { collectTextOutlineGeometry, prepareTextOutlineGeometry } from '../src/text-outline-geometry.js';

const rectangle = 'M0 0 L600 0 L600 700 L0 700 Z';
const curve = 'M0 0 Q450 900 900 0 L900 700 C600 850 300 850 0 700 Z';
function shape(text, style = {}) {
  const second = style.fontFamily === 'Second'; const upem = second ? 2000 : 1000;
  const glyphs = [];
  for (let index = 0; index < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(index));
    const ligature = text.slice(index, index + 2) === 'fi'; const mark = character === '\u0301';
    glyphs.push({ id: ligature ? 77 : mark ? 3 : 1, cluster: mark ? index - 1 : index,
      xAdvance: mark ? 0 : ligature ? 900 : /\s/u.test(character) ? 500 : second ? 800 : 600,
      yAdvance: 0, xOffset: mark ? -300 : 0, yOffset: mark ? 250 : 0,
      path: /\s/u.test(character) ? '' : ligature ? curve : mark ? 'M0 0 Q100 150 300 0 Z' : rectangle });
    index += ligature ? 2 : character.length;
  }
  return { upem, extents: { ascender: second ? 1500 : 800, descender: second ? -500 : -200, lineGap: 0 }, missingGlyph: false, glyphs };
}
function scene(overrides = {}) {
  const document = createDocument(); const node = createNode('text', { x: 123, y: 234, width: 240, height: 80,
    fontSize: 20, fontFamily: 'First', text: 'A fi A\u0301', ...overrides });
  addNode(document, node); return { document, node };
}
const capture = (document, node, shapeText = shape, options = {}) => collectTextOutlineGeometry(document, node,
  { shapeText, captureTextSemantics: true, ...options });
const apply = (matrix, x, y) => ({ x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] });
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test('opt-in PDF semantics capture whitespace and exact tracked glyph matrices without changing editable geometry', () => {
  const { document, node } = scene({ letterSpacing: 2 }); const original = structuredClone(node);
  const ordinary = collectTextOutlineGeometry(document, node, { shapeText: shape });
  assert.equal('pdfTextRuns' in ordinary, false);
  const result = capture(document, node); const { pdfTextRuns, ...geometry } = result;
  assert.deepEqual(geometry, ordinary); assert.deepEqual(node, original);
  assert.equal(result.glyphs.length, 4, 'empty paths still do not create editable geometry');
  assert.equal(pdfTextRuns.length, 1);
  const run = pdfTextRuns[0];
  assert.equal(run.text, node.text); assert.equal(run.upem, 1000); assert.equal(run.ascender, 800); assert.equal(run.descender, -200);
  assert.deepEqual(run.glyphs.map(glyph => glyph.text), ['A', ' ', 'fi', ' ', 'A\u0301', 'A\u0301']);
  assert.deepEqual(run.glyphs.map(glyph => glyph.cluster), [0, 1, 2, 4, 5, 5]);
  assert.deepEqual(run.glyphs.map(glyph => glyph.path), [rectangle, '', curve, '', rectangle, 'M0 0 Q100 150 300 0 Z']);
  assert.deepEqual(run.glyphs.map(glyph => glyph.xAdvance), [600, 500, 900, 500, 600, 0]);
  const xs = [0, 14, 26, 46, 58, 64]; const ys = [16, 16, 16, 16, 16, 11];
  run.glyphs.forEach((glyph, index) => {
    assert.deepEqual(glyph.matrix.slice(0, 4), [.02, 0, 0, -.02]);
    near(glyph.matrix[4], xs[index]); near(glyph.matrix[5], ys[index]);
    assert.equal(glyph.yAdvance, 0);
  });
  run.glyphs.filter(glyph => glyph.path).forEach((glyph, index) => assert.deepEqual(apply(glyph.matrix, 0, 0),
    result.glyphs[index].geometry.strokeContours[0].start));
  run.glyphs.filter(glyph => glyph.path).forEach((glyph, index) => assert.equal(glyph.inkContours,
    result.glyphs[index].geometry.strokeContours, 'eligibility uses the exact existing geometry without parsing or copying it'));
  run.glyphs.filter(glyph => glyph.path).forEach((glyph, index) => assert.equal(glyph.inkContours,
    result.glyphs[index].geometry.fillGroups[0].contours, 'fill and semantic eligibility share the exact contour array'));
  assert.deepEqual(run.glyphs.filter(glyph => !glyph.path).map(glyph => glyph.inkContours), [[], []]);
});

test('semantic ink contours preserve winding holes and empty noncontour paths without fragile glyph indexing', () => {
  const { document, node } = scene({ text: 'A B' });
  const hole = rectangle + ' M100 100L100 500L500 500L500 100Z';
  const result = capture(document, node, (text, style) => ({ ...shape(text, style), glyphs: shape(text, style).glyphs.map(glyph => ({ ...glyph,
    path: text[glyph.cluster] === 'A' ? hole : text[glyph.cluster] === 'B' ? 'M0 0Z' : '' })) }));
  const [a, space, empty] = result.pdfTextRuns[0].glyphs;
  assert.equal(result.glyphs.length, 1); assert.equal(a.inkContours.length, 2); assert.equal(a.inkContours, result.glyphs[0].geometry.strokeContours);
  assert.deepEqual(space.inkContours, []); assert.deepEqual(empty.inkContours, []);
  assert.equal(empty.path, 'M0 0Z'); assert.equal(empty.text, 'B');
});

test('rich and mixed-font semantic runs keep their displayed text, native metrics, paint, and shared baselines', () => {
  const { document, node } = scene({ text: 'A B', textRuns: [
    { text: 'A ', color: '#ff0000' }, { text: 'B', fontFamily: 'Second', fontSize: 30, baselineShift: 4, color: '#0000ff' }
  ], align: 'right', verticalAlign: 'middle', height: 100 });
  const result = capture(document, node); const runs = result.pdfTextRuns;
  assert.deepEqual(runs.map(run => run.text), ['A ', 'B']); assert.deepEqual(runs.map(run => run.upem), [1000, 2000]);
  assert.deepEqual(runs.map(run => run.paint.color), ['#ff0000', '#0000ff']);
  assert.deepEqual(runs.map(run => run.paint.opacity), [1, 1]);
  near(runs[0].glyphs[0].matrix[5] - runs[1].glyphs[0].matrix[5], 4);
  assert.ok(runs[0].glyphs[0].matrix[4] > 100);
  assert.equal(runs[0].glyphs[1].path, '');
  const mixed = scene({ text: 'AB' });
  const mixedResult = capture(mixed.document, mixed.node, text => ({ mixedRuns: [...text].map(character => ({
    text: character, shaped: shape(character, { fontFamily: character === 'B' ? 'Second' : 'First' }) })) }));
  assert.deepEqual(mixedResult.pdfTextRuns.map(run => run.text), ['A', 'B']);
  assert.deepEqual(mixedResult.pdfTextRuns.map(run => run.glyphs[0].matrix[5]), [16, 16]);
});

test('displayed case, ellipsis, and list markers are captured instead of hidden source text or decoration ink', () => {
  const { document, node } = scene({ text: 'a a a a', width: 30, height: 30, textTruncation: 'ending', maxLines: 1,
    textCase: 'uppercase', textDecoration: 'underline' });
  const result = capture(document, node);
  const displayed = result.pdfTextRuns.map(run => run.text).join('');
  assert.ok(displayed.endsWith('…')); assert.match(displayed, /^A/u); assert.notEqual(displayed, 'A A A A');
  assert.ok(result.decorations.length > 0); assert.equal(result.pdfTextRuns.flatMap(run => run.glyphs).length, result.glyphs.length);
  assert.ok(result.clipGeometry);
  const listed = scene({ text: 'A\nB', paragraphStyles: [{ listStyle: 'numbered', listStart: 1 }, { listStyle: 'numbered', listStart: 2 }] });
  const markers = capture(listed.document, listed.node).pdfTextRuns.map(run => run.text);
  assert.deepEqual(markers, ['1.', 'A', '2.', 'B']);
});

test('RTL glyph order and UTF16 ligature/combining clusters remain attached to logical displayed run text', () => {
  const { document, node } = scene({ text: 'אבג', letterSpacing: 2 });
  const result = capture(document, node, text => ({ ...shape(text), glyphs: shape(text).glyphs.reverse() }));
  const [run] = result.pdfTextRuns;
  assert.equal(run.text, 'אבג'); assert.deepEqual(run.glyphs.map(glyph => glyph.cluster), [2, 1, 0]);
  assert.deepEqual(run.glyphs.map(glyph => glyph.text), ['ג', 'ב', 'א']);
  assert.deepEqual(run.glyphs.map(glyph => glyph.matrix[4]), [0, 14, 28]);
  node.text = '😀 A\u0301';
  const astral = capture(document, node).pdfTextRuns[0];
  assert.deepEqual(astral.glyphs.map(glyph => glyph.cluster), [0, 2, 3, 3]);
  assert.deepEqual(astral.glyphs.map(glyph => glyph.text), ['😀', ' ', 'A\u0301', 'A\u0301']);
});

test('path semantics rebase sliced cluster offsets and capture exact rotation/flipping while excluding off-path text', () => {
  const path = createTextPathGeometry(createNode('line', { width: 200, height: 50 }), { startOffset: 20 });
  const { document, node } = scene({ textPath: path, textRuns: [{ text: 'A fi A\u0301', baselineShift: 3 }] });
  const result = capture(document, node); const runs = result.pdfTextRuns;
  assert.deepEqual(runs.map(run => run.text), ['A', ' ', 'fi', ' ', 'A\u0301']);
  assert.ok(runs.every(run => run.glyphs.every(glyph => glyph.cluster === 0 && glyph.text === run.text)));
  const angle = Math.atan2(50, 200); const first = runs[0].glyphs[0].matrix;
  near(first[0], .02 * Math.cos(angle)); near(first[1], .02 * Math.sin(angle));
  near(first[2], .02 * Math.sin(angle)); near(first[3], -.02 * Math.cos(angle));
  const visible = runs.flatMap(run => run.glyphs).filter(glyph => glyph.path);
  visible.forEach((glyph, index) => assert.deepEqual(apply(glyph.matrix, 0, 0), result.glyphs[index].geometry.strokeContours[0].start));
  node.textPath.flipped = true;
  const flipped = capture(document, node).pdfTextRuns[0].glyphs[0].matrix;
  assert.ok(first[0] * first[3] - first[1] * first[2] < 0);
  assert.ok(flipped[0] * flipped[3] - flipped[1] * flipped[2] > 0);
  node.textPath = createTextPathGeometry(createNode('line', { width: 14, height: 0 })); delete node.textRuns;
  const clipped = capture(document, node).pdfTextRuns.map(run => run.text).join('');
  assert.equal(clipped, 'A');
});

test('ordinary native path drawing does not depend on semantic collector hooks', () => {
  const previous = globalThis.Path2D; const painted = [];
  globalThis.Path2D = class { constructor(path) { this.path = path; } };
  const context = { globalAlpha: 1, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    fill(path) { painted.push(path.path); } };
  const { document, node } = scene({ text: 'A fi A\u0301', textPath: createTextPathGeometry(createNode('line', { width: 200, height: 50 })) });
  try {
    drawTextLayerContent(context, node, document, 0, 0, node.width, node.height, { shapeText: shape, includeDecorations: false });
    assert.deepEqual(painted, [rectangle, curve, rectangle, 'M0 0 Q100 150 300 0 Z']);
  } finally { globalThis.Path2D = previous; }
});

test('semantic matrix includes script font scaling and rich-line compression exactly once', () => {
  const { document, node } = scene({ text: 'W', width: 3, textPosition: 'superscript',
    textRuns: [{ text: 'W', fontSize: 20, textPosition: 'superscript' }] });
  const result = capture(document, node); const glyph = result.pdfTextRuns[0].glyphs[0];
  const geometry = result.glyphs[0].geometry.strokeContours[0];
  assert.ok(Math.abs(glyph.matrix[0]) < .02 && Math.abs(glyph.matrix[3]) < .02);
  assert.notEqual(Math.abs(glyph.matrix[0]), Math.abs(glyph.matrix[3]), 'compression is part of the recorded context matrix');
  assert.deepEqual(apply(glyph.matrix, 600, 0), geometry.commands[0].end);
  assert.deepEqual(apply(glyph.matrix, 600, 700), geometry.commands[1].end);
});

test('semantics validate descenders and Unicode boundaries, and count empty-path glyphs in bounded capture', () => {
  const { document, node } = scene({ text: '😀' });
  assert.throws(() => capture(document, node, text => ({ ...shape(text), extents: { ascender: 800, descender: NaN } })), /incomplete text semantics/u);
  assert.throws(() => capture(document, node, text => ({ ...shape(text), glyphs: [{ ...shape(text).glyphs[0], cluster: 1 }] })), /invalid glyph text semantics/u);
  node.text = ' '.repeat(1025); node.width = 100_000;
  assert.equal(collectTextOutlineGeometry(document, node, { shapeText: shape }).glyphs.length, 0);
  assert.throws(() => capture(document, node), /1,024-glyph semantic limit/u);
  const large = capture(document, node, shape, { exportMode: 'svg' });
  assert.equal(large.pdfTextRuns.flatMap(run => run.glyphs).length, 1025);
});

test('async preparation captures the same immutable semantic records and preserves abort/source fences', async () => {
  const { document, node } = scene();
  const prepared = await prepareTextOutlineGeometry(document, node, { shapeText: async (text, style) => shape(text, style), captureTextSemantics: true });
  assert.deepEqual(prepared, capture(document, node));
  const controller = new AbortController();
  const pending = prepareTextOutlineGeometry(document, node, { signal: controller.signal, captureTextSemantics: true, shapeText: () => new Promise(() => {}) });
  controller.abort(); await assert.rejects(pending, error => error.name === 'AbortError');
});

test('real retained Inter glyph semantics use native paths, kerning, mark offsets, and font extents', async () => {
  const face = new hb.Face(new hb.Blob(await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))))));
  const font = new hb.Font(face); font.setScale(face.upem, face.upem);
  font.setVariations([new hb.Variation('wght', 550), new hb.Variation('opsz', 24)]);
  const native = text => {
    const buffer = new hb.Buffer(); buffer.addText(text); buffer.guessSegmentProperties(); hb.shape(font, buffer);
    const raw = buffer.getGlyphInfosAndPositions();
    return { upem: face.upem, extents: font.hExtents(), missingGlyph: raw.some(glyph => glyph.codepoint === 0),
      glyphs: raw.map(glyph => ({ id: glyph.codepoint, cluster: glyph.cluster, xAdvance: glyph.xAdvance, yAdvance: glyph.yAdvance,
        xOffset: glyph.xOffset, yOffset: glyph.yOffset, path: font.glyphToPath(glyph.codepoint) })) };
  };
  const { document, node } = scene({ text: 'O q\u0301 To', fontSize: 42, letterSpacing: 3, width: 400 });
  const result = capture(document, node, native); const run = result.pdfTextRuns[0]; const independent = native(node.text);
  assert.equal(run.upem, face.upem); assert.equal(run.ascender, font.hExtents().ascender); assert.equal(run.descender, font.hExtents().descender);
  assert.deepEqual(run.glyphs.map(glyph => glyph.path), independent.glyphs.map(glyph => glyph.path));
  assert.deepEqual(run.glyphs.map(glyph => glyph.xAdvance), independent.glyphs.map(glyph => glyph.xAdvance));
  assert.ok(run.glyphs.some(glyph => glyph.path === '' && glyph.text === ' '));
  assert.ok(run.glyphs.some(glyph => glyph.xAdvance === 0 && glyph.text.includes('\u0301')));
  const scale = 42 / face.upem; let pen = 0; let tracking = 0; let previous = null;
  run.glyphs.forEach((glyph, index) => {
    const raw = independent.glyphs[index]; if (previous !== null && previous !== raw.cluster) tracking += 3;
    near(glyph.matrix[0], scale); near(glyph.matrix[3], -scale);
    near(glyph.matrix[4], (pen + raw.xOffset) * scale + tracking);
    near(glyph.matrix[5], (font.hExtents().ascender - raw.yOffset) * scale);
    pen += raw.xAdvance; previous = raw.cluster;
  });
});
