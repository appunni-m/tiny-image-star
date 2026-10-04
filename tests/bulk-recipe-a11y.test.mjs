import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatImageRecipeWorkerReadout, imageRecipeBatchAnnouncement } from '../src/bulk-recipe-a11y.js';

const [html, main] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
]);

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

test('the live visual batch progress exposes its current image count to assistive technology', () => {
  const progress = html.match(/<div class="bulk-progress-track"[^>]*>/)?.[0] || '';
  assert.match(progress, /role="progressbar"/);
  assert.match(progress, /aria-label="Images processed"/);
  assert.match(progress, /aria-valuemin="0"[^>]*aria-valuemax="1"[^>]*aria-valuenow="0"/);
  assert.match(progress, /aria-valuetext="0 of 0 images processed"/);
  assert.match(main, /progressTrack\.setAttribute\('aria-valuemax', String\(Math\.max\(1, total\)\)\)/);
  assert.match(main, /progressTrack\.setAttribute\('aria-valuenow', String\(Math\.min\(total, bulk\.completed\)\)\)/);
  assert.match(main, /progressTrack\.setAttribute\('aria-valuetext', `\$\{Math\.min\(total, bulk\.completed\)\} of \$\{total\} images processed`\)/);
});

test('batch announcements describe pause, failure, save, and final outcomes', () => {
  assert.match(imageRecipeBatchAnnouncement({ ...activeBatch, paused: true }), /paused/u);
  assert.match(imageRecipeBatchAnnouncement({ ...activeBatch, journalPending: true }), /recovery point/u);
  assert.match(imageRecipeBatchAnnouncement({ ...activeBatch, savePending: true, done: true }), /Saving the changes/u);
  assert.equal(imageRecipeBatchAnnouncement({ ...activeBatch, completed: 3, done: true }), 'Warm light finished: 3 updated.');
  assert.equal(imageRecipeBatchAnnouncement({ ...activeBatch, completed: 3, failed: 1, done: true }), 'Warm light finished: 2 updated, 1 failed.');
  assert.match(imageRecipeBatchAnnouncement({ ...activeBatch, ownershipLost: true }), /Another tab owns/u);
});

test('long recipe names remain discoverable when batch and recovery titles are visually truncated', () => {
  assert.match(main, /const titleText = [^;]*bulk\.recipe\.name[^;]*;[\s\S]*?\$\('#bulk-title'\)\.textContent = titleText;[\s\S]*?\$\('#bulk-title'\)\.title = titleText;/,
    'the active bar should expose the complete title shown in its truncated heading');
  assert.match(main, /const recipeName = recovery\.recipe\.name \|\| 'Image recipe';[\s\S]*?\$\('#recipe-recovery-recipe'\)\.textContent = recipeName;[\s\S]*?\$\('#recipe-recovery-recipe'\)\.title = recipeName;/,
    'the interrupted-batch prompt should expose its complete recipe name too');
});
