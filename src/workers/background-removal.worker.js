import * as ort from 'onnxruntime-web/wasm';
import {
  applyBackgroundRemovalMatte,
  backgroundRemovalModelDimensions,
  MAX_BACKGROUND_REMOVAL_PIXELS,
  MAX_BACKGROUND_REMOVAL_SOURCE_BYTES,
  validateBackgroundRemovalDimensions,
} from '../background-removal-mask.js';

const modelUrl = new URL('../../wasm/models/isnet-general-use-q8.onnx', import.meta.url).href;
const wasmBaseUrl = new URL('../../wasm/onnxruntime/', import.meta.url).href;
const cancelledRequests = new Set();
let sessionPromise = null;
let activeRequestId = null;

function postStage(requestId, stage, detail = '') {
  self.postMessage({ type: 'stage', requestId, stage, detail });
}

function getSession() {
  if (!sessionPromise) {
    // The model has one explicit WASM thread so it remains usable without
    // cross-origin isolation and cannot oversubscribe the Pillow worker pool.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = {
      mjs: `${wasmBaseUrl}ort-wasm-simd-threaded.mjs`,
      wasm: `${wasmBaseUrl}ort-wasm-simd-threaded.wasm`,
    };
    ort.env.logLevel = 'error';
    sessionPromise = ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      executionMode: 'sequential',
    }).then(session => {
      if (session.inputNames.length !== 1 || session.inputNames[0] !== 'input_image'
        || session.outputNames.length !== 1 || session.outputNames[0] !== 'output_image') {
        session.release();
        throw new Error('The local background-removal model has an unexpected input or output format.');
      }
      return session;
    }).catch(error => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

function isCancelled(requestId) { return cancelledRequests.has(requestId); }

async function removeBackground(message) {
  const { requestId } = message;
  let bitmap;
  let modelTensor;
  let modelOutput;
  try {
    if (!(message.sourceBytes instanceof ArrayBuffer)
      || message.sourceBytes.byteLength < 1 || message.sourceBytes.byteLength > MAX_BACKGROUND_REMOVAL_SOURCE_BYTES) {
      throw new TypeError('Background removal needs bounded image bytes.');
    }
    postStage(requestId, 'loading-model');
    const session = await getSession();
    if (isCancelled(requestId)) return;

    postStage(requestId, 'decoding-image');
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
      throw new Error('This browser cannot decode and mask images in a local worker.');
    }
    bitmap = await createImageBitmap(new Blob([message.sourceBytes]));
    const { width, height } = bitmap;
    const pixels = validateBackgroundRemovalDimensions(width, height);
    if (isCancelled(requestId)) return;

    const modelSize = backgroundRemovalModelDimensions(width, height);
    const modelCanvas = new OffscreenCanvas(modelSize.width, modelSize.height);
    const modelContext = modelCanvas.getContext('2d', { willReadFrequently: true });
    if (!modelContext) throw new Error('This browser cannot create a local model input surface.');
    modelContext.drawImage(bitmap, 0, 0, modelSize.width, modelSize.height);
    const modelPixels = modelContext.getImageData(0, 0, modelSize.width, modelSize.height).data;
    const planeSize = modelSize.width * modelSize.height;
    const tensorData = new Float32Array(planeSize * 3);
    for (let sourceIndex = 0, pixelIndex = 0; pixelIndex < planeSize; sourceIndex += 4, pixelIndex += 1) {
      tensorData[pixelIndex] = modelPixels[sourceIndex] / 255 - 0.5;
      tensorData[planeSize + pixelIndex] = modelPixels[sourceIndex + 1] / 255 - 0.5;
      tensorData[planeSize * 2 + pixelIndex] = modelPixels[sourceIndex + 2] / 255 - 0.5;
    }
    modelTensor = new ort.Tensor('float32', tensorData, [1, 3, modelSize.height, modelSize.width]);
    if (isCancelled(requestId)) return;

    postStage(requestId, 'segmenting');
    modelOutput = await session.run({ input_image: modelTensor });
    if (isCancelled(requestId)) return;
    const mask = modelOutput.output_image;
    if (!mask || mask.type !== 'float32'
      || mask.dims.join(',') !== `1,1,${modelSize.height},${modelSize.width}`
      || mask.data.length !== planeSize) {
      throw new Error('The local background-removal model returned an unexpected mask size.');
    }

    postStage(requestId, 'applying-alpha-matte');
    const sourceCanvas = new OffscreenCanvas(width, height);
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('This browser cannot create the local output image surface.');
    sourceContext.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = null;
    const sourcePixels = sourceContext.getImageData(0, 0, width, height);
    const result = applyBackgroundRemovalMatte(sourcePixels.data, width, height, mask.data, modelSize.width, modelSize.height);
    if (result.pixels.length !== pixels * 4) throw new Error('The local background-removal output has invalid pixels.');
    sourceContext.putImageData(sourcePixels, 0, 0);

    postStage(requestId, 'encoding-png');
    const blob = await sourceCanvas.convertToBlob({ type: 'image/png' });
    if (blob.type !== 'image/png' || blob.size < 1) throw new Error('The transparent image could not be encoded as PNG.');
    if (isCancelled(requestId)) return;
    const bytes = await blob.arrayBuffer();
    if (isCancelled(requestId)) return;
    self.postMessage({ type: 'removed', requestId, mimeType: 'image/png', width, height, bytes }, [bytes]);
  } catch (error) {
    if (!isCancelled(requestId)) self.postMessage({ type: 'error', requestId, message: error?.message || 'Local background removal failed.' });
  } finally {
    const wasCancelled = isCancelled(requestId);
    bitmap?.close();
    modelTensor?.dispose?.();
    if (modelOutput) for (const tensor of Object.values(modelOutput)) tensor?.dispose?.();
    cancelledRequests.delete(requestId);
    if (activeRequestId === requestId) activeRequestId = null;
    if (wasCancelled) self.postMessage({ type: 'cancelled', requestId });
  }
}

self.onmessage = event => {
  const message = event.data;
  if (message?.type === 'initialize') {
    void getSession().then(
      () => self.postMessage({ type: 'ready' }),
      error => self.postMessage({ type: 'init-error', message: error?.message || 'The local background-removal model could not start.' }),
    );
    return;
  }
  if (message?.type === 'cancel' && typeof message.requestId === 'string') {
    cancelledRequests.add(message.requestId);
    return;
  }
  if (message?.type === 'dispose') {
    void sessionPromise?.then(session => session.release()).catch(() => {});
    sessionPromise = null;
    self.postMessage({ type: 'disposed' });
    self.close();
    return;
  }
  if (message?.type !== 'remove-background' || typeof message.requestId !== 'string' || !message.requestId) return;
  if (activeRequestId) {
    self.postMessage({ type: 'error', requestId: message.requestId, message: 'Background removal is busy with another image. Wait for it to finish, then retry.' });
    return;
  }
  activeRequestId = message.requestId;
  void removeBackground(message);
};
