import { addNode, createDocument, createNode } from '../src/model.js';

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
  const reviewFrame = createNode('frame', { name: 'Review frame', x: -70, y: -50, width: 140, height: 100, fill: '#ffffff' });
  const shape = createNode('rectangle', { name: 'Review target', x: 20, y: 20, width: 100, height: 60, fill: '#ffffff' });
  addNode(design, reviewFrame); addNode(design, shape, { parentId: reviewFrame.id });
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
  assert(app.querySelector(`[data-layer-id="${reviewFrame.id}"]`)?.classList.contains('is-selected'), 'A normal first click in Comment mode should select the containing frame.');
  assert(app.querySelector('[data-inspector-tab="design"]')?.classList.contains('is-active'), 'Selecting an object should expose its Design properties while leaving Comment mode active.');
  assert(!app.querySelector('#comment-draft'), 'Selecting a frame should not create a comment draft.');
  assert(app.querySelector('[data-tool="comment"]')?.classList.contains('is-selected'), 'Selecting a frame should keep Comment mode active.');
  const point = new app.defaultView.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 78, pointerType: 'mouse', clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  canvas.dispatchEvent(point);
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 78, pointerType: 'mouse' }));
  assert(!app.querySelector('#comment-draft'), 'Repeated clicks on an already-selected frame must not hijack selection to start a comment.');
  const commentPoint = new app.defaultView.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 79, pointerType: 'mouse', altKey: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  canvas.dispatchEvent(commentPoint);
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 79, pointerType: 'mouse' }));
  await waitFor(() => app.querySelector('#comment-draft'), 'new comment composer');
  const draft = app.querySelector('#comment-draft'); draft.value = 'Increase the space above this label.';
  draft.form.requestSubmit();
  await waitFor(() => app.querySelectorAll('.comment-message').length === 1, 'first comment thread');
  await waitFor(() => app.querySelector('#save-state').textContent.includes('Saved locally'), 'comment persistence');
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
  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', noPublicReferenceName: true, canvasAnchors: true, commentModeCanvasClicksSelectObjects: true, optionClickPlacesCommentOnObject: true, reply: true, resolveAndReopen: true, localPersistence: true, mobileComposer: true, touchSizedActions: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
