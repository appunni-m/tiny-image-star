import test from 'node:test';
import assert from 'node:assert/strict';
import { deepestContainerAtPagePoint, drawCropPreview, drawCropSourceImage, drawFittedImage, drawImageWithTransforms, drawTextDecoration, drawTextRuns, drawTrackedText, fillLayerColor, hitTestPage, measureTrackedText, SceneRenderer, selectionGroupHandles, selectionOverlayGeometry, sliceSelectionHandles, textVerticalOffset, wrapText } from '../src/renderer.js';
import { imagePreviewKey, imagePreviewSettingsForNode, imagePreviewSettingsSignature } from '../src/image-preview-runtime.js';
import { createImageFill } from '../src/image-fills.js';
import { addNode, addVariableMode, bindVariable, createDocument, createNode, createVariable, createVariableCollection, setFrameVariableMode, setVariableValue } from '../src/model.js';
import { vectorNetworkGeometryFromAnchors } from '../src/vector-path.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';

function textContext({ nativeTracking = false } = {}) {
  const calls = [];
  const context = {
    calls,
    measureText(value) {
      const width = [...String(value)].reduce((total, character) => total + (character === ' ' ? 5 : 10), 0);
      return { width: value === 'AV' ? width - 1 : width };
    },
    fillText(...args) { calls.push(args); }
  };
  if (nativeTracking) context.letterSpacing = '';
  return context;
}

test('group transform handles follow non-zero selection bounds while keeping rotation available', () => {
  const regular = selectionGroupHandles({ x: 10, y: 20, width: 30, height: 40 });
  assert.deepEqual(Object.keys(regular.resize), ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  assert.deepEqual(regular.rotate, { x: 25, y: -4 });

  const horizontal = selectionGroupHandles({ x: 10, y: 20, width: 30, height: 0 });
  assert.deepEqual(horizontal.resize, {
    e: { x: 40, y: 20 },
    w: { x: 10, y: 20 }
  });
  assert.deepEqual(horizontal.rotate, { x: 25, y: -4 });

  const vertical = selectionGroupHandles({ x: 10, y: 20, width: 0, height: 40 });
  assert.deepEqual(vertical.resize, {
    n: { x: 10, y: 20 },
    s: { x: 10, y: 60 }
  });
  assert.deepEqual(vertical.rotate, { x: 10, y: -4 });

  const point = selectionGroupHandles({ x: 10, y: 20, width: 0, height: 0 });
  assert.deepEqual(point.resize, {});
  assert.deepEqual(point.rotate, { x: 10, y: -4 });
});

test('single slice selection exposes eight axis-aligned resize handles and no rotation handle', () => {
  const handles = sliceSelectionHandles({ type: 'slice', x: 12, y: 24, width: 80, height: 60, rotation: 0 });
  assert.deepEqual(handles, { resize: {
    nw: { x: 12, y: 24 }, n: { x: 52, y: 24 }, ne: { x: 92, y: 24 },
    e: { x: 92, y: 54 }, se: { x: 92, y: 84 }, s: { x: 52, y: 84 },
    sw: { x: 12, y: 84 }, w: { x: 12, y: 54 }
  } });
  assert.equal(sliceSelectionHandles({ type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }), null);
  assert.equal(sliceSelectionHandles({ type: 'slice', x: 0, y: 0, width: 0, height: 10 }), null);
});

test('remote live presence draws page-scoped cursor labels and selection outlines', () => {
  const document = createDocument();
  const page = document.pages[0];
  const node = createNode('rectangle', { x: 24, y: 36, width: 80, height: 40 });
  node.id = 'layer-remote';
  addNode(document, node, { pageId: page.id });
  const calls = [];
  const context = {
    save() {}, restore() {}, translate() {}, scale() {},
    beginPath: () => calls.push('path'), moveTo() {}, lineTo() {}, closePath() {},
    stroke: () => calls.push('stroke'), fill() {}, fillRect() {}, setLineDash() {},
    measureText: value => ({ width: String(value).length * 6 }),
    fillText: value => calls.push(`label:${value}`)
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.drawRemotePresence(context, page, {
    document, zoom: 1, motionPreview: new Map(),
    remotePresence: new Map([
      ['peer-a', { peerActorId: 'peer-a', active: true, pageId: page.id, cursorX: 20, cursorY: 30, selectedIds: ['layer-remote'] }],
      ['peer-b', { peerActorId: 'peer-b', active: true, pageId: 'another-page', cursorX: 1, cursorY: 2, selectedIds: ['layer-remote'] }],
      ['peer-c', { peerActorId: 'peer-c', active: false, pageId: page.id, cursorX: null, cursorY: null, selectedIds: [] }]
    ])
  });
  assert.equal(calls.filter(call => call === 'stroke').length, 2, 'one page-scoped layer outline and one cursor are drawn');
  assert.deepEqual(calls.filter(call => String(call).startsWith('label:')), ['label:Guest er-a']);
});

test('scene renderer carries sticky scroll context through nested groups', () => {
  const document = createDocument();
  const scroller = createNode('frame', {
    x: 0, y: 0, width: 100, height: 100, overflowBehavior: 'vertical', fill: 'transparent', strokeWidth: 0
  });
  const parent = createNode('group', { x: 0, y: 30, width: 80, height: 120, fill: 'transparent', strokeWidth: 0 });
  const sticky = createNode('rectangle', {
    x: 0, y: 40, width: 40, height: 20, scrollPosition: 'sticky', fill: '#ff0000', strokeWidth: 0
  });
  parent.children.push(sticky);
  scroller.children.push(parent);
  addNode(document, scroller);
  const state = {
    document, assets: new Map(), previews: new Map(), previewAssetIds: new Map(), previewSignatures: new Map(),
    imageStatus: new Map(), motionPreview: new Map(), selectedIds: [], zoom: 1,
    imageCropMode: false, presenting: true, outlineMode: false,
    presentationScrollOffsets: new Map([[scroller.id, { x: 0, y: 90 }]])
  };
  const calls = [];
  const context = new Proxy({ globalAlpha: 1, globalCompositeOperation: 'source-over' }, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => calls.push([property, ...args]);
    },
    set(target, property, value) { target[property] = value; return true; }
  });
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => state;
  renderer.drawNode(context, scroller, 0, 0, state.assets);

  const translations = calls.filter(([method]) => method === 'translate').map(([, x, y]) => [x, y]);
  assert.ok(translations.some(([x, y]) => x === 0 && y === -90), 'the scroll frame moves its content');
  assert.ok(translations.some(([x, y]) => x === 0 && y === 20), 'the nested sticky child is compensated to the viewport top');
});

test('live smart-image rendering crops the original bitmap before fitting, rotating, and flipping', () => {
  const calls = [];
  const context = {
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    translate: (...args) => calls.push(['translate', ...args]),
    scale: (...args) => calls.push(['scale', ...args]),
    rotate: (...args) => calls.push(['rotate', ...args]),
    drawImage: (...args) => calls.push(['drawImage', ...args])
  };
  const image = { width: 400, height: 200 };
  assert.equal(drawImageWithTransforms(context, image, 10, 20, 100, 100, 'contain', {
    crop: { left: .25, top: .25, right: .75, bottom: .75 },
    rotation: 90, flipHorizontal: true, flipVertical: false
  }), true);
  assert.deepEqual(calls, [
    ['save'], ['translate', 60, 70], ['scale', -1, 1], ['rotate', Math.PI / 2],
    ['drawImage', image, 100, 50, 200, 100, -50, -25, 100, 50], ['restore']
  ]);
});

test('live smart-image cover fitting uses the rotated crop bounds', () => {
  const calls = [];
  const context = {
    save() {}, restore() {}, translate() {}, rotate() {},
    drawImage: (...args) => calls.push(args)
  };
  const image = { width: 400, height: 200 };
  assert.equal(drawImageWithTransforms(context, image, 0, 0, 120, 80, 'cover', {
    crop: { left: .25, top: .25, right: .75, bottom: .75 },
    rotation: 90, flipHorizontal: false, flipVertical: false
  }), true);
  assert.deepEqual(calls, [[image, 100, 50, 200, 100, -120, -60, 240, 120]]);
});

test('Tile image rendering repeats the original-sized pattern at the requested scale and honors transforms', () => {
  const calls = [];
  const pattern = { setTransform: matrix => calls.push(['setTransform', matrix]) };
  const context = {
    createPattern: (...args) => { calls.push(['createPattern', ...args]); return pattern; },
    save: () => calls.push(['save']), restore: () => calls.push(['restore']),
    fillRect: (...args) => calls.push(['fillRect', ...args])
  };
  const image = { width: 200, height: 100 };
  assert.equal(drawFittedImage(context, image, 10, 20, 80, 60, 'tile', 0.5, {
    rotation: 90, flipHorizontal: true
  }, { width: 400, height: 200 }), true);
  assert.deepEqual(calls[0], ['createPattern', image, 'repeat']);
  assert.deepEqual(calls[1], ['setTransform', { a: -0, b: -1, c: -1, d: 0, e: 110, f: 220 }]);
  assert.deepEqual(calls.slice(2), [['save'], ['fillRect', 10, 20, 80, 60], ['restore']]);

  const unsupportedContext = { createPattern: () => ({}) };
  assert.equal(drawFittedImage(unsupportedContext, image, 0, 0, 50, 50, 'tile'), false,
    'an unavailable CanvasPattern transform must fail closed instead of silently drawing a different fit mode');
});

test('image layers and fills render Tile through the clipped CanvasPattern path', () => {
  const source = { name: 'source pixels', width: 320, height: 160 };
  const asset = { bitmap: source, width: source.width, height: source.height, sourceWidth: source.width, sourceHeight: source.height };
  const document = createDocument();
  const fillNode = createNode('rectangle', {
    width: 180, height: 100,
    fills: [{ id: 'tile-fill', type: 'image', visible: true, opacity: 1,
      imageFill: createImageFill('photo', { fit: 'tile', scalingFactor: 0.25 }) }]
  });
  const imageNode = createNode('image', { assetId: 'photo', width: 120, height: 90, fit: 'tile', scalingFactor: 0.5 });
  addNode(document, fillNode);
  addNode(document, imageNode);
  const state = {
    document, assets: new Map([['photo', asset]]), previews: new Map(), previewAssetIds: new Map(),
    previewSignatures: new Map(), zoom: 1, selectedIds: [], imageCropMode: false, presenting: false,
    outlineMode: false, imageStatus: new Map()
  };
  const calls = [];
  const context = new Proxy({ globalAlpha: 1, globalCompositeOperation: 'source-over' }, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === 'createPattern') return (image, repetition) => {
        calls.push(['createPattern', image, repetition]);
        return { setTransform: matrix => calls.push(['setTransform', matrix]) };
      };
      return (...args) => calls.push([property, ...args]);
    },
    set(target, property, value) { target[property] = value; return true; }
  });
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => state;

  renderer.drawNode(context, fillNode, 0, 0, state.assets);
  renderer.drawNode(context, imageNode, 0, 0, state.assets);

  const patternCalls = calls.filter(([method]) => method === 'createPattern');
  assert.equal(patternCalls.length, 2, 'both image layers and image paints use the same Tile renderer');
  assert.ok(patternCalls.every(([, image, repetition]) => image === source && repetition === 'repeat'));
  assert.equal(calls.filter(([method]) => method === 'fillRect').length, 2);
  assert.equal(calls.filter(([method]) => method === 'clip').length, 2,
    'Tile paint is clipped to its image layer or fill geometry');
});

test('scene renderer bypasses endpoint previews for live smart-animate image layers and fills', () => {
  const document = createDocument();
  const source = { name: 'original bitmap', width: 400, height: 200 };
  const preview = { name: 'endpoint preview', width: 200, height: 200 };
  const fillId = 'smart-fill';
  const fillNode = createNode('rectangle', {
    width: 100, height: 80,
    fills: [{ id: fillId, type: 'image', visible: true, opacity: 1,
      imageFill: createImageFill('photo', { transforms: { crop: { left: .2, top: .1, right: .8, bottom: .9 } } }),
      __smartAnimateLiveImageFill: true }]
  });
  const imageNode = createNode('image', {
    assetId: 'photo', width: 100, height: 80,
    transforms: { crop: { left: .1, top: .2, right: .9, bottom: .8 }, rotation: 90 },
    __smartAnimateLiveImageTransforms: true
  });
  const fillKey = imagePreviewKey(fillNode.id, fillId);
  const state = {
    document, assets: new Map([['photo', { bitmap: source }]]),
    previews: new Map([[fillKey, preview], [imageNode.id, preview]]),
    zoom: 1, selectedIds: [], imageCropMode: false, presenting: true
  };
  const calls = [];
  const context = new Proxy({ globalAlpha: 1, globalCompositeOperation: 'source-over' }, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => calls.push([property, ...args]);
    },
    set(target, property, value) { target[property] = value; return true; }
  });
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => state;
  renderer.drawNode(context, fillNode, 0, 0, state.assets);
  renderer.drawNode(context, imageNode, 0, 0, state.assets);

  const imageCalls = calls.filter(([method]) => method === 'drawImage');
  assert.equal(imageCalls.length, 2);
  assert.ok(imageCalls.every(([, image]) => image === source), 'live paints must draw the source, never the baked endpoint preview');
  assert.deepEqual(imageCalls.map(call => call.slice(2, 6)), [
    [80, 20, 240, 160], [40, 40, 320, 120]
  ], 'each draw uses its own current crop rectangle from the source bitmap');
});

test('processed Smart Animate previews blend additively and reject stale endpoint settings', () => {
  const canvases = [];
  class TransitionCanvas {
    constructor(width, height) {
      this.width = width; this.height = height; this.calls = [];
      this.context = {
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        setTransform(...args) { this.calls.push({ method: 'setTransform', args }); },
        clearRect(...args) { this.calls.push({ method: 'clearRect', args }); },
        drawImage(...args) { this.calls.push({ method: 'drawImage', args, alpha: this.globalAlpha, composite: this.globalCompositeOperation }); }
      };
      this.context.calls = this.calls;
      canvases.push(this);
    }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = TransitionCanvas;
  try {
    const document = createDocument();
    const from = { previewKey: 'from-image', assetId: 'asset-a', signature: 'settings-a', fit: 'cover', opacity: .2, sourceRenderable: false };
    const to = { previewKey: 'to-image', assetId: 'asset-b', signature: 'settings-b', fit: 'contain', opacity: .8, sourceRenderable: false };
    const fromBitmap = { name: 'processed source', width: 200, height: 100 };
    const toBitmap = { name: 'processed target', width: 100, height: 200 };
    const state = {
      document, zoom: 1, previews: new Map([[from.previewKey, fromBitmap], [to.previewKey, toBitmap]]),
      previewAssetIds: new Map([[from.previewKey, from.assetId], [to.previewKey, to.assetId]]),
      previewSignatures: new Map([[from.previewKey, from.signature], [to.previewKey, to.signature]]),
      imageStatus: new Map([[from.previewKey, 'Updated · Pillow-RS WASM'], [to.previewKey, 'Updated · Pillow-RS WASM']])
    };
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => state;
    const destination = [];
    const ctx = {
      getTransform: () => ({ a: 1, b: 0 }),
      drawImage: (...args) => destination.push(args)
    };
    const transition = { from, to, progress: .25 };

    assert.equal(renderer.drawSmartAnimateImageTransition(ctx, transition, new Map(), state, 4, 8, 120, 80), true);
    assert.equal(canvases.length, 1);
    const blended = canvases[0].calls.filter(call => call.method === 'drawImage');
    assert.deepEqual(blended.map(call => [call.args[0].name, call.composite]), [
      ['processed source', 'lighter'], ['processed target', 'lighter']
    ]);
    assert.ok(Math.abs(blended[0].alpha - 3 / 7) < Number.EPSILON * 2);
    assert.ok(Math.abs(blended[1].alpha - 4 / 7) < Number.EPSILON * 2,
      'endpoint opacities are normalized once before additive premultiplied compositing');
    assert.equal(destination.length, 1);
    assert.equal(destination[0][0], canvases[0]);
    assert.deepEqual(destination[0].slice(1), [4, 8, 120, 80]);

    state.previewSignatures.set(to.previewKey, 'stale-settings');
    assert.equal(renderer.drawSmartAnimateImageTransition(ctx, transition, new Map(), state, 4, 8, 120, 80), true,
      'one still-verified endpoint remains visible if the other preview becomes stale');
    const latestDraws = canvases[0].calls.filter(call => call.method === 'drawImage').slice(-1);
    assert.equal(latestDraws[0].args[0], fromBitmap);
    assert.equal(latestDraws[0].alpha, 1);

    state.previewSignatures.set(from.previewKey, 'also-stale');
    assert.equal(renderer.drawSmartAnimateImageTransition(ctx, transition, new Map(), state, 4, 8, 120, 80), false,
      'stale endpoint previews are never rendered as current edits');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('image and container layers contribute their alpha when used as mask sources', () => {
  const document = createDocument();
  const sourceBitmap = { name: 'source bitmap', width: 200, height: 100 };
  const editedPreview = { name: 'edited alpha preview', width: 80, height: 60 };
  const image = createNode('image', { assetId: 'mask-photo', width: 80, height: 60, opacity: 0.7 });
  addNode(document, image);
  const imagePreviewSettings = imagePreviewSettingsForNode(image, image.id);
  const state = {
    document, assets: new Map([['mask-photo', { bitmap: sourceBitmap }]]),
    previews: new Map([[image.id, editedPreview]]), previewAssetIds: new Map([[image.id, 'mask-photo']]),
    previewSignatures: new Map([[image.id, imagePreviewSettingsSignature(imagePreviewSettings)]]),
    zoom: 1, presenting: false, selectedIds: [], imageCropMode: false
  };
  const makeContext = (calls, scale = 1) => new Proxy({ globalAlpha: 1, globalCompositeOperation: 'source-over' }, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === 'getTransform') return () => ({ a: scale, b: 0 });
      return (...args) => calls.push({ method: property, args, alpha: target.globalAlpha, fillStyle: target.fillStyle });
    },
    set(target, property, value) { target[property] = value; return true; }
  });
  const imageCalls = [];
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => state;
  renderer.drawNode(makeContext(imageCalls), image, 0, 0, state.assets, false, true);
  assert.ok(imageCalls.some(call => call.method === 'drawImage' && call.args[0] === editedPreview),
    'image-mask alpha follows the current per-layer preview when one is available');

  // Output format and quality affect downloads only. The editor preview stays
  // lossless PNG and its existing bitmap must remain valid after those edits.
  image.outputFormat = 'webp';
  image.outputQuality = 34;
  const formatOnlyCalls = [];
  renderer.drawNode(makeContext(formatOnlyCalls), image, 0, 0, state.assets, false, true);
  assert.ok(formatOnlyCalls.some(call => call.method === 'drawImage' && call.args[0] === editedPreview),
    'changing only export format/quality must keep the current edited canvas bitmap visible');

  const containerCalls = [];
  class RecordingCanvas {
    constructor(width, height) {
      this.width = width; this.height = height; this.calls = [];
      this.context = makeContext(this.calls);
    }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const child = createNode('rectangle', { width: 24, height: 18, fill: '#123456' });
    const sourceGroup = createNode('group', { width: 40, height: 30, opacity: 0.6, children: [child] });
    renderer.drawNode(makeContext(containerCalls), sourceGroup, 0, 0, state.assets, false, true);
    const surfaceDraw = containerCalls.find(call => call.method === 'drawImage');
    assert.ok(surfaceDraw?.args[0] instanceof RecordingCanvas, 'container mask is flattened to a bounded alpha surface');
    assert.ok(surfaceDraw.args[0].calls.some(call => call.method === 'fill' && /18, 52, 86/.test(call.fillStyle || '')),
      `container children contribute their actual painted alpha: ${JSON.stringify(surfaceDraw.args[0].calls)}`);
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('shape alpha masks honor paint opacity and leave unpainted geometry transparent', () => {
  const document = createDocument();
  const painted = createNode('rectangle', {
    opacity: 0.6,
    fills: [{ id: 'paint', type: 'solid', visible: true, opacity: 0.25, color: '#ff0000' }],
    strokes: []
  });
  const empty = createNode('rectangle', { fill: 'transparent', fills: [], stroke: null, strokeWidth: 0 });
  addNode(document, painted);
  addNode(document, empty);
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });

  const recordDraws = node => {
    const calls = [];
    const target = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
    const stack = [];
    const context = new Proxy(target, {
      get(current, property) {
        if (property in current) return current[property];
        if (property === 'save') return () => stack.push({ ...current });
        if (property === 'restore') return () => Object.assign(current, stack.pop() || {});
        return (...args) => calls.push({ method: property, args, alpha: current.globalAlpha, fillStyle: current.fillStyle });
      },
      set(current, property, value) { current[property] = value; return true; }
    });
    renderer.drawNode(context, node, 0, 0, new Map(), false, true);
    return calls;
  };

  const paintedFill = recordDraws(painted).find(call => call.method === 'fill');
  assert.equal(paintedFill?.alpha, 0.15, 'node opacity and fill opacity both shape mask alpha');
  assert.equal(paintedFill?.fillStyle, 'rgba(255, 0, 0, 1)', 'mask compositing uses the source paint alpha');
  assert.equal(recordDraws(empty).some(call => call.method === 'fill'), false,
    'a shape with no visible fill or stroke contributes no mask alpha');
});

test('vector masks use opaque white visible fill and stroke geometry regardless of paint alpha', () => {
  const document = createDocument();
  const source = createNode('rectangle', {
    id: 'vector-mask-source', opacity: 0, fillOpacity: 0, strokeOpacity: 0,
    fills: [{ id: 'hidden-by-alpha', type: 'solid', visible: true, opacity: 0, color: 'transparent' }],
    strokes: [{ id: 'zero-alpha-stroke', color: 'transparent', width: 6, opacity: 0, visible: true,
      cap: 'round', join: 'round', pattern: 'solid', miterLimit: 10 }]
  });
  const noPaint = createNode('rectangle', {
    id: 'vector-mask-no-paint', fills: [{ id: 'hidden-fill', type: 'solid', visible: false, opacity: 1, color: '#f00' }],
    strokes: [{ id: 'hidden-stroke', color: '#00f', width: 5, opacity: 1, visible: false,
      cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 }]
  });
  addNode(document, source); addNode(document, noPaint);
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  const recordDraws = node => {
    const calls = [];
    const target = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
    const stack = [];
    const context = new Proxy(target, {
      get(current, property) {
        if (property in current) return current[property];
        if (property === 'save') return () => stack.push({ ...current });
        if (property === 'restore') return () => Object.assign(current, stack.pop() || {});
        return (...args) => calls.push({ method: property, args, alpha: current.globalAlpha,
          fillStyle: current.fillStyle, strokeStyle: current.strokeStyle, lineWidth: current.lineWidth });
      },
      set(current, property, value) { current[property] = value; return true; }
    });
    renderer.drawNode(context, node, 0, 0, new Map(), false, 'vector');
    return calls;
  };
  const calls = recordDraws(source);
  const fill = calls.find(call => call.method === 'fill');
  const stroke = calls.find(call => call.method === 'stroke');
  assert.equal(fill?.alpha, 1, 'zero layer and fill alpha do not weaken vector fill geometry');
  assert.equal(fill?.fillStyle, '#ffffff');
  assert.equal(stroke?.alpha, 1, 'zero stroke alpha does not weaken vector stroke geometry');
  assert.equal(stroke?.strokeStyle, '#ffffff');
  assert.equal(stroke?.lineWidth, 6, 'the source stroke extent remains part of the vector mask');
  assert.deepEqual(recordDraws(noPaint).filter(call => call.method === 'fill' || call.method === 'stroke'), [],
    'invisible paints do not contribute vector mask regions');
});

test('vector mask groups build an opaque source surface before applying destination-in', () => {
  const content = { id: 'masked-content', type: 'rectangle' };
  const source = { id: 'vector-source', type: 'ellipse' };
  const group = { id: 'mask-group', width: 20, height: 10, mask: true, maskMode: 'vector',
    maskSourceId: source.id, children: [content, source] };
  const canvases = [];
  const drawCalls = [];
  class RecordingCanvas {
    constructor(width, height) {
      this.width = width; this.height = height;
      this.context = {
        globalAlpha: 1, globalCompositeOperation: 'source-over', operations: [],
        setTransform(...args) { this.operations.push({ method: 'setTransform', args }); },
        drawImage(image, ...args) { this.operations.push({ method: 'drawImage', image, args, composite: this.globalCompositeOperation }); },
        clearRect() {}, save() {}, restore() {}
      };
      canvases.push(this);
    }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ zoom: 1 });
    renderer.drawNode = (ctx, node, _x, _y, _assets, _draft, maskMode) => {
      drawCalls.push({ surface: ctx, node: node.id, maskMode });
    };
    const destination = { getTransform: () => ({ a: 1, b: 0 }), drawImage() {} };
    renderer.drawMaskGroup(destination, group, 3, 4, new Map());
    assert.equal(canvases.length, 2, 'content and vector mask use separate bounded surfaces');
    assert.deepEqual(drawCalls.map(call => [call.node, call.maskMode]), [
      ['masked-content', false], ['vector-source', 'vector']
    ]);
    assert.ok(canvases[0].context.operations.some(operation => operation.method === 'drawImage'
      && operation.image === canvases[1] && operation.composite === 'destination-in'),
    'the fully composed vector source is applied once to the content surface');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('inner-shadow raster composition clips a shifted blurred mask back to the source alpha', () => {
  const created = [];
  class RecordingCanvas {
    constructor(width, height) {
      this.width = width; this.height = height; this.operations = [];
      this.context = {
        globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
        save: () => this.operations.push(['save']),
        restore: () => this.operations.push(['restore']),
        setTransform: (...args) => this.operations.push(['transform', ...args]),
        clearRect: (...args) => this.operations.push(['clearRect', ...args]),
        fillRect: (...args) => this.operations.push(['fillRect', ...args]),
        drawImage: (...args) => this.operations.push(['drawImage', ...args])
      };
      created.push(this);
    }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const source = new RecordingCanvas(160, 80);
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.applyInnerShadows(source, [
      { type: 'inner-shadow', visible: true, color: '#123456', opacity: 0.4, offsetX: 4, offsetY: -2, blur: 3 }
    ], 2, 160, 80);
    const overlay = created[1];
    assert.deepEqual(overlay.operations.find(operation => operation[0] === 'transform'), ['transform', 1, 0, 0, 1, 0, 0]);
    assert.ok(overlay.operations.some(operation => operation[0] === 'drawImage' && operation[1] === source && operation[2] === 8 && operation[3] === -4));
    assert.equal(overlay.context.filter, 'none');
    assert.equal(overlay.context.globalCompositeOperation, 'destination-in');
    assert.equal(source.context.globalAlpha, 0.4);
    assert.ok(source.operations.some(operation => operation[0] === 'drawImage' && operation[1] === overlay));
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('layer opacity is applied once after the completed effect surface', () => {
  const document = createDocument();
  const node = createNode('rectangle', {
    id: 'partially-transparent-card', width: 40, height: 24, opacity: 0.8,
    effects: [{ type: 'inner-shadow', visible: true, color: '#000000', opacity: 1, offsetX: 1, offsetY: 0, blur: 0 }]
  });
  addNode(document, node);
  const collection = createVariableCollection(document, 'Opacity');
  const opacity = createVariable(document, collection.id, 'Card opacity', 'number', 0.35);
  assert.equal(bindVariable(document, node.id, opacity.id, 'opacity'), true);

  const canvases = [];
  class RecordingCanvas {
    constructor(width, height) {
      this.width = width; this.height = height;
      const stack = [];
      this.context = {
        globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
        save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation, filter: this.filter }); },
        restore() { Object.assign(this, stack.pop()); },
        setTransform() {},
        drawImage: (...args) => this.draws.push({ args, alpha: this.context.globalAlpha })
      };
      this.draws = [];
      canvases.push(this);
    }
    getContext() { return this.context; }
  }

  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const parent = new RecordingCanvas(80, 48);
    parent.context.getTransform = () => ({ a: 1, b: 0 });
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, zoom: 1 });
    let sourceNode;
    renderer.drawNode = (_context, renderedNode) => { sourceNode = renderedNode; };
    renderer.applyInnerShadows = () => {};

    renderer.drawNodeWithEffects(parent.context, node, 0, 0, new Map(), node.effects);

    assert.equal(sourceNode.opacity, 1, 'node opacity stays out of the pixels used to build its effects');
    assert.equal(sourceNode.variableBindings.opacity, undefined, 'resolved opacity binding is applied only at final composition');
    const finalComposite = parent.draws.at(-1);
    assert.equal(finalComposite.alpha, 0.35);
    assert.equal(finalComposite.args[0], canvases[1], 'the finished effect surface is composited once');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('background blur samples the already-painted backdrop, clips to the authored mask, and redraws crisp content', () => {
  const canvases = [];
  class RecordingCanvas {
    constructor(width, height) {
      this.width = width; this.height = height; this.draws = [];
      this.context = {
        filters: [], composites: [], _filter: 'none', _composite: 'source-over',
        get filter() { return this._filter; }, set filter(value) { this._filter = value; this.filters.push(value); },
        get globalCompositeOperation() { return this._composite; }, set globalCompositeOperation(value) { this._composite = value; this.composites.push(value); },
        globalAlpha: 1,
        clearRect() {},
        drawImage: (...args) => this.draws.push(args),
        save() {}, restore() {}, setTransform: (...args) => { this.transform = args; }
      };
      canvases.push(this);
    }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const document = createDocument();
    const node = createNode('rectangle', {
      x: 20, y: 30, width: 50, height: 30, opacity: .6,
      effects: [{ id: 'backdrop', type: 'background-blur', visible: true, radius: 4 }]
    });
    addNode(document, node);
    const backdrop = { width: 240, height: 180 };
    const parent = {
      canvas: backdrop, filter: 'none', globalAlpha: .5, globalCompositeOperation: 'source-over',
      clipEnabled: true, drawImage: (...args) => parent.draws.push([...args, parent.clipEnabled]), draws: [],
      save() {}, restore() {}, setTransform() {}, getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    };
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document });
    const calls = [];
    renderer.drawNode = (...args) => calls.push(args);

    renderer.drawNodeWithBackgroundBlur(parent, node, 0, 0, new Map(), node.effects);

    assert.equal(canvases.length, 2, 'only the bounded backdrop and masked result scratch surfaces are allocated');
    assert.ok(canvases.every(canvas => canvas.width * canvas.height <= 4_000_000));
    assert.ok(canvases.every(canvas => canvas.width <= 4096 && canvas.height <= 4096));
    assert.equal(canvases[0].draws[0][0], backdrop, 'the already-painted scene is sampled without modifying it');
    assert.ok(canvases[1].context.filters.includes('blur(4px)'));
    assert.ok(canvases[1].context.composites.includes('destination-in'), 'blurred pixels are clipped through node alpha');
    assert.equal(calls.length, 2, 'the first draw builds the mask and the second redraws node content crisply');
    assert.equal(calls[0][1].opacity, 1, 'the alpha pass does not bake layer opacity into its mask');
    assert.deepEqual(calls[0][1].children, [], 'child layers do not enlarge the authored background-blur mask');
    assert.deepEqual(calls[0][1].effects, [], 'effects do not contaminate the authored background-blur mask');
    assert.deepEqual(calls[0][1].strokes, [], 'stroke-only alpha cannot reveal background blur');
    assert.deepEqual(calls[1][1].effects, [], 'background blur is removed from the crisp foreground pass');
    assert.deepEqual(node.effects, [{ id: 'backdrop', type: 'background-blur', visible: true, radius: 4 }], 'the authored node is immutable');
    assert.equal(parent.draws[0][0], canvases[1], 'only the masked result is composited onto the scene');
    assert.equal(parent.draws[0].at(-1), true, 'the active ancestor clip remains applied to the filtered layer composite');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('background blur bounds scratch allocation at extreme zoom and layer dimensions', () => {
  const canvases = [];
  class RecordingCanvas {
    constructor(width, height) { this.width = width; this.height = height; this.context = { filter: 'none', globalAlpha: 1, globalCompositeOperation: 'source-over', drawImage() {}, clearRect() {}, save() {}, restore() {}, setTransform() {} }; canvases.push(this); }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const document = createDocument();
    const node = createNode('rectangle', { x: 0, y: 0, width: 20_000, height: 20_000, effects: [{ id: 'backdrop', type: 'background-blur', visible: true, radius: 100 }] });
    addNode(document, node);
    const parent = { canvas: { width: 200, height: 200 }, filter: 'none', globalAlpha: 1, globalCompositeOperation: 'source-over', drawImage() {}, save() {}, restore() {}, setTransform() {}, getTransform: () => ({ a: 20, b: 0, c: 0, d: 20, e: 0, f: 0 }) };
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document });
    renderer.drawNode = () => {};
    renderer.drawNodeWithBackgroundBlur(parent, node, 0, 0, new Map(), node.effects);
    assert.equal(canvases.length, 2);
    assert.ok(canvases.every(canvas => canvas.width <= 4096 && canvas.height <= 4096));
    assert.ok(canvases.every(canvas => canvas.width * canvas.height <= 4_000_000));
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('Glass locally samples a bounded backdrop, builds a stable masked surface, and redraws only foreground content', () => {
  const canvases = [];
  class GlassCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.draws = [];
      this.reads = 0;
      this.context = {
        owner: this, filter: 'none', globalCompositeOperation: 'source-over', globalAlpha: 1,
        save() {}, restore() {}, setTransform() {}, clearRect() {},
        drawImage: (...args) => this.draws.push(args),
        getImageData: (_x, _y, imageWidth, imageHeight) => {
          this.reads += 1;
          const data = new Uint8ClampedArray(imageWidth * imageHeight * 4);
          for (let y = 0; y < imageHeight; y += 1) for (let x = 0; x < imageWidth; x += 1) {
            const offset = (y * imageWidth + x) * 4;
            if (this.reads === 1) {
              data[offset] = x * 7 % 255; data[offset + 1] = y * 9 % 255; data[offset + 2] = (x + y) * 5 % 255; data[offset + 3] = 255;
            } else data[offset + 3] = Math.round(x / Math.max(1, imageWidth - 1) * 255);
          }
          return { width: imageWidth, height: imageHeight, data };
        },
        putImageData: imageData => { this.pixels = Uint8ClampedArray.from(imageData.data); }
      };
      canvases.push(this);
    }
    getContext() { return this.context; }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  try {
    Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, writable: true, value: GlassCanvas });
    const document = createDocument();
    const effect = { id: 'glass', type: 'glass', visible: true, lightAngle: 225, lightIntensity: 70, refraction: 65, depth: 45, dispersion: 20, frost: 25, splay: 40 };
    const node = createNode('rectangle', { x: 24, y: 32, width: 52, height: 36, fillOpacity: .45, effects: [effect] });
    addNode(document, node);
    const scene = { width: 200, height: 160 };
    const parentDraws = [];
    const parent = {
      canvas: scene, globalAlpha: .8, globalCompositeOperation: 'source-over', filter: 'none',
      save() {}, restore() {}, setTransform() {},
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      drawImage: (...args) => parentDraws.push(args)
    };
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document });
    const sourceDraws = [];
    renderer.drawNode = (...args) => sourceDraws.push(args);

    renderer.drawNodeWithGlass(parent, node, 0, 0, new Map(), effect);

    assert.equal(canvases.length, 3, 'the implementation uses separate bounded backdrop, working, and silhouette surfaces');
    assert.ok(canvases.every(canvas => canvas.width * canvas.height <= 1_000_000));
    assert.ok(canvases.every(canvas => canvas.width <= 1536 && canvas.height <= 1536));
    assert.equal(canvases[0].draws[0][0], scene, 'only previously painted scene pixels feed the preview');
    assert.match(canvases[1].context.filter, /blur\(/, 'frost and edge contour use stable canvas filtering');
    assert.ok(canvases[0].context.globalCompositeOperation === 'destination-in' || canvases[0].draws.length >= 1);
    assert.equal(canvases[0].pixels?.length, canvases[0].width * canvases[0].height * 4, 'refracted pixels are written to the local surface');
    assert.deepEqual(sourceDraws[0][1].effects, [], 'mask passes never recurse into the backdrop slot');
    assert.equal(sourceDraws.at(-1)[1].effects.length, 0, 'the Glass effect is omitted from the crisp foreground pass');
    assert.equal(sourceDraws.at(-1)[1].fillOpacity, node.fillOpacity, 'foreground paint keeps the authored translucency');
    assert.deepEqual(node.effects, [effect], 'preview does not mutate the saved effect stack');
    assert.equal(parentDraws[0][0], canvases[0], 'the completed masked Glass surface is composited onto the scene');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'OffscreenCanvas', previous);
    else delete globalThis.OffscreenCanvas;
  }
});

test('Boolean source pixels scale and reposition into the resized group bounds', () => {
  class RecordingContext {
    constructor() { this.transforms = []; }
    setTransform(...matrix) { this.transforms.push(matrix); }
    save() {} restore() {} clearRect() {} fillRect() {} drawImage() {}
    beginPath() {} rect() {} fill() {}
  }
  class RecordingCanvas {
    constructor(width, height) { this.width = width; this.height = height; this.context = new RecordingContext(); }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const document = createDocument();
    const group = createNode('boolean', {
      width: 80, height: 60,
      children: [
        createNode('rectangle', { x: 10, y: 5, width: 40, height: 40 }),
        createNode('rectangle', { x: 20, y: 15, width: 20, height: 20 })
      ]
    });
    addNode(document, group);
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, assets: new Map(), zoom: 1 });
    renderer.booleanCache = new Map();
    renderer.booleanCachePixels = 0;
    renderer.drawNode = () => {};

    renderer.getBooleanSurface(group, new Map(), true, 1);
    const transforms = [...renderer.booleanCache.values()][0].surface.context.transforms;
    assert.deepEqual(transforms[0], [1, 0, 0, 1, 0, 0], 'the raster starts in the group box coordinate system');
    assert.deepEqual(transforms[1], [2, 0, 0, 1.5, -20, -7.5], 'source visual bounds are translated to the origin and stretched to the current group size');
    assert.deepEqual(transforms.at(-1), [1, 0, 0, 1, 0, 0], 'the composite paint resets to the destination box after drawing operands');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('Boolean stacked fills blend separately against the destination instead of caching blended pixels', () => {
  const document = createDocument();
  const group = createNode('boolean', {
    width: 40, height: 24,
    fills: [
      { id: 'base', type: 'solid', visible: true, opacity: 1, color: '#ff0000' },
      { id: 'overlay', type: 'solid', visible: true, opacity: .45, color: '#0000ff', blendMode: 'multiply' }
    ]
  });
  addNode(document, group);
  const maskSurface = { width: 40, height: 24 };
  const destination = [];
  const target = {
    globalAlpha: .8, globalCompositeOperation: 'source-over',
    save() { this.saved = { globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }; },
    restore() { Object.assign(this, this.saved); },
    getTransform() { return { a: 1, b: 0 }; },
    drawImage(image) { destination.push({ image, globalAlpha: this.globalAlpha, blendMode: this.globalCompositeOperation }); }
  };
  class PaintSurface {
    constructor(width, height) {
      this.width = width; this.height = height;
      const stack = [];
      this.context = {
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
        restore() { Object.assign(this, stack.pop() || {}); },
        setTransform() {}, clearRect() {}, fillRect() {}, drawImage() {}
      };
    }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = PaintSurface;
  try {
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, assets: new Map(), zoom: 1 });
    renderer.getBooleanSurface = () => maskSurface;
    renderer.drawBooleanGroup(target, group, 5, 7, new Map());

    assert.deepEqual(destination.map(item => [item.blendMode, item.globalAlpha]), [
      ['source-over', .8], ['multiply', .8 * .45]
    ]);
    assert.ok(destination.every(item => item.image instanceof PaintSurface), 'each paint is clipped to the Boolean alpha mask before reaching the page');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('Boolean paint and mask surfaces cap extreme axes and total pixels without shrinking normal previews', () => {
  const created = [];
  class RecordingContext {
    constructor(scale = 1) { this.scale = scale; }
    getTransform() { return { a: this.scale, b: 0 }; }
    setTransform() {} save() {} restore() {} clearRect() {} fillRect() {} drawImage() {}
  }
  class RecordingCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = new RecordingContext();
      created.push(this);
    }
    getContext() { return this.context; }
  }

  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const document = createDocument();
    const cases = [
      { name: 'extreme horizontal', width: 100_000, height: 1, requestedScale: 2, expected: [4096, 1] },
      { name: 'pixel budget', width: 5_000, height: 5_000, requestedScale: 2, expected: [2000, 2000] },
      { name: 'huge equal aspect', width: 1e300, height: 1e300, requestedScale: 2, expected: [2000, 2000] },
      { name: 'ordinary', width: 80, height: 60, requestedScale: 1.5, expected: [120, 90] }
    ];
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, assets: new Map(), zoom: 1 });
    renderer.booleanCache = new Map();
    renderer.booleanCachePixels = 0;
    renderer.drawNode = () => {};

    for (const item of cases) {
      const group = createNode('boolean', {
        name: item.name, width: item.width, height: item.height,
        children: [createNode('rectangle'), createNode('rectangle', { x: 1 })]
      });
      addNode(document, group);
      for (const maskMode of [false, true]) {
        const surface = renderer.getBooleanSurface(group, new Map(), maskMode, item.requestedScale);
        assert.deepEqual([surface.width, surface.height], item.expected,
          `${item.name} ${maskMode ? 'mask' : 'paint'} surface should use the bounded, aspect-preserving dimensions`);
        assert.ok(surface.width <= 4096 && surface.height <= 4096,
          `${item.name} ${maskMode ? 'mask' : 'paint'} surface exceeded the per-axis limit`);
        assert.ok(surface.width * surface.height <= 4_000_000,
          `${item.name} ${maskMode ? 'mask' : 'paint'} surface exceeded the total pixel budget`);
      }
      const children = [createNode('rectangle'), createNode('rectangle', { x: 1 })];
      const maskGroup = createNode('group', {
        name: `${item.name} alpha mask`, width: item.width, height: item.height,
        mask: true, maskSourceId: children[0].id, children
      });
      renderer.drawMaskGroup(new RecordingContext(item.requestedScale), maskGroup, 0, 0, new Map());
      const maskSurface = created.at(-1);
      assert.deepEqual([maskSurface.width, maskSurface.height], item.expected,
        `${item.name} alpha mask should obey the same bounded dimensions`);
      assert.ok(maskSurface.width * maskSurface.height <= 4_000_000,
        `${item.name} alpha mask exceeded the total pixel budget`);
    }
    assert.equal(created.length, cases.length * 3, 'paint, Boolean mask, and alpha-mask requests should each allocate one bounded surface');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('Boolean surfaces invalidate cached source geometry when an ancestor variable mode changes', () => {
  class TestContext {
    setTransform() {} save() {} restore() {} clearRect() {} fillRect() {} drawImage() {}
  }
  class TestCanvas {
    constructor(width, height) { this.width = width; this.height = height; this.context = new TestContext(); }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = TestCanvas;
  try {
    const document = createDocument();
    const collection = createVariableCollection(document, 'Boolean source geometry');
    const expandedMode = addVariableMode(document, collection.id, 'Expanded');
    const variable = createVariable(document, collection.id, 'Source width', 'number', 30);
    setVariableValue(document, variable.id, 55, expandedMode.id);
    const frame = createNode('frame', { width: 200, height: 100 });
    const boolean = createNode('boolean', {
      operation: 'union', width: 80, height: 40,
      children: [
        createNode('rectangle', { width: 30, height: 30 }),
        createNode('rectangle', { x: 50, width: 20, height: 20 })
      ]
    });
    addNode(document, frame);
    addNode(document, boolean, { parentId: frame.id });
    const group = document.pages[0].children[0].children[0];
    assert.equal(bindVariable(document, group.children[0].id, variable.id, 'width'), true);

    const state = { document, assets: new Map(), zoom: 1 };
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => state;
    renderer.booleanCache = new Map();
    renderer.booleanCachePixels = 0;
    renderer.drawNode = () => {};
    const defaultSurface = renderer.getBooleanSurface(group, state.assets, true, 1);

    assert.equal(setFrameVariableMode(document, frame.id, collection.id, expandedMode.id), true);
    const expandedSurface = renderer.getBooleanSurface(group, state.assets, true, 1);
    assert.notEqual(expandedSurface, defaultSurface, 'resolved child dimensions must participate in Boolean cache identity');
    assert.equal(renderer.booleanCache.size, 2);
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('Boolean composition uses mode-resolved operand visibility for union and intersection', () => {
  class TestContext {
    constructor() { this.clearCalls = []; }
    setTransform() {} save() {} restore() {} fillRect() {} drawImage() {}
    clearRect(...args) { this.clearCalls.push(args); }
  }
  class TestCanvas {
    constructor(width, height) { this.width = width; this.height = height; this.context = new TestContext(); }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = TestCanvas;
  try {
    const document = createDocument();
    const collection = createVariableCollection(document, 'Boolean operand visibility');
    const expandedMode = addVariableMode(document, collection.id, 'Expanded');
    const showHiddenOperand = createVariable(document, collection.id, 'Show operand', 'boolean', false);
    const hideIntersectOperand = createVariable(document, collection.id, 'Hide intersection operand', 'boolean', true);
    setVariableValue(document, showHiddenOperand.id, true, expandedMode.id);
    setVariableValue(document, hideIntersectOperand.id, false, expandedMode.id);

    const frame = createNode('frame', { width: 200, height: 100 });
    const union = createNode('boolean', {
      operation: 'union', width: 40, height: 30,
      children: [
        createNode('rectangle', { width: 20, height: 20, visible: false }),
        createNode('rectangle', { x: 20, width: 20, height: 20 })
      ]
    });
    const intersection = createNode('boolean', {
      operation: 'intersect', width: 40, height: 30,
      children: [
        createNode('rectangle', { width: 30, height: 30 }),
        createNode('rectangle', { x: 10, width: 20, height: 20, visible: true })
      ]
    });
    addNode(document, frame);
    addNode(document, union, { parentId: frame.id });
    addNode(document, intersection, { parentId: frame.id });
    const [unionGroup, intersectionGroup] = document.pages[0].children[0].children;
    const [unionHidden, unionVisible] = unionGroup.children;
    const intersectionHidden = intersectionGroup.children[1];
    assert.equal(bindVariable(document, unionHidden.id, showHiddenOperand.id, 'visible'), true);
    assert.equal(bindVariable(document, intersectionHidden.id, hideIntersectOperand.id, 'visible'), true);

    const state = { document, assets: new Map(), zoom: 1 };
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => state;
    renderer.booleanCache = new Map();
    renderer.booleanCachePixels = 0;
    const drawn = [];
    renderer.drawNode = (_context, child) => drawn.push(child.id);

    const unionDefault = renderer.getBooleanSurface(unionGroup, state.assets, true, 1);
    assert.equal(drawn.includes(unionHidden.id), false, 'raw-hidden operand resolving hidden is skipped');
    assert.equal(drawn.includes(unionVisible.id), true);
    const intersectionDefault = renderer.getBooleanSurface(intersectionGroup, state.assets, true, 1);
    assert.equal(intersectionDefault.context.clearCalls.length, 0, 'visible intersection operand does not clear the mask');

    assert.equal(setFrameVariableMode(document, frame.id, collection.id, expandedMode.id), true);
    drawn.length = 0;
    const unionExpanded = renderer.getBooleanSurface(unionGroup, state.assets, true, 1);
    assert.notEqual(unionExpanded, unionDefault, 'visibility mode changes invalidate the cached Boolean surface');
    assert.equal(drawn.includes(unionHidden.id), true, 'raw-hidden operand resolving visible participates in the union');

    drawn.length = 0;
    const intersectionExpanded = renderer.getBooleanSurface(intersectionGroup, state.assets, true, 1);
    assert.notEqual(intersectionExpanded, intersectionDefault);
    assert.equal(drawn.includes(intersectionHidden.id), true, 'intersection operands are rendered before hidden mode clears the mask');
    assert.equal(intersectionExpanded.context.clearCalls.length, 1, 'raw-visible operand resolving hidden empties the intersection result');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('Boolean paint and white-mask surfaces never share cache entries in either request order', () => {
  class TestContext {
    setTransform() {} save() {} restore() {} clearRect() {} fillRect() {} drawImage() {}
  }
  class TestCanvas {
    constructor(width, height) { this.width = width; this.height = height; this.context = new TestContext(); }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = TestCanvas;
  try {
    for (const [firstMode, secondMode] of [[false, true], [true, false]]) {
      const document = createDocument();
      const group = createNode('boolean', {
        fill: '#ffffff', width: 40, height: 30,
        fills: [{ id: 'red-overlay', type: 'solid', color: '#ff0000', visible: true, opacity: 0.5 }],
        children: [
          createNode('rectangle', { width: 30, height: 30 }),
          createNode('rectangle', { x: 10, width: 20, height: 20 })
        ]
      });
      addNode(document, group);
      const state = { document, assets: new Map(), zoom: 1 };
      const renderer = Object.create(SceneRenderer.prototype);
      renderer.getState = () => state;
      renderer.booleanCache = new Map();
      renderer.booleanCachePixels = 0;
      renderer.drawNode = () => {};

      const first = renderer.getBooleanSurface(group, state.assets, firstMode, 1);
      const second = renderer.getBooleanSurface(group, state.assets, secondMode, 1);
      assert.notEqual(first, second, `${firstMode ? 'mask' : 'paint'} then ${secondMode ? 'mask' : 'paint'} must render separate pixels`);
      assert.equal(renderer.booleanCache.size, 2, 'both output modes need independent reusable cache entries');
    }
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('motion preview overrides the first solid fill color and opacity without changing saved fills or exports', () => {
  const document = createDocument();
  const node = createNode('rectangle', { id: 'animated-fill', width: 20, height: 20,
    fills: [{ id: 'primary', type: 'solid', color: '#000000', visible: true, opacity: 1 }] });
  addNode(document, node);
  const state = { document, zoom: 1, presenting: true, assets: new Map(), previews: new Map(),
    selectedIds: [], motionPreview: new Map([[node.id, { fillColor: '#ffffff', fillOpacity: 0.25 }]]) };
  let liveFillStyle = '';
  let liveAlpha = 1;
  const painted = [];
  const alphaStack = [];
  const ctx = new Proxy({ globalAlpha: 1, globalCompositeOperation: 'source-over' }, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === 'save') return () => alphaStack.push(target.globalAlpha);
      if (property === 'restore') return () => { target.globalAlpha = alphaStack.pop() ?? 1; };
      if (property === 'fill') return () => painted.push({ fillStyle: liveFillStyle, alpha: liveAlpha });
      return () => {};
    },
    set(target, property, value) {
      if (property === 'fillStyle') liveFillStyle = value;
      if (property === 'globalAlpha') liveAlpha = value;
      target[property] = value;
      return true;
    }
  });
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => state;
  renderer.drawNode(ctx, node, 0, 0, state.assets);
  assert.match(painted.at(-1).fillStyle, /255, 255, 255/);
  assert.equal(painted.at(-1).alpha, 0.25);
  assert.equal(node.fills[0].color, '#000000');
  assert.equal(node.fills[0].opacity, 1);
  // The shared export renderer option suppresses the transient motion map.
  state.motionPreview = new Map([[node.id, { fillColor: '#ffffff', fillOpacity: 0.25 }]]);
  renderer.drawNode(ctx, node, 0, 0, state.assets, false, false, { ignoreMotionPreview: true });
  assert.match(painted.at(-1).fillStyle, /0, 0, 0/);
  assert.equal(painted.at(-1).alpha, 1);
});

test('motion fill keyframe base color resolution matches the renderer for linked and ordinary fills', () => {
  const document = createDocument();
  document.colorStyles = [{ id: 'brand-primary', kind: 'fill', name: 'Brand', value: '#123456' }];
  const linked = createNode('rectangle', { id: 'linked-color', fillStyleId: 'brand-primary',
    fills: [{ id: 'linked-fill', type: 'solid', color: '#abcdef', visible: true, opacity: 1 }] });
  const ordinary = createNode('rectangle', { id: 'ordinary-color',
    fills: [{ id: 'ordinary-fill', type: 'solid', color: '#fedcba', visible: true, opacity: 1 }] });
  assert.equal(fillLayerColor(document, linked, linked.fills[0], 0), '#123456');
  assert.equal(fillLayerColor(document, ordinary, ordinary.fills[0], 0), '#fedcba');
});

test('Boolean text operands render white glyph masks and resolve text metrics by frame mode', () => {
  class TestContext {
    constructor() { this.globalAlpha = 1; this.textDraws = []; this.rects = []; }
    setTransform() {} save() {} restore() {} clearRect() {} fillRect() {} drawImage() {} stroke() {}
    beginPath() {} rect(...args) { this.rects.push(args); } fill() {}
    translate() {} scale() {}
    measureText(value) { return { width: [...String(value)].length * 10 }; }
    fillText(value, ...args) { this.textDraws.push({ value: String(value), fillStyle: this.fillStyle, args }); }
  }
  class TestCanvas {
    constructor(width, height) { this.width = width; this.height = height; this.context = new TestContext(); }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = TestCanvas;
  try {
    const document = createDocument();
    const collection = createVariableCollection(document, 'Boolean text');
    const alternate = addVariableMode(document, collection.id, 'Alternate');
    const textVariable = createVariable(document, collection.id, 'Label', 'string', 'OLD');
    const sizeVariable = createVariable(document, collection.id, 'Label size', 'number', 16);
    setVariableValue(document, textVariable.id, 'NEW', alternate.id);
    setVariableValue(document, sizeVariable.id, 24, alternate.id);
    const frame = createNode('frame', { width: 240, height: 100 });
    const text = createNode('text', {
      width: 120, height: 40, fontSize: 16, color: '#ff0000',
      textRuns: [{ text: 'OLD', color: '#ff0000', fontSize: 16 }]
    });
    const group = createNode('boolean', {
      operation: 'union', width: 120, height: 50,
      children: [text, createNode('rectangle', { x: 130, width: 20, height: 20 })]
    });
    addNode(document, frame);
    addNode(document, group, { parentId: frame.id });
    const booleanGroup = document.pages[0].children[0].children[0];
    const textOperand = booleanGroup.children[0];
    assert.equal(bindVariable(document, textOperand.id, textVariable.id, 'text'), true);
    assert.equal(bindVariable(document, textOperand.id, sizeVariable.id, 'fontSize'), true);

    const state = { document, assets: new Map(), zoom: 1 };
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => state;
    renderer.booleanCache = new Map();
    renderer.booleanCachePixels = 0;
    const before = renderer.getBooleanSurface(booleanGroup, state.assets, true, 1);
    assert.equal(before.context.textDraws.map(draw => draw.value).join(''), 'OLD',
      'Boolean text masks should draw actual glyphs rather than a filled text-layer rectangle');
    assert.ok(before.context.textDraws.every(draw => draw.fillStyle === 'rgba(255, 255, 255, 1)'),
      'text color is normalized to opaque white for alpha-mask composition');
    assert.equal(before.context.rects.length, 1, 'only the rectangle operand should contribute a rectangular mask path');

    assert.equal(setFrameVariableMode(document, frame.id, collection.id, alternate.id), true);
    const after = renderer.getBooleanSurface(booleanGroup, state.assets, true, 1);
    assert.notEqual(after, before, 'resolved text content and typography participate in Boolean cache identity');
    assert.equal(after.context.textDraws.map(draw => draw.value).join(''), 'NEW');

    const plainText = createNode('text', {
      width: 100, height: 100, fontSize: 10, lineHeight: 2,
      text: 'hello world this is text'
    });
    const normalContext = new TestContext();
    const maskContext = new TestContext();
    renderer.drawNode(normalContext, plainText, 0, 0, state.assets, false, false);
    renderer.drawNode(maskContext, plainText, 0, 0, state.assets, false, true);
    assert.deepEqual(maskContext.textDraws.map(({ value, args }) => [value, ...args.slice(0, 2)]),
      normalContext.textDraws.map(({ value, args }) => [value, ...args.slice(0, 2)]),
      'plain text masks must reuse the editor line wrapping and glyph positions after mode-bound rich runs become stale');
    assert.ok(maskContext.textDraws.every(draw => draw.fillStyle === 'rgba(255, 255, 255, 1)'),
      'plain text mask glyphs must stay white regardless of the regular text color');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('group selection overlay renders degenerate line and point bounds safely', () => {
  const context = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    stroke() {}, rect() {}, fill() {}, arc() {}
  };
  const cases = [
    [
      createNode('line', { x: 0, y: 10, width: 20, height: 0 }),
      createNode('line', { x: 30, y: 10, width: 20, height: 0 })
    ],
    [
      createNode('line', { x: 10, y: 0, width: 0, height: 20 }),
      createNode('line', { x: 10, y: 30, width: 0, height: 20 })
    ],
    [
      createNode('line', { x: 10, y: 10, width: 0, height: 0 }),
      createNode('line', { x: 10, y: 10, width: 0, height: 0 })
    ]
  ];

  for (const lines of cases) {
    const document = createDocument();
    for (const line of lines) addNode(document, line);
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, selectedIds: lines.map(line => line.id), zoom: 1 });
    assert.doesNotThrow(() => renderer.drawSelection(context, document.pages[0].children, lines.map(line => line.id), 0, 0));
  }
});

test('component property hover draws a purple outline around its instance layer', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 20, y: 30, width: 120, height: 80 });
  const target = createNode('text', { x: 8, y: 12, width: 50, height: 20, text: 'Label' });
  addNode(document, frame);
  addNode(document, target, { parentId: frame.id });
  const paths = [];
  let path = [];
  const colors = [];
  const context = {
    save() {}, restore() {}, beginPath() { path = []; },
    moveTo(x, y) { path.push({ x, y }); }, lineTo(x, y) { path.push({ x, y }); },
    closePath() { path.push('close'); }, stroke() { paths.push(path); },
    set strokeStyle(value) { colors.push(value); }, set lineWidth(_value) {}
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, zoom: 1 });

  assert.equal(renderer.drawComponentPropertyHighlight(context, document.pages[0].children, target.id), true);
  assert.deepEqual(colors, ['#9747ff']);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].length, 5, 'the target gets a closed four-corner outline');
  target.visible = false;
  assert.equal(renderer.drawComponentPropertyHighlight(context, document.pages[0].children, target.id), false,
    'hidden targets do not show a hover outline');
});

test('text tracking affects measured line width and wrapping', () => {
  const context = textContext();
  assert.equal(measureTrackedText(context, 'ab cd', 0), 45);
  assert.equal(measureTrackedText(context, 'ab cd', 2), 53);
  assert.deepEqual(wrapText(context, 'ab cd', 46, 0), ['ab cd']);
  assert.deepEqual(wrapText(context, 'ab cd', 46, 2), ['ab', 'cd']);
});

test('shape rendering applies editable stroke cap, join, and dash patterns', () => {
  const document = createDocument();
  const shape = createNode('rectangle', {
    stroke: '#123456', strokeWidth: 3, strokeCap: 'round', strokeJoin: 'bevel', strokePattern: 'dashed', strokeMiterLimit: 4
  });
  addNode(document, shape);
  const calls = [];
  const context = {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    save() {}, restore() {}, beginPath() {}, rect() {}, fill() {},
    setLineDash(value) { calls.push(['dash', [...value]]); },
    stroke() { calls.push(['stroke', this.lineCap, this.lineJoin, this.miterLimit, this.lineWidth, this.strokeStyle]); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, shape, 0, 0, new Map());
  assert.deepEqual(calls, [['dash', [12, 6]], ['stroke', 'round', 'bevel', 4, 3, '#123456']]);

  shape.strokePattern = 'dotted';
  shape.strokeCap = undefined;
  calls.length = 0;
  renderer.drawNode(context, shape, 0, 0, new Map());
  assert.deepEqual(calls, [['dash', [0, 6]], ['stroke', 'round', 'bevel', 4, 3, '#123456']], 'dots need a round cap to keep zero-length dash segments visible');
});

test('rectangle rendering paints independent stroke edges with their saved widths', () => {
  const document = createDocument();
  const shape = createNode('rectangle', { width: 80, height: 40, fill: 'transparent', strokes: [
    { id: 'individual', color: '#123456', width: 0, opacity: 1, visible: true,
      cap: 'round', join: 'miter', pattern: 'solid', miterLimit: 10,
      sideMode: 'custom', sideWidths: { top: 1.5, right: 2.5, bottom: 3.25, left: 2 } }
  ] });
  addNode(document, shape);
  const calls = [];
  let currentPath = [];
  const target = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    save() {}, restore() {}, beginPath() { currentPath = []; }, rect() {}, closePath() { currentPath.push('close'); },
    fill() { calls.push({ fill: true, points: currentPath }); },
    moveTo(x, y) { currentPath.push([x, y]); }, lineTo(x, y) { currentPath.push([x, y]); },
    setLineDash() {}, stroke() { calls.push({ width: this.lineWidth, cap: this.lineCap, points: currentPath }); }
  };
  const context = new Proxy(target, {
    get(current, property) { return property in current ? current[property] : () => {}; },
    set(current, property, value) { current[property] = value; return true; }
  });
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, shape, 0, 0, new Map());
  assert.deepEqual(calls.filter(call => Number.isFinite(call.width)).map(call => call.width).sort((left, right) => left - right), [1.5, 2, 2.5, 3.25]);
  assert.ok(calls.filter(call => Number.isFinite(call.width)).every(call => call.cap === 'butt'), 'corner bisectors do not inherit open-vector caps');
  assert.deepEqual(calls.filter(call => Number.isFinite(call.width)).map(call => call.points.length), [2, 2, 2, 2]);
  assert.equal(calls.filter(call => call.fill).length, 4, 'the selected miter join fills each unequal-width square corner');
  assert.ok(calls.filter(call => call.fill).every(call => call.points.at(-1) === 'close'));

  calls.length = 0;
  shape.strokes[0].pattern = 'dotted';
  renderer.drawNode(context, shape, 0, 0, new Map());
  assert.ok(calls.filter(call => Number.isFinite(call.width)).every(call => call.cap === 'round'),
    'zero-length dotted dashes retain round caps after side splitting');
  assert.equal(calls.filter(call => call.fill).length, 0, 'solid corner wedges do not erase the dotted rhythm');
});

test('fill and stroke paint blends composite in paint order on the active page backdrop', () => {
  const document = createDocument();
  const shape = createNode('rectangle', {
    width: 40, height: 30, fill: 'transparent', stroke: null, strokeWidth: 0,
    fills: [
      { id: 'base', type: 'solid', visible: true, opacity: 1, color: '#ff0000' },
      { id: 'screen', type: 'solid', visible: true, opacity: .6, color: '#00ff00', blendMode: 'screen' },
      { id: 'soft-light', type: 'solid', visible: true, opacity: .4, color: '#0000ff', blendMode: 'soft-light' }
    ],
    strokes: [
      { id: 'multiply-outline', color: '#111111', width: 2, opacity: .8, visible: true, blendMode: 'multiply' },
      { id: 'hue-outline', color: '#eeeeee', width: 1, opacity: .5, visible: true, blendMode: 'hue' }
    ]
  });
  addNode(document, shape);

  const operations = [];
  const stack = [];
  const target = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle }); },
    restore() { Object.assign(this, stack.pop() || {}); },
    beginPath() {}, rect() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, closePath() {}, setLineDash() {},
    fill() { operations.push({ kind: 'fill', blendMode: this.globalCompositeOperation, alpha: this.globalAlpha }); },
    stroke() { operations.push({ kind: 'stroke', blendMode: this.globalCompositeOperation, alpha: this.globalAlpha }); }
  };
  const context = new Proxy(target, {
    get(current, property) {
      if (property in current) return current[property];
      return () => {};
    },
    set(current, property, value) { current[property] = value; return true; }
  });
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, shape, 0, 0, new Map());

  assert.deepEqual(operations.map(({ kind, blendMode }) => [kind, blendMode]), [
    ['fill', 'source-over'], ['fill', 'screen'], ['fill', 'soft-light'],
    ['stroke', 'multiply'], ['stroke', 'hue']
  ]);
  assert.deepEqual(operations.map(({ alpha }) => alpha), [1, .6, .4, .8, .5]);
});

test('normal and mask-source paints preserve the enclosing Canvas composite operation', () => {
  const document = createDocument();
  const shape = createNode('rectangle', {
    width: 24, height: 16,
    fills: [{ id: 'screen', type: 'solid', visible: true, opacity: 1, color: '#123456', blendMode: 'screen' }]
  });
  addNode(document, shape);
  const operations = [];
  const stack = [];
  const target = {
    globalAlpha: 1, globalCompositeOperation: 'destination-out', fillStyle: '',
    save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
    restore() { Object.assign(this, stack.pop() || {}); },
    beginPath() {}, rect() {}, fill() { operations.push(this.globalCompositeOperation); }
  };
  const context = new Proxy(target, {
    get(current, property) { return property in current ? current[property] : () => {}; },
    set(current, property, value) { current[property] = value; return true; }
  });
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, shape, 0, 0, new Map(), false, true);
  assert.deepEqual(operations, ['destination-out'], 'paint blend modes do not replace Boolean/mask alpha composition');
});

test('vector network face paints honor each fill paint blend mode', () => {
  const document = createDocument();
  const geometry = vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 24 }
  ], { closed: true });
  const network = createNode('network', {
    ...geometry, stroke: null, strokeWidth: 0,
    fills: [
      { id: 'base', type: 'solid', visible: true, opacity: 1, color: '#ff0000' },
      { id: 'color-dodge', type: 'solid', visible: true, opacity: .7, color: '#00ff00', blendMode: 'color-dodge' },
      { id: 'luminosity', type: 'solid', visible: true, opacity: .35, color: '#0000ff', blendMode: 'luminosity' }
    ]
  });
  addNode(document, network);

  const fills = [];
  const stack = [];
  const target = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '',
    save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
    restore() { Object.assign(this, stack.pop() || {}); },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() { fills.push(this.globalCompositeOperation); }
  };
  const context = new Proxy(target, {
    get(current, property) { return property in current ? current[property] : () => {}; },
    set(current, property, value) { current[property] = value; return true; }
  });
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, network, 0, 0, new Map());

  assert.deepEqual(fills, ['source-over', 'color-dodge', 'luminosity']);
});

test('vector network rendering uses the shared rounded-face path for fills and strokes', () => {
  const document = createDocument();
  const geometry = vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }
  ], { closed: true });
  geometry.vertices[0].cornerRadius = 6;
  geometry.vertices[2].cornerRadius = 4;
  const network = createNode('network', { ...geometry, fill: '#123456', stroke: '#000000', strokeWidth: 2 });
  addNode(document, network);
  let arcCount = 0;
  const stack = [];
  const target = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', lineWidth: 1,
    save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
    restore() { Object.assign(this, stack.pop() || {}); },
    beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, closePath() {}, fill() {}, stroke() {},
    arc() { arcCount += 1; }
  };
  const context = new Proxy(target, {
    get(current, property) { return property in current ? current[property] : () => {}; },
    set(current, property, value) { current[property] = value; return true; }
  });
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, network, 0, 0, new Map());

  assert.ok(arcCount >= 4,
    'each non-zero vertex radius must appear in both the face fill path and the shared stroke path');
});

test('shape rendering paints linear, radial, and angular stroke gradients through the stroke geometry', () => {
  for (const type of ['linear', 'radial', 'angular']) {
    const document = createDocument();
    const gradient = {
      type, angle: 45,
      stops: [
        { id: `${type}-start`, color: '#ff0000', position: 0 },
        { id: `${type}-end`, color: '#0000ff', position: 1 }
      ]
    };
    const shape = createNode('rectangle', { x: 7, y: 9, width: 80, height: 40, strokes: [
      { id: `${type}-stroke`, color: '#ff0000', width: 4, opacity: .75, visible: true,
        cap: 'round', join: 'round', pattern: 'solid', miterLimit: 10, gradient }
    ] });
    addNode(document, shape);
    const gradients = [];
    const painted = [];
    const context = {
      globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '',
      lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
      save() {}, restore() {}, beginPath() {}, rect() {}, fill() {}, setLineDash() {},
      createLinearGradient(...coordinates) {
        const result = { kind: 'linear', coordinates, stops: [], addColorStop(position, color) { this.stops.push([position, color]); } };
        gradients.push(result); return result;
      },
      createRadialGradient(...coordinates) {
        const result = { kind: 'radial', coordinates, stops: [], addColorStop(position, color) { this.stops.push([position, color]); } };
        gradients.push(result); return result;
      },
      createConicGradient(...coordinates) {
        const result = { kind: 'angular', coordinates, stops: [], addColorStop(position, color) { this.stops.push([position, color]); } };
        gradients.push(result); return result;
      },
      stroke() { painted.push({ paint: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth }); }
    };
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
    renderer.drawNode(context, shape, 0, 0, new Map());
    assert.equal(gradients.length, 1);
    assert.equal(gradients[0].kind, type);
    assert.deepEqual(gradients[0].stops, [[0, '#ff0000'], [1, '#0000ff']]);
    assert.equal(painted.length, 1);
    assert.equal(painted[0].paint, gradients[0]);
    assert.equal(painted[0].alpha, .75);
    assert.equal(painted[0].width, 4);
  }
});

test('shape rendering preserves negative-slope line direction', () => {
  const document = createDocument();
  const line = createNode('line', { x: 5, y: 7, width: 20, height: 10, lineReverseY: true });
  addNode(document, line);
  const points = [];
  const context = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    save() {}, restore() {}, beginPath() {}, moveTo(x, y) { points.push(['move', x, y]); },
    lineTo(x, y) { points.push(['line', x, y]); }, fill() {}, stroke() {}, setLineDash() {}
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, line, 0, 0, new Map());
  assert.deepEqual(points, [['move', 5, 17], ['line', 25, 7]]);
});

test('open line stroke decorations render in order and follow the line endpoints', () => {
  const document = createDocument();
  const line = createNode('line', { x: 4, y: 8, width: 40, height: 20, strokes: [
    { id: 'decorated', color: '#123456', width: 2, opacity: 1, visible: true,
      cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10,
      startDecoration: 'triangle', endDecoration: 'arrow' }
  ] });
  addNode(document, line);
  const shapes = [];
  let path = [];
  const context = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    save() {}, restore() {}, beginPath() { path = []; },
    moveTo(x, y) { path.push(['move', x, y]); }, lineTo(x, y) { path.push(['line', x, y]); },
    closePath() { path.push(['close']); },
    setLineDash(value) { this.dash = [...value]; },
    stroke() { shapes.push({ kind: 'stroke', path: [...path], color: this.strokeStyle, width: this.lineWidth }); },
    fill() { shapes.push({ kind: 'fill', path: [...path], color: this.fillStyle }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, line, 0, 0, new Map());
  assert.deepEqual(shapes.map(shape => shape.kind), ['stroke', 'fill', 'stroke']);
  assert.deepEqual(shapes[1].path[0], ['move', 4, 8]);
  assert.deepEqual(shapes[2].path[1], ['line', 44, 28]);
  assert.equal(shapes[1].color, '#123456');
  assert.equal(shapes[2].color, '#123456');
});

test('shape rendering paints ordered stroke layers with independent opacity and presentation', () => {
  const document = createDocument();
  const shape = createNode('rectangle', { strokes: [
    { id: 'inner', color: '#123456', width: 2, opacity: .5, visible: true, cap: 'square', join: 'bevel', pattern: 'dashed', miterLimit: 4 },
    { id: 'hidden', color: '#ffffff', width: 99, opacity: 1, visible: false, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 },
    { id: 'outer', color: '#abcdef', width: 8, opacity: .25, visible: true, cap: 'round', join: 'round', pattern: 'dotted', miterLimit: 7 }
  ] });
  addNode(document, shape);
  const calls = [];
  const stack = [];
  const context = {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    save() { stack.push({ globalAlpha: this.globalAlpha, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin, miterLimit: this.miterLimit }); },
    restore() { Object.assign(this, stack.pop()); }, beginPath() {}, rect() {}, fill() {},
    setLineDash(value) { calls.push(['dash', [...value]]); },
    stroke() { calls.push(['stroke', this.globalAlpha, this.lineWidth, this.strokeStyle, this.lineCap, this.lineJoin, this.miterLimit]); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, shape, 0, 0, new Map());
  assert.deepEqual(calls, [
    ['dash', [8, 4]], ['stroke', .5, 2, '#123456', 'square', 'bevel', 4],
    ['dash', [0, 16]], ['stroke', .25, 8, '#abcdef', 'round', 'round', 7]
  ]);
});

test('compound path rendering keeps separate contours and applies the even-odd fill rule', () => {
  const document = createDocument();
  const path = createNode('path', {
    width: 100, height: 80, closed: true, fillRule: 'evenodd', fill: '#123456', stroke: null, strokeWidth: 0,
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    subpaths: [{ closed: true, points: [{ x: .25, y: .25 }, { x: .75, y: .25 }, { x: .75, y: .75 }] }]
  });
  addNode(document, path);
  const calls = { moves: 0, closes: 0, fills: [] };
  const context = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '',
    save() {}, restore() {}, beginPath() {},
    moveTo() { calls.moves += 1; }, lineTo() {}, bezierCurveTo() {}, closePath() { calls.closes += 1; },
    fill(rule) { calls.fills.push(rule); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, path, 0, 0, new Map());
  assert.deepEqual(calls, { moves: 2, closes: 2, fills: ['evenodd'] });
});

test('fallback text tracking retains pair kerning and native tracking restores canvas state', () => {
  const fallback = textContext();
  drawTrackedText(fallback, 'AV', 4, 8, 2);
  assert.deepEqual(fallback.calls, [['A', 4, 8], ['V', 15, 8]]);

  const native = textContext({ nativeTracking: true });
  drawTrackedText(native, 'AV', 4, 8, 2, 100);
  assert.deepEqual(native.calls, [['AV', 4, 8, 100]]);
  assert.equal(native.letterSpacing, '');
});

test('text decorations draw a style-colored line below or through the measured text', () => {
  const calls = [];
  const context = {
    fillStyle: '#123456', strokeStyle: '', lineWidth: 0,
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); },
    beginPath() { calls.push(['begin']); }, moveTo(x, y) { calls.push(['move', x, y]); },
    lineTo(x, y) { calls.push(['line', x, y]); }, stroke() { calls.push(['stroke']); }
  };
  assert.equal(drawTextDecoration(context, 12, 8, 40, 20, 'underline'), true);
  assert.deepEqual(calls.slice(0, 4), [['save'], ['begin'], ['move', 12, 28.6], ['line', 52, 28.6]]);
  assert.equal(context.strokeStyle, '#123456');
  assert.equal(context.lineWidth, 1.25);
  calls.length = 0;
  drawTextDecoration(context, 4, 10, 25, 20, 'line-through');
  assert.deepEqual(calls.filter(call => ['move', 'line'].includes(call[0])), [['move', 4, 21], ['line', 29, 21]]);
  assert.equal(drawTextDecoration(context, 0, 0, 0, 20, 'underline'), false);
  assert.equal(drawTextDecoration(context, 0, 0, 20, 20, 'none'), false);
});

function richContext() {
  const calls = [];
  const stack = [];
  const context = {
    calls, font: '400 10px Arial', fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1,
    textAlign: 'left', textBaseline: 'alphabetic',
    save() { stack.push({ font: this.font, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, textAlign: this.textAlign, textBaseline: this.textBaseline }); },
    restore() { Object.assign(this, stack.pop()); },
    translate(x, y) { calls.push({ transform: 'translate', x, y }); },
    scale(x, y) { calls.push({ transform: 'scale', x, y }); },
    beginPath() { calls.push({ path: 'begin' }); },
    moveTo(x, y) { calls.push({ path: 'move', x, y }); },
    lineTo(x, y) { calls.push({ path: 'line', x, y }); },
    stroke() { calls.push({ path: 'stroke', strokeStyle: this.strokeStyle, lineWidth: this.lineWidth }); },
    measureText(text) {
      const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 10);
      return { width: [...String(text)].length * size * .5 };
    },
    fillText(text, x, y) { calls.push({ text, x, y, font: this.font, fillStyle: this.fillStyle }); }
  };
  return context;
}

function textPaintContext() {
  const stack = [];
  const calls = [];
  const context = {
    calls, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    font: '400 10px Arial', textAlign: 'left', textBaseline: 'alphabetic',
    save() {
      stack.push(Object.fromEntries(['globalAlpha', 'globalCompositeOperation', 'fillStyle', 'strokeStyle',
        'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'font', 'textAlign', 'textBaseline']
        .map(key => [key, this[key]])));
    },
    restore() { Object.assign(this, stack.pop() || {}); },
    setTransform(...values) { calls.push({ kind: 'setTransform', values }); },
    getTransform() { return { a: 1, b: 0 }; },
    translate(...values) { calls.push({ kind: 'translate', values }); },
    scale(...values) { calls.push({ kind: 'scale', values }); },
    beginPath() { calls.push({ kind: 'beginPath' }); },
    rect(...values) { calls.push({ kind: 'rect', values }); },
    clip(...values) { calls.push({ kind: 'clip', values }); },
    moveTo(...values) { calls.push({ kind: 'moveTo', values }); },
    lineTo(...values) { calls.push({ kind: 'lineTo', values }); },
    setLineDash(values) { calls.push({ kind: 'setLineDash', values: [...values] }); },
    clearRect(...values) { calls.push({ kind: 'clearRect', values }); },
    measureText(text) {
      const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 10);
      return { width: [...String(text)].length * size * .5 };
    },
    fillText(text, x, y, maxWidth) {
      calls.push({ kind: 'fillText', text, x, y, maxWidth, font: this.font, fillStyle: this.fillStyle,
        alpha: this.globalAlpha, blendMode: this.globalCompositeOperation });
    },
    strokeText(text, x, y, maxWidth) {
      calls.push({ kind: 'strokeText', text, x, y, maxWidth, font: this.font, strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth, alpha: this.globalAlpha, blendMode: this.globalCompositeOperation });
    },
    fill() {
      calls.push({ kind: 'fill', fillStyle: this.fillStyle, alpha: this.globalAlpha,
        blendMode: this.globalCompositeOperation });
    },
    stroke() {
      calls.push({ kind: 'stroke', strokeStyle: this.strokeStyle, lineWidth: this.lineWidth,
        alpha: this.globalAlpha, blendMode: this.globalCompositeOperation });
    },
    drawImage(image, ...values) {
      calls.push({ kind: 'drawImage', image, values, alpha: this.globalAlpha,
        blendMode: this.globalCompositeOperation,
        sourceCalls: image?.context?.calls ? [...image.context.calls] : null });
    }
  };
  return context;
}

test('canvas text rendering ellipsizes max-lines content and clips it to the text box', () => {
  const document = createDocument();
  const text = createNode('text', {
    x: 7, y: 11, width: 50, height: 10, text: 'one\ntwo', textFit: 'fixed',
    textTruncation: 'ending', maxLines: 1, fontSize: 10, lineHeight: 1
  });
  addNode(document, text);
  const context = textPaintContext();
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, text, 0, 0, new Map());

  const clipIndex = context.calls.findIndex(call => call.kind === 'clip');
  assert.notEqual(clipIndex, -1,
    'ending truncation establishes a local text-box clip');
  assert.deepEqual(context.calls.slice(0, clipIndex).filter(call => call.kind === 'rect').at(-1).values, [7, 11, 50, 10]);
  assert.deepEqual(context.calls.filter(call => call.kind === 'fillText').map(call => call.text), ['one…']);
});

test('text fill stacks composite ordered paints through the combined laid-out glyph alpha', () => {
  const document = createDocument();
  const text = createNode('text', {
    x: 10, y: 20, width: 120, height: 54, opacity: .75, align: 'right', verticalAlign: 'middle',
    text: 'A👩‍💻',
    textRuns: [
      { text: 'A', fontSize: 16, color: '#ff0000', letterSpacing: 2 },
      { text: '👩‍💻', fontSize: 20, color: '#0000ff', textDecoration: 'underline' }
    ],
    fills: [
      { id: 'magenta', type: 'solid', color: '#ff00ff', visible: true, opacity: .6, blendMode: 'multiply' },
      { id: 'photo', type: 'image', imageFill: createImageFill('local-photo'), visible: true, opacity: .4, blendMode: 'screen' }
    ],
    strokes: []
  });
  addNode(document, text);
  const preview = { name: 'local fill preview', width: 16, height: 12 };
  const fillKey = imagePreviewKey(text.id, 'photo');
  const fillPreviewSettings = imagePreviewSettingsForNode(text, fillKey);
  const state = {
    document, assets: new Map(), previews: new Map([[fillKey, preview]]),
    previewAssetIds: new Map([[fillKey, 'local-photo']]),
    previewSignatures: new Map([[fillKey, imagePreviewSettingsSignature(fillPreviewSettings)]]),
    outlineMode: false, presenting: false, zoom: 1
  };
  const context = textPaintContext();
  const canvases = [];
  class RecordingCanvas {
    constructor(width, height) {
      this.width = width; this.height = height; this.context = textPaintContext();
      canvases.push(this);
    }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => state;
    renderer.drawNode(context, text, 0, 0, state.assets);

    assert.equal(canvases.length, 2, 'glyph alpha and one reusable paint surface are bounded to a pair of canvases');
    assert.ok(canvases.every(canvas => canvas.width === 120 && canvas.height === 54));
    const glyphCalls = canvases[0].context.calls;
    const glyphs = glyphCalls.filter(call => call.kind === 'fillText');
    assert.deepEqual(glyphs.map(call => call.text), ['A', '👩‍💻'],
      'the white alpha pass keeps run segmentation and grapheme-safe tracking');
    assert.ok(glyphs.every(call => call.fillStyle === 'rgba(255, 255, 255, 1)'),
      'an explicit node fill stack replaces rich-run colors only while building its common glyph alpha');
    assert.deepEqual(glyphs.map(call => call.font), ['400 16px Inter, Arial, sans-serif', '400 20px Inter, Arial, sans-serif'],
      'rich-run typography survives the layer paint override');
    assert.ok(glyphCalls.some(call => call.kind === 'stroke' && call.strokeStyle === 'rgba(255, 255, 255, 1)'),
      'rich paragraph decoration is included in the same text alpha');

    const composites = context.calls.filter(call => call.kind === 'drawImage' && call.image instanceof RecordingCanvas);
    assert.deepEqual(composites.map(call => [call.blendMode, call.alpha]), [['multiply', .75], ['screen', .75]],
      'each paint composites in order against the active destination with node opacity applied once');
    assert.ok(composites[0].sourceCalls.some(call => call.kind === 'fill'
      && call.fillStyle === 'rgba(255, 0, 255, 1)' && call.alpha === .6),
    'the first solid paint is rendered with its own opacity before glyph clipping');
    assert.ok(composites.every(call => call.sourceCalls.some(sourceCall => sourceCall.kind === 'drawImage'
      && sourceCall.image === canvases[0] && sourceCall.blendMode === 'destination-in')),
    'each paint is clipped by the same combined glyph alpha');
    assert.ok(composites[1].sourceCalls.some(call => call.kind === 'drawImage' && call.image === preview),
      'image fills use the local fill preview cache before glyph clipping');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('text strokes preserve emoji shaping and retain run colors without layer fills', () => {
  const document = createDocument();
  const text = createNode('text', {
    x: 8, y: 12, width: 180, height: 48, text: 'A👩‍💻',
    textRuns: [{ text: 'A👩‍💻', color: '#ff0000', fontSize: 18, letterSpacing: 2 }],
    strokes: [
      { id: 'green-outline', color: '#00aa00', width: 2, opacity: .5, visible: true,
        cap: 'round', join: 'round', pattern: 'solid', miterLimit: 10, blendMode: 'multiply' },
      { id: 'blue-outline', color: '#0000ff', width: 4, opacity: .25, visible: true,
        cap: 'square', join: 'bevel', pattern: 'dashed', miterLimit: 5, blendMode: 'screen' }
    ]
  });
  addNode(document, text);
  const context = textPaintContext();
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, text, 0, 0, new Map());

  const fills = context.calls.filter(call => call.kind === 'fillText');
  const outlines = context.calls.filter(call => call.kind === 'strokeText');
  assert.deepEqual(fills.map(call => call.text), ['A👩‍💻'],
    'fallback letter spacing must keep an emoji sequence in one browser-shaped text run');
  assert.ok(fills.every(call => call.fillStyle === 'rgba(255, 0, 0, 1)'),
    'rich-run color remains the fill when no explicit layer fill stack exists');
  assert.deepEqual(outlines.map(call => [call.text, call.x, call.y]), [
    ...fills.map(call => [call.text, call.x, call.y]),
    ...fills.map(call => [call.text, call.x, call.y])
  ], 'every stroke follows the same glyph outlines, line positions, and grapheme tracking as the fill');
  assert.deepEqual(outlines.map(call => [call.strokeStyle, call.lineWidth, call.alpha, call.blendMode]), [
    ...fills.map(() => ['#00aa00', 2, .5, 'multiply']),
    ...fills.map(() => ['#0000ff', 4, .25, 'screen'])
  ], 'stroke paints retain order, color, width, opacity, and blend mode');
  assert.equal(context.calls.filter(call => call.kind === 'stroke').length, 0,
    'text strokes must not stroke the text-box rectangle or paragraph decorations');
});

test('text fill-stack offscreen surfaces remain bounded for oversized text boxes', () => {
  const document = createDocument();
  const text = createNode('text', {
    width: 100_000, height: 100_000, text: 'X',
    fills: [{ id: 'white', type: 'solid', color: '#ffffff', visible: true, opacity: 1 }]
  });
  addNode(document, text);
  const dimensions = [];
  class RecordingCanvas {
    constructor(width, height) {
      this.width = width; this.height = height; this.context = textPaintContext();
      dimensions.push([width, height]);
    }
    getContext() { return this.context; }
  }
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const context = textPaintContext();
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });
    renderer.drawNode(context, text, 0, 0, new Map());
    assert.equal(dimensions.length, 2);
    assert.ok(dimensions.every(([width, height]) => width <= 4096 && height <= 4096 && width * height <= 4_000_000),
      `text fill surfaces should stay within the bounded preview budget: ${JSON.stringify(dimensions)}`);
    assert.deepEqual(dimensions, [[2000, 2000], [2000, 2000]]);
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('text layers render as white alpha masks regardless of their editable text colors', () => {
  const document = createDocument();
  const text = createNode('text', {
    text: 'STAR', fillOpacity: 0.6,
    fills: [{ id: 'unused-mask-fill', type: 'solid', color: '#00ff00', visible: true, opacity: 1 }],
    strokes: [{ id: 'unused-mask-stroke', color: '#ff0000', width: 8, opacity: 1, visible: true,
      cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 }],
    textRuns: [{ text: 'STAR', color: '#ff0000', fontSize: 24 }]
  });
  addNode(document, text);
  const context = richContext();
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, assets: new Map(), outlineMode: false, presenting: false, zoom: 1 });

  renderer.drawNode(context, text, 0, 0, new Map(), false, true);

  const glyph = context.calls.find(call => call.text === 'STAR');
  assert.ok(glyph, 'mask mode should draw the actual text glyphs');
  assert.equal(glyph.fillStyle, 'rgba(255, 255, 255, 0.6)', 'mask alpha should retain fill opacity while replacing source color with white');
  assert.equal(context.calls.some(call => call.strokeText), false,
    'existing alpha-mask text semantics continue to ignore layer fill and stroke stacks');
});

const defaultRunStyle = {
  fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal',
  lineHeight: 1.25, letterSpacing: 0, color: '#000000', textDecoration: 'none', align: 'left', fillOpacity: 1
};

test('rich text draws each run with inherited or overridden font, color, and decoration', () => {
  const context = richContext();
  const result = drawTextRuns(context, [
    { text: 'Tiny ' },
    { text: 'Star', fontWeight: 700, color: '#ff0000', textDecoration: 'underline' }
  ], 4, 8, 100, defaultRunStyle);

  assert.equal(result.lines.length, 1);
  const draws = context.calls.filter(call => call.text);
  assert.deepEqual(draws.map(({ text }) => text), ['Tiny ', 'Star']);
  assert.equal(draws[0].font, '400 10px Arial, sans-serif');
  assert.equal(draws[0].fillStyle, 'rgba(0, 0, 0, 1)');
  assert.equal(draws[1].font, '700 10px Arial, sans-serif');
  assert.equal(draws[1].fillStyle, 'rgba(255, 0, 0, 1)');
  assert.ok(context.calls.some(call => call.transform === 'translate' && call.x === 4 && call.y === 8));
  assert.ok(context.calls.some(call => call.path === 'stroke' && call.strokeStyle === 'rgba(255, 0, 0, 1)'), 'run decoration should inherit its run color');
});

test('locally shaped rich text paints glyph outlines and falls back when an outline cannot be parsed', () => {
  const previousPath2D = Object.getOwnPropertyDescriptor(globalThis, 'Path2D');
  class TestPath2D {
    constructor(data) {
      if (data === 'invalid-path') throw new TypeError('invalid test outline');
      this.data = data;
    }
  }
  Object.defineProperty(globalThis, 'Path2D', { configurable: true, value: TestPath2D });
  try {
    const shaped = [];
    const context = richContext();
    context.fill = path => context.calls.push({ kind: 'fillGlyphPath', data: path.data });
    const shapeText = (text, style) => {
      shaped.push({ text, style });
      return {
        upem: 1000, extents: { ascender: 800 },
        glyphs: [...text].map((_, index) => ({
          path: 'valid-path', cluster: index, xAdvance: 1000, xOffset: 0, yOffset: 250
        }))
      };
    };
    const result = drawTextRuns(context, [{ text: 'A' }], 4, 8, 100, {
      ...defaultRunStyle, fontAxes: { opsz: 20, wght: 600 }, shapeText
    });
    assert.equal(result.lines.length, 1);
    assert.ok(shaped.some(item => item.style.fontAxes?.opsz === 20), 'the selected local axis coordinates reach the shaping callback');
    assert.equal(context.calls.filter(call => call.kind === 'fillGlyphPath').length, 1);
    assert.equal(context.calls.some(call => call.text === 'A'), false, 'valid local outlines replace Canvas text painting');
    assert.ok(context.calls.some(call => call.transform === 'translate' && call.y === 250),
      'HarfBuzz positive Y offsets stay positive in the flipped font coordinate system so combining marks rise');

    const missing = richContext();
    missing.fill = () => {};
    drawTextRuns(missing, [{ text: 'مرحبا' }], 0, 0, 100, {
      ...defaultRunStyle, shapeText: () => ({
        upem: 1000, extents: { ascender: 800 }, missingGlyph: true, glyphs: []
      })
    });
    assert.ok(missing.calls.some(call => call.text === 'مرحبا'), 'missing glyphs retain browser font fallback and never become .notdef boxes');

    const fallback = richContext();
    fallback.fill = () => {};
    drawTextRuns(fallback, [{ text: 'B' }], 0, 0, 100, {
      ...defaultRunStyle, shapeText: () => ({
        upem: 1000, extents: { ascender: 800 },
        glyphs: [{ path: 'invalid-path', cluster: 0, xAdvance: 1000 }]
      })
    });
    assert.ok(fallback.calls.some(call => call.text === 'B'), 'an invalid outline returns to the Canvas renderer instead of dropping the glyph');

    const strokeOnly = richContext();
    strokeOnly.stroke = path => strokeOnly.calls.push({ kind: 'strokeGlyphPath', data: path.data });
    drawTextRuns(strokeOnly, [{ text: 'C' }], 0, 0, 100, {
      ...defaultRunStyle, paintMode: 'stroke', shapeText: () => ({
        upem: 1000, extents: { ascender: 800 },
        glyphs: [{ path: 'stroke-path', cluster: 0, xAdvance: 1000 }]
      })
    });
    assert.equal(strokeOnly.calls.filter(call => call.kind === 'strokeGlyphPath').length, 1,
      'stroke-only Canvas contexts can paint HarfBuzz outlines without a fill method');
  } finally {
    if (previousPath2D) Object.defineProperty(globalThis, 'Path2D', previousPath2D);
    else delete globalThis.Path2D;
  }
});

test('mixed-script local shaping paints covered runs and measures uncovered runs with the browser stack', () => {
  const previousPath2D = Object.getOwnPropertyDescriptor(globalThis, 'Path2D');
  class TestPath2D { constructor(data) { this.data = data; } }
  Object.defineProperty(globalThis, 'Path2D', { configurable: true, value: TestPath2D });
  try {
    const context = richContext();
    context.fill = path => context.calls.push({ kind: 'fillGlyphPath', data: path.data });
    drawTextRuns(context, [{ text: 'Aمرحبا' }], 4, 8, 100, {
      ...defaultRunStyle,
      letterSpacing: 2,
      shapeText: () => ({
        mixedRuns: [
          { text: 'A', shaped: { upem: 1000, extents: { ascender: 800 }, glyphs: [{ path: 'latin-path', cluster: 0, xAdvance: 1000 }] } },
          { text: 'مرحبا', shaped: null }
        ]
      })
    });
    assert.equal(context.calls.filter(call => call.kind === 'fillGlyphPath').length, 1,
      'supported text uses the local outline shaper');
    const fallback = context.calls.find(call => call.text === 'مرحبا');
    const fallbackGlyphs = context.calls.filter(call => call.text).map(call => call.text).join('');
    assert.equal(fallbackGlyphs, 'مرحبا', 'the complete uncovered script run remains shaped as browser text');
    assert.ok(context.calls.some(call => call.kind === 'fillGlyphPath'), 'the covered local run remains an outline');
    assert.equal(fallback.x, 12, 'the browser fallback begins after the local run and one inter-run tracking step');
  } finally {
    if (previousPath2D) Object.defineProperty(globalThis, 'Path2D', previousPath2D);
    else delete globalThis.Path2D;
  }
});

test('rich text wraps using each run font and advances lines for larger styles', () => {
  const context = richContext();
  const result = drawTextRuns(context, [
    { text: 'red words ' },
    { text: 'split', fontSize: 20, fontWeight: 700 }
  ], 0, 2, 55, defaultRunStyle);

  assert.deepEqual(result.lines.map(line => line.map(part => part.text).join('')), ['red words', 'split']);
  assert.ok(context.calls.some(call => call.transform === 'translate' && call.y === 2 + 12.5), 'second line should follow the first line’s 10px font metrics');
  assert.equal(result.height, 37.5, 'the second line contributes its 20px font metrics');
});

test('plain and rich text align their complete line stacks within fixed-height boxes', () => {
  assert.equal(textVerticalOffset(50, 20, 'top'), 0);
  assert.equal(textVerticalOffset(50, 20, 'middle'), 15);
  assert.equal(textVerticalOffset(50, 20, 'bottom'), 30);
  assert.equal(textVerticalOffset(10, 20, 'bottom'), 0, 'overflowing text remains anchored at the top instead of shifting out of view');

  for (const [verticalAlign, expectedY] of [['top', 2], ['middle', 14.5], ['bottom', 27]]) {
    const context = richContext();
    const result = drawTextRuns(context, [{ text: 'one\ntwo' }], 4, 2, 100, {
      ...defaultRunStyle, height: 50, verticalAlign
    });
    const firstLine = context.calls.find(call => call.transform === 'translate');
    assert.equal(firstLine.y, expectedY, `${verticalAlign} rich text should offset the first line correctly`);
    assert.equal(result.height, 25);
  }

  const document = createDocument();
  const draws = [];
  const context = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top',
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: String(value).length * 5 }; },
    fillText(text, x, y) { draws.push({ text, x, y }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  for (const [verticalAlign, expectedY] of [['top', 12], ['middle', 30], ['bottom', 48]]) {
    draws.length = 0;
    renderer.drawNode(context, createNode('text', {
      x: 4, y: 10, width: 80, height: 60, text: 'a\nb', textFit: 'fixed',
      fontSize: 10, lineHeight: 1.2, verticalAlign
    }), 0, 2, new Map());
    assert.deepEqual(draws.map(draw => draw.y), [expectedY, expectedY + 12], `${verticalAlign} plain text should offset each line consistently`);
  }
});

test('paragraph spacing and first-line indentation affect rich and plain canvas layout', () => {
  const rich = richContext();
  const result = drawTextRuns(rich, [{ text: 'one two\n\nnext' }], 3, 4, 50, {
    ...defaultRunStyle, paragraphSpacing: 7, firstLineIndent: 20
  });
  const richLines = rich.calls.filter(call => call.transform === 'translate');
  assert.deepEqual(richLines.map(({ x, y }) => [x, y]), [[23, 4], [3, 16.5], [3, 36], [23, 55.5]]);
  assert.deepEqual(result.lines.map(line => line.map(part => part.text).join('')), ['one', 'two', '', 'next']);
  assert.equal(result.height, 64, 'paragraph gaps contribute to rich text height');

  const document = createDocument();
  const draws = [];
  const context = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: [...String(value)].length * 5 }; },
    fillText(text, x, y) { draws.push({ text, x, y }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, createNode('text', {
    x: 4, y: 10, width: 50, height: 90, text: 'one two\n\nnext', textFit: 'fixed',
    fontSize: 10, lineHeight: 1.25, paragraphSpacing: 7, firstLineIndent: 20
  }), 0, 0, new Map());
  assert.deepEqual(draws.map(({ text, x, y }) => [text, x, y]), [
    ['one', 24, 10], ['two', 4, 22.5], ['', 4, 42], ['next', 24, 61.5]
  ]);
});

test('rich canvas text paints styled list markers once, outside alignment and wrapped text transforms', () => {
  const context = richContext();
  drawTextRuns(context, [
    { text: 'alpha beta gamma\n', fontSize: 12, fontWeight: 700, color: '#ff0000' },
    { text: 'delta', fontSize: 8, fontWeight: 400, color: '#0000ff' }
  ], 5, 7, 75, {
    ...defaultRunStyle, align: 'right', fillOpacity: 0.4, listSpacing: 6,
    paragraphStyles: [
      { listStyle: 'bulleted', listLevel: 0 },
      { listStyle: 'numbered', listLevel: 0 }
    ]
  });

  const markers = context.calls.filter(call => call.text === '•' || call.text === '1.');
  assert.deepEqual(markers.map(({ text, x, y, font, fillStyle }) => [text, x, y, font, fillStyle]), [
    ['•', 5, 7, '700 12px Arial, sans-serif', 'rgba(255, 0, 0, 0.4)'],
    ['1.', 5, 43, '400 8px Arial, sans-serif', 'rgba(0, 0, 255, 0.4)']
  ]);
  const textLines = context.calls.filter(call => call.transform === 'translate');
  assert.deepEqual(textLines.map(({ x, y }) => [x, y]), [
    [5 + 13 + (62 - 60), 7],
    [5 + 13 + (62 - 30), 22],
    [5 + 18 + (57 - 20), 43]
  ], 'right alignment moves the text inside its available line width while markers stay in the list gutter');
  assert.equal(context.calls.filter(call => call.text === '•').length, 1, 'wrapped continuation lines must not repeat the marker');
});

test('plain canvas text passes paragraph list metadata through layout and paints hanging markers with node color and opacity', () => {
  const document = createDocument();
  const draws = [];
  const context = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: [...String(value)].length * 5 }; },
    fillText(text, x, y) { draws.push({ text, x, y, font: this.font, fillStyle: this.fillStyle }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, createNode('text', {
    x: 10, y: 20, width: 75, height: 90, text: 'alpha beta gamma\nnext', textFit: 'fixed',
    fontSize: 10, lineHeight: 1.25, align: 'left', listSpacing: 6, fillOpacity: 0.4,
    color: '#112233',
    paragraphStyles: [
      { listStyle: 'bulleted', listLevel: 0 },
      { listStyle: 'numbered', listLevel: 0 }
    ]
  }), 0, 0, new Map());

  const markers = draws.filter(draw => draw.text === '•' || draw.text === '1.');
  assert.deepEqual(markers.map(({ text, x, y, font, fillStyle }) => [text, x, y, font, fillStyle]), [
    ['•', 10, 20, '400 10px Inter, Arial, sans-serif', 'rgba(17, 34, 51, 0.4)'],
    ['1.', 10, 51, '400 10px Inter, Arial, sans-serif', 'rgba(17, 34, 51, 0.4)']
  ]);
  assert.ok(draws.some(draw => draw.text === 'alpha beta' && draw.x === 23), 'first list line starts after the marker gutter');
  assert.ok(draws.some(draw => draw.text === 'gamma' && draw.x === 23), 'wrapped continuation keeps the hanging indent');
  assert.equal(markers.filter(draw => draw.text === '•').length, 1, 'continuation line is marker-free');
});

test('justified canvas text distributes extra space between words and keeps final paragraph lines natural', () => {
  const rich = richContext();
  drawTextRuns(rich, [{ text: 'aa ' }, { text: 'bb cc', fontWeight: 700 }], 0, 0, 35, {
    ...defaultRunStyle, align: 'justify'
  });
  const richDraws = rich.calls.filter(call => call.text);
  assert.deepEqual(richDraws.slice(0, 3).map(({ text, x }) => [text, x]), [['aa', 0], [' ', 10], ['bb', 25]]);
  assert.deepEqual(richDraws.slice(3).map(({ text, x }) => [text, x]), [['cc', 0]], 'the final line does not receive expanded spacing');

  const document = createDocument();
  const draws = [];
  const context = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: [...String(value)].length * 5 }; },
    fillText(text, x, y) { draws.push({ text, x, y }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, createNode('text', {
    x: 0, y: 0, width: 35, height: 40, text: 'aa bb cc', textFit: 'fixed', align: 'justify', fontSize: 10, lineHeight: 1.25
  }), 0, 0, new Map());
  assert.deepEqual(draws.slice(0, 3).map(({ text, x }) => [text, x]), [['aa', 0], [' ', 10], ['bb', 25]]);
  assert.deepEqual(draws.slice(3).map(({ text, x }) => [text, x]), [['cc', 0]]);
});

test('rich and plain canvas text position each paragraph using its own alignment', () => {
  const rich = richContext();
  drawTextRuns(rich, [{ text: 'one\ntwo' }], 3, 4, 50, {
    ...defaultRunStyle, align: 'left',
    paragraphStyles: [{ align: 'center' }, { align: 'right' }]
  });
  assert.deepEqual(rich.calls.filter(call => call.transform === 'translate').map(({ x, y }) => [x, y]), [
    [3 + (50 - 15) / 2, 4], [3 + 50 - 15, 16.5]
  ]);

  const document = createDocument();
  const draws = [];
  const context = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: [...String(value)].length * 5 }; },
    fillText(text, x, y) { draws.push({ text, x, y }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(context, createNode('text', {
    x: 3, y: 4, width: 50, height: 60, text: 'one\ntwo', textFit: 'fixed',
    fontSize: 10, lineHeight: 1.25, align: 'left',
    paragraphStyles: [{ align: 'center' }, { align: 'right' }]
  }), 0, 0, new Map());
  assert.deepEqual(draws.filter(draw => draw.text).map(({ text, x, y }) => [text, x, y]), [
    ['one', 3 + (50 - 15) / 2, 4], ['two', 3 + 50 - 15, 16.5]
  ]);
});

test('canvas text resolves bound font and paragraph properties in the active frame mode', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Typography');
  const editorial = addVariableMode(document, collection.id, 'Editorial');
  const values = {
    fontFamily: ['string', 'Base Sans', 'Editorial Sans'],
    fontWeight: ['number', 400, 700],
    fontStyle: ['string', 'normal', 'italic'],
    paragraphSpacing: ['number', 0, 5],
    firstLineIndent: ['number', 0, 8]
  };
  const variables = Object.fromEntries(Object.entries(values).map(([property, [type, initial, alternate]]) => {
    const variable = createVariable(document, collection.id, property, type, initial);
    assert.equal(setVariableValue(document, variable.id, alternate, editorial.id), true);
    return [property, variable];
  }));
  const frame = createNode('frame', { width: 200, height: 100, variableModes: { [collection.id]: editorial.id } });
  const text = createNode('text', {
    text: 'one\ntwo', width: 100, height: 50, textFit: 'fixed', fontFamily: 'Fallback Sans',
    fontSize: 10, lineHeight: 1.25, fontWeight: 400, fontStyle: 'normal'
  });
  addNode(document, frame);
  addNode(document, text, { parentId: frame.id });
  for (const [property, variable] of Object.entries(variables)) assert.equal(bindVariable(document, text.id, variable.id, property), true);
  const draws = [];
  const canvas = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: [...String(value)].length * 5 }; },
    fillText(value, x, y) { draws.push({ text: value, x, y, font: this.font }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(canvas, text, 0, 0, new Map());

  assert.deepEqual(draws.map(({ text: value, x, y }) => [value, x, y]), [
    ['one', 8, 0], ['two', 8, 17.5]
  ], 'canvas wrapping uses the bound paragraph indent and spacing');
  assert.ok(draws.every(draw => draw.font === 'italic 700 10px Editorial Sans'),
    'canvas paint uses the bound font family, weight, and style');
});

test('justified canvas text retains letter spacing at token boundaries', () => {
  const context = richContext();
  drawTextRuns(context, [{ text: 'aa bb cc' }], 0, 0, 35, {
    ...defaultRunStyle, align: 'justify', letterSpacing: 2
  });
  const b = context.calls.find(call => call.text === 'b');
  assert.equal(b.x, 23, 'the tracking between text and whitespace tokens remains part of the natural line width');

  const document = createDocument();
  const draws = [];
  const canvas = {
    font: '', fillStyle: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {},
    measureText(value) { return { width: [...String(value)].length * 5 }; },
    fillText(text, x, y) { draws.push({ text, x, y }); }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, outlineMode: false, presenting: false, zoom: 1 });
  renderer.drawNode(canvas, createNode('text', {
    width: 35, height: 40, text: 'aa bb cc', textFit: 'fixed', align: 'justify',
    fontSize: 10, lineHeight: 1.25, letterSpacing: 2
  }), 0, 0, new Map());
  const plainB = draws.find(call => call.text === 'b');
  assert.equal(plainB.x, 23);
});

test('rich justified gaps keep their source run style and decoration width', () => {
  const context = richContext();
  drawTextRuns(context, [
    { text: 'aa', color: '#ff0000' },
    { text: '   ', color: '#0000ff', textDecoration: 'underline' },
    { text: 'bb cc', color: '#00aa00' }
  ], 0, 0, 45, { ...defaultRunStyle, align: 'justify' });
  const spaces = context.calls.filter(call => call.text === '   ');
  assert.equal(spaces.length, 1);
  assert.equal(spaces[0].fillStyle, 'rgba(0, 0, 255, 1)', 'expanded spaces retain the color of their source run');
  assert.deepEqual(context.calls.filter(call => call.path === 'line').map(call => call.x), [35],
    'the underline for the styled repeated-space run includes its expanded width');
});

test('rich text case changes preserve run boundaries even when Unicode casing expands', () => {
  const context = richContext();
  const result = drawTextRuns(context, [
    { text: 'straße' },
    { text: ' mix', fontWeight: 700 }
  ], 0, 0, 200, { ...defaultRunStyle, textCase: 'uppercase' });

  assert.equal(result.lines.map(line => line.map(part => part.text).join('')).join(''), 'STRASSE MIX');
  assert.deepEqual(context.calls.filter(call => call.text).map(call => call.text), ['straße'.toUpperCase(), ' MIX']);
  assert.equal(context.calls.filter(call => call.text)[1].font, '700 10px Arial, sans-serif');
});

test('hit testing follows mode-resolved geometry and rotation', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Layout');
  const compact = collection.defaultModeId;
  const expanded = addVariableMode(document, collection.id, 'Expanded');
  const x = createVariable(document, collection.id, 'X', 'number', 0);
  const y = createVariable(document, collection.id, 'Y', 'number', 0);
  const width = createVariable(document, collection.id, 'Width', 'number', 20);
  const height = createVariable(document, collection.id, 'Height', 'number', 10);
  const rotation = createVariable(document, collection.id, 'Rotation', 'number', 0);
  for (const [variable, value] of [[x, 40], [y, 20], [width, 40], [height, 20], [rotation, 90]]) assert.equal(setVariableValue(document, variable.id, value, expanded.id), true);
  const frame = createNode('frame');
  const card = createNode('rectangle', { x: 5, y: 5, width: 5, height: 5 });
  addNode(document, frame); addNode(document, card, { parentId: frame.id });
  for (const [property, variable] of Object.entries({ x, y, width, height, rotation })) assert.equal(bindVariable(document, card.id, variable.id, property), true);
  assert.equal(hitTestPage(document.pages[0], { x: 10, y: 10 }, null, document)?.id, card.id);
  assert.equal(hitTestPage(document.pages[0], { x: 50, y: 10 }, null, document)?.id, frame.id);
  assert.equal(setFrameVariableMode(document, frame.id, collection.id, expanded.id), true);
  assert.equal(hitTestPage(document.pages[0], { x: 10, y: 10 }, null, document)?.id, frame.id);
  assert.equal(hitTestPage(document.pages[0], { x: 60, y: 45 }, null, document)?.id, card.id);
  assert.equal(hitTestPage(document.pages[0], { x: 45, y: 15 }, null, document)?.id, frame.id, 'rotated resolved bounds should reject an unrotated-only hit');
  assert.equal(compact, collection.defaultModeId);
});

test('hit testing follows nested frame and group rotations to the deepest visible child', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 120, y: -90, width: 300, height: 220, rotation: 37 });
  const group = createNode('group', { x: 32, y: 24, width: 160, height: 110, rotation: -26 });
  const child = createNode('rectangle', { x: 22, y: 18, width: 64, height: 42, rotation: 19 });
  addNode(document, frame);
  addNode(document, group, { parentId: frame.id });
  addNode(document, child, { parentId: group.id });

  // Independent center transform: apply each local-to-parent rotation from
  // the leaf up to the page, as the canvas does while recursively drawing.
  const transformNodePoint = (point, node) => {
    const x = point.x + node.x;
    const y = point.y + node.y;
    const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    const radians = node.rotation * Math.PI / 180;
    const dx = x - center.x;
    const dy = y - center.y;
    return {
      x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians)
    };
  };
  const childCenter = [child, group, frame].reduce(
    (point, node) => transformNodePoint(point, node),
    { x: child.width / 2, y: child.height / 2 }
  );

  assert.equal(hitTestPage(document.pages[0], childCenter, null, document)?.id, child.id,
    'a click at the nested child’s rendered center should hit that child through both ancestor rotations.');
});

test('hit testing excludes nested children outside a rotated frame clip', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 100, y: 50, width: 100, height: 100, rotation: 35, clip: true });
  const group = createNode('group', { x: 100, y: 20, width: 80, height: 60, rotation: -15 });
  const child = createNode('rectangle', { x: 5, y: 5, width: 30, height: 30 });
  addNode(document, frame);
  addNode(document, group, { parentId: frame.id });
  addNode(document, child, { parentId: group.id });
  const childCenter = nodeLocalToPage(child, { x: 15, y: 15 }, [frame, group]);

  assert.equal(hitTestPage(document.pages[0], childCenter, null, document), null,
    'a child center outside its rotated clipping frame should not be selectable.');
  frame.clip = false;
  assert.equal(hitTestPage(document.pages[0], childCenter, null, document)?.id, child.id,
    'the nested child should be hittable when the ancestor clip is disabled.');
});

test('container placement falls back from a group in a rotated rounded frame clip corner', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 100, y: 50, width: 100, height: 100, rotation: 35, radius: 24, clip: true });
  const group = createNode('group', { x: -12, y: -12, width: 28, height: 28, rotation: -15 });
  addNode(document, frame);
  addNode(document, group, { parentId: frame.id });
  const groupCenter = nodeLocalToPage(group, { x: group.width / 2, y: group.height / 2 }, [frame]);

  assert.equal(deepestContainerAtPagePoint(document.pages[0].children, groupCenter, document)?.node.id, frame.id,
    'a rounded clipped-away group should not become the Pen destination.');
  frame.clip = false;
  assert.equal(deepestContainerAtPagePoint(document.pages[0].children, groupCenter, document)?.node.id, group.id,
    'the group should become the deepest destination when clipping is disabled.');
});

test('selection overlay corners and transform handles include nested ancestor rotations', () => {
  const parent = { x: 100, y: 50, width: 100, height: 80, rotation: 90 };
  const node = { x: 10, y: 20, width: 40, height: 20, rotation: 90 };
  const overlay = selectionOverlayGeometry(node, [parent], { zoom: 2 });
  const closePoint = (actual, expected) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-9,
    `Expected (${actual.x}, ${actual.y}) to equal (${expected.x}, ${expected.y}).`);

  closePoint(overlay.corners[0], { x: 180, y: 80 });
  closePoint(overlay.corners[1], { x: 140, y: 80 });
  closePoint(overlay.handles.resize.nw, overlay.corners[0]);
  closePoint(overlay.handles.resize.se, overlay.corners[2]);
  assert.ok(Math.abs(Math.hypot(overlay.handles.rotate.x - overlay.handles.resize.n.x, overlay.handles.rotate.y - overlay.handles.resize.n.y) - 12) < 1e-9,
    'The rotation handle offset should remain 24 screen pixels at 200% zoom.');
});

test('image crop selection renders node-local crop and live drag bounds with zoom-sized handles', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 80, y: 35, width: 180, height: 140, rotation: 90 });
  const image = createNode('image', { x: 18, y: 22, width: 90, height: 64, rotation: 15 });
  addNode(document, frame);
  addNode(document, image, { parentId: frame.id });

  const state = {
    document, zoom: 2, selectedIds: [image.id], imageCropMode: true,
    imageCropOverlay: {
      nodeId: image.id,
      drawBounds: { left: 12, top: 8, width: 54, height: 38 },
      virtualBounds: { left: 0, top: 0, width: 90, height: 64 },
      crop: { left: .1, top: .1, right: .7, bottom: .7 }
    },
    imageCropDraftSelection: {
      nodeId: image.id, start: { x: 16, y: 13 }, end: { x: 41, y: 39 }
    }
  };
  const strokes = [];
  const rects = [];
  let path = [];
  let arcs = 0;
  const context = {
    lineWidth: 1, fillStyle: '', strokeStyle: '',
    save() {}, restore() {},
    beginPath() { path = []; },
    moveTo(x, y) { path.push({ type: 'move', x, y }); },
    lineTo(x, y) { path.push({ type: 'line', x, y }); },
    closePath() { path.push({ type: 'close' }); },
    rect(x, y, width, height) { rects.push({ x, y, width, height }); path.push({ type: 'rect', x, y, width, height }); },
    setLineDash() {}, fill() {},
    stroke() { strokes.push(path.map(command => ({ ...command }))); },
    arc() { arcs += 1; }
  };
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => state;

  renderer.drawSelection(context, document.pages[0].children, state.selectedIds, 0, 0);

  assert.equal(arcs, 0, 'crop mode suppresses the standard rotation handle');
  assert.equal(rects.filter(rect => Math.abs(rect.width - 24) < 1e-9 && Math.abs(rect.height - 24) < 1e-9).length, 8,
    'each crop edge/corner has a 48 CSS-pixel hit target at 200% zoom');
  assert.equal(rects.filter(rect => Math.abs(rect.width - 3) < 1e-9 && Math.abs(rect.height - 3) < 1e-9).length, 0,
    'standard resize handles are suppressed while cropping');
  const expectedCrop = [
    nodeLocalToPage(image, { x: 12, y: 8 }, [frame]),
    nodeLocalToPage(image, { x: 66, y: 8 }, [frame]),
    nodeLocalToPage(image, { x: 66, y: 46 }, [frame]),
    nodeLocalToPage(image, { x: 12, y: 46 }, [frame])
  ];
  const currentCropPath = strokes.find(candidate => candidate.length === 5
    && candidate[0].type === 'move' && candidate.at(-1).type === 'close'
    && Math.abs(candidate[0].x - expectedCrop[0].x) < 1e-9
    && Math.abs(candidate[0].y - expectedCrop[0].y) < 1e-9);
  assert.ok(currentCropPath, 'the current crop bounds render in node-local coordinates');
  for (let index = 1; index < expectedCrop.length; index += 1) {
    assert.ok(Math.hypot(currentCropPath[index].x - expectedCrop[index].x, currentCropPath[index].y - expectedCrop[index].y) < 1e-9,
      `current crop corner ${index} should use node-local to page-space mapping`);
  }
  const expectedDraft = [
    nodeLocalToPage(image, { x: 16, y: 13 }, [frame]),
    nodeLocalToPage(image, { x: 41, y: 13 }, [frame]),
    nodeLocalToPage(image, { x: 41, y: 39 }, [frame]),
    nodeLocalToPage(image, { x: 16, y: 39 }, [frame])
  ];
  const draftPath = strokes.find(candidate => candidate.length === 5
    && candidate[0].type === 'move' && candidate.at(-1).type === 'close'
    && Math.abs(candidate[0].x - expectedDraft[0].x) < 1e-9
    && Math.abs(candidate[0].y - expectedDraft[0].y) < 1e-9);
  assert.ok(draftPath, 'the live draft rectangle is transformed through the image and its rotated frame');
  for (let index = 1; index < expectedDraft.length; index += 1) {
    assert.ok(Math.hypot(draftPath[index].x - expectedDraft[index].x, draftPath[index].y - expectedDraft[index].y) < 1e-9,
      `draft corner ${index} should use node-local to page-space mapping`);
  }
});

test('crop editing draws the full original bitmap in stable quarter-turn source bounds', () => {
  const calls = [];
  const context = {
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); },
    translate(...args) { calls.push(['translate', ...args]); }, rotate(...args) { calls.push(['rotate', ...args]); },
    scale(...args) { calls.push(['scale', ...args]); },
    drawImage(...args) { calls.push(['drawImage', ...args]); }
  };
  const original = { width: 64, height: 32 };
  assert.equal(drawCropSourceImage(context, original, 10, 20, { left: -5, top: 8, width: 100, height: 200 }, 90), true);
  assert.deepEqual(calls, [
    ['save'], ['translate', 55, 128], ['rotate', Math.PI / 2],
    ['drawImage', original, -100, -50, 200, 100], ['restore']
  ], 'the unrotated source is shown over its stable, fully visible 90° display rectangle');
  calls.length = 0;
  assert.equal(drawCropSourceImage(context, original, 10, 20, { left: -5, top: 8, width: 100, height: 200 }, 90, true, false), true);
  assert.deepEqual(calls, [
    ['save'], ['translate', 55, 128], ['scale', -1, 1], ['rotate', Math.PI / 2],
    ['drawImage', original, -100, -50, 200, 100], ['restore']
  ], 'the full-source crop context mirrors in visible axes after its quarter-turn');
});

test('crop editing shows cover previews at the same scale they will have after commit', () => {
  const calls = [];
  const context = {
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); }, rect(...args) { calls.push(['rect', ...args]); },
    clip() { calls.push(['clip']); }, drawImage(...args) { calls.push(['drawImage', ...args]); }
  };
  const preview = { width: 400, height: 100 };
  assert.equal(drawCropPreview(context, preview, 14, 25, 100, 100, 'cover'), true);
  assert.deepEqual(calls, [
    ['save'], ['beginPath'], ['rect', 14, 25, 100, 100], ['clip'],
    ['drawImage', preview, -136, 25, 400, 100], ['restore']
  ], 'a wide aspect-changing crop should have exactly the same cover fit and frame clip before and after commit');
  calls.length = 0;
  const quarterTurnPreview = { width: 100, height: 400 };
  assert.equal(drawCropPreview(context, quarterTurnPreview, 14, 25, 100, 100, 'contain'), true);
  assert.deepEqual(calls, [
    ['save'], ['beginPath'], ['rect', 14, 25, 100, 100], ['clip'],
    ['drawImage', quarterTurnPreview, 51.5, 25, 25, 100], ['restore']
  ], 'a quarter-turned contain preview should match the committed layer fit');
  assert.equal(drawCropPreview(context, null, 0, 0, 1, 1), false);
});

test('noise effect rendering composites deterministic layer-local grain and keeps stack-slot seeds stable', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  const textures = [];
  class NoiseTestCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.textureContext = {
        createImageData: (imageWidth, imageHeight) => ({
          width: imageWidth,
          height: imageHeight,
          data: new Uint8ClampedArray(imageWidth * imageHeight * 4)
        }),
        putImageData: imageData => { this.imageData = Uint8ClampedArray.from(imageData.data); }
      };
      this.context = {
        calls: [],
        save() { this.calls.push(['save']); },
        restore() { this.calls.push(['restore']); },
        setTransform(...args) { this.calls.push(['setTransform', ...args]); },
        drawImage(...args) { this.calls.push(['drawImage', ...args]); }
      };
      textures.push(this);
    }
    getContext() { return this.textureContext; }
  }
  try {
    Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, writable: true, value: NoiseTestCanvas });
    const draws = [];
    const surface = { getContext: () => ({
      globalCompositeOperation: 'source-over', globalAlpha: 1, filter: 'none', imageSmoothingEnabled: true,
      save() {}, restore() {}, setTransform() {},
      drawImage(...args) { draws.push({ image: args[0], args: args.slice(1), operation: this.globalCompositeOperation, smoothing: this.imageSmoothingEnabled }); }
    }) };
    const renderer = Object.create(SceneRenderer.prototype);
    const noise = {
      id: 'noise-grain', type: 'noise', visible: true, mode: 'duo', sizeX: 2, sizeY: 3,
      density: 72, color: '#112233', color2: '#aabbcc', opacity: 0.5
    };
    const effects = [noise];
    const node = { id: 'layer-stable', effects };
    const render = () => renderer.applyNoiseEffects(surface, node, effects, 1, 12, 9, 4, 5);
    render();
    render();

    assert.equal(draws.length, 2, 'each preview pass composites one texture onto the layer surface');
    assert.equal(textures.length, 1, 'rerenders reuse their cached deterministic grain texture');
    assert.equal(draws[0].image, draws[1].image, 'rerenders composite the same stable layer/effect texture');
    assert.ok(textures[0].imageData.some((channel, index) => index % 4 === 3 && channel > 0), 'the cached texture contains visible Duo grain');
    assert.deepEqual(draws.map(({ operation }) => operation), ['source-atop', 'source-atop'], 'grain is clipped to nontransparent layer pixels');
    assert.deepEqual(draws[0].args, [4, 5, 12, 9], 'the texture starts at the padded layer content origin and covers its content dimensions');
    assert.deepEqual(draws.map(({ smoothing }) => smoothing), [false, false], 'pixel-sized grain uses nearest-neighbor scaling');

    const otherDraws = [];
    const otherSurface = { getContext: () => ({
      globalCompositeOperation: 'source-over', globalAlpha: 1, filter: 'none', imageSmoothingEnabled: true,
      save() {}, restore() {}, setTransform() {}, drawImage(image) { otherDraws.push(image); }
    }) };
    renderer.applyNoiseEffects(otherSurface, { id: 'different-layer', effects }, effects, 1, 12, 9, 4, 5);
    assert.equal(textures.length, 2, 'a new layer receives a separate cached texture');
    assert.notDeepEqual(textures[1].imageData, textures[0].imageData, 'different layers receive independent stable grain patterns');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'OffscreenCanvas', previous);
    else delete globalThis.OffscreenCanvas;
  }
});

test('texture rendering bounds mask work, roughens layer edges deterministically, and respects clip-to-shape', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  const canvases = [];
  class TextureTestCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = {
        owner: this,
        filter: 'none',
        globalCompositeOperation: 'source-over',
        imageSmoothingEnabled: true,
        createImageData: (imageWidth, imageHeight) => ({ width: imageWidth, height: imageHeight, data: new Uint8ClampedArray(imageWidth * imageHeight * 4) }),
        putImageData: imageData => { this.maskPixels = Uint8ClampedArray.from(imageData.data); },
        getImageData: (_x, _y, imageWidth, imageHeight) => {
          const data = new Uint8ClampedArray(imageWidth * imageHeight * 4);
          for (let y = 0; y < imageHeight; y += 1) {
            for (let x = 0; x < imageWidth; x += 1) {
              const inside = x >= 2 && x <= 5 && y >= 2 && y <= 5;
              const distance = Math.max(Math.abs(x - 3.5), Math.abs(y - 3.5));
              const alpha = inside ? 255 : this.filter !== 'none' && distance <= 3 ? 80 : 0;
              data[(y * imageWidth + x) * 4 + 3] = alpha;
            }
          }
          return { width: imageWidth, height: imageHeight, data };
        },
        drawImage() {}, fillRect() {}, save() {}, restore() {}, setTransform() {}
      };
      canvases.push(this);
    }
    getContext() { return this.context; }
  }
  try {
    Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, writable: true, value: TextureTestCanvas });
    const surfacePasses = [];
    const surfaceContext = {
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      save() {}, restore() {}, setTransform() {},
      drawImage(image) { surfacePasses.push({ image, operation: this.globalCompositeOperation, smoothing: this.imageSmoothingEnabled }); }
    };
    const surface = { getContext: () => surfaceContext };
    const renderer = Object.create(SceneRenderer.prototype);
    const texture = { id: 'paper', type: 'texture', visible: true, sizeX: 1, sizeY: 1, radius: 2, clipToShape: false };
    const node = { id: 'paper-layer', effects: [texture] };
    const effects = [texture];
    renderer.applyTextureEffects(surface, node, effects, 8, 8, 1);
    const firstMasks = canvases.filter(canvas => canvas.maskPixels).map(canvas => canvas.maskPixels);
    assert.equal(firstMasks.length, 2, 'inside and outside edge masks are separate');
    assert.ok(firstMasks[0].some((value, index) => index % 4 === 3 && value < 255 && value > 0), 'inside mask carries distressed alpha at the source edge');
    assert.ok(firstMasks[1].some((value, index) => index % 4 === 3 && value > 0), 'outside mask carries controlled edge spread');
    assert.deepEqual(surfacePasses.map(pass => pass.operation), ['destination-in', 'source-over'], 'the rough silhouette is clipped first, then its fringe is composited');

    const beforeRepeat = canvases.length;
    surfacePasses.length = 0;
    renderer.applyTextureEffects(surface, node, effects, 8, 8, 1);
    const repeatedMasks = canvases.slice(beforeRepeat).filter(canvas => canvas.maskPixels).map(canvas => canvas.maskPixels);
    assert.deepEqual(repeatedMasks, firstMasks, 'rerendered edge masks do not flicker');

    surfacePasses.length = 0;
    const clippedTexture = { ...texture, clipToShape: true };
    renderer.applyTextureEffects(surface, { id: node.id, effects: [clippedTexture] }, [clippedTexture], 8, 8, 1);
    assert.deepEqual(surfacePasses.map(pass => pass.operation), ['destination-in'], 'Clip to shape removes the outer fringe pass');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'OffscreenCanvas', previous);
    else delete globalThis.OffscreenCanvas;
  }
});
