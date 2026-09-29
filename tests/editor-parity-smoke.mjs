import { addNode, createDocument, createNode } from '../src/model.js';
import { deleteImageAsset, deleteStoredDocument, listSavedDocuments, loadDocumentById, saveDocument } from '../src/storage.js';
import { getTransformHandles, nodeLocalToPage, parentLocalToPageTransform, resizeOrientedRect, transformPoint } from '../src/transform-geometry.js';
import { vectorNetworkGeometryFromAnchors, vectorNetworkVertexPoint } from '../src/vector-path.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const runId = `editor-parity-${Date.now()}`;
const testDocumentIds = new Set();
const testAssetIds = new Set();

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { if (await test()) { resolve(); return; } } catch { /* The app or a local save may still be settling. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    poll();
  });
}
function click(app, element) {
  assert(element, 'Expected an editor control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function clickLibraryMenu(app) {
  click(app, app.querySelector('#main-menu-button'));
  const item = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  click(app, item);
}
function openDesignRow(app, id) {
  click(app, app.querySelector(`[data-design-action="open"][data-design-id="${CSS.escape(id)}"]`));
}
function readSaved(app, id) {
  return new Promise((resolve, reject) => {
    const request = app.defaultView.indexedDB.open('figma-local-documents', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('documents').objectStore('documents').get(id);
      get.onsuccess = () => { resolve(get.result?.document || null); db.close(); };
      get.onerror = () => { reject(get.error); db.close(); };
    };
  });
}
function findSavedNode(savedDocument, id) {
  const visit = nodes => {
    for (const node of nodes || []) {
      if (node.id === id) return node;
      const nested = visit(node.children);
      if (nested) return nested;
    }
    return null;
  };
  for (const page of savedDocument?.pages || []) {
    const found = visit(page.children);
    if (found) return found;
  }
  return null;
}
function dispatchCanvasPointer(app, canvas, type, point, pointerId = 83) {
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  const event = new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0,
    clientX: point.x, clientY: point.y
  });
  canvas.dispatchEvent(event);
  return event;
}
function screenPoint(app, worldPoint) {
  const canvas = app.querySelector('#scene-canvas');
  const rect = canvas.getBoundingClientRect();
  // Opening a saved design resets the viewport to 100% and centers the page origin.
  return { x: rect.left + canvas.clientWidth / 2 + worldPoint.x, y: rect.top + canvas.clientHeight / 2 + worldPoint.y };
}
function resolved(node) { return { ...node }; }
function fixtureBmp() {
  const width = 64; const height = 32; const pixels = width * height * 3;
  const bytes = new Uint8Array(54 + pixels); const view = new DataView(bytes.buffer);
  bytes[0] = 66; bytes[1] = 77; view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, width, true); view.setInt32(22, height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, pixels, true);
  for (let offset = 54; offset < bytes.length; offset += 3) { bytes[offset] = 80; bytes[offset + 1] = 140; bytes[offset + 2] = 220; }
  return bytes;
}

async function run(app) {
  result.textContent = 'RUNNING: waiting for editor startup';
  await waitFor(() => app.documentElement.dataset.appReady === 'true', 'editor startup', 45000);
  await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'initial local save');
  result.textContent = 'RUNNING: preparing local designs';
  const initialRows = await listSavedDocuments();
  const initialDocument = initialRows[0] ? await loadDocumentById(initialRows[0].id) : null;
  const initialDocumentIds = new Set(initialRows.map(item => item.id));
  let checks;
  let testError = null;
  const cleanupErrors = [];

  try {
    const original = createDocument();
    original.name = `${runId} original`;
    const parent = createNode('frame', { name: 'Rotated outer frame', x: 120, y: -90, width: 300, height: 220, rotation: 37, fill: '#ffffff' });
    const group = createNode('group', { name: 'Rotated group', x: 32, y: 24, width: 160, height: 110, rotation: -26 });
    const target = createNode('rectangle', { name: 'Transform target', x: 22, y: 18, width: 64, height: 42, rotation: 19, fill: '#a8c8ff' });
    const network = createNode('network', {
      name: 'Nested vector network',
      ...vectorNetworkGeometryFromAnchors([{ x: 100, y: 50 }, { x: 145, y: 55 }])
    });
    addNode(original, parent);
    addNode(original, group, { parentId: parent.id });
    addNode(original, target, { parentId: group.id });
    addNode(original, network, { parentId: group.id });
    await saveDocument(original);
    testDocumentIds.add(original.id);

    result.textContent = 'RUNNING: opening design library';
    clickLibraryMenu(app);
    await waitFor(() => app.querySelector('#design-library-dialog')?.open, 'design library dialog');
    await waitFor(() => app.querySelector(`[data-design-action="open"][data-design-id="${CSS.escape(original.id)}"]`), 'local design row');
    openDesignRow(app, original.id);
    await waitFor(() => !app.querySelector('#design-library-dialog')?.open && app.querySelector('#document-name')?.value === original.name, 'opening saved design');

    result.textContent = 'RUNNING: duplicate and rename';
    clickLibraryMenu(app);
    await waitFor(() => app.querySelector('#design-library-dialog')?.open, 'library reopen');
    await waitFor(() => app.querySelector(`[data-design-action="duplicate"][data-design-id="${CSS.escape(original.id)}"]`), 'original design duplicate action');
    click(app, app.querySelector(`[data-design-action="duplicate"][data-design-id="${CSS.escape(original.id)}"]`));
    await waitFor(() => [...app.querySelectorAll('.design-file-name')].some(item => item.textContent.includes(`${original.name} copy`)), 'duplicated local design');
    const duplicateRows = await listSavedDocuments();
    const duplicate = duplicateRows.find(item => item.name === `${original.name} copy`);
    assert(duplicate, 'duplicate action should create a separately named local document.');
    testDocumentIds.add(duplicate.id);
    app.defaultView.prompt = () => `${runId} renamed copy`;
    click(app, app.querySelector(`[data-design-action="rename"][data-design-id="${CSS.escape(duplicate.id)}"]`));
    await waitFor(() => [...app.querySelectorAll('.design-file-name')].some(item => item.textContent.includes(`${runId} renamed copy`)), 'renamed local design');
    click(app, app.querySelector(`[data-design-action="open"][data-design-id="${CSS.escape(duplicate.id)}"]`));
    await waitFor(() => !app.querySelector('#design-library-dialog')?.open && app.querySelector('#document-name')?.value === `${runId} renamed copy`, 'opening renamed duplicate');
    const reopened = await readSaved(app, duplicate.id);
    assert(reopened?.pages[0].children[0].children[0].children[0]?.name === target.name, 'duplicate should retain its independent editable layer tree.');

    const canvas = app.querySelector('#scene-canvas');
    const ancestors = [parent, group].map(resolved);
    const originalRect = resolved(target);
    result.textContent = 'RUNNING: transformed marquee selection';
    const originalCenter = nodeLocalToPage(originalRect, { x: originalRect.width / 2, y: originalRect.height / 2 }, ancestors);
    const marqueeStart = screenPoint(app, { x: 80, y: originalCenter.y - 15 });
    const marqueeEnd = screenPoint(app, { x: originalCenter.x, y: originalCenter.y - 15 });
    dispatchCanvasPointer(app, canvas, 'pointerdown', marqueeStart, 86);
    dispatchCanvasPointer(app, canvas, 'pointermove', marqueeEnd, 86);
    dispatchCanvasPointer(app, canvas, 'pointerup', marqueeEnd, 86);
    assert(app.querySelector(`[data-layer-id="${CSS.escape(target.id)}"]`)?.classList.contains('is-selected'),
      'a marquee crossing the rotated child’s visible bounds should select it.');

    click(app, app.querySelector(`[data-layer-id="${CSS.escape(target.id)}"]`));
    assert(app.querySelector('#selection-status')?.textContent === `${target.name} · ${target.type}`,
      'a direct layer-row selection should reduce the marquee result to the single resize target.');
    result.textContent = 'RUNNING: rotated resize';
    const initialHandles = getTransformHandles(originalRect, ancestors);
    const originalOpposite = nodeLocalToPage(originalRect, { x: 0, y: 0 }, ancestors);
    const start = screenPoint(app, initialHandles.resize.se);
    const finishWorld = { x: initialHandles.resize.se.x + 24, y: initialHandles.resize.se.y + 13 };
    const finish = screenPoint(app, finishWorld);
    const resizeDown = dispatchCanvasPointer(app, canvas, 'pointerdown', start, 84);
    try {
      dispatchCanvasPointer(app, canvas, 'pointermove', finish, 84);
    } finally {
      dispatchCanvasPointer(app, canvas, 'pointerup', finish, 84);
    }
    assert(resizeDown.defaultPrevented, 'pointer at the rotated southeast handle should begin a resize gesture.');
    await waitFor(async () => {
      const doc = await readSaved(app, duplicate.id);
      const changed = doc?.pages[0].children[0].children[0].children[0];
      return changed && (Math.abs(changed.width - target.width) > 1 || Math.abs(changed.height - target.height) > 1);
    }, 'oriented canvas resize persistence');
    const resizedDoc = await readSaved(app, duplicate.id);
    const resized = resizedDoc.pages[0].children[0].children[0].children[0];
    const expectedResize = resizeOrientedRect(originalRect, 'se', finishWorld, ancestors);
    assert(Math.abs(resized.width - expectedResize.width) < 1e-5 && Math.abs(resized.height - expectedResize.height) < 1e-5,
      'dragging the visible rotated corner should resize in the node’s local axes.');
    const fixedAfterResize = nodeLocalToPage({ ...originalRect, ...resized }, { x: 0, y: 0 }, ancestors);
    assert(Math.hypot(fixedAfterResize.x - originalOpposite.x, fixedAfterResize.y - originalOpposite.y) < 1e-5,
      'oriented resize should keep the opposite handle anchored in page space.');

    const rotationHandles = getTransformHandles({ ...originalRect, ...resized }, ancestors);
    const rotateStart = screenPoint(app, rotationHandles.rotate);
    const center = nodeLocalToPage({ ...originalRect, ...resized }, { x: resized.width / 2, y: resized.height / 2 }, ancestors);
    const startAngle = Math.atan2(rotationHandles.rotate.y - center.y, rotationHandles.rotate.x - center.x);
    const rotateFinishWorld = { x: center.x + 42 * Math.cos(startAngle + Math.PI / 9), y: center.y + 42 * Math.sin(startAngle + Math.PI / 9) };
    const rotateFinish = screenPoint(app, rotateFinishWorld);
    dispatchCanvasPointer(app, canvas, 'pointerdown', rotateStart, 85);
    dispatchCanvasPointer(app, canvas, 'pointermove', rotateFinish, 85);
    dispatchCanvasPointer(app, canvas, 'pointerup', rotateFinish, 85);
    await waitFor(async () => {
      const doc = await readSaved(app, duplicate.id);
      const changed = doc?.pages[0].children[0].children[0].children[0];
      return changed && Math.abs(changed.rotation - target.rotation) > 5;
    }, 'rotate-handle gesture persistence');
    const rotatedDoc = await readSaved(app, duplicate.id);
    const rotated = rotatedDoc.pages[0].children[0].children[0].children[0];
    assert(Math.abs(rotated.rotation - (target.rotation + 20)) < 1, `rotation handle should apply angular movement (got ${rotated.rotation}).`);

    result.textContent = 'RUNNING: Pen branch through rotated ancestors';
    click(app, app.querySelector(`[data-layer-id="${CSS.escape(network.id)}"]`));
    click(app, app.querySelector('[data-tool="pen"]'));
    const firstNetworkPoint = vectorNetworkVertexPoint(network, 'v1', { x: 0, y: 0 });
    const firstNetworkPage = nodeLocalToPage(network, firstNetworkPoint, ancestors);
    const branchParentPoint = { x: 140, y: 80 };
    const branchPagePoint = transformPoint(parentLocalToPageTransform(ancestors), branchParentPoint);
    const penStart = screenPoint(app, firstNetworkPage);
    dispatchCanvasPointer(app, canvas, 'pointerdown', penStart, 87);
    dispatchCanvasPointer(app, canvas, 'pointerup', penStart, 87);
    await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('Starting at a shared point'), 'Pen start on existing network anchor');
    const branchPoint = screenPoint(app, branchPagePoint);
    dispatchCanvasPointer(app, canvas, 'pointerdown', branchPoint, 88);
    dispatchCanvasPointer(app, canvas, 'pointerup', branchPoint, 88);
    app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('Vector path added to network'), 'Pen network branch completion');
    await waitFor(async () => findSavedNode(await readSaved(app, duplicate.id), network.id)?.vertices?.length === 3,
      'rotated network branch persistence');
    const branchedNetwork = findSavedNode(await readSaved(app, duplicate.id), network.id);
    const appendedVertex = branchedNetwork.vertices.find(vertex => vertex.id === 'v3');
    const appendedParentPoint = vectorNetworkVertexPoint(branchedNetwork, appendedVertex.id, { x: branchedNetwork.x, y: branchedNetwork.y });
    const appendedPagePoint = transformPoint(parentLocalToPageTransform(ancestors), appendedParentPoint);
    assert(Math.hypot(appendedPagePoint.x - branchPagePoint.x, appendedPagePoint.y - branchPagePoint.y) < 1e-5,
      'a Pen branch point should retain its page position through the rotated parent chain.');

    result.textContent = 'RUNNING: create vector path inside rotated group';
    click(app, app.querySelector(`[data-layer-id="${CSS.escape(target.id)}"]`));
    click(app, app.querySelector('[data-tool="pen"]'));
    const localStroke = [{ x: 55, y: 85 }, { x: 75, y: 92 }];
    const pageStroke = localStroke.map(point => transformPoint(parentLocalToPageTransform(ancestors), point));
    for (const [index, point] of pageStroke.entries()) {
      const screen = screenPoint(app, point);
      dispatchCanvasPointer(app, canvas, 'pointerdown', screen, 89 + index);
      dispatchCanvasPointer(app, canvas, 'pointerup', screen, 89 + index);
    }
    app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(async () => {
      const saved = await readSaved(app, duplicate.id);
      const groupNode = findSavedNode(saved, group.id);
      return groupNode?.children?.some(item => item.id !== network.id && item.type === 'network');
    }, 'new rotated-group vector path persistence');
    const savedAfterPath = await readSaved(app, duplicate.id);
    const groupAfterPath = findSavedNode(savedAfterPath, group.id);
    const addedPath = groupAfterPath.children.find(item => item.id !== network.id && item.type === 'network');
    const firstPathPoint = vectorNetworkVertexPoint(addedPath, addedPath.vertices[0].id, { x: addedPath.x, y: addedPath.y });
    const addedPathPagePoint = transformPoint(parentLocalToPageTransform(ancestors), firstPathPoint);
    assert(Math.hypot(addedPathPagePoint.x - pageStroke[0].x, addedPathPagePoint.y - pageStroke[0].y) < 1e-5,
      'a newly drawn vector path should preserve page positions of points inside the rotated group.');

    result.textContent = 'RUNNING: nested rotated shape, text, and image placement';
    const toPage = point => transformPoint(parentLocalToPageTransform(ancestors), point);
    const shapeStartLocal = { x: 106, y: 68 };
    const shapeEndLocal = { x: 132, y: 92 };
    const shapeStart = screenPoint(app, toPage(shapeStartLocal));
    const shapeEnd = screenPoint(app, toPage(shapeEndLocal));
    click(app, app.querySelector('[data-tool="rectangle"]'));
    dispatchCanvasPointer(app, canvas, 'pointerdown', shapeStart, 91);
    dispatchCanvasPointer(app, canvas, 'pointermove', shapeEnd, 91);
    dispatchCanvasPointer(app, canvas, 'pointerup', shapeEnd, 91);
    await waitFor(async () => {
      const saved = await readSaved(app, duplicate.id);
      return findSavedNode(saved, group.id)?.children?.some(item => item.type === 'rectangle' && item.id !== target.id);
    }, 'rectangle placement in the rotated nested group');
    const shape = findSavedNode(await readSaved(app, duplicate.id), group.id).children.find(item => item.type === 'rectangle' && item.id !== target.id);
    const shapeCenterPage = nodeLocalToPage(shape, { x: shape.width / 2, y: shape.height / 2 }, ancestors);
    const expectedShapeCenter = toPage({ x: (shapeStartLocal.x + shapeEndLocal.x) / 2, y: (shapeStartLocal.y + shapeEndLocal.y) / 2 });
    assert(Math.hypot(shapeCenterPage.x - expectedShapeCenter.x, shapeCenterPage.y - expectedShapeCenter.y) < 1e-5,
      'a shape created inside rotated ancestors should keep its intended page-space center.');

    const textLocal = { x: 116, y: 36 };
    const textPage = toPage(textLocal);
    click(app, app.querySelector('[data-tool="text"]'));
    const textScreen = screenPoint(app, textPage);
    dispatchCanvasPointer(app, canvas, 'pointerdown', textScreen, 92);
    dispatchCanvasPointer(app, canvas, 'pointerup', textScreen, 92);
    app.querySelector('#text-editor-overlay').dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(async () => findSavedNode(await readSaved(app, duplicate.id), group.id)?.children?.some(item => item.type === 'text'),
      'text placement in the rotated nested group');
    const textNode = findSavedNode(await readSaved(app, duplicate.id), group.id).children.find(item => item.type === 'text');
    const textOriginPage = nodeLocalToPage(textNode, { x: 0, y: 0 }, ancestors);
    assert(Math.hypot(textOriginPage.x - textPage.x, textOriginPage.y - textPage.y) < 1e-5,
      'text created inside rotated ancestors should keep its clicked page-space origin.');

    const imagePage = toPage({ x: 116, y: 22 });
    const imageScreen = screenPoint(app, imagePage);
    const imageFile = new app.defaultView.File([fixtureBmp()], `${runId}-nested.bmp`, { type: 'image/bmp' });
    const imageTransfer = new app.defaultView.DataTransfer();
    imageTransfer.items.add(imageFile);
    app.querySelector('#canvas-scroll').dispatchEvent(new app.defaultView.DragEvent('drop', {
      bubbles: true, cancelable: true, clientX: imageScreen.x, clientY: imageScreen.y, dataTransfer: imageTransfer
    }));
    await waitFor(async () => findSavedNode(await readSaved(app, duplicate.id), group.id)?.children?.some(item => item.type === 'image'),
      'image placement in the rotated nested group');
    const imageNode = findSavedNode(await readSaved(app, duplicate.id), group.id).children.find(item => item.type === 'image');
    testAssetIds.add(imageNode.assetId);
    const imageCenterPage = nodeLocalToPage(imageNode, { x: imageNode.width / 2, y: imageNode.height / 2 }, ancestors);
    assert(Math.hypot(imageCenterPage.x - imagePage.x, imageCenterPage.y - imagePage.y) <= 2,
      'an image dropped inside rotated ancestors should keep its drop-point center within the browser’s rounded drag-event coordinates.');

    result.textContent = 'RUNNING: active design deletion';
    clickLibraryMenu(app);
    await waitFor(() => app.querySelector('#design-library-dialog')?.open, 'active design delete dialog');
    await waitFor(() => app.querySelector('.design-file-row.is-current [data-design-action="delete"]'), 'active design delete action');
    app.defaultView.confirm = () => true;
    const beforeDeleteIds = new Set((await listSavedDocuments()).map(item => item.id));
    const pendingFile = new app.defaultView.File([new Uint8Array([1, 2, 3])], 'pending-import.png', { type: 'image/png' });
    let rejectPendingRead;
    Object.defineProperty(pendingFile, 'arrayBuffer', {
      configurable: true,
      value: () => new Promise((_, reject) => { rejectPendingRead = reject; })
    });
    const transfer = new app.defaultView.DataTransfer();
    transfer.items.add(pendingFile);
    const imageInput = app.querySelector('#image-input');
    Object.defineProperty(imageInput, 'files', { configurable: true, value: transfer.files });
    imageInput.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
    await waitFor(() => typeof rejectPendingRead === 'function', 'held image import before active deletion');
    const activeDeleteButton = app.querySelector('.design-file-row.is-current [data-design-action="delete"]');
    click(app, activeDeleteButton);
    await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('Wait for the current image import'), 'active deletion blocked by pending image import');
    assert(await loadDocumentById(duplicate.id), 'a refused active-design switch must leave the current design stored.');
    assert(app.querySelector(`[data-design-action="delete"][data-design-id="${CSS.escape(duplicate.id)}"]`), 'the active design should remain in the local library after a refused delete.');
    rejectPendingRead(new Error('Injected pending image read failure'));
    await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('pending-import.png: Injected pending image read failure'), 'held image import release');
    click(app, app.querySelector(`[data-design-action="delete"][data-design-id="${CSS.escape(duplicate.id)}"]`));
    await waitFor(() => app.querySelector('#document-name')?.value === 'Untitled', 'active design deletion and safe document switch');
    await waitFor(async () => !(await listSavedDocuments()).some(item => item.id === duplicate.id), 'deleted document removal');
    assert(!app.querySelector('#design-library-list')?.textContent.includes(`${runId} renamed copy`), 'deleted active file should disappear from the library.');
    await waitFor(async () => (await listSavedDocuments()).some(item => !beforeDeleteIds.has(item.id)), 'replacement design save');
    for (const item of await listSavedDocuments()) if (!beforeDeleteIds.has(item.id)) testDocumentIds.add(item.id);

    checks = { library: ['open', 'duplicate', 'rename', 'delete-active'], canvas: ['nested rotated resize', 'opposite handle fixed', 'rotate gesture', 'transformed marquee', 'rotated Pen branch', 'rotated group Pen path', 'shape/text/image nested rotated placement'] };
  } catch (error) {
    testError = error;
  } finally {
    let restored = false;
    if (initialDocument) {
      try {
        if (!(await loadDocumentById(initialDocument.id))) throw new Error('The original active design is no longer available for restoration.');
        const activeId = app.querySelector('.design-file-row.is-current [data-design-action="delete"]')?.dataset.designId;
        if (activeId !== initialDocument.id) await persistLibrarySwitch(app, initialDocument.id);
        await waitFor(() => app.querySelector('#document-name')?.value === initialDocument.name, 'original active design restored');
        restored = true;
      } catch (error) {
        cleanupErrors.push(`Could not restore the original active design: ${error.message || error}`);
      }
    } else {
      cleanupErrors.push('Could not identify the original active design to restore.');
    }

    // Only remove newly-created records after switching the editor away from
    // them. The initial ID snapshot catches test records even if an assertion
    // failed before the normal path could add their IDs to testDocumentIds.
    if (restored) {
      try {
        const currentRows = await listSavedDocuments();
        const cleanupIds = new Set([
          ...testDocumentIds,
          ...currentRows.filter(item => !initialDocumentIds.has(item.id)).map(item => item.id)
        ]);
        for (const id of cleanupIds) {
          if (!initialDocumentIds.has(id) && id !== initialDocument.id) await deleteStoredDocument(id);
        }
        for (const assetId of testAssetIds) await deleteImageAsset(assetId);
        const leftovers = (await listSavedDocuments()).filter(item => !initialDocumentIds.has(item.id));
        if (leftovers.length) throw new Error(`Unremoved test design records: ${leftovers.map(item => item.id).join(', ')}`);
      } catch (error) {
        cleanupErrors.push(`Could not remove all test designs: ${error.message || error}`);
      }
    }
  }

  if (testError) {
    if (cleanupErrors.length) testError.stack = `${testError.stack || testError}\nSmoke cleanup also failed: ${cleanupErrors.join('; ')}`;
    throw testError;
  }
  if (cleanupErrors.length) throw new Error(`Smoke cleanup failed: ${cleanupErrors.join('; ')}`);
  return checks;
}

async function persistLibrarySwitch(app, id) {
  if (app.querySelector('#design-library-dialog')?.open) app.querySelector('#design-library-dialog').close();
  clickLibraryMenu(app);
  await waitFor(() => app.querySelector('#design-library-dialog')?.open, 'restore prior local design');
  await waitFor(() => app.querySelector(`[data-design-action="open"][data-design-id="${CSS.escape(id)}"]`), 'prior local design row');
  openDesignRow(app, id);
  await waitFor(() => !app.querySelector('#design-library-dialog')?.open, 'prior local design restored');
}

async function start() {
  try {
    result.textContent = 'RUNNING: module loaded';
    await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'embedded editor startup', 45000);
    const checks = await run(frame.contentDocument);
    result.textContent = `PASS\n${JSON.stringify(checks)}`;
  } catch (error) {
    result.textContent = `FAIL\n${error.stack || error}`;
  }
}

void start();
