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

  app.defaultView.prompt = () => 'Smoke button';
  const mainFrameRow = app.querySelector(`[data-layer-id="${destinationFrame.id}"]`);
  dispatchClick(mainFrameRow);
  dispatchClick(app.querySelector('[data-action="create-component"]'));
  await waitFor(() => app.querySelector('#components-list [data-component-id]'), 'component creation and asset listing');
  const componentId = app.querySelector('#components-list [data-component-id]').dataset.componentId;
  const instanceButton = app.querySelector('[data-action="create-component-instance"]');
  assert(instanceButton?.dataset.componentId === componentId, 'component inspector did not expose instance creation');
  dispatchClick(instanceButton);
  await waitFor(() => app.querySelectorAll('.layer-row[data-layer-id]').length === 6, 'component instance creation');
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

  dispatchClick(app.querySelector('#present-button'));
  await waitFor(() => app.querySelector('#present-dialog')?.open && app.querySelector('#present-title')?.textContent === sourceFrame.name, 'local prototype presentation');
  const presentCanvas = app.querySelector('#present-canvas');
  dispatchCanvasPointer(app, presentCanvas, 'pointerup', presentCanvas.getBoundingClientRect().left + presentCanvas.clientWidth / 2, presentCanvas.getBoundingClientRect().top + presentCanvas.clientHeight / 2, 84);
  await waitFor(() => !app.querySelector('#present-back')?.disabled, 'prototype navigation and history');
  dispatchClick(app.querySelector('#present-back'));
  assert(app.querySelector('#present-back').disabled, 'prototype back did not restore the start frame');
  dispatchClick(app.querySelector('#present-exit'));
  await waitFor(() => !app.querySelector('#present-dialog').open, 'prototype presentation exit');
  result.textContent = `PASS\n${JSON.stringify({ importedImages: 3, pillowWasmPreview: true, sameLayerPixelChanged: true, pixelBefore: before, pixelAfter: after, recipeSave: true, multiImageApply: true, livePauseResume: true, speedWorkers: speed.value, inPlaceLayers: 3, portableDesignRoundTrip: true, localImageAssets: assetRecords.length, prototypeConnection: true, startPoint: true, sharedColorStyles: true, reusableComponents: true, instancePropagation: true, instanceOverrides: true, instanceDetach: true, presentNavigation: true, presentBack: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
