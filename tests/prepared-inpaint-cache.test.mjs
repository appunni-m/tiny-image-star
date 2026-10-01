import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PreparedInpaintCache } from '../src/prepared-inpaint-cache.js';
import { RetainedImageMemoryBudget } from '../src/image-memory-budget.js';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const sourceBytes = new Uint8Array([1, 2, 3, 4]);
const dimensions = { width: 2, height: 2 };
const strokes = [{ radius: 0.08, points: [{ x: 0.4, y: 0.5 }] }];

function makeCache(limitBytes = 1024) {
  const memoryBudget = new RetainedImageMemoryBudget({ limitBytes });
  const disposed = [];
  const cache = new PreparedInpaintCache({ memoryBudget, onDispose: assetId => disposed.push(assetId) });
  return { cache, memoryBudget, disposed };
}

test('verified erased bytes are reused for the same original, dimensions, and exact strokes', () => {
  const { cache, memoryBudget, disposed } = makeCache();
  const generated = new Uint8Array([10, 11, 12, 13]);
  const stored = cache.store(sourceBytes, 'asset-a', strokes, dimensions, generated);

  assert.ok(stored);
  assert.notEqual(stored.bytes, generated, 'the cache owns an independent retained buffer');
  assert.deepEqual([...stored.bytes], [...generated]);
  generated.fill(0);
  assert.deepEqual([...stored.bytes], [10, 11, 12, 13], 'temporary worker output can be cleared after retaining');
  assert.equal(memoryBudget.metrics().byKind['prepared-object-erase'], 4);

  const hit = cache.acquire(sourceBytes, 'asset-a', strokes, dimensions);
  assert.ok(hit);
  assert.equal(hit.assetId, stored.assetId, 'Pillow-RS can keep the decoded prepared source under a stable worker-cache identity');
  assert.equal(hit.bytes, stored.bytes);
  assert.equal(stored.release(), true);
  assert.equal(hit.release(), true);
  assert.equal(cache.clear(), true);
  assert.deepEqual(memoryBudget.metrics(), {
    usedBytes: 0, limitBytes: 1024, availableBytes: 1024, entries: 0, reservations: 0, byKind: {}
  });
  assert.deepEqual(disposed, [stored.assetId]);
  assert.deepEqual([...stored.bytes], [0, 0, 0, 0], 'eviction clears the retained encoded image');
});

test('source, asset identity, dimensions, or stroke edits invalidate the one-entry cache', () => {
  const { cache, memoryBudget, disposed } = makeCache();
  const stored = cache.store(sourceBytes, 'asset-a', strokes, dimensions, new Uint8Array([20, 21]));
  assert.ok(stored);
  stored.release();

  assert.equal(cache.acquire(sourceBytes, 'asset-a', [{ radius: 0.1, points: [{ x: 0.4, y: 0.5 }] }], dimensions), null);
  assert.equal(memoryBudget.usedBytes, 0, 'a changed stroke releases the old entry before new inference');
  assert.deepEqual(disposed, [stored.assetId]);

  const second = cache.store(sourceBytes, 'asset-a', strokes, dimensions, new Uint8Array([30]));
  assert.ok(second);
  second.release();
  assert.equal(cache.acquire(new Uint8Array([1, 2, 3, 4]), 'asset-a', strokes, dimensions), null,
    'a reloaded source buffer cannot reuse an entry made from an older source object');
  assert.equal(memoryBudget.usedBytes, 0);

  const third = cache.store(sourceBytes, 'asset-a', strokes, dimensions, new Uint8Array([40]));
  assert.ok(third);
  third.release();
  assert.equal(cache.acquire(sourceBytes, 'asset-b', strokes, dimensions), null);
  assert.equal(memoryBudget.usedBytes, 0);

  const fourth = cache.store(sourceBytes, 'asset-a', strokes, dimensions, new Uint8Array([50]));
  assert.ok(fourth);
  fourth.release();
  assert.equal(cache.acquire(sourceBytes, 'asset-a', strokes, { width: 1, height: 4 }), null);
  assert.equal(memoryBudget.usedBytes, 0);
});

test('retiring a leased result waits for the render to release it before wiping bytes or memory accounting', () => {
  const { cache, memoryBudget, disposed } = makeCache();
  const lease = cache.store(sourceBytes, 'asset-a', strokes, dimensions, new Uint8Array([60, 61, 62]));
  assert.ok(lease);
  const bytes = lease.bytes;

  assert.equal(cache.clear(), true);
  assert.equal(memoryBudget.usedBytes, 3, 'active renders keep retired source bytes accounted');
  assert.deepEqual([...bytes], [60, 61, 62], 'an in-flight Pillow-RS job keeps a stable byte source');
  assert.deepEqual(disposed, [], 'the worker-side decoded copy stays available until render completion');
  assert.equal(lease.release(), true);
  assert.equal(lease.release(), false, 'a lease is released exactly once');
  assert.equal(memoryBudget.usedBytes, 0);
  assert.deepEqual([...bytes], [0, 0, 0]);
  assert.deepEqual(disposed, [lease.assetId]);
});

test('removing erase strokes or releasing the original asset invalidates its prepared copy', () => {
  const { cache, memoryBudget } = makeCache();
  const first = cache.store(sourceBytes, 'asset-a', strokes, dimensions, new Uint8Array([65]));
  assert.ok(first);
  first.release();
  assert.equal(cache.invalidateSource(sourceBytes, 'asset-a'), true);
  assert.equal(memoryBudget.usedBytes, 0);

  const second = cache.store(sourceBytes, 'asset-a', strokes, dimensions, new Uint8Array([66]));
  assert.ok(second);
  second.release();
  assert.equal(cache.invalidateAsset('asset-a'), true);
  assert.equal(memoryBudget.usedBytes, 0);
});

test('cache admission is optional when the retained image budget is full', () => {
  const { cache, memoryBudget } = makeCache(2);
  const generated = new Uint8Array([70, 71, 72]);

  assert.equal(cache.store(sourceBytes, 'asset-a', strokes, dimensions, generated), null);
  assert.equal(cache.acquire(sourceBytes, 'asset-a', strokes, dimensions), null);
  assert.equal(memoryBudget.usedBytes, 0);
  assert.deepEqual([...generated], [70, 71, 72], 'rejected cache admission leaves the transient render source intact');
});

test('image rendering consumes a leased prepared source and clears cache state with its owning runtime', () => {
  const start = mainSource.indexOf('async function renderImageWithEdits(');
  const end = mainSource.indexOf('\nasync function renderImagePreview(', start);
  assert.ok(start >= 0 && end > start, 'the edited-image render path should have a bounded function body');
  const renderBody = mainSource.slice(start, end);
  assert.match(renderBody, /preparedInpaintCache\.acquire\(asset\.sourceBytes, asset\.assetId, strokes, originalDimensions\)/);
  assert.match(renderBody, /preparedInpaintCache\.store\(asset\.sourceBytes, asset\.assetId, strokes, originalDimensions, prepared\.bytes\)/);
  assert.match(renderBody, /assertSafeRasterDimensions\(prepared\.bytes\)/,
    'only an encoded result whose real image header matches the verified source dimensions can be cached');
  assert.match(renderBody, /preparedInpaintCache\.invalidateSource\(asset\.sourceBytes, asset\.assetId\)/,
    'removing erase strokes from an image releases its obsolete prepared copy');
  assert.match(renderBody, /cachedSource\.release\(\)/);
  assert.match(mainSource, /preparedInpaintCache\.clear\(\);\s*imageMemoryBudget\.releaseEntries\(\)/,
    'switching documents retires any retained erased source');
  assert.match(mainSource, /preparedInpaintCache\.invalidateAsset\(assetId\)/,
    'disposing an unreachable original asset also disposes its prepared source');
});
