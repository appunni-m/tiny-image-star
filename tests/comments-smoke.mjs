import { addNode, createComponent, createDocument, createNode } from '../src/model.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 10000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for editor startup or a saved local write. */ }
      if (performance.now() - start > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 30);
    };
    poll();
  });
}
function click(element) {
  assert(element, 'Expected an interactive comment control.');
  element.dispatchEvent(new element.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function assertCanvasReceivesPoint(app, canvas, point, label) {
  const target = app.elementFromPoint(point.x, point.y);
  assert(target === canvas || canvas.contains(target),
    `${label} should hit the visible canvas, not ${target?.id || target?.className || target?.tagName || 'no element'}.`);
}
function packageFile(documentData) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: documentData.schema, document: documentData, assets: [] }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
function readDocument(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('figma-local-documents');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const read = db.transaction('documents').objectStore('documents').get(id);
      read.onsuccess = () => { resolve(read.result?.document || null); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  });
}
function waitForPaint(app) {
  return new Promise(resolve => app.defaultView.requestAnimationFrame(() => app.defaultView.requestAnimationFrame(resolve)));
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  // A writable folder picker is available in some browser shells but cannot be
  // completed by the isolated smoke frame. On its disposable test origin,
  // select the supported browser-storage fallback so this workflow can reach
  // the canvas without touching a real workspace folder.
  const onboarding = app.querySelector('#workspace-onboarding-dialog');
  if (onboarding?.open) {
    Object.defineProperty(app.defaultView, 'showDirectoryPicker', { configurable: true, value: undefined });
    const browserFallback = app.querySelector('#workspace-onboarding-browser-fallback');
    browserFallback.hidden = false;
    click(browserFallback);
    await waitFor(() => !onboarding.open, 'isolated browser-storage workspace');
  }
  assert(app.title === 'Tiny Image Star', 'The public product name must stay Tiny Image Star.');
  assert(!app.body.innerText.toLowerCase().includes('figma'), 'The user-facing editor must not display its internal reference name.');
  const design = createDocument();
  const reviewFrame = createNode('frame', { name: 'Review component', x: -70, y: -50, width: 140, height: 100, fill: '#ffffff' });
  const nestedFrame = createNode('frame', { name: 'Review frame', x: 0, y: 0, width: 140, height: 100, fill: 'transparent' });
  const shape = createNode('rectangle', { name: 'Review target', x: 20, y: 20, width: 100, height: 60, fill: '#ffffff' });
  addNode(design, reviewFrame); createComponent(design, reviewFrame.id, reviewFrame.name);
  addNode(design, nestedFrame, { parentId: reviewFrame.id }); addNode(design, shape, { parentId: nestedFrame.id });
  const input = app.querySelector('#open-file-input'); const transfer = new app.defaultView.DataTransfer();
  transfer.items.add(new app.defaultView.File([packageFile(design)], 'comments-smoke.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Local design opened')), 'local design import');

  click(app.querySelector('[data-tool="comment"]'));
  const canvas = app.querySelector('#scene-canvas');
  canvas.setPointerCapture = () => {};
  const rect = canvas.getBoundingClientRect();
  const selectPoint = new app.defaultView.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 77, pointerType: 'mouse', clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  assertCanvasReceivesPoint(app, canvas, { x: selectPoint.clientX, y: selectPoint.clientY }, 'Comment-mode object selection');
  canvas.dispatchEvent(selectPoint);
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 77, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'), 'A normal first click in Comment mode should select the containing component.');
  assert(app.querySelector('[data-inspector-tab="design"]')?.classList.contains('is-active'), 'Selecting an object should expose its Design properties while leaving Comment mode active.');
  assert(!app.querySelector('#comment-draft'), 'Selecting a component should not create a comment draft.');
  assert(app.querySelector('[data-tool="comment"]')?.classList.contains('is-selected'), 'Selecting a frame should keep Comment mode active.');
  click(app.querySelector('[data-tool="frame"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 89, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 89, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'Switching from Comment to Frame after selecting a component should keep the next same-point click available for its nested frame.');
  assert(app.querySelector('[data-tool="frame"]')?.classList.contains('is-selected'),
    'Selecting the nested frame should leave the newly chosen Frame tool active.');
  click(app.querySelector('[data-tool="comment"]'));
  click(app.querySelector('[data-inspector-tab="comments"]'));
  click(app.querySelector('[data-tool="frame"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 75, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 75, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'With the Comments panel active and no thread open, clicking existing artwork should select its frame instead of drawing a new one.');
  assert(app.querySelector('[data-inspector-tab="design"]')?.classList.contains('is-active'),
    'Selecting artwork from the Comments panel should reveal its Design properties.');
  assert(app.querySelector('[data-tool="frame"]')?.classList.contains('is-selected'),
    'Selecting an object from the Comments panel should preserve the active drawing tool.');
  assert(!app.querySelector('#comment-draft'), 'Selecting from the Comments panel should not create a comment draft.');
  click(app.querySelector('[data-inspector-tab="comments"]'));
  click(app.querySelector('[data-tool="select"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 76, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 76, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected')
    || app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
  'With the Comments panel active, Select should resolve a canvas hit to its component or containing frame.');
  assert(app.querySelector('[data-tool="select"]')?.classList.contains('is-selected'),
    'Selecting a review container from the Comments panel should preserve the Select tool.');
  click(app.querySelector('[data-tool="comment"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 72, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 72, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'A second mouse click on nested artwork should switch from the component to its containing frame.');
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 71, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 71, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'),
    'A third mouse click should cycle back to the component.');
  for (const pointerId of [73, 74]) {
    canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, pointerId, pointerType: 'touch',
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
    }));
    canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId, pointerType: 'touch' }));
  }
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'Two quick phone taps on nested artwork should let users switch from its component to the containing frame.');
  assert(app.querySelector('#scene-canvas').getAttribute('aria-label').includes('tap the same spot again'),
    'Comment mode should explain the touch gesture for choosing a nested frame or component.');
  const initialZoom = Number.parseFloat(app.querySelector('#zoom-readout').textContent) / 100;
  const emptyFramePoint = new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 94, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2 + 60 * initialZoom,
    clientY: rect.top + rect.height / 2 + 40 * initialZoom
  });
  canvas.dispatchEvent(emptyFramePoint);
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 94, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'Clicking empty space inside a nested frame should select that frame directly, without requiring Shift-click.');
  const framePoint = new app.defaultView.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 78, pointerType: 'mouse', shiftKey: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  canvas.dispatchEvent(framePoint);
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 78, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'), 'Shift-click should select the nearest nested frame inside a component.');
  const point = new app.defaultView.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 80, pointerType: 'mouse', clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  canvas.dispatchEvent(point);
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 80, pointerType: 'mouse' }));
  assert(!app.querySelector('#comment-draft'), 'Repeated clicks on an already-selected frame must not hijack selection to start a comment.');
  click(app.querySelector('[data-inspector-tab="comments"]'));
  click(app.querySelector('[data-comment-action="new"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 82, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 82, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected')
    || app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'A pending New comment action must not prevent selecting a component or frame.');
  assert(!app.querySelector('#comment-draft'), 'Selecting an object while Comment mode is active should not place a comment.');
  const commentPoint = new app.defaultView.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 79, pointerType: 'mouse', altKey: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  canvas.dispatchEvent(commentPoint);
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 79, pointerType: 'mouse' }));
  await waitFor(() => app.querySelector('#comment-draft'), 'new comment composer');
  const draft = app.querySelector('#comment-draft'); draft.value = 'Increase the space above this label.';
  draft.form.requestSubmit();
  await waitFor(() => app.querySelectorAll('.comment-message').length === 1, 'first comment thread');
  await waitFor(() => app.querySelector('#save-state').textContent.includes('Saved locally'), 'comment persistence');
  click(app.querySelector('[data-tool="select"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 88, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 88, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'),
    'Select mode should leave an open comment thread by selecting the component beneath its pin.');
  assert(app.querySelector('[data-inspector-tab="design"]')?.classList.contains('is-active'),
    'Selecting beneath the active thread should return the inspector to Design.');
  click(app.querySelector('[data-tool="comment"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 89, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 89, pointerType: 'mouse' }));
  await waitFor(() => app.querySelector('.comment-thread-actions'), 'reopening the inactive comment pin');
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 83, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 83, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'),
    'Clicking the active comment pin should select its containing component instead of trapping canvas selection.');
  assert(app.querySelector('[data-inspector-tab="design"]')?.classList.contains('is-active'),
    'Selecting the component beneath an active comment pin should return to Design properties.');
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 84, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 84, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'A repeated hit on the active comment pin should select its nested frame after selecting the component.');
  click(app.querySelector('[data-inspector-tab="comments"]'));
  click(app.querySelector('.comment-thread-row'));
  await waitFor(() => app.querySelector('#comment-draft'), 'reopening the selected thread from the Comments list');
  click(app.querySelector('[data-comment-action="back"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 85, pointerType: 'mouse', shiftKey: true,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 85, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'Shift-click should leave an inactive pin thread and select the nearest nested frame.');
  for (const [pointerId, expectedId, message] of [
    [101, reviewFrame.id, 'the first Comment-mode hit on an inactive pin should select its component'],
    [102, nestedFrame.id, 'the repeated hit on that same inactive pin should select its nested frame']
  ]) {
    canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, pointerId, pointerType: 'mouse',
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
    }));
    canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId, pointerType: 'mouse' }));
    assert(app.querySelector(`[data-layer-id="${expectedId}"]`)?.classList.contains('is-selected'), message);
    assert(!app.querySelector('#comment-draft'), 'Selecting through an inactive pin in Comment mode should not reopen its thread.');
  }
  click(app.querySelector('[data-tool="select"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 86, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 86, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'),
    'Select mode should select an unselected component beneath an inactive comment pin on the first click.');
  assert(!app.querySelector('#comment-draft'), 'Selecting an unselected component beneath an inactive pin should not reopen its thread.');
  click(app.querySelector('[data-tool="comment"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 87, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 87, pointerType: 'mouse' }));
  await waitFor(() => app.querySelector('#comment-draft'), 'opening a thread from the selected component pin');
  await waitForPaint(app);
  const dpr = canvas.width / canvas.clientWidth;
  const pinPixel = canvas.getContext('2d').getImageData(Math.round(canvas.width / 2 + 7 * dpr), Math.round(canvas.height / 2), 1, 1).data;
  assert(pinPixel[2] > 180 && pinPixel[0] < 80, `An anchored blue comment pin should render above the artwork; pixel=${[...pinPixel]}.`);

  const replyDraft = app.querySelector('#comment-draft'); replyDraft.value = 'Spacing updated.'; replyDraft.form.requestSubmit();
  await waitFor(() => app.querySelectorAll('.comment-message').length === 2, 'thread reply');
  click(app.querySelector('[data-comment-action="resolve"]'));
  await waitFor(() => app.querySelector('[data-comment-action="resolve"]')?.textContent.includes('Reopen'), 'thread resolution');
  await waitFor(() => app.querySelector('#save-state').textContent.includes('Saved locally'), 'resolved thread persistence');
  click(app.querySelector('[data-comment-action="back"]'));
  const row = app.querySelector('.comment-thread-row');
  assert(row?.classList.contains('is-resolved') && row.textContent.includes('Resolved'), 'Resolved threads should remain visible in the comments list.');
  click(row);
  await waitFor(() => app.querySelectorAll('.comment-message').length === 2, 'opening saved thread');
  const stored = await readDocument(design.id);
  assert(stored?.comments?.length === 1 && stored.comments[0].messages.length === 2 && stored.comments[0].resolved, 'The complete review thread should persist with the local document.');

  click(app.querySelector('[data-tool="frame"]'));
  const reviewCanvasRect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 90, pointerType: 'mouse',
    clientX: reviewCanvasRect.left + reviewCanvasRect.width / 2,
    clientY: reviewCanvasRect.top + reviewCanvasRect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 90, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'),
    'An open comment thread should allow canvas object selection even when the Frame tool remains active.');
  assert(app.querySelector('[data-inspector-tab="design"]')?.classList.contains('is-active'),
    'Selecting artwork from an open thread should return the inspector to Design.');
  assert(app.querySelector('[data-tool="frame"]')?.classList.contains('is-selected'),
    'Selecting through an open review thread should preserve the chosen canvas tool.');
  assert(!app.querySelector('#comment-draft'), 'Selecting under an open review thread should return to Design instead of placing a reply.');
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 91, pointerType: 'mouse',
    clientX: reviewCanvasRect.left + reviewCanvasRect.width / 2,
    clientY: reviewCanvasRect.top + reviewCanvasRect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 91, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'After leaving an active comment thread, the repeated click should still select the nested frame instead of drawing a new one.');
  assert(app.querySelector('[data-tool="frame"]')?.classList.contains('is-selected'),
    'Selecting a nested frame after comment review should preserve the active Frame tool.');
  click(app.querySelector('[data-inspector-tab="comments"]'));
  click(app.querySelector('.comment-thread-row'));
  await waitFor(() => app.querySelectorAll('.comment-message').length === 2, 'reopening the saved thread after canvas selection');

  click(app.querySelector('[data-tool="hand"]'));
  const handRect = canvas.getBoundingClientRect();
  const handPoint = { x: handRect.left + handRect.width / 2, y: handRect.top + handRect.height / 2 };
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 97, pointerType: 'mouse',
    clientX: handPoint.x, clientY: handPoint.y
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointermove', {
    bubbles: true, cancelable: true, buttons: 1, pointerId: 97, pointerType: 'mouse',
    clientX: handPoint.x + 40, clientY: handPoint.y + 20
  }));
  assert(canvas.classList.contains('is-panning'), 'Dragging artwork with Hand during comment review should pan the canvas.');
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
    bubbles: true, button: 0, pointerId: 97, pointerType: 'mouse',
    clientX: handPoint.x + 40, clientY: handPoint.y + 20
  }));
  assert(app.querySelector('.comment-thread-actions'), 'Panning during comment review should leave the open thread intact.');
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 98, pointerType: 'mouse',
    clientX: handPoint.x, clientY: handPoint.y
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
    bubbles: true, button: 0, pointerId: 98, pointerType: 'mouse',
    clientX: handPoint.x, clientY: handPoint.y
  }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'),
    'A Hand-tool click on artwork during comment review should select its component or frame.');
  assert(app.querySelector('[data-inspector-tab="design"]')?.classList.contains('is-active'),
    'Hand-tool selection should leave comment review and expose the selected layer properties.');

  // Selecting an object leaves the active thread by design. Reopen it before
  // checking that a saved thread remains selectable after switching inspector
  // tabs on a phone.
  click(app.querySelector('[data-inspector-tab="comments"]'));
  click(app.querySelector('.comment-thread-row'));
  await waitFor(() => app.querySelectorAll('.comment-message').length === 2, 'reopening the saved thread before mobile review');

  frame.style.width = '390px'; frame.style.height = '844px';
  await new Promise(resolve => setTimeout(resolve, 120));
  click(app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'mobile comments panel');
  await waitForPaint(app);
  click(app.querySelector('[data-inspector-tab="design"]'));
  assert(!app.querySelector('#canvas-region').inert,
    'Switching inspector tabs must not make the phone canvas inert while a comment thread remains active.');
  const switchedCanvas = app.querySelector('#scene-canvas');
  const switchedRect = switchedCanvas.getBoundingClientRect();
  const switchedSheetTop = app.querySelector('#right-panel').getBoundingClientRect().top;
  const switchedTapY = Math.min(switchedRect.top + switchedRect.height / 2 - 24, switchedSheetTop - 24);
  switchedCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 95, pointerType: 'touch',
    clientX: switchedRect.left + switchedRect.width / 2, clientY: switchedTapY
  }));
  switchedCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
    bubbles: true, button: 0, pointerId: 95, pointerType: 'touch',
    clientX: switchedRect.left + switchedRect.width / 2, clientY: switchedTapY
  }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'),
    'A phone tap should select the component or frame when its thread remains active after switching to Design.');
  assert(!app.querySelector('#right-panel').classList.contains('is-open'),
    'Selecting from a switched-tab comment thread should dismiss the phone sheet.');
  click(app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'reopening comments after switched-tab selection');
  click(app.querySelector('[data-inspector-tab="comments"]'));
  click(app.querySelector('.comment-thread-row'));
  await waitFor(() => app.querySelector('.comment-thread-actions'), 'reopening the active thread for mobile comment review');
  await waitForPaint(app);
  assert(Number.parseFloat(app.defaultView.getComputedStyle(app.querySelector('.comment-compose textarea')).minHeight) >= 88, 'The phone comment composer should provide a comfortable touch target.');
  assert(Number.parseFloat(app.defaultView.getComputedStyle(app.querySelector('.comment-compose .primary-button')).minHeight) >= 40, 'The phone reply button should remain finger-sized.');
  assert(!app.querySelector('#canvas-region').inert, 'An open saved comment thread should keep the visible phone canvas interactive.');
  assert(!app.querySelector('#mobile-scrim').classList.contains('is-visible') || app.defaultView.getComputedStyle(app.querySelector('#mobile-scrim')).display === 'none', 'An active mobile thread should not place a blocking scrim over the canvas.');
  const reviewCanvas = app.querySelector('#scene-canvas');
  const reviewRect = reviewCanvas.getBoundingClientRect();
  const commentSheetTop = app.querySelector('#right-panel').getBoundingClientRect().top;
  const selectableCanvasY = Math.min(reviewRect.top + reviewRect.height / 2 - 24, commentSheetTop - 24);
  reviewCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 90, pointerType: 'touch',
    clientX: reviewRect.left + reviewRect.width / 2, clientY: selectableCanvasY
  }));
  reviewCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
    bubbles: true, button: 0, pointerId: 90, pointerType: 'touch',
    clientX: reviewRect.left + reviewRect.width / 2, clientY: selectableCanvasY
  }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'), 'A phone canvas tap should select the component beneath an active comment thread.');
  assert(!app.querySelector('#right-panel').classList.contains('is-open'), `Selecting from an active mobile thread should dismiss its sheet and restore the full canvas (viewport ${app.defaultView.innerWidth}×${app.defaultView.innerHeight}; tap y=${selectableCanvasY}; sheet top=${commentSheetTop}).`);
  click(app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'opening the mobile Comments list');
  click(app.querySelector('[data-inspector-tab="comments"]'));
  assert(!app.querySelector('#canvas-region').inert, 'The mobile Comments list should leave the canvas available for selection without an open thread.');
  assert(!app.querySelector('#mobile-scrim').classList.contains('is-visible') || app.defaultView.getComputedStyle(app.querySelector('#mobile-scrim')).display === 'none', 'The mobile Comments list should not place a blocking scrim over the visible canvas.');
  const listCanvas = app.querySelector('#scene-canvas');
  const listRect = listCanvas.getBoundingClientRect();
  const zoom = Number.parseFloat(app.querySelector('#zoom-readout').textContent) / 100;
  const blankFramePointer = new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 91, pointerType: 'touch',
    clientX: listRect.left + listRect.width / 2 - 60 * zoom,
    clientY: listRect.top + listRect.height / 2 - 40 * zoom
  });
  listCanvas.dispatchEvent(blankFramePointer);
  listCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
    bubbles: true, button: 0, pointerId: 91, pointerType: 'touch',
    clientX: listRect.left + listRect.width / 2 - 60 * zoom,
    clientY: listRect.top + listRect.height / 2 - 40 * zoom
  }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'), 'A tap from the mobile Comments list should select the nested frame on the canvas.');
  assert(!app.querySelector('#right-panel').classList.contains('is-open') && app.querySelector('[data-inspector-tab="design"]')?.classList.contains('is-active'), 'Canvas selection should close the Comments sheet and show Design properties.');
  click(app.querySelector('[data-tool="comment"]'));
  await waitFor(() => !app.querySelector('#right-panel').classList.contains('is-open'), 'mobile panel dismissal when returning to canvas comments');
  assert(!app.querySelector('#canvas-region').inert, 'Activating Comment mode should restore canvas input on mobile.');
  click(app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'opening the mobile Comments panel while Comment mode is active');
  await waitForPaint(app);
  click(app.querySelector('[data-inspector-tab="design"]'));
  await waitForPaint(app);
  assert(!app.querySelector('#canvas-region').inert,
    'Switching to Design must not disable component/frame selection while the Comment tool remains active on mobile.');
  const commentDesignCanvas = app.querySelector('#scene-canvas');
  const commentDesignRect = commentDesignCanvas.getBoundingClientRect();
  const commentDesignPoint = {
    x: commentDesignRect.left + commentDesignRect.width / 2,
    y: commentDesignRect.top + commentDesignRect.height / 2
  };
  assertCanvasReceivesPoint(app, commentDesignCanvas, commentDesignPoint,
    'Phone component/frame selection with the Comment tool active and Design inspector open');
  commentDesignCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 96, pointerType: 'touch',
    clientX: commentDesignPoint.x,
    clientY: commentDesignPoint.y
  }));
  commentDesignCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
    bubbles: true, button: 0, pointerId: 96, pointerType: 'touch',
    clientX: commentDesignPoint.x,
    clientY: commentDesignPoint.y
  }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected')
    || app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'A phone tap must select the component/frame while Comment mode stays active and Design is shown.');
  await waitFor(() => !app.querySelector('#right-panel').classList.contains('is-open'), 'closing the phone sheet after Comment-mode selection');
  click(app.querySelector('#sidebar-toggle'));
  await waitFor(() => app.querySelector('#left-panel').classList.contains('is-open'), 'opening Layers while Comment mode is active');
  await waitForPaint(app);
  assert(!app.querySelector('#canvas-region').inert,
    'Comment mode must keep canvas selection available when the mobile Layers drawer is open.');
  assert(app.querySelector('.app-shell').classList.contains('mobile-comment-canvas-open'),
    'The mobile Layers drawer should share the workspace row layout that preserves an exposed canvas hit area.');
  const layersReviewCanvas = app.querySelector('#scene-canvas');
  const layersReviewRect = layersReviewCanvas.getBoundingClientRect();
  const layersDrawerRect = app.querySelector('#left-panel').getBoundingClientRect();
  const layersReviewPoint = {
    x: layersReviewRect.left + layersReviewRect.width / 2,
    y: layersReviewRect.top + layersReviewRect.height / 2
  };
  assertCanvasReceivesPoint(app, layersReviewCanvas, layersReviewPoint,
    'Phone component/frame selection with the Comment tool and Layers drawer open');
  assert(layersReviewRect.bottom <= layersDrawerRect.top + 1,
    'The open Layers drawer should not overlap the canvas hit area in portrait review.');
  layersReviewCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 93, pointerType: 'touch',
    clientX: layersReviewPoint.x, clientY: layersReviewPoint.y
  }));
  layersReviewCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
    bubbles: true, button: 0, pointerId: 93, pointerType: 'touch',
    clientX: layersReviewPoint.x, clientY: layersReviewPoint.y
  }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected')
    || app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'A phone tap must still select the component/frame with Comment mode active and the Layers drawer open.');
  await waitFor(() => !app.querySelector('#left-panel').classList.contains('is-open'), 'closing Layers after comment-mode selection');
  click(app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'reopening the phone inspector after Comment-mode selection');
  click(app.querySelector('[data-inspector-tab="comments"]'));
  await waitForPaint(app);
  assert(!app.querySelector('#canvas-region').inert, 'Comment mode should keep the canvas interactive with the mobile Comments panel open, even without an active thread.');
  assert(!app.querySelector('#mobile-scrim').classList.contains('is-visible') || app.defaultView.getComputedStyle(app.querySelector('#mobile-scrim')).display === 'none', 'The active mobile Comment panel should not cover the canvas with a blocking scrim.');
  const mobileCanvas = app.querySelector('#scene-canvas');
  const mobileCanvasRect = mobileCanvas.getBoundingClientRect();
  const mobileZoom = Number.parseFloat(app.querySelector('#zoom-readout').textContent) / 100;
  const newCommentPoint = {
    x: mobileCanvasRect.left + mobileCanvasRect.width / 2 + 60 * mobileZoom,
    y: mobileCanvasRect.top + mobileCanvasRect.height / 2 + 40 * mobileZoom
  };
  mobileCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 92, pointerType: 'touch', altKey: true,
    clientX: newCommentPoint.x, clientY: newCommentPoint.y
  }));
  mobileCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
    bubbles: true, button: 0, pointerId: 92, pointerType: 'touch', altKey: true
  }));
  await waitFor(() => app.querySelector('#comment-draft'), 'opening the mobile comment composer');
  assert(!app.querySelector('#canvas-region').inert, 'An anchored new-comment composer should leave the canvas available for selecting components and frames.');
  const mobileDraft = app.querySelector('#comment-draft');
  mobileDraft.value = 'Mobile comment selection remains available.';
  mobileDraft.dispatchEvent(new app.defaultView.InputEvent('input', { bubbles: true, inputType: 'insertText', data: mobileDraft.value }));
  for (const [index, layerId] of [reviewFrame.id, nestedFrame.id].entries()) {
    const selectableRect = mobileCanvas.getBoundingClientRect();
    const selectablePoint = {
      x: selectableRect.left + selectableRect.width / 2,
      y: selectableRect.top + selectableRect.height / 2
    };
    mobileCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, pointerId: 94 + index, pointerType: 'touch',
      clientX: selectablePoint.x, clientY: selectablePoint.y
    }));
    mobileCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
      bubbles: true, button: 0, pointerId: 94 + index, pointerType: 'touch',
      clientX: selectablePoint.x, clientY: selectablePoint.y
    }));
    await waitFor(() => app.querySelector(`[data-layer-id="${layerId}"]`)?.classList.contains('is-selected'),
      index === 0 ? 'selecting the component while a comment draft is open' : 'selecting its nested frame while the draft is retained');
  }
  click(app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'reopening inspector with the retained comment draft');
  click(app.querySelector('[data-inspector-tab="comments"]'));
  await waitFor(() => app.querySelector('#comment-draft')?.value === 'Mobile comment selection remains available.', 'restoring the unsent comment text after selection');
  assert(!app.querySelector('#canvas-region').inert, 'The canvas should remain selectable while the new-comment draft is open.');
  const restoredMobileDraft = app.querySelector('#comment-draft');
  restoredMobileDraft.form.requestSubmit();
  await waitFor(() => app.querySelector('.comment-message p')?.textContent === 'Mobile comment selection remains available.', 'posting a mobile comment');
  assert(!app.querySelector('#canvas-region').inert, 'Posting the comment should restore mobile canvas interaction for selecting components and frames.');
  assert(!app.querySelector('#right-panel').classList.contains('is-open'),
    'Posting a new phone comment should return to the full canvas so its pin and nearby layers stay selectable.');
  assert(!app.querySelector('#mobile-scrim').classList.contains('is-visible') || app.defaultView.getComputedStyle(app.querySelector('#mobile-scrim')).display === 'none',
    'The active mobile comment thread should not keep a blocking scrim over the canvas.');
  const postedCanvasRect = mobileCanvas.getBoundingClientRect();
  const postedPinPoint = {
    x: postedCanvasRect.left + postedCanvasRect.width / 2 + 60 * mobileZoom,
    y: postedCanvasRect.top + postedCanvasRect.height / 2 + 40 * mobileZoom
  };
  mobileCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 93, pointerType: 'touch',
    clientX: postedPinPoint.x, clientY: postedPinPoint.y
  }));
  mobileCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
    bubbles: true, button: 0, pointerId: 93, pointerType: 'touch'
  }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'After posting a mobile comment, a canvas tap on its pin should select the directly hit nested frame.');
  assert(!app.querySelector('#right-panel').classList.contains('is-open'), 'Selecting from the new mobile thread should dismiss its sheet.');
  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', noPublicReferenceName: true, canvasAnchors: true, commentModeCanvasClicksSelectObjects: true, openCommentThreadYieldsObjectSelection: true, handClickSelectsDuringCommentReview: true, handDragPansDuringCommentReview: true, optionClickPlacesCommentOnObject: true, reply: true, resolveAndReopen: true, localPersistence: true, mobileComposer: true, mobileCanvasSelection: true, mobileCommentPanelCanvasSelection: true, mobileCommentsListSelection: true, mobileThreadTabSwitchSelection: true, mobileDraftSelectionRetention: true, mobileCommentPostRestoresSelection: true, touchSizedActions: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
