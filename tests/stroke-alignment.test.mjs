import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createGradientFill, createNode } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { effectiveStrokeAlignment, strokeAlignment, strokeGeometryBounds, strokeOuterExtent, strokePaintPadding, supportsStrokeAlignment } from '../src/stroke-alignment.js';
import { hitTestVisibleGeometry } from '../src/shape-hit-testing.js';
import { SceneRenderer } from '../src/renderer.js';
import { vectorNetworkGeometryFromAnchors } from '../src/vector-path.js';

test('stroke position preserves legacy center and uses only closed geometric boundaries', () => {
  assert.equal(strokeAlignment({}), 'center');
  assert.equal(strokeAlignment({ alignment: 'unknown' }), 'center');
  for (const type of ['rectangle', 'frame', 'image', 'ellipse', 'star', 'polygon', 'text']) {
    assert.equal(supportsStrokeAlignment(createNode(type)), true, type);
  }
  const open = createNode('path', { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false });
  assert.equal(effectiveStrokeAlignment(open, { alignment: 'outside' }), 'center');
  assert.equal(supportsStrokeAlignment({ ...open, closed: true }), true);
  assert.equal(supportsStrokeAlignment({ ...open, closed: true, subpaths: [{ points: open.points, closed: false }] }), false);
  const geometry = vectorNetworkGeometryFromAnchors([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], { closed: true });
  const network = createNode('network', geometry);
  assert.equal(supportsStrokeAlignment(network), true);
  network.edges.push({ id: 'dangling', from: network.vertices[0].id, to: 'open-tip' });
  assert.equal(supportsStrokeAlignment(network), false);
  assert.equal(supportsStrokeAlignment(createNode('line')), false);
  assert.equal(supportsStrokeAlignment(createNode('boolean')), false);
});

test('stroke position aprons include individual weights, open fallbacks, and miter geometry', () => {
  const stroke = createStroke({ width: 8, alignment: 'outside', sideMode: 'custom', sideWidths: { top: 4, right: 20, bottom: 0, left: 2 } });
  assert.equal(strokeOuterExtent(stroke), 20);
  assert.equal(strokeOuterExtent({ ...stroke, alignment: 'center' }), 10);
  assert.equal(strokeOuterExtent({ ...stroke, alignment: 'inside' }), 0);
  assert.equal(strokeOuterExtent(stroke, createNode('line')), 10);
  assert.equal(strokePaintPadding(createNode('rectangle'), [stroke]), 20);
  const pointStroke = createStroke({ width: 8, alignment: 'outside', miterLimit: 4 });
  assert.equal(strokePaintPadding(createNode('star'), [pointStroke]), 32);
  assert.equal(strokePaintPadding(createNode('text'), [pointStroke]), 32);
  assert.equal(strokePaintPadding(createNode('star'), [{ ...pointStroke, visible: false }]), 0);
  assert.equal(strokePaintPadding(createNode('rectangle', { strokeVariableId: 'bound-color' }), [{ ...stroke, color: 'transparent' }]), 20,
    'a bound primary paint may resolve to a visible color and must retain its apron');
});

test('local geometry bounds retain out-of-box anchors, relative path handles, and absolute network controls', () => {
  const node = createNode('path', { width: 100, height: 80, closed: true, points: [
    { x: 0, y: 0, out: { x: -.5, y: -.5 } },
    { x: 1.5, y: 0, in: { x: .5, y: -.25 } },
    { x: 1, y: 1 }
  ] });
  assert.deepEqual(strokeGeometryBounds(node), { left: -50, top: -40, right: 200, bottom: 80 });
  node.subpaths = [{ closed: true, points: [{ x: 0, y: 2 }, { x: .5, y: 2 }, { x: .5, y: 1 }] }];
  assert.equal(strokeGeometryBounds(node).bottom, 160);
  const network = createNode('network', { width: 100, height: 80,
    vertices: [{ id: 'a', x: -.2, y: 0 }, { id: 'b', x: 1, y: 1 }],
    edges: [{ id: 'edge', from: 'a', to: 'b', control1: { x: -.5, y: -.4 }, control2: { x: 2, y: 1.5 } }]
  });
  assert.deepEqual(strokeGeometryBounds(network), { left: -50, top: -32, right: 200, bottom: 120 });
  const outsideAnchor = createNode('path', { width: 100, height: 80, closed: true, fill: 'transparent',
    points: [{ x: -.2, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], strokes: [createStroke({ width: 8, alignment: 'inside' })]
  });
  assert.equal(hitTestVisibleGeometry(outsideAnchor, { x: -20, y: 0 }, { tolerance: 0 }), true,
    'picking must not reject a visible anchor before checking its actual contour');
});

test('picking selects the authored side of transparent shapes and each independent edge', () => {
  for (const alignment of ['inside', 'center', 'outside']) {
    const node = createNode('rectangle', { width: 100, height: 60, fill: 'transparent', strokes: [createStroke({ width: 8, alignment })] });
    const hit = (x, y = 30) => hitTestVisibleGeometry(node, { x, y }, { tolerance: 0 });
    assert.equal(hit(-6), alignment === 'outside', `${alignment} exterior`);
    assert.equal(hit(6), alignment === 'inside', `${alignment} interior`);
    assert.equal(hit(50), false, `${alignment} hollow center`);
    assert.equal(hit(-3), alignment !== 'inside', `${alignment} near exterior`);
    assert.equal(hit(3), alignment !== 'outside', `${alignment} near interior`);
  }
  const oneSide = createNode('rectangle', { width: 100, height: 60, fill: 'transparent', strokes: [createStroke({ width: 8, sideMode: 'top', alignment: 'outside' })] });
  assert.equal(hitTestVisibleGeometry(oneSide, { x: 50, y: -7 }, { tolerance: 0 }), true);
  assert.equal(hitTestVisibleGeometry(oneSide, { x: 50, y: 7 }, { tolerance: 0 }), false);
  assert.equal(hitTestVisibleGeometry(oneSide, { x: 105, y: 30 }, { tolerance: 0 }), false);
  const image = createNode('image', { width: 100, height: 60, strokes: [createStroke({ width: 8, alignment: 'outside' })] });
  assert.equal(hitTestVisibleGeometry(image, { x: -7, y: 30 }, { tolerance: 0 }), true, 'images retain external stroke picking');
  const miter = createNode('rectangle', { width: 100, height: 60, fill: 'transparent', strokes: [createStroke({ width: 8, alignment: 'outside', join: 'miter' })] });
  assert.equal(hitTestVisibleGeometry(miter, { x: -7, y: -7 }, { tolerance: 0 }), true, 'outside miter corner remains selectable');
  miter.strokes[0].join = 'bevel';
  assert.equal(hitTestVisibleGeometry(miter, { x: -7, y: -7 }, { tolerance: 0 }), false, 'bevel does not expose the miter wedge');
});

class RecordingCanvas {
  static instances = [];
  constructor(width, height) {
    this.width = width; this.height = height; this.calls = [];
    RecordingCanvas.instances.push(this);
    const calls = this.calls; const stack = [];
    this.context = {
      filter: 'none', globalAlpha: 1, globalCompositeOperation: 'source-over',
      save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
      restore() { Object.assign(this, stack.pop()); },
      setTransform(...args) { calls.push({ kind: 'transform', args }); },
      getTransform() { return { a: 1, b: 0, c: 0, d: 1 }; },
      beginPath() {}, closePath() {}, rect() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, ellipse() {}, clip() {},
      setLineDash(args) { this.dash = args; },
      stroke() { calls.push({ kind: 'stroke', width: this.lineWidth, dash: this.dash, alpha: this.globalAlpha, color: this.strokeStyle }); },
      fill(rule) { calls.push({ kind: 'fill', rule, alpha: this.globalAlpha, color: this.fillStyle }); },
      measureText(text) { return { width: String(text).length * 8 }; },
      fillText(text) { calls.push({ kind: 'glyph-fill', text, color: this.fillStyle, alpha: this.globalAlpha }); },
      strokeText(text) { calls.push({ kind: 'glyph-stroke', text, width: this.lineWidth }); },
      drawImage(source, ...args) { calls.push({ kind: 'image', source, args, composite: this.globalCompositeOperation, alpha: this.globalAlpha }); },
      createLinearGradient() { return { addColorStop() {} }; }
    };
  }
  getContext() { return this.context; }
}

test('Canvas aligned paint doubles only geometric width, masks independently, and composites one stroke at a time', () => {
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  RecordingCanvas.instances = [];
  try {
    const document = createDocument();
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, zoom: 1 });
    const node = createNode('rectangle', { width: 80, height: 60, fill: 'transparent', strokes: [
      createStroke({ width: 6, alignment: 'inside', pattern: 'dashed', opacity: .3 }),
      createStroke({ width: 4, alignment: 'outside', opacity: .6, blendMode: 'multiply' })
    ] });
    const destination = new RecordingCanvas(120, 120);
    renderer.drawNode(destination.context, node, 0, 0, new Map(), false, false, { effectPaintStage: 'stroke' });
    const paints = RecordingCanvas.instances.filter(canvas => canvas.calls.some(call => call.kind === 'stroke'));
    assert.equal(paints.length, 2);
    assert.deepEqual(paints.map(canvas => canvas.calls.find(call => call.kind === 'stroke').width), [12, 8]);
    assert.deepEqual(paints[0].calls.find(call => call.kind === 'stroke').dash, [24, 12], 'default dash lengths stay based on the authored 6px weight');
    assert.deepEqual(paints.map(canvas => canvas.calls.find(call => call.kind === 'image').composite), ['destination-in', 'destination-out']);
    const layers = destination.calls.filter(call => call.kind === 'image');
    assert.deepEqual(layers.map(call => call.alpha), [.3, .6]);
    assert.deepEqual(layers.map(call => call.composite), ['source-over', 'multiply']);
    const masks = RecordingCanvas.instances.filter(canvas => canvas.calls.some(call => call.kind === 'fill'));
    assert.equal(masks.length, 2, 'transparent authored fill still supplies a geometric mask');
    assert.ok(masks.every(canvas => canvas.calls.filter(call => call.kind === 'fill').every(call => call.color === '#ffffff' && call.alpha === 1)));
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('aligned stroke surfaces reserve the complete curve control hull before clipping', () => {
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  RecordingCanvas.instances = [];
  try {
    const document = createDocument();
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, zoom: 1 });
    const node = createNode('path', { x: 10, y: 10, width: 100, height: 80, closed: true, fill: 'transparent', points: [
      { x: 0, y: 0, out: { x: -.5, y: -.5 } },
      { x: 1.5, y: 0, in: { x: .5, y: -.25 } },
      { x: 1, y: 1 }
    ], strokes: [createStroke({ width: 4, alignment: 'inside' })] });
    const destination = new RecordingCanvas(300, 200);
    renderer.drawNode(destination.context, node, 0, 0, new Map(), false, false, { effectPaintStage: 'stroke' });
    const draw = destination.calls.find(call => call.kind === 'image');
    assert.deepEqual(draw.args, [-41, -31, 252, 122]);
    assert.deepEqual([draw.source.width, draw.source.height], [252, 122], 'the stroke is never cropped to its 100 × 80 layout box');
    RecordingCanvas.instances = [];
    node.effects = [{ id: 'zero-blur', type: 'layer-blur', visible: true, radius: 0 }];
    renderer.drawNode(destination.context, node, 0, 0, new Map());
    assert.ok(RecordingCanvas.instances.some(surface => surface.width >= 300 && surface.height >= 160),
      'the outer effect stage also reserves the complete control hull');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('text stroke alignment masks glyphs rather than its layout box and bounds allocations', () => {
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  RecordingCanvas.instances = [];
  try {
    const document = createDocument();
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, zoom: 1 });
    const node = createNode('text', { width: 100000, height: 100000, text: 'Ab', fill: 'transparent', strokes: [createStroke({ width: 4, alignment: 'outside' })] });
    const destination = new RecordingCanvas(100, 100);
    renderer.drawNode(destination.context, node, 0, 0, new Map(), false, false, { effectPaintStage: 'stroke' });
    const mask = RecordingCanvas.instances.find(canvas => canvas.calls.some(call => call.kind === 'glyph-fill'));
    const paint = RecordingCanvas.instances.find(canvas => canvas.calls.some(call => call.kind === 'glyph-stroke'));
    assert.ok(mask);
    assert.equal(mask.calls.some(call => call.kind === 'fill'), false, 'layout bounds are never the glyph clip');
    assert.equal(mask.calls.find(call => call.kind === 'glyph-fill').color, 'rgba(255, 255, 255, 1)');
    assert.equal(paint.calls.find(call => call.kind === 'glyph-stroke').width, 8);
    assert.ok(mask.width <= 4096 && mask.height <= 4096 && mask.width * mask.height <= 4000000);
    assert.ok(paint.width <= 4096 && paint.height <= 4096 && paint.width * paint.height <= 4000000);
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('aligned gradients and vector masks preserve separate paint and geometric alpha semantics', () => {
  const previousCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const document = createDocument();
    const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, zoom: 1 });
    const node = createNode('ellipse', { width: 80, height: 60, fills: [], strokes: [createStroke({
      width: 6, color: 'transparent', gradient: createGradientFill('linear', '#ff0000'), alignment: 'outside', opacity: .3
    })] });
    RecordingCanvas.instances = [];
    const destination = new RecordingCanvas(120, 120);
    renderer.drawNode(destination.context, node, 0, 0, new Map(), false, false, { effectPaintStage: 'stroke' });
    const paint = RecordingCanvas.instances.find(canvas => canvas.calls.some(call => call.kind === 'stroke'));
    assert.equal(typeof paint.calls.find(call => call.kind === 'stroke').color.addColorStop, 'function');
    assert.equal(destination.calls.find(call => call.kind === 'image').alpha, .3);
    node.strokes[0].opacity = 0;
    RecordingCanvas.instances = [];
    const vectorDestination = new RecordingCanvas(120, 120);
    renderer.drawNode(vectorDestination.context, node, 0, 0, new Map(), false, 'vector', { effectPaintStage: 'stroke' });
    const vectorPaint = RecordingCanvas.instances.find(canvas => canvas.calls.some(call => call.kind === 'stroke'));
    assert.equal(vectorPaint.calls.find(call => call.kind === 'stroke').color, '#ffffff');
    assert.equal(vectorDestination.calls.find(call => call.kind === 'image').alpha, 1, 'vector masks ignore authored stroke alpha');
    assert.ok(vectorPaint.width >= 94 && vectorPaint.height >= 74, 'transparent paint never shrinks the outside geometric mask apron');
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});
