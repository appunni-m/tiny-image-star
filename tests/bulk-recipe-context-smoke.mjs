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
  const originPageId = app.querySelector('#pages-list [data-page-id]')?.dataset.pageId;
  assert(originPageId, 'The new design did not expose its starting page.');
  click(app, app.querySelector('#add-page'));
  await waitFor(() => app.querySelectorAll('#pages-list [data-page-id]').length === 2, 'second page creation');
  const otherPageId = [...app.querySelectorAll('#pages-list [data-page-id]')]
    .map(row => row.dataset.pageId).find(id => id !== originPageId);
  assert(otherPageId, 'The new design did not expose its second page.');
  click(app, app.querySelector(`#pages-list [data-page-id="${originPageId}"]`));
  await waitFor(() => app.querySelector(`#pages-list [data-page-id="${originPageId}"]`)?.getAttribute('aria-selected') === 'true', 'starting page selection');

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

  // Hold an unrelated third image render so the second batch render queues in
  // the shared engine behind it. Pause must hold that queued recipe job even
  // after the unrelated render and the first recipe render finish.
  assert(layerIds.length === IMAGE_COUNT, 'The initial image rows were not available for the scoped pause check.');
  const targetLayerIds = layerIds.slice(0, 2);
  workerGate.hold = true;
  click(app, app.querySelector(`#layers-list .layer-row[data-layer-id="${layerIds[2]}"]`));
  setInput(app, app.querySelector('[data-prop="adjustments.brightness"]'), 17);
  // The batch speed readout is not mounted until a recipe job starts, so the
  // worker count cannot be observed through the progress bar yet. A held
  // render response proves the unrelated job occupies its engine worker.
  await waitFor(() => workerGate.held.length >= 1 && workerGate.workerCount >= 1,
    'unrelated image preview to occupy a worker');

  click(app, app.querySelector('#layer-select-mode'));
  click(app, app.querySelector(`#layers-list .layer-row[data-layer-id="${layerIds[2]}"]`));
  for (const id of targetLayerIds) {
    const row = app.querySelector(`#layers-list .layer-row[data-layer-id="${id}"]`);
    if (!row.classList.contains('is-selected')) click(app, row);
  }
  assert(app.querySelectorAll('#layers-list .layer-row.is-selected[data-layer-type="image"]').length === targetLayerIds.length,
    'The multi-selection did not contain the two recipe targets.');
  const originalLayerIds = [...app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]')]
    .map(row => row.dataset.layerId);

  const speed = app.querySelector('#bulk-speed');
  const workerBudget = Number(speed.max);
  assert(Number.isSafeInteger(workerBudget) && workerBudget > 0, 'The progress bar reported an invalid worker budget.');
  const batchStart = workerGate.submissions.length;
  canvasContextMenu(app);
  const menuLabel = app.querySelector('#context-menu .menu-label')?.textContent.trim();
  assert(menuLabel === `Apply recipe to ${targetLayerIds.length} images`,
    `The canvas context menu lost the multi-selection (${menuLabel || 'no target label'}).`);
  const applyAction = [...app.querySelectorAll('#context-menu button')]
    .find(button => button.textContent.trim() === 'Desktop context recipe');
  assert(applyAction, 'The canvas context menu did not offer the saved recipe.');
  click(app, applyAction);

  const bulkBar = app.querySelector('#bulk-bar');
  assert(!bulkBar.hidden, 'Applying from the canvas menu did not show the in-place progress bar.');
  assert(app.querySelector('#bulk-progress-label').textContent === `0 / ${targetLayerIds.length}`,
    'The progress bar did not start at zero with the correct target count.');
  assert(app.querySelector('#bulk-rate')?.textContent.trim(), 'The in-place progress bar did not show a speed/ETA status.');
  assert(app.querySelector('#bulk-title').textContent.includes('Desktop context recipe'),
    'The progress bar did not identify the active recipe.');
  assert([...app.querySelectorAll('#inspector-content input, #inspector-content select, #inspector-content textarea, #inspector-content button')]
    .every(control => control.disabled),
  'The inspector should lock selected recipe targets while the batch owns their edits.');
  assert(app.querySelector('#bulk-speed').min === '1' && Number(app.querySelector('#bulk-speed').max) === workerBudget,
    'The live speed slider did not expose the browser worker budget.');
  const startConcurrency = Math.min(2, workerBudget);
  const activeBatchRenders = Math.max(0, startConcurrency - 1);
  await waitFor(() => workerGate.held.length >= startConcurrency && activeWorkers(app) === startConcurrency
    && workerGate.submissions.length - batchStart === activeBatchRenders,
  'recipe work to queue behind the unrelated preview under the reported worker budget');

  click(app, app.querySelector('#bulk-pause'));
  await waitFor(() => app.querySelector('#bulk-title')?.textContent === 'Processing paused', 'recipe batch pause');
  assert(app.querySelector('#bulk-rate')?.textContent.startsWith('Paused ·'), 'The progress rate did not enter its paused state.');
  await waitFor(async () => {
    const nodes = imageNodes(await latestDocument(app));
    return targetLayerIds.every(id => nodes.find(node => node.id === id)?.adjustments?.brightness === -65);
  }, 'admitted recipe values to persist before their held worker outputs settle');
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert(app.querySelector('#bulk-title')?.textContent === 'Processing paused'
    && !app.querySelector('#bulk-cancel')?.hidden,
  'Escape should leave the paused batch available to resume or cancel explicitly.');
  click(app, app.querySelector(`#pages-list [data-page-id="${otherPageId}"]`));
  await waitFor(() => app.querySelector(`#pages-list [data-page-id="${otherPageId}"]`)?.getAttribute('aria-selected') === 'true', 'page switch during paused recipe batch');
  releaseResults(workerGate);
  await waitFor(() => activeWorkers(app) === 0 && app.querySelector('#bulk-subtitle')?.textContent.includes('1 admitted image'),
    'active previews to drain while the queued batch render stays held');
  const pausedSubmissions = workerGate.submissions.length;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert(workerGate.submissions.length === pausedSubmissions,
    'The paused progress bar dispatched a recipe render that was already queued in the image engine.');
  assert(app.querySelector('#bulk-progress-label').textContent !== `${targetLayerIds.length} / ${targetLayerIds.length}`,
    'The test paused after the batch had already completed.');

  speed.value = String(workerBudget);
  speed.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  assert(app.querySelector('#bulk-speed-value').textContent.includes(`${workerBudget} max worker`),
    'Changing the paused speed control did not update its live worker readout.');
  workerGate.hold = false;
  click(app, app.querySelector('#bulk-pause'));
  await waitFor(() => app.querySelector('#bulk-title')?.textContent === 'Recipe applied'
    && app.querySelector('#bulk-progress-label')?.textContent === `${targetLayerIds.length} / ${targetLayerIds.length}`,
  'resumed recipe batch completion');
  assert(/^(Complete · .*average|Complete · no timed renders)$/.test(app.querySelector('#bulk-rate')?.textContent || ''),
    'The completed recipe bar did not show its final average processing speed.');
  assert(app.querySelector('#bulk-speed-value')?.title.startsWith(`Engine limit: ${startConcurrency} worker`),
    'Completing the batch should restore the image engine’s pre-batch worker limit.');
  click(app, app.querySelector(`#pages-list [data-page-id="${originPageId}"]`));
  await waitFor(() => app.querySelector(`#pages-list [data-page-id="${originPageId}"]`)?.getAttribute('aria-selected') === 'true'
    && app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]').length === IMAGE_COUNT,
  'original recipe page after page switch');

  assert(app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]').length === IMAGE_COUNT,
    'Recipe processing replaced or dropped the original image layers.');
  const currentLayerIds = [...app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]')]
    .map(row => row.dataset.layerId);
  assert(JSON.stringify(currentLayerIds) === JSON.stringify(originalLayerIds),
    'Recipe processing changed the original image layer identities or ordering.');
  await waitFor(async () => {
    const nodes = imageNodes(await latestDocument(app));
    return nodes.length === IMAGE_COUNT
      && targetLayerIds.every(id => nodes.find(node => node.id === id)?.adjustments?.brightness === -65)
      && nodes.find(node => node.id === layerIds[2])?.adjustments?.brightness === 17;
  }, 'persisted in-place image recipe results');
  click(app, app.querySelector('#bulk-done'));
  await waitFor(() => app.querySelector('#bulk-bar')?.hidden, 'multi-image recipe result dismissal');

  // A target can disappear after its worker has accepted the request. Its
  // eventual aborted preview must be counted as unavailable, not as a newer
  // user edit that should be retried.
  const layerSelectionMode = app.querySelector('#layer-select-mode');
  if (layerSelectionMode?.getAttribute('aria-pressed') === 'true') click(app, layerSelectionMode);
  await waitFor(() => layerSelectionMode?.getAttribute('aria-pressed') === 'false', 'single-image selection mode');
  click(app, app.querySelector(`#layers-list .layer-row[data-layer-id="${layerIds[2]}"]`));
  await waitFor(() => app.querySelector('[data-action="apply-image-recipe"]'), 'single-image recipe action');
  const picker = app.querySelector('#selection-image-recipe');
  picker.value = (await latestDocument(app)).recipes.find(recipe => recipe.name === 'Desktop context recipe')?.id;
  assert(picker.value, 'The saved recipe was not available for the removed-target check.');
  workerGate.hold = true;
  const heldBeforeRemoval = workerGate.held.length;
  click(app, app.querySelector('[data-action="apply-image-recipe"]'));
  await waitFor(() => workerGate.held.length > heldBeforeRemoval, 'removed-target recipe render admission');
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  await waitFor(() => !app.querySelector(`#layers-list .layer-row[data-layer-id="${layerIds[2]}"]`), 'recipe target deletion');
  workerGate.hold = false;
  releaseResults(workerGate);
  await waitFor(() => app.querySelector('#bulk-title')?.textContent === 'Recipe finished · unavailable images skipped'
    && app.querySelector('#bulk-progress-label')?.textContent === '1 / 1'
    && app.querySelector('#bulk-subtitle')?.textContent.includes('1 removed or unavailable skipped'),
  'deleted recipe target to settle as skipped');
  click(app, app.querySelector('#bulk-done'));
  await waitFor(() => app.querySelector('#bulk-bar')?.hidden, 'removed-target result dismissal');

  result.textContent = `PASS\n${JSON.stringify({
    workflow: 'right-click save → multi-select → canvas right-click apply',
    images: IMAGE_COUNT,
    recipeTargets: targetLayerIds.length,
    savedRecipe: true,
    canvasMenuKeptMultiSelection: true,
    progressBar: true,
    pauseHeldQueuedBatchWork: true,
    escapeKeepsBatchActive: true,
    liveSpeedControl: workerBudget,
    restoredEngineConcurrency: startConcurrency,
    resumeCompletedAll: true,
    pageSwitchPreservedBatch: true,
    updatedInPlace: true,
    originalLayerIdsPreserved: true,
    deletedAdmittedTargetSkipped: true
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
