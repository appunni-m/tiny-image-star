import { addNode, createDocument, createNode } from '../src/model.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 15000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { if (await test()) { resolve(); return; } } catch { /* Wait for editor startup and storage writes. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    poll();
  });
}
function tap(app, element) {
  assert(element, 'Expected a phone prototype control.');
  const Pointer = app.defaultView.PointerEvent;
  if (Pointer) {
    element.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true, pointerId: 81, pointerType: 'touch', button: 0 }));
    element.dispatchEvent(new Pointer('pointerup', { bubbles: true, cancelable: true, pointerId: 81, pointerType: 'touch', button: 0 }));
  }
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function packageFile(documentData) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: documentData.schema, document: documentData, assets: [] }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
function makeDesign() {
  const design = createDocument();
  const sourceFrame = createNode('frame', { name: 'Home', x: -160, y: -110, width: 140, height: 220 });
  const source = createNode('rectangle', { name: 'Open details', x: 20, y: 30, width: 80, height: 48, fill: '#1769aa' });
  const destination = createNode('frame', { name: 'Details', x: 20, y: -110, width: 140, height: 220 });
  addNode(design, sourceFrame);
  addNode(design, source, { parentId: sourceFrame.id });
  addNode(design, destination);
  return { design, source, destination };
}
function importDesign(app, design, fileName) {
  const input = app.querySelector('#open-file-input');
  const transfer = new app.defaultView.DataTransfer();
  transfer.items.add(new app.defaultView.File([packageFile(design)], fileName, { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}
function readDocument(app, id) {
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
async function enterPendingConnection(app, sourceId) {
  const rightPanel = app.querySelector('#right-panel');
  if (!rightPanel.classList.contains('is-open')) tap(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => rightPanel.classList.contains('is-open') && !rightPanel.inert, 'phone Properties panel');
  const prototypeTab = app.querySelector('.inspector-tab[data-inspector-tab="prototype"]');
  if (!prototypeTab.classList.contains('is-active')) tap(app, prototypeTab);
  assert(app.querySelector(`[data-layer-id="${sourceId}"]`)?.getAttribute('aria-selected') === 'true', 'The prototype source should remain selected.');
  tap(app, app.querySelector('[data-action="prototype-connect"]'));
  await waitFor(() => !app.querySelector('#prototype-connect-prompt').hidden, 'persistent prototype connection prompt');
}
function startCanvasTap(app, targetFrame) {
  const canvas = app.querySelector('#scene-canvas');
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + canvas.clientWidth / 2 + targetFrame.x + targetFrame.width / 2;
  const clientY = rect.top + canvas.clientHeight / 2 + targetFrame.y + targetFrame.height / 2;
  canvas.setPointerCapture = () => {};
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, pointerId: 82, pointerType: 'touch', button: 0, clientX, clientY
  }));
  canvas.dispatchEvent(new app.defaultView.PointerEvent('pointerup', {
    bubbles: true, cancelable: true, pointerId: 82, pointerType: 'touch', button: 0, clientX, clientY
  }));
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  assert(app.defaultView.innerWidth === 390 && app.defaultView.innerHeight === 844, 'The workflow should run at a 390×844 phone viewport.');

  let fixture = makeDesign();
  importDesign(app, fixture.design, 'mobile-prototype-first.flocal');
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Local design opened')), 'first design import');
  tap(app, app.querySelector('#sidebar-toggle'));
  await waitFor(() => app.querySelector('#left-panel').classList.contains('is-open'), 'phone Layers panel');
  tap(app, app.querySelector(`[data-layer-id="${fixture.source.id}"]`));
  assert(app.querySelector(`[data-layer-id="${fixture.source.id}"]`)?.getAttribute('aria-selected') === 'true', 'The source layer should be selected from Layers.');
  tap(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'phone Properties panel');
  tap(app, app.querySelector('.inspector-tab[data-inspector-tab="prototype"]'));
  await waitFor(() => app.querySelector('[data-action="prototype-connect"]'), 'prototype interaction controls');

  tap(app, app.querySelector('[data-action="prototype-connect"]'));
  const prompt = app.querySelector('#prototype-connect-prompt');
  await waitFor(() => !prompt.hidden, 'initial connection prompt');
  assert(!app.querySelector('#right-panel').classList.contains('is-open') && !app.querySelector('#mobile-scrim').classList.contains('is-visible'), 'Starting a connection should close the panel and remove the canvas scrim.');
  const canvas = app.querySelector('#scene-canvas');
  assert(app.activeElement === canvas, 'Starting a phone connection should focus the canvas.');
  const message = app.querySelector('#prototype-connect-message');
  assert(message.textContent.includes('Tap a destination frame') && message.textContent.includes('Escape'), 'The prompt should explain the tap target and keyboard cancellation.');
  assert(canvas.getAttribute('aria-describedby') === message.id, 'The focused canvas should announce the pending connection instruction.');
  const cancel = app.querySelector('#prototype-connect-cancel');
  const cancelRect = cancel.getBoundingClientRect();
  assert(cancelRect.width >= 72 && cancelRect.height >= 44, 'The in-canvas Cancel action should be touch-sized.');
  const cancelHit = app.elementFromPoint(cancelRect.left + cancelRect.width / 2, cancelRect.top + cancelRect.height / 2);
  assert(cancelHit === cancel || cancel.contains(cancelHit), 'Cancel should remain reachable above the canvas.');

  tap(app, cancel);
  assert(prompt.hidden && !canvas.hasAttribute('aria-describedby'), 'Cancel should clear the prompt and its canvas description.');
  assert(app.activeElement === canvas, 'Cancel should leave keyboard focus on the canvas.');

  await enterPendingConnection(app, fixture.source.id);
  const escape = new app.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  canvas.dispatchEvent(escape);
  assert(escape.defaultPrevented && prompt.hidden, 'Escape should cancel the pending connection and hide its prompt.');

  await enterPendingConnection(app, fixture.source.id);
  tap(app, app.querySelector('#main-menu-button'));
  assert(!app.querySelector('#context-menu').hidden, 'The phone main menu should open during a pending connection.');
  const menuEscape = new app.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  app.activeElement.dispatchEvent(menuEscape);
  assert(menuEscape.defaultPrevented && app.querySelector('#context-menu').hidden && prompt.hidden, 'Escape should close the menu and cancel the pending connection.');

  await enterPendingConnection(app, fixture.source.id);
  tap(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'reopened Properties panel');
  tap(app, app.querySelector('.inspector-tab[data-inspector-tab="design"]'));
  assert(prompt.hidden && !canvas.hasAttribute('aria-describedby'), 'Changing inspector tabs should cancel the pending connection.');

  await enterPendingConnection(app, fixture.source.id);
  tap(app, app.querySelector('#main-menu-button'));
  const newDesign = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('New design'));
  assert(newDesign, 'The phone main menu should expose New design during a pending connection.');
  tap(app, newDesign);
  await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('New local design created.'), 'document switch');
  assert(prompt.hidden && !canvas.hasAttribute('aria-describedby'), 'Switching designs should clear the pending connection prompt.');

  fixture = makeDesign();
  importDesign(app, fixture.design, 'mobile-prototype-final.flocal');
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Local design opened')), 'final design import');
  tap(app, app.querySelector('#sidebar-toggle'));
  await waitFor(() => app.querySelector('#left-panel').classList.contains('is-open'), 'final Layers panel');
  tap(app, app.querySelector(`[data-layer-id="${fixture.source.id}"]`));
  tap(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'final Properties panel');
  tap(app, app.querySelector('.inspector-tab[data-inspector-tab="prototype"]'));
  await enterPendingConnection(app, fixture.source.id);

  canvas.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  await waitFor(() => !app.querySelector(`[data-layer-id="${fixture.source.id}"]`) && prompt.hidden,
    'source deletion to cancel the pending connection');
  assert(!canvas.hasAttribute('aria-describedby'), 'Deleting the pending prototype source should remove its canvas instruction.');

  fixture = makeDesign();
  importDesign(app, fixture.design, 'mobile-prototype-connected.flocal');
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Local design opened')), 'connection destination design import');
  tap(app, app.querySelector('#sidebar-toggle'));
  await waitFor(() => app.querySelector('#left-panel').classList.contains('is-open'), 'connection Layers panel');
  tap(app, app.querySelector(`[data-layer-id="${fixture.source.id}"]`));
  tap(app, app.querySelector('#inspector-toggle'));
  await waitFor(() => app.querySelector('#right-panel').classList.contains('is-open'), 'connection Properties panel');
  tap(app, app.querySelector('.inspector-tab[data-inspector-tab="prototype"]'));
  await enterPendingConnection(app, fixture.source.id);
  startCanvasTap(app, fixture.destination);
  await waitFor(async () => {
    const saved = await readDocument(app, fixture.design.id);
    const savedSource = saved?.pages.flatMap(page => page.children.flatMap(node => [node, ...(node.children || [])])).find(node => node.id === fixture.source.id);
    return savedSource?.interactions?.some(interaction => interaction.destinationId === fixture.destination.id);
  }, 'saved phone prototype connection');
  assert(prompt.hidden && !canvas.hasAttribute('aria-describedby'), 'A successful connection should remove the in-canvas prompt.');
  assert(!app.querySelector('#mobile-scrim').classList.contains('is-visible'), 'Completing a connection should leave the canvas unobstructed.');

  result.textContent = `PASS\n${JSON.stringify({ viewport: '390x844', panelDismissed: true, canvasFocused: true, persistentPrompt: true, touchSizedCancel: true, cancelButton: true, escapeCancel: true, inspectorTabCancel: true, documentSwitchClearsPrompt: true, sourceDeletionClearsPrompt: true, phoneTapDestination: true, savedInteraction: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
