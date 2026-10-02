import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageSourceResidencyManager } from '../src/image-source-residency.js';

test('residency tracks LRU order and returns oldest unpinned eviction candidates', () => {
  const residency = new ImageSourceResidencyManager();
  assert.equal(residency.markResident('a'), true);
  assert.equal(residency.markResident('b'), true);
  assert.equal(residency.markResident('c'), true);
  assert.equal(residency.size, 3);

  assert.equal(residency.touch('a'), true);
  assert.deepEqual(residency.evictionCandidates(), ['b', 'c', 'a']);
  assert.equal(residency.oldestUnpinned(), 'b');
  assert.deepEqual(residency.evictionCandidates({ limit: 2 }), ['b', 'c']);
  assert.deepEqual(residency.evictionCandidates({ limit: 0 }), []);
  assert.equal(residency.has('a'), true);
});

test('leases count pins independently and release idempotently', () => {
  const residency = new ImageSourceResidencyManager();
  residency.markResident('a');
  residency.markResident('b');

  const first = residency.acquire('b');
  const second = residency.acquire('b');
  assert.ok(first);
  assert.ok(second);
  assert.equal(residency.pinCount('b'), 2);
  assert.deepEqual(residency.evictionCandidates(), ['a']);

  assert.equal(first.release(), true);
  assert.equal(first.release(), false);
  assert.equal(residency.pinCount('b'), 1);
  assert.equal(residency.oldestUnpinned(), 'a');

  assert.equal(second.release(), true);
  assert.equal(residency.pinCount('b'), 0);
  assert.deepEqual(residency.evictionCandidates(), ['a', 'b'], 'releasing every lease makes b evictable');
});

test('pinned sources cannot be evicted, but become evictable after their last lease releases', () => {
  const residency = new ImageSourceResidencyManager();
  residency.markResident('pinned');
  residency.markResident('ordinary');
  const lease = residency.acquire('pinned');

  assert.equal(residency.evict('pinned'), false);
  assert.equal(residency.has('pinned'), true);
  assert.equal(residency.oldestUnpinned(), 'ordinary');
  assert.deepEqual(residency.evictionCandidates({ exclude: ['ordinary'] }), []);

  assert.equal(lease.release(), true);
  assert.equal(residency.evict('pinned'), true);
  assert.equal(residency.evict('pinned'), false);
  assert.equal(residency.has('pinned'), false);
  assert.equal(residency.size, 1);
});

test('marking an existing source refreshes recency without losing its leases', () => {
  const residency = new ImageSourceResidencyManager();
  residency.markResident('a');
  residency.markResident('b');
  const lease = residency.acquire('a');

  assert.equal(residency.markResident('a'), false);
  assert.equal(residency.pinCount('a'), 1);
  assert.equal(residency.oldestUnpinned(), 'b');
  assert.equal(lease.release(), true);
  assert.equal(residency.evictionCandidates().at(-1), 'a');
});

test('missing sources cannot be leased and invalid IDs or candidate limits are rejected', () => {
  const residency = new ImageSourceResidencyManager();
  assert.equal(residency.acquire('missing'), null);
  assert.equal(residency.touch('missing'), false);
  assert.equal(residency.evict('missing'), false);
  assert.throws(() => residency.markResident('  '), /nonempty asset ID/);
  assert.throws(() => residency.evictionCandidates({ limit: -1 }), /nonnegative safe integer/);
  assert.throws(() => residency.evictionCandidates({ limit: 1.5 }), /nonnegative safe integer/);
});

test('clear resets tracked sources at a runtime boundary and makes stale leases harmless', () => {
  const residency = new ImageSourceResidencyManager();
  residency.markResident('a');
  const lease = residency.acquire('a');

  assert.equal(residency.clear(), 1);
  assert.equal(residency.size, 0);
  assert.equal(residency.pinCount('a'), 0);
  assert.equal(residency.evictionCandidates().length, 0);
  assert.equal(lease.release(), true);
  assert.equal(residency.size, 0);
});
