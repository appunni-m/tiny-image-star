import { addNode, createComponent, createDocument, createNode } from '../src/model.js';
import { ellipseArcControlHandles } from '../src/ellipse-arc-controls.js';
import { starControlHandles } from '../src/star-controls.js';
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
const reviewComponent = createNode('frame', { name: 'Comment component', x: 150, y: 135, width: 180, height: 120, fill: 'transparent' });
const reviewFrame = createNode('frame', { name: 'Comment frame', x: 10, y: 10, width: 150, height: 90, fill: 'transparent' });
const reviewArtwork = createNode('rectangle', { name: 'Comment artwork', x: 10, y: 10, width: 50, height: 35, fill: '#ff8b5d' });
const star = createNode('star', { name: 'Tunable star', x: 390, y: 120, width: 120, height: 100, points: 5, innerRadius: .48, radius: 0 });
const ellipseArc = createNode('ellipse', {
  name: 'Tunable ellipse arc', x: 560, y: 120, width: 120, height: 100, fill: '#36b37e',
  arcData: { startingAngle: 0, endingAngle: Math.PI * 1.5, innerRadius: .25 }
});
addNode(design, image); addNode(design, movable); addNode(design, text); addNode(design, star); addNode(design, ellipseArc);
addNode(design, reviewComponent); createComponent(design, reviewComponent.id, reviewComponent.name);
addNode(design, reviewFrame, { parentId: reviewComponent.id }); addNode(design, reviewArtwork, { parentId: reviewFrame.id });

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
function pointerScreen(app, type, point, pointerId = 91, pointerType = 'mouse') {
  const canvas = app.querySelector('#scene-canvas');
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  canvas.dispatchEvent(new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType, button: 0,
    clientX: point.x, clientY: point.y
  }));
}
function tap(app, point, pointerId = 91, pointerType = 'mouse') {
  pointer(app, 'pointerdown', point, pointerId, pointerType);
  pointer(app, 'pointerup', point, pointerId, pointerType);
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
  await waitFor(() => app.querySelector('#document-name')?.value === design.name
    && app.querySelector('.workspace')?.inert === false, 'local design open and editable');
  await waitFor(() => app.querySelector(`[data-layer-id="${image.id}"]`)
    && app.querySelector(`[data-layer-id="${movable.id}"]`)
    && app.querySelector(`[data-layer-id="${text.id}"]`)
    && app.querySelector(`[data-layer-id="${star.id}"]`)
    && app.querySelector(`[data-layer-id="${ellipseArc.id}"]`), 'seeded layers');

  click(app, app.querySelector(`[data-layer-id="${star.id}"]`));
  await waitFor(() => app.querySelector('[data-prop="points"]'), 'star controls in the inspector');
  const canvasTransform = app.querySelector('#scene-canvas').getContext('2d').getTransform();
  const zoom = canvasTransform.a / (app.defaultView.devicePixelRatio || 1);
  const pointsHandle = starControlHandles(star, zoom).find(handle => handle.kind === 'points');
  const pointStart = { x: star.x + pointsHandle.point.x, y: star.y + pointsHandle.point.y };
  pointer(app, 'pointerdown', pointStart, 104);
  const pointEnd = { x: pointStart.x, y: pointStart.y - 36 / zoom };
  pointer(app, 'pointermove', pointEnd, 104);
  pointer(app, 'pointerup', pointEnd, 104);
  await waitFor(async () => (await loadDocumentById(design.id))?.pages?.[0]?.children?.find(node => node.id === star.id)?.points === 8,
    'direct star point-count edit');

  let savedStar = (await loadDocumentById(design.id)).pages[0].children.find(node => node.id === star.id);
  let ratioHandle = starControlHandles(savedStar, zoom).find(handle => handle.kind === 'ratio');
  const ratioCenter = { x: savedStar.width / 2, y: savedStar.height / 2 };
  const ratioDirection = {
    x: ratioHandle.point.x - ratioCenter.x,
    y: ratioHandle.point.y - ratioCenter.y
  };
  const ratioLength = Math.hypot(ratioDirection.x, ratioDirection.y);
  const ratioEndLocal = {
    x: ratioCenter.x + ratioDirection.x / ratioLength * Math.min(savedStar.width, savedStar.height) * .4,
    y: ratioCenter.y + ratioDirection.y / ratioLength * Math.min(savedStar.width, savedStar.height) * .4
  };
  const ratioStart = { x: savedStar.x + ratioHandle.point.x, y: savedStar.y + ratioHandle.point.y };
  const ratioEnd = { x: savedStar.x + ratioEndLocal.x, y: savedStar.y + ratioEndLocal.y };
  pointer(app, 'pointerdown', ratioStart, 105);
  pointer(app, 'pointermove', ratioEnd, 105);
  pointer(app, 'pointerup', ratioEnd, 105);
  await waitFor(async () => Math.abs(((await loadDocumentById(design.id))?.pages?.[0]?.children?.find(node => node.id === star.id)?.innerRadius ?? 0) - .8) < .001,
    'direct star ratio edit');

  savedStar = (await loadDocumentById(design.id)).pages[0].children.find(node => node.id === star.id);
  const radiusHandle = starControlHandles(savedStar, zoom).find(handle => handle.kind === 'radius');
  const radiusStart = { x: savedStar.x + radiusHandle.point.x, y: savedStar.y + radiusHandle.point.y };
  const radiusAmount = Math.min(6, radiusHandle.maxRadius);
  const radiusEnd = {
    x: radiusStart.x + radiusHandle.axis.x * radiusHandle.tangentFactor * (1 + radiusHandle.smoothing) * radiusAmount,
    y: radiusStart.y + radiusHandle.axis.y * radiusHandle.tangentFactor * (1 + radiusHandle.smoothing) * radiusAmount
  };
  pointer(app, 'pointerdown', radiusStart, 106);
  pointer(app, 'pointermove', radiusEnd, 106);
  pointer(app, 'pointerup', radiusEnd, 106);
  await waitFor(async () => (await loadDocumentById(design.id))?.pages?.[0]?.children?.find(node => node.id === star.id)?.radius > 0,
    'direct star corner-radius edit');

  click(app, app.querySelector(`[data-layer-id="${ellipseArc.id}"]`));
  await waitFor(() => app.querySelector('[data-prop="ellipseArc.start"]')
    && app.querySelector('[data-prop="ellipseArc.end"]')
    && app.querySelector('[data-prop="ellipseArc.innerRadius"]'), 'ellipse arc controls in the inspector');
  let savedEllipseArc = (await loadDocumentById(design.id)).pages[0].children.find(node => node.id === ellipseArc.id);
  const angleHandle = ellipseArcControlHandles(savedEllipseArc, zoom).find(handle => handle.kind === 'start');
  const angleStart = { x: savedEllipseArc.x + angleHandle.point.x, y: savedEllipseArc.y + angleHandle.point.y };
  const angleEnd = { x: savedEllipseArc.x + savedEllipseArc.width / 2, y: savedEllipseArc.y + savedEllipseArc.height };
  pointer(app, 'pointerdown', angleStart, 107);
  pointer(app, 'pointermove', angleEnd, 107);
  pointer(app, 'pointerup', angleEnd, 107);
  await waitFor(async () => Math.abs(((await loadDocumentById(design.id))?.pages?.[0]?.children?.find(node => node.id === ellipseArc.id)?.arcData?.startingAngle ?? 0) - Math.PI / 2) < 1e-6,
    'direct ellipse arc start-angle edit');

  savedEllipseArc = (await loadDocumentById(design.id)).pages[0].children.find(node => node.id === ellipseArc.id);
  const innerHandle = ellipseArcControlHandles(savedEllipseArc, zoom).find(handle => handle.kind === 'innerRadius');
  const innerStart = { x: savedEllipseArc.x + innerHandle.point.x, y: savedEllipseArc.y + innerHandle.point.y };
  const innerCenter = { x: savedEllipseArc.x + savedEllipseArc.width / 2, y: savedEllipseArc.y + savedEllipseArc.height / 2 };
  const innerEnd = {
    x: innerCenter.x + (innerStart.x - innerCenter.x) * 2.4,
    y: innerCenter.y + (innerStart.y - innerCenter.y) * 2.4
  };
  pointer(app, 'pointerdown', innerStart, 108);
  pointer(app, 'pointermove', innerEnd, 108);
  pointer(app, 'pointerup', innerEnd, 108);
  await waitFor(async () => Math.abs(((await loadDocumentById(design.id))?.pages?.[0]?.children?.find(node => node.id === ellipseArc.id)?.arcData?.innerRadius ?? 0) - .6) < .001,
    'direct ellipse inner-radius edit');

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
  await waitFor(() => app.querySelector('[data-action="toggle-image-crop-mode"]')?.textContent.includes('Finish crop'), 'crop mode');
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

  // Hand pans the view without applying a crop. Select returns to crop editing.
  const cropBeforeHandPan = cropAt(saved.pages[0].children.find(node => node.id === image.id));
  const beforeHandPan = app.querySelector('#scene-canvas').getContext('2d').getTransform();
  click(app, app.querySelector('.tool-button[data-tool="hand"]'));
  const handPanStart = worldScreenPoint(app, { x: image.x + fullSource.left + 30, y: image.y + 20 });
  const handPanEnd = { x: handPanStart.x + 42, y: handPanStart.y + 24 };
  pointerScreen(app, 'pointerdown', handPanStart, 98);
  pointerScreen(app, 'pointermove', handPanEnd, 98);
  pointerScreen(app, 'pointerup', handPanEnd, 98);
  await waitFor(() => {
    const transform = app.querySelector('#scene-canvas').getContext('2d').getTransform();
    return Math.abs(transform.e - beforeHandPan.e) > 1 || Math.abs(transform.f - beforeHandPan.f) > 1;
  }, 'Hand-tool panning during crop mode');
  saved = await loadDocumentById(design.id);
  const cropAfterHandPan = cropAt(saved.pages[0].children.find(node => node.id === image.id));
  assert(cropAfterHandPan.left === cropBeforeHandPan.left && cropAfterHandPan.right === cropBeforeHandPan.right,
    'Hand-tool panning must leave the active image crop unchanged.');
  click(app, app.querySelector('.tool-button[data-tool="select"]'));
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

  // An inspector action can reactivate crop while Comment remains selected.
  // The next canvas tap must still select the target component or nested frame.
  click(app, app.querySelector('.tool-button[data-tool="comment"]'));
  click(app, app.querySelector('[data-inspector-tab="design"]'));
  click(app, app.querySelector(`[data-layer-id="${image.id}"]`));
  const commentCropButton = await waitFor(() => app.querySelector('[data-action="toggle-image-crop-mode"]'), 'image crop control while Comment is active');
  click(app, commentCropButton);
  await waitFor(() => app.querySelector('[data-action="toggle-image-crop-mode"]')?.textContent.includes('Finish crop'), 'crop capture while Comment remains active');
  tap(app, {
    x: reviewComponent.x + reviewFrame.x + reviewArtwork.x + reviewArtwork.width / 2,
    y: reviewComponent.y + reviewFrame.y + reviewArtwork.y + reviewArtwork.height / 2
  }, 99);
  assert(app.querySelector(`[data-layer-id="${reviewComponent.id}"]`)?.classList.contains('is-selected'),
    'Comment must reclaim a canvas tap from crop mode and select the containing component.');
  assert(app.querySelector('.tool-button[data-tool="comment"]')?.classList.contains('is-selected'),
    'Selecting a component should leave Comment mode active.');
  tap(app, {
    x: reviewComponent.x + reviewFrame.x + 120,
    y: reviewComponent.y + reviewFrame.y + 70
  }, 100);
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'),
    'Comment mode should select the directly hit nested frame after releasing crop mode.');
  click(app, app.querySelector(`[data-layer-id="${image.id}"]`));
  assert(app.querySelector('[data-action="toggle-image-crop-mode"]')?.textContent.includes('Crop image'),
    'The intercepted crop mode must be fully reset after Comment selects a layer.');

  click(app, app.querySelector(`[data-layer-id="${text.id}"]`));
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

  result.textContent = `PASS\n${JSON.stringify({ movePointerCancel: true, canceledMoveCreatedNoUndo: true, canvasGestureCancelsBeforePanelAction: true, uncroppedSourceVisible: true, cropSelectionUndoGuard: true, cropModeOverridesHandTool: true, touchOffsetPreserved: true, cropPointerCancelAndUndoGuard: true, cropSelectionInPlace: true, cropUndoRedo: true, commentReclaimsCanvasFromCrop: true, commentSelectsComponentAndFrame: true, doubleClickTextEdit: true, starPointsRatioRadiusHandles: true, ellipseArcAngleAndRadiusHandles: true, originalImageAssetRetained: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  await deleteStoredDocument(design.id).catch(() => {});
  await deleteImageAsset(assetId).catch(() => {});
}
