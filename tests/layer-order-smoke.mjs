import { addNode, createDocument, createNode } from '../src/model.js';
import { buildLocalPackageBlob, deleteStoredDocument, loadDocumentById } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
let designId;
let outcome;

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 15000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { if (await test()) { resolve(); return; } } catch { /* Wait for startup or rendering. */ }
      if (performance.now() - start > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 30);
    };
    poll();
  });
}
function names(app) { return [...app.querySelectorAll('#layers-list .layer-row')].filter(row => row.style.paddingLeft === '7px').map(row => row.querySelector('.layer-name').textContent); }
function row(app, name) { return [...app.querySelectorAll('#layers-list .layer-row')].find(item => item.querySelector('.layer-name')?.textContent === name); }
function click(app, element) {
  assert(element, 'Expected a control while opening the saved layer fixture.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function drag(app, source, target, position) {
  const transfer = new app.defaultView.DataTransfer();
  const started = source.dispatchEvent(new app.defaultView.DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  assert(started, 'The source layer should be draggable.');
  const bounds = target.getBoundingClientRect();
  const clientY = position === 'before' ? bounds.top + 1 : bounds.bottom - 1;
  const over = new app.defaultView.DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY });
  target.dispatchEvent(over);
  assert(over.defaultPrevented, 'A valid sibling drop should be accepted.');
  assert(target.classList.contains(position === 'before' ? 'is-drop-before' : 'is-drop-after'), 'The target should show the requested insertion edge.');
  target.dispatchEvent(new app.defaultView.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY }));
}
function key(app, key, { ctrlKey = false, shiftKey = false } = {}) {
  const target = app.activeElement?.closest?.('#layers-list') ? app.activeElement : app.body;
  target.dispatchEvent(new app.defaultView.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ctrlKey, shiftKey }));
}

try {
  const design = createDocument();
  design.name = 'Layer order smoke';
  const bottom = createNode('rectangle', { name: 'Bottom' });
  const middle = createNode('ellipse', { name: 'Middle' });
  const locked = createNode('rectangle', { name: 'Locked', locked: true });
  const top = createNode('rectangle', { name: 'Top' });
  const frameNode = createNode('frame', { name: 'Container', locked: true });
  const nestedGroup = createNode('group', { name: 'Unlocked nested group' });
  const nestedTop = createNode('text', { name: 'Nested top' });
  const nestedBottom = createNode('rectangle', { name: 'Nested bottom' });
  addNode(design, bottom); addNode(design, middle); addNode(design, locked); addNode(design, top); addNode(design, frameNode);
  addNode(design, nestedGroup, { parentId: frameNode.id });
  addNode(design, nestedBottom, { parentId: nestedGroup.id }); addNode(design, nestedTop, { parentId: nestedGroup.id });
  designId = design.id;
  frame.style.width = '390px'; frame.style.height = '844px';
  const app = frame.contentDocument;
  await waitFor(() => app?.documentElement.dataset.appReady === 'true'
    && app.defaultView.innerWidth === 390 && app.defaultView.innerHeight === 844, 'phone-sized editor viewport');
  const input = app.querySelector('#open-file-input');
  const packageTransfer = new app.defaultView.DataTransfer();
  packageTransfer.items.add(new app.defaultView.File([buildLocalPackageBlob(design, [])], 'layer-order-smoke.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: packageTransfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(() => app.querySelector('#document-name')?.value === design.name && app.querySelector('.workspace')?.inert === false, 'layer fixture import');
  app.querySelector('#sidebar-toggle').click();
  await waitFor(() => app.querySelector('#left-panel').classList.contains('is-open'), 'phone Layers panel');
  assert(names(app).join(',') === 'Container,Top,Locked,Middle,Bottom', `unexpected initial top-level layer order: ${names(app).join(',')}`);
  const tree = app.querySelector('#layers-list');
  assert(tree.getAttribute('role') === 'tree' && tree.querySelector('[data-layer-id="' + frameNode.id + '"]')?.getAttribute('aria-expanded') === 'true',
    'the layer panel should expose an expanded accessible treeitem for containers.');
  assert([...tree.querySelectorAll('[role="treeitem"]')].filter(item => item.tabIndex === 0).length === 1,
    'the layer tree should have exactly one roving tab stop.');
  const containerRow = row(app, 'Container');
  assert(containerRow.getAttribute('aria-level') === '1' && row(app, 'Nested top').getAttribute('aria-level') === '3',
    'treeitems should report their nesting depth.');
  containerRow.focus();
  assert(app.activeElement === containerRow, 'The open mobile layer tree should accept keyboard focus.');
  key(app, 'End');
  assert(app.activeElement === row(app, 'Bottom'), 'End should focus the last visible treeitem.');
  key(app, 'Home');
  assert(app.activeElement === containerRow, 'Home should focus the first visible treeitem.');
  containerRow.querySelector('[data-action="layer-toggle"]').click();
  assert(row(app, 'Container').getAttribute('aria-expanded') === 'false' && !row(app, 'Nested top'), 'the disclosure control should collapse descendants.');
  key(app, 'ArrowRight');
  assert(row(app, 'Nested top') && row(app, 'Container').getAttribute('aria-expanded') === 'true', 'ArrowRight should expand a focused container.');
  const topRow = row(app, 'Top');
  topRow.focus();
  const xBefore = app.querySelector('[data-prop="selection.x"]')?.value;
  key(app, 'ArrowRight');
  assert(app.activeElement === topRow && app.querySelector('[data-prop="selection.x"]')?.value === xBefore,
    'tree navigation keys on a focused row must not nudge the canvas selection.');
  key(app, 'F10', { shiftKey: true });
  const layerMenu = app.querySelector('#context-menu');
  const layerMenuButton = topRow.querySelector('[data-action="layer-actions-menu"]');
  assert(!layerMenu.hidden && layerMenu.contains(app.activeElement) && layerMenuButton.getAttribute('aria-expanded') === 'true',
    'Shift+F10 should open the focused row action menu and move focus into it.');
  key(app, 'Escape');
  assert(layerMenu.hidden && app.activeElement === layerMenuButton && layerMenuButton.getAttribute('aria-expanded') === 'false',
    'Escape should close the keyboard-opened row menu and restore focus.');
  row(app, 'Unlocked nested group').querySelector('[data-action="layer-toggle"]').click();
  row(app, 'Container').querySelector('[data-action="layer-toggle"]').click();
  app.querySelector('#search-layers').click();
  const searchInput = app.querySelector('#layer-search');
  searchInput.value = 'nested';
  searchInput.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  assert(row(app, 'Container')?.getAttribute('aria-expanded') === 'true'
    && row(app, 'Unlocked nested group')?.getAttribute('aria-expanded') === 'true'
    && row(app, 'Nested top') && row(app, 'Nested bottom'),
  'search should reveal matching descendants even when the collapsed parent also matches the query.');
  searchInput.value = '';
  searchInput.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  assert(row(app, 'Container')?.getAttribute('aria-expanded') === 'false' && !row(app, 'Unlocked nested group'),
    'clearing search should restore the user’s prior collapse state.');
  assert(row(app, 'Bottom')?.draggable, 'layer rows should expose native drag support.');

  const control = (name, direction) => row(app, name)?.querySelector(`[data-action="layer-move-${direction}"]`);
  assert(control('Container', 'up')?.disabled, 'the visible first row must not move above the sibling boundary.');
  assert(control('Bottom', 'down')?.disabled, 'the visible last row must not move below the sibling boundary.');
  assert(control('Top', 'down')?.disabled && control('Middle', 'up')?.disabled,
    'a layer must not move across an adjacent locked sibling.');
  assert(control('Locked', 'up')?.disabled && control('Locked', 'down')?.disabled,
    'a locked layer must not expose enabled row-order actions.');

  row(app, 'Bottom').dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => row(app, 'Bottom')?.getAttribute('aria-selected') === 'true', 'selected phone layer');
  const moveUp = control('Bottom', 'up');
  const upBox = moveUp.getBoundingClientRect();
  assert(!moveUp.disabled && upBox.width >= 40 && upBox.height >= 40, 'the selected layer’s up control must be enabled and touch-sized.');
  moveUp.click();
  await waitFor(() => names(app).join(',') === 'Container,Top,Locked,Bottom,Middle', 'phone move layer up');
  assert(row(app, 'Bottom')?.getAttribute('aria-selected') === 'true', 'the moved layer should stay selected.');
  key(app, 'z', { ctrlKey: true });
  await waitFor(() => names(app).join(',') === 'Container,Top,Locked,Middle,Bottom', 'undo phone row move');
  key(app, 'z', { ctrlKey: true, shiftKey: true });
  await waitFor(() => names(app).join(',') === 'Container,Top,Locked,Bottom,Middle', 'redo phone row move');
  const moveDown = control('Bottom', 'down');
  const downBox = moveDown.getBoundingClientRect();
  assert(!moveDown.disabled && downBox.width >= 40 && downBox.height >= 40, 'the selected layer’s down control must be enabled and touch-sized.');
  moveDown.click();
  await waitFor(() => names(app).join(',') === 'Container,Top,Locked,Middle,Bottom', 'phone move layer down');

  drag(app, row(app, 'Bottom'), row(app, 'Middle'), 'before');
  await waitFor(() => names(app).join(',') === 'Container,Top,Locked,Bottom,Middle', 'sibling reordering');
  assert(!app.querySelector('.layer-row.is-dragging, .layer-row.is-drop-before, .layer-row.is-drop-after'), 'drag styling should clear after the drop.');

  // Cross-container moves are ignored; this increment reorders only siblings.
  row(app, 'Container').querySelector('[data-action="layer-toggle"]').click();
  row(app, 'Unlocked nested group').querySelector('[data-action="layer-toggle"]').click();
  const source = row(app, 'Bottom'); const target = row(app, 'Nested top'); const transfer = new app.defaultView.DataTransfer();
  source.dispatchEvent(new app.defaultView.DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  const targetBounds = target.getBoundingClientRect();
  const invalidDrop = new app.defaultView.DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: targetBounds.top + 1 });
  target.dispatchEvent(invalidDrop);
  assert(!invalidDrop.defaultPrevented && !target.classList.contains('is-drop-before'), 'a layer from another container must not be offered as a reorder target.');
  source.dispatchEvent(new app.defaultView.DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));

  const nestedSource = row(app, 'Nested top');
  const lockedAncestorTransfer = new app.defaultView.DataTransfer();
  const lockedAncestorDrag = new app.defaultView.DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: lockedAncestorTransfer });
  assert(!nestedSource.dispatchEvent(lockedAncestorDrag), 'a layer under a locked ancestor must not start a drag.');
  assert(control('Nested top', 'up')?.disabled && control('Nested top', 'down')?.disabled,
    'row-order controls must stay disabled throughout a locked ancestor chain.');

  key(app, 'z', { ctrlKey: true });
  await waitFor(() => names(app).join(',') === 'Container,Top,Locked,Middle,Bottom', 'undo of layer reorder');
  key(app, 'z', { ctrlKey: true, shiftKey: true });
  await waitFor(() => names(app).join(',') === 'Container,Top,Locked,Bottom,Middle', 'redo of layer reorder');
  await waitFor(async () => (await loadDocumentById(designId))?.pages[0].children.map(node => node.name).join(',') === 'Middle,Bottom,Locked,Top,Container', 'saved layer order');
  outcome = `PASS\n${JSON.stringify({ phoneViewport: '390x844', rowMoveUpDown: true, touchSizedControls: true, lockedLayerAndNeighborDisabled: true, siblingBoundariesDisabled: true, buttonMoveUndoRedo: true, siblingDragReorder: true, reversedStackOrder: true, crossContainerRejected: true, lockedAncestorDragRejected: true, lockedAncestorButtonsDisabled: true, undo: true, redo: true, savedLayerOrder: true })}`;
} catch (error) {
  outcome = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  if (designId) await deleteStoredDocument(designId).catch(() => {});
}
result.textContent = outcome;
