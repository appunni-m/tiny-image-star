import {
  addNode, combineBoolean, createComponent, createComponentSet, createDocument, createNode
} from '../src/model.js';
import { deleteStoredDocument, loadDocumentById, saveDocument } from '../src/storage.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = async () => {
      try {
        const value = await test();
        if (value) { resolve(value); return; }
      } catch { /* Let the editor render and its local save queue settle. */ }
      if (performance.now() - started > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(() => { void poll(); }, 35);
    };
    void poll();
  });
}
function click(app, element, message = 'Expected an editor control to exist.') {
  assert(element, message);
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function openMobilePanel(app, panel, toggle) {
  if (!panel.classList.contains('is-open')) click(app, toggle, 'Expected a mobile panel toggle.');
}
function cubicCirclePath(x, y, radius, name) {
  const k = 0.5522847498307936;
  return createNode('path', {
    name, x, y, width: radius * 2, height: radius * 2, closed: true, fillRule: 'nonzero',
    points: [
      { x: .5, y: 0, in: { x: -k / 2, y: 0 }, out: { x: k / 2, y: 0 } },
      { x: 1, y: .5, in: { x: 0, y: -k / 2 }, out: { x: 0, y: k / 2 } },
      { x: .5, y: 1, in: { x: k / 2, y: 0 }, out: { x: -k / 2, y: 0 } },
      { x: 0, y: .5, in: { x: 0, y: k / 2 }, out: { x: 0, y: -k / 2 } }
    ]
  });
}

let designId = null;
try {
  const design = createDocument();
  design.name = `Feature batch smoke ${Date.now()}`;

  const row = createNode('frame', { name: 'Auto layout row', x: 0, y: 0, width: 150, height: 80 });
  row.children.push(
    createNode('rectangle', { name: 'Row one', x: 10, y: 12, width: 30, height: 20 }),
    createNode('rectangle', { name: 'Row two', x: 50, y: 12, width: 30, height: 20 }),
    createNode('rectangle', { name: 'Row three', x: 90, y: 12, width: 30, height: 20 })
  );
  addNode(design, row);

  const rest = createNode('frame', { name: 'Button / State=Rest', x: 0, y: 150, width: 60, height: 30 });
  const hover = createNode('frame', { name: 'Button / State=Hover', x: 80, y: 150, width: 60, height: 30 });
  addNode(design, rest);
  addNode(design, hover);
  const restComponent = createComponent(design, rest.id, rest.name);
  const hoverComponent = createComponent(design, hover.id, hover.name);
  const componentSet = createComponentSet(design, [restComponent.id, hoverComponent.id], 'Button');

  const firstCurve = cubicCirclePath(160, 20, 40, 'Curve base');
  const secondCurve = cubicCirclePath(195, 20, 40, 'Curve overlap');
  addNode(design, firstCurve);
  addNode(design, secondCurve);
  const booleanGroup = combineBoolean(design, [firstCurve.id, secondCurve.id], 'union');

  designId = design.id;
  await saveDocument(design);
  const app = frame.contentDocument;
  await waitFor(() => app?.documentElement.dataset.appReady === 'true', 'editor startup');
  click(app, app.querySelector('#main-menu-button'));
  const designsButton = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('Your designs'));
  click(app, designsButton, 'Expected the local designs menu item.');
  const library = app.querySelector('#design-library-dialog');
  const designRow = await waitFor(() => library.open && library.querySelector(`[data-design-id="${designId}"][data-design-action="open"]`), 'local feature fixture');
  click(app, designRow);
  await waitFor(() => app.querySelector('#document-name')?.value === design.name, 'feature fixture open');

  const leftPanel = app.querySelector('#left-panel');
  const rightPanel = app.querySelector('#right-panel');
  openMobilePanel(app, leftPanel, app.querySelector('#sidebar-toggle'));
  click(app, app.querySelector('.sidebar-tab[data-sidebar-tab="layers"]'));
  click(app, app.querySelector(`.layer-row[data-layer-id="${row.id}"]`), 'Expected the auto-layout fixture row.');
  openMobilePanel(app, rightPanel, app.querySelector('#inspector-toggle'));
  const suggest = await waitFor(() => app.querySelector('[data-action="suggest-auto-layout"]'), 'auto-layout suggestion control');
  assert(!suggest.disabled, 'a clearly aligned mobile row should allow an auto-layout suggestion');
  click(app, suggest);
  const apply = await waitFor(() => app.querySelector('[data-action="apply-auto-layout-suggestion"]'), 'reviewable auto-layout suggestion');
  const applyHeight = apply.getBoundingClientRect().height;
  assert(applyHeight >= 44, `mobile suggestion apply target should be at least 44px high (${applyHeight})`);
  click(app, apply);
  const savedLayout = await waitFor(async () => {
    const current = await loadDocumentById(designId);
    return current?.pages?.[0]?.children?.find(node => node.id === row.id)?.autoLayout || null;
  }, 'applied local auto layout');
  assert(savedLayout.axis === 'horizontal' && savedLayout.columnGap === 10,
    'applying the reviewed suggestion should persist the inferred row layout');

  openMobilePanel(app, leftPanel, app.querySelector('#sidebar-toggle'));
  click(app, app.querySelector('.sidebar-tab[data-sidebar-tab="assets"]'));
  const setCard = await waitFor(() => app.querySelector(`[data-component-set-panel="${componentSet.id}"]`), 'component-set Assets controls');
  const placement = setCard.querySelector('[data-component-set-placement]');
  placement.value = hoverComponent.id;
  placement.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  const placeSelected = setCard.querySelector('.component-set-place-selected');
  const placeHeight = placeSelected.getBoundingClientRect().height;
  assert(placeHeight >= 44, `mobile exact-variant Place target should be at least 44px high (${placeHeight})`);
  click(app, placeSelected);
  const placed = await waitFor(async () => {
    const current = await loadDocumentById(designId);
    return current?.pages?.[0]?.children?.find(node => node.isInstance && node.componentId === hoverComponent.id) || null;
  }, 'instance of the exact selected variant');
  assert(placed.componentId === hoverComponent.id,
    'the Assets selector should place the chosen variant rather than the set’s first variant');

  openMobilePanel(app, leftPanel, app.querySelector('#sidebar-toggle'));
  click(app, app.querySelector('.sidebar-tab[data-sidebar-tab="layers"]'));
  click(app, app.querySelector(`.layer-row[data-layer-id="${booleanGroup.id}"]`), 'Expected the curved Boolean fixture row.');
  openMobilePanel(app, rightPanel, app.querySelector('#inspector-toggle'));
  const bake = await waitFor(() => app.querySelector('[data-action="bake-boolean"]'), 'curve-preserving Boolean bake action');
  assert(app.querySelector('#inspector-content')?.textContent.includes('cubic Bézier paths'),
    'the inspector should describe curve-preserving baking and its exact limitations');
  click(app, bake);
  const baked = await waitFor(async () => {
    const current = await loadDocumentById(designId);
    const node = current?.pages?.[0]?.children?.find(item => item.id === booleanGroup.id);
    return node?.type === 'path' ? node : null;
  }, 'saved editable Bézier path');
  const anchors = [baked.points, ...(baked.subpaths || []).map(contour => contour.points)].flat();
  assert(anchors.some(point => [point.in, point.out].some(handle => handle && Math.hypot(handle.x, handle.y) > 1e-5)),
    'the mobile bake action should preserve editable Bézier handles');

  result.textContent = `PASS\n${JSON.stringify({
    mobileAutoLayoutReviewAndApply: true,
    exactVariantPlacement: true,
    curveBooleanBakeKeepsHandles: true,
    touchTargets44px: true
  })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
} finally {
  if (designId) await deleteStoredDocument(designId).catch(() => {});
}
