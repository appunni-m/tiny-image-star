import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, bindVariable, createDocument, createNode, createVariable, createVariableCollection } from '../src/model.js';
import { imagePreviewKey } from '../src/image-preview-runtime.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';
import { collectVisibleImagePreviewKeys } from '../src/visible-image-previews.js';

test('visible preview collection follows nested affine geometry and includes partially visible image fills', () => {
  const document = createDocument();
  const parent = createNode('frame', {
    id: 'rotated-parent', x: 120, y: 80, width: 160, height: 100, rotation: 31,
    affineTransform: { a: 1.2, b: .1, c: -.2, d: .9 }, fill: 'transparent'
  });
  const image = createNode('image', { id: 'photo', x: 22, y: 18, width: 48, height: 32, assetId: 'asset-a' });
  const filled = createNode('rectangle', {
    id: 'filled-shape', x: 24, y: 18, width: 40, height: 40,
    fills: [
      { id: 'visible-photo', type: 'image', visible: true, opacity: 1, imageFill: { assetId: 'asset-b' } },
      { id: 'hidden-photo', type: 'image', visible: true, opacity: 0, imageFill: { assetId: 'asset-c' } },
      { id: 'hidden-layer', type: 'image', visible: false, opacity: 1, imageFill: { assetId: 'asset-d' } }
    ]
  });
  addNode(document, parent);
  addNode(document, image, { parentId: parent.id });
  addNode(document, filled, { parentId: parent.id });
  const page = document.pages[0];
  const center = nodeLocalToPage(image, { x: image.width / 2, y: image.height / 2 }, [parent]);
  const visible = collectVisibleImagePreviewKeys(page, document, {
    left: center.x - 2, right: center.x + 2, top: center.y - 2, bottom: center.y + 2
  });

  assert.ok(visible.has(imagePreviewKey(image.id)));
  assert.ok(visible.has(imagePreviewKey(filled.id, 'visible-photo')));
  assert.ok(!visible.has(imagePreviewKey(filled.id, 'hidden-photo')));
  assert.ok(!visible.has(imagePreviewKey(filled.id, 'hidden-layer')));
});

test('visible preview collection includes unclipped overflow and accounts for presentation scrolling', () => {
  const document = createDocument();
  const unclipped = createNode('frame', { id: 'unclipped', x: 0, y: 0, width: 20, height: 20, clip: false });
  const overflowImage = createNode('image', { id: 'overflow-image', x: 80, y: 0, width: 30, height: 30, assetId: 'asset-overflow' });
  const scroller = createNode('frame', { id: 'scroller', x: 200, y: 0, width: 100, height: 100, overflowBehavior: 'vertical' });
  const scrolledImage = createNode('image', { id: 'scrolled-image', x: 10, y: 300, width: 25, height: 25, assetId: 'asset-scroll' });
  addNode(document, unclipped);
  addNode(document, overflowImage, { parentId: unclipped.id });
  addNode(document, scroller);
  addNode(document, scrolledImage, { parentId: scroller.id });

  const viewport = { left: 75, right: 112, top: 0, bottom: 32 };
  const withoutScroll = collectVisibleImagePreviewKeys(document.pages[0], document, viewport);
  assert.ok(withoutScroll.has(imagePreviewKey(overflowImage.id)), 'unclipped children can paint outside their parent bounds');
  assert.ok(!withoutScroll.has(imagePreviewKey(scrolledImage.id)));

  const withScroll = collectVisibleImagePreviewKeys(document.pages[0], document, {
    left: 205, right: 240, top: 45, bottom: 80
  }, { presentationScrollOffsets: new Map([[scroller.id, { x: 0, y: 260 }]]) });
  assert.ok(withScroll.has(imagePreviewKey(scrolledImage.id)), 'presentation scroll offsets move descendants into the visible viewport');
});

test('fixed image previews stay resident while sibling images scroll away', () => {
  const document = createDocument();
  const scroller = createNode('frame', {
    id: 'preview-fixed-scroller', x: 200, y: 0, width: 100, height: 100, overflowBehavior: 'vertical'
  });
  const fixed = createNode('image', {
    id: 'preview-fixed-image', x: 10, y: 5, width: 25, height: 20,
    assetId: 'asset-fixed', fixedPositionWhenScrolling: true
  });
  const scrolling = createNode('image', {
    id: 'preview-scrolling-image', x: 10, y: 150, width: 25, height: 20, assetId: 'asset-scrolling'
  });
  addNode(document, scroller);
  addNode(document, fixed, { parentId: scroller.id });
  addNode(document, scrolling, { parentId: scroller.id });
  const visible = collectVisibleImagePreviewKeys(document.pages[0], document, {
    left: 205, right: 240, top: 0, bottom: 30
  }, { presentationScrollOffsets: new Map([[scroller.id, { x: 0, y: 40 }]]) });
  assert.ok(visible.has(imagePreviewKey(fixed.id)), 'fixed preview remains at its viewport position');
  assert.ok(!visible.has(imagePreviewKey(scrolling.id)), 'ordinary preview moves out of this viewport');
});

test('nested sticky image previews follow their sticky position and direct-parent boundary', () => {
  const document = createDocument();
  const scroller = createNode('frame', {
    id: 'nested-preview-scroller', x: 0, y: 0, width: 100, height: 100, overflowBehavior: 'vertical'
  });
  const parent = createNode('group', { id: 'nested-preview-parent', x: 0, y: 30, width: 80, height: 120 });
  const image = createNode('image', {
    id: 'nested-sticky-preview', x: 0, y: 40, width: 25, height: 20,
    assetId: 'asset-nested-sticky', scrollPosition: 'sticky'
  });
  parent.children.push(image);
  scroller.children.push(parent);
  addNode(document, scroller);
  const viewport = { left: 0, top: 0, right: 100, bottom: 50 };

  const hiddenBeforeScroll = collectVisibleImagePreviewKeys(document.pages[0], document, viewport);
  assert.ok(!hiddenBeforeScroll.has(imagePreviewKey(image.id)), 'the original nested location is below the checked viewport');
  const pinned = collectVisibleImagePreviewKeys(document.pages[0], document, viewport, {
    presentationScrollOffsets: new Map([[scroller.id, { x: 0, y: 90 }]])
  });
  assert.ok(pinned.has(imagePreviewKey(image.id)), 'the preview remains resident while the sticky image is pinned');
  const parentGone = collectVisibleImagePreviewKeys(document.pages[0], document, viewport, {
    presentationScrollOffsets: new Map([[scroller.id, { x: 0, y: 160 }]])
  });
  assert.ok(!parentGone.has(imagePreviewKey(image.id)), 'the preview leaves once its direct parent scrolls away');
});

test('visible preview collection respects clip polygons, resolved geometry, opacity, and legacy image fills', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Preview visibility');
  const visibleX = createVariable(document, collection.id, 'Visible X', 'number', 35);
  const clipped = createNode('frame', { id: 'clipped', x: 0, y: 0, width: 20, height: 20, clip: true });
  const clippedImage = createNode('image', { id: 'clipped-image', x: 40, y: 2, width: 30, height: 12, assetId: 'clipped-asset' });
  const partlyVisible = createNode('image', { id: 'partly-visible', x: 10, y: 10, width: 30, height: 20, assetId: 'visible-asset' });
  const variableImage = createNode('image', { id: 'variable-image', x: -100, y: 40, width: 20, height: 20, assetId: 'variable-asset' });
  const hiddenParent = createNode('frame', { id: 'hidden-parent', x: 80, y: 0, width: 40, height: 40, opacity: 0 });
  const hiddenImage = createNode('image', { id: 'hidden-image', x: 0, y: 0, width: 30, height: 30, assetId: 'hidden-asset' });
  const legacyFill = createNode('rectangle', {
    id: 'legacy-fill', x: 35, y: 50, width: 20, height: 20,
    imageFill: { assetId: 'legacy-fill-asset', adjustments: {}, transforms: {} }
  });
  addNode(document, clipped);
  addNode(document, clippedImage, { parentId: clipped.id });
  addNode(document, partlyVisible, { parentId: clipped.id });
  addNode(document, variableImage);
  addNode(document, hiddenParent);
  addNode(document, hiddenImage, { parentId: hiddenParent.id });
  addNode(document, legacyFill);
  assert.equal(bindVariable(document, variableImage.id, visibleX.id, 'x'), true);

  const visible = collectVisibleImagePreviewKeys(document.pages[0], document, {
    left: 15, right: 75, top: 0, bottom: 80
  });

  assert.ok(!visible.has(imagePreviewKey(clippedImage.id)), 'a fully clipped descendant should not keep a preview resident');
  assert.ok(visible.has(imagePreviewKey(partlyVisible.id)), 'a descendant intersecting the clip remains visible');
  assert.ok(visible.has(imagePreviewKey(variableImage.id)), 'variable-bound x/y must use resolved geometry');
  assert.ok(!visible.has(imagePreviewKey(hiddenImage.id)), 'zero-opacity ancestors hide all descendants');
  assert.ok(visible.has(imagePreviewKey(legacyFill.id)), 'legacy image fills share their materialized preview key');
});

test('invalid or empty viewports do not retain previews', () => {
  const document = createDocument();
  const image = createNode('image', { id: 'image', assetId: 'asset' });
  addNode(document, image);
  assert.deepEqual([...collectVisibleImagePreviewKeys(document.pages[0], document, null)], []);
  assert.deepEqual([...collectVisibleImagePreviewKeys(document.pages[0], document, {
    left: 4, right: 3, top: 0, bottom: 1
  })], []);
});
