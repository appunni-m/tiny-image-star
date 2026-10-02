import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addNode, combineBoolean, createComponent, createComponentInstance, createComponentProperty, createDocument, createMaskGroup, createNode, findNode, parseDocument, releaseMaskGroup, serializeDocument, setComponentSlotContent, syncAllComponentInstances, validateDocument } from '../src/model.js';
import { layerDeleteTargets, layerMenuDeleteTargets, removeLayersAtomically } from '../src/layer-deletion.js';
import { hitTestPage } from '../src/renderer.js';
import { applyAutoLayout, createAutoLayout } from '../src/layout-engine.js';

const editorSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('keyboard delete prefers a focused unselected layer and preserves an active multi-selection', () => {
  const selectedIds = ['selected-a', 'selected-b'];

  assert.deepEqual(layerDeleteTargets(selectedIds, 'focused-unselected'), ['focused-unselected']);
  assert.deepEqual(layerDeleteTargets(selectedIds, 'selected-b'), selectedIds);
  assert.deepEqual(layerDeleteTargets(selectedIds, null), selectedIds);
  assert.deepEqual(layerDeleteTargets([], 'focused-layer'), ['focused-layer']);
  assert.deepEqual(layerDeleteTargets(['selected-a', 'selected-a'], null), ['selected-a']);
});

test('a layer menu keeps its opening selection as the delete target', () => {
  const selectedIds = ['selected-a', 'selected-b'];

  assert.deepEqual(layerMenuDeleteTargets(selectedIds, 'selected-b'), selectedIds,
    'opening a menu on a selected row keeps the multi-selection');
  assert.deepEqual(layerMenuDeleteTargets(selectedIds, 'menu-layer'), ['menu-layer'],
    'opening a menu on an unselected row makes that row the stable delete target');
  assert.deepEqual(layerMenuDeleteTargets([], 'menu-layer'), ['menu-layer']);
});

test('Delete and Backspace always delete the selected layer; vector anchors use the explicit inspector action', () => {
  const keydown = editorSource.slice(editorSource.indexOf('function onKeyDown(event) {'));
  assert.match(keydown, /if \(key === 'delete' \|\| key === 'backspace'\) \{[\s\S]*?deleteSelected\(targetIds\); return;/,
    'layer deletion keyboard handling should not be intercepted by vector anchor selection');
  assert.doesNotMatch(keydown, /deleteSelectedVectorPoint\(\)/,
    'vector point deletion stays on its explicit inspector action');
});

test('every layer delete entry point cancels an in-flight canvas gesture before taking its target snapshot', () => {
  const start = editorSource.indexOf('function deleteSelected(selectionIds = null) {');
  const end = editorSource.indexOf('\nfunction copySelected()', start);
  assert.ok(start >= 0 && end > start, 'the shared delete command should have a bounded implementation');
  const command = editorSource.slice(start, end);
  assert.match(command, /if \(state\.interaction\) cancelCanvasInteraction\(\{ pointerId: state\.interaction\.pointerId \}\);[\s\S]*?const ids = pageId \? rootSelectedIds\(selectionIds \?\? state\.selectedIds\)/,
    'deleting from the Inspector, layer row, context menu, or keyboard must not leave a rollback that restores the layer');
});

test('vector inspector explains separate layer and anchor deletion actions', () => {
  assert.match(editorSource, /data-action="delete-vector-point"[\s\S]*?Delete or Backspace removes the layer/,
    'anchor editing should leave a clear, layer-level keyboard deletion path');
});

test('vector point deletion tells users that the layer remains and where to delete it', () => {
  const start = editorSource.indexOf('function deleteSelectedPathAnchors(');
  const end = editorSource.indexOf('\nfunction unrotateForPath', start);
  assert.ok(start >= 0 && end > start, 'vector point deletion should have a bounded implementation');
  const command = editorSource.slice(start, end);
  assert.match(command, /Vector point deleted; the layer remains\. Use Layers → ⋯ → Delete to remove the full layer/,
    'single-anchor deletion must distinguish point removal from deleting its layer');
  assert.match(command, /vector anchors deleted; the layer remains\. Use Layers → ⋯ → Delete to remove the full layer/,
    'multi-anchor deletion must also make the retained layer explicit');
});

test('a canvas body hit exits vector-anchor editing before the next Delete key', () => {
  const start = editorSource.indexOf('function onCanvasPointerDown(event) {');
  const end = editorSource.indexOf('\nfunction updateDraftShapeGeometry', start);
  assert.ok(start >= 0 && end > start, 'canvas pointer handling should have a bounded function body');
  const handler = editorSource.slice(start, end);
  const anchorHit = handler.indexOf('const vectorControl = vectorPathControlAt(world, event.pointerType);');
  const layerHit = handler.indexOf('    if (hit) {', anchorHit);
  const nextBranch = handler.indexOf('\n    const previousSelection', layerHit);
  assert.ok(anchorHit >= 0 && layerHit > anchorHit && nextBranch > layerHit,
    'anchor handles should be resolved before ordinary layer-body hits');
  assert.match(handler.slice(layerHit, nextBranch), /clearVectorAnchorSelection\(\);[\s\S]*?if \(event\.shiftKey\)/,
    'a normal layer-body hit should clear a stale anchor so Delete removes the layer');
});

test('the design canvas retries empty-space picks against clipped overflow geometry', () => {
  const start = editorSource.indexOf('function onCanvasPointerDown(event) {');
  const end = editorSource.indexOf('\nfunction updateDraftShapeGeometry', start);
  assert.ok(start >= 0 && end > start, 'canvas pointer handling should have a bounded function body');
  const handler = editorSource.slice(start, end);
  assert.match(handler, /const hit = hitTestPage\(page, world, hitTester, state\.document, null, state\.zoom, \{ allowAnyClippedNodes: true \}\)/,
    'canvas picking should include clipped overflow in the same stacking-order pass');
  assert.doesNotMatch(handler, /hitTestPage\(page, world, hitTester, state\.document, null, state\.zoom\)\s*\|\|/,
    'a visible sibling must not short-circuit a higher overflow child');
});

test('canvas context menus can target clipped overflow layers for layer actions', () => {
  const start = editorSource.indexOf("canvas.addEventListener('contextmenu', event => {");
  const end = editorSource.indexOf("canvasScroll.addEventListener('dragover'", start);
  assert.ok(start >= 0 && end > start, 'canvas context-menu handling should have a bounded event handler');
  const handler = editorSource.slice(start, end);
  assert.match(handler, /const hit = hitTestPage\(page, world, hitTester, state\.document, null, state\.zoom, \{ allowAnyClippedNodes: true \}\)/,
    'canvas right-click should resolve visible and overflow targets in the same stacking-order pass');
  assert.doesNotMatch(handler, /hitTestPage\(page, world, hitTester, state\.document, null, state\.zoom\)\s*\|\|/,
    'a visible sibling must not short-circuit context-menu targeting for a higher overflow child');
  assert.match(handler, /if \(hit\) openNodeMenu\(hit\.id,/,
    'right-clicking an overflow layer should open that layer’s action menu, including Delete');
});

test('layer deletion removes selections from a new valid document', () => {
  const document = createDocument();
  const first = createNode('rectangle', { name: 'First' });
  const second = createNode('ellipse', { name: 'Second' });
  addNode(document, first);
  addNode(document, second);

  const result = removeLayersAtomically(document, [first.id, second.id, first.id]);

  assert.equal(findNode(result.document, first.id), null);
  assert.equal(findNode(result.document, second.id), null);
  assert.ok(findNode(document, first.id), 'the active document is left untouched until deletion succeeds');
  assert.deepEqual(result.removedIds, [first.id, second.id]);
});

test('deleting one of the final two Boolean operands preserves the survivor and leaves a valid document', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 80, y: 40, width: 300, height: 240 });
  const removeMe = createNode('rectangle', { x: 12, y: 28, width: 90, height: 70, rotation: 14, name: 'Remove operand' });
  const keepMe = createNode('ellipse', { x: 138, y: 76, width: 52, height: 48, rotation: -9, name: 'Keep operand' });
  addNode(document, frame);
  addNode(document, removeMe, { parentId: frame.id });
  addNode(document, keepMe, { parentId: frame.id });
  const booleanGroup = combineBoolean(document, [removeMe.id, keepMe.id]);
  booleanGroup.rotation = 27;

  const result = removeLayersAtomically(document, [removeMe.id]);
  const remaining = findNode(result.document, keepMe.id);

  assert.equal(findNode(result.document, removeMe.id), null, 'the selected Boolean operand is removed');
  assert.ok(remaining, 'the unselected Boolean source remains as a layer');
  assert.equal(remaining.parent.id, frame.id, 'separating the Boolean restores source layers to their parent');
  assert.equal(remaining.node.type, 'ellipse');
  assert.equal(findNode(result.document, booleanGroup.id), null, 'an invalid one-operand Boolean wrapper is not left behind');
  assert.equal(validateDocument(parseDocument(serializeDocument(result.document))), true);
  assert.ok(findNode(document, booleanGroup.id), 'the original document stays untouched before commit');
});

test('deleting a Boolean operand in a component master updates its instances', () => {
  const document = createDocument();
  const componentFrame = createNode('frame', { name: 'Card component' });
  const removeMe = createNode('rectangle', { name: 'Remove operand' });
  const keepMe = createNode('ellipse', { name: 'Keep operand' });
  addNode(document, componentFrame);
  addNode(document, removeMe, { parentId: componentFrame.id });
  addNode(document, keepMe, { parentId: componentFrame.id });
  const booleanGroup = combineBoolean(document, [removeMe.id, keepMe.id]);
  const component = createComponent(document, componentFrame.id, 'Card component');
  const instance = createComponentInstance(document, component.id);

  const result = removeLayersAtomically(document, [removeMe.id]);
  const updatedInstance = findNode(result.document, instance.id).node;

  assert.equal(findNode(result.document, removeMe.id), null);
  assert.equal(findNode(result.document, booleanGroup.id), null);
  assert.equal(findNode(result.document, keepMe.id).parent.id, componentFrame.id);
  assert.equal(updatedInstance.children.length, 1);
  assert.equal(updatedInstance.children[0].type, 'ellipse');
  assert.equal(validateDocument(parseDocument(serializeDocument(result.document))), true);
});

test('deleting a final Boolean operand inside a component instance reports how to proceed', () => {
  const document = createDocument();
  const componentFrame = createNode('frame', { name: 'Card component' });
  const removeMe = createNode('rectangle', { name: 'Remove operand' });
  const keepMe = createNode('ellipse', { name: 'Keep operand' });
  addNode(document, componentFrame);
  addNode(document, removeMe, { parentId: componentFrame.id });
  addNode(document, keepMe, { parentId: componentFrame.id });
  combineBoolean(document, [removeMe.id, keepMe.id]);
  const component = createComponent(document, componentFrame.id, 'Card component');
  const instance = createComponentInstance(document, component.id);
  const instanceOperand = findNode(document, instance.id).node.children[0].children[0];

  assert.throws(() => removeLayersAtomically(document, [instanceOperand.id]),
    /Detach this component instance before deleting one of the final two Boolean operands/);
  assert.ok(findNode(document, instanceOperand.id), 'a refused structural edit leaves the source instance intact');
});

test('the editor does not rerun component sync after installing the validated delete candidate', () => {
  const start = editorSource.indexOf('function deleteSelected(selectionIds = null) {');
  const end = editorSource.indexOf('\nfunction copySelected()', start);
  assert.ok(start >= 0 && end > start, 'the shared delete command should have a bounded implementation');
  assert.match(editorSource.slice(start, end), /removeLayersAtomically\(state\.document, ids, pageId\)/);
  assert.match(editorSource.slice(start, end), /queueSave\(\{ syncComponents: false \}\)/,
    'the validated candidate already includes the component projection, so autosave must not restore a removed instance layer');
  assert.match(editorSource, /function queueSave\(\{ refreshLayerTree = true, syncComponents = true \} = \{\}\)[\s\S]*?if \(syncComponents && syncAllComponentInstances\(state\.document\)\)/,
    'other edits keep the normal component synchronization behavior');
});

test('deleting from an auto-layout frame closes the gap and updates hug-content size', () => {
  const document = createDocument();
  const frame = createNode('frame', {
    name: 'Hugging row', width: 300, height: 120,
    autoLayout: createAutoLayout({ axis: 'horizontal', columnGap: 8, padding: 16, mainSizing: 'hug', crossSizing: 'hug' })
  });
  const first = createNode('rectangle', { name: 'Delete me', width: 40, height: 20 });
  const second = createNode('rectangle', { name: 'Keep me', width: 40, height: 20 });
  addNode(document, frame);
  addNode(document, first, { parentId: frame.id });
  addNode(document, second, { parentId: frame.id });
  applyAutoLayout(frame);
  assert.deepEqual({ width: frame.width, height: frame.height, firstX: first.x, secondX: second.x }, {
    width: 120, height: 52, firstX: 16, secondX: 64
  });

  const result = removeLayersAtomically(document, [first.id]);
  const updatedFrame = findNode(result.document, frame.id).node;
  const remaining = findNode(result.document, second.id).node;
  assert.equal(findNode(result.document, first.id), null);
  assert.deepEqual({ width: updatedFrame.width, height: updatedFrame.height, remainingX: remaining.x }, {
    width: 72, height: 52, remainingX: 16
  }, 'the remaining child moves into place and the auto-layout frame hugs it');
  assert.equal(validateDocument(parseDocument(serializeDocument(result.document))), true);
});

test('deleting the last child shrinks a hug-content auto-layout frame to its padding', () => {
  const document = createDocument();
  const frame = createNode('frame', {
    width: 200, height: 100,
    autoLayout: createAutoLayout({ axis: 'horizontal', padding: 12, mainSizing: 'hug', crossSizing: 'hug' })
  });
  const child = createNode('rectangle', { width: 30, height: 18 });
  addNode(document, frame);
  addNode(document, child, { parentId: frame.id });
  applyAutoLayout(frame);
  assert.deepEqual({ width: frame.width, height: frame.height }, { width: 54, height: 42 });

  const result = removeLayersAtomically(document, [child.id]);
  const updatedFrame = findNode(result.document, frame.id).node;
  assert.deepEqual(updatedFrame.children, []);
  assert.deepEqual({ width: updatedFrame.width, height: updatedFrame.height }, { width: 24, height: 24 });
  assert.equal(validateDocument(result.document), true);
});

test('a deselected overflow child can be picked and deleted without removing its clipping frame', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 20, y: 20, width: 100, height: 100, clip: true });
  const child = createNode('rectangle', { x: 120, y: 10, width: 40, height: 40, fill: '#ff0000', stroke: null, strokeWidth: 0 });
  addNode(document, frame);
  addNode(document, child, { parentId: frame.id });
  const outsidePoint = { x: 150, y: 40 };

  assert.equal(hitTestPage(document.pages[0], outsidePoint, null, document), null,
    'ordinary picking continues to respect the frame clip');
  const picked = hitTestPage(document.pages[0], outsidePoint, null, document, null, 1, { allowAnyClippedNodes: true });
  assert.equal(picked?.id, child.id, 'an overflow child remains reachable after its selection is cleared');
  const result = removeLayersAtomically(document, [picked.id]);

  assert.equal(findNode(result.document, child.id), null);
  assert.ok(findNode(result.document, frame.id), 'deleting the child leaves the frame intact');
  assert.equal(validateDocument(result.document), true);
});

test('deleting an overflow child under a visible sibling removes the intended layer by stacking order', () => {
  const document = createDocument();
  const visibleSibling = createNode('rectangle', {
    x: 120, y: 10, width: 40, height: 40, fill: '#00ff00', stroke: null, strokeWidth: 0, name: 'Visible sibling'
  });
  const frame = createNode('frame', { x: 20, y: 20, width: 100, height: 100, clip: true });
  const overflowChild = createNode('rectangle', {
    x: 120, y: 10, width: 40, height: 40, fill: '#ff0000', stroke: null, strokeWidth: 0, name: 'Overflow child'
  });
  addNode(document, visibleSibling);
  addNode(document, frame);
  addNode(document, overflowChild, { parentId: frame.id });
  const overlapPoint = { x: 150, y: 40 };

  assert.equal(hitTestPage(document.pages[0], overlapPoint, null, document)?.id, visibleSibling.id,
    'normal presentation hit testing stays clipped and sees the sibling beneath the frame');
  const picked = hitTestPage(document.pages[0], overlapPoint, null, document, null, 1, { allowAnyClippedNodes: true });
  assert.equal(picked?.id, overflowChild.id,
    'editor hit testing keeps the clipped child reachable according to its layer stacking order');

  const result = removeLayersAtomically(document, [picked.id]);
  assert.equal(findNode(result.document, overflowChild.id), null, 'Delete removes the overflow child the user targeted');
  assert.ok(findNode(result.document, visibleSibling.id), 'Delete leaves the visible sibling intact');
  assert.ok(findNode(result.document, frame.id), 'Delete leaves the clipping frame intact');
  assert.equal(validateDocument(result.document), true);
});

test('deleting a mask source removes only that layer and keeps the remaining group editable', () => {
  const document = createDocument();
  const content = createNode('rectangle', { name: 'Visible content' });
  const mask = createNode('ellipse', { name: 'Mask source' });
  addNode(document, content);
  addNode(document, mask);
  const group = createMaskGroup(document, [content.id, mask.id]);

  const result = removeLayersAtomically(document, [mask.id]);
  const updatedGroup = findNode(result.document, group.id).node;

  assert.equal(findNode(result.document, mask.id), null);
  assert.equal(findNode(result.document, content.id).parent.id, group.id);
  assert.equal(updatedGroup.mask, false);
  assert.equal(Object.hasOwn(updatedGroup, 'maskSourceId'), false);
  assert.equal(validateDocument(result.document), true);
});

test('deleting the final masked content succeeds and keeps the empty mask source editable', () => {
  const document = createDocument();
  const content = createNode('rectangle', { name: 'Only masked content' });
  const mask = createNode('ellipse', { name: 'Reusable mask source' });
  addNode(document, content);
  addNode(document, mask);
  const group = createMaskGroup(document, [content.id, mask.id]);

  const result = removeLayersAtomically(document, [content.id]);
  const remainingGroup = findNode(result.document, group.id).node;

  assert.equal(findNode(result.document, content.id), null);
  assert.equal(findNode(result.document, mask.id).parent.id, group.id);
  assert.equal(remainingGroup.mask, true);
  assert.equal(remainingGroup.maskSourceId, mask.id);
  assert.deepEqual(remainingGroup.children.map(child => child.id), [mask.id]);
  assert.equal(validateDocument(parseDocument(serializeDocument(result.document))), true);

  const released = releaseMaskGroup(result.document, group.id);
  assert.deepEqual(released.map(child => child.id), [mask.id]);
  assert.equal(findNode(result.document, group.id), null);
  assert.equal(findNode(result.document, mask.id).parent, null);
  assert.equal(validateDocument(result.document), true);
});

test('deleting a mask source from a component instance remains deleted after component sync and reload', () => {
  const document = createDocument();
  const content = createNode('rectangle', { name: 'Component content' });
  const mask = createNode('ellipse', { name: 'Component mask' });
  addNode(document, content);
  addNode(document, mask);
  const maskGroup = createMaskGroup(document, [content.id, mask.id]);
  const component = createComponent(document, maskGroup.id, 'Masked component');
  const instance = createComponentInstance(document, component.id);
  const instanceGroup = instance;
  const instanceMask = instanceGroup.children.find(child => child.type === 'ellipse');

  const result = removeLayersAtomically(document, [instanceMask.id]);
  syncAllComponentInstances(result.document);
  validateDocument(result.document);
  const reloaded = parseDocument(serializeDocument(result.document));
  syncAllComponentInstances(reloaded);
  validateDocument(reloaded);

  const reloadedInstanceGroup = findNode(reloaded, instanceGroup.id).node;
  assert.equal(findNode(reloaded, instanceMask.id), null);
  assert.equal(reloadedInstanceGroup.mask, false);
  assert.equal(reloadedInstanceGroup.children.some(child => child.type === 'rectangle'), true);
});

test('deleting inherited component-slot content creates an override and preserves unselected content', () => {
  const document = createDocument();
  const removable = createNode('rectangle', { name: 'Ordinary layer' });
  const card = createNode('frame', { name: 'Card' });
  const slot = createNode('frame', { name: 'Content' });
  const inherited = createNode('frame', { name: 'Inherited container' });
  const inheritedChild = createNode('rectangle', { name: 'Inherited content' });
  const sibling = createNode('ellipse', { name: 'Keep this content' });
  addNode(document, removable);
  addNode(document, card);
  addNode(document, slot, { parentId: card.id });
  addNode(document, inherited, { parentId: slot.id });
  addNode(document, inheritedChild, { parentId: inherited.id });
  addNode(document, sibling, { parentId: slot.id });
  const component = createComponent(document, card.id, 'Card');
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const inheritedInstanceLayer = instance.children[0].children[0].children[0];
  const originalInheritedInstanceId = inheritedInstanceLayer.id;

  const result = removeLayersAtomically(document, [removable.id, inheritedInstanceLayer.id]);
  const updatedInstance = findNode(result.document, instance.id).node;
  const updatedSlot = findNode(result.document, instance.children[0].id).node;

  assert.equal(findNode(result.document, removable.id), null, 'a mixed selection still deletes ordinary layers');
  assert.equal(findNode(result.document, originalInheritedInstanceId), null, 'the requested inherited layer is removed');
  assert.deepEqual(updatedSlot.children[0].children, [], 'the inherited container remains, with its selected child removed');
  assert.equal(updatedSlot.children[0].name, 'Inherited container');
  assert.equal(updatedSlot.children[1].name, 'Keep this content', 'unselected slot content is retained');
  assert.ok(updatedInstance.componentPropertyValues[property.id], 'the instance now owns an explicit slot override');
  assert.deepEqual(updatedInstance.componentPropertyValues[property.id], updatedSlot.children.map(node => node.id));
  assert.ok(findNode(document, removable.id), 'the source document remains untouched until the atomic delete is installed');
  assert.ok(findNode(document, originalInheritedInstanceId), 'the source instance remains untouched');
  assert.equal(validateDocument(result.document), true);

  syncAllComponentInstances(result.document);
  const reloaded = parseDocument(serializeDocument(result.document));
  syncAllComponentInstances(reloaded);
  assert.deepEqual(findNode(reloaded, instance.children[0].id).node.children[0].children, [], 'the local deletion survives sync and reload');
  assert.equal(findNode(reloaded, instance.children[0].id).node.children[1].name, 'Keep this content');
});

test('deleting the last inherited slot layer persists an explicit empty override', () => {
  const document = createDocument();
  const card = createNode('frame', { name: 'Card' });
  const slot = createNode('frame', { name: 'Content' });
  const inherited = createNode('rectangle', { name: 'Default content' });
  addNode(document, card);
  addNode(document, slot, { parentId: card.id });
  addNode(document, inherited, { parentId: slot.id });
  const component = createComponent(document, card.id, 'Card');
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const instanceSlot = instance.children[0];
  const inheritedInstanceLayerId = instanceSlot.children[0].id;

  const result = removeLayersAtomically(document, [inheritedInstanceLayerId]);
  const updatedInstance = findNode(result.document, instance.id).node;
  const updatedSlot = findNode(result.document, instanceSlot.id).node;

  assert.deepEqual(updatedSlot.children, []);
  assert.deepEqual(updatedInstance.componentPropertyValues[property.id], [], 'empty content remains an explicit override');
  assert.equal(findNode(result.document, inheritedInstanceLayerId), null);
  assert.equal(validateDocument(result.document), true);

  syncAllComponentInstances(result.document);
  const reloaded = parseDocument(serializeDocument(result.document));
  syncAllComponentInstances(reloaded);
  assert.deepEqual(findNode(reloaded, instanceSlot.id).node.children, [], 'the default layer stays deleted after sync and reload');
});

test('deleting a selected slot override remains supported', () => {
  const document = createDocument();
  const card = createNode('frame', { name: 'Card' });
  const slot = createNode('frame', { name: 'Content' });
  addNode(document, card);
  addNode(document, slot, { parentId: card.id });
  const component = createComponent(document, card.id, 'Card');
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const instanceSlot = instance.children[0];
  setComponentSlotContent(document, instance.id, property.id, [createNode('rectangle', { name: 'Custom content' })]);
  const customLayer = instanceSlot.children[0];

  const result = removeLayersAtomically(document, [customLayer.id]);

  assert.equal(findNode(result.document, customLayer.id), null);
  assert.deepEqual(findNode(result.document, instanceSlot.id).node.children, []);
});

test('deleting inside deeply nested component instances survives the save-time component sync', () => {
  const document = createDocument();
  const leafMaster = createNode('frame', { name: 'Leaf component' });
  const leafChild = createNode('rectangle', { name: 'Deletable leaf' });
  addNode(document, leafMaster);
  addNode(document, leafChild, { parentId: leafMaster.id });
  const leafComponent = createComponent(document, leafMaster.id, 'Leaf component');

  const middleMaster = createNode('frame', { name: 'Middle component' });
  addNode(document, middleMaster);
  createComponentInstance(document, leafComponent.id, { parentId: middleMaster.id });
  createComponentInstance(document, leafComponent.id, { parentId: middleMaster.id });
  const middleComponent = createComponent(document, middleMaster.id, 'Middle component');

  const outerMaster = createNode('frame', { name: 'Outer component' });
  addNode(document, outerMaster);
  createComponentInstance(document, middleComponent.id, { parentId: outerMaster.id });
  const outerComponent = createComponent(document, outerMaster.id, 'Outer component');
  const outerInstance = createComponentInstance(document, outerComponent.id);
  const firstNestedLeafInstance = outerInstance.children[0].children[0];
  const selectedLeaf = firstNestedLeafInstance.children[0];

  const result = removeLayersAtomically(document, [selectedLeaf.id]);
  assert.equal(findNode(result.document, selectedLeaf.id), null);
  syncAllComponentInstances(result.document);
  const syncedOuter = findNode(result.document, outerInstance.id).node;
  assert.deepEqual(syncedOuter.children[0].children[0].children, [],
    'refreshing an enclosing component must preserve the nested instance deletion');
  assert.equal(syncedOuter.children[0].children[1].children[0].name, 'Deletable leaf',
    'the sibling instance of the same component must retain its own unedited content');
  assert.ok(findNode(result.document, leafChild.id), 'the source component layer must remain intact');

  const reloaded = parseDocument(serializeDocument(result.document));
  syncAllComponentInstances(reloaded);
  const restoredOuter = findNode(reloaded, outerInstance.id).node;
  assert.deepEqual(restoredOuter.children[0].children[0].children, [],
    'the nested deletion must survive local save and reload');
  assert.equal(restoredOuter.children[0].children[1].children[0].name, 'Deletable leaf',
    'a sibling instance must remain unchanged after local save and reload');
});
