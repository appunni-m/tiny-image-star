import { addNode, createDocument, createImageRecipe, createNode } from '../src/model.js';
import { claimRecipeBatchRecovery, deleteRecipeBatchRecovery, deleteStoredDocument, listSavedDocuments, loadDocumentById, loadRecipeBatchRecovery, RECIPE_BATCH_RECOVERY_LEASE_MS, saveDocument, saveRecipeBatchRecovery } from '../src/storage.js';

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

const designIds = new Set();
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
  designIds.add(design.id);
  await saveDocument(design);
  const priorOwnerToken = 'run-bulk-retry-fixture';
  await claimRecipeBatchRecovery({
    documentId: design.id, ownerToken: priorOwnerToken, recipe, pageId: design.activePageId, targetIds: [image.id], status: 'running'
  }, { now: Date.now() - RECIPE_BATCH_RECOVERY_LEASE_MS - 1 });

  const app = frame.contentDocument;
  await waitFor(() => app?.documentElement.dataset.appReady === 'true', 'editor startup');
  tap(app, app.querySelector('#main-menu-button'));
  const libraryMenuItem = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  tap(app, libraryMenuItem);
  const libraryDialog = app.querySelector('#design-library-dialog');
  const designButton = await waitFor(() => libraryDialog.open && libraryDialog.querySelector(`[data-design-id="${designId}"][data-design-action="open"]`), 'smoke design in local library');
  tap(app, designButton);
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'smoke design open');
  const recoveryDialog = await waitFor(() => app.querySelector('#recipe-recovery-dialog')?.open && app.querySelector('#recipe-recovery-resume'), 'interrupted recipe recovery prompt');
  assert(app.querySelector('#recipe-recovery-recipe').textContent === recipe.name
    && app.querySelector('#recipe-recovery-copy').textContent.includes('1 image layer'),
  'The recovery prompt did not describe the saved recipe and target count.');
  tap(app, recoveryDialog);

  const retry = app.querySelector('#bulk-retry');
  await waitFor(() => !retry.hidden && retry.textContent.includes('(1)'), 'first failed target and retry action');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'rolled-back recipe save');
  assert(app.querySelector('#bulk-title').textContent.includes('errors'), 'A failed preview should be reported without hiding the batch result.');
  const beforeRetry = await loadDocumentById(designId);
  const failedImage = beforeRetry.pages[0].children.find(node => node.id === image.id);
  assert(imageRecipeState(failedImage) === originalRecipeState,
    `A failed preview should roll back all image recipe fields. Expected ${originalRecipeState}; got ${imageRecipeState(failedImage)}.`);
  assert((await loadRecipeBatchRecovery(designId))?.targetIds.includes(image.id),
    'An interrupted batch should keep its recovery journal until the user resolves the result.');

  tap(app, retry);
  await waitFor(() => !retry.hidden && retry.textContent.includes('(1)'), 'retry batch failure');
  assert(app.querySelector('#bulk-progress-label').textContent === '1 / 1', 'Retry should submit only the one failed image.');
  const afterRetry = await loadDocumentById(designId);
  const finalImage = afterRetry.pages[0].children.find(node => node.id === image.id);
  assert(imageRecipeState(finalImage) === originalRecipeState,
    'A repeated failure should continue preserving the original image recipe state.');
  tap(app, app.querySelector('#bulk-done'));
  await waitFor(() => app.querySelector('#bulk-bar').hidden, 'recovered batch result dismissal');
  assert((await loadRecipeBatchRecovery(designId)) === null, 'Dismissing the saved result should clear its recovery journal.');
  assert(app.querySelector('#bulk-bar').hidden, 'The drained retry result should be dismissible.');

  const activeDesign = createDocument();
  activeDesign.name = `Active recovery source ${Date.now()}`;
  const activeImage = createNode('image', { name: 'Still missing', assetId: 'missing-active-recovery-asset', width: 120, height: 80 });
  addNode(activeDesign, activeImage);
  const activeRecipe = createImageRecipe(activeImage, 'Resume without the other tab', { format: 'png', quality: 90 });
  activeDesign.recipes.push(activeRecipe);
  designIds.add(activeDesign.id);
  await saveDocument(activeDesign);
  const activeOwnerToken = 'run-bulk-retry-active-fixture';
  await claimRecipeBatchRecovery({
    documentId: activeDesign.id, ownerToken: activeOwnerToken, recipe: activeRecipe,
    pageId: activeDesign.activePageId, targetIds: [activeImage.id], status: 'running'
  }, { now: Date.now(), leaseMs: RECIPE_BATCH_RECOVERY_LEASE_MS });

  tap(app, app.querySelector('#main-menu-button'));
  const secondLibraryItem = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  tap(app, secondLibraryItem);
  const activeDesignButton = await waitFor(() => libraryDialog.open
    && libraryDialog.querySelector(`[data-design-id="${activeDesign.id}"][data-design-action="open"]`), 'active-lease fixture in local library');
  tap(app, activeDesignButton);
  const activeRecoveryDialog = await waitFor(() => app.querySelector('#recipe-recovery-dialog')?.open
    && app.querySelector('#recipe-recovery-resume')?.textContent === 'Take over and resume here',
  'in-place takeover action for an active recovery lease');
  tap(app, app.querySelector('#recipe-recovery-resume'));
  const resumedRecovery = await waitFor(async () => {
    const record = await loadRecipeBatchRecovery(activeDesign.id);
    return record?.ownerToken && record.ownerToken !== activeOwnerToken ? record : null;
  }, 'active lease taken over under the existing design identity');
  assert(resumedRecovery.documentId === activeDesign.id, 'Recovery stays on the original design.');
  assert(resumedRecovery.targetIds[0] === activeImage.id, 'The saved batch target resumes in place.');
  assert(app.querySelector('#document-name').value === activeDesign.name, 'No recovery-copy design is opened.');
  assert(!(await listSavedDocuments()).some(item => item.name.endsWith('(recipe recovery copy)')),
    'Taking over does not create a duplicate design.');
  let previousOwnerError = null;
  try {
    await saveRecipeBatchRecovery({
      documentId: activeDesign.id, ownerToken: activeOwnerToken, recipe: activeRecipe,
      pageId: activeDesign.activePageId, targetIds: [activeImage.id], status: 'running'
    });
  } catch (error) {
    previousOwnerError = error;
  }
  assert(/no longer owns/.test(previousOwnerError?.message || ''),
    'the previous tab owner is fenced from further recipe writes');
  outcome = `PASS\n${JSON.stringify({ failedTargetsRetained: 1, retryTargets: 1, failureRollback: true, retryResultDismissed: true, activeLeaseTakenOverInPlace: true, previousOwnerFenced: true, sameDesignIdResumed: true })}`;
} catch (error) {
  outcome = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  for (const designId of designIds) {
    const recovery = await loadRecipeBatchRecovery(designId).catch(() => null);
    if (recovery?.ownerToken) await deleteRecipeBatchRecovery(designId, recovery.ownerToken).catch(() => {});
    await deleteStoredDocument(designId).catch(() => {});
  }
}
result.textContent = outcome;
