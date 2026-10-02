import test from 'node:test';
import assert from 'node:assert/strict';
import { formatImageRecipeWorkerReadout, imageRecipeBatchAnnouncement } from '../src/bulk-recipe-a11y.js';

const activeBatch = {
  recipe: { name: 'Warm light' }, targets: ['a', 'b', 'c'], completed: 0,
  failed: 0, skipped: 0, skippedLocked: 0, excludedLocked: 0, superseded: 0
};

test('active batch announcements remain stable while individual images finish', () => {
  assert.equal(imageRecipeBatchAnnouncement(activeBatch), 'Applying Warm light to 3 images.');
  assert.equal(imageRecipeBatchAnnouncement({ ...activeBatch, completed: 1 }), 'Applying Warm light to 3 images.');
  assert.equal(imageRecipeBatchAnnouncement({ ...activeBatch, completed: 2 }), 'Applying Warm light to 3 images.');
});

test('worker readout keeps active batch work visible beside its adjustable cap', () => {
  assert.equal(formatImageRecipeWorkerReadout(0, 2), '0/2 active');
  assert.equal(formatImageRecipeWorkerReadout(3, 4), '3/4 active');
  assert.equal(formatImageRecipeWorkerReadout(-1, 0), '0/1 active');
  assert.equal(formatImageRecipeWorkerReadout(Number.NaN, Number.NaN), '0/1 active');
});

test('batch announcements describe pause, failure, save, and final outcomes', () => {
  assert.match(imageRecipeBatchAnnouncement({ ...activeBatch, paused: true }), /paused/u);
  assert.match(imageRecipeBatchAnnouncement({ ...activeBatch, journalPending: true }), /recovery point/u);
  assert.match(imageRecipeBatchAnnouncement({ ...activeBatch, savePending: true, done: true }), /Saving the changes/u);
  assert.equal(imageRecipeBatchAnnouncement({ ...activeBatch, completed: 3, done: true }), 'Warm light finished: 3 updated.');
  assert.equal(imageRecipeBatchAnnouncement({ ...activeBatch, completed: 3, failed: 1, done: true }), 'Warm light finished: 2 updated, 1 failed.');
  assert.match(imageRecipeBatchAnnouncement({ ...activeBatch, ownershipLost: true }), /Another tab owns/u);
});
