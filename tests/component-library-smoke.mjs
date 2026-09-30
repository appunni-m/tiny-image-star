import { addNode, createComponent, createDocument, createNode } from '../src/model.js';
import { deleteComponentLibrary, deleteStoredDocument, listComponentLibraries, loadDocumentById } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const documentId = `component-library-smoke-${Date.now()}`;
const libraryName = `Smoke library ${Date.now()}`;
let outcome;

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 18000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { if (await test()) { resolve(); return; } } catch { /* Wait for editor startup, rendering, or save completion. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    void poll();
  });
}
function click(app, element, label = 'editor control') {
  assert(element, `Could not find ${label}.`);
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function findNode(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return null;
}
function importDesign(app, design) {
  const payload = new TextEncoder().encode(JSON.stringify({ schema: design.schema, document: design, assets: [] }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, payload.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, payload];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], `${documentId}.flocal`, { type: 'application/octet-stream' }));
  const input = app.querySelector('#open-file-input');
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}
function selectLayer(app, id) {
  const row = app.querySelector(`.layer-row[data-layer-id="${id}"]`);
  click(app, row, `layer row ${id}`);
}
function editProperty(app, property, value) {
  const input = app.querySelector(`#inspector-content [data-prop="${property}"]`);
  assert(input, `The inspector did not expose ${property}.`);
  input.value = String(value);
  input.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  input.blur();
}
async function waitForSave(app, label) {
  await waitFor(() => {
    const status = app.querySelector('#save-state')?.textContent || '';
    return status.includes('Saving locally') || status.includes('Saved locally');
  }, `${label} save start or completion`);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${label} save completion`);
}
async function savedDesign() {
  return loadDocumentById(documentId);
}
function linkedRoots(design) { return design.pages.flatMap(page => page.children).filter(node => node.linkedComponent); }

try {
  const design = createDocument();
  design.id = documentId;
  design.name = documentId;
  const root = createNode('frame', { name: 'Reusable card', x: 30, y: 40, width: 260, height: 150, fill: '#ffffff' });
  const swatch = createNode('rectangle', { name: 'Card color', x: 12, y: 12, width: 80, height: 54, fill: '#2563eb', radius: 8 });
  const label = createNode('text', { name: 'Card label', x: 106, y: 22, width: 132, height: 40, text: 'Local component', fontSize: 18, color: '#111827' });
  addNode(design, root); addNode(design, swatch, { parentId: root.id }); addNode(design, label, { parentId: root.id });
  const mainComponent = createComponent(design, root.id, 'Reusable card');

  frame.src = '../index.html';
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup', 45000);
  const app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'The editor should use the Tiny Image Star public name.');
  importDesign(app, design);
  await waitFor(() => app.querySelector('#document-name')?.value === documentId, 'isolated design import');
  await waitFor(() => app.querySelector(`.layer-row[data-layer-id="${root.id}"]`), 'component layer');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'initial design save');

  app.defaultView.prompt = () => libraryName;
  selectLayer(app, root.id);
  click(app, app.querySelector('.sidebar-tab[data-sidebar-tab="assets"]'), 'Assets tab');
  click(app, app.querySelector('#create-component-library'), 'create local library');
  await waitFor(() => app.querySelector('#component-library-list .local-library-card'), 'local library creation');
  const publishSelected = app.querySelector('#component-library-list [data-publish-local-component]');
  assert(publishSelected && !publishSelected.disabled, 'Assets should allow publishing the selected main component.');
  click(app, publishSelected, 'publish selected component');
  await waitFor(() => app.querySelector('#component-library-list [data-local-library-id][data-local-component-id]'), 'published library component');
  const placeCard = () => app.querySelector('#component-library-list [data-local-library-id][data-local-component-id]');
  const libraryId = placeCard().dataset.localLibraryId;
  const componentId = placeCard().dataset.localComponentId;

  click(app, placeCard(), 'place the first linked instance from Assets');
  await waitFor(async () => linkedRoots(await savedDesign()).length === 1, 'first linked placement');
  await waitForSave(app, 'first linked placement');
  click(app, placeCard(), 'place the second linked instance from Assets');
  await waitFor(async () => linkedRoots(await savedDesign()).length === 2, 'second linked placement');
  await waitForSave(app, 'second linked placement');

  const initial = await savedDesign();
  const [instanceA, instanceB] = linkedRoots(initial);
  assert(instanceA && instanceB && instanceA.linkedComponent.sourceRevision === 1 && instanceB.linkedComponent.sourceRevision === 1,
    'Both Assets placements should be linked to the first published revision.');

  click(app, app.querySelector('.sidebar-tab[data-sidebar-tab="layers"]'), 'Layers tab');
  selectLayer(app, instanceA.id);
  editProperty(app, 'x', 321);
  editProperty(app, 'y', 123);
  await waitForSave(app, 'first instance placement edit');
  selectLayer(app, instanceA.children[0].id);
  editProperty(app, 'fill', '#ef4444');
  await waitForSave(app, 'first linked instance override');
  selectLayer(app, instanceA.id);
  const republish = app.querySelector('#inspector-content [data-action="publish-local-instance"]');
  click(app, republish, 'republish edited linked component');
  await waitFor(async () => {
    const library = (await listComponentLibraries()).find(item => item.id === libraryId);
    return library?.revision === 2;
  }, 'second local library revision');
  await waitForSave(app, 'linked component republish');

  selectLayer(app, instanceB.id);
  editProperty(app, 'x', 555);
  editProperty(app, 'y', 444);
  await waitForSave(app, 'second instance placement edit');
  selectLayer(app, instanceB.children[0].id);
  editProperty(app, 'fill', '#22c55e');
  await waitForSave(app, 'second linked instance override');
  selectLayer(app, instanceB.id);
  await waitFor(() => app.querySelector('#inspector-content [data-action="update-local-component"]'), 'new revision update action');
  click(app, app.querySelector('#inspector-content [data-action="update-local-component"]'), 'update linked instance');
  await waitFor(async () => {
    const saved = await savedDesign();
    const updated = findNode(saved.pages.flatMap(page => page.children), instanceB.id);
    return updated?.linkedComponent?.sourceRevision === 2 && updated?.children[0]?.fill === '#22c55e';
  }, 'updated source with preserved local override');
  await waitForSave(app, 'linked instance update');

  const finalDesign = await savedDesign();
  const updatedA = findNode(finalDesign.pages.flatMap(page => page.children), instanceA.id);
  const updatedB = findNode(finalDesign.pages.flatMap(page => page.children), instanceB.id);
  assert(updatedA.linkedComponent.sourceRevision === 2 && updatedA.children[0].fill === '#ef4444',
    'Republishing the first instance should publish its edited visual as revision 2.');
  assert(updatedB.linkedComponent.libraryId === libraryId && updatedB.linkedComponent.componentId === componentId,
    'The second instance should keep its local library/component identity.');
  assert(updatedB.linkedComponent.sourceRevision === 2, 'The second instance should update to the published revision.');
  assert(updatedB.x === 555 && updatedB.y === 444, 'Updating must preserve instance placement.');
  assert(updatedB.children[0].fill === '#22c55e' && updatedB.linkedComponent.overrides[updatedB.children[0].componentSourceId].fill === '#22c55e',
    'Updating must preserve a compatible local fill override over the newer library default.');
  outcome = `PASS\n${JSON.stringify({ libraryPublishedRevision: 2, assetsPlacements: 2, linkedInstances: 2, sourceRepublishedFill: updatedA.children[0].fill, updatedInstance: { revision: updatedB.linkedComponent.sourceRevision, x: updatedB.x, y: updatedB.y, preservedOverride: updatedB.children[0].fill } })}`;
} catch (error) {
  outcome = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  await deleteStoredDocument(documentId).catch(() => {});
  const libraries = await listComponentLibraries().catch(() => []);
  for (const library of libraries.filter(item => item.name === libraryName)) await deleteComponentLibrary(library.id).catch(() => {});
}
result.textContent = outcome;
