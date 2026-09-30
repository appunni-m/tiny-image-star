import { addNode, createDocument, createImageRecipe, createNode } from '../src/model.js';
import { deleteStoredDocument, loadDocumentById, saveDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } } catch { /* Wait for the next batch transition. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    void poll();
  });
}
function tap(app, element) {
  assert(element, 'Expected a bulk retry control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function imageRecipeState(node) {
  return JSON.stringify({
    adjustments: node.adjustments,
    transforms: node.transforms,
    fit: node.fit,
    opacity: node.opacity,
    outputFormat: node.outputFormat,
    outputQuality: node.outputQuality
  });
}

let designId = null;
let outcome;
try {
  const design = createDocument();
  design.name = `Bulk retry smoke ${Date.now()}`;
  const image = createNode('image', { name: 'Missing local source', assetId: 'missing-retry-smoke-asset', width: 120, height: 80 });
  const originalRecipeState = imageRecipeState(image);
  addNode(design, image);
  const recipe = createImageRecipe(image, 'Retry missing preview', { format: 'png', quality: 90 });
  design.recipes.push(recipe);
  designId = design.id;
  await saveDocument(design);

  const app = frame.contentDocument;
  await waitFor(() => app?.documentElement.dataset.appReady === 'true', 'editor startup');
  tap(app, app.querySelector('#main-menu-button'));
  const libraryMenuItem = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  tap(app, libraryMenuItem);
  const libraryDialog = app.querySelector('#design-library-dialog');
  const designButton = await waitFor(() => libraryDialog.open && libraryDialog.querySelector(`[data-design-id="${designId}"][data-design-action="open"]`), 'smoke design in local library');
  tap(app, designButton);
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'smoke design open');
  tap(app, app.querySelector(`[data-layer-id="${image.id}"]`));
  await waitFor(() => app.querySelector('[data-action="apply-image-recipe"]'), 'image recipe action');
  const picker = app.querySelector('#selection-image-recipe');
  picker.value = recipe.id;
  tap(app, app.querySelector('[data-action="apply-image-recipe"]'));

  const retry = app.querySelector('#bulk-retry');
  await waitFor(() => !retry.hidden && retry.textContent.includes('(1)'), 'first failed target and retry action');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'rolled-back recipe save');
  assert(app.querySelector('#bulk-title').textContent.includes('errors'), 'A failed preview should be reported without hiding the batch result.');
  const beforeRetry = await loadDocumentById(designId);
  const failedImage = beforeRetry.pages[0].children.find(node => node.id === image.id);
  assert(imageRecipeState(failedImage) === originalRecipeState,
    `A failed preview should roll back all image recipe fields. Expected ${originalRecipeState}; got ${imageRecipeState(failedImage)}.`);

  tap(app, retry);
  await waitFor(() => !retry.hidden && retry.textContent.includes('(1)'), 'retry batch failure');
  assert(app.querySelector('#bulk-progress-label').textContent === '1 / 1', 'Retry should submit only the one failed image.');
  const afterRetry = await loadDocumentById(designId);
  const finalImage = afterRetry.pages[0].children.find(node => node.id === image.id);
  assert(imageRecipeState(finalImage) === originalRecipeState,
    'A repeated failure should continue preserving the original image recipe state.');
  tap(app, app.querySelector('#bulk-done'));
  assert(app.querySelector('#bulk-bar').hidden, 'The drained retry result should be dismissible.');
  outcome = `PASS\n${JSON.stringify({ failedTargetsRetained: 1, retryTargets: 1, failureRollback: true, retryResultDismissed: true })}`;
} catch (error) {
  outcome = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  if (designId) await deleteStoredDocument(designId).catch(() => {});
}
result.textContent = outcome;
