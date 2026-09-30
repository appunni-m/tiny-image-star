import { addNode, createDocument, createNode } from '../src/model.js';
import { deleteStoredDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const documentId = `touch-canvas-${Date.now()}`;

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 15000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for editor startup, rendering, and storage writes. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 35);
    };
    poll();
  });
}
function dispatchPointer(app, canvas, type, point, pointerId) {
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  canvas.dispatchEvent(new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType: 'touch', button: 0,
    clientX: point.x, clientY: point.y
  }));
}
function tap(app, element, pointerId) {
  assert(element, 'Expected a phone control.');
  const Pointer = app.defaultView.PointerEvent;
  if (Pointer) {
    element.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true, pointerId, pointerType: 'touch', button: 0 }));
    element.dispatchEvent(new Pointer('pointerup', { bubbles: true, cancelable: true, pointerId, pointerType: 'touch', button: 0 }));
  }
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function worldScreenPoint(canvas, x, y) {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + canvas.clientWidth / 2 + x, y: rect.top + canvas.clientHeight / 2 + y };
}
function packageFile(documentData) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: documentData.schema, document: documentData, assets: [] }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
function importDesign(app, design) {
  const input = app.querySelector('#open-file-input');
  const transfer = new app.defaultView.DataTransfer();
  transfer.items.add(new app.defaultView.File([packageFile(design)], `${design.name}.flocal`, { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}
function readStoredDesign(app) {
  return new Promise((resolve, reject) => {
    const request = app.defaultView.indexedDB.open('figma-local-documents');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('documents').objectStore('documents').get(documentId);
      get.onsuccess = () => { resolve(get.result?.document || null); db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  });
}
function canvasPixelAtWorld(app, canvas, x, y) {
  const rect = canvas.getBoundingClientRect();
  const screen = worldScreenPoint(canvas, x, y);
  const pixelX = Math.max(0, Math.min(canvas.width - 1, Math.floor((screen.x - rect.left) * canvas.width / rect.width)));
  const pixelY = Math.max(0, Math.min(canvas.height - 1, Math.floor((screen.y - rect.top) * canvas.height / rect.height)));
  return [...canvas.getContext('2d').getImageData(pixelX, pixelY, 1, 1).data];
}
async function waitForSave(app, label) {
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saving locally'), `${label} save start`);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${label} save completion`);
}
function findNode(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    const nested = findNode(node.children, id);
    if (nested) return nested;
  }
  return null;
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'phone editor startup', 45000);
  const app = frame.contentDocument;
  assert(app.defaultView.innerWidth === 390 && app.defaultView.innerHeight === 844, 'The touch workflow should run at a 390×844 phone viewport.');

  const design = createDocument();
  design.id = documentId;
  design.name = documentId;
  const rectangle = createNode('rectangle', { name: 'Touch target', x: -50, y: -50, width: 100, height: 100, fill: '#d9d9d9' });
  addNode(design, rectangle);
  importDesign(app, design);
  await waitFor(() => app.querySelector('#document-name')?.value === documentId, 'isolated phone design import');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'initial design save');
  const canvas = app.querySelector('#scene-canvas');
  const row = app.querySelector(`[data-layer-id="${rectangle.id}"]`);
  assert(row, 'The imported resize target should appear in Layers.');
  tap(app, app.querySelector('#sidebar-toggle'), 510);
  await waitFor(() => app.querySelector('#left-panel').classList.contains('is-open'), 'phone Layers panel');
  tap(app, row, 511);
  tap(app, app.querySelector('#sidebar-toggle'), 512);
  await waitFor(() => !app.querySelector('#left-panel').classList.contains('is-open'), 'closed phone Layers panel');

  // The visible east handle is centered at (50, 0). A touch landing 18 CSS px
  // away must still start a resize, then extend the rectangle to x=80.
  dispatchPointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, 68, 0), 501);
  dispatchPointer(app, canvas, 'pointermove', worldScreenPoint(canvas, 80, 0), 501);
  dispatchPointer(app, canvas, 'pointerup', worldScreenPoint(canvas, 80, 0), 501);
  await waitForSave(app, 'touch-sized resize handle');
  let saved = await readStoredDesign(app);
  let savedRectangle = findNode(saved?.pages?.[0]?.children, rectangle.id);
  assert(savedRectangle?.width > 100, `A touch near the resize handle did not resize the layer (width ${savedRectangle?.width}).`);

  const center = { x: savedRectangle.x + savedRectangle.width / 2, y: savedRectangle.y + savedRectangle.height / 2 };
  const rotateHandle = { x: center.x, y: savedRectangle.y - 24 };
  const impreciseTouch = { x: rotateHandle.x + 18, y: rotateHandle.y };
  const startAngle = Math.atan2(impreciseTouch.y - center.y, impreciseTouch.x - center.x);
  const nextAngle = startAngle + Math.PI / 4;
  const radius = Math.hypot(impreciseTouch.x - center.x, impreciseTouch.y - center.y);
  dispatchPointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, impreciseTouch.x, impreciseTouch.y), 513);
  dispatchPointer(app, canvas, 'pointermove', worldScreenPoint(canvas, center.x + Math.cos(nextAngle) * radius, center.y + Math.sin(nextAngle) * radius), 513);
  dispatchPointer(app, canvas, 'pointerup', worldScreenPoint(canvas, center.x + Math.cos(nextAngle) * radius, center.y + Math.sin(nextAngle) * radius), 513);
  await waitForSave(app, 'touch-sized rotate handle');
  saved = await readStoredDesign(app);
  savedRectangle = findNode(saved?.pages?.[0]?.children, rectangle.id);
  assert(Math.abs(savedRectangle?.rotation || 0) >= 40,
    `A touch near the rotate handle did not rotate the layer (rotation ${savedRectangle?.rotation}).`);

  // Starting a pinch while drawing cancels the unfinished shape draft. The
  // canvas pixel check also catches the stale ghost preview that used to live
  // on after pinch-up even though no layer had been committed.
  app.querySelector('[data-tool="rectangle"]').click();
  dispatchPointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, 100, 170), 502);
  dispatchPointer(app, canvas, 'pointermove', worldScreenPoint(canvas, 150, 220), 502);
  await waitFor(() => canvasPixelAtWorld(app, canvas, 125, 195)[0] < 225, 'live rectangle draft');
  dispatchPointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, 170, 250), 503);
  dispatchPointer(app, canvas, 'pointermove', worldScreenPoint(canvas, 170, 250), 503);
  await waitFor(() => canvasPixelAtWorld(app, canvas, 125, 195)[0] >= 225, 'draft removal on pinch takeover');
  dispatchPointer(app, canvas, 'pointerup', worldScreenPoint(canvas, 100, 170), 502);
  dispatchPointer(app, canvas, 'pointerup', worldScreenPoint(canvas, 170, 250), 503);
  saved = await readStoredDesign(app);
  assert(saved?.pages?.[0]?.children.length === 1, 'Pinch takeover committed the unfinished rectangle draft.');

  // An active one-finger move is committed through the regular edit finalizer
  // before the second finger takes ownership of the canvas.
  app.querySelector('[data-tool="select"]').click();
  dispatchPointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, 15, 0), 504);
  dispatchPointer(app, canvas, 'pointermove', worldScreenPoint(canvas, 47, 32), 504);
  dispatchPointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, 300, 300), 505);
  dispatchPointer(app, canvas, 'pointermove', worldScreenPoint(canvas, 300, 300), 505);
  dispatchPointer(app, canvas, 'pointerup', worldScreenPoint(canvas, 47, 32), 504);
  dispatchPointer(app, canvas, 'pointerup', worldScreenPoint(canvas, 300, 300), 505);
  await waitForSave(app, 'move finalized before pinch takeover');
  saved = await readStoredDesign(app);
  savedRectangle = findNode(saved?.pages?.[0]?.children, rectangle.id);
  assert(savedRectangle?.x > -50 && savedRectangle?.y > -50,
    `The active move was not finalized and saved before pinch takeover (x ${savedRectangle?.x}, y ${savedRectangle?.y}).`);

  result.textContent = `PASS\n${JSON.stringify({ viewport: '390x844', touchResizeHitRegion: true, touchRotateHitRegion: true, interruptedDrawDraftCleared: true, interruptedMoveSaved: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  await deleteStoredDocument(documentId).catch(() => {});
}
