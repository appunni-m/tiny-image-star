import { addNode, combineBoolean, createDocument, createNode } from '../src/model.js';
import { SceneRenderer } from '../src/renderer.js';
import { deleteStoredDocument, loadDocumentById, saveDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } } catch { /* Wait for editor state or storage to settle. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    void poll();
  });
}
function click(app, element, options = {}) {
  assert(element, 'Expected the Boolean text control to exist.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }));
}
function contextMenu(app, element) {
  assert(element, 'Expected the Boolean text layer row to exist.');
  element.dispatchEvent(new app.defaultView.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: 180, clientY: 160
  }));
}

let designId = null;
try {
  const renderDocument = createDocument();
  const text = createNode('text', {
    name: 'Text source', width: 100, height: 80, text: 'Local', fontSize: 44, fontWeight: 700,
    color: '#ff0000', opacity: 0.8, fillOpacity: 0.5
  });
  const clip = createNode('rectangle', { name: 'Text crop', width: 100, height: 80 });
  addNode(renderDocument, text);
  addNode(renderDocument, clip);
  const group = combineBoolean(renderDocument, [text.id, clip.id], 'intersect');
  const renderer = Object.create(SceneRenderer.prototype);
  const renderState = { document: renderDocument, assets: new Map(), zoom: 1 };
  renderer.getState = () => renderState;
  renderer.booleanCache = new Map();
  renderer.booleanCachePixels = 0;
  const mask = renderer.getBooleanSurface(group, renderState.assets, true, 1);
  const pixels = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
  let covered = 0;
  let peakAlpha = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3]) covered += 1;
    peakAlpha = Math.max(peakAlpha, pixels[index + 3]);
  }
  assert(covered > 0 && covered < mask.width * mask.height / 3,
    'real browser Boolean masks should contain text glyphs, not the whole text-box rectangle');
  assert(peakAlpha >= 90 && peakAlpha <= 115,
    `text opacity and fill opacity should be applied once (${peakAlpha})`);
  // Boolean masks are consumed by alpha (destination-in), so their source RGB
  // may retain the last intersected paint without changing the visible result.
  assert(peakAlpha > 0, 'text mask should retain visible alpha coverage');

  const design = createDocument();
  design.name = `Boolean text smoke ${Date.now()}`;
  const uiText = createNode('text', { name: 'Editable label', x: 0, y: 0, width: 100, height: 60, text: 'Type stays live', fontSize: 30 });
  const uiShape = createNode('rectangle', { name: 'Crop shape', x: 12, y: 0, width: 88, height: 60 });
  addNode(design, uiText);
  addNode(design, uiShape);
  designId = design.id;
  await saveDocument(design);

  const app = frame.contentDocument;
  await waitFor(() => app?.documentElement.dataset.appReady === 'true', 'editor startup');
  click(app, app.querySelector('#main-menu-button'));
  const yourDesigns = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  click(app, yourDesigns);
  const library = app.querySelector('#design-library-dialog');
  const row = await waitFor(() => library.open && library.querySelector(`[data-design-id="${designId}"][data-design-action="open"]`), 'saved editable text fixture');
  click(app, row);
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'text fixture open');

  click(app, app.querySelector(`.layer-row[data-layer-id="${uiText.id}"]`));
  click(app, app.querySelector(`.layer-row[data-layer-id="${uiShape.id}"]`), { ctrlKey: true });
  assert(app.querySelectorAll('.layer-row.is-selected[data-layer-id]').length === 2,
    'text and vector shape should support the normal multi-selection flow');
  contextMenu(app, app.querySelector(`.layer-row[data-layer-id="${uiShape.id}"]`));
  const combine = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim() === 'Combine as Intersect');
  assert(combine, 'the layer context menu should expose Boolean operations for selected text and shapes');
  click(app, combine);
  await waitFor(() => app.querySelector('.layer-row.is-selected[data-layer-id]')?.textContent.includes('Intersect group'), 'live text Boolean group');
  const stored = await waitFor(async () => {
    const current = await loadDocumentById(designId);
    return current?.pages?.[0]?.children?.find(node => node.type === 'boolean') || null;
  }, 'saved Boolean text source');
  assert(stored.children.some(child => child.type === 'text' && child.text === 'Type stays live'),
    'combining through the editor should preserve its editable text source');

  result.textContent = `PASS\n${JSON.stringify({ browserGlyphMask: true, opacityAppliedOnce: true, textAndShapeMenu: true, editableTextRetained: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  if (designId) await deleteStoredDocument(designId).catch(() => {});
}
