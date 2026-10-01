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
      adjustments: { brightness: 20 }, transforms: { crop: { left: 0, top: 0, right: 0.5, bottom: 1 }, rotation: 90 },
      format: 'webp', quality: 73, outputMode: 'export',
    } });
    const rendered = await resultPromise;
    assert.equal(rendered.mimeType, 'image/webp');
    assert.deepEqual([rendered.width, rendered.height], [1, 1]);
    assert.deepEqual([...rendered.bytes.slice(0, 4)], [82, 73, 70, 70]);
    assert.equal(rendered.mode, 'export');
    assert.equal(rendered.qualityApplied, true, 'the worker applies codec quality inside Pillow-RS WASM');
  } finally {
    globalThis.self = previousSelf;
    globalThis.fetch = previousFetch;
  }
});

test('consecutive worker previews reuse the retained original instead of compounding the previous edit', async () => {
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
    await pillow.default({ module_or_path: wasmBytes });
    await import(`../src/image-worker.js?retained-original-test=${Date.now()}`);
    await waitFor(message => message.type === 'ready');

    const sourceBytes = twoPixelBmp();
    const firstResult = waitFor(message => message.type === 'rendered' && message.requestId === 1);
    selfMock.onmessage({ data: {
      type: 'render', requestId: 1, assetId: 'same-original', sourceBytes: sourceBytes.buffer,
      adjustments: { invert: true }, transforms: {}, outputMode: 'preview',
    } });
    const first = await firstResult;
    assert.equal(first.sourceRetained, true, 'the worker keeps its decoded original available for the next edit');

    const expectedOriginal = decodeOriginal(pillow, sourceBytes);
    try {
      const expected = renderImage(expectedOriginal, { brightness: 24, saturation: -15 }, { rotation: 90 }, pillow);
      const secondResult = waitFor(message => message.type === 'rendered' && message.requestId === 2);
      selfMock.onmessage({ data: {
        type: 'render', requestId: 2, assetId: 'same-original', sourceBytes: null,
        adjustments: { brightness: 24, saturation: -15 }, transforms: { rotation: 90 }, outputMode: 'preview',
      } });
      const second = await secondResult;

      assert.equal(second.sourceRetained, true);
      assert.deepEqual(second.bytes, expected.bytes,
        'the new settings render from the same original even though the previous worker output was a different edit');
      assert.deepEqual([...sourceBytes], [...twoPixelBmp()], 'sending the source to the worker leaves the editor-owned original bytes attached and unchanged');
    } finally { expectedOriginal.free(); }
  } finally {
    globalThis.self = previousSelf;
    globalThis.fetch = previousFetch;
  }
});
