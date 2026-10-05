import test from 'node:test';
import assert from 'node:assert/strict';
import { withPreparedTextPositionShapes } from '../src/text-position-export-preparation.js';
import { createNode } from '../src/model.js';
import { exportNodeToSvg } from '../src/svg-export.js';

const style = { fontFamily: 'Local', fontSize: 20, fontWeight: 400 };
const shape = (text, options = {}) => ({ upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 },
  glyphs: [...text].map((character, cluster) => ({ id: character.codePointAt(0) + (options.fontFeatures?.sups ? 1000 : 0), cluster,
    xAdvance: 600, yAdvance: 0, xOffset: 0, yOffset: 0, path: 'M0 0L500 0L500 700L0 700Z' })) });

test('cold-font SVG preparation retries actual wrapping queries and matches a warm export without changing authored source', async () => {
  const ready = new Map(); const queued = new Set(); let attempts = 0;
  const cold = (text, options) => {
    const key = JSON.stringify([text, options.fontFeatures || {}]);
    if (ready.has(key)) return ready.get(key);
    if (!queued.has(key)) { queued.add(key); setTimeout(() => ready.set(key, shape(text, options)), 1); }
    return null;
  };
  cold.fontStatus = () => 'ready';
  const node = createNode('text', { text: '1 2 3', textPosition: 'superscript', ...style, width: 18, height: 100, stroke: null });
  const authored = structuredClone(node);
  const measure = (text, options) => text.length * options.fontSize * .6;
  const actual = await withPreparedTextPositionShapes(pinned => {
    attempts++;
    const measuring = (...args) => measure(...args); measuring.shapeText = pinned;
    return exportNodeToSvg(node, { measureText: measuring });
  }, { shapeText: cold, pollMs: 1, deadlineMs: 1000 });
  const warm = (...args) => measure(...args); warm.shapeText = shape;
  assert.equal(actual, exportNodeToSvg(node, { measureText: warm }));
  assert.ok(attempts > 2); assert.ok([...queued].some(key => !key.includes('1 2 3')));
  assert.deepEqual(node, authored);
});

test('pinned answers survive preview LRU eviction and exported result mutation', async () => {
  const calls = [];
  const evicting = (text, options) => { calls.push(text); return shape(text, options); };
  evicting.fontStatus = () => 'ready';
  const output = await withPreparedTextPositionShapes(pinned => {
    const first = pinned('1', style); first.glyphs[0].path = 'corrupted';
    pinned('2', style);
    return pinned('1', style);
  }, { shapeText: evicting });
  assert.deepEqual(calls, ['1', '2']); assert.equal(output.glyphs[0].path, 'M0 0L500 0L500 700L0 700Z');
});

test('shaping keys canonicalize maps and variable weight, retain optical font size, and ignore manual baseline shifts', async () => {
  let calls = 0;
  const shaper = (text, options) => { calls++; return shape(text, options); };
  await withPreparedTextPositionShapes(pinned => {
    pinned('1', { ...style, fontAxes: { wght: 600, wdth: 90 }, fontFeatures: { kern: 0, sups: 1 } });
    pinned('1', { ...style, baselineShift: 9, fontWeight: 600, fontAxes: { wdth: 90, wght: 600 }, fontFeatures: { sups: 1, kern: 0 } });
    pinned('1', { ...style, fontSize: 40, fontAxes: { wght: 600, wdth: 90 }, fontFeatures: { kern: 0, sups: 1 } });
    pinned('1', { ...style, fontFeatures: { subs: 1 } });
  }, { shapeText: shaper });
  assert.equal(calls, 3, 'font size can change the automatic opsz variation and must remain in the native shape key');
});

test('known-ready snapshots survive worker font eviction between generator retries', async () => {
  let attempt = 0; let evicted = false;
  const shaper = (text, options) => { if (text === '2' && !evicted) { evicted = true; return null; } return shape(text, options); };
  shaper.fontStatus = () => evicted ? 'pending' : 'ready';
  const result = await withPreparedTextPositionShapes(pinned => {
    attempt++;
    pinned('1', style); pinned('2', style);
    assert.equal(pinned.fontStatus(style, '1'), 'ready');
    return 'done';
  }, { shapeText: shaper, pollMs: 1, deadlineMs: 1000 });
  assert.equal(result, 'done'); assert.equal(attempt, 2);
});

test('genuine uncovered browser fallback stays available, while normal documents bypass new limits', async () => {
  const fallback = () => null; fallback.fontStatus = () => 'none';
  assert.equal(await withPreparedTextPositionShapes(pinned => pinned('missing', style), { shapeText: fallback }), null);
  const unchanged = () => ({ large: 'x'.repeat(1000) });
  assert.equal(await withPreparedTextPositionShapes(pinned => pinned('old document', style).large.length,
    { shapeText: unchanged, enabled: false, maxBytes: 1 }), 1000);
});

test('local preparation failures and stale source fences stop before publication', async () => {
  let available = true; let attempts = 0;
  const unavailable = () => { available = false; return null; };
  unavailable.fontStatus = () => available ? 'pending' : 'none';
  await assert.rejects(withPreparedTextPositionShapes(pinned => { pinned.fontStatus(style, '1'); return pinned('1', style); },
    { shapeText: unavailable }), /became unavailable/u);
  const cold = () => null; cold.fontStatus = () => 'pending';
  await assert.rejects(withPreparedTextPositionShapes(pinned => { attempts++; return pinned('1', style); }, {
    shapeText: cold, pollMs: 1, assertCurrent: () => { if (attempts) throw new Error('source changed'); }
  }), /source changed/u);
  assert.equal(attempts, 1);
});

test('pending fonts have a bounded timeout and cancel promptly', async () => {
  const cold = () => null; cold.fontStatus = () => 'pending';
  await assert.rejects(withPreparedTextPositionShapes(pinned => pinned('1', style),
    { shapeText: cold, deadlineMs: 5, pollMs: 1 }), /could not finish preparing/u);
  const controller = new AbortController();
  const work = withPreparedTextPositionShapes(pinned => { const result = pinned('1', style); return result; },
    { shapeText: cold, signal: controller.signal });
  controller.abort();
  await assert.rejects(work, error => error.name === 'AbortError');
});

test('snapshot budgets include query text and contours before copying results', async () => {
  await assert.rejects(withPreparedTextPositionShapes(pinned => pinned('x'.repeat(100), style),
    { shapeText: shape, maxBytes: 100 }), /bounded shaping snapshot/u);
  await assert.rejects(withPreparedTextPositionShapes(pinned => { pinned('1', style); return pinned('2', style); },
    { shapeText: shape, maxQueries: 1 }), /bounded shaping snapshot/u);
  const huge = (text, options) => { const result = shape(text, options); result.glyphs[0].path = 'M'.repeat(2000); return result; };
  await assert.rejects(withPreparedTextPositionShapes(pinned => pinned('1', style),
    { shapeText: huge, maxBytes: 1000 }), /bounded glyph snapshot/u);
});

test('unexpected generator failures never enter the font retry loop', async () => {
  let attempts = 0;
  await assert.rejects(withPreparedTextPositionShapes(() => { attempts++; throw new Error('invalid SVG paint'); },
    { shapeText: shape }), /invalid SVG paint/u);
  assert.equal(attempts, 1);
});

test('asynchronous cold-trim export retries actual layout and retains a pinned metric snapshot', async () => {
  const ready = new Map(); const queued = new Set(); let attempts = 0;
  const metricShape = (text, options) => ({ ...shape(text, options), leadingTrimMetrics: { capHeight: 700 } });
  const cold = (text, options) => {
    const key = JSON.stringify([text, options.fontSize, options.fontFeatures || {}]);
    if (ready.has(key)) return ready.get(key);
    if (!queued.has(key)) { queued.add(key); setTimeout(() => ready.set(key, metricShape(text, options)), 1); }
    return null;
  };
  cold.fontStatus = () => 'ready';
  const node = createNode('text', { text: 'H2\nHp', ...style, leadingTrim: { type: 'CAP_HEIGHT' },
    width: 70, height: 50, textRuns: [{ text: 'H' }, { text: '2\n', textPosition: 'superscript' },
      { text: 'Hp', fontSize: 24, baselineShift: 2 }], stroke: null });
  const authored = structuredClone(node);
  const measure = (text, options) => text.length * options.fontSize * .6;
  const output = await withPreparedTextPositionShapes(async pinned => {
    attempts++; await Promise.resolve();
    const measuring = (...args) => measure(...args); measuring.shapeText = pinned;
    return exportNodeToSvg(node, { measureText: measuring });
  }, { shapeText: cold, pollMs: 1, deadlineMs: 1000 });
  const warm = (...args) => measure(...args); warm.shapeText = metricShape;
  assert.equal(output, exportNodeToSvg(node, { measureText: warm }));
  assert.ok(attempts > 1); assert.deepEqual(node, authored);
  assert.ok([...queued].some(key => key.includes('24')));
});

test('asynchronous preparation failures and cancellation cannot publish an unfinished export', async () => {
  let attempts = 0;
  await assert.rejects(withPreparedTextPositionShapes(async () => {
    attempts++; await Promise.resolve(); throw new Error('invalid raster paint');
  }, { shapeText: shape }), /invalid raster paint/u);
  assert.equal(attempts, 1);
  const controller = new AbortController(); let published = false;
  await assert.rejects(withPreparedTextPositionShapes(async pinned => {
    await Promise.resolve(); controller.abort(); pinned('1', style); published = true;
  }, { shapeText: shape, signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(published, false);
});

test('font line metrics prepare independently of uncovered glyphs and remain pinned after eviction', async () => {
  let warm = false; let reads = 0; let attempts = 0;
  const fallback = () => null; fallback.fontStatus = () => 'none';
  fallback.fontMetricsStatus = () => warm ? 'ready' : 'pending';
  fallback.fontMetrics = () => {
    reads++;
    if (!warm) { setTimeout(() => { warm = true; }, 1); return null; }
    return { upem: 1000, extents: { ascender: 950, descender: -240, lineGap: 25 } };
  };
  const result = await withPreparedTextPositionShapes(async pinned => {
    attempts++;
    assert.equal(pinned('uncovered emoji', style), null);
    const metrics = pinned.fontMetrics(style, 'uncovered emoji');
    metrics.extents.ascender = 0;
    warm = false; // The worker can evict a font while other export work runs.
    await Promise.resolve();
    assert.equal(pinned.fontMetricsStatus(style), 'ready');
    return pinned.fontMetrics(style, 'other uncovered characters');
  }, { shapeText: fallback, pollMs: 1, deadlineMs: 1000 });
  assert.ok(attempts > 1); assert.equal(reads, 2);
  assert.equal(result.extents.ascender, 950);
});

test('native metadata keys retain automatic optical size without spending budgets on browser wrapping', async () => {
  const fallback = () => { throw new Error('Uncovered text has no native glyph request.'); };
  fallback.fontStatus = () => 'none';
  let reads = 0;
  fallback.fontMetricsStatus = () => 'ready';
  fallback.fontMetrics = options => { reads++; return { upem: 1000, extents: {
    ascender: 800 + options.fontSize, descender: -200, lineGap: 0
  } }; };
  await withPreparedTextPositionShapes(pinned => {
    for (let index = 0; index < 5000; index++) assert.equal(pinned(String(index), style), null);
    const small = pinned.fontMetrics({ ...style, fontAxes: { wdth: 90, wght: 400 } });
    assert.deepEqual(pinned.fontMetrics({ ...style, fontAxes: { wght: 400, wdth: 90 }, baselineShift: 2 }), small);
    assert.notEqual(pinned.fontMetrics({ ...style, fontSize: 40, fontAxes: { wdth: 90, wght: 400 } }).extents.ascender,
      small.extents.ascender);
  }, { shapeText: fallback, maxQueries: 2 });
  assert.equal(reads, 2);
});

test('queued font metrics fail closed on disappearance, stale source, cancellation and snapshot limits', async () => {
  let available = true; let metricReads = 0;
  const cold = () => null; cold.fontStatus = () => 'none';
  cold.fontMetricsStatus = () => available ? 'pending' : 'none';
  cold.fontMetrics = () => { metricReads++; available = false; return null; };
  await assert.rejects(withPreparedTextPositionShapes(pinned => pinned.fontMetrics(style), { shapeText: cold }), /became unavailable/u);
  assert.equal(metricReads, 1);
  available = true;
  let current = true;
  cold.fontMetrics = () => { current = false; return null; };
  await assert.rejects(withPreparedTextPositionShapes(pinned => pinned.fontMetrics(style), {
    shapeText: cold, assertCurrent: () => { if (!current) throw new Error('stale font source'); }, pollMs: 1
  }), /stale font source/u);
  const controller = new AbortController();
  cold.fontMetrics = () => { controller.abort(); return null; };
  await assert.rejects(withPreparedTextPositionShapes(pinned => pinned.fontMetrics(style), {
    shapeText: cold, signal: controller.signal, pollMs: 1
  }), error => error.name === 'AbortError');
  cold.fontMetricsStatus = () => 'ready';
  cold.fontMetrics = () => ({ upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 } });
  await assert.rejects(withPreparedTextPositionShapes(pinned => {
    pinned.fontMetrics(style); return pinned.fontMetrics({ ...style, fontSize: 40 });
  }, { shapeText: cold, maxQueries: 1 }), /bounded shaping snapshot/u);
  await assert.rejects(withPreparedTextPositionShapes(pinned => pinned.fontMetrics(style), {
    shapeText: cold, maxBytes: 20
  }), /bounded shaping snapshot/u);
});
