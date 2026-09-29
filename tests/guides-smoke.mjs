import { addNode, createDocument, createLayoutGuide, createNode } from '../src/model.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 10000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for editor initialization. */ }
      if (performance.now() - start > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 30);
    };
    poll();
  });
}
function click(element) { assert(element, 'Expected an interactive layout-guide control.'); element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); }
function packageFile(documentData) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: documentData.schema, document: documentData, assets: [] }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
function waitForPaint() {
  return new Promise(resolve => frame.contentWindow.requestAnimationFrame(() => frame.contentWindow.requestAnimationFrame(resolve)));
}
function pixelAt(app, worldX, worldY) {
  const canvas = app.querySelector('#scene-canvas');
  const dpr = Math.min(2, app.defaultView.devicePixelRatio || 1);
  const x = Math.floor((canvas.clientWidth / 2 + worldX) * dpr);
  const y = Math.floor((canvas.clientHeight / 2 + worldY) * dpr);
  return [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];
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
function updateGuide(app, guideId, field, value) {
  const input = app.querySelector(`[data-guide-id="${guideId}"][data-guide-field="${field}"]`);
  assert(input, `The ${field} control was missing from the selected guide.`);
  input.value = String(value);
  input.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'The public product name should remain Tiny Image Star.');
  const design = createDocument();
  const guide = createLayoutGuide('grid', { id: 'uniform-grid', size: 50, color: '#ff0000', opacity: 0.1 });
  const artboard = createNode('frame', { name: 'Artboard', x: 0, y: 0, width: 200, height: 200, fill: '#ffffff', layoutGuides: [guide] });
  addNode(design, artboard);
  const input = app.querySelector('#open-file-input'); const transfer = new DataTransfer();
  transfer.items.add(new File([packageFile(design)], 'guides-smoke.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Local design opened')), 'design import');
  click(app.querySelector(`[data-layer-id="${artboard.id}"]`));
  await waitForPaint();
  const baseline = pixelAt(app, 25, 75); const gridPixel = pixelAt(app, 50, 75);
  assert(gridPixel[0] > gridPixel[1] + 10 && baseline[0] === baseline[1], 'Uniform grid guides should render a subtle colored overlay on the frame.');
  const initialGuideCard = app.querySelector(`[data-layout-guide="${guide.id}"]`);
  assert(Number.parseFloat(app.defaultView.getComputedStyle(initialGuideCard.querySelector('select')).height) >= 38, 'Guide controls should remain finger-sized on a 390px phone viewport.');
  assert(Number.parseFloat(app.defaultView.getComputedStyle(initialGuideCard.querySelector('button')).height) >= 40, 'Guide visibility controls should remain finger-sized on a phone viewport.');

  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'G', shiftKey: true, bubbles: true, cancelable: true }));
  await waitForPaint();
  const globallyHidden = pixelAt(app, 50, 75);
  assert(globallyHidden[0] === globallyHidden[1] && globallyHidden[1] === globallyHidden[2], 'Shift+G should hide all layout guides without deleting them.');
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'g', shiftKey: true, bubbles: true, cancelable: true }));
  await waitForPaint();
  assert(pixelAt(app, 50, 75)[0] > pixelAt(app, 50, 75)[1] + 10, 'Shift+G should show the guides again.');

  click(app.querySelector(`[data-action="toggle-layout-guide"][data-guide-id="${guide.id}"]`));
  await waitForPaint();
  const individuallyHidden = pixelAt(app, 50, 75);
  assert(individuallyHidden[0] === individuallyHidden[1] && individuallyHidden[1] === individuallyHidden[2], 'A frame guide can be hidden individually.');
  click(app.querySelector('[data-action="add-layout-guide"][data-guide-type="columns"]'));
  const columnCard = [...app.querySelectorAll('.layout-guide-card')].find(card => card.dataset.layoutGuide !== guide.id);
  assert(columnCard, 'A frame should support adding a column guide alongside a grid.');
  const columnId = columnCard.dataset.layoutGuide;
  updateGuide(app, columnId, 'count', '1');
  updateGuide(app, columnId, 'alignment', 'left');
  updateGuide(app, columnId, 'bandSize', '60');
  updateGuide(app, columnId, 'offset', '20');
  await waitForPaint();
  const insideColumn = pixelAt(app, 30, 100); const outsideColumn = pixelAt(app, 90, 100);
  assert(insideColumn[0] > insideColumn[1] + 10 && outsideColumn[0] === outsideColumn[1], `Fixed column guides should honor width and left-edge offset; inside=${insideColumn.join(',')} outside=${outsideColumn.join(',')}.`);
  click(app.querySelector('[data-action="add-layout-guide"][data-guide-type="rows"]'));
  await waitFor(() => app.querySelectorAll('.layout-guide-card').length === 3, 'combined grid, column, and row controls');
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'guide changes saved locally');
  const saved = await readDocument(design.id);
  const savedGuides = saved?.pages[0].children[0].layoutGuides;
  assert(savedGuides?.length === 3 && savedGuides[0].visible === false, 'Combined guide visibility should persist locally.');
  assert(savedGuides[1].alignment === 'left' && savedGuides[1].bandSize === 60 && savedGuides[1].offset === 20, 'Fixed guide settings should persist locally.');
  assert(savedGuides[2].type === 'rows', 'A frame can combine grid, column, and row guide types.');

  const downloads = []; const blobs = new Map(); let urlNumber = 0; const view = app.defaultView;
  view.URL.createObjectURL = blob => { const url = `blob:tiny-image-star-guides-${++urlNumber}`; blobs.set(url, blob); return url; };
  const originalAnchorClick = view.HTMLAnchorElement.prototype.click;
  view.HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download')) { downloads.push({ filename: this.download, blob: blobs.get(this.href) }); return; }
    originalAnchorClick.call(this);
  };
  click(app.querySelector('#export-selection'));
  await waitFor(() => downloads.length === 1, 'frame export without guides');
  assert(downloads[0].filename === 'Artboard.png' && downloads[0].blob?.type === 'image/png', 'Frame export should still produce a local PNG.');
  const bitmap = await view.createImageBitmap(downloads[0].blob);
  const output = view.document.createElement('canvas'); output.width = bitmap.width; output.height = bitmap.height;
  const outputContext = output.getContext('2d'); outputContext.drawImage(bitmap, 0, 0); bitmap.close();
  const exportPixel = outputContext.getImageData(30, 100, 1, 1).data;
  assert(exportPixel[0] === 255 && exportPixel[1] === 255 && exportPixel[2] === 255, 'Non-printing layout guides must not be baked into frame exports.');
  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', guideTypes: ['grid', 'columns', 'rows'], combinedGuides: true, fixedColumns: true, globalShortcut: 'Shift+G', perGuideVisibility: true, mobileControls: true, localPersistence: true, exportsExcludeGuides: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
