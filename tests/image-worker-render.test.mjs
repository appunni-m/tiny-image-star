import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as pillow from '../wasm/pillow_rs_js.js';
import { decodeOriginal, renderImage } from '../src/image-processing.js';

function twoPixelBmp() {
  const bytes = Buffer.alloc(62);
  bytes.write('BM', 0, 'ascii'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(2, 18); bytes.writeInt32LE(1, 22); bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(8, 34);
  bytes.set([0, 0, 255, 0, 255, 0, 0, 0], 54);
  return new Uint8Array(bytes);
}

function fourByTwoBmp() {
  const bytes = Buffer.alloc(78);
  bytes.write('BM', 0, 'ascii'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10); bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(4, 18); bytes.writeInt32LE(2, 22); bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(24, 34);
  bytes.set([
    0, 0, 0, 40, 0, 0, 80, 0, 0, 120, 0, 0,
    0, 0, 40, 40, 0, 40, 80, 0, 40, 120, 0, 40,
  ], 54);
  return new Uint8Array(bytes);
}

test('local image worker returns full-resolution Pillow-RS export bytes in the requested codec', async () => {
  const previousSelf = globalThis.self;
  const previousFetch = globalThis.fetch;
  const wasmBytes = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  const messages = [];
  const waiters = [];
  const selfMock = {
    onmessage: null,
    addEventListener() {},
    postMessage(message) {
      messages.push(message);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        if (waiters[index].matches(message)) {
          const [{ resolve }] = waiters.splice(index, 1);
          resolve(message);
        }
      }
    },
  };
  const waitFor = predicate => {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for a local Pillow-RS worker message.')), 5000);
      waiters.push({ matches: predicate, resolve: message => { clearTimeout(timer); resolve(message); } });
    });
  };
  globalThis.self = selfMock;
  globalThis.fetch = async input => {
    if (String(input).endsWith('/pillow_rs_js_bg.wasm')) {
      return new Response(wasmBytes, { status: 200, headers: { 'Content-Type': 'application/wasm' } });
    }
    return previousFetch(input);
  };
  try {
    await import(`../src/image-worker.js?render-test=${Date.now()}`);
    await waitFor(message => message.type === 'ready');
    const resultPromise = waitFor(message => message.type === 'rendered' && message.requestId === 1);
    selfMock.onmessage({ data: {
      type: 'render', requestId: 1, assetId: 'original', sourceBytes: twoPixelBmp().buffer,
      adjustments: { brightness: 20 }, transforms: {}, previewMaxDimension: 1,
      format: 'webp', quality: 73, outputMode: 'export',
    } });
    const rendered = await resultPromise;
    assert.equal(rendered.mimeType, 'image/webp');
    assert.deepEqual([rendered.width, rendered.height], [2, 1], 'the worker ignores preview bounds for export jobs');
    assert.deepEqual([...rendered.bytes.slice(0, 4)], [82, 73, 70, 70]);
    assert.equal(rendered.mode, 'export');
    assert.equal(rendered.qualityApplied, true, 'the worker applies codec quality inside Pillow-RS WASM');
  } finally {
    globalThis.self = previousSelf;
    globalThis.fetch = previousFetch;
  }
});

test('oversized previews always decode the full original and remain ephemeral while exports retain full resolution', async () => {
  const previousSelf = globalThis.self;
  const previousFetch = globalThis.fetch;
  const wasmBytes = await readFile(new URL('../wasm/pillow_rs_js_bg.wasm', import.meta.url));
  const messages = [];
  const waiters = [];
  const selfMock = {
    onmessage: null,
    addEventListener() {},
    postMessage(message) {
      messages.push(message);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        if (waiters[index].matches(message)) {
          const [{ resolve }] = waiters.splice(index, 1);
          resolve(message);
        }
      }
    },
  };
  const describeMessages = () => messages.map(message => `${message.type}:${message.requestId ?? message.generation ?? ''}:${message.message || ''}`).join(', ');
  const waitFor = predicate => {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for a local Pillow-RS worker message; received ${describeMessages()}.`)), 5000);
      waiters.push({ matches: predicate, resolve: message => { clearTimeout(timer); resolve(message); } });
    });
  };
  const waitForRender = async requestId => {
    const message = await waitFor(item => item.requestId === requestId && ['rendered', 'error'].includes(item.type));
    assert.equal(message.type, 'rendered', message.message || `Pillow-RS render ${requestId} failed.`);
    return message;
  };

  globalThis.self = selfMock;
  globalThis.fetch = async input => {
    if (String(input).endsWith('/pillow_rs_js_bg.wasm')) {
      return new Response(wasmBytes, { status: 200, headers: { 'Content-Type': 'application/wasm' } });
    }
    return previousFetch(input);
  };
  try {
    await pillow.default({ module_or_path: wasmBytes });
    await import(`../src/image-worker.js?retained-original-test=${Date.now()}`);
    await waitFor(message => message.type === 'ready');

    const configured = waitFor(message => message.type === 'cache-configured' && message.generation === 1);
    selfMock.onmessage({ data: { type: 'configure-cache', generation: 1, pixelBudget: 2 } });
    await configured;

    const sourceBytes = fourByTwoBmp();
    const firstResult = waitForRender(1);
    selfMock.onmessage({ data: {
      type: 'render', requestId: 1, assetId: 'same-original', sourceBytes: sourceBytes.buffer,
      adjustments: { invert: true }, transforms: {}, previewMaxDimension: 8, outputMode: 'preview',
    } });
    const first = await firstResult;
    assert.equal(first.sourceRetained, false, 'an oversized decoded source is not retained in the worker cache');
    assert.deepEqual([first.width, first.height, first.sourceWidth, first.sourceHeight], [4, 2, 4, 2],
      'the preview render starts from full-resolution source pixels when its output cap permits');

    const expectedOriginal = decodeOriginal(pillow, sourceBytes);
    const reducedSource = decodeOriginal(pillow, sourceBytes);
    try {
      const expected = renderImage(expectedOriginal, { brightness: 24, saturation: -15 }, { rotation: 90 }, pillow, { previewMaxDimension: 8 });
      reducedSource.thumbnail(2, 2);
      const reducedSourceResult = renderImage(reducedSource, { brightness: 24, saturation: -15 }, { rotation: 90 }, pillow, { previewMaxDimension: 8 });
      const secondResult = waitForRender(2);
      selfMock.onmessage({ data: {
        type: 'render', requestId: 2, assetId: 'same-original', sourceBytes: sourceBytes.buffer,
        adjustments: { brightness: 24, saturation: -15 }, transforms: { rotation: 90 },
        previewMaxDimension: 8, outputMode: 'preview',
      } });
      const second = await secondResult;

      assert.equal(second.sourceRetained, false, 'the full source is freed again after each over-budget preview');
      assert.deepEqual([second.width, second.height, second.sourceWidth, second.sourceHeight], [2, 4, 4, 2]);
      assert.deepEqual(second.bytes, expected.bytes,
        'successive edits match a fresh render from the immutable full-resolution source');
      assert.notDeepEqual(second.bytes, reducedSourceResult.bytes,
        'preview edits preserve detail that would be lost by caching a downsampled source');

      const exportResult = waitForRender(3);
      selfMock.onmessage({ data: {
        type: 'render', requestId: 3, assetId: 'same-original', sourceBytes: sourceBytes.buffer,
        adjustments: { brightness: 24 }, transforms: {}, previewMaxDimension: 1,
        format: 'png', quality: 90, outputMode: 'export',
      } });
      const exported = await exportResult;
      assert.deepEqual([exported.width, exported.height], [4, 2], 'exports always use the original dimensions');
      assert.equal(exported.sourceRetained, false, 'oversized export decodes the source ephemerally too');

      const thirdResult = waitForRender(4);
      selfMock.onmessage({ data: {
        type: 'render', requestId: 4, assetId: 'same-original', sourceBytes: sourceBytes.buffer,
        adjustments: { brightness: 12 }, transforms: {}, previewMaxDimension: 8, outputMode: 'preview',
      } });
      const third = await thirdResult;
      const expectedThird = renderImage(expectedOriginal, { brightness: 12 }, {}, pillow, { previewMaxDimension: 8 });
      assert.equal(third.sourceRetained, false);
      assert.deepEqual(third.bytes, expectedThird.bytes,
        'a preview after export still derives from the original rather than an earlier result');

      const retainedConfigured = waitFor(message => message.type === 'cache-configured' && message.generation === 2);
      selfMock.onmessage({ data: { type: 'configure-cache', generation: 2, pixelBudget: 8 } });
      await retainedConfigured;
      const retainedFirstResult = waitForRender(5);
      selfMock.onmessage({ data: {
        type: 'render', requestId: 5, assetId: 'same-original', sourceBytes: sourceBytes.buffer,
        adjustments: { invert: true }, transforms: {}, previewMaxDimension: 8, outputMode: 'preview',
      } });
      const retainedFirst = await retainedFirstResult;
      assert.equal(retainedFirst.sourceRetained, true, 'the in-budget decoded original stays cached between edits');

      const retainedSecondResult = waitForRender(6);
      selfMock.onmessage({ data: {
        type: 'render', requestId: 6, assetId: 'same-original', sourceBytes: sourceBytes.buffer,
        adjustments: { brightness: 18 }, transforms: {}, previewMaxDimension: 8, outputMode: 'preview',
      } });
      const retainedSecond = await retainedSecondResult;
      const expectedRetainedSecond = renderImage(expectedOriginal, { brightness: 18 }, {}, pillow, { previewMaxDimension: 8 });
      assert.equal(retainedSecond.sourceRetained, true);
      assert.deepEqual(retainedSecond.bytes, expectedRetainedSecond.bytes,
        'an edit after a retained preview is rendered from the cached original, not the previous preview');
      assert.notDeepEqual(retainedSecond.bytes, retainedFirst.bytes,
        'the independent second recipe replaces the first preview instead of compounding it');
      assert.deepEqual([...sourceBytes], [...fourByTwoBmp()], 'worker processing leaves the editor-owned original bytes attached and unchanged');
    } finally { expectedOriginal.free(); reducedSource.free(); }
  } finally {
    globalThis.self = previousSelf;
    globalThis.fetch = previousFetch;
  }
});
