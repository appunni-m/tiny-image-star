import { addNode, createComponent, createComponentInstance, createComponentProperty, createDocument, createNode } from '../src/model.js';
import { saveDocument } from '../src/storage.js';

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 12000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } }
      catch { /* The editor may be refreshing its document or inspector. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 30);
    };
    poll();
  });
}
async function readDocumentRecord(id) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('figma-local-documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('documents').objectStore('documents').get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function waitForSavedExposure(documentId, componentId, expectedIds) {
  const started = performance.now();
  while (performance.now() - started < 12000) {
    const record = await readDocumentRecord(documentId);
    const actual = record?.document?.components?.find(component => component.id === componentId)?.exposedNestedInstances || [];
    if (JSON.stringify(actual) === JSON.stringify(expectedIds)) return record;
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  throw new Error('Timed out waiting for the component exposure change to save.');
}
function shortcut(app, key, shift = false) {
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', {
    bubbles: true, cancelable: true, key, ctrlKey: true, shiftKey: shift
  }));
}
async function flushCanvas(app) {
  await new Promise(resolve => app.defaultView.requestAnimationFrame(() => app.defaultView.requestAnimationFrame(resolve)));
}
function countPropertyHighlightPixels(app) {
  const canvas = app.querySelector('#scene-canvas');
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] > 95 && pixels[index] < 190 && pixels[index + 1] < 125 && pixels[index + 2] > 205) count += 1;
  }
  return count;
}

try {
  const design = createDocument();
  design.name = 'Nested exposure interaction smoke';
  const nestedRoot = createNode('frame', { name: 'Nested component', x: 20, y: 20, width: 140, height: 60 });
  const nestedLabel = createNode('text', { name: 'Nested label', text: 'Nested', x: 16, y: 14, width: 90, height: 28 });
  addNode(design, nestedRoot);
  addNode(design, nestedLabel, { parentId: nestedRoot.id });
  const nestedComponent = createComponent(design, nestedRoot.id, 'Nested component');
  createComponentProperty(design, nestedComponent.id, { name: 'Label', type: 'TEXT', targetNodeId: nestedLabel.id });

  const ownerRoot = createNode('frame', { name: 'Owner component', width: 360, height: 180 });
  addNode(design, ownerRoot);
  const firstNested = createComponentInstance(design, nestedComponent.id, { parentId: ownerRoot.id });
  firstNested.name = 'Primary label';
  const secondNested = createComponentInstance(design, nestedComponent.id, { parentId: ownerRoot.id });
  secondNested.name = 'Secondary label';
  secondNested.x = 185;
  const ownerComponent = createComponent(design, ownerRoot.id, 'Owner component');
  const ownerInstance = createComponentInstance(design, ownerComponent.id);
  await saveDocument(design);
  await new Promise(resolve => setTimeout(resolve, 15));

  const frame = document.querySelector('#app-frame');
  const previous = frame.contentDocument;
  frame.style.width = '390px';
  frame.style.height = '844px';
  const url = new URL('../index.html', location.href);
  url.searchParams.set('component-exposure-smoke', String(Date.now()));
  frame.src = url.href;
  await waitFor(() => frame.contentDocument && frame.contentDocument !== previous
    && frame.contentDocument.documentElement.dataset.appReady === 'true', 'phone editor boot');
  const app = frame.contentDocument;

  const leftPanel = app.querySelector('#left-panel');
  if (!leftPanel.classList.contains('is-open')) app.querySelector('#sidebar-toggle').click();
  const ownerRow = app.querySelector(`[data-layer-id="${ownerRoot.id}"]`);
  assert(ownerRow, 'the nested exposure fixture did not load its owner component');
  ownerRow.click();
  const rightPanel = app.querySelector('#right-panel');
  if (!rightPanel.classList.contains('is-open')) app.querySelector('#inspector-toggle').click();
  await waitFor(() => app.querySelector(`[data-action="edit-component-exposures"][data-component-id="${ownerComponent.id}"]`), 'component exposure action');
  app.querySelector(`[data-action="edit-component-exposures"][data-component-id="${ownerComponent.id}"]`).click();
  const dialog = app.querySelector('#component-exposure-dialog');
  await waitFor(() => dialog.open, 'nested exposure dialog');
  const options = [...app.querySelectorAll('[data-exposed-nested-instance]')];
  assert(options.length === 2, 'the dialog did not list both eligible nested instances');
  options[0].click();
  app.querySelector('#component-exposure-form [value="cancel"]').click();
  await waitFor(() => !dialog.open, 'exposure dialog cancel');
  let record = await readDocumentRecord(design.id);
  assert(!record?.document?.components?.find(component => component.id === ownerComponent.id)?.exposedNestedInstances,
    'canceling the dialog changed the saved component definition');

  app.querySelector(`[data-action="edit-component-exposures"][data-component-id="${ownerComponent.id}"]`).click();
  await waitFor(() => dialog.open, 'reopened nested exposure dialog');
  for (const option of [...app.querySelectorAll('[data-exposed-nested-instance]')]) option.click();
  const firstOption = app.querySelector('[data-exposed-nested-instance]');
  const apply = app.querySelector('#component-exposure-apply');
  assert(firstOption.closest('.component-exposure-option').getBoundingClientRect().height >= 44
    && apply.getBoundingClientRect().height >= 44,
  'nested exposure rows and apply remain finger-sized on a phone');
  apply.click();
  await waitFor(() => !dialog.open, 'nested exposure apply');
  record = await waitForSavedExposure(design.id, ownerComponent.id, [firstNested.id, secondNested.id]);
  const savedOwner = record?.document?.components?.find(component => component.id === ownerComponent.id);
  assert(JSON.stringify(savedOwner?.exposedNestedInstances) === JSON.stringify([firstNested.id, secondNested.id]),
    'applying two nested selections did not save them together');
  shortcut(app, 'z');
  await waitForSavedExposure(design.id, ownerComponent.id, []);
  shortcut(app, 'z', true);
  await waitForSavedExposure(design.id, ownerComponent.id, [firstNested.id, secondNested.id]);

  if (!leftPanel.classList.contains('is-open')) app.querySelector('#sidebar-toggle').click();
  const instanceRow = app.querySelector(`[data-layer-id="${ownerInstance.id}"]`);
  assert(instanceRow, 'the exposed owner instance is not present in the layer list');
  instanceRow.click();
  if (!rightPanel.classList.contains('is-open')) app.querySelector('#inspector-toggle').click();
  await waitFor(() => app.querySelectorAll('[data-component-property-highlight]').length === 2, 'exposed property rows');
  const propertyRows = [...app.querySelectorAll('[data-component-property-highlight]')];
  assert(propertyRows.every(row => row.dataset.componentPropertyTargetSourceId === nestedLabel.id),
    'the nested property rows lost their source-layer identity');
  const canvas = app.querySelector('#scene-canvas');
  const beforeHover = countPropertyHighlightPixels(app);
  propertyRows[0].dispatchEvent(new app.defaultView.PointerEvent('pointerover', { bubbles: true }));
  await flushCanvas(app);
  const afterHover = countPropertyHighlightPixels(app);
  assert(afterHover > beforeHover, 'hovering a nested property did not draw its target outline on the canvas');
  propertyRows[0].dispatchEvent(new app.defaultView.PointerEvent('pointerout', { bubbles: true, relatedTarget: null }));
  propertyRows[0].querySelector('input').focus();
  await flushCanvas(app);
  const afterFocus = countPropertyHighlightPixels(app);
  assert(afterFocus > beforeHover, 'keyboard focus did not draw the property target outline on the canvas');
  propertyRows[0].querySelector('input').blur();
  await flushCanvas(app);
  assert(countPropertyHighlightPixels(app) <= beforeHover, 'leaving the property row left a stale canvas outline');
  result.textContent = `PASS\n${JSON.stringify({ cancelPreservedDefinition: true, multiSelectAppliedAtomically: true, singleStepUndoRedo: true, mobileTapTargets: true, hoverCanvasOutline: true, focusCanvasOutline: true, clearedCanvasOutline: true, controls: propertyRows.length, canvas: { width: canvas.width, height: canvas.height } })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
