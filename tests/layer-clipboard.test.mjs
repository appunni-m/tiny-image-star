import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, bindColorVariable, bindVariable, createColorStyle, createColorVariable, createComponent,
  createComponentInstance, createComponentProperty, createDocument, createImageRecipe, createMaskGroup, createNode,
  createVariable, createVariableCollection, createTypographyStyle, deleteTypographyStyle, deleteVariable, findNode, getNodeGeometry, getNodePropertyValue,
  removeNode, setComponentSlotContent,
  serializeDocument, validateDocument
} from '../src/model.js';
import { createLayerClipboard, layerClipboardSchema, pasteLayerClipboard } from '../src/layer-clipboard.js';
import { History } from '../src/history.js';
import { addPrototypeInteraction } from '../src/prototype.js';
import { parentLocalToPageTransform, transformPoint } from '../src/transform-geometry.js';

test('copying a nested mask tree remaps every layer reference and keeps one shared local image asset', () => {
  const document = createDocument();
  const image = createNode('image', { name: 'Photo', x: 16, y: 10, assetId: 'asset-local-photo', fileName: 'photo.webp' });
  const mask = createNode('ellipse', { name: 'Photo mask', x: 4, y: 2, width: 40, height: 40 });
  addNode(document, image); addNode(document, mask);
  const maskGroup = createMaskGroup(document, [image.id, mask.id]);
  const clipboard = createLayerClipboard(document, [findNode(document, maskGroup.id)]);

  const { document: pastedDocument, nodes: [pasted] } = pasteLayerClipboard(document, clipboard);
  assert.equal(clipboard.schema, layerClipboardSchema);
  assert.notEqual(pasted.id, maskGroup.id);
  assert.notEqual(pasted.children[0].id, image.id);
  assert.notEqual(pasted.children[1].id, mask.id);
  assert.equal(pasted.maskSourceId, pasted.children[1].id, 'the mask source points to the newly cloned shape');
  assert.equal(pasted.children[0].assetId, 'asset-local-photo', 'the image continues to use the saved local asset');
  assert.equal('bytes' in pasted.children[0], false, 'clipboard snapshots never embed image bytes');
  assert.equal(validateDocument(pastedDocument), true);
  assert.equal(document.pages[0].children.length, 1, 'building a paste candidate never mutates the source document');
});

test('copying and pasting text layers preserves their text wrap style', () => {
  const document = createDocument();
  const text = createNode('text', { text: 'A balanced heading', textWrapStyle: 'balance' });
  addNode(document, text);
  const style = createTypographyStyle(document, text.id, 'Headline');
  const clipboard = createLayerClipboard(document, [findNode(document, text.id)]);
  deleteTypographyStyle(document, style.id);
  const result = pasteLayerClipboard(document, clipboard);
  assert.equal(result.nodes[0].textWrapStyle, 'balance');
  assert.equal(result.nodes[0].typographyStyleId, undefined, 'a deleted copied style is detached cleanly');
  assert.equal(validateDocument(result.document), true);
});

test('layer clipboard remaps internal scroll targets and drops routes whose targets are outside the pasted page', () => {
  const document = createDocument();
  const screen = createNode('frame', { name: 'Long screen' });
  const scroller = createNode('frame', { name: 'Content', overflowBehavior: 'vertical', width: 300, height: 180 });
  const hotspot = createNode('rectangle', { name: 'Jump link' });
  const target = createNode('rectangle', { name: 'Footer anchor', y: 400 });
  scroller.children.push(hotspot, target);
  screen.children.push(scroller);
  addNode(document, screen);
  addPrototypeInteraction(document, hotspot.id, null, { action: 'scroll-to', scrollTargetId: target.id });
  const treeClipboard = createLayerClipboard(document, [findNode(document, screen.id)]);

  const pastedTree = pasteLayerClipboard(document, treeClipboard);
  const copiedScreen = pastedTree.nodes[0];
  const copiedHotspot = copiedScreen.children[0].children.find(node => node.name === 'Jump link copy');
  const copiedTarget = copiedScreen.children[0].children.find(node => node.name === 'Footer anchor copy');
  assert.equal(copiedHotspot.interactions[0].scrollTargetId, copiedTarget.id);
  assert.equal(validateDocument(pastedTree.document), true);

  const secondPage = structuredClone(document.pages[0]);
  secondPage.id = 'page-for-scroll-paste'; secondPage.name = 'Other page'; secondPage.children = [];
  document.pages.push(secondPage);
  const hotspotClipboard = createLayerClipboard(document, [findNode(document, hotspot.id)]);
  const pastedHotspot = pasteLayerClipboard(document, hotspotClipboard, { pageId: secondPage.id });
  assert.equal(pastedHotspot.nodes[0].interactions, undefined,
    'a copied hotspot must not keep a scroll-to route to a target left on another page');
  assert.equal(validateDocument(pastedHotspot.document), true);
});

test('repeated copy-paste creates fresh IDs with progressive offsets; cut-paste restores the source position', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 100, y: 80 });
  const original = createNode('rectangle', { name: 'Card', x: 12, y: 18, width: 60, height: 30 });
  addNode(document, frame); addNode(document, original, { parentId: frame.id });
  const entry = findNode(document, original.id);
  const clipboard = createLayerClipboard(document, [entry]);
  const first = pasteLayerClipboard(document, clipboard);
  const nextClipboard = { ...clipboard, pasteCount: first.pasteCount };
  const second = pasteLayerClipboard(first.document, nextClipboard);

  assert.equal(first.nodes[0].x, original.x + 16);
  assert.equal(second.nodes[0].x, original.x + 32);
  assert.equal(findNode(first.document, first.nodes[0].id).parents[0].id, frame.id, 'pasted children return to a still-valid source container');
  assert.notEqual(first.nodes[0].id, second.nodes[0].id);
  assert.match(first.nodes[0].name, /copy/);

  const cutClipboard = createLayerClipboard(document, [findNode(document, original.id)], { mode: 'cut' });
  removeNode(document, original.id);
  const moved = pasteLayerClipboard(document, cutClipboard);
  assert.equal(moved.nodes[0].x, original.x);
  assert.equal(moved.nodes[0].y, original.y);
  assert.equal(findNode(moved.document, moved.nodes[0].id).parents[0].id, frame.id);
  assert.equal(validateDocument(moved.document), true);
});

test('cut-paste restores non-contiguous siblings to their original positions', () => {
  const document = createDocument();
  const siblings = ['A', 'B', 'C', 'D', 'E'].map(name => createNode('rectangle', { name }));
  siblings.forEach(node => addNode(document, node));
  const clipboard = createLayerClipboard(document, [findNode(document, siblings[1].id), findNode(document, siblings[3].id)], { mode: 'cut' });
  removeNode(document, siblings[1].id);
  removeNode(document, siblings[3].id);

  const restored = pasteLayerClipboard(document, clipboard);
  assert.deepEqual(restored.document.pages[0].children.map(node => node.name), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(restored.nodes.map(node => node.x), [siblings[1].x, siblings[3].x]);
  assert.notEqual(restored.nodes[0].id, siblings[1].id, 'cut-paste remaps IDs after the originals were removed');
  assert.equal(validateDocument(restored.document), true);
});

test('cut and paste candidates survive independent undo and redo snapshots', () => {
  const document = createDocument();
  const image = createNode('image', { name: 'Original', assetId: 'asset-history', fileName: 'original.png' });
  addNode(document, image);
  const original = serializeDocument(document);
  const clipboard = createLayerClipboard(document, [findNode(document, image.id)], { mode: 'cut' });
  const history = new History();

  history.checkpoint(document, 'Cut layers');
  const cutDocument = structuredClone(document);
  removeNode(cutDocument, image.id);
  const undoCut = history.undo(cutDocument);
  assert.equal(serializeDocument(undoCut), original);
  const redoCut = history.redo(undoCut);
  assert.equal(redoCut.pages[0].children.length, 0);

  history.checkpoint(redoCut, 'Paste layers');
  const pasted = pasteLayerClipboard(redoCut, clipboard);
  const undoPaste = history.undo(pasted.document);
  assert.equal(undoPaste.pages[0].children.length, 0);
  const undoCutAgain = history.undo(undoPaste);
  assert.equal(serializeDocument(undoCutAgain), original);
  const redoCutAgain = history.redo(undoCutAgain);
  const redoPaste = history.redo(redoCutAgain);
  assert.equal(redoPaste.pages[0].children.length, 1);
  assert.equal(redoPaste.pages[0].children[0].assetId, 'asset-history');
  assert.notEqual(redoPaste.pages[0].children[0].id, image.id);
  assert.equal(validateDocument(redoPaste), true);
});

test('paste keeps children inside sections, which are valid layer containers', () => {
  const document = createDocument();
  const section = createNode('section', { name: 'Section', x: 80, y: 30 });
  const child = createNode('rectangle', { name: 'Child', x: 12, y: 9 });
  addNode(document, section); addNode(document, child, { parentId: section.id });

  const pasted = pasteLayerClipboard(document, createLayerClipboard(document, [findNode(document, child.id)]));
  const entry = findNode(pasted.document, pasted.nodes[0].id);
  assert.equal(entry.parent.id, section.id);
  assert.equal(pasted.nodes[0].x, child.x + 16);
  assert.equal(pasted.nodes[0].y, child.y + 16);
  assert.equal(validateDocument(pasted.document), true);
});

test('copying from rotated nesting preserves page placement when pasted to another page or after its parent is removed', () => {
  const document = createDocument();
  const geometry = createVariableCollection(document, 'Parent geometry');
  const outer = createNode('frame', { x: 120, y: 45, width: 180, height: 130, rotation: 37 });
  const inner = createNode('group', { x: 28, y: 19, width: 90, height: 70, rotation: -21 });
  const child = createNode('rectangle', { x: 13, y: 8, width: 25, height: 17, rotation: 12 });
  addNode(document, outer); addNode(document, inner, { parentId: outer.id }); addNode(document, child, { parentId: inner.id });
  const variableX = createVariable(document, geometry.id, 'Outer X', 'number', 145);
  const variableRotation = createVariable(document, geometry.id, 'Outer rotation', 'number', 50);
  assert.equal(bindVariable(document, outer.id, variableX.id, 'x'), true);
  assert.equal(bindVariable(document, outer.id, variableRotation.id, 'rotation'), true);
  const entry = findNode(document, child.id);
  const resolvedParents = entry.parents.map(parent => ({ ...parent, ...getNodeGeometry(document, parent) }));
  const pageAnchor = transformPoint(parentLocalToPageTransform(resolvedParents), { x: child.x, y: child.y });
  const clipboard = createLayerClipboard(document, [entry]);
  const secondPage = structuredClone(document.pages[0]);
  secondPage.id = 'page-secondary'; secondPage.name = 'Page 2'; secondPage.children = [];
  document.pages.push(secondPage);

  const crossPage = pasteLayerClipboard(document, clipboard, { pageId: secondPage.id });
  assert.deepEqual({ x: crossPage.nodes[0].x, y: crossPage.nodes[0].y }, { x: pageAnchor.x + 16, y: pageAnchor.y + 16 });
  assert.equal(findNode(crossPage.document, crossPage.nodes[0].id, secondPage.id).parent, null);

  const withoutParent = structuredClone(document);
  removeNode(withoutParent, outer.id);
  const recovered = pasteLayerClipboard(withoutParent, clipboard);
  assert.deepEqual({ x: recovered.nodes[0].x, y: recovered.nodes[0].y }, { x: pageAnchor.x + 16, y: pageAnchor.y + 16 });
  assert.equal(findNode(recovered.document, recovered.nodes[0].id).parent, null);
  assert.equal(validateDocument(recovered.document), true);
});

test('component masters get independent component identities while linked instances keep their shared definition', () => {
  const document = createDocument();
  const master = createNode('rectangle', { name: 'Button', fill: '#445566' }); addNode(document, master);
  const component = createComponent(document, master.id);
  const clipboard = createLayerClipboard(document, [findNode(document, master.id)]);
  const pasted = pasteLayerClipboard(document, clipboard);
  const clonedMaster = pasted.nodes[0];
  assert.equal(clonedMaster.isComponent, true);
  assert.notEqual(clonedMaster.componentId, component.id);
  assert.equal(pasted.document.components.length, 2);
  assert.equal(pasted.document.components.find(item => item.id === clonedMaster.componentId)?.rootNodeId, clonedMaster.id);
  assert.equal(validateDocument(pasted.document), true);
});

test('copying a component master preserves its property definitions and remaps their internal targets', () => {
  const document = createDocument();
  const master = createNode('frame', { name: 'Card' });
  const label = createNode('text', { name: 'Label', text: 'Default label' });
  const subtitle = createNode('text', { name: 'Subtitle', text: 'Default subtitle' });
  addNode(document, master); addNode(document, label, { parentId: master.id }); addNode(document, subtitle, { parentId: master.id });
  const component = createComponent(document, master.id);
  const property = createComponentProperty(document, component.id, { name: 'Label', type: 'TEXT', targetNodeId: label.id });
  property.targetSourceIds = [label.id, subtitle.id];
  const pasted = pasteLayerClipboard(document, createLayerClipboard(document, [findNode(document, master.id)]));
  const copiedMaster = pasted.nodes[0];
  const copiedComponent = pasted.document.components.find(item => item.id === copiedMaster.componentId);
  const copiedProperty = copiedComponent.componentProperties[0];
  const copiedTargetIds = copiedMaster.children.filter(node => node.type === 'text').map(node => node.id);

  assert.notEqual(copiedProperty.id, property.id);
  assert.notEqual(copiedProperty.targetSourceId, property.targetSourceId);
  assert.equal(findNode(pasted.document, copiedProperty.targetSourceId).node.id, copiedMaster.children[0].id);
  assert.deepEqual(copiedProperty.targetSourceIds, copiedTargetIds);
  assert.ok(copiedProperty.targetSourceIds.every(id => id !== label.id && id !== subtitle.id));
  assert.equal(copiedProperty.defaultValue, 'Default label');
  assert.equal(validateDocument(pasted.document), true);
});

test('clipboard edits use overridden SLOT rules and reject unsupported linked-instance children atomically', () => {
  const document = createDocument();
  const master = createNode('frame', { name: 'Card' });
  const slot = createNode('section', { name: 'Content' });
  const holder = createNode('frame', { name: 'Fixed content' });
  const inherited = createNode('rectangle', { name: 'Inherited' });
  addNode(document, master); addNode(document, slot, { parentId: master.id });
  addNode(document, holder, { parentId: master.id }); addNode(document, inherited, { parentId: holder.id });
  const component = createComponent(document, master.id);
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const customGroup = createNode('group', { name: 'Custom content' });
  const customLayer = createNode('rectangle', { name: 'Custom layer' });
  customGroup.children.push(customLayer);
  setComponentSlotContent(document, instance.id, property.id, [customGroup]);

  const instanceSlot = findNode(document, instance.id).node.children.find(node => node.componentSourceId === slot.id);
  const customGroupInSlot = instanceSlot.children[0];
  const customLayerInSlot = customGroupInSlot.children[0];
  const slotClipboard = createLayerClipboard(document, [findNode(document, customLayerInSlot.id)]);
  const pastedIntoSlot = pasteLayerClipboard(document, slotClipboard);
  const updatedInstance = findNode(pastedIntoSlot.document, instance.id).node;
  const updatedSlot = updatedInstance.children.find(node => node.componentSourceId === slot.id);
  assert.deepEqual(updatedSlot.children.map(node => node.id), [customGroupInSlot.id]);
  assert.equal(customGroupInSlot.children.length, 1, 'the source document was not mutated by building the candidate');
  assert.equal(findNode(pastedIntoSlot.document, customGroupInSlot.id).node.children.length, 2);
  assert.deepEqual(updatedInstance.componentPropertyValues[property.id], [customGroupInSlot.id]);
  assert.equal(validateDocument(pastedIntoSlot.document), true);

  const inheritedInInstance = findNode(document, instance.id).node.children.find(node => node.componentSourceId === holder.id).children[0];
  const blockedClipboard = createLayerClipboard(document, [findNode(document, inheritedInInstance.id)]);
  const before = serializeDocument(document);
  assert.throws(() => pasteLayerClipboard(document, blockedClipboard), /Cannot paste into linked component layers/);
  assert.equal(serializeDocument(document), before, 'unsupported linked-instance insertion leaves the design unchanged');

  const withoutInstance = structuredClone(document);
  removeNode(withoutInstance, instance.id);
  const detachedCopy = pasteLayerClipboard(withoutInstance, blockedClipboard).nodes[0];
  assert.equal(detachedCopy.componentSourceId, undefined, 'a layer copied out of a removed instance becomes a standalone visual copy');
  assert.equal(validateDocument(pasteLayerClipboard(withoutInstance, blockedClipboard).document), true);
});

test('existing variable, color-style, recipe, and component references stay shared; removed variables materialize their copied color', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Theme');
  const ink = createColorVariable(document, collection.id, 'Ink', '#224466');
  const variableNode = createNode('rectangle', { name: 'Variable fill' }); addNode(document, variableNode);
  assert.equal(bindColorVariable(document, variableNode.id, ink.id), true);
  const styleNode = createNode('rectangle', { name: 'Style fill', fill: '#997755' }); addNode(document, styleNode);
  const style = createColorStyle(document, styleNode.id, 'Sand');
  const image = createNode('image', { assetId: 'shared-photo', adjustments: { brightness: 20, contrast: 0, saturation: 0, blur: 0 } }); addNode(document, image);
  const recipe = createImageRecipe(image, 'Bright'); document.recipes.push(recipe);
  const clipboard = createLayerClipboard(document, [findNode(document, variableNode.id), findNode(document, styleNode.id), findNode(document, image.id)]);
  const pasted = pasteLayerClipboard(document, clipboard);
  assert.equal(pasted.nodes[0].fillVariableId, ink.id);
  assert.equal(pasted.nodes[1].fillStyleId, style.id);
  assert.equal(pasted.nodes[2].assetId, 'shared-photo');
  assert.deepEqual(pasted.document.recipes, document.recipes, 'recipes are document catalog entries, not duplicated with each layer');
  assert.equal(validateDocument(pasted.document), true);

  assert.equal(deleteVariable(document, ink.id), true);
  const detached = pasteLayerClipboard(document, clipboard);
  assert.equal(detached.nodes[0].fillVariableId, undefined);
  assert.equal(detached.nodes[0].fill, '#224466', 'stale variable links fall back to their copy-time resolved value');
  assert.equal(validateDocument(detached.document), true);
});

test('copying preserves all schema-supported variable bindings and materializes removed nested layout bindings', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Layout');
  const x = createVariable(document, collection.id, 'Horizontal position', 'number', 42);
  const axis = createVariable(document, collection.id, 'Direction', 'string', 'vertical');
  const frame = createNode('frame', { x: 7, width: 160, height: 90 });
  frame.autoLayout = { axis: 'horizontal', mainSizing: 'fixed', crossSizing: 'fixed', gap: 8, padding: { top: 0, right: 0, bottom: 0, left: 0 } };
  addNode(document, frame);
  assert.equal(bindVariable(document, frame.id, x.id, 'x'), true);
  assert.equal(bindVariable(document, frame.id, axis.id, 'autoLayout.axis'), true);
  const clipboard = createLayerClipboard(document, [findNode(document, frame.id)]);

  const linkedCopy = pasteLayerClipboard(document, clipboard).nodes[0];
  assert.equal(linkedCopy.variableBindings.x, x.id);
  assert.equal(linkedCopy.variableBindings['autoLayout.axis'], axis.id);
  assert.equal(getNodePropertyValue(document, linkedCopy, 'x'), 42);

  deleteVariable(document, x.id);
  deleteVariable(document, axis.id);
  const detachedCopy = pasteLayerClipboard(document, clipboard).nodes[0];
  assert.equal(detachedCopy.variableBindings, undefined);
  assert.equal(detachedCopy.x, 58, 'the copy-time resolved coordinate is materialized before the standard copy offset');
  assert.equal(detachedCopy.autoLayout.axis, 'vertical');
  assert.equal(validateDocument(pasteLayerClipboard(document, clipboard).document), true);
});

test('broken component links detach into visual copies and a stale parent falls back to page coordinates', () => {
  const document = createDocument();
  const master = createNode('rectangle', { name: 'Master' }); addNode(document, master);
  const component = createComponent(document, master.id);
  const instance = createNode('rectangle', { name: 'Detached later', isInstance: true, componentId: component.id, componentSourceId: master.id, componentOverrides: {} }); addNode(document, instance);
  const instanceClipboard = createLayerClipboard(document, [findNode(document, instance.id)]);
  removeNode(document, master.id);
  const detached = pasteLayerClipboard(document, instanceClipboard);
  assert.equal(detached.nodes[0].isInstance, undefined);
  assert.equal(detached.nodes[0].componentId, undefined);
  assert.equal(validateDocument(detached.document), true);

  const frame = createNode('frame', { x: 45, y: 70 });
  const child = createNode('ellipse', { x: 8, y: 11 }); addNode(document, frame); addNode(document, child, { parentId: frame.id });
  const childClipboard = createLayerClipboard(document, [findNode(document, child.id)]);
  removeNode(document, frame.id);
  const recovered = pasteLayerClipboard(document, childClipboard);
  assert.equal(recovered.nodes[0].x, 69, 'a copied layer falls back to page coordinates and then receives the standard 16 px copy offset');
  assert.equal(recovered.nodes[0].y, 97, 'the page-coordinate fallback preserves the same copy offset vertically');
  assert.equal(findNode(recovered.document, recovered.nodes[0].id).parent, null);
});

test('malformed, stale, or cross-design clipboards fail without mutating the design', () => {
  const document = createDocument();
  const shape = createNode('rectangle'); addNode(document, shape);
  const clipboard = createLayerClipboard(document, [findNode(document, shape.id)]);
  const before = serializeDocument(document);
  assert.throws(() => pasteLayerClipboard(document, null), /clipboard is invalid/i);
  assert.throws(() => pasteLayerClipboard(document, { ...clipboard, documentId: 'other-design' }), /same open design/i);
  const malformed = structuredClone(clipboard);
  malformed.items[0].node.children = 'not-a-list';
  assert.throws(() => pasteLayerClipboard(document, malformed), /malformed children/i);
  const duplicateIds = structuredClone(clipboard);
  duplicateIds.items[0].node.children = [structuredClone(duplicateIds.items[0].node)];
  assert.throws(() => pasteLayerClipboard(document, duplicateIds), /duplicate layer IDs/i);
  assert.equal(serializeDocument(document), before);

  const staleParent = structuredClone(clipboard);
  staleParent.items[0].parentId = 'deleted-container';
  const fallback = pasteLayerClipboard(document, staleParent);
  assert.equal(validateDocument(fallback.document), true, 'stale containers safely fall back to the active page');
});

test('clipboard creation checks the aggregate layer limit before snapshotting selected trees', () => {
  const document = createDocument();
  const root = createNode('group');
  root.children = Array.from({ length: 20_000 }, () => createNode('rectangle'));
  addNode(document, root);
  assert.throws(() => createLayerClipboard(document, [findNode(document, root.id)]), /20,000-layer safety limit/);
});
