import { addNode, createDocument, createNode } from '../src/model.js';
import { createImageFill } from '../src/image-fills.js';
import * as pillow from '../wasm/pillow_rs_js.js';
import { decodeOriginal, renderImage } from '../src/image-processing.js';

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
function click(element, options = {}) { assert(element, 'Expected an interactive editor control.'); element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options })); }
function packageFile(documentData, assets = []) {
  const manifest = new TextEncoder().encode(JSON.stringify({
    schema: documentData.schema,
    document: documentData,
    assets: assets.map(({ id, name, type, bytes }) => ({ id, name, type, length: bytes.byteLength }))
  }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest, ...assets.map(asset => new Uint8Array(asset.bytes))];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
function readDocument(documentId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('figma-local-documents');
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
function embeddedImageBytes(svg, nodeId) {
  const escapedId = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const group = svg.match(new RegExp(`<g[^>]*data-tiny-image-star-node-id="${escapedId}"[^>]*>([\\s\\S]*?)</g>`));
  assert(group, `SVG should contain the exported layer ${nodeId}.`);
  const href = group[1].match(/href="data:image\/png;base64,([^"]+)"/)?.[1];
  assert(href, `SVG should embed a processed PNG for layer ${nodeId}.`);
  const binary = atob(href);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function expectedPillowPreview(sourceBytes, adjustments, transforms) {
  const source = decodeOriginal(pillow, sourceBytes);
  try { return renderImage(source, adjustments, transforms).bytes; }
  finally { source.free(); }
}
function assertSameBytes(actual, expected, message) {
  assert(actual.length === expected.length && actual.every((value, index) => value === expected[index]), message);
}
async function unpackStoredZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const contentStart = nameStart + nameLength + extraLength;
    assert(method === 0, 'The image archive should store already-compressed raster payloads without recompressing them.');
    files.set(name, bytes.slice(contentStart, contentStart + size));
    offset = contentStart + size;
  }
  assert(view.getUint32(offset, true) === 0x02014b50, 'The central directory should follow the image entries.');
  return files;
}

try {
  await pillow.default();
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'the public product name should remain Tiny Image Star');
  const design = createDocument();
  const group = createNode('group', { name: 'Red parent', x: 100, y: 80, width: 200, height: 160, rotation: 30, fill: '#ff0000' });
  const artwork = createNode('rectangle', { name: 'Artwork', x: 35, y: 42, width: 40, height: 20, rotation: 45, fill: '#0066ff' });
  const caption = createNode('text', { name: 'Vector caption', x: 16, y: 108, width: 150, height: 30, text: 'editable vector text', textCase: 'uppercase', textDecoration: 'underline', fontSize: 16, color: '#224466' });
  const imageCanvas = document.createElement('canvas'); imageCanvas.width = 4; imageCanvas.height = 2;
  const imageContext = imageCanvas.getContext('2d'); imageContext.fillStyle = '#e22'; imageContext.fillRect(0, 0, 2, 2); imageContext.fillStyle = '#26c'; imageContext.fillRect(2, 0, 2, 2);
  const imageBlob = await new Promise((resolve, reject) => imageCanvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create the local SVG image fixture.')), 'image/png'));
  const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
  const imageAssetId = 'export-smoke-local-image';
  const localImage = createNode('image', {
    name: 'Local photo', assetId: imageAssetId, sourceWidth: 4, sourceHeight: 2,
    x: 112, y: 20, width: 40, height: 28, rotation: -8, opacity: 0.8, fit: 'cover'
  });
  const batchJpeg = createNode('image', {
    name: 'Batch JPEG', assetId: imageAssetId, sourceWidth: 4, sourceHeight: 2,
    x: 20, y: 360, width: 40, height: 28, outputFormat: 'jpeg', outputQuality: 76
  });
  const batchWebp = createNode('image', {
    name: 'Batch Edited WebP', assetId: imageAssetId, sourceWidth: 4, sourceHeight: 2,
    x: 84, y: 360, width: 40, height: 28, outputFormat: 'webp', outputQuality: 61,
    adjustments: { invert: true }
  });
  const imageFilled = createNode('rectangle', {
    name: 'Image-filled export', x: 220, y: 30, width: 40, height: 40, fill: '#ffffff',
    imageFill: createImageFill(imageAssetId, { fit: 'contain' })
  });
  addNode(design, group); addNode(design, artwork, { parentId: group.id });
  addNode(design, caption, { parentId: group.id });
  addNode(design, localImage, { parentId: group.id });
  addNode(design, batchJpeg); addNode(design, batchWebp);
  addNode(design, imageFilled);
  const input = app.querySelector('#open-file-input'); const transfer = new DataTransfer();
  const imageAssets = [{ id: imageAssetId, name: 'local-photo.png', type: 'image/png', bytes: imageBytes }];
  transfer.items.add(new File([packageFile(design, imageAssets)], 'export-smoke.flocal', { type: 'application/octet-stream' }));
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
  const mobileSvgButton = app.querySelector('[data-action="export-svg"]');
  assert(mobileSvgButton && Number.parseFloat(app.defaultView.getComputedStyle(mobileSvgButton).minHeight) >= 40, 'The editable SVG export action should remain finger-sized on mobile.');
  updateSetting(app, settingId, 'format', 'webp');
  updateSetting(app, settingId, 'scale', '2');
  updateSetting(app, settingId, 'suffix', '@2x');
  updateSetting(app, settingId, 'quality', '84');
  await waitForSaveCycle(app, 'WebP preset');
  const saved = await readDocument(design.id);
  assert(saved?.pages[0].children[0].children[0].exportSettings?.[0]?.format === 'webp', 'The chosen export format did not persist locally.');
  assert(saved.pages[0].children[0].children[0].exportSettings[0].scale === 2 && saved.pages[0].children[0].children[0].exportSettings[0].suffix === '@2x', 'The scale and suffix did not persist locally.');
  assert(saved.pages[0].children[0].children[0].exportSettings[0].quality === 84, 'The output quality did not persist locally.');

  click(app.querySelector('#outline-mode'));
  assert(app.querySelector('#outline-mode')?.getAttribute('aria-pressed') === 'true', 'The outline view should be active while checking export isolation.');

  const downloads = [];
  const objectUrls = new Map();
  const view = app.defaultView;
  const createObjectURL = view.URL.createObjectURL.bind(view.URL);
  view.URL.createObjectURL = blob => { const url = createObjectURL(blob); objectUrls.set(url, blob); return url; };
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
  click(app.querySelector('[data-action="export-svg"]'));
  await waitFor(() => downloads.length === 5, 'selected-layer SVG download');
  assert(downloads[4].filename === 'Artwork.svg' && downloads[4].blob?.type.startsWith('image/svg+xml'), 'Selected-layer SVG should download with the SVG MIME type and filename.');
  const selectedSvg = await downloads[4].blob.text();
  assert(selectedSvg.includes(`data-tiny-image-star-node-id="${artwork.id}"`) && selectedSvg.includes('fill="#0066ff"') && !selectedSvg.includes('Red parent'), 'Selected SVG should preserve the chosen editable layer without exporting its ancestor.');

  click(app.querySelector('#file-menu-button'));
  const exportPageButton = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Export current page as SVG'));
  click(exportPageButton);
  await waitFor(() => downloads.length === 6, 'page SVG download');
  assert(downloads[5].filename === 'Page 1.svg' && downloads[5].blob?.type.startsWith('image/svg+xml'), 'Page SVG should download with a local page name and SVG MIME type.');
  const pageSvg = await downloads[5].blob.text();
  const captionMarkup = pageSvg.match(/<text\b[^>]*>([\s\S]*?)<\/text>/)?.[1] || '';
  assert(pageSvg.includes('fill="#ff0000"') && pageSvg.includes('fill="#0066ff"')
    && ['EDITABLE', 'VECTOR', 'TEXT'].every(word => captionMarkup.includes(word))
    && (captionMarkup.match(/<tspan\b/g) || []).length > 1,
  'Page SVG should preserve nested vector geometry, case-transformed text, and canvas word wrapping.');
  assert(pageSvg.includes('textLength=') && pageSvg.includes('stroke="#224466"'), 'Page SVG should preserve measured text widths and explicit underline geometry.');
  assert(pageSvg.includes('href="data:image/png;base64,') && pageSvg.includes('data-tiny-image-star-type="image"'), 'Page SVG should embed local image bytes without network references.');

  click(app.querySelector(`[data-layer-id="${localImage.id}"]`));
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'locally restored image preview');
  click(app.querySelector('[data-action="export-svg"]'));
  await waitFor(() => downloads.length === 7, 'selected local-image SVG download');
  assert(downloads[6].filename === 'Local photo.svg', 'Selected local image SVG should use the image layer name.');
  const localImageSvg = await downloads[6].blob.text();
  assert(localImageSvg.includes('href="data:image/png;base64,') && !localImageSvg.includes('blob:') && !localImageSvg.includes('href="http'),
    'Selected local image SVG should embed the source bytes and contain no temporary or network URL.');

  // Edited SVGs must bake the current preview. This image shares its source
  // asset with an independently edited image fill later in this test.
  click(app.querySelector(`[data-layer-id="${localImage.id}"]`));
  const localBrightness = app.querySelector('[data-prop="adjustments.brightness"]');
  assert(localBrightness, 'The selected local image should expose brightness adjustment.');
  localBrightness.value = '35';
  localBrightness.dispatchEvent(new view.Event('input', { bubbles: true }));
  localBrightness.dispatchEvent(new view.Event('change', { bubbles: true }));
  const localCrop = app.querySelector('[data-image-transform-field="left"][data-image-transform-target="layer"]');
  assert(localCrop, 'The selected local image should expose crop adjustment.');
  localCrop.value = '25';
  localCrop.dispatchEvent(new view.Event('input', { bubbles: true }));
  localCrop.dispatchEvent(new view.Event('change', { bubbles: true }));
  click(app.querySelector('[data-action="rotate-image"][data-transform-target="layer"][data-direction="right"]'));
  await waitFor(() => app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'adjusted local image preview');
  click(app.querySelector('[data-action="export-svg"]'));
  await waitFor(() => downloads.length === 8, 'edited image SVG download');
  const editedImageSvg = await downloads[7].blob.text();
  const editedImageBytes = embeddedImageBytes(editedImageSvg, localImage.id);
  const localAdjustments = { brightness: 35, contrast: 0, saturation: 0, sharpness: 0, blur: 0 };
  const localTransforms = { crop: { left: 0.25, top: 0, right: 1, bottom: 1 }, rotation: 90 };
  const expectedLocalPreview = expectedPillowPreview(imageBytes, localAdjustments, localTransforms);
  assertSameBytes(editedImageBytes, expectedLocalPreview, 'Selected-layer SVG should embed the exact Pillow-RS crop/rotation/adjustment preview.');
  const liveAssetImage = app.querySelector(`#assets-list .asset-card[data-layer-id="${localImage.id}"] img`);
  assert(liveAssetImage?.src.startsWith('blob:'), 'The local asset card should display the current live preview blob.');
  const livePreviewBytes = new Uint8Array(await (await view.fetch(liveAssetImage.src)).arrayBuffer());
  assertSameBytes(editedImageBytes, livePreviewBytes, 'The selected-layer SVG raster should byte-match the live image preview.');

  click(app.querySelector(`[data-layer-id="${imageFilled.id}"]`));
  await waitFor(() => app.querySelector('[data-image-transform-field="left"][data-image-transform-target="fill"]'), 'image-fill crop control for export race');
  await waitFor(() => app.querySelector('[data-image-fill-status]')?.textContent.includes('Updated · Pillow-RS WASM'), 'initial image-fill preview for export race');
  const cropLeft = app.querySelector('[data-image-transform-field="left"][data-image-transform-target="fill"]');
  const pendingPreviewTimers = new Set();
  const nativeSetTimeout = view.setTimeout.bind(view);
  const nativeClearTimeout = view.clearTimeout.bind(view);
  view.setTimeout = (callback, delay, ...args) => {
    if (delay === 110) {
      const timer = { callback, args, cancelled: false };
      pendingPreviewTimers.add(timer);
      return timer;
    }
    return nativeSetTimeout(callback, delay, ...args);
  };
  view.clearTimeout = timer => {
    if (pendingPreviewTimers.has(timer)) { timer.cancelled = true; return; }
    nativeClearTimeout(timer);
  };
  try {
    cropLeft.value = '50';
    cropLeft.dispatchEvent(new view.Event('input', { bubbles: true }));
    cropLeft.dispatchEvent(new view.Event('change', { bubbles: true }));
    view.setTimeout = nativeSetTimeout;
    assert([...pendingPreviewTimers].some(timer => !timer.cancelled), 'the crop edit should have a queued debounced image-fill render before export.');
    click(app.querySelector('#export-selection'));
    await waitFor(() => downloads.length === 9, 'immediate image-fill PNG download');
    assert([...pendingPreviewTimers].every(timer => timer.cancelled), 'export should drain the pending image-fill preview before drawing.');
    const bitmap = await view.createImageBitmap(downloads[8].blob);
    assert(bitmap.width === 40 && bitmap.height === 40, 'the image-filled shape export should retain its layer dimensions.');
    const previewCanvas = view.document.createElement('canvas'); previewCanvas.width = bitmap.width; previewCanvas.height = bitmap.height;
    const previewContext = previewCanvas.getContext('2d', { willReadFrequently: true });
    previewContext.drawImage(bitmap, 0, 0); bitmap.close();
    const croppedPixel = previewContext.getImageData(4, 20, 1, 1).data;
    assert(croppedPixel[2] > croppedPixel[0] * 1.5, `the immediate PNG should contain the new blue-only crop, not the stale red half (${Array.from(croppedPixel).join(',')}).`);
  } finally {
    view.setTimeout = nativeSetTimeout;
    view.clearTimeout = nativeClearTimeout;
  }

  const fillBrightness = app.querySelector('[data-image-fill-field="adjustments.brightness"]');
  assert(fillBrightness, 'The image fill should expose its own brightness adjustment.');
  fillBrightness.value = '-40';
  fillBrightness.dispatchEvent(new view.Event('input', { bubbles: true }));
  fillBrightness.dispatchEvent(new view.Event('change', { bubbles: true }));
  const fillCrop = app.querySelector('[data-image-transform-field="left"][data-image-transform-target="fill"]');
  fillCrop.value = '25';
  fillCrop.dispatchEvent(new view.Event('input', { bubbles: true }));
  fillCrop.dispatchEvent(new view.Event('change', { bubbles: true }));
  await waitForSaveCycle(app, 'image-fill crop');
  click(app.querySelector('[data-action="rotate-image"][data-transform-target="fill"][data-direction="right"]'));
  await waitFor(() => app.querySelector('[data-image-fill-status]')?.textContent.includes('Updated · Pillow-RS WASM'), 'edited image-fill preview');
  await waitForSaveCycle(app, 'image-fill rotation');
  const editedFillDocument = await readDocument(design.id);
  const editedImageFill = editedFillDocument?.pages[0]?.children.find(node => node.id === imageFilled.id)?.fills?.[0]?.imageFill;
  assert(editedImageFill?.transforms?.crop?.left === 0.25 && editedImageFill?.transforms?.rotation === 90,
    'Image-fill crop and rotation should update the ordered fill and its persisted compatibility mirror.');
  click(app.querySelector('#file-menu-button'));
  const editedPageExportButton = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Export current page as SVG'));
  assert(editedPageExportButton, 'The file menu should offer current-page SVG export.');
  click(editedPageExportButton);
  await waitFor(() => downloads.length === 10, 'page SVG with edited image and fill');
  const editedPageSvg = await downloads[9].blob.text();
  assertSameBytes(embeddedImageBytes(editedPageSvg, localImage.id), expectedLocalPreview,
    'Page SVG should keep the image layer’s unique edited preview when its source is also used by a fill.');
  const fillAdjustments = { brightness: -40, contrast: 0, saturation: 0, sharpness: 0, blur: 0 };
  const fillTransforms = { crop: { left: 0.25, top: 0, right: 1, bottom: 1 }, rotation: 90 };
  const expectedFillPreview = expectedPillowPreview(imageBytes, fillAdjustments, fillTransforms);
  assertSameBytes(embeddedImageBytes(editedPageSvg, imageFilled.id), expectedFillPreview,
    'Page SVG should embed the image fill’s distinct Pillow-RS crop/rotation/adjustment preview.');
  click(app.querySelector(`[data-layer-id="${batchJpeg.id}"]`));
  click(app.querySelector(`[data-layer-id="${batchWebp.id}"]`), { ctrlKey: true });
  assert(app.querySelectorAll('.layer-row.is-selected[data-layer-id]').length === 2, 'Batch export should begin with both selected image layers.');
  const encodeCalls = [];
  const canvasPrototype = view.HTMLCanvasElement.prototype;
  const originalToBlob = canvasPrototype.toBlob;
  canvasPrototype.toBlob = function (callback, type, quality) {
    encodeCalls.push({ type, quality });
    return originalToBlob.call(this, callback, type, quality);
  };
  const keyboardEscape = () => app.body.dispatchEvent(new view.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
  try {
    click(app.querySelector('#export-selection'));
    keyboardEscape();
    await new Promise(resolve => setTimeout(resolve, 60));
    assert(downloads.length === 10, 'Canceling a multi-image export should not download a partial archive.');
    click(app.querySelector('#export-selection'));
    await waitFor(() => downloads.length === 11, 'separate-image ZIP download');
  } finally {
    canvasPrototype.toBlob = originalToBlob;
  }
  const imageArchive = downloads[10];
  assert(imageArchive.filename === 'Untitled-images.zip' && imageArchive.blob?.type === 'application/zip', 'Multi-image export should download one ZIP archive.');
  const archiveEntries = await unpackStoredZip(imageArchive.blob);
  assert([...archiveEntries.keys()].join(',') === 'Batch JPEG.jpg,Batch Edited WebP.webp', 'The ZIP should contain one separately named image file per selected layer.');
  const jpegBytes = archiveEntries.get('Batch JPEG.jpg');
  const webpBytes = archiveEntries.get('Batch Edited WebP.webp');
  assert(jpegBytes[0] === 0xff && jpegBytes[1] === 0xd8 && jpegBytes[2] === 0xff, 'Each image should use its saved JPEG output format.');
  assert(new TextDecoder().decode(webpBytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(webpBytes.subarray(8, 12)) === 'WEBP', 'Each image should use its saved WebP output format.');
  assert(encodeCalls.some(call => call.type === 'image/jpeg' && call.quality === 0.76)
    && encodeCalls.some(call => call.type === 'image/webp' && call.quality === 0.61), 'Batch export should pass each image’s saved quality to its own encoder.');
  const processedBitmap = await view.createImageBitmap(new Blob([webpBytes], { type: 'image/webp' }));
  const processedCanvas = view.document.createElement('canvas'); processedCanvas.width = processedBitmap.width; processedCanvas.height = processedBitmap.height;
  const processedContext = processedCanvas.getContext('2d', { willReadFrequently: true }); processedContext.drawImage(processedBitmap, 0, 0); processedBitmap.close();
  const originalBitmap = await view.createImageBitmap(new Blob([imageBytes], { type: 'image/png' }));
  const originalCanvas = view.document.createElement('canvas'); originalCanvas.width = originalBitmap.width; originalCanvas.height = originalBitmap.height;
  const originalContext = originalCanvas.getContext('2d', { willReadFrequently: true }); originalContext.drawImage(originalBitmap, 0, 0); originalBitmap.close();
  const processedPixel = processedContext.getImageData(5, 12, 1, 1).data;
  const originalPixel = originalContext.getImageData(0, 0, 1, 1).data;
  assert(processedPixel.some((channel, index) => index < 3 && channel !== originalPixel[index]), 'The archive should contain the current edited preview, not the untouched source image.');
  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', persistedSettings: true, formats: ['webp', 'jpeg', 'png', 'svg'], nestedRotatedBounds: [60, 88], suffix: '@2x', quality: 84, mobileTouchTargets: true, ancestorFillExcluded: red === 0, jpegWhiteBackground: true, quickPngPreserved: true, selectedLayerSvg: true, pageSvg: true, svgTextParity: true, embeddedLocalImage: true, editedImagePreviewByteExact: true, sharedSourcePreviewIsolation: true, editedImageFillPreviewByteExact: true, imageFillImmediateExport: true, individualImageZip: true, perImageOutputFormatAndQuality: true, batchExportCancellation: true, processedPreviewInArchive: true, rasterExportUnaffectedByOutlineView: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
