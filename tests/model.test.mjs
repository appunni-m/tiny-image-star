import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, absoluteBounds, applyImageRecipe, createDocument, createImageRecipe, createNode, duplicateNode, findNode, parseDocument, removeNode, serializeDocument, updateNode, validateDocument } from '../src/model.js';
import { History } from '../src/history.js';
import { createImageFill } from '../src/image-fills.js';

test('new file has an active page and a valid empty layer tree', () => {
  const document = createDocument();
  assert.equal(document.pages.length, 1);
  assert.equal(document.pages[0].id, document.activePageId);
  assert.equal(validateDocument(document), true);
});

test('frames own nested layers and bounds resolve into page coordinates', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 120, y: 80, width: 400, height: 500 });
  const shape = createNode('rectangle', { x: 24, y: 32, width: 90, height: 60 });
  addNode(document, frame);
  addNode(document, shape, { parentId: frame.id });
  assert.deepEqual(absoluteBounds(document, shape.id), { x: 144, y: 112, width: 90, height: 60 });
  assert.equal(findNode(document, shape.id).parents[0].id, frame.id);
});

test('node edits, duplication and removal preserve independent identities', () => {
  const document = createDocument();
  const shape = createNode('ellipse', { x: 5, y: 6 }); addNode(document, shape);
  updateNode(document, shape.id, { x: 14, opacity: .5 });
  const copy = duplicateNode(document, shape.id);
  assert.notEqual(copy.id, shape.id);
  assert.equal(copy.x, 30);
  assert.equal(copy.opacity, .5);
  removeNode(document, shape.id);
  assert.equal(findNode(document, shape.id), null);
  assert.equal(findNode(document, copy.id).node.id, copy.id);
});

test('image recipes snapshot adjustments and apply to another source layer', () => {
  const document = createDocument();
  const source = createNode('image', { assetId: 'asset-a', adjustments: { brightness: -12, contrast: 25, saturation: 7, blur: 2 } });
  const target = createNode('image', { assetId: 'asset-b' });
  addNode(document, source); addNode(document, target);
  const recipe = createImageRecipe(source, 'Warm dusk');
  source.adjustments.brightness = 0;
  assert.equal(applyImageRecipe(document, target.id, recipe), true);
  assert.deepEqual(target.adjustments, { brightness: -12, contrast: 25, saturation: 7, blur: 2 });
  assert.equal(target.assetId, 'asset-b');
});

test('serialized design validates after reload and rejects duplicate layer identities', () => {
  const document = createDocument();
  addNode(document, createNode('frame', { name: 'Mobile frame' }));
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reopened), true);
  const duplicate = createNode('rectangle');
  reopened.pages[0].children.push(duplicate, structuredClone(duplicate));
  assert.throws(() => validateDocument(reopened), /duplicate layer/);
});

test('image fills validate and survive a portable design round trip', () => {
  const document = createDocument();
  const fill = createImageFill('asset-local-photo', { fit: 'contain', adjustments: { brightness: -18, contrast: 12, saturation: 8, blur: 2 } });
  const rectangle = createNode('rectangle', { imageFill: fill });
  addNode(document, rectangle);
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reopened), true);
  assert.deepEqual(reopened.pages[0].children[0].imageFill, fill);

  reopened.pages[0].children[0].imageFill.fit = 'stretch';
  assert.throws(() => validateDocument(reopened), /Invalid image fill/);
  reopened.pages[0].children[0].imageFill = fill;
  reopened.pages[0].children[0].imageFill.adjustments.blur = 25;
  assert.throws(() => validateDocument(reopened), /Invalid image fill/);
  reopened.pages[0].children[0] = createNode('text', { imageFill: fill });
  assert.throws(() => validateDocument(reopened), /Image fill is not supported/);
});

test('layer blend modes validate and survive local design serialization', () => {
  const document = createDocument();
  const rectangle = createNode('rectangle', { blendMode: 'multiply' });
  addNode(document, rectangle);
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(reopened.pages[0].children[0].blendMode, 'multiply');
  assert.equal(validateDocument(reopened), true);
  reopened.pages[0].children[0].blendMode = 'vivid-light';
  assert.throws(() => validateDocument(reopened), /Invalid blend mode/);
});

test('history restores both document direction and redo state', () => {
  const document = createDocument();
  const history = new History();
  history.checkpoint(document, 'Create layer');
  addNode(document, createNode('rectangle'));
  const undone = history.undo(document);
  assert.equal(undone.pages[0].children.length, 0);
  const redone = history.redo(undone);
  assert.equal(redone.pages[0].children.length, 1);
});
