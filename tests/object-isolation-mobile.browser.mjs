import { addNode, createDocument, createNode } from '../src/model.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';
import { deleteImageAsset, deleteStoredDocument, saveDocument, saveImageAssetBytes } from '../src/storage.js';

// Phone-only UI workflow. The desktop browser workflow covers the actual local
// model, layer persistence, cancellation, and design fencing.
const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const design = createDocument();
design.name = 'Object isolation phone ' + Date.now().toString(36);
const assetId = 'object-isolation-phone-' + Date.now().toString(36);
const source = createNode('image', {
  name: 'Phone isolation source', fileName: 'phone-source.png', assetId,
  sourceWidth: 96, sourceHeight: 96, x: -64, y: -64, width: 128, height: 128,
  transforms: { crop: { left: .08, top: .08, right: .92, bottom: .92 }, rotation: 90, flipHorizontal: true, flipVertical: false }
});
addNode(design, source);

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 30000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } } catch { /* Wait for UI and storage state. */ }
      if (performance.now() - started > timeout) { reject(new Error('Timed out waiting for ' + label + '.')); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    void poll();
  });
}
function click(app, element) {
  assert(element, 'Expected a phone object-isolation control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function sourceBytes() {
  const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e7e9ed'; ctx.fillRect(0, 0, 96, 96);
  ctx.fillStyle = '#f04438'; ctx.beginPath(); ctx.arc(48, 48, 25, 0, Math.PI * 2); ctx.fill();
  return new Promise((resolve, reject) => canvas.toBlob(async blob => {
    if (!blob) { reject(new Error('Could not create the phone image fixture.')); return; }
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, 'image/png'));
}
function pixelPosition(app, local) {
  const canvas = app.querySelector('#scene-canvas');
  const point = nodeLocalToPage(source, local, []);
  const matrix = canvas.getContext('2d').getTransform();
  const rect = canvas.getBoundingClientRect();
  const dpr = app.defaultView.devicePixelRatio || 1;
  const x = matrix.a * point.x + matrix.c * point.y + matrix.e;
  const y = matrix.b * point.x + matrix.d * point.y + matrix.f;
  return { x: Math.round(x), y: Math.round(y), clientX: rect.left + x / dpr, clientY: rect.top + y / dpr };
}
function dispatchStroke(app, localPoints) {
  const canvas = app.querySelector('#scene-canvas');
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  const dispatch = (type, local, pointerId) => {
    const point = pixelPosition(app, local);
    canvas.dispatchEvent(new app.defaultView.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId, pointerType: 'touch', button: 0,
      buttons: type === 'pointerup' ? 0 : 1, clientX: point.clientX, clientY: point.clientY
    }));
  };
  const id = 801;
  dispatch('pointerdown', localPoints[0], id);
  for (const point of localPoints.slice(1)) dispatch('pointermove', point, id);
  dispatch('pointerup', localPoints.at(-1), id);
}
async function paint(app) {
  await new Promise(resolve => app.defaultView.requestAnimationFrame(() => app.defaultView.requestAnimationFrame(resolve)));
}
function colorDistance(left, right) { return left.reduce((sum, channel, index) => sum + Math.abs(channel - right[index]), 0); }

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'phone editor startup');
  const app = frame.contentDocument;
  assert(app.defaultView.innerWidth === 390 && app.defaultView.innerHeight === 844, 'Object isolation phone controls should be exercised at 390×844.');
  await saveImageAssetBytes(assetId, 'phone-source.png', 'image/png', await sourceBytes());
  await saveDocument(design);
  click(app, app.querySelector('#main-menu-button'));
  click(app, [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs')));
  click(app, await waitFor(() => app.querySelector('#design-library-dialog [data-design-id="' + design.id + '"][data-design-action="open"]'), 'phone fixture in design library'));
  const sourceRow = await waitFor(() => app.querySelector('[data-layer-id="' + source.id + '"]'), 'phone source layer');
  if (app.querySelector('#left-panel').inert) click(app, app.querySelector('#sidebar-toggle'));
  await waitFor(() => !app.querySelector('#left-panel').inert, 'phone Layers sheet');
  click(app, sourceRow);
  if (app.querySelector('#left-panel').classList.contains('is-open')) click(app, app.querySelector('#sidebar-toggle'));
  click(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open') && !app.querySelector('#right-panel').inert, 'phone inspector sheet');
  await waitFor(() => app.querySelector('#right-panel').getBoundingClientRect().top <= 450, 'settled phone inspector sheet');

  click(app, app.querySelector('[data-inspector-tab="comments"]'));
  assert(app.querySelector('#right-panel').classList.contains('is-open'), 'the Comments tab should stay usable in the phone inspector sheet.');
  assert(!app.querySelector('#canvas-region').inert, 'The phone Comments sheet should leave the visible canvas available for selection.');
  click(app, app.querySelector('[data-inspector-tab="design"]'));
  await waitFor(() => Boolean(app.querySelector('[data-action="toggle-object-isolation-mode"]')), 'phone Design controls for the selected image');
  assert(app.querySelector('#canvas-region').inert, 'The phone Design sheet should keep focus in the inspector while controls are being used.');
  const selectArea = app.querySelector('[data-action="toggle-object-isolation-mode"]');
  const isolate = app.querySelector('[data-action="create-object-isolation-layer"]');
  const modes = [...app.querySelectorAll('[data-action="set-object-isolation-mode"]')];
  assert(selectArea?.textContent.trim() === 'Select area' && isolate?.textContent.trim() === 'Isolate', 'the phone inspector should expose the Select area → Isolate workflow.');
  assert(app.querySelector('[data-action="set-object-isolation-mode"][data-mode="3"]')?.getAttribute('aria-pressed') === 'true', 'Lasso should be the default phone area-selection mode.');
  assert(modes.length === 3 && modes.every(button => button.getBoundingClientRect().height >= 44), 'Include, Exclude, and Lasso should have phone-sized touch targets.');
  assert(selectArea.getBoundingClientRect().height >= 44 && isolate.getBoundingClientRect().height >= 44, 'Select area and Isolate should have phone-sized touch targets.');

  selectArea.scrollIntoView({ block: 'center' });
  click(app, selectArea);
  const sheetTop = app.querySelector('#right-panel').getBoundingClientRect().top;
  click(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').inert, 'canvas area above the closed phone sheet');
  const candidates = [{ x: 24, y: 48 }, { x: 72, y: 48 }, { x: 48, y: 24 }, { x: 48, y: 72 }];
  const center = candidates.find(candidate => {
    const around = [[-9, -9], [9, -9], [9, 9], [-9, 9], [-9, -9]];
    return around.every(([dx, dy]) => pixelPosition(app, { x: candidate.x + dx, y: candidate.y + dy }).clientY < sheetTop - 4);
  });
  assert(center, 'A touch lasso should fit in the visible canvas band above the phone inspector sheet.');
  const polygon = [[-9, -9], [9, -9], [9, 9], [-9, 9], [-9, -9]].map(([dx, dy]) => ({ x: center.x + dx, y: center.y + dy }));
  const sample = pixelPosition(app, center);
  const canvas = app.querySelector('#scene-canvas');
  const before = [...canvas.getContext('2d').getImageData(sample.x, sample.y, 1, 1).data].slice(0, 3);
  dispatchStroke(app, polygon);
  await paint(app);
  const after = [...canvas.getContext('2d').getImageData(sample.x, sample.y, 1, 1).data].slice(0, 3);
  assert(colorDistance(before, after) > 6, 'A touch lasso stroke should paint a visible selection preview on the canvas.');
  click(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'reopened phone inspector sheet');
  await waitFor(() => app.querySelector('#right-panel').getBoundingClientRect().top <= 450, 'settled reopened phone inspector sheet');
  const centerOnScreen = pixelPosition(app, center);
  assert(centerOnScreen.clientY < app.querySelector('#right-panel').getBoundingClientRect().top, 'The lasso preview should remain visible above the open phone inspector sheet.');
  const isolateAgain = app.querySelector('[data-action="create-object-isolation-layer"]');
  isolateAgain?.scrollIntoView({ block: 'center' });
  assert(isolateAgain?.textContent.trim() === 'Isolate' && isolateAgain.getBoundingClientRect().height >= 44, 'the touch-sized Isolate action should remain reachable after drawing on canvas.');

  app.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await paint(app);
  result.textContent = 'PASS\n' + JSON.stringify({ viewport: '390x844', commentsInspectorSheet: true, touchSizedControls: true, selectAreaIsolateLabels: true, defaultLasso: true, touchLassoPreviewAboveSheet: true });
} catch (error) {
  result.textContent = 'FAIL\n' + (error?.stack || error);
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 0));
  try { await deleteStoredDocument(design.id); } catch { /* Best-effort cleanup. */ }
  try { await deleteImageAsset(assetId); } catch { /* Best-effort cleanup. */ }
}
