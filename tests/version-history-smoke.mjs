import { addNode, createDocument, createNode } from '../src/model.js';
import { deleteStoredDocument, listDocumentVersions, loadDocumentById, saveDocument, saveDocumentVersion } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } } catch { /* Wait for the editor to finish switching documents. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    poll();
  });
}
function tap(app, element) {
  assert(element, 'Expected a version-history control.');
  const Pointer = app.defaultView.PointerEvent;
  if (Pointer) {
    element.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true, pointerId: 91, pointerType: 'touch', button: 0 }));
    element.dispatchEvent(new Pointer('pointerup', { bubbles: true, cancelable: true, pointerId: 91, pointerType: 'touch', button: 0 }));
  }
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

let designId = null;
let outcome;
try {
  const design = createDocument();
  design.name = `Version history smoke ${Date.now()}`;
  const card = createNode('rectangle', { name: 'Checkpoint card', fill: '#e14452', width: 120, height: 72 });
  addNode(design, card);
  designId = design.id;
  await saveDocument(design);
  const first = await saveDocumentVersion(design, { name: 'Before color edit', force: true });
  const revised = structuredClone(design);
  revised.pages[0].children[0].fill = '#2165d2';
  await saveDocument(revised);
  await saveDocumentVersion(revised, { name: 'Blue direction', force: true });

  const app = frame.contentDocument;
  await waitFor(() => app?.documentElement.dataset.appReady === 'true', 'editor startup');
  tap(app, app.querySelector('#main-menu-button'));
  const libraryMenuItem = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  tap(app, libraryMenuItem);
  const libraryDialog = app.querySelector('#design-library-dialog');
  const designRow = await waitFor(() => libraryDialog.open && libraryDialog.querySelector(`[data-design-id="${designId}"][data-design-action="open"]`), 'smoke design in local library');
  tap(app, designRow);
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'smoke design open');
  assert(app.title === 'Tiny Image Star', 'The editor should use Tiny Image Star as its public name.');

  tap(app, app.querySelector('#main-menu-button'));
  const historyMenuItem = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Version history'));
  tap(app, historyMenuItem);
  const dialog = app.querySelector('#version-history-dialog');
  await waitFor(() => dialog.open && dialog.querySelector('[data-version-action="restore"]'), 'local version list');
  const controls = [...dialog.querySelectorAll('button, input')];
  assert(controls.every(control => control.getBoundingClientRect().width > 0 && control.getBoundingClientRect().height > 0),
    'Version history controls should remain visible at phone viewport size.');
  const list = dialog.querySelector('#version-history-list');
  assert(list.textContent.includes('Before color edit') && list.textContent.includes('Blue direction'),
    'The dialog should show named snapshots in the current design history.');

  const name = dialog.querySelector('#version-save-name');
  name.value = 'Phone review checkpoint';
  dialog.querySelector('#version-save-form').dispatchEvent(new app.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(async () => (await listDocumentVersions(designId)).some(version => version.name === 'Phone review checkpoint'), 'named local checkpoint');
  const rows = [...dialog.querySelectorAll('.version-record')];
  const phoneRow = rows.find(row => row.textContent.includes('Phone review checkpoint'));
  assert(phoneRow, 'The named checkpoint should render in the version list.');

  const restore = dialog.querySelector(`[data-version-action="restore"][data-version-id="${first.id}"]`);
  tap(app, restore);
  await waitFor(() => !dialog.open, 'version restore');
  await waitFor(async () => (await loadDocumentById(designId))?.pages?.[0]?.children?.[0]?.fill === '#e14452', 'restored document pixels');
  assert((await loadDocumentById(designId)).pages[0].children[0].fill === '#e14452',
    'Restoring a named version should replace the current local document snapshot.');
  outcome = `PASS\n${JSON.stringify({ phoneViewport: '390x844', namedVersionsListed: true, namedCheckpointSaved: true, restoreControl: true, restoredFill: '#e14452' })}`;
} catch (error) {
  outcome = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  if (designId) await deleteStoredDocument(designId).catch(() => {});
}
result.textContent = outcome;
