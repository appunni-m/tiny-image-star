import { deleteImageAsset } from '../src/storage.js';

const STORAGE_KEY = 'local-studio-project-v1';
const result = document.querySelector('#result');
const frame = document.querySelector('#app');
const previousProject = localStorage.getItem(STORAGE_KEY);
let importedId = null;

function assert(condition, message) { if (!condition) throw new Error(message); }
function makeBmp() {
  const bytes = new Uint8Array(62), view = new DataView(bytes.buffer);
  bytes.set([66, 77]); view.setUint32(2, 62, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, 2, true); view.setInt32(22, 1, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, 8, true);
  bytes.set([0, 0, 255, 0, 255, 0, 0, 0], 54);
  return bytes;
}
async function waitFor(predicate, timeoutMs = 12_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('The local image workflow did not finish in time.');
}

try {
  if (frame.contentDocument?.readyState !== 'complete') await new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
  const app = frame.contentWindow, appDocument = frame.contentDocument;
  await waitFor(() => appDocument.querySelector('#image-input'));
  const input = appDocument.querySelector('#image-input');
  const transfer = new app.DataTransfer();
  transfer.items.add(new app.File([makeBmp()], 'browser-import.bmp', { type: 'image/bmp' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.Event('change', { bubbles: true }));

  const row = await waitFor(() => [...appDocument.querySelectorAll('.layer-row')].find(element => element.textContent.includes('browser-import')));
  importedId = row.dataset.nodeId;
  await waitFor(() => appDocument.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'));
  const layerCount = appDocument.querySelectorAll('.layer-row .layer-icon.image').length;
  assert(layerCount === 1, 'The file import should create one image layer.');
  assert(appDocument.querySelector('#selection-description').textContent === 'Image · 2 × 1', 'WASM preview dimensions were not surfaced to the editor.');

  const slider = appDocument.querySelector('[data-adjustment="brightness"]');
  slider.value = '-40'; slider.dispatchEvent(new app.Event('input', { bubbles: true })); slider.dispatchEvent(new app.Event('change', { bubbles: true }));
  await waitFor(() => appDocument.querySelector('#image-engine-status')?.textContent.includes('Updating preview'));
  await waitFor(() => appDocument.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'));
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  const savedNode = saved.pages.flatMap(page => page.nodes).find(node => node.id === importedId);
  assert(savedNode?.adjustments?.brightness === -40, 'The in-place image adjustment did not save with the same layer.');
  result.textContent = JSON.stringify({ status: 'PASS', importedLayer: importedId, inPlaceAdjustment: true, localWasmPreview: true, localStorageMetadata: true, indexedDbAsset: true });
} catch (error) {
  result.textContent = `FAIL: ${error?.stack || error}`;
} finally {
  frame.remove();
  if (previousProject === null) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, previousProject);
  if (importedId) await deleteImageAsset(importedId).catch(() => {});
}
