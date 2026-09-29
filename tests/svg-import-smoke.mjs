import { addNode, createDocument, createNode } from '../src/model.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 12000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for the editor and its local save cycle. */ }
      if (performance.now() - start > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 30);
    };
    poll();
  });
}
function click(app, element) {
  assert(element, 'Expected an interactive editor control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function packageFile(documentData) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: documentData.schema, document: documentData, assets: [] }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
function readDocument(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('figma-local-documents', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('documents').objectStore('documents').get(id);
      read.onsuccess = () => { resolve(read.result?.document || null); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  });
}
async function waitForSave(app, label) {
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saving locally'), `${label} save start`);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${label} save completion`);
}
function walk(nodes, visit) {
  for (const node of nodes || []) { visit(node); walk(node.children, visit); }
}
function fileChange(app, input, file) {
  const transfer = new app.defaultView.DataTransfer();
  transfer.items.add(file);
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}
async function importViaFileMenu(app, filename, source) {
  const input = app.querySelector('#svg-input');
  assert(input?.accept.includes('image/svg+xml') && input.hidden, 'The editor should provide a hidden local SVG file input.');
  let pickerRequested = false;
  input.click = () => { pickerRequested = true; };
  click(app, app.querySelector('#file-menu-button'));
  const menuItem = [...app.querySelectorAll('#context-menu button')]
    .find(button => button.textContent.trim() === 'Import SVG as editable layers…');
  assert(menuItem, 'The File menu should expose SVG import as editable layers.');
  click(app, menuItem);
  assert(pickerRequested, 'Choosing SVG import from the File menu should open the local file picker.');
  fileChange(app, input, new app.defaultView.File([source], filename, { type: 'image/svg+xml' }));
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'The public product name should remain Tiny Image Star.');

  // Start from a known local design so the test proves imports append in place.
  const design = createDocument();
  design.name = 'SVG import smoke';
  const existing = createNode('rectangle', { name: 'Existing layer', x: 12, y: 14, width: 28, height: 20, fill: '#9a3412' });
  addNode(design, existing);
  const localInput = app.querySelector('#open-file-input');
  fileChange(app, localInput, new app.defaultView.File([packageFile(design)], 'svg-import-smoke.flocal', { type: 'application/octet-stream' }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Local design opened')), 'known local design import');
  await waitForSave(app, 'known local design');
  assert((await readDocument(design.id))?.pages?.[0]?.children?.[0]?.id === existing.id, 'The baseline layer should be persisted before SVG import.');

  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 120 80">
    <defs><linearGradient id="sunset"><stop offset="0" stop-color="#3366cc"/><stop offset="1" stop-color="#ff7744"/></linearGradient></defs>
    <g id="Editable group" transform="translate(5 7)">
      <path id="Blue curve" d="M 5 8 C 14 1 22 18 31 9 L 31 25 L 5 25 Z" fill="#3366cc"/>
    </g>
    <rect id="Red box" x="55" y="12" width="25" height="18" fill="#cc3322"/>
    <rect id="Gradient box" x="85" y="12" width="25" height="18" fill="url(#sunset)"/>
  </svg>`;
  await importViaFileMenu(app, 'safe-artwork.svg', source);
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('safe-artwork.svg imported as editable layers')), 'editable SVG import');
  await waitForSave(app, 'first SVG import');
  const firstDocument = await readDocument(design.id);
  assert(firstDocument?.pages?.[0]?.children?.length === 2, 'A successful SVG import should append one root to the current design.');
  const firstRoot = firstDocument.pages[0].children.find(node => node.name === 'safe-artwork');
  assert(firstRoot?.type === 'frame' && firstRoot.width === 240 && firstRoot.height === 160, 'The SVG should become a correctly sized editable frame.');
  const firstNodes = [];
  walk([firstRoot], node => firstNodes.push(node));
  assert(firstNodes.some(node => node.type === 'group' && node.name === 'Editable group'), 'SVG groups should remain editable groups.');
  assert(firstNodes.some(node => node.type === 'path' && node.name === 'Blue curve' && node.fill.toLowerCase() === '#3366cc'), 'SVG geometry should be imported as an editable filled vector path.');
  assert(firstNodes.some(node => node.type === 'path' && node.name === 'Red box' && node.fill.toLowerCase() === '#cc3322'), 'SVG rectangles should be imported as editable vector paths.');
  const gradientBox = firstNodes.find(node => node.name === 'Gradient box');
  assert(gradientBox?.type === 'path' && gradientBox.fillGradient?.type === 'linear' && gradientBox.fillGradient.stops.length === 2, 'local SVG linear gradients should become editable gradient fills.');
  const firstIds = firstNodes.map(node => node.id);
  assert(new Set(firstIds).size === firstIds.length, 'The imported vector tree should have unique layer IDs.');
  const firstRootRow = app.querySelector(`[data-layer-id="${firstRoot.id}"]`);
  assert(firstRootRow?.dataset.layerType === 'frame' && firstRootRow.getAttribute('aria-selected') === 'true', 'The imported root should appear in the editable layer tree and be selected.');
  assert(app.querySelector(`[data-layer-type="group"] .layer-name`)?.textContent === 'Editable group', 'The imported group should be visible in the layer panel.');
  assert([...app.querySelectorAll('.layer-row[data-layer-type="path"]')].some(row => row.querySelector('.layer-name')?.textContent === 'Blue curve'), 'Imported paths should be individually selectable in the layer panel.');

  await importViaFileMenu(app, 'safe-artwork.svg', source);
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('safe-artwork.svg imported as editable layers')), 'repeat SVG import');
  await waitForSave(app, 'repeat SVG import');
  const repeatedDocument = await readDocument(design.id);
  assert(repeatedDocument?.pages?.[0]?.children?.length === 3, 'Repeated imports should append a second SVG frame to the same design.');
  const roots = repeatedDocument.pages[0].children.filter(node => node.name === 'safe-artwork');
  assert(roots.length === 2 && roots[0].id !== roots[1].id, 'Repeated imports of identical SVG bytes should receive distinct root IDs.');
  const secondNodes = [];
  walk([roots[1]], node => secondNodes.push(node));
  const secondIds = secondNodes.map(node => node.id);
  assert(new Set(secondIds).size === secondIds.length && firstIds.every(id => !secondIds.includes(id)), 'Repeated imports should receive fresh IDs throughout the full vector tree.');

  // A valid shape precedes each rejected construct to catch partial insertion.
  const unsafeCases = [
    { name: 'active content', filename: 'active-content.svg', markup: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect x="0" y="0" width="10" height="10" fill="#ff0000"/><script>alert(1)</script></svg>', expected: 'active or embedded content' },
    { name: 'external reference', filename: 'external-reference.svg', markup: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect x="0" y="0" width="10" height="10" fill="#ff0000"/><path d="M0 0 L10 10" href="https://example.invalid/vector.svg"/></svg>', expected: 'href references are not accepted' }
  ];
  for (const unsafe of unsafeCases) {
    const before = await readDocument(design.id);
    await importViaFileMenu(app, unsafe.filename, unsafe.markup);
    await waitFor(() => app.querySelector('#toast-region .toast')?.textContent.includes(unsafe.expected), `${unsafe.name} rejection`);
    await new Promise(resolve => setTimeout(resolve, 80));
    const after = await readDocument(design.id);
    assert(JSON.stringify(after) === JSON.stringify(before), `Rejected ${unsafe.name} must leave the saved design byte-for-byte unchanged.`);
    assert(app.querySelector('#svg-input').value === '', `The SVG input should reset after rejecting ${unsafe.name}.`);
  }

  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', mobileViewport: '390x844', fileMenuPicker: true, editableGroupsAndPaths: true, editableGradients: true, inPlaceAppend: true, selectedLayerTree: true, repeatImportFreshIds: true, activeContentRejectedAtomically: true, externalReferenceRejectedAtomically: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
