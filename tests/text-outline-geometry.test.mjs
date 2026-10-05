import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { createDocument, createNode, addNode, createVariableCollection, createVariable, bindVariable, setVariableValue } from '../src/model.js';
import { createTextPathGeometry } from '../src/text-on-path.js';
import { collectTextOutlineGeometry, prepareTextOutlineGeometry, TextOutlineGeometryError } from '../src/text-outline-geometry.js';

const rectangularGlyph = 'M0 0 L600 0 L600 700 L0 700 Z';
const ligatureGlyph = 'M0 0 Q450 900 900 0 L900 700 C600 850 300 850 0 700 Z M200 200 L200 400 L600 400 L600 200 Z';
function fakeShape(text, style = {}) {
  const second = style.fontFamily === 'Second'; const upem = second ? 2000 : 1000;
  const glyphs = [];
  for (let index = 0; index < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(index));
    const ligature = text.slice(index, index + 2) === 'fi' && style.fontFeatures?.liga !== 0;
    const mark = character === '\u0301';
    glyphs.push({ id: ligature ? 77 : mark ? 3 : 1, cluster: mark ? Math.max(0, index - 1) : index,
      xAdvance: mark ? 0 : ligature ? 900 : /\s/u.test(character) ? 500 : second ? 800 : 600,
      yAdvance: 0, xOffset: mark ? -300 : 0, yOffset: mark ? 250 : 0,
      path: /\s/u.test(character) ? '' : ligature ? ligatureGlyph : mark ? 'M0 0 C100 150 200 150 300 0 Z' : rectangularGlyph });
    index += ligature ? 2 : character.length;
  }
  return { upem, extents: { ascender: second ? 1500 : 800 }, missingGlyph: false, glyphs };
}
function scene(overrides = {}) {
  const document = createDocument(); const node = createNode('text', { x: 123, y: 234, width: 200, height: 80,
    fontSize: 20, fontFamily: 'First', text: 'A fi A\u0301', ...overrides });
  addNode(document, node); return { document, node };
}

test('exact renderer layout emits separate shaped glyphs with native quadratic/cubic holes and local positions', () => {
  const { document, node } = scene(); const original = structuredClone(node);
  const result = collectTextOutlineGeometry(document, node, { shapeText: fakeShape });
  assert.equal(result.glyphs.length, 4, 'a ligature is one glyph and its combining mark remains a separate glyph');
  assert.deepEqual(result.glyphs.map(glyph => glyph.text), ['A', 'fi', 'A\u0301', 'A\u0301']);
  assert.deepEqual(result.glyphs[0].geometry.strokeContours[0].start, { x: 0, y: 16 });
  assert.equal(result.glyphs[1].geometry.strokeContours.length, 2, 'the hole stays bundled with its own glyph');
  assert.ok(result.glyphs[1].geometry.strokeContours[0].commands.some(command => command.type === 'quadratic'));
  assert.ok(result.glyphs[1].geometry.strokeContours[0].commands.some(command => command.type === 'cubic'));
  assert.equal(result.geometry.fillGroups.length, 4, 'overlapping glyph regions are independent union fill groups');
  assert.equal(result.geometry.strokeContours.length, 5);
  assert.deepEqual(node, original);
});

test('rich local fonts, feature overrides, baseline shift, paragraph markers and decoration colors reuse editor layout', () => {
  const { document, node } = scene({ text: 'A fi', align: 'right', verticalAlign: 'middle', height: 100,
    textRuns: [{ text: 'A ', color: '#ff0000', textDecoration: 'underline' },
      { text: 'fi', color: '#0000ff', fontSize: 30, fontFamily: 'Second', fontFeatures: { liga: 0 }, baselineShift: 4, textDecoration: 'line-through' }] });
  const result = collectTextOutlineGeometry(document, node, { shapeText: fakeShape });
  assert.equal(result.glyphs.length, 3);
  assert.deepEqual(result.glyphs.map(glyph => glyph.paint.color), ['#ff0000', '#0000ff', '#0000ff']);
  assert.ok(result.glyphs[0].geometry.strokeContours[0].start.x > 100, 'right alignment is retained');
  assert.equal(result.decorations.length, 2);
  assert.deepEqual(result.decorations.map(item => item.paint.color), ['#ff0000', '#0000ff']);
  assert.equal(result.geometry.strokeContours.length, 3, 'decorations contribute fill geometry rather than glyph stroke contours');
  assert.equal(result.glyphGeometry.fillGroups.length, 3, 'aligned strokes clip to the complete glyph union without including decorations');
  assert.equal(result.geometry.fillGroups.length, 5);
  const list = scene({ text: 'A\nA', paragraphStyles: [{ listStyle: 'numbered', listStart: 1 }, { listStyle: 'numbered', listStart: 2 }], listSpacing: 4 });
  const listed = collectTextOutlineGeometry(list.document, list.node, { shapeText: fakeShape });
  assert.ok(listed.glyphs.some(glyph => glyph.text === '1' || glyph.text === '2'), 'ordered markers become actual shaped vector glyphs');
});

test('ending truncation clips final paint, while explicit fills have a separate logical-box paint domain', () => {
  const plain = scene({ text: 'A', width: 5, height: 10 });
  const plainResult = collectTextOutlineGeometry(plain.document, plain.node, { shapeText: fakeShape });
  assert.equal(plainResult.clipGeometry, undefined); assert.equal(plainResult.fillClipGeometry, undefined);
  const filled = scene({ text: 'A', width: 5, height: 10, fills: [{ id: 'red', type: 'solid', color: '#ff0000', opacity: 1, visible: true }] });
  const filledResult = collectTextOutlineGeometry(filled.document, filled.node, { shapeText: fakeShape });
  assert.equal(filledResult.clipGeometry, undefined); assert.ok(filledResult.fillClipGeometry);
  const truncated = scene({ text: 'A A A A', width: 30, height: 30, textTruncation: 'ending', maxLines: 1 });
  const clipped = collectTextOutlineGeometry(truncated.document, truncated.node, { shapeText: fakeShape });
  assert.ok(clipped.clipGeometry);
  assert.deepEqual(clipped.clipGeometry.fillGroups[0].contours[0].commands[1].end, { x: 30, y: 30 });
  assert.ok(clipped.glyphs.some(glyph => glyph.text === '…'), 'the displayed ellipsis is itself outlined');
});

test('text-on-path keeps cluster placement, flipped transforms, run baselines and curved glyphs', () => {
  const path = createTextPathGeometry(createNode('line', { width: 150, height: 10 }), { startOffset: 20 });
  const { document, node } = scene({ text: 'fi', width: 150, height: 10, textPath: path, textRuns: [{ text: 'fi', baselineShift: 3, color: '#00ff00' }] });
  const result = collectTextOutlineGeometry(document, node, { shapeText: fakeShape });
  assert.equal(result.glyphs.length, 1); assert.equal(result.glyphs[0].glyphId, 77);
  assert.equal(result.glyphs[0].paint.color, '#00ff00');
  assert.ok(result.glyphs[0].geometry.strokeContours[0].commands.some(command => command.type === 'quadratic'));
  node.textPath.flipped = true;
  const flipped = collectTextOutlineGeometry(document, node, { shapeText: fakeShape });
  assert.notDeepEqual(flipped.glyphs[0].geometry.strokeContours, result.glyphs[0].geometry.strokeContours);
  node.text = 'A fi A\u0301'; delete node.textRuns;
  const clustered = collectTextOutlineGeometry(document, node, { shapeText: fakeShape });
  assert.deepEqual(clustered.glyphs.map(glyph => glyph.text), ['A', 'fi', 'A\u0301', 'A\u0301'],
    'later path clusters retain their own displayed text while HarfBuzz cluster indices remain intact');
});

test('live text paths return current root placement once and fence source-transform edits during preparation', async () => {
  const { document, node } = scene({ text: 'A' });
  const source = createNode('line', { x: 30, y: 40, width: 150, height: 60, rotation: 12,
    affineTransform: { a: 1, b: .2, c: .3, d: 1 } });
  addNode(document, source);
  node.textPath = { ...createTextPathGeometry(source), sourceId: source.id };
  const result = collectTextOutlineGeometry(document, node, { shapeText: fakeShape });
  assert.deepEqual(result.placement, { x: 30, y: 40, width: 150, height: 60, rotation: 12,
    affineTransform: { a: 1, b: .2, c: .3, d: 1 } });
  assert.equal(result.width, 150); assert.equal(result.height, 60);
  let release;
  const pending = prepareTextOutlineGeometry(document, node, { shapeText: (text, style) => new Promise(resolve => {
    release = () => resolve(fakeShape(text, style));
  }) });
  source.x = 80; release();
  await assert.rejects(pending, error => error.code === 'TEXT_OUTLINE_STALE');
});

test('missing browser fallback glyphs, malformed native paths and .notdef records refuse conversion', () => {
  const { document, node } = scene({ text: 'A' });
  for (const shapeText of [() => null, () => ({ mixedRuns: [{ text: 'A', shaped: null }] }),
    () => ({ ...fakeShape('A'), missingGlyph: true }),
    () => ({ ...fakeShape('A'), glyphs: [{ ...fakeShape('A').glyphs[0], id: 0 }] }),
    () => ({ ...fakeShape('A'), glyphs: [{ ...fakeShape('A').glyphs[0], path: '<path d="M0 0"/>' }] }),
    () => ({ ...fakeShape('A'), glyphs: [{ ...fakeShape('A').glyphs[0], path: 'M0 0L1 1' }] })]) {
    assert.throws(() => collectTextOutlineGeometry(document, node, { shapeText }), error => error instanceof TextOutlineGeometryError);
  }
  const measured = { measureText() { throw new Error('Browser measurements should never be consulted'); } };
  assert.equal(collectTextOutlineGeometry(document, node, { shapeText: fakeShape, measureContext: measured }).glyphs.length, 1);
});

test('mixed local-font runs retain exact per-font baselines without allowing an uncovered fallback run', () => {
  const { document, node } = scene({ text: 'AB' });
  const result = collectTextOutlineGeometry(document, node, { shapeText: text => ({ mixedRuns: [...text].map(character => ({
    text: character, shaped: fakeShape(character, { fontFamily: character === 'B' ? 'Second' : 'First' }) })) }) });
  assert.equal(result.glyphs.length, 2);
  assert.deepEqual(result.glyphs.map(glyph => glyph.geometry.strokeContours[0].start), [{ x: 0, y: 16 }, { x: 12, y: 15 }]);
});

test('RTL shaped glyph order and cluster labels survive without splitting or reordering the run', () => {
  const { document, node } = scene({ text: 'אבג', letterSpacing: 2 });
  const result = collectTextOutlineGeometry(document, node, { shapeText: text => ({ ...fakeShape(text),
    glyphs: fakeShape(text).glyphs.reverse() }) });
  assert.deepEqual(result.glyphs.map(glyph => glyph.text), ['ג', 'ב', 'א']);
  assert.deepEqual(result.glyphs.map(glyph => glyph.cluster), [2, 1, 0]);
  assert.deepEqual(result.glyphs.map(glyph => glyph.geometry.strokeContours[0].start.x), [0, 14, 28]);
});

test('blank glyphs advance layout without becoming empty vector layers, and outline work stays bounded', () => {
  const { document, node } = scene({ text: ' A ' }); const result = collectTextOutlineGeometry(document, node, { shapeText: fakeShape });
  assert.equal(result.glyphs.length, 1); assert.equal(result.glyphs[0].geometry.strokeContours[0].start.x, 10);
  node.text = 'A'.repeat(1025); node.width = 100_000;
  assert.throws(() => collectTextOutlineGeometry(document, node, { shapeText: fakeShape }), /1,024-glyph/);
});

test('async preparation resolves distinct local shaping queries then returns the same exact layout', async () => {
  const { document, node } = scene(); const queries = new Set();
  const prepared = await prepareTextOutlineGeometry(document, node, { shapeText: async (text, style) => {
    const key = JSON.stringify([text, style]); assert.equal(queries.has(key), false, 'command-local immutable results satisfy repeated layout queries');
    queries.add(key); return fakeShape(text, style);
  } });
  const collected = collectTextOutlineGeometry(document, node, { shapeText: fakeShape });
  assert.deepEqual(prepared, collected); assert.ok(queries.size > 0);
});

test('async preparation cancels promptly, times out, and refuses source or bound mode changes', async () => {
  const { document, node } = scene(); const controller = new AbortController();
  const cancelled = prepareTextOutlineGeometry(document, node, { signal: controller.signal,
    shapeText: (_text, _style, { signal }) => { assert.equal(signal, controller.signal); return new Promise(() => {}); } });
  controller.abort(); await assert.rejects(cancelled, error => error.name === 'AbortError');
  await assert.rejects(prepareTextOutlineGeometry(document, node, { timeoutMs: 5, shapeText: () => new Promise(() => {}) }), error => error.code === 'TEXT_OUTLINE_TIMEOUT');
  let release;
  const stale = prepareTextOutlineGeometry(document, node, { shapeText: (text, style) => new Promise(resolve => { release = () => resolve(fakeShape(text, style)); }) });
  node.text = 'Changed'; release(); await assert.rejects(stale, error => error.code === 'TEXT_OUTLINE_STALE');
  const collection = createVariableCollection(document, 'Text'); const variable = createVariable(document, collection.id, 'Label', 'string', 'A');
  bindVariable(document, node.id, variable.id, 'text');
  const modeChanged = prepareTextOutlineGeometry(document, node, { shapeText: (text, style) => new Promise(resolve => { release = () => resolve(fakeShape(text, style)); }) });
  setVariableValue(document, variable.id, 'B'); release(); await assert.rejects(modeChanged, error => error.code === 'TEXT_OUTLINE_STALE');
});

test('preparation invokes the caller font-session fence again after local shaping resolves', async () => {
  const { document, node } = scene({ text: 'A' }); let current = true; let checks = 0;
  await assert.rejects(prepareTextOutlineGeometry(document, node, {
    assertCurrent() { checks++; if (!current) throw new Error('Local fonts changed'); },
    shapeText: async (text, style) => { current = false; return fakeShape(text, style); }
  }), /Local fonts changed/);
  assert.ok(checks >= 3);
});

test('preparing a cloned text snapshot refuses edits or deletion of the retained live layer', async () => {
  for (const deletion of [false, true]) {
    const { document, node } = scene({ text: 'A' }); const snapshot = structuredClone(node); let release;
    const pending = prepareTextOutlineGeometry(document, snapshot, { shapeText: (text, style) => new Promise(resolve => {
      release = () => resolve(fakeShape(text, style));
    }) });
    if (deletion) document.pages[0].children.splice(0, 1);
    else node.text = 'Changed live text';
    release(); await assert.rejects(pending, error => error.code === 'TEXT_OUTLINE_STALE');
  }
});

test('real local variable-font contours and OpenType shaping remain native and never fabricate missing glyphs', async () => {
  const woff = new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url)));
  const sfnt = await decompress(woff); const face = new hb.Face(new hb.Blob(sfnt));
  function nativeShape(text, style) {
    const font = new hb.Font(face); font.setScale(face.upem, face.upem);
    font.setVariations(Object.entries(style.fontAxes || {}).map(([tag, value]) => new hb.Variation(tag, value)));
    const buffer = new hb.Buffer(); buffer.addText(text); buffer.guessSegmentProperties();
    hb.shape(font, buffer, Object.entries(style.fontFeatures || {}).map(([tag, value]) => new hb.Feature(tag, value)));
    const raw = buffer.getGlyphInfosAndPositions();
    return { upem: face.upem, extents: font.hExtents(), missingGlyph: raw.some(glyph => glyph.codepoint === 0),
      glyphs: raw.map(glyph => ({ id: glyph.codepoint, cluster: glyph.cluster, xAdvance: glyph.xAdvance, yAdvance: glyph.yAdvance,
        xOffset: glyph.xOffset, yOffset: glyph.yOffset, path: font.glyphToPath(glyph.codepoint) })) };
  }
  const { document, node } = scene({ text: 'O', fontSize: 42, fontAxes: { wght: 400, opsz: 14 } });
  const result = await prepareTextOutlineGeometry(document, node, { shapeText: nativeShape });
  assert.equal(result.glyphs.length, 1); assert.equal(result.glyphs[0].geometry.strokeContours.length, 2);
  assert.ok(result.glyphs[0].geometry.strokeContours[0].commands.some(command => command.type === 'quadratic'));
  const independentFont = new hb.Font(face); independentFont.setScale(face.upem, face.upem);
  independentFont.setVariations([new hb.Variation('wght', 400), new hb.Variation('opsz', 14)]);
  const raw = independentFont.glyphToJson(result.glyphs[0].glyphId); const first = raw.find(command => command.type === 'M');
  const scale = 42 / face.upem;
  assert.deepEqual(result.glyphs[0].geometry.strokeContours[0].start,
    { x: first.values[0] * scale, y: independentFont.hExtents().ascender * scale - first.values[1] * scale });
  node.fontAxes = { wght: 800, opsz: 32 };
  const heavy = await prepareTextOutlineGeometry(document, node, { shapeText: nativeShape });
  assert.notDeepEqual(heavy.glyphs[0].geometry, result.glyphs[0].geometry, 'variable axis changes alter actual outlines');
  node.text = 'ToWa'; node.fontFeatures = { kern: 0 };
  const noKerning = await prepareTextOutlineGeometry(document, node, { shapeText: nativeShape });
  node.fontFeatures = { kern: 1 };
  const kerning = await prepareTextOutlineGeometry(document, node, { shapeText: nativeShape });
  assert.notDeepEqual(kerning.glyphs[1].geometry, noKerning.glyphs[1].geometry, 'OpenType features alter real glyph placement');
  node.text = 'مرحبا';
  await assert.rejects(prepareTextOutlineGeometry(document, node, { shapeText: nativeShape }), /retained local font/);
});
