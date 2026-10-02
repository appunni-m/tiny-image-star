import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as pillow from '../wasm/pillow_rs_js.js';
import { decodeOriginal, imagePreviewResolutionMatches, renderImage } from '../src/image-processing.js';

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

test('a budgeted preview source stays reusable while exports still decode the full-resolution original', async () => {
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

    const configured = waitFor(message => message.type === 'cache-configured' && message.generation === 1);
    selfMock.onmessage({ data: { type: 'configure-cache', generation: 1, pixelBudget: 2 } });
    await configured;

    const sourceBytes = fourByTwoBmp();
    const firstResult = waitFor(message => message.type === 'rendered' && message.requestId === 1);
    selfMock.onmessage({ data: {
      type: 'render', requestId: 1, assetId: 'same-original', sourceBytes: sourceBytes.buffer,
      adjustments: { invert: true }, transforms: {}, previewMaxDimension: 8, outputMode: 'preview',
    } });
    const first = await firstResult;
    assert.equal(first.sourceRetained, true, 'the worker retains the interactive source inside its small pixel budget');
    assert.deepEqual([first.width, first.height, first.sourceWidth, first.sourceHeight], [2, 1, 2, 1]);

    const expectedOriginal = decodeOriginal(pillow, sourceBytes);
    try {
      expectedOriginal.thumbnail(2, 2);
      const expected = renderImage(expectedOriginal, { brightness: 24, saturation: -15 }, { rotation: 90 }, pillow, { previewMaxDimension: 8 });
      const secondResult = waitFor(message => message.type === 'rendered' && message.requestId === 2);
      selfMock.onmessage({ data: {
        type: 'render', requestId: 2, assetId: 'same-original', sourceBytes: null,
        adjustments: { brightness: 24, saturation: -15 }, transforms: { rotation: 90 },
        previewMaxDimension: 8, outputMode: 'preview',
      } });
      const second = await secondResult;

      assert.equal(second.sourceRetained, true);
      assert.deepEqual(second.bytes, expected.bytes,
        'the new settings render from the same unedited, budgeted source rather than the previous preview');
      assert.equal(imagePreviewResolutionMatches(second.width, second.height, 2, 4), true,
        'a lower-resolution cache preview preserves the verified original aspect ratio');

      const exportResult = waitFor(message => message.type === 'rendered' && message.requestId === 3);
      selfMock.onmessage({ data: {
        type: 'render', requestId: 3, assetId: 'same-original', sourceBytes: sourceBytes.buffer,
        adjustments: { brightness: 24 }, transforms: {}, previewMaxDimension: 1,
        format: 'png', quality: 90, outputMode: 'export',
      } });
      const exported = await exportResult;
      assert.deepEqual([exported.width, exported.height], [4, 2], 'exports always use the original dimensions');
      assert.equal(exported.sourceRetained, true, 'full-resolution export preserves the active preview source');

      const thirdResult = waitFor(message => message.type === 'rendered' && message.requestId === 4);
      selfMock.onmessage({ data: {
        type: 'render', requestId: 4, assetId: 'same-original', sourceBytes: null,
        adjustments: { brightness: 12 }, transforms: {}, previewMaxDimension: 8, outputMode: 'preview',
      } });
      const third = await thirdResult;
      assert.equal(third.sourceRetained, true, 'subsequent previews continue using the retained source after export');
      assert.deepEqual([...sourceBytes], [...fourByTwoBmp()], 'worker processing leaves the editor-owned original bytes attached and unchanged');
    } finally { expectedOriginal.free(); }
  } finally {
    globalThis.self = previousSelf;
    globalThis.fetch = previousFetch;
  }
});
