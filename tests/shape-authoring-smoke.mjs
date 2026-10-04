import { addNode, createDocument, createNode } from '../src/model.js';
import { createAutoLayout } from '../src/layout-engine.js';
import { exportNodeToSvg, exportPageToSvg } from '../src/svg-export.js';
import { deleteStoredDocument } from '../src/storage.js';

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
function dispatchPointer(app, canvas, type, point, pointerId, pointerType = 'mouse', modifiers = {}) {
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  canvas.dispatchEvent(new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType, button: 0,
    clientX: point.x, clientY: point.y, ...modifiers
  }));
}
function worldScreenPoint(canvas, x, y) {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + rect.width / 2 + x, y: rect.top + rect.height / 2 + y };
}
function drawShape(app, type, startWorld, endWorld, pointerId, modifiers = {}) {
  const canvas = app.querySelector('#scene-canvas');
  click(app, app.querySelector(`[data-tool="${type}"]`));
  dispatchPointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, startWorld.x, startWorld.y), pointerId);
  dispatchPointer(app, canvas, 'pointermove', worldScreenPoint(canvas, endWorld.x, endWorld.y), pointerId, 'mouse', modifiers);
  dispatchPointer(app, canvas, 'pointerup', worldScreenPoint(canvas, endWorld.x, endWorld.y), pointerId, 'mouse', modifiers);
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
async function waitForSavedNode(app, documentId, nodeId, label, context = {}) {
  const started = performance.now();
  while (performance.now() - started <= 12000) {
    const saved = await readSavedDesign(app, documentId);
    if (findNodeInPages(saved, nodeId)) return saved;
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  const saved = await readSavedDesign(app, documentId);
  const savedNodes = (saved?.pages || []).flatMap(page => collectNodes(page.children));
  const status = app.querySelector('#save-state')?.textContent.trim() || 'unavailable';
  const diagnostic = {
    targetId: nodeId,
    documentId,
    storedDocumentName: saved?.name ?? null,
    storedPageIds: (saved?.pages || []).map(page => ({ id: page.id, name: page.name })),
    storedLineNodes: savedNodes.filter(node => node.type === 'line').map(({ id, name, x, y, width, height }) => ({ id, name, x, y, width, height })),
    storedTargetNode: savedNodes.find(node => node.id === nodeId)?.type ?? null,
    currentRows: layerRowSnapshot(app),
    ...context,
    saveState: status
  };
  throw new Error(`Timed out waiting for ${label} to persist: ${JSON.stringify(diagnostic)}`);
}
function findNode(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return null;
}
function findNodeInPages(document, id) {
  for (const page of document?.pages || []) {
    const node = findNode(page.children, id);
    if (node) return node;
  }
  return null;
}
function collectNodes(nodes, output = []) {
  for (const node of nodes || []) {
    output.push(node);
    collectNodes(node.children, output);
  }
  return output;
}
function layerRowSnapshot(app) {
  return [...app.querySelectorAll('.layer-row[data-layer-id]')].map(row => ({
    id: row.dataset.layerId,
    type: row.dataset.layerType || null,
    selected: row.classList.contains('is-selected'),
    text: row.textContent.trim().replace(/\s+/g, ' ').slice(0, 120)
  }));
}
function countNodes(nodes) {
  return (nodes || []).reduce((count, node) => count + 1 + countNodes(node.children), 0);
}
function hasBlueAtWorld(canvas, point) {
  const rect = canvas.getBoundingClientRect();
  const centerX = Math.round((rect.width / 2 + point.x) * canvas.width / rect.width);
  const centerY = Math.round((rect.height / 2 + point.y) * canvas.height / rect.height);
  const context = canvas.getContext('2d');
  for (let y = Math.max(0, centerY - 2); y <= Math.min(canvas.height - 1, centerY + 2); y += 1) {
    for (let x = Math.max(0, centerX - 2); x <= Math.min(canvas.width - 1, centerX + 2); x += 1) {
      const pixel = context.getImageData(x, y, 1, 1).data;
      if (pixel[3] > 180 && pixel[0] < 80 && pixel[1] > 100 && pixel[2] > 180) return true;
    }
  }
  return false;
}
async function waitForSave(app, label) {
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saving locally'), `${label} save start`);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${label} save completion`);
}
function importEmptyDesign(app) {
  const design = createDocument();
  design.id = documentId;
  design.name = documentId;
  const autoLayoutFrame = createNode('frame', {
    name: 'Rotated Pencil layout frame', x: -225, y: 70, width: 200, height: 150, rotation: 9,
    autoLayout: createAutoLayout({ axis: 'horizontal', gap: 8, padding: 12 })
  });
  addNode(design, autoLayoutFrame);
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

  drawShape(app, 'rectangle', { x: 68, y: 82 }, { x: 128, y: 97 }, 218, { shiftKey: true });
  const squareId = app.querySelector('.layer-row.is-selected')?.dataset.layerId;
  await waitForSave(app, 'Shift-constrained square creation');
  let modifierDocument = await readSavedDesign(app, documentId);
  let square = findNode(modifierDocument.pages[0].children, squareId);
  assert(square?.type === 'rectangle' && square.width === 60 && square.height === 60,
    `Shift-drag should constrain a rectangle to a square (${square?.width}×${square?.height}).`);

  drawShape(app, 'ellipse', { x: 190, y: 110 }, { x: 210, y: 120 }, 219, { altKey: true });
  const centeredEllipseId = app.querySelector('.layer-row.is-selected')?.dataset.layerId;
  await waitForSave(app, 'Alt center-out ellipse creation');
  modifierDocument = await readSavedDesign(app, documentId);
  const centeredEllipse = findNode(modifierDocument.pages[0].children, centeredEllipseId);
  assert(centeredEllipse?.type === 'ellipse' && centeredEllipse.x === 170 && centeredEllipse.y === 100
    && centeredEllipse.width === 40 && centeredEllipse.height === 20,
  `Alt-drag should use the initial pointer as the ellipse center (${centeredEllipse?.x},${centeredEllipse?.y},${centeredEllipse?.width}×${centeredEllipse?.height}).`);

  const lineRowsBefore = layerRowSnapshot(app);
  const lineIdsBefore = new Set(lineRowsBefore.map(row => row.id));
  drawShape(app, 'line', { x: 250, y: 100 }, { x: 300, y: 130 }, 220, { shiftKey: true });
  const lineRowsAfter = layerRowSnapshot(app);
  const addedLineRows = lineRowsAfter.filter(row => row.type === 'line' && !lineIdsBefore.has(row.id));
  const selectedLineRow = lineRowsAfter.find(row => row.selected && row.type === 'line');
  const snappedLineId = addedLineRows.length === 1 ? addedLineRows[0].id : null;
  const lineDragScreenDistance = Math.hypot(300 - 250, 130 - 100);
  assert(lineDragScreenDistance > 4, 'the synthetic line drag must exceed the editor’s 4px creation threshold.');
  assert(snappedLineId && selectedLineRow?.id === snappedLineId,
    `Shift-snapped line drawing did not create and select exactly one new line layer: ${JSON.stringify({ before: lineRowsBefore, after: lineRowsAfter, addedLineRows, selectedLineRow, lineDragScreenDistance, drawThresholdScreenPixels: 4 })}.`);
  await waitFor(() => app.querySelector('#inspector-content [data-stroke-field="width"]'), 'line stroke inspector controls');
  modifierDocument = await waitForSavedNode(app, documentId, snappedLineId, 'Shift-snapped line creation', {
    newLineRows: addedLineRows,
    selectedLineRow,
    lineDragScreenDistance,
    drawThresholdScreenPixels: 4
  });
  const snappedLine = findNodeInPages(modifierDocument, snappedLineId);
  assert(snappedLine?.type === 'line' && Math.abs(snappedLine.width - snappedLine.height) < 1e-8,
    `Shift-drag should snap line angles to 45° (${snappedLine?.width}×${snappedLine?.height}).`);
  const lineEndDecoration = app.querySelector('#inspector-content [data-stroke-field="endDecoration"]');
  assert(lineEndDecoration && [...lineEndDecoration.options].some(option => option.value === 'triangle-inward'),
    'the line inspector should expose the imported inward-pointing triangle decoration');
  lineEndDecoration.value = 'triangle-inward';
  lineEndDecoration.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  lineEndDecoration.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitForSave(app, 'inward triangle endpoint decoration');
  modifierDocument = await readSavedDesign(app, documentId);
  const decoratedLine = findNodeInPages(modifierDocument, snappedLineId);
  assert(decoratedLine?.strokes?.[0]?.endDecoration === 'triangle-inward',
    'the inward-pointing triangle decoration should survive a local save');

  drawShape(app, 'line', { x: 350, y: 130 }, { x: 400, y: 100 }, 221, { shiftKey: true });
  const reverseLineId = app.querySelector('.layer-row.is-selected')?.dataset.layerId;
  await waitForSave(app, 'negative-slope line creation');
  modifierDocument = await readSavedDesign(app, documentId);
  const reverseLine = findNode(modifierDocument.pages[0].children, reverseLineId);
  assert(reverseLine?.type === 'line' && reverseLine.lineReverseY === true
    && /d="M 0 [\d.]+ L [\d.]+ 0"/.test(exportNodeToSvg(reverseLine)),
  'A snapped negative-slope line must persist its direction and export the same geometry to SVG.');

  const pencilButton = app.querySelector('[data-tool="pencil"]');
  assert(pencilButton?.getAttribute('aria-label') === 'Pencil · draw freehand with stylus pressure',
    'the canvas toolbar does not expose the Pencil tool with its accessible stylus-pressure description.');
  click(app, pencilButton);
  const pencilPath = [{ x: -150, y: 128 }, { x: -126, y: 108 }, { x: -102, y: 140 }, { x: -78, y: 106 }, { x: -54, y: 132 }];
  for (const [index, point] of pencilPath.entries()) {
    dispatchPointer(app, canvas, index === 0 ? 'pointerdown' : 'pointermove', worldScreenPoint(canvas, point.x, point.y), 212, 'touch');
    if (index === 1) {
      await waitFor(() => hasBlueAtWorld(canvas, { x: -138, y: 118 }), 'live Pencil canvas preview');
    }
  }
  dispatchPointer(app, canvas, 'pointerup', worldScreenPoint(canvas, pencilPath.at(-1).x, pencilPath.at(-1).y), 212, 'touch');
  const pencilId = app.querySelector('.layer-row.is-selected')?.dataset.layerId;
  assert(pencilId, 'a touch Pencil stroke did not create and select a vector layer.');
  await waitForSave(app, 'Pencil path creation');

  const beforeCancelledStroke = await readSavedDesign(app, documentId);
  const pencil = findNode(beforeCancelledStroke.pages[0].children, pencilId);
  assert(pencil?.type === 'network' && pencil.name === 'Pencil path', 'Pencil did not create an editable vector-network layer.');
  assert(pencil.vertices?.length >= 2 && pencil.edges?.length >= 1, 'Pencil output did not retain editable vector anchors and edges.');
  assert(pencil.edges.some(edge => edge.control1 && edge.control2), 'Pencil output did not fit editable Bézier controls.');
  const pencilParent = beforeCancelledStroke.pages[0].children.find(node => node.name === 'Rotated Pencil layout frame');
  assert(pencilParent?.children.some(node => node.id === pencilId) && pencilParent.autoLayout && pencil.layoutPositioning === 'absolute',
    'Pencil drawing in a rotated auto-layout frame must remain an absolutely positioned child.');

  await new Promise(resolve => setTimeout(resolve, 220));
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', ctrlKey: true }));
  await waitFor(() => !app.querySelector(`[data-layer-id="${pencilId}"]`), 'undo removing the Pencil path');
  await waitForSave(app, 'Pencil undo');
  let historySnapshot = await readSavedDesign(app, documentId);
  assert(!findNode(historySnapshot.pages[0].children, pencilId), 'undo left the Pencil vector network in the saved design.');
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'y', ctrlKey: true }));
  await waitFor(() => app.querySelector(`[data-layer-id="${pencilId}"]`), 'redo restoring the Pencil path');
  await waitForSave(app, 'Pencil redo');
  historySnapshot = await readSavedDesign(app, documentId);
  const redonePencil = findNode(historySnapshot.pages[0].children, pencilId);
  assert(JSON.stringify(redonePencil?.vertices) === JSON.stringify(pencil.vertices)
    && JSON.stringify(redonePencil?.edges) === JSON.stringify(pencil.edges), 'redo did not restore the exact editable Pencil network.');

  const countBeforeCancel = countNodes(beforeCancelledStroke.pages[0].children);
  dispatchPointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, 205, 130), 213, 'touch');
  dispatchPointer(app, canvas, 'pointermove', worldScreenPoint(canvas, 235, 155), 213, 'touch');
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
  await new Promise(resolve => setTimeout(resolve, 220));
  const afterCancelledStroke = await readSavedDesign(app, documentId);
  assert(countNodes(afterCancelledStroke.pages[0].children) === countBeforeCancel, 'Escape committed a partial Pencil stroke.');

  const secondPencilPath = [{ x: 190, y: 124 }, { x: 218, y: 139 }, { x: 246, y: 116 }];
  for (const [index, point] of secondPencilPath.entries()) {
    dispatchPointer(app, canvas, index === 0 ? 'pointerdown' : 'pointermove', worldScreenPoint(canvas, point.x, point.y), 214, 'touch');
  }
  dispatchPointer(app, canvas, 'pointerup', worldScreenPoint(canvas, secondPencilPath.at(-1).x, secondPencilPath.at(-1).y), 214, 'touch');
  const secondPencilId = app.querySelector('.layer-row.is-selected')?.dataset.layerId;
  assert(secondPencilId && secondPencilId !== pencilId, 'Pencil did not accept the next touch stroke after Escape cancelled a draft.');
  await waitForSave(app, 'Pencil path after cancellation');
  const afterSecondStroke = await readSavedDesign(app, documentId);
  const countBeforePointerCancel = countNodes(afterSecondStroke.pages[0].children);
  dispatchPointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, 265, 125), 215, 'touch');
  dispatchPointer(app, canvas, 'pointermove', worldScreenPoint(canvas, 295, 155), 215, 'touch');
  dispatchPointer(app, canvas, 'pointercancel', worldScreenPoint(canvas, 295, 155), 215, 'touch');
  await new Promise(resolve => setTimeout(resolve, 220));
  const afterPointerCancel = await readSavedDesign(app, documentId);
  assert(countNodes(afterPointerCancel.pages[0].children) === countBeforePointerCancel, 'pointercancel committed a partial Pencil stroke.');

  dispatchPointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, -10, 215), 216, 'touch');
  dispatchPointer(app, canvas, 'pointermove', worldScreenPoint(canvas, 18, 236), 216, 'touch');
  dispatchPointer(app, canvas, 'lostpointercapture', worldScreenPoint(canvas, 18, 236), 216, 'touch');
  await new Promise(resolve => setTimeout(resolve, 220));
  const afterLostCapture = await readSavedDesign(app, documentId);
  assert(countNodes(afterLostCapture.pages[0].children) === countBeforePointerCancel, 'lost pointer capture committed a partial Pencil stroke.');
  dispatchPointer(app, canvas, 'pointerdown', worldScreenPoint(canvas, 22, 220), 217, 'touch');
  dispatchPointer(app, canvas, 'pointermove', worldScreenPoint(canvas, 45, 241), 217, 'touch');
  dispatchPointer(app, canvas, 'pointerup', worldScreenPoint(canvas, 45, 241), 217, 'touch');
  assert(app.querySelector('.layer-row.is-selected')?.dataset.layerId, 'Pencil did not accept the next stroke after lost pointer capture.');
  await waitForSave(app, 'Pencil recovery after lost capture');

result.textContent = `PASS\n${JSON.stringify({ starTool: true, starInspector: true, polygonInspector: true, shiftSquare: true, altCenterEllipse: true, shiftLineSnap: true, reverseLineDirection: true, pencilTouch: true, pencilEditableNetwork: true, pencilLivePreview: true, pencilAutoLayoutPlacement: true, pencilUndoRedo: true, pencilCancellation: true, pencilPointerCancel: true, pencilLostCapture: true, liveCanvasRender: true, undoRedo: true, localPersistence: true, svgGeometry: true, starPoints: finalStar.points, starInnerRadius: finalStar.innerRadius, polygonSides: polygon.points })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  await deleteStoredDocument(documentId).catch(() => {});
}
