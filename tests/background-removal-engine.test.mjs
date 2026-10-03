import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalBackgroundRemovalEngine } from '../src/background-removal-engine.js';
import { MAX_BACKGROUND_REMOVAL_SOURCE_BYTES } from '../src/background-removal-mask.js';

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
  throw new Error('Timed out waiting for the background-removal worker.');
}
function resultFor(request, bytes = new Uint8Array([137, 80, 78, 71]).buffer) {
  return { type: 'removed', requestId: request.requestId, mimeType: 'image/png', width: 2, height: 2, bytes };
}

test('the local engine creates one worker, transfers source copies, serializes jobs, and forwards stages/results', async () => {
  const workers = [];
  const stages = [];
  const engine = new LocalBackgroundRemovalEngine({
    workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    idleTimeoutMs: 60_000,
  });
  const source = new Uint8Array([7, 8, 9, 10]);
  const original = [...source];
  const first = engine.run(source, { onStage: event => stages.push(event.stage) });
  const second = engine.run(new Uint8Array([1, 2]));
  assert.equal(workers.length, 1);
  const worker = workers[0];
  assert.equal(worker.messages[0].message.type, 'initialize');
  worker.emit({ type: 'ready' });
  await waitFor(() => worker.messages.some(item => item.message.type === 'remove-background'));
  const firstMessage = worker.messages.find(item => item.message.type === 'remove-background');
  assert.deepEqual(firstMessage.transfer, [firstMessage.message.sourceBytes]);
  assert.notStrictEqual(firstMessage.message.sourceBytes, source.buffer);
  assert.deepEqual([...new Uint8Array(firstMessage.message.sourceBytes)], original);
  assert.deepEqual([...source], original, 'the retained original must not be detached by transfer');
  assert.equal(worker.messages.filter(item => item.message.type === 'remove-background').length, 1,
    'the worker admits one ONNX inference at a time');

  worker.emit({ type: 'stage', requestId: firstMessage.message.requestId, stage: 'segmenting' });
  worker.emit(resultFor(firstMessage.message));
  const firstResult = await first;
  assert.equal(firstResult.mimeType, 'image/png');
  assert.deepEqual([...firstResult.bytes], [137, 80, 78, 71]);
  assert.deepEqual(stages, ['segmenting']);

  await waitFor(() => worker.messages.filter(item => item.message.type === 'remove-background').length === 2);
  const secondMessage = worker.messages.filter(item => item.message.type === 'remove-background')[1].message;
  worker.emit(resultFor(secondMessage, new Uint8Array([1]).buffer));
  assert.deepEqual([...(await second).bytes], [1]);
  engine.dispose();
  assert.equal(worker.terminated, true);
});

test('queued cancellation removes work before dispatch and active cancellation waits for worker drain', async () => {
  const workers = [];
  const engine = new LocalBackgroundRemovalEngine({
    workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    idleTimeoutMs: 60_000,
  });
  const queuedController = new AbortController();
  const activeController = new AbortController();
  const first = engine.run(new Uint8Array([1]), { signal: activeController.signal });
  const queued = engine.run(new Uint8Array([2]), { signal: queuedController.signal });
  queuedController.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  const worker = workers[0];
  worker.emit({ type: 'ready' });
  await waitFor(() => worker.messages.some(item => item.message.type === 'remove-background'));
  const active = worker.messages.find(item => item.message.type === 'remove-background').message;
  activeController.abort();
  assert.equal(worker.messages.at(-1).message.type, 'cancel');
  assert.equal(worker.messages.filter(item => item.message.type === 'remove-background').length, 1,
    'a cancelled inference retains worker ownership until model computation drains');
  worker.emit({ type: 'cancelled', requestId: active.requestId });
  await assert.rejects(first, { name: 'AbortError' });
  engine.dispose();
});

test('source inputs and worker PNG results are bounded and fail closed', async () => {
  const workers = [];
  const engine = new LocalBackgroundRemovalEngine({
    workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    idleTimeoutMs: 60_000,
  });
  await assert.rejects(engine.run({}), /original image bytes/);
  await assert.rejects(engine.run(new Uint8Array(0)), /source bytes exceed/);
  assert.equal(workers.length, 0, 'invalid inputs must fail before loading ONNX Runtime');
  // A short typed view must be copied using its exact byte range.
  const oversizedSource = new Uint8Array(MAX_BACKGROUND_REMOVAL_SOURCE_BYTES + 1);
  await assert.rejects(engine.run(oversizedSource), /source bytes exceed/);
  const pending = engine.run(new Uint8Array([1]));
  const worker = workers[0];
  worker.emit({ type: 'ready' });
  await waitFor(() => worker.messages.some(item => item.message.type === 'remove-background'));
  const request = worker.messages.find(item => item.message.type === 'remove-background').message;
  worker.emit(resultFor(request, new ArrayBuffer(0)));
  await assert.rejects(pending, /invalid transparent image/);
  engine.dispose();
});

test('worker startup, inference deadline, and disposal always settle pending jobs', async () => {
  let worker;
  const startupEngine = new LocalBackgroundRemovalEngine({
    workerFactory: () => (worker = new FakeWorker()), readinessTimeoutMs: 10, idleTimeoutMs: 60_000,
  });
  await assert.rejects(startupEngine.run(new Uint8Array([1])), /did not start in time/);
  assert.equal(worker.terminated, true);
  startupEngine.dispose();

  const timeoutEngine = new LocalBackgroundRemovalEngine({
    workerFactory: () => (worker = new FakeWorker()), jobTimeoutMs: 10, idleTimeoutMs: 60_000,
  });
  const hung = timeoutEngine.run(new Uint8Array([1]));
  worker.emit({ type: 'ready' });
  await waitFor(() => worker.messages.some(item => item.message.type === 'remove-background'));
  await assert.rejects(hung, /exceeded its time limit/);
  assert.equal(worker.terminated, true);

  const disposeEngine = new LocalBackgroundRemovalEngine({
    workerFactory: () => (worker = new FakeWorker()), readinessTimeoutMs: 60_000,
  });
  const pending = disposeEngine.run(new Uint8Array([1]));
  assert.equal(disposeEngine.dispose(), true);
  await assert.rejects(pending, /worker was stopped/);
  assert.equal(worker.terminated, true);
});
