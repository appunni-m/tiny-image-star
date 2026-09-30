import { addNode, combineBoolean, createDocument, createNode } from '../src/model.js';
import { deleteStoredDocument, loadDocumentById, saveDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } } catch { /* Wait for the editor or its save queue. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    void poll();
  });
}
function click(app, element) {
  assert(element, 'Expected the Boolean bake control to exist.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function contextMenu(app, element) {
  assert(element, 'Expected the Boolean layer row to exist.');
  element.dispatchEvent(new app.defaultView.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: 180, clientY: 160
  }));
}
function shortcut(app, shift = false) {
  const event = new app.defaultView.KeyboardEvent('keydown', {
    bubbles: true, cancelable: true, key: 'z', ctrlKey: true, shiftKey: shift
  });
  app.body.dispatchEvent(event);
  assert(event.defaultPrevented, shift ? 'Redo should consume Ctrl+Shift+Z.' : 'Undo should consume Ctrl+Z.');
}
function pixelAt(app, worldX, worldY) {
  const canvas = app.querySelector('#scene-canvas');
  const zoom = Number.parseFloat(app.querySelector('#zoom-readout')?.textContent) / 100;
  const x = canvas.clientWidth / 2 + (worldX - 40) * zoom;
  const y = canvas.clientHeight / 2 + (worldY - 30) * zoom;
  const ratioX = canvas.width / canvas.clientWidth;
  const ratioY = canvas.height / canvas.clientHeight;
  return [...canvas.getContext('2d').getImageData(Math.floor(x * ratioX), Math.floor(y * ratioY), 1, 1).data];
}

let designId = null;
let outcome;
try {
  const design = createDocument();
  design.name = `Boolean bake smoke ${Date.now()}`;
  const underlay = createNode('rectangle', { name: 'Underlay', x: 0, y: 0, width: 80, height: 60, fill: '#00cc00' });
  const base = createNode('rectangle', { name: 'Resizable base', x: 0, y: 0, width: 40, height: 40, fill: '#0055ff' });
  const cutter = createNode('rectangle', { name: 'Resize cutout', x: 10, y: 10, width: 20, height: 20 });
  addNode(design, underlay); addNode(design, base); addNode(design, cutter);
  const group = combineBoolean(design, [base.id, cutter.id], 'subtract');
  group.width = 80; group.height = 60;
  const booleanId = group.id;
  designId = design.id;
  await saveDocument(design);

  const app = frame.contentDocument;
  await waitFor(() => app?.documentElement.dataset.appReady === 'true', 'editor startup');
  click(app, app.querySelector('#main-menu-button'));
  const menuItem = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  click(app, menuItem);
  const library = app.querySelector('#design-library-dialog');
  const designRow = await waitFor(() => library.open && library.querySelector(`[data-design-id="${designId}"][data-design-action="open"]`), 'saved fixture in local designs');
  click(app, designRow);
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'fixture design open');
  const groupRow = await waitFor(() => app.querySelector(`.layer-row[data-layer-id="${booleanId}"]`), 'resized Boolean layer');
  click(app, groupRow);
  // Fit the selected group so the pixel sampler's origin matches its 80×60 bounds.
  click(app, app.querySelector('#zoom-fit'));
  const selectedGroupRow = await waitFor(() => app.querySelector(`.layer-row[data-layer-id="${booleanId}"]`), 'selected Boolean layer');
  assert(app.querySelector('[data-action="bake-boolean"]')?.textContent.includes('Bake to vector path'), 'the Boolean inspector must expose Bake to vector path.');
  contextMenu(app, selectedGroupRow);
  const bakeMenuItem = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim() === 'Bake to vector path');
  assert(bakeMenuItem, 'the Boolean context menu must expose Bake to vector path.');

  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const liveBlue = pixelAt(app, 5, 5);
  const liveHole = pixelAt(app, 40, 30);
  const liveResizedEdge = pixelAt(app, 70, 50);
  assert(liveBlue[2] > 220 && liveBlue[1] < 130, `resized Boolean preview should fill the preserved area (${liveBlue.join(',')})`);
  assert(liveHole[1] > 180 && liveHole[2] < 80, `resized Boolean preview should expose the cutout (${liveHole.join(',')})`);
  assert(liveResizedEdge[2] > 220 && liveResizedEdge[1] < 130, `resized Boolean preview should stretch source geometry to its current bounds (${liveResizedEdge.join(',')})`);

  click(app, bakeMenuItem);
  const bakedRow = await waitFor(() => {
    const row = app.querySelector(`.layer-row[data-layer-id="${booleanId}"]`);
    return row?.dataset.layerType === 'path' ? row : null;
  }, 'native editable vector path after baking');
  await waitFor(async () => {
    const saved = await loadDocumentById(designId);
    return saved?.pages?.[0]?.children?.find(node => node.id === booleanId)?.type === 'path';
  }, 'baked vector save');
  click(app, bakedRow);
  assert(app.querySelector('[data-action="insert-vector-point"]'), 'the baked layer should expose native vector point editing controls.');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const bakedBlue = pixelAt(app, 5, 5);
  const bakedHole = pixelAt(app, 40, 30);
  const bakedResizedEdge = pixelAt(app, 70, 50);
  assert(JSON.stringify(bakedBlue) === JSON.stringify(liveBlue), 'baked path pixels should exactly match the resized live Boolean preview');
  assert(JSON.stringify(bakedHole) === JSON.stringify(liveHole), 'the compound-path hole should match the live cutout');
  assert(JSON.stringify(bakedResizedEdge) === JSON.stringify(liveResizedEdge), 'the resized outer edge should match the live Boolean preview');

  let stored = await loadDocumentById(designId);
  const savedPath = stored.pages[0].children.find(node => node.id === booleanId);
  assert(savedPath?.type === 'path' && savedPath.points.length === 4 && savedPath.subpaths?.length === 1,
    'saving should retain the native outer and hole contours under the same layer ID');
  const savedGeometry = JSON.stringify({ points: savedPath.points, subpaths: savedPath.subpaths, fillRule: savedPath.fillRule });

  shortcut(app, false);
  await waitFor(() => app.querySelector(`.layer-row[data-layer-id="${booleanId}"]`)?.dataset.layerType === 'boolean', 'undo restores live Boolean sources');
  shortcut(app, true);
  await waitFor(() => app.querySelector(`.layer-row[data-layer-id="${booleanId}"]`)?.dataset.layerType === 'path', 'redo restores the baked path');
  stored = await waitFor(async () => {
    const current = await loadDocumentById(designId);
    return current?.pages?.[0]?.children?.find(node => node.id === booleanId)?.type === 'path' ? current : null;
  }, 'redo geometry save');
  const redonePath = stored.pages[0].children.find(node => node.id === booleanId);
  assert(JSON.stringify({ points: redonePath.points, subpaths: redonePath.subpaths, fillRule: redonePath.fillRule }) === savedGeometry,
    'redo and local persistence should retain the exact editable contours');
  outcome = `PASS\n${JSON.stringify({ inspectorBakeAction: true, contextMenuBakeAction: true, nativeEditablePath: true, resizedBooleanPreviewMatchesBake: true, holeAndCompoundContour: true, exactSaveUndoRedoGeometry: true })}`;
} catch (error) {
  outcome = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  if (designId) await deleteStoredDocument(designId).catch(() => {});
}
result.textContent = outcome;
