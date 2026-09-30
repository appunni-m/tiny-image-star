import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertImagePayloadMatchesPreflight,
  defaultRetainedImageMemoryBudget,
  estimateAssetMemoryBytes,
  estimateBitmapBytes,
  estimatePreviewMemoryBytes,
  releaseImageMemoryReservations,
  RetainedImageMemoryBudget,
  transformedImageDimensions,
} from '../src/image-memory-budget.js';

test('device tiers keep a hard bounded retained image budget', () => {
  assert.equal(defaultRetainedImageMemoryBudget({ deviceMemory: 2 }), 96 * 1024 * 1024);
  assert.equal(defaultRetainedImageMemoryBudget({ deviceMemory: 4 }), 160 * 1024 * 1024);
  assert.equal(defaultRetainedImageMemoryBudget({ deviceMemory: 16 }), 384 * 1024 * 1024);
  assert.equal(defaultRetainedImageMemoryBudget({ deviceMemory: undefined }), 160 * 1024 * 1024);
});

test('conservative resource estimates include source bytes, decoded pixels and preview output bytes', () => {
  assert.equal(estimateBitmapBytes(20, 10), 800);
  assert.equal(estimateAssetMemoryBytes({ sourceByteLength: 1000, bitmapWidth: 20, bitmapHeight: 10 }), 2800);
  assert.equal(estimatePreviewMemoryBytes({ width: 20, height: 10, encodedByteLength: 100 }), 1000);
  assert.throws(() => estimateBitmapBytes(Number.MAX_SAFE_INTEGER, 2), /safe integer/);
});

test('crop and right-angle rotation produce safe output dimensions', () => {
  assert.deepEqual(transformedImageDimensions(800, 400, {
    crop: { left: 0.1, top: 0.25, right: 0.9, bottom: 0.75 }, rotation: 90,
  }), { width: 200, height: 640 });
  assert.deepEqual(transformedImageDimensions(800, 400, { rotation: 180 }), { width: 800, height: 400 });
});

test('import payload must match the reserved header dimensions and byte length', () => {
  const expectedDimensions = { width: 12, height: 8 };
  assert.equal(assertImagePayloadMatchesPreflight({
    expectedDimensions, expectedByteLength: 64,
    actualDimensions: { width: 12, height: 8 }, actualByteLength: 64,
  }), true);
  assert.throws(() => assertImagePayloadMatchesPreflight({
    expectedDimensions, expectedByteLength: 64,
    actualDimensions: { width: 12, height: 8 }, actualByteLength: 63,
  }), /changed or was incomplete/);
  assert.throws(() => assertImagePayloadMatchesPreflight({
    expectedDimensions, expectedByteLength: 64,
    actualDimensions: { width: 12, height: 9 }, actualByteLength: 64,
  }), /changed or was incomplete/);
  for (const dimensions of [
    { width: 0, height: 8 },
    { width: '12', height: '8' },
    { width: Number.MAX_SAFE_INTEGER + 1, height: 8 },
  ]) {
    assert.throws(() => assertImagePayloadMatchesPreflight({
      expectedDimensions: dimensions, expectedByteLength: 64,
      actualDimensions: dimensions, actualByteLength: 64,
    }), /measurements are invalid/);
  }
});

test('reservations atomically protect capacity across concurrent image jobs', () => {
  const budget = new RetainedImageMemoryBudget({ limitBytes: 100 });
  assert.equal(budget.retain('asset:a', 30, { kind: 'asset' }), true);
  const first = budget.reserve(40, { kind: 'preview-pending' });
  const second = budget.reserve(40, { kind: 'preview-pending' });
  assert.ok(first);
  assert.equal(second, null, 'the same remaining memory cannot be admitted twice');
  assert.deepEqual(budget.metrics(), {
    usedBytes: 70, limitBytes: 100, availableBytes: 30, entries: 1, reservations: 1,
    byKind: { asset: 30, 'preview-pending': 40 },
  });
  assert.equal(budget.commit(first, 'preview:a', { bytes: 35, kind: 'preview' }), true);
  assert.equal(budget.metrics().usedBytes, 65);
  assert.equal(budget.release('asset:a'), true);
  assert.equal(budget.release('asset:a'), false);
  assert.equal(budget.metrics().usedBytes, 35);
});

test('replacement admission accounts old and new previews until disposal, without partial commits', () => {
  const budget = new RetainedImageMemoryBudget({ limitBytes: 100 });
  budget.retain('preview:one', 55, { kind: 'preview' });
  assert.equal(budget.canFit(50), false);
  assert.equal(budget.canFit(50, { excluding: ['preview:one'] }), true);
  const reservation = budget.reserve(50);
  assert.equal(reservation, null, 'replacement still requires peak memory unless old resources are released');
  budget.release('preview:one');
  const next = budget.reserve(50);
  assert.ok(next);
  assert.throws(() => budget.commit(next, 'preview:one', { bytes: 101 }), /limit/);
  assert.equal(budget.metrics().usedBytes, 50, 'failed commits keep their reservation available for release');
  budget.releaseReservation(next);
  assert.equal(budget.metrics().usedBytes, 0);
});

test('invalid sizes and stale reservations fail closed', () => {
  const budget = new RetainedImageMemoryBudget({ limitBytes: 10 });
  assert.equal(budget.retain('x', 11), false);
  assert.throws(() => budget.retain('x', -1), /nonnegative/);
  const token = budget.reserve(5);
  assert.ok(token);
  assert.equal(budget.releaseReservation(token), true);
  assert.equal(budget.releaseReservation(token), false);
  assert.throws(() => budget.commit(token, 'x'), /no longer active/);
});

test('document disposal releases committed image resources but keeps in-flight allocations fenced', () => {
  const budget = new RetainedImageMemoryBudget({ limitBytes: 100 });
  budget.retain('asset:a', 30, { kind: 'asset' });
  const inFlight = budget.reserve(40, { kind: 'preview-pending' });
  assert.ok(inFlight);
  budget.releaseEntries();
  assert.equal(budget.metrics().usedBytes, 40);
  assert.equal(budget.metrics().entries, 0);
  assert.equal(budget.metrics().reservations, 1);
  assert.equal(budget.retain('asset:next-document', 61), false, 'new design cannot spend bytes held by an old in-flight decode');
  budget.releaseReservation(inFlight);
  assert.equal(budget.metrics().usedBytes, 0);
  assert.equal(budget.retain('asset:next-document', 61), true);
});

test('stale restore cleanup releases both decode and asset reservations exactly once', () => {
  const budget = new RetainedImageMemoryBudget({ limitBytes: 100 });
  const reservations = {
    assetReservation: budget.reserve(60, { kind: 'asset-pending' }),
    decodeReservation: budget.reserve(40, { kind: 'decode-transient' })
  };
  assert.ok(reservations.assetReservation && reservations.decodeReservation);
  assert.equal(budget.metrics().usedBytes, 100);

  assert.equal(releaseImageMemoryReservations(budget, reservations), 2);
  assert.deepEqual(reservations, { assetReservation: null, decodeReservation: null });
  assert.equal(releaseImageMemoryReservations(budget, reservations), 0);
  assert.deepEqual(budget.metrics(), {
    usedBytes: 0, limitBytes: 100, availableBytes: 100, entries: 0, reservations: 0, byKind: {}
  });
});
