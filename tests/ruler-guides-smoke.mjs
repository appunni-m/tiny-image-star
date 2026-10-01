const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 15000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } }
      catch { /* Let the editor render or finish its local save first. */ }
      if (performance.now() - start > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    void poll();
  });
}
function click(app, element) {
  assert(element, 'Expected a visible editor control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function pointer(app, target, type, pointerId, clientX, clientY) {
  target.dispatchEvent(new app.defaultView.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, clientX, clientY
  }));
}
function waitForPaint() {
  return new Promise(resolve => frame.contentWindow.requestAnimationFrame(() => frame.contentWindow.requestAnimationFrame(resolve)));
}
function readLatestDocument(app) {
  return new Promise((resolve, reject) => {
    const request = app.defaultView.indexedDB.open('figma-local-documents');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('documents').objectStore('documents').getAll();
      read.onsuccess = () => {
        const records = read.result.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        resolve(records[0]?.document || null);
        db.close();
      };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  });
}
function rulerScaleHasMarks(rail) {
  const surface = rail.querySelector('canvas');
  if (!surface?.width || !surface?.height) return false;
  const { data } = surface.getContext('2d').getImageData(0, 0, surface.width, surface.height);
  for (let index = 3; index < data.length; index += 4) if (data[index] > 0) return true;
  return false;
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  click(app, app.querySelector('#file-menu-button'));
  const create = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('New design'));
  click(app, create);
  await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('New local design created.'), 'fresh design');
  await waitFor(() => app.querySelector('.workspace')?.inert === false, 'design switch');

  const toggle = app.querySelector('#toggle-rulers');
  click(app, toggle);
  const horizontal = app.querySelector('#ruler-horizontal');
  const vertical = app.querySelector('#ruler-vertical');
  assert(toggle.getAttribute('aria-pressed') === 'true' && !horizontal.hidden && !vertical.hidden,
    'The ruler toggle should expose both accessible rulers.');
  await waitForPaint();
  assert(rulerScaleHasMarks(horizontal) && rulerScaleHasMarks(vertical), 'Zoom-aware ruler marks should be painted on both axes.');
  assert(Number.parseFloat(app.defaultView.getComputedStyle(horizontal).height) >= 24
    && Number.parseFloat(app.defaultView.getComputedStyle(vertical).width) >= 24,
  'Ruler touch rails should keep a minimum 24 CSS-pixel target.');

  const canvas = app.querySelector('#scene-canvas');
  const canvasRect = canvas.getBoundingClientRect();
  Object.defineProperty(horizontal, 'setPointerCapture', { configurable: true, value: () => {} });
  Object.defineProperty(vertical, 'setPointerCapture', { configurable: true, value: () => {} });
  Object.defineProperty(canvas, 'setPointerCapture', { configurable: true, value: () => {} });
  const startX = canvasRect.left + Math.min(120, canvasRect.width / 2);
  const startY = horizontal.getBoundingClientRect().top + 12;
  const verticalGuideY = canvasRect.top + 88;
  pointer(app, horizontal, 'pointerdown', 801, startX, startY);
  pointer(app, horizontal, 'pointermove', 801, startX, verticalGuideY);
  pointer(app, horizontal, 'pointerup', 801, startX, verticalGuideY);
  await waitFor(async () => (await readLatestDocument(app))?.pages?.find(page => page.id === app.querySelector('.page-row.is-active')?.dataset.pageId)?.guides?.length === 1,
    'saved vertical guide');
  let saved = await readLatestDocument(app);
  const pageId = saved.activePageId;
  let guides = saved.pages.find(page => page.id === pageId).guides;
  const firstGuide = guides[0];
  assert(firstGuide.axis === 'x' && Number.isFinite(firstGuide.position), 'Dragging from the horizontal rail should persist an x-position guide.');

  const transform = canvas.getContext('2d').getTransform();
  const ratio = canvas.width / canvasRect.width;
  const zoom = transform.a / ratio;
  const panX = transform.e / ratio;
  const guideClientX = canvasRect.left + panX + firstGuide.position * zoom;
  const guideClientY = canvasRect.top + Math.max(64, canvasRect.height / 2);
  pointer(app, canvas, 'pointerdown', 802, guideClientX, guideClientY);
  pointer(app, canvas, 'pointermove', 802, guideClientX + 32, guideClientY);
  pointer(app, canvas, 'pointerup', 802, guideClientX + 32, guideClientY);
  await waitFor(async () => {
    const doc = await readLatestDocument(app);
    return doc?.pages?.find(page => page.id === pageId)?.guides?.[0]?.position !== firstGuide.position;
  }, 'moved and saved guide');
  saved = await readLatestDocument(app);
  guides = saved.pages.find(page => page.id === pageId).guides;
  const movedPosition = guides[0].position;
  assert(Math.abs(movedPosition - firstGuide.position) > 20, 'Dragging a guide on the canvas should change its page-space position.');

  horizontal.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
  await waitFor(async () => {
    const doc = await readLatestDocument(app);
    return doc?.pages?.find(page => page.id === pageId)?.guides?.[0]?.position === movedPosition + 10;
  }, 'keyboard guide movement');
  horizontal.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  await waitFor(async () => (await readLatestDocument(app))?.pages?.find(page => page.id === pageId)?.guides?.length === 0,
    'keyboard guide deletion');

  vertical.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(async () => (await readLatestDocument(app))?.pages?.find(page => page.id === pageId)?.guides?.length === 1,
    'keyboard guide creation');
  saved = await readLatestDocument(app);
  guides = saved.pages.find(page => page.id === pageId).guides;
  assert(guides[0].axis === 'y', 'Enter on the vertical ruler should add a horizontal guide.');
  click(app, toggle);
  await waitForPaint();
  assert(toggle.getAttribute('aria-pressed') === 'false' && horizontal.hidden && vertical.hidden,
    'Ruler visibility should toggle off without deleting its saved guide.');
  assert((await readLatestDocument(app)).pages.find(page => page.id === pageId).guides.length === 1,
    'Hiding the rulers should keep page guides persisted.');

  result.textContent = `PASS\n${JSON.stringify({ ticksOnBothAxes: true, touchRails: true, dragCreate: true, dragMove: true, keyboardMove: true, keyboardDelete: true, keyboardCreate: true, pagePersistence: true, rulerVisibilityPreservesGuides: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
