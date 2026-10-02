import { addNode, createDocument, createNode } from '../src/model.js';
import { deleteStoredDocument, loadDocumentById, saveDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } } catch { /* Wait for the editor or its save queue. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    void poll();
  });
}
function click(app, element) {
  assert(element, 'Expected the vector offset control to exist.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function shortcut(app, shift = false) {
  const event = new app.defaultView.KeyboardEvent('keydown', {
    bubbles: true, cancelable: true, key: 'z', ctrlKey: true, shiftKey: shift
  });
  app.body.dispatchEvent(event);
  assert(event.defaultPrevented, shift ? 'Redo should consume Ctrl+Shift+Z.' : 'Undo should consume Ctrl+Z.');
}
function pathIn(documentValue, pathId) {
  return documentValue?.pages?.flatMap(page => page.children || []).find(node => node.id === pathId) || null;
}

let designId = null;
let outcome;
try {
  const design = createDocument();
  design.name = `Vector offset smoke ${Date.now()}`;
  const path = createNode('path', {
    name: 'Offset square', x: 20, y: 30, width: 100, height: 50, closed: true,
    fillRule: 'nonzero', fill: '#147dff',
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  });
  addNode(design, path);
  designId = design.id;
  await saveDocument(design);

  const app = frame.contentDocument;
  await waitFor(() => app?.documentElement.dataset.appReady === 'true', 'editor startup');
  click(app, app.querySelector('#main-menu-button'));
  const menuItem = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  click(app, menuItem);
  click(app, await waitFor(() => app.querySelector(`#design-library-list [data-design-id="${designId}"][data-design-action="open"]`), 'saved offset fixture'));
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'fixture design open');
  click(app, await waitFor(() => app.querySelector(`.layer-row[data-layer-id="${path.id}"]`), 'editable vector path'));

  const amount = app.querySelector('[data-vector-offset-amount]');
  const join = app.querySelector('[data-vector-offset-join]');
  const apply = app.querySelector('[data-action="offset-vector"]');
  assert(amount && join && apply, 'the vector inspector must expose amount, join, and apply controls.');
  assert([...join.options].some(option => option.value === 'square') && [...join.options].some(option => option.value === 'round'),
    'vector offset must offer square and round joins.');
  if (innerWidth <= 820) {
    assert(Number.parseFloat(app.defaultView.getComputedStyle(amount).minHeight) >= 40,
      'the amount field must be touch-sized in the phone inspector.');
    assert(Number.parseFloat(app.defaultView.getComputedStyle(apply).minHeight) >= 40,
      'the apply action must be touch-sized in the phone inspector.');
  }

  amount.value = '10';
  amount.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  join.value = 'square';
  join.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  click(app, apply);
  await waitFor(async () => {
    const saved = await loadDocumentById(designId);
    const updated = pathIn(saved, path.id);
    return updated?.width === 120 && updated?.height === 70 && updated?.x === 10 && updated?.y === 20 ? updated : null;
  }, 'expanded path save');

  shortcut(app);
  await waitFor(async () => {
    const saved = await loadDocumentById(designId);
    const updated = pathIn(saved, path.id);
    return updated?.width === 100 && updated?.height === 50 && updated?.x === 20 && updated?.y === 30 ? updated : null;
  }, 'undo restores original vector geometry');

  click(app, await waitFor(() => app.querySelector(`.layer-row[data-layer-id="${path.id}"]`), 'vector layer after undo'));
  const roundAmount = app.querySelector('[data-vector-offset-amount]');
  const roundJoin = app.querySelector('[data-vector-offset-join]');
  roundAmount.value = '10';
  roundAmount.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  roundJoin.value = 'round';
  roundJoin.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  click(app, app.querySelector('[data-action="offset-vector"]'));
  await waitFor(async () => {
    const saved = await loadDocumentById(designId);
    const updated = pathIn(saved, path.id);
    return updated?.points?.length > 4 && updated?.points?.some(point => Math.hypot(point.in?.x || 0, point.in?.y || 0, point.out?.x || 0, point.out?.y || 0) > 0) ? updated : null;
  }, 'round joins persist as editable Bézier geometry');

  outcome = { signedExpansion: true, undo: true, roundJoin: true, mobileTouchTargets: innerWidth <= 820 };
  result.textContent = `PASS\n${JSON.stringify(outcome)}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  if (designId) await deleteStoredDocument(designId).catch(() => {});
}
