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
  canvas.dispatchEvent(selectPoint);
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 77, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'), 'A normal first click in Comment mode should select the containing component.');
  assert(app.querySelector('[data-inspector-tab="design"]')?.classList.contains('is-active'), 'Selecting an object should expose its Design properties while leaving Comment mode active.');
  assert(!app.querySelector('#comment-draft'), 'Selecting a component should not create a comment draft.');
  assert(app.querySelector('[data-tool="comment"]')?.classList.contains('is-selected'), 'Selecting a frame should keep Comment mode active.');
  const framePoint = new app.defaultView.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 78, pointerType: 'mouse', shiftKey: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  canvas.dispatchEvent(framePoint);
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 78, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'), 'Shift-click should select the nearest nested frame inside a component.');
  const point = new app.defaultView.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 80, pointerType: 'mouse', clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  canvas.dispatchEvent(point);
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 80, pointerType: 'mouse' }));
  assert(!app.querySelector('#comment-draft'), 'Repeated clicks on an already-selected frame must not hijack selection to start a comment.');
  click(app.querySelector('[data-comment-action="new"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 82, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 82, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'),
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
  click(app.querySelector('[data-tool="comment"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 84, pointerType: 'mouse',
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 84, pointerType: 'mouse' }));
  await waitFor(() => app.querySelector('#comment-draft'), 'reopening the selected thread from its pin');
  click(app.querySelector('[data-comment-action="back"]'));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 85, pointerType: 'mouse', shiftKey: true,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 85, pointerType: 'mouse' }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'Shift-click should leave an inactive pin thread and select the nearest nested frame.');
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

  frame.style.width = '390px'; frame.style.height = '844px';
  await new Promise(resolve => setTimeout(resolve, 120));
  click(app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'mobile comments panel');
  assert(Number.parseFloat(app.defaultView.getComputedStyle(app.querySelector('.comment-compose textarea')).minHeight) >= 88, 'The phone comment composer should provide a comfortable touch target.');
  assert(Number.parseFloat(app.defaultView.getComputedStyle(app.querySelector('.comment-compose .primary-button')).minHeight) >= 40, 'The phone reply button should remain finger-sized.');
  assert(!app.querySelector('#canvas-region').inert, 'An open saved comment thread should keep the visible phone canvas interactive.');
  assert(!app.querySelector('#mobile-scrim').classList.contains('is-visible') || app.defaultView.getComputedStyle(app.querySelector('#mobile-scrim')).display === 'none', 'An active mobile thread should not place a blocking scrim over the canvas.');
  const reviewCanvas = app.querySelector('#scene-canvas');
  const reviewRect = reviewCanvas.getBoundingClientRect();
  reviewCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 90, pointerType: 'touch',
    clientX: reviewRect.left + reviewRect.width / 2, clientY: reviewRect.top + reviewRect.height / 2
  }));
  reviewCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 90, pointerType: 'touch' }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'), 'A phone canvas tap should select the component beneath an active comment thread.');
  assert(!app.querySelector('#right-panel').classList.contains('is-open'), 'Selecting from an active mobile thread should dismiss its sheet and restore the full canvas.');
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
  listCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 91, pointerType: 'touch' }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'), 'A tap from the mobile Comments list should select the nested frame on the canvas.');
  assert(!app.querySelector('#right-panel').classList.contains('is-open') && app.querySelector('[data-inspector-tab="design"]')?.classList.contains('is-active'), 'Canvas selection should close the Comments sheet and show Design properties.');
  click(app.querySelector('[data-tool="comment"]'));
  await waitFor(() => !app.querySelector('#right-panel').classList.contains('is-open'), 'mobile panel dismissal when returning to canvas comments');
  assert(!app.querySelector('#canvas-region').inert, 'Activating Comment mode should restore canvas input on mobile.');
  click(app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'opening the mobile Comments panel while Comment mode is active');
  assert(!app.querySelector('#canvas-region').inert, 'Comment mode should keep the canvas interactive with the mobile Comments panel open, even without an active thread.');
  assert(!app.querySelector('#mobile-scrim').classList.contains('is-visible') || app.defaultView.getComputedStyle(app.querySelector('#mobile-scrim')).display === 'none', 'The active mobile Comment panel should not cover the canvas with a blocking scrim.');
  const mobileCanvas = app.querySelector('#scene-canvas');
  const mobileRect = mobileCanvas.getBoundingClientRect();
  mobileCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 81, pointerType: 'touch', shiftKey: true,
    clientX: mobileRect.left + mobileRect.width / 2, clientY: mobileRect.top + mobileRect.height / 2
  }));
  mobileCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
    bubbles: true, button: 0, pointerId: 81, pointerType: 'touch'
  }));
  assert(app.querySelector(`[data-layer-id="${nestedFrame.id}"]`)?.classList.contains('is-selected'),
    'A mobile Comment-mode tap should be able to select a frame after dismissing the inspector.');

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
  assert(app.querySelector('#canvas-region').inert, 'The canvas should be inert while the anchored new-comment composer is open.');
  const mobileDraft = app.querySelector('#comment-draft');
  mobileDraft.value = 'Mobile comment selection remains available.';
  mobileDraft.form.requestSubmit();
  await waitFor(() => app.querySelector('.comment-message p')?.textContent === 'Mobile comment selection remains available.', 'posting a mobile comment');
  assert(!app.querySelector('#canvas-region').inert, 'Posting the comment should restore mobile canvas interaction for selecting components and frames.');
  assert(!app.querySelector('#mobile-scrim').classList.contains('is-visible') || app.defaultView.getComputedStyle(app.querySelector('#mobile-scrim')).display === 'none',
    'The active mobile comment thread should not keep a blocking scrim over the canvas.');
  mobileCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerId: 93, pointerType: 'touch',
    clientX: newCommentPoint.x, clientY: newCommentPoint.y
  }));
  mobileCanvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
    bubbles: true, button: 0, pointerId: 93, pointerType: 'touch'
  }));
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'),
    'After posting a mobile comment, a canvas tap on its pinned component should select it and dismiss the thread sheet.');
  assert(!app.querySelector('#right-panel').classList.contains('is-open'), 'Selecting from the new mobile thread should dismiss its sheet.');
  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', noPublicReferenceName: true, canvasAnchors: true, commentModeCanvasClicksSelectObjects: true, optionClickPlacesCommentOnObject: true, reply: true, resolveAndReopen: true, localPersistence: true, mobileComposer: true, mobileCanvasSelection: true, mobileCommentPanelCanvasSelection: true, mobileCommentsListSelection: true, mobileCommentPostRestoresSelection: true, touchSizedActions: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
