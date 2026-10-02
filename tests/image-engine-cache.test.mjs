import test from 'node:test';
import assert from 'node:assert/strict';
import { DecodedSourceCache, imageCacheDimensionForBudget } from '../src/decoded-source-cache.js';
import { assertSafeRasterDimensions, defaultActiveRenderMemoryBudget, defaultImageCachePixelBudget, defaultSingleImageRenderMemoryBudget, estimateImageWorkingSetBytes, inspectRasterDimensions, LocalImageEngine } from '../src/image-engine.js';
import { ImageMemoryLimitError } from '../src/image-memory-budget.js';

const PIXEL_BUDGET = 5;

test('preview cache dimensions fit the configured pixel ceiling across normal and extreme aspect ratios', () => {
  for (const [width, height, budget] of [[4000, 3000, 10_000_000], [80_000_000, 1, 16_000_000], [4, 2, 3]]) {
    const edge = imageCacheDimensionForBudget(width, height, budget);
    assert.ok(Number.isSafeInteger(edge) && edge > 0 && edge <= Math.max(width, height));
    const longer = Math.max(width, height);
    const shorter = Math.min(width, height);
    const minor = Math.max(1, Math.ceil(edge * shorter / longer));
    assert.ok(edge * minor <= budget, `${edge} × ${minor} should fit ${budget} cached pixels`);
  }
  assert.equal(imageCacheDimensionForBudget(4, 2, 8), null, 'a source already inside the budget stays full resolution');
  assert.equal(imageCacheDimensionForBudget(4, 2, 0), null, 'a disabled cache does not downsample ephemeral renders');
  assert.throws(() => imageCacheDimensionForBudget(0, 2, 3), /dimensions/);
});

function makeSource(width) {
  return { width, height: 1, freeCalls: 0, free() { this.freeCalls += 1; } };
}

class CacheWorkerMock {
  constructor() {
    this.onmessage = null;
    this.onError = null;
    this.cache = new DecodedSourceCache({ pixelBudget: CacheWorkerMock.initialPixelBudget });
    this.renderRequests = [];
    this.pendingRenderMessages = [];
    this.disposed = [];
    this.cacheBudgets = [];
    this.activeSources = [];
    this.terminated = false;
    queueMicrotask(() => this.#emit({ type: 'ready' }));
  }

  static initialPixelBudget = 16_000_000;
  static deferRenders = false;

  postMessage(message) {
    if (message.type === 'set-active-source') {
      this.cache.setActive(message.assetId);
      this.activeSources.push(message.assetId);
      return;
    }
    if (message.type === 'configure-cache') {
      const result = this.cache.setBudget(message.pixelBudget);
      this.cacheBudgets.push(message.pixelBudget);
      queueMicrotask(() => this.#emit({ type: 'cache-configured', generation: message.generation, ...result }));
      return;
    }
    if (message.type === 'dispose') {
      this.cache.delete(message.assetId);
      this.disposed.push(message.assetId);
      queueMicrotask(() => this.#emit({ type: 'disposed', assetId: message.assetId }));
      return;
    }
    if (message.type !== 'render') return;
    this.renderRequests.push({
      requestId: message.requestId,
      assetId: message.assetId,
      hasSourceBytes: message.sourceBytes instanceof ArrayBuffer,
      adjustments: message.adjustments,
      transforms: message.transforms,
      format: message.format,
      quality: message.quality,
      outputMode: message.outputMode,
      previewMaxDimension: message.previewMaxDimension,
    });
    this.pendingRenderMessages.push(message);
    if (!CacheWorkerMock.deferRenders) queueMicrotask(() => this.completeRender(message.requestId));
  }

  completeNextRender() {
    const message = this.pendingRenderMessages.shift();
    if (!message) return false;
    this.#completeRender(message);
    return true;
  }

  completeRender(requestId) {
    const index = this.pendingRenderMessages.findIndex(message => message.requestId === requestId);
    if (index < 0) return false;
    const [message] = this.pendingRenderMessages.splice(index, 1);
    this.#completeRender(message);
    return true;
  }

  #completeRender(message) {
    try {
      const cachedRender = this.cache.withSource(message.assetId, () => {
        if (!(message.sourceBytes instanceof ArrayBuffer)) throw new Error('The original image is no longer available in memory.');
        const pixelCount = new Uint8Array(message.sourceBytes)[0];
        return makeSource(pixelCount);
      }, source => ({ bytes: new Uint8Array([source.width]), width: source.width, height: 1, mode: message.outputMode }));
      this.#emit({
        type: 'rendered', requestId: message.requestId, assetId: message.assetId,
        sourceRetained: cachedRender.retained,
        evictedAssetIds: cachedRender.evictedAssetIds,
        ...cachedRender.result,
      });
    } catch (error) {
      const state = error.decodedSourceCache;
      this.#emit({
        type: 'error', requestId: message.requestId, assetId: message.assetId,
        sourceRetained: state?.retained, evictedAssetIds: state?.evictedAssetIds || [], message: error.message,
      });
    }
  }

  terminate() { this.terminated = true; this.cache.clear(); }

  crash(message = 'synthetic worker failure') { this.onerror?.({ message }); }

  #emit(data) { if (!this.terminated) this.onmessage?.({ data }); }
}

async function withEngine(run, { maxWorkers = 1, maxCachedPixels = PIXEL_BUDGET, maxActiveRenderBytes, maxSingleRenderBytes = Number.MAX_SAFE_INTEGER, deferRenders = false } = {}) {
  const oldWorker = globalThis.Worker;
  const oldBudget = CacheWorkerMock.initialPixelBudget;
  const oldDeferred = CacheWorkerMock.deferRenders;
  CacheWorkerMock.initialPixelBudget = maxCachedPixels;
  CacheWorkerMock.deferRenders = deferRenders;
  globalThis.Worker = CacheWorkerMock;
  const engine = new LocalImageEngine({ maxWorkers, maxCachedPixels, ...(maxActiveRenderBytes === undefined ? {} : { maxActiveRenderBytes }), ...(maxSingleRenderBytes === null ? {} : { maxSingleRenderBytes }) });
  try {
    await run(engine);
  } finally {
    engine.destroy();
    globalThis.Worker = oldWorker;
    CacheWorkerMock.initialPixelBudget = oldBudget;
    CacheWorkerMock.deferRenders = oldDeferred;
  }
}

const bytesFor = pixels => new Uint8Array([pixels]);

test('LocalImageEngine rejects invalid worker limits before allocating a pool', () => {
  for (const maxWorkers of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new LocalImageEngine({ maxWorkers }), {
      name: 'RangeError',
      message: /worker limit must be a positive safe integer/,
    });
  }
});

test('lowering image concurrency retires idle excess Pillow workers', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(4);
    await new Promise(resolve => setTimeout(resolve, 0));
    const workers = engine.workers.map(slot => slot.worker);
    assert.equal(engine.workers.length, 4);
    assert.equal(engine.metrics().workersReady, 4);

    engine.setConcurrency(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(engine.workers.length, 1, 'idle slots above the restored limit must be terminated');
    assert.equal(engine.workers[0].worker, workers[0], 'the first warm worker remains available for future image edits');
    assert.deepEqual(workers.map(worker => worker.terminated), [false, true, true, true]);
    assert.equal(engine.metrics().workersReady, 1);
  }, { maxWorkers: 4 });
});

test('lowering image concurrency retires busy excess workers after their current render drains', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(4);
    await new Promise(resolve => setTimeout(resolve, 0));
    const workers = engine.workers.map(slot => slot.worker);
    const renders = Array.from({ length: 4 }, (_, index) => engine.render(`retire-${index}`, pngHeader(1, 1), {}));
    assert.equal(engine.metrics().active, 4);

    engine.setConcurrency(1);
    assert.equal(engine.workers.length, 4, 'in-use workers stay alive until their current render settles');
    assert.deepEqual(engine.workers.slice(1).map(slot => slot.retireWhenIdle), [true, true, true]);
    for (const slot of [...engine.workers].slice(1).reverse()) {
      assert.equal(slot.worker.completeNextRender(), true);
      await renders[workers.indexOf(slot.worker)];
    }
    assert.equal(engine.workers.length, 1, 'busy excess slots should retire as soon as they become idle');
    assert.equal(engine.workers[0].worker, workers[0]);
    assert.deepEqual(workers.map(worker => worker.terminated), [false, true, true, true]);

    assert.equal(engine.workers[0].worker.completeNextRender(), true);
    await renders[0];
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(engine.metrics().active, 0);
    assert.equal(engine.metrics().workersReady, 1);
  }, { maxWorkers: 4, deferRenders: true });
});

test('worker retirement keeps healthy capacity when an early slot has failed', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(3);
    await new Promise(resolve => setTimeout(resolve, 0));
    const [failedWorker, firstHealthy, excessHealthy] = engine.workers.map(slot => slot.worker);
    failedWorker.crash('failed first worker');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(engine.workers.length, 3, 'a bounded replacement should restore configured capacity after an initialized worker crashes');
    assert.equal(engine.metrics().workersReady, 3);
    const replacement = engine.workers.find(slot => slot.worker !== firstHealthy && slot.worker !== excessHealthy)?.worker;
    assert.ok(replacement, 'a fresh worker should replace the failed slot');
    assert.equal(failedWorker.terminated, true);

    engine.setConcurrency(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(engine.workers.length, 1);
    assert.equal(engine.workers[0].worker, firstHealthy);
    assert.equal(excessHealthy.terminated, true);
    assert.equal(replacement.terminated, true, 'lowering concurrency also retires an idle replacement');
    await engine.render('after-retirement', bytesFor(1), {});
    assert.equal(firstHealthy.renderRequests.at(-1).assetId, 'after-retirement');
  }, { maxWorkers: 4 });
});

test('repeated worker failures stop after a bounded recovery chain', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    let failures = 0;
    while (engine.workers.length) {
      assert.equal(engine.workers.length, 1);
      engine.workers[0].worker.crash(`bounded failure ${failures + 1}`);
      failures += 1;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(failures, 3, 'one initial worker and at most two replacement workers may fail in one recovery chain');
    assert.equal(engine.metrics().concurrency, 1);
    assert.equal(engine.metrics().workersReady, 0, 'the degraded pool must report its actual ready capacity');
  }, { maxWorkers: 1 });
});

test('terminal worker failure clears paused queue-group counts with the rejected queue', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    engine.pauseQueueGroup('batch:worker-failure');
    const jobs = [
      engine.render('queued-one', pngHeader(1, 1), {}, {}, { queueGroup: 'batch:worker-failure' }),
      engine.render('queued-two', pngHeader(1, 1), {}, {}, { queueGroup: 'batch:worker-failure' }),
    ];
    const settled = Promise.allSettled(jobs);
    assert.deepEqual(engine.queueGroupMetrics('batch:worker-failure'), { active: 0, queued: 2 });

    let failures = 0;
    while (engine.workers.length) {
      engine.workers[0].worker.crash(`queue-group failure ${failures + 1}`);
      failures += 1;
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    assert.equal(failures, 3, 'the queue survives bounded recovery attempts before the pool is declared exhausted');
    assert.ok((await settled).every(item => item.status === 'rejected'));
    assert.equal(engine.metrics().queued, 0);
    assert.deepEqual(engine.queueGroupMetrics('batch:worker-failure'), { active: 0, queued: 0 });
  }, { maxWorkers: 1, deferRenders: true });
});

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

test('LocalImageEngine resends oversized source bytes for each ephemeral render', async () => {
  await withEngine(async engine => {
    const retainedSource = bytesFor(6);
    await engine.render('large', retainedSource, {});
    assert.deepEqual([...retainedSource], [6], 'a worker transfer must not detach or mutate the retained original source');
    await engine.render('large', retainedSource, {});
    assert.deepEqual([...retainedSource], [6], 'subsequent edits still start from the same in-memory source bytes');
    const requests = engine.workers[0].worker.renderRequests;
    assert.deepEqual(requests.map(request => request.hasSourceBytes), [true, true]);
  });
});

test('LocalImageEngine propagates active-source intent and preserves a fitting decoded source through cache pressure', async () => {
  await withEngine(async engine => {
    engine.setActiveSource('active');
    await engine.render('active', bytesFor(4), {});
    const worker = engine.workers[0].worker;
    assert.deepEqual(worker.activeSources, ['active'], 'new workers receive the active selection before their first render');
    assert.equal(worker.cache.activeAssetId, 'active');
    assert.equal(worker.cache.has('active'), true);

    engine.setActiveSource('other');
    await engine.render('other', bytesFor(2), {});
    assert.equal(worker.cache.activeAssetId, 'other');
    assert.equal(worker.cache.has('active'), false, 'a normal render may evict the formerly active source after selection changes');
    assert.equal(worker.cache.has('other'), true);

    engine.setActiveSource(null);
    assert.equal(worker.cache.activeAssetId, null, 'clearing the selection releases the active-source protection');
  });
});

test('the selected source receives the shared cache budget so multi-worker editing reuses large decodes', async () => {
  const selectedCacheBudget = defaultImageCachePixelBudget({ deviceMemory: 8, hardwareConcurrency: 8 });
  await withEngine(async engine => {
    engine.setConcurrency(4);
    await new Promise(resolve => setTimeout(resolve, 0));
    engine.setActiveSource('selected-large');
    await new Promise(resolve => setTimeout(resolve, 0));

    const workers = engine.workers.map(slot => slot.worker);
    assert.deepEqual(engine.workers.map(slot => slot.cacheBudget), [selectedCacheBudget, 0, 0, 0],
      'the active worker can retain a source larger than an even per-worker share');
    assert.equal(engine.workers.reduce((sum, slot) => sum + slot.cacheBudget, 0), selectedCacheBudget,
      'worker cache ceilings never exceed the shared engine allowance');

    await engine.render('selected-large', bytesFor(8), {});
    await engine.render('selected-large', bytesFor(8), { brightness: 12 });
    assert.deepEqual(workers[0].renderRequests.map(request => request.hasSourceBytes), [true, false],
      'successive edits use the same worker-local decoded Pillow source');
    assert.deepEqual(workers.slice(1).map(worker => worker.renderRequests.length), [0, 0, 0]);
  }, { maxWorkers: 4, maxCachedPixels: selectedCacheBudget });
});

test('active-source affinity waits for its owner without blocking unrelated batch work', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(3);
    await new Promise(resolve => setTimeout(resolve, 0));
    engine.setActiveSource('selected');
    await new Promise(resolve => setTimeout(resolve, 0));

    const selectedFirst = engine.render('selected', bytesFor(6), {});
    const selectedAgain = engine.render('selected', bytesFor(6), { brightness: 20 });
    const batchOther = engine.render('batch-other', bytesFor(2), {}, {}, { queueGroup: 'recipe:one' });
    assert.equal(engine.workers[0].worker.pendingRenderMessages[0].assetId, 'selected');
    const batchWorker = engine.workers.find(slot => slot.worker.pendingRenderMessages.some(message => message.assetId === 'batch-other'));
    assert.ok(batchWorker,
      'an active-source update waiting for its owner does not prevent a different recipe image from using an idle worker');
    assert.equal(engine.workers[0].worker.pendingRenderMessages.length, 1,
      'the active source is never decoded concurrently in a second worker');

    batchWorker.worker.completeNextRender();
    await batchOther;
    engine.workers[0].worker.completeNextRender();
    await selectedFirst;
    assert.equal(engine.workers[0].worker.pendingRenderMessages[0].assetId, 'selected');
    engine.workers[0].worker.completeNextRender();
    await selectedAgain;
    assert.deepEqual(engine.workers[0].worker.renderRequests.map(request => request.hasSourceBytes), [true, false]);
  }, { maxWorkers: 3, maxCachedPixels: 10, maxActiveRenderBytes: 8_000_000_000, deferRenders: true });
});

test('LocalImageEngine transfers raw ArrayBuffers and exact typed-view ranges without detaching originals', async () => {
  await withEngine(async engine => {
    const raw = bytesFor(2).buffer;
    const backing = new Uint8Array([99, 3, 88]);
    const view = new DataView(backing.buffer, 1, 1);

    await engine.render('raw-buffer', raw, {});
    await engine.render('data-view', view, {});

    const requests = engine.workers[0].worker.renderRequests;
    assert.deepEqual(requests.map(request => [request.assetId, request.hasSourceBytes]), [
      ['raw-buffer', true], ['data-view', true],
    ]);
    assert.deepEqual([...new Uint8Array(raw)], [2], 'the retained raw original stays attached for later edits');
    assert.deepEqual([...backing], [99, 3, 88], 'a nonzero-offset source view is copied exactly without mutating its owner');
  });
});

test('LocalImageEngine reconciles LRU evictions before scheduling later renders', async () => {
  await withEngine(async engine => {
    await engine.render('a', bytesFor(3), {});
    await engine.render('b', bytesFor(3), {}); // Evicts a from the worker cache.
    await engine.render('a', bytesFor(3), {});
    const requests = engine.workers[0].worker.renderRequests;
    assert.deepEqual(requests.map(request => [request.assetId, request.hasSourceBytes]), [
      ['a', true], ['b', true], ['a', true],
    ]);
  });
});

test('LocalImageEngine omits source bytes for retained cache hits and resends after disposal', async () => {
  await withEngine(async engine => {
    await engine.render('asset', bytesFor(3), {});
    await engine.render('asset', bytesFor(3), {});
    engine.dispose('asset');
    await engine.render('asset', bytesFor(3), {});

    const worker = engine.workers[0].worker;
    assert.deepEqual(worker.renderRequests.map(request => request.hasSourceBytes), [true, false, true]);
    assert.deepEqual(worker.disposed, ['asset']);
  });
});

test('LocalImageEngine snapshots crop and rotation metadata into worker render requests', async () => {
  await withEngine(async engine => {
    const transforms = { crop: { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 }, rotation: 270 };
    const pending = engine.render('asset', bytesFor(2), {}, transforms);
    transforms.crop.left = 0.75;
    await pending;
    assert.deepEqual(engine.workers[0].worker.renderRequests[0].transforms, {
      crop: { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 },
      rotation: 270,
    });
  });
});

test('LocalImageEngine forwards Pillow sharpness settings to the local worker', async () => {
  await withEngine(async engine => {
    await engine.render('asset', bytesFor(2), { sharpness: 73 });
    assert.deepEqual(engine.workers[0].worker.renderRequests[0].adjustments, { sharpness: 73 });
  });
});

test('LocalImageEngine snapshots recipe format and quality into each worker job', async () => {
  await withEngine(async engine => {
    const output = { format: 'webp', quality: 67 };
    const pending = engine.render('asset', bytesFor(2), {}, {}, output);
    output.format = 'jpeg'; output.quality = 10;
    await pending;
    assert.deepEqual(
      [engine.workers[0].worker.renderRequests[0].format, engine.workers[0].worker.renderRequests[0].quality],
      ['webp', 67],
    );
  });
});

test('LocalImageEngine forwards preview dimensions only to interactive preview workers', async () => {
  await withEngine(async engine => {
    await engine.render('asset', bytesFor(2), {}, {}, { previewMaxDimension: 2048 });
    assert.equal(engine.workers[0].worker.renderRequests[0].previewMaxDimension, 2048);

    await engine.renderOutput('asset', bytesFor(2), {}, {}, { previewMaxDimension: 2048 });
    assert.equal(engine.workers[0].worker.renderRequests[1].previewMaxDimension, undefined,
      'export always renders at full source resolution even when a preview cap is accidentally present');
    assert.equal(engine.workers[0].worker.renderRequests[1].hasSourceBytes, true,
      'a full-resolution export receives the immutable original even when a lower-resolution preview is cached');
  });
});

test('LocalImageEngine queues a full-resolution export job separately from lossless preview renders', async () => {
  await withEngine(async engine => {
    const source = bytesFor(3);
    const output = await engine.renderOutput('asset', source, { brightness: 24 }, {
      crop: { left: 0, top: 0, right: 0.5, bottom: 1 }, rotation: 90,
    }, { format: 'webp', quality: 73 });
    assert.equal(output.mode, 'export');
    assert.equal(engine.workers[0].worker.renderRequests[0].outputMode, 'export');
    assert.equal(engine.workers[0].worker.renderRequests[0].format, 'webp');
    assert.equal(engine.workers[0].worker.renderRequests[0].quality, 73);
    assert.deepEqual([...source], [3], 'the export job does not detach or replace retained source bytes');

    await engine.render('asset', source, {}, {}, { format: 'webp', quality: 73 });
    assert.equal(engine.workers[0].worker.renderRequests[1].outputMode, 'preview');
  });
});

test('LocalImageEngine rejects unsupported recipe output options before admitting work', async () => {
  await withEngine(async engine => {
    await assert.rejects(engine.render('asset', bytesFor(2), {}, {}, { format: 'gif' }), /PNG, JPEG, or WebP/);
    await assert.rejects(engine.render('asset', bytesFor(2), {}, {}, { format: 'jpeg', quality: 0 }), /1 to 100/);
    await assert.rejects(engine.render('asset', bytesFor(2), {}, {}, { queueGroup: '' }), /group must be a nonempty string or null/);
    await assert.rejects(engine.render('asset', bytesFor(2), {}, {}, { previewMaxDimension: 0 }), /positive safe integer/);
    assert.equal(engine.metrics().queued, 0);
  });
});

test('a paused queue group holds queued work while unrelated jobs run, then resumes once in FIFO order', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(2);
    await new Promise(resolve => setTimeout(resolve, 0));

    const firstBlocker = engine.render('blocker-first', pngHeader(1, 1), {});
    const secondBlocker = engine.render('blocker-second', pngHeader(1, 1), {});
    const pausedBatch = engine.render('paused-batch', pngHeader(1, 1), {}, {}, { queueGroup: 'batch:test' });
    assert.equal(engine.metrics().queued, 1);
    assert.deepEqual(engine.queueGroupMetrics('batch:test'), { active: 0, queued: 1 });
    assert.equal(engine.pauseQueueGroup('batch:test'), true);
    assert.equal(engine.pauseQueueGroup('batch:test'), false, 'pausing an already-held group is idempotent');

    const unrelatedFirst = engine.render('unrelated-first', pngHeader(1, 1), {});
    const unrelatedSecond = engine.render('unrelated-second', pngHeader(1, 1), {});
    const finish = async assetId => {
      const slot = engine.workers.find(item => item.worker.pendingRenderMessages.some(message => message.assetId === assetId));
      assert.ok(slot, `Expected ${assetId} to be active.`);
      const message = slot.worker.pendingRenderMessages.find(item => item.assetId === assetId);
      slot.worker.completeRender(message.requestId);
      return slot;
    };
    const submitted = () => engine.workers.flatMap(slot => slot.worker.renderRequests.map(request => request.assetId));

    const firstWorker = await finish('blocker-first');
    await firstBlocker;
    assert.deepEqual(firstWorker.worker.renderRequests.map(request => request.assetId), ['blocker-first', 'unrelated-first'],
      'the oldest unrelated job bypasses the held batch job');
    assert.equal(submitted().includes('paused-batch'), false, 'the held batch job is not dispatched');

    await finish('unrelated-first');
    await unrelatedFirst;
    assert.deepEqual(firstWorker.worker.renderRequests.map(request => request.assetId), ['blocker-first', 'unrelated-first', 'unrelated-second'],
      'later unrelated work continues in FIFO order while the batch is paused');
    await finish('blocker-second');
    await secondBlocker;
    await finish('unrelated-second');
    await unrelatedSecond;
    assert.equal(engine.metrics().active, 0);
    assert.equal(engine.metrics().queued, 1);
    assert.equal(submitted().includes('paused-batch'), false, 'the held batch remains queued after all unrelated work drains');

    assert.equal(engine.resumeQueueGroup('batch:test'), true);
    assert.equal(engine.resumeQueueGroup('batch:test'), false, 'resuming an already-running group does not redispatch it');
    assert.equal(engine.metrics().active, 1);
    assert.equal(engine.metrics().queued, 0);
    assert.deepEqual(engine.queueGroupMetrics('batch:test'), { active: 1, queued: 0 });
    assert.equal(submitted().filter(assetId => assetId === 'paused-batch').length, 1,
      'the queued batch target is dispatched exactly once after resume');
    await finish('paused-batch');
    await pausedBatch;
    assert.equal(engine.metrics().active, 0);
    assert.equal(engine.metrics().queued, 0);
  }, { maxWorkers: 2, maxCachedPixels: 10, deferRenders: true });
});

test('paused queue groups retain replacement and cancellation behavior', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const active = engine.render('active', pngHeader(1, 1), {});
    const oldQueued = engine.render('preview', pngHeader(1, 1), {}, {}, {
      queueGroup: 'batch:replace', replaceKey: 'preview:layer',
    });
    assert.equal(engine.pauseQueueGroup('batch:replace'), true);
    const oldRejected = assert.rejects(oldQueued, { name: 'AbortError' });
    const latestQueued = engine.render('preview', pngHeader(1, 1), { brightness: 20 }, {}, {
      queueGroup: 'batch:replace', replaceKey: 'preview:layer',
    });
    await oldRejected;
    assert.equal(engine.metrics().queued, 1, 'replacing a paused queued job keeps only the latest request');
    assert.deepEqual(engine.queueGroupMetrics('batch:replace'), { active: 0, queued: 1 },
      'replacement transfers the same single queued slot within its group');
    const latestRejected = assert.rejects(latestQueued, { name: 'AbortError' });
    assert.equal(engine.cancelQueuedByKey('preview:layer'), true);
    await latestRejected;
    assert.equal(engine.metrics().queued, 0, 'keyed cancellation removes a paused queue entry');
    assert.deepEqual(engine.queueGroupMetrics('batch:replace'), { active: 0, queued: 0 },
      'keyed cancellation decrements the paused group count');

    const blocker = engine.workers[0].worker;
    blocker.completeNextRender();
    await active;
    assert.deepEqual(blocker.renderRequests.map(request => request.assetId), ['active'],
      'replaced or canceled paused work never reaches the worker');
    assert.equal(engine.resumeQueueGroup('batch:replace'), true);
  }, { maxWorkers: 1, maxCachedPixels: 10, deferRenders: true });
});

test('cancel-all clears queued counts for paused recipe groups', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const blocker = engine.render('active-blocker', pngHeader(1, 1), {});
    engine.pauseQueueGroup('batch:cancel');
    engine.pauseQueueGroup('batch:other');
    const canceledJobs = [
      ...Array.from({ length: 48 }, (_, index) => engine.render(`cancel-${index}`, pngHeader(1, 1), {}, {}, { queueGroup: 'batch:cancel' })),
      ...Array.from({ length: 7 }, (_, index) => engine.render(`other-${index}`, pngHeader(1, 1), {}, {}, { queueGroup: 'batch:other' })),
    ];
    const settled = Promise.allSettled(canceledJobs);

    assert.deepEqual(engine.queueGroupMetrics('batch:cancel'), { active: 0, queued: 48 });
    assert.deepEqual(engine.queueGroupMetrics('batch:other'), { active: 0, queued: 7 });
    engine.cancelQueued(new DOMException('Canceled for test.', 'AbortError'));
    const outcomes = await settled;
    assert.ok(outcomes.every(item => item.status === 'rejected' && item.reason.name === 'AbortError'));
    assert.equal(engine.metrics().queued, 0);
    assert.deepEqual(engine.queueGroupMetrics('batch:cancel'), { active: 0, queued: 0 });
    assert.deepEqual(engine.queueGroupMetrics('batch:other'), { active: 0, queued: 0 });

    engine.workers[0].worker.completeNextRender();
    await blocker;
    assert.equal(engine.metrics().active, 0);
  }, { maxWorkers: 1, deferRenders: true });
});

test('queued renders with the same replacement key keep only the latest preview', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const worker = engine.workers[0].worker;
    const active = engine.render('asset', bytesFor(1), { brightness: 0 }, {}, { replaceKey: 'preview:layer-1' });
    assert.equal(engine.metrics().active, 1);

    const stale = engine.render('asset', bytesFor(1), { brightness: 10 }, {}, { replaceKey: 'preview:layer-1' });
    const staleRejected = assert.rejects(stale, { name: 'AbortError' });
    const latest = engine.render('asset', bytesFor(1), { brightness: 25 }, {}, { replaceKey: 'preview:layer-1' });
    await staleRejected;

    assert.equal(engine.metrics().queued, 1);
    assert.equal(engine.cancelQueuedByKey('preview:missing'), false);
    worker.completeNextRender();
    await active;
    assert.equal(worker.renderRequests.length, 2, 'the superseded queued render never reaches Pillow-RS');
    assert.equal(worker.renderRequests[1].adjustments.brightness, 25);
    const removedLayer = engine.render('other-asset', bytesFor(1), {}, {}, { replaceKey: 'preview:removed-layer' });
    const removedLayerRejected = assert.rejects(removedLayer, { name: 'AbortError' });
    assert.equal(engine.cancelQueuedByKey('preview:removed-layer'), true);
    await removedLayerRejected;
    assert.equal(engine.metrics().active, 1, 'canceling a queued preview leaves the active render alone');
    worker.completeNextRender();
    await latest;
    assert.equal(engine.metrics().queued, 0);
  }, { deferRenders: true });
});

test('disposing an asset cancels queued source-buffer owners and preserves unrelated work', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const worker = engine.workers[0].worker;
    const active = engine.render('active', pngHeader(1, 1), {});
    const disposed = engine.render('disposed-asset', pngHeader(2, 2), {}, {}, {
      replaceKey: 'preview:disposed-asset', queueGroup: 'recipe:disposed',
    });
    const unrelated = engine.render('unrelated', pngHeader(1, 1), {});
    const disposedRejected = assert.rejects(disposed, { name: 'AbortError' });

    assert.deepEqual(engine.queueGroupMetrics('recipe:disposed'), { active: 0, queued: 1 });
    engine.dispose('disposed-asset');
    await disposedRejected;

    assert.equal(engine.metrics().queued, 1, 'the unrelated queued render remains scheduled');
    assert.deepEqual(engine.queueGroupMetrics('recipe:disposed'), { active: 0, queued: 0 });
    assert.equal(engine.cancelQueuedByKey('preview:disposed-asset'), false,
      'disposing a source also clears its queued replacement index');
    assert.deepEqual(worker.disposed, ['disposed-asset']);

    worker.completeNextRender();
    await active;
    assert.deepEqual(worker.renderRequests.map(request => request.assetId), ['active', 'unrelated'],
      'a disposed source is never copied into or processed by the worker');
    worker.completeNextRender();
    await unrelated;
    assert.equal(engine.metrics().queued, 0);
  }, { maxWorkers: 1, deferRenders: true });
});

test('LocalImageEngine forgets an unconfirmed cache entry after a missing-source error', async () => {
  await withEngine(async engine => {
    await engine.render('asset', bytesFor(3), {});
    const worker = engine.workers[0].worker;
    worker.cache.clear(); // Simulate a worker losing an entry before it could report eviction.
    await assert.rejects(engine.render('asset', bytesFor(3), {}), /original image is no longer available/);
    await engine.render('asset', bytesFor(3), {});

    assert.deepEqual(worker.renderRequests.map(request => request.hasSourceBytes), [true, false, true]);
  });
});

test('worker cache shares are rebalanced on concurrency changes and report budget evictions', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(1);
    await engine.render('a', bytesFor(8), {});
    const firstWorker = engine.workers[0].worker;
    assert.equal(firstWorker.cache.pixelBudget, 10);
    assert.equal(engine.workers[0].loaded.has('a'), true);

    engine.setConcurrency(2);
    await new Promise(resolve => setTimeout(resolve, 0));
    const secondWorker = engine.workers[1].worker;
    assert.deepEqual([firstWorker.cache.pixelBudget, secondWorker.cache.pixelBudget], [5, 5]);
    assert.deepEqual([firstWorker.cache.pixels, secondWorker.cache.pixels], [0, 0]);
    assert.equal(engine.workers[0].loaded.has('a'), false);
    assert.deepEqual(firstWorker.cacheBudgets, [10, 5]);

    await engine.render('a', bytesFor(8), {});
    assert.equal(firstWorker.renderRequests.at(-1).hasSourceBytes, true);
    assert.equal(firstWorker.cache.pixelBudget + secondWorker.cache.pixelBudget, 10);
  }, { maxWorkers: 2, maxCachedPixels: 10 });
});

test('reducing concurrency drops idle worker caches and retires the excess WASM worker', async () => {
  await withEngine(async engine => {
    await Promise.all([
      engine.render('a', bytesFor(4), {}),
      engine.render('b', bytesFor(4), {}),
    ]);
    const [firstWorker, secondWorker] = engine.workers.map(slot => slot.worker);
    assert.deepEqual([firstWorker.cache.pixelBudget, secondWorker.cache.pixelBudget], [3, 2]);

    engine.setConcurrency(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual([firstWorker.cache.pixelBudget, secondWorker.cache.pixelBudget], [5, 2]);
    assert.equal(firstWorker.cache.pixels <= 5, true);
    assert.equal(secondWorker.terminated, true, 'the idle worker is terminated to release its initialized WASM runtime');
    assert.equal(engine.workers.length, 1);
  }, { maxWorkers: 2, maxCachedPixels: 5 });
});

test('scheduler sends the FIFO head to an idle worker that already retains its source', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(2);
    await new Promise(resolve => setTimeout(resolve, 0));
    const [coldSlot, warmSlot] = engine.workers;

    // Model a source retained by the second worker after an earlier render.
    warmSlot.worker.cache.withSource('shared', () => makeSource(2), source => source);
    warmSlot.loaded.add('shared');

    await engine.render('shared', bytesFor(2), {});

    assert.equal(coldSlot.worker.renderRequests.length, 0);
    assert.deepEqual(warmSlot.worker.renderRequests.map(request => [request.assetId, request.hasSourceBytes]), [
      ['shared', false],
    ]);
  }, { maxWorkers: 2, maxCachedPixels: 10 });
});

test('active render estimates include raster dimensions and transferable source bytes', () => {
  const expected = 6 * 32;
  const gif = new Uint8Array(10); gif.set(new TextEncoder().encode('GIF89a')); new DataView(gif.buffer).setUint16(6, 2, true); new DataView(gif.buffer).setUint16(8, 3, true);
  const bmp = new Uint8Array(26); bmp.set(new TextEncoder().encode('BM')); new DataView(bmp.buffer).setUint32(14, 40, true); new DataView(bmp.buffer).setInt32(18, 2, true); new DataView(bmp.buffer).setInt32(22, -3, true);
  const jpeg = new Uint8Array(15); jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 8]); new DataView(jpeg.buffer).setUint16(7, 3); new DataView(jpeg.buffer).setUint16(9, 2); jpeg[11] = 1;
  const webp = new Uint8Array(30); webp.set(new TextEncoder().encode('RIFF')); new DataView(webp.buffer).setUint32(4, 22, true); webp.set(new TextEncoder().encode('WEBPVP8X'), 8); new DataView(webp.buffer).setUint32(16, 10, true); webp[24] = 2; webp[27] = 1;

  for (const source of [pngHeader(2, 3), gif, bmp, jpeg, webp]) assert.equal(estimateImageWorkingSetBytes(source), expected + source.byteLength);
  assert.equal(estimateImageWorkingSetBytes(bytesFor(1)), 80_000_000 * 32 + 1, 'unknown encodings use the full decoder pixel ceiling plus their transferable source bytes');

  const metadataHeavy = new Uint8Array(4096);
  metadataHeavy.set(pngHeader(1, 1));
  assert.equal(estimateImageWorkingSetBytes(metadataHeavy), 32 + metadataHeavy.byteLength,
    'a compressed image with a tiny pixel count still accounts for its large worker input copy');
});

test('large compressed source payloads are rejected by the hard working-set ceiling before worker allocation', async () => {
  await withEngine(async engine => {
    const metadataHeavy = new Uint8Array(2048);
    metadataHeavy.set(pngHeader(1, 1));
    await assert.rejects(engine.render('metadata-heavy', metadataHeavy, {}), error => {
      assert.ok(error instanceof ImageMemoryLimitError);
      assert.equal(error.budgetKind, 'wasm-working-set');
      assert.match(error.message, /temporary Pillow-RS memory/);
      return true;
    });
    assert.equal(engine.workers.length, 0, 'oversized source copies fail before starting a worker');
    assert.equal(engine.metrics().queued, 0);
  }, { maxSingleRenderBytes: 1024 });
});

test('WebP preflight reads dimensions from a bounded prefix of large image chunks', () => {
  const webp = (type, chunkBytes, payload) => {
    const bytes = new Uint8Array(20 + payload.length);
    bytes.set(new TextEncoder().encode('RIFF'), 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, 12 + chunkBytes + (chunkBytes & 1), true);
    bytes.set(new TextEncoder().encode('WEBP'), 8);
    bytes.set(new TextEncoder().encode(type), 12);
    view.setUint32(16, chunkBytes, true);
    bytes.set(payload, 20);
    return bytes;
  };

  const lossy = webp('VP8 ', 2_000_000, [0, 0, 0, 0x9d, 0x01, 0x2a, 0x80, 0x02, 0xe0, 0x01]);
  assert.deepEqual(inspectRasterDimensions(lossy), { width: 640, height: 480, pixels: 307_200 });
  assert.equal(assertSafeRasterDimensions(lossy).pixels, 307_200);

  const lossless = webp('VP8L', 2_000_000, [0x2f, 62, 129, 52, 0]);
  assert.deepEqual(inspectRasterDimensions(lossless), { width: 319, height: 211, pixels: 67_309 });
  assert.equal(inspectRasterDimensions(lossy.subarray(0, 25)), null, 'a prefix that omits dimension bytes must still fail closed');
  assert.equal(inspectRasterDimensions(webp('VP8 ', 10, [0, 0, 0, 0x9d, 0x01, 0x2a, 0x80, 0x02, 0xe0, 0x01]).subarray(0, 25)), null,
    'truncated chunk payloads must not be read past the supplied prefix');
});

test('active render admission honors the byte budget, uses available parallelism, and preserves FIFO', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(2);
    await new Promise(resolve => setTimeout(resolve, 0));

    const first = engine.render('first', pngHeader(2, 2), {}); // 128 decoded-working bytes + 24 source bytes
    const second = engine.render('second', pngHeader(2, 2), {}); // fills the 304-byte budget
    const third = engine.render('third', pngHeader(1, 1), {}); // waits behind FIFO head
    assert.deepEqual(engine.metrics(), { concurrency: 2, workersReady: 2, active: 2, activeRenderBytes: 304, maxActiveRenderBytes: 304, queued: 1, paused: false });

    engine.workers[0].worker.completeNextRender();
    assert.equal(engine.metrics().activeRenderBytes, 208);
    assert.equal(engine.metrics().queued, 0);
    assert.deepEqual(engine.workers[0].worker.renderRequests.map(item => item.assetId), ['first', 'third']);
    assert.deepEqual(engine.workers[1].worker.renderRequests.map(item => item.assetId), ['second']);

    engine.workers[0].worker.completeNextRender();
    engine.workers[1].worker.completeNextRender();
    await Promise.all([first, second, third]);
    assert.equal(engine.metrics().activeRenderBytes, 0);
  }, { maxWorkers: 2, maxCachedPixels: 10, maxActiveRenderBytes: 304, deferRenders: true });
});

test('a memory-blocked queue head does not idle a worker when a later image fits', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(2);
    await new Promise(resolve => setTimeout(resolve, 0));

    const active = engine.render('active-184', pngHeader(5, 1), {});
    const large = engine.render('blocked-152', pngHeader(4, 1), {});
    const fitting = engine.render('fitting-88', pngHeader(2, 1), {});

    assert.deepEqual(engine.workers.map(slot => slot.worker.renderRequests.map(request => request.assetId)), [
      ['active-184'], ['fitting-88'],
    ]);
    assert.deepEqual(engine.metrics(), {
      concurrency: 2, workersReady: 2, active: 2, activeRenderBytes: 272,
      maxActiveRenderBytes: 272, queued: 1, paused: false,
    });

    const fittingWorker = engine.workers.find(slot => slot.worker.pendingRenderMessages.some(message => message.assetId === 'fitting-88'));
    fittingWorker.worker.completeRender(fittingWorker.worker.pendingRenderMessages.find(message => message.assetId === 'fitting-88').requestId);
    await fitting;
    assert.equal(engine.metrics().activeRenderBytes, 184);
    assert.equal(engine.metrics().queued, 1, 'the larger image waits until enough active memory is released');

    const activeWorker = engine.workers.find(slot => slot.worker.pendingRenderMessages.some(message => message.assetId === 'active-184'));
    activeWorker.worker.completeRender(activeWorker.worker.pendingRenderMessages.find(message => message.assetId === 'active-184').requestId);
    await active;
    assert.equal(engine.metrics().active, 1);
    assert.equal(engine.metrics().queued, 0);
    assert.ok(engine.workers.some(slot => slot.worker.renderRequests.some(request => request.assetId === 'blocked-152')));

    const largeWorker = engine.workers.find(slot => slot.worker.pendingRenderMessages.some(message => message.assetId === 'blocked-152'));
    largeWorker.worker.completeRender(largeWorker.worker.pendingRenderMessages.find(message => message.assetId === 'blocked-152').requestId);
    await large;
    assert.equal(engine.metrics().activeRenderBytes, 0);
  }, { maxWorkers: 2, maxCachedPixels: 10, maxActiveRenderBytes: 272, deferRenders: true });
});

test('bounded memory bypasses eventually protect an older large render from a small-job stream', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(4);
    await new Promise(resolve => setTimeout(resolve, 0));

    const base = engine.render('base-1624', pngHeader(50, 1), {});
    const large = engine.render('old-large-1304', pngHeader(40, 1), {});
    const smallJobs = ['small-1', 'small-2', 'small-3', 'small-4'].map(id => engine.render(id, pngHeader(1, 1), {}));

    assert.equal(engine.metrics().active, 4, 'three fitting jobs can bypass the blocked image');
    assert.equal(engine.metrics().activeRenderBytes, 1792);
    assert.equal(engine.metrics().queued, 2, 'the large image and fourth small image remain queued');
    assert.deepEqual(engine.workers.flatMap(slot => slot.worker.renderRequests.map(request => request.assetId)).sort(),
      ['base-1624', 'small-1', 'small-2', 'small-3'].sort());

    const finish = async assetId => {
      const slot = engine.workers.find(item => item.worker.pendingRenderMessages.some(message => message.assetId === assetId));
      assert.ok(slot, `Expected ${assetId} to be in flight.`);
      const message = slot.worker.pendingRenderMessages.find(item => item.assetId === assetId);
      slot.worker.completeRender(message.requestId);
    };

    await finish('small-1');
    await smallJobs[0];
    assert.deepEqual(engine.metrics(), {
      concurrency: 4, workersReady: 4, active: 3, activeRenderBytes: 1736,
      maxActiveRenderBytes: 1792, queued: 2, paused: false,
    });
    assert.ok(!engine.workers.some(slot => slot.worker.renderRequests.some(request => request.assetId === 'small-4')),
      'after the bypass bound, the scheduler must leave capacity available for the older large image');

    for (const [assetId, pending] of [['small-2', smallJobs[1]], ['small-3', smallJobs[2]], ['base-1624', base]]) {
      await finish(assetId);
      await pending;
    }
    const dispatchOrder = engine.workers.flatMap(slot => slot.worker.renderRequests.map(request => request.assetId));
    assert.ok(dispatchOrder.indexOf('old-large-1304') >= 0 && dispatchOrder.indexOf('old-large-1304') < dispatchOrder.indexOf('small-4'),
      'once memory is available, the oldest large image dispatches before work behind it');

    await Promise.all([finish('old-large-1304'), finish('small-4')]);
    await Promise.all([large, smallJobs[3]]);
    assert.equal(engine.metrics().activeRenderBytes, 0);
    assert.equal(engine.metrics().queued, 0);
  }, { maxWorkers: 4, maxCachedPixels: 20, maxActiveRenderBytes: 1792, maxSingleRenderBytes: 4096, deferRenders: true });
});

test('a high-volume recipe workload drains unique image renders within worker and memory admission bounds', async () => {
  await withEngine(async engine => {
    const imageCount = 2048;
    const queueGroup = 'batch:high-volume';
    engine.setConcurrency(3);
    await new Promise(resolve => setTimeout(resolve, 0));

    const completed = Array.from({ length: imageCount }, (_, index) => engine.render(
      `recipe-image-${index}`, pngHeader(1, 1), {}, {}, { queueGroup },
    ));
    assert.equal(engine.metrics().active, 3);
    assert.equal(engine.metrics().queued, imageCount - 3);
    assert.equal(engine.metrics().activeRenderBytes, 168);
    assert.deepEqual(engine.queueGroupMetrics(queueGroup), { active: 3, queued: imageCount - 3 });

    let terminal = 0;
    while (engine.metrics().active || engine.metrics().queued) {
      let finishedOne = false;
      for (const slot of engine.workers) {
        if (!slot.worker.completeNextRender()) continue;
        finishedOne = true;
        terminal += 1;
        const remaining = imageCount - terminal;
        assert.deepEqual(engine.queueGroupMetrics(queueGroup), {
          active: Math.min(3, remaining),
          queued: Math.max(0, remaining - 3),
        }, 'the progress bar can poll exact group counts after every completed image');
      }
      assert.equal(finishedOne, true, 'every admitted render must have a worker response available');
      assert.ok(engine.metrics().active <= 3, 'active image workers must stay within configured concurrency');
      assert.ok(engine.metrics().activeRenderBytes <= 168, 'parallel image memory must stay within the shared budget');
      await Promise.resolve();
    }

    const results = await Promise.all(completed);
    const submitted = engine.workers.flatMap(slot => slot.worker.renderRequests);
    const submittedIds = submitted.map(request => request.assetId);
    assert.equal(results.length, imageCount);
    assert.equal(submittedIds.length, imageCount);
    assert.equal(new Set(submittedIds).size, imageCount, 'each selected source image is rendered exactly once');
    assert.deepEqual([...submittedIds].sort(), Array.from({ length: imageCount }, (_, index) => `recipe-image-${index}`).sort());
    assert.deepEqual(submitted.sort((left, right) => left.requestId - right.requestId).map(request => request.assetId),
      Array.from({ length: imageCount }, (_, index) => `recipe-image-${index}`),
      'the queue cursor and compaction retain exact global FIFO submission order');
    assert.deepEqual(engine.queueGroupMetrics(queueGroup), { active: 0, queued: 0 });
    assert.deepEqual(engine.metrics(), { concurrency: 3, workersReady: 3, active: 0, activeRenderBytes: 0, maxActiveRenderBytes: 168, queued: 0, paused: false });
  }, { maxWorkers: 3, maxCachedPixels: 96, maxActiveRenderBytes: 168, maxSingleRenderBytes: 1024, deferRenders: true });
});

test('over-budget image runs alone, then releases admission for the next FIFO job', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(2);
    await new Promise(resolve => setTimeout(resolve, 0));

    const large = engine.render('large', pngHeader(4, 4), {}); // 512 decoded-working bytes + 24 source bytes > budget
    const small = engine.render('small', pngHeader(1, 1), {});
    assert.deepEqual(engine.metrics(), { concurrency: 2, workersReady: 2, active: 1, activeRenderBytes: 536, maxActiveRenderBytes: 256, queued: 1, paused: false });
    assert.equal(engine.workers[1].worker.renderRequests.length, 0);

    engine.workers[0].worker.completeNextRender();
    assert.deepEqual(engine.metrics(), { concurrency: 2, workersReady: 2, active: 1, activeRenderBytes: 56, maxActiveRenderBytes: 256, queued: 0, paused: false });
    assert.deepEqual(engine.workers[0].worker.renderRequests.map(item => item.assetId), ['large', 'small']);

    engine.workers[0].worker.completeNextRender();
    await Promise.all([large, small]);
    assert.equal(engine.metrics().activeRenderBytes, 0);
  }, { maxWorkers: 2, maxCachedPixels: 10, maxActiveRenderBytes: 256, deferRenders: true });
});

test('single-image WASM working-set ceiling rejects oversized jobs before worker admission', async () => {
  await withEngine(async engine => {
    await assert.rejects(engine.render('oversized', pngHeader(3, 3), {}), error => {
      assert.ok(error instanceof ImageMemoryLimitError);
      assert.equal(error.budgetKind, 'wasm-working-set');
      assert.match(error.message, /temporary Pillow-RS memory/);
      assert.match(error.message, /per-image processing limit/);
      return true;
    });
    assert.equal(engine.workers.length, 0, 'reject before allocating a worker or retaining source bytes');
    assert.equal(engine.metrics().activeRenderBytes, 0);
    assert.equal(engine.metrics().queued, 0);
  }, { maxWorkers: 1, maxCachedPixels: 10, maxActiveRenderBytes: 256, maxSingleRenderBytes: 256, deferRenders: true });
});

test('default hard ceiling fails closed for images with unknown dimensions', async () => {
  await withEngine(async engine => {
    await assert.rejects(engine.render('unknown', bytesFor(1), {}), error => {
      assert.ok(error instanceof ImageMemoryLimitError);
      assert.equal(error.budgetKind, 'wasm-working-set');
      assert.match(error.message, /2442 MiB/);
      return true;
    });
    assert.equal(engine.workers.length, 0);
  }, { maxSingleRenderBytes: null });
});

test('default retained-image budget is conservative for mobile and unknown-memory devices', () => {
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: 2, hardwareConcurrency: 8 }), (192 * 1024 * 1024) / 32);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: 4, hardwareConcurrency: 8 }), (320 * 1024 * 1024) / 32);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: 8, hardwareConcurrency: 16 }), 16_000_000);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: 16, hardwareConcurrency: 16 }), 16_000_000);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: null, hardwareConcurrency: 4 }), 4_000_000);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: null, hardwareConcurrency: null }), 8_000_000);
});

test('a selected 12MP source stays decoded for repeat edits when the device tier admits it', () => {
  const budget = defaultImageCachePixelBudget({ deviceMemory: 8, hardwareConcurrency: 8 });
  const cache = new DecodedSourceCache({ pixelBudget: budget });
  const original = makeSource(12_000_000);
  let decodes = 0;
  cache.setActive('camera-original');

  const first = cache.withSource('camera-original', () => { decodes += 1; return original; }, source => source.width);
  const second = cache.withSource('camera-original', () => { decodes += 1; throw new Error('the retained source should be reused'); }, source => source.width);

  assert.equal(first.result, 12_000_000);
  assert.equal(first.retained, true);
  assert.equal(second.result, 12_000_000);
  assert.equal(second.retained, true);
  assert.equal(decodes, 1, 'successive live edits reuse the immutable decoded original');
  assert.equal(original.freeCalls, 0, 'selection keeps the original alive in the worker cache');

  cache.setActive('next-image');
  const next = makeSource(5_000_000);
  const replacement = cache.withSource('next-image', () => next, source => source.width);
  assert.equal(replacement.retained, true);
  assert.equal(cache.has('camera-original'), false, 'a deselected source becomes reclaimable under cache pressure');
  assert.equal(original.freeCalls, 1, 'eviction releases the deselected Pillow image');
  cache.clear();
  assert.equal(next.freeCalls, 1, 'worker shutdown releases the replacement source');
});

test('single-image hard limits account for device tiers while remaining globally bounded', () => {
  assert.equal(defaultSingleImageRenderMemoryBudget({ deviceMemory: 2 }), 192 * 1024 * 1024);
  assert.equal(defaultSingleImageRenderMemoryBudget({ deviceMemory: 4 }), 320 * 1024 * 1024);
  assert.equal(defaultSingleImageRenderMemoryBudget({ deviceMemory: 8 }), 512 * 1024 * 1024);
  assert.equal(defaultSingleImageRenderMemoryBudget({ deviceMemory: undefined }), 512 * 1024 * 1024);
});

test('default active render memory budget scales conservatively with reported device memory', () => {
  assert.equal(defaultActiveRenderMemoryBudget({ deviceMemory: 2 }), 192 * 1024 * 1024);
  assert.equal(defaultActiveRenderMemoryBudget({ deviceMemory: 4 }), 320 * 1024 * 1024);
  assert.equal(defaultActiveRenderMemoryBudget({ deviceMemory: 8 }), 640 * 1024 * 1024);
  assert.equal(defaultActiveRenderMemoryBudget({ deviceMemory: 16 }), 1024 * 1024 * 1024);
  assert.equal(defaultActiveRenderMemoryBudget({ deviceMemory: null }), 256 * 1024 * 1024);
});

test('bounded worker recovery rejects a queued tail, then later requests can restart the pool', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const queued = [
      engine.render('a', bytesFor(2), {}, {}, { replaceKey: 'preview:a', queueGroup: 'recipe-batch:failed' }),
      engine.render('b', bytesFor(2), {}, {}, { replaceKey: 'preview:b', queueGroup: 'recipe-batch:failed' }),
      engine.render('c', bytesFor(2), {}, {}, { replaceKey: 'preview:c', queueGroup: 'recipe-batch:failed' }),
      engine.render('d', bytesFor(2), {}, {}, { replaceKey: 'preview:d', queueGroup: 'recipe-batch:failed' }),
    ];
    const resultsPromise = Promise.allSettled(queued);
    for (let recoveryRound = 0; recoveryRound <= 2; recoveryRound += 1) {
      const active = engine.workers.find(slot => slot.busy);
      assert.ok(active, `recovery round ${recoveryRound + 1} should have one active render to interrupt`);
      active.worker.crash(`pool failure ${recoveryRound + 1}`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const results = await resultsPromise;
    assert.equal(results.length, 4);
    assert.ok(results.every(result => result.status === 'rejected'));
    assert.match(results[3].reason.message, /All local image workers stopped unexpectedly/);
    assert.equal(engine.metrics().activeRenderBytes, 0, 'worker failure releases every active memory reservation');
    assert.equal(engine.metrics().queued, 0);
    assert.equal(engine.queuedByKey.size, 0, 'failure releases canceled preview keys and their retained source buffers');
    await assert.rejects(
      engine.render('same-batch-retry', bytesFor(2), {}, {}, { queueGroup: 'recipe-batch:failed' }),
      /Start a new batch to retry/,
      'a persistent worker failure must not restart the full recovery budget for every target in the same bulk run',
    );
    assert.equal(engine.workers.length, 0, 'same-batch retries do not allocate another recovery chain');
    const later = engine.render('later', bytesFor(2), {}, {}, { queueGroup: 'recipe-batch:retry' });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(engine.workers.length, 1, 'a new batch can start a fresh, bounded worker pool');
    assert.equal(engine.workers[0].worker.completeNextRender(), true);
    assert.equal((await later).mode, 'preview');
  }, { maxWorkers: 2, maxCachedPixels: 10, deferRenders: true });
});

test('a healthy busy worker promoted from retirement keeps the bulk queue moving after another worker fails', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(2);
    await new Promise(resolve => setTimeout(resolve, 0));
    const options = { queueGroup: 'recipe-batch:retiree' };
    const tinyPng = pngHeader(1, 1);
    const first = engine.render('first', tinyPng, {}, {}, options);
    const retiring = engine.render('retiring', tinyPng, {}, {}, options);
    const queued = engine.render('queued', tinyPng, {}, {}, options);
    const resultsPromise = Promise.allSettled([first, retiring, queued]);
    assert.equal(engine.metrics().active, 2, 'both workers must be processing before the concurrency reduction');
    const retiringSlot = engine.workers[1];
    engine.setConcurrency(1);
    assert.equal(retiringSlot.retireWhenIdle, true, 'the second busy worker should be scheduled for retirement');

    const retainedSlot = engine.workers[0];
    retainedSlot.recoveryAttempts = 2;
    retainedSlot.worker.crash('exhausted retained worker');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(engine.workers.length, 1);
    assert.equal(retiringSlot.retireWhenIdle, false, 'the remaining healthy worker must be promoted into active capacity');
    assert.equal(engine.metrics().queued, 1, 'queued work waits for the busy worker to drain rather than hanging or being discarded');

    assert.equal(retiringSlot.worker.completeNextRender(), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(retiringSlot.worker.completeNextRender(), true, 'the queued target should dispatch as soon as the survivor becomes idle');
    const results = await resultsPromise;
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(results[2].status, 'fulfilled');
    assert.equal(engine.metrics().activeRenderBytes, 0);
  }, { maxWorkers: 2, maxCachedPixels: 10, deferRenders: true });
});
