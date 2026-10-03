import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activeImageRecipeRenderTargets, canDismissImageRecipeBatch, cancelImageRecipeBatch, completeImageRecipeBatchIfDrained, formatImageRecipeBatchTiming, hydrateAndAdmitImageRecipeTarget, imageRecipeBatchTiming, imageRecipeRenderIsCurrent, isImageRecipeBatchActive, pauseImageRecipeBatchClock, recordImageRecipeBatchTarget, resumeImageRecipeBatchClock, startImageRecipeBatchClock } from '../src/bulk-recipe-state.js';

const editorSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

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

test('bulk recipe admission reuses a mutation-aware page index across the full job lifecycle', () => {
  const scheduleStart = editorSource.indexOf('function scheduleBulk()');
  const scheduleEnd = editorSource.indexOf('\nfunction restoreImageRecipeBatchConcurrency', scheduleStart);
  const schedule = editorSource.slice(scheduleStart, scheduleEnd);
  assert.match(schedule, /findBulkRecipeTarget\(bulk, id\)/,
    'scheduling must resolve targets through the reusable page index');
  assert.doesNotMatch(schedule, /findNode\(state\.document, id, bulk\.pageId\)/,
    'each admission must not rescan the entire layer tree');
  assert.match(schedule, /targetEntry: currentEntry/,
    'ordinary recipe mutation must reuse the admitted current entry');

  const start = editorSource.indexOf('function startRecipe(');
  const end = editorSource.indexOf('\nfunction cancelBulkRecipe', start);
  const startRecipe = editorSource.slice(start, end);
  assert.match(startRecipe, /const uniqueTargets = \[\.\.\.new Set\(targets\)\];[\s\S]*?createPageNodeIndex\(state\.document, pageId, \{[\s\S]*?nodeIds: uniqueTargets,[\s\S]*?preserveNodeIdentity: true[\s\S]*?\}\)/,
    'one target-only page traversal should pin selected image IDs before resolving them');
  assert.match(startRecipe, /localAiRequired = imageRecipeUsesLocalModel\(recipe\)/,
    'every recipe inference stage, including object erase, should reserve the local model lane');
  assert.match(startRecipe, /uniqueTargets\.map\(id => \(\{ id, entry: nodeIndex\.find\(id\) \}\)\)/,
    'initial filtering should be linear in the batch size after the target-only index is built');

  const lookupStart = editorSource.indexOf('function findBulkRecipeTarget(');
  const lookupEnd = editorSource.indexOf('\nfunction releaseBulkNodeIndexWhenDrained', lookupStart);
  assert.match(editorSource.slice(lookupStart, lookupEnd), /if \(bulk\?\.nodeIndex && pageId === bulk\.pageId\) return bulk\.nodeIndex\.find\(nodeId\)/,
    'asynchronous fences must revalidate identity, ancestry, and lock state through the index');
  assert.match(editorSource, /withLocalModelWorkerSlot\(\s*\(\) => inpaintEngine\.run/,
    'object erase inference must share the local model lane with background removal and expansion');
  assert.match(editorSource, /withLocalModelWorkerSlot\(\(\) => objectIsolationEngine\.run/,
    'subject isolation inference must also share that lane');
});

test('pre-render recipe failures still use the target start version to fence rollback', () => {
  const batch = { renderVersions: new Map() };
  assert.equal(imageRecipeRenderIsCurrent(batch, 'image-a', 3, 3), true);
  assert.equal(imageRecipeRenderIsCurrent(batch, 'image-a', 3, 4), false,
    'a newer user preview after the batch started protects that edit from rollback');
  batch.renderVersions.set('image-a', 8);
  assert.equal(imageRecipeRenderIsCurrent(batch, 'image-a', 3, 8), true);
  assert.equal(imageRecipeRenderIsCurrent(batch, 'image-a', 3, 9), false,
    'a newer edit after the batch preview was admitted protects that edit too');
});

test('bulk cancellation visits only active recipe renders in large batches', () => {
  const activeIds = ['queued-current', 'running-current', 'queued-stale', 'hydrating'];
  const currentVersions = new Map([
    ['queued-current', 4],
    ['running-current', 9],
    ['queued-stale', 12],
    ['hydrating', 1],
  ]);
  const batch = {
    targets: Array.from({ length: 100_000 }, (_, index) => `image-${index}`),
    activeControllers: new Map(activeIds.map(id => [id, {}])),
    renderVersions: new Map([
      ['queued-current', 4],
      ['running-current', 9],
      ['queued-stale', 11],
      // A hydrating target has no queued Pillow render to cancel yet.
    ]),
  };
  const checkedVersions = [];
  const renderTargets = activeImageRecipeRenderTargets(batch, id => {
    checkedVersions.push(id);
    return currentVersions.get(id);
  });

  assert.deepEqual(renderTargets, ['queued-current', 'running-current']);
  assert.deepEqual(checkedVersions, ['queued-current', 'running-current', 'queued-stale'],
    'version checks skip still-hydrating controllers and scale with active renders, not 100,000 historical targets');

  const cancelStart = editorSource.indexOf('function cancelBulkRecipe()');
  const cancelEnd = editorSource.indexOf('\nfunction retryFailedRecipeTargets', cancelStart);
  const cancel = editorSource.slice(cancelStart, cancelEnd);
  assert.match(cancel, /activeImageRecipeRenderTargets\(bulk, targetId => state\.renderVersion\.get\(targetId\)\)/,
    'cancellation only probes currently owned renders and still fences newer edits');
  assert.doesNotMatch(cancel, /bulk\.targets\.slice\(0, bulk\.next\)/,
    'the old cancellation scan over every previously admitted image must remain absent');
});

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

test('drained batches release per-image fences while retaining recovery and retry data', () => {
  const targets = Array.from({ length: 100_000 }, (_, index) => `image-${index}`);
  const batch = {
    targets, next: targets.length, inflight: 1, completed: targets.length - 1,
    failedTargets: ['image-7'], paused: false, cancelled: false, done: false,
    activeControllers: new Map([['image-99999', {}]]),
    renderVersions: new Map(targets.map((id, index) => [id, index + 1])),
    previousStatuses: new Map(targets.map(id => [id, 'Ready · original image'])),
    restorePreviews: new Set(targets),
  };

  assert.equal(completeImageRecipeBatchIfDrained(batch), false,
    'do not release fences before the last admitted render has settled');
  assert.equal(batch.renderVersions.size, targets.length);

  batch.inflight = 0;
  assert.equal(completeImageRecipeBatchIfDrained(batch), true);
  assert.equal(batch.done, true);
  assert.equal(batch.activeControllers.size, 0);
  assert.equal(batch.renderVersions.size, 0);
  assert.equal(batch.previousStatuses.size, 0);
  assert.equal(batch.restorePreviews.size, 0);
  assert.equal(batch.targets, targets, 'target IDs remain available to the recovery lease and result count');
  assert.equal(batch.failedTargets[0], 'image-7', 'failed targets remain available for targeted retry');
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

test('large batches index failed image IDs without repeated linear scans', () => {
  const targetCount = 25_000;
  const batch = { completed: 0, failed: 0, failedTargets: [] };
  for (let index = 0; index < targetCount; index += 1) {
    recordImageRecipeBatchTarget(batch, { failed: true, targetId: `image-${index}` });
  }

  assert.equal(batch.failed, targetCount);
  assert.equal(batch.failedTargets.length, targetCount);
  assert.equal(batch.failedTargets[0], 'image-0');
  assert.equal(batch.failedTargets.at(-1), `image-${targetCount - 1}`);
  recordImageRecipeBatchTarget(batch, { failed: true, targetId: 'image-0' });
  assert.equal(batch.failedTargets.length, targetCount, 'a repeated failure remains a single retry target');
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

test('high-rate batch timing keeps a bounded rolling window without rescanning prior results', () => {
  const batch = { targets: Array.from({ length: 50_000 }, (_, index) => `image-${index}`), completed: 0, inflight: 0, next: 50_000, paused: false, cancelled: false, done: false };
  startImageRecipeBatchClock(batch, 0);
  for (let index = 1; index <= 50_000; index += 1) {
    recordImageRecipeBatchTarget(batch, { now: index });
  }

  const timing = imageRecipeBatchTiming(batch, 50_000);
  assert.equal(timing.recentImagesPerSecond, 1000.2, 'the inclusive five-second boundary matches the previous rate definition');
  assert.ok(batch.timingCompletionHead > 0 || batch.timingCompletionTimes.length < 6000,
    'old completions are removed from the active rolling window');
  assert.ok(batch.timingCompletionTimes.length < 12_000,
    'the stored rate history stays near twice the five-second window even after tens of thousands of results');
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
