import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { booleanStrokePath, BooleanStrokeGeometryError } from '../src/boolean-stroke-geometry.js';
import { hitTestBooleanStrokeGeometry, hitTestVisibleGeometry } from '../src/shape-hit-testing.js';
import { hitTestPage, SceneRenderer } from '../src/renderer.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';

function group(operation = 'union', overrides = {}) {
  return createNode('boolean', { width: 72, height: 48, operation, fill: '#2244ff', children: [
    createNode('rectangle', { name: 'Left source', width: 48, height: 48, fill: '#336699' }),
    createNode('rectangle', { name: 'Right source', x: 24, width: 48, height: 48, fill: '#669933' })
  ], ...overrides });
}

test('editable Boolean outlines follow all four result operations and preserve sources and own styles', () => {
  const expected = { union: [true, true, true], subtract: [true, false, false], intersect: [false, true, false], exclude: [true, false, true] };
  for (const operation of Object.keys(expected)) {
    const node = group(operation, { x: 17, y: 23, rotation: 14, opacity: .4, strokes: [createStroke({ width: 4, alignment: 'outside' })] });
    const before = JSON.stringify(node);
    const path = booleanStrokePath(node);
    assert.equal(path.type, 'path');
    assert.deepEqual(path.children, []);
    assert.equal(path.fillRule, 'evenodd');
    assert.equal(path.rotation, 14);
    assert.equal(path.x, 17);
    assert.equal(path.opacity, .4);
    assert.deepEqual(path.strokes, node.strokes);
    const fillOnly = { ...path, strokes: [], stroke: null, strokeWidth: 0 };
    assert.deepEqual([12, 36, 60].map(x => hitTestVisibleGeometry(fillOnly, { x, y: 24 }, { tolerance: 0 })), expected[operation], operation);
    assert.equal(JSON.stringify(node), before, 'derivation never mutates editable operands');
  }
});

test('cubic source boundaries stay cubic and cached geometry never stales own styles or source edits', () => {
  const node = group('union');
  node.children[0] = createNode('ellipse', { width: 48, height: 48, fill: '#336699' });
  const initial = booleanStrokePath(node);
  assert.ok(initial.points.some(point => Math.hypot(point.in.x, point.in.y, point.out.x, point.out.y) > 0));
  const stored = JSON.stringify({ points: initial.points, subpaths: initial.subpaths });
  initial.points[0].x = 999;
  node.fill = '#ff7733'; node.rotation = -30; node.opacity = .7;
  node.strokes = [createStroke({ width: 9, alignment: 'inside' })];
  const restyled = booleanStrokePath(node);
  assert.equal(restyled.fill, '#ff7733'); assert.equal(restyled.rotation, -30); assert.equal(restyled.opacity, .7);
  assert.deepEqual(restyled.strokes, node.strokes);
  assert.equal(JSON.stringify({ points: restyled.points, subpaths: restyled.subpaths }), stored, 'returned contour edits cannot corrupt cached geometry');
  node.children[1].x = 12;
  assert.notEqual(JSON.stringify(booleanStrokePath(node).points), JSON.stringify(restyled.points), 'operand edits invalidate the boundary');
});

test('coverage eligibility follows explicit fill stacks rather than stale scalar alpha', () => {
  const node = group();
  node.children[0].fillOpacity = .5;
  node.children[0].fills = [
    { id: 'opaque', type: 'solid', color: '#336699', visible: true, opacity: 1 },
    { id: 'partial', type: 'solid', color: '#ff0000', visible: true, opacity: .2 }
  ];
  assert.ok(booleanStrokePath(node).points.length, 'one opaque paint guarantees full geometric alpha despite translucent upper paint');
  delete node.children[0].fills;
  assert.throws(() => booleanStrokePath(node), /Left source.*opaque geometric fill/);
});

test('visible source strokes, missing fills, hidden/translucent operands, and unsupported sources reject descriptive outlines', () => {
  for (const mutate of [
    child => { child.opacity = .5; },
    child => { child.visible = false; },
    child => { child.fills = []; },
    child => { child.fill = 'transparent'; },
    child => { child.stroke = '#111111'; child.strokeWidth = 3; },
    child => { child.type = 'text'; child.text = 'Unsupported glyph source'; child.fill = '#111111'; }
  ]) {
    const node = group(); mutate(node.children[0]);
    assert.throws(() => booleanStrokePath(node), error => error instanceof BooleanStrokeGeometryError
      && error.code === 'UNSUPPORTED_BOOLEAN_STROKE' && /Left source/.test(error.message));
  }
  const ignoredEffects = group();
  ignoredEffects.children[0].effects = [{ id: 'ignored-blur', type: 'layer-blur', visible: true, radius: 8 }];
  ignoredEffects.children[0].blendMode = 'multiply';
  assert.ok(booleanStrokePath(ignoredEffects).points.length, 'live alpha masks suppress source effects and blend modes');
});

test('recursive mode resolution refreshes geometry and eligibility without cached source appearances', () => {
  const node = group('subtract');
  let mode = 0;
  const resolveNode = value => value === node.children[1] ? { ...value, x: mode ? 12 : 24 } : value;
  const first = booleanStrokePath(node, { resolveNode }); mode = 1;
  assert.notDeepEqual(booleanStrokePath(node, { resolveNode }).points, first.points);
  node.children[0].fill = 'transparent';
  assert.throws(() => booleanStrokePath(node, { resolveNode }), /opaque geometric fill/, 'cache hits still validate current source coverage');
});

test('empty intersections and fully subtracted results remain valid and restore their outline after an edit', () => {
  const intersect = group('intersect'); intersect.children[1].x = 80;
  assert.deepEqual(booleanStrokePath(intersect).points, []);
  intersect.children[1].x = 24;
  assert.ok(booleanStrokePath(intersect).points.length);
  const subtract = group('subtract'); subtract.children[1] = { ...subtract.children[0], id: 'full-cover' };
  assert.deepEqual(booleanStrokePath(subtract).points, []);
});

test('source recursion is bounded and cycles fail with a useful geometry error', () => {
  const node = group(); node.children.push(node);
  assert.throws(() => booleanStrokePath(node), /cyclic source tree/);
  const tooMany = group(); tooMany.children = Array.from({ length: 300 }, (_, index) => createNode('rectangle', { x: index, width: 1, height: 1 }));
  assert.throws(() => booleanStrokePath(tooMany), /bounded source-tree limit/);
});

test('Boolean result strokes are pickable outside their bounds with rotations and affine transforms', () => {
  const document = createDocument();
  const node = group('union', { x: 80, y: 60, rotation: 23, affineTransform: { a: 1.2, b: .1, c: .3, d: 1 }, strokes: [createStroke({ width: 8, alignment: 'outside' })] });
  addNode(document, node);
  assert.equal(hitTestBooleanStrokeGeometry(node, { x: -6, y: 24 }, { tolerance: 0, document }), true);
  assert.equal(hitTestBooleanStrokeGeometry(node, { x: 6, y: 24 }, { tolerance: 0, document }), false);
  const point = nodeLocalToPage(node, { x: -6, y: 24 });
  assert.equal(hitTestPage(document.pages[0], point, () => false, document)?.id, node.id,
    'the alpha-mask bbox gate must not discard the result outline');
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
      setTransform() {}, translate() {}, transform() {}, rotate() {}, clearRect() {}, clip() {},
      getTransform() { return { a: 1, b: 0, c: 0, d: 1 }; },
      beginPath() {}, closePath() {}, rect(...args) { calls.push({ kind: 'rect', args }); },
      moveTo(...args) { calls.push({ kind: 'move', args }); }, lineTo(...args) { calls.push({ kind: 'line', args }); },
      bezierCurveTo(...args) { calls.push({ kind: 'curve', args }); },
      setLineDash(dash) { this.dash = dash; },
      stroke() { calls.push({ kind: 'stroke', color: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth, dash: this.dash }); },
      fill() {}, fillRect(...args) { calls.push({ kind: 'fill-rect', args }); },
      drawImage() { calls.push({ kind: 'image', alpha: this.globalAlpha }); }
    };
  }
  getContext() { return this.context; }
}

test('Boolean paint phases separate result fills and strokes with opacity applied exactly once', () => {
  const document = createDocument();
  const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, zoom: 1 });
  renderer.getBooleanSurface = () => new RecordingCanvas(72, 48);
  const node = group('union', { opacity: .5, strokes: [createStroke({ width: 4, color: '#ff0000', opacity: .5 })] });
  const destination = new RecordingCanvas(100, 100);
  renderer.drawNode(destination.context, node, 0, 0, new Map(), false, false, { effectPaintStage: 'fill' });
  assert.equal(destination.calls.filter(call => call.kind === 'image').length, 1);
  assert.equal(destination.calls.some(call => call.kind === 'stroke'), false);
  destination.calls.length = 0;
  renderer.drawNode(destination.context, node, 0, 0, new Map(), false, false, { effectPaintStage: 'stroke' });
  assert.equal(destination.calls.some(call => call.kind === 'image'), false);
  assert.equal(destination.calls.find(call => call.kind === 'stroke').alpha, .25);
  assert.equal(destination.calls.filter(call => call.kind === 'move').length, 1, 'union draws one closed boundary without the overlapping operand seam');
});

test('hidden unsupported result strokes retain fills, while every visible failure reaches fresh export collectors', () => {
  const document = createDocument(); const renderer = Object.create(SceneRenderer.prototype);
  renderer.getState = () => ({ document, zoom: 1 }); renderer.getBooleanSurface = () => new RecordingCanvas(72, 48);
  const node = group('union', { strokes: [createStroke({ visible: false })] }); node.children[0].type = 'text';
  const destination = new RecordingCanvas(100, 100); const failures = []; const toasts = [];
  renderer.onStrokeError = (_node, error) => toasts.push(error);
  const previousWarn = console.warn; console.warn = () => {};
  try {
    renderer.drawNode(destination.context, node, 0, 0, new Map(), false, false, { onRenderError: (_node, error) => failures.push(error) });
    assert.equal(failures.length, 0); assert.ok(destination.calls.some(call => call.kind === 'image'));
    node.strokes[0].visible = true;
    node.strokes[0].gradient = { type: 'linear', angle: 0, stops: [{ position: 0, color: '#111111', opacity: 0 }, { position: 1, color: '#ffffff', opacity: 0 }] };
    renderer.drawNode(destination.context, node, 0, 0, new Map(), false, false, { onRenderError: (_node, error) => failures.push(error) });
    assert.equal(failures.length, 0, 'an entirely transparent retained gradient needs no unsupported boundary');
    delete node.strokes[0].gradient;
    node.strokes[0].visible = true;
    for (let index = 0; index < 2; index += 1) renderer.drawNode(destination.context, node, 0, 0, new Map(), false, false,
      { onRenderError: (_node, error) => failures.push(error) });
    assert.equal(failures.length, 2, 'each export receives its own diagnostic even after a preview warning');
    assert.equal(toasts.length, 1, 'interactive repetition stays bounded');
  } finally { console.warn = previousWarn; }
});

test('Boolean inner shadows use fill, shadow, and result-stroke phases and outline mode has no operand seam', () => {
  const previousCanvas = globalThis.OffscreenCanvas; globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const document = createDocument(); const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, zoom: 1 });
    const node = group('union', { strokes: [createStroke({ width: 2 })], effects: [{ id: 'inner', type: 'inner-shadow', visible: true, color: '#000000', opacity: .5, offsetX: 1, offsetY: 0, blur: 0 }] });
    const destination = new RecordingCanvas(150, 100); const events = [];
    renderer.drawNode = (_context, _node, _x, _y, _assets, _draft, _mask, options) => events.push(options.effectPaintStage);
    renderer.applyInnerShadows = () => events.push('inner');
    renderer.applyDropShadows = () => null;
    renderer.drawNodeWithEffects(destination.context, node, 0, 0, new Map(), node.effects);
    assert.deepEqual(events, ['fill', 'stroke', 'inner', 'stroke']);
    delete renderer.drawNode;
    destination.calls.length = 0;
    renderer.drawNodeOutline(destination.context, node, 0, 0, new Map());
    assert.equal(destination.calls.filter(call => call.kind === 'move').length, 1);
    assert.equal(destination.calls.some(call => call.kind === 'rect'), false, 'eligible outline mode follows the result path instead of a bbox');
    assert.deepEqual(destination.calls.find(call => call.kind === 'stroke').dash, []);
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('cached Boolean source failures remain visible to later export collectors', () => {
  const previousCanvas = globalThis.OffscreenCanvas; globalThis.OffscreenCanvas = RecordingCanvas;
  const previousWarn = console.warn; console.warn = () => {};
  try {
    const document = createDocument(); const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, zoom: 1 });
    renderer.booleanCache = new Map(); renderer.booleanCachePixels = 0;
    const nested = group('union', { name: 'Nested unsupported outline', strokes: [createStroke()] });
    nested.children[0].type = 'text';
    const node = group('union', { children: [nested], strokes: [], fills: [] });
    const error = new BooleanStrokeGeometryError('the nested text source has no exact outline.');
    let sourceDraws = 0;
    renderer.drawNode = (_context, source, _x, _y, _assets, _draft, _mask, options) => {
      sourceDraws += 1; renderer.reportBooleanStrokeError(source, error, options);
    };
    const preview = renderer.getBooleanSurface(node, new Map(), false, 1);
    assert.equal(sourceDraws, 1);
    const failures = [];
    const exported = renderer.getBooleanSurface(node, new Map(), false, 1,
      { onRenderError: (source, failure) => failures.push({ source, failure }) });
    assert.equal(exported, preview, 'the export reuses the existing bounded pixel cache');
    assert.equal(sourceDraws, 1, 'diagnostic replay does not require a rerender');
    assert.equal(failures.length, 1); assert.equal(failures[0].source.id, nested.id); assert.equal(failures[0].failure, error);
  } finally {
    console.warn = previousWarn;
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('Boolean paint phases never suppress operand paints while constructing a source mask', () => {
  const previousCanvas = globalThis.OffscreenCanvas; globalThis.OffscreenCanvas = RecordingCanvas;
  try {
    const document = createDocument(); const renderer = Object.create(SceneRenderer.prototype);
    renderer.getState = () => ({ document, zoom: 1 });
    renderer.booleanCache = new Map(); renderer.booleanCachePixels = 0;
    const node = group(); node.children[0].strokes = [createStroke({ width: 6 })];
    const stages = [];
    renderer.drawNode = (_context, _source, _x, _y, _assets, _draft, maskMode, options) => {
      stages.push({ stage: options.effectPaintStage, maskMode });
    };
    const fill = renderer.getBooleanSurface(node, new Map(), false, 1, { effectPaintStage: 'fill' });
    assert.deepEqual(stages, [{ stage: undefined, maskMode: true }, { stage: undefined, maskMode: true }]);
    const stroke = renderer.getBooleanSurface(node, new Map(), false, 1, { effectPaintStage: 'stroke' });
    assert.equal(stroke, fill, 'own paint phase does not create a different operand mask');
    assert.equal(stages.length, 2);
  } finally {
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});
