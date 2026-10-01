import { addNode, createDocument, createNode } from '../src/model.js';
import { deleteImageAsset, deleteStoredDocument, listSavedDocuments, loadDocumentById, loadImageAsset, saveDocument } from '../src/storage.js';
import { getTransformHandles, nodeLocalToPage, parentLocalToPageTransform, resizeOrientedRect, transformPoint } from '../src/transform-geometry.js';
import { resizeSelection, rotateSelection, selectionBounds } from '../src/group-transform.js';
import { hitTestPage, selectionGroupHandles } from '../src/renderer.js';
import { vectorNetworkGeometryFromAnchors, vectorNetworkVertexPoint } from '../src/vector-path.js';
import { applyAutoLayout } from '../src/layout-engine.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const runId = `editor-parity-${Date.now()}`;
const testDocumentIds = new Set();
const testAssetIds = new Set();

function assert(value, message) { if (!value) throw new Error(message); }
function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${String(expected)}, received ${String(actual)}).`);
}
function assertDeepEqual(actual, expected, message) {
  const stable = value => value instanceof Set ? [...value].sort() : value;
  assert(JSON.stringify(stable(actual)) === JSON.stringify(stable(expected)), message);
}
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
    const request = app.defaultView.indexedDB.open('figma-local-documents');
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
function findSavedNodeByProperty(savedDocument, key, value) {
  const visit = nodes => {
    for (const node of nodes || []) {
      if (node[key] === value) return node;
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
function collectPageNodeIds(page) {
  const ids = new Set();
  const visit = nodes => { for (const node of nodes || []) { ids.add(node.id); visit(node.children); } };
  visit(page?.children);
  return ids;
}
function pageAction(app, pageId, actionName) {
  const row = app.querySelector(`#pages-list [data-page-id="${CSS.escape(pageId)}"]`);
  assert(row, `Expected page ${pageId} in the page list.`);
  const menu = row.querySelector('.page-row-menu');
  if (!menu.open) click(app, menu.querySelector('summary'));
  click(app, row.querySelector(`[data-page-action="${actionName}"]`));
}
function dispatchCanvasPointer(app, canvas, type, point, pointerId = 83, modifiers = {}) {
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  const event = new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0,
    clientX: point.x, clientY: point.y, ...modifiers
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
    const verticalLineA = createNode('line', { name: 'Degenerate vertical A', x: 260, y: -30, width: 0, height: 30 });
    const verticalLineB = createNode('line', { name: 'Degenerate vertical B', x: 260, y: 30, width: 0, height: 30 });
    const flow = createNode('frame', {
      name: 'Alt-drag auto layout', x: 350, y: 170, width: 180, height: 76,
      autoLayout: { axis: 'horizontal', columnGap: 8, padding: 8 }
    });
    const flowItem = createNode('rectangle', { name: 'Auto layout item', width: 36, height: 30, fill: '#b8dcff' });
    addNode(original, parent);
    addNode(original, verticalLineA);
    addNode(original, verticalLineB);
    addNode(original, flow);
    addNode(original, flowItem, { parentId: flow.id });
    addNode(original, group, { parentId: parent.id });
    addNode(original, target, { parentId: group.id });
    addNode(original, network, { parentId: group.id });
    applyAutoLayout(flow);
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
    // Start outside the rotated parent and group so the select tool begins a
    // marquee instead of correctly treating a drag on either container as a
    // move. Keep the horizontal crossing through the child's visible bounds.
    const marqueeStart = screenPoint(app, { x: originalCenter.x + 268, y: originalCenter.y - 15 });
    const marqueeEnd = screenPoint(app, { x: originalCenter.x - 124, y: originalCenter.y - 15 });
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
    try {
      await waitFor(async () => {
        const doc = await readSaved(app, duplicate.id);
        const changed = findSavedNode(doc, target.id);
        return changed && (Math.abs(changed.width - target.width) > 1 || Math.abs(changed.height - target.height) > 1);
      }, 'oriented canvas resize persistence');
    } catch (error) {
      const saved = findSavedNode(await readSaved(app, duplicate.id), target.id);
      throw new Error(`${error.message} (saved=${JSON.stringify(saved && { x: saved.x, y: saved.y, width: saved.width, height: saved.height, rotation: saved.rotation })}, live-status=${app.querySelector('#position-status')?.textContent}, down-default=${resizeDown.defaultPrevented})`);
    }
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

    result.textContent = 'RUNNING: multi-layer resize and rotate';
    const beforeGroupTransform = await readSaved(app, duplicate.id);
    const groupTarget = findSavedNode(beforeGroupTransform, target.id);
    const groupNetwork = findSavedNode(beforeGroupTransform, network.id);
    const transformAncestors = [parent.id, group.id].map(id => findSavedNode(beforeGroupTransform, id));
    const groupEntries = [groupTarget, groupNetwork].map(node => ({ node, ancestors: transformAncestors }));
    const groupBounds = selectionBounds(groupEntries);
    click(app, app.querySelector(`[data-layer-id="${CSS.escape(target.id)}"]`));
    app.querySelector(`[data-layer-id="${CSS.escape(network.id)}"]`).dispatchEvent(new app.defaultView.MouseEvent('click', {
      bubbles: true, cancelable: true, button: 0, ctrlKey: true
    }));
    assert(app.querySelector('#selection-status')?.textContent === '2 layers selected',
      'the two sibling layers should be selected together before group transform.');
    const groupCanvas = app.querySelector('#scene-canvas');
    const groupResizeHandles = selectionGroupHandles(groupBounds);
    const groupResizeStart = screenPoint(app, groupResizeHandles.resize.se);
    const groupResizeFinishWorld = { x: groupResizeHandles.resize.se.x + 30, y: groupResizeHandles.resize.se.y + 17 };
    const groupResizeFinish = screenPoint(app, groupResizeFinishWorld);
    const groupResizeDown = dispatchCanvasPointer(app, groupCanvas, 'pointerdown', groupResizeStart, 96);
    dispatchCanvasPointer(app, groupCanvas, 'pointermove', groupResizeFinish, 96);
    dispatchCanvasPointer(app, groupCanvas, 'pointerup', groupResizeFinish, 96);
    assert(groupResizeDown.defaultPrevented, 'the shared southeast handle should start a multi-layer resize.');
    const expectedGroupResize = new Map(resizeSelection(groupEntries, groupBounds, 'se', groupResizeFinishWorld).map(patch => [patch.id, patch]));
    await waitFor(async () => {
      const saved = await readSaved(app, duplicate.id);
      const savedTarget = findSavedNode(saved, target.id);
      const savedNetwork = findSavedNode(saved, network.id);
      return savedTarget && savedNetwork
        && (Math.abs(savedTarget.width - groupTarget.width) > 1 || Math.abs(savedNetwork.width - groupNetwork.width) > 1);
    }, 'multi-layer resize persistence');
    const afterGroupResize = await readSaved(app, duplicate.id);
    for (const id of [target.id, network.id]) {
      const actual = findSavedNode(afterGroupResize, id);
      const expected = expectedGroupResize.get(id);
      assert(Math.abs(actual.x - expected.x) < 1e-4 && Math.abs(actual.y - expected.y) < 1e-4
        && Math.abs(actual.width - expected.width) < 1e-4 && Math.abs(actual.height - expected.height) < 1e-4,
      `group resize should apply the shared page-space scale to ${id} through rotated ancestors.`);
    }

    const resizedEntries = [target.id, network.id].map(id => ({ node: findSavedNode(afterGroupResize, id), ancestors: transformAncestors }));
    const resizedBounds = selectionBounds(resizedEntries);
    const rotateHandles = selectionGroupHandles(resizedBounds);
    const rotateStartWorld = rotateHandles.rotate;
    const rotateCenter = resizedBounds.center;
    const groupStartAngle = Math.atan2(rotateStartWorld.y - rotateCenter.y, rotateStartWorld.x - rotateCenter.x);
    const groupFinishWorld = {
      x: rotateCenter.x + 46 * Math.cos(groupStartAngle + Math.PI / 9),
      y: rotateCenter.y + 46 * Math.sin(groupStartAngle + Math.PI / 9)
    };
    const groupRotateStart = screenPoint(app, rotateStartWorld);
    const groupRotateFinish = screenPoint(app, groupFinishWorld);
    const groupRotateDown = dispatchCanvasPointer(app, groupCanvas, 'pointerdown', groupRotateStart, 97);
    dispatchCanvasPointer(app, groupCanvas, 'pointermove', groupRotateFinish, 97);
    dispatchCanvasPointer(app, groupCanvas, 'pointerup', groupRotateFinish, 97);
    assert(groupRotateDown.defaultPrevented, 'the shared rotation handle should start a multi-layer rotation.');
    const expectedGroupRotate = new Map(rotateSelection(resizedEntries, rotateCenter, 20).map(patch => [patch.id, patch]));
    await waitFor(async () => {
      const saved = await readSaved(app, duplicate.id);
      return Math.abs(findSavedNode(saved, target.id)?.rotation - findSavedNode(afterGroupResize, target.id)?.rotation) > 5;
    }, 'multi-layer rotation persistence');
    const afterGroupRotate = await readSaved(app, duplicate.id);
    for (const id of [target.id, network.id]) {
      const actual = findSavedNode(afterGroupRotate, id);
      const expected = expectedGroupRotate.get(id);
      assert(Math.abs(actual.x - expected.x) < 1e-4 && Math.abs(actual.y - expected.y) < 1e-4
        && Math.abs(actual.rotation - expected.rotation) < 1e-4,
      `group rotation should preserve both layers' page-space positions through rotated ancestors (${id}).`);
    }

    result.textContent = 'RUNNING: Shift-resize vertical degenerate selection';
    const beforeVerticalResize = await readSaved(app, duplicate.id);
    const verticalEntries = [verticalLineA.id, verticalLineB.id].map(id => ({
      node: findSavedNode(beforeVerticalResize, id), ancestors: []
    }));
    assert(verticalEntries.every(({ node }) => node?.width === 0),
      'the vertical test layers should both have zero width before the group resize.');
    const verticalBounds = selectionBounds(verticalEntries);
    assert(verticalBounds.width === 0 && verticalBounds.height > 0,
      'the two vertical test layers should form a selection with zero total width.');
    click(app, app.querySelector(`[data-layer-id="${CSS.escape(verticalLineA.id)}"]`));
    app.querySelector(`[data-layer-id="${CSS.escape(verticalLineB.id)}"]`).dispatchEvent(new app.defaultView.MouseEvent('click', {
      bubbles: true, cancelable: true, button: 0, ctrlKey: true
    }));
    assert(app.querySelector('#selection-status')?.textContent === '2 layers selected',
      'the two vertical layers should be selected together before Shift-resizing.');
    const verticalResizeHandle = selectionGroupHandles(verticalBounds).resize.n;
    assert(verticalResizeHandle, 'a zero-width selection should retain its north resize handle.');
    const verticalResizeStart = screenPoint(app, verticalResizeHandle);
    const verticalResizeFinishWorld = { x: verticalResizeHandle.x, y: verticalResizeHandle.y - 12 };
    const verticalResizeFinish = screenPoint(app, verticalResizeFinishWorld);
    const resizeErrors = [];
    const onResizeError = event => resizeErrors.push(event.error?.message || event.message || 'unknown window error');
    app.defaultView.addEventListener('error', onResizeError);
    let verticalResizeDown;
    try {
      verticalResizeDown = dispatchCanvasPointer(app, groupCanvas, 'pointerdown', verticalResizeStart, 98);
      dispatchCanvasPointer(app, groupCanvas, 'pointermove', verticalResizeFinish, 98, { shiftKey: true });
      dispatchCanvasPointer(app, groupCanvas, 'pointerup', verticalResizeFinish, 98, { shiftKey: true });
    } finally {
      app.defaultView.removeEventListener('error', onResizeError);
    }
    assert(verticalResizeDown?.defaultPrevented, 'the north handle should begin a group resize for vertical layers.');
    assert(resizeErrors.length === 0, `Shift-resizing zero-width layers should not throw (${resizeErrors.join('; ')}).`);
    await waitFor(async () => {
      const saved = await readSaved(app, duplicate.id);
      const changed = [verticalLineA.id, verticalLineB.id].map(id => findSavedNode(saved, id));
      return changed.every((node, index) => node && Math.abs(node.height - verticalEntries[index].node.height) > 1);
    }, 'vertical degenerate group resize persistence');
    const afterVerticalResize = await readSaved(app, duplicate.id);
    for (const id of [verticalLineA.id, verticalLineB.id]) {
      const actual = findSavedNode(afterVerticalResize, id);
      assert(Number.isFinite(actual.x) && Number.isFinite(actual.y) && actual.width === 0
        && Number.isFinite(actual.height) && actual.height > 0,
      `Shift-resize should keep vertical line geometry finite and valid (${id}).`);
    }

    result.textContent = 'RUNNING: Pen branch through rotated ancestors';
    click(app, app.querySelector(`[data-layer-id="${CSS.escape(network.id)}"]`));
    click(app, app.querySelector('[data-tool="pen"]'));
    const networkAfterGroupTransform = findSavedNode(await readSaved(app, duplicate.id), network.id);
    const firstNetworkPoint = vectorNetworkVertexPoint(networkAfterGroupTransform, 'v1', { x: 0, y: 0 });
    const firstNetworkPage = nodeLocalToPage(networkAfterGroupTransform, firstNetworkPoint, ancestors);
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
    const appendedLocalPoint = vectorNetworkVertexPoint(branchedNetwork, appendedVertex.id, { x: 0, y: 0 });
    const appendedPagePoint = nodeLocalToPage(branchedNetwork, appendedLocalPoint, ancestors);
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

    const pastedFileName = `${runId}-clipboard.bmp`;
    const pastedFile = new app.defaultView.File([fixtureBmp()], pastedFileName, { type: 'image/bmp' });
    const pasteTransfer = new app.defaultView.DataTransfer();
    pasteTransfer.items.add(pastedFile);
    const pasteEvent = new app.defaultView.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', { configurable: true, value: pasteTransfer });
    app.dispatchEvent(pasteEvent);
    assert(pasteEvent.defaultPrevented, 'pasting a clipboard image should be handled by the local editor');
    await waitFor(async () => findSavedNodeByProperty(await readSaved(app, duplicate.id), 'fileName', pastedFileName),
      'clipboard image placement and local document save');
    const pastedImageNode = findSavedNodeByProperty(await readSaved(app, duplicate.id), 'fileName', pastedFileName);
    testAssetIds.add(pastedImageNode.assetId);
    const pastedAsset = await loadImageAsset(pastedImageNode.assetId);
    assert(pastedAsset?.name === pastedFileName && pastedAsset?.type === 'image/bmp'
      && pastedAsset?.bytes?.byteLength === fixtureBmp().byteLength,
    'clipboard image bytes should be retained in local image storage with their source metadata.');

    result.textContent = 'RUNNING: Alt-drag duplicate, cancel, undo, and redo';
    click(app, app.querySelector('[data-tool="select"]'));
    assert(app.querySelector('[data-tool="select"]')?.classList.contains('is-selected'),
      'Alt-click and Alt-drag duplicate checks must run with the Select tool active.');
    const beforeAltDrag = await readSaved(app, duplicate.id);
    const sourceBeforeAltDrag = findSavedNode(beforeAltDrag, target.id);
    const sourceParents = [parent.id, group.id].map(id => findSavedNode(beforeAltDrag, id));
    const sourceCenter = nodeLocalToPage(sourceBeforeAltDrag, {
      x: sourceBeforeAltDrag.width / 2, y: sourceBeforeAltDrag.height / 2
    }, sourceParents);
    const activePageBeforeAltDrag = beforeAltDrag.pages.find(page => page.id === beforeAltDrag.activePageId);
    const targetDragCandidates = [0.25, 0.5, 0.75].flatMap(x => [0.25, 0.5, 0.75].map(y => {
      const local = { x: sourceBeforeAltDrag.width * x, y: sourceBeforeAltDrag.height * y };
      const page = nodeLocalToPage(sourceBeforeAltDrag, local, sourceParents);
      return { local, page, hit: hitTestPage(activePageBeforeAltDrag, page, null, beforeAltDrag) };
    }));
    const targetDragStart = targetDragCandidates.find(candidate => candidate.hit?.id === target.id);
    assert(targetDragStart,
      `No interior point uniquely hit the Alt-drag target; candidates=${JSON.stringify(targetDragCandidates.map(({ local, page, hit }) => ({ local, page, hitId: hit?.id || null })))}`);
    const sourceDragScreen = screenPoint(app, targetDragStart.page);
    const initialLayerIds = [...app.querySelectorAll('#layers-list [data-layer-id]')].map(row => row.dataset.layerId);
    const initialPageIds = collectPageNodeIds(beforeAltDrag.pages.find(page => page.id === beforeAltDrag.activePageId));

    dispatchCanvasPointer(app, canvas, 'pointerdown', sourceDragScreen, 111, { altKey: true });
    dispatchCanvasPointer(app, canvas, 'pointerup', sourceDragScreen, 111, { altKey: true });
    assertDeepEqual([...app.querySelectorAll('#layers-list [data-layer-id]')].map(row => row.dataset.layerId), initialLayerIds,
      'Alt-click without a drag should not create a duplicate layer.');
    assertDeepEqual(collectPageNodeIds((await readSaved(app, duplicate.id)).pages.find(page => page.id === beforeAltDrag.activePageId)), initialPageIds,
      'Alt-click without a drag should leave the saved layer tree unchanged.');

    const cancelEnd = screenPoint(app, { x: targetDragStart.page.x + 30, y: targetDragStart.page.y - 18 });
    let altDragPointerDownDispatched = false;
    try {
      altDragPointerDownDispatched = true;
      dispatchCanvasPointer(app, canvas, 'pointerdown', sourceDragScreen, 112, { altKey: true });
      const selectedTargetAfterDown = app.querySelector(`[data-layer-id="${CSS.escape(target.id)}"]`);
      const altDragDiagnostics = () => ({
        selectedLayerIds: [...app.querySelectorAll('#layers-list .layer-row.is-selected[data-layer-id]')]
          .map(row => row.dataset.layerId),
        activeLayerIds: [...app.querySelectorAll('#layers-list [data-layer-id]')].map(row => row.dataset.layerId),
        position: app.querySelector('#position-status')?.textContent,
        toast: app.querySelector('#toast-region')?.textContent?.trim(),
        start: targetDragStart
          ? { local: targetDragStart.local, page: targetDragStart.page, hitId: targetDragStart.hit?.id }
          : null
      });
      assert(selectedTargetAfterDown?.classList.contains('is-selected'),
        `Alt-drag pointerdown should preserve selection of its expected target; diagnostics=${JSON.stringify(altDragDiagnostics())}`);

      dispatchCanvasPointer(app, canvas, 'pointermove', cancelEnd, 112, { altKey: true });
      const transientLayerIds = [...app.querySelectorAll('#layers-list [data-layer-id]')].map(row => row.dataset.layerId);
      assert(transientLayerIds.length > initialLayerIds.length,
        `Alt-drag should create its duplicate once the pointer crosses the drag threshold; diagnostics=${JSON.stringify(altDragDiagnostics())}`);
    } finally {
      if (altDragPointerDownDispatched) {
        try { dispatchCanvasPointer(app, canvas, 'pointercancel', cancelEnd, 112, { altKey: true }); }
        catch (error) { cleanupErrors.push(`Could not cancel the Alt-drag pointer: ${error.message || error}`); }
      }
    }
    await waitFor(() => app.querySelector('#save-state')?.textContent.includes('Saved locally'), 'cancelled Alt-drag rollback save');
    const afterAltCancel = await readSaved(app, duplicate.id);
    assertDeepEqual(collectPageNodeIds(afterAltCancel.pages.find(page => page.id === beforeAltDrag.activePageId)), initialPageIds,
      'cancelling an Alt-drag should remove the transient duplicate and preserve its source.');
    assert(app.querySelector(`[data-layer-id="${CSS.escape(target.id)}"]`)?.classList.contains('is-selected'),
      'cancelling an Alt-drag should restore selection to the source layer.');

    const dragDelta = { x: 34, y: -22 };
    const dragEnd = screenPoint(app, { x: targetDragStart.page.x + dragDelta.x, y: targetDragStart.page.y + dragDelta.y });
    dispatchCanvasPointer(app, canvas, 'pointerdown', sourceDragScreen, 113, { altKey: true });
    dispatchCanvasPointer(app, canvas, 'pointermove', dragEnd, 113, { altKey: true });
    dispatchCanvasPointer(app, canvas, 'pointerup', dragEnd, 113, { altKey: true });
    await waitFor(async () => {
      const saved = await readSaved(app, duplicate.id);
      const ids = collectPageNodeIds(saved?.pages.find(page => page.id === beforeAltDrag.activePageId));
      return [...ids].some(id => !initialPageIds.has(id));
    }, 'Alt-drag duplicate persistence');
    const afterAltDrag = await readSaved(app, duplicate.id);
    const afterDragIds = collectPageNodeIds(afterAltDrag.pages.find(page => page.id === beforeAltDrag.activePageId));
    const newDragIds = [...afterDragIds].filter(id => !initialPageIds.has(id));
    assertEqual(newDragIds.length, 1, 'Alt-drag should create one layer with a fresh ID for the selected source.');
    const duplicatedTarget = findSavedNode(afterAltDrag, newDragIds[0]);
    assert(duplicatedTarget && duplicatedTarget.id !== sourceBeforeAltDrag.id,
      'the dragged copy should have a new layer identity.');
    const duplicatedCenter = nodeLocalToPage(duplicatedTarget, {
      x: duplicatedTarget.width / 2, y: duplicatedTarget.height / 2
    }, sourceParents);
    assert(Math.hypot(duplicatedCenter.x - sourceCenter.x - dragDelta.x, duplicatedCenter.y - sourceCenter.y - dragDelta.y) < 1e-4,
      'the duplicate should follow the pointer by the exact page-space drag offset through rotated parents.');

    app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true, ctrlKey: true }));
    await waitFor(async () => {
      const saved = await readSaved(app, duplicate.id);
      return !collectPageNodeIds(saved?.pages.find(page => page.id === beforeAltDrag.activePageId)).has(newDragIds[0]);
    }, 'single-step Alt-drag undo');
    const afterAltUndo = await readSaved(app, duplicate.id);
    assertDeepEqual(collectPageNodeIds(afterAltUndo.pages.find(page => page.id === beforeAltDrag.activePageId)), initialPageIds,
      'one undo should remove both the duplicate and its drag movement.');
    app.body.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true, ctrlKey: true, shiftKey: true }));
    await waitFor(async () => {
      const saved = await readSaved(app, duplicate.id);
      return Boolean(findSavedNode(saved, newDragIds[0]));
    }, 'single-step Alt-drag redo');
    const afterAltRedo = await readSaved(app, duplicate.id);
    const redoneTarget = findSavedNode(afterAltRedo, newDragIds[0]);
    assert(redoneTarget, 'one redo should restore the duplicate.');
    const redoneCenter = nodeLocalToPage(redoneTarget, { x: redoneTarget.width / 2, y: redoneTarget.height / 2 }, sourceParents);
    assert(Math.hypot(redoneCenter.x - sourceCenter.x - dragDelta.x, redoneCenter.y - sourceCenter.y - dragDelta.y) < 1e-4,
      'redo should restore the duplicate at its completed drag position.');

    const beforeFlowAltDrag = await readSaved(app, duplicate.id);
    const flowBeforeAltDrag = findSavedNode(beforeFlowAltDrag, flow.id);
    const flowItemBeforeAltDrag = findSavedNode(beforeFlowAltDrag, flowItem.id);
    const flowCenter = nodeLocalToPage(flowItemBeforeAltDrag, {
      x: flowItemBeforeAltDrag.width / 2, y: flowItemBeforeAltDrag.height / 2
    }, [flowBeforeAltDrag]);
    const flowStart = screenPoint(app, flowCenter);
    const flowEnd = screenPoint(app, { x: flowCenter.x + 52, y: flowCenter.y });
    const beforeFlowIds = collectPageNodeIds(beforeFlowAltDrag.pages.find(page => page.id === beforeFlowAltDrag.activePageId));
    dispatchCanvasPointer(app, canvas, 'pointerdown', flowStart, 114, { altKey: true });
    dispatchCanvasPointer(app, canvas, 'pointermove', flowEnd, 114, { altKey: true });
    dispatchCanvasPointer(app, canvas, 'pointerup', flowEnd, 114, { altKey: true });
    await waitFor(async () => {
      const saved = await readSaved(app, duplicate.id);
      return collectPageNodeIds(saved?.pages.find(page => page.id === beforeAltDrag.activePageId)).size > beforeFlowIds.size;
    }, 'Alt-drag duplication in auto layout');
    const afterFlowAltDrag = await readSaved(app, duplicate.id);
    const afterFlowIds = collectPageNodeIds(afterFlowAltDrag.pages.find(page => page.id === beforeAltDrag.activePageId));
    const flowCopyIds = [...afterFlowIds].filter(id => !beforeFlowIds.has(id));
    const flowAfterAltDrag = findSavedNode(afterFlowAltDrag, flow.id);
    assertEqual(flowCopyIds.length, 1, 'Alt-drag should create one fresh copy of an auto-layout child.');
    assertEqual(flowAfterAltDrag.children.length, 2, 'the auto-layout parent should contain both the source and duplicate.');
    assertEqual(flowAfterAltDrag.children[0].id, flowItem.id, 'the source should remain in place before its dragged copy.');
    assertEqual(flowAfterAltDrag.children[1].id, flowCopyIds[0], 'the duplicate should reorder to the pointer-selected position.');
    assert(flowAfterAltDrag.children[1].x > flowAfterAltDrag.children[0].x,
      'auto layout should recompute the duplicate position after the in-place reorder.');

    result.textContent = 'RUNNING: page lifecycle controls';
    app.defaultView.prompt = () => `${runId} Home`;
    const firstPageId = (await readSaved(app, duplicate.id)).pages[0].id;
    pageAction(app, firstPageId, 'rename');
    await waitFor(async () => (await readSaved(app, duplicate.id))?.pages[0]?.name === `${runId} Home`, 'page rename persistence');
    pageAction(app, firstPageId, 'duplicate');
    await waitFor(async () => (await readSaved(app, duplicate.id))?.pages.length === 2, 'page duplicate persistence');
    let pageDocument = await readSaved(app, duplicate.id);
    const duplicatedPage = pageDocument.pages.find(page => page.id !== firstPageId);
    assert(duplicatedPage?.name === `${runId} Home copy`, 'duplicating a page should assign a distinct copy name.');
    const originalNodeIds = collectPageNodeIds(pageDocument.pages.find(page => page.id === firstPageId));
    const duplicatedNodeIds = collectPageNodeIds(duplicatedPage);
    assert(duplicatedNodeIds.size === originalNodeIds.size && [...duplicatedNodeIds].every(id => !originalNodeIds.has(id)),
      'duplicated page layers should receive fresh identities independent of their source.');
    assert(app.querySelector(`#pages-list [data-page-id="${CSS.escape(duplicatedPage.id)}"]`)?.classList.contains('is-active'),
      'page duplication should switch the canvas to the new copy.');
    pageAction(app, duplicatedPage.id, 'move-up');
    await waitFor(async () => (await readSaved(app, duplicate.id))?.pages[0]?.id === duplicatedPage.id, 'page move-up persistence');
    assert(app.querySelector(`#pages-list [data-page-id="${CSS.escape(duplicatedPage.id)}"]`)?.classList.contains('is-active'),
      'reordering pages should preserve the active page by identity.');
    pageAction(app, duplicatedPage.id, 'move-down');
    await waitFor(async () => (await readSaved(app, duplicate.id))?.pages[1]?.id === duplicatedPage.id, 'page move-down persistence');
    app.defaultView.confirm = () => true;
    pageAction(app, duplicatedPage.id, 'delete');
    await waitFor(async () => (await readSaved(app, duplicate.id))?.pages.length === 1, 'page delete persistence');
    pageDocument = await readSaved(app, duplicate.id);
    assert(pageDocument.pages[0].id === firstPageId && pageDocument.activePageId === firstPageId,
      'deleting the active copy should return to the surviving page.');
    assert(app.querySelector(`#pages-list [data-page-id="${CSS.escape(firstPageId)}"] [data-page-action="delete"]`)?.disabled,
      'the final remaining page must not be deletable.');

    result.textContent = 'RUNNING: active design deletion';
    clickLibraryMenu(app);
    await waitFor(() => app.querySelector('#design-library-dialog')?.open, 'active design delete dialog');
    await waitFor(() => app.querySelector('.design-file-row.is-current [data-design-action="delete"]'), 'active design delete action');
    app.defaultView.confirm = () => true;
    const beforeDeleteIds = new Set((await listSavedDocuments()).map(item => item.id));
    // Keep the file header valid so import preflight reaches the intentionally held full-file read.
    const pendingFile = new app.defaultView.File([fixtureBmp()], 'pending-import.bmp', { type: 'image/bmp' });
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
    await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('pending-import.bmp: Injected pending image read failure'), 'held image import release');
    click(app, app.querySelector(`[data-design-action="delete"][data-design-id="${CSS.escape(duplicate.id)}"]`));
    await waitFor(() => app.querySelector('#document-name')?.value === 'Untitled', 'active design deletion and safe document switch');
    await waitFor(async () => !(await listSavedDocuments()).some(item => item.id === duplicate.id), 'deleted document removal');
    assert(!app.querySelector('#design-library-list')?.textContent.includes(`${runId} renamed copy`), 'deleted active file should disappear from the library.');
    await waitFor(async () => (await listSavedDocuments()).some(item => !beforeDeleteIds.has(item.id)), 'replacement design save');
    for (const item of await listSavedDocuments()) if (!beforeDeleteIds.has(item.id)) testDocumentIds.add(item.id);

    checks = { library: ['open', 'duplicate', 'rename', 'delete-active'], pages: ['rename', 'duplicate-fresh-ids', 'move-up', 'move-down', 'delete-last-page-guard'], canvas: ['nested rotated resize', 'opposite handle fixed', 'rotate gesture', 'multi-layer resize', 'multi-layer rotate', 'degenerate Shift multi-layer resize', 'transformed marquee', 'rotated Pen branch', 'rotated group Pen path', 'shape/text/image nested rotated placement', 'clipboard image paste to local source', 'Alt-drag fresh-ID duplicate', 'Alt-click no-op', 'Alt-drag pointer-cancel rollback', 'single-step duplicate-move undo/redo', 'Alt-drag auto-layout duplicate and reorder'] };
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

await start();
