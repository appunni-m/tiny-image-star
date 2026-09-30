import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
    assert.equal(rendered.qualityApplied, false, 'the vendored save binding does not accept codec quality options');
  } finally {
    globalThis.self = previousSelf;
    globalThis.fetch = previousFetch;
  }
});
