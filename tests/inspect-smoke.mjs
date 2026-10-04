import { addNode, createDocument, createNode } from '../src/model.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
let coarsePointerGradientTargetChecked = false;
function assert(value, message) { if (!value) throw new Error(message); }
function assertInspectorFits(app, label) {
  const panel = app.querySelector('#right-panel');
  const content = app.querySelector('#inspector-content');
  assert(panel && content, `${label}: the properties panel should be present`);
  assert(panel.scrollWidth <= panel.clientWidth + 1, `${label}: the properties panel should not overflow horizontally`);
  assert(content.scrollWidth <= content.clientWidth + 1, `${label}: inspector content should not overflow horizontally`);
}
function waitFor(test, label, timeout = 10000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for editor startup and asynchronous clipboard actions. */ }
      if (performance.now() - start > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 30);
    };
    poll();
  });
}
async function waitForSaveCycle(app, label) {
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saving locally'), `${label} save start`);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${label} save completion`);
}
function click(element, options = {}) {
  assert(element, 'Expected an Inspect workflow control.');
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }));
}
function readDocuments() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('figma-local-documents');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const get = db.transaction('documents').objectStore('documents').getAll();
      get.onsuccess = () => { resolve(get.result); db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  });
}
function packageFile(documentData) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: documentData.schema, document: documentData, assets: [] }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  let app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'The editor should use Tiny Image Star as its public name.');
  const onboarding = app.querySelector('#workspace-onboarding-dialog');
  const browserFallback = app.querySelector('#workspace-onboarding-browser-fallback');
  if (onboarding?.open && browserFallback && !browserFallback.hidden) {
    click(browserFallback);
    await waitFor(() => !onboarding.open, 'browser storage setup');
  }
  const design = createDocument();
  const screen = createNode('frame', { name: 'Mobile screen', x: 30, y: 40, width: 350, height: 700, autoLayout: { axis: 'vertical', gap: 16, padding: 20 } });
  const button = createNode('rectangle', { name: 'Primary button', x: 18, y: 24, width: 180, height: 52, minWidth: 150, maxWidth: 240, minHeight: 44, maxHeight: 72, fill: '#1769aa', radius: 10, rotation: 3 });
  const label = createNode('text', { name: 'Button label', x: 24, y: 38, width: 160, height: 28, text: 'Continue', fontFamily: 'Arial, sans-serif', fontSize: 16, fontWeight: 600, lineHeight: 1.5, letterSpacing: 0.25, paragraphSpacing: 6, firstLineIndent: 4, color: '#ffffff' });
  addNode(design, screen); addNode(design, button, { parentId: screen.id }); addNode(design, label, { parentId: screen.id });
  const input = app.querySelector('#open-file-input'); const transfer = new DataTransfer();
  transfer.items.add(new File([packageFile(design)], 'inspect-smoke.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Local design opened')), 'design import');

  click(app.querySelector(`[data-layer-id="${label.id}"]`));
  assertInspectorFits(app, 'text selection');
  const textFit = app.querySelector('[data-prop="textFit"]');
  assert(textFit && ['fixed', 'auto-height', 'auto-width'].every(value => [...textFit.options].some(option => option.value === value)), 'text resize modes should be available on the phone');
  assert(textFit.getBoundingClientRect().right <= app.querySelector('#right-panel').getBoundingClientRect().right, 'the text resize control should fit inside the phone inspector');
  const phoneInspectorRight = app.querySelector('#right-panel').getBoundingClientRect().right;
  const paragraphSpacing = app.querySelector('[data-prop="paragraphSpacing"]');
  const firstLineIndent = app.querySelector('[data-prop="firstLineIndent"]');
  assert(paragraphSpacing && firstLineIndent, 'paragraph spacing and first-line indentation controls should be available');
  assert(paragraphSpacing.min === '0' && paragraphSpacing.max === '10000' && firstLineIndent.min === '0' && firstLineIndent.max === '10000', 'paragraph typography controls should advertise the supported numeric range');
  assert(paragraphSpacing.getBoundingClientRect().right <= phoneInspectorRight && firstLineIndent.getBoundingClientRect().right <= phoneInspectorRight, 'paragraph typography controls should fit inside the phone inspector');
  const textCase = app.querySelector('[data-prop="textCase"]');
  const textDecoration = app.querySelector('[data-prop="textDecoration"]');
  const verticalAlign = app.querySelector('[data-prop="verticalAlign"]');
  assert(textCase && ['none', 'uppercase', 'lowercase', 'capitalize'].every(value => [...textCase.options].some(option => option.value === value)), 'text case options should be available on the phone');
  assert(textDecoration && ['none', 'underline', 'line-through'].every(value => [...textDecoration.options].some(option => option.value === value)), 'text decoration options should be available on the phone');
  assert(verticalAlign && ['top', 'middle', 'bottom'].every(value => [...verticalAlign.options].some(option => option.value === value)), 'vertical text alignment options should be available on the phone');
  assert(textCase.getBoundingClientRect().right <= phoneInspectorRight && textDecoration.getBoundingClientRect().right <= phoneInspectorRight && verticalAlign.getBoundingClientRect().right <= phoneInspectorRight, 'text styling controls should fit inside the phone inspector');
  const textWidth = app.querySelector('[data-prop="width"]');
  textWidth.value = '50'; textWidth.dispatchEvent(new Event('input', { bubbles: true })); textWidth.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'auto-height text');
  const textRecords = await readDocuments(); textRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedLabel = textRecords[0]?.document?.pages.flatMap(page => page.children.flatMap(parent => parent.children || [])).find(node => node.id === label.id);
  assert(savedLabel?.textFit === 'auto-height' && savedLabel.width === 50 && savedLabel.height >= 36, 'auto-height text should resize and persist after its width changes');
  const autoWidth = app.querySelector('[data-prop="textFit"]');
  autoWidth.value = 'auto-width'; autoWidth.dispatchEvent(new Event('input', { bubbles: true })); autoWidth.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'auto-width text');
  const autoWidthRecords = await readDocuments(); autoWidthRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedAutoWidth = autoWidthRecords[0]?.document?.pages.flatMap(page => page.children.flatMap(parent => parent.children || [])).find(node => node.id === label.id);
  assert(savedAutoWidth?.textFit === 'auto-width' && savedAutoWidth.width > 50 && savedAutoWidth.width < 160, 'auto-width text should fit its measured line and persist the selected mode');
  const mobileTextCase = app.querySelector('[data-prop="textCase"]');
  mobileTextCase.value = 'uppercase'; mobileTextCase.dispatchEvent(new Event('input', { bubbles: true })); mobileTextCase.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'uppercase text');
  const mobileTextDecoration = app.querySelector('[data-prop="textDecoration"]');
  mobileTextDecoration.value = 'underline'; mobileTextDecoration.dispatchEvent(new Event('input', { bubbles: true })); mobileTextDecoration.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'underlined text');
  const renderedTextRecords = await readDocuments(); renderedTextRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedRenderedText = renderedTextRecords[0]?.document?.pages.flatMap(page => page.children.flatMap(parent => parent.children || [])).find(node => node.id === label.id);
  assert(savedRenderedText?.text === 'Continue' && savedRenderedText.textCase === 'uppercase' && savedRenderedText.textDecoration === 'underline', 'mobile text rendering controls should preserve the source copy and persist display casing and decoration');
  const mobileVerticalAlign = app.querySelector('[data-prop="verticalAlign"]');
  mobileVerticalAlign.value = 'bottom'; mobileVerticalAlign.dispatchEvent(new Event('input', { bubbles: true })); mobileVerticalAlign.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'bottom-aligned text');
  const verticalRecords = await readDocuments(); verticalRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedVerticalText = verticalRecords[0]?.document?.pages.flatMap(page => page.children.flatMap(parent => parent.children || [])).find(node => node.id === label.id);
  assert(savedVerticalText?.verticalAlign === 'bottom', 'mobile vertical alignment should persist with the local design');
  const paragraphInput = app.querySelector('[data-prop="paragraphSpacing"]');
  paragraphInput.value = '12'; paragraphInput.dispatchEvent(new Event('input', { bubbles: true })); paragraphInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'paragraph spacing');
  const indentInput = app.querySelector('[data-prop="firstLineIndent"]');
  indentInput.value = '10'; indentInput.dispatchEvent(new Event('input', { bubbles: true })); indentInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'first-line indentation');
  const paragraphRecords = await readDocuments(); paragraphRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedParagraphText = paragraphRecords[0]?.document?.pages.flatMap(page => page.children.flatMap(parent => parent.children || [])).find(node => node.id === label.id);
  assert(savedParagraphText?.paragraphSpacing === 12 && savedParagraphText?.firstLineIndent === 10, 'paragraph typography controls should preserve values in the local design');
  const clampInput = app.querySelector('[data-prop="paragraphSpacing"]');
  clampInput.value = '-4'; clampInput.dispatchEvent(new Event('input', { bubbles: true })); clampInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'paragraph spacing range clamp');
  const clampedRecords = await readDocuments(); clampedRecords.sort((a, b) => b.savedAt - a.savedAt);
  const clampedText = clampedRecords[0]?.document?.pages.flatMap(page => page.children.flatMap(parent => parent.children || [])).find(node => node.id === label.id);
  assert(clampedText?.paragraphSpacing === 0, 'invalid negative paragraph spacing should clamp to the supported minimum');
  const restoreParagraphInput = app.querySelector('[data-prop="paragraphSpacing"]');
  restoreParagraphInput.value = '12'; restoreParagraphInput.dispatchEvent(new Event('input', { bubbles: true })); restoreParagraphInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'restore paragraph spacing');
  click(app.querySelector(`[data-layer-id="${button.id}"]`));
  assertInspectorFits(app, 'shape selection');
  const limitFields = [...app.querySelectorAll('.size-limits-grid .size-limit-field')];
  assert(limitFields.length === 4 && limitFields.every(field => field.getBoundingClientRect().width >= 96), 'the four size-limit controls should remain readable in the phone inspector');
  const maxWidthInput = app.querySelector('[data-prop="maxWidth"]');
  maxWidthInput.value = '200'; maxWidthInput.dispatchEvent(new Event('input', { bubbles: true })); maxWidthInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'size-limit');
  const savedRecords = await readDocuments(); savedRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedButton = savedRecords[0]?.document.pages.flatMap(page => page.children).flatMap(frameNode => frameNode.children || []).find(node => node.id === button.id);
  assert(savedButton?.minWidth === 150 && savedButton.maxWidth === 200 && savedButton.minHeight === 44 && savedButton.maxHeight === 72, 'size limits should persist in the local document');
  const rightPanel = app.querySelector('#right-panel').getBoundingClientRect();
  const fillType = app.querySelector('[data-prop="fillType"]');
  assert(fillType && ['solid', 'linear', 'radial'].every(value => [...fillType.options].some(option => option.value === value)) && fillType.getBoundingClientRect().right <= rightPanel.right, 'gradient fill options should be available inside the phone inspector');
  fillType.value = 'linear'; fillType.dispatchEvent(new Event('input', { bubbles: true })); fillType.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'linear gradient');
  const geometryToggle = app.querySelector('[data-action="toggle-gradient-geometry"]');
  assert(geometryToggle && geometryToggle.getBoundingClientRect().right <= rightPanel.right, 'gradient geometry editing should be available inside the phone inspector');
  if (app.defaultView.matchMedia('(max-width: 820px) and (pointer: coarse)').matches) {
    assert(geometryToggle.getBoundingClientRect().height >= 44, 'gradient geometry editing should have a 44px phone touch target');
    coarsePointerGradientTargetChecked = true;
  }
  click(geometryToggle);
  const geometryInputs = [...app.querySelectorAll('[data-gradient-geometry-field]')];
  assert(geometryInputs.length === 6 && geometryInputs.every(input => input.getBoundingClientRect().right <= rightPanel.right), 'all three editable gradient handles should expose fitting X/Y controls');
  const startX = geometryInputs.find(input => input.dataset.gradientGeometryIndex === '0' && input.dataset.gradientGeometryAxis === 'x');
  startX.value = '5'; startX.dispatchEvent(new Event('input', { bubbles: true })); startX.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'gradient geometry edit');
  const geometryRecords = await readDocuments(); geometryRecords.sort((a, b) => b.savedAt - a.savedAt);
  const geometryButton = geometryRecords[0]?.document?.pages.flatMap(page => page.children.flatMap(parent => parent.children || [])).find(node => node.id === button.id);
  const savedGradient = geometryButton?.fills?.[0]?.gradient || geometryButton?.fillGradient;
  assert(Math.abs(savedGradient?.geometry?.handles?.[0]?.x - 0.05) < 1e-6, 'editing normalized gradient geometry should persist in the local design');
  assert(!app.querySelector('[data-gradient-field="angle"]'), 'affine gradients should use their editable canvas handles instead of a disconnected angle field');
  click(app.querySelector('[data-action="toggle-gradient-geometry"]'));
  assert(app.querySelector('.gradient-geometry-fields')?.hidden, 'gradient geometry fields should close without changing the gradient');
  const firstStopColor = app.querySelector('[data-gradient-field="color"]');
  const firstStopPosition = app.querySelector('[data-gradient-field="position"]');
  const firstStopOpacity = app.querySelector('[data-gradient-field="opacity"]');
  assert(firstStopColor && firstStopPosition && firstStopOpacity && firstStopPosition.getBoundingClientRect().right <= rightPanel.right
    && firstStopOpacity.getBoundingClientRect().right <= rightPanel.right, 'gradient color, position, and alpha controls should fit in the phone inspector');
  firstStopColor.value = '#00ff00'; firstStopColor.dispatchEvent(new Event('input', { bubbles: true })); firstStopColor.dispatchEvent(new Event('change', { bubbles: true }));
  firstStopPosition.value = '20'; firstStopPosition.dispatchEvent(new Event('input', { bubbles: true })); firstStopPosition.dispatchEvent(new Event('change', { bubbles: true }));
  firstStopOpacity.value = '35'; firstStopOpacity.dispatchEvent(new Event('input', { bubbles: true })); firstStopOpacity.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'gradient stop tuning');
  const gradientTrack = app.querySelector('[data-gradient-stop-track]');
  assert(gradientTrack, 'the gradient stop rail should be available for direct stop editing');
  const trackBounds = gradientTrack.getBoundingClientRect();
  gradientTrack.dispatchEvent(new app.defaultView.MouseEvent('click', {
    bubbles: true, cancelable: true, button: 0,
    clientX: trackBounds.left + trackBounds.width * 0.6,
    clientY: trackBounds.top + trackBounds.height / 2
  }));
  await waitForSaveCycle(app, 'gradient rail stop insertion');
  const insertedRow = [...app.querySelectorAll('[data-gradient-stop-row]')]
    .find(row => row.querySelector('input[type="color"]')?.value === '#80ff80');
  assert(insertedRow, 'clicking the gradient rail should insert a stop with the interpolated color');
  assert(Math.abs(Number(insertedRow.querySelector('[data-gradient-field="opacity"]')?.value) - 67.5) < 0.1,
    'a new stop should interpolate alpha between the two neighboring stops');
  const insertedStopId = insertedRow.dataset.gradientStopId;
  const insertedHandle = [...app.querySelectorAll('[data-gradient-stop-handle]')]
    .find(handle => handle.dataset.gradientStopId === insertedStopId);
  assert(insertedHandle && Math.abs(Number(insertedHandle.getAttribute('aria-valuenow')) - 60) <= 1,
    'the inserted gradient stop should be positioned at the clicked rail location');
  if (app.defaultView.matchMedia('(max-width: 820px) and (pointer: coarse)').matches) {
    const handleBounds = insertedHandle.getBoundingClientRect();
    assert(handleBounds.width >= 44 && handleBounds.height >= 44,
      'coarse-pointer gradient stop handles should provide a 44px touch target');
    coarsePointerGradientTargetChecked = true;
  }
  const dispatchPointer = (type, clientX) => {
    const event = new app.defaultView.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ pointerId: 41, button: 0, clientX })) {
      Object.defineProperty(event, key, { value });
    }
    insertedHandle.dispatchEvent(event);
  };
  dispatchPointer('pointerdown', trackBounds.left + trackBounds.width * 0.6);
  dispatchPointer('pointermove', trackBounds.left + trackBounds.width * 0.64);
  dispatchPointer('pointerup', trackBounds.left + trackBounds.width * 0.64);
  assert(insertedHandle.getAttribute('aria-valuenow') === '64', 'dragging the slider handle should move the stop in the gradient');
  await waitForSaveCycle(app, 'pointer gradient stop move');
  insertedHandle.focus();
  insertedHandle.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', {
    bubbles: true, cancelable: true, key: 'ArrowRight'
  }));
  assert(insertedHandle.getAttribute('aria-valuenow') === '65',
    'the focused gradient stop slider should move one percentage point with ArrowRight');
  assert(!app.querySelector('#toast-region')?.textContent.includes('Auto layout controls'),
    'gradient slider arrows should not escape to the layer-nudge shortcut');
  await waitForSaveCycle(app, 'keyboard gradient stop move');
  const savedGradientRecords = await readDocuments(); savedGradientRecords.sort((a, b) => b.savedAt - a.savedAt);
  const findSavedGradientButton = documentData => documentData?.pages.flatMap(page => page.children)
    .flatMap(frameNode => frameNode.children || []).find(node => node.id === button.id);
  const savedLinearGradient = savedGradientRecords.map(record => findSavedGradientButton(record.document))
    .find(node => node?.fillGradient?.stops.some(stop => stop.id === insertedStopId));
  const savedInsertedStop = savedLinearGradient?.fillGradient.stops.find(stop => stop.id === insertedStopId);
  assert(savedInsertedStop?.color === '#80ff80' && Math.abs(savedInsertedStop.position - 0.65) < 1e-9
    && Math.abs((savedInsertedStop.opacity ?? 1) - 0.675) < 1e-6
    && savedLinearGradient.x === button.x,
    'the interpolated stop color, alpha, and keyboard-updated position should be saved locally');

  const previousGradientApp = app;
  app.defaultView.location.reload();
  await waitFor(() => frame.contentDocument !== previousGradientApp
    && frame.contentDocument?.documentElement.dataset.appReady === 'true', 'gradient design reload', 45000);
  app = frame.contentDocument;
  await waitFor(() => app.querySelector(`[data-layer-id="${screen.id}"]`), 'gradient screen restore after reload');
  if (!app.querySelector(`[data-layer-id="${button.id}"]`)) {
    click(app.querySelector(`[data-layer-id="${screen.id}"] [data-action="layer-toggle"]`));
  }
  await waitFor(() => app.querySelector(`[data-layer-id="${button.id}"]`), 'gradient layer restore after reload');
  click(app.querySelector(`[data-layer-id="${button.id}"]`));
  await waitFor(() => app.querySelector('[data-gradient-stop-track]'), 'reloaded gradient stop rail');
  const reloadedInsertedRow = [...app.querySelectorAll('[data-gradient-stop-row]')]
    .find(row => row.dataset.gradientStopId === insertedStopId);
  const reloadedFirstStopOpacity = app.querySelector('[data-gradient-field="opacity"]');
  const reloadedInsertedHandle = [...app.querySelectorAll('[data-gradient-stop-handle]')]
    .find(handle => handle.dataset.gradientStopId === insertedStopId);
  assert(reloadedInsertedRow?.querySelector('input[type="color"]')?.value === '#80ff80'
    && reloadedInsertedRow.querySelector('input[type="number"]')?.value === '65'
    && Math.abs(Number(reloadedFirstStopOpacity?.value) - 35) < 0.01
    && Math.abs(Number(reloadedInsertedRow.querySelector('[data-gradient-field="opacity"]')?.value) - 67.5) < 0.1
    && reloadedInsertedHandle?.getAttribute('aria-valuenow') === '65',
  'gradient stop color, alpha, and moved position should remain editable after a local reload');
  click(app.querySelector('[data-action="add-gradient-stop"]'));
  await waitForSaveCycle(app, 'additional gradient stop');
  const radialType = app.querySelector('[data-prop="fillType"]');
  radialType.value = 'radial'; radialType.dispatchEvent(new Event('input', { bubbles: true })); radialType.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'radial gradient');
  const gradientRecords = await readDocuments(); gradientRecords.sort((a, b) => b.savedAt - a.savedAt);
  const gradientButton = gradientRecords[0]?.document.pages.flatMap(page => page.children).flatMap(frameNode => frameNode.children || []).find(node => node.id === button.id);
  assert(gradientButton?.fillGradient?.type === 'radial' && gradientButton.fillGradient.stops.length === 4 && gradientButton.fillGradient.stops[0].color === '#00ff00' && gradientButton.fillGradient.stops[0].position === 0.2
    && Math.abs((gradientButton.fillGradient.stops[0].opacity ?? 1) - 0.35) < 1e-6
    && gradientButton.fillGradient.stops.some(stop => stop.id === insertedStopId && stop.color === '#80ff80' && Math.abs(stop.position - 0.65) < 1e-9 && Math.abs((stop.opacity ?? 1) - 0.675) < 1e-6),
  'gradient type, existing and inserted stop color, position, alpha, and an additional button-created stop should persist');
  click(app.querySelector('[data-action="add-stroke"]'));
  await waitForSaveCycle(app, 'add stroke');
  const strokeWidth = app.querySelector('[data-prop="strokeWidth"]');
  const strokePattern = app.querySelector('[data-prop="strokePattern"]');
  const strokeCap = app.querySelector('[data-prop="strokeCap"]');
  const strokeJoin = app.querySelector('[data-prop="strokeJoin"]');
  const strokeMiterLimit = app.querySelector('[data-prop="strokeMiterLimit"]');
  assert(strokeWidth?.getAttribute('aria-label') === 'Stroke width' && strokePattern && strokeCap && strokeJoin && strokeMiterLimit?.getAttribute('aria-label') === 'Stroke miter limit', 'the phone inspector should expose editable stroke settings');
  assert([strokeWidth, strokePattern, strokeCap, strokeJoin, strokeMiterLimit].every(control => control.getBoundingClientRect().right <= rightPanel.right), 'stroke controls should fit in the phone inspector');
  for (const [control, value] of [[strokeWidth, '3'], [strokePattern, 'dashed'], [strokeCap, 'round'], [strokeJoin, 'bevel'], [strokeMiterLimit, '4']]) {
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await waitForSaveCycle(app, 'stroke style');
  const strokeRecords = await readDocuments(); strokeRecords.sort((a, b) => b.savedAt - a.savedAt);
  const styledButton = strokeRecords[0]?.document.pages.flatMap(page => page.children).flatMap(frameNode => frameNode.children || []).find(node => node.id === button.id);
  assert(styledButton?.strokeWidth === 3 && styledButton.strokePattern === 'dashed' && styledButton.strokeCap === 'round' && styledButton.strokeJoin === 'bevel' && styledButton.strokeMiterLimit === 4, 'stroke appearance edits should be saved in the local document');
  const sideMode = app.querySelector('[data-stroke-field="sideMode"]');
  assert(sideMode && [...sideMode.options].some(option => option.value === 'custom'), 'rectangle strokes should expose All, side presets, and Custom weights');
  sideMode.value = 'custom'; sideMode.dispatchEvent(new Event('input', { bubbles: true })); sideMode.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'individual stroke sides');
  const sideWidths = Object.fromEntries([...app.querySelectorAll('[data-stroke-field="sideWidth"]')].map(input => [input.dataset.strokeSide, input]));
  assert(['top', 'right', 'bottom', 'left'].every(side => sideWidths[side]), 'custom weights should expose all four edge inputs');
  assert(Object.values(sideWidths).every(control => control.getBoundingClientRect().right <= rightPanel.right), 'four side weights should fit inside the phone inspector');
  for (const [side, value] of [['top', '1.5'], ['right', '0'], ['bottom', '3.25'], ['left', '2']]) {
    sideWidths[side].value = value;
    sideWidths[side].dispatchEvent(new Event('input', { bubbles: true }));
    sideWidths[side].dispatchEvent(new Event('change', { bubbles: true }));
  }
  await waitForSaveCycle(app, 'custom individual stroke weights');
  const individualStrokeRecords = await readDocuments(); individualStrokeRecords.sort((a, b) => b.savedAt - a.savedAt);
  const individualButton = individualStrokeRecords[0]?.document.pages.flatMap(page => page.children).flatMap(frameNode => frameNode.children || []).find(node => node.id === button.id);
  assert.deepEqual(individualButton?.strokes?.[0]?.sideWidths, { top: 1.5, right: 0, bottom: 3.25, left: 2 }, 'per-side weights should persist in the local design');
  const addShadow = app.querySelector('[data-action="add-layer-effect"][data-effect-type="drop-shadow"]');
  assert(addShadow && addShadow.getBoundingClientRect().right <= rightPanel.right, 'effect actions should fit inside the phone inspector');
  click(addShadow);
  await waitForSaveCycle(app, 'drop shadow');
  const shadowBlend = app.querySelector('[data-effect-field="blendMode"]');
  assert(shadowBlend && [...shadowBlend.options].some(option => option.value === 'multiply'), 'the effect inspector should expose per-shadow blend modes');
  assert(shadowBlend.getBoundingClientRect().right <= app.querySelector('#right-panel').getBoundingClientRect().right, 'the shadow blend control should fit in the phone inspector');
  shadowBlend.value = 'multiply'; shadowBlend.dispatchEvent(new Event('input', { bubbles: true })); shadowBlend.dispatchEvent(new Event('change', { bubbles: true }));
  const shadowX = app.querySelector('[data-effect-field="offsetX"]');
  const shadowOpacity = app.querySelector('[data-effect-field="opacity"]');
  assert(shadowX && shadowOpacity, 'the inspector should expose shadow offset and opacity controls');
  shadowX.value = '6'; shadowX.dispatchEvent(new Event('input', { bubbles: true })); shadowX.dispatchEvent(new Event('change', { bubbles: true }));
  shadowOpacity.value = '45'; shadowOpacity.dispatchEvent(new Event('input', { bubbles: true })); shadowOpacity.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'shadow tuning');
  click(app.querySelector('[data-action="add-layer-effect"][data-effect-type="layer-blur"]'));
  await waitForSaveCycle(app, 'layer blur');
  const blurRadius = app.querySelector('[data-effect-field="radius"]');
  blurRadius.value = '3'; blurRadius.dispatchEvent(new Event('input', { bubbles: true })); blurRadius.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'blur tuning');
  const effectRecords = await readDocuments(); effectRecords.sort((a, b) => b.savedAt - a.savedAt);
  const effectButton = effectRecords[0]?.document.pages.flatMap(page => page.children).flatMap(frameNode => frameNode.children || []).find(node => node.id === button.id);
  assert(effectButton?.effects?.length === 2 && effectButton.effects[0].offsetX === 6 && effectButton.effects[0].opacity === 0.45 && effectButton.effects[0].blendMode === 'multiply' && effectButton.effects[1].radius === 3, 'shadow, blend, and blur settings should save together on the selected layer');
  click(app.querySelector('[data-inspector-tab="prototype"]'));
  let prototypeTransition = app.querySelector('#prototype-transition');
  assert([...prototypeTransition.options].some(option => option.value === 'smart-animate') && prototypeTransition.getBoundingClientRect().right <= app.querySelector('#right-panel').getBoundingClientRect().right, 'Smart animate should remain available inside the phone prototype inspector');
  prototypeTransition.value = 'smart-animate'; prototypeTransition.dispatchEvent(new Event('change', { bubbles: true }));
  const prototypeEasing = app.querySelector('#prototype-easing');
  assert(prototypeEasing && prototypeEasing.getBoundingClientRect().right <= app.querySelector('#right-panel').getBoundingClientRect().right, 'the easing control should fit inside the phone prototype inspector');
  const prototypeTrigger = app.querySelector('#prototype-trigger');
  prototypeTrigger.value = 'after-delay'; prototypeTrigger.dispatchEvent(new Event('change', { bubbles: true }));
  const prototypeDelay = app.querySelector('#prototype-delay');
  const prototypeDelayLabel = prototypeDelay?.closest('label');
  assert(prototypeDelay && prototypeDelayLabel && prototypeDelay.getBoundingClientRect().width >= prototypeDelayLabel.getBoundingClientRect().width - 2 && prototypeDelay.getBoundingClientRect().height >= 44, 'the after-delay slider should span the phone inspector and provide a 44px touch target');
  prototypeTrigger.value = 'on-click'; prototypeTrigger.dispatchEvent(new Event('change', { bubbles: true }));
  const prototypeAction = app.querySelector('#prototype-action');
  prototypeAction.value = 'open-overlay'; prototypeAction.dispatchEvent(new Event('change', { bubbles: true }));
  assert(![...app.querySelectorAll('#prototype-transition option')].some(option => option.value === 'smart-animate'), 'the phone prototype inspector should keep overlay transitions separate');
  prototypeAction.value = 'swap-overlay'; prototypeAction.dispatchEvent(new Event('change', { bubbles: true }));
  assert([...app.querySelectorAll('#prototype-transition option')].some(option => option.value === 'smart-animate'), 'the phone prototype inspector should offer Smart animate when swapping overlays');
  prototypeAction.value = 'navigate'; prototypeAction.dispatchEvent(new Event('change', { bubbles: true }));
  click(app.querySelector('[data-inspector-tab="inspect"]'));
  await waitFor(() => app.querySelector('.inspect-panel'), 'Inspect panel');
  const panel = app.querySelector('.inspect-panel');
  const css = panel.querySelector('.inspect-code-card code')?.textContent || '';
  assert(panel.textContent.includes('50, 60 px') && css.includes('position: relative;') && !css.includes('left: 50px;'), 'Inspect did not report page-space values while keeping an auto-layout child in flow.');
  assert(css.includes('background: radial-gradient(circle,') && css.includes('filter: drop-shadow(') && css.includes(' blur(3px);') && css.includes('border-radius: 10px;') && css.includes('rotate(3deg)'), 'Inspect CSS omitted resolved gradient or layer effects.');
  assert(css.includes('min-width: 150px;') && css.includes('max-width: 200px;') && css.includes('min-height: 44px;') && css.includes('max-height: 72px;'), 'Inspect CSS omitted the selected layer size limits.');
  assert(panel.textContent.includes('Primary button') && panel.textContent.includes('Mobile screen'), 'The selected layer or its owner is missing from the handoff summary.');
  const html = [...panel.querySelectorAll('.inspect-code-card')].find(card => card.querySelector('strong')?.textContent === 'HTML structure')?.querySelector('code')?.textContent || '';
  assert(html.includes('data-layer-type="rectangle"'), 'HTML handoff should include the selected layer.');
  const reactCard = [...panel.querySelectorAll('.inspect-code-card')].find(card => card.querySelector('strong')?.textContent === 'React component');
  const jsx = reactCard?.querySelector('code')?.textContent || '';
  assert(jsx.includes("import React from 'react';") && jsx.includes('export default function TinyImageStarHandoff()') && jsx.includes('<style>{styles}</style>'), 'React handoff should provide a component and its generated styles.');
  assert(jsx.includes('data-layer-type={"rectangle"}') && jsx.includes('className={"primary-button-'), 'React JSX should contain the selected editable layer.');
  const vueCard = [...panel.querySelectorAll('.inspect-code-card')].find(card => card.querySelector('strong')?.textContent === 'Vue 3 component');
  const vue = vueCard?.querySelector('code')?.textContent || '';
  assert(vue.startsWith('<template>') && vue.includes('<style>') && vue.includes('data-layer-type="rectangle"'), 'Vue handoff should provide an adaptable SFC scaffold with the selected layer.');
  assert(vueCard?.textContent.includes('Adaptable single-file component scaffold') && vueCard.textContent.includes('connect local images'), 'Vue handoff should identify the output as a scaffold and explain local asset wiring.');
  assert(Number.parseFloat(app.defaultView.getComputedStyle(panel.querySelector('.inspect-copy')).minHeight) >= 40, 'Copy control should remain finger-sized on a phone viewport.');

  const copied = [];
  Object.defineProperty(app.defaultView.navigator, 'clipboard', { configurable: true, value: { writeText: async text => copied.push(text) } });
  click(panel.querySelector('[data-inspect-copy="css"]'));
  await waitFor(() => copied.length === 1, 'copy CSS');
  assert(copied[0] === css, 'Copy CSS did not copy the visible generated CSS.');
  click(panel.querySelector('[data-inspect-copy="html"]'));
  await waitFor(() => copied.length === 2, 'copy HTML');
  assert(copied[1] === html, 'Copy HTML did not copy the visible generated markup.');
  click(panel.querySelector('[data-inspect-copy="jsx"]'));
  await waitFor(() => copied.length === 3, 'copy React JSX');
  assert(copied[2] === jsx, 'Copy JSX did not copy the visible generated React component.');
  click(panel.querySelector('[data-inspect-copy="vue"]'));
  await waitFor(() => copied.length === 4, 'copy Vue SFC');
  assert(copied[3] === vue, 'Copy SFC did not copy the visible generated Vue component.');
  click(panel.querySelector('[data-inspect-copy="json"]'));
  await waitFor(() => copied.length === 5, 'copy layer JSON');
  assert(JSON.parse(copied[4]).id === button.id, 'Copy JSON did not preserve exact selected layer data.');

  click(app.querySelector(`[data-layer-id="${screen.id}"]`));
  const handoffCard = kind => [...app.querySelectorAll('.inspect-panel .inspect-code-card')].find(card => card.querySelector('strong')?.textContent === kind);
  await waitFor(() => handoffCard('HTML structure')?.querySelector('code')?.textContent.includes('data-layer-type="text"'), 'nested frame HTML handoff');
  const frameHtml = handoffCard('HTML structure')?.querySelector('code')?.textContent || '';
  assert(frameHtml.includes('data-layer-type="frame"') && frameHtml.includes('data-layer-type="text"') && frameHtml.includes('Continue'), 'HTML handoff should preserve nested frame and text structure.');
  const frameJsx = handoffCard('React component')?.querySelector('code')?.textContent || '';
  assert(frameJsx.includes('data-layer-type={"frame"}') && frameJsx.includes('data-layer-type={"text"}') && frameJsx.includes('>{"Continue"}</span>'), 'React handoff should preserve nested frames and safely encoded text.');
  const frameVue = handoffCard('Vue 3 component')?.querySelector('code')?.textContent || '';
  assert(frameVue.includes('data-layer-type="frame"') && frameVue.includes('data-layer-type="text"') && frameVue.includes('v-text="&quot;Continue&quot;"'), 'Vue handoff should preserve nested frames and safely encoded text.');

  click(app.querySelector(`[data-layer-id="${label.id}"]`));
  await waitFor(() => app.querySelector('.inspect-panel')?.textContent.includes('16 px · Arial, sans-serif'), 'text metrics');
  assert(app.querySelector('.inspect-panel').textContent.includes('Continue'), 'Inspect panel did not show resolved text content.');
  const selectedVerticalAlign = app.querySelector('[data-prop="verticalAlign"]')?.value;
  const handoffJson = app.querySelector('.inspect-json-card pre code')?.textContent || '[]';
  const handoffLayer = JSON.parse(handoffJson)[0];
  const verticalCss = app.querySelector('.inspect-panel .inspect-code-card code')?.textContent || '';
  assert(verticalCss.includes('justify-content: flex-end;'), `Inspect CSS should hand off bottom-aligned text; control=${selectedVerticalAlign}, layer=${handoffLayer?.verticalAlign}, typography=${handoffLayer?.typography?.verticalAlign}; found: ${verticalCss}`);
  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', nestedPageCoordinates: true, resolvedStyleValues: true, nestedHtmlHandoff: true, nestedReactHandoff: true, nestedVueHandoff: true, strokeStyles: true, typography: true, verticalTextAlignment: true, exactLayerJson: true, clipboardCopy: true, phoneSizedActions: true, afterDelayPhoneControl: true, gradientStopRailInsert: true, gradientStopInterpolatedColor: true, gradientStopKeyboardMove: true, gradientStopLocalReload: true, coarsePointerGradientTargetChecked })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
