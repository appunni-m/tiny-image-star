import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseLocalFigFile } from '../src/fig-import-worker-client.js';

test('isolated .fig import returns the exact transferred archive buffer without copying it', async () => {
  const fixtureBytes = new Uint8Array(await readFile(new URL('./fixtures/fig-import/circle-v101.fig', import.meta.url)));
  const originalArchiveBuffer = fixtureBytes.buffer.slice(
    fixtureBytes.byteOffset,
    fixtureBytes.byteOffset + fixtureBytes.byteLength
  );
  let workerMessageHandler = null;
  let activeWorker = null;
  let inboundTransfers = null;
  let outboundTransfers = null;

  const workerSelf = {
    addEventListener(type, listener) {
      if (type !== 'message') throw new TypeError(`Unexpected worker event: ${type}`);
      workerMessageHandler = listener;
    },
    postMessage(data, transfers) {
      outboundTransfers = transfers;
      activeWorker.onmessage?.({ data });
    }
  };
  class FakeWorker {
    constructor(url, options) {
      assert.match(String(url), /fig-import-worker\.bundle\.js/u);
      assert.equal(options.name, 'tiny-image-star-fig-import');
      activeWorker = this;
    }
    postMessage(data, transfers) {
      inboundTransfers = transfers;
      workerMessageHandler({ data });
    }
    terminate() { this.terminated = true; }
  }

  const previousSelf = globalThis.self;
  const previousWorker = globalThis.Worker;
  globalThis.self = workerSelf;
  globalThis.Worker = FakeWorker;
  try {
    await import('../src/workers/fig-import.worker.js?fig-source-sidecar-test');
    const result = await parseLocalFigFile({
      name: 'circle-v101.fig',
      size: fixtureBytes.byteLength,
      arrayBuffer: async () => originalArchiveBuffer
    });

    assert.equal(inboundTransfers[0], originalArchiveBuffer,
      'the client transfers the file buffer into the worker');
    assert.equal(result.figSourceArchive, originalArchiveBuffer,
      'the worker returns the same ArrayBuffer object received from the client');
    assert.ok(outboundTransfers.includes(originalArchiveBuffer),
      'the original buffer is transferred back instead of structured-cloned');
    assert.deepEqual(new Uint8Array(result.figSourceArchive), fixtureBytes,
      'the sidecar bytes are identical to the selected .fig file');
    assert.equal(result.report.formatVersion, 101);
    assert.equal(activeWorker.terminated, true);
  } finally {
    globalThis.self = previousSelf;
    globalThis.Worker = previousWorker;
  }
});
