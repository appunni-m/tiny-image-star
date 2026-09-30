import { addNode, createDocument, createNode } from '../src/model.js';
import { deleteImageAsset, deleteStoredDocument, loadDocumentById, saveDocument, saveImageAssetBytes } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const design = createDocument();
design.name = `Canvas editing ${Date.now().toString(36)}`;
const assetId = `canvas-edit-image-${Date.now().toString(36)}`;
const image = createNode('image', {
  name: 'Crop source', fileName: 'crop-source.png', assetId,
  sourceWidth: 64, sourceHeight: 32, x: -80, y: -50, width: 160, height: 100,
  fit: 'cover', transforms: { crop: { left: .25, top: 0, right: .75, bottom: 1 } }
});
const movable = createNode('rectangle', { name: 'Cancelable move', x: 160, y: -60, width: 70, height: 48, fill: '#9747ff' });
const text = createNode('text', { name: 'Editable text', text: 'Double click to edit', x: 100, y: -35, width: 220, height: 54, fontSize: 24 });
addNode(design, image); addNode(design, movable); addNode(design, text);

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } } catch { /* Wait for local startup, preview, or persistence. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    void poll();
  });
}
function click(app, element) {
  assert(element, 'Expected a canvas editing control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function worldScreenPoint(app, point) {
  const canvas = app.querySelector('#scene-canvas');
  const rect = canvas.getBoundingClientRect();
  const transform = canvas.getContext('2d').getTransform();
  const dpr = app.defaultView.devicePixelRatio || 1;
  return {
    x: rect.left + transform.e / dpr + point.x * transform.a / dpr,
    y: rect.top + transform.f / dpr + point.y * transform.d / dpr
  };
}
function pointer(app, type, point, pointerId = 91, pointerType = 'mouse') {
  const canvas = app.querySelector('#scene-canvas');
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  const screen = worldScreenPoint(app, point);
  canvas.dispatchEvent(new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType, button: 0,
    clientX: screen.x, clientY: screen.y
  }));
}
function pointerOn(app, element, type, pointerId = 91) {
  assert(element, 'Expected the canvas gesture to be interrupted by a UI control.');
  element.dispatchEvent(new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType: 'touch', button: 0,
    clientX: 12, clientY: 12
  }));
}
function closeEnough(actual, expected, label) {
  assert(Math.abs(actual - expected) < 1 / 32 + 1e-9,
    `${label} should be ${expected}, got ${actual}.`);
}
function cropAt(node) { return node?.transforms?.crop || null; }
async function makeImageBytes() {
  const source = document.createElement('canvas'); source.width = 64; source.height = 32;
  const context = source.getContext('2d');
  context.fillStyle = '#ff0000'; context.fillRect(0, 0, 32, 32);
  context.fillStyle = '#0000ff'; context.fillRect(32, 0, 32, 32);
  const blob = await new Promise((resolve, reject) => source.toBlob(value => value ? resolve(value) : reject(new Error('Could not create a crop source image.')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
function readPixelAtWorld(app, point) {
  const canvas = app.querySelector('#scene-canvas');
  const rect = canvas.getBoundingClientRect();
  const screen = worldScreenPoint(app, point);
  const x = Math.max(0, Math.min(canvas.width - 1, Math.round((screen.x - rect.left) * canvas.width / rect.width)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.round((screen.y - rect.top) * canvas.height / rect.height)));
  return [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];
}

try {
  const app = frame.contentDocument;
  await waitFor(() => app?.documentElement.dataset.appReady === 'true', 'editor startup');
  const sourceBytes = await makeImageBytes();
  await saveImageAssetBytes(assetId, 'crop-source.png', 'image/png', sourceBytes);
  await saveDocument(design);

  click(app, app.querySelector('#main-menu-button'));
  const designsAction = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  click(app, designsAction);
  const library = app.querySelector('#design-library-dialog');
  const designRow = await waitFor(() => library?.open && library.querySelector(`[data-design-id="${design.id}"][data-design-action="open"]`), 'seeded local design');
  click(app, designRow);
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'local design open');
  await waitFor(() => app.querySelector(`[data-layer-id="${image.id}"]`)
    && app.querySelector(`[data-layer-id="${movable.id}"]`)
    && app.querySelector(`[data-layer-id="${text.id}"]`), 'seeded layers');

  click(app, app.querySelector(`[data-layer-id="${movable.id}"]`));
  const moveStart = { x: movable.x + movable.width / 2, y: movable.y + movable.height / 2 };
  pointer(app, 'pointerdown', moveStart, 92);
  pointer(app, 'pointermove', { x: moveStart.x + 28, y: moveStart.y + 20 }, 92);
  pointer(app, 'pointercancel', { x: moveStart.x + 28, y: moveStart.y + 20 }, 92);
  await waitFor(async () => (await loadDocumentById(design.id))?.pages?.[0]?.children?.find(node => node.id === movable.id)?.x === movable.x,
    'canceled move rollback');
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 260));
  let saved = await loadDocumentById(design.id);
  assert(saved.pages[0].children.find(node => node.id === movable.id)?.x === movable.x,
    'A canceled move must not create a hidden undo entry.');

  const interruptedMoveStart = { x: movable.x + movable.width / 2, y: movable.y + movable.height / 2 };
  pointer(app, 'pointerdown', interruptedMoveStart, 95);
  pointer(app, 'pointermove', { x: interruptedMoveStart.x + 22, y: interruptedMoveStart.y }, 95);
  pointerOn(app, app.querySelector(`[data-layer-id="${image.id}"]`), 'pointerdown', 96);
  const imageLayerRow = app.querySelector(`[data-layer-id="${image.id}"]`);
  click(app, imageLayerRow);
  pointerOn(app, imageLayerRow, 'pointerup', 96);
  await waitFor(async () => (await loadDocumentById(design.id))?.pages?.[0]?.children?.find(node => node.id === movable.id)?.x === movable.x,
    'canvas gesture cancellation before inspector or layer UI actions');
  assert(imageLayerRow.classList.contains('is-selected'),
    'The layer panel action should proceed after the canvas gesture is rolled back.');

  const cropButton = app.querySelector('[data-action="toggle-image-crop-mode"]');
  click(app, cropButton);
  await waitFor(() => app.querySelector('[data-action="toggle-image-crop-mode"]')?.textContent.includes('Done cropping'), 'crop mode');
  const outsideCrop = await waitFor(() => {
    const pixel = readPixelAtWorld(app, { x: image.x - 15, y: image.y + image.height / 2 });
    return pixel[0] > pixel[2] * 2 && pixel[0] > 120 ? pixel : null;
  }, 'uncropped source pixels outside the previous crop');
  assert(outsideCrop[0] > outsideCrop[2] * 2 && outsideCrop[0] > 120,
    `Crop mode must reveal uncropped original pixels outside the old crop (${outsideCrop.join(',')}).`);
  const fullSource = { left: -20, top: 0, width: 200, height: 100 };

  // Undo is blocked for the entire crop gesture, including a new selection
  // before there is a live document transaction to roll back.
  const selectionStart = { x: image.x + fullSource.left + 10, y: image.y + 10 };
  pointer(app, 'pointerdown', selectionStart, 97);
  pointer(app, 'pointermove', { x: selectionStart.x + 40, y: selectionStart.y + 35 }, 97);
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  pointer(app, 'pointercancel', { x: selectionStart.x + 40, y: selectionStart.y + 35 }, 97);
  saved = await loadDocumentById(design.id);
  assert(cropAt(saved.pages[0].children.find(node => node.id === image.id))?.left === .25,
    'Undo during an uncommitted crop selection must not replace the document or lose the active layer reference.');

  // Crop mode remains the active canvas tool even if Hand was selected first.
  click(app, app.querySelector('.tool-button[data-tool="hand"]'));
  const handCropStart = { x: image.x + fullSource.left + 10, y: image.y + 10 };
  const handCropEnd = { x: image.x + fullSource.left + 170, y: image.y + 90 };
  pointer(app, 'pointerdown', handCropStart, 98);
  pointer(app, 'pointermove', handCropEnd, 98);
  pointer(app, 'pointerup', handCropEnd, 98);
  await waitFor(async () => {
    const crop = cropAt((await loadDocumentById(design.id))?.pages?.[0]?.children?.find(node => node.id === image.id));
    return crop?.left < .06 && crop?.right > .84;
  }, 'crop interaction while Hand tool is selected');
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  await waitFor(async () => cropAt((await loadDocumentById(design.id))?.pages?.[0]?.children?.find(node => node.id === image.id))?.left === .25,
    'undo of Hand-tool crop interaction');

  // Touch begins within the large handle hit target but away from its visual
  // center; the crop edge should follow only the finger delta, with no jump.
  const handleStart = { x: image.x + 138, y: image.y + 50 };
  pointer(app, 'pointerdown', handleStart, 93, 'touch');
  pointer(app, 'pointermove', { x: handleStart.x + 20, y: handleStart.y + 5 }, 93, 'touch');
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  pointer(app, 'pointercancel', { x: handleStart.x + 20, y: handleStart.y + 5 }, 93, 'touch');
  await new Promise(resolve => setTimeout(resolve, 260));
  saved = await loadDocumentById(design.id);
  let savedImage = saved.pages[0].children.find(node => node.id === image.id);
  assert(cropAt(savedImage)?.left === .25 && cropAt(savedImage)?.right === .75,
    'Pointer cancellation or mid-gesture undo changed the committed crop.');

  const cropStart = { x: image.x + fullSource.left + 10, y: image.y + 10 };
  const cropEnd = { x: image.x + fullSource.left + 170, y: image.y + 90 };
  pointer(app, 'pointerdown', cropStart, 94);
  pointer(app, 'pointermove', cropEnd, 94);
  pointer(app, 'pointerup', cropEnd, 94);
  await waitFor(async () => {
    saved = await loadDocumentById(design.id);
    const crop = cropAt(saved?.pages?.[0]?.children?.find(node => node.id === image.id));
    return crop?.left < .06 && crop?.right > .84 && crop?.top > .08 && crop?.bottom < .92;
  }, 'committed full-source crop');
  savedImage = saved.pages[0].children.find(node => node.id === image.id);
  assert(savedImage.id === image.id && savedImage.assetId === assetId,
    'Cropping must update the same image layer while retaining its original local source.');
  const committedCrop = cropAt(savedImage);
  closeEnough(committedCrop.left, 3 / 64, 'rounded left crop edge');
  closeEnough(committedCrop.right, 55 / 64, 'rounded right crop edge');
  closeEnough(committedCrop.top, 3 / 32, 'rounded top crop edge');
  closeEnough(committedCrop.bottom, 29 / 32, 'rounded bottom crop edge');

  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  await waitFor(async () => cropAt((await loadDocumentById(design.id))?.pages?.[0]?.children?.find(node => node.id === image.id))?.left === .25,
    'crop undo');
  app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }));
  await waitFor(async () => {
    const crop = cropAt((await loadDocumentById(design.id))?.pages?.[0]?.children?.find(node => node.id === image.id));
    return crop?.left === committedCrop.left && crop?.right === committedCrop.right;
  }, 'crop redo');
  click(app, app.querySelector('[data-action="toggle-image-crop-mode"]'));

  click(app, app.querySelector(`[data-layer-id="${text.id}"]`));
  // The preceding crop-on-canvas check deliberately leaves Hand selected.
  // Put the editor back in Select mode before asserting text-layer editing.
  click(app, app.querySelector('.tool-button[data-tool="select"]'));
  const textCenter = worldScreenPoint(app, { x: text.x + text.width / 2, y: text.y + text.height / 2 });
  app.querySelector('#scene-canvas').dispatchEvent(new app.defaultView.MouseEvent('dblclick', {
    bubbles: true, cancelable: true, clientX: textCenter.x, clientY: textCenter.y
  }));
  await waitFor(() => !app.querySelector('#text-editor-overlay')?.hidden, 'double-click text editing');
  assert(app.querySelector('#text-editor-overlay').textContent.includes('Double click to edit'),
    'Double-clicking text should open the same layer in the text editor.');
  click(app, app.querySelector('[data-text-format-done]'));
  await waitFor(() => app.querySelector('#text-editor-overlay')?.hidden, 'text edit close');

  result.textContent = `PASS\n${JSON.stringify({ movePointerCancel: true, canceledMoveCreatedNoUndo: true, canvasGestureCancelsBeforePanelAction: true, uncroppedSourceVisible: true, cropSelectionUndoGuard: true, cropModeOverridesHandTool: true, touchOffsetPreserved: true, cropPointerCancelAndUndoGuard: true, cropSelectionInPlace: true, cropUndoRedo: true, doubleClickTextEdit: true, originalImageAssetRetained: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  await deleteStoredDocument(design.id).catch(() => {});
  await deleteImageAsset(assetId).catch(() => {});
}
