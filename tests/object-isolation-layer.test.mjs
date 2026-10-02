import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, createComponent, createComponentInstance, createComponentProperty,
  createDocument, createNode, findNode
} from '../src/model.js';
import { insertObjectIsolationLayer, prepareObjectIsolationLayer } from '../src/object-isolation-layer.js';

function image(overrides = {}) {
  return createNode('image', {
    name: 'Portrait', fileName: 'portrait.jpg', assetId: 'source-asset', sourceWidth: 800, sourceHeight: 600,
    x: 12.25, y: -3.5, width: 400, height: 300, rotation: 17, fit: 'cover',
    opacity: 0.8, adjustments: { exposure: 0.25 }, transforms: { flipHorizontal: true },
    radius: 9, cornerRadii: { topLeft: 3, topRight: 4, bottomRight: 5, bottomLeft: 6 },
    ...overrides
  });
}

test('isolated image preparation preserves source appearance and inserts a transparent PNG immediately above it', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Frame', x: 20, y: 30, width: 700, height: 500, clip: true });
  addNode(document, frame);
  const below = createNode('rectangle', { name: 'Below', x: 0, y: 0, width: 40, height: 40 });
  const source = image();
  const above = createNode('rectangle', { name: 'Above', x: 10, y: 10, width: 30, height: 30 });
  addNode(document, below, { parentId: frame.id });
  addNode(document, source, { parentId: frame.id });
  addNode(document, above, { parentId: frame.id });
  const sourceBefore = structuredClone(source);

  const prepared = prepareObjectIsolationLayer(document, {
    sourceId: source.id, assetId: 'isolated-asset', width: 800, height: 600
  });

  assert.deepEqual(source, sourceBefore, 'preparation must not alter the original image');
  assert.equal(prepared.layer.type, 'image');
  assert.equal(prepared.layer.assetId, 'isolated-asset');
  assert.equal(prepared.layer.outputFormat, 'png');
  assert.equal(prepared.layer.outputQuality, 100);
  assert.equal(prepared.layer.opacity, 1);
  assert.equal(prepared.layer.fit, source.fit);
  assert.equal(prepared.layer.x, source.x);
  assert.equal(prepared.layer.y, source.y);
  assert.equal(prepared.layer.width, source.width);
  assert.equal(prepared.layer.height, source.height);
  assert.equal(prepared.layer.rotation, source.rotation);
  assert.deepEqual(prepared.layer.transforms, source.transforms);
  assert.notEqual(prepared.layer.transforms, source.transforms);
  assert.deepEqual(prepared.layer.adjustments, source.adjustments);

  insertObjectIsolationLayer(document, prepared);
  const children = findNode(document, frame.id).node.children;
  assert.deepEqual(children.map(node => node.id), [below.id, source.id, prepared.layer.id, above.id]);
  assert.deepEqual(source, sourceBefore, 'insertion must keep source bytes and metadata untouched');
});

test('isolated layer preparation uses absolute positioning in auto-layout and does not join its flow', () => {
  const document = createDocument();
  const frame = createNode('frame', {
    name: 'Auto layout', x: 0, y: 0, width: 600, height: 400,
    autoLayout: { mode: 'vertical', gap: 12, padding: 16 }
  });
  addNode(document, frame);
  const source = image({ layoutPositioning: 'flow', layoutSizingMain: 'fill', layoutSizingCross: 'hug', gridCell: { row: 1, column: 1 } });
  addNode(document, source, { parentId: frame.id });

  const prepared = prepareObjectIsolationLayer(document, {
    sourceId: source.id, assetId: 'isolated-asset', width: 800, height: 600
  });
  assert.equal(prepared.layer.layoutPositioning, 'absolute');
  assert.equal(Object.hasOwn(prepared.layer, 'layoutSizingMain'), false);
  assert.equal(Object.hasOwn(prepared.layer, 'layoutSizingCross'), false);
  assert.equal(Object.hasOwn(prepared.layer, 'gridCell'), false);
});

test('isolation rejects stale, locked, wrong-size, and non-image sources before inserting anything', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Locked frame', locked: true, width: 500, height: 400 });
  addNode(document, frame);
  const source = image();
  addNode(document, source, { parentId: frame.id });
  const options = { sourceId: source.id, assetId: 'isolated-asset', width: 800, height: 600 };
  assert.throws(() => prepareObjectIsolationLayer(document, options), /Unlock the source image/u);
  frame.locked = false;
  assert.throws(() => prepareObjectIsolationLayer(document, { ...options, width: 400 }), /dimensions no longer match/u);
  assert.throws(() => prepareObjectIsolationLayer(document, { ...options, sourceId: frame.id }), /source image/u);
  assert.deepEqual(frame.children, [source]);

  const prepared = prepareObjectIsolationLayer(document, options);
  source.opacity = 0.5;
  assert.throws(() => insertObjectIsolationLayer(document, prepared), /source image changed/u);
  assert.deepEqual(frame.children, [source], 'a stale prepared result must not partially insert');
});

test('isolation preflights component-slot insertion and reports an actionable failure', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card' });
  const slot = createNode('frame', { name: 'Content' });
  const source = image({ name: 'Portrait' });
  addNode(document, main);
  addNode(document, slot, { parentId: main.id });
  addNode(document, source, { parentId: slot.id });
  const component = createComponent(document, main.id, 'Card');
  createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const instanceSlot = instance.children.find(node => node.componentSourceId === slot.id);
  const inheritedImage = instanceSlot.children[0];
  assert.throws(() => prepareObjectIsolationLayer(document, {
    sourceId: inheritedImage.id, assetId: 'isolated-asset', width: 800, height: 600
  }), /Set a slot override/u);
});
