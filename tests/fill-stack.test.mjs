import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createComponent, createComponentInstance, createDocument, createFillLayer, createGradientFill, createNode, addNode, duplicateNode, parseDocument, serializeDocument, syncComponentInstances, validateDocument } from '../src/model.js';
import { createImageFill } from '../src/image-fills.js';
import { addFillLayer, detachPrimaryFillBinding, ensureFillStack, fillStackForNode, isFillStackSupported, isValidFillStack, moveFillLayer, removeFillLayer, syncLegacyFillFields, updateFillLayer } from '../src/fills.js';
import { imagePreviewKey } from '../src/image-preview-runtime.js';
import { SceneRenderer } from '../src/renderer.js';
import { vectorNetworkGeometryFromAnchors } from '../src/vector-path.js';

function triangleNode(overrides = {}) {
  const geometry = vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 40 }
  ], { closed: true });
  return createNode('network', { ...geometry, ...overrides });
}

function renderNode(node, assets = new Map(), previews = new Map()) {
  const document = createDocument();
  addNode(document, node);
  const calls = [];
  const state = { document, assets, previews, previewAssetIds: new Map([...previews.keys()].map(key => [key, 'asset-local'])), selectedIds: [], outlineMode: false, presenting: false, zoom: 1 };
  const context = {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    save() {}, restore() {}, beginPath() {}, rect() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { calls.push({ kind: 'fill', color: this.fillStyle, alpha: this.globalAlpha }); },
    stroke() {}, setLineDash() {}, clip() {},
    drawImage(image) { calls.push({ kind: 'image', image }); },
    createLinearGradient() { calls.push({ kind: 'linear-gradient' }); return { kind: 'gradient', addColorStop() {} }; },
    createRadialGradient() { calls.push({ kind: 'radial-gradient' }); return { kind: 'gradient', addColorStop() {} }; }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => state;
  renderer.drawNode(context, node, 0, 0, assets);
  return calls;
}

test('legacy single paints become a stable, editable layer without changing until materialized', () => {
  const legacy = createNode('rectangle', { id: 'shape-1', fill: '#123456', fillOpacity: 0.4 });
  const initial = fillStackForNode(legacy);
  assert.deepEqual(initial, [{ id: 'legacy-fill:shape-1', type: 'solid', color: '#123456', visible: true, opacity: 0.4 }]);
  assert.equal(Object.hasOwn(legacy, 'fills'), false, 'opening an older file does not rewrite its document');
  const stack = ensureFillStack(legacy);
  stack[0].visible = false;
  syncLegacyFillFields(legacy);
  assert.equal(legacy.fillOpacity, 0.4);
  assert.equal(legacy.fill, '#123456');
  assert.equal(fillStackForNode(legacy)[0].visible, false);
});

test('fill stack editing adds, removes, reorders, hides, and adjusts opacity without losing paint identity', () => {
  const node = createNode('rectangle', { id: 'editable-shape', fill: '#123456' });
  const original = fillStackForNode(node)[0];
  const overlay = createFillLayer('solid', { color: '#abcdef' });
  assert.equal(addFillLayer(node, overlay), true);
  assert.deepEqual(node.fills.map(fill => fill.id), [original.id, overlay.id]);
  assert.equal(moveFillLayer(node, overlay.id, 'up'), true);
  assert.deepEqual(node.fills.map(fill => fill.id), [overlay.id, original.id]);
  updateFillLayer(node, overlay.id, { visible: false, opacity: 0.42 });
  assert.equal(node.fills[0].visible, false);
  assert.equal(node.fills[0].opacity, 0.42);
  assert.equal(node.fill, '#abcdef', 'the primary legacy fields mirror the reordered first fill');
  assert.equal(removeFillLayer(node, overlay.id).id, overlay.id);
  assert.deepEqual(node.fills.map(fill => fill.id), [original.id]);
  assert.equal(node.fill, '#123456');
  assert.equal(moveFillLayer(node, original.id, 'up'), false);
});

test('a node-level fill binding is baked onto its paint before the primary slot changes', () => {
  const node = {
    fillStyleId: 'shared-style',
    fillVariableId: 'brand-color',
    variableBindings: { fill: 'brand-color', opacity: 'opacity-token' },
    fills: [
      createFillLayer('solid', { id: 'linked-primary', color: '#111111' }),
      createFillLayer('solid', { id: 'next-primary', color: '#22aa44' })
    ]
  };
  const previousPrimary = node.fills[0];

  assert.equal(detachPrimaryFillBinding(node, previousPrimary, '#336699'), true);
  assert.equal(previousPrimary.color, '#336699');
  assert.equal(node.fillStyleId, undefined);
  assert.equal(node.fillVariableId, undefined);
  assert.deepEqual(node.variableBindings, { opacity: 'opacity-token' });
});

test('removing a linked primary clears its node-level binding without recoloring the next paint', () => {
  const node = {
    fillVariableId: 'brand-color',
    fills: [createFillLayer('solid', { id: 'removed-primary', color: '#111111' }), createFillLayer('solid', { id: 'remaining', color: '#22aa44' })]
  };
  const previousPrimary = node.fills[0];
  node.fills.shift();

  assert.equal(detachPrimaryFillBinding(node, previousPrimary, '#336699'), true);
  assert.equal(node.fills[0].color, '#22aa44');
  assert.equal(node.fillVariableId, undefined);
});

test('an edited image-fill preview follows its stable fill ID after moving below the primary paint', () => {
  const preview = { width: 18, height: 28 };
  const node = createNode('rectangle', {
    id: 'reordered-image-fill', width: 80, height: 50,
    fills: [
      createFillLayer('solid', { id: 'solid-primary', color: '#123456' }),
      createFillLayer('image', { id: 'image-secondary', imageFill: createImageFill('asset-local') })
    ]
  });
  const original = { width: 2, height: 2 };
  const calls = renderNode(node, new Map([['asset-local', { bitmap: original }]]), new Map([[imagePreviewKey(node.id, 'image-secondary'), preview]]));

  assert.equal(calls.find(call => call.kind === 'image')?.image, preview);
});

test('duplicated image-fill layers can retain paint IDs without sharing preview resources', () => {
  const document = createDocument();
  const source = createNode('rectangle', {
    id: 'duplicate-source',
    fills: [createFillLayer('image', { id: 'shared-fill-id', imageFill: createImageFill('asset-local') })]
  });
  addNode(document, source);
  const copy = duplicateNode(document, source.id);

  assert.equal(copy.fills[0].id, source.fills[0].id, 'the copy preserves fill identity inside its own layer');
  assert.notEqual(imagePreviewKey(copy.id, copy.fills[0].id), imagePreviewKey(source.id, source.fills[0].id));
});

test('Boolean surfaces composite the fill-ID preview without an image-fill reference error', () => {
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  const drawnImages = [];
  class TestCanvasContext {
    constructor(canvas) { this.canvas = canvas; }
    setTransform() {} save() {} restore() {} beginPath() {} rect() {} ellipse() {} fill() {} clearRect() {}
    fillRect() {} clip() {} moveTo() {} lineTo() {} closePath() {}
    drawImage(image) { drawnImages.push(image); }
  }
  class TestOffscreenCanvas {
    constructor(width, height) { this.width = width; this.height = height; this.context = new TestCanvasContext(this); }
    getContext() { return this.context; }
  }
  globalThis.OffscreenCanvas = TestOffscreenCanvas;
  try {
    const document = createDocument();
    const node = createNode('boolean', {
      id: 'boolean-with-image-paint', width: 40, height: 40,
      children: [createNode('rectangle', { id: 'operand-one', width: 40, height: 40 }), createNode('ellipse', { id: 'operand-two', width: 20, height: 20 })],
      fills: [createFillLayer('image', { id: 'boolean-image-paint', imageFill: createImageFill('asset-local') })]
    });
    addNode(document, node);
    let preview = { width: 8, height: 8 };
    const previewKey = imagePreviewKey(node.id, 'boolean-image-paint');
    const state = {
      document, assets: new Map([['asset-local', { bitmap: { width: 2, height: 2 } }]]),
      previews: new Map([[previewKey, preview]]), previewAssetIds: new Map([[previewKey, 'asset-local']]),
      previewVersions: new Map([[previewKey, 1]]),
      selectedIds: [], outlineMode: false, presenting: false, zoom: 1
    };
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => state;
    renderer.booleanCache = new Map();
    renderer.booleanCachePixels = 0;

    const firstSurface = renderer.getBooleanSurface(node, state.assets, false, 1);
    assert.ok(drawnImages.includes(preview), 'the secondary surface uses the edited paint preview');

    const updatedPreview = { width: 12, height: 6 };
    preview = updatedPreview;
    state.previews.set(previewKey, updatedPreview);
    state.previewVersions.set(previewKey, 2);
    drawnImages.length = 0;
    const updatedSurface = renderer.getBooleanSurface(node, state.assets, false, 1);
    assert.notEqual(updatedSurface, firstSurface, 'a new fill preview version should invalidate the cached Boolean surface');
    assert.ok(drawnImages.includes(updatedPreview), 'the recomposed Boolean surface should use the latest fill preview');
  } finally {
    if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousOffscreenCanvas;
  }
});

test('fill stacks validate and round-trip through the document model, including image paint', () => {
  const node = createNode('rectangle', {
    fills: [
      createFillLayer('solid', { color: '#0c7a6a', opacity: 0.8 }),
      createFillLayer('radial', { gradient: createGradientFill('radial', '#ffffff'), opacity: 0.25 }),
      createFillLayer('image', { imageFill: createImageFill('asset-local', { fit: 'contain' }), visible: false })
    ]
  });
  const document = createDocument();
  addNode(document, node);
  assert.equal(isValidFillStack(node.fills, node, { isValidImageFill: () => true, isImageFillSupported: () => true }), true);
  validateDocument(document);
  const restored = parseDocument(serializeDocument(document)).pages[0].children[0];
  assert.deepEqual(restored.fills, node.fills);
  assert.equal(restored.fill, node.fill, 'the original one-fill field remains available to older consumers');
  assert.equal(isValidFillStack([{ ...node.fills[0], opacity: 1.1 }], node), false);
  assert.equal(isValidFillStack([node.fills[0], { ...node.fills[0] }], node), false, 'fill IDs are unique within the stack');
  for (const unsupportedType of ['image', 'line', 'text']) {
    const unsupported = createNode(unsupportedType);
    assert.equal(isFillStackSupported(unsupported), false, `${unsupportedType} keeps its dedicated paint controls`);
    assert.equal(isValidFillStack([createFillLayer('solid')], unsupported), false, `${unsupportedType} rejects unsupported fill stacks`);
  }
});

test('per-fill blend modes default to normal, edit only to supported values, and survive document reload', () => {
  const paint = createFillLayer('solid', { id: 'screen-paint', color: '#123456', blendMode: 'screen' });
  const node = createNode('rectangle', { fills: [paint] });
  assert.equal(paint.blendMode, 'screen');
  assert.equal(isValidFillStack(node.fills, node), true);
  assert.equal(updateFillLayer(node, paint.id, { blendMode: 'multiply' }).blendMode, 'multiply');
  assert.equal(updateFillLayer(node, paint.id, { blendMode: 'vivid-light' }).blendMode, 'multiply', 'unsupported edits are ignored');
  const document = createDocument();
  addNode(document, node);
  const restored = parseDocument(serializeDocument(document)).pages[0].children[0];
  assert.equal(restored.fills[0].blendMode, 'multiply');
  assert.equal(isValidFillStack([{ ...paint, blendMode: 'vivid-light' }], node), false);
  assert.equal(isValidFillStack([{ ...paint, blendMode: 'PASS_THROUGH' }], node), false);
  assert.equal(isValidFillStack([{ ...paint, blendMode: 'normal' }], node), true);
  assert.equal(createFillLayer('solid').blendMode, 'normal', 'new paints explicitly default to normal');
});

test('linked component fill-stack overrides keep an instance-local base and overlay through master edits and reload', () => {
  const document = createDocument();
  const master = createNode('rectangle', {
    name: 'Card background',
    fills: [{ id: 'master-base', type: 'solid', color: '#223344', visible: true, opacity: 1 }]
  });
  addNode(document, master);
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);

  const localStack = structuredClone(instance.fills);
  localStack[0].color = '#aabbcc';
  localStack.push(createFillLayer('linear', { gradient: createGradientFill('linear', '#ff6600'), opacity: 0.65 }));
  instance.fills = localStack;
  instance.componentOverrides[master.id] = { fills: structuredClone(localStack) };

  master.fills[0].color = '#445566';
  syncLegacyFillFields(master);
  assert.equal(syncComponentInstances(document, component.id), 1);
  assert.equal(master.fills[0].color, '#445566', 'the component source accepts its base paint edit');
  assert.deepEqual(instance.fills, localStack, 'the full instance override keeps its edited base and instance-only overlay');
  assert.equal(validateDocument(document), true);

  const reopened = parseDocument(serializeDocument(document));
  const reopenedInstance = reopened.pages[0].children.find(node => node.isInstance);
  assert.deepEqual(reopenedInstance.fills, localStack);
  assert.deepEqual(reopenedInstance.componentOverrides[master.id].fills, localStack);
  assert.equal(validateDocument(reopened), true);
});

test('shape rendering paints visible fills in order with independent opacity', () => {
  const node = createNode('rectangle', {
    width: 80, height: 60,
    fills: [
      { id: 'base', type: 'solid', color: '#111111', visible: true, opacity: 1 },
      { id: 'hidden', type: 'solid', color: '#222222', visible: false, opacity: 1 },
      { id: 'overlay', type: 'solid', color: '#abcdef', visible: true, opacity: 0.35 }
    ]
  });
  const paints = renderNode(node).filter(call => call.kind === 'fill');
  assert.deepEqual(paints, [
    { kind: 'fill', color: 'rgba(17, 17, 17, 1)', alpha: 1 },
    { kind: 'fill', color: 'rgba(171, 205, 239, 1)', alpha: 0.35 }
  ]);
});

test('legacy network face colors retain image-first and gradient-second precedence', () => {
  const bitmap = { width: 20, height: 20 };
  const assets = new Map([['asset-local', { bitmap }]]);
  const imageNetwork = triangleNode({
    fill: '#101010',
    imageFill: createImageFill('asset-local'),
    faces: [{ id: 'face', vertexIds: ['v1', 'v2', 'v3'], fill: '#ff0000' }]
  });
  const imageCalls = renderNode(imageNetwork, assets);
  assert.equal(imageCalls.filter(call => call.kind === 'image').length, 1, 'legacy image fill still wins over an explicit face color');
  assert.equal(imageCalls.filter(call => call.kind === 'fill').length, 0);

  const gradientNetwork = triangleNode({
    fill: '#101010',
    fillGradient: createGradientFill('linear', '#00ff00'),
    faces: [{ id: 'face', vertexIds: ['v1', 'v2', 'v3'], fill: '#ff0000' }]
  });
  const gradientCalls = renderNode(gradientNetwork);
  assert.equal(gradientCalls.some(call => call.kind === 'linear-gradient'), false, 'an explicit face color still overrides a legacy gradient');
  assert.equal(gradientCalls.find(call => call.kind === 'fill')?.color, 'rgba(255, 0, 0, 1)');
});

test('explicit network stacks preserve image and gradient paints over face colors, but solid faces still override', () => {
  const bitmap = { width: 20, height: 20 };
  const assets = new Map([['asset-local', { bitmap }]]);
  const face = { id: 'face', vertexIds: ['v1', 'v2', 'v3'], fill: '#ff0000' };
  const imageNetwork = triangleNode({ fills: [{ id: 'image', type: 'image', imageFill: createImageFill('asset-local'), visible: true, opacity: 1 }], faces: [face] });
  assert.equal(renderNode(imageNetwork, assets).filter(call => call.kind === 'image').length, 1);

  const gradientNetwork = triangleNode({ fills: [{ id: 'gradient', type: 'linear', gradient: createGradientFill('linear', '#00ff00'), visible: true, opacity: 1 }], faces: [face] });
  const gradientCalls = renderNode(gradientNetwork);
  assert.equal(gradientCalls.some(call => call.kind === 'linear-gradient'), true);
  assert.equal(gradientCalls.find(call => call.kind === 'fill')?.color.kind, 'gradient');

  const solidNetwork = triangleNode({ fills: [{ id: 'solid', type: 'solid', color: '#00ff00', visible: true, opacity: 1 }], faces: [face] });
  assert.equal(renderNode(solidNetwork).find(call => call.kind === 'fill')?.color, 'rgba(255, 0, 0, 1)');
});

test('Inspector markup and delegated events expose add/remove/reorder/visibility/opacity for fills', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const marker of [
    'data-action="add-fill-layer"', 'data-action="remove-fill-layer"', 'data-action="move-fill-layer"',
    'data-fill-field="visible"', 'data-fill-field="opacity"', 'data-fill-field="blendMode"', "select('blendMode', 'Blend'", "field === 'blendMode') updateStroke", 'paintBlendCompositionWarning(node)', 'updateFillInput(fillField)',
    "recordNodeComponentOverrides(node, ['fills'"
  ]) assert.ok(source.includes(marker), `Inspector is wired for ${marker}`);
});
