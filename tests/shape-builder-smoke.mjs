import { addNode, createDocument, createNode, findNode } from '../src/model.js';
import { shapeBuilderRegionAtPoint } from '../src/boolean-geometry.js';
import { deleteStoredDocument, loadDocumentById, saveDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const documentId = `shape-builder-${Date.now()}`;
let pointerId = 700;

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const value = await test();
        if (value) { resolve(value); return; }
      } catch { /* Wait for the editor, renderer, or local save to settle. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    void poll();
  });
}
function click(app, element, options = {}) {
  assert(element, 'Expected a Shape Builder control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }));
}
function tap(app, element) {
  assert(element, 'Expected a mobile Shape Builder control.');
  const id = pointerId++;
  element.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', button: 0 }));
  element.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', button: 0 }));
  click(app, element);
}
function selectedRows(app) {
  return [...app.querySelectorAll('#layers-list .layer-row.is-selected[data-layer-id]')];
}
function findLayer(documentData, id) {
  for (const page of documentData?.pages || []) {
    const found = findNode({ ...documentData, pages: [page], activePageId: page.id }, id, page.id);
    if (found) return found.node;
  }
  return null;
}
function canvasPoint(app, worldX, worldY) {
  const canvas = app.querySelector('#scene-canvas');
  const rect = canvas.getBoundingClientRect();
  const zoom = Number.parseFloat(app.querySelector('#zoom-readout')?.textContent) / 100 || 1;
  return {
    canvas,
    x: rect.left + canvas.clientWidth / 2 + worldX * zoom,
    y: rect.top + canvas.clientHeight / 2 + worldY * zoom
  };
}
function dispatchCanvasPointer(app, type, worldX, worldY, id = pointerId++) {
  const point = canvasPoint(app, worldX, worldY);
  Object.defineProperty(point.canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  point.canvas.dispatchEvent(new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: true,
    button: 0, clientX: point.x, clientY: point.y
  }));
}
function canvasTap(app, worldX, worldY) {
  const id = pointerId++;
  dispatchCanvasPointer(app, 'pointerdown', worldX, worldY, id);
  dispatchCanvasPointer(app, 'pointerup', worldX, worldY, id);
}
function canvasDrag(app, start, end) {
  const id = pointerId++;
  dispatchCanvasPointer(app, 'pointerdown', start.x, start.y, id);
  dispatchCanvasPointer(app, 'pointermove', (start.x + end.x) / 2, (start.y + end.y) / 2, id);
  dispatchCanvasPointer(app, 'pointermove', end.x, end.y, id);
  dispatchCanvasPointer(app, 'pointerup', end.x, end.y, id);
}
function shortcut(app, key) {
  const event = new app.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ctrlKey: true });
  app.body.dispatchEvent(event);
  assert(event.defaultPrevented, `Ctrl+${key.toUpperCase()} should be handled by the editor.`);
}
async function openDesign(app, design) {
  click(app, app.querySelector('#main-menu-button'));
  const designs = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  click(app, designs);
  const library = app.querySelector('#design-library-dialog');
  const open = await waitFor(() => library.open && library.querySelector(`[data-design-action="open"][data-design-id="${design.id}"]`), 'saved Shape Builder fixture');
  click(app, open);
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'Shape Builder fixture open');
}
async function selectLayers(app, ids, mobile) {
  if (mobile) {
    const leftPanel = app.querySelector('#left-panel');
    if (!leftPanel.classList.contains('is-open')) tap(app, app.querySelector('#sidebar-toggle'));
    const layersTab = app.querySelector('.sidebar-tab[data-sidebar-tab="layers"]');
    if (!layersTab.classList.contains('is-active')) tap(app, layersTab);
    click(app, app.querySelector(`.layer-row[data-layer-id="${ids[0]}"]`));
    if (ids.length > 1) {
      const mode = app.querySelector('#layer-select-mode');
      if (mode.getAttribute('aria-pressed') !== 'true') tap(app, mode);
      for (const id of ids.slice(1)) click(app, app.querySelector(`.layer-row[data-layer-id="${id}"]`));
    }
    const rightPanel = app.querySelector('#right-panel');
    if (!rightPanel.classList.contains('is-open')) tap(app, app.querySelector('#inspector-toggle'));
  } else {
    click(app, app.querySelector(`.layer-row[data-layer-id="${ids[0]}"]`));
    for (const id of ids.slice(1)) click(app, app.querySelector(`.layer-row[data-layer-id="${id}"]`), { ctrlKey: true });
  }
  assert(selectedRows(app).length === ids.length && ids.every(id => selectedRows(app).some(row => row.dataset.layerId === id)),
    'Shape Builder source selection did not match the requested layers.');
}
async function enterShapeBuilder(app) {
  const mobile = app.defaultView.innerWidth <= 820;
  const entry = await waitFor(() => app.querySelector('#inspector-content [data-action="shape-builder-start"]'), 'Shape Builder Inspector entry');
  if (mobile) tap(app, entry); else click(app, entry);
  const bar = await waitFor(() => {
    const element = app.querySelector('#shape-builder-bar');
    return element && !element.hidden ? element : null;
  }, 'Shape Builder canvas toolbar');
  if (mobile) {
    const bounds = bar.getBoundingClientRect();
    assert(bounds.left >= 0 && bounds.right <= app.defaultView.innerWidth, `The phone toolbar overflows the viewport (${bounds.left}..${bounds.right}).`);
    for (const button of bar.querySelectorAll('button')) {
      assert(button.getBoundingClientRect().height >= 40, 'A phone Shape Builder button is too small for touch.');
    }
  }
  return bar;
}
async function savedDocument() {
  return waitFor(async () => {
    const stored = await loadDocumentById(documentId);
    return stored?.name === documentId ? stored : null;
  }, 'local Shape Builder document');
}
async function waitForStored(predicate, label) {
  return waitFor(async () => {
    const stored = await loadDocumentById(documentId);
    return stored && predicate(stored) ? stored : null;
  }, `${label} save`);
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup', 45000);
  const app = frame.contentDocument;
  const design = createDocument();
  design.id = documentId;
  design.name = documentId;
  const extractLeft = createNode('rectangle', { name: 'Extract left', x: -100, y: -40, width: 100, height: 80, fill: '#df3b35' });
  const extractRight = createNode('rectangle', { name: 'Extract right', x: -50, y: -40, width: 100, height: 80, fill: '#276ce4' });
  const subtractLeft = createNode('rectangle', { name: 'Subtract left', x: 60, y: -40, width: 100, height: 80, fill: '#20985b' });
  const subtractRight = createNode('rectangle', { name: 'Subtract right', x: 110, y: -40, width: 100, height: 80, fill: '#edbc32' });
  const islands = createNode('path', {
    name: 'Merge islands', x: -160, y: 100, width: 100, height: 40, closed: true, fillRule: 'evenodd', fill: '#0aa',
    points: [{ x: 0, y: 0 }, { x: .2, y: 0 }, { x: .2, y: 1 }, { x: 0, y: 1 }],
    subpaths: [{ closed: true, points: [{ x: .8, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: .8, y: 1 }] }]
  });
  for (const node of [extractLeft, extractRight, subtractLeft, subtractRight, islands]) addNode(design, node);
  await saveDocument(design);
  await openDesign(app, design);
  await savedDocument();
  const mobile = app.defaultView.innerWidth <= 820;

  await selectLayers(app, [extractLeft.id, extractRight.id], mobile);
  let bar = await enterShapeBuilder(app);
  const pinchFirst = pointerId++;
  const pinchSecond = pointerId++;
  dispatchCanvasPointer(app, 'pointerdown', -25, 0, pinchFirst);
  dispatchCanvasPointer(app, 'pointerdown', -20, 5, pinchSecond);
  dispatchCanvasPointer(app, 'pointerup', -25, 0, pinchFirst);
  dispatchCanvasPointer(app, 'pointerup', -20, 5, pinchSecond);
  await new Promise(resolve => setTimeout(resolve, 350));
  const afterPinch = await loadDocumentById(documentId);
  assert(findLayer(afterPinch, extractLeft.id)?.type === 'rectangle'
    && findLayer(afterPinch, extractRight.id)?.type === 'rectangle',
  'A second touch should transfer to pinch navigation without committing a Shape Builder edit.');
  assert(!app.querySelector('#shape-builder-bar').hidden, 'Pinch navigation should preserve the Shape Builder tool mode.');
  if (mobile) tap(app, bar.querySelector('[data-action="shape-builder-done"]'));
  else click(app, bar.querySelector('[data-action="shape-builder-done"]'));
  assert(app.querySelector('#shape-builder-bar').hidden, 'Done should exit Shape Builder.');
  assert((await savedDocument()).pages[0].children.find(node => node.id === extractLeft.id)?.type === 'rectangle',
    'Done should leave the source vectors unchanged.');

  await selectLayers(app, [extractLeft.id, extractRight.id], mobile);
  bar = await enterShapeBuilder(app);
  canvasTap(app, -25, 0);
  const extracted = await waitForStored(stored => {
    const first = findLayer(stored, extractLeft.id);
    const second = findLayer(stored, extractRight.id);
    const paths = stored.pages.flatMap(page => page.children).filter(node => node.type === 'path');
    return first?.type === 'path' && second?.type === 'path' && paths.length >= 3 ? stored : null;
  }, 'extracted editable overlap region');
  const extractedPath = extracted.pages[0].children.find(node => node.type === 'path' && ![extractLeft.id, extractRight.id, islands.id].includes(node.id));
  assert(extractedPath, 'Extract should insert an editable path while retaining both source IDs.');
  assert(app.querySelector('#shape-builder-bar').hidden, 'A committed extract should close the preview toolbar.');
  shortcut(app, 'z');
  await waitForStored(stored => findLayer(stored, extractLeft.id)?.type === 'rectangle'
    && findLayer(stored, extractRight.id)?.type === 'rectangle', 'Shape Builder undo');
  shortcut(app, 'y');
  await waitForStored(stored => findLayer(stored, extractedPath.id)?.type === 'path'
    && findLayer(stored, extractLeft.id)?.type === 'path', 'Shape Builder redo');

  await selectLayers(app, [subtractLeft.id, subtractRight.id], mobile);
  bar = await enterShapeBuilder(app);
  const subtract = bar.querySelector('[data-shape-builder-mode="subtract"]');
  if (mobile) tap(app, subtract); else click(app, subtract);
  assert(subtract.getAttribute('aria-pressed') === 'true', 'Subtract should become the active mode.');
  canvasTap(app, 135, 0);
  const subtracted = await waitForStored(stored => findLayer(stored, subtractLeft.id)?.type === 'path'
    && findLayer(stored, subtractRight.id)?.type === 'path', 'subtracted overlap sources');
  for (const id of [subtractLeft.id, subtractRight.id]) {
    assert(shapeBuilderRegionAtPoint([findLayer(subtracted, id)], { x: 135, y: 0 }) === null,
      `Subtract left the selected overlap in source ${id}.`);
  }
  assert(!subtracted.pages[0].children.some(node => node.type === 'path'
    && ![extractLeft.id, extractRight.id, subtractLeft.id, subtractRight.id, islands.id, extractedPath.id].includes(node.id)),
  'Subtract should remove the selected face without creating a replacement path.');

  await selectLayers(app, [islands.id], mobile);
  bar = await enterShapeBuilder(app);
  canvasDrag(app, { x: -150, y: 120 }, { x: -70, y: 120 });
  const merged = await waitForStored(stored => !findLayer(stored, islands.id)
    && stored.pages[0].children.some(node => node.type === 'path' && node.subpaths?.length === 1
      && node.name === 'Merged vector regions'), 'drag-merged islands');
  const mergedPath = merged.pages[0].children.find(node => node.name === 'Merged vector regions');
  assert(mergedPath && mergedPath.id !== islands.id, 'Merge should create one native editable compound path with new identity.');
  assert(app.querySelector('#shape-builder-bar').hidden, 'A committed drag merge should close the preview toolbar.');
  result.textContent = `PASS\n${JSON.stringify({
    mobile, inspectorEntry: true, desktopOrTouchMultiSelect: true, toolbarDone: true,
    extract: true, undoRedo: true, subtract: true, subtractRemovesTheFaceFromEverySource: true,
    dragMergeDisconnectedRegions: true, localSave: true, editablePathOutputs: true
  })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  await deleteStoredDocument(documentId).catch(() => {});
}
