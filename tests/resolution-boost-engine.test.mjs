import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalResolutionBoostEngine } from '../src/resolution-boost-engine.js';
import { MAX_RESOLUTION_BOOST_SOURCE_BYTES } from '../src/resolution-boost.js';

class FakeWorker {
  messages = [];
  terminated = false;
  postMessage(message, transfer = []) { this.messages.push({ message, transfer }); }
  emit(data) { this.onmessage?.({ data }); }
  terminate() { this.terminated = true; }
}

const tick = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error('Timed out waiting for the resolution-boost worker.');
}
function resultFor(request, bytes = new Uint8Array([137, 80, 78, 71]).buffer) {
  return { type: 'boosted', requestId: request.requestId, mimeType: 'image/png', width: 64, height: 64, bytes };
}

test('local resolution engine boots one configured model worker, copies inputs, serializes calls, and forwards progress', async () => {
  const workers = [];
  const stages = [];
  const engine = new LocalResolutionBoostEngine({
    workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    numThreads: 4,
    idleTimeoutMs: 60_000,
  });
  const source = new Uint8Array([7, 8, 9, 10]);
  const original = [...source];
  const first = engine.run(source, { width: 16, height: 16, onStage: event => stages.push(event.stage) });
  const second = engine.run(new Uint8Array([1, 2]), { width: 16, height: 16 });
  assert.equal(workers.length, 1);
  const worker = workers[0];
  assert.deepEqual(worker.messages[0].message, { type: 'initialize', numThreads: 4 });
  worker.emit({ type: 'ready' });
  await waitFor(() => worker.messages.some(item => item.message.type === 'boost'));
  const firstMessage = worker.messages.find(item => item.message.type === 'boost');
  assert.deepEqual(firstMessage.transfer, [firstMessage.message.sourceBytes]);
  assert.notStrictEqual(firstMessage.message.sourceBytes, source.buffer);
  assert.deepEqual([...new Uint8Array(firstMessage.message.sourceBytes)], original);
  assert.deepEqual([...source], original, 'the retained original must not be detached by transfer');
  assert.equal(firstMessage.message.numThreads, 4);
  assert.equal(worker.messages.filter(item => item.message.type === 'boost').length, 1,
    'the worker admits one ONNX inference at a time');

  worker.emit({ type: 'stage', requestId: firstMessage.message.requestId, stage: 'upscaling', detail: 'Tile 1 of 2' });
  worker.emit(resultFor(firstMessage.message));
  const firstResult = await first;
  assert.equal(firstResult.mimeType, 'image/png');
  assert.deepEqual([...firstResult.bytes], [137, 80, 78, 71]);
  assert.deepEqual(stages, ['upscaling']);

  await waitFor(() => worker.messages.filter(item => item.message.type === 'boost').length === 2);
  const secondMessage = worker.messages.filter(item => item.message.type === 'boost')[1].message;
  worker.emit(resultFor(secondMessage, new Uint8Array([1]).buffer));
  assert.deepEqual([...(await second).bytes], [1]);
  engine.dispose();
  assert.equal(worker.terminated, true);
});

test('queued cancellation removes work and active cancellation waits for model drain', async () => {
  const workers = [];
  const engine = new LocalResolutionBoostEngine({
    workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    idleTimeoutMs: 60_000,
  });
  const queuedController = new AbortController();
  const activeController = new AbortController();
  const first = engine.run(new Uint8Array([1]), { width: 16, height: 16, signal: activeController.signal });
  const queued = engine.run(new Uint8Array([2]), { width: 16, height: 16, signal: queuedController.signal });
  queuedController.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  const worker = workers[0];
  worker.emit({ type: 'ready' });
  await waitFor(() => worker.messages.some(item => item.message.type === 'boost'));
  const active = worker.messages.find(item => item.message.type === 'boost').message;
  activeController.abort();
  assert.equal(worker.messages.at(-1).message.type, 'cancel');
  assert.equal(worker.messages.filter(item => item.message.type === 'boost').length, 1,
    'a cancelled inference retains worker ownership until its tile drains');
  worker.emit({ type: 'cancelled', requestId: active.requestId });
  await assert.rejects(first, { name: 'AbortError' });
  engine.dispose();
});

test('source inputs and PNG responses are validated before and after inference', async () => {
  const workers = [];
  const engine = new LocalResolutionBoostEngine({
    workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    idleTimeoutMs: 60_000,
  });
  await assert.rejects(engine.run({}), /original image bytes/);
  await assert.rejects(engine.run(new Uint8Array(0)), /source bytes exceed/);
  await assert.rejects(engine.run(new Uint8Array([1]), { width: 15, height: 16 }), /16 through 2,048/);
  await assert.rejects(engine.run(new Uint8Array([1]), { width: 2048, height: 2048 }), /524,288 source pixels/);
  assert.equal(workers.length, 0, 'invalid inputs must fail before starting ONNX Runtime');

  const oversizedSource = new Uint8Array(MAX_RESOLUTION_BOOST_SOURCE_BYTES + 1);
  await assert.rejects(engine.run(oversizedSource, { width: 16, height: 16 }), /source bytes exceed/);
  const pending = engine.run(new Uint8Array([1]), { width: 16, height: 16 });
  const worker = workers[0];
  worker.emit({ type: 'ready' });
  await waitFor(() => worker.messages.some(item => item.message.type === 'boost'));
  const request = worker.messages.find(item => item.message.type === 'boost').message;
  worker.emit(resultFor(request, new ArrayBuffer(0)));
  await assert.rejects(pending, /invalid PNG/);
  engine.dispose();
});

test('startup timeout, job timeout, and disposal settle all pending requests', async () => {
  let worker;
  const startupEngine = new LocalResolutionBoostEngine({
    workerFactory: () => (worker = new FakeWorker()), readinessTimeoutMs: 10, idleTimeoutMs: 60_000,
  });
  await assert.rejects(startupEngine.run(new Uint8Array([1]), { width: 16, height: 16 }), /did not start in time/);
  assert.equal(worker.terminated, true);
  startupEngine.dispose();

  const timeoutEngine = new LocalResolutionBoostEngine({
    workerFactory: () => (worker = new FakeWorker()), jobTimeoutMs: 10, idleTimeoutMs: 60_000,
  });
  const hung = timeoutEngine.run(new Uint8Array([1]), { width: 16, height: 16 });
  worker.emit({ type: 'ready' });
  await waitFor(() => worker.messages.some(item => item.message.type === 'boost'));
  await assert.rejects(hung, /exceeded its time limit/);
  assert.equal(worker.terminated, true);

  const disposeEngine = new LocalResolutionBoostEngine({
    workerFactory: () => (worker = new FakeWorker()), readinessTimeoutMs: 60_000,
  });
  const pending = disposeEngine.run(new Uint8Array([1]), { width: 16, height: 16 });
  assert.equal(disposeEngine.dispose(), true);
  await assert.rejects(pending, /worker was stopped/);
  assert.equal(worker.terminated, true);
});
