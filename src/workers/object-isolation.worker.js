import { FilesetResolver, InteractiveSegmenter } from '@mediapipe/tasks-vision';
import { applyObjectIsolationMaskToRgba, normalizeObjectIsolationStrokes, validateObjectIsolationDimensions } from '../object-isolation-mask.js';

const wasmBaseUrl = new URL('../../wasm/mediapipe/', import.meta.url).href;
const modelUrl = new URL('../../wasm/models/interactive_segmentation.task', import.meta.url).href;
const cancelledRequests = new Set();
let segmenterPromise = null;
let activeRequestId = null;

function postStage(requestId, stage, detail = '') {
  self.postMessage({ type: 'stage', requestId, stage, detail });
}

async function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(wasmBaseUrl, false);
      // CPU inference is deterministic across supported browsers and avoids a
      // second mobile GPU context competing with the editor's canvas renderer.
      return InteractiveSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
      });
    })().catch(error => {
      segmenterPromise = null;
      throw error;
    });
  }
  return segmenterPromise;
}

function isCancelled(requestId) {
  return cancelledRequests.has(requestId);
}

async function isolate(message) {
  const { requestId } = message;
  let bitmap;
  let mask;
  try {
    if (!(message.sourceBytes instanceof ArrayBuffer) || !Array.isArray(message.strokes)) {
      throw new TypeError('Object isolation needs original image bytes and completed selection strokes.');
    }
    const strokes = normalizeObjectIsolationStrokes(message.strokes);
    postStage(requestId, 'loading-model');
    const task = await getSegmenter();
    if (isCancelled(requestId)) return;

    postStage(requestId, 'decoding-source');
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
      throw new Error('This browser cannot decode and mask images in a local worker.');
    }
    bitmap = await createImageBitmap(new Blob([message.sourceBytes]));
    const { width, height } = bitmap;
    validateObjectIsolationDimensions(width, height);
    if (isCancelled(requestId)) return;

    postStage(requestId, 'encoding-image-features');
    // MediaPipe setImage is synchronous; keeping this work in its own worker
    // leaves the canvas, pointer events, and mobile scrolling responsive.
    task.setImage(bitmap);
    bitmap.close();
    bitmap = null;
    if (isCancelled(requestId)) return;

    postStage(requestId, 'segmenting');
    mask = task.segment(strokes);
    if (!mask || !mask.hasFloat32Array()) {
      throw new Error('The local object-isolation model returned no confidence mask.');
    }
    const maskWidth = mask.width;
    const maskHeight = mask.height;
    validateObjectIsolationDimensions(maskWidth, maskHeight);
    const confidence = mask.getAsFloat32Array();
    mask.close();
    mask = null;
    if (isCancelled(requestId)) return;

    postStage(requestId, 'creating-transparent-layer');
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser cannot create an image surface for object isolation.');
    bitmap = await createImageBitmap(new Blob([message.sourceBytes]));
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = null;
    const image = context.getImageData(0, 0, width, height);
    const result = applyObjectIsolationMaskToRgba(image.data, width, height, confidence, maskWidth, maskHeight);
    if (result.selectedPixels < 1) throw new Error('The selection did not contain any visible pixels. Add a positive stroke and try again.');
    context.putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    if (blob.type !== 'image/png' || blob.size < 1) throw new Error('The transparent image could not be encoded as PNG.');
    if (isCancelled(requestId)) return;
    const bytes = await blob.arrayBuffer();
    if (isCancelled(requestId)) return;
    self.postMessage({ type: 'rendered', requestId, mimeType: 'image/png', width, height, bytes }, [bytes]);
  } catch (error) {
    if (!isCancelled(requestId)) {
      self.postMessage({ type: 'error', requestId, message: error?.message || 'Local object isolation failed.' });
    }
  } finally {
    const wasCancelled = isCancelled(requestId);
    bitmap?.close();
    mask?.close();
    cancelledRequests.delete(requestId);
    if (activeRequestId === requestId) activeRequestId = null;
    if (wasCancelled) self.postMessage({ type: 'cancelled', requestId });
  }
}

self.onmessage = event => {
  const message = event.data;
  if (message?.type === 'initialize') {
    void getSegmenter().then(
      () => self.postMessage({ type: 'ready' }),
      error => self.postMessage({ type: 'init-error', message: error?.message || 'The local object-isolation model could not start.' }),
    );
    return;
  }
  if (message?.type === 'cancel' && typeof message.requestId === 'string') {
    cancelledRequests.add(message.requestId);
    return;
  }
  if (message?.type === 'dispose') {
    void segmenterPromise?.then(task => task.close()).catch(() => {});
    segmenterPromise = null;
    self.postMessage({ type: 'disposed' });
    self.close();
    return;
  }
  if (message?.type !== 'isolate' || typeof message.requestId !== 'string' || !message.requestId) return;
  if (activeRequestId) {
    self.postMessage({ type: 'error', requestId: message.requestId, message: 'Object isolation is busy with another image. Wait for it to finish, then retry.' });
    return;
  }
  activeRequestId = message.requestId;
  void isolate(message);
};
