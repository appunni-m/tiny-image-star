import { addNode, bindVariable, createComponent, createComponentInstance, createDocument, createNode, createVariable, createVariableCollection } from '../src/model.js';
import { selectionBounds } from '../src/group-transform.js';
import { applyAutoLayout, createAutoLayout } from '../src/layout-engine.js';
import { deleteStoredDocument, loadDocumentById, saveDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try { const value = await test(); if (value) { resolve(value); return; } } catch { /* The editor may still be rendering or saving. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    void poll();
  });
}
function click(app, element, options = {}) {
  assert(element, 'Expected a selection inspector control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }));
}
function setInput(app, selector, value) {
  const input = app.querySelector(selector);
  assert(input, `Expected selection inspector input ${selector}.`);
  input.value = String(value);
  input.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
}
function rootNodes(doc) { return doc.pages.find(page => page.id === doc.activePageId)?.children || []; }
function boundsFor(nodes) { return selectionBounds(nodes.map(node => ({ node, ancestors: [] }))); }

let designId = null;
let outcome;
try {
  const design = createDocument();
  design.name = `Selection inspector smoke ${Date.now()}`;
  const nodes = [
    createNode('rectangle', { name: 'Inspector A', x: -85, y: -45, width: 55, height: 40, fill: '#f24e1e' }),
    createNode('ellipse', { name: 'Inspector B', x: 20, y: 5, width: 70, height: 35, fill: '#0d99ff' }),
    createNode('rectangle', { name: 'Inspector C', x: 125, y: -25, width: 45, height: 75, fill: '#14ae5c' })
  ];
  for (const node of nodes) addNode(design, node);
  const masterFrame = createNode('frame', { name: 'Resizable component', x: -260, y: 190, width: 120, height: 100, fill: '#ffffff' });
  const constrainedChild = createNode('rectangle', {
    name: 'Stretched component child', x: 10, y: 12, width: 80, height: 20, fill: '#9747ff',
    constraints: { horizontal: 'left-right', vertical: 'top' }
  });
  addNode(design, masterFrame);
  addNode(design, constrainedChild, { parentId: masterFrame.id });
  const component = createComponent(design, masterFrame.id, 'Resizable component');
  const instance = createComponentInstance(design, component.id, { x: -105, y: 185 });
  const hugFrame = createNode('frame', {
    name: 'Hug width frame', x: 235, y: 150, width: 150, height: 70, fill: '#ffffff',
    autoLayout: createAutoLayout({ axis: 'horizontal', mainSizing: 'hug', crossSizing: 'fixed', padding: 0, gap: 0 })
  });
  addNode(design, hugFrame);
  addNode(design, createNode('rectangle', { name: 'Hug child', x: 0, y: 0, width: 60, height: 24 }), { parentId: hugFrame.id });
  applyAutoLayout(hugFrame);
  const boundHugFrame = createNode('frame', {
    name: 'Variable-bound Hug frame', x: 420, y: 150, width: 150, height: 70, fill: '#ffffff',
    autoLayout: createAutoLayout({ axis: 'horizontal', mainSizing: 'fixed', crossSizing: 'fixed', padding: 0, gap: 0 })
  });
  addNode(design, boundHugFrame);
  addNode(design, createNode('rectangle', { name: 'Variable Hug child', x: 0, y: 0, width: 60, height: 24 }), { parentId: boundHugFrame.id });
  const layoutVariables = createVariableCollection(design, 'Layout sizing');
  const verticalAxis = createVariable(design, layoutVariables.id, 'Vertical axis', 'string', 'vertical');
  const hugSizing = createVariable(design, layoutVariables.id, 'Hug sizing', 'string', 'hug');
  bindVariable(design, boundHugFrame.id, verticalAxis.id, 'autoLayout.axis');
  bindVariable(design, boundHugFrame.id, hugSizing.id, 'autoLayout.mainSizing');
  designId = design.id;
  await saveDocument(design);

  const app = frame.contentDocument;
  await waitFor(() => app?.documentElement.dataset.appReady === 'true', 'editor startup');
  click(app, app.querySelector('#main-menu-button'));
  const designsMenu = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  click(app, designsMenu);
  const library = app.querySelector('#design-library-dialog');
  const designRow = await waitFor(() => library.open && library.querySelector(`[data-design-id="${designId}"][data-design-action="open"]`), 'seeded local design');
  click(app, designRow);
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'selection fixture open');
  await waitFor(() => nodes.every(node => app.querySelector(`.layer-row[data-layer-id="${node.id}"]`)), 'fixture layers');

  // Make one item differ so the shared opacity control must show a mixed value.
  click(app, app.querySelector(`.layer-row[data-layer-id="${nodes[0].id}"]`));
  setInput(app, '[data-prop="opacity"]', 25);
  await waitFor(async () => (await loadDocumentById(designId))?.pages?.[0]?.children?.find(node => node.id === nodes[0].id)?.opacity === 0.25, 'single-layer opacity save');

  for (const [index, node] of nodes.entries()) {
    click(app, app.querySelector(`.layer-row[data-layer-id="${node.id}"]`), { ctrlKey: index > 0 });
  }
  await waitFor(() => app.querySelectorAll('.layer-row.is-selected[data-layer-id]').length === 3, 'multi-selection');
  assert(app.querySelectorAll('[data-prop^="selection."]').length === 6, 'multi-selection should expose X, Y, width, height, rotation, and opacity controls.');
  assert(app.querySelector('[data-prop="selection.x"]')?.value !== '0', 'selection X should use the actual visual bounds instead of a placeholder.');
  assert(app.querySelector('[data-prop="selection.opacity"]')?.placeholder === 'Mixed', 'different layer opacity values should display as Mixed.');

  let stored = await loadDocumentById(designId);
  let currentNodes = nodes.map(node => stored.pages[0].children.find(item => item.id === node.id));
  let bounds = boundsFor(currentNodes);
  const targetX = bounds.x + 17;
  setInput(app, '[data-prop="selection.x"]', targetX);
  await waitFor(async () => {
    const saved = await loadDocumentById(designId);
    return Math.abs(boundsFor(nodes.map(node => saved.pages[0].children.find(item => item.id === node.id))).x - targetX) < 1e-5;
  }, 'shared X transform');

  stored = await loadDocumentById(designId);
  currentNodes = nodes.map(node => stored.pages[0].children.find(item => item.id === node.id));
  bounds = boundsFor(currentNodes);
  const targetY = bounds.y + 11;
  setInput(app, '[data-prop="selection.y"]', targetY);
  await waitFor(async () => {
    const saved = await loadDocumentById(designId);
    return Math.abs(boundsFor(nodes.map(node => saved.pages[0].children.find(item => item.id === node.id))).y - targetY) < 1e-5;
  }, 'shared Y transform');

  stored = await loadDocumentById(designId);
  currentNodes = nodes.map(node => stored.pages[0].children.find(item => item.id === node.id));
  bounds = boundsFor(currentNodes);
  const targetWidth = bounds.width + 24;
  setInput(app, '[data-prop="selection.width"]', targetWidth);
  await waitFor(async () => {
    const saved = await loadDocumentById(designId);
    return Math.abs(boundsFor(nodes.map(node => saved.pages[0].children.find(item => item.id === node.id))).width - targetWidth) < 1e-4;
  }, 'shared width transform');

  stored = await loadDocumentById(designId);
  currentNodes = nodes.map(node => stored.pages[0].children.find(item => item.id === node.id));
  bounds = boundsFor(currentNodes);
  const targetHeight = bounds.height + 19;
  setInput(app, '[data-prop="selection.height"]', targetHeight);
  await waitFor(async () => {
    const saved = await loadDocumentById(designId);
    return Math.abs(boundsFor(nodes.map(node => saved.pages[0].children.find(item => item.id === node.id))).height - targetHeight) < 1e-4;
  }, 'shared height transform');

  // A mixed rotation edit sets the first layer's angle and preserves each
  // other layer's relative angle while rotating the group together.
  click(app, app.querySelector(`.layer-row[data-layer-id="${nodes[2].id}"]`));
  setInput(app, '[data-prop="rotation"]', 10);
  await waitFor(async () => (await loadDocumentById(designId))?.pages?.[0]?.children?.find(node => node.id === nodes[2].id)?.rotation === 10, 'single-layer rotation save');
  for (const [index, node] of nodes.entries()) click(app, app.querySelector(`.layer-row[data-layer-id="${node.id}"]`), { ctrlKey: index > 0 });
  await waitFor(() => app.querySelector('[data-prop="selection.rotation"]')?.placeholder === 'Mixed', 'mixed rotation display');
  stored = await loadDocumentById(designId);
  currentNodes = nodes.map(node => stored.pages[0].children.find(item => item.id === node.id));
  bounds = boundsFor(currentNodes);
  const rotatedTargetWidth = bounds.width + 21;
  setInput(app, '[data-prop="selection.width"]', rotatedTargetWidth);
  await waitFor(async () => {
    const saved = await loadDocumentById(designId);
    return Math.abs(boundsFor(nodes.map(node => saved.pages[0].children.find(item => item.id === node.id))).width - rotatedTargetWidth) < 1e-4;
  }, 'exact rotated selection width');
  setInput(app, '[data-prop="selection.rotation"]', 20);
  await waitFor(async () => {
    const saved = await loadDocumentById(designId);
    const rotations = nodes.map(node => saved.pages[0].children.find(item => item.id === node.id)?.rotation);
    return rotations.every(rotation => rotation === 20);
  }, 'absolute shared rotation edit');

  setInput(app, '[data-prop="selection.opacity"]', 64);
  await waitFor(async () => {
    const saved = await loadDocumentById(designId);
    return nodes.every(node => saved.pages[0].children.find(item => item.id === node.id)?.opacity === 0.64);
  }, 'shared opacity edit');
  assert(app.querySelector('[data-prop="selection.opacity"]')?.value === '64', 'shared opacity should display the common edited percent.');

  const controls = app.querySelectorAll('.multi-selection-property-grid .property-field');
  assert(controls.length === 6, 'all six shared properties should remain in the compact selection inspector.');

  // A component instance resize should only record actual constraint changes
  // on its direct child, leaving unchanged geometry available to future syncs.
  click(app, app.querySelector(`.layer-row[data-layer-id="${instance.id}"]`));
  click(app, app.querySelector(`.layer-row[data-layer-id="${nodes[0].id}"]`), { ctrlKey: true });
  stored = await loadDocumentById(designId);
  const instanceBefore = stored.pages[0].children.find(node => node.id === instance.id);
  const instanceOther = stored.pages[0].children.find(node => node.id === nodes[0].id);
  const componentBounds = boundsFor([instanceBefore, instanceOther]);
  const componentTargetWidth = componentBounds.width + 17;
  setInput(app, '[data-prop="selection.width"]', componentTargetWidth);
  await waitFor(async () => {
    const saved = await loadDocumentById(designId);
    const resized = saved.pages[0].children.find(node => node.id === instance.id);
    return Math.abs(boundsFor([resized, saved.pages[0].children.find(node => node.id === nodes[0].id)]).width - componentTargetWidth) < 1e-4;
  }, 'component instance group resize');
  stored = await loadDocumentById(designId);
  const savedInstance = stored.pages[0].children.find(node => node.id === instance.id);
  const childOverride = savedInstance.componentOverrides?.[constrainedChild.id];
  assert(childOverride && Object.keys(childOverride).join(',') === 'width', 'a constrained instance child should record only its changed width override.');

  click(app, app.querySelector(`.layer-row[data-layer-id="${hugFrame.id}"]`));
  click(app, app.querySelector(`.layer-row[data-layer-id="${nodes[0].id}"]`), { ctrlKey: true });
  assert(app.querySelector('[data-prop="selection.width"]')?.disabled, 'an auto-layout Hug width should not expose an overwritten shared width edit.');
  assert(!app.querySelector('[data-prop="selection.height"]')?.disabled, 'a fixed auto-layout height should remain editable.');
  click(app, app.querySelector(`.layer-row[data-layer-id="${boundHugFrame.id}"]`));
  click(app, app.querySelector(`.layer-row[data-layer-id="${nodes[0].id}"]`), { ctrlKey: true });
  await waitFor(() => app.querySelectorAll('.layer-row.is-selected[data-layer-id]').length === 2, 'variable-bound Hug multi-selection');
  assert(app.querySelector('[data-prop="selection.height"]')?.disabled, 'a variable-bound vertical main-axis Hug height should not expose an overwritten shared edit.');
  assert(!app.querySelector('[data-prop="selection.width"]')?.disabled, 'a variable-bound vertical cross-axis fixed width should remain editable.');
  outcome = `PASS\n${JSON.stringify({ sharedPosition: true, sharedSize: true, exactRotatedBounds: true, mixedRotation: true, mixedOpacity: true, componentChildOverrides: true, hugSizingDisabled: true, variableBoundHugSizingDisabled: true, inPlaceNodes: 3, savedLocally: true })}`;
} catch (error) {
  outcome = `FAIL\n${error?.stack || error}`;
} finally {
  frame.src = 'about:blank';
  await new Promise(resolve => setTimeout(resolve, 50));
  if (designId) await deleteStoredDocument(designId).catch(() => {});
}
result.textContent = outcome;
