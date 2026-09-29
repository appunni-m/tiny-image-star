import { addNode, createDocument, createNode } from '../src/model.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for app startup and redraws. */ }
      if (performance.now() - start > 10000) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 30);
    };
    poll();
  });
}
function click(element, options = {}) { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options })); }
function contextMenu(element) { element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 160, clientY: 150 })); }
function packageFile(documentData) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: documentData.schema, document: documentData, assets: [] }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
function readDocuments() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('figma-local-documents', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const read = db.transaction('documents').objectStore('documents').getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  });
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor handlers');
  const app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'the editor must use the Tiny Image Star public name');
  const design = createDocument();
  const content = createNode('rectangle', { name: 'Photo', x: 10, y: 10, width: 120, height: 80, fill: '#55aaee' });
  const mask = createNode('ellipse', { name: 'Circle', x: 30, y: 20, width: 60, height: 60 });
  addNode(design, content); addNode(design, mask);
  const input = app.querySelector('#open-file-input'); const transfer = new DataTransfer();
  transfer.items.add(new File([packageFile(design)], 'mask-smoke.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Local design opened')), 'design import');

  click(app.querySelector(`[data-layer-id="${content.id}"]`));
  click(app.querySelector(`[data-layer-id="${mask.id}"]`), { ctrlKey: true });
  let maskRow = app.querySelector(`[data-layer-id="${mask.id}"]`);
  contextMenu(maskRow);
  let action = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim() === 'Use as mask');
  assert(action && !app.querySelector('#context-menu').hidden, 'selected vector siblings did not show Use as mask');
  click(app.querySelector('#layer-options'));
  action = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim() === 'Use selected layers as mask');
  assert(action, 'Layer options did not expose mask creation for touch and keyboard users');
  click(action);
  await waitFor(() => app.querySelector('.layer-row.is-selected[data-layer-id]')?.querySelector('.layer-name')?.textContent === 'Mask group', 'mask group creation');
  const groupRow = app.querySelector('.layer-row.is-selected[data-layer-id]');
  const groupId = groupRow.dataset.layerId;
  assert(app.querySelector('[data-action="release-mask"]'), 'the Inspector did not expose mask release');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'mask group save');
  let records = await readDocuments(); records.sort((a, b) => b.savedAt - a.savedAt);
  let roots = records[0]?.document.pages[0].children;
  const savedGroup = roots?.find(node => node.id === groupId);
  assert(savedGroup?.mask && savedGroup.maskSourceId === mask.id, 'saved mask group lost its editable mask source identity');
  assert(savedGroup.children.map(node => node.id).join(',') === `${content.id},${mask.id}`, 'mask creation changed source stacking order');

  contextMenu(app.querySelector(`[data-layer-id="${groupId}"]`));
  action = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim() === 'Release mask');
  assert(action, 'mask group did not show Release mask');
  click(app.querySelector('#layer-options'));
  action = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim() === 'Release selected mask');
  assert(action, 'Layer options did not expose mask release for touch and keyboard users');
  click(action);
  await waitFor(() => app.querySelectorAll('.layer-row[data-layer-id]').length === 2 && !app.querySelector('.layer-row[data-layer-id] .layer-name')?.textContent.includes('Mask group'), 'mask release');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'mask release save');
  records = await readDocuments(); records.sort((a, b) => b.savedAt - a.savedAt);
  roots = records[0]?.document.pages[0].children;
  assert(roots?.map(node => node.id).join(',') === `${content.id},${mask.id}`, 'mask release did not restore original root order and identities');
  assert(roots[0].x === 10 && roots[0].y === 10 && roots[1].x === 30 && roots[1].y === 20, 'mask release changed source layer positions');
  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', contextMenuCreate: true, layerOptionsCreateRelease: true, inspectorRelease: true, editableMaskSource: true, stackAndPositionPreserved: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
