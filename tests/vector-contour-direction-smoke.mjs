import { addNode, createDocument, createNode } from '../src/model.js';
import { deleteStoredDocument, loadDocumentById, saveDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } } catch { /* Wait for the app to render its next state. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    poll();
  });
}
function tap(app, element) {
  assert(element, 'Expected a vector action control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

let designId = null;
let outcome;
try {
  const design = createDocument();
  design.name = `Contour direction smoke ${Date.now()}`;
  const path = createNode('path', {
    name: 'Reversible curve', x: -80, y: -45, width: 160, height: 90, closed: true,
    points: [
      { x: .1, y: .25, in: { x: -.03, y: -.04 }, out: { x: .28, y: -.2 }, mode: 'smooth' },
      { x: .78, y: .18, in: { x: -.18, y: .24 }, out: { x: .12, y: .04 } },
      { x: .52, y: .86, in: { x: .12, y: -.14 }, out: { x: -.1, y: .08 } }
    ]
  });
  addNode(design, path);
  designId = design.id;
  await saveDocument(design);

  const app = frame.contentDocument;
  await waitFor(() => app?.documentElement.dataset.appReady === 'true', 'editor startup');
  tap(app, app.querySelector('#main-menu-button'));
  const libraryMenuItem = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  tap(app, libraryMenuItem);
  const libraryDialog = app.querySelector('#design-library-dialog');
  const designRow = await waitFor(() => libraryDialog.open && libraryDialog.querySelector(`[data-design-id="${designId}"][data-design-action="open"]`), 'smoke design in local library');
  tap(app, designRow);
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'smoke design open');
  tap(app, app.querySelector(`[data-layer-id="${path.id}"]`));
  await waitFor(() => app.querySelector('[data-action="reverse-vector-contour"]'), 'contour direction control');
  const control = app.querySelector('[data-action="reverse-vector-contour"]');
  assert(control.textContent.includes('Reverse contour direction'), 'The path inspector should label the direction action clearly.');
  tap(app, control);
  await waitFor(async () => {
    const stored = await loadDocumentById(designId);
    const changed = stored?.pages?.[0]?.children?.find(node => node.id === path.id);
    return changed?.points?.[0]?.x === path.points.at(-1).x;
  }, 'reversed contour persistence');
  const stored = await loadDocumentById(designId);
  const savedPath = stored.pages[0].children.find(node => node.id === path.id);
  assert(savedPath.points.map(point => point.x).join(',') === path.points.map(point => point.x).reverse().join(','),
    'The saved contour should reverse its anchor order.');
  assert(savedPath.points[0].in.x === path.points.at(-1).out.x
    && savedPath.points[0].out.x === path.points.at(-1).in.x,
  'Reversal should swap Bézier handles while preserving the curve.');
  outcome = `PASS\n${JSON.stringify({ inspectorAction: true, anchorOrderReversed: true, bezierHandlesSwapped: true, localSave: true })}`;
} catch (error) {
  outcome = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  if (designId) await deleteStoredDocument(designId).catch(() => {});
}
result.textContent = outcome;
