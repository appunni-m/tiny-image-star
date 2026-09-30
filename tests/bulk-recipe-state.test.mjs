import test from 'node:test';
import assert from 'node:assert/strict';
import { canDismissImageRecipeBatch, cancelImageRecipeBatch, completeImageRecipeBatchIfDrained, formatImageRecipeBatchTiming, imageRecipeBatchTiming, isImageRecipeBatchActive, pauseImageRecipeBatchClock, recordImageRecipeBatchTarget, resumeImageRecipeBatchClock, startImageRecipeBatchClock } from '../src/bulk-recipe-state.js';

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
  recordImageRecipeBatchTarget(batch);
  recordImageRecipeBatchTarget(batch, { failed: true, targetId: 'image-1' });

  assert.deepEqual(imageRecipeBatchTiming(batch, 3000), {
    elapsedMs: 2000,
    imagesPerSecond: 1,
    remaining: 6,
    etaSeconds: 6
  });
  assert.equal(formatImageRecipeBatchTiming(batch, 3000), '1.0 images/s · about 6s left');
});

test('throughput counts terminal success, failure, superseded, and skipped targets but excludes cancellation', () => {
  const batch = { targets: ['a', 'b', 'c', 'd', 'e'], completed: 0, inflight: 0, next: 5, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(batch, 0);
  recordImageRecipeBatchTarget(batch);
  recordImageRecipeBatchTarget(batch, { failed: true, targetId: 'b' });
  recordImageRecipeBatchTarget(batch, { superseded: true });
  recordImageRecipeBatchTarget(batch, { skipped: true });
  assert.equal(recordImageRecipeBatchTarget(batch, { canceled: true }), false);

  assert.deepEqual(imageRecipeBatchTiming(batch, 2000), {
    elapsedMs: 2000,
    imagesPerSecond: 2,
    remaining: 1,
    etaSeconds: 0.5
  });
});

test('pausing freezes both elapsed time and throughput additions until the batch resumes', () => {
  const batch = { targets: ['a', 'b', 'c', 'd'], completed: 0, inflight: 2, next: 2, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(batch, 100);
  recordImageRecipeBatchTarget(batch);
  pauseImageRecipeBatchClock(batch, 2100);
  batch.paused = true;
  recordImageRecipeBatchTarget(batch, { skipped: true });

  assert.deepEqual(imageRecipeBatchTiming(batch, 50_000), {
    elapsedMs: 2000,
    imagesPerSecond: 0.5,
    remaining: 2,
    etaSeconds: 4
  }, 'paused time and paused completions must not inflate the displayed rate');
  assert.equal(formatImageRecipeBatchTiming(batch, 50_000), 'Paused · 0.5 images/s · about 4s after resume');

  batch.paused = false;
  assert.equal(resumeImageRecipeBatchClock(batch, 50_000), true);
  recordImageRecipeBatchTarget(batch);
  const resumed = imageRecipeBatchTiming(batch, 52_000);
  assert.equal(resumed.elapsedMs, 4000, 'the 48-second pause is excluded from active elapsed time');
  assert.equal(resumed.imagesPerSecond, 0.5, 'the resumed completion is counted without including the paused interval');
  assert.equal(resumed.remaining, 1);
});

test('canceling suppresses ETA while admitted work drains and freezes the final average', () => {
  const batch = { targets: ['a', 'b', 'c', 'd'], completed: 0, inflight: 1, next: 1, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(batch, 0);
  recordImageRecipeBatchTarget(batch);
  assert.equal(cancelImageRecipeBatch(batch, 2000), true);
  assert.equal(batch.done, false, 'the active worker still owns its submitted image');
  assert.equal(formatImageRecipeBatchTiming(batch, 3000), 'Stopping · admitted images are finishing');

  recordImageRecipeBatchTarget(batch);
  batch.inflight = 0;
  assert.equal(completeImageRecipeBatchIfDrained(batch, 5000), true);
  assert.equal(formatImageRecipeBatchTiming(batch, 50_000), 'Stopped · 0.4 images/s average');
  assert.equal(imageRecipeBatchTiming(batch, 50_000).etaSeconds, null, 'canceled queued targets never receive an ETA');
});

test('canceling a paused batch times admitted renders until their drain completes', () => {
  const batch = { targets: ['a', 'b', 'c'], completed: 0, inflight: 1, next: 2, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(batch, 0);
  recordImageRecipeBatchTarget(batch);
  pauseImageRecipeBatchClock(batch, 1000);
  batch.paused = true;
  recordImageRecipeBatchTarget(batch, { skipped: true });

  assert.equal(cancelImageRecipeBatch(batch, 5000), true);
  assert.equal(batch.activeSince, 5000, 'the in-flight drain starts a fresh active-time interval after cancellation');
  assert.equal(batch.paused, false);
  recordImageRecipeBatchTarget(batch);
  batch.inflight = 0;
  assert.equal(completeImageRecipeBatchIfDrained(batch, 7000), true);

  assert.equal(imageRecipeBatchTiming(batch, 50_000).elapsedMs, 3000, 'paused time is excluded but the cancellation drain is included');
  assert.equal(imageRecipeBatchTiming(batch, 50_000).imagesPerSecond, 2 / 3, 'the admitted render finishing during drain contributes to the average');
  assert.equal(formatImageRecipeBatchTiming(batch, 50_000), 'Stopped · 0.7 images/s average');
});

test('a targeted retry begins with fresh timing and sub-second estimates stay provisional', () => {
  const retry = { targets: ['failed-a', 'failed-b'], completed: 0, inflight: 0, next: 0, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(retry, 10_000);
  recordImageRecipeBatchTarget(retry);
  assert.equal(formatImageRecipeBatchTiming(retry, 10_250), '4.0 images/s · estimating ETA');
  assert.equal(imageRecipeBatchTiming(retry, 10_250).elapsedMs, 250);
});

test('clock skew and no timed renders never produce negative elapsed time or an infinite rate', () => {
  const batch = { targets: ['a'], completed: 0, inflight: 0, next: 0, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(batch, 500);
  recordImageRecipeBatchTarget(batch);
  const timing = imageRecipeBatchTiming(batch, 100);
  assert.deepEqual(timing, { elapsedMs: 0, imagesPerSecond: 0, remaining: 0, etaSeconds: null });
  assert.equal(formatImageRecipeBatchTiming(batch, 100), 'Starting · 0 images left');
});
