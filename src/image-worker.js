import { decodeOriginal, renderImage, renderImageOutput } from './image-processing.js';
import { DecodedSourceCache } from './decoded-source-cache.js';

let pillow;
const sources = new DecodedSourceCache();
const activeRenders = new Map();
const ready = import('../wasm/pillow_rs_js.js').then(async module => { await module.default(); pillow = module; });

self.onmessage = async event => {
  const message = event.data;
  if (message.type === 'set-active-source') {
    sources.setActive(message.assetId);
    return;
  }
  if (message.type === 'configure-cache') {
    try {
      const { pixelBudget, evictedAssetIds } = sources.setBudget(message.pixelBudget);
      self.postMessage({ type: 'cache-configured', generation: message.generation, pixelBudget, evictedAssetIds });
    } catch (error) {
      self.postMessage({ type: 'cache-config-error', generation: message.generation, message: error?.message || 'The decoded image cache could not be configured.' });
    }
    return;
  }
  if (message.type === 'dispose') {
    for (const render of activeRenders.values()) {
      if (render.assetId === message.assetId) render.invalidated = true;
    }
    sources.delete(message.assetId);
    self.postMessage({ type: 'disposed', assetId: message.assetId });
    return;
  }
  if (message.type !== 'render') return;
  const render = { assetId: message.assetId, invalidated: false };
  activeRenders.set(message.requestId, render);
  try {
    await ready;
    if (message.outputMode != null && !['preview', 'export'].includes(message.outputMode)) {
      throw new TypeError('The local image worker received an unsupported output mode.');
    }
    const cachedRender = sources.withSource(message.assetId, () => {
      if (!message.sourceBytes) throw new Error('The original image is no longer available in memory.');
      return decodeOriginal(pillow, new Uint8Array(message.sourceBytes));
    }, source => (message.outputMode === 'export' ? renderImageOutput : renderImage)(source, message.adjustments, message.transforms, pillow, {
      format: message.format ?? 'png',
      quality: message.quality ?? 90,
    }), { retain: !render.invalidated });
    const { result, retained, evictedAssetIds } = cachedRender;
    self.postMessage({ type: 'rendered', requestId: message.requestId, assetId: message.assetId, sourceRetained: retained, evictedAssetIds, ...result }, [result.bytes.buffer]);
  } catch (error) {
    const cacheState = error?.decodedSourceCache;
    self.postMessage({ type: 'error', requestId: message.requestId, assetId: message.assetId, sourceRetained: cacheState?.retained, evictedAssetIds: cacheState?.evictedAssetIds || [], message: error?.message || 'Pillow-RS could not render this image.' });
  } finally {
    if (activeRenders.get(message.requestId) === render) activeRenders.delete(message.requestId);
  }
};

ready.then(() => self.postMessage({ type: 'ready' }), error => self.postMessage({ type: 'init-error', message: error?.message || 'Pillow-RS WebAssembly failed to load.' }));

self.addEventListener('close', () => sources.clear());
