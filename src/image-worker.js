import { decodeOriginal, renderImage } from './image-processing.js';

let pillow;
const sources = new Map();
const ready = import('../wasm/pillow_rs_js.js').then(async module => { await module.default(); pillow = module; });

self.onmessage = async event => {
  const message = event.data;
  if (message.type === 'dispose') {
    sources.get(message.assetId)?.free();
    sources.delete(message.assetId);
    self.postMessage({ type: 'disposed', assetId: message.assetId });
    return;
  }
  if (message.type !== 'render') return;
  try {
    await ready;
    let source = sources.get(message.assetId);
    if (!source) {
      if (!message.sourceBytes) throw new Error('The original image is no longer available in memory.');
      source = decodeOriginal(pillow, new Uint8Array(message.sourceBytes));
      sources.set(message.assetId, source);
    }
    const result = renderImage(source, message.adjustments);
    self.postMessage({ type: 'rendered', requestId: message.requestId, assetId: message.assetId, ...result }, [result.bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', requestId: message.requestId, assetId: message.assetId, message: error?.message || 'Pillow-RS could not render this image.' });
  }
};

ready.then(() => self.postMessage({ type: 'ready' }), error => self.postMessage({ type: 'init-error', message: error?.message || 'Pillow-RS WebAssembly failed to load.' }));

self.addEventListener('close', () => { for (const source of sources.values()) source.free(); sources.clear(); });
