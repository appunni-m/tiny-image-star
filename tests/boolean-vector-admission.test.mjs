import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import * as model from '../src/model.js';
import { booleanGeometryWithKit } from '../src/vector-geometry-kernel.js';
import { booleanVectorGeometryKey, disposeBooleanVectorGeometryCache, registerBooleanVectorGeometryProvider } from '../src/boolean-vector-geometry.js';
import { configureBooleanTextGeometry, disposeBooleanTextGeometryCache, getBooleanTextGeometryOptions, registerBooleanTextGeometryProvider } from '../src/boolean-text-geometry.js';

const kit = await createRequire(import.meta.url)('canvaskit-wasm')({});
const source = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');
const start = source.indexOf('\n  resetBooleanVectorRenderScope(document) {');
const end = source.indexOf('\n  reportBooleanStrokeError(', start);
assert.ok(start >= 0 && end > start);
const loader = runInNewContext(`class Loader { ${source.slice(start, end)} }; Loader`, {
  AbortController, setTimeout, structuredClone, booleanVectorGeometryKey, registerBooleanVectorGeometryProvider,
  getBooleanTextGeometryOptions, registerBooleanTextGeometryProvider, getBooleanVectorGeometryKey: model.getBooleanVectorGeometryKey,
  getBooleanVectorPath: model.getBooleanVectorPath,
  getNodePropertyValue: model.getNodePropertyValue,
  resolveBooleanSourceNode: model.resolveBooleanSourceNode,
  prepareBooleanVectorPath: (document, node, options) => model.prepareBooleanVectorPath(document, node, {
    ...options, booleanGeometry: (...args) => processor(...args)
  })
});
let processor;

function scene(count) {
  const document = model.createDocument();
  for (let index = 0; index < count; index++) {
    const width = 100 + index;
    model.addNode(document, model.createNode('boolean', { width, height: 80, booleanGeometry: 'vector',
      children: [model.createNode('rectangle', { width, height: 80 }), model.createNode('rectangle', { x: 30, y: 20, width: 20, height: 20 })] }));
  }
  return document;
}

function rendererFor(document) {
  const renderer = new loader(); const errors = [];
  let queued = false;
  Object.assign(renderer, { booleanVectorPending: new Map(), booleanVectorFailures: new Map(),
    getState: () => ({ document }), reportBooleanStrokeError: (_node, error) => errors.push(error),
    invalidate: () => {
      if (queued || renderer.destroyed) return;
      queued = true; setImmediate(() => { queued = false; if (!renderer.destroyed) draw(); });
    } });
  function draw() {
    renderer.pruneBooleanVectorRenderScope(document);
    for (const node of document.pages[0].children) {
      try { renderer.getRenderedBooleanVectorPath(node); }
      catch (error) { if (['BOOLEAN_VECTOR_PENDING', 'BOOLEAN_TEXT_PENDING'].includes(error.code)) renderer.loadBooleanVectorPath(node); else errors.push(error); }
    }
  }
  return { renderer, errors, draw, close: () => {
    renderer.destroyed = true;
    for (const ticket of renderer.booleanVectorPending.values()) ticket.controller.abort();
    renderer.booleanVectorPending.clear(); renderer.booleanVectorUnregister?.(); renderer.booleanVectorTextUnregister?.();
    clearTimeout(renderer.booleanVectorRetryTimer);
  } };
}

async function waitReady(document, renderer) {
  const deadline = Date.now() + 20_000;
  while (true) {
    try { for (const node of document.pages[0].children) { renderer.getRenderedBooleanVectorPath(node); model.getBooleanVectorPath(document, node); } return; }
    catch (error) { if (!['BOOLEAN_VECTOR_PENDING', 'BOOLEAN_TEXT_PENDING'].includes(error.code) || Date.now() > deadline) throw error; }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('a cold page with more than eight Boolean regions admits bounded work until every region is ready', async t => {
  disposeBooleanVectorGeometryCache(); const document = scene(40);
  let active = 0; let peak = 0; let calls = 0;
  processor = async request => {
    active++; peak = Math.max(peak, active); calls++;
    try { await new Promise(resolve => setImmediate(resolve)); return booleanGeometryWithKit(kit, request); }
    finally { active--; }
  };
  const h = rendererFor(document); t.after(h.close); h.draw(); await waitReady(document, h.renderer);
  assert.equal(calls, 40); assert.ok(peak <= 4); assert.equal(active, 0);
  assert.equal(h.errors.length, 0); assert.equal(h.renderer.booleanVectorFailures.size, 0);
});

test('temporary worker queue contention retries automatically without poisoning the geometry key', async t => {
  disposeBooleanVectorGeometryCache(); const document = scene(1); let calls = 0;
  processor = async request => {
    if (++calls === 1) { const error = new Error('Busy'); error.code = 'VECTOR_GEOMETRY_QUEUE_FULL'; throw error; }
    return booleanGeometryWithKit(kit, request);
  };
  const h = rendererFor(document); t.after(h.close); h.draw(); await waitReady(document, h.renderer);
  assert.equal(calls, 2); assert.equal(h.errors.length, 0); assert.equal(h.renderer.booleanVectorFailures.size, 0);
  clearTimeout(h.renderer.booleanVectorRetryTimer);
});

test('257 distinct regions remain ready after shared-cache eviction without repeated native work', async t => {
  disposeBooleanVectorGeometryCache(); const document = scene(257); let calls = 0;
  processor = async request => { calls++; await new Promise(resolve => setImmediate(resolve)); return booleanGeometryWithKit(kit, request); };
  const h = rendererFor(document); t.after(h.close); h.draw(); await waitReady(document, h.renderer);
  assert.equal(calls, 257); assert.equal(h.renderer.booleanVectorPaths.size, 257);
  assert.ok(h.renderer.booleanVectorPathBytes > 0 && h.renderer.booleanVectorPathBytes <= 32 * 1024 * 1024);
  for (const node of document.pages[0].children) {
    assert.equal(model.getBooleanVectorPath(document, node).type, 'path', 'hit tests and inspector lookups can borrow every retained region');
    assert.equal((await model.prepareBooleanVectorPath(document, node, { booleanGeometry: processor })).type, 'path', 'exports reuse page pins');
  }
  for (let pass = 0; pass < 4; pass++) { h.draw(); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(calls, 257, 'ordinary invalidations do not resubmit evicted shared-cache regions');
  const node = document.pages[0].children[0]; node.fill = '#123456'; node.opacity = .7;
  const fresh = h.renderer.getRenderedBooleanVectorPath(node);
  assert.equal(fresh.fill, '#123456'); assert.equal(fresh.opacity, .7);
  fresh.points[0].x = 99;
  assert.notEqual(h.renderer.getRenderedBooleanVectorPath(node).points[0].x, 99, 'returned paths cannot mutate retained contours');
  node.children[0].width += 1;
  h.draw(); await waitReady(document, h.renderer);
  assert.equal(calls, 258, 'only changed source geometry is recomputed');
  document.pages[0].children.pop(); h.draw();
  assert.equal(h.renderer.booleanVectorPaths.size, 256, 'removed layers release retained page geometry');
  assert.equal(h.errors.length, 0);
});

test('renderer geometry limits fail actionably without repeated work and reset after content is removed', async t => {
  disposeBooleanVectorGeometryCache(); const document = scene(2); let calls = 0;
  processor = async request => { calls++; return booleanGeometryWithKit(kit, request); };
  const h = rendererFor(document); t.after(h.close); h.draw(); await waitReady(document, h.renderer);
  const retained = h.renderer.booleanVectorPaths.get(document.pages[0].children[0].id);
  h.renderer.booleanVectorPathBytes = 32 * 1024 * 1024;
  const node = model.createNode('boolean', { width: 351, height: 80, booleanGeometry: 'vector',
    children: [model.createNode('rectangle', { width: 351, height: 80 }), model.createNode('rectangle', { x: 10 })] });
  model.addNode(document, node); h.draw();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 3); assert.equal(h.renderer.booleanVectorBudgetError?.code, 'BOOLEAN_VECTOR_RENDER_LIMIT');
  for (let pass = 0; pass < 4; pass++) { h.draw(); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(calls, 3, 'budget rejection never starts an admission loop');
  document.pages[0].children.shift(); h.renderer.booleanVectorPathBytes -= retained.bytes;
  h.renderer.pruneBooleanVectorRenderScope(document);
  assert.equal(h.renderer.booleanVectorBudgetError, null);
  h.renderer.booleanVectorPathBytes = [...h.renderer.booleanVectorPaths.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  h.draw(); await waitReady(document, h.renderer);
  assert.equal(calls, 3, 'the already completed shared result can be retained after budget is released');
  const replacement = scene(1); h.renderer.getState = () => ({ document: replacement });
  h.renderer.resetBooleanVectorRenderScope(replacement);
  assert.equal(h.renderer.booleanVectorPaths.size, 0); assert.equal(h.renderer.booleanVectorPathBytes, 0);
});

const fontBytes = await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))));
const fontFace = new hb.Face(new hb.Blob(fontBytes));
function shapeLocalGlyphs(text) {
  const font = new hb.Font(fontFace); font.setScale(fontFace.upem, fontFace.upem);
  const buffer = new hb.Buffer(); buffer.addText(text); buffer.guessSegmentProperties(); hb.shape(font, buffer);
  return { upem: fontFace.upem, extents: font.hExtents(),
    glyphs: buffer.getGlyphInfosAndPositions().map(g => ({ ...g, id: g.codepoint, path: font.glyphToPath(g.codepoint) })) };
}
function textScene(count) {
  const document = model.createDocument();
  for (let index = 0; index < count; index++) model.addNode(document, model.createNode('boolean', {
    width: 100, height: 80, booleanGeometry: 'vector', children: [
      model.createNode('text', { text: 'O', fontFamily: 'Retained Inter', fontSize: 20 + index / 10, width: 90, height: 80 }),
      model.createNode('rectangle', { x: 90, width: 10, height: 80 })]
  }));
  return document;
}

test('cold text Booleans load real glyphs, refresh edited operands and reject old font revisions without sticky failures', async t => {
  disposeBooleanVectorGeometryCache(); const document = textScene(3); let revision = 1; let shapes = 0;
  const release = configureBooleanTextGeometry(document, { getFontRevision: () => revision,
    shapeText: (...args) => { shapes++; return shapeLocalGlyphs(...args); } });
  t.after(release); processor = async request => booleanGeometryWithKit(kit, request);
  const h = rendererFor(document); t.after(h.close); h.draw(); await waitReady(document, h.renderer);
  assert.ok(shapes > 0, 'cold rendering invokes actual local font geometry preparation');
  const first = document.pages[0].children[0]; const before = model.getBooleanVectorGeometryKey(document, first);
  first.children[0].text = 'B'; h.draw(); await waitReady(document, h.renderer);
  assert.notEqual(model.getBooleanVectorGeometryKey(document, first), before);
  const ready = shapes; revision++; h.draw(); await waitReady(document, h.renderer);
  assert.ok(shapes > ready); assert.equal(h.errors.length, 0); assert.equal(h.renderer.booleanVectorFailures.size, 0);
});

test('257 distinct text regions remain ready through glyph/native cache eviction without repeated font or native jobs', { timeout: 30_000 }, async t => {
  disposeBooleanVectorGeometryCache(); const document = textScene(257); let shapes = 0, jobs = 0, active = 0, peak = 0;
  const release = configureBooleanTextGeometry(document, { getFontRevision: () => 'retained Inter',
    shapeText: (...args) => { shapes++; return shapeLocalGlyphs(...args); } });
  t.after(release); processor = async request => {
    jobs++; active++; peak = Math.max(peak, active);
    try { await new Promise(resolve => setImmediate(resolve)); return booleanGeometryWithKit(kit, request); }
    finally { active--; }
  };
  const h = rendererFor(document); t.after(h.close); h.draw(); await waitReady(document, h.renderer);
  const initial = { jobs, shapes }; assert.ok(peak <= 4); assert.equal(h.renderer.booleanVectorPaths.size, 257);
  assert.ok([...h.renderer.booleanVectorPaths.values()].every(entry => entry.textGeometryPlan?.bytes > 0));
  // More than 256 final regions and 128 text sources already evict both LRUs.
  // Full native disposal intentionally unregisters page owners; glyph disposal
  // clears only its shared contour cache, so retained page pins stay valid.
  disposeBooleanTextGeometryCache(document);
  for (let pass = 0; pass < 3; pass++) { h.draw(); await waitReady(document, h.renderer); }
  assert.deepEqual({ jobs, shapes }, initial, 'independent page pins supply both glyph and final region geometry');
  const node = document.pages[0].children[0];
  assert.ok(model.prepareBooleanBake(document, node.id));
  node.children[0].fontSize = 100.777; h.draw(); await waitReady(document, h.renderer);
  assert.equal(jobs, initial.jobs + 2, 'one changed text silhouette and its region are recomputed');
  assert.equal(h.errors.length, 0); assert.equal(h.renderer.booleanVectorFailures.size, 0);
  document.pages[0].children.splice(0, 1); h.draw(); assert.equal(h.renderer.booleanVectorPaths.size, 256);
});

test('a first draw from warm native geometry captures text pins before later glyph eviction', async t => {
  disposeBooleanVectorGeometryCache(); const document = textScene(1); let shapes = 0, jobs = 0;
  const release = configureBooleanTextGeometry(document, { getFontRevision: () => 'Inter',
    shapeText: (...args) => { shapes++; return shapeLocalGlyphs(...args); } });
  t.after(release); processor = async request => { jobs++; return booleanGeometryWithKit(kit, request); };
  const node = document.pages[0].children[0];
  await model.prepareBooleanVectorPath(document, node, { booleanGeometry: processor });
  const ready = { jobs, shapes }; const h = rendererFor(document); t.after(h.close); h.draw();
  const entry = h.renderer.booleanVectorPaths.get(node.id);
  assert.ok(entry.textGeometryPlan?.bytes > 0, 'the synchronous warm-path branch also retains verified text contours');
  disposeBooleanTextGeometryCache(document); h.draw(); await waitReady(document, h.renderer);
  assert.deepEqual({ jobs, shapes }, ready, 'eviction cannot reopen a font session or resubmit ready native geometry');
});
