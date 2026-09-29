import test from 'node:test';
import assert from 'node:assert/strict';
import { DecodedSourceCache } from '../src/decoded-source-cache.js';
import { defaultImageCachePixelBudget, LocalImageEngine } from '../src/image-engine.js';

const PIXEL_BUDGET = 5;

function makeSource(width) {
  return { width, height: 1, freeCalls: 0, free() { this.freeCalls += 1; } };
}

class CacheWorkerMock {
  constructor() {
    this.onmessage = null;
    this.onError = null;
    this.cache = new DecodedSourceCache({ pixelBudget: CacheWorkerMock.initialPixelBudget });
    this.renderRequests = [];
    this.disposed = [];
    this.cacheBudgets = [];
    this.terminated = false;
    queueMicrotask(() => this.#emit({ type: 'ready' }));
  }

  static initialPixelBudget = 16_000_000;

  postMessage(message) {
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
    this.renderRequests.push({ assetId: message.assetId, hasSourceBytes: message.sourceBytes instanceof ArrayBuffer });
    queueMicrotask(() => {
      try {
        const cachedRender = this.cache.withSource(message.assetId, () => {
          if (!(message.sourceBytes instanceof ArrayBuffer)) throw new Error('The original image is no longer available in memory.');
          const pixelCount = new Uint8Array(message.sourceBytes)[0];
          return makeSource(pixelCount);
        }, source => ({ bytes: new Uint8Array([source.width]), width: source.width, height: 1 }));
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
    });
  }

  terminate() { this.terminated = true; this.cache.clear(); }

  crash(message = 'synthetic worker failure') { this.onerror?.({ message }); }

  #emit(data) { if (!this.terminated) this.onmessage?.({ data }); }
}

async function withEngine(run, { maxWorkers = 1, maxCachedPixels = PIXEL_BUDGET } = {}) {
  const oldWorker = globalThis.Worker;
  const oldBudget = CacheWorkerMock.initialPixelBudget;
  CacheWorkerMock.initialPixelBudget = maxCachedPixels;
  globalThis.Worker = CacheWorkerMock;
  const engine = new LocalImageEngine({ maxWorkers, maxCachedPixels });
  try {
    await run(engine);
  } finally {
    engine.destroy();
    globalThis.Worker = oldWorker;
    CacheWorkerMock.initialPixelBudget = oldBudget;
  }
}

const bytesFor = pixels => new Uint8Array([pixels]);

test('LocalImageEngine resends oversized source bytes for each ephemeral render', async () => {
  await withEngine(async engine => {
    await engine.render('large', bytesFor(6), {});
    await engine.render('large', bytesFor(6), {});
    const requests = engine.workers[0].worker.renderRequests;
    assert.deepEqual(requests.map(request => request.hasSourceBytes), [true, true]);
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

test('reducing concurrency drops idle worker caches and keeps the aggregate budget bounded', async () => {
  await withEngine(async engine => {
    await Promise.all([
      engine.render('a', bytesFor(4), {}),
      engine.render('b', bytesFor(4), {}),
    ]);
    const [firstWorker, secondWorker] = engine.workers.map(slot => slot.worker);
    assert.deepEqual([firstWorker.cache.pixelBudget, secondWorker.cache.pixelBudget], [3, 2]);

    engine.setConcurrency(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual([firstWorker.cache.pixelBudget, secondWorker.cache.pixelBudget], [5, 0]);
    assert.equal(firstWorker.cache.pixels + secondWorker.cache.pixels <= 5, true);
    assert.equal(secondWorker.cache.pixels, 0);
    assert.equal(engine.workers[1].loaded.size, 0);
  }, { maxWorkers: 2, maxCachedPixels: 5 });
});

test('default retained-image budget is conservative for mobile and unknown-memory devices', () => {
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: 2, hardwareConcurrency: 8 }), 4_000_000);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: 8, hardwareConcurrency: 16 }), 8_000_000);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: 16, hardwareConcurrency: 16 }), 16_000_000);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: null, hardwareConcurrency: 4 }), 4_000_000);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: null, hardwareConcurrency: null }), 8_000_000);
});

test('last worker failure rejects queued work and later requests instead of hanging', async () => {
  await withEngine(async engine => {
    const queued = [
      engine.render('a', bytesFor(2), {}),
      engine.render('b', bytesFor(2), {}),
      engine.render('c', bytesFor(2), {}),
    ];
    for (const slot of engine.workers) slot.worker.crash();

    const results = await Promise.allSettled(queued);
    assert.equal(results.length, 3);
    assert.ok(results.every(result => result.status === 'rejected'));
    assert.match(results[2].reason.message, /All local image workers stopped unexpectedly/);
    await assert.rejects(engine.render('later', bytesFor(2), {}), /All local image workers stopped unexpectedly/);
  }, { maxWorkers: 2, maxCachedPixels: 10 });
});
