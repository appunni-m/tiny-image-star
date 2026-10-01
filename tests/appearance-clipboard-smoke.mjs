import { addNode, bindColorVariable, bindVariable, createColorVariable, createDocument, createFillLayer, createLayerEffect, createNode, createVariable, createVariableCollection } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { deleteStoredDocument, loadDocumentById, saveDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
let designId = null;

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 18000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } }
      catch { /* Allow local restore and save work to finish. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    void poll();
  });
}
function click(app, element) {
  assert(element, 'Expected a Tiny Image Star control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function keydown(app, key, options = {}) {
  const event = new app.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...options });
  app.body.dispatchEvent(event);
  return event;
}
function nodeById(doc, id) {
  for (const page of doc?.pages || []) {
    const pending = [...(page.children || [])];
    while (pending.length) {
      const node = pending.shift();
      if (node.id === id) return node;
      pending.unshift(...(node.children || []));
    }
  }
  return null;
}
async function savedNode(id, label) {
  return waitFor(async () => {
    const node = nodeById(await loadDocumentById(designId), id);
    return node && (await label(node)) ? node : null;
  }, label.toString());
}
function openLayerMenu(app, id) {
  const button = app.querySelector(`.layer-row[data-layer-id="${id}"] [data-action="layer-actions-menu"]`);
  click(app, button);
  return app.querySelector('#context-menu');
}
function menuAction(app, label) {
  return [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.trim().startsWith(label));
}
function selectLayer(app, id, { additive = false } = {}) {
  const row = app.querySelector(`.layer-row[data-layer-id="${id}"]`);
  assert(row, `Expected layer row ${id}.`);
  row.dispatchEvent(new app.defaultView.MouseEvent('click', {
    bubbles: true, cancelable: true, button: 0, ctrlKey: additive
  }));
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  const design = createDocument();
  design.name = `Appearance clipboard smoke ${Date.now()}`;

  const source = createNode('rectangle', {
    name: 'Source card', x: -150, y: -20, width: 96, height: 64, opacity: 0.42, visible: true,
    blendMode: 'multiply', radius: 9,
    fills: [createFillLayer('solid', { color: '#b52649', opacity: 0.85 })],
    strokes: [createStroke({ color: '#f7bd38', width: 3, opacity: 0.9, join: 'round' })],
    effects: [createLayerEffect('drop-shadow', { offsetX: 4, offsetY: 6, blur: 8, opacity: 0.3 })]
  });
  const first = createNode('rectangle', {
    name: 'First target', x: 10, y: -20, width: 72, height: 48, opacity: 1, visible: false,
    blendMode: 'normal', radius: 0, fill: '#2648b5'
  });
  const second = createNode('rectangle', {
    name: 'Second target', x: 100, y: -20, width: 84, height: 54, opacity: 0.8,
    blendMode: 'screen', radius: 2, fill: '#328b63'
  });
  const textSource = createNode('text', {
    name: 'Heading source', x: -130, y: 100, width: 190, height: 45, text: 'Source heading',
    fontFamily: 'Inter, Arial, sans-serif', fontSize: 28, fontWeight: 700, fontStyle: 'italic',
    lineHeight: 1.3, letterSpacing: 1.2, color: '#234b87', align: 'center'
  });
  const textTarget = createNode('text', {
    name: 'Heading target', x: 100, y: 100, width: 210, height: 52, text: 'Keep this target text',
    fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 400, color: '#333333', align: 'left',
    textRuns: [{ text: 'Keep this ', color: '#ac2637' }, { text: 'target text', fontWeight: 500 }]
  });
  const boundSource = createNode('rectangle', {
    name: 'Bound source', x: -160, y: 220, width: 56, height: 46, opacity: 0.17, fill: '#ffffff'
  });
  const boundTarget = createNode('rectangle', {
    name: 'Bound target', x: -70, y: 220, width: 66, height: 52, opacity: 0.84, fill: '#ffffff'
  });
  const variableCollection = createVariableCollection(design, 'Copy properties');
  const opacityVariable = createVariable(design, variableCollection.id, 'Source opacity', 'number', 0.63);
  const targetOpacityVariable = createVariable(design, variableCollection.id, 'Target opacity', 'number', 0.91);
  const fillVariable = createColorVariable(design, variableCollection.id, 'Source color', '#0e8aab');
  for (const node of [source, first, second, textSource, textTarget, boundSource, boundTarget]) addNode(design, node);
  assert(bindVariable(design, boundSource.id, opacityVariable.id, 'opacity'), 'The source opacity variable should bind.');
  assert(bindVariable(design, boundTarget.id, targetOpacityVariable.id, 'opacity'), 'The target opacity variable should bind.');
  assert(bindColorVariable(design, boundSource.id, fillVariable.id, 'fill'), 'The source color variable should bind.');
  designId = design.id;
  await saveDocument(design);

  click(app, app.querySelector('#main-menu-button'));
  click(app, [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs')));
  const dialog = app.querySelector('#design-library-dialog');
  const open = await waitFor(() => dialog.open && dialog.querySelector(`[data-design-id="${designId}"][data-design-action="open"]`), 'fixture in local designs');
  click(app, open);
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'appearance fixture open');

  openLayerMenu(app, source.id);
  const copyProperties = menuAction(app, 'Copy properties');
  assert(copyProperties, 'The layer menu should expose Copy properties.');
  assert(copyProperties.textContent.includes('⌥⌘C') || copyProperties.textContent.includes('Ctrl+Alt+C'), 'The menu should document the platform property-copy shortcut.');
  assert(copyProperties.getBoundingClientRect().height >= 44, 'Property copy should remain finger-sized in the mobile layer menu.');
  click(app, copyProperties);

  selectLayer(app, first.id);
  selectLayer(app, second.id, { additive: true });
  const multiMenu = openLayerMenu(app, second.id);
  const pasteProperties = menuAction(app, 'Paste properties');
  assert(pasteProperties && !pasteProperties.disabled, 'A copied appearance should be available to the selected targets.');
  assert(pasteProperties.getBoundingClientRect().height >= 44, 'Property paste should remain finger-sized in the mobile layer menu.');
  click(app, pasteProperties);
  await savedNode(first.id, node => node.opacity === source.opacity && node.blendMode === source.blendMode && node.radius === source.radius);
  let stored = await loadDocumentById(designId);
  const firstSaved = nodeById(stored, first.id);
  const secondSaved = nodeById(stored, second.id);
  assert(firstSaved && secondSaved, 'Both selected targets should persist.');
  for (const [target, original] of [[firstSaved, first], [secondSaved, second]]) {
    assert(target.opacity === source.opacity && target.blendMode === source.blendMode, `${original.name} should receive common appearance values.`);
    assert(target.fills?.[0]?.color === '#b52649' && target.strokes?.[0]?.color === '#f7bd38', `${original.name} should receive ordered fill and stroke appearance.`);
    assert(target.effects?.[0]?.type === 'drop-shadow' && target.radius === source.radius, `${original.name} should receive effects and corner radius.`);
    assert(target.name === original.name && target.x === original.x && target.y === original.y
      && target.width === original.width && target.height === original.height && target.visible === original.visible,
    `${original.name} identity, geometry, and visibility must stay unchanged.`);
  }
  assert(firstSaved.fills[0].id !== source.fills[0].id && secondSaved.fills[0].id !== firstSaved.fills[0].id,
    'Each pasted paint stack should receive independent IDs.');
  assert(multiMenu.hidden, 'Using a context-menu action should close the menu after applying properties.');

  const undoEvent = keydown(app, 'z', { ctrlKey: true });
  assert(undoEvent.defaultPrevented, 'One undo should reverse the multi-target paste.');
  await savedNode(first.id, node => node.opacity === first.opacity && node.blendMode === first.blendMode && node.radius === first.radius);
  stored = await loadDocumentById(designId);
  assert(nodeById(stored, second.id).opacity === second.opacity && nodeById(stored, second.id).fill === second.fill,
    'Undo should restore every target from the same paste transaction.');

  selectLayer(app, source.id);
  const copyShortcut = keydown(app, 'c', { ctrlKey: true, altKey: true });
  assert(copyShortcut.defaultPrevented, 'Ctrl+Alt+C should copy properties without invoking layer copy.');
  selectLayer(app, first.id);
  const pasteShortcut = keydown(app, 'v', { ctrlKey: true, altKey: true });
  assert(pasteShortcut.defaultPrevented, 'Ctrl+Alt+V should paste properties without invoking native/layer paste.');
  await savedNode(first.id, node => node.opacity === source.opacity && node.blendMode === source.blendMode);

  openLayerMenu(app, textSource.id);
  click(app, menuAction(app, 'Copy properties'));
  selectLayer(app, textTarget.id);
  const textPasteShortcut = keydown(app, 'v', { ctrlKey: true, altKey: true });
  assert(textPasteShortcut.defaultPrevented, 'Text appearance should use the same property-paste shortcut.');
  await savedNode(textTarget.id, node => node.fontSize === textSource.fontSize && node.fontWeight === textSource.fontWeight);
  stored = await loadDocumentById(designId);
  const storedTextTarget = nodeById(stored, textTarget.id);
  assert(storedTextTarget.text === textTarget.text && JSON.stringify(storedTextTarget.textRuns) === JSON.stringify(textTarget.textRuns),
    'Text styling should preserve the target content and rich-text runs.');
  assert(storedTextTarget.fontFamily === textSource.fontFamily && storedTextTarget.fontSize === textSource.fontSize
    && storedTextTarget.fontWeight === textSource.fontWeight && storedTextTarget.color === textSource.color,
  'Text appearance should update its base typography and color.');

  openLayerMenu(app, boundSource.id);
  click(app, menuAction(app, 'Copy properties'));
  selectLayer(app, boundTarget.id);
  const boundPaste = keydown(app, 'v', { ctrlKey: true, altKey: true });
  assert(boundPaste.defaultPrevented, 'Bound properties should paste through the property shortcut.');
  await savedNode(boundTarget.id, node => node.opacity === 0.63 && node.variableBindings?.opacity === undefined);
  stored = await loadDocumentById(designId);
  const storedBoundSource = nodeById(stored, boundSource.id);
  const storedBoundTarget = nodeById(stored, boundTarget.id);
  assert(storedBoundTarget.opacity === 0.63 && storedBoundTarget.fills?.[0]?.color === '#0e8aab',
    'Copy properties should use the source’s resolved variable values.');
  assert(!storedBoundTarget.variableBindings?.opacity && !storedBoundTarget.fillVariableId,
    'Paste should detach destination bindings that would override the copied visual values.');
  assert(storedBoundSource.variableBindings?.opacity === opacityVariable.id && storedBoundSource.fillVariableId === fillVariable.id,
    'Copying a variable-bound source must leave its bindings untouched.');

  result.textContent = `PASS\n${JSON.stringify({ contextMenuCopyAndPaste: true, multiSelectionPaste: true, independentPaintIds: true, geometryAndVisibilityPreserved: true, oneStepUndo: true, keyboardPropertyShortcuts: true, textContentAndRunsPreserved: true, textTypographyCopied: true, resolvedVariableValuesCopied: true, destinationBindingsDetached: true })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  if (designId) await deleteStoredDocument(designId).catch(() => {});
}
