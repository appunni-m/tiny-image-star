import test from 'node:test';
import assert from 'node:assert/strict';
import { DecodedSourceCache } from '../src/decoded-source-cache.js';
import { defaultActiveRenderMemoryBudget, defaultImageCachePixelBudget, estimateImageWorkingSetBytes, LocalImageEngine } from '../src/image-engine.js';

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
    this.pendingRenderMessages = [];
    this.disposed = [];
    this.cacheBudgets = [];
    this.terminated = false;
    queueMicrotask(() => this.#emit({ type: 'ready' }));
  }

  static initialPixelBudget = 16_000_000;
  static deferRenders = false;

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
    this.renderRequests.push({
      assetId: message.assetId,
      hasSourceBytes: message.sourceBytes instanceof ArrayBuffer,
      transforms: message.transforms,
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
  }

  terminate() { this.terminated = true; this.cache.clear(); }

  crash(message = 'synthetic worker failure') { this.onerror?.({ message }); }

  #emit(data) { if (!this.terminated) this.onmessage?.({ data }); }
}

async function withEngine(run, { maxWorkers = 1, maxCachedPixels = PIXEL_BUDGET, maxActiveRenderBytes, deferRenders = false } = {}) {
  const oldWorker = globalThis.Worker;
  const oldBudget = CacheWorkerMock.initialPixelBudget;
  const oldDeferred = CacheWorkerMock.deferRenders;
  CacheWorkerMock.initialPixelBudget = maxCachedPixels;
  CacheWorkerMock.deferRenders = deferRenders;
  globalThis.Worker = CacheWorkerMock;
  const engine = new LocalImageEngine({ maxWorkers, maxCachedPixels, ...(maxActiveRenderBytes === undefined ? {} : { maxActiveRenderBytes }) });
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

test('active render estimates use raster dimensions instead of compressed byte length', () => {
  const expected = 6 * 32;
  const gif = new Uint8Array(10); gif.set(new TextEncoder().encode('GIF89a')); new DataView(gif.buffer).setUint16(6, 2, true); new DataView(gif.buffer).setUint16(8, 3, true);
  const bmp = new Uint8Array(26); bmp.set(new TextEncoder().encode('BM')); new DataView(bmp.buffer).setUint32(14, 40, true); new DataView(bmp.buffer).setInt32(18, 2, true); new DataView(bmp.buffer).setInt32(22, -3, true);
  const jpeg = new Uint8Array(15); jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 8]); new DataView(jpeg.buffer).setUint16(7, 3); new DataView(jpeg.buffer).setUint16(9, 2); jpeg[11] = 1;
  const webp = new Uint8Array(30); webp.set(new TextEncoder().encode('RIFF')); new DataView(webp.buffer).setUint32(4, 22, true); webp.set(new TextEncoder().encode('WEBPVP8X'), 8); new DataView(webp.buffer).setUint32(16, 10, true); webp[24] = 2; webp[27] = 1;

  for (const source of [pngHeader(2, 3), gif, bmp, jpeg, webp]) assert.equal(estimateImageWorkingSetBytes(source), expected);
  assert.equal(estimateImageWorkingSetBytes(bytesFor(1)), 80_000_000 * 32, 'unknown encodings use the full decoder pixel ceiling');
});

test('active render admission honors the byte budget, uses available parallelism, and preserves FIFO', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(2);
    await new Promise(resolve => setTimeout(resolve, 0));

    const first = engine.render('first', pngHeader(2, 2), {}); // 128 estimated bytes
    const second = engine.render('second', pngHeader(2, 2), {}); // fills 256-byte budget
    const third = engine.render('third', pngHeader(1, 1), {}); // waits behind FIFO head
    assert.deepEqual(engine.metrics(), { concurrency: 2, workersReady: 2, active: 2, activeRenderBytes: 256, maxActiveRenderBytes: 256, queued: 1, paused: false });

    engine.workers[0].worker.completeNextRender();
    assert.equal(engine.metrics().activeRenderBytes, 160);
    assert.equal(engine.metrics().queued, 0);
    assert.deepEqual(engine.workers[0].worker.renderRequests.map(item => item.assetId), ['first', 'third']);
    assert.deepEqual(engine.workers[1].worker.renderRequests.map(item => item.assetId), ['second']);

    engine.workers[0].worker.completeNextRender();
    engine.workers[1].worker.completeNextRender();
    await Promise.all([first, second, third]);
    assert.equal(engine.metrics().activeRenderBytes, 0);
  }, { maxWorkers: 2, maxCachedPixels: 10, maxActiveRenderBytes: 256, deferRenders: true });
});

test('over-budget image runs alone, then releases admission for the next FIFO job', async () => {
  await withEngine(async engine => {
    engine.setConcurrency(2);
    await new Promise(resolve => setTimeout(resolve, 0));

    const large = engine.render('large', pngHeader(4, 4), {}); // 512 estimated bytes > budget
    const small = engine.render('small', pngHeader(1, 1), {});
    assert.deepEqual(engine.metrics(), { concurrency: 2, workersReady: 2, active: 1, activeRenderBytes: 512, maxActiveRenderBytes: 256, queued: 1, paused: false });
    assert.equal(engine.workers[1].worker.renderRequests.length, 0);

    engine.workers[0].worker.completeNextRender();
    assert.deepEqual(engine.metrics(), { concurrency: 2, workersReady: 2, active: 1, activeRenderBytes: 32, maxActiveRenderBytes: 256, queued: 0, paused: false });
    assert.deepEqual(engine.workers[0].worker.renderRequests.map(item => item.assetId), ['large', 'small']);

    engine.workers[0].worker.completeNextRender();
    await Promise.all([large, small]);
    assert.equal(engine.metrics().activeRenderBytes, 0);
  }, { maxWorkers: 2, maxCachedPixels: 10, maxActiveRenderBytes: 256, deferRenders: true });
});

test('default retained-image budget is conservative for mobile and unknown-memory devices', () => {
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: 2, hardwareConcurrency: 8 }), 4_000_000);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: 8, hardwareConcurrency: 16 }), 8_000_000);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: 16, hardwareConcurrency: 16 }), 16_000_000);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: null, hardwareConcurrency: 4 }), 4_000_000);
  assert.equal(defaultImageCachePixelBudget({ deviceMemory: null, hardwareConcurrency: null }), 8_000_000);
});

test('default active render memory budget scales conservatively with reported device memory', () => {
  assert.equal(defaultActiveRenderMemoryBudget({ deviceMemory: 2 }), 192 * 1024 * 1024);
  assert.equal(defaultActiveRenderMemoryBudget({ deviceMemory: 4 }), 320 * 1024 * 1024);
  assert.equal(defaultActiveRenderMemoryBudget({ deviceMemory: 8 }), 640 * 1024 * 1024);
  assert.equal(defaultActiveRenderMemoryBudget({ deviceMemory: 16 }), 1024 * 1024 * 1024);
  assert.equal(defaultActiveRenderMemoryBudget({ deviceMemory: null }), 256 * 1024 * 1024);
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
    assert.equal(engine.metrics().activeRenderBytes, 0, 'worker failure releases every active memory reservation');
    assert.equal(engine.metrics().queued, 0);
    await assert.rejects(engine.render('later', bytesFor(2), {}), /All local image workers stopped unexpectedly/);
  }, { maxWorkers: 2, maxCachedPixels: 10 });
});
