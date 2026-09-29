import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, bindColorVariable, createColorStyle, createColorVariable, createComponent, createDocument,
  createImageRecipe, createMaskGroup, createNode, createVariableCollection, deleteVariable, findNode,
  removeNode, serializeDocument, validateDocument
} from '../src/model.js';
import { createLayerClipboard, layerClipboardSchema, pasteLayerClipboard } from '../src/layer-clipboard.js';

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
