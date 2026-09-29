import { addNode, addVariableMode, bindColorVariable, createColorVariable, createDocument, createNode, createVariableCollection, getNodeColor, resolveVariableValue, setColorVariableValue } from '../src/model.js';
import { vectorSegmentPoint } from '../src/vector-path.js';

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

  let selectedRow = app.querySelector('.layer-row.is-selected[data-layer-id]');
  assert(selectedRow, 'the imported image layer was not selected');
  dispatchContextMenu(selectedRow);
  const saveRecipeItem = [...app.querySelectorAll('#context-menu button')].find(item => item.textContent.includes('Save image recipe'));
  assert(saveRecipeItem, 'image context menu did not offer recipe saving');
  dispatchClick(saveRecipeItem);
  const dialog = app.querySelector('#recipe-dialog');
  assert(dialog.open, 'the save-recipe dialog did not open');
  app.querySelector('#recipe-name').value = 'Local red recipe';
  dispatchClick(app.querySelector('#save-recipe-confirm'));
  await waitFor(() => !dialog.open && app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'recipe save');

  for (let index = 0; index < 3; index += 1) {
    const row = app.querySelectorAll('.layer-row[data-layer-id]')[index];
    dispatchClick(row, { ctrlKey: index > 0 });
  }
  assert(app.querySelectorAll('.layer-row.is-selected[data-layer-id]').length === 3, 'multi-select did not retain all target images');
  selectedRow = app.querySelector('.layer-row.is-selected[data-layer-id]');
  dispatchContextMenu(selectedRow);
  const recipeItem = [...app.querySelectorAll('#context-menu button')].find(item => item.textContent.trim() === 'Local red recipe');
  assert(recipeItem, 'selected-image context menu did not show the saved recipe');
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
  const documentRecords = await readStore('documents'); documentRecords.sort((a, b) => b.savedAt - a.savedAt);
  const current = documentRecords[0]?.document;
  assert(current?.recipes.some(item => item.name === 'Local red recipe'), 'the saved recipe was not persisted with the design');
  const assetRecords = await readStore('assets');
  const packaged = buildPackage(current, assetRecords);
  const openInput = app.querySelector('#open-file-input'); const fileTransfer = new DataTransfer();
  fileTransfer.items.add(new File([packaged], 'local-design-roundtrip.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(openInput, 'files', { configurable: true, value: fileTransfer.files });
  openInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(item => item.textContent.includes('Local design opened')), 'portable design import');
  await waitFor(() => app.querySelectorAll('.layer-row').length === 3 && app.querySelectorAll('#assets-list .asset-card').length === 3, 'portable image-layer restore');

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
  transition.value = 'dissolve'; transition.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchClick(app.querySelector('[data-action="prototype-connect"]'));
  const targetX = canvasRect.left + panCenter.x + 550;
  const targetY = canvasRect.top + panCenter.y;
  dispatchCanvasPointer(app, designCanvas, 'pointerdown', targetX, targetY, 83);
  dispatchCanvasPointer(app, designCanvas, 'pointerup', targetX, targetY, 83);
  await waitFor(() => app.querySelector('.prototype-interaction-row')?.textContent.includes(destinationFrame.name), 'frame interaction connection');

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
  const overlayPosition = app.querySelector('#prototype-overlay-position');
  overlayPosition.value = 'center'; overlayPosition.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchClick(app.querySelector('[data-action="prototype-connect"]'));
  dispatchCanvasPointer(app, designCanvas, 'pointerdown', overlayX, overlayY, 85);
  dispatchCanvasPointer(app, designCanvas, 'pointerup', overlayX, overlayY, 85);
  await waitFor(() => app.querySelector('.prototype-interaction-row')?.textContent.includes('Open overlay'), 'prototype overlay connection');

  dispatchClick(app.querySelector(`[data-layer-id="${overlayFrame.id}"]`));
  actionSelect = app.querySelector('#prototype-action');
  actionSelect.value = 'close-overlay'; actionSelect.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchClick(app.querySelector('[data-action="prototype-connect"]'));
  await waitFor(() => app.querySelector('.prototype-interaction-row')?.textContent.includes('Close overlay'), 'close overlay interaction');

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
  dispatchClick(mainFrameRow);
  dispatchClick(app.querySelector('[data-action="create-component"]'));
  await waitFor(() => app.querySelector('#components-list [data-component-id]'), 'component creation and asset listing');
  const componentId = app.querySelector('#components-list [data-component-id]').dataset.componentId;
  const instanceButton = app.querySelector('[data-action="create-component-instance"]');
  assert(instanceButton?.dataset.componentId === componentId, 'component inspector did not expose instance creation');
  dispatchClick(instanceButton);
  await waitFor(() => app.querySelectorAll('.layer-row[data-layer-id]').length === 7, 'component instance creation');
  const instanceRow = app.querySelector('.layer-row.is-selected[data-layer-id]');
  const instanceId = instanceRow?.dataset.layerId;
  assert(instanceId && instanceId !== destinationFrame.id, 'the component instance has no independent layer identity');

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
  await waitFor(() => app.querySelectorAll('.layer-row[data-layer-id]').length === 8, 'variant set instance creation');
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
    .filter(row => row.textContent.trim() === 'Vector').map(row => row.dataset.layerId));
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
    return row?.textContent.trim() === 'Vector' && !vectorIdsBeforePen.has(row.dataset.layerId);
  }, 'multi-point Bézier pen path');
  await new Promise(resolve => setTimeout(resolve, 450));
  let vectorRecords = await readStore('documents'); vectorRecords.sort((a, b) => b.savedAt - a.savedAt);
  let vectorDocument = vectorRecords[0]?.document;
  let vectorNodes = flattenNodes(vectorDocument?.pages.flatMap(page => page.children));
  const selectedVectorRow = app.querySelector('.layer-row.is-selected[data-layer-id]');
  const vectorNode = vectorNodes.find(node => node.id === selectedVectorRow?.dataset.layerId);
  assert(vectorNode?.points.length === 3 && vectorNode.points[1].out?.y, 'pen tool did not create and preserve a cubic Bézier segment');
  const newlyAddedPaths = vectorNodes.filter(node => node.type === 'path' && !vectorIdsBeforePen.has(node.id));
  assert(newlyAddedPaths.filter(node => !node.componentSourceId).length === 1, 'one pen session must create one authored path; its linked component copies may add mirrored layers');

  const vectorLayerRow = app.querySelector(`[data-layer-id="${vectorNode.id}"]`);
  dispatchClick(vectorLayerRow);
  const closePath = app.querySelector('[data-prop="closed"]');
  assert(closePath, 'selected vector did not expose its closed-path control');
  closePath.checked = true; closePath.dispatchEvent(new Event('input', { bubbles: true })); closePath.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 450));
  vectorRecords = await readStore('documents'); vectorRecords.sort((a, b) => b.savedAt - a.savedAt);
  vectorDocument = vectorRecords[0]?.document;
  const savedVector = flattenNodes(vectorDocument?.pages.flatMap(page => page.children)).find(node => node.id === vectorNode.id);
  assert(savedVector?.closed === true, 'closed-path fill behavior was not saved');

  const positionedVector = findNodeOrigin(vectorDocument.pages.flatMap(page => page.children), vectorNode.id);
  const editablePoint = positionedVector.node.points[1];
  const handleWorld = {
    x: positionedVector.x + (editablePoint.x + editablePoint.out.x) * positionedVector.node.width,
    y: positionedVector.y + (editablePoint.y + editablePoint.out.y) * positionedVector.node.height
  };
  const handleScreen = penScreenPoint(handleWorld);
  dispatchCanvasPointer(app, designCanvas, 'pointerdown', handleScreen.x, handleScreen.y, 94);
  dispatchCanvasPointer(app, designCanvas, 'pointermove', handleScreen.x + 18, handleScreen.y - 12, 94);
  dispatchCanvasPointer(app, designCanvas, 'pointerup', handleScreen.x + 18, handleScreen.y - 12, 94);
  await new Promise(resolve => setTimeout(resolve, 450));
  vectorRecords = await readStore('documents'); vectorRecords.sort((a, b) => b.savedAt - a.savedAt);
  vectorDocument = vectorRecords[0]?.document;
  const editedVector = flattenNodes(vectorDocument?.pages.flatMap(page => page.children)).find(node => node.id === vectorNode.id);
  assert(editedVector.points[1].out.y !== editablePoint.out.y, 'canvas Bézier handle editing did not update the path');

  const currentVector = findNodeOrigin(vectorDocument.pages.flatMap(page => page.children), vectorNode.id);
  const insertionWorld = vectorSegmentPoint(currentVector.node, 0, .42, { x: currentVector.x, y: currentVector.y });
  const insertionScreen = penScreenPoint(insertionWorld);
  designCanvas.dispatchEvent(new app.defaultView.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: insertionScreen.x, clientY: insertionScreen.y }));
  await waitFor(() => app.querySelector('#inspector-content')?.textContent.includes('4 points'), 'double-click vector point insertion');
  assert(app.querySelector('[data-action="delete-vector-point"]') && !app.querySelector('[data-action="delete-vector-point"]').disabled, 'inserted vector point was not selected for deletion');
  dispatchClick(app.querySelector('[data-action="delete-vector-point"]'));
  await waitFor(() => app.querySelector('#inspector-content')?.textContent.includes('3 points'), 'vector point inspector deletion');
  dispatchClick(app.querySelector('[data-action="insert-vector-point"]'));
  await waitFor(() => app.querySelector('#inspector-content')?.textContent.includes('4 points'), 'touch-friendly vector point insertion');
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' }));
  await waitFor(() => app.querySelector('#inspector-content')?.textContent.includes('3 points'), 'Backspace vector point deletion');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'vector point edits autosave');
  vectorRecords = await readStore('documents'); vectorRecords.sort((a, b) => b.savedAt - a.savedAt);
  vectorDocument = vectorRecords[0]?.document;
  const savedEditedPath = flattenNodes(vectorDocument?.pages.flatMap(page => page.children)).find(node => node.id === vectorNode.id);
  assert(savedEditedPath?.points.length === 3 && savedEditedPath.closed, 'vector point edits did not preserve the closed path on disk');

  const variablesDocument = createDocument();
  const brandColors = createVariableCollection(variablesDocument, 'Brand colors');
  brandColors.modes[0].name = 'Light';
  const lightMode = brandColors.modes[0];
  const darkMode = addVariableMode(variablesDocument, brandColors.id, 'Dark');
  const surfaceVariable = createColorVariable(variablesDocument, brandColors.id, 'Surface', '#f7f7f7');
  setColorVariableValue(variablesDocument, surfaceVariable.id, '#202124', darkMode.id);
  const themeFrame = createNode('frame', { name: 'Theme frame', width: 300, height: 210 });
  const nestedThemeFrame = createNode('frame', { name: 'Nested theme', x: 20, y: 20, width: 250, height: 160 });
  const variableSurface = createNode('rectangle', { name: 'Variable surface', x: 12, y: 12, width: 150, height: 80, fillVariableId: surfaceVariable.id });
  const variableHeading = createNode('text', { name: 'Variable heading', x: 12, y: 108, width: 180, height: 32, text: 'Local variables', textVariableId: surfaceVariable.id });
  addNode(variablesDocument, themeFrame);
  addNode(variablesDocument, nestedThemeFrame, { parentId: themeFrame.id });
  addNode(variablesDocument, variableSurface, { parentId: nestedThemeFrame.id });
  addNode(variablesDocument, variableHeading, { parentId: nestedThemeFrame.id });
  const variablesInput = app.querySelector('#open-file-input'); const variablesTransfer = new DataTransfer();
  variablesTransfer.items.add(new File([buildPackage(variablesDocument, [])], 'variables-smoke.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(variablesInput, 'files', { configurable: true, value: variablesTransfer.files });
  variablesInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(item => item.textContent.includes('Local design opened')), 'variable collection fixture import');
  dispatchClick(app.querySelector('[data-sidebar-tab="assets"]'));
  dispatchClick(app.querySelector(`.variable-mode-add[data-collection-id="${brandColors.id}"]`));
  assert(app.querySelector('#variable-dialog').open, 'adding a mode did not open the native variable dialog');
  app.querySelector('#variable-name').value = 'Contrast';
  dispatchClick(app.querySelector('#variable-save'));
  await waitFor(() => [...app.querySelectorAll(`[data-variable-default-mode="${brandColors.id}"] option`)].some(option => option.textContent === 'Contrast'), 'new variable mode');
  dispatchClick(app.querySelector('[data-sidebar-tab="layers"]'));
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

  result.textContent = `PASS\n${JSON.stringify({ importedImages: 3, pillowWasmPreview: true, sameLayerPixelChanged: true, pixelBefore: before, pixelAfter: after, recipeSave: true, multiImageApply: true, livePauseResume: true, speedWorkers: speed.value, inPlaceLayers: 3, portableDesignRoundTrip: true, localImageAssets: assetRecords.length, prototypeConnection: true, prototypeOverlay: true, closeOverlay: true, startPoint: true, sharedColorStyles: true, reusableComponents: true, instancePropagation: true, instanceOverrides: true, instanceDetach: true, componentVariants: true, variantSwitch: true, presentNavigation: true, presentBack: true, bezierPen: true, closedVectorFill: true, bezierHandleEditing: true, bezierPreservingPointInsertion: true, mobileVectorPointControl: true, vectorPointDeletion: true, colorVariableModes: true, variableModeCreationUI: true, nestedFrameModeOverride: true, liveColorBinding: true, variableAssetsBinding: true, typedVariableValues: true, variableAliases: true, liveBooleanOperations: ['union','subtract','intersect','exclude'], booleanTransparentCutout: true, hitTestingThroughBooleanCutout: true, booleanSourceEditing: true, booleanSeparate: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
