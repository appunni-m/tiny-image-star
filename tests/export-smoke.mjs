import { addNode, createDocument, createGradientFill, createLayerEffect, createNode, findNode } from '../src/model.js';
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
  const imageCanvas = document.createElement('canvas'); imageCanvas.width = 64; imageCanvas.height = 32;
  const imageContext = imageCanvas.getContext('2d'); imageContext.fillStyle = '#e22'; imageContext.fillRect(0, 0, 32, 32); imageContext.fillStyle = '#26c'; imageContext.fillRect(32, 0, 32, 32);
  const imageBlob = await new Promise((resolve, reject) => imageCanvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create the local SVG image fixture.')), 'image/png'));
  const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
  const imageAssetId = 'export-smoke-local-image';
  const localImage = createNode('image', {
    name: 'Local photo', assetId: imageAssetId, sourceWidth: 64, sourceHeight: 32,
    x: 112, y: 20, width: 40, height: 28, rotation: -8, opacity: 0.8, fit: 'cover'
  });
  const batchJpeg = createNode('image', {
    name: 'Batch JPEG', assetId: imageAssetId, sourceWidth: 64, sourceHeight: 32,
    x: 20, y: 360, width: 40, height: 28, outputFormat: 'jpeg', outputQuality: 76
  });
  const batchWebp = createNode('image', {
    name: 'Batch Edited WebP', assetId: imageAssetId, sourceWidth: 64, sourceHeight: 32,
    x: 84, y: 360, width: 40, height: 28, outputFormat: 'webp', outputQuality: 61,
    adjustments: { invert: true }
  });
  const imageFilled = createNode('rectangle', {
    name: 'Image-filled export', x: 220, y: 30, width: 40, height: 40, fill: '#ffffff',
    imageFill: createImageFill(imageAssetId, { fit: 'contain' })
  });
  const sliceArtwork = createNode('rectangle', {
    name: 'Slice artwork', x: 550, y: 390, width: 40, height: 30, fill: '#00cc44'
  });
  const pageSlice = createNode('slice', {
    name: 'Page slice', x: 545, y: 385, width: 60, height: 45
  });
  const fractionalSliceBackdrop = createNode('rectangle', {
    name: 'Fractional slice backdrop', x: 601, y: 451, width: 5, height: 5,
    fill: '#ffffff', fillOpacity: 0.25, visible: false,
    effects: [createLayerEffect('background-blur', { id: 'fractional-slice-backdrop-blur', radius: 2 })]
  });
  const fractionalSliceArtwork = createNode('rectangle', {
    name: 'Fractional slice interior', x: 600.25, y: 450.25, width: 20.5, height: 20.5, fill: '#00cc44'
  });
  const outsideFractionalSliceArtwork = createNode('rectangle', {
    name: 'Artwork outside fractional slice', x: 620.75, y: 470.75, width: 10, height: 10, fill: '#ff0000'
  });
  const fractionalSlice = createNode('slice', {
    name: 'Fractional backdrop slice', x: 600.25, y: 450.25, width: 20.5, height: 20.5
  });
  const vectorFrame = createNode('frame', { name: 'Vector art one', x: 320, y: 40, width: 120, height: 80, fill: '#ffffff' });
  const vectorGradient = createGradientFill('linear', '#ff3300');
  vectorGradient.stops[1].color = '#2244ff';
  addNode(design, vectorFrame);
  addNode(design, createNode('rectangle', { name: 'Gradient card', x: 12, y: 10, width: 72, height: 44, fillGradient: vectorGradient }), { parentId: vectorFrame.id });
  const secondVectorFrame = createNode('frame', { name: 'Vector art two', x: 470, y: 40, width: 90, height: 70, fill: '#ffffff' });
  addNode(design, secondVectorFrame);
  addNode(design, createNode('ellipse', { name: 'Blue circle', x: 15, y: 10, width: 56, height: 50, fill: '#3366cc' }), { parentId: secondVectorFrame.id });
  addNode(design, group); addNode(design, artwork, { parentId: group.id });
  addNode(design, caption, { parentId: group.id });
  addNode(design, localImage, { parentId: group.id });
  addNode(design, batchJpeg); addNode(design, batchWebp);
  addNode(design, imageFilled);
  addNode(design, sliceArtwork); addNode(design, pageSlice);
  addNode(design, fractionalSliceArtwork); addNode(design, outsideFractionalSliceArtwork);
  addNode(design, fractionalSliceBackdrop); addNode(design, fractionalSlice);
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
  const savedArtwork = saved ? findNode(saved, artwork.id)?.node : null;
  assert(savedArtwork?.exportSettings?.[0]?.format === 'webp', 'The chosen export format did not persist locally.');
  assert(savedArtwork.exportSettings[0].scale === 2 && savedArtwork.exportSettings[0].suffix === '@2x', 'The scale and suffix did not persist locally.');
  assert(savedArtwork.exportSettings[0].quality === 84, 'The output quality did not persist locally.');

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
  assert(!pageSvg.includes(`data-tiny-image-star-node-id="${pageSlice.id}"`), 'Page SVG should omit slice overlays while retaining the artwork underneath.');

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
  assert(!encodeCalls.some(call => call.type === 'image/jpeg' || call.type === 'image/webp'), 'Batch image formats and quality should be encoded in the local Pillow-RS WASM worker, not Canvas2D.');
  const processedBitmap = await view.createImageBitmap(new Blob([webpBytes], { type: 'image/webp' }));
  const processedCanvas = view.document.createElement('canvas'); processedCanvas.width = processedBitmap.width; processedCanvas.height = processedBitmap.height;
  const processedContext = processedCanvas.getContext('2d', { willReadFrequently: true }); processedContext.drawImage(processedBitmap, 0, 0); processedBitmap.close();
  const originalBitmap = await view.createImageBitmap(new Blob([imageBytes], { type: 'image/png' }));
  const originalCanvas = view.document.createElement('canvas'); originalCanvas.width = originalBitmap.width; originalCanvas.height = originalBitmap.height;
  const originalContext = originalCanvas.getContext('2d', { willReadFrequently: true }); originalContext.drawImage(originalBitmap, 0, 0); originalBitmap.close();
  const processedPixel = processedContext.getImageData(5, 12, 1, 1).data;
  const originalPixel = originalContext.getImageData(0, 0, 1, 1).data;
  assert(processedPixel.some((channel, index) => index < 3 && channel !== originalPixel[index]), 'The archive should contain the current edited preview, not the untouched source image.');
  click(app.querySelector(`[data-layer-id="${batchWebp.id}"]`));
  const sourceExport = app.querySelector('[data-action="export-edited-source"]');
  assert(sourceExport && Number.parseFloat(view.getComputedStyle(sourceExport).minHeight) >= 40, 'The full-resolution source export action should remain finger-sized on mobile.');
  const directQualityCalls = [];
  canvasPrototype.toBlob = function (callback, type, quality) {
    directQualityCalls.push({ type, quality });
    return originalToBlob.call(this, callback, type, quality);
  };
  try {
    click(sourceExport);
    await waitFor(() => downloads.length === 12, 'full-resolution edited source export');
  } finally {
    canvasPrototype.toBlob = originalToBlob;
  }
  const sourceExported = downloads[11];
  assert(sourceExported.filename === 'Batch Edited WebP.webp' && sourceExported.blob?.type === 'image/webp', 'The edited original export should use its saved WebP format and sanitized layer name.');
  bitmap = await view.createImageBitmap(sourceExported.blob);
  assert(bitmap.width === 64 && bitmap.height === 32, `The edited original should keep its full source resolution; received ${bitmap.width} × ${bitmap.height}.`);
  bitmap.close();
  assert(!directQualityCalls.some(call => call.type === 'image/webp'), 'Full-resolution WebP output should preserve WASM-encoded quality without a browser re-encode.');
  click(app.querySelector(`[data-layer-id="${vectorFrame.id}"]`));
  const selectedVectorPdfButton = app.querySelector('[data-action="export-vector-pdf"]');
  assert(selectedVectorPdfButton && Number.parseFloat(view.getComputedStyle(selectedVectorPdfButton).minHeight) >= 40,
    'The vector PDF export action should be available and finger-sized for a selected frame on mobile.');
  click(selectedVectorPdfButton);
  await waitFor(() => downloads.length === 13, 'selected-frame vector PDF');
  assert(downloads[12].filename === 'Vector art one.pdf' && downloads[12].blob?.type === 'application/pdf',
    'Selected-frame vector PDF should use a local filename and PDF MIME type.');
  const selectedPdfText = new TextDecoder('latin1').decode(await downloads[12].blob.arrayBuffer());
  assert(selectedPdfText.startsWith('%PDF-1.4') && selectedPdfText.includes('/ShadingType 2')
    && !selectedPdfText.includes('/Subtype /Image'),
  'Selected-frame PDF should keep the editor gradient as vector shading instead of rasterizing it.');

  click(app.querySelector('#file-menu-button'));
  const vectorPagePdfButton = [...app.querySelectorAll('#context-menu button')]
    .find(button => button.textContent.includes('Current page · editable vector, one page per frame'));
  assert(vectorPagePdfButton, 'The file menu should offer an editable vector PDF page for each frame.');
  click(vectorPagePdfButton);
  await waitFor(() => downloads.length === 14, 'current-page multipage vector PDF');
  assert(downloads[13].filename === 'Page 1-frames.pdf' && downloads[13].blob?.type === 'application/pdf',
    'Current-page vector PDF should use the page name and frames suffix.');
  const pagePdfText = new TextDecoder('latin1').decode(await downloads[13].blob.arrayBuffer());
  assert(pagePdfText.includes('/Type /Pages /Count 2') && !pagePdfText.includes('/Subtype /Image'),
    'Current-page PDF should contain one vector page for each visible top-level frame.');

  click(app.querySelector(`[data-layer-id="${pageSlice.id}"]`));
  assert(app.querySelector('[data-prop="fill"]') === null && app.querySelector('[data-action="export-svg"]') === null,
    'A slice should expose crop/export controls without ordinary shape styling or SVG export.');
  click(app.querySelector('[data-action="add-export-setting"]'));
  let sliceRows = app.querySelectorAll('.export-setting-row');
  assert(sliceRows.length === 1, 'The selected slice should add a dedicated raster export setting.');
  const slicePngId = sliceRows[0].dataset.exportRow;
  updateSetting(app, slicePngId, 'padding', '3');
  sliceRows = app.querySelectorAll('.export-setting-row');
  const slicePaddingInput = sliceRows[0]?.querySelector('[data-export-field="padding"]');
  const slicePaddingBounds = slicePaddingInput?.getBoundingClientRect();
  const slicePaddingHeight = slicePaddingInput && Number.parseFloat(view.getComputedStyle(slicePaddingInput).height);
  assert(slicePaddingInput?.isConnected && slicePaddingHeight >= 38 && slicePaddingBounds.height >= 38,
  'Slice padding controls should remain finger-sized on mobile after the inspector rerenders.');
  const sliceCanvasCalls = [];
  canvasPrototype.toBlob = function (callback, type, quality) {
    sliceCanvasCalls.push({ type, quality });
    return originalToBlob.call(this, callback, type, quality);
  };
  try {
    click(app.querySelector(`[data-action="export-setting"][data-export-id="${slicePngId}"]`));
    await waitFor(() => downloads.length === 15, 'padded slice PNG download');
  } finally {
    canvasPrototype.toBlob = originalToBlob;
  }
  const slicePng = downloads[14];
  assert(slicePng.filename === 'Page slice.png' && slicePng.blob?.type === 'image/png',
    'Slice PNG export should use the slice name and PNG format.');
  bitmap = await view.createImageBitmap(slicePng.blob);
  assert(bitmap.width === 66 && bitmap.height === 51,
    `A 60 × 45 slice with 3 px padding should export at 66 × 51; got ${bitmap.width} × ${bitmap.height}.`);
  const sliceCanvas = view.document.createElement('canvas'); sliceCanvas.width = bitmap.width; sliceCanvas.height = bitmap.height;
  const sliceContext = sliceCanvas.getContext('2d', { willReadFrequently: true });
  sliceContext.drawImage(bitmap, 0, 0); bitmap.close();
  const transparentPadding = sliceContext.getImageData(1, 1, 1, 1).data;
  const slicedArtworkPixel = sliceContext.getImageData(12, 12, 1, 1).data;
  assert(transparentPadding[3] === 0, `PNG slice padding should stay transparent; got alpha ${transparentPadding[3]}.`);
  assert(slicedArtworkPixel[1] > 150 && slicedArtworkPixel[0] < 80 && slicedArtworkPixel[3] > 240,
    `Slice should include the page artwork beneath its region; got ${Array.from(slicedArtworkPixel).join(',')}.`);
  assert(!sliceCanvasCalls.some(call => call.type === 'image/jpeg' || call.type === 'image/webp'),
    'Slice PNG should pass through the local Pillow-RS encoder rather than Canvas JPEG/WebP codecs.');

  click(app.querySelector('[data-action="add-export-setting"]'));
  sliceRows = app.querySelectorAll('.export-setting-row');
  const sliceWebpId = sliceRows[1].dataset.exportRow;
  updateSetting(app, sliceWebpId, 'format', 'webp');
  updateSetting(app, sliceWebpId, 'scale', '2');
  updateSetting(app, sliceWebpId, 'quality', '82');
  canvasPrototype.toBlob = function (callback, type, quality) {
    sliceCanvasCalls.push({ type, quality });
    return originalToBlob.call(this, callback, type, quality);
  };
  try {
    click(app.querySelector(`[data-action="export-setting"][data-export-id="${sliceWebpId}"]`));
    await waitFor(() => downloads.length === 16, 'scaled slice WebP download');
  } finally {
    canvasPrototype.toBlob = originalToBlob;
  }
  const sliceWebp = downloads[15];
  assert(sliceWebp.filename === 'Page slice@2x.webp' && sliceWebp.blob?.type === 'image/webp',
    'Scaled slice WebP should use the requested format, scale suffix, and MIME type.');
  const webpBitmap = await view.createImageBitmap(sliceWebp.blob);
  assert(webpBitmap.width === 120 && webpBitmap.height === 90,
    `A 2× 60 × 45 slice should export at 120 × 90; got ${webpBitmap.width} × ${webpBitmap.height}.`);
  webpBitmap.close();
  const sliceWebpBytes = new Uint8Array(await sliceWebp.blob.arrayBuffer());
  assert(new TextDecoder().decode(sliceWebpBytes.subarray(0, 4)) === 'RIFF'
    && new TextDecoder().decode(sliceWebpBytes.subarray(8, 12)) === 'WEBP',
  'Scaled slice WebP should contain an encoded WebP file from the local raster pipeline.');
  assert(!sliceCanvasCalls.some(call => call.type === 'image/webp'),
    'Slice WebP should use Pillow-RS encoding rather than the browser WebP codec.');

  click(app.querySelector('[data-action="add-export-setting"]'));
  sliceRows = app.querySelectorAll('.export-setting-row');
  const sliceJpegId = sliceRows[2].dataset.exportRow;
  updateSetting(app, sliceJpegId, 'format', 'jpeg');
  updateSetting(app, sliceJpegId, 'padding', '2');
  canvasPrototype.toBlob = function (callback, type, quality) {
    sliceCanvasCalls.push({ type, quality });
    return originalToBlob.call(this, callback, type, quality);
  };
  try {
    click(app.querySelector(`[data-action="export-setting"][data-export-id="${sliceJpegId}"]`));
    await waitFor(() => downloads.length === 17, 'padded slice JPEG download');
  } finally {
    canvasPrototype.toBlob = originalToBlob;
  }
  const sliceJpeg = downloads[16];
  assert(sliceJpeg.filename === 'Page slice.jpg' && sliceJpeg.blob?.type === 'image/jpeg',
    'Slice JPEG should use the .jpg extension and JPEG MIME type.');
  bitmap = await view.createImageBitmap(sliceJpeg.blob);
  assert(bitmap.width === 64 && bitmap.height === 49,
    `A 60 × 45 slice with 2 px padding should export at 64 × 49; got ${bitmap.width} × ${bitmap.height}.`);
  const jpegSliceCanvas = view.document.createElement('canvas'); jpegSliceCanvas.width = bitmap.width; jpegSliceCanvas.height = bitmap.height;
  const jpegSliceContext = jpegSliceCanvas.getContext('2d', { willReadFrequently: true });
  jpegSliceContext.drawImage(bitmap, 0, 0); bitmap.close();
  const jpegPaddingPixel = jpegSliceContext.getImageData(1, 1, 1, 1).data;
  assert(jpegPaddingPixel[0] > 220 && jpegPaddingPixel[1] > 220 && jpegPaddingPixel[2] > 220,
    `JPEG slice padding should be white; got ${Array.from(jpegPaddingPixel).join(',')}.`);
  assert(!sliceCanvasCalls.some(call => call.type === 'image/jpeg' || call.type === 'image/webp'),
    'Slice raster formats should use Pillow-RS encoding rather than browser JPEG/WebP codecs.');

  const backdropRow = app.querySelector(`[data-layer-id="${fractionalSliceBackdrop.id}"]`);
  assert(backdropRow?.classList.contains('layer-hidden'), 'The fractional-slice blur fixture should stay hidden during page SVG export assertions.');
  click(backdropRow.querySelector('[data-action="visibility"]'));
  assert(!app.querySelector(`[data-layer-id="${fractionalSliceBackdrop.id}"]`)?.classList.contains('layer-hidden'),
    'The fractional-slice blur fixture should be enabled before the raster slice export.');
  click(app.querySelector(`[data-layer-id="${fractionalSlice.id}"]`));
  click(app.querySelector('[data-action="add-export-setting"]'));
  const fractionalSliceId = app.querySelector('.export-setting-row')?.dataset.exportRow;
  assert(fractionalSliceId, 'The fractional slice should expose a raster export setting.');
  canvasPrototype.toBlob = function (callback, type, quality) {
    sliceCanvasCalls.push({ type, quality });
    return originalToBlob.call(this, callback, type, quality);
  };
  try {
    click(app.querySelector(`[data-action="export-setting"][data-export-id="${fractionalSliceId}"]`));
    await waitFor(() => downloads.length === 18, 'fractional backdrop slice PNG download');
  } finally {
    canvasPrototype.toBlob = originalToBlob;
  }
  const fractionalSlicePng = downloads[17];
  assert(fractionalSlicePng.filename === 'Fractional backdrop slice.png'
    && fractionalSlicePng.blob?.type === 'image/png', 'Fractional backdrop slice should export as PNG.');
  bitmap = await view.createImageBitmap(fractionalSlicePng.blob);
  assert(bitmap.width === 21 && bitmap.height === 21,
    `A 20.5 × 20.5 fractional slice should round up to 21 × 21; got ${bitmap.width} × ${bitmap.height}.`);
  const fractionalSliceCanvas = view.document.createElement('canvas');
  fractionalSliceCanvas.width = bitmap.width; fractionalSliceCanvas.height = bitmap.height;
  const fractionalSliceContext = fractionalSliceCanvas.getContext('2d', { willReadFrequently: true });
  fractionalSliceContext.drawImage(bitmap, 0, 0); bitmap.close();
  const fractionalEdgePixel = fractionalSliceContext.getImageData(20, 20, 1, 1).data;
  assert(fractionalEdgePixel[1] > 100 && fractionalEdgePixel[0] < 30 && fractionalEdgePixel[3] > 0,
    `The fractional slice edge must retain only cropped green artwork, excluding red artwork just outside the crop; got ${Array.from(fractionalEdgePixel).join(',')}.`);
  click(app.querySelector('#file-menu-button'));
  const pagePdfMenuItem = [...app.querySelectorAll('#context-menu button')]
    .find(button => button.textContent.includes('Current page · fit artwork to paper'));
  assert(pagePdfMenuItem, 'The file menu should offer a paper-sized PDF export for the current page.');
  click(pagePdfMenuItem);
  const pagePdfDialog = app.querySelector('#page-pdf-dialog');
  assert(pagePdfDialog?.open && pagePdfDialog.querySelector('#page-pdf-size'),
    'Page PDF export should open a size chooser instead of requiring frame-only output.');
  const pageSize = pagePdfDialog.querySelector('#page-pdf-size');
  const customWidth = pagePdfDialog.querySelector('#page-pdf-custom-width');
  const customHeight = pagePdfDialog.querySelector('#page-pdf-custom-height');
  pageSize.value = 'custom'; pageSize.dispatchEvent(new view.Event('change', { bubbles: true }));
  customWidth.value = '100'; customWidth.dispatchEvent(new view.Event('input', { bubbles: true }));
  customHeight.value = '150'; customHeight.dispatchEvent(new view.Event('input', { bubbles: true }));
  assert(pagePdfDialog.querySelector('#page-pdf-status').textContent.includes('100.0 × 150.0 mm'),
    'Custom page dimensions should update the live export preview.');
  pagePdfDialog.querySelector('#page-pdf-form').dispatchEvent(new view.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => downloads.length === 19, 'custom-size current-page PDF');
  const pageRasterPdf = downloads[18];
  assert(pageRasterPdf.filename === 'Page 1.pdf' && pageRasterPdf.blob?.type === 'application/pdf',
    'Page PDF should be delivered using the page name and PDF MIME type.');
  const pageRasterPdfText = new TextDecoder('latin1').decode(await pageRasterPdf.blob.arrayBuffer());
  assert(pageRasterPdfText.includes('/Type /Pages /Count 1')
    && /\/MediaBox \[0 0 283\.46\d+ 425\.19\d+\]/.test(pageRasterPdfText)
    && pageRasterPdfText.includes('/Subtype /Image'),
  'Page PDF should contain one Pillow-RS raster page with the selected 100 × 150 mm physical size.');
  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', persistedSettings: true, formats: ['webp', 'jpeg', 'png', 'svg', 'vector-pdf'], nestedRotatedBounds: [60, 88], suffix: '@2x', quality: 84, mobileTouchTargets: true, ancestorFillExcluded: red === 0, jpegWhiteBackground: true, quickPngPreserved: true, selectedLayerSvg: true, pageSvg: true, svgTextParity: true, embeddedLocalImage: true, editedImagePreviewByteExact: true, sharedSourcePreviewIsolation: true, editedImageFillPreviewByteExact: true, imageFillImmediateExport: true, individualImageZip: true, perImageOutputFormatAndQuality: true, batchExportCancellation: true, processedPreviewInArchive: true, fullResolutionImageExport: true, fullResolutionQualityApplied: true, selectedVectorPdf: true, vectorPdfPages: 2, customSizePagePdf: true, customPaperSizeMm: [100, 150], slicePngCropAndTransparentPadding: true, sliceWebpScaleAndQuality: true, sliceJpegWhitePadding: true, fractionalSliceBackdropEdgeClipped: true, rasterExportUnaffectedByOutlineView: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
