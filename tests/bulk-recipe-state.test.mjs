import test from 'node:test';
import assert from 'node:assert/strict';
import { canDismissImageRecipeBatch, cancelImageRecipeBatch, completeImageRecipeBatchIfDrained, formatImageRecipeBatchTiming, hydrateAndAdmitImageRecipeTarget, imageRecipeBatchTiming, isImageRecipeBatchActive, pauseImageRecipeBatchClock, recordImageRecipeBatchTarget, resumeImageRecipeBatchClock, startImageRecipeBatchClock } from '../src/bulk-recipe-state.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function hydrationAdmissionOptions(overrides = {}) {
  const node = { id: 'image-a', type: 'image', assetId: 'asset-a', adjustments: { brightness: 0 } };
  const entry = { node, parents: [] };
  return {
    ensureResident: async () => {},
    assetId: 'asset-a',
    previewKey: 'image-a',
    generation: 4,
    isGenerationCurrent: () => true,
    isBatchCurrent: () => true,
    resolveTarget: () => entry,
    expectedNode: node,
    isEditableTarget: target => target.node.type === 'image' && !target.node.locked && !(target.parents || []).some(parent => parent.locked),
    onAdmit: target => {
      target.node.adjustments.brightness = 25;
      return 'render-admitted';
    },
    ...overrides,
    entry,
    node,
  };
}

test('recipe target hydration finishes before recipe mutation and render admission', async () => {
  const sourceReady = deferred();
  let admitted = false;
  const options = hydrationAdmissionOptions({
    ensureResident: () => sourceReady.promise,
    onAdmit: target => {
      admitted = true;
      target.node.adjustments.brightness = 25;
      return 'render-admitted';
    },
  });

  const admission = hydrateAndAdmitImageRecipeTarget(options);
  await Promise.resolve();
  assert.equal(admitted, false, 'the recipe must remain untouched while original bytes are loading');
  assert.equal(options.node.adjustments.brightness, 0);

  sourceReady.resolve();
  assert.deepEqual(await admission, { status: 'admitted', value: 'render-admitted' });
  assert.equal(admitted, true);
  assert.equal(options.node.adjustments.brightness, 25);
});

test('hydrated recipe targets are fenced against generation, batch, layer, asset, and lock changes', async () => {
  const cases = [
    ['document generation', context => { context.generationCurrent = false; }, 'cancelled'],
    ['batch ownership', context => { context.batchCurrent = false; }, 'cancelled'],
    ['removed target', context => { context.entry = null; }, 'skipped'],
    ['replaced node identity', context => { context.entry = { node: { ...context.node }, parents: [] }; }, 'skipped'],
    ['changed source asset', context => { context.node.assetId = 'asset-b'; }, 'skipped'],
    ['locked target', context => { context.node.locked = true; }, 'skipped'],
    ['locked ancestor', context => { context.entry.parents = [{ locked: true }]; }, 'skipped'],
  ];

  for (const [label, invalidate, expectedStatus] of cases) {
    const sourceReady = deferred();
    const node = { id: 'image-a', type: 'image', assetId: 'asset-a', adjustments: { brightness: 0 } };
    const context = { generationCurrent: true, batchCurrent: true, node, entry: { node, parents: [] } };
    let admitted = false;
    const admission = hydrateAndAdmitImageRecipeTarget({
      ensureResident: () => sourceReady.promise,
      assetId: 'asset-a',
      previewKey: 'image-a',
      generation: 4,
      isGenerationCurrent: () => context.generationCurrent,
      isBatchCurrent: () => context.batchCurrent,
      resolveTarget: () => context.entry,
      expectedNode: node,
      isEditableTarget: target => target.node.type === 'image' && !target.node.locked && !(target.parents || []).some(parent => parent.locked),
      onAdmit: () => { admitted = true; },
    });

    await Promise.resolve();
    invalidate(context);
    sourceReady.resolve();
    const outcome = await admission;
    assert.equal(outcome.status, expectedStatus, label);
    assert.equal(admitted, false, `${label} must not mutate or dispatch a render`);
    assert.equal(node.adjustments.brightness, 0, `${label} must leave the original recipe state untouched`);
  }
});

test('a cancelled recipe batch keeps its bar until submitted work has drained', () => {
  const batch = { targets: ['a', 'b', 'c', 'd'], next: 2, inflight: 2, paused: true, cancelled: false, done: false };

  assert.equal(isImageRecipeBatchActive(batch), true);
  assert.equal(canDismissImageRecipeBatch(batch), false);
  assert.equal(cancelImageRecipeBatch(batch), true);
  assert.equal(batch.cancelled, true);
  assert.equal(batch.paused, false);
  assert.equal(batch.next, batch.targets.length, 'cancel stops admission of every target not yet submitted');
  assert.equal(batch.done, false, 'in-flight image jobs must settle before the user can dismiss the status bar');
  assert.equal(canDismissImageRecipeBatch(batch), false);

  batch.inflight = 0;
  batch.done = true;
  assert.equal(isImageRecipeBatchActive(batch), false);
  assert.equal(canDismissImageRecipeBatch(batch), true);
  assert.equal(cancelImageRecipeBatch(batch), false);
});

test('a nominally completed recipe batch is not dismissible while a worker is still settling', () => {
  const batch = { targets: ['a'], next: 1, inflight: 1, paused: false, cancelled: false, done: true };
  assert.equal(isImageRecipeBatchActive(batch), true);
  assert.equal(canDismissImageRecipeBatch(batch), false);
});

test('a drained batch finishes when its remaining targets are skipped without starting renders', () => {
  const batch = { targets: ['deleted', 'stale'], next: 0, inflight: 0, paused: false, cancelled: false, done: false };

  assert.equal(completeImageRecipeBatchIfDrained(batch), false, 'unadmitted targets still need a scheduling pass');
  batch.next = batch.targets.length;
  assert.equal(completeImageRecipeBatchIfDrained(batch), true);
  assert.equal(batch.done, true);
  assert.equal(canDismissImageRecipeBatch(batch), true);
});

test('recipe progress distinguishes successful, failed, superseded, skipped, and canceled queued targets', () => {
  const batch = { completed: 0, failed: 0, superseded: 0, skipped: 0, failedTargets: [] };
  recordImageRecipeBatchTarget(batch);
  recordImageRecipeBatchTarget(batch, { failed: true, targetId: 'image-failed' });
  recordImageRecipeBatchTarget(batch, { superseded: true });
  recordImageRecipeBatchTarget(batch, { skipped: true, targetId: 'image-removed' });
  assert.equal(recordImageRecipeBatchTarget(batch, { canceled: true, failed: true, skipped: true, targetId: 'image-canceled' }), false);
  assert.deepEqual(batch, {
    completed: 4,
    failed: 1,
    superseded: 1,
    skipped: 1,
    failedTargets: ['image-failed'],
  });
});

test('failed image IDs are retained once for targeted retry after the batch drains', () => {
  const batch = { completed: 0, failed: 0, superseded: 0, failedTargets: [] };
  recordImageRecipeBatchTarget(batch, { failed: true, targetId: 'image-a' });
  recordImageRecipeBatchTarget(batch, { failed: true, targetId: 'image-a' });
  recordImageRecipeBatchTarget(batch, { failed: true, targetId: 'image-b' });
  recordImageRecipeBatchTarget(batch, { canceled: true, failed: true, targetId: 'image-c' });
  assert.equal(batch.failed, 3);
  assert.deepEqual(batch.failedTargets, ['image-a', 'image-b']);
});

test('bulk timing reports active images per second and estimates only unfinished targets', () => {
  const batch = { targets: Array.from({ length: 8 }, (_, index) => `image-${index}`), completed: 0, inflight: 0, next: 0, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(batch, 1000);
  recordImageRecipeBatchTarget(batch, { now: 2200 });
  recordImageRecipeBatchTarget(batch, { failed: true, targetId: 'image-1', now: 2500 });

  assert.deepEqual(imageRecipeBatchTiming(batch, 3000), {
    elapsedMs: 2000,
    imagesPerSecond: 1,
    recentImagesPerSecond: 1,
    remaining: 6,
    etaSeconds: 6
  });
  assert.equal(formatImageRecipeBatchTiming(batch, 3000), '1.0 images/s average · now 1.0 images/s · about 6s left');
});

test('throughput counts terminal success, failure, superseded, and skipped targets but excludes cancellation', () => {
  const batch = { targets: ['a', 'b', 'c', 'd', 'e'], completed: 0, inflight: 0, next: 5, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(batch, 0);
  recordImageRecipeBatchTarget(batch, { now: 100 });
  recordImageRecipeBatchTarget(batch, { failed: true, targetId: 'b', now: 500 });
  recordImageRecipeBatchTarget(batch, { superseded: true, now: 1000 });
  recordImageRecipeBatchTarget(batch, { skipped: true, now: 1500 });
  assert.equal(recordImageRecipeBatchTarget(batch, { canceled: true }), false);

  assert.deepEqual(imageRecipeBatchTiming(batch, 2000), {
    elapsedMs: 2000,
    imagesPerSecond: 2,
    recentImagesPerSecond: 2,
    remaining: 1,
    etaSeconds: 0.5
  });
});

test('pausing freezes both elapsed time and throughput additions until the batch resumes', () => {
  const batch = { targets: ['a', 'b', 'c', 'd'], completed: 0, inflight: 2, next: 2, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(batch, 100);
  recordImageRecipeBatchTarget(batch, { now: 1100 });
  pauseImageRecipeBatchClock(batch, 2100);
  batch.paused = true;
  recordImageRecipeBatchTarget(batch, { skipped: true });

  assert.deepEqual(imageRecipeBatchTiming(batch, 50_000), {
    elapsedMs: 2000,
    imagesPerSecond: 0.5,
    recentImagesPerSecond: 0.5,
    remaining: 2,
    etaSeconds: 4
  }, 'paused time and paused completions must not inflate the displayed rate');
  assert.equal(formatImageRecipeBatchTiming(batch, 50_000), 'Paused · 0.5 images/s average · about 4s after resume · now 0.5 images/s');

  batch.paused = false;
  assert.equal(resumeImageRecipeBatchClock(batch, 50_000), true);
  recordImageRecipeBatchTarget(batch, { now: 51_000 });
  const resumed = imageRecipeBatchTiming(batch, 52_000);
  assert.equal(resumed.elapsedMs, 4000, 'the 48-second pause is excluded from active elapsed time');
  assert.equal(resumed.imagesPerSecond, 0.5, 'the resumed completion is counted without including the paused interval');
  assert.equal(resumed.remaining, 1);
});

test('canceling suppresses ETA while admitted work drains and freezes the final average', () => {
  const batch = { targets: ['a', 'b', 'c', 'd'], completed: 0, inflight: 1, next: 1, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(batch, 0);
  recordImageRecipeBatchTarget(batch, { now: 1000 });
  assert.equal(cancelImageRecipeBatch(batch, 2000), true);
  assert.equal(batch.done, false, 'the active worker still owns its submitted image');
  assert.equal(formatImageRecipeBatchTiming(batch, 3000), 'Stopping · admitted images are finishing');

  recordImageRecipeBatchTarget(batch, { now: 3000 });
  batch.inflight = 0;
  assert.equal(completeImageRecipeBatchIfDrained(batch, 5000), true);
  assert.equal(formatImageRecipeBatchTiming(batch, 50_000), 'Stopped · 0.4 images/s average · now 0.4 images/s');
  assert.equal(imageRecipeBatchTiming(batch, 50_000).etaSeconds, null, 'canceled queued targets never receive an ETA');
});

test('canceling a paused batch times admitted renders until their drain completes', () => {
  const batch = { targets: ['a', 'b', 'c'], completed: 0, inflight: 1, next: 2, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(batch, 0);
  recordImageRecipeBatchTarget(batch, { now: 500 });
  pauseImageRecipeBatchClock(batch, 1000);
  batch.paused = true;
  recordImageRecipeBatchTarget(batch, { skipped: true });

  assert.equal(cancelImageRecipeBatch(batch, 5000), true);
  assert.equal(batch.activeSince, 5000, 'the in-flight drain starts a fresh active-time interval after cancellation');
  assert.equal(batch.paused, false);
  recordImageRecipeBatchTarget(batch, { now: 6000 });
  batch.inflight = 0;
  assert.equal(completeImageRecipeBatchIfDrained(batch, 7000), true);

  assert.equal(imageRecipeBatchTiming(batch, 50_000).elapsedMs, 3000, 'paused time is excluded but the cancellation drain is included');
  assert.equal(imageRecipeBatchTiming(batch, 50_000).imagesPerSecond, 2 / 3, 'the admitted render finishing during drain contributes to the average');
  assert.equal(formatImageRecipeBatchTiming(batch, 50_000), 'Stopped · 0.7 images/s average · now 0.7 images/s');
});

test('a targeted retry begins with fresh timing and sub-second estimates stay provisional', () => {
  const retry = { targets: ['failed-a', 'failed-b'], completed: 0, inflight: 0, next: 0, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(retry, 10_000);
  recordImageRecipeBatchTarget(retry, { now: 10_250 });
  assert.equal(formatImageRecipeBatchTiming(retry, 10_250), '4.0 images/s average · now 1.0 images/s · estimating ETA');
  assert.equal(imageRecipeBatchTiming(retry, 10_250).elapsedMs, 250);
  assert.equal(imageRecipeBatchTiming(retry, 15_251).recentImagesPerSecond, 0,
    'the live rate returns to zero after no image has completed for five active seconds');
  assert.ok(imageRecipeBatchTiming(retry, 15_251).imagesPerSecond > 0,
    'the historical average remains available for stable ETA estimates');
});

test('clock skew and no timed renders never produce negative elapsed time or an infinite rate', () => {
  const batch = { targets: ['a'], completed: 0, inflight: 0, next: 0, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(batch, 500);
  recordImageRecipeBatchTarget(batch, { now: 600 });
  const timing = imageRecipeBatchTiming(batch, 100);
  assert.deepEqual(timing, { elapsedMs: 0, imagesPerSecond: 0, recentImagesPerSecond: 0, remaining: 0, etaSeconds: null });
  assert.equal(formatImageRecipeBatchTiming(batch, 100), 'Starting · 0 images left · now 0.0 images/s');
});
