import * as ort from 'onnxruntime-web/wasm';
import { compositeInpaintRgbPixels, rasterizeInpaintMask, resolveImageEraseStrokes, validateInpaintDimensions } from '../inpaint-mask.js';

const modelUrl = new URL('../../wasm/models/migan_pipeline_v2.onnx', import.meta.url).href;
const wasmBaseUrl = new URL('../../wasm/onnxruntime/', import.meta.url).href;
const cancelledRequests = new Set();
const activeRequests = new Set();
let sessionPromise = null;

function postStage(requestId, stage, detail = '') {
  self.postMessage({ type: 'stage', requestId, stage, detail });
}

function getSession() {
  if (!sessionPromise) {
    // One WASM thread keeps this usable in ordinary mobile tabs without
    // cross-origin isolation and prevents AI work from oversubscribing the
    // editor's shared Pillow-RS worker pool.
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
      if (session.inputNames.length !== 2
        || !session.inputNames.includes('image')
        || !session.inputNames.includes('mask')
        || !session.outputNames.includes('result')) {
        session.release();
        throw new Error('The bundled object-erase model has an unexpected input or output format.');
      }
      return session;
    }).catch(error => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

function cancelled(requestId) {
  return cancelledRequests.has(requestId);
}

async function inpaint(message) {
  const { requestId } = message;
  let bitmap;
  let imageTensor;
  let maskTensor;
  let outputs;
  try {
    if (!(message.sourceBytes instanceof ArrayBuffer) || !Array.isArray(message.strokes)) {
      throw new TypeError('Object erase needs image bytes and at least one brush stroke.');
    }
    postStage(requestId, 'loading-model');
    const session = await getSession();
    if (cancelled(requestId)) return;

    postStage(requestId, 'decoding-image');
    bitmap = await createImageBitmap(new Blob([message.sourceBytes]));
    const { width, height } = bitmap;
    const pixelCount = validateInpaintDimensions(width, height);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser cannot create a local image surface for object erase.');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = null;
    const pixels = context.getImageData(0, 0, width, height);
    if (cancelled(requestId)) return;

    const pixelStrokes = resolveImageEraseStrokes(message.strokes, width, height);
    const mask = rasterizeInpaintMask(width, height, pixelStrokes);
    const image = new Uint8Array(pixelCount * 3);
    const planeSize = pixelCount;
    for (let sourceIndex = 0, pixelIndex = 0; pixelIndex < pixelCount; sourceIndex += 4, pixelIndex += 1) {
      image[pixelIndex] = pixels.data[sourceIndex];
      image[planeSize + pixelIndex] = pixels.data[sourceIndex + 1];
      image[planeSize * 2 + pixelIndex] = pixels.data[sourceIndex + 2];
    }
    imageTensor = new ort.Tensor('uint8', image, [1, 3, height, width]);
    maskTensor = new ort.Tensor('uint8', mask, [1, 1, height, width]);

    postStage(requestId, 'inpainting');
    outputs = await session.run({ image: imageTensor, mask: maskTensor });
    if (cancelled(requestId)) return;
    const result = outputs.result;
    if (!result || result.type !== 'uint8' || result.dims.join(',') !== `1,3,${height},${width}`
      || result.data.length !== planeSize * 3) {
      throw new Error('The object-erase model returned an unexpected image size.');
    }

    postStage(requestId, 'encoding-preview');
    compositeInpaintRgbPixels(pixels.data, result.data, mask, width, height);
    context.putImageData(pixels, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    if (cancelled(requestId)) return;
    const bytes = await blob.arrayBuffer();
    if (cancelled(requestId)) return;
    self.postMessage({ type: 'rendered', requestId, width, height, bytes }, [bytes]);
  } catch (error) {
    if (!cancelled(requestId)) {
      self.postMessage({ type: 'error', requestId, message: error?.message || 'Local object erase failed.' });
    }
  } finally {
    const wasCancelled = cancelled(requestId);
    bitmap?.close();
    imageTensor?.dispose?.();
    maskTensor?.dispose?.();
    if (outputs) for (const tensor of Object.values(outputs)) tensor?.dispose?.();
    cancelledRequests.delete(requestId);
    activeRequests.delete(requestId);
    if (wasCancelled) self.postMessage({ type: 'cancelled', requestId });
  }
}

self.onmessage = event => {
  const message = event.data;
  if (message?.type === 'cancel') {
    if (activeRequests.has(message.requestId)) cancelledRequests.add(message.requestId);
    return;
  }
  if (message?.type === 'inpaint' && typeof message.requestId === 'string' && message.requestId) {
    if (activeRequests.size) {
      self.postMessage({ type: 'error', requestId: message.requestId, message: 'Object erase is busy with another image. Wait for it to finish, then retry.' });
      return;
    }
    activeRequests.add(message.requestId);
    void inpaint(message);
  }
};

void getSession().then(
  () => self.postMessage({ type: 'ready' }),
  error => self.postMessage({ type: 'init-error', message: error?.message || 'The local object-erase model could not start.' }),
);
