import { addNode, createDocument, createNode } from '../src/model.js';
import { deleteImageAsset, deleteStoredDocument, MAX_LOCAL_PACKAGE_BYTES, saveDocument, saveImageAssetBytes, unpackLocalPackage } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } } catch { /* Wait for the app, library, or package action. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 30);
    };
    void poll();
  });
}
function click(app, element) {
  assert(element, 'Expected a local-share workflow control.');
  element.click();
}
function clickSendDesignFile(app) {
  click(app, app.querySelector('#main-menu-button'));
  const sendFile = [...app.querySelectorAll('#context-menu [role="menuitem"]')]
    .find(item => item.textContent.includes('Send design file'));
  assert(sendFile, 'File should offer a local design-file sharing action.');
  click(app, sendFile);
}
function installDownloadCapture(app) {
  const view = app.defaultView;
  const downloads = [];
  const objectUrls = new Map();
  const createDescriptor = Object.getOwnPropertyDescriptor(view.URL, 'createObjectURL');
  const revokeDescriptor = Object.getOwnPropertyDescriptor(view.URL, 'revokeObjectURL');
  const clickDescriptor = Object.getOwnPropertyDescriptor(view.HTMLAnchorElement.prototype, 'click');
  const createObjectURL = view.URL.createObjectURL.bind(view.URL);
  const originalAnchorClick = view.HTMLAnchorElement.prototype.click;
  Object.defineProperty(view.URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: blob => {
      const url = createObjectURL(blob);
      objectUrls.set(url, blob);
      return url;
    }
  });
  Object.defineProperty(view.HTMLAnchorElement.prototype, 'click', {
    configurable: true,
    writable: true,
    value: function () {
      if (this.hasAttribute('download')) {
        downloads.push({ filename: this.download, blob: objectUrls.get(this.href) || null });
        return;
      }
      originalAnchorClick.call(this);
    }
  });
  return {
    downloads,
    restore() {
      if (createDescriptor) Object.defineProperty(view.URL, 'createObjectURL', createDescriptor);
      else delete view.URL.createObjectURL;
      if (revokeDescriptor) Object.defineProperty(view.URL, 'revokeObjectURL', revokeDescriptor);
      else delete view.URL.revokeObjectURL;
      if (clickDescriptor) Object.defineProperty(view.HTMLAnchorElement.prototype, 'click', clickDescriptor);
      else delete view.HTMLAnchorElement.prototype.click;
    }
  };
}
function setNavigatorMethod(view, key, value) {
  const navigator = view.navigator;
  const descriptor = Object.getOwnPropertyDescriptor(navigator, key);
  Object.defineProperty(navigator, key, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(navigator, key, descriptor);
    else delete navigator[key];
  };
}
async function assertPackageFile(file, app, designId, assetId, expectedBytes, expectedName) {
  assert(file instanceof app.defaultView.File, 'The share/download payload should be a File.');
  assert(file.name === expectedName && file.name.endsWith('.flocal'), 'The local package filename should be safe and end in .flocal.');
  assert(file.type === 'application/octet-stream', 'The .flocal file should retain its package MIME type.');
  const contents = unpackLocalPackage(new Uint8Array(await file.arrayBuffer()));
  assert(contents.document.id === designId, 'The shared package should contain the active local design.');
  const image = contents.assets.find(asset => asset.id === assetId);
  assert(image, 'The shared package should embed the referenced local image asset.');
  assert(image.bytes.length === expectedBytes.length && image.bytes.every((byte, index) => byte === expectedBytes[index]),
    'The shared package image bytes should match the exact synthetic local source.');
  return contents;
}

let app = null;
let downloadCapture = null;
let restoreCanShare = null;
let restoreShare = null;
let designId = null;
let assetId = null;
try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'the local-share workflow should run in the Tiny Image Star editor.');

  const design = createDocument();
  design.name = `Local / Share ${Date.now().toString(36)}`;
  designId = design.id;
  assetId = `share-smoke-image-${Date.now().toString(36)}`;
  const imageCanvas = document.createElement('canvas'); imageCanvas.width = 1; imageCanvas.height = 1;
  imageCanvas.getContext('2d').fillRect(0, 0, 1, 1);
  const imageBlob = await new Promise((resolve, reject) => imageCanvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not build a valid local PNG fixture.')), 'image/png'));
  const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
  addNode(design, createNode('image', { name: 'Embedded share image', fileName: 'synthetic.png', assetId, sourceWidth: 1, sourceHeight: 1 }));
  await saveDocument(design);
  await saveImageAssetBytes(assetId, 'synthetic.png', 'image/png', imageBytes);

  click(app, app.querySelector('#main-menu-button'));
  const designsAction = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  click(app, designsAction);
  const library = app.querySelector('#design-library-dialog');
  const openDesign = await waitFor(() => library?.open && library.querySelector(`[data-design-id="${designId}"][data-design-action="open"]`), 'seeded local design');
  click(app, openDesign);
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'local design open');

  downloadCapture = installDownloadCapture(app);
  const openFileInput = app.querySelector('#open-file-input');
  let oversizedReadCalls = 0;
  Object.defineProperty(openFileInput, 'files', {
    configurable: true,
    value: [{ name: 'oversized.flocal', size: MAX_LOCAL_PACKAGE_BYTES + 1, arrayBuffer() { oversizedReadCalls += 1; throw new Error('Oversized package must be rejected before reading.'); } }]
  });
  openFileInput.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('128 MiB local package limit')),
    'oversized local package rejection');
  assert(oversizedReadCalls === 0, 'An oversized .flocal should be rejected before its bytes are allocated.');
  delete openFileInput.files;

  const nativePayloads = [];
  restoreCanShare = setNavigatorMethod(app.defaultView, 'canShare', data => {
    assert(Array.isArray(data?.files) && data.files.length === 1, 'canShare should inspect exactly one local package file.');
    return true;
  });
  restoreShare = setNavigatorMethod(app.defaultView, 'share', async data => { nativePayloads.push(data); });
  clickSendDesignFile(app);
  await waitFor(() => nativePayloads.length === 1, 'native file share');
  const nativeFile = nativePayloads[0].files?.[0];
  const safeName = design.name.replaceAll('/', '-').replace(/[. ]+$/g, '').trim() + '.flocal';
  await assertPackageFile(nativeFile, app, designId, assetId, imageBytes, safeName);
  assert(downloadCapture.downloads.length === 0, 'A successful device share should not also trigger a download.');

  restoreCanShare(); restoreCanShare = null;
  restoreShare(); restoreShare = null;
  let shareCalls = 0;
  restoreCanShare = setNavigatorMethod(app.defaultView, 'canShare', () => false);
  restoreShare = setNavigatorMethod(app.defaultView, 'share', async () => { shareCalls += 1; });
  clickSendDesignFile(app);
  await waitFor(() => downloadCapture.downloads.length === 1, 'unsupported-share download fallback');
  assert(shareCalls === 0, 'Unsupported file sharing should fall back without calling the device share API.');
  const unsupportedDownload = downloadCapture.downloads[0];
  const unsupportedFile = new app.defaultView.File([unsupportedDownload.blob], unsupportedDownload.filename, { type: unsupportedDownload.blob?.type || '' });
  await assertPackageFile(unsupportedFile, app, designId, assetId, imageBytes, safeName);

  restoreCanShare(); restoreCanShare = null;
  restoreShare(); restoreShare = null;
  restoreCanShare = setNavigatorMethod(app.defaultView, 'canShare', () => true);
  restoreShare = setNavigatorMethod(app.defaultView, 'share', async () => { throw new Error('Synthetic share-sheet failure.'); });
  clickSendDesignFile(app);
  await waitFor(() => downloadCapture.downloads.length === 2, 'failed-share download fallback');
  const failedDownload = downloadCapture.downloads[1];
  const failedFile = new app.defaultView.File([failedDownload.blob], failedDownload.filename, { type: failedDownload.blob?.type || '' });
  await assertPackageFile(failedFile, app, designId, assetId, imageBytes, safeName);

  restoreCanShare(); restoreCanShare = null;
  restoreShare(); restoreShare = null;
  let activationCalls = 0;
  const activationPayloads = [];
  restoreCanShare = setNavigatorMethod(app.defaultView, 'canShare', () => true);
  restoreShare = setNavigatorMethod(app.defaultView, 'share', async data => {
    activationCalls += 1;
    activationPayloads.push(data);
    if (activationCalls === 1) throw new app.defaultView.DOMException('Synthetic transient activation expired.', 'NotAllowedError');
  });
  clickSendDesignFile(app);
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Send design file again')),
    'prepared native-share retry');
  assert(downloadCapture.downloads.length === 2, 'An expired activation should keep the prepared file ready instead of immediately downloading it.');
  clickSendDesignFile(app);
  await waitFor(() => activationCalls === 2, 'native-share retry from a fresh button click');
  assert(activationPayloads[0].files[0] === activationPayloads[1].files[0], 'The fresh share tap should reuse the prepared File without rebuilding the package.');
  assert(downloadCapture.downloads.length === 2, 'A successful retry should not trigger a duplicate download.');

  result.textContent = `PASS\n${JSON.stringify({
    nativeShareFile: true,
    nativeShareIncludesExactEmbeddedImageBytes: true,
    unsupportedShareDownloadsFlocal: true,
    rejectedShareDownloadsFlocal: true,
    expiredActivationPreparedFileRetriesOnFreshTap: true,
    safeFilename: safeName,
    localOnlySyntheticAsset: true
  })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  restoreCanShare?.();
  restoreShare?.();
  downloadCapture?.restore();
  if (designId) await deleteStoredDocument(designId).catch(() => {});
  if (assetId) await deleteImageAsset(assetId).catch(() => {});
}
