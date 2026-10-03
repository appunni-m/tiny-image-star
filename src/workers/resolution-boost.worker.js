import * as ort from 'onnxruntime-web/wasm';
import {
  copyResolutionBoostTile,
  MAX_RESOLUTION_BOOST_OUTPUT_BYTES,
  MAX_RESOLUTION_BOOST_SOURCE_BYTES,
  resolutionBoostTiles,
  rgbaPixelsToNchw,
  upscaleRgbaAlpha,
  validateResolutionBoostDimensions,
} from '../resolution-boost.js';

const modelUrl = new URL('../../wasm/models/realesr-general-x4v3.onnx', import.meta.url).href;
const wasmBaseUrl = new URL('../../wasm/onnxruntime/', import.meta.url).href;
const cancelledRequests = new Set();
let sessionPromise = null;
let configuredThreads = null;
let activeRequestId = null;

function postStage(requestId, stage, detail = '') {
  self.postMessage({ type: 'stage', requestId, stage, detail });
}

function getSession(numThreads) {
  if (!Number.isSafeInteger(numThreads) || numThreads < 1 || numThreads > 4) {
    throw new RangeError('Local resolution boost supports one through four WebAssembly threads.');
  }
  if (numThreads > 1 && self.crossOriginIsolated !== true) {
    throw new Error('This page cannot use shared WebAssembly threads. Resolution boost will use one CPU thread after restart.');
  }
  if (sessionPromise) {
    if (configuredThreads !== numThreads) throw new Error('Resolution boost worker thread settings cannot change while its model is loaded.');
    return sessionPromise;
  }
  configuredThreads = numThreads;
  ort.env.wasm.numThreads = numThreads;
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
    if (session.inputNames.length !== 1 || session.inputNames[0] !== 'input'
      || session.outputNames.length !== 1 || session.outputNames[0] !== 'output') {
      session.release();
      throw new Error('The local resolution-boost model has an unexpected input or output format.');
    }
    return session;
  }).catch(error => {
    sessionPromise = null;
    configuredThreads = null;
    throw error;
  });
  return sessionPromise;
}

function isCancelled(requestId) { return cancelledRequests.has(requestId); }

function copyInputTile(source, sourceWidth, tile) {
  const pixels = new Uint8ClampedArray(tile.input.width * tile.input.height * 4);
  for (let row = 0; row < tile.input.height; row += 1) {
    const sourceStart = ((tile.input.top + row) * sourceWidth + tile.input.left) * 4;
    const targetStart = row * tile.input.width * 4;
    pixels.set(source.subarray(sourceStart, sourceStart + tile.input.width * 4), targetStart);
  }
  return pixels;
}

async function boost(message) {
  const { requestId } = message;
  let bitmap;
  let modelTensor;
  let modelOutput;
  try {
    if (!(message.sourceBytes instanceof ArrayBuffer)
      || message.sourceBytes.byteLength < 1 || message.sourceBytes.byteLength > MAX_RESOLUTION_BOOST_SOURCE_BYTES) {
      throw new TypeError('Resolution boost needs bounded original image bytes.');
    }
    postStage(requestId, 'loading-model');
    const session = await getSession(message.numThreads);
    if (isCancelled(requestId)) return;

    postStage(requestId, 'decoding-image');
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
      throw new Error('This browser cannot decode and upscale images in a local worker.');
    }
    bitmap = await createImageBitmap(new Blob([message.sourceBytes]));
    const { width, height } = bitmap;
    if (width !== message.width || height !== message.height) {
      throw new Error('The selected image dimensions changed before local resolution boost could start.');
    }
    const dimensions = validateResolutionBoostDimensions(width, height);
    const outputByteLength = dimensions.outputPixels * 4;
    if (!Number.isSafeInteger(outputByteLength) || outputByteLength > MAX_RESOLUTION_BOOST_OUTPUT_BYTES) {
      throw new RangeError('The resolution-boosted image would exceed the local output-memory limit.');
    }
    if (isCancelled(requestId)) return;

    const sourceCanvas = new OffscreenCanvas(width, height);
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('This browser cannot read local image pixels for resolution boost.');
    sourceContext.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    bitmap = null;
    const sourcePixels = sourceContext.getImageData(0, 0, width, height).data;
    const outputPixels = new Uint8ClampedArray(outputByteLength);
    const tiles = resolutionBoostTiles(width, height);

    for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
      if (isCancelled(requestId)) return;
      const tile = tiles[tileIndex];
      postStage(requestId, 'upscaling', `Tile ${tileIndex + 1} of ${tiles.length}`);
      const inputPixels = copyInputTile(sourcePixels, width, tile);
      const tensorData = rgbaPixelsToNchw(inputPixels, tile.input.width, tile.input.height);
      inputPixels.fill(0);
      modelTensor = new ort.Tensor('float32', tensorData, [1, 3, tile.input.height, tile.input.width]);
      modelOutput = await session.run({ input: modelTensor });
      modelTensor.dispose?.();
      modelTensor = null;
      if (isCancelled(requestId)) return;

      const output = modelOutput.output;
      const expectedDims = [1, 3, tile.input.height * 4, tile.input.width * 4];
      if (!output || output.type !== 'float32'
        || output.dims.join(',') !== expectedDims.join(',')
        || output.data.length !== tile.input.width * tile.input.height * 16 * 3) {
        throw new Error('The local resolution-boost model returned an unexpected tile size.');
      }
      for (let index = 0; index < output.data.length; index += 1) {
        if (!Number.isFinite(output.data[index])) throw new Error('The local resolution-boost model returned invalid pixels.');
      }
      copyResolutionBoostTile(outputPixels, output.data, tile.input.width, tile);
      for (const tensor of Object.values(modelOutput)) tensor?.dispose?.();
      modelOutput = null;
    }

    if (isCancelled(requestId)) return;
    postStage(requestId, 'restoring-transparency');
    upscaleRgbaAlpha(outputPixels, sourcePixels, width, height);
    const outputCanvas = new OffscreenCanvas(dimensions.outputWidth, dimensions.outputHeight);
    const outputContext = outputCanvas.getContext('2d', { alpha: true });
    if (!outputContext) throw new Error('This browser cannot encode the local resolution-boost result.');
    outputContext.putImageData(new ImageData(outputPixels, dimensions.outputWidth, dimensions.outputHeight), 0, 0);

    postStage(requestId, 'encoding-png');
    const blob = await outputCanvas.convertToBlob({ type: 'image/png' });
    if (blob.type !== 'image/png' || blob.size < 1 || blob.size > MAX_RESOLUTION_BOOST_OUTPUT_BYTES) {
      throw new Error('The resolution-boosted image could not be encoded within the local output limit.');
    }
    if (isCancelled(requestId)) return;
    const bytes = await blob.arrayBuffer();
    if (isCancelled(requestId)) return;
    self.postMessage({
      type: 'boosted', requestId, mimeType: 'image/png',
      width: dimensions.outputWidth, height: dimensions.outputHeight, bytes,
    }, [bytes]);
  } catch (error) {
    if (!isCancelled(requestId)) self.postMessage({ type: 'error', requestId, message: error?.message || 'Local resolution boost failed.' });
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
    void getSession(message.numThreads).then(
      () => self.postMessage({ type: 'ready' }),
      error => self.postMessage({ type: 'init-error', message: error?.message || 'The local resolution-boost model could not start.' }),
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
  if (message?.type !== 'boost' || typeof message.requestId !== 'string' || !message.requestId) return;
  if (activeRequestId) {
    self.postMessage({ type: 'error', requestId: message.requestId, message: 'Resolution boost is busy with another image. Wait for it to finish, then retry.' });
    return;
  }
  activeRequestId = message.requestId;
  void boost(message);
};
