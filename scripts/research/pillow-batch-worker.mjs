import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import * as pillow from '../../wasm/pillow_rs_js.js';
import { DecodedSourceCache } from '../../src/decoded-source-cache.js';
import { decodeOriginal, renderImage } from '../../src/image-processing.js';

const wasmBytes = await readFile(new URL('../../wasm/pillow_rs_js_bg.wasm', import.meta.url));
await pillow.default({ module_or_path: wasmBytes });
const sources = new DecodedSourceCache({ pixelBudget: workerData.cachePixelBudget });
parentPort.postMessage({ type: 'ready', workerId: workerData.workerId });

parentPort.on('message', message => {
  if (message?.type !== 'render') return;
  try {
    for (const image of message.images) {
      const { result } = sources.withSource(
        image.assetId,
        () => decodeOriginal(pillow, new Uint8Array(image.sourceBytes)),
        source => renderImage(source, image.adjustments, image.transforms, pillow),
      );
      const bytes = result.bytes.byteOffset === 0 && result.bytes.byteLength === result.bytes.buffer.byteLength
        ? result.bytes
        : result.bytes.slice();
      parentPort.postMessage({ type: 'result', workerId: workerData.workerId, assetId: image.assetId, bytes: bytes.buffer }, [bytes.buffer]);
    }
    parentPort.postMessage({ type: 'done', workerId: workerData.workerId });
  } catch (error) {
    parentPort.postMessage({ type: 'error', workerId: workerData.workerId, message: error?.message || String(error) });
  }
});

parentPort.on('close', () => sources.clear());
