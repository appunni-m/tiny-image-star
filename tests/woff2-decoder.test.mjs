import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LocalWoff2Decoder } from '../src/woff2-decoder.js';
import { fontVariationInspectionStatus, inspectFontVariationAxes } from '../src/font-variation.js';

const fixtureUrl = new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url);

test('the bundled local WASM worker inspects axes in a real variable WOFF2 without mutating the saved font bytes', async () => {
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  let receiveMessage;
  let activeWorker = null;
  const workerScope = {
    addEventListener(type, listener) {
      if (type === 'message') receiveMessage = listener;
    },
    postMessage(data) {
      activeWorker?.dispatch('message', { data });
    }
  };
  Object.defineProperty(globalThis, 'self', { configurable: true, value: workerScope });
  const workerUrl = new URL('../src/workers/woff2-decompress-worker.bundle.js', import.meta.url);
  await import(`${workerUrl.href}?woff2-test=${Date.now()}`);

  class BundledWorkerHarness {
    #listeners = new Map();
    addEventListener(type, listener) { this.#listeners.set(type, listener); }
    postMessage(message) {
      activeWorker = this;
      queueMicrotask(() => receiveMessage({ data: message }));
    }
    dispatch(type, event) { this.#listeners.get(type)?.(event); }
    terminate() {}
  }

  const decoder = new LocalWoff2Decoder({ workerFactory: () => new BundledWorkerHarness(), timeoutMs: 20_000, idleShutdownMs: 0 });
  try {
    const source = new Uint8Array(await readFile(fixtureUrl));
    const sourceCopy = source.slice();
    assert.equal(fontVariationInspectionStatus(source), 'inspected');
    const decoded = await decoder.decode(source);
    assert.deepEqual(source, sourceCopy, 'transferring a decoder-owned copy must preserve the retained original WOFF2 asset');
    assert.deepEqual(await inspectFontVariationAxes(decoded), [
      { tag: 'opsz', min: 14, defaultValue: 14, max: 32 },
      { tag: 'wght', min: 100, defaultValue: 400, max: 900 }
    ]);
  } finally {
    decoder.close();
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
    else delete globalThis.self;
  }
});

test('the decoder rejects invalid inputs before creating or messaging a worker', async () => {
  let created = false;
  const decoder = new LocalWoff2Decoder({ workerFactory: () => { created = true; throw new Error('unexpected worker creation'); } });
  try {
    await assert.rejects(decoder.decode(new Uint8Array([1, 2, 3, 4])), /valid WOFF2/);
    assert.equal(created, false);
  } finally { decoder.close(); }
});
