import test from 'node:test';
import assert from 'node:assert/strict';
import { canDismissImageRecipeBatch, cancelImageRecipeBatch, completeImageRecipeBatchIfDrained, isImageRecipeBatchActive, recordImageRecipeBatchTarget } from '../src/bulk-recipe-state.js';

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
