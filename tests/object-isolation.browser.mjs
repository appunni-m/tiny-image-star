import { addNode, createDocument, createNode } from '../src/model.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';
import { deleteImageAsset, deleteStoredDocument, loadDocumentById, loadImageAsset, saveDocument, saveImageAssetBytes } from '../src/storage.js';

// Browser-smoke end-to-end workflow; this scenario is deliberately not run by Node tests.
const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const design = createDocument();
design.name = 'Object isolation ' + Date.now().toString(36);
let diagnosticApp = null;
const assetId = 'object-isolation-source-' + Date.now().toString(36);
const source = createNode('image', {
  name: 'Isolation source', fileName: 'isolation-source.png', assetId,
  sourceWidth: 96, sourceHeight: 96, x: -64, y: -64, width: 128, height: 128,
  transforms: { crop: { left: .08, top: .08, right: .92, bottom: .92 }, rotation: 90, flipHorizontal: true, flipVertical: false }
});
addNode(design, source);
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } } catch { /* Wait for local startup and persistence. */ }
      if (performance.now() - started > timeout) { reject(new Error('Timed out waiting for ' + label + '.')); return; }
      setTimeout(() => { void poll(); }, 40);
    };
    void poll();
  });
}
function click(app, element) {
  assert(element, 'Expected an object-isolation control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function photoBytes() {
  const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e7e9ed'; ctx.fillRect(0, 0, 96, 96);
  ctx.fillStyle = '#f04438'; ctx.beginPath(); ctx.arc(48, 48, 25, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#182230'; ctx.fillRect(41, 25, 14, 48);
  return new Promise((resolve, reject) => canvas.toBlob(async blob => {
    if (!blob) { reject(new Error('Could not create the local source fixture.')); return; }
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, 'image/png'));
}
function pointOnCanvas(app, type, local, pointerId) {
  const canvas = app.querySelector('#scene-canvas');
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  const point = nodeLocalToPage(source, local, []);
  const matrix = canvas.getContext('2d').getTransform();
  const rect = canvas.getBoundingClientRect();
  const dpr = app.defaultView.devicePixelRatio || 1;
  canvas.dispatchEvent(new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: rect.left + (matrix.a * point.x + matrix.c * point.y + matrix.e) / dpr,
    clientY: rect.top + (matrix.b * point.x + matrix.d * point.y + matrix.f) / dpr
  }));
}
function stroke(app, mode, points, id) {
  click(app, app.querySelector('[data-action="set-object-isolation-mode"][data-mode="' + mode + '"]'));
  pointOnCanvas(app, 'pointerdown', points[0], id);
  for (const point of points.slice(1)) pointOnCanvas(app, 'pointermove', point, id);
  pointOnCanvas(app, 'pointerup', points.at(-1), id);
}

let outputAssetId = null;
try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup', 30000);
  const app = frame.contentDocument;
  diagnosticApp = app;
  const sourceBytes = await photoBytes();
  await saveImageAssetBytes(assetId, 'isolation-source.png', 'image/png', sourceBytes);
  await saveDocument(design);
  click(app, app.querySelector('#main-menu-button'));
  click(app, [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs')));
  click(app, await waitFor(() => app.querySelector('#design-library-dialog [data-design-id="' + design.id + '"][data-design-action="open"]'), 'saved fixture', 30000));
  // Opening a design loads its record asynchronously before it raises the
  // editor's transition fence; waiting only for the initial `false` value can
  // race ahead and find every local-AI action temporarily disabled.
  await waitFor(() => app.querySelector('.workspace')?.inert === true, 'design switch start', 30000);
  await waitFor(() => app.querySelector('.workspace')?.inert === false, 'design switch completion', 30000);
  const sourceLayer = await waitFor(() => app.querySelector('[data-layer-id="' + source.id + '"]'), 'source layer', 30000);
  click(app, sourceLayer);
  const imageAiTools = await waitFor(() => app.querySelector('#inspector-content .image-ai-tools'), 'local AI image tools disclosure');
  imageAiTools.open = true;
  await waitFor(() => app.querySelector('[data-action="toggle-object-isolation-mode"]'), 'object-isolation inspector controls', 30000);
  const selectAreaButton = app.querySelector('[data-action="toggle-object-isolation-mode"]');
  const isolateButton = app.querySelector('[data-action="create-object-isolation-layer"]');
  await waitFor(() => selectAreaButton && !selectAreaButton.disabled, 'object-isolation controls ready', 30000);
  assert(selectAreaButton?.textContent.trim() === 'Select area', 'the image inspector should start with the Select area action');
  assert(app.querySelector('[data-action="set-object-isolation-mode"][data-mode="3"]')?.getAttribute('aria-pressed') === 'true', 'lasso should be the default area-selection mode');
  assert(isolateButton?.textContent.trim() === 'Isolate' && isolateButton.getAttribute('aria-label')?.includes('new image layer'), 'the primary action should create a new isolated image layer');
  click(app, selectAreaButton);
  stroke(app, 1, [{ x: 42, y: 40 }, { x: 48, y: 48 }, { x: 55, y: 55 }], 701);
  stroke(app, 2, [{ x: 27, y: 26 }, { x: 31, y: 31 }], 702);
  stroke(app, 3, [{ x: 70, y: 36 }, { x: 84, y: 40 }, { x: 80, y: 57 }, { x: 70, y: 36 }], 703);
  const createButton = app.querySelector('[data-action="create-object-isolation-layer"]');
  assert(createButton && !createButton.disabled, 'include, exclude, and lasso should enable isolation for a cropped, rotated, flipped image');
  const sourceBefore = structuredClone((await loadDocumentById(design.id)).pages[0].children.find(node => node.id === source.id));
  click(app, createButton);
  await waitFor(() => app.querySelectorAll('.layer-row[data-layer-id]').length === 2, 'isolated transparent layer', 180000);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'isolated layer durable save', 30000);
  let saved = await loadDocumentById(design.id);
  const children = saved.pages[0].children;
  const sourceIndex = children.findIndex(node => node.id === source.id);
  const isolated = children[sourceIndex + 1]; outputAssetId = isolated?.assetId;
  assert(isolated?.type === 'image' && outputAssetId !== assetId, 'isolation should add a new image asset directly above the source');
  assert(JSON.stringify(children[sourceIndex]) === JSON.stringify(sourceBefore), 'the source layer must remain byte-for-byte unchanged');
  assert(isolated.x === source.x && isolated.y === source.y && isolated.width === source.width && isolated.height === source.height
    && JSON.stringify(isolated.transforms) === JSON.stringify(source.transforms), 'the result must share source placement and transforms');
  const storedSource = await loadImageAsset(assetId);
  assert(storedSource.bytes.byteLength === sourceBytes.byteLength
    && new Uint8Array(storedSource.bytes).every((value, index) => value === sourceBytes[index]), 'the source asset bytes must remain unchanged');
  const cutout = await loadImageAsset(outputAssetId);
  const bitmap = await app.defaultView.createImageBitmap(new app.defaultView.Blob([cutout.bytes], { type: 'image/png' }));
  const surface = app.createElement('canvas'); surface.width = bitmap.width; surface.height = bitmap.height;
  const context = surface.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0); bitmap.close?.();
  const alpha = context.getImageData(0, 0, surface.width, surface.height).data;
  assert([...Array(surface.width * surface.height)].some((_, index) => alpha[index * 4 + 3] < 250), 'the output PNG must retain transparent pixels');

  click(app, app.querySelector('[data-layer-id="' + source.id + '"]'));
  click(app, app.querySelector('[data-action="toggle-object-isolation-mode"]'));
  stroke(app, 1, [{ x: 44, y: 44 }, { x: 55, y: 52 }], 704);
  click(app, app.querySelector('[data-action="create-object-isolation-layer"]'));
  click(app, await waitFor(() => app.querySelector('[data-action="cancel-object-isolation"]'), 'cancel control', 10000));
  await new Promise(resolve => setTimeout(resolve, 800));
  saved = await loadDocumentById(design.id);
  assert(saved.pages[0].children.length === 2, 'cancel must not save a partial layer');

  click(app, app.querySelector('[data-action="create-object-isolation-layer"]'));
  await waitFor(() => app.querySelector('[data-action="cancel-object-isolation"]'), 'second cancellable run', 10000);
  click(app, app.querySelector('#file-menu-button'));
  click(app, [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('New design')));
  await waitFor(() => app.querySelectorAll('.layer-row[data-layer-id]').length === 0, 'new design switch', 30000);
  await new Promise(resolve => setTimeout(resolve, 800));
  saved = await loadDocumentById(design.id);
  assert(saved.pages[0].children.length === 2, 'switching designs must fence any late isolation result');
  result.textContent = 'PASS\n' + JSON.stringify({ selectAreaLassoIsolateWorkflow: true, includeExcludeRefinement: true, transformedSourceMapping: true, distinctTransparentLayer: true, sourceNodeAndBytesPreserved: true, cancelCleanup: true, designSwitchFence: true });
} catch (error) {
  const button = diagnosticApp?.querySelector('[data-action="create-object-isolation-layer"]');
  const diagnostics = diagnosticApp ? {
    status: diagnosticApp.querySelector('.object-isolation-status')?.textContent,
    selectAreaPressed: diagnosticApp.querySelector('[data-action="toggle-object-isolation-mode"]')?.getAttribute('aria-pressed'),
    selectAreaDisabled: diagnosticApp.querySelector('[data-action="toggle-object-isolation-mode"]')?.disabled,
    selectAreaTitle: diagnosticApp.querySelector('[data-action="toggle-object-isolation-mode"]')?.title,
    createDisabled: button?.disabled,
    createTitle: button?.title,
    modes: [...diagnosticApp.querySelectorAll('[data-action="set-object-isolation-mode"]')].map(item => [item.dataset.mode, item.getAttribute('aria-pressed')]),
    canvasMode: diagnosticApp.querySelector('#scene-canvas')?.className
  } : null;
  result.textContent = 'FAIL\n' + (error?.stack || error) + (diagnostics ? '\nDEBUG ' + JSON.stringify(diagnostics) : '');
} finally {
  if (result.textContent.startsWith('PASS\n')) {
    frame.src = 'about:blank';
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  try { await deleteStoredDocument(design.id); } catch { /* Best-effort local fixture cleanup. */ }
  for (const id of new Set([assetId, outputAssetId].filter(Boolean))) {
    try { await deleteImageAsset(id); } catch { /* Best-effort source/output cleanup. */ }
  }
}
