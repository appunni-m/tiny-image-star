import { addNode, createDocument, createNode } from '../src/model.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 10000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for app startup and redraws. */ }
      if (performance.now() - start > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 30);
    };
    poll();
  });
}
function click(element) { assert(element, 'Expected an interactive editor control.'); element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); }
function packageFile(documentData) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: documentData.schema, document: documentData, assets: [] }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
function readDocument(documentId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('figma-local-documents', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const read = db.transaction('documents').objectStore('documents').get(documentId);
      read.onsuccess = () => { resolve(read.result?.document || null); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  });
}
async function waitForSaveCycle(app, label) {
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saving locally'), `${label} save start`);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), `${label} save completion`);
}
function updateSetting(app, settingId, field, value) {
  const input = app.querySelector(`[data-export-id="${settingId}"][data-export-field="${field}"]`);
  assert(input, `Export setting control ${field} was missing.`);
  input.value = String(value);
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'the public product name should remain Tiny Image Star');
  const design = createDocument();
  const group = createNode('group', { name: 'Red parent', x: 100, y: 80, width: 200, height: 160, rotation: 30, fill: '#ff0000' });
  const artwork = createNode('rectangle', { name: 'Artwork', x: 35, y: 42, width: 40, height: 20, rotation: 45, fill: '#0066ff' });
  addNode(design, group); addNode(design, artwork, { parentId: group.id });
  const input = app.querySelector('#open-file-input'); const transfer = new DataTransfer();
  transfer.items.add(new File([packageFile(design)], 'export-smoke.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Local design opened')), 'design import');

  click(app.querySelector(`[data-layer-id="${artwork.id}"]`));
  click(app.querySelector('[data-action="add-export-setting"]'));
  let row = app.querySelector('.export-setting-row');
  assert(row, 'The Inspector should add a reusable export setting to the selected layer.');
  const settingId = row.dataset.exportRow;
  const mobileSelect = row.querySelector('[data-export-field="format"]');
  const mobileExportButton = row.querySelector('[data-action="export-setting"]');
  assert(Number.parseFloat(app.defaultView.getComputedStyle(mobileSelect).height) >= 38, 'Export format control should remain finger-sized in a 390px mobile viewport.');
  assert(Number.parseFloat(app.defaultView.getComputedStyle(mobileExportButton).minHeight) >= 40, 'Export action should remain finger-sized in a 390px mobile viewport.');
  updateSetting(app, settingId, 'format', 'webp');
  updateSetting(app, settingId, 'scale', '2');
  updateSetting(app, settingId, 'suffix', '@2x');
  updateSetting(app, settingId, 'quality', '84');
  await waitForSaveCycle(app, 'WebP preset');
  const saved = await readDocument(design.id);
  assert(saved?.pages[0].children[0].children[0].exportSettings?.[0]?.format === 'webp', 'The chosen export format did not persist locally.');
  assert(saved.pages[0].children[0].children[0].exportSettings[0].scale === 2 && saved.pages[0].children[0].children[0].exportSettings[0].suffix === '@2x', 'The scale and suffix did not persist locally.');
  assert(saved.pages[0].children[0].children[0].exportSettings[0].quality === 84, 'The output quality did not persist locally.');

  const downloads = [];
  const objectUrls = new Map();
  const view = app.defaultView;
  let urlIndex = 0;
  view.URL.createObjectURL = blob => { const url = `blob:tiny-image-star-export-${++urlIndex}`; objectUrls.set(url, blob); return url; };
  const originalAnchorClick = view.HTMLAnchorElement.prototype.click;
  view.HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download')) { downloads.push({ filename: this.download, blob: objectUrls.get(this.href) }); return; }
    originalAnchorClick.call(this);
  };

  click(app.querySelector(`[data-action="export-setting"][data-export-id="${settingId}"]`));
  await waitFor(() => downloads.length === 1, 'WebP download');
  assert(downloads[0].filename === 'Artwork@2x.webp' && downloads[0].blob?.type === 'image/webp', 'WebP export should use the requested suffix, extension, and MIME type.');
  let bitmap = await view.createImageBitmap(downloads[0].blob);
  assert(bitmap.width === 60 && bitmap.height === 88, `Nested rotated 2× export bounds should be 60 × 88 px; received ${bitmap.width} × ${bitmap.height}.`);
  const pixels = view.document.createElement('canvas'); pixels.width = bitmap.width; pixels.height = bitmap.height;
  const context = pixels.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0); bitmap.close();
  const rgba = context.getImageData(0, 0, pixels.width, pixels.height).data;
  let blue = 0; let red = 0;
  for (let index = 0; index < rgba.length; index += 4) {
    if (rgba[index + 3] < 16) continue;
    if (rgba[index + 2] > rgba[index] * 1.5) blue += 1;
    if (rgba[index] > rgba[index + 2] * 1.5) red += 1;
  }
  assert(blue > 100 && red === 0, 'Layer export should contain selected artwork without painting the ancestor group.');

  updateSetting(app, settingId, 'format', 'jpeg');
  click(app.querySelector(`[data-action="export-setting"][data-export-id="${settingId}"]`));
  await waitFor(() => downloads.length === 2, 'JPG download');
  assert(downloads[1].filename === 'Artwork@2x.jpg' && downloads[1].blob?.type === 'image/jpeg', 'JPG export should use the .jpg extension and JPEG MIME type.');
  bitmap = await view.createImageBitmap(downloads[1].blob);
  assert(bitmap.width === 60 && bitmap.height === 88, 'JPG output dimensions should follow the same nested rotated bounds and scale.');
  const jpegCanvas = view.document.createElement('canvas'); jpegCanvas.width = bitmap.width; jpegCanvas.height = bitmap.height;
  const jpegContext = jpegCanvas.getContext('2d', { willReadFrequently: true }); jpegContext.drawImage(bitmap, 0, 0); bitmap.close();
  const corner = jpegContext.getImageData(0, 0, 1, 1).data;
  assert(corner[0] > 220 && corner[1] > 220 && corner[2] > 220, `JPG transparency should be flattened against white; top-left pixel was ${Array.from(corner).join(',')}.`);

  updateSetting(app, settingId, 'format', 'png');
  click(app.querySelector(`[data-action="export-setting"][data-export-id="${settingId}"]`));
  await waitFor(() => downloads.length === 3, 'PNG download');
  assert(downloads[2].filename === 'Artwork@2x.png' && downloads[2].blob?.type === 'image/png', 'PNG export should preserve its alpha-capable format and requested suffix.');
  click(app.querySelector('#export-selection'));
  await waitFor(() => downloads.length === 4, 'one-click PNG export');
  assert(downloads[3].filename === 'Artwork.png' && downloads[3].blob?.type === 'image/png', 'The existing one-click export should remain a 1× PNG.');
  bitmap = await view.createImageBitmap(downloads[3].blob);
  assert(bitmap.width === 30 && bitmap.height === 44, 'The existing one-click path should use the selected layer’s nested rotated bounds at 1×.');
  bitmap.close();
  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', persistedSettings: true, formats: ['webp', 'jpeg', 'png'], nestedRotatedBounds: [60, 88], suffix: '@2x', quality: 84, mobileTouchTargets: true, ancestorFillExcluded: red === 0, jpegWhiteBackground: true, quickPngPreserved: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
