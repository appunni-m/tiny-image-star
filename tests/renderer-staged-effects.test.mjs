import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneRenderer, localTextInkBounds } from '../src/renderer.js';
import { hasVisibleRenderedPaint, paintHasVisibleAlpha, renderNodeInkBounds, transformInkBounds } from '../src/render-ink-bounds.js';
import { createDocument, createNode, addNode } from '../src/model.js';
import { nodeToParentTransform } from '../src/transform-geometry.js';
import { layerEffectPadding } from '../src/layer-effects.js';

class Pixels {
  constructor(width, height) { this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4); }
}
class Surface {
  static surfaces = [];
  constructor(width, height) {
    this.width = width; this.height = height; this.calls = []; Surface.surfaces.push(this);
    const canvas = this; const states = [];
    this.context = { canvas, globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
      fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1,
      save() { states.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation,
        filter: this.filter, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth }); },
      restore() { Object.assign(this, states.pop()); },
      getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
      setTransform(...args) { canvas.calls.push(['setTransform', ...args]); },
      transform(...args) { canvas.calls.push(['transform', ...args]); },
      translate() {}, rotate() {}, scale() {},
      beginPath() {}, closePath() {}, clip() {}, rect() {}, roundRect() {},
      moveTo(...args) { canvas.calls.push(['move', ...args]); }, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {},
      setLineDash() {}, clearRect() {},
      fill() { canvas.calls.push(['fill', this.fillStyle, this.globalAlpha]); },
      fillRect() { canvas.calls.push(['fill', this.fillStyle, this.globalAlpha]); },
      stroke() { canvas.calls.push(['stroke', this.strokeStyle, this.globalAlpha]); },
      strokeRect() {}, drawImage(...args) { canvas.calls.push(['image', ...args]); },
      getImageData(_x, _y, width, height) { return new Pixels(width, height); },
      putImageData(pixels) { assert.ok(pixels instanceof Pixels, 'Canvas receives actual ImageData, rather than portable shader bytes'); },
      createImageData(width, height) { return new Pixels(width, height); }
    };
  }
  getContext() { return this.context; }
}

function environment(run) {
  const prior = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = Surface; Surface.surfaces = [];
  try { return run(); } finally { globalThis.OffscreenCanvas = prior; }
}
function renderer(document, extra = {}) {
  const result = Object.create(SceneRenderer.prototype);
  result.getState = () => ({ document, zoom: 1, ...extra });
  return result;
}
function path(color, fields = {}) {
  return createNode('path', { x: 0, y: 0, width: 10, height: 10, closed: true,
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    fills: [{ id: `paint-${color}`, type: 'solid', color, opacity: 1, visible: true, blendMode: 'normal' }],
    strokes: [], ...fields });
}
function staged(document, children, fields = {}) {
  const root = createNode('group', { x: 0, y: 0, width: 10, height: 10, fills: [], strokes: [], children,
    effectPaintMode: 'staged', effectFillMode: 'stack', ...fields });
  root.children = children;
  addNode(document, root); return root;
}

test('descendant ink includes curve handles, own stroke, affine transforms and effect aprons in parent coordinates', () => {
  const document = createDocument();
  const leaf = path('#ff0000', { x: -8, y: 12, rotation: 30,
    points: [{ x: -1, y: 0, out: { x: -2, y: 3 } }, { x: 3, y: 2 }],
    strokes: [{ id: 's', width: 4, color: '#000000', opacity: 1, visible: true, alignment: 'outside', join: 'round' }],
    effects: [{ type: 'drop-shadow', visible: true, blur: 2, spread: 0, offsetX: 7, offsetY: -3 }] });
  const nested = createNode('group', { x: 20, y: -40, width: 10, height: 10,
    affineTransform: { a: 2, b: .3, c: 1.5, d: 1 }, children: [leaf] });
  const root = staged(document, [nested]);
  const local = { left: -34, top: -4, right: 34, bottom: 34 };
  const transformed = transformInkBounds(local, nodeToParentTransform(leaf));
  const padding = layerEffectPadding(leaf.effects);
  const expected = transformInkBounds({ left: transformed.left - padding.x, top: transformed.top - padding.y,
    right: transformed.right + padding.x, bottom: transformed.bottom + padding.y }, nodeToParentTransform(nested));
  const actual = renderNodeInkBounds(document, root);
  assert.ok(actual.left <= expected.left && actual.top <= expected.top);
  assert.ok(actual.right >= expected.right && actual.bottom >= expected.bottom);
});

test('clips and masks bound descendant ink while hidden layers and slices do not enlarge it', () => {
  const document = createDocument();
  const overflow = path('#ff0000', { x: -500, width: 1000, height: 1000 });
  const hidden = path('#ffffff', { x: 10000, visible: false });
  const slice = createNode('slice', { x: 10000, y: 10000, width: 20000, height: 20000 });
  for (const fields of [{ clip: true }, { mask: true }]) {
    const clipped = createNode('group', { x: 0, y: 0, width: 30, height: 40, children: [overflow], ...fields });
    const root = staged(document, [clipped, hidden]); root.children.push(slice);
    assert.deepEqual(renderNodeInkBounds(document, root), { left: 0, top: 0, right: 30, bottom: 40 });
  }
});

test('ink bounds resolve mode/motion geometry and reject cycles or aggregate budgets', () => {
  const document = createDocument(); const leaf = path('#000000'); const root = staged(document, [leaf]);
  const actual = renderNodeInkBounds(document, root, { resolveNode: node => node === leaf ? { ...node, x: 80, width: 25 } : node });
  assert.equal(actual.right, 105);
  assert.throws(() => renderNodeInkBounds(document, root, { limits: { maxNodes: 1, maxDepth: 256, maxPoints: 100 } }), /layer-tree budget/);
  assert.throws(() => renderNodeInkBounds(document, root, { limits: { maxDepth: 0 } }), /finite positive integers/);
  for (const value of [Infinity, NaN, -1, .5]) assert.throws(() => renderNodeInkBounds(document, root,
    { limits: { maxNodes: value } }), /finite positive integers/);
  assert.throws(() => renderNodeInkBounds(document, root, { resolveNode: node => node === leaf ? { ...node, x: 1e13 } : node }), /coordinate budget/);
  const nested = createNode('group', { width: 10, height: 10, children: [leaf] }); root.children = [nested];
  assert.throws(() => renderNodeInkBounds(document, root, { limits: { maxDepth: 1 } }), /layer-tree budget/);
  root.children = [leaf];
  assert.throws(() => renderNodeInkBounds(document, root, { limits: { maxNodes: 10, maxDepth: 10, maxPoints: 3 } }), /vector-point budget/);
  root.children.push(root);
  assert.throws(() => renderNodeInkBounds(document, root), /layer-tree budget/);
});

test('staged effect root scopes fill/stroke subtrees and inner shadow to source order without suppressing glyph fills', () => environment(() => {
  const document = createDocument(); const fill = path('#ff0000'); const stroke = path('#0000ff', { effectPaintPhase: 'stroke' });
  const nestedStroke = path('#00ff00'); stroke.children = [nestedStroke];
  const root = staged(document, [fill, stroke], { effects: [{ type: 'inner-shadow', visible: true, opacity: 1, blur: 0, offsetX: 2, offsetY: 0 }] });
  const scene = renderer(document); const entries = [];
  const draw = scene.drawNode;
  scene.drawNode = function (ctx, node, ...args) {
    entries.push({ id: node.id, stage: args[5]?.effectPaintStage, scope: args[5]?.effectPaintStageNodeId });
    return draw.call(this, ctx, node, ...args);
  };
  scene.applyInnerShadows = () => entries.push({ id: 'inner-shadow' });
  scene.drawNode(new Surface(200, 200).context, root, 0, 0, new Map());
  const stages = entries.filter(entry => entry.id === root.id && entry.stage).map(entry => entry.stage);
  assert.deepEqual(stages, ['fill', 'stroke', 'stroke']);
  assert.equal(entries.filter(entry => entry.id === fill.id).length, 1);
  assert.equal(entries.filter(entry => entry.id === stroke.id).length, 2);
  assert.ok(entries.filter(entry => [fill.id, stroke.id, nestedStroke.id].includes(entry.id)).every(entry => !entry.stage && !entry.scope));
  const innerIndex = entries.findIndex(entry => entry.id === 'inner-shadow');
  assert.ok(entries.findIndex(entry => entry.id === fill.id) < innerIndex);
  assert.ok(entries.findLastIndex(entry => entry.id === stroke.id) > innerIndex);
  assert.equal(Surface.surfaces.flatMap(surface => surface.calls).filter(call => call[0] === 'fill'
    && /^(#0000ff|rgba\(0,\s*0,\s*255,\s*1\))$/u.test(call[1])).length, 2);
}));

test('invisible or edited-away stroke paints use evolving fill alpha for sequential inner shadows', () => environment(() => {
  for (const paintEdit of [{ opacity: 0 }, { visible: false }, { color: 'transparent' },
    { type: 'linear', gradient: { type: 'linear', stops: [{ color: '#ff0000', opacity: 0 }, { color: '#0000ff', opacity: 0 }] } }]) {
    const document = createDocument(); const fill = path('#ffffff'); const stroke = path('#ff0000', { effectPaintPhase: 'stroke' });
    Object.assign(stroke.fills[0], paintEdit);
    const root = staged(document, [fill, stroke], { effects: [
      { type: 'inner-shadow', visible: true, opacity: .8, blur: 2, offsetX: 4, offsetY: 4 },
      { type: 'inner-shadow', visible: true, opacity: .7, blur: 1, offsetX: -4, offsetY: 3 }
    ] });
    const scene = renderer(document); const snapshots = [];
    scene.applyInnerShadows = (surface, _effects, _scale, _width, _height, alphaSurface) => snapshots.push(alphaSurface === surface);
    scene.drawNode(new Surface(100, 100).context, root, 0, 0, new Map());
    assert.deepEqual(snapshots, [true], 'no rendered stroke paint means the fill surface remains the evolving alpha source');
    Object.assign(stroke.fills[0], { type: 'solid', color: '#ff0000', opacity: 1, visible: true }); delete stroke.fills[0].gradient;
    snapshots.length = 0;
    scene.drawNode(new Surface(100, 100).context, root, 0, 0, new Map());
    assert.deepEqual(snapshots, [false], 'unhiding the live outlined stroke restores a fixed combined-alpha snapshot');
  }
}));

test('paint eligibility resolves subtree opacity, mask source/content and fully transparent gradient stops', () => {
  const document = createDocument(); const glyph = path('#ffffff'); const plane = path('#ff0000');
  const mask = createNode('group', { width: 10, height: 10, mask: true, maskSourceId: glyph.id, children: [] }); mask.children = [glyph, plane];
  assert.equal(hasVisibleRenderedPaint(document, mask), true);
  plane.fills[0].opacity = 0; assert.equal(hasVisibleRenderedPaint(document, mask), false);
  plane.fills[0].opacity = 1; glyph.fills[0].visible = false; assert.equal(hasVisibleRenderedPaint(document, mask), false);
  glyph.fills[0].visible = true; glyph.fills[0].opacity = 0;
  assert.equal(hasVisibleRenderedPaint(document, mask), false);
  mask.maskMode = 'vector'; assert.equal(hasVisibleRenderedPaint(document, mask), true, 'vector source geometry ignores paint alpha');
  plane.opacity = 0; assert.equal(hasVisibleRenderedPaint(document, mask), false);
  plane.opacity = 1; mask.opacity = 0; assert.equal(hasVisibleRenderedPaint(document, mask), false);
  mask.opacity = 1; mask.maskMode = 'luminance'; glyph.fills[0].opacity = 1; glyph.fills[0].color = '#000000';
  assert.equal(hasVisibleRenderedPaint(document, mask), false, 'a black luminance source contributes no content coverage');
  assert.equal(paintHasVisibleAlpha({ visible: true, opacity: 1, gradient: { stops: [{ color: '#ffffff', opacity: 0 }] } }), false);
  assert.equal(paintHasVisibleAlpha({ visible: true, opacity: 1, color: 'rgba(255,0,0,0)' }), false);
  const empty = path('#ffffff', { points: [], subpaths: [] }); assert.equal(hasVisibleRenderedPaint(document, empty), false);
  const group = createNode('group', { fill: 'transparent', children: [] }); group.children = [group];
  assert.throws(() => hasVisibleRenderedPaint(document, group), /bounded layer-tree budget/);
  assert.throws(() => hasVisibleRenderedPaint(document, mask, { limits: { maxNodes: 1 } }), /bounded layer-tree budget/);
});

test('legacy root fill opacity applies to each direct fill child and leaves stroke alpha and ordinary groups alone', () => environment(() => {
  const document = createDocument();
  const fill = path('#ff0000'); fill.fills[0].opacity = .4;
  const stroke = path('#0000ff', { effectPaintPhase: 'stroke' }); stroke.fills[0].opacity = .5;
  const root = staged(document, [fill, stroke], { effectFillMode: 'legacy', fillOpacity: .3, fill: '#ff00ff', fills: undefined, opacity: .6 });
  const canvas = new Surface(100, 100);
  canvas.context.drawImage = (...args) => canvas.calls.push(['image', canvas.context.globalAlpha, ...args]);
  renderer(document).drawNode(canvas.context, root, 0, 0, new Map());
  const paints = Surface.surfaces[1].calls.filter(call => call[0] === 'fill');
  assert.equal(paints.length, 2, 'semantic scalar root fill never paints a rectangle');
  assert.ok(Math.abs(paints[0][2] - .12) < 1e-12);
  assert.ok(Math.abs(paints[1][2] - .5) < 1e-12);
  assert.equal(canvas.calls.filter(call => call[0] === 'image')[0][1], .6, 'root opacity is applied once after independent fill/stroke paint');
  delete root.effectPaintMode; delete root.effectFillMode; root.fills = [];
  canvas.calls.length = 0; renderer(document).drawNode(canvas.context, root, 0, 0, new Map());
  assert.deepEqual(canvas.calls.filter(call => call[0] === 'fill').map(call => call[2]), [.24, .3]);
}));

test('marked groups include transformed out-of-box children within the bounded isolated surface', () => environment(() => {
  const document = createDocument(); const child = path('#ff0000', { x: -50, y: 120, width: 70, height: 40, rotation: 90 });
  const root = staged(document, [child], { blendMode: 'multiply', affineTransform: { a: 2, b: .3, c: .7, d: 1 } });
  const target = new Surface(300, 300); renderer(document).drawNode(target.context, root, 0, 0, new Map());
  const surface = Surface.surfaces[1];
  assert.ok(surface.width > root.width * 2 && surface.height > root.height * 2);
  assert.ok(surface.width * surface.height <= 4_010_000 && surface.width <= 4096 && surface.height <= 4096);
}));

test('a failed preview cannot suppress a fresh export bounds error and no partial effect surface is allocated', () => environment(() => {
  const document = createDocument(); const root = staged(document, []); root.children.push(root);
  const scene = renderer(document); const errors = []; const previous = console.warn; const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const target = new Surface(100, 100);
    scene.drawNodeWithEffects(target.context, root, 0, 0, new Map(), [], { onRenderError: (_node, error) => errors.push(error) });
    scene.drawNodeWithEffects(target.context, root, 0, 0, new Map(), [], { onRenderError: (_node, error) => errors.push(error) });
    assert.equal(errors.length, 2); assert.equal(warnings.length, 1);
    assert.ok(errors.every(error => /bounded layer-tree budget/u.test(error.message)));
    assert.equal(Surface.surfaces.length, 1, 'effect allocation happens only after valid bounded ink');
  } finally { console.warn = previous; }
}));

test('shadow geometry traces editable glyph mask sources and stroke paths, ignores rectangle planes and paint alpha', () => environment(() => {
  const document = createDocument(); const glyph = path('#ffffff'); const stroke = path('#0000ff', { effectPaintPhase: 'stroke' });
  const source = createNode('group', { width: 10, height: 10, children: [glyph] });
  source.children = [glyph];
  const plane = createNode('rectangle', { width: 10, height: 10,
    fills: [{ id: 'plane', type: 'solid', color: '#ff0000', opacity: 0, visible: true, blendMode: 'normal' }] });
  const mask = createNode('group', { width: 10, height: 10, mask: true, maskSourceId: source.id, children: [source, plane] });
  mask.children = [source, plane];
  const root = staged(document, [mask, stroke]); const scene = renderer(document); const painted = [];
  scene.drawNode = (_ctx, node, _x, _y, _assets, _draft, mode) => painted.push([node.id, mode]);
  scene.createStagedShadowGeometryMask(root, new Map(), 1, 100, 100, 0, 0);
  assert.deepEqual(painted, [[glyph.id, 'vector'], [stroke.id, 'vector']]);
  painted.length = 0; plane.fills[0].visible = false;
  scene.createStagedShadowGeometryMask(root, new Map(), 1, 100, 100, 0, 0);
  assert.deepEqual(painted, [[stroke.id, 'vector']]);
  root.effectFillMode = 'none'; root.children = [glyph, stroke]; glyph.fills = []; painted.length = 0;
  scene.createStagedShadowGeometryMask(root, new Map(), 1, 100, 100, 0, 0);
  assert.deepEqual(painted, [[stroke.id, 'vector']]);
  glyph.fills = [{ id: 'new-paint', type: 'solid', color: '#ff0000', opacity: 0, visible: true }]; painted.length = 0;
  scene.createStagedShadowGeometryMask(root, new Map(), 1, 100, 100, 0, 0);
  assert.deepEqual(painted, [[glyph.id, 'vector'], [stroke.id, 'vector']], 'adding a live fill updates originally unfilled glyph geometry');
}));

test('source local glyph ink and aligned strokes extend beyond short text boxes', () => {
  const document = createDocument();
  const node = createNode('text', { text: 'H', width: 12, height: 15, fontSize: 80,
    strokes: [{ id: 'stroke', width: 6, alignment: 'outside', color: '#ff0000', opacity: 1, visible: true }] });
  addNode(document, node);
  const shapeText = () => ({ upem: 1000, extents: { ascender: 1000, descender: 0, lineGap: 0 },
    glyphs: [{ id: 1, cluster: 0, xAdvance: 800, yAdvance: 0, xOffset: 0, yOffset: 0, path: 'M0 0L800 0L800 1000L0 1000Z' }] });
  const bounds = localTextInkBounds(document, node, shapeText, { forStroke: true });
  assert.ok(bounds.right >= 64 && bounds.bottom >= 80);
  const scene = renderer(document, { shapeLocalTextRun: shapeText });
  const ink = scene.renderInkBounds(node);
  assert.ok(ink.right >= 70 && ink.bottom >= 86);
});

test('source normal ink includes underline contours while text-stroke bounds stay glyph-only', () => {
  const document = createDocument(); const node = createNode('text', { text: 'H', width: 12, height: 15, fontSize: 80, textDecoration: 'underline' });
  addNode(document, node);
  const shapeText = () => ({ upem: 1000, extents: { ascender: 1000, descender: 0, lineGap: 0 },
    glyphs: [{ id: 1, cluster: 0, xAdvance: 800, yAdvance: 0, xOffset: 0, yOffset: 0, path: 'M0 0L800 0L800 1000L0 1000Z' }] });
  const glyph = localTextInkBounds(document, node, shapeText, { forStroke: true });
  const decorated = localTextInkBounds(document, node, shapeText);
  assert.ok(decorated.bottom > glyph.bottom, 'underline geometry below the baseline enlarges isolated fill/effect ink');
});

test('Glass keeps intrinsic legacy run alpha and uses real sampled ImageData with bounded affine ink', () => environment(() => {
  const document = createDocument(); const glyph = path('#ff0000', { x: 80, y: -25 }); glyph.fills[0].opacity = .4;
  const root = staged(document, [glyph], { effectFillMode: 'legacy', fills: undefined, fill: '#ffffff', fillOpacity: .3,
    affineTransform: { a: 2, b: .2, c: .8, d: 1 },
    effects: [{ id: 'glass', type: 'glass', visible: true, lightAngle: 0, lightIntensity: 20, refraction: 10,
      depth: 10, dispersion: 5, frost: 10, splay: 0 }] });
  const scene = renderer(document); const captured = []; const draw = scene.drawNode;
  scene.drawNode = function (ctx, node, ...args) {
    if (node.id === glyph.id) captured.push({ opacity: node.fills[0].opacity, alpha: ctx.globalAlpha });
    return draw.call(this, ctx, node, ...args);
  };
  scene.drawNode(new Surface(300, 300).context, root, 0, 0, new Map());
  assert.ok(captured.some(record => record.opacity === .4 && record.alpha === 1), 'opaque mask retains intrinsic run alpha');
  assert.ok(captured.some(record => record.opacity === .4 && record.alpha === .3), 'normal fills retain scalar opacity');
  assert.ok(Surface.surfaces.some(surface => surface.width > 180), 'affine out-of-box ink participates in backdrop allocation');
}));

test('Glass eligibility uses the legacy scalar paint and never an opaque glyph-mask source', () => environment(() => {
  const document = createDocument(); const glyph = path('#ffffff'); glyph.fills[0].opacity = .3;
  const root = staged(document, [glyph], { effectFillMode: 'legacy', fills: undefined, fill: '#ffffff', fillOpacity: 1,
    effects: [{ type: 'glass', visible: true }] });
  const scene = renderer(document); let sampled = false;
  scene.drawNodeWithGlass = () => { sampled = true; };
  scene.drawNode(new Surface(50, 50).context, root, 0, 0, new Map());
  assert.equal(sampled, false, 'opaque source scalar hides Glass even when all rich runs are partial alpha');
  root.fill = 'transparent';
  scene.drawNode(new Surface(50, 50).context, root, 0, 0, new Map());
  assert.equal(sampled, true);
}));
