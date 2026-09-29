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
