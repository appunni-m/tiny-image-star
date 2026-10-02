import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode } from '../src/model.js';
import { imagePreviewMaxDimensionForNode } from '../src/image-preview-surface.js';

test('preview output resolution follows projected image layer dimensions, device pixels, zoom, and the configured ceiling', () => {
  const document = createDocument();
  const image = createNode('image', { id: 'image', x: 0, y: 0, width: 320, height: 180, assetId: 'asset' });
  addNode(document, image);
  assert.equal(imagePreviewMaxDimensionForNode(image, document, document.activePageId, {
    zoom: 1, pixelRatio: 2, maximumDimension: 4096
  }), 640);
  assert.equal(imagePreviewMaxDimensionForNode(image, document, document.activePageId, {
    zoom: .5, pixelRatio: 2, maximumDimension: 4096
  }), 320);
  assert.equal(imagePreviewMaxDimensionForNode(image, document, document.activePageId, {
    zoom: 8, pixelRatio: 2, maximumDimension: 2048
  }), 2048);
});

test('preview resolution follows nested rotation and affine scaling without using the full viewport', () => {
  const document = createDocument();
  const parent = createNode('frame', {
    id: 'parent', x: 0, y: 0, width: 200, height: 200, rotation: 90,
    affineTransform: { a: 2, b: 0, c: 0, d: .5 }
  });
  const image = createNode('image', { id: 'image', x: 12, y: 15, width: 140, height: 40, assetId: 'asset' });
  addNode(document, parent);
  addNode(document, image, { parentId: parent.id });
  assert.equal(imagePreviewMaxDimensionForNode(image, document, document.activePageId, {
    zoom: 1, pixelRatio: 1, maximumDimension: 4096
  }), 80, 'the raster edge follows the composed affine transform and parent rotation used by the renderer');
});

test('preview resolution rejects missing layers and invalid scale inputs', () => {
  const document = createDocument();
  const image = createNode('image', { id: 'image', assetId: 'asset' });
  addNode(document, image);
  assert.throws(() => imagePreviewMaxDimensionForNode(image, document, 'missing-page'), /no longer exists/);
  assert.throws(() => imagePreviewMaxDimensionForNode(image, document, document.activePageId, { zoom: 0 }), /positive finite/);
  assert.throws(() => imagePreviewMaxDimensionForNode(image, document, document.activePageId, { maximumDimension: 0 }), /positive finite/);
});
