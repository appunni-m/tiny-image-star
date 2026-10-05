import test from 'node:test';
import assert from 'node:assert/strict';
import { TextOutlineFontSession } from '../src/text-outline-font-session.js';
import { localFontsForStyle, localFontAxisValues } from '../src/local-font-style.js';

const font = (id, family = id, extra = {}) => ({ id, family, name: `${id}.ttf`, weight: 400, style: 'normal', type: 'font/ttf', ...extra });
const bytes = value => Uint8Array.from([0, 1, 0, 0, value, 0, 0, 0, 0, 0, 0, 0]);

function harness(fonts, options = {}) {
  const files = new Map(fonts.map((record, index) => [record.id, { ...record, bytes: bytes(index + 1) }]));
  const reads = []; const loads = []; const requests = []; const resident = new Map();
  let closed = 0; let decoderClosed = 0;
  const shaper = {
    hasFont: id => resident.has(id),
    loadFont: async (id, input) => {
      loads.push({ id, bytes: input.slice() });
      if (resident.size >= 4 && !resident.has(id)) resident.delete(resident.keys().next().value);
      const coverage = options.coverage?.get(id) || Array.from({ length: 128 }, (_, index) => index);
      resident.set(id, input.slice());
      return { coverage };
    },
    shape: async (id, request) => {
      assert.ok(resident.has(id)); requests.push({ id, request });
      return { upem: 1000, extents: { ascender: 800 }, glyphs: [{ id: resident.get(id)[4], path: 'M0,0L1,0L1,1Z', cluster: 0, xAdvance: 500 }], missingGlyph: options.missingGlyph === true };
    },
    close: () => { closed += 1; resident.clear(); }
  };
  const session = new TextOutlineFontSession({ fonts, shaper, decoder: { close: () => { decoderClosed += 1; } },
    readFont: async id => { reads.push(id); return files.get(id); }, ...options.sessionOptions });
  return { session, files, reads, loads, requests, get closed() { return closed; }, get decoderClosed() { return decoderClosed; } };
}

test('preview and outlining share family order, closest faces and variable-axis coordinates', () => {
  const variable = font('variable', 'Family, One', { axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }, { tag: 'opsz', min: 8, max: 80, defaultValue: 14 }] });
  const regular = font('regular', 'Family, One', { weight: 400 });
  const italic = font('italic', 'Family, One', { weight: 500, style: 'italic' });
  const fallback = font('fallback', 'Other');
  assert.deepEqual(localFontsForStyle({ fontFamily: '"Family, One", Other, "Family, One"', fontWeight: 760 }, [regular, variable, italic, fallback]), [variable, fallback]);
  assert.deepEqual(localFontsForStyle({ fontFamily: '"Family, One"', fontWeight: 500, fontStyle: 'italic' }, [regular, variable, italic]), [italic]);
  assert.deepEqual(localFontAxisValues(variable, { fontWeight: 760, fontSize: 110, fontAxes: { wght: 950 } }), { wght: 900, opsz: 80 });
});

test('explicit wght selects the same retained face before and after layout normalizes fontWeight', () => {
  const regular = font('regular', 'Local', { weight: 400 });
  const bold = font('bold', 'Local', { weight: 700 });
  const authored = { fontFamily: 'Local', fontWeight: 400, fontAxes: { wght: 700 } };
  assert.deepEqual(localFontsForStyle(authored, [regular, bold]), [bold]);
  assert.deepEqual(localFontsForStyle({ ...authored, fontWeight: 700 }, [regular, bold]), [bold]);
});

test('conversion shapes real font requests after loading coverage and preserves axes, features and script', async t => {
  const record = font('variable', 'Local', { axes: [{ tag: 'wght', min: 100, max: 900, defaultValue: 400 }] });
  const h = harness([record]); t.after(() => h.session.close());
  const result = await h.session.shapeText('office', { fontFamily: 'Local', fontWeight: 650, fontFeatures: { liga: 1, kern: 0 } });
  assert.equal(result.glyphs[0].id, 1);
  assert.deepEqual(h.reads, ['variable']);
  assert.deepEqual(h.requests[0], { id: 'variable', request: { text: 'office', variations: { wght: 650 }, features: { liga: 1, kern: 0 }, script: 'Latn' } });
});

test('mixed script fallback uses locally covered fonts and refuses a browser fallback', async t => {
  const h = harness([font('latin', 'Latin'), font('arabic', 'Arabic')], { coverage: new Map([['latin', [32, 65]], ['arabic', [0x627]]]) });
  t.after(() => h.session.close());
  const result = await h.session.shapeText('Aا', { fontFamily: 'Latin, Arabic' });
  assert.deepEqual(result.mixedRuns.map(run => run.text), ['A', 'ا']);
  assert.deepEqual(h.requests.map(request => [request.id, request.request.script]), [['latin', 'Latn'], ['arabic', 'Arab']]);
  await assert.rejects(h.session.shapeText('A字', { fontFamily: 'Latin, Arabic' }), /browser fallback/);
  assert.equal(h.requests.length, 2, 'a partial result is never accepted for missing local glyphs');
});

test('evicted fonts reload pinned bytes without reading a changed source file', async t => {
  const records = Array.from({ length: 5 }, (_, index) => font(`font-${index}`));
  const h = harness(records); t.after(() => h.session.close());
  for (const record of records) await h.session.shapeText('A', { fontFamily: record.family });
  h.files.get(records[0].id).bytes[4] = 99;
  const result = await h.session.shapeText('A', { fontFamily: records[0].family });
  assert.equal(result.glyphs[0].id, 1);
  assert.deepEqual(h.reads, records.map(record => record.id));
  assert.equal(h.loads.length, 6);
});

test('font snapshot metadata, missing glyphs and stale design state reject before accepting contours', async () => {
  const h = harness([font('font')]);
  h.files.get('font').family = 'Changed';
  await assert.rejects(h.session.shapeText('A', { fontFamily: 'font' }), /fonts changed/);
  assert.equal(h.loads.length, 0); h.session.close();
  const missing = harness([font('font')], { missingGlyph: true });
  await assert.rejects(missing.session.shapeText('A', { fontFamily: 'font' }), /cannot outline every character/);
  missing.session.close();
  let current = true;
  const stale = harness([font('font')], { sessionOptions: { assertCurrent: () => current } });
  await stale.session.shapeText('A', { fontFamily: 'font' }); current = false;
  await assert.rejects(stale.session.shapeText('B', { fontFamily: 'font' }), /fonts changed/);
  assert.equal(stale.requests.length, 1); stale.session.close();
});

test('abort closes owned workers while a file read is pending and late data cannot shape', async () => {
  const controller = new AbortController(); let finishRead;
  const record = font('font');
  const h = harness([record], { sessionOptions: { signal: controller.signal, readFont: () => new Promise(resolve => { finishRead = resolve; }) } });
  const pending = h.session.shapeText('A', { fontFamily: 'font' });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  finishRead({ ...record, bytes: bytes(1) }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.loads.length, 0); assert.equal(h.requests.length, 0);
  assert.equal(h.closed, 1); assert.equal(h.decoderClosed, 1);
});

test('a nonresponding font read has a deadline and closes both owned workers', async () => {
  const h = harness([font('font')], { sessionOptions: { requestTimeoutMs: 10, readFont: () => new Promise(() => {}) } });
  await assert.rejects(h.session.shapeText('A', { fontFamily: 'font' }), /font loading took too long/);
  assert.equal(h.closed, 1); assert.equal(h.decoderClosed, 1);
});

test('the shaping queue is bounded and closing drains queued requests and a pending file read', async () => {
  const h = harness([font('font')], { sessionOptions: { readFont: () => new Promise(() => {}) } });
  const pending = Array.from({ length: 8 }, () => h.session.shapeText('A', { fontFamily: 'font' }));
  const results = Promise.allSettled(pending);
  await assert.rejects(h.session.shapeText('A', { fontFamily: 'font' }), /queue is full/);
  await new Promise(resolve => setImmediate(resolve)); h.session.close();
  const settled = await results;
  assert.ok(settled.every(result => result.status === 'rejected' && /session is closed/.test(result.reason.message)));
  assert.equal(h.closed, 1); assert.equal(h.decoderClosed, 1);
});
