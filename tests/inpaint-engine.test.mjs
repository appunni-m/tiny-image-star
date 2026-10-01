import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalInpaintEngine } from '../src/inpaint-engine.js';

class FakeWorker {
  messages = [];
  terminated = false;
  onmessage = null;
  onerror = null;

  postMessage(message, transfer = []) {
    this.messages.push({ message, transfer });
  }

  emit(message) { this.onmessage?.({ data: message }); }
  terminate() { this.terminated = true; }
}

function makeEngine() {
  const worker = new FakeWorker();
  const engine = new LocalInpaintEngine({ workerFactory: () => worker, readinessTimeoutMs: 1000 });
  return { engine, worker };
}

const strokes = [{ radius: 3, points: [{ x: 4, y: 5 }] }];

test('local inference serializes requests and transfers an exact copy of retained source bytes', async () => {
  const { engine, worker } = makeEngine();
  const source = new Uint8Array([7, 8, 9, 10]);
  const first = engine.run(source, strokes);
  const second = engine.run(new Uint8Array([1, 2]), strokes);
  worker.emit({ type: 'ready' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(worker.messages.filter(item => item.message.type === 'inpaint').length, 1);
  const firstMessage = worker.messages[0];
  assert.deepEqual(firstMessage.transfer, [firstMessage.message.sourceBytes]);
  assert.deepEqual([...new Uint8Array(firstMessage.message.sourceBytes)], [7, 8, 9, 10]);
  assert.deepEqual([...source], [7, 8, 9, 10], 'the retained original buffer is not detached');

  worker.emit({ type: 'stage', requestId: firstMessage.message.requestId, stage: 'inpainting' });
  const firstBytes = new Uint8Array([11, 12]).buffer;
  worker.emit({ type: 'rendered', requestId: firstMessage.message.requestId, width: 2, height: 1, bytes: firstBytes });
  assert.deepEqual(await first, { bytes: new Uint8Array([11, 12]), width: 2, height: 1 });
  await new Promise(resolve => setImmediate(resolve));
  const secondMessage = worker.messages.filter(item => item.message.type === 'inpaint')[1];
  assert.ok(secondMessage, 'the next image is admitted only after the current model run completes');
  worker.emit({ type: 'rendered', requestId: secondMessage.message.requestId, width: 1, height: 1, bytes: new Uint8Array([13]).buffer });
  await second;
  engine.dispose();
  assert.equal(worker.terminated, true);
});

test('cancellation waits for model completion before releasing the worker to its next request', async () => {
  const { engine, worker } = makeEngine();
  const controller = new AbortController();
  const first = engine.run(new Uint8Array([1]), strokes, { signal: controller.signal });
  const second = engine.run(new Uint8Array([2]), strokes);
  worker.emit({ type: 'ready' });
  await new Promise(resolve => setImmediate(resolve));
  const requestId = worker.messages[0].message.requestId;
  controller.abort();
  assert.equal(worker.messages.at(-1).message.type, 'cancel');
  assert.equal(worker.messages.filter(item => item.message.type === 'inpaint').length, 1,
    'the serialized inference worker is not reused while WASM is still running');
  worker.emit({ type: 'cancelled', requestId });
  await assert.rejects(first, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  const nextRequest = worker.messages.filter(item => item.message.type === 'inpaint')[1];
  assert.ok(nextRequest);
  worker.emit({ type: 'rendered', requestId: nextRequest.message.requestId, width: 1, height: 1, bytes: new Uint8Array([3]).buffer });
  await second;
  engine.dispose();
});

test('queued work can be cancelled before dispatch and malformed outputs fail closed', async () => {
  const { engine, worker } = makeEngine();
  const controller = new AbortController();
  const first = engine.run(new Uint8Array([1]), strokes);
  const queued = engine.run(new Uint8Array([2]), strokes, { signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  worker.emit({ type: 'ready' });
  await new Promise(resolve => setImmediate(resolve));
  const requestId = worker.messages[0].message.requestId;
  worker.emit({ type: 'rendered', requestId, width: 1, height: 1, bytes: new Uint8Array([4]).buffer });
  await first;

  const invalid = engine.run(new Uint8Array([5]), strokes);
  await new Promise(resolve => setImmediate(resolve));
  const invalidId = worker.messages.filter(item => item.message.type === 'inpaint').at(-1).message.requestId;
  worker.emit({ type: 'rendered', requestId: invalidId, width: 0, height: 1, bytes: new Uint8Array([1]).buffer });
  await assert.rejects(invalid, /invalid image/);
  engine.dispose();
});

test('bad input, worker startup errors, and post-disposal jobs are reported to callers', async () => {
  const { engine, worker } = makeEngine();
  await assert.rejects(engine.run({}, strokes), /original image bytes/);
  const started = engine.run(new Uint8Array([1]), strokes);
  worker.emit({ type: 'init-error', message: 'local model failed' });
  await assert.rejects(started, /local model failed/);
  engine.dispose();
  await assert.rejects(engine.run(new Uint8Array([1]), strokes), /worker is closed/);
});
