import { addNode, createDocument, createNode } from '../src/model.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
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
    const request = indexedDB.open('figma-local-documents', 1);
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
  const app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'The editor should use Tiny Image Star as its public name.');
  const design = createDocument();
  const screen = createNode('frame', { name: 'Mobile screen', x: 30, y: 40, width: 350, height: 700, autoLayout: { axis: 'vertical', gap: 16, padding: 20 } });
  const button = createNode('rectangle', { name: 'Primary button', x: 18, y: 24, width: 180, height: 52, minWidth: 150, maxWidth: 240, minHeight: 44, maxHeight: 72, fill: '#1769aa', radius: 10, rotation: 3 });
  const label = createNode('text', { name: 'Button label', x: 24, y: 38, width: 160, height: 28, text: 'Continue', fontFamily: 'Arial, sans-serif', fontSize: 16, fontWeight: 600, lineHeight: 1.5, letterSpacing: 0.25, color: '#ffffff' });
  addNode(design, screen); addNode(design, button, { parentId: screen.id }); addNode(design, label, { parentId: screen.id });
  const input = app.querySelector('#open-file-input'); const transfer = new DataTransfer();
  transfer.items.add(new File([packageFile(design)], 'inspect-smoke.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Local design opened')), 'design import');

  click(app.querySelector(`[data-layer-id="${button.id}"]`));
  const limitFields = [...app.querySelectorAll('.size-limits-grid .size-limit-field')];
  assert(limitFields.length === 4 && limitFields.every(field => field.getBoundingClientRect().width >= 96), 'the four size-limit controls should remain readable in the phone inspector');
  const maxWidthInput = app.querySelector('[data-prop="maxWidth"]');
  maxWidthInput.value = '200'; maxWidthInput.dispatchEvent(new Event('input', { bubbles: true })); maxWidthInput.dispatchEvent(new Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'size-limit');
  const savedRecords = await readDocuments(); savedRecords.sort((a, b) => b.savedAt - a.savedAt);
  const savedButton = savedRecords[0]?.document.pages.flatMap(page => page.children).flatMap(frameNode => frameNode.children || []).find(node => node.id === button.id);
  assert(savedButton?.minWidth === 150 && savedButton.maxWidth === 200 && savedButton.minHeight === 44 && savedButton.maxHeight === 72, 'size limits should persist in the local document');
  click(app.querySelector('[data-inspector-tab="inspect"]'));
  await waitFor(() => app.querySelector('.inspect-panel'), 'Inspect panel');
  const panel = app.querySelector('.inspect-panel');
  const css = panel.querySelector('.inspect-code-card code')?.textContent || '';
  assert(panel.textContent.includes('50, 60 px') && css.includes('position: relative;') && !css.includes('left: 50px;'), 'Inspect did not report page-space values while keeping an auto-layout child in flow.');
  assert(css.includes('background-color: #1769aa;') && css.includes('border-radius: 10px;') && css.includes('rotate(3deg)'), 'Inspect CSS omitted resolved shape appearance.');
  assert(css.includes('min-width: 150px;') && css.includes('max-width: 200px;') && css.includes('min-height: 44px;') && css.includes('max-height: 72px;'), 'Inspect CSS omitted the selected layer size limits.');
  assert(panel.textContent.includes('Primary button') && panel.textContent.includes('Mobile screen'), 'The selected layer or its owner is missing from the handoff summary.');
  assert(Number.parseFloat(app.defaultView.getComputedStyle(panel.querySelector('.inspect-copy')).minHeight) >= 40, 'Copy control should remain finger-sized on a phone viewport.');

  const copied = [];
  Object.defineProperty(app.defaultView.navigator, 'clipboard', { configurable: true, value: { writeText: async text => copied.push(text) } });
  click(panel.querySelector('[data-inspect-copy="css"]'));
  await waitFor(() => copied.length === 1, 'copy CSS');
  assert(copied[0] === css, 'Copy CSS did not copy the visible generated CSS.');
  click(panel.querySelector('[data-inspect-copy="json"]'));
  await waitFor(() => copied.length === 2, 'copy layer JSON');
  assert(JSON.parse(copied[1]).id === button.id, 'Copy JSON did not preserve exact selected layer data.');

  click(app.querySelector(`[data-layer-id="${label.id}"]`));
  await waitFor(() => app.querySelector('.inspect-panel')?.textContent.includes('16 px · Arial, sans-serif'), 'text metrics');
  assert(app.querySelector('.inspect-panel').textContent.includes('Continue'), 'Inspect panel did not show resolved text content.');
  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', nestedPageCoordinates: true, resolvedStyleValues: true, typography: true, exactLayerJson: true, clipboardCopy: true, phoneSizedActions: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
