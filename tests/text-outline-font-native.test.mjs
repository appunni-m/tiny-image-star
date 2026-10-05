import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { runInNewContext } from 'node:vm';
import { createDocument, createNode, addNode } from '../src/model.js';
import { TextOutlineFontSession } from '../src/text-outline-font-session.js';
import { prepareTextOutlineGeometry } from '../src/text-outline-geometry.js';
import { validateLocalFontAsset } from '../src/font-assets.js';
import { LocalFontShapingClient } from '../src/font-shaping.js';
import { LocalWoff2Decoder } from '../src/woff2-decoder.js';

const fixtureUrl = new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url);
const axes = [
  { tag: 'wght', min: 100, max: 900, defaultValue: 400 },
  { tag: 'opsz', min: 14, max: 32, defaultValue: 14 }
];
const font = index => ({ id: `outline-inter-${index}`, family: `Outline Inter ${index}`,
  name: `outline-inter-${index}.woff2`, type: 'font/woff2', weight: 400, style: 'normal', axes });
const style = record => ({ fontFamily: record.family, fontWeight: 400, fontSize: 14 });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function bounded(value, label) {
  let timer;
  try {
    return await Promise.race([value, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not finish within 10 seconds.`)), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

// Use the production bundles and their actual local WASM in separate heaps.
// Only the browser worker message boundary is adapted to Node worker_threads.
function workerFactory(bundleName, lifecycle) {
  const workerUrl = new URL(`../src/workers/${bundleName}`, import.meta.url).href;
  return () => {
    const worker = new NodeWorker(`
      const {parentPort} = require('node:worker_threads');
      const {readFile} = require('node:fs/promises');
      globalThis.self = {
        location: {href: ${JSON.stringify(workerUrl)}},
        addEventListener(type, callback) {
          if (type === 'message') parentPort.on('message', data => callback({data}));
        },
        postMessage: (value, transfers) => parentPort.postMessage(value, transfers)
      };
      globalThis.fetch = async value => {
        const url = new URL(String(value));
        if (url.protocol !== 'file:') throw new Error('Font outlining attempted a non-local fetch.');
        return new Response(await readFile(url));
      };
      import(${JSON.stringify(workerUrl)}).catch(error => {throw error;});
    `, { eval: true });
    const record = { bundleName, messages: [], terminateCount: 0,
      exit: new Promise(resolve => worker.once('exit', resolve)) };
    lifecycle.push(record);
    return {
      postMessage(message, transfers) {
        record.messages.push({ type: message.type || 'decode', fontId: message.fontId });
        worker.postMessage(message, transfers);
      },
      terminate() { record.terminateCount += 1; return worker.terminate(); },
      addEventListener(type, callback) {
        if (type === 'message') worker.on('message', data => callback({ data }));
        else if (type === 'error') worker.on('error', callback);
        else if (type === 'messageerror') worker.on('messageerror', callback);
      }
    };
  };
}

async function harness(t, records, options = {}) {
  const bytes = new Uint8Array(await readFile(fixtureUrl));
  const originals = bytes.slice();
  const files = new Map(records.map(record => [record.id, { ...record, bytes: bytes.slice() }]));
  const reads = [];
  const lifecycle = [];
  const shaper = new LocalFontShapingClient({
    workerFactory: workerFactory('font-shaping-worker.bundle.js', lifecycle),
    maxCacheBytes: 0, maxCacheEntries: 0
  });
  const decoder = new LocalWoff2Decoder({
    workerFactory: workerFactory('woff2-decompress-worker.bundle.js', lifecycle),
    timeoutMs: 10_000, idleShutdownMs: 0
  });
  const session = new TextOutlineFontSession({ fonts: records, shaper, decoder,
    readFont: async id => { reads.push(id); return files.get(id); },
    requestTimeoutMs: 10_000, ...options });
  t.after(async () => {
    session.close();
    await bounded(Promise.all(lifecycle.map(record => record.exit)), 'Font worker cleanup');
    assert.ok(lifecycle.every(record => record.terminateCount === 1), 'each owned native worker terminates once');
  });
  return { session, shaper, decoder, files, reads, lifecycle, originals };
}

test('production font sessions decode local WOFF2 and preserve actual combining-glyph, variation and feature geometry', { timeout: 30_000 }, async t => {
  const record = font(0);
  const h = await harness(t, [record]);
  const marked = await h.session.shapeText('q\u0301', style(record));
  assert.equal(marked.upem, 2048);
  assert.equal(marked.glyphs.length, 2, 'this fixture retains a separate zero-advance accent on q');
  assert.deepEqual(marked.glyphs.map(glyph => glyph.cluster), [0, 0]);
  assert.equal(marked.glyphs[1].xAdvance, 0);
  assert.ok(marked.glyphs[1].xOffset < 0, 'the real GPOS attachment moves the accent over its base');
  assert.ok(marked.glyphs.every(glyph => glyph.id > 0 && glyph.path.endsWith('Z')));
  assert.ok(marked.glyphs[0].path.includes('Q'), 'the real native quadratic glyph contours survive the worker boundary');
  const composed = await h.session.shapeText('A\u0301', style(record));
  assert.equal(composed.glyphs.length, 1, 'the fixture composes this supported cluster before outlining');
  const whitespace = await h.session.shapeText(' ', style(record));
  assert.equal(whitespace.glyphs.length, 1);
  assert.equal(whitespace.glyphs[0].path, '');
  assert.ok(whitespace.glyphs[0].xAdvance > 0, 'spacing survives even when there is no drawable outline');

  const regular = await h.session.shapeText('ToWa', style(record));
  const heavy = await h.session.shapeText('ToWa', { ...style(record), fontWeight: 850 });
  const optical = await h.session.shapeText('ToWa', { ...style(record), fontSize: 32 });
  const unkerned = await h.session.shapeText('ToWa', { ...style(record), fontFeatures: { kern: 0 } });
  const advance = result => result.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0);
  assert.notEqual(heavy.glyphs[0].path, regular.glyphs[0].path, 'authored weight reaches the actual variable-font outline');
  assert.notEqual(advance(optical), advance(regular), 'automatic optical size uses the authored font size');
  assert.notEqual(advance(unkerned), advance(regular), 'authored OpenType features reach native shaping');
  await assert.rejects(h.session.shapeText('مرحبا', style(record)), /browser fallback/,
    'the Latin fixture cannot silently produce an Arabic browser or .notdef outline');
  assert.deepEqual(h.reads, [record.id]);
  assert.deepEqual(h.files.get(record.id).bytes, h.originals, 'decode transfers copies without mutating the saved file');
  assert.deepEqual(h.lifecycle.map(worker => worker.bundleName).sort(),
    ['font-shaping-worker.bundle.js', 'woff2-decompress-worker.bundle.js']);
});

test('actual four-font worker eviction reloads immutable decoded bytes without reopening changed files', { timeout: 30_000 }, async t => {
  const records = Array.from({ length: 5 }, (_, index) => font(index));
  const h = await harness(t, records);
  const first = await h.session.shapeText('q\u0301 O', style(records[0]));
  for (const record of records.slice(1)) await h.session.shapeText('A', style(record));
  assert.equal(h.shaper.hasFont(records[0].id), false, 'the actual native font LRU evicts the first of five fonts');
  h.files.get(records[0].id).bytes.fill(0);
  const reloaded = await h.session.shapeText('q\u0301 O', style(records[0]));
  assert.deepEqual(reloaded, first, 'the reloaded native font comes from the pinned conversion snapshot');
  assert.equal(h.shaper.hasFont(records[0].id), true);
  assert.deepEqual(h.reads, records.map(record => record.id));
  const shapeWorker = h.lifecycle.find(worker => worker.bundleName === 'font-shaping-worker.bundle.js');
  assert.equal(shapeWorker.messages.filter(message => message.type === 'load-font').length, 6);
  const decodeWorker = h.lifecycle.find(worker => worker.bundleName === 'woff2-decompress-worker.bundle.js');
  assert.equal(decodeWorker.messages.length, 5, 'eviction does not decode or reread a mutable WOFF2 file again');
});

test('cancelling a pending font read terminates already running native workers and fences late file data', { timeout: 30_000 }, async t => {
  const records = [font(0), font(1)];
  const enteredRead = deferred(); const finishRead = deferred();
  const controller = new AbortController();
  const source = new Uint8Array(await readFile(fixtureUrl));
  const h = await harness(t, records, { signal: controller.signal, readFont: async id => {
    if (id === records[1].id) { enteredRead.resolve(); return finishRead.promise; }
    return { ...records[0], bytes: source };
  } });
  await h.session.shapeText('A', style(records[0]));
  const messageCounts = h.lifecycle.map(worker => worker.messages.length);
  const pending = h.session.shapeText('O', style(records[1]));
  await bounded(enteredRead.promise, 'Second local font read');
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await bounded(Promise.all(h.lifecycle.map(worker => worker.exit)), 'Aborted native worker cleanup');
  finishRead.resolve({ ...records[1], bytes: source });
  await finishRead.promise;
  assert.deepEqual(h.lifecycle.map(worker => worker.messages.length), messageCounts,
    'late local file bytes cannot schedule decode, load or shaping after cancellation');
  assert.ok(h.lifecycle.every(worker => worker.terminateCount === 1));
  await assert.rejects(h.session.shapeText('A', style(records[0])), { name: 'AbortError' });
});

test('a stale design/font snapshot rejects a pending file result before another native font is parsed', { timeout: 30_000 }, async t => {
  const records = [font(0), font(1)];
  const enteredRead = deferred(); const finishRead = deferred();
  let current = true;
  const source = new Uint8Array(await readFile(fixtureUrl));
  const h = await harness(t, records, { assertCurrent: () => current, readFont: async id => {
    if (id === records[1].id) { enteredRead.resolve(); return finishRead.promise; }
    return { ...records[0], bytes: source };
  } });
  await h.session.shapeText('A', style(records[0]));
  const messageCounts = h.lifecycle.map(worker => worker.messages.length);
  const pending = h.session.shapeText('O', style(records[1]));
  await bounded(enteredRead.promise, 'Stale local font read');
  current = false;
  finishRead.resolve({ ...records[1], bytes: source });
  await assert.rejects(pending, /design or its fonts changed/);
  assert.deepEqual(h.lifecycle.map(worker => worker.messages.length), messageCounts);
  assert.throws(() => h.session.validateCurrent(), /design or its fonts changed/);
});

test('the production text preparation pins workspace reads and replays rich layout with native local glyph contours', { timeout: 30_000 }, async t => {
  const record = font(0); const h = await harness(t, [record]);
  const sourceDocument = createDocument();
  const node = createNode('text', { text: 'q\u0301 O', fontFamily: record.family, fontSize: 32,
    width: 300, height: 80, textRuns: [
      { text: 'q\u0301 ', fontSize: 32, color: '#ff0000', fontAxes: { wght: 400, opsz: 14 }, textDecoration: 'underline' },
      { text: 'O', fontSize: 48, color: '#0000ff', fontAxes: { wght: 800, opsz: 32 } }
    ] });
  addNode(sourceDocument, node);
  const before = structuredClone(sourceDocument);
  const workspace = { name: 'captured local folder' }; const reads = [];
  const state = { document: sourceDocument, documentGeneration: 7, fontAssetEpoch: 3,
    workspace, fontAssets: new Map([[record.id, record]]) };
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function createTextOutlinePreparation(sourceDocument, signal) {');
  const end = main.indexOf('\nfunction documentUsesFontFamily', start);
  assert.ok(start >= 0 && end > start);
  const preparation = runInNewContext(`${main.slice(start, end)}\ncreateTextOutlinePreparation(sourceDocument);`, {
    state, sourceDocument, DOMException,
    TextOutlineFontSession: class {
      constructor(options) {
        const session = new TextOutlineFontSession({ ...options, shaper: h.shaper, decoder: h.decoder });
        t.after(() => session.close());
        return session;
      }
    },
    document: { createElement: () => ({ getContext: () => ({
      measureText() { throw new Error('Native text preparation must not use browser fallback measurements.'); }
    }) }) },
    validateLocalFontAsset, prepareTextOutlineGeometry,
    loadFontAsset: () => { throw new Error('The captured workspace must supply the local font file.'); },
    readWorkspaceFontAssetOrRestore: async (selectedWorkspace, designId, fontId) => {
      assert.equal(selectedWorkspace, workspace); assert.equal(designId, sourceDocument.id);
      reads.push(fontId); const saved = h.files.get(fontId);
      return { metadata: saved, bytes: saved.bytes };
    }
  });
  try {
    const result = await preparation.getTextOutline(sourceDocument, node, {});
    assert.equal(result.glyphs.length, 3, 'q, its zero-advance accent, and O retain their individual native contours');
    assert.deepEqual(result.glyphs.map(glyph => glyph.paint.color), ['#ff0000', '#ff0000', '#0000ff']);
    assert.equal(result.glyphs[2].geometry.strokeContours.length, 2, 'the real O counter survives rich typography layout');
    assert.ok(result.glyphs[2].geometry.strokeContours.some(contour => contour.commands.some(command => command.type === 'quadratic')));
    assert.ok(result.decorations.length > 0, 'the displayed underline is retained as separate local vector geometry');
    assert.deepEqual(reads, [record.id]);
    assert.deepEqual(sourceDocument, before, 'font preparation never modifies the design before model validation/apply');
    state.workspace = { name: 'different local folder' };
    assert.throws(() => preparation.validateCurrent(), /design or its fonts changed/,
      'a folder switch invalidates the prepared conversion even when the same design object remains active');
  } finally { preparation.close(); }
});
