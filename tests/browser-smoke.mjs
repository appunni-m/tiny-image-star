import { addNode, addVariableMode, bindColorVariable, canCreateMaskGroup, createColorVariable, createDocument, createGradientFill, createLayerEffect, createMaskGroup, createNode, createVariable, createVariableCollection, getNodeColor, getNodePropertyValue, releaseMaskGroup, resolveVariableValue, setColorVariableValue, setVariableValue } from '../src/model.js';
import { SceneRenderer, worldToScreen } from '../src/renderer.js';
import { vectorNetworkEdgePoints, vectorNetworkVertexPoint } from '../src/vector-path.js';
import { createImageFill } from '../src/image-fills.js';
import { createAutoLayout } from '../src/layout-engine.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } }
      catch { /* The app may still be rendering its initial state. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 35);
    };
    poll();
  });
}
async function waitForSaveCycle(app, label) {
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saving locally'), `${label} save start`);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${label} save completion`);
}
function fixtureBmp() {
  const width = 64; const height = 32; const pixels = width * height * 3; const bytes = new Uint8Array(54 + pixels); const view = new DataView(bytes.buffer);
  bytes[0] = 66; bytes[1] = 77; view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, width, true); view.setInt32(22, height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, pixels, true);
  let offset = 54;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const left = x < width / 2; bytes[offset++] = left ? 30 : 230; bytes[offset++] = left ? 65 : 145; bytes[offset++] = left ? 210 : 40;
  }
  return bytes;
}
function imageInput(doc, files) {
  const input = doc.querySelector('#image-input'); const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function pixelInLeftHalf(doc) {
  const canvas = doc.querySelector('#scene-canvas'); const rect = canvas.getBoundingClientRect(); const dpr = doc.defaultView.devicePixelRatio || 1;
  // Imports fan out by 24 px; the third image is selected at x=16, y=32.
  const x = Math.round((rect.width / 2 + 32) * dpr); const y = Math.round((rect.height / 2 + 48) * dpr);
  return [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];
}
function dispatchClick(element, options = {}) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }));
}
function dispatchContextMenu(element) {
  element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 180, clientY: 160 }));
}
function dispatchImageCanvasContextMenu(app, xOffset = 32, yOffset = 24) {
  const canvas = app.querySelector('#scene-canvas');
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new app.defaultView.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2,
    clientX: rect.left + rect.width / 2 + xOffset,
    clientY: rect.top + rect.height / 2 + yOffset
  }));
}
function dispatchShortcut(doc, key, { shift = false } = {}) {
  doc.body.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ctrlKey: true, shiftKey: shift }));
}
function dispatchCanvasPointer(app, canvas, type, clientX, clientY, pointerId = 71) {
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  canvas.dispatchEvent(new app.defaultView.PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, clientX, clientY }));
}
function readStore(storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('figma-local-documents', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const get = db.transaction(storeName).objectStore(storeName).getAll();
      get.onsuccess = () => { resolve(get.result); db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  });
}
function flattenNodes(nodes, result = []) { for (const node of nodes || []) { result.push(node); flattenNodes(node.children, result); } return result; }
function findNodeOrigin(nodes, id, parentX = 0, parentY = 0) {
  for (const node of nodes || []) {
    const x = parentX + node.x; const y = parentY + node.y;
    if (node.id === id) return { node, x, y };
    const nested = findNodeOrigin(node.children, id, x, y);
    if (nested) return nested;
  }
  return null;
}
function buildPackage(documentData, assets) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: documentData.schema, document: documentData, assets: assets.map(({ id, name, type, bytes }) => ({ id, name, type, length: bytes.byteLength })) }));
  const headerLength = new Uint8Array(4); new DataView(headerLength.buffer).setUint32(0, manifest.byteLength, true);
  const chunks = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), headerLength, manifest, ...assets.map(asset => new Uint8Array(asset.bytes))];
  const output = new Uint8Array(chunks.reduce((total, part) => total + part.byteLength, 0)); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'isolated editor event handlers');
  const app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star' && app.querySelector('.brand-mark')?.textContent.trim() === '✦', 'the editor branding does not use the Tiny Image Star identity');
  dispatchClick(app.querySelector('#file-menu-button'));
  const newDesign = [...app.querySelectorAll('#context-menu button')].find(item => item.textContent.includes('New design'));
  assert(newDesign, 'the file menu did not expose a fresh local design for this isolated workflow');
  dispatchClick(newDesign);
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(item => item.textContent.includes('New local design created.')), 'fresh local design switch');
  await waitFor(() => app.querySelectorAll('.layer-row[data-layer-id]').length === 0, 'fresh local design');
  const source = fixtureBmp();
  const files = Array.from({ length: 3 }, (_, index) => new File([source], `local-fixture-${index + 1}.bmp`, { type: 'image/bmp' }));
  imageInput(app, files);
  await waitFor(() => app.querySelectorAll('.layer-row').length === 3, 'three image layers');
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'WASM image preview');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const before = pixelInLeftHalf(app);
  const brightness = app.querySelector('[data-prop="adjustments.brightness"]');
  assert(brightness, 'the selected image did not expose adjustment controls');
  brightness.value = '-60'; brightness.dispatchEvent(new Event('input', { bubbles: true })); brightness.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'edited WASM preview');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const after = pixelInLeftHalf(app);
  assert(after[0] < before[0] - 20, `brightness edit did not change the same canvas image (${before.join(',')} -> ${after.join(',')})`);
  await waitForSaveCycle(app, 'image edit before history preview check');
  dispatchShortcut(app, 'z');
  await waitFor(() => Math.abs(pixelInLeftHalf(app)[0] - before[0]) < 12, 'undo image preview restoration');
  dispatchShortcut(app, 'z', { shift: true });
  await waitFor(() => Math.abs(pixelInLeftHalf(app)[0] - after[0]) < 12, 'redo image preview restoration');

  let selectedRow = app.querySelector('.layer-row.is-selected[data-layer-id]');
  assert(selectedRow, 'the imported image layer was not selected');
  dispatchImageCanvasContextMenu(app);
  const saveRecipeItem = [...app.querySelectorAll('#context-menu button')].find(item => item.textContent.includes('Save image recipe'));
  assert(saveRecipeItem, 'right-clicking the edited canvas image did not offer recipe saving');
  dispatchClick(saveRecipeItem);
  const dialog = app.querySelector('#recipe-dialog');
  assert(dialog.open, 'the save-recipe dialog did not open');
  app.querySelector('#recipe-name').value = 'Local red recipe';
  dispatchClick(app.querySelector('#save-recipe-confirm'));
  await waitFor(() => !dialog.open, 'recipe dialog close');
  await waitForSaveCycle(app, 'recipe save');

  for (let index = 0; index < 3; index += 1) {
    const row = app.querySelectorAll('.layer-row[data-layer-id]')[index];
    dispatchClick(row, { ctrlKey: index > 0 });
  }
  assert(app.querySelectorAll('.layer-row.is-selected[data-layer-id]').length === 3, 'multi-select did not retain all target images');
  dispatchImageCanvasContextMenu(app);
  assert([...app.querySelectorAll('#context-menu .menu-label')].some(item => item.textContent.trim() === 'Apply recipe to 3 images'), 'canvas context menu did not preserve the full multi-image selection');
  const recipeItem = [...app.querySelectorAll('#context-menu button')].find(item => item.textContent.trim() === 'Local red recipe');
  assert(recipeItem, 'right-clicking a selected canvas image did not show the saved recipe for the multi-selection');
  dispatchClick(recipeItem);
  assert(!app.querySelector('#bulk-bar').hidden, 'recipe processing bar did not start');
  dispatchClick(app.querySelector('#bulk-pause'));
  await waitFor(() => app.querySelector('#bulk-title')?.textContent === 'Processing paused', 'pause control');
  const speed = app.querySelector('#bulk-speed'); speed.value = String(Math.min(3, Number(speed.max))); speed.dispatchEvent(new Event('input', { bubbles: true }));
  assert(app.querySelector('#bulk-speed-value').textContent.includes('worker'), 'speed control did not update the live worker count');
  dispatchClick(app.querySelector('#bulk-pause'));
  await waitFor(() => !app.querySelector('#bulk-done').hidden && app.querySelector('#bulk-progress-label').textContent === '3 / 3', 'in-place bulk recipe completion');
  assert(app.querySelector('#bulk-title').textContent === 'Recipe applied', 'bulk recipe did not finish successfully');
  assert(app.querySelectorAll('.layer-row').length === 3, 'bulk processing replaced the selected image layers');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'last batch autosave');

  const clipboardRecords = await readStore('documents'); clipboardRecords.sort((a, b) => b.savedAt - a.savedAt);
  const clipboardDocument = clipboardRecords[0]?.document;
  const clipboardImages = flattenNodes(clipboardDocument?.pages?.find(page => page.id === clipboardDocument.activePageId)?.children)
    .filter(node => node.type === 'image');
  assert(clipboardImages.length === 3, 'clipboard browser coverage did not start with the three imported images');
  const originalClipboardIds = clipboardImages.map(node => node.id);
  const originalAssetIds = new Set(clipboardImages.map(node => node.assetId));
  const assetIdsBeforeClipboard = new Set((await readStore('assets')).map(asset => asset.id));
  const rowForLayer = id => app.querySelector(`.layer-row[data-layer-id="${id}"]`);
  const selectClipboardLayer = id => {
    const row = rowForLayer(id); assert(row, `layer ${id} disappeared during clipboard coverage`); dispatchClick(row); return row;
  };
  const openClipboardMenu = id => { const row = rowForLayer(id); assert(row, `layer ${id} disappeared before its context menu opened`); dispatchContextMenu(row); };
  const clickClipboardMenuAction = (label, { startsWith = false } = {}) => {
    const button = [...app.querySelectorAll('#context-menu button')].find(item => startsWith
      ? item.textContent.trim().startsWith(label)
      : item.textContent.trim() === label);
    assert(button, `layer context menu did not expose ${label}`); dispatchClick(button);
  };
  const assertClipboardCount = count => assert(app.querySelectorAll('.layer-row[data-layer-id]').length === count,
    `layer clipboard action expected ${count} layers, got ${app.querySelectorAll('.layer-row[data-layer-id]').length}`);

  selectClipboardLayer(originalClipboardIds[0]);
  dispatchClick(app.querySelector('#file-menu-button'));
  for (const label of ['Copy selected layers', 'Cut selected layers', 'Paste layers', 'Duplicate selected layers']) {
    assert([...app.querySelectorAll('#context-menu button')].some(button => button.textContent.trim().startsWith(label)), `the visible editor menu omitted ${label}`);
  }
  openClipboardMenu(originalClipboardIds[0]);
  for (const label of ['Copy layers', 'Cut layers', 'Paste layers', 'Duplicate']) {
    assert([...app.querySelectorAll('#context-menu button')].some(button => button.textContent.trim().startsWith(label)), `layer context menu omitted ${label}`);
  }
  clickClipboardMenuAction('Copy layers', { startsWith: true });
  openClipboardMenu(originalClipboardIds[0]);
  clickClipboardMenuAction('Paste layers', { startsWith: true });
  assertClipboardCount(4);
  let pastedClipboardRow = app.querySelector('.layer-row.is-selected[data-layer-id]');
  const contextPastedId = pastedClipboardRow?.dataset.layerId;
  assert(contextPastedId && !originalClipboardIds.includes(contextPastedId), 'context-menu paste did not create a fresh layer ID');
  await waitForSaveCycle(app, 'context-menu clipboard paste');
  let pastedRecords = await readStore('documents'); pastedRecords.sort((a, b) => b.savedAt - a.savedAt);
  let pastedImages = flattenNodes(pastedRecords[0]?.document?.pages?.find(page => page.id === pastedRecords[0]?.document?.activePageId)?.children).filter(node => node.type === 'image');
  assert(pastedImages.find(node => node.id === contextPastedId)?.assetId === clipboardImages[0].assetId,
    'copying an image duplicated its asset bytes or broke the original local asset reference');
  const assetsAfterCopy = new Set((await readStore('assets')).map(asset => asset.id));
  assert(assetsAfterCopy.size === assetIdsBeforeClipboard.size && [...assetIdsBeforeClipboard].every(id => assetsAfterCopy.has(id)),
    'copying an image wrote a duplicate local asset record');

  openClipboardMenu(contextPastedId);
  clickClipboardMenuAction('Duplicate', { startsWith: true });
  assertClipboardCount(5);
  dispatchShortcut(app, 'z'); assertClipboardCount(4);
  dispatchShortcut(app, 'z', { shift: true }); assertClipboardCount(5);
  dispatchShortcut(app, 'z'); assertClipboardCount(4);

  openClipboardMenu(originalClipboardIds[0]);
  clickClipboardMenuAction('Cut layers', { startsWith: true });
  assertClipboardCount(3);
  assert(!rowForLayer(originalClipboardIds[0]), 'context-menu cut left the source layer in the design');
  openClipboardMenu(contextPastedId);
  clickClipboardMenuAction('Paste layers', { startsWith: true });
  assertClipboardCount(4);
  pastedClipboardRow = app.querySelector('.layer-row.is-selected[data-layer-id]');
  const contextCutPastedId = pastedClipboardRow?.dataset.layerId;
  assert(contextCutPastedId && !originalClipboardIds.includes(contextCutPastedId), 'context-menu paste did not restore the cut layer as a fresh layer');
  dispatchShortcut(app, 'z'); assertClipboardCount(3);
  dispatchShortcut(app, 'z', { shift: true }); assertClipboardCount(4);

  selectClipboardLayer(contextCutPastedId);
  dispatchShortcut(app, 'c');
  dispatchShortcut(app, 'v');
  assertClipboardCount(5);
  const keyboardPastedId = app.querySelector('.layer-row.is-selected[data-layer-id]')?.dataset.layerId;
  assert(keyboardPastedId && keyboardPastedId !== contextCutPastedId, 'Ctrl+C/Ctrl+V did not paste a distinct layer');
  dispatchShortcut(app, 'd');
  assertClipboardCount(6);
  dispatchShortcut(app, 'z'); assertClipboardCount(5);
  dispatchShortcut(app, 'z', { shift: true }); assertClipboardCount(6);
  dispatchShortcut(app, 'z'); assertClipboardCount(5);

  selectClipboardLayer(contextCutPastedId);
  dispatchShortcut(app, 'x');
  assertClipboardCount(4);
  assert(!rowForLayer(contextCutPastedId), 'Ctrl+X did not remove the selected layer');
  dispatchShortcut(app, 'v');
  assertClipboardCount(5);
  const keyboardCutPastedId = app.querySelector('.layer-row.is-selected[data-layer-id]')?.dataset.layerId;
  assert(keyboardCutPastedId && keyboardCutPastedId !== contextCutPastedId, 'Ctrl+X/Ctrl+V did not move the cut layer through a fresh ID');
  dispatchShortcut(app, 'z'); assertClipboardCount(4);
  dispatchShortcut(app, 'z', { shift: true }); assertClipboardCount(5);

  // Return the fixture to its original three image layers before later editor assertions.
  for (let index = 0; index < 6; index += 1) dispatchShortcut(app, 'z');
  assertClipboardCount(3);
  await waitForSaveCycle(app, 'clipboard history restoration');
  const assetsAfterClipboard = new Set((await readStore('assets')).map(asset => asset.id));
  assert(assetsAfterClipboard.size === assetIdsBeforeClipboard.size && [...originalAssetIds].every(id => assetsAfterClipboard.has(id)),
    'clipboard edits changed the document asset catalog');
  const clipboardContract = { visibleCopyPaste: true, visibleCutPaste: true, visibleDuplicate: true, keyboardCopyCutPasteDuplicate: true,
    undoRedo: true, freshIds: true, sharedImageAssets: true, fixtureRestored: true };

  const fillCanvas = app.querySelector('#scene-canvas');
  const fillCanvasRect = fillCanvas.getBoundingClientRect();
  const fillStart = { x: fillCanvasRect.left + fillCanvasRect.width * .72, y: fillCanvasRect.top + fillCanvasRect.height * .68 };
  const fillEnd = { x: fillStart.x + 84, y: fillStart.y + 64 };
  app.querySelector('.tool-button[data-tool="rectangle"]').click();
  dispatchCanvasPointer(app, fillCanvas, 'pointerdown', fillStart.x, fillStart.y, 93);
  dispatchCanvasPointer(app, fillCanvas, 'pointermove', fillEnd.x, fillEnd.y, 93);
  dispatchCanvasPointer(app, fillCanvas, 'pointerup', fillEnd.x, fillEnd.y, 93);
  await waitFor(() => app.querySelectorAll('.layer-row[data-layer-id]').length === 4, 'image-fill test shape');
  const blendModeControl = app.querySelector('[data-prop="blendMode"]');
  assert(blendModeControl?.options.length === 16, 'the Inspector did not expose all 16 layer blend modes');
  blendModeControl.value = 'multiply';
  blendModeControl.dispatchEvent(new Event('input', { bubbles: true }));
  blendModeControl.dispatchEvent(new Event('change', { bubbles: true }));
  const fillType = app.querySelector('[data-prop="fillType"]');
  assert(fillType?.querySelector('option[value="image"]'), 'shape appearance did not offer image fills');
  fillType.value = 'image';
  fillType.dispatchEvent(new Event('input', { bubbles: true }));
  fillType.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('[data-image-fill-field="assetId"]'), 'image-fill source controls');
  const fillBrightness = app.querySelector('[data-image-fill-field="adjustments.brightness"]');
  assert(fillBrightness, 'image fills did not expose local WASM adjustments');
  const desktopFrameSize = { width: frame.style.width, height: frame.style.height };
  frame.style.width = '390px'; frame.style.height = '844px';
  await new Promise(resolve => app.defaultView.requestAnimationFrame(resolve));
  const mobileFillSource = app.querySelector('.image-fill-source');
  const mobileFillSourceStyle = app.defaultView.getComputedStyle(mobileFillSource);
  assert(mobileFillSourceStyle.gridTemplateColumns.startsWith('78px') && mobileFillSource.querySelector('select').getBoundingClientRect().height >= 38,
    'image-fill Inspector controls did not fit phone width with a touch-sized source selector');
  frame.style.width = desktopFrameSize.width; frame.style.height = desktopFrameSize.height;
  await new Promise(resolve => app.defaultView.requestAnimationFrame(resolve));
  fillBrightness.value = '-18';
  fillBrightness.dispatchEvent(new Event('input', { bubbles: true }));
  fillBrightness.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#image-fill-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'image-fill WASM preview');
  const fillCropLeft = app.querySelector('[data-image-transform-field="left"][data-image-transform-target="fill"]');
  assert(fillCropLeft, 'image fills did not expose local crop controls');
  fillCropLeft.value = '20';
  fillCropLeft.dispatchEvent(new Event('input', { bubbles: true }));
  fillCropLeft.dispatchEvent(new Event('change', { bubbles: true }));
  const fillRotateRight = app.querySelector('[data-action="rotate-image"][data-direction="right"][data-transform-target="fill"]');
  assert(fillRotateRight, 'image fills did not expose quarter-turn controls');
  dispatchClick(fillRotateRight);
  await waitFor(() => app.querySelector('#image-fill-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'image-fill crop and rotation preview');
  await waitForSaveCycle(app, 'image-fill save');

  const documentRecords = await readStore('documents'); documentRecords.sort((a, b) => b.savedAt - a.savedAt);
  const current = documentRecords[0]?.document;
  assert(current?.recipes.some(item => item.name === 'Local red recipe'), 'the saved recipe was not persisted with the design');
  const imageFillNode = current.pages.flatMap(page => flattenNodes(page.children)).find(node => node.imageFill);
  assert(imageFillNode?.imageFill.adjustments.brightness === -18
    && imageFillNode?.imageFill.transforms?.crop?.left === 0.2
    && imageFillNode?.imageFill.transforms?.rotation === 90, 'the image fill adjustments, crop, and rotation were not saved with the layer');
  assert(imageFillNode.blendMode === 'multiply', 'the layer blend mode was not saved with the design');
  const assetRecords = await readStore('assets');
  assert(assetRecords.some(asset => asset.id === imageFillNode.imageFill.assetId), 'the portable package did not retain the image-fill source bytes');
  const packaged = buildPackage(current, assetRecords);
  const openInput = app.querySelector('#open-file-input'); const fileTransfer = new DataTransfer();
  fileTransfer.items.add(new File([packaged], 'local-design-roundtrip.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(openInput, 'files', { configurable: true, value: fileTransfer.files });
  openInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(item => item.textContent.includes('Local design opened')), 'portable design import');
  await waitFor(() => app.querySelectorAll('.layer-row').length === 4 && app.querySelectorAll('#assets-list .asset-card').length === 3, 'portable image-layer restore');
  const restoredFillRow = app.querySelector(`[data-layer-id="${imageFillNode.id}"]`);
  assert(restoredFillRow, 'the portable design did not restore its image-filled layer');
  dispatchClick(restoredFillRow);
  assert(app.querySelector('[data-prop="blendMode"]')?.value === 'multiply', 'the portable design did not restore the selected blend mode');
  await waitFor(() => app.querySelector('[data-image-fill-field="assetId"]'), 'reopened image-fill controls');
  await waitFor(() => app.querySelector('#image-fill-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'reopened image-fill preview');
  dispatchContextMenu(app.querySelector(`[data-layer-id="${imageFillNode.id}"]`));
  const deleteFillItem = [...app.querySelectorAll('#context-menu button')].find(item => item.textContent.trim().startsWith('Delete'));
  assert(deleteFillItem, 'the restored image-fill layer could not be selected for cleanup');
  dispatchClick(deleteFillItem);
  await waitFor(() => app.querySelectorAll('.layer-row').length === 3, 'image-fill fixture cleanup');

  const designCanvas = app.querySelector('#scene-canvas');
  const canvasRect = designCanvas.getBoundingClientRect();
  const panCenter = { x: designCanvas.clientWidth / 2, y: designCanvas.clientHeight / 2 };
  app.querySelector('.tool-button[data-tool="frame"]').click();
  dispatchCanvasPointer(app, designCanvas, 'pointerdown', canvasRect.left + panCenter.x, canvasRect.top + panCenter.y, 81);
  dispatchCanvasPointer(app, designCanvas, 'pointerup', canvasRect.left + panCenter.x, canvasRect.top + panCenter.y, 81);
  await waitFor(() => app.querySelectorAll('.layer-row').length === 4, 'first prototype frame');
  dispatchCanvasPointer(app, designCanvas, 'pointerdown', canvasRect.left + panCenter.x + 550, canvasRect.top + panCenter.y, 82);
  dispatchCanvasPointer(app, designCanvas, 'pointerup', canvasRect.left + panCenter.x + 550, canvasRect.top + panCenter.y, 82);
  await waitFor(() => app.querySelectorAll('.layer-row').length === 5, 'second prototype frame');
  await new Promise(resolve => setTimeout(resolve, 350));
  const afterFrames = await readStore('documents'); afterFrames.sort((a, b) => b.savedAt - a.savedAt);
  const frameDocument = afterFrames[0]?.document;
  const frameNodes = frameDocument?.pages[0]?.children.filter(node => node.type === 'frame') || [];
  assert(frameNodes.length === 2, 'created prototype frames were not saved with the document');
  const sourceFrame = frameNodes[0]; const destinationFrame = frameNodes[1];
  const sourceRow = app.querySelector(`[data-layer-id="${sourceFrame.id}"]`);
  assert(sourceRow, 'the source frame was not available in the Layers panel');
  dispatchClick(sourceRow);
  dispatchClick(app.querySelector('.inspector-tab[data-inspector-tab="prototype"]'));
  const setStart = [...app.querySelectorAll('[data-action="prototype-start"]')].find(Boolean);
  assert(setStart, 'Prototype did not offer a frame starting point');
  dispatchClick(setStart);
  assert(app.querySelector('[data-action="prototype-start"]')?.textContent.includes('Starting point'), 'prototype start point was not stored');
  const transition = app.querySelector('#prototype-transition');
  assert([...transition.options].some(option => option.value === 'smart-animate'), 'frame navigation did not offer Smart animate');
  transition.value = 'smart-animate'; transition.dispatchEvent(new Event('change', { bubbles: true }));
  const easing = app.querySelector('#prototype-easing');
  assert(easing && [...easing.options].some(option => option.value === 'ease-out'), 'transition easing options were not available');
  easing.value = 'ease-out'; easing.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchClick(app.querySelector('[data-action="prototype-connect"]'));
  const targetX = canvasRect.left + panCenter.x + 550;
  const targetY = canvasRect.top + panCenter.y;
  dispatchCanvasPointer(app, designCanvas, 'pointerdown', targetX, targetY, 83);
  dispatchCanvasPointer(app, designCanvas, 'pointerup', targetX, targetY, 83);
  await waitFor(() => app.querySelector('.prototype-interaction-row')?.textContent.includes(destinationFrame.name), 'frame interaction connection');
  assert(app.querySelector('.prototype-interaction-row')?.textContent.includes('ease-out'), 'the saved interaction did not display its chosen easing');
  await waitForSaveCycle(app, 'prototype easing');
  const easingRecords = await readStore('documents'); easingRecords.sort((a, b) => b.savedAt - a.savedAt);
  const persistedSourceFrame = easingRecords[0]?.document?.pages[0]?.children.find(node => node.id === sourceFrame.id);
  assert(persistedSourceFrame?.interactions?.[0]?.easing === 'ease-out', 'the transition easing was not persisted with the local design');

  dispatchClick(app.querySelector('.tool-button[data-tool="frame"]'));
  const overlayX = canvasRect.left + panCenter.x - 550;
  const overlayY = canvasRect.top + panCenter.y;
  dispatchCanvasPointer(app, designCanvas, 'pointerdown', overlayX, overlayY, 84);
  dispatchCanvasPointer(app, designCanvas, 'pointerup', overlayX, overlayY, 84);
  await waitFor(() => app.querySelectorAll('.layer-row').length === 6, 'prototype overlay frame');
  await new Promise(resolve => setTimeout(resolve, 350));
  const overlayRecords = await readStore('documents'); overlayRecords.sort((a, b) => b.savedAt - a.savedAt);
  const overlayDocument = overlayRecords[0]?.document;
  const overlayFrame = overlayDocument?.pages[0]?.children.find(node => node.type === 'frame' && node.id !== sourceFrame.id && node.id !== destinationFrame.id);
  assert(overlayFrame, 'the overlay destination frame was not saved');

  dispatchClick(app.querySelector(`[data-layer-id="${destinationFrame.id}"]`));
  let actionSelect = app.querySelector('#prototype-action');
  actionSelect.value = 'open-overlay'; actionSelect.dispatchEvent(new Event('change', { bubbles: true }));
  assert(app.querySelector('#prototype-transition').value === 'dissolve' && ![...app.querySelectorAll('#prototype-transition option')].some(option => option.value === 'smart-animate'), 'overlay interactions should use their own transition and exclude Smart animate');
  const overlayPosition = app.querySelector('#prototype-overlay-position');
  overlayPosition.value = 'center'; overlayPosition.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchClick(app.querySelector('[data-action="prototype-connect"]'));
  dispatchCanvasPointer(app, designCanvas, 'pointerdown', overlayX, overlayY, 85);
  dispatchCanvasPointer(app, designCanvas, 'pointerup', overlayX, overlayY, 85);
  await waitFor(() => app.querySelector('.prototype-interaction-row')?.textContent.includes('Open overlay'), 'prototype overlay connection');

  dispatchClick(app.querySelector(`[data-layer-id="${destinationFrame.id}"]`));
  actionSelect = app.querySelector('#prototype-action');
  actionSelect.value = 'swap-overlay'; actionSelect.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchClick(app.querySelector('[data-action="prototype-connect"]'));
  dispatchCanvasPointer(app, designCanvas, 'pointerdown', overlayX, overlayY, 86);
  dispatchCanvasPointer(app, designCanvas, 'pointerup', overlayX, overlayY, 86);
  await waitFor(() => [...app.querySelectorAll('.prototype-interaction-row')].some(row => row.textContent.includes('Swap overlay') && row.textContent.includes(overlayFrame.name)), 'prototype swap overlay connection');

  dispatchClick(app.querySelector(`[data-layer-id="${overlayFrame.id}"]`));
  actionSelect = app.querySelector('#prototype-action');
  actionSelect.value = 'close-overlay'; actionSelect.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchClick(app.querySelector('[data-action="prototype-connect"]'));
  await waitFor(() => app.querySelector('.prototype-interaction-row')?.textContent.includes('Close overlay'), 'close overlay interaction');
  actionSelect = app.querySelector('#prototype-action');
  actionSelect.value = 'back'; actionSelect.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchClick(app.querySelector('[data-action="prototype-connect"]'));
  await waitFor(() => [...app.querySelectorAll('.prototype-interaction-row')].some(row => row.textContent.includes('Back') && row.textContent.includes('Previous screen')), 'back interaction');
  actionSelect = app.querySelector('#prototype-action');
  actionSelect.value = 'open-link'; actionSelect.dispatchEvent(new Event('change', { bubbles: true }));
  const linkInput = app.querySelector('#prototype-url');
  assert(linkInput, 'Open Link did not expose a URL input');
  linkInput.value = 'https://example.com/help?from=smoke'; linkInput.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchClick(app.querySelector('[data-action="prototype-connect"]'));
  await waitFor(() => [...app.querySelectorAll('.prototype-interaction-row')].some(row => row.textContent.includes('example.com/help?from=smoke')), 'safe Open Link interaction');
  await waitForSaveCycle(app, 'prototype action persistence');

  app.defaultView.prompt = () => 'Smoke white';
  dispatchClick(app.querySelector('.inspector-tab[data-inspector-tab="design"]'));
  dispatchClick(app.querySelector('[data-action="create-color-style"]'));
  await waitFor(() => app.querySelector('#color-styles-list [data-color-style-id]'), 'shared color style creation');
  const colorStyleId = app.querySelector('#color-styles-list [data-color-style-id]').dataset.colorStyleId;
  const destinationRow = app.querySelector(`[data-layer-id="${destinationFrame.id}"]`);
  assert(destinationRow, 'the destination frame was not available for shared styling');
  dispatchContextMenu(destinationRow);
  const applyColorStyle = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim() === 'Smoke white');
  assert(applyColorStyle, 'the layer context menu did not expose shared color styles');
  dispatchClick(applyColorStyle);
  await new Promise(resolve => setTimeout(resolve, 350));
  const styledRecords = await readStore('documents'); styledRecords.sort((a, b) => b.savedAt - a.savedAt);
  const styledDocument = styledRecords[0]?.document;
  const styledNodes = flattenNodes(styledDocument?.pages.flatMap(page => page.children));
  assert(styledDocument?.colorStyles.some(style => style.id === colorStyleId), 'the shared color style did not persist');
  assert(styledNodes.find(node => node.id === destinationFrame.id)?.fillStyleId === colorStyleId, 'the shared color style was not applied to the destination frame');

  let componentPrompt = 0;
  app.defaultView.prompt = (message, initial = '') => message === 'Component name'
    ? ['Smoke button / State=Default', 'Smoke button / State=Hover'][componentPrompt++] || initial
    : initial;
  const mainFrameRow = app.querySelector(`[data-layer-id="${destinationFrame.id}"]`);
  // Create a nested component target inside the frame that will become the
  // main component so the slot control exercises the full authoring flow.
  const sceneCanvas = app.querySelector('#scene-canvas');
  const canvasPan = { zoom: 1, panX: sceneCanvas.clientWidth / 2, panY: sceneCanvas.clientHeight / 2 };
  const slotStart = worldToScreen({ x: destinationFrame.x + destinationFrame.width / 2 - 22, y: destinationFrame.y + destinationFrame.height / 2 - 22 }, sceneCanvas, canvasPan);
  const slotEnd = worldToScreen({ x: destinationFrame.x + destinationFrame.width / 2 + 22, y: destinationFrame.y + destinationFrame.height / 2 + 22 }, sceneCanvas, canvasPan);
  dispatchClick(app.querySelector('.tool-button[data-tool="frame"]'));
  dispatchCanvasPointer(app, sceneCanvas, 'pointerdown', slotStart.x, slotStart.y, 91);
  dispatchCanvasPointer(app, sceneCanvas, 'pointermove', slotEnd.x, slotEnd.y, 91);
  dispatchCanvasPointer(app, sceneCanvas, 'pointerup', slotEnd.x, slotEnd.y, 91);
  await waitFor(() => app.querySelector('.layer-row.is-selected[data-layer-id]'), 'nested component slot frame creation');
  const nestedSlotId = app.querySelector('.layer-row.is-selected[data-layer-id]').dataset.layerId;
  const refreshedMainFrameRow = app.querySelector(`[data-layer-id="${destinationFrame.id}"]`);
  assert(refreshedMainFrameRow, 'the main component frame disappeared after creating a nested frame');
  dispatchClick(refreshedMainFrameRow);
  dispatchClick(app.querySelector('[data-action="create-component"]'));
  await waitFor(() => app.querySelector('#components-list [data-component-id]'), 'component creation and asset listing');
  const componentId = app.querySelector('#components-list [data-component-id]').dataset.componentId;
  const componentPropertyName = app.querySelector('#component-property-name');
  const componentPropertyButton = app.querySelector('[data-action="create-component-property"]');
  assert(componentPropertyName && componentPropertyButton, 'main components did not expose typed property creation controls');
  componentPropertyName.value = 'Enabled';
  dispatchClick(componentPropertyButton);
  await waitFor(() => app.querySelector('.component-property-definition')?.textContent.includes('Enabled') || app.querySelector('#toast-region .toast'), 'BOOLEAN component property creation or error');
  assert(app.querySelector('.component-property-definition')?.textContent.includes('Enabled'), `BOOLEAN component property creation failed: ${app.querySelector('#toast-region .toast')?.textContent || 'the Inspector did not refresh'}`);
  await waitForSaveCycle(app, 'BOOLEAN component property definition');
  const slotTarget = app.querySelector('#component-property-target');
  assert([...slotTarget.options].some(option => option.value === nestedSlotId), 'the main component property target list omitted its nested frame');
  slotTarget.value = nestedSlotId; slotTarget.dispatchEvent(new Event('change', { bubbles: true }));
  const slotType = app.querySelector('#component-property-type');
  assert([...slotType.options].some(option => option.value === 'SLOT'), 'a nested frame did not offer a content slot property');
  slotType.value = 'SLOT'; slotType.dispatchEvent(new Event('change', { bubbles: true }));
  const slotPropertyName = app.querySelector('#component-property-name');
  slotPropertyName.value = 'Content';
  dispatchClick(app.querySelector('[data-action="create-component-property"]'));
  await waitFor(() => [...app.querySelectorAll('.component-property-definition')].some(item => item.querySelector('strong')?.textContent === 'Content' && item.querySelector('small')?.textContent.includes('Flexible slot')),
    'content slot property creation');
  await waitForSaveCycle(app, 'content slot property definition');
  let definitionRecords = await readStore('documents'); definitionRecords.sort((a, b) => b.savedAt - a.savedAt);
  const componentPropertyId = definitionRecords[0]?.document?.components?.find(component => component.id === componentId)?.componentProperties?.find(property => property.name === 'Enabled')?.id;
  assert(componentPropertyId, 'the BOOLEAN component property definition was not persisted');
  const slotPropertyId = definitionRecords[0]?.document?.components?.find(component => component.id === componentId)?.componentProperties?.find(property => property.name === 'Content')?.id;
  assert(slotPropertyId, 'the SLOT component property definition was not persisted');
  const instanceButton = app.querySelector('[data-action="create-component-instance"]');
  assert(instanceButton?.dataset.componentId === componentId, 'component inspector did not expose instance creation');
  dispatchClick(instanceButton);
  await waitFor(() => app.querySelector('.layer-row.is-selected[data-layer-id]')
    && app.querySelector(`[data-action="choose-component-slot-content"][data-property-id="${slotPropertyId}"]`), 'component instance creation');
  const instanceRow = app.querySelector('.layer-row.is-selected[data-layer-id]');
  const instanceId = instanceRow?.dataset.layerId;
  assert(instanceId && instanceId !== destinationFrame.id, 'the component instance has no independent layer identity');
  const chooseSlot = app.querySelector(`[data-action="choose-component-slot-content"][data-instance-id="${instanceId}"][data-property-id="${slotPropertyId}"]`);
  assert(chooseSlot, 'the linked component Inspector did not expose the slot picker');
  dispatchClick(chooseSlot);
  const slotDialog = app.querySelector('#component-slot-dialog');
  assert(slotDialog.open, 'the component slot picker did not open');
  const sourceLayerId = originalClipboardIds[0];
  const sourceLayerName = clipboardImages.find(node => node.id === sourceLayerId)?.name;
  assert(sourceLayerName, 'the slot picker test could not resolve the original source layer name');
  const slotSearch = app.querySelector('#component-slot-search');
  slotSearch.value = sourceLayerName; slotSearch.dispatchEvent(new Event('input', { bubbles: true }));
  let slotCandidate = app.querySelector(`[data-slot-candidate="${sourceLayerId}"]`);
  assert(slotCandidate, 'the slot picker search did not find an existing page layer');
  const desktopEditorSize = { width: frame.style.width, height: frame.style.height };
  frame.style.width = '390px'; frame.style.height = '844px';
  await new Promise(resolve => app.defaultView.requestAnimationFrame(() => app.defaultView.requestAnimationFrame(resolve)));
  const mobileSlotRow = slotCandidate.closest('.slot-picker-row');
  const mobileSlotApply = app.querySelector('#component-slot-form [value="apply"]');
  assert(mobileSlotRow.getBoundingClientRect().height >= 44 && mobileSlotApply.getBoundingClientRect().height >= 44,
    'component slot choices and apply controls must remain touch-sized on a phone');
  frame.style.width = desktopEditorSize.width; frame.style.height = desktopEditorSize.height;
  await new Promise(resolve => app.defaultView.requestAnimationFrame(resolve));
  dispatchClick(app.querySelector('#component-slot-form [value="cancel"]'));
  await waitFor(() => !slotDialog.open, 'component slot picker cancel');
  assert(!app.querySelector(`[data-action="reset-component-slot"][data-instance-id="${instanceId}"][data-property-id="${slotPropertyId}"]`),
    'canceling the slot picker changed the component instance');
  dispatchClick(app.querySelector(`[data-action="choose-component-slot-content"][data-instance-id="${instanceId}"][data-property-id="${slotPropertyId}"]`));
  await waitFor(() => slotDialog.open, 'reopen component slot picker after cancel');
  slotSearch.value = sourceLayerName; slotSearch.dispatchEvent(new Event('input', { bubbles: true }));
  slotCandidate = app.querySelector(`[data-slot-candidate="${sourceLayerId}"]`);
  assert(slotCandidate, 'reopened slot picker did not retain searchable current-page layers');
  slotCandidate.checked = true; slotCandidate.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchClick(app.querySelector('#component-slot-form [value="apply"]'));
  await waitFor(() => !slotDialog.open, 'component slot picker apply');
  await waitForSaveCycle(app, 'component slot content copy');
  let slotRecords = await readStore('documents'); slotRecords.sort((a, b) => b.savedAt - a.savedAt);
  let slotDocument = slotRecords[0]?.document;
  let slotNodes = flattenNodes(slotDocument?.pages.flatMap(page => page.children));
  const slotInstance = slotNodes.find(node => node.id === instanceId);
  const installedSlotContentId = slotInstance?.componentPropertyValues?.[slotPropertyId]?.[0];
  const slotHost = flattenNodes([slotInstance]).find(node => node.componentSourceId === nestedSlotId);
  assert(installedSlotContentId && installedSlotContentId !== sourceLayerId && slotHost?.children?.some(node => node.id === installedSlotContentId),
    'the slot picker did not copy selected page content into the instance slot with a fresh ID');
  assert(slotNodes.some(node => node.id === sourceLayerId), 'applying component slot content removed its original layer');
  const resetSlot = app.querySelector(`[data-action="reset-component-slot"][data-instance-id="${instanceId}"][data-property-id="${slotPropertyId}"]`);
  assert(resetSlot, 'the slot Inspector did not expose reset-to-default');
  dispatchClick(resetSlot);
  await waitForSaveCycle(app, 'component slot reset');
  slotRecords = await readStore('documents'); slotRecords.sort((a, b) => b.savedAt - a.savedAt);
  slotDocument = slotRecords[0]?.document;
  slotNodes = flattenNodes(slotDocument?.pages.flatMap(page => page.children));
  assert(!slotNodes.find(node => node.id === instanceId)?.componentPropertyValues?.[slotPropertyId], 'resetting a component slot left its custom content override attached');
  const componentPropertyCheckbox = app.querySelector(`[data-instance-id="${instanceId}"][data-component-property-value="${componentPropertyId}"]`);
  assert(componentPropertyCheckbox?.checked, 'the Boolean property did not initialize to the component default');
  componentPropertyCheckbox.checked = false; componentPropertyCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'Boolean component property override');
  let propertyRecords = await readStore('documents'); propertyRecords.sort((a, b) => b.savedAt - a.savedAt);
  let propertyDocument = propertyRecords[0]?.document;
  let propertyNodes = flattenNodes(propertyDocument?.pages.flatMap(page => page.children));
  const savedPropertyInstance = propertyNodes.find(node => node.id === instanceId);
  assert(savedPropertyInstance?.visible === false && savedPropertyInstance.componentPropertyValues?.[componentPropertyId] === false,
    'changing the Boolean property did not project and persist the instance visibility');
  assert(propertyNodes.find(node => node.id === destinationFrame.id)?.visible === true,
    'changing an instance property modified the main component');
  const resetComponentProperty = app.querySelector(`[data-instance-id="${instanceId}"][data-component-property-value="${componentPropertyId}"]`);
  resetComponentProperty.checked = true; resetComponentProperty.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'Boolean component property reset');

  dispatchClick(app.querySelector(`[data-layer-id="${destinationFrame.id}"]`));
  const mainWidth = app.querySelector('[data-prop="width"]');
  mainWidth.value = '320'; mainWidth.dispatchEvent(new Event('input', { bubbles: true })); mainWidth.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 600));
  let componentRecords = await readStore('documents'); componentRecords.sort((a, b) => b.savedAt - a.savedAt);
  let componentDocument = componentRecords[0]?.document;
  let componentNodes = flattenNodes(componentDocument?.pages.flatMap(page => page.children));
  assert(componentNodes.find(node => node.id === instanceId)?.width === 320, 'main component edit did not propagate to its instance');

  dispatchClick(app.querySelector(`[data-layer-id="${instanceId}"]`));
  const overrideWidth = app.querySelector('[data-prop="width"]');
  overrideWidth.value = '240'; overrideWidth.dispatchEvent(new Event('input', { bubbles: true })); overrideWidth.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 600));
  componentRecords = await readStore('documents'); componentRecords.sort((a, b) => b.savedAt - a.savedAt);
  componentDocument = componentRecords[0]?.document;
  componentNodes = flattenNodes(componentDocument?.pages.flatMap(page => page.children));
  assert(componentNodes.find(node => node.id === instanceId)?.width === 240, 'the local instance size override was not saved');

  dispatchClick(app.querySelector(`[data-layer-id="${destinationFrame.id}"]`));
  const nextMainWidth = app.querySelector('[data-prop="width"]');
  nextMainWidth.value = '360'; nextMainWidth.dispatchEvent(new Event('input', { bubbles: true })); nextMainWidth.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 600));
  componentRecords = await readStore('documents'); componentRecords.sort((a, b) => b.savedAt - a.savedAt);
  componentDocument = componentRecords[0]?.document;
  componentNodes = flattenNodes(componentDocument?.pages.flatMap(page => page.children));
  assert(componentNodes.find(node => node.id === instanceId)?.width === 240, 'a main edit replaced the local instance override');

  dispatchClick(app.querySelector(`[data-layer-id="${instanceId}"]`));
  dispatchClick(app.querySelector('[data-action="detach-component-instance"]'));
  dispatchClick(app.querySelector(`[data-layer-id="${destinationFrame.id}"]`));
  const finalMainWidth = app.querySelector('[data-prop="width"]');
  finalMainWidth.value = '400'; finalMainWidth.dispatchEvent(new Event('input', { bubbles: true })); finalMainWidth.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 600));
  componentRecords = await readStore('documents'); componentRecords.sort((a, b) => b.savedAt - a.savedAt);
  componentDocument = componentRecords[0]?.document;
  componentNodes = flattenNodes(componentDocument?.pages.flatMap(page => page.children));
  const detachedInstance = componentNodes.find(node => node.id === instanceId);
  assert(detachedInstance?.width === 240 && !detachedInstance.isInstance, 'detached component instance changed with its former main component');
  assert(componentDocument?.components?.some(component => component.id === componentId), 'component metadata was not saved locally');

  dispatchClick(app.querySelector(`[data-layer-id="${sourceFrame.id}"]`));
  dispatchClick(app.querySelector('[data-action="create-component"]'));
  await waitFor(() => [...app.querySelectorAll('#components-list [data-component-id]')].some(card => card.title.includes('State=Hover')), 'second variant creation');
  const hoverComponentCard = [...app.querySelectorAll('#components-list [data-component-id]')].find(card => card.title.includes('State=Hover'));
  const hoverComponentId = hoverComponentCard.dataset.componentId;
  dispatchClick(app.querySelector(`[data-layer-id="${destinationFrame.id}"]`));
  dispatchClick(app.querySelector(`[data-layer-id="${sourceFrame.id}"]`), { ctrlKey: true });
  dispatchContextMenu(app.querySelector(`[data-layer-id="${sourceFrame.id}"]`));
  const combineVariants = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Combine 2 as variants'));
  assert(combineVariants, 'the context menu did not offer to combine selected main components as variants');
  dispatchClick(combineVariants);
  await waitFor(() => app.querySelector('#components-list [data-component-set-id]'), 'component set creation');
  const componentSetCard = app.querySelector('#components-list [data-component-set-id]');
  dispatchClick(componentSetCard);
  await waitFor(() => app.querySelector('[data-variant-property="State"]'), 'variant set instance creation');
  const variantInstanceRow = app.querySelector('.layer-row.is-selected[data-layer-id]');
  const variantInstanceId = variantInstanceRow?.dataset.layerId;
  const variantSelect = app.querySelector('[data-variant-property="State"]');
  assert(variantInstanceId && variantSelect, 'component instance inspector did not expose variant properties');
  variantSelect.value = 'Hover'; variantSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 600));
  componentRecords = await readStore('documents'); componentRecords.sort((a, b) => b.savedAt - a.savedAt);
  componentDocument = componentRecords[0]?.document;
  componentNodes = flattenNodes(componentDocument?.pages.flatMap(page => page.children));
  assert(componentDocument?.componentSets?.some(set => set.componentIds.includes(hoverComponentId)), 'variant set metadata was not stored');
  assert(componentNodes.find(node => node.id === variantInstanceId)?.componentId === hoverComponentId, 'changing the instance variant did not switch its main component');

  dispatchClick(app.querySelector('#present-button'));
  await waitFor(() => app.querySelector('#present-dialog')?.open && app.querySelector('#present-title')?.textContent === sourceFrame.name, 'local prototype presentation');
  const presentCanvas = app.querySelector('#present-canvas');
  dispatchCanvasPointer(app, presentCanvas, 'pointerup', presentCanvas.getBoundingClientRect().left + presentCanvas.clientWidth / 2, presentCanvas.getBoundingClientRect().top + presentCanvas.clientHeight / 2, 84);
  await waitFor(() => !app.querySelector('#present-back')?.disabled, 'prototype navigation and history');
  await waitFor(() => app.querySelector('#present-dialog')?.dataset.frameId === destinationFrame.id, 'prototype destination frame');
  await waitFor(() => app.querySelector('#present-dialog')?.dataset.smartAnimating === 'true', 'Smart animate interpolation start');
  const smartProgress = Number(app.querySelector('#present-dialog').dataset.smartProgress);
  assert(smartProgress > 0 && smartProgress < 1, `Smart animate should render an intermediate scene, received ${smartProgress}`);
  await waitFor(() => app.querySelector('#present-dialog')?.dataset.smartAnimating !== 'true', 'Smart animate completion');
  dispatchCanvasPointer(app, presentCanvas, 'pointerup', presentCanvas.getBoundingClientRect().left + presentCanvas.clientWidth / 2, presentCanvas.getBoundingClientRect().top + presentCanvas.clientHeight / 2, 86);
  await waitFor(() => app.querySelector('#present-dialog')?.dataset.overlayDepth === '1', 'prototype overlay presentation');
  assert(app.querySelector('#present-dialog').dataset.frameId === destinationFrame.id, 'opening an overlay replaced the underlying frame');
  dispatchCanvasPointer(app, presentCanvas, 'pointerup', presentCanvas.getBoundingClientRect().left + presentCanvas.clientWidth / 2, presentCanvas.getBoundingClientRect().top + presentCanvas.clientHeight / 2, 87);
  assert(!app.querySelector('#present-back').disabled, 'opening an overlay disabled presentation history');
  await waitFor(() => app.querySelector('#present-dialog')?.dataset.overlayDepth === '0', 'close overlay interaction');
  dispatchCanvasPointer(app, presentCanvas, 'pointerup', presentCanvas.getBoundingClientRect().left + presentCanvas.clientWidth / 2, presentCanvas.getBoundingClientRect().top + presentCanvas.clientHeight / 2, 89);
  await waitFor(() => app.querySelector('#present-dialog')?.dataset.overlayDepth === '1', 'overlay reopen for outside dismissal');
  dispatchCanvasPointer(app, presentCanvas, 'pointerup', presentCanvas.getBoundingClientRect().left + 2, presentCanvas.getBoundingClientRect().top + 2, 90);
  await waitFor(() => app.querySelector('#present-dialog')?.dataset.overlayDepth === '0', 'outside click overlay dismissal');
  dispatchClick(app.querySelector('#present-back'));
  assert(app.querySelector('#present-back').disabled, 'prototype back did not restore the start frame');
  assert(app.querySelector('#present-dialog').dataset.frameId === sourceFrame.id, 'prototype back did not restore the start frame');
  dispatchClick(app.querySelector('#present-exit'));
  await waitFor(() => !app.querySelector('#present-dialog').open, 'prototype presentation exit');

  const penButton = app.querySelector('.tool-button[data-tool="pen"]');
  const vectorIdsBeforePen = new Set([...app.querySelectorAll('.layer-row[data-layer-id]')]
    .filter(row => row.querySelector('.layer-name')?.textContent.trim() === 'Vector network').map(row => row.dataset.layerId));
  dispatchClick(penButton);
  const penScreenPoint = ({ x, y }) => ({ x: canvasRect.left + panCenter.x + x, y: canvasRect.top + panCenter.y + y });
  const penDownUp = (world, pointerId) => {
    const point = penScreenPoint(world);
    dispatchCanvasPointer(app, designCanvas, 'pointerdown', point.x, point.y, pointerId);
    dispatchCanvasPointer(app, designCanvas, 'pointerup', point.x, point.y, pointerId);
  };
  penDownUp({ x: -130, y: -140 }, 91);
  const curveAnchor = penScreenPoint({ x: -30, y: -45 });
  const curveControl = penScreenPoint({ x: -30, y: -95 });
  dispatchCanvasPointer(app, designCanvas, 'pointerdown', curveAnchor.x, curveAnchor.y, 92);
  dispatchCanvasPointer(app, designCanvas, 'pointermove', curveControl.x, curveControl.y, 92);
  dispatchCanvasPointer(app, designCanvas, 'pointerup', curveControl.x, curveControl.y, 92);
  penDownUp({ x: 100, y: -130 }, 93);
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
  await waitFor(() => {
    const row = app.querySelector('.layer-row.is-selected[data-layer-id]');
    return row?.querySelector('.layer-name')?.textContent.trim() === 'Vector network' && !vectorIdsBeforePen.has(row.dataset.layerId);
  }, 'multi-point Bézier vector network');
  await new Promise(resolve => setTimeout(resolve, 450));
  let vectorRecords = await readStore('documents'); vectorRecords.sort((a, b) => b.savedAt - a.savedAt);
  let vectorDocument = vectorRecords[0]?.document;
  let vectorNodes = flattenNodes(vectorDocument?.pages.flatMap(page => page.children));
  const selectedVectorRow = app.querySelector('.layer-row.is-selected[data-layer-id]');
  const vectorNode = vectorNodes.find(node => node.id === selectedVectorRow?.dataset.layerId);
  assert(vectorNode?.vertices.length === 3 && vectorNode.edges.length === 2 && (vectorNode.edges[0].control2 || vectorNode.edges[1].control1), 'pen tool did not create a graph-backed cubic vector network');
  const newlyAddedNetworks = vectorNodes.filter(node => node.type === 'network' && !vectorIdsBeforePen.has(node.id));
  assert(newlyAddedNetworks.filter(node => !node.componentSourceId).length === 1, 'one pen session must create one authored network; its linked component copies may add mirrored layers');

  dispatchClick(penButton);
  penDownUp({ x: -130, y: -140 }, 94);
  penDownUp({ x: -80, y: -210 }, 95);
  penDownUp({ x: 100, y: -130 }, 96);
  await waitFor(() => app.querySelector('#inspector-content')?.textContent.includes('4 edges'), 'shared-junction branch creation');
  await new Promise(resolve => setTimeout(resolve, 450));
  vectorRecords = await readStore('documents'); vectorRecords.sort((a, b) => b.savedAt - a.savedAt);
  vectorDocument = vectorRecords[0]?.document;
  let savedNetwork = flattenNodes(vectorDocument?.pages.flatMap(page => page.children)).find(node => node.id === vectorNode.id);
  assert(savedNetwork?.vertices.length === 4 && savedNetwork.edges.length === 4, 'branch path duplicated a shared junction instead of connecting the graph');

  dispatchClick(penButton);
  penDownUp({ x: -120, y: 110 }, 97);
  penDownUp({ x: -20, y: 110 }, 98);
  penDownUp({ x: -70, y: 190 }, 99);
  penDownUp({ x: -120, y: 110 }, 100);
  await waitFor(() => app.querySelector('#inspector-content')?.textContent.includes('1 closed regions'), 'closed network region creation');
  await new Promise(resolve => setTimeout(resolve, 450));
  vectorRecords = await readStore('documents'); vectorRecords.sort((a, b) => b.savedAt - a.savedAt);
  vectorDocument = vectorRecords[0]?.document;
  savedNetwork = flattenNodes(vectorDocument?.pages.flatMap(page => page.children)).find(node => node.id === vectorNode.id);
  assert(savedNetwork?.faces.length === 1 && savedNetwork.edges.length === 7, 'closed network region was not persisted as a face');
  const faceFillInput = app.querySelector('[data-network-face-fill]');
  const faceOpacityInput = app.querySelector('[data-network-face-opacity]');
  assert(faceFillInput && faceOpacityInput, 'closed vector regions did not expose independent fill controls');
  faceFillInput.value = '#e14a6d'; faceFillInput.dispatchEvent(new Event('input', { bubbles: true }));
  faceOpacityInput.value = '62'; faceOpacityInput.dispatchEvent(new Event('input', { bubbles: true }));
  faceFillInput.dispatchEvent(new Event('change', { bubbles: true }));
  faceOpacityInput.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 450));
  vectorRecords = await readStore('documents'); vectorRecords.sort((a, b) => b.savedAt - a.savedAt);
  vectorDocument = vectorRecords[0]?.document;
  savedNetwork = flattenNodes(vectorDocument?.pages.flatMap(page => page.children)).find(node => node.id === vectorNode.id);
  assert(savedNetwork.faces[0].fill === '#e14a6d' && savedNetwork.faces[0].fillOpacity === .62, 'region fill color and opacity did not autosave independently');
  const regionCanvas = document.createElement('canvas'); regionCanvas.width = 320; regionCanvas.height = 460;
  const regionContext = regionCanvas.getContext('2d');
  const regionRenderer = Object.create(SceneRenderer.prototype);
  regionRenderer.getState = () => ({ document: vectorDocument, assets: new Map(), previews: new Map(), zoom: 1 });
  const faceVertices = savedNetwork.faces[0].vertexIds.map(id => vectorNetworkVertexPoint(savedNetwork, id, { x: savedNetwork.x, y: savedNetwork.y }));
  const faceSample = faceVertices.reduce((point, vertex) => ({ x: point.x + vertex.x / faceVertices.length, y: point.y + vertex.y / faceVertices.length }), { x: 0, y: 0 });
  const regionOffset = { x: 40 - savedNetwork.x, y: 30 - savedNetwork.y };
  regionContext.translate(regionOffset.x, regionOffset.y);
  regionRenderer.drawNode(regionContext, savedNetwork, 0, 0, new Map());
  const regionPixel = [...regionContext.getImageData(Math.round(faceSample.x + regionOffset.x), Math.round(faceSample.y + regionOffset.y), 1, 1).data];
  assert(regionPixel[0] > 210 && regionPixel[1] > 60 && regionPixel[1] < 90 && regionPixel[2] > 95 && regionPixel[3] >= 150 && regionPixel[3] <= 165,
    `independent region color and opacity did not render over a transparent network fill (${regionPixel.join(',')})`);
  const regionMaskCanvas = document.createElement('canvas'); regionMaskCanvas.width = 320; regionMaskCanvas.height = 460;
  const regionMaskContext = regionMaskCanvas.getContext('2d');
  regionMaskContext.translate(regionOffset.x, regionOffset.y);
  regionRenderer.drawNode(regionMaskContext, savedNetwork, 0, 0, new Map(), false, true);
  const regionMaskPixel = [...regionMaskContext.getImageData(Math.round(faceSample.x + regionOffset.x), Math.round(faceSample.y + regionOffset.y), 1, 1).data];
  assert(regionMaskPixel[0] === 255 && regionMaskPixel[1] === 255 && regionMaskPixel[2] === 255 && regionMaskPixel[3] >= 150 && regionMaskPixel[3] <= 165,
    `vector region opacity was lost when used as an alpha mask (${regionMaskPixel.join(',')})`);

  const positionedVector = findNodeOrigin(vectorDocument.pages.flatMap(page => page.children), vectorNode.id);
  const editableEdge = positionedVector.node.edges.find(edge => edge.control1 || edge.control2);
  const editablePart = editableEdge.control1 ? 'control1' : 'control2';
  const editableControl = editableEdge[editablePart];
  const handleWorld = vectorNetworkEdgePoints(positionedVector.node, editableEdge.id, { x: positionedVector.x, y: positionedVector.y })[editablePart === 'control1' ? 1 : 2];
  const handleScreen = penScreenPoint(handleWorld);
  dispatchCanvasPointer(app, designCanvas, 'pointerdown', handleScreen.x, handleScreen.y, 101);
  dispatchCanvasPointer(app, designCanvas, 'pointermove', handleScreen.x + 18, handleScreen.y - 12, 101);
  dispatchCanvasPointer(app, designCanvas, 'pointerup', handleScreen.x + 18, handleScreen.y - 12, 101);
  await new Promise(resolve => setTimeout(resolve, 450));
  vectorRecords = await readStore('documents'); vectorRecords.sort((a, b) => b.savedAt - a.savedAt);
  vectorDocument = vectorRecords[0]?.document;
  let editedVector = flattenNodes(vectorDocument?.pages.flatMap(page => page.children)).find(node => node.id === vectorNode.id);
  assert(editedVector.edges.find(edge => edge.id === editableEdge.id)[editablePart].y !== editableControl.y, 'canvas Bézier handle editing did not update the network edge');

  const currentVector = findNodeOrigin(vectorDocument.pages.flatMap(page => page.children), vectorNode.id);
  const insertionWorld = (() => {
    const [p0, p1, p2, p3] = vectorNetworkEdgePoints(currentVector.node, currentVector.node.edges[0].id, { x: currentVector.x, y: currentVector.y });
    const t = .42; const inverse = 1 - t;
    return { x: inverse ** 3 * p0.x + 3 * inverse ** 2 * t * p1.x + 3 * inverse * t ** 2 * p2.x + t ** 3 * p3.x, y: inverse ** 3 * p0.y + 3 * inverse ** 2 * t * p1.y + 3 * inverse * t ** 2 * p2.y + t ** 3 * p3.y };
  })();
  const insertionScreen = penScreenPoint(insertionWorld);
  designCanvas.dispatchEvent(new app.defaultView.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: insertionScreen.x, clientY: insertionScreen.y }));
  await waitFor(() => app.querySelector('#inspector-content')?.textContent.includes('8 points'), 'double-click vector network point insertion');
  assert(app.querySelector('[data-action="delete-vector-point"]') && !app.querySelector('[data-action="delete-vector-point"]').disabled, 'inserted vector point was not selected for deletion');
  dispatchClick(app.querySelector('[data-action="delete-vector-point"]'));
  await waitFor(() => app.querySelector('#inspector-content')?.textContent.includes('7 points'), 'vector network point inspector deletion');
  dispatchClick(app.querySelector('[data-action="insert-vector-point"]'));
  await waitFor(() => app.querySelector('#inspector-content')?.textContent.includes('8 points'), 'touch-friendly vector network point insertion');
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' }));
  await waitFor(() => app.querySelector('#inspector-content')?.textContent.includes('7 points'), 'Backspace vector network point deletion');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'vector network edits autosave');
  vectorRecords = await readStore('documents'); vectorRecords.sort((a, b) => b.savedAt - a.savedAt);
  vectorDocument = vectorRecords[0]?.document;
  const savedEditedNetwork = flattenNodes(vectorDocument?.pages.flatMap(page => page.children)).find(node => node.id === vectorNode.id);
  assert(savedEditedNetwork?.vertices.length === 7 && savedEditedNetwork.edges.length === 7 && savedEditedNetwork.faces.length === 1
    && savedEditedNetwork.faces[0].fill === '#e14a6d' && savedEditedNetwork.faces[0].fillOpacity === .62, 'network editing did not preserve the branch, region paint, and closed region on disk');

  const variablesDocument = createDocument();
  const brandColors = createVariableCollection(variablesDocument, 'Brand colors');
  brandColors.modes[0].name = 'Light';
  const lightMode = brandColors.modes[0];
  const darkMode = addVariableMode(variablesDocument, brandColors.id, 'Dark');
  brandColors.defaultModeId = darkMode.id;
  const surfaceVariable = createColorVariable(variablesDocument, brandColors.id, 'Surface', '#f7f7f7');
  setColorVariableValue(variablesDocument, surfaceVariable.id, '#202124', darkMode.id);
  const cardWidthVariable = createVariable(variablesDocument, brandColors.id, 'Card width', 'number', 90);
  setVariableValue(variablesDocument, cardWidthVariable.id, 210, darkMode.id);
  const layoutGapVariable = createVariable(variablesDocument, brandColors.id, 'Layout gap', 'number', 8);
  setVariableValue(variablesDocument, layoutGapVariable.id, 24, darkMode.id);
  const themeFrame = createNode('frame', { name: 'Theme frame', width: 300, height: 210 });
  const nestedThemeFrame = createNode('frame', { name: 'Nested theme', x: 20, y: 20, width: 250, height: 160 });
  const themeModeTrigger = createNode('rectangle', { name: 'Switch to dark', x: 215, y: 150, width: 70, height: 42, fill: '#40444d' });
  const variableSurface = createNode('rectangle', { name: 'Variable surface', x: 12, y: 12, width: 150, height: 80, fillVariableId: surfaceVariable.id });
  const variableHeading = createNode('text', { name: 'Variable heading', x: 12, y: 108, width: 180, height: 32, text: 'Local variables', textVariableId: surfaceVariable.id });
  const typographyFrame = createNode('frame', { name: 'Typography styles', x: 340, y: 20, width: 220, height: 240 });
  const layoutFrame = createNode('frame', { name: 'Bound layout', x: 600, y: 20, width: 200, height: 100, autoLayout: createAutoLayout({ axis: 'horizontal', columnGap: 4, padding: 10 }) });
  const layoutFirst = createNode('rectangle', { name: 'Layout first', width: 20, height: 20 });
  const layoutSecond = createNode('rectangle', { name: 'Layout second', width: 20, height: 20 });
  layoutFrame.children.push(layoutFirst, layoutSecond);
  const typographySource = createNode('text', { name: 'Typography source', x: 12, y: 145, width: 180, height: 32, text: 'Source style' });
  const typographyTarget = createNode('text', { name: 'Typography target', x: 12, y: 180, width: 180, height: 32, text: 'First target' });
  const typographyUpdatedTarget = createNode('text', { name: 'Typography updated target', x: 12, y: 215, width: 180, height: 32, text: 'Updated target' });
  addNode(variablesDocument, themeFrame);
  addNode(variablesDocument, typographyFrame);
  addNode(variablesDocument, layoutFrame);
  addNode(variablesDocument, nestedThemeFrame, { parentId: themeFrame.id });
  addNode(variablesDocument, themeModeTrigger, { parentId: themeFrame.id });
  addNode(variablesDocument, variableSurface, { parentId: nestedThemeFrame.id });
  addNode(variablesDocument, variableHeading, { parentId: nestedThemeFrame.id });
  addNode(variablesDocument, typographySource, { parentId: typographyFrame.id });
  addNode(variablesDocument, typographyTarget, { parentId: typographyFrame.id });
  addNode(variablesDocument, typographyUpdatedTarget, { parentId: typographyFrame.id });
  const variablesInput = app.querySelector('#open-file-input'); const variablesTransfer = new DataTransfer();
  variablesTransfer.items.add(new File([buildPackage(variablesDocument, [])], 'variables-smoke.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(variablesInput, 'files', { configurable: true, value: variablesTransfer.files });
  variablesInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(item => item.textContent.includes('Local design opened')), 'variable collection fixture import');
  dispatchClick(app.querySelector(`[data-layer-id="${themeModeTrigger.id}"]`));
  dispatchClick(app.querySelector('.inspector-tab[data-inspector-tab="prototype"]'));
  const themeAction = app.querySelector('#prototype-action');
  themeAction.value = 'set-variable-mode'; themeAction.dispatchEvent(new Event('change', { bubbles: true }));
  const themeCollectionSelect = app.querySelector('#prototype-variable-collection');
  const themeModeSelect = app.querySelector('#prototype-variable-mode');
  assert(themeCollectionSelect && themeModeSelect && app.querySelector('#prototype-condition-variable'), 'prototype variable-mode and condition controls were not shown');
  themeCollectionSelect.value = brandColors.id; themeCollectionSelect.dispatchEvent(new Event('change', { bubbles: true }));
  assert(app.querySelector('#prototype-variable-mode').value === darkMode.id, 'prototype variable-mode control did not select the collection default mode');
  app.querySelector('#prototype-variable-mode').value = darkMode.id;
  app.querySelector('#prototype-variable-mode').dispatchEvent(new Event('change', { bubbles: true }));
  const conditionVariableSelect = app.querySelector('#prototype-condition-variable');
  conditionVariableSelect.value = surfaceVariable.id; conditionVariableSelect.dispatchEvent(new Event('change', { bubbles: true }));
  assert(app.querySelector('#prototype-condition-operator')?.value === 'equals', 'a variable condition should default to equality');
  assert(app.querySelector('#prototype-condition-value')?.value.toLowerCase() === '#202124', 'a color condition should preload the selected variable’s current value');
  dispatchClick(app.querySelector('[data-action="prototype-connect"]'));
  await waitFor(() => app.querySelector('.prototype-interaction-row')?.textContent.includes('Dark · Brand colors') && app.querySelector('.prototype-interaction-row')?.textContent.includes('If Surface is #202124'), 'conditional prototype variable-mode interaction');
  await waitForSaveCycle(app, 'prototype variable-mode persistence');
  let themeModeRecords = await readStore('documents'); themeModeRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedThemeModeDocument = themeModeRecords[0]?.document;
  const savedThemeModeTrigger = flattenNodes(savedThemeModeDocument.pages.flatMap(page => page.children)).find(node => node.id === themeModeTrigger.id);
  assert(savedThemeModeTrigger?.interactions?.some(item => item.action === 'set-variable-mode' && item.collectionId === brandColors.id && item.modeId === darkMode.id
    && item.condition?.variableId === surfaceVariable.id && item.condition.type === 'color' && item.condition.operator === 'equals' && item.condition.value === '#202124'), 'prototype condition was not serialized with its mode action');
  const numericConditionVariable = app.querySelector('#prototype-condition-variable');
  numericConditionVariable.value = cardWidthVariable.id; numericConditionVariable.dispatchEvent(new Event('change', { bubbles: true }));
  const numericConditionValue = app.querySelector('#prototype-condition-value');
  numericConditionValue.value = ''; numericConditionValue.dispatchEvent(new Event('input', { bubbles: true }));
  numericConditionValue.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchClick(app.querySelector('[data-action="prototype-connect"]'));
  assert(app.querySelectorAll('.prototype-interaction-row').length === 1, 'an empty numeric condition must not silently become zero and add another interaction');
  assert([...app.querySelectorAll('#toast-region .toast')].some(item => item.textContent.includes('Enter a valid number')), 'an empty numeric condition should show a validation message');
  const clearCondition = app.querySelector('#prototype-condition-variable');
  clearCondition.value = ''; clearCondition.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchClick(app.querySelector('[data-sidebar-tab="assets"]'));
  const themeDefaultModeControl = app.querySelector(`[data-variable-default-mode="${brandColors.id}"]`);
  themeDefaultModeControl.value = lightMode.id; themeDefaultModeControl.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'restore light default mode after prototype mode check');
  dispatchClick(app.querySelector(`.variable-mode-add[data-collection-id="${brandColors.id}"]`));
  assert(app.querySelector('#variable-dialog').open, 'adding a mode did not open the native variable dialog');
  app.querySelector('#variable-name').value = 'Contrast';
  dispatchClick(app.querySelector('#variable-save'));
  await waitFor(() => [...app.querySelectorAll(`[data-variable-default-mode="${brandColors.id}"] option`)].some(option => option.textContent === 'Contrast'), 'new variable mode');
  dispatchClick(app.querySelector('[data-sidebar-tab="layers"]'));
  dispatchClick(app.querySelector('.inspector-tab[data-inspector-tab="design"]'));
  dispatchClick(app.querySelector(`[data-layer-id="${themeFrame.id}"]`));
  let frameModeControl = app.querySelector(`[data-frame-variable-mode="${brandColors.id}"]`);
  assert(frameModeControl, 'frame inspector did not expose collection mode overrides');
  frameModeControl.value = darkMode.id; frameModeControl.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'dark frame mode autosave');
  let variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt);
  let savedVariables = variableRecords[0]?.document;
  let savedVariableSurface = flattenNodes(savedVariables?.pages.flatMap(page => page.children)).find(node => node.id === variableSurface.id);
  let savedVariableHeading = flattenNodes(savedVariables?.pages.flatMap(page => page.children)).find(node => node.id === variableHeading.id);
  assert(getNodeColor(savedVariables, savedVariableSurface) === '#202124' && getNodeColor(savedVariables, savedVariableHeading, 'text') === '#202124', 'frame mode did not update bound fills and text together');

  dispatchClick(app.querySelector(`[data-layer-id="${layoutFrame.id}"]`));
  const layoutGapBinding = app.querySelector('[data-variable-property-binding="autoLayout.columnGap"]');
  assert(layoutGapBinding && [...layoutGapBinding.options].some(option => option.value === layoutGapVariable.id), 'Auto Layout inspector did not expose numeric variable bindings');
  layoutGapBinding.value = layoutGapVariable.id; layoutGapBinding.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'Auto Layout variable binding autosave');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  let savedLayoutFrame = flattenNodes(savedVariables.pages.flatMap(page => page.children)).find(node => node.id === layoutFrame.id);
  assert(savedLayoutFrame.children[1].x === 38, `default Auto Layout variable value did not reflow the frame (${savedLayoutFrame.children[1].x})`);
  frameModeControl = app.querySelector(`[data-frame-variable-mode="${brandColors.id}"]`);
  frameModeControl.value = darkMode.id; frameModeControl.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'Auto Layout variable mode autosave');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  savedLayoutFrame = flattenNodes(savedVariables.pages.flatMap(page => page.children)).find(node => node.id === layoutFrame.id);
  assert(getNodePropertyValue(savedVariables, savedLayoutFrame, 'autoLayout.columnGap') === 24 && savedLayoutFrame.children[1].x === 54,
    'changing the frame variable mode did not update its live and persisted Auto Layout');

  dispatchClick(app.querySelector(`[data-layer-id="${nestedThemeFrame.id}"]`));
  frameModeControl = app.querySelector(`[data-frame-variable-mode="${brandColors.id}"]`);
  frameModeControl.value = lightMode.id; frameModeControl.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'nested frame mode autosave');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  savedVariableSurface = flattenNodes(savedVariables?.pages.flatMap(page => page.children)).find(node => node.id === variableSurface.id);
  assert(getNodeColor(savedVariables, savedVariableSurface) === '#f7f7f7', 'nested frame mode did not override its parent mode');
  frameModeControl = app.querySelector(`[data-frame-variable-mode="${brandColors.id}"]`);
  frameModeControl.value = ''; frameModeControl.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'inherited frame mode autosave');

  dispatchClick(app.querySelector(`[data-layer-id="${variableSurface.id}"]`));
  const widthBinding = app.querySelector('[data-variable-property-binding="width"]');
  assert(widthBinding && [...widthBinding.options].some(option => option.value === cardWidthVariable.id), 'geometry variable was missing from the width binding control');
  widthBinding.value = cardWidthVariable.id; widthBinding.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'geometry variable binding autosave');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  savedVariableSurface = flattenNodes(savedVariables.pages.flatMap(page => page.children)).find(node => node.id === variableSurface.id);
  assert(getNodePropertyValue(savedVariables, savedVariableSurface, 'width') === 210, 'geometry binding did not resolve the inherited dark mode value');
  dispatchClick(app.querySelector(`[data-layer-id="${nestedThemeFrame.id}"]`));
  frameModeControl = app.querySelector(`[data-frame-variable-mode="${brandColors.id}"]`);
  frameModeControl.value = lightMode.id; frameModeControl.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'geometry variable mode change autosave');
  dispatchClick(app.querySelector(`[data-layer-id="${variableSurface.id}"]`));
  assert(app.querySelector('[data-prop="width"]')?.value === '90', 'geometry variable did not update the visible inspector value after a frame mode change');
  dispatchClick(app.querySelector(`[data-layer-id="${nestedThemeFrame.id}"]`));
  frameModeControl = app.querySelector(`[data-frame-variable-mode="${brandColors.id}"]`);
  frameModeControl.value = ''; frameModeControl.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'geometry variable mode inheritance restore');
  dispatchClick(app.querySelector(`[data-layer-id="${variableSurface.id}"]`));
  assert(app.querySelector('[data-prop="width"]')?.value === '210', 'geometry inspector kept a stale raw width after restoring the inherited mode');

  dispatchClick(app.querySelector('[data-action="create-color-variable"][data-kind="fill"]'));
  assert(app.querySelector('#variable-dialog').open, 'creating a variable from a layer did not open the native dialog');
  app.querySelector('#variable-name').value = 'Card accent';
  dispatchClick(app.querySelector('#variable-save'));
  await waitFor(() => [...app.querySelectorAll('[data-variable-binding="fill"] option')].some(option => option.textContent.includes('Card accent')), 'color variable creation from a layer');
  const accentOption = [...app.querySelectorAll('[data-variable-binding="fill"] option')].find(option => option.textContent.includes('Card accent'));
  const accentId = accentOption?.value;
  assert(accentId, 'new color variable was not available for binding');
  dispatchClick(app.querySelector('[data-sidebar-tab="assets"]'));
  const defaultModeControl = app.querySelector(`[data-variable-default-mode="${brandColors.id}"]`);
  defaultModeControl.value = darkMode.id; defaultModeControl.dispatchEvent(new Event('change', { bubbles: true }));
  const accentValue = app.querySelector(`[data-variable-value="${accentId}"][data-mode-id="${darkMode.id}"]`);
  assert(accentValue, 'new variable did not appear in the Assets collection');
  accentValue.value = '#eeaa33'; accentValue.dispatchEvent(new Event('input', { bubbles: true })); accentValue.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'color variable edit autosave');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  savedVariableSurface = flattenNodes(savedVariables?.pages.flatMap(page => page.children)).find(node => node.id === variableSurface.id);
  assert(savedVariableSurface.fillVariableId === accentId && getNodeColor(savedVariables, savedVariableSurface) === '#eeaa33', 'edited variable did not repaint its bound layer');
  const fillBinding = app.querySelector('[data-variable-binding="fill"]');
  fillBinding.value = ''; fillBinding.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'variable unlink autosave');
  assert(!app.querySelector('[data-variable-binding="fill"]')?.value, 'inspector could not remove a variable binding');
  dispatchClick(app.querySelector('[data-sidebar-tab="assets"]'));
  dispatchClick(app.querySelector(`[data-variable-apply="${accentId}"]`));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'variable Assets binding autosave');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  savedVariableSurface = flattenNodes(savedVariables?.pages.flatMap(page => page.children)).find(node => node.id === variableSurface.id);
  assert(savedVariableSurface.fillVariableId === accentId && getNodeColor(savedVariables, savedVariableSurface) === '#eeaa33', 'Assets variable card did not bind the selected layer');

  dispatchClick(app.querySelector(`[data-action="add-variable"][data-collection-id="${brandColors.id}"]`));
  app.querySelector('#variable-name').value = 'Spacing base';
  app.querySelector('#variable-type').value = 'number';
  dispatchClick(app.querySelector('#variable-save'));
  await waitFor(() => [...app.querySelectorAll('.variable-type-badge')].some(item => item.textContent === 'number'), 'number variable creation');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'number variable autosave');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  const spacingBase = savedVariables.variables.find(variable => variable.name === 'Spacing base');
  assert(spacingBase?.type === 'number', 'variable type selector did not create a numeric variable');
  let spacingValue = app.querySelector(`[data-variable-value="${spacingBase.id}"][data-mode-id="${darkMode.id}"]`);
  spacingValue.value = '12'; spacingValue.dispatchEvent(new Event('input', { bubbles: true })); spacingValue.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'numeric variable edit autosave');

  dispatchClick(app.querySelector(`[data-action="add-variable"][data-collection-id="${brandColors.id}"]`));
  app.querySelector('#variable-name').value = 'Spacing component';
  app.querySelector('#variable-type').value = 'number';
  dispatchClick(app.querySelector('#variable-save'));
  await waitFor(() => [...app.querySelectorAll('.variable-name')].some(item => item.textContent === 'Spacing component'), 'second numeric variable creation');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'second number variable autosave');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  const spacingComponent = savedVariables.variables.find(variable => variable.name === 'Spacing component');
  const spacingAlias = app.querySelector(`[data-variable-alias="${spacingComponent.id}"][data-mode-id="${darkMode.id}"]`);
  spacingAlias.value = spacingBase.id; spacingAlias.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector(`[data-variable-value="${spacingComponent.id}"][data-mode-id="${darkMode.id}"]`)?.disabled, 'numeric variable alias selection');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'numeric variable alias autosave');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  assert(resolveVariableValue(savedVariables, spacingComponent.id) === 12, 'numeric variable alias did not resolve its source value');
  spacingValue = app.querySelector(`[data-variable-value="${spacingBase.id}"][data-mode-id="${darkMode.id}"]`);
  spacingValue.value = '21'; spacingValue.dispatchEvent(new Event('input', { bubbles: true })); spacingValue.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'numeric alias source autosave');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  assert(resolveVariableValue(savedVariables, spacingComponent.id) === 21, 'numeric variable alias did not update with its source');

  for (const [type, name, expected] of [['string', 'Action text', 'Save changes'], ['boolean', 'Action enabled', true]]) {
    dispatchClick(app.querySelector(`[data-action="add-variable"][data-collection-id="${brandColors.id}"]`));
    app.querySelector('#variable-name').value = name;
    app.querySelector('#variable-type').value = type;
    dispatchClick(app.querySelector('#variable-save'));
    await waitFor(() => [...app.querySelectorAll('.variable-name')].some(item => item.textContent === name), `${type} variable creation`);
    await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${type} variable autosave`);
    variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
    const variable = savedVariables.variables.find(item => item.name === name);
    const value = app.querySelector(`[data-variable-value="${variable.id}"][data-mode-id="${darkMode.id}"]`);
    if (type === 'boolean') value.checked = expected;
    else value.value = expected;
    value.dispatchEvent(new Event('input', { bubbles: true })); value.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${type} value autosave`);
    variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
    assert(resolveVariableValue(savedVariables, variable.id) === expected, `${type} variable did not retain its typed value`);
  }

  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  const savedSpacingComponent = savedVariables.variables.find(variable => variable.name === 'Spacing component');
  const savedSpacingBase = savedVariables.variables.find(variable => variable.name === 'Spacing base');
  const actionText = savedVariables.variables.find(variable => variable.name === 'Action text');
  const actionEnabled = savedVariables.variables.find(variable => variable.name === 'Action enabled');
  dispatchClick(app.querySelector('[data-sidebar-tab="layers"]'));
  dispatchClick(app.querySelector(`[data-layer-id="${variableSurface.id}"]`));
  const radiusBinding = app.querySelector('[data-variable-property-binding="radius"]');
  radiusBinding.value = savedSpacingComponent.id; radiusBinding.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'numeric layer binding autosave');
  dispatchClick(app.querySelector('[data-sidebar-tab="assets"]'));
  let sourceSpacingValue = app.querySelector(`[data-variable-value="${savedSpacingBase.id}"][data-mode-id="${darkMode.id}"]`);
  sourceSpacingValue.value = '31'; sourceSpacingValue.dispatchEvent(new Event('input', { bubbles: true })); sourceSpacingValue.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'bound alias source update autosave');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  savedVariableSurface = flattenNodes(savedVariables.pages.flatMap(page => page.children)).find(node => node.id === variableSurface.id);
  assert(getNodePropertyValue(savedVariables, savedVariableSurface, 'radius') === 31, 'a numeric alias did not drive the bound layer radius');
  sourceSpacingValue = app.querySelector(`[data-variable-value="${savedSpacingBase.id}"][data-mode-id="${darkMode.id}"]`);
  sourceSpacingValue.value = '2'; sourceSpacingValue.dispatchEvent(new Event('input', { bubbles: true })); sourceSpacingValue.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'text tracking value autosave');

  dispatchClick(app.querySelector('[data-sidebar-tab="layers"]'));
  dispatchClick(app.querySelector(`[data-layer-id="${variableHeading.id}"]`));
  const familyControl = app.querySelector('[data-prop="fontFamily"]');
  const weightControl = app.querySelector('[data-prop="fontWeight"]');
  const styleControl = app.querySelector('[data-prop="fontStyle"]');
  assert(familyControl?.tagName === 'INPUT' && familyControl.list?.options.length >= 8, 'the text Inspector did not offer an editable font family with useful presets');
  assert(weightControl && [100, 200, 300, 400, 500, 600, 700, 800, 900].every(weight => [...weightControl.options].some(option => Number(option.value) === weight)), 'the text Inspector did not offer the complete font-weight scale');
  assert(styleControl && [...styleControl.options].some(option => option.value === 'italic'), 'the text Inspector did not offer italic styling');
  const textInspector = app.querySelector('#right-panel').getBoundingClientRect();
  assert(familyControl.getBoundingClientRect().right <= textInspector.right, 'the custom font family control overflowed the Inspector');
  if (app.defaultView.matchMedia('(max-width: 820px)').matches) assert(familyControl.getBoundingClientRect().height >= 40, 'the phone font-family field is below the 40px touch target');
  const originalFamily = familyControl.value;
  familyControl.value = ''; familyControl.dispatchEvent(new Event('input', { bubbles: true })); familyControl.dispatchEvent(new Event('change', { bubbles: true }));
  assert(familyControl.value === originalFamily, 'clearing the font field should restore its previous valid family');
  familyControl.value = 'Georgia, serif'; familyControl.dispatchEvent(new Event('input', { bubbles: true })); familyControl.dispatchEvent(new Event('change', { bubbles: true }));
  weightControl.value = '800'; weightControl.dispatchEvent(new Event('input', { bubbles: true })); weightControl.dispatchEvent(new Event('change', { bubbles: true }));
  styleControl.value = 'italic'; styleControl.dispatchEvent(new Event('input', { bubbles: true })); styleControl.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'expanded typography controls');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  savedVariableHeading = flattenNodes(savedVariables.pages.flatMap(page => page.children)).find(node => node.id === variableHeading.id);
  assert(savedVariableHeading.fontFamily === 'Georgia, serif' && savedVariableHeading.fontWeight === 800 && savedVariableHeading.fontStyle === 'italic', 'custom family, heavy weight, or italic style did not persist');

  const selectTypographyLayer = (id) => {
    dispatchClick(app.querySelector('[data-sidebar-tab="layers"]'));
    const row = app.querySelector(`[data-layer-id="${id}"]`);
    assert(row, `typography fixture layer ${id} was missing from the layer list`);
    dispatchClick(row);
  };
  const setTypographyProperty = (property, value) => {
    const control = app.querySelector(`[data-prop="${property}"]`);
    assert(control, `text Inspector did not expose ${property} for reusable text styles`);
    control.value = String(value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const savedDocument = async () => {
    const records = await readStore('documents'); records.sort((a, b) => b.savedAt - a.savedAt);
    return records[0]?.document;
  };
  selectTypographyLayer(typographySource.id);
  setTypographyProperty('fontFamily', 'Georgia, serif');
  setTypographyProperty('fontSize', 31);
  setTypographyProperty('fontWeight', 700);
  setTypographyProperty('fontStyle', 'italic');
  setTypographyProperty('color', '#e14a6d');
  await waitForSaveCycle(app, 'typography source style');
  const originalPrompt = app.defaultView.prompt;
  app.defaultView.prompt = () => 'Smoke reusable typography';
  dispatchClick(app.querySelector('[data-action="create-typography-style"]'));
  app.defaultView.prompt = originalPrompt;
  await waitForSaveCycle(app, 'reusable typography style save');
  dispatchClick(app.querySelector('[data-sidebar-tab="assets"]'));
  await waitFor(() => app.querySelector('#text-styles-list [data-typography-style-id]'), 'saved typography style card');
  let typographyRecord = await savedDocument();
  let savedTypographyStyle = typographyRecord.typographyStyles?.find(style => style.name === 'Smoke reusable typography');
  assert(savedTypographyStyle, 'the reusable typography style was not persisted');
  const typographyStyleId = savedTypographyStyle.id;
  const typographyStyleCard = () => app.querySelector(`#text-styles-list [data-typography-style-id="${typographyStyleId}"]`);
  selectTypographyLayer(typographyTarget.id);
  dispatchClick(app.querySelector('[data-sidebar-tab="assets"]'));
  await waitFor(() => typographyStyleCard(), 'typography style card before apply');
  dispatchClick(typographyStyleCard());
  await waitForSaveCycle(app, 'typography style apply to first target');
  typographyRecord = await savedDocument();
  let savedTypographyTarget = flattenNodes(typographyRecord.pages.flatMap(page => page.children)).find(node => node.id === typographyTarget.id);
  assert(savedTypographyTarget.fontFamily === 'Georgia, serif' && savedTypographyTarget.fontSize === 31 && savedTypographyTarget.fontWeight === 700 && savedTypographyTarget.fontStyle === 'italic' && savedTypographyTarget.color === '#e14a6d',
    'the saved typography style did not apply to another text layer');
  assert(savedTypographyTarget.text === 'First target' && savedTypographyTarget.x === typographyTarget.x && savedTypographyTarget.y === typographyTarget.y,
    'applying a typography style changed the target text or placement');

  selectTypographyLayer(typographySource.id);
  setTypographyProperty('fontFamily', 'Arial, sans-serif');
  setTypographyProperty('fontSize', 36);
  setTypographyProperty('fontWeight', 600);
  setTypographyProperty('fontStyle', 'normal');
  setTypographyProperty('color', '#3264c8');
  await waitForSaveCycle(app, 'updated typography source');
  dispatchClick(app.querySelector('[data-sidebar-tab="assets"]'));
  const styleCardBeforeUpdate = typographyStyleCard();
  assert(styleCardBeforeUpdate, 'the typography style card disappeared before update');
  const updateTypographyStyle = styleCardBeforeUpdate.closest('.typography-style-row')?.querySelector(`[data-text-style-action="update"][data-text-style-id="${typographyStyleId}"]`);
  assert(updateTypographyStyle, 'the typography style card did not expose its update action');
  dispatchClick(updateTypographyStyle);
  await waitForSaveCycle(app, 'typography style update');
  typographyRecord = await savedDocument();
  savedTypographyStyle = typographyRecord.typographyStyles?.find(style => style.id === typographyStyleId);
  assert(savedTypographyStyle?.fontFamily === 'Arial, sans-serif' && savedTypographyStyle.fontSize === 36 && savedTypographyStyle.fontWeight === 600 && savedTypographyStyle.fontStyle === 'normal' && savedTypographyStyle.color === '#3264c8',
    'updating the typography style did not capture the selected text properties');

  selectTypographyLayer(typographyUpdatedTarget.id);
  const updatedTargetRow = app.querySelector(`[data-layer-id="${typographyUpdatedTarget.id}"]`);
  dispatchContextMenu(updatedTargetRow);
  const updatedStyleMenuItem = [...app.querySelectorAll('#context-menu button')].find(item => item.textContent.trim() === 'Smoke reusable typography');
  assert(updatedStyleMenuItem, 'the selected text context menu did not offer saved typography styles');
  dispatchClick(updatedStyleMenuItem);
  await waitForSaveCycle(app, 'updated typography style apply to third target');
  typographyRecord = await savedDocument();
  const savedTypographyUpdatedTarget = flattenNodes(typographyRecord.pages.flatMap(page => page.children)).find(node => node.id === typographyUpdatedTarget.id);
  assert(savedTypographyUpdatedTarget.fontFamily === 'Arial, sans-serif' && savedTypographyUpdatedTarget.fontSize === 36 && savedTypographyUpdatedTarget.fontWeight === 600 && savedTypographyUpdatedTarget.fontStyle === 'normal' && savedTypographyUpdatedTarget.color === '#3264c8',
    'the updated typography style did not apply to the third text layer');
  dispatchClick(app.querySelector('[data-sidebar-tab="assets"]'));
  await waitFor(() => typographyStyleCard(), 'updated typography style card before phone layout check');
  const desktopFrameSizeForTypography = { width: frame.style.width, height: frame.style.height };
  frame.style.width = '390px'; frame.style.height = '844px';
  await new Promise(resolve => app.defaultView.requestAnimationFrame(() => app.defaultView.requestAnimationFrame(resolve)));
  const mobileTypographyApply = typographyStyleCard();
  const mobileTypographyRow = mobileTypographyApply?.closest('.typography-style-row');
  const mobileTypographyUpdate = mobileTypographyRow?.querySelector(`[data-text-style-action="update"][data-text-style-id="${typographyStyleId}"]`);
  assert(mobileTypographyApply?.getBoundingClientRect().height >= 44 && mobileTypographyUpdate?.getBoundingClientRect().height >= 40,
    'text style apply and update actions do not meet mobile touch target sizing');
  assert(mobileTypographyRow.getBoundingClientRect().right <= app.querySelector('#left-panel').getBoundingClientRect().right,
    'the text style card overflows the mobile Assets panel');
  dispatchClick(app.querySelector('[data-sidebar-tab="layers"]'));
  const mobileLeftPanel = app.querySelector('#left-panel');
  if (!mobileLeftPanel.classList.contains('is-open')) dispatchClick(app.querySelector('#sidebar-toggle'));
  await waitFor(() => mobileLeftPanel.getBoundingClientRect().left >= -0.5, 'mobile Layers panel opening');
  const mobileLayersList = app.querySelector('#layers-list');
  mobileLayersList.scrollTop = 0;
  const firstMobileLayer = mobileLayersList.querySelector('.layer-row[data-layer-id]');
  assert(firstMobileLayer, 'the mobile Layers panel did not contain a visible layer');
  dispatchClick(firstMobileLayer);
  await new Promise(resolve => app.defaultView.requestAnimationFrame(resolve));
  const mobileLayerRow = mobileLayersList.querySelector('.layer-row.is-selected[data-layer-id]');
  const mobileLayerVisibility = mobileLayerRow?.querySelector('.layer-visibility');
  const mobileLayerBounds = mobileLayerRow?.getBoundingClientRect();
  const mobileLayerVisibilityBounds = mobileLayerVisibility?.getBoundingClientRect();
  const mobilePanelBounds = mobileLeftPanel.getBoundingClientRect();
  const mobileLayersBounds = mobileLayersList.getBoundingClientRect();
  assert(mobileLayerRow && app.defaultView.getComputedStyle(mobileLayerRow).display !== 'none' && mobileLayerBounds.height >= 40,
    'a visible mobile layer row is below the 40px touch target');
  assert(mobileLayerVisibility && app.defaultView.getComputedStyle(mobileLayerVisibility).display !== 'none' && mobileLayerVisibilityBounds.width >= 40 && mobileLayerVisibilityBounds.height >= 40,
    'the mobile layer visibility control is not a visible 40×40px touch target');
  assert(mobileLayerBounds.left >= mobilePanelBounds.left - 0.5 && mobileLayerBounds.right <= mobilePanelBounds.right + 0.5 &&
    mobileLayerBounds.top >= mobileLayersBounds.top - 0.5 && mobileLayerBounds.bottom <= mobileLayersBounds.bottom + 0.5 &&
    mobileLayerVisibilityBounds.left >= mobilePanelBounds.left - 0.5 && mobileLayerVisibilityBounds.right <= mobilePanelBounds.right + 0.5,
  'the mobile layer row or visibility control overflows the open Layers panel');
  frame.style.width = desktopFrameSizeForTypography.width; frame.style.height = desktopFrameSizeForTypography.height;
  await new Promise(resolve => app.defaultView.requestAnimationFrame(resolve));
  const deleteTypographyStyle = typographyStyleCard()?.closest('.typography-style-row')?.querySelector(`[data-text-style-action="delete"][data-text-style-id="${typographyStyleId}"]`);
  assert(deleteTypographyStyle, 'the typography style card did not expose its delete action');
  dispatchClick(deleteTypographyStyle);
  await waitForSaveCycle(app, 'typography style deletion save');
  await waitFor(() => !typographyStyleCard(), 'typography style deletion from Assets');
  typographyRecord = await savedDocument();
  assert(!typographyRecord.typographyStyles?.some(style => style.id === typographyStyleId), 'deleting the typography style did not remove it from the local document');

  selectTypographyLayer(variableHeading.id);
  const textBinding = app.querySelector('[data-variable-property-binding="text"]');
  textBinding.value = actionText.id; textBinding.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'text variable binding autosave');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const textPixelsBeforeTracking = new Uint8ClampedArray(app.querySelector('#scene-canvas').getContext('2d').getImageData(0, 0, app.querySelector('#scene-canvas').width, app.querySelector('#scene-canvas').height).data);
  const trackingBinding = app.querySelector('[data-variable-property-binding="letterSpacing"]');
  assert(trackingBinding, 'the text inspector did not offer a letter-spacing variable');
  trackingBinding.value = savedSpacingBase.id; trackingBinding.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'letter-spacing variable binding autosave');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const textPixelsAfterTracking = app.querySelector('#scene-canvas').getContext('2d').getImageData(0, 0, app.querySelector('#scene-canvas').width, app.querySelector('#scene-canvas').height).data;
  assert(textPixelsBeforeTracking.some((pixel, index) => pixel !== textPixelsAfterTracking[index]), 'the bound letter-spacing variable did not change the rendered text');
  dispatchClick(app.querySelector('[data-sidebar-tab="assets"]'));
  dispatchClick(app.querySelector(`[data-sidebar-tab="layers"]`));
  dispatchClick(app.querySelector(`[data-layer-id="${variableSurface.id}"]`));
  const visibilityBinding = app.querySelector('[data-variable-property-binding="visible"]');
  visibilityBinding.value = actionEnabled.id; visibilityBinding.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'visibility variable binding autosave');
  dispatchClick(app.querySelector('[data-sidebar-tab="assets"]'));
  const enabledValue = app.querySelector(`[data-variable-value="${actionEnabled.id}"][data-mode-id="${darkMode.id}"]`);
  enabledValue.checked = false; enabledValue.dispatchEvent(new Event('input', { bubbles: true })); enabledValue.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'bound Boolean value autosave');
  variableRecords = await readStore('documents'); variableRecords.sort((a, b) => b.savedAt - a.savedAt); savedVariables = variableRecords[0]?.document;
  savedVariableSurface = flattenNodes(savedVariables.pages.flatMap(page => page.children)).find(node => node.id === variableSurface.id);
  savedVariableHeading = flattenNodes(savedVariables.pages.flatMap(page => page.children)).find(node => node.id === variableHeading.id);
  assert(getNodePropertyValue(savedVariables, savedVariableSurface, 'visible') === false, 'the Boolean variable did not update layer visibility');
  assert(getNodePropertyValue(savedVariables, savedVariableHeading, 'text') === 'Save changes', 'the string variable did not replace bound text content');
  dispatchClick(app.querySelector('[data-sidebar-tab="assets"]'));
  const enabledValueForLayout = app.querySelector(`[data-variable-value="${actionEnabled.id}"][data-mode-id="${darkMode.id}"]`);
  enabledValueForLayout.checked = true; enabledValueForLayout.dispatchEvent(new Event('input', { bubbles: true })); enabledValueForLayout.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'grid fixture visibility autosave');
  dispatchClick(app.querySelector('[data-sidebar-tab="layers"]'));
  await waitFor(() => !app.querySelector(`[data-layer-id="${variableSurface.id}"]`)?.classList.contains('layer-hidden'), 'grid fixture variable-controlled layer visibility');
  dispatchClick(app.querySelector(`[data-layer-id="${nestedThemeFrame.id}"]`));
  dispatchClick(app.querySelector('[data-action="auto-layout-toggle"]'));
  let layoutAxis = app.querySelector('[data-prop="autoLayout.axis"]');
  assert([...layoutAxis.options].some(option => option.value === 'grid'), 'auto layout flow picker did not offer Grid');
  layoutAxis.value = 'grid'; layoutAxis.dispatchEvent(new Event('input', { bubbles: true })); layoutAxis.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'grid auto layout');
  let layoutRecords = await readStore('documents'); layoutRecords.sort((a, b) => b.savedAt - a.savedAt);
  let savedGridFrame = flattenNodes(layoutRecords[0]?.document.pages.flatMap(page => page.children)).find(node => node.id === nestedThemeFrame.id);
  assert(savedGridFrame?.autoLayout.axis === 'grid' && savedGridFrame.children.every(node => node.gridCell?.row && node.gridCell?.column), 'grid auto layout did not assign stable cell placements');
  const gridColumns = app.querySelector('[data-prop="autoLayout.columns"]');
  gridColumns.value = '1'; gridColumns.dispatchEvent(new Event('input', { bubbles: true })); gridColumns.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'grid column resize');
  layoutRecords = await readStore('documents'); layoutRecords.sort((a, b) => b.savedAt - a.savedAt);
  savedGridFrame = flattenNodes(layoutRecords[0]?.document.pages.flatMap(page => page.children)).find(node => node.id === nestedThemeFrame.id);
  const visibleGridChildren = savedGridFrame.children.filter(node => node.visible && node.layoutPositioning !== 'absolute');
  assert(savedGridFrame.autoLayout.columns === 1 && visibleGridChildren.length >= 2 && visibleGridChildren[1].gridCell.row > visibleGridChildren[0].gridCell.row, `reducing grid columns did not reflow visible children into more rows: ${JSON.stringify({ columns: savedGridFrame.autoLayout.columns, visible: visibleGridChildren.map(node => ({ name: node.name, row: node.gridCell?.row, column: node.gridCell?.column, visible: node.visible })) })}`);

  const booleanDocument = createDocument();
  const booleanUnderlay = createNode('rectangle', { name: 'Boolean underlay', x: 0, y: 0, width: 190, height: 90, fill: '#00cc44' });
  const booleanBase = createNode('rectangle', { name: 'Boolean base', x: 0, y: 0, width: 160, height: 90, fill: '#0055ff' });
  const booleanCutter = createNode('rectangle', { name: 'Boolean cutter', x: 70, y: 0, width: 120, height: 90, fill: '#ff0055' });
  addNode(booleanDocument, booleanUnderlay); addNode(booleanDocument, booleanBase); addNode(booleanDocument, booleanCutter);
  const booleanInput = app.querySelector('#open-file-input'); const booleanTransfer = new DataTransfer();
  booleanTransfer.items.add(new File([buildPackage(booleanDocument, [])], 'boolean-smoke.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(booleanInput, 'files', { configurable: true, value: booleanTransfer.files });
  booleanInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(item => item.textContent.includes('Local design opened')), 'Boolean fixture document import');
  let baseRow = app.querySelector(`[data-layer-id="${booleanBase.id}"]`);
  dispatchClick(baseRow);
  let cutterRow = app.querySelector(`[data-layer-id="${booleanCutter.id}"]`);
  dispatchClick(cutterRow, { ctrlKey: true });
  assert(app.querySelectorAll('.layer-row.is-selected[data-layer-id]').length === 2, 'Boolean source shapes were not multi-selected');
  cutterRow = app.querySelector(`[data-layer-id="${booleanCutter.id}"]`);
  dispatchContextMenu(cutterRow);
  for (const label of ['Combine as Union', 'Combine as Subtract', 'Combine as Intersect', 'Combine as Exclude']) {
    assert([...app.querySelectorAll('#context-menu button')].some(button => button.textContent.trim() === label), `Boolean context menu omitted ${label}`);
  }
  const subtractMenuItem = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim() === 'Combine as Subtract');
  dispatchClick(subtractMenuItem);
  await waitFor(() => app.querySelector('.layer-row.is-selected[data-layer-id]')?.textContent.includes('Subtract group'), 'live subtract Boolean group');
  assert(app.querySelectorAll('.layer-row[data-layer-id]').length === 4, 'Boolean combine flattened or discarded its editable source layers');
  dispatchClick(app.querySelector('#zoom-fit'));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const booleanGroupId = app.querySelector('.layer-row.is-selected[data-layer-id]')?.dataset.layerId;
  const sampleBooleanPixel = world => {
    const ratio = designCanvas.width / designCanvas.clientWidth;
    const zoom = Number.parseFloat(app.querySelector('#zoom-readout').textContent) / 100;
    const x = designCanvas.clientWidth / 2 + (world.x - 95) * zoom;
    const y = designCanvas.clientHeight / 2 + (world.y - 45) * zoom;
    return [...designCanvas.getContext('2d').getImageData(Math.floor(x * ratio), Math.floor(y * ratio), 1, 1).data];
  };
  const subtractHole = sampleBooleanPixel({ x: 120, y: 45 });
  const subtractFill = sampleBooleanPixel({ x: 30, y: 45 });
  assert(subtractHole[1] > 180 && subtractHole[0] < 80, `subtract did not reveal the underlay through its cutout (${subtractHole.join(',')})`);
  assert(subtractFill[2] > 180 && subtractFill[0] < 80, `subtract did not render the retained shape (${subtractFill.join(',')})`);
  const holeZoom = Number.parseFloat(app.querySelector('#zoom-readout').textContent) / 100;
  const holeX = canvasRect.left + panCenter.x + (120 - 95) * holeZoom;
  const holeY = canvasRect.top + panCenter.y;
  dispatchCanvasPointer(app, designCanvas, 'pointerdown', holeX, holeY, 111);
  dispatchCanvasPointer(app, designCanvas, 'pointerup', holeX, holeY, 111);
  await waitFor(() => app.querySelector('.layer-row.is-selected[data-layer-id]')?.dataset.layerId === booleanUnderlay.id, 'selection through the Boolean cutout');
  dispatchClick(app.querySelector(`[data-layer-id="${booleanGroupId}"]`));
  const operationInput = app.querySelector('[data-prop="operation"]');
  operationInput.value = 'union'; operationInput.dispatchEvent(new Event('input', { bubbles: true })); operationInput.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const unionFill = sampleBooleanPixel({ x: 120, y: 45 });
  assert(unionFill[0] < 80 && unionFill[2] > 180, `changing the operation in the inspector did not update the preview (${unionFill.join(',')})`);
  const booleanRow = app.querySelector('.layer-row.is-selected[data-layer-id]');
  dispatchContextMenu(booleanRow);
  const separateItem = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim() === 'Separate Boolean');
  assert(separateItem, 'Boolean context menu did not offer separation');
  dispatchClick(separateItem);
  await waitFor(() => app.querySelectorAll('.layer-row[data-layer-id]').length === 3 && !app.querySelector('[data-action="separate-boolean"]'), 'Boolean separation');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'separated Boolean autosave');
  const separatedRecords = await readStore('documents'); separatedRecords.sort((a, b) => b.savedAt - a.savedAt);
  const separated = separatedRecords[0]?.document?.pages[0]?.children;
  assert(separated?.map(node => node.id).join(',') === `${booleanUnderlay.id},${booleanBase.id},${booleanCutter.id}`, 'separation did not restore the original source layers and identities');
  const preGroupGeometry = new Map([booleanBase.id, booleanCutter.id].map(id => {
    const entry = findNodeOrigin(separated, id);
    return [id, { x: entry.x, y: entry.y, rotation: entry.node.rotation }];
  }));
  dispatchClick(app.querySelector(`[data-layer-id="${booleanBase.id}"]`));
  dispatchClick(app.querySelector(`[data-layer-id="${booleanCutter.id}"]`), { ctrlKey: true });
  assert(app.querySelectorAll('.layer-row.is-selected[data-layer-id]').length === 2, 'layers for ordinary grouping were not multi-selected');
  dispatchContextMenu(app.querySelector(`[data-layer-id="${booleanCutter.id}"]`));
  const groupAction = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Group 2 layers'));
  assert(groupAction, 'the context menu did not expose ordinary Group');
  dispatchClick(groupAction);
  await waitFor(() => app.querySelector('.layer-row.is-selected[data-layer-id]')?.textContent.includes('Group'), 'ordinary layer grouping');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'group autosave');
  const groupedRecords = await readStore('documents'); groupedRecords.sort((a, b) => b.savedAt - a.savedAt);
  const groupedDocument = groupedRecords[0]?.document;
  const groupedLayer = groupedDocument?.pages[0]?.children.find(node => node.type === 'group' && node.children.some(child => child.id === booleanBase.id));
  assert(groupedLayer?.children.map(node => node.id).join(',') === `${booleanBase.id},${booleanCutter.id}`, 'grouping did not retain the selected layer identities and stack order');
  for (const id of [booleanBase.id, booleanCutter.id]) {
    const groupedChild = findNodeOrigin(groupedDocument.pages[0].children, id);
    assert(groupedChild.x === preGroupGeometry.get(id).x && groupedChild.y === preGroupGeometry.get(id).y, 'grouping changed a child page-space position');
  }
  dispatchContextMenu(app.querySelector(`[data-layer-id="${groupedLayer.id}"]`));
  const ungroupAction = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Ungroup'));
  assert(ungroupAction, 'the context menu did not expose Ungroup');
  dispatchClick(ungroupAction);
  await waitFor(() => app.querySelectorAll('.layer-row[data-layer-id]').length === 3 && !app.querySelector(`[data-layer-id="${groupedLayer.id}"]`), 'ordinary layer ungrouping');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'ungroup autosave');
  const ungroupedRecords = await readStore('documents'); ungroupedRecords.sort((a, b) => b.savedAt - a.savedAt);
  const ungroupedChildren = ungroupedRecords[0]?.document?.pages[0]?.children;
  assert(ungroupedChildren.map(node => node.id).join(',') === `${booleanUnderlay.id},${booleanBase.id},${booleanCutter.id}`, 'ungrouping did not restore the original sibling stack order');
  for (const id of [booleanBase.id, booleanCutter.id]) {
    const ungroupedChild = ungroupedChildren.find(node => node.id === id);
    assert(ungroupedChild.x === preGroupGeometry.get(id).x && ungroupedChild.y === preGroupGeometry.get(id).y, 'ungrouping changed a child page-space position');
  }
  const alignLeftButton = app.querySelector('[data-action="align-selection"][data-align-mode="left"]');
  assert(alignLeftButton && !alignLeftButton.disabled, 'multi-selection inspector did not expose sibling alignment controls');
  dispatchClick(alignLeftButton);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'aligned sibling autosave');
  const alignedRecords = await readStore('documents'); alignedRecords.sort((a, b) => b.savedAt - a.savedAt);
  const alignedChildren = alignedRecords[0]?.document?.pages[0]?.children;
  assert(alignedChildren.find(node => node.id === booleanBase.id)?.x === alignedChildren.find(node => node.id === booleanCutter.id)?.x,
    'Align left did not move selected siblings to the same visual edge');
  const maskDocument = createDocument();
  const maskedContent = createNode('rectangle', { name: 'Masked content', x: 0, y: 0, width: 100, height: 100, fill: '#00cc44' });
  const maskShape = createNode('ellipse', { name: 'Circle mask', x: 25, y: 25, width: 50, height: 50 });
  addNode(maskDocument, maskedContent); addNode(maskDocument, maskShape);
  assert(canCreateMaskGroup(maskDocument, [maskedContent.id, maskShape.id]), 'valid mask siblings could not form a mask group');
  const maskGroup = createMaskGroup(maskDocument, [maskedContent.id, maskShape.id]);
  const maskCanvas = document.createElement('canvas'); maskCanvas.width = 100; maskCanvas.height = 100;
  const maskContext = maskCanvas.getContext('2d');
  const maskRenderer = Object.create(SceneRenderer.prototype);
  maskRenderer.getState = () => ({ document: maskDocument, assets: new Map(), previews: new Map(), zoom: 1 });
  maskRenderer.drawNode(maskContext, maskGroup, 0, 0, new Map());
  const maskInside = [...maskContext.getImageData(40, 40, 1, 1).data];
  const maskOutside = [...maskContext.getImageData(10, 10, 1, 1).data];
  assert(maskInside[1] > 180 && maskInside[3] > 240 && maskOutside[3] === 0, `mask group did not clip editable content (${maskInside.join(',')} / ${maskOutside.join(',')})`);
  const maskSource = maskGroup.children.find(node => node.id === maskGroup.maskSourceId);
  maskSource.opacity = .5; maskSource.fillOpacity = .5;
  maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  maskRenderer.drawNode(maskContext, maskGroup, 0, 0, new Map());
  const translucentMaskPixel = maskContext.getImageData(40, 40, 1, 1).data[3];
  assert(translucentMaskPixel >= 62 && translucentMaskPixel <= 66, `mask source opacity did not affect alpha composition (${translucentMaskPixel})`);
  const releasedMaskLayers = releaseMaskGroup(maskDocument, maskGroup.id);
  assert(releasedMaskLayers.map(node => node.id).join(',') === `${maskedContent.id},${maskShape.id}`, 'releasing the mask did not restore the original editable layers');

  const effectDocument = createDocument();
  const shadowNode = createNode('rectangle', { x: 12, y: 12, width: 20, height: 20, fill: '#ff0000', effects: [createLayerEffect('drop-shadow', { color: '#000000', opacity: 1, offsetX: 8, offsetY: 0, blur: 0 })] });
  addNode(effectDocument, shadowNode);
  const effectCanvas = document.createElement('canvas'); effectCanvas.width = 48; effectCanvas.height = 48;
  const effectContext = effectCanvas.getContext('2d');
  const effectRenderer = Object.create(SceneRenderer.prototype);
  effectRenderer.getState = () => ({ document: effectDocument, assets: new Map(), previews: new Map(), zoom: 1, outlineMode: false, presenting: false });
  effectRenderer.drawNode(effectContext, shadowNode, 0, 0, new Map());
  const shadowPixel = [...effectContext.getImageData(35, 20, 1, 1).data];
  assert(shadowPixel[3] > 200 && shadowPixel[0] < 60 && shadowPixel[1] < 60, `drop shadow should render outside the shape bounds (${shadowPixel.join(',')})`);
  const blurNode = createNode('rectangle', { x: 10, y: 10, width: 10, height: 10, fill: '#ff0000', effects: [createLayerEffect('layer-blur', { radius: 3 })] });
  effectDocument.pages[0].children = [blurNode];
  effectContext.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
  effectRenderer.drawNode(effectContext, blurNode, 0, 0, new Map());
  const blurPixel = effectContext.getImageData(9, 15, 1, 1).data[3];
  assert(blurPixel > 0, 'layer blur should spread color beyond the original shape edge');

  const gradientDocument = createDocument();
  const linearFill = createGradientFill('linear', '#ff0000');
  linearFill.stops[1].color = '#0000ff';
  const gradientNode = createNode('rectangle', { x: 8, y: 8, width: 40, height: 20, fillGradient: linearFill });
  addNode(gradientDocument, gradientNode);
  effectRenderer.getState = () => ({ document: gradientDocument, assets: new Map(), previews: new Map(), zoom: 1, outlineMode: false, presenting: false });
  effectContext.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
  effectRenderer.drawNode(effectContext, gradientNode, 0, 0, new Map());
  const gradientLeft = [...effectContext.getImageData(12, 18, 1, 1).data];
  const gradientRight = [...effectContext.getImageData(44, 18, 1, 1).data];
  assert(gradientLeft[0] > gradientLeft[2] && gradientRight[2] > gradientRight[0], `linear gradient should interpolate across the filled shape (${gradientLeft.join(',')} / ${gradientRight.join(',')})`);
  gradientNode.fillGradient = createGradientFill('radial', '#ff0000');
  gradientNode.fillGradient.stops[1].color = '#0000ff';
  effectContext.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
  effectRenderer.drawNode(effectContext, gradientNode, 0, 0, new Map());
  const radialCenter = [...effectContext.getImageData(28, 18, 1, 1).data];
  const radialEdge = [...effectContext.getImageData(9, 18, 1, 1).data];
  assert(radialCenter[0] > radialCenter[2] && radialEdge[2] > radialEdge[0], `radial gradient should radiate from the center (${radialCenter.join(',')} / ${radialEdge.join(',')})`);

  const fillBitmap = await createImageBitmap(new Blob([source], { type: 'image/bmp' }));
  const fillAssetId = 'asset-image-fill-test';
  const imageFillDocument = createDocument();
  const imageFilledEllipse = createNode('ellipse', { x: 8, y: 8, width: 32, height: 24, fill: '#d9d9d9', imageFill: createImageFill(fillAssetId) });
  addNode(imageFillDocument, imageFilledEllipse);
  const imageFillAssets = new Map([[fillAssetId, { bitmap: fillBitmap }]]);
  effectRenderer.getState = () => ({ document: imageFillDocument, assets: imageFillAssets, previews: new Map(), zoom: 1, outlineMode: false, presenting: false });
  effectContext.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
  effectRenderer.drawNode(effectContext, imageFilledEllipse, 0, 0, imageFillAssets);
  const imageFillLeft = [...effectContext.getImageData(12, 20, 1, 1).data];
  const imageFillRight = [...effectContext.getImageData(36, 20, 1, 1).data];
  const imageFillCorner = [...effectContext.getImageData(8, 8, 1, 1).data];
  assert(imageFillLeft[0] > imageFillLeft[2] && imageFillRight[2] > imageFillRight[0], `image fill did not map source pixels into the vector shape (${imageFillLeft.join(',')} / ${imageFillRight.join(',')})`);
  assert(imageFillCorner[3] === 0, 'image fill escaped the ellipse path');
  const containedFill = createNode('rectangle', { x: 4, y: 4, width: 40, height: 40, imageFill: createImageFill(fillAssetId, { fit: 'contain' }) });
  imageFillDocument.pages[0].children = [containedFill];
  effectContext.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
  effectRenderer.drawNode(effectContext, containedFill, 0, 0, imageFillAssets);
  const containBar = effectContext.getImageData(24, 6, 1, 1).data[3];
  const containImage = effectContext.getImageData(24, 24, 1, 1).data[3];
  assert(containBar === 0 && containImage > 0, `contain mode did not preserve transparent letterbox space (${containBar} / ${containImage})`);
  fillBitmap.close?.();

  const blendDocument = createDocument();
  const blendBackdrop = createNode('rectangle', { x: 4, y: 4, width: 32, height: 32, fill: '#0000ff' });
  const multiplyNode = createNode('rectangle', { x: 12, y: 12, width: 36, height: 36, fill: '#ff0000', blendMode: 'multiply' });
  addNode(blendDocument, blendBackdrop); addNode(blendDocument, multiplyNode);
  effectRenderer.getState = () => ({ document: blendDocument, assets: new Map(), previews: new Map(), zoom: 1, outlineMode: false, presenting: false });
  effectContext.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
  effectRenderer.drawNode(effectContext, blendBackdrop, 0, 0, new Map());
  effectRenderer.drawNode(effectContext, multiplyNode, 0, 0, new Map());
  const multipliedPixel = [...effectContext.getImageData(16, 16, 1, 1).data];
  const blendOnlyPixel = [...effectContext.getImageData(40, 40, 1, 1).data];
  assert(multipliedPixel[0] < 5 && multipliedPixel[1] < 5 && multipliedPixel[2] < 5, `multiply blend should combine red with blue as black (${multipliedPixel.join(',')})`);
  assert(blendOnlyPixel[0] > 245 && blendOnlyPixel[1] < 5 && blendOnlyPixel[2] < 5, `multiply blend should retain the unblended red area (${blendOnlyPixel.join(',')})`);
  const groupedBlendDocument = createDocument();
  const groupBackdrop = createNode('rectangle', { x: 4, y: 4, width: 32, height: 32, fill: '#0000ff' });
  const multiplyGroup = createNode('group', { x: 12, y: 12, width: 20, height: 20, blendMode: 'multiply' });
  const groupedRed = createNode('rectangle', { x: 0, y: 0, width: 20, height: 20, fill: '#ff0000' });
  addNode(groupedBlendDocument, groupBackdrop); addNode(groupedBlendDocument, multiplyGroup); addNode(groupedBlendDocument, groupedRed, { parentId: multiplyGroup.id });
  effectRenderer.getState = () => ({ document: groupedBlendDocument, assets: new Map(), previews: new Map(), zoom: 1, outlineMode: false, presenting: false });
  effectContext.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
  effectRenderer.drawNode(effectContext, groupBackdrop, 0, 0, new Map());
  effectRenderer.drawNode(effectContext, multiplyGroup, 0, 0, new Map());
  const groupedMultiplyPixel = [...effectContext.getImageData(16, 16, 1, 1).data];
  assert(groupedMultiplyPixel[0] < 5 && groupedMultiplyPixel[1] < 5 && groupedMultiplyPixel[2] < 5, `a group should blend as one isolated layer (${groupedMultiplyPixel.join(',')})`);

  result.textContent = `PASS\n${JSON.stringify({ importedImages: 3, pillowWasmPreview: true, sameLayerPixelChanged: true, pixelBefore: before, pixelAfter: after, recipeSave: true, multiImageApply: true, livePauseResume: true, speedWorkers: speed.value, inPlaceLayers: 3, layerClipboard: clipboardContract, portableDesignRoundTrip: true, localImageAssets: assetRecords.length, imageFill: true, imageFillClipping: true, imageFillContain: true, imageFillLocalWasmAdjustments: true, imageFillMobileTapTargets: true, layerBlendModes: true, multiplyBlend: true, groupBlend: true, prototypeConnection: true, smartAnimate: true, smartAnimateGradients: true, prototypeOverlay: true, prototypeSwapOverlay: true, prototypeBackAction: true, prototypeOpenLink: true, prototypeVariableMode: true, prototypeVariableCondition: true, numericConditionValidation: true, closeOverlay: true, startPoint: true, sharedColorStyles: true, reusableComponents: true, typedComponentProperties: ['BOOLEAN','TEXT','INSTANCE_SWAP','SLOT'], componentPropertyInspector: true, componentSlotPicker: true, componentSlotCancel: true, componentSlotMobileTargets: true, componentSlotReset: true, instancePropagation: true, instanceOverrides: true, instanceDetach: true, componentVariants: true, variantSwitch: true, presentNavigation: true, presentBack: true, bezierPen: true, closedVectorFill: true, vectorRegionPaint: true, vectorRegionPaintRendering: true, vectorRegionPaintMaskOpacity: true, ordinaryGroupUngroup: true, multiSelectionAlignment: true, bezierHandleEditing: true, bezierPreservingPointInsertion: true, mobileVectorPointControl: true, vectorPointDeletion: true, colorVariableModes: true, variableModeCreationUI: true, nestedFrameModeOverride: true, liveColorBinding: true, variableAssetsBinding: true, typedVariableValues: true, variableAliases: true, typedVariableBindings: ['radius','text','visible'], autoLayoutVariableBindings: ['columnGap','padding','grid'], letterSpacingTracking: true, gridAutoLayout: true, liveBooleanOperations: ['union','subtract','intersect','exclude'], booleanTransparentCutout: true, hitTestingThroughBooleanCutout: true, booleanSourceEditing: true, booleanSeparate: true, editableMaskGroups: true, maskAlphaPreview: true, maskRelease: true, dropShadow: true, layerBlur: true, linearGradient: true, radialGradient: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
