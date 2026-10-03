const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 30000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { if (await test()) { resolve(); return; } } catch { /* Wait for app state and local processing to settle. */ }
      if (performance.now() - start > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 25);
    };
    void poll();
  });
}
function click(app, element, options = {}) {
  assert(element, 'Expected an editor control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }));
}
function setInput(app, input, value) {
  assert(input, 'Expected the editor input to be available.');
  input.value = String(value);
  input.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}
function fixtureBmp() {
  const width = 64; const height = 32; const pixels = width * height * 3;
  const bytes = new Uint8Array(54 + pixels); const view = new DataView(bytes.buffer);
  bytes[0] = 66; bytes[1] = 77;
  view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, width, true); view.setInt32(22, height, true);
  view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, pixels, true);
  let offset = 54;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const left = x < width / 2;
    bytes[offset++] = left ? 32 : 224;
    bytes[offset++] = left ? 72 : 148;
    bytes[offset++] = left ? 208 : 48;
  }
  return bytes;
}
function addImages(app, files) {
  const input = app.querySelector('#image-input');
  const transfer = new app.defaultView.DataTransfer();
  for (const file of files) transfer.items.add(file);
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}
function readAll(app, storeName) {
  return new Promise((resolve, reject) => {
    const request = app.defaultView.indexedDB.open('figma-local-documents');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction(storeName).objectStore(storeName).getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  });
}
function imageNodes(doc) {
  return (doc?.pages || []).flatMap(page => page.children || []).filter(node => node.type === 'image');
}
async function documentWithLayer(app, layerId) {
  const records = await readAll(app, 'documents');
  return records.map(record => record.document).find(doc => imageNodes(doc).some(node => node.id === layerId));
}
async function contextMenuOnImage(app, imageId) {
  await waitFor(async () => imageNodes(await documentWithLayer(app, imageId)).some(node => node.id === imageId), 'saved image geometry');
  const image = imageNodes(await documentWithLayer(app, imageId)).find(node => node.id === imageId);
  const canvas = app.querySelector('#scene-canvas');
  const rect = canvas.getBoundingClientRect();
  const transform = canvas.getContext('2d').getTransform();
  const pixelRatio = canvas.width / rect.width;
  const zoom = transform.a / pixelRatio;
  const panX = transform.e / pixelRatio;
  const panY = transform.f / pixelRatio;
  canvas.dispatchEvent(new app.defaultView.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2,
    clientX: rect.left + panX + (image.x + image.width / 2) * zoom,
    clientY: rect.top + panY + (image.y + image.height / 2) * zoom
  }));
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  const onboarding = app.querySelector('#workspace-onboarding-dialog');
  if (onboarding?.open) {
    Object.defineProperty(app.defaultView, 'showDirectoryPicker', { configurable: true, value: undefined });
    const browserFallback = app.querySelector('#workspace-onboarding-browser-fallback');
    assert(browserFallback, 'The isolated editor did not expose browser-storage onboarding.');
    browserFallback.hidden = false;
    click(app, browserFallback);
    await waitFor(() => !onboarding.open, 'browser-storage workspace');
  }

  click(app, app.querySelector('#file-menu-button'));
  const newDesign = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('New design'));
  assert(newDesign, 'The File menu did not offer a new design.');
  click(app, newDesign);
  await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('New local design created.'), 'fresh design');
  await waitFor(() => app.querySelectorAll('#layers-list .layer-row[data-layer-id]').length === 0, 'empty design');

  const imageCount = 2;
  const bytes = fixtureBmp();
  const files = Array.from({ length: imageCount }, (_, index) => new app.defaultView.File(
    [bytes], `long-fashion-editorial-retouch-session-reference-${'source-name-with-many-words-'.repeat(5)}${index + 1}.bmp`,
    { type: 'image/bmp' }
  ));
  assert(files.every(file => file.name.length > 100), 'The test images must have names long enough to exercise truncation.');
  addImages(app, files);
  await waitFor(() => app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]').length === imageCount, 'long-named images');
  const layerIds = [...app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]')].map(row => row.dataset.layerId);
  assert(layerIds.length === imageCount, 'The imported image layers were not available.');

  const sourceId = layerIds[0];
  click(app, app.querySelector(`#layers-list .layer-row[data-layer-id="${sourceId}"]`));
  setInput(app, app.querySelector('[data-prop="adjustments.brightness"]'), -65);
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'edited image preview');
  await contextMenuOnImage(app, sourceId);
  click(app, [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim().includes('Save image recipe')));
  const dialog = app.querySelector('#recipe-dialog');
  await waitFor(() => dialog?.open, 'save recipe dialog');
  const recipeName = app.querySelector('#recipe-name').value;
  assert(recipeName.length <= 60 && recipeName.endsWith('… look'), 'The suggested name should be shortened but recognizable and saveable.');
  setInput(app, app.querySelector('#recipe-format'), 'webp');
  setInput(app, app.querySelector('#recipe-quality'), 73);
  click(app, app.querySelector('#save-recipe-confirm'));
  await waitFor(() => !dialog.open, 'save dialog close');
  await waitFor(async () => (await documentWithLayer(app, sourceId))?.recipes?.some(recipe => recipe.name === recipeName), 'recipe persistence');

  click(app, app.querySelector('#layer-select-mode'));
  const targetIds = layerIds;
  for (const id of targetIds) {
    const row = app.querySelector(`#layers-list .layer-row[data-layer-id="${id}"]`);
    if (!row.classList.contains('is-selected')) click(app, row);
  }
  assert(app.querySelectorAll('#layers-list .layer-row.is-selected[data-layer-type="image"]').length === imageCount,
    'The long-named image layers could not be multi-selected.');
  const before = await documentWithLayer(app, sourceId);
  const sourceAssets = Object.fromEntries(targetIds.map(id => [id, imageNodes(before).find(node => node.id === id)?.assetId]));
  await contextMenuOnImage(app, targetIds[0]);
  assert(app.querySelector('#context-menu .menu-label')?.textContent.trim() === `Apply recipe to ${imageCount} images`,
    'The canvas menu did not retain the multi-image selection.');
  const applyAction = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim() === recipeName);
  assert(applyAction, 'The saved recipe was missing from the image context menu.');
  click(app, applyAction);
  assert(!app.querySelector('#bulk-bar').hidden, 'Applying the recipe should show the in-place progress bar.');
  await waitFor(() => app.querySelector('#bulk-title')?.textContent === 'Recipe applied'
    && app.querySelector('#bulk-progress-label')?.textContent === `${imageCount} / ${imageCount}`,
  'long-name recipe batch completion');
  await waitFor(async () => {
    const doc = await documentWithLayer(app, sourceId);
    const nodes = imageNodes(doc);
    return targetIds.every(id => {
      const node = nodes.find(item => item.id === id);
      return node?.adjustments?.brightness === -65 && node.outputFormat === 'webp' && node.outputQuality === 73;
    });
  }, 'saved in-place recipe outputs');
  const after = await documentWithLayer(app, sourceId);
  assert(targetIds.every(id => imageNodes(after).find(node => node.id === id)?.assetId === sourceAssets[id]),
    'Applying a visual recipe should preserve each long-named image’s own source asset.');
  assert(targetIds.every(id => imageNodes(after).some(node => node.id === id)), 'Applying the recipe should keep the original image layer IDs.');

  result.textContent = `PASS\n${JSON.stringify({ imageNamesOver100Characters: true, recipeSaved: true, recipeNameLength: recipeName.length, rightClickBulkApply: true, inPlaceLayersPreserved: true, sourceAssetsPreserved: true, outputFormat: 'webp', updatedImages: imageCount })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
