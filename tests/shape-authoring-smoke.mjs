import { createDocument } from '../src/model.js';
import { exportPageToSvg } from '../src/svg-export.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const documentId = `shape-authoring-${Date.now()}`;

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 12000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for editor startup, rendering, or save completion. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 35);
    };
    poll();
  });
}
function click(app, element) {
  assert(element, 'Expected a shape authoring control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function dispatchPointer(app, canvas, type, point, pointerId) {
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
function drawShape(app, type, startWorld, endWorld, pointerId) {
  const canvas = app.querySelector('#scene-canvas');
  click(app, app.querySelector(`[data-tool="${type}"]`));
  dispatchPointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, startWorld.x, startWorld.y), pointerId);
  dispatchPointer(app, canvas, 'pointermove', worldScreenPoint(canvas, endWorld.x, endWorld.y), pointerId);
  dispatchPointer(app, canvas, 'pointerup', worldScreenPoint(canvas, endWorld.x, endWorld.y), pointerId);
}
function editNumber(app, property, value) {
  const input = app.querySelector(`#inspector-content [data-prop="${property}"]`);
  assert(input, `The inspector did not expose the ${property} shape control.`);
  input.value = String(value);
  input.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  input.blur();
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
function findNode(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return null;
}
async function waitForSave(app, label) {
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saving locally'), `${label} save start`);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${label} save completion`);
}
function importEmptyDesign(app) {
  const design = createDocument();
  design.id = documentId;
  design.name = documentId;
  const input = app.querySelector('#open-file-input');
  const payload = new TextEncoder().encode(JSON.stringify({ schema: design.schema, document: design, assets: [] }));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payload.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, payload];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], `${documentId}.flocal`, { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup', 45000);
  const app = frame.contentDocument;
  importEmptyDesign(app);
  await waitFor(() => app.querySelector('#document-name')?.value === documentId, 'isolated local design import');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'initial design save');

  const starButton = app.querySelector('[data-tool="star"]');
  assert(starButton?.getAttribute('aria-label') === 'Star', 'the canvas toolbar does not expose an accessible Star tool.');
  drawShape(app, 'star', { x: -32, y: -32 }, { x: 32, y: 32 }, 210);
  const starId = app.querySelector('.layer-row.is-selected')?.dataset.layerId;
  assert(starId, 'drawing with the Star tool did not create and select a layer.');
  await waitFor(() => app.querySelector('#inspector-content [data-prop="innerRadius"]'), 'star geometry controls');
  editNumber(app, 'points', 8);
  editNumber(app, 'innerRadius', .25);
  await waitForSave(app, 'star geometry edit');

  const canvas = app.querySelector('#scene-canvas');
  const centerPixel = [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
  assert(centerPixel[0] > 200 && centerPixel[1] > 150 && centerPixel[2] < 100,
    `the toolbar-created star was not visibly rendered at its center (${centerPixel.join(',')}).`);

  const beforeUndo = await readSavedDesign(app, documentId);
  const savedStar = findNode(beforeUndo.pages[0].children, starId);
  assert(savedStar?.type === 'star' && savedStar.points === 8 && savedStar.innerRadius === .25,
    'star geometry controls did not persist to the local design.');

  await new Promise(resolve => setTimeout(resolve, 220));
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', ctrlKey: true }));
  await waitFor(() => app.querySelector('#inspector-content [data-prop="points"]')?.value === '5'
    && app.querySelector('#inspector-content [data-prop="innerRadius"]')?.value === '0.48', 'undo restoring star defaults');
  await waitForSave(app, 'star undo');
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'y', ctrlKey: true }));
  await waitFor(() => app.querySelector('#inspector-content [data-prop="points"]')?.value === '8'
    && app.querySelector('#inspector-content [data-prop="innerRadius"]')?.value === '0.25', 'redo restoring star geometry');
  await waitForSave(app, 'star redo');

  drawShape(app, 'polygon', { x: 92, y: -32 }, { x: 156, y: 32 }, 211);
  const polygonId = app.querySelector('.layer-row.is-selected')?.dataset.layerId;
  assert(polygonId, 'drawing with the Polygon tool did not create and select a layer.');
  await waitFor(() => app.querySelector('#inspector-content [data-prop="points"]'), 'polygon side-count control');
  editNumber(app, 'points', 7);
  await waitForSave(app, 'polygon geometry edit');

  const saved = await readSavedDesign(app, documentId);
  const polygon = findNode(saved.pages[0].children, polygonId);
  const finalStar = findNode(saved.pages[0].children, starId);
  assert(polygon?.type === 'polygon' && polygon.points === 7, 'polygon side count did not persist.');
  assert(finalStar?.points === 8 && finalStar.innerRadius === .25, 'star geometry changed after editing the polygon.');
  const svg = exportPageToSvg(saved.pages[0], { document: saved });
  assert(svg.match(/data-tiny-image-star-type="star"/g)?.length === 1, 'SVG export omitted the created star.');
  assert(svg.match(/data-tiny-image-star-type="polygon"/g)?.length === 1, 'SVG export omitted the created polygon.');
  const svgDocument = new app.defaultView.DOMParser().parseFromString(svg, 'image/svg+xml');
  const starPolygon = svgDocument.querySelector('[data-tiny-image-star-type="star"] > polygon');
  const starVertices = starPolygon?.getAttribute('points')?.trim().split(/\s+/).map(pair => pair.split(',').map(Number));
  assert(starVertices?.length === 16, 'SVG export did not retain all eight star points.');
  const innerRadii = starVertices.filter((_, index) => index % 2 === 1)
    .map(([x, y]) => Math.hypot(x - 32, y - 32));
  assert(innerRadii.every(radius => Math.abs(radius - 8) < 1e-8), 'SVG export did not preserve the edited 0.25 inner-radius ratio.');
  assert((svg.match(/<polygon points="/g) || []).length === 2, 'SVG export should retain both editable regular shapes.');

  result.textContent = `PASS\n${JSON.stringify({ starTool: true, starInspector: true, polygonInspector: true, liveCanvasRender: true, undoRedo: true, localPersistence: true, svgGeometry: true, starPoints: finalStar.points, starInnerRadius: finalStar.innerRadius, polygonSides: polygon.points })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
