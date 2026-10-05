import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { withPreparedVectorPdfText, VECTOR_PDF_TEXT_LIMITS } from '../src/vector-pdf-text-preparation.js';
import { TextOutlineFontSession } from '../src/text-outline-font-session.js';
import { LocalFontShapingClient } from '../src/font-shaping.js';
import { LocalWoff2Decoder } from '../src/woff2-decoder.js';

const record = { id: 'pdf-inter', name: 'pdf-inter.woff2', family: 'PDF Inter', type: 'font/woff2', weight: 400, style: 'normal',
  axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }, { tag: 'opsz', min: 14, max: 32, defaultValue: 14 }] };
const style = { fontFamily: record.family, fontSize: 14, fontWeight: 400 };
const metrics = { upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 }, leadingTrimMetrics: { capHeight: 700 } };
const shape = text => ({ ...structuredClone(metrics), primaryFontMetrics: structuredClone(metrics),
  glyphs: [...text].map((character, cluster) => ({ id: character.codePointAt(0), cluster,
    xAdvance: 500, yAdvance: 0, xOffset: 0, yOffset: 0, path: 'M0 0L500 0L500 700Z' })) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fakeOptions(implementation = async text => shape(text), extra = {}) {
  const state = { created: 0, closed: 0, calls: [] };
  return { state, options: { fonts: [record], readFont: async () => null, pollMs: 1,
    sessionFactory: options => {
      state.created++; state.settings = options;
      return { shapeText: (text, value) => { state.calls.push({ text, style: structuredClone(value) }); return implementation(text, value, options); },
        close: () => { state.closed++; } };
    }, ...extra } };
}

test('standard-font queries preserve none/null and never create a font session, even with unused retained fonts', async () => {
  const h = fakeOptions();
  const output = await withPreparedVectorPdfText(pinned => {
    const standard = { ...style, fontFamily: 'Helvetica' };
    assert.equal(pinned.isPreparedTextExport, true);
    assert.equal(pinned.fontStatus(standard, 'normal PDF'), 'none');
    assert.equal(pinned.fontMetricsStatus(standard), 'none');
    assert.equal(pinned.fontMetrics(standard), null);
    return pinned('normal PDF', standard);
  }, h.options);
  assert.equal(output, null); assert.equal(h.state.created, 0); assert.equal(h.state.closed, 0);
  assert.equal(await withPreparedVectorPdfText(pinned => pinned('standard', { fontFamily: 'Helvetica' })), null);
});

test('cold local queries retry, pin canonical styles, and isolate answers from generator mutation', async () => {
  const h = fakeOptions(); let attempts = 0;
  const result = await withPreparedVectorPdfText(pinned => {
    attempts++;
    const authored = { ...style, fontAxes: { wght: 600, opsz: 20 }, fontFeatures: { kern: 0, liga: 1 } };
    const first = pinned('To', authored); first.glyphs[0].path = 'changed';
    const next = pinned('To', { ...authored, fontWeight: 600, baselineShift: 3,
      fontAxes: { opsz: 20, wght: 600 }, fontFeatures: { liga: 1, kern: 0 } });
    assert.notEqual(next.glyphs[0].path, 'changed'); return next;
  }, h.options);
  assert.ok(attempts > 1); assert.equal(result.glyphs.length, 2);
  assert.equal(h.state.created, 1); assert.equal(h.state.calls.length, 1); assert.equal(h.state.closed, 1);
  assert.equal(h.state.settings.signal.aborted, true, 'the owned operation is closed after publication');
});

test('queued glyph styles are immutable snapshots and cannot answer an old cache key with mutated axes or features', async () => {
  const submitted = { ...style, fontAxes: { wght: 400, opsz: 14 }, fontFeatures: { kern: 1 } };
  const original = structuredClone(submitted); let first = true;
  const h = fakeOptions(async (text, captured) => {
    assert.equal(Object.isFrozen(captured), true); assert.equal(Object.isFrozen(captured.fontAxes), true);
    assert.equal(Object.isFrozen(captured.fontFeatures), true);
    return { ...shape(text), glyphs: [{ ...shape(text).glyphs[0], id: captured.fontAxes.wght,
      path: `M${captured.fontSize} ${captured.fontFeatures.kern}L500 0L500 700Z` }] };
  });
  const result = await withPreparedVectorPdfText(pinned => {
    if (first) {
      first = false;
      try { pinned('O', submitted); }
      catch (error) {
        assert.equal(error.code, 'TEXT_POSITION_PENDING');
        submitted.fontFamily = 'Caller changed family'; submitted.fontSize = 32; submitted.fontWeight = 900;
        submitted.fontStyle = 'italic'; submitted.fontAxes.wght = 900; submitted.fontAxes.opsz = 32;
        submitted.fontFeatures.kern = 0; throw error;
      }
    }
    const earlier = pinned('O', original);
    const later = pinned('O', { ...submitted, fontFamily: record.family, fontStyle: 'normal' });
    return { earlier, later };
  }, h.options);
  assert.equal(result.earlier.glyphs[0].id, 400); assert.equal(result.earlier.glyphs[0].path, 'M14 1L500 0L500 700Z');
  assert.equal(result.later.glyphs[0].id, 900); assert.equal(result.later.glyphs[0].path, 'M32 0L500 0L500 700Z');
  assert.deepEqual(h.state.calls[0].style, { ...original, fontStyle: 'normal' });
  assert.equal(h.state.calls.length, 2); assert.equal(h.state.closed, 1);
});

test('queued metric styles snapshot axes and font size before the asynchronous empty-text query', async () => {
  const submitted = { ...style, fontAxes: { wght: 400 } }; const original = structuredClone(submitted); let first = true;
  const h = fakeOptions(async (_, captured) => ({ ...shape(''), primaryFontMetrics: {
    ...structuredClone(metrics), extents: { ...metrics.extents, ascender: 800 + captured.fontSize + captured.fontAxes.wght }
  } }));
  const result = await withPreparedVectorPdfText(pinned => {
    if (first) {
      first = false;
      try { pinned.fontMetrics(submitted); }
      catch (error) {
        assert.equal(error.code, 'TEXT_LINE_METRICS_PENDING');
        submitted.fontSize = 32; submitted.fontAxes.wght = 900; throw error;
      }
    }
    return pinned.fontMetrics(original);
  }, h.options);
  assert.equal(result.extents.ascender, 1214); assert.equal(h.state.calls[0].text, '');
  assert.equal(h.state.calls[0].style.fontSize, 14); assert.deepEqual(h.state.calls[0].style.fontAxes, { wght: 400 });
  assert.equal(h.state.closed, 1);
});

test('invalid or excessive shaping maps reject before a font session is opened', async () => {
  const h = fakeOptions();
  for (const fields of [{ fontAxes: { wght: Infinity } }, { fontFeatures: { kern: -1 } },
    { fontAxes: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`x${String(index).padStart(3, '0')}`, 1])) },
    { fontFeatures: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`x${String(index).padStart(3, '0')}`, 1])) }]) {
    await assert.rejects(withPreparedVectorPdfText(pinned => pinned('O', { ...style, ...fields }), h.options), /invalid shaping style/);
  }
  assert.equal(h.state.created, 0);
});

test('an escaped prepared shaper cannot reopen local fonts after its operation finishes', async () => {
  const h = fakeOptions(); const pinned = await withPreparedVectorPdfText(value => { value('O', style); return value; }, h.options);
  assert.throws(() => pinned('O', style), error => error.name === 'AbortError');
  assert.throws(() => pinned.fontMetrics(style), error => error.name === 'AbortError');
  assert.equal(h.state.created, 1); assert.equal(h.state.closed, 1);
});

test('font line metrics use an empty native query and pin declared primary metrics independently of display glyphs', async () => {
  const h = fakeOptions(async text => ({ ...shape(text), upem: 2000, extents: { ascender: 1500, descender: -500, lineGap: 50 } }));
  const output = await withPreparedVectorPdfText(pinned => {
    const first = pinned.fontMetrics(style, 'ignored display sample'); first.extents.ascender = 0;
    return pinned.fontMetrics({ ...style, baselineShift: 2, fontFeatures: { kern: 0 } });
  }, h.options);
  assert.deepEqual(output, metrics); assert.deepEqual(h.state.calls.map(call => call.text), ['']);
  assert.equal(h.state.closed, 1);
});

test('font catalog snapshots are frozen, contain metadata only, and preserve the selected axes', async () => {
  const supplied = [{ ...structuredClone(record), bytes: new Uint8Array(1024) }];
  const h = fakeOptions(async text => shape(text), { fonts: supplied });
  await withPreparedVectorPdfText(pinned => {
    const result = pinned('O', style);
    assert.equal(Object.isFrozen(h.state.settings.fonts[0]), true);
    assert.equal(Object.isFrozen(h.state.settings.fonts[0].axes), true);
    assert.equal(Object.hasOwn(h.state.settings.fonts[0], 'bytes'), false);
    assert.notEqual(h.state.settings.fonts[0], supplied[0]);
    assert.deepEqual(h.state.settings.fonts[0].axes, record.axes);
    return result;
  }, h.options);
  assert.deepEqual(supplied[0].bytes, new Uint8Array(1024));
});

test('configured local font failures retain their error and never publish a browser fallback', async () => {
  const failure = Object.assign(new Error('font file is corrupt'), { code: 'CORRUPT_LOCAL_FONT' });
  const h = fakeOptions(async () => { throw failure; }); let published = false;
  await assert.rejects(withPreparedVectorPdfText(pinned => {
    const result = pinned('O', style); published = true; return result;
  }, h.options), error => error === failure);
  assert.equal(published, false); assert.equal(h.state.created, 1); assert.equal(h.state.closed, 1);
});

test('completed asynchronous PDF generation is revalidated before publishing and unexpected generator errors do not retry', async () => {
  let current = true; const h = fakeOptions(async text => shape(text), { assertCurrent: () => current });
  await assert.rejects(withPreparedVectorPdfText(async pinned => {
    pinned('O', style); await Promise.resolve(); current = false; return new Uint8Array([1, 2, 3]);
  }, h.options), /fonts changed/);
  assert.equal(h.state.closed, 1);
  let attempts = 0; const unused = fakeOptions(); const error = Object.assign(new Error('invalid PDF graph'), { code: 'PDF_GRAPH_INVALID' });
  await assert.rejects(withPreparedVectorPdfText(() => { attempts++; throw error; }, unused.options), failure => failure === error);
  assert.equal(attempts, 1); assert.equal(unused.state.created, 0);
});

test('cancellation and a stale source/font/workspace guard fence publication and close the owned session', async () => {
  const gate = deferred(); const entered = deferred(); const controller = new AbortController();
  const h = fakeOptions(async () => { entered.resolve(); return gate.promise; }, { signal: controller.signal });
  const work = withPreparedVectorPdfText(pinned => pinned('O', style), h.options);
  await entered.promise; controller.abort();
  await assert.rejects(work, error => error.name === 'AbortError');
  assert.equal(h.state.closed, 1); gate.resolve(shape('O')); await new Promise(resolve => setImmediate(resolve));

  let current = true;
  const stale = fakeOptions(async text => { current = false; return shape(text); }, { assertCurrent: () => current });
  await assert.rejects(withPreparedVectorPdfText(pinned => pinned('O', style), stale.options), /fonts changed/);
  assert.equal(stale.state.closed, 1);
  const preaborted = new AbortController(); preaborted.abort(); const untouched = fakeOptions();
  await assert.rejects(withPreparedVectorPdfText(() => { throw new Error('must not run'); }, { ...untouched.options, signal: preaborted.signal }), error => error.name === 'AbortError');
  assert.equal(untouched.state.created, 0);
});

test('asynchronous generators cannot publish after cancellation or retain a running native session beyond the deadline', async () => {
  const h = fakeOptions(); const controller = new AbortController(); let entered = false;
  const work = withPreparedVectorPdfText(async pinned => {
    pinned('O', style); entered = true; return new Promise(() => {});
  }, { ...h.options, signal: controller.signal });
  while (!entered) await new Promise(resolve => setTimeout(resolve, 1));
  controller.abort(); await assert.rejects(work, error => error.name === 'AbortError'); assert.equal(h.state.closed, 1);
  const slow = fakeOptions(() => new Promise(() => {}));
  await assert.rejects(withPreparedVectorPdfText(pinned => pinned('O', style), { ...slow.options, deadlineMs: 10 }),
    error => error.code === 'VECTOR_PDF_TEXT_TIMEOUT');
  assert.equal(slow.state.closed, 1);
});

test('native handoffs admit at most eight pending requests and shaping snapshots keep the existing byte/query limits', async () => {
  const entered = deferred(); let pending = 0; const h = fakeOptions(() => { if (++pending === 8) entered.resolve(); return new Promise(() => {}); });
  await assert.rejects(withPreparedVectorPdfText(async pinned => {
    for (let index = 0; index < 8; index++) try { pinned(String(index), style); } catch (error) { assert.equal(error.code, 'TEXT_POSITION_PENDING'); }
    await entered.promise; return pinned('overflow', style);
  }, h.options), /queue is full/);
  assert.equal(pending, 8); assert.equal(h.state.closed, 1);
  const limited = fakeOptions();
  await assert.rejects(withPreparedVectorPdfText(pinned => { pinned('A', style); return pinned('B', style); }, { ...limited.options, maxQueries: 1 }), /snapshot budget/);
  assert.equal(limited.state.closed, 1);
  const oversized = fakeOptions(async text => ({ ...shape(text), glyphs: [{ ...shape(text).glyphs[0], path: 'M'.repeat(5000) }] }));
  await assert.rejects(withPreparedVectorPdfText(pinned => pinned('O', style), { ...oversized.options, maxBytes: 1024 }), /snapshot budget/);
  assert.equal(oversized.state.closed, 1);
});

test('invalid metadata and unbounded options reject before creating workers or calling the generator', async () => {
  const h = fakeOptions(); let generated = false;
  for (const options of [{ maxQueries: VECTOR_PDF_TEXT_LIMITS.maxQueries + 1 }, { maxBytes: VECTOR_PDF_TEXT_LIMITS.maxBytes + 1 },
    { deadlineMs: 60_001 }, { fonts: [record, record] }, { fonts: [{ ...record, axes: [{ tag: 'wght', min: 900, max: 100, defaultValue: 400 }] }] }]) {
    await assert.rejects(withPreparedVectorPdfText(() => { generated = true; }, { ...h.options, ...options }), /invalid|duplicate|options/);
  }
  assert.equal(generated, false); assert.equal(h.state.created, 0);
});

function workerFactory(bundleName, lifecycle) {
  const url = new URL(`../src/workers/${bundleName}`, import.meta.url).href;
  return () => {
    const worker = new NodeWorker(`
      const {parentPort}=require('node:worker_threads'); const {readFile}=require('node:fs/promises');
      globalThis.self={location:{href:${JSON.stringify(url)}},addEventListener(type,callback){if(type==='message')parentPort.on('message',data=>callback({data}));},postMessage:(value,transfers)=>parentPort.postMessage(value,transfers)};
      globalThis.fetch=async value=>{const target=new URL(String(value));if(target.protocol!=='file:')throw new Error('Non-local font request');return new Response(await readFile(target));};
      import(${JSON.stringify(url)}).catch(error=>{throw error;});
    `, { eval: true });
    const entry = { bundleName, messages: [], closed: 0, exit: new Promise(resolve => worker.once('exit', resolve)) }; lifecycle.push(entry);
    return { postMessage(message, transfers) { entry.messages.push(message.type || 'decode'); worker.postMessage(message, transfers); },
      terminate() { entry.closed++; return worker.terminate(); },
      addEventListener(type, callback) {
        if (type === 'message') worker.on('message', data => callback({ data }));
        else if (type === 'error') worker.on('error', callback);
        else if (type === 'messageerror') worker.on('messageerror', callback);
      } };
  };
}
async function nativeOptions(t) {
  const bytes = new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url)));
  const original = bytes.slice(); const lifecycle = []; let reads = 0; let sessions = 0;
  const options = { fonts: [record], readFont: async id => { assert.equal(id, record.id); reads++; return { ...record, bytes }; },
    sessionFactory: options => {
      sessions++;
      return new TextOutlineFontSession({ ...options,
        shaper: new LocalFontShapingClient({ workerFactory: workerFactory('font-shaping-worker.bundle.js', lifecycle), maxCacheBytes: 0, maxCacheEntries: 0 }),
        decoder: new LocalWoff2Decoder({ workerFactory: workerFactory('woff2-decompress-worker.bundle.js', lifecycle), idleShutdownMs: 0 }),
        requestTimeoutMs: 10_000 });
    } };
  t.after(async () => {
    let timer;
    try { await Promise.race([Promise.all(lifecycle.map(entry => entry.exit)), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PDF font workers did not stop.')), 10_000); })]); }
    finally { clearTimeout(timer); }
    assert.ok(lifecycle.every(entry => entry.closed === 1)); assert.deepEqual(bytes, original);
  });
  return { options, lifecycle, get reads() { return reads; }, get sessions() { return sessions; } };
}

test('actual production WOFF2/HarfBuzz workers prepare combining contours, font variations/features, and primary metrics for vector PDF', { timeout: 30_000 }, async t => {
  const h = await nativeOptions(t); let attempts = 0;
  const result = await withPreparedVectorPdfText(pinned => {
    attempts++;
    const marked = pinned('q\u0301O', style); const regular = pinned('ToWa', style);
    const heavy = pinned('ToWa', { ...style, fontWeight: 850 });
    const optical = pinned('ToWa', { ...style, fontSize: 32 });
    const unkerned = pinned('ToWa', { ...style, fontFeatures: { kern: 0 } });
    const line = pinned.fontMetrics({ ...style, fontSize: 32 });
    return { marked, regular, heavy, optical, unkerned, line };
  }, h.options);
  assert.ok(attempts > 1); assert.equal(result.marked.upem, 2048);
  assert.equal(result.marked.glyphs.length, 3); assert.deepEqual(result.marked.glyphs.map(g => g.cluster), [0, 0, 2]);
  assert.equal(result.marked.glyphs[1].xAdvance, 0); assert.ok(result.marked.glyphs[0].path.includes('Q'));
  assert.notEqual(result.heavy.glyphs[0].path, result.regular.glyphs[0].path);
  const advance = value => value.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0);
  assert.notEqual(advance(result.optical), advance(result.regular)); assert.notEqual(advance(result.unkerned), advance(result.regular));
  assert.equal(result.line.upem, 2048); assert.ok(result.line.leadingTrimMetrics.capHeight > 0);
  assert.ok(result.line.extents.ascender > 0); assert.ok(result.line.extents.descender < 0);
  assert.equal(h.sessions, 1); assert.equal(h.reads, 1);
  assert.deepEqual(h.lifecycle.map(entry => entry.bundleName).sort(), ['font-shaping-worker.bundle.js', 'woff2-decompress-worker.bundle.js']);
});

test('actual retained-font missing coverage rejects vector PDF preparation without fallback or leaked workers', { timeout: 30_000 }, async t => {
  const h = await nativeOptions(t); let published = false;
  await assert.rejects(withPreparedVectorPdfText(pinned => {
    const result = pinned('مرحبا', style); published = true; return result;
  }, h.options), /browser fallback/);
  assert.equal(published, false); assert.equal(h.sessions, 1); assert.equal(h.reads, 1);
});

test('missing font files and invalid real font headers never fabricate vector PDF glyph coverage', { timeout: 30_000 }, async t => {
  for (const corrupt of [false, true]) {
    const h = await nativeOptions(t); const reader = h.options.readFont; let published = false;
    h.options.readFont = async id => {
      const saved = await reader(id); return corrupt ? { ...saved, bytes: new Uint8Array(64) } : null;
    };
    await assert.rejects(withPreparedVectorPdfText(pinned => {
      const value = pinned('O', style); published = true; return value;
    }, h.options), corrupt ? /TrueType|OpenType|WOFF/ : /font file/);
    assert.equal(published, false); assert.equal(h.sessions, 1); assert.equal(h.reads, 1);
    assert.equal(h.lifecycle.length, 0, 'invalid input cannot reach native parsing or glyph coverage');
  }
});
