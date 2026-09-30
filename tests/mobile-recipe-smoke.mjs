const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { if (await test()) { resolve(); return; } } catch { /* Wait for app startup or an asynchronous image render. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    poll();
  });
}
function tap(app, element) {
  assert(element, 'Expected a mobile recipe control.');
  const Pointer = app.defaultView.PointerEvent;
  if (Pointer) {
    element.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true, pointerId: 21, pointerType: 'touch', button: 0 }));
    element.dispatchEvent(new Pointer('pointerup', { bubbles: true, cancelable: true, pointerId: 21, pointerType: 'touch', button: 0 }));
  }
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function setInput(app, input, value) {
  assert(input, 'Expected a mobile recipe input.');
  input.value = String(value);
  input.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
}
function setInspectorInput(app, selector, value) {
  const input = app.querySelector(selector);
  assert(input, `Expected recipe regression input ${selector}.`);
  input.value = String(value);
  input.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}
function fixtureBmp() {
  const width = 64; const height = 32; const pixels = width * height * 3;
  const bytes = new Uint8Array(54 + pixels); const view = new DataView(bytes.buffer);
  bytes[0] = 66; bytes[1] = 77; view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, width, true); view.setInt32(22, height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, pixels, true);
  let offset = 54;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const left = x < width / 2;
    bytes[offset++] = left ? 30 : 230; bytes[offset++] = left ? 65 : 145; bytes[offset++] = left ? 210 : 40;
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
function readDocuments(app) {
  return new Promise((resolve, reject) => {
    const request = app.defaultView.indexedDB.open('figma-local-documents', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const get = db.transaction('documents').objectStore('documents').getAll();
      get.onsuccess = () => { resolve(get.result); db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  });
}
function sampleUntouchedSecondImage(app) {
  const canvas = app.querySelector('#scene-canvas'); const rect = canvas.getBoundingClientRect();
  const scale = app.defaultView.devicePixelRatio || 1;
  // The imported layers fan out by 24px. This point is inside the second
  // image and above the third (topmost) image, so the pre-batch pixel remains
  // an untouched target even after the recipe source has been edited.
  const x = Math.round((rect.width / 2 + 32) * scale); const y = Math.round((rect.height / 2 + 16) * scale);
  return [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];
}
function assertTouchTarget(app, element, label, minimum = 40) {
  const box = element.getBoundingClientRect();
  assert(box.width >= minimum && box.height >= minimum, `${label} should provide a ${minimum}px touch target (got ${Math.round(box.width)}x${Math.round(box.height)}).`);
  assert(box.left >= 0 && box.right <= 390, `${label} should fit inside the 390px viewport.`);
}
function waitForPhonePanel(app, selector, side) {
  const panel = app.querySelector(selector);
  return waitFor(() => side === 'left' ? panel.getBoundingClientRect().left >= -1 : panel.getBoundingClientRect().right <= 391, `${side} phone panel opening`);
}
function assertReachable(app, element, label) {
  const box = element.getBoundingClientRect();
  const hit = app.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  assert(hit === element || element.contains(hit), `${label} should be reachable at its visible touch center.`);
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  assert(app.defaultView.innerWidth === 390 && app.defaultView.innerHeight === 844, 'the workflow should run at a 390×844 phone viewport.');
  assert(app.title === 'Tiny Image Star', 'the editor should use the Tiny Image Star product name.');
  for (const [toggleSelector, panelSelector] of [['#sidebar-toggle', '#left-panel'], ['#inspector-toggle', '#right-panel']]) {
    const toggle = app.querySelector(toggleSelector); const panel = app.querySelector(panelSelector);
    assert(toggle.getAttribute('aria-controls') === panel.id && toggle.getAttribute('aria-expanded') === 'false', `${toggleSelector} should identify its closed panel accessibly.`);
    assert(panel.inert && panel.getAttribute('aria-hidden') === 'true', `${panelSelector} should be removed from keyboard and screen-reader navigation while closed.`);
    const firstControl = panel.querySelector('button:not(:disabled)');
    firstControl.focus();
    assert(app.activeElement !== firstControl, `${panelSelector} controls should not accept focus while the panel is closed.`);
  }

  tap(app, app.querySelector('#main-menu-button'));
  const newDesign = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('New design'));
  assert(newDesign, 'the mobile main menu should offer a fresh local design.');
  tap(app, newDesign);
  await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('New local design created.'), 'new local design switch');
  await waitFor(() => app.querySelectorAll('.layer-row[data-layer-id]').length === 0, 'fresh design');

  tap(app, app.querySelector('#sidebar-toggle'));
  await waitForPhonePanel(app, '#left-panel', 'left');
  const leftPanel = app.querySelector('#left-panel'); const leftToggle = app.querySelector('#sidebar-toggle');
  assert(!leftPanel.inert && leftPanel.getAttribute('aria-hidden') === 'false' && leftToggle.getAttribute('aria-expanded') === 'true', 'opening Layers should expose the panel and synchronize its toggle state.');
  assert(leftPanel.contains(app.activeElement), 'opening a mobile panel should move focus inside it.');
  const escape = new app.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  app.activeElement.dispatchEvent(escape);
  assert(escape.defaultPrevented, 'Escape should dismiss an open phone panel.');
  assert(leftPanel.inert && leftPanel.getAttribute('aria-hidden') === 'true' && leftToggle.getAttribute('aria-expanded') === 'false', 'Escape should hide the panel from navigation and reset its expanded state.');
  assert(app.activeElement === leftToggle, 'closing with Escape should restore focus to the panel toggle.');

  tap(app, leftToggle);
  await waitForPhonePanel(app, '#left-panel', 'left');
  tap(app, app.querySelector('#inspector-toggle'));
  await waitForPhonePanel(app, '#right-panel', 'right');
  const rightPanel = app.querySelector('#right-panel'); const rightToggle = app.querySelector('#inspector-toggle');
  assert(leftPanel.inert && leftToggle.getAttribute('aria-expanded') === 'false', 'opening Properties should close and disable the Layers panel.');
  assert(!rightPanel.inert && rightToggle.getAttribute('aria-expanded') === 'true' && rightPanel.contains(app.activeElement), 'opening Properties should expose it and move focus inside.');
  app.querySelector('#mobile-scrim').click();
  assert(rightPanel.inert && rightPanel.getAttribute('aria-hidden') === 'true' && rightToggle.getAttribute('aria-expanded') === 'false', 'the scrim should close Properties and remove it from navigation.');
  assert(app.activeElement === rightToggle, 'closing with the scrim should restore focus to the Properties toggle.');

  tap(app, leftToggle);
  await waitForPhonePanel(app, '#left-panel', 'left');
  tap(app, app.querySelector('[data-sidebar-tab="assets"]'));
  tap(app, app.querySelector('#add-variable-collection'));
  app.querySelector('#variable-name').value = 'Phone colors';
  tap(app, app.querySelector('#variable-save'));
  await waitFor(() => app.querySelector('.variable-collection-card'), 'phone variable collection');
  const collectionId = app.querySelector('[data-action="add-variable"]').dataset.collectionId;
  tap(app, app.querySelector(`[data-action="add-variable"][data-collection-id="${collectionId}"]`));
  app.querySelector('#variable-name').value = 'Accent';
  tap(app, app.querySelector('#variable-save'));
  await waitFor(() => app.querySelector('.variable-value'), 'phone variable value editor');
  for (const [selector, label] of [
    ['.variable-mode-add', 'Variable mode button'],
    ['.variable-apply', 'Variable apply button'],
    ['.variable-alias', 'Variable alias selector'],
    ['.variable-value', 'Variable value editor'],
    ['.variable-remove', 'Variable delete button'],
  ]) assertTouchTarget(app, app.querySelector(selector), label, 40);
  tap(app, app.querySelector('[data-sidebar-tab="layers"]'));
  tap(app, app.querySelector('#sidebar-toggle'));

  const source = fixtureBmp();
  const importToasts = [];
  try {
    addImages(app, Array.from({ length: 3 }, (_, index) => new app.defaultView.File([source], `phone-image-${index + 1}.bmp`, { type: 'image/bmp' })));
    await waitFor(() => {
      const message = app.querySelector('#toast-region')?.textContent?.trim();
      if (message) importToasts.push(message);
      return app.querySelectorAll('.layer-row[data-layer-id]').length === 3;
    }, 'three imported images');
  }
  catch (error) { throw new Error(`${error.message} (observed import errors: ${importToasts.join(' | ') || 'none'})`); }
  tap(app, app.querySelector('#sidebar-toggle'));
  await waitForPhonePanel(app, '#left-panel', 'left');
  const imageIds = [...app.querySelectorAll('.layer-row[data-layer-id]')].map(row => row.dataset.layerId);
  // Layer rows are stacked in reverse insertion order, so save the recipe from
  // the first import while the pixel assertion below samples the third import.
  tap(app, app.querySelector(`[data-layer-id="${imageIds[2]}"]`));
  tap(app, app.querySelector('#inspector-toggle'));
  await waitForPhonePanel(app, '#right-panel', 'right');
  const brightness = app.querySelector('[data-prop="adjustments.brightness"]');
  assert(brightness, 'the selected phone image should expose local WASM adjustments.');
  setInput(app, brightness, -65);
  brightness.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updating preview'), 'scheduled source preview');
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'source image preview');
  const sharpness = app.querySelector('[data-prop="adjustments.sharpness"]');
  assert(sharpness, 'the selected phone image should expose Pillow-RS sharpness.');
  setInput(app, sharpness, 40);
  sharpness.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'phone sharpness preview');
  const cropLeft = app.querySelector('[data-image-transform-field="left"][data-image-transform-target="layer"]');
  assert(cropLeft, 'the phone image inspector should expose normalized crop bounds.');
  assertTouchTarget(app, cropLeft, 'Crop left control', 34);
  setInput(app, cropLeft, 20);
  cropLeft.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  const rotateRight = app.querySelector('[data-action="rotate-image"][data-direction="right"][data-transform-target="layer"]');
  assertTouchTarget(app, rotateRight, 'Rotate right control');
  tap(app, rotateRight);
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'cropped and rotated source preview');
  await waitFor(() => sampleUntouchedSecondImage(app)[3] > 0, 'untouched batch target preview');
  const beforeBatch = sampleUntouchedSecondImage(app);

  const saveRecipe = app.querySelector('[data-action="save-image-recipe"]');
  assertTouchTarget(app, saveRecipe, 'Save recipe action');
  tap(app, saveRecipe);
  const dialog = app.querySelector('#recipe-dialog');
  assert(dialog?.open, 'Save recipe should open from the image inspector without a context menu.');
  assert(app.querySelector('#recipe-preview-summary').textContent.includes('Crop') && app.querySelector('#recipe-preview-summary').textContent.includes('Rotate 90°')
    && app.querySelector('#recipe-preview-summary').textContent.includes('Sharpness 40'), 'the recipe preview should describe sharpness, crop, and rotation.');
  app.querySelector('#recipe-name').value = 'Phone batch look';
  tap(app, app.querySelector('#save-recipe-confirm'));
  await waitFor(() => !dialog.open, 'recipe save dialog');
  await waitFor(async () => {
    const records = await readDocuments(app); records.sort((a, b) => b.savedAt - a.savedAt);
    return records[0]?.document?.recipes?.some(recipe => recipe.name === 'Phone batch look');
  }, 'saved local recipe');

  tap(app, app.querySelector('#sidebar-toggle'));
  await waitForPhonePanel(app, '#left-panel', 'left');
  const selectMode = app.querySelector('#layer-select-mode');
  assertTouchTarget(app, selectMode, 'Layer selection mode');
  tap(app, selectMode);
  assert(selectMode.getAttribute('aria-pressed') === 'true', 'the mobile layer selection mode should report pressed state.');
  for (const id of imageIds) {
    const row = app.querySelector(`[data-layer-id="${id}"]`);
    if (!row.classList.contains('is-selected')) tap(app, row);
  }
  assert(app.querySelectorAll('.layer-row.is-selected[data-layer-id]').length === 3, 'three image layers should be selectable by touch taps alone, without keyboard modifiers.');

  tap(app, app.querySelector('#inspector-toggle'));
  await waitForPhonePanel(app, '#right-panel', 'right');
  const recipePicker = app.querySelector('#selection-image-recipe');
  const applyRecipe = app.querySelector('[data-action="apply-selection-image-recipe"]');
  assert(recipePicker && [...recipePicker.options].some(option => option.textContent.trim() === 'Phone batch look'), 'the multi-image inspector should expose the saved recipe picker on a phone.');
  assertTouchTarget(app, recipePicker, 'Recipe picker');
  assertTouchTarget(app, applyRecipe, 'Apply selected recipe');
  recipePicker.value = [...recipePicker.options].find(option => option.textContent.trim() === 'Phone batch look').value;
  recipePicker.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  tap(app, applyRecipe);
  const bulkBar = app.querySelector('#bulk-bar');
  assert(!bulkBar.hidden, 'the recipe action should open the in-place processing bar immediately.');
  const initialBatchProgress = app.querySelector('#bulk-progress-label').textContent;
  tap(app, applyRecipe);
  assert(app.querySelector('#toast-region')?.textContent.includes('batch is active'), 'a second recipe request must clearly explain that the current batch remains active.');
  assert(app.querySelector('#bulk-progress-label').textContent === initialBatchProgress, 'a rejected overlapping start must preserve the in-flight batch progress.');
  assert(bulkBar.getBoundingClientRect().left >= 0 && bulkBar.getBoundingClientRect().right <= 390, 'the bulk controls should stay inside the phone viewport.');
  assertTouchTarget(app, app.querySelector('#bulk-pause'), 'Pause control');
  assertTouchTarget(app, app.querySelector('#bulk-cancel'), 'Cancel control');
  assert(!app.querySelector('#left-panel').classList.contains('is-open') && !app.querySelector('#right-panel').classList.contains('is-open'), 'applying a recipe should close both mobile panels so the bulk bar is unobstructed.');
  assert(!app.querySelector('#mobile-scrim').classList.contains('is-visible'), 'applying a recipe should dismiss the mobile scrim.');
  assertReachable(app, app.querySelector('#bulk-pause'), 'Pause control');
  assertReachable(app, app.querySelector('#bulk-cancel'), 'Cancel control');
  const speedControl = app.querySelector('.speed-control');
  const speedBox = speedControl.getBoundingClientRect();
  assert(speedBox.height >= 40 && speedBox.left >= 0 && speedBox.right <= 390, 'the speed control should be touch-sized and fit the phone viewport.');

  tap(app, app.querySelector('#bulk-pause'));
  assert(app.querySelector('#bulk-title')?.textContent === 'Processing paused', 'the bulk bar should pause immediately.');
  const speed = app.querySelector('#bulk-speed');
  setInput(app, speed, Math.min(3, Number(speed.max)));
  assert(app.querySelector('#bulk-speed-value').textContent.includes('worker'), 'the live speed value should update to the selected worker count.');
  tap(app, app.querySelector('#bulk-pause'));
  await waitFor(() => app.querySelector('#bulk-title')?.textContent === 'Recipe applied' && app.querySelector('#bulk-progress-label')?.textContent === '3 / 3', 'in-place recipe completion');
  const afterBatch = sampleUntouchedSecondImage(app);
  assert(afterBatch[0] < beforeBatch[0] - 20, `the recipe should render into the existing image layer (${beforeBatch.join(',')} → ${afterBatch.join(',')}).`);
  assert(app.querySelectorAll('.layer-row[data-layer-id]').length === 3, 'bulk processing should preserve the three original layer rows.');
  await waitFor(async () => {
    const stored = await readDocuments(app); stored.sort((a, b) => b.savedAt - a.savedAt);
    const images = stored[0]?.document?.pages.flatMap(page => page.children).filter(node => node.type === 'image') || [];
    return images.length === 3 && images.every(node => node.adjustments?.brightness === -65 && node.adjustments?.sharpness === 40
      && node.transforms?.crop?.left === 0.2 && node.transforms?.rotation === 90);
  }, 'all applied recipe settings persisted locally');
  const records = await readDocuments(app); records.sort((a, b) => b.savedAt - a.savedAt);
  const savedImages = records[0]?.document?.pages.flatMap(page => page.children).filter(node => node.type === 'image') || [];
  assert(savedImages.length === 3 && savedImages.every(node => node.adjustments?.brightness === -65 && node.adjustments?.sharpness === 40
    && node.transforms?.crop?.left === 0.2 && node.transforms?.rotation === 90), 'the image layers should retain recipe adjustments, crop, and rotation in local storage.');

  tap(app, app.querySelector('#bulk-done'));
  tap(app, app.querySelector('#sidebar-toggle'));
  await waitForPhonePanel(app, '#left-panel', 'left');
  const failureTargetId = imageIds[0];
  tap(app, app.querySelector(`[data-layer-id="${failureTargetId}"]`));
  tap(app, app.querySelector('#inspector-toggle'));
  await waitForPhonePanel(app, '#right-panel', 'right');
  setInspectorInput(app, '[data-prop="adjustments.brightness"]', 11);
  setInspectorInput(app, '[data-prop="adjustments.contrast"]', 24);
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'prepared recipe rollback settings');

  const nativeCreateImageBitmap = app.defaultView.createImageBitmap.bind(app.defaultView);
  let rejectRecipeBitmap;
  let recipeBitmapStarted;
  const recipeBitmapGate = new Promise(resolve => { recipeBitmapStarted = resolve; });
  app.defaultView.createImageBitmap = () => new Promise((resolve, reject) => {
    rejectRecipeBitmap = reject;
    recipeBitmapStarted();
  });
  const failureRecipePicker = app.querySelector('#selection-image-recipe');
  const applySingleRecipe = app.querySelector('[data-action="apply-image-recipe"]');
  assert(failureRecipePicker && applySingleRecipe, 'a single selected image should expose recipe application controls for the failure regression.');
  failureRecipePicker.value = [...failureRecipePicker.options].find(option => option.textContent.trim() === 'Phone batch look').value;
  failureRecipePicker.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  tap(app, applySingleRecipe);
  await waitFor(() => typeof rejectRecipeBitmap === 'function', 'recipe render to reach its controlled bitmap failure');
  await recipeBitmapGate;
  app.defaultView.createImageBitmap = nativeCreateImageBitmap;

  setInspectorInput(app, '[data-prop="adjustments.brightness"]', -19);
  setInspectorInput(app, '[data-prop="opacity"]', 37);
  setInspectorInput(app, '[data-prop="fit"]', 'contain');
  setInspectorInput(app, '[data-image-transform-field="left"]', 30);
  tap(app, app.querySelector('[data-action="rotate-image"][data-direction="right"][data-transform-target="layer"]'));
  rejectRecipeBitmap(new Error('Injected recipe-render failure for rollback regression.'));
  await waitFor(() => app.querySelector('#bulk-title')?.textContent === 'Recipe finished with errors', 'failed recipe batch completion');
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'newer image edit preview after failed recipe');
  await waitFor(async () => {
    const stored = await readDocuments(app); stored.sort((a, b) => b.savedAt - a.savedAt);
    const target = stored[0]?.document?.pages.flatMap(page => page.children).find(node => node.id === failureTargetId);
    return target?.adjustments?.brightness === -19
      && target?.adjustments?.contrast === 24
      && target?.adjustments?.sharpness === 40
      && target?.transforms?.crop?.left === 0.3
      && target?.transforms?.rotation === 180
      && target?.opacity === 0.37
      && target?.fit === 'contain';
  }, 'newer edit and unchanged recipe fields to persist after rollback');
  app.defaultView.createImageBitmap = nativeCreateImageBitmap;

  result.textContent = `PASS\n${JSON.stringify({ viewport: '390x844', touchSelection: 3, keyboardModifiers: false, contextMenuUsed: false, recipeSaved: true, pickerAndApply: true, sharpnessPreview: true, cropRotatePreview: true, cropRotateRecipeRoundTrip: true, inPlaceLayers: savedImages.length, recipeOutputChanged: true, overlappingBatchRejected: true, recipeRenderFailureInjected: true, newerEditsPreserved: ['brightness', 'crop', 'rotation', 'opacity', 'fit'], unchangedRecipeFieldsRestored: ['contrast', 'sharpness'], liveSpeedControl: true, bulkProgress: '3/3', fingerSizedControls: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
