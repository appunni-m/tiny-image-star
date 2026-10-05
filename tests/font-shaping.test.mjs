import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LocalFontShapingClient, MAX_LOCAL_SHAPING_FONT_BYTES, fontShapeCacheKey } from '../src/font-shaping.js';
import { zlibSync } from 'fflate';
import decompress from 'woff2-encoder/decompress';

const fixtureUrl = new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url);

async function shapingHarness() {
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  let receiveMessage;
  let activeWorker = null;
  const workerScope = {
    addEventListener(type, listener) { if (type === 'message') receiveMessage = listener; },
    postMessage(data) { activeWorker?.dispatch('message', { data }); }
  };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: workerScope });
  const workerUrl = new URL('../src/workers/font-shaping-worker.bundle.js', import.meta.url);
  await import(`${workerUrl.href}?font-shaping-test=${Date.now()}`);

  class BundledWorkerHarness {
    #listeners = new Map();
    addEventListener(type, listener) { this.#listeners.set(type, listener); }
    postMessage(message) {
      activeWorker = this;
      queueMicrotask(() => receiveMessage({ data: message }));
    }
    dispatch(type, event) { this.#listeners.get(type)?.(event); }
    terminate() {}
  }

  const client = new LocalFontShapingClient({ workerFactory: () => new BundledWorkerHarness() });
  return {
    client,
    async restore() {
      client.close();
      if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
      else delete globalThis.self;
    }
  };
}

function padded(value) { return (value + 3) & ~3; }

function createWoff1(sfnt) {
  const sourceView = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const tableCount = sourceView.getUint16(4, false);
  const tables = [];
  let totalSfntSize = 12 + tableCount * 16;
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    const offset = sourceView.getUint32(record + 8, false);
    const length = sourceView.getUint32(record + 12, false);
    const bytes = sfnt.subarray(offset, offset + length);
    const compressed = zlibSync(bytes);
    const packed = compressed.byteLength < bytes.byteLength ? compressed : bytes.slice();
    tables.push({
      tag: sfnt.slice(record, record + 4), offset: 0, checksum: sourceView.getUint32(record + 4, false),
      originalLength: length, bytes: packed
    });
    totalSfntSize += padded(length);
  }
  let cursor = 44 + tableCount * 20;
  for (const table of tables) { table.offset = cursor; cursor += padded(table.bytes.byteLength); }
  const woff = new Uint8Array(cursor);
  const view = new DataView(woff.buffer);
  view.setUint32(0, 0x774f4646, false);
  view.setUint32(4, sourceView.getUint32(0, false), false);
  view.setUint32(8, woff.byteLength, false);
  view.setUint16(12, tableCount, false);
  view.setUint32(16, totalSfntSize, false);
  view.setUint16(20, 1, false);
  for (const [index, table] of tables.entries()) {
    const record = 44 + index * 20;
    woff.set(table.tag, record);
    view.setUint32(record + 4, table.offset, false);
    view.setUint32(record + 8, table.bytes.byteLength, false);
    view.setUint32(record + 12, table.originalLength, false);
    view.setUint32(record + 16, table.checksum, false);
    woff.set(table.bytes, table.offset);
  }
  return woff;
}

test('the pinned local HarfBuzz worker shapes variable axes and OpenType features from retained font bytes', async () => {
  const harness = await shapingHarness();
  try {
    const source = new Uint8Array(await readFile(fixtureUrl));
    const sourceCopy = source.slice();
    const sfnt = await decompress(source);
    const loaded = await harness.client.loadFont('inter-variable', sfnt);
    assert.equal(loaded.upem, 2048);
    assert.deepEqual(Object.keys(loaded.axes).sort(), ['opsz', 'wght']);
    assert.ok(loaded.coverage instanceof Uint32Array);
    assert.ok(loaded.coverage.includes('A'.codePointAt(0)), 'the worker reports local cmap coverage for fallback itemization');
    assert.equal(loaded.coverage.includes('م'.codePointAt(0)), false, 'the Latin fixture does not claim Arabic coverage');
    assert.ok(loaded.gposFeatures.includes('kern'));

    const base = await harness.client.shape('inter-variable', {
      text: 'ToWa', variations: { opsz: 14, wght: 400 }
    });
    const largerOpticalSize = await harness.client.shape('inter-variable', {
      text: 'ToWa', variations: { wght: 400, opsz: 32 }
    });
    const kerningDisabled = await harness.client.shape('inter-variable', {
      text: 'ToWa', variations: { opsz: 14, wght: 400 }, features: { kern: 0 }
    });
    const missingGlyph = await harness.client.shape('inter-variable', { text: 'مرحبا' });
    const advance = result => result.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0);
    assert.notEqual(advance(base), advance(largerOpticalSize), 'opsz must change real font outline advances');
    assert.notEqual(advance(base), advance(kerningDisabled), 'OpenType kern=0 must affect real glyph placement');
    assert.ok(base.glyphs.every(glyph => typeof glyph.path === 'string' && Number.isFinite(glyph.xAdvance)));
    assert.equal(missingGlyph.missingGlyph, true, 'unsupported text must request the browser fallback instead of drawing .notdef glyphs');
    assert.equal(missingGlyph.glyphs.length, 0);
    assert.deepEqual(base.positionMetrics.superscript, { xSize: 1331, ySize: 1229, xOffset: 0, yOffset: 717 });
    assert.deepEqual(base.positionMetrics.subscript, { xSize: 1331, ySize: 1229, xOffset: 0, yOffset: 154 });
    base.positionMetrics.superscript.ySize = -1;
    assert.equal(harness.client.get('inter-variable', { text: 'ToWa', variations: { wght: 400, opsz: 14 } }).positionMetrics.superscript.ySize, 1229,
      'worker metrics are cloned at the public cache boundary');
    base.positionMetrics.superscript.ySize = 1229;

    const woff = createWoff1(new Uint8Array(sfnt));
    const woffFont = await harness.client.loadFont('inter-variable-woff', woff);
    const woffShape = await harness.client.shape('inter-variable-woff', {
      text: 'ToWa', variations: { opsz: 14, wght: 400 }
    });
    assert.equal(woffFont.upem, 2048, 'the local worker should decode WOFF 1 tables into an SFNT font');
    assert.equal(woffShape.glyphs.length, 4);
    const overlappingWoff = woff.slice();
    new DataView(overlappingWoff.buffer).setUint32(48, 44, false);
    await assert.rejects(harness.client.loadFont('overlapping-woff', overlappingWoff), /invalid offset/i,
      'malformed table ranges are rejected before decompression or shaping');
    assert.deepEqual(harness.client.get('inter-variable', { text: 'ToWa', variations: { wght: 400, opsz: 14 } }), base,
      'the main-thread cache key must be independent of axis-property order');
    assert.deepEqual(source, sourceCopy, 'local shaping must not mutate the retained WOFF2 source bytes');
    assert.equal(await harness.client.releaseFont('inter-variable'), true);
    assert.equal(harness.client.get('inter-variable', { text: 'ToWa', variations: { wght: 400, opsz: 14 } }), null);
    await assert.rejects(harness.client.shape('inter-variable', { text: 'ToWa' }), /no longer available/i);
  } finally { await harness.restore(); }
});

test('local font shaping rejects oversized inputs before worker creation and canonicalizes axis maps', async () => {
  let created = false;
  const client = new LocalFontShapingClient({ workerFactory: () => { created = true; throw new Error('unexpected worker'); } });
  try {
    await assert.rejects(client.loadFont('too-large', new Uint8Array(MAX_LOCAL_SHAPING_FONT_BYTES + 1)), /preview limits/i);
    await assert.rejects(client.shape('font', { text: 'x'.repeat(32_769) }), /text.*limits/i);
    assert.equal(created, false);
  } finally { client.close(); }
  assert.equal(fontShapeCacheKey({ fontId: 'a', text: 'x', variations: { wght: 400, opsz: 14 } }),
    fontShapeCacheKey({ fontId: 'a', text: 'x', variations: { opsz: 14, wght: 400 } }));
});

test('releasing a font fences an in-flight worker load from restoring stale bytes', async () => {
  const harness = await shapingHarness();
  try {
    const source = new Uint8Array(await readFile(fixtureUrl));
    const sfnt = await decompress(source);
    const loading = harness.client.loadFont('release-race', sfnt);
    const releasing = harness.client.releaseFont('release-race');
    await assert.rejects(loading, /released during loading/i);
    assert.equal(await releasing, true, 'the worker removes the font already queued before the release');
    assert.equal(harness.client.hasFont('release-race'), false,
      'a late load response cannot repopulate the released-font cache');
  } finally { await harness.restore(); }
});
