import { addNode, createDocument, createNode } from '../src/model.js';
import { deleteStoredDocument, loadDocumentById, saveDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
let documentId;
let outcome;

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 15000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { if (await test()) { resolve(); return; } } catch { /* Wait for editor startup, rendering, or save completion. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 30);
    };
    poll();
  });
}
function worldScreenPoint(canvas, x, y) {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + canvas.clientWidth / 2 + x, y: rect.top + canvas.clientHeight / 2 + y };
}
function dispatchPointer(app, canvas, type, point, pointerId) {
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  canvas.dispatchEvent(new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0,
    clientX: point.x, clientY: point.y
  }));
}
function magentaPixelsNearWorldPoint(app, worldX, worldY) {
  const canvas = app.querySelector('#scene-canvas');
  const dpr = Math.min(2, app.defaultView.devicePixelRatio || 1);
  const centerX = Math.round((canvas.clientWidth / 2 + worldX) * dpr);
  const centerY = Math.round((canvas.clientHeight / 2 + worldY) * dpr);
  const left = Math.max(0, centerX - 3); const top = Math.max(0, centerY - 3);
  const right = Math.min(canvas.width, centerX + 4); const bottom = Math.min(canvas.height, centerY + 4);
  const pixels = canvas.getContext('2d').getImageData(left, top, right - left, bottom - top).data;
  let matches = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] > 220 && pixels[index + 1] < 145 && pixels[index + 2] > 135 && pixels[index + 3] > 200) matches += 1;
  }
  return matches;
}
function waitForPaint() {
  const view = frame.contentWindow;
  return new Promise(resolve => view.requestAnimationFrame(() => view.requestAnimationFrame(resolve)));
}

try {
  const design = createDocument();
  design.name = `Smart guides smoke ${Date.now()}`;
  // This offset is deliberately off-grid: the guide should place the moving
  // right edge at x=25 (moving.x=-15); plain grid snapping would leave x=-20.
  const target = createNode('rectangle', {
    name: 'Alignment target', x: 25, y: 0, width: 80, height: 60, fill: '#d4d4d4'
  });
  const moving = createNode('rectangle', {
    name: 'Moving layer', x: -100, y: 10, width: 40, height: 40, fill: '#91caff'
  });
  addNode(design, target);
  addNode(design, moving);
  documentId = design.id;
  await saveDocument(design);

  frame.src = '../index.html';
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'The editor should use the Tiny Image Star public name.');
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'isolated design restore');
  await waitFor(() => app.querySelectorAll('#layers-list .layer-row[data-layer-id]').length === 2, 'isolated design layers');

  const canvas = app.querySelector('#scene-canvas');
  const start = worldScreenPoint(canvas, -80, 30);
  const end = worldScreenPoint(canvas, 2, 30); // Requested dx=82; the smart guide corrects it to 85.
  dispatchPointer(app, canvas, 'pointerdown', start, 220);
  dispatchPointer(app, canvas, 'pointermove', end, 220);
  await waitForPaint();

  assert(app.querySelector('#position-status')?.textContent.includes('Aligned'),
    'Dragging near the peer edge should report a live alignment match.');
  const guidePixelsDuringDrag = magentaPixelsNearWorldPoint(app, 25, 20);
  assert(guidePixelsDuringDrag > 0,
    `The vertical alignment guide should be visible during the drag; matching pixels=${guidePixelsDuringDrag}.`);

  dispatchPointer(app, canvas, 'pointerup', end, 220);
  await waitForPaint();
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'saved drag result');
  assert(magentaPixelsNearWorldPoint(app, 25, 20) === 0, 'Temporary alignment guides should disappear after release.');

  await waitFor(async () => {
    const saved = await loadDocumentById(documentId);
    const savedLayer = saved?.pages?.[0]?.children?.find(node => node.id === moving.id);
    return savedLayer?.x === -15 && savedLayer?.y === 10;
  }, 'snapped geometry in local storage');
  const saved = await loadDocumentById(documentId);
  const savedMoving = saved.pages[0].children.find(node => node.id === moving.id);
  assert(savedMoving.x === -15 && savedMoving.y === 10,
    `Saved geometry should land on the peer edge (expected -15,10; got ${savedMoving.x},${savedMoving.y}).`);

  outcome = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', snappedToPeerEdge: true, guideVisibleDuringDrag: true, guideClearedOnRelease: true, savedGeometry: { x: savedMoving.x, y: savedMoving.y } })}`;
} catch (error) {
  outcome = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  if (documentId) await deleteStoredDocument(documentId).catch(() => {});
}
result.textContent = outcome;
