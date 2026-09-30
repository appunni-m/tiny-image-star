const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const BATCH_SIZE = 128;

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 30000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { if (await test()) { resolve(); return; } } catch { /* Wait for editor startup or IndexedDB state. */ }
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
  assert(element, 'Expected a layer row for the context menu.');
  element.dispatchEvent(new app.defaultView.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, clientX: 180, clientY: 160
  }));
}
function watchBulkUiRebuilds(app) {
  const targets = ['#layers-list', '#assets-list', '#components-list', '#component-library-list',
    '#variable-collections-list', '#color-styles-list', '#text-styles-list'];
  const watched = targets.map(selector => {
    const element = app.querySelector(selector);
    const original = Object.getOwnPropertyDescriptor(element, 'replaceChildren');
    const replaceChildren = element.replaceChildren;
    let rebuilds = 0;
    Object.defineProperty(element, 'replaceChildren', {
      configurable: true,
      value(...children) {
        rebuilds += 1;
        return replaceChildren.apply(this, children);
      }
    });
    return { selector, element, original, get rebuilds() { return rebuilds; } };
  });
  return {
    rows: new Map([...app.querySelectorAll('#layers-list .layer-row[data-layer-id]')].map(row => [row.dataset.layerId, row])),
    assetCards: new Map([...app.querySelectorAll('#assets-list .asset-card[data-layer-id]')].map(card => [card.dataset.layerId, card])),
    thumbnails: new Map([...app.querySelectorAll('#assets-list .asset-card[data-layer-id]')]
      .map(card => [card.dataset.layerId, card.querySelector('img')])),
    thumbnailSources: new Map([...app.querySelectorAll('#assets-list .asset-card[data-layer-id]')]
      .map(card => [card.dataset.layerId, card.querySelector('img')?.getAttribute('src')])),
    rebuildsFor(selector) { return watched.find(item => item.selector === selector)?.rebuilds || 0; },
    get allRebuilds() { return watched.reduce((total, item) => total + item.rebuilds, 0); },
    restore() {
      for (const item of watched) {
        if (item.original) Object.defineProperty(item.element, 'replaceChildren', item.original);
        else delete item.element.replaceChildren;
      }
    }
  };
}
function setInput(app, input, value) {
  assert(input, 'Expected an image adjustment field.');
  input.value = String(value);
  input.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}
function fixtureBmp() {
  const width = 64; const height = 32; const pixels = width * height * 3;
  const bytes = new Uint8Array(54 + pixels); const view = new DataView(bytes.buffer);
  bytes[0] = 66; bytes[1] = 77;
  view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, width, true); view.setInt32(22, height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, pixels, true);
  let offset = 54;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const left = x < width / 2;
    bytes[offset++] = left ? 32 : 224; bytes[offset++] = left ? 72 : 148; bytes[offset++] = left ? 208 : 48;
  }
  return bytes;
}
function addImages(app, files) {
  const input = app.querySelector('#image-input'); const transfer = new app.defaultView.DataTransfer();
  for (const file of files) transfer.items.add(file);
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}
function readStore(app, storeName) {
  return new Promise((resolve, reject) => {
    const request = app.defaultView.indexedDB.open('figma-local-documents');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction(storeName).objectStore(storeName).getAll();
      get.onsuccess = () => { resolve(get.result); db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  });
}
async function latestDocument(app) {
  const records = await readStore(app, 'documents');
  records.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return records[0]?.document;
}
function imageNodes(doc) {
  return (doc?.pages || []).flatMap(page => page.children || []).filter(node => node.type === 'image');
}
function installWorkerGate(app) {
  const WorkerConstructor = app.defaultView.Worker;
  const prototype = WorkerConstructor.prototype;
  const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, 'postMessage');
  assert(originalDescriptor?.value, 'Could not instrument the local image workers for the deterministic batch check.');
  const nativePostMessage = originalDescriptor.value;
  const seenWorkers = new WeakSet();
  const workerIndexes = new WeakMap();
  const gate = { hold: false, workerCount: 0, submissions: [], rendered: [], held: [], errors: [], events: [], restore: null };
  Object.defineProperty(prototype, 'postMessage', {
    ...originalDescriptor,
    value(message, transfer) {
      // The first cache configuration is sent only after the engine attaches
      // its message handler. Observe from that point onward, including the
      // response that decides whether a newly scaled worker can become ready.
      if (!seenWorkers.has(this)) {
        seenWorkers.add(this);
        const worker = this;
        const index = ++gate.workerCount;
        workerIndexes.set(worker, index);
        const handler = worker.onmessage;
        assert(typeof handler === 'function', 'The local image worker did not install its message handler before initialization.');
        worker.onmessage = event => {
          const response = event.data;
          gate.events.push({ worker: index, type: response?.type, generation: response?.generation, requestId: response?.requestId });
          if (response?.type === 'init-error' || response?.type === 'cache-config-error' || response?.type === 'error') {
            gate.errors.push({ worker: index, type: response.type, requestId: response.requestId, message: response.message });
          }
          if (response?.type !== 'rendered') { handler.call(worker, event); return; }
          gate.rendered.push({ assetId: response.assetId, requestId: response.requestId, worker: index });
          if (!gate.hold) { handler.call(worker, event); return; }
          gate.held.push({ assetId: response.assetId, requestId: response.requestId, worker: index,
            deliver: () => handler.call(worker, { data: response }) });
        };
      }
      if (message?.type === 'render') {
        gate.submissions.push({ assetId: message.assetId, requestId: message.requestId, worker: workerIndexes.get(this) });
      }
      return nativePostMessage.call(this, message, transfer);
    }
  });
  gate.restore = () => Object.defineProperty(prototype, 'postMessage', originalDescriptor);
  return gate;
}
function releaseResults(gate, count = Infinity) {
  for (let index = 0; index < count && gate.held.length; index += 1) gate.held.shift().deliver();
}
function activeWorkers(app) {
  const match = app.querySelector('#bulk-speed-value')?.textContent.match(/(\d+) active/);
  return match ? Number(match[1]) : -1;
}
function requestedWorkers(app) { return Number(app.querySelector('#bulk-speed')?.value); }
function assertWorkerAndMemoryBounds(app, label) {
  const active = activeWorkers(app); const requested = requestedWorkers(app);
  const cpuBudget = Number(app.querySelector('#bulk-speed')?.max);
  const memory = app.querySelector('#bulk-speed-value')?.title.match(/([\d,]+) of ([\d,]+) MiB/);
  assert(active >= 0 && active <= requested && requested <= cpuBudget,
    `${label} exceeded its worker bounds (${active} active, ${requested} requested, ${cpuBudget} CPU budget).`);
  assert(memory && Number(memory[1].replaceAll(',', '')) <= Number(memory[2].replaceAll(',', '')),
    `${label} exceeded the reported active-memory budget.`);
  return { active, requested, cpuBudget, activeRenderMiB: Number(memory[1].replaceAll(',', '')), budgetMiB: Number(memory[2].replaceAll(',', '')) };
}
function selectAllImages(app) {
  const mode = app.querySelector('#layer-select-mode');
  if (mode.getAttribute('aria-pressed') !== 'true') click(app, mode);
  const ids = [...app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]')].map(row => row.dataset.layerId);
  assert(ids.length === BATCH_SIZE, `Expected ${BATCH_SIZE} image rows, found ${ids.length}.`);
  for (const id of ids) {
    const row = app.querySelector(`#layers-list .layer-row[data-layer-id="${id}"]`);
    if (!row.classList.contains('is-selected')) click(app, row);
  }
  assert(app.querySelectorAll('#layers-list .layer-row.is-selected[data-layer-type="image"]').length === BATCH_SIZE,
    'Touch-style layer selection did not select every target image.');
  return ids.map(id => app.querySelector(`#layers-list .layer-row[data-layer-id="${id}"]`));
}
function startFromLayerMenu(app, row, recipeName) {
  contextMenu(app, row);
  const label = app.querySelector('#context-menu .menu-label')?.textContent.trim();
  assert(label === `Apply recipe to ${BATCH_SIZE} images`, `Context menu targeted the wrong selection: ${label || 'no batch label'}.`);
  const recipe = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim() === recipeName);
  assert(recipe, `The context menu did not offer “${recipeName}”.`);
  click(app, recipe);
}
async function saveRecipeFromSelected(app, recipeName, brightness, blur = null) {
  const field = app.querySelector('[data-prop="adjustments.brightness"]');
  assert(field, 'The selected image did not expose local image adjustments.');
  setInput(app, field, brightness);
  if (blur != null) setInput(app, app.querySelector('[data-prop="adjustments.blur"]'), blur);
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'),
    `brightness ${brightness} preview`);
  click(app, app.querySelector('[data-action="save-image-recipe"]'));
  const dialog = app.querySelector('#recipe-dialog');
  await waitFor(() => dialog?.open, 'recipe dialog');
  app.querySelector('#recipe-name').value = recipeName;
  click(app, app.querySelector('#save-recipe-confirm'));
  await waitFor(() => !dialog.open, 'recipe dialog close');
  await waitFor(async () => (await latestDocument(app))?.recipes?.some(recipe => recipe.name === recipeName),
    `saved recipe ${recipeName}`);
}

let workerGateForCleanup = null;
let layerTreeProbeForCleanup = null;
try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  const workerGate = installWorkerGate(app);
  workerGateForCleanup = workerGate;
  click(app, app.querySelector('#file-menu-button'));
  const newDesign = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('New design'));
  assert(newDesign, 'The file menu did not offer a new local design.');
  click(app, newDesign);
  await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('New local design created.'), 'fresh local design switch');
  await waitFor(() => app.querySelectorAll('#layers-list .layer-row[data-layer-id]').length === 0, 'fresh empty design');
  await waitFor(async () => imageNodes(await latestDocument(app)).length === 0, 'saved blank design before fixture import');

  const source = fixtureBmp();
  addImages(app, Array.from({ length: BATCH_SIZE }, (_, index) => new app.defaultView.File([source], `scale-image-${String(index).padStart(3, '0')}.bmp`, { type: 'image/bmp' })));
  await waitFor(() => app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]').length === BATCH_SIZE, `${BATCH_SIZE} imported images`);
  try {
    await waitFor(() => workerGate.rendered.length >= BATCH_SIZE, 'all initial image previews');
  } catch (error) {
    const diagnostics = {
      workerCount: workerGate.workerCount,
      renderSubmissions: workerGate.submissions.length,
      renderedResponses: workerGate.rendered.length,
      workerEvents: workerGate.events.slice(-80),
      workerFailures: workerGate.errors,
      imageStatus: [...app.querySelectorAll('.image-engine-status')].map(element => element.textContent.trim())
    };
    error.stack = `${error.stack || error.message}\nDiagnostics: ${JSON.stringify(diagnostics)}`;
    throw error;
  }
  await waitFor(async () => imageNodes(await latestDocument(app)).length === BATCH_SIZE, 'saved image layers');
  const firstDoc = await latestDocument(app);
  const initialNodes = imageNodes(firstDoc);
  assert(initialNodes.length === BATCH_SIZE, `IndexedDB saved ${initialNodes.length} image layers, expected ${BATCH_SIZE}.`);
  const assetIds = initialNodes.map(node => node.assetId);
  const originalLayerIds = new Set(initialNodes.map(node => node.id));
  const uniqueAssetIds = new Set(assetIds);
  assert(uniqueAssetIds.size === BATCH_SIZE, 'The imported targets did not have unique source assets.');
  const lastImageId = initialNodes.at(-1).id;
  click(app, app.querySelector(`[data-layer-id="${lastImageId}"]`));
  await saveRecipeFromSelected(app, 'Scale recipe', -55, 24);

  const mode = app.querySelector('#layer-select-mode');
  if (mode.getAttribute('aria-pressed') !== 'true') click(app, mode);
  const layerTreeProbe = watchBulkUiRebuilds(app);
  layerTreeProbeForCleanup = layerTreeProbe;
  const selectedRows = selectAllImages(app);
  assert(layerTreeProbe.rebuildsFor('#layers-list') === 0
    && selectedRows.every(row => row.isConnected && row.classList.contains('is-selected')
      && row.getAttribute('aria-selected') === 'true' && layerTreeProbe.rows.get(row.dataset.layerId) === row),
  'Selecting a large image set should update existing layer rows in place.');
  const selectionPanelRebuilds = layerTreeProbe.allRebuilds;
  const initialWorkerBudget = Number(app.querySelector('#bulk-speed').max);
  assert(Number.isSafeInteger(initialWorkerBudget) && initialWorkerBudget > 0, 'The worker slider reported an invalid CPU budget.');
  // Keep the live scale-up bounded to three workers in browser CI: the suite
  // reports up to eight logical CPUs, but spinning up one WASM runtime per
  // logical CPU is an unnecessarily brittle environment/resource assumption.
  const liveConcurrencyTarget = Math.min(3, initialWorkerBudget);
  const batchStart = workerGate.submissions.length;
  const batchResultStart = workerGate.rendered.length;
  const batchErrorStart = workerGate.errors.length;
  workerGate.hold = true;
  startFromLayerMenu(app, selectedRows[0], 'Scale recipe');
  const initialConcurrency = Math.min(2, initialWorkerBudget);
  try {
    await waitFor(() => workerGate.held.length >= initialConcurrency && activeWorkers(app) === initialConcurrency,
      `${initialConcurrency} held workers in the running batch`);
  } catch (error) {
    const diagnostics = {
      heldCount: workerGate.held.length,
      heldAssets: workerGate.held.map(item => item.assetId),
      renderedSinceBatchStart: workerGate.rendered.length - batchResultStart,
      renderedWorkersSinceBatchStart: workerGate.rendered.slice(batchResultStart).map(item => item.worker),
      submittedSinceBatchStart: workerGate.submissions.length - batchStart,
      submittedWorkersSinceBatchStart: workerGate.submissions.slice(batchStart).map(item => item.worker),
      activeWorkers: activeWorkers(app),
      requestedWorkers: requestedWorkers(app),
      cpuWorkerBudget: initialWorkerBudget,
      workerCount: workerGate.workerCount,
      workerEvents: workerGate.events.slice(-60),
      workerFailuresSinceBatchStart: workerGate.errors.slice(batchErrorStart),
      progress: app.querySelector('#bulk-progress-label')?.textContent.trim(),
      bulkTitle: app.querySelector('#bulk-title')?.textContent.trim(),
      bulkSubtitle: app.querySelector('#bulk-subtitle')?.textContent.trim(),
      failureToasts: app.querySelector('#toast-region')?.textContent.trim()
    };
    error.stack = `${error.stack || error.message}\nDiagnostics: ${JSON.stringify(diagnostics)}`;
    throw error;
  }
  assert(new Set(workerGate.held.map(item => item.worker)).size >= initialConcurrency,
    'The initial batch concurrency did not occupy distinct image workers.');
  const initialBounds = assertWorkerAndMemoryBounds(app, 'Initial batch workers');

  let concurrencyEvidence = { initialConcurrency, loweredToOne: false, raisedToWorkerTarget: false };
  if (initialWorkerBudget >= 2) {
    const slider = app.querySelector('#bulk-speed');
    slider.value = '1'; slider.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
    await waitFor(() => requestedWorkers(app) === 1, 'live worker decrease control');
    releaseResults(workerGate, 1);
    try {
      await waitFor(() => activeWorkers(app) === 1, 'in-flight worker count to drain to the lower limit');
    } catch (error) {
      const diagnostics = {
        heldCount: workerGate.held.length,
        activeWorkers: activeWorkers(app),
        requestedWorkers: requestedWorkers(app),
        cpuWorkerBudget: initialWorkerBudget,
        workerCount: workerGate.workerCount,
        submittedSinceBatchStart: workerGate.submissions.length - batchStart,
        renderedSinceBatchStart: workerGate.rendered.length - batchResultStart,
        workerEvents: workerGate.events.slice(-60),
        workerFailuresSinceBatchStart: workerGate.errors.slice(batchErrorStart),
        progress: app.querySelector('#bulk-progress-label')?.textContent.trim(),
        bulkTitle: app.querySelector('#bulk-title')?.textContent.trim(),
        bulkSubtitle: app.querySelector('#bulk-subtitle')?.textContent.trim(),
        failureToasts: app.querySelector('#toast-region')?.textContent.trim(),
        engineStatus: [...app.querySelectorAll('.image-engine-status')]
          .map(element => element.textContent.trim()).filter(text => /fail|error/i.test(text))
      };
      error.stack = `${error.stack || error.message}\nDiagnostics: ${JSON.stringify(diagnostics)}`;
      throw error;
    }
    const lowBounds = assertWorkerAndMemoryBounds(app, 'Reduced batch workers');
    concurrencyEvidence.loweredToOne = true;
    concurrencyEvidence.lowBounds = lowBounds;

    slider.value = String(liveConcurrencyTarget);
    slider.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
    try {
      await waitFor(() => workerGate.held.length >= liveConcurrencyTarget && activeWorkers(app) === liveConcurrencyTarget,
        `live worker increase to ${liveConcurrencyTarget} workers`);
    } catch (error) {
      const batchSubmissions = workerGate.submissions.slice(batchStart);
      const batchResults = workerGate.rendered.slice(batchResultStart);
      const visibleFailures = [...app.querySelectorAll('.image-engine-status')]
        .map(element => element.textContent.trim()).filter(text => /fail|error/i.test(text));
      const diagnostics = {
        heldCount: workerGate.held.length,
        heldAssets: workerGate.held.map(item => item.assetId),
        activeWorkers: activeWorkers(app),
        requestedWorkers: requestedWorkers(app),
        cpuWorkerBudget: initialWorkerBudget,
        workerCount: workerGate.workerCount,
        submittedSinceBatchStart: batchSubmissions.length,
        submittedAssets: batchSubmissions.map(item => item.assetId),
        renderedSinceBatchStart: batchResults.length,
        renderedAssets: batchResults.map(item => item.assetId),
        workerEvents: workerGate.events.slice(-60),
        workerFailuresSinceBatchStart: workerGate.errors.slice(batchErrorStart),
        progress: app.querySelector('#bulk-progress-label')?.textContent.trim(),
        bulkTitle: app.querySelector('#bulk-title')?.textContent.trim(),
        bulkSubtitle: app.querySelector('#bulk-subtitle')?.textContent.trim(),
        failureToasts: app.querySelector('#toast-region')?.textContent.trim(),
        visibleFailureStatuses: visibleFailures
      };
      // Error.stack is materialized when the error is created, so changing only
      // error.message does not expose the added diagnostics in the result pane.
      error.stack = `${error.stack || error.message}\nDiagnostics: ${JSON.stringify(diagnostics)}`;
      throw error;
    }
    assert(new Set(workerGate.held.map(item => item.worker)).size >= liveConcurrencyTarget,
      'The scaled-up batch concurrency did not occupy distinct image workers.');
    concurrencyEvidence.highBounds = assertWorkerAndMemoryBounds(app, 'Raised batch workers');
    concurrencyEvidence.liveConcurrencyTarget = liveConcurrencyTarget;
    concurrencyEvidence.raisedToWorkerTarget = true;
  } else {
    concurrencyEvidence.note = 'Single-CPU browser budget exposes no higher worker setting.';
  }

  releaseResults(workerGate, 1);
  await waitFor(() => {
    const match = app.querySelector('#bulk-progress-label')?.textContent.match(/^(\d+) \/ (\d+)$/);
    return match && Number(match[1]) > 0 && Number(match[1]) < Number(match[2]);
  }, 'live batch progress after a rendered image');
  const realtimeProgress = app.querySelector('#bulk-progress-label').textContent;
  click(app, app.querySelector('#bulk-pause'));
  await waitFor(() => app.querySelector('#bulk-title')?.textContent === 'Processing paused', 'batch pause');
  releaseResults(workerGate);
  await waitFor(() => activeWorkers(app) === 0 && app.querySelector('#bulk-subtitle')?.textContent.includes('0 images queued'),
    'paused batch in-flight work to drain');
  const pausedProgress = app.querySelector('#bulk-progress-label').textContent;
  const pausedSubmissions = workerGate.submissions.length;
  await new Promise(resolve => setTimeout(resolve, 160));
  assert(app.querySelector('#bulk-title')?.textContent === 'Processing paused', 'The batch left paused state while work was being drained.');
  assert(workerGate.submissions.length === pausedSubmissions, 'The paused batch dispatched additional image work.');
  assert(pausedProgress !== `${BATCH_SIZE} / ${BATCH_SIZE}`, 'The pause regression ran after the batch had already completed.');

  workerGate.hold = false;
  click(app, app.querySelector('#bulk-pause'));
  await waitFor(() => app.querySelector('#bulk-title')?.textContent === 'Recipe applied'
    && app.querySelector('#bulk-progress-label')?.textContent === `${BATCH_SIZE} / ${BATCH_SIZE}`, 'resumed batch completion');
  const completedSubmissions = workerGate.submissions.slice(batchStart);
  const completedResults = workerGate.rendered.slice(batchResultStart);
  const submittedCounts = new Map();
  for (const job of completedSubmissions) submittedCounts.set(job.assetId, (submittedCounts.get(job.assetId) || 0) + 1);
  assert(completedSubmissions.length === BATCH_SIZE, `The batch dispatched ${completedSubmissions.length} renders, expected ${BATCH_SIZE}.`);
  assert(submittedCounts.size === BATCH_SIZE && [...submittedCounts.values()].every(count => count === 1),
    'The batch submitted duplicate images or skipped a selected image.');
  assert(assetIds.every(assetId => submittedCounts.get(assetId) === 1), 'A selected source asset did not receive exactly one recipe render.');
  const completedResultCounts = new Map();
  for (const render of completedResults) completedResultCounts.set(render.assetId, (completedResultCounts.get(render.assetId) || 0) + 1);
  assert(completedResults.length === BATCH_SIZE && assetIds.every(assetId => completedResultCounts.get(assetId) === 1),
    'The rendered results were not unique and complete for the selected images.');
  const submittedRequestByAsset = new Map(completedSubmissions.map(job => [job.assetId, job.requestId]));
  assert(completedResults.every(render => submittedRequestByAsset.get(render.assetId) === render.requestId),
    'A rendered result did not match the unique worker request submitted for its source image.');
  assert(app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]').length === BATCH_SIZE,
    'Recipe processing replaced or dropped original image layers.');
  assert(layerTreeProbe.allRebuilds === 0,
    `Bulk completion rebuilt layer or asset panels ${layerTreeProbe.allRebuilds} times for ${BATCH_SIZE} images (layers: ${layerTreeProbe.rebuildsFor('#layers-list')}, asset/library sections: ${layerTreeProbe.rebuildsFor('#assets-list') + layerTreeProbe.rebuildsFor('#components-list') + layerTreeProbe.rebuildsFor('#component-library-list') + layerTreeProbe.rebuildsFor('#variable-collections-list') + layerTreeProbe.rebuildsFor('#color-styles-list') + layerTreeProbe.rebuildsFor('#text-styles-list')}).`);
  const firstBatchPanelRebuilds = {
    total: layerTreeProbe.allRebuilds,
    layerTree: layerTreeProbe.rebuildsFor('#layers-list'),
    assetAndLibrarySections: layerTreeProbe.allRebuilds - layerTreeProbe.rebuildsFor('#layers-list')
  };
  assert(selectedRows.every(row => row.isConnected && row.classList.contains('is-selected')
    && layerTreeProbe.rows.get(row.dataset.layerId) === row),
  'Bulk completion replaced layer rows or lost the existing multi-image selection.');
  assert(selectedRows.every(row => {
    const id = row.dataset.layerId;
    const image = layerTreeProbe.thumbnails.get(id);
    return layerTreeProbe.assetCards.get(id)?.isConnected
      && layerTreeProbe.assetCards.get(id) === app.querySelector(`#assets-list .asset-card[data-layer-id="${id}"]`)
      && image?.isConnected && image === layerTreeProbe.assetCards.get(id)?.querySelector('img')
      && image.getAttribute('src') && image.getAttribute('src') !== layerTreeProbe.thumbnailSources.get(id);
  }), 'Bulk recipe previews should update each existing asset thumbnail in place without replacing the asset cards.');
  await waitFor(async () => {
    const nodes = imageNodes(await latestDocument(app));
    return nodes.length === BATCH_SIZE && nodes.every(node => originalLayerIds.has(node.id)
      && node.adjustments?.brightness === -55 && node.adjustments?.blur === 24);
  }, 'persisted results for every image layer');

  // A second, distinct recipe makes cancellation observable: only the images
  // already in flight may receive it; the remaining selected images stay at -55.
  const modeForCancel = app.querySelector('#layer-select-mode');
  if (modeForCancel.getAttribute('aria-pressed') === 'true') click(app, modeForCancel);
  const speed = app.querySelector('#bulk-speed');
  speed.value = String(initialConcurrency);
  speed.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  await waitFor(() => requestedWorkers(app) === initialConcurrency, 'reset worker count before cancellation');
  const cancelSourceId = initialNodes[0].id;
  click(app, app.querySelector(`[data-layer-id="${cancelSourceId}"]`));
  await saveRecipeFromSelected(app, 'Cancel recipe', -82);
  const beforeCancelSelectionRebuilds = {
    total: layerTreeProbe.allRebuilds,
    layerTree: layerTreeProbe.rebuildsFor('#layers-list')
  };
  const cancelRows = selectAllImages(app);
  const cancelSelectionRebuilds = {
    total: layerTreeProbe.allRebuilds - beforeCancelSelectionRebuilds.total,
    layerTree: layerTreeProbe.rebuildsFor('#layers-list') - beforeCancelSelectionRebuilds.layerTree
  };
  const cancelStart = workerGate.submissions.length;
  workerGate.hold = true;
  startFromLayerMenu(app, cancelRows[0], 'Cancel recipe');
  await waitFor(() => workerGate.held.length >= initialConcurrency && activeWorkers(app) === initialConcurrency,
    'cancel batch in-flight renders');
  click(app, app.querySelector('#bulk-cancel'));
  assert(app.querySelector('#bulk-title')?.textContent === 'Recipe stopped', 'The cancel control did not mark the active batch stopped.');
  await waitFor(() => {
    // A worker can post its last result between the cancel click and the first
    // release pass; keep draining until both the engine and gate are quiescent.
    releaseResults(workerGate);
    return app.querySelector('#bulk-title')?.textContent === 'Recipe stopped'
      && activeWorkers(app) === 0 && workerGate.held.length === 0;
  }, 'cancelled batch worker cleanup');
  const cancelledSubmissions = workerGate.submissions.slice(cancelStart);
  assert(cancelledSubmissions.length === initialConcurrency,
    `Cancel dispatched ${cancelledSubmissions.length} renders; expected only ${initialConcurrency} already-in-flight renders.`);
  assert(workerGate.held.length === 0, `Cancelled batch left withheld worker results behind: ${JSON.stringify({
    held: workerGate.held.map(item => ({ assetId: item.assetId, requestId: item.requestId, worker: item.worker })),
    activeWorkers: activeWorkers(app), submittedSinceCancel: cancelledSubmissions.length,
    workerEvents: workerGate.events.slice(-30)
  })}`);
  const changedAssets = new Set(cancelledSubmissions.map(job => job.assetId));
  assert(changedAssets.size === initialConcurrency, 'The cancelled batch had duplicate or missing in-flight target assets.');
  await waitFor(async () => {
    const nodes = imageNodes(await latestDocument(app));
    const byAsset = new Map(nodes.map(node => [node.assetId, node]));
    return nodes.length === BATCH_SIZE && nodes.every(node => originalLayerIds.has(node.id)) && assetIds.every(assetId =>
      byAsset.get(assetId)?.adjustments?.brightness === (changedAssets.has(assetId) ? -82 : -55)
        && byAsset.get(assetId)?.adjustments?.blur === 24);
  }, 'cancelled batch to persist completed in-flight targets only');
  const afterCancel = imageNodes(await latestDocument(app));
  assert(afterCancel.filter(node => node.adjustments?.brightness === -82).length === initialConcurrency,
    'Cancellation committed a recipe to an image that had not already been in flight.');
  assert(assetIds.every(assetId => changedAssets.has(assetId)
    ? afterCancel.find(node => node.assetId === assetId)?.adjustments?.brightness === -82
    : afterCancel.find(node => node.assetId === assetId)?.adjustments?.brightness === -55),
  'Cancellation did not leave in-flight and not-yet-started targets in their expected states.');

  result.textContent = `PASS\n${JSON.stringify({
    images: BATCH_SIZE,
    selectionPanelRebuilds,
    firstBatchPanelRebuilds,
    cancellationSelectionRebuilds: cancelSelectionRebuilds,
    selectedRowsPreservedDuringBatch: true,
    recipeContextMenuTargets: BATCH_SIZE,
    uniqueSubmittedAndRenderedResults: true,
    cpuWorkerBudget: initialWorkerBudget,
    concurrencyEvidence,
    initialBounds,
    realtimeProgress,
    pauseDrainedWithoutDispatch: true,
    resumeCompletedAll: true,
    cancelDrainedWithoutDispatch: true,
    cancelledInFlightPreserved: initialConcurrency,
    originalImageLayersPreserved: true,
    persistedRecipeResults: true
  })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  if (layerTreeProbeForCleanup) layerTreeProbeForCleanup.restore();
  if (workerGateForCleanup) {
    workerGateForCleanup.hold = false;
    releaseResults(workerGateForCleanup);
    workerGateForCleanup.restore();
  }
}
