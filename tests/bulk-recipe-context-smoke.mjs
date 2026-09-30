const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const IMAGE_COUNT = 3;

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 30000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { if (await test()) { resolve(); return; } } catch { /* Wait for editor startup and async local image work. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 25);
    };
    void poll();
  });
}
function click(app, element, options = {}) {
  assert(element, 'Expected a control in the editor.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }));
}
function contextMenu(app, element) {
  assert(element, 'Expected an image layer for the context menu.');
  element.dispatchEvent(new app.defaultView.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: 180, clientY: 160
  }));
}
function canvasContextMenu(app) {
  const canvas = app.querySelector('#scene-canvas');
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new app.defaultView.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2,
    clientX: rect.left + rect.width / 2 + 32,
    clientY: rect.top + rect.height / 2 + 24
  }));
}
function setInput(app, input, value) {
  assert(input, 'The selected image did not expose its brightness adjustment.');
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
async function latestDocument(app) {
  const records = await readAll(app, 'documents');
  records.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return records[0]?.document;
}
function imageNodes(doc) {
  return (doc?.pages || []).flatMap(page => page.children || []).filter(node => node.type === 'image');
}
function installWorkerGate(app) {
  const prototype = app.defaultView.Worker.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'postMessage');
  assert(descriptor?.value, 'Could not observe local image worker messages.');
  const nativePostMessage = descriptor.value;
  const knownWorkers = new WeakSet();
  const indexes = new WeakMap();
  const gate = { hold: false, workerCount: 0, submissions: [], rendered: [], held: [], restore: null };
  Object.defineProperty(prototype, 'postMessage', {
    ...descriptor,
    value(message, transfer) {
      if (!knownWorkers.has(this)) {
        knownWorkers.add(this);
        const worker = this;
        const index = ++gate.workerCount;
        indexes.set(worker, index);
        const handler = worker.onmessage;
        assert(typeof handler === 'function', 'The local image worker did not attach its message handler.');
        worker.onmessage = event => {
          const response = event.data;
          if (response?.type !== 'rendered') { handler.call(worker, event); return; }
          gate.rendered.push({ assetId: response.assetId, requestId: response.requestId, worker: index });
          if (!gate.hold) { handler.call(worker, event); return; }
          gate.held.push({
            assetId: response.assetId, requestId: response.requestId, worker: index,
            deliver: () => handler.call(worker, { data: response })
          });
        };
      }
      if (message?.type === 'render') gate.submissions.push({ assetId: message.assetId, requestId: message.requestId, worker: indexes.get(this) });
      return nativePostMessage.call(this, message, transfer);
    }
  });
  gate.restore = () => Object.defineProperty(prototype, 'postMessage', descriptor);
  return gate;
}
function releaseResults(gate) {
  while (gate.held.length) gate.held.shift().deliver();
}
function activeWorkers(app) {
  const match = app.querySelector('#bulk-speed-value')?.textContent.match(/(\d+) active/);
  return match ? Number(match[1]) : -1;
}

let workerGate;
try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  workerGate = installWorkerGate(app);

  click(app, app.querySelector('#file-menu-button'));
  const newDesign = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('New design'));
  assert(newDesign, 'The File menu did not offer a new local design.');
  click(app, newDesign);
  await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('New local design created.'), 'fresh design');
  await waitFor(() => app.querySelectorAll('#layers-list .layer-row[data-layer-id]').length === 0, 'empty design');

  const bytes = fixtureBmp();
  addImages(app, Array.from({ length: IMAGE_COUNT }, (_, index) =>
    new app.defaultView.File([bytes], `context-recipe-${index + 1}.bmp`, { type: 'image/bmp' })));
  await waitFor(() => app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]').length === IMAGE_COUNT,
    `${IMAGE_COUNT} imported images`);
  await waitFor(() => workerGate.rendered.length >= IMAGE_COUNT, 'initial image previews');

  const sourceRow = app.querySelector('#layers-list .layer-row[data-layer-type="image"]');
  const layerIds = [...app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]')].map(row => row.dataset.layerId);
  assert(sourceRow && layerIds.length === IMAGE_COUNT, 'The imported image rows were not available.');
  const sourceId = sourceRow.dataset.layerId;
  click(app, sourceRow);
  setInput(app, app.querySelector('[data-prop="adjustments.brightness"]'), -65);
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'),
    'edited source image preview');

  contextMenu(app, app.querySelector(`#layers-list .layer-row[data-layer-id="${sourceId}"]`));
  const saveAction = [...app.querySelectorAll('#context-menu button')]
    .find(button => button.textContent.trim().includes('Save image recipe'));
  assert(saveAction, 'Right-clicking the edited image did not offer recipe saving.');
  click(app, saveAction);
  const dialog = app.querySelector('#recipe-dialog');
  await waitFor(() => dialog?.open, 'save recipe dialog');
  app.querySelector('#recipe-name').value = 'Desktop context recipe';
  assert(app.querySelector('#recipe-preview-summary').textContent.includes('Brightness -65'),
    'The recipe dialog did not capture the edited image adjustment.');
  click(app, app.querySelector('#save-recipe-confirm'));
  await waitFor(() => !dialog.open, 'recipe dialog close');
  await waitFor(async () => (await latestDocument(app))?.recipes?.some(recipe => recipe.name === 'Desktop context recipe'),
    'saved context-menu recipe');

  click(app, app.querySelector('#layer-select-mode'));
  for (const id of layerIds) {
    const row = app.querySelector(`#layers-list .layer-row[data-layer-id="${id}"]`);
    if (!row.classList.contains('is-selected')) click(app, row);
  }
  assert(app.querySelectorAll('#layers-list .layer-row.is-selected[data-layer-type="image"]').length === IMAGE_COUNT,
    'The multi-selection did not contain every image target.');
  const originalRows = new Map([...app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]')]
    .map(row => [row.dataset.layerId, row]));

  const speed = app.querySelector('#bulk-speed');
  const workerBudget = Number(speed.max);
  assert(Number.isSafeInteger(workerBudget) && workerBudget > 0, 'The progress bar reported an invalid worker budget.');
  const batchStart = workerGate.submissions.length;
  workerGate.hold = true;
  canvasContextMenu(app);
  const menuLabel = app.querySelector('#context-menu .menu-label')?.textContent.trim();
  assert(menuLabel === `Apply recipe to ${IMAGE_COUNT} images`,
    `The canvas context menu lost the multi-selection (${menuLabel || 'no target label'}).`);
  const applyAction = [...app.querySelectorAll('#context-menu button')]
    .find(button => button.textContent.trim() === 'Desktop context recipe');
  assert(applyAction, 'The canvas context menu did not offer the saved recipe.');
  click(app, applyAction);

  const bulkBar = app.querySelector('#bulk-bar');
  assert(!bulkBar.hidden, 'Applying from the canvas menu did not show the in-place progress bar.');
  assert(app.querySelector('#bulk-progress-label').textContent === `0 / ${IMAGE_COUNT}`,
    'The progress bar did not start at zero with the correct target count.');
  assert(app.querySelector('#bulk-title').textContent.includes('Desktop context recipe'),
    'The progress bar did not identify the active recipe.');
  assert(app.querySelector('#bulk-speed').min === '1' && Number(app.querySelector('#bulk-speed').max) === workerBudget,
    'The live speed slider did not expose the browser worker budget.');
  const startConcurrency = Math.min(2, workerBudget);
  await waitFor(() => workerGate.held.length >= startConcurrency && activeWorkers(app) === startConcurrency,
    `${startConcurrency} in-flight recipe previews`);

  click(app, app.querySelector('#bulk-pause'));
  await waitFor(() => app.querySelector('#bulk-title')?.textContent === 'Processing paused', 'recipe batch pause');
  releaseResults(workerGate);
  await waitFor(() => activeWorkers(app) === 0 && app.querySelector('#bulk-subtitle')?.textContent.includes('0 images queued'),
    'in-flight previews to drain after pause');
  const pausedSubmissions = workerGate.submissions.length;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert(workerGate.submissions.length === pausedSubmissions,
    'The paused progress bar continued dispatching image renders.');
  assert(app.querySelector('#bulk-progress-label').textContent !== `${IMAGE_COUNT} / ${IMAGE_COUNT}`,
    'The test paused after the batch had already completed.');

  speed.value = String(workerBudget);
  speed.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  assert(app.querySelector('#bulk-speed-value').textContent.includes(`${workerBudget} max worker`),
    'Changing the paused speed control did not update its live worker readout.');
  workerGate.hold = false;
  click(app, app.querySelector('#bulk-pause'));
  await waitFor(() => app.querySelector('#bulk-title')?.textContent === 'Recipe applied'
    && app.querySelector('#bulk-progress-label')?.textContent === `${IMAGE_COUNT} / ${IMAGE_COUNT}`,
  'resumed recipe batch completion');

  assert(app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]').length === IMAGE_COUNT,
    'Recipe processing replaced or dropped the original image layers.');
  assert([...originalRows].every(([id, row]) => row.isConnected && row === app.querySelector(`#layers-list .layer-row[data-layer-id="${id}"]`)),
    'Recipe processing replaced the existing image rows instead of editing them in place.');
  await waitFor(async () => {
    const nodes = imageNodes(await latestDocument(app));
    return nodes.length === IMAGE_COUNT && nodes.every(node => layerIds.includes(node.id) && node.adjustments?.brightness === -65);
  }, 'persisted in-place image recipe results');

  result.textContent = `PASS\n${JSON.stringify({
    workflow: 'right-click save → multi-select → canvas right-click apply',
    images: IMAGE_COUNT,
    savedRecipe: true,
    canvasMenuKeptMultiSelection: true,
    progressBar: true,
    pauseDrainedWithoutDispatch: true,
    liveSpeedControl: workerBudget,
    resumeCompletedAll: true,
    updatedInPlace: true,
    originalLayerIdsPreserved: true
  })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  if (workerGate) {
    workerGate.hold = false;
    releaseResults(workerGate);
    workerGate.restore();
  }
}
