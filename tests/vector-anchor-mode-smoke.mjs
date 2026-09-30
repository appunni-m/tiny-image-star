import { addNode, createDocument, createNode } from '../src/model.js';
import { deleteStoredDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const documentId = `vector-anchor-mode-${Date.now()}`;

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 12000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for startup, rendering, and local save completion. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 35);
    };
    poll();
  });
}
function click(app, element) {
  assert(element, 'Expected an editor control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function pointer(app, canvas, type, point, pointerId = 71) {
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  canvas.dispatchEvent(new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0,
    clientX: point.x, clientY: point.y
  }));
}
function worldScreenPoint(canvas, x, y) {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + rect.width / 2 + x, y: rect.top + rect.height / 2 + y };
}
function packageFile(design) {
  const payload = new TextEncoder().encode(JSON.stringify({ schema: design.schema, document: design, assets: [] }));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payload.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, payload];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
function readSavedDesign(app, id) {
  return new Promise((resolve, reject) => {
    const request = app.defaultView.indexedDB.open('figma-local-documents');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('documents').objectStore('documents').get(id);
      get.onsuccess = () => { resolve(get.result?.document || null); db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  });
}
async function waitForSave(app, label) {
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saving locally'), `${label} save start`);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${label} save completion`);
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup', 45000);
  const app = frame.contentDocument;
  const design = createDocument();
  design.id = documentId;
  design.name = documentId;
  const path = createNode('path', {
    name: 'Editable curve', x: -80, y: -25, width: 160, height: 50,
    points: [
      { x: 0, y: .5, in: { x: 0, y: 0 }, out: { x: .25, y: 0 }, mode: 'corner' },
      { x: 1, y: .5, in: { x: -.25, y: 0 }, out: { x: 0, y: 0 }, mode: 'corner' }
    ]
  });
  addNode(design, path);
  const input = app.querySelector('#open-file-input');
  const transfer = new app.defaultView.DataTransfer();
  transfer.items.add(new app.defaultView.File([packageFile(design)], `${documentId}.flocal`, { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#document-name')?.value === documentId, 'isolated local design import');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'initial local save');

  assert(app.defaultView.innerWidth === 390, 'the editor iframe should use a 390px phone viewport.');
  click(app, app.querySelector(`[data-layer-id="${path.id}"]`));
  const canvas = app.querySelector('#scene-canvas');
  pointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, -80, 0));
  pointer(app, canvas, 'pointerup', worldScreenPoint(canvas, -80, 0));
  await waitFor(() => app.querySelector('[data-vector-anchor-mode]'), 'selected anchor mode control');
  const inspector = app.querySelector('#right-panel');
  const openInspector = app.querySelector('#inspector-toggle');
  if (!inspector.classList.contains('is-open')) click(app, openInspector);
  const mode = app.querySelector('[data-vector-anchor-mode]');
  assert(mode.getAttribute('aria-label') === 'Selected anchor mode', 'the anchor mode select should have an accessible name.');
  assert(mode.options.length === 3 && ['corner', 'smooth', 'symmetric'].every(value => [...mode.options].some(option => option.value === value)), 'the inspector should offer Corner, Smooth, and Symmetric modes.');
  assert(mode.getBoundingClientRect().height >= 44, 'the anchor mode select should meet the 44px phone touch target.');
  assert(mode.getBoundingClientRect().right <= inspector.getBoundingClientRect().right + 1, 'the anchor mode select should fit inside the phone inspector.');

  mode.value = 'smooth';
  mode.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('[data-vector-anchor-mode]')?.value === 'smooth', 'smooth mode inspector update');
  await waitForSave(app, 'anchor mode');
  const saved = await readSavedDesign(app, documentId);
  const savedPath = saved?.pages[0]?.children.find(node => node.id === path.id);
  assert(savedPath?.points[0]?.mode === 'smooth', 'changing the anchor mode should persist point.mode in the local document.');

  const oppositeBefore = { ...savedPath.points[0].in };
  const startHandle = worldScreenPoint(canvas, -40, 0);
  const movedHandle = worldScreenPoint(canvas, -40, 30);
  pointer(app, canvas, 'pointerdown', startHandle, 72);
  pointer(app, canvas, 'pointermove', movedHandle, 72);
  pointer(app, canvas, 'pointerup', movedHandle, 72);
  await waitForSave(app, 'handle drag');
  const afterDrag = await readSavedDesign(app, documentId);
  const movedPath = afterDrag?.pages[0]?.children.find(node => node.id === path.id);
  const incoming = movedPath?.points[0]?.in;
  const outgoing = movedPath?.points[0]?.out;
  assert(movedPath?.points[0]?.mode === 'smooth', 'dragging a handle should preserve the stored smooth mode.');
  assert(Math.abs(incoming.x * movedPath.width + outgoing.x * movedPath.width) > 0, 'handle movement should have changed the stored geometry.');
  const inPhysical = { x: incoming.x * movedPath.width, y: incoming.y * movedPath.height };
  const outPhysical = { x: outgoing.x * movedPath.width, y: outgoing.y * movedPath.height };
  const cross = inPhysical.x * outPhysical.y - inPhysical.y * outPhysical.x;
  const dot = inPhysical.x * outPhysical.x + inPhysical.y * outPhysical.y;
  const beforeLength = Math.hypot(oppositeBefore.x * movedPath.width, oppositeBefore.y * movedPath.height);
  assert(Math.abs(cross) < 1e-6 && dot < 0, 'a handle drag should keep smooth handles aligned in opposite directions.');
  assert(Math.abs(Math.hypot(inPhysical.x, inPhysical.y) - beforeLength) < 1e-6, 'smooth handle drag should retain the opposite handle length.');

  result.textContent = 'PASS · phone-sized accessible anchor mode control, local persistence, and stored smooth drag semantics';
} catch (error) {
  result.textContent = `FAIL\n${error.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  await deleteStoredDocument(documentId).catch(() => {});
}
