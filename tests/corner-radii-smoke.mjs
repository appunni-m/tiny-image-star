const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const designName = `Corner radius mobile smoke ${Date.now()}`;
const radiusValues = { topLeft: 11, topRight: 17, bottomRight: 23, bottomLeft: 29 };

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 16000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for app startup or save completion. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 35);
    };
    poll();
  });
}
function click(app, element) {
  assert(element, 'Expected a corner-radius workflow control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function tap(app, element) {
  assert(element, 'Expected a touch-accessible corner-radius control.');
  const Pointer = app.defaultView.PointerEvent;
  if (Pointer) {
    element.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true, pointerId: 620, pointerType: 'touch', button: 0 }));
    element.dispatchEvent(new Pointer('pointerup', { bubbles: true, cancelable: true, pointerId: 620, pointerType: 'touch', button: 0 }));
  }
  click(app, element);
}
function setInput(app, input, value) {
  assert(input, 'Expected an editable corner-radius input.');
  input.value = String(value);
  input.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}
function readDocuments(app) {
  return new Promise((resolve, reject) => {
    const request = app.defaultView.indexedDB.open('figma-local-documents');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('documents').objectStore('documents').getAll();
      get.onsuccess = () => { resolve(get.result); db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  });
}
function flatten(nodes, result = []) {
  for (const node of nodes || []) { result.push(node); flatten(node.children, result); }
  return result;
}
function findDocument(records) {
  return records.find(record => record.document?.name === designName || record.name === designName) || null;
}
async function waitForSave(app, label) {
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saving locally'), `${label} save start`);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${label} save completion`);
  const status = app.querySelector('#save-state')?.textContent || '';
  assert(!status.includes('Could not save'), `${label} did not persist locally.`);
}
function openPanel(app, side) {
  const panel = app.querySelector(side === 'left' ? '#left-panel' : '#right-panel');
  const toggle = app.querySelector(side === 'left' ? '#sidebar-toggle' : '#inspector-toggle');
  if (!panel.classList.contains('is-open')) tap(app, toggle);
  return waitFor(() => {
    const bounds = panel.getBoundingClientRect();
    return panel.classList.contains('is-open') && bounds.left >= 0 && bounds.right <= app.defaultView.innerWidth + 1;
  }, `${side} phone panel`);
}
function closePanel(app, side) {
  const panel = app.querySelector(side === 'left' ? '#left-panel' : '#right-panel');
  const toggle = app.querySelector(side === 'left' ? '#sidebar-toggle' : '#inspector-toggle');
  if (panel.classList.contains('is-open')) tap(app, toggle);
}
function worldScreenPoint(canvas, x, y) {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + rect.width / 2 + x, y: rect.top + rect.height / 2 + y };
}
function drawRectangle(app, start, end, pointerId) {
  const canvas = app.querySelector('#scene-canvas');
  click(app, app.querySelector('[data-tool="rectangle"]'));
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  for (const [type, point] of [
    ['pointerdown', start], ['pointermove', end], ['pointerup', end]
  ]) {
    const screen = worldScreenPoint(canvas, point.x, point.y);
    canvas.dispatchEvent(new app.defaultView.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId, pointerType: 'touch', button: 0,
      clientX: screen.x, clientY: screen.y
    }));
  }
  const row = app.querySelector('.layer-row.is-selected[data-layer-id]');
  assert(row, 'Drawing a rectangle should create and select a layer.');
  return row.dataset.layerId;
}
function setRadius(app, corner, value) {
  const input = app.querySelector(`#inspector-content [data-prop="cornerRadii.${corner}"]`);
  setInput(app, input, value);
}
function assertIndependentFields(app, expected) {
  const controls = [...app.querySelectorAll('#inspector-content .corner-radius-controls .property-field')];
  const names = controls.map(control => control.querySelector('label')?.textContent.trim());
  assert(names.join('|') === 'Top left|Top right|Bottom left|Bottom right',
    `Independent corner labels should remain readable and in expected order (received ${names.join('|')}).`);
  for (const control of controls) {
    const label = control.querySelector('label');
    assert(label && label.scrollWidth <= label.clientWidth + 1,
      `${label?.textContent.trim() || 'Corner label'} should fit without clipping at 390px.`);
    const bounds = control.getBoundingClientRect();
    assert(bounds.left >= 0 && bounds.right <= 391,
      `${label.textContent.trim()} should remain inside the phone viewport (field bounds ${Math.round(bounds.left)}–${Math.round(bounds.right)}).`);
    const input = control.querySelector('input[data-prop]');
    const corner = input?.dataset.prop.slice('cornerRadii.'.length);
    assert(input && Number(input.value) === expected[corner], `${label.textContent.trim()} should show ${expected[corner]}.`);
    assert(Number.parseFloat(app.defaultView.getComputedStyle(input).fontSize) >= 16,
      `${label.textContent.trim()} should use phone-sized input text at 390px.`);
  }
  const coarsePointer = app.defaultView.matchMedia('(pointer: coarse)').matches;
  if (coarsePointer) {
    for (const control of controls) {
      const label = control.querySelector('label').textContent.trim();
      const bounds = control.getBoundingClientRect();
      const inputBounds = control.querySelector('input').getBoundingClientRect();
      assert(bounds.height >= 44 && inputBounds.height >= 42,
        `${label} should meet the 44px mobile touch target (${Math.round(bounds.width)}×${Math.round(bounds.height)}, input ${Math.round(inputBounds.height)}px).`);
    }
  }
  return { labels: names.length, touchTargets: coarsePointer ? controls.length : 'coarse-pointer media rule not active in this runner' };
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup', 45000);
  let app = frame.contentDocument;
  assert(app.defaultView.innerWidth === 390 && app.defaultView.innerHeight === 844,
    'Corner-radius workflow must run in the 390×844 phone viewport.');

  tap(app, app.querySelector('#main-menu-button'));
  const newDesign = [...app.querySelectorAll('#context-menu [role="menuitem"]')]
    .find(item => item.textContent.trim().startsWith('New design'));
  tap(app, newDesign);
  await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('New local design created.'), 'fresh local design');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'new design save');
  const name = app.querySelector('#document-name');
  name.value = designName;
  name.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitForSave(app, 'smoke design name');

  const firstRectId = drawRectangle(app, { x: -64, y: -56 }, { x: 64, y: 40 }, 621);
  await openPanel(app, 'right');
  await waitFor(() => app.querySelector('[data-action="unlink-corners"]'), 'shared radius controls');
  tap(app, app.querySelector('[data-action="unlink-corners"]'));
  await waitFor(() => app.querySelector('[data-prop="cornerRadii.topLeft"]'), 'independent corner controls');
  const accessibilityAndTouch = assertIndependentFields(app, { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 });
  for (const [corner, value] of Object.entries(radiusValues)) setRadius(app, corner, value);
  const smoothingSlider = app.querySelector('#inspector-content [data-prop="cornerSmoothing"]');
  const smoothingField = smoothingSlider?.closest('.corner-smoothing-field');
  const smoothingBounds = smoothingField?.getBoundingClientRect();
  assert(smoothingField && smoothingBounds.left >= 0 && smoothingBounds.right <= 391,
    'Corner smoothing should remain visible in the 390px phone Inspector.');
  if (app.defaultView.matchMedia('(pointer: coarse)').matches) {
    assert(smoothingBounds.height >= 44 && smoothingSlider.getBoundingClientRect().height >= 42,
      'The phone corner-smoothing slider should provide a 44px touch target.');
  }
  setInput(app, smoothingSlider, 35);
  await waitFor(() => smoothingSlider.nextElementSibling?.value === '35%', 'corner-smoothing slider preview');
  await waitForSave(app, 'corner-smoothing slider edit');
  tap(app, app.querySelector('[data-action="ios-corner-smoothing"]'));
  await waitFor(() => app.querySelector('#inspector-content [data-prop="cornerSmoothing"]')?.value === '60', 'iOS corner-smoothing preset');
  await waitForSave(app, 'iOS corner-smoothing preset');

  let records = await readDocuments(app);
  let savedRecord = findDocument(records);
  assert(savedRecord, 'The smoke design was missing from local document storage.');
  let savedNodes = flatten(savedRecord.document.pages.flatMap(page => page.children));
  let savedFirstRect = savedNodes.find(node => node.id === firstRectId);
  assert(savedFirstRect?.type === 'rectangle' && JSON.stringify(savedFirstRect.cornerRadii) === JSON.stringify(radiusValues),
    'All four distinct corner radii should be saved to the local design.');
  assert(savedFirstRect.cornerSmoothing === 0.6, 'The iOS 60% corner-smoothing preset should persist in the local design.');

  const previousApp = app;
  app.defaultView.location.reload();
  await waitFor(() => frame.contentDocument !== previousApp
    && frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor reload', 45000);
  app = frame.contentDocument;
  await waitFor(() => app.querySelector('#document-name')?.value === designName
    && app.querySelector(`[data-layer-id="${firstRectId}"]`), 'smoke design restore after reload', 20000);
  await openPanel(app, 'left');
  tap(app, app.querySelector(`[data-layer-id="${firstRectId}"]`));
  await openPanel(app, 'right');
  await waitFor(() => app.querySelector('[data-prop="cornerRadii.bottomRight"]'), 'restored independent corner controls');
  assertIndependentFields(app, radiusValues);
  assert(app.querySelector('[data-prop="cornerSmoothing"]')?.value === '60', 'Corner smoothing should restore after reload.');
  records = await readDocuments(app);
  savedRecord = findDocument(records);
  savedNodes = flatten(savedRecord?.document?.pages.flatMap(page => page.children));
  savedFirstRect = savedNodes.find(node => node.id === firstRectId);
  assert(JSON.stringify(savedFirstRect?.cornerRadii) === JSON.stringify(radiusValues),
    'Distinct corner radii should still be present in the document after a full reload.');

  const downloads = [];
  const objectUrls = new Map();
  const view = app.defaultView;
  const createObjectURL = view.URL.createObjectURL.bind(view.URL);
  view.URL.createObjectURL = blob => { const url = createObjectURL(blob); objectUrls.set(url, blob); return url; };
  const originalAnchorClick = view.HTMLAnchorElement.prototype.click;
  view.HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download')) { downloads.push({ filename: this.download, blob: objectUrls.get(this.href) }); return; }
    originalAnchorClick.call(this);
  };
  const exportButton = app.querySelector('[data-action="export-svg"]');
  assert(exportButton, 'The selected rectangle should expose editable SVG export.');
  tap(app, exportButton);
  await waitFor(() => downloads.length === 1, 'independent-radius SVG export');
  assert(downloads[0].filename === 'Rectangle.svg' && downloads[0].blob?.type.startsWith('image/svg+xml'),
    'The selected rectangle should download as editable SVG.');
  const svg = await downloads[0].blob.text();
  const svgDoc = new view.DOMParser().parseFromString(svg, 'image/svg+xml');
  const exportedGroup = svgDoc.querySelector(`[data-tiny-image-star-node-id="${firstRectId}"]`);
  const exportedPath = exportedGroup?.querySelector(':scope > path');
  assert(exportedPath, 'Independent rounded corners should export as a vector path.');
  assert(/ C .* A .* 0 0 1 /u.test(exportedPath.getAttribute('d')),
    `Exported SVG should carry cubic smoothing ramps and circular arcs (received ${exportedPath.getAttribute('d')}).`);

  closePanel(app, 'left');
  closePanel(app, 'right');
  const secondRectId = drawRectangle(app, { x: 78, y: 50 }, { x: 156, y: 108 }, 622);
  await openPanel(app, 'left');
  tap(app, app.querySelector('[data-sidebar-tab="assets"]'));
  tap(app, app.querySelector('#add-variable-collection'));
  const variableDialog = app.querySelector('#variable-dialog');
  assert(variableDialog?.open, 'Creating the radius token collection should open its local dialog.');
  app.querySelector('#variable-name').value = 'Corner radius smoke';
  tap(app, app.querySelector('#variable-save'));
  await waitFor(() => app.querySelector('.variable-collection-card strong')?.textContent === 'Corner radius smoke', 'radius token collection');
  const collection = app.querySelector('.variable-collection-card');
  tap(app, collection.querySelector('[data-action="add-variable"]'));
  app.querySelector('#variable-name').value = 'Card radius';
  app.querySelector('#variable-type').value = 'number';
  tap(app, app.querySelector('#variable-save'));
  await waitFor(() => [...app.querySelectorAll('.variable-name')].some(item => item.textContent === 'Card radius'), 'numeric radius variable');
  const radiusVariable = [...app.querySelectorAll('.variable-name')].find(item => item.textContent === 'Card radius');
  const variableRow = radiusVariable.closest('.variable-row');
  const radiusVariableInput = variableRow.querySelector('[data-variable-value]');
  const radiusVariableId = radiusVariableInput.dataset.variableValue;
  const radiusVariableModeId = radiusVariableInput.dataset.modeId;
  setInput(app, radiusVariableInput, 37);
  await waitForSave(app, 'radius variable value');

  tap(app, app.querySelector('[data-sidebar-tab="layers"]'));
  await openPanel(app, 'right');
  tap(app, app.querySelector(`[data-layer-id="${secondRectId}"]`));
  await waitFor(() => app.querySelector('[data-variable-property-binding="radius"]'), 'radius variable binding selector');
  const binding = app.querySelector('[data-variable-property-binding="radius"]');
  binding.value = radiusVariableId;
  binding.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('[data-prop="radius"]')?.value === '37', 'bound radius value');
  await waitForSave(app, 'bound radius variable');
  tap(app, app.querySelector('[data-action="unlink-corners"]'));
  await waitFor(() => app.querySelector('[data-prop="cornerRadii.topLeft"]'), 'unlink from radius variable');
  assertIndependentFields(app, { topLeft: 37, topRight: 37, bottomLeft: 37, bottomRight: 37 });
  await waitForSave(app, 'detach radius variable locally');

  // Change the variable after unlinking. The detached shape must keep its local
  // corner values while the design token itself remains editable.
  tap(app, app.querySelector('[data-sidebar-tab="assets"]'));
  const changedRadiusInput = app.querySelector(`[data-variable-value="${radiusVariableId}"]`);
  setInput(app, changedRadiusInput, 52);
  await waitForSave(app, 'change source radius token after detach');
  tap(app, app.querySelector('[data-sidebar-tab="layers"]'));
  tap(app, app.querySelector(`[data-layer-id="${secondRectId}"]`));
  await waitFor(() => app.querySelector('[data-prop="cornerRadii.bottomRight"]'), 'detached shape after token change');
  assertIndependentFields(app, { topLeft: 37, topRight: 37, bottomLeft: 37, bottomRight: 37 });
  records = await readDocuments(app);
  savedRecord = findDocument(records);
  const savedSecondRect = flatten(savedRecord?.document?.pages?.flatMap(page => page.children)).find(node => node.id === secondRectId);
  assert(savedRecord?.document?.variables?.some(variable => variable.id === radiusVariableId),
    'Unlinking should preserve the reusable source variable.');
  assert(savedRecord.document.variables.find(variable => variable.id === radiusVariableId)?.valuesByMode?.[radiusVariableModeId] === 52,
    'The shared radius token should remain editable after the shape detaches.');
  assert(!savedSecondRect?.variableBindings?.radius && JSON.stringify(savedSecondRect?.cornerRadii)
    === JSON.stringify({ topLeft: 37, topRight: 37, bottomRight: 37, bottomLeft: 37 }),
  'The unlinked shape should persist local radii and no radius-variable binding.');

  result.textContent = `PASS\n${JSON.stringify({ viewport: '390x844', labels: accessibilityAndTouch.labels, touchTargets: accessibilityAndTouch.touchTargets, fourCornerEdits: true, cornerSmoothingSlider: true, iosSmoothingPreset: true, persistedAndReloaded: true, exportedSvgPath: true, variableRadiusDetachedLocally: true, detachedRadiusUnaffectedByTokenEdit: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
