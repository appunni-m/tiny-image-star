import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { createDocument, createNode, addNode } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { collectTextOutlineGeometry } from '../src/text-outline-geometry.js';
import { nativePathGeometryForNode } from '../src/vector-shape-geometry.js';
import { booleanGeometryWithKit } from '../src/vector-geometry-kernel.js';
import { buildBooleanVectorRequest } from '../src/boolean-vector-geometry.js';
import { configureBooleanTextGeometry, getBooleanTextGeometryOptions, prepareBooleanTextGeometry, captureBooleanTextGeometry,
  disposeBooleanTextGeometryCache, booleanTextGeometryCacheStats, adoptBooleanTextGeometry, booleanTextGeometryKey,
  registerBooleanTextGeometryProvider } from '../src/boolean-text-geometry.js';

const kit = await createRequire(import.meta.url)('canvaskit-wasm')({ wasmBinary: await readFile(new URL('../node_modules/canvaskit-wasm/bin/canvaskit.wasm', import.meta.url)) });
const identity = () => [1, 0, 0, 1, 0, 0];
const fakeShape = value => ({ upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 },
  glyphs: [...value].map((character, cluster) => ({ id: character.codePointAt(0), cluster, xAdvance: 600, yAdvance: 0, xOffset: 0, yOffset: 0,
    path: /\s/u.test(character) ? '' : 'M0 0L600 0L600 800L0 800Z' })) });
const native = async request => booleanGeometryWithKit(kit, request);
function fixture(props = {}) {
  const document = createDocument(); const node = createNode('text', { name: 'Editable', text: 'H', width: 80, height: 40,
    fontFamily: 'Retained', fontSize: 20, lineHeight: 20, lineHeightUnit: 'pixels', color: '#000000', ...props });
  addNode(document, node); return { document, node };
}
const options = extra => ({ shapeText: fakeShape, booleanGeometry: native, ...extra });
const region = geometry => ({ kind: 'shape', transform: identity(), includeFill: true, strokes: [], geometry });
function coverage(pins, node) { return booleanGeometryWithKit(kit, { root: region(pins.resolveTextGeometry(node).geometry) }); }
function pathOf(result) { const path = kit.Path.MakeFromCmds(result.commands); path.setFillType(result.fillRule === 'evenodd' ? kit.FillType.EvenOdd : kit.FillType.Winding); return path; }
function contains(result, x, y) { const path = pathOf(result); try { return path.contains(x, y); } finally { path.delete(); } }
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };

test('local text paints contribute binary geometry regardless alpha while source fields remain untouched', async () => {
  const { document, node } = fixture({ opacity: 0, fillOpacity: 0, color: 'rgba(0,0,0,0)' }); const before = structuredClone(node);
  const pins = await prepareBooleanTextGeometry(document, [node], options());
  assert.equal(contains(coverage(pins, node), 6, 8), true);
  assert.deepEqual(node, before);
  assert.ok(Object.isFrozen(pins.resolveTextGeometry(node).geometry));
  assert.equal(JSON.stringify(pins.resolveTextGeometry(node)).includes('fontFamily'), false);
});

test('legacy rich transparent runs are absent while explicit stacks mask every glyph and disabled fills stay absent', async () => {
  const { document, node } = fixture({ text: 'HH', textRuns: [{ text: 'H', color: 'transparent' }, { text: 'H', color: 'rgba(0,0,0,0)' }] });
  let pins = await prepareBooleanTextGeometry(document, [node], options());
  assert.equal(contains(coverage(pins, node), 6, 8), false); assert.equal(contains(coverage(pins, node), 18, 8), true);
  node.fills = [{ id: 'fill', type: 'solid', color: '#123456', visible: true, opacity: 0 }];
  pins = await prepareBooleanTextGeometry(document, [node], options());
  assert.equal(contains(coverage(pins, node), 6, 8), true);
  node.fills[0].visible = false;
  pins = await prepareBooleanTextGeometry(document, [node], options());
  assert.equal(coverage(pins, node).commands.length, 0);
});

test('explicit fill planes clip fills only and completed ending clip does not invent edge strokes', async () => {
  const { document, node } = fixture({ width: 5, height: 8, fills: [{ id: 'fill', type: 'solid', color: '#000000', opacity: 1, visible: true }],
    strokes: [createStroke({ width: 4, color: '#000000', alignment: 'outside' })] });
  let pins = await prepareBooleanTextGeometry(document, [node], options()); let output = coverage(pins, node);
  assert.equal(contains(output, 3, 4), true, 'the explicit fill paints inside its logical domain');
  assert.equal(contains(output, 7, 8), false, 'the glyph interior beyond the plane remains unfilled');
  assert.equal(contains(output, 13, 8), true, 'the original outer glyph stroke remains outside the logical box');
  node.width = 20; node.height = 20; node.fills = []; node.strokes[0].alignment = 'inside'; node.strokes[0].width = 2;
  const descenderShape = value => ({ ...fakeShape(value), glyphs: fakeShape(value).glyphs.map(glyph => ({ ...glyph, path: 'M0 -400L600 -400L600 800L0 800Z' })) });
  pins = await prepareBooleanTextGeometry(document, [node], options({ shapeText: descenderShape })); output = coverage(pins, node);
  assert.equal(contains(output, 6, 23), true, 'the original bottom glyph stroke exists below its logical box');
  node.textTruncation = 'ending'; node.maxLines = 1;
  pins = await prepareBooleanTextGeometry(document, [node], options({ shapeText: descenderShape })); output = coverage(pins, node);
  assert.equal(contains(output, 6, 23), false, 'ending clips the completed source ink');
  assert.equal(contains(output, 6, 19), false, 'there is no newly stroked truncation edge at y=20');
});

test('typed underline geometry remains independent of empty glyph fills and zero custom alpha', async () => {
  const { document, node } = fixture({ fills: [], textDecoration: 'underline', textDecorationStyle: 'solid',
    textDecorationThickness: { unit: 'pixels', value: 2 }, textDecorationColor: { type: 'solid', color: '#ff0000', opacity: 0 } });
  let pins = await prepareBooleanTextGeometry(document, [node], options()); let output = coverage(pins, node);
  assert.equal(contains(output, 6, 8), false); assert.ok(output.commands.length > 0, 'an enabled zero-alpha typed paint still has vector coverage');
  node.textDecorationColor.visible = false;
  pins = await prepareBooleanTextGeometry(document, [node], options()); assert.equal(coverage(pins, node).commands.length, 0);
});

test('native retained Inter contours preserve counters and Q/C boundaries against a direct font-path reference', async () => {
  const face = new hb.Face(new hb.Blob(await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))))));
  const font = new hb.Font(face); font.setScale(face.upem, face.upem); const metrics = font.hExtents(); const scale = 64 / face.upem;
  const shapeText = value => { const buffer = new hb.Buffer(); buffer.addText(value); buffer.guessSegmentProperties(); hb.shape(font, buffer);
    return { upem: face.upem, extents: metrics, glyphs: buffer.getGlyphInfosAndPositions().map(glyph => ({ ...glyph, id: glyph.codepoint, path: font.glyphToPath(glyph.codepoint) })) }; };
  const { document, node } = fixture({ text: 'O', fontFamily: 'Inter', fontSize: 64, lineHeight: (metrics.ascender - metrics.descender) * scale, width: 100, height: 100 });
  const pins = await prepareBooleanTextGeometry(document, [node], options({ shapeText })); const output = coverage(pins, node); const actual = pathOf(output);
  const raw = kit.Path.MakeFromSVGString(shapeText('O').glyphs[0].path); const builder = new kit.PathBuilder(raw);
  builder.transform([scale, 0, 0, 0, -scale, metrics.ascender * scale, 0, 0, 1]); const direct = builder.detach(); builder.delete(); raw.delete();
  try {
    for (let y = .375; y < 85; y += 1.5) for (let x = .375; x < 70; x += 1.5) assert.equal(actual.contains(x, y), direct.contains(x, y), `${x},${y}`);
    assert.equal(actual.contains(25, 38), false, 'the letter counter remains a hole');
    assert.ok(pins.resolveTextGeometry(node).geometry.fillGroups[0].contours.some(contour => contour.commands.some(command => command.type === 'quadratic' || command.type === 'cubic')));
  } finally { actual.delete(); direct.delete(); }
});

test('prepared text coverage embeds once and all four Boolean operations honor its binary region', async () => {
  const { document, node } = fixture({ strokes: [createStroke({ width: 2, color: '#000000', alignment: 'outside' })] });
  const pins = await prepareBooleanTextGeometry(document, [node], options());
  const box = createNode('rectangle', { x: 6, y: 0, width: 20, height: 40, fill: '#000000' });
  const group = createNode('boolean', { width: 80, height: 40, booleanGeometry: 'vector', children: [node, box] });
  for (const operation of ['union', 'subtract', 'intersect', 'exclude']) {
    group.operation = operation; const request = buildBooleanVectorRequest(group, pins);
    assert.deepEqual(request.root.children[0].strokes, [], 'source strokes have already been outlined and must not be reapplied');
    const result = booleanGeometryWithKit(kit, request);
    assert.equal(contains(result, 8, 8), operation === 'union' || operation === 'intersect');
    assert.equal(contains(result, 2, 8), operation !== 'intersect');
    assert.equal(contains(result, 20, 8), operation === 'union' || operation === 'exclude');
  }
  const firstKey = booleanTextGeometryKey(document, node); node.x += 5; node.rotation = 30;
  assert.equal(booleanTextGeometryKey(document, node), firstKey, 'own placement stays outside glyph coverage');
});

test('mixed stroke metrics clip inside/outside against the complete overlapping glyph geometry', async () => {
  const first = nativePathGeometryForNode(createNode('rectangle', { width: 20, height: 20 }));
  const second = JSON.parse(JSON.stringify(first));
  for (const list of [...second.fillGroups.map(group => group.contours), second.strokeContours, second.alignedStrokeContours]) {
    for (const contour of list) { contour.start.x += 10; for (const command of contour.commands) { command.start.x += 10; command.end.x += 10; } }
  }
  for (const alignment of ['inside', 'outside']) {
    const { document, node } = fixture({ color: 'transparent', strokes: [createStroke({ width: 4, color: '#000000', alignment })] });
    const pins = await prepareBooleanTextGeometry(document, [node], options({ getTextOutline: async () => ({ width: 80, height: 40, decorations: [], glyphs: [
      { geometry: first, paint: { color: '#ffffff' }, strokeTransform: [2, 0, 0, 1, 0, 0] },
      { geometry: second, paint: { color: '#ffffff' }, strokeTransform: identity() }
    ] }) }));
    const output = coverage(pins, node);
    assert.equal(contains(output, 23, 10), alignment === 'inside', 'coverage from the second glyph controls the first glyph\'s aligned overlap');
    assert.equal(contains(output, -3, 10), alignment === 'outside');
  }
});

test('pins survive cache disposal and can be adopted by a clone only with matching font/source authority', async () => {
  let revision = 1; const { document, node } = fixture(); const context = options({ getFontRevision: () => revision });
  const unregister = configureBooleanTextGeometry(document, context); const pins = await prepareBooleanTextGeometry(document, [node]);
  const ready = pins.resolveTextGeometry(node); disposeBooleanTextGeometryCache(document);
  assert.throws(() => getBooleanTextGeometryOptions(document).resolveTextGeometry(node), error => error.code === 'BOOLEAN_TEXT_PENDING');
  assert.equal(pins.resolveTextGeometry(node), ready);
  const clone = structuredClone(document); const copied = clone.pages[0].children[0]; copied.x += 100;
  configureBooleanTextGeometry(clone, context); adoptBooleanTextGeometry(clone, pins);
  assert.equal(getBooleanTextGeometryOptions(clone).resolveTextGeometry(copied), ready);
  revision = 2;
  assert.throws(() => pins.validateCurrent(), error => error.code === 'BOOLEAN_TEXT_STALE');
  assert.throws(() => getBooleanTextGeometryOptions(clone).resolveTextGeometry(copied), error => error.code === 'BOOLEAN_TEXT_PENDING');
  unregister();
});

test('font configuration is bound to the document object rather than an imported matching design ID', async () => {
  const { document, node } = fixture(); const unregister = configureBooleanTextGeometry(document, options());
  await prepareBooleanTextGeometry(document, [node]); const clone = structuredClone(document);
  assert.throws(() => getBooleanTextGeometryOptions(clone).resolveTextGeometry(clone.pages[0].children[0]), error => error.code === 'BOOLEAN_TEXT_PENDING');
  unregister();
});

test('bounded page providers reuse current prepared contours after LRU disposal and reject edited text/font keys', async () => {
  let revision = 1; const { document, node } = fixture(); const context = options({ getFontRevision: () => revision });
  configureBooleanTextGeometry(document, context); const pins = await prepareBooleanTextGeometry(document, [node]);
  const unregister = registerBooleanTextGeometryProvider(document, pins.geometryForKey);
  assert.equal(unregister.isRegistered(), true); assert.ok(pins.bytes > 0);
  disposeBooleanTextGeometryCache(document);
  assert.equal(getBooleanTextGeometryOptions(document).resolveTextGeometry(node), pins.resolveTextGeometry(node));
  const reused = await prepareBooleanTextGeometry(document, [node], { getTextOutline: () => { throw new Error('A retained pin must not reopen its font session.'); } });
  assert.equal(reused.resolveTextGeometry(node), pins.resolveTextGeometry(node));
  assert.deepEqual(booleanTextGeometryCacheStats(document), { entries: 0, bytes: 0, pending: 0 });
  node.text = 'HH';
  assert.throws(() => getBooleanTextGeometryOptions(document).resolveTextGeometry(node), error => error.code === 'BOOLEAN_TEXT_PENDING');
  node.text = 'H'; revision++;
  assert.throws(() => getBooleanTextGeometryOptions(document).resolveTextGeometry(node), error => error.code === 'BOOLEAN_TEXT_PENDING');
  revision--; unregister(); assert.equal(unregister.isRegistered(), false);
  assert.throws(() => getBooleanTextGeometryOptions(document).resolveTextGeometry(node), error => error.code === 'BOOLEAN_TEXT_PENDING');
});

test('warm synchronous capture retains current text pins without jobs and survives shared-cache eviction', async () => {
  let revision = 1; const { document, node } = fixture();
  configureBooleanTextGeometry(document, options({ getFontRevision: () => revision }));
  assert.throws(() => captureBooleanTextGeometry(document, [node]), error => error.code === 'BOOLEAN_TEXT_PENDING');
  assert.deepEqual(booleanTextGeometryCacheStats(document), { entries: 0, bytes: 0, pending: 0 });
  await prepareBooleanTextGeometry(document, [node]);
  const captured = captureBooleanTextGeometry(document, [node], { getTextOutline: () => { throw new Error('Synchronous capture must not read fonts.'); } });
  const geometry = captured.resolveTextGeometry(node); disposeBooleanTextGeometryCache(document);
  const unregister = registerBooleanTextGeometryProvider(document, captured.geometryForKey);
  assert.equal(captureBooleanTextGeometry(document, [node]).resolveTextGeometry(node), geometry);
  assert.equal(captured.geometryForKey(booleanTextGeometryKey(document, node)), geometry);
  assert.ok(captured.bytes > 0); captured.validateCurrent();
  revision++;
  assert.throws(() => captured.validateCurrent(), error => error.code === 'BOOLEAN_TEXT_STALE');
  assert.throws(() => captureBooleanTextGeometry(document, [node]), error => error.code === 'BOOLEAN_TEXT_PENDING');
  unregister();
});

test('disposal promptly settles pending text preparation and aborts its native font read', async () => {
  const { document, node } = fixture(); const entered = deferred(); let producerSignal;
  const work = prepareBooleanTextGeometry(document, [node], options({ getTextOutline: (_, __, settings) => { producerSignal = settings.signal; entered.resolve(); return new Promise(() => {}); } }));
  const rejected = assert.rejects(work, error => error.name === 'AbortError');
  await entered.promise; disposeBooleanTextGeometryCache(document); await rejected;
  assert.equal(producerSignal.aborted, true); assert.deepEqual(booleanTextGeometryCacheStats(document), { entries: 0, bytes: 0, pending: 0 });
});

test('separate operation-owned font sessions are not coalesced or poisoned by cancellation', async () => {
  const { document, node } = fixture(); const first = deferred(); const second = deferred(); const entered = deferred(); const controller = new AbortController();
  let count = 0;
  const provider = gate => (design, normalized) => { if (++count === 2) entered.resolve(); return gate.promise.then(() => collectTextOutlineGeometry(design, normalized, { shapeText: fakeShape })); };
  const left = prepareBooleanTextGeometry(document, [node], options({ getTextOutline: provider(first), signal: controller.signal }));
  const right = prepareBooleanTextGeometry(document, [node], options({ getTextOutline: provider(second) }));
  const rejected = assert.rejects(left, error => error.name === 'AbortError'); await entered.promise; controller.abort(); await rejected;
  second.resolve(); const result = await right; assert.equal(contains(coverage(result, node), 6, 8), true);
  first.resolve();
});

test('identical producer authority shares work with independent waiters and charges a same-key replacement once', async () => {
  const { document, node } = fixture(); const gate = deferred(); const entered = deferred(); const controller = new AbortController(); let reads = 0;
  const getTextOutline = (design, normalized) => { reads++; entered.resolve(); return gate.promise.then(() => collectTextOutlineGeometry(design, normalized, { shapeText: fakeShape })); };
  const common = options({ getTextOutline });
  const left = prepareBooleanTextGeometry(document, [node], { ...common, signal: controller.signal }); const right = prepareBooleanTextGeometry(document, [node], common);
  const rejected = assert.rejects(left, error => error.name === 'AbortError'); await entered.promise; controller.abort(); await rejected; gate.resolve(); await right;
  assert.equal(reads, 1); assert.equal(booleanTextGeometryCacheStats(document).entries, 1);
});

test('two independent producers replacing one semantic entry do not double its retained byte charge', async () => {
  const { document, node } = fixture(); const first = deferred(); const second = deferred(); const entered = deferred(); let count = 0;
  const provider = gate => (design, normalized) => { if (++count === 2) entered.resolve(); return gate.promise.then(() => collectTextOutlineGeometry(design, normalized, { shapeText: fakeShape })); };
  const left = prepareBooleanTextGeometry(document, [node], options({ getTextOutline: provider(first) }));
  const right = prepareBooleanTextGeometry(document, [node], options({ getTextOutline: provider(second) }));
  await entered.promise; first.resolve(); await left; const bytes = booleanTextGeometryCacheStats(document).bytes;
  second.resolve(); await right;
  assert.deepEqual(booleanTextGeometryCacheStats(document), { entries: 1, bytes, pending: 0 });
});

test('the text queue admits at most eight independent jobs and cancellation drains every waiter', async () => {
  const document = createDocument(); const controllers = []; const results = [];
  const settings = options({ getTextOutline: () => new Promise(() => {}) });
  for (let index = 0; index < 8; index++) {
    const node = createNode('text', { text: `H${index}`, fontFamily: 'Retained' }); addNode(document, node);
    const controller = new AbortController(); controllers.push(controller);
    results.push(assert.rejects(prepareBooleanTextGeometry(document, [node], { ...settings, signal: controller.signal }), error => error.name === 'AbortError'));
  }
  const overflow = createNode('text', { text: 'Overflow', fontFamily: 'Retained' }); addNode(document, overflow);
  await assert.rejects(prepareBooleanTextGeometry(document, [overflow], settings), error => error.code === 'BOOLEAN_TEXT_QUEUE_FULL');
  assert.equal(booleanTextGeometryCacheStats(document).pending, 8);
  controllers.forEach(controller => controller.abort()); await Promise.all(results);
  assert.equal(booleanTextGeometryCacheStats(document).pending, 0);
});

test('changed source typography or linked path revisions cannot use pinned or pending stale contours', async () => {
  const { document, node } = fixture(); const gate = deferred(); const entered = deferred();
  const work = prepareBooleanTextGeometry(document, [node], options({ getTextOutline: (design, normalized) => { entered.resolve(); return gate.promise.then(() => collectTextOutlineGeometry(design, normalized, { shapeText: fakeShape })); } }));
  const rejected = assert.rejects(work, error => error.code === 'BOOLEAN_TEXT_STALE'); await entered.promise; node.fontSize = 30; gate.resolve(); await rejected;
  const pins = await prepareBooleanTextGeometry(document, [node], options()); node.letterSpacing = 10; node.letterSpacingUnit = 'percent';
  assert.throws(() => pins.validateCurrent(), error => error.code === 'BOOLEAN_TEXT_STALE');
});

test('removing a source cannot validate detached old text pins', async () => {
  const { document, node } = fixture(); const pins = await prepareBooleanTextGeometry(document, [node], options());
  document.pages[0].children = [];
  assert.throws(() => pins.validateCurrent(), error => error.code === 'BOOLEAN_TEXT_STALE');
});

test('browser glyph fallback fails explicitly and no partial native contours are retained', async () => {
  const { document, node } = fixture();
  await assert.rejects(prepareBooleanTextGeometry(document, [node], options({ shapeText: () => null })), /glyph|font|shape/i);
  assert.equal(booleanTextGeometryCacheStats(document).entries, 0);
  assert.equal(booleanTextGeometryCacheStats(document).pending, 0);
});
