import test from 'node:test';
import assert from 'node:assert/strict';
import { DecodedSourceCache } from '../src/decoded-source-cache.js';

function source(width, height = 1) {
  return { width, height, freeCalls: 0, free() { this.freeCalls += 1; } };
}

test('decoded source cache evicts the least recently used images to stay within its pixel budget', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 12 });
  const a = source(6), b = source(4), c = source(6);
  cache.set('a', a); cache.set('b', b);
  assert.equal(cache.get('a'), a); // Make a newer than b.
  const inserted = cache.set('c', c);

  assert.deepEqual(inserted, { retained: true, evictedAssetIds: ['b'] });
  assert.equal(cache.pixels, 12);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('c'), true);
  assert.equal(b.freeCalls, 1);
  assert.equal(a.freeCalls, 0);
  assert.equal(c.freeCalls, 0);
});

test('replacing a cached asset frees the old WASM image and updates pixel accounting', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 10 });
  const oldSource = source(4), replacement = source(7);
  cache.set('asset', oldSource);
  cache.set('asset', replacement);

  assert.equal(cache.get('asset'), replacement);
  assert.equal(cache.pixels, 7);
  assert.equal(cache.size, 1);
  assert.equal(oldSource.freeCalls, 1);
  assert.equal(replacement.freeCalls, 0);
});

test('pinned sources survive LRU churn while the oldest unpinned sources are freed first', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 8 });
  const a = source(3), active = source(3), b = source(2), next = source(5);
  cache.set('a', a); cache.set('active', active); cache.set('b', b);
  assert.equal(cache.pin('active'), true);
  assert.equal(cache.pin('missing'), false);
  cache.get('a'); // b is now the oldest unpinned entry.

  const inserted = cache.set('next', next);
  assert.deepEqual(inserted, { retained: true, evictedAssetIds: ['b', 'a'] });
  assert.equal(cache.has('active'), true);
  assert.equal(cache.has('next'), true);
  assert.equal(cache.pixels, 8);
  assert.deepEqual([a.freeCalls, active.freeCalls, b.freeCalls, next.freeCalls], [1, 0, 1, 0]);
});

test('an absent active-source intent protects that source when it is decoded later', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 8 });
  const old = source(4), recent = source(3), active = source(5);
  cache.set('old', old); cache.set('recent', recent);

  assert.equal(cache.setActive('active'), false, 'the source is not resident yet');
  assert.equal(cache.activeAssetId, 'active', 'the selection intent survives the cache miss');
  const rendered = cache.withSource('active', () => active, decoded => decoded.width);
  assert.deepEqual(rendered, { result: 5, retained: true, evictedAssetIds: ['old'] });
  assert.equal(cache.has('active'), true);
  assert.equal(cache.has('recent'), true);
  assert.equal(cache.pixels, 8);

  const extra = source(4);
  const refused = cache.set('extra', extra);
  assert.deepEqual(refused, { retained: false, evictedAssetIds: [] }, 'a new source cannot displace the protected active source when the pair exceeds budget');
  assert.equal(cache.has('active'), true);
  assert.equal(cache.has('recent'), true, 'an impossible insertion does not evict useful unpinned entries before refusing');
  assert.equal(cache.pixels, 8);
  assert.equal(extra.freeCalls, 0, 'set leaves an unretained source owned by its caller');
  extra.free();
});

test('unpin restores ordinary LRU eviction while the active source remains protected', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 8 });
  const pinned = source(4), active = source(4), next = source(1);
  cache.set('pinned', pinned); cache.set('active', active);
  assert.equal(cache.pin('pinned'), true);
  assert.equal(cache.setActive('active'), true);

  assert.deepEqual(cache.set('next', next), { retained: false, evictedAssetIds: [] }, 'both protected sources leave no room for the incoming source');
  assert.equal(cache.has('pinned'), true);
  assert.equal(cache.unpin('pinned'), true);
  assert.deepEqual(cache.set('next', next), { retained: true, evictedAssetIds: ['pinned'] });
  assert.equal(cache.has('active'), true);
  assert.equal(cache.pixels, 5);
  assert.equal(pinned.freeCalls, 1);
});

test('oversized source renders successfully but is freed immediately after rendering', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 4 });
  const large = source(3, 2);
  const output = cache.withSource('large', () => large, decoded => {
    assert.equal(decoded, large);
    assert.equal(decoded.freeCalls, 0);
    return 'rendered';
  });

  assert.equal(output.result, 'rendered');
  assert.equal(output.retained, false);
  assert.deepEqual(output.evictedAssetIds, []);
  assert.equal(large.freeCalls, 1);
  assert.equal(cache.size, 0);
  assert.equal(cache.pixels, 0);
});

test('a disposed asset cannot be repopulated after an in-flight first WASM load', async () => {
  const cache = new DecodedSourceCache({ pixelBudget: 10 });
  const sourceLoadedAfterReady = source(4);
  const render = { invalidated: false };
  let finishWasmLoad;
  const wasmReady = new Promise(resolve => { finishWasmLoad = resolve; });
  const inFlight = (async () => {
    await wasmReady;
    return cache.withSource('deleted-asset', () => sourceLoadedAfterReady, decoded => decoded.width, { retain: !render.invalidated });
  })();

  // This models dispose arriving while the worker's render handler is waiting
  // for its initial Pillow-RS WASM import to finish.
  render.invalidated = true;
  cache.delete('deleted-asset');
  finishWasmLoad();
  const result = await inFlight;

  assert.deepEqual(result, { result: 4, retained: false, evictedAssetIds: [] });
  assert.equal(cache.has('deleted-asset'), false, 'the stale render must not resurrect the disposed cache entry');
  assert.equal(sourceLoadedAfterReady.freeCalls, 1, 'the ephemeral decoded source is still freed after rendering');
});

test('retained renders report exact cache evictions and reuse the same decoded object', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 5 });
  const a = source(3), b = source(3);
  const first = cache.withSource('a', () => a, decoded => decoded);
  const second = cache.withSource('b', () => b, decoded => decoded);
  let recreated = false;
  const third = cache.withSource('b', () => { recreated = true; return source(3); }, decoded => decoded);

  assert.equal(first.result, a);
  assert.equal(first.retained, true);
  assert.deepEqual(first.evictedAssetIds, []);
  assert.deepEqual(second.evictedAssetIds, ['a']);
  assert.equal(third.result, b);
  assert.equal(third.retained, true);
  assert.deepEqual(third.evictedAssetIds, []);
  assert.equal(recreated, false);
  assert.equal(a.freeCalls, 1);
});

test('shrinking a worker budget frees least-recently-used sources and reports their IDs', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 10 });
  const a = source(4), b = source(4);
  cache.set('a', a); cache.set('b', b);
  cache.get('a');

  assert.deepEqual(cache.setBudget(4), { pixelBudget: 4, evictedAssetIds: ['b'] });
  assert.equal(cache.pixels, 4);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(b.freeCalls, 1);
});

test('budget reductions evict unpinned entries first and release pins if even protected sources cannot fit', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 12 });
  const pinned = source(4), ordinary = source(4), active = source(3);
  cache.set('pinned', pinned); cache.set('ordinary', ordinary); cache.set('active', active);
  cache.pin('pinned');
  cache.setActive('active');

  assert.deepEqual(cache.setBudget(7), { pixelBudget: 7, evictedAssetIds: ['ordinary'] });
  assert.equal(cache.has('pinned'), true);
  assert.equal(cache.has('active'), true);
  assert.equal(cache.pixels, 7);

  assert.deepEqual(cache.setBudget(2), { pixelBudget: 2, evictedAssetIds: ['pinned', 'active'] });
  assert.equal(cache.pixels, 0);
  assert.equal(cache.size, 0);
  assert.equal(pinned.freeCalls, 1);
  assert.equal(active.freeCalls, 1);
  assert.equal(cache.unpin('pinned'), false, 'eviction clears explicit pin state');
});

test('oversized source is still freed when its render fails', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 4 });
  const large = source(5);
  assert.throws(() => cache.withSource('large', () => large, () => { throw new Error('render failed'); }), /render failed/);
  assert.equal(large.freeCalls, 1);
  assert.equal(cache.size, 0);
});

test('failed renders still report cache retention and evictions to the worker owner', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 5 });
  const a = source(3), b = source(3);
  cache.set('a', a);

  assert.throws(() => cache.withSource('b', () => b, () => { throw new Error('render failed'); }), error => {
    assert.equal(error.message, 'render failed');
    assert.deepEqual(error.decodedSourceCache, { retained: true, evictedAssetIds: ['a'] });
    return true;
  });
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('b'), true);
  assert.equal(a.freeCalls, 1);
  assert.equal(b.freeCalls, 0);
});

test('dispose deletes one source and worker-close cleanup frees all remaining sources', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 10 });
  const a = source(3), b = source(5);
  cache.set('a', a); cache.set('b', b);

  assert.equal(cache.delete('a'), true);
  assert.equal(cache.delete('missing'), false);
  assert.equal(a.freeCalls, 1);
  assert.equal(b.freeCalls, 0);
  assert.equal(cache.pixels, 5);

  cache.clear(); // The worker's close handler releases all retained sources.
  cache.clear(); // Cleanup remains safe if invoked again during shutdown.
  assert.equal(b.freeCalls, 1);
  assert.equal(cache.size, 0);
  assert.equal(cache.pixels, 0);
});

test('delete and clear release pinned sources once and discard active intents', () => {
  const cache = new DecodedSourceCache({ pixelBudget: 10 });
  const a = source(3), b = source(5);
  cache.set('a', a); cache.set('b', b);
  assert.equal(cache.pin('a'), true);
  assert.equal(cache.setActive('b'), true);

  assert.equal(cache.delete('b'), true);
  assert.equal(cache.activeAssetId, null);
  assert.equal(b.freeCalls, 1);
  assert.equal(cache.has('a'), true);

  assert.equal(cache.setActive('future'), false);
  cache.clear();
  cache.clear();
  assert.equal(cache.activeAssetId, null);
  assert.equal(cache.unpin('a'), false);
  assert.equal(a.freeCalls, 1);
  assert.equal(cache.pixels, 0);
  assert.equal(cache.size, 0);
});
