import { decodeOriginal, renderImage, renderImageOutput } from './image-processing.js';
import { DecodedSourceCache, imageCacheDimensionForBudget } from './decoded-source-cache.js';

let pillow;
const sources = new DecodedSourceCache();
const sourceModes = new Map();
const activeRenders = new Map();
const ready = import('../wasm/pillow_rs_js.js').then(async module => { await module.default(); pillow = module; });

function forgetEvictedSources(assetIds = []) {
  for (const assetId of assetIds) sourceModes.delete(assetId);
}

function createWorkerSource(assetId, sourceBytes, outputMode) {
  const source = decodeOriginal(pillow, new Uint8Array(sourceBytes));
  let mode = 'full';
  if (outputMode === 'preview') {
    const maxDimension = imageCacheDimensionForBudget(source.width, source.height, sources.pixelBudget);
    if (maxDimension !== null) {
      try {
        source.thumbnail(maxDimension, maxDimension);
        // Pillow-RS and other image codecs can differ by one pixel when they
        // round a constrained aspect axis. Stay strictly inside the shared
        // cache budget rather than allowing that rounding to defeat admission.
        let edge = maxDimension;
        while (source.width * source.height > sources.pixelBudget && edge > 1) {
          edge -= 1;
          source.thumbnail(edge, edge);
        }
        mode = 'preview';
      } catch (error) {
        source.free();
        throw error;
      }
    }
  }
  sourceModes.set(assetId, mode);
  return source;
}

self.onmessage = async event => {
  const message = event.data;
  if (message.type === 'set-active-source') {
    sources.setActive(message.assetId);
    return;
  }
  if (message.type === 'configure-cache') {
    try {
      const { pixelBudget, evictedAssetIds } = sources.setBudget(message.pixelBudget);
      forgetEvictedSources(evictedAssetIds);
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
    sourceModes.delete(message.assetId);
    self.postMessage({ type: 'disposed', assetId: message.assetId });
    return;
  }
  if (message.type !== 'render') return;
  const renderState = { assetId: message.assetId, invalidated: false };
  activeRenders.set(message.requestId, renderState);
  try {
    await ready;
    if (message.outputMode != null && !['preview', 'export'].includes(message.outputMode)) {
      throw new TypeError('The local image worker received an unsupported output mode.');
    }
    const renderSource = source => (message.outputMode === 'export' ? renderImageOutput : renderImage)(source, message.adjustments, message.transforms, pillow, {
      format: message.format ?? 'png',
      quality: message.quality ?? 90,
      previewMaxDimension: message.outputMode === 'export' ? undefined : message.previewMaxDimension,
    });
    if (message.outputMode === 'export' && sourceModes.get(message.assetId) === 'preview') {
      // The retained interactive source is deliberately downsampled to fit a
      // low-memory worker. Exports always decode the editor-owned original
      // bytes, leaving the responsive preview source ready for further edits.
      if (!message.sourceBytes) throw new Error('The original image is no longer available in memory.');
      const source = decodeOriginal(pillow, new Uint8Array(message.sourceBytes));
      try {
        const result = renderSource(source);
        self.postMessage({ type: 'rendered', requestId: message.requestId, assetId: message.assetId, sourceRetained: sources.has(message.assetId), evictedAssetIds: [], ...result }, [result.bytes.buffer]);
      } finally { source.free(); }
      return;
    }

    let createdMode = null;
    const cachedRender = sources.withSource(message.assetId, () => {
      if (!message.sourceBytes) throw new Error('The original image is no longer available in memory.');
      const source = createWorkerSource(message.assetId, message.sourceBytes, message.outputMode);
      createdMode = sourceModes.get(message.assetId);
      return source;
    }, renderSource, { retain: !renderState.invalidated });
    const { result, retained, evictedAssetIds } = cachedRender;
    forgetEvictedSources(evictedAssetIds);
    if (retained && createdMode) sourceModes.set(message.assetId, createdMode);
    else if (!retained) sourceModes.delete(message.assetId);
    self.postMessage({ type: 'rendered', requestId: message.requestId, assetId: message.assetId, sourceRetained: retained, evictedAssetIds, ...result }, [result.bytes.buffer]);
  } catch (error) {
    const cacheState = error?.decodedSourceCache;
    forgetEvictedSources(cacheState?.evictedAssetIds);
    if (cacheState && !cacheState.retained) sourceModes.delete(message.assetId);
    self.postMessage({ type: 'error', requestId: message.requestId, assetId: message.assetId, sourceRetained: cacheState?.retained, evictedAssetIds: cacheState?.evictedAssetIds || [], message: error?.message || 'Pillow-RS could not render this image.' });
  } finally {
    if (activeRenders.get(message.requestId) === renderState) activeRenders.delete(message.requestId);
  }
};

ready.then(() => self.postMessage({ type: 'ready' }), error => self.postMessage({ type: 'init-error', message: error?.message || 'Pillow-RS WebAssembly failed to load.' }));

self.addEventListener('close', () => { sources.clear(); sourceModes.clear(); });
