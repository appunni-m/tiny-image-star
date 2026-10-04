import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectorEmptyState } from '../src/inspector-empty-state.js';

test('an empty page tells the user how to begin', () => {
  assert.deepEqual(inspectorEmptyState({ children: [] }), {
    title: 'Start designing',
    description: 'Select an item to edit its settings. To start, add an image, draw a frame, or add text.',
    showStartActions: true
  });
});

test('a page with layers explains how to reach their properties', () => {
  assert.deepEqual(inspectorEmptyState({ children: [{ id: 'shape-1' }] }), {
    title: 'No layer selected',
    description: 'Select a layer on the canvas or in Layers to see and edit its properties.',
    showStartActions: false
  });
});

test('a populated page with a photo tells the user where its crop action appears', () => {
  assert.deepEqual(inspectorEmptyState({ children: [{ id: 'image-1', type: 'image' }] }), {
    title: 'No layer selected',
    description: 'Select a photo or the shape containing it on the canvas or in Layers. Choose Crop image or Reposition photo in the canvas action bar.',
    showStartActions: false
  });
});

test('photo-fill and nested images also enable crop guidance', () => {
  const photoFillPage = { children: [{ id: 'shape-1', imageFill: { assetId: 'asset-1' } }] };
  const nestedPage = { children: [{ id: 'frame-1', children: [{ id: 'image-1', type: 'image' }] }] };
  assert.match(inspectorEmptyState(photoFillPage).description, /Reposition photo/);
  assert.match(inspectorEmptyState(nestedPage).description, /Crop image/);
});

test('hidden images do not replace the general no-selection guidance', () => {
  const page = { children: [{ id: 'image-1', type: 'image', visible: false }] };
  assert.equal(inspectorEmptyState(page).description,
    'Select a layer on the canvas or in Layers to see and edit its properties.');
});

test('a missing page is treated as an empty workspace', () => {
  assert.equal(inspectorEmptyState(null).showStartActions, true);
});
