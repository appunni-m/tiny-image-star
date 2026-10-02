import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalObjectIsolationEngine } from '../src/object-isolation-engine.js';
import { OBJECT_ISOLATION_BRUSH_MODE as BrushMode } from '../src/object-isolation-mask.js';

class FakeWorker {
  messages = [];
  terminated = false;
  postMessage(message, transfer = []) { this.messages.push({ message, transfer }); }
  emit(data) { this.onmessage?.({ data }); }
  terminate() { this.terminated = true; }
}

const positiveStroke = [{ brushMode: BrushMode.POSITIVE, point: [{ x: .2, y: .3 }, { x: .4, y: .5 }], isCompleted: true }];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error('Timed out waiting for the isolated worker message.');
}

test('the isolation engine lazily creates one worker, transfers a copy, and forwards the PNG result', async () => {
  const workers = [];
  const stages = [];
  const engine = new LocalObjectIsolationEngine({ workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });
  const source = new Uint8Array([1, 2, 3, 4]);
  const original = source.slice();
  const resultPromise = engine.run(source, positiveStroke, { onStage: event => stages.push(event.stage) });
  assert.equal(workers.length, 1);
  const worker = workers[0];
  assert.equal(worker.messages[0].message.type, 'initialize');
  worker.emit({ type: 'ready' });
  await waitFor(() => worker.messages.some(item => item.message.type === 'isolate'));
  const request = worker.messages.find(item => item.message.type === 'isolate');
  assert.notStrictEqual(request.message.sourceBytes, source.buffer);
  assert.deepEqual([...new Uint8Array(request.message.sourceBytes)], [...original]);
  assert.deepEqual([...source], [...original], 'transferring the worker copy must preserve the editor source bytes');
  assert.deepEqual(request.message.strokes, positiveStroke);
  worker.emit({ type: 'stage', requestId: request.message.requestId, stage: 'segmenting' });
  const output = new Uint8Array([137, 80, 78, 71]).buffer;
  worker.emit({ type: 'rendered', requestId: request.message.requestId, mimeType: 'image/png', width: 2, height: 2, bytes: output });
  const result = await resultPromise;
  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual([...result.bytes], [137, 80, 78, 71]);
  assert.deepEqual(stages, ['segmenting']);
  assert.equal(engine.dispose(), true);
  assert.equal(worker.terminated, true);
});

test('the worker engine permits one model job and reports stage callback failures safely', async () => {
  let worker;
  const engine = new LocalObjectIsolationEngine({ workerFactory: () => (worker = new FakeWorker()) });
  const pending = engine.run(new Uint8Array([1]), positiveStroke, { onStage: () => { throw new Error('UI callback'); } });
  await assert.rejects(engine.run(new Uint8Array([2]), positiveStroke), /already processing/);
  worker.emit({ type: 'ready' });
  await waitFor(() => worker.messages.some(item => item.message.type === 'isolate'));
  const request = worker.messages.find(item => item.message.type === 'isolate').message;
  worker.emit({ type: 'stage', requestId: request.requestId, stage: 'loading-model' });
  worker.emit({ type: 'rendered', requestId: request.requestId, mimeType: 'image/png', width: 1, height: 1, bytes: new Uint8Array([1]).buffer });
  assert.equal((await pending).width, 1);
});

test('invalid source inputs and model outputs are rejected before creating an image layer result', async () => {
  const workers = [];
  const engine = new LocalObjectIsolationEngine({ workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });
  await assert.rejects(engine.run(new Uint8Array(), positiveStroke), /source bytes exceed/);
  await assert.rejects(engine.run(new Uint8Array([1]), []), /at least one isolation stroke/);
  assert.equal(workers.length, 0, 'invalid requests do not load the large model runtime');
  const pending = engine.run(new Uint8Array([1]), positiveStroke);
  workers[0].emit({ type: 'ready' });
  await waitFor(() => workers[0].messages.some(item => item.message.type === 'isolate'));
  const requestId = workers[0].messages.find(item => item.message.type === 'isolate').message.requestId;
  workers[0].emit({ type: 'rendered', requestId, mimeType: 'image/jpeg', width: 1, height: 1, bytes: new Uint8Array([1]).buffer });
  await assert.rejects(pending, /invalid transparent image/);
  engine.dispose();
});

test('abort terminates the synchronous inference worker and releases the active request', async () => {
  let worker;
  const engine = new LocalObjectIsolationEngine({ workerFactory: () => (worker = new FakeWorker()) });
  const controller = new AbortController();
  const pending = engine.run(new Uint8Array([1]), positiveStroke, { signal: controller.signal });
  worker.emit({ type: 'ready' });
  await waitFor(() => worker.messages.some(item => item.message.type === 'isolate'));
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(worker.terminated, true, 'cancel must stop CPU inference and drop retained image embeddings');
  assert.equal(engine.active, null);
  engine.dispose();
});

test('failed worker startup is bounded and terminates the local runtime', async () => {
  let worker;
  const engine = new LocalObjectIsolationEngine({ workerFactory: () => (worker = new FakeWorker()), readinessTimeoutMs: 12 });
  const pending = engine.run(new Uint8Array([1]), positiveStroke);
  await assert.rejects(pending, /did not start in time/);
  assert.equal(worker.terminated, true);
  engine.dispose();
});

test('an isolated inference job has a deadline and terminates a hung worker', async () => {
  let worker;
  const engine = new LocalObjectIsolationEngine({
    workerFactory: () => (worker = new FakeWorker()),
    readinessTimeoutMs: 60_000,
    jobTimeoutMs: 12
  });
  const pending = engine.run(new Uint8Array([1]), positiveStroke);
  worker.emit({ type: 'ready' });
  await waitFor(() => worker.messages.some(item => item.message.type === 'isolate'));
  await assert.rejects(pending, /exceeded its time limit/u);
  assert.equal(worker.terminated, true, 'a stalled sync inference must release its worker and model memory');
  assert.equal(engine.active, null);
  engine.dispose();
});

test('dispose rejects an in-flight model startup instead of leaving a request pending', async () => {
  let worker;
  const engine = new LocalObjectIsolationEngine({ workerFactory: () => (worker = new FakeWorker()), readinessTimeoutMs: 60_000 });
  const pending = engine.run(new Uint8Array([1]), positiveStroke);
  assert.equal(engine.dispose(), true);
  await assert.rejects(pending, /worker was stopped/);
  assert.equal(worker.terminated, true);
});
