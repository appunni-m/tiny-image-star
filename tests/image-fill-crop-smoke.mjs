import { addNode, createDocument, createNode } from '../src/model.js';
import { createImageFill } from '../src/image-fills.js';
import { deleteImageAsset, deleteStoredDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const documentId = `image-fill-crop-${Date.now()}`;
let assetId = null;

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { if (await test()) { resolve(); return; } } catch { /* Wait for editor startup, save, and preview work. */ }
      if (performance.now() - start > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    poll();
  });
}
function click(app, element) {
  assert(element, 'Expected an image-fill editor control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function packageFile(design, assets) {
  const manifest = new TextEncoder().encode(JSON.stringify({
    schema: design.schema,
    document: design,
    assets: assets.map(({ id, name, type, bytes }) => ({ id, name, type, length: bytes.byteLength }))
  }));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, manifest.byteLength, true);
  const pieces = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest, ...assets.map(asset => new Uint8Array(asset.bytes))];
  const bytes = new Uint8Array(pieces.reduce((total, piece) => total + piece.byteLength, 0));
  let offset = 0;
  for (const piece of pieces) { bytes.set(piece, offset); offset += piece.byteLength; }
  return bytes;
}
function pointer(app, canvas, type, pointerId, worldX, worldY, pointerType = 'touch') {
  const context = canvas.getContext('2d');
  const matrix = context.getTransform();
  const dpr = app.defaultView.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + (matrix.a * worldX + matrix.c * worldY + matrix.e) / dpr;
  const clientY = rect.top + (matrix.b * worldX + matrix.d * worldY + matrix.f) / dpr;
  canvas.dispatchEvent(new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX, clientY
  }));
}
function readDesign(app) {
  return new Promise((resolve, reject) => {
    const request = app.defaultView.indexedDB.open('figma-local-documents');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('documents').objectStore('documents').get(documentId);
      read.onsuccess = () => { resolve(read.result?.document || null); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  });
}
function cropFromSaved(design, nodeId, fillId) {
  const node = design?.pages.flatMap(page => page.children).find(layer => layer.id === nodeId);
  const fill = node?.fills?.find(item => item.id === fillId)
    || (node?.imageFill ? { id: `legacy-fill:${node.id}`, imageFill: node.imageFill } : null);
  return fill?.imageFill?.transforms?.crop || null;
}
function sampleWorldPixel(app, canvas, x, y) {
  const context = canvas.getContext('2d');
  const matrix = context.getTransform();
  const pixelX = Math.round(matrix.a * x + matrix.c * y + matrix.e);
  const pixelY = Math.round(matrix.b * x + matrix.d * y + matrix.f);
  return [...context.getImageData(pixelX, pixelY, 1, 1).data].slice(0, 3);
}
function pixelDistance(left, right) {
  return left.reduce((total, channel, index) => total + Math.abs(channel - right[index]), 0);
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  assert(app.defaultView.innerWidth === 390 && app.defaultView.innerHeight === 844, 'Image-fill editing must work in the phone viewport.');

  const artwork = document.createElement('canvas');
  artwork.width = 64; artwork.height = 32;
  const pixels = artwork.getContext('2d');
  pixels.fillStyle = '#e22'; pixels.fillRect(0, 0, 32, 32);
  pixels.fillStyle = '#26c'; pixels.fillRect(32, 0, 32, 32);
  const imageBlob = await new Promise((resolve, reject) => artwork.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not make the local image fixture.')), 'image/png'));
  const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
  assetId = `fill-photo-${Date.now()}`;
  const fillId = `phone-fill-${Date.now()}`;
  const design = createDocument();
  design.id = documentId; design.name = documentId;
  const shape = createNode('rectangle', {
    name: 'Adjustable photo fill', x: -60, y: -40, width: 120, height: 80,
    fills: [{ id: fillId, type: 'image', imageFill: createImageFill(assetId), visible: true, opacity: 1 }]
  });
  addNode(design, shape);
  const input = app.querySelector('#open-file-input');
  const transfer = new app.defaultView.DataTransfer();
  transfer.items.add(new app.defaultView.File([packageFile(design, [{ id: assetId, name: 'split-color.png', type: 'image/png', bytes: imageBytes }])], `${documentId}.flocal`, { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#document-name')?.value === documentId, 'local fixture import');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'fixture save');

  click(app, app.querySelector(`[data-layer-id="${shape.id}"]`));
  click(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => !app.querySelector('#right-panel')?.inert, 'phone image-fill controls');
  const adjust = app.querySelector(`[data-action="toggle-image-crop-mode"][data-transform-target="fill"][data-fill-id="${fillId}"]`);
  const zoom = app.querySelector(`[data-image-fill-zoom][data-fill-id="${fillId}"]`);
  assert(adjust && !adjust.disabled, 'image fills should expose on-canvas adjustment.');
  assert(zoom && !zoom.disabled && zoom.getAttribute('aria-label') === 'Image fill zoom', 'image-fill zoom should be available with an accessible label.');
  click(app, adjust);
  assert(app.querySelector(`[data-action="toggle-image-crop-mode"][data-transform-target="fill"][data-fill-id="${fillId}"]`)?.getAttribute('aria-pressed') === 'true', 'the image-fill adjustment button should expose active state.');
  click(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel')?.inert, 'phone canvas space');
  await new Promise(resolve => setTimeout(resolve, 240));

  const canvas = app.querySelector('#scene-canvas');
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  const pixelBeforePan = sampleWorldPixel(app, canvas, 15, 0);
  pointer(app, canvas, 'pointerdown', 31, 0, 0);
  pointer(app, canvas, 'pointermove', 31, 24, 0);
  pointer(app, canvas, 'pointerup', 31, 24, 0);
  const status = () => app.querySelector('[data-image-fill-status]');
  await waitFor(() => status()?.textContent.includes('Updated · Pillow-RS WASM'), 'in-place fill pan preview');
  await waitFor(async () => Boolean(cropFromSaved(await readDesign(app), shape.id, fillId)), 'persisted fill pan');
  await new Promise(resolve => setTimeout(resolve, 40));
  const pixelAfterPan = sampleWorldPixel(app, canvas, 15, 0);
  assert(pixelDistance(pixelBeforePan, pixelAfterPan) > 100, `the same shape-fill preview should visibly change after pan (${pixelBeforePan.join(',')} → ${pixelAfterPan.join(',')}).`);
  const pannedCrop = cropFromSaved(await readDesign(app), shape.id, fillId);

  click(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => !app.querySelector('#right-panel')?.inert, 'zoom controls');
  const zoomControl = app.querySelector(`[data-image-fill-zoom][data-fill-id="${fillId}"]`);
  zoomControl.value = '180';
  zoomControl.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  zoomControl.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(() => status()?.textContent.includes('Updated · Pillow-RS WASM'), 'fill zoom preview');
  await waitFor(async () => {
    const crop = cropFromSaved(await readDesign(app), shape.id, fillId);
    return crop && crop.left !== pannedCrop.left;
  }, 'persisted fill zoom');
  const zoomedCrop = cropFromSaved(await readDesign(app), shape.id, fillId);
  assert(zoomedCrop.right - zoomedCrop.left < pannedCrop.right - pannedCrop.left, 'the zoom slider should narrow the source window.');

  click(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel')?.inert, 'phone canvas for pinch');
  await new Promise(resolve => setTimeout(resolve, 240));
  pointer(app, canvas, 'pointerdown', 41, -20, 0);
  pointer(app, canvas, 'pointerdown', 42, 20, 0);
  pointer(app, canvas, 'pointermove', 41, -34, 0);
  pointer(app, canvas, 'pointermove', 42, 34, 0);
  pointer(app, canvas, 'pointerup', 41, -34, 0);
  pointer(app, canvas, 'pointerup', 42, 34, 0);
  await waitFor(() => status()?.textContent.includes('Updated · Pillow-RS WASM'), 'touch pinch preview');
  await waitFor(async () => {
    const crop = cropFromSaved(await readDesign(app), shape.id, fillId);
    return crop && Math.abs((crop.right - crop.left) - (zoomedCrop.right - zoomedCrop.left)) > 1e-5;
  }, 'persisted pinch zoom');

  result.textContent = `PASS\n${JSON.stringify({ phoneViewport: true, onCanvasAdjust: true, fingerSizedZoomControl: true, panUpdatesExistingFill: true, sameFillPixelsChanged: true, pinchZoomAndPan: true, localWasmPreview: true, fillCropPersists: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 0));
  try { await deleteStoredDocument(documentId); } catch { /* Best-effort cleanup of the isolated workflow fixture. */ }
  if (assetId) {
    try { await deleteImageAsset(assetId); } catch { /* Remove the isolated local image bytes when storage allows it. */ }
  }
}
