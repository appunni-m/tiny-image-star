import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import {
  addNode, applyBooleanBake, applyBooleanCombine, bindColorVariable, bindVariable, combineBoolean,
  createColorVariable, createDocument, createFillLayer, createGradientFill, createLayerEffect, createNode,
  createVariable, createVariableCollection, deleteVariable, getBooleanVectorGeometryKey, getBooleanVectorPath, prepareBooleanBake, prepareBooleanCombine,
  resolveBooleanSourceNode, setVariableValue,
  separateBoolean, removeNode, reorderNode, validateDocument, validateBooleanCombinePlan
} from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { booleanGeometryWithKit } from '../src/vector-geometry-kernel.js';

const require = createRequire(import.meta.url);
const kit = await require('canvaskit-wasm')({ wasmBinary: await readFile(new URL('../node_modules/canvaskit-wasm/bin/canvaskit.wasm', import.meta.url)) });
const nativeBoolean = request => booleanGeometryWithKit(kit, request);

test('resolving an unbound Boolean source does not scan the page tree', () => {
  const document = createDocument();
  const source = createNode('rectangle', { x: 17, y: 23, width: 49, height: 31, fill: '#224466' });
  const other = createNode('rectangle', { x: 40, y: 28, width: 25, height: 19 });
  addNode(document, source); addNode(document, other);
  const group = combineBoolean(document, [source.id, other.id], 'union');
  let pageReads = 0;
  const observedDocument = new Proxy(document, {
    get(target, property, receiver) {
      if (property === 'pages') pageReads += 1;
      return Reflect.get(target, property, receiver);
    }
  });
  const resolved = resolveBooleanSourceNode(observedDocument, source);
  assert.equal(resolved.x, 0); assert.equal(resolved.y, 0);
  assert.equal(resolved.width, 49); assert.equal(resolved.height, 31);
  assert.equal(resolved.fill, '#224466');
  assert.equal(group.children[0], source);
  group.booleanGeometry = 'vector';
  getBooleanVectorGeometryKey(observedDocument, group);
  assert.equal(pageReads, 0, 'unbound source coordinates already use the Boolean local frame');
});

test('Boolean output inherits full ordered appearance from front source, except subtract inherits its base', () => {
  const makeSource = (name, x, color) => createNode('rectangle', { name, x, width: 50, height: 40,
    fills: [createFillLayer('solid', { color }), createFillLayer('linear', { gradient: createGradientFill('linear', color) })],
    strokes: [createStroke({ width: 3, color }), createStroke({ width: 5, color: '#123456', opacity: .35 })],
    effects: [createLayerEffect('inner-shadow', { id: `effect-${name}`, offsetX: 2, offsetY: -1, blur: 4 })],
    opacity: .7, blendMode: 'multiply' });
  for (const operation of ['union', 'subtract']) {
    const document = createDocument();
    const back = makeSource('back', 0, '#224466'); const front = makeSource('front', 25, '#ee4455');
    addNode(document, back); addNode(document, front);
    const collection = createVariableCollection(document, 'Opacity');
    const opacity = createVariable(document, collection.id, 'Result opacity', 'number', .6);
    assert.equal(bindVariable(document, front.id, opacity.id, 'opacity'), true);
    const stroke = createColorVariable(document, collection.id, 'Stroke', '#336699');
    assert.equal(bindColorVariable(document, front.id, stroke.id, 'stroke'), true);
    const frontBefore = structuredClone(front); const backBefore = structuredClone(back);
    const group = combineBoolean(document, [front.id, back.id], operation);
    const expected = operation === 'subtract' ? backBefore : frontBefore;
    assert.deepEqual(group.fills, expected.fills);
    assert.deepEqual(group.strokes, expected.strokes);
    assert.deepEqual(group.effects, expected.effects);
    assert.equal(group.opacity, expected.opacity); assert.equal(group.blendMode, expected.blendMode);
    assert.equal(group.strokeVariableId, operation === 'subtract' ? undefined : stroke.id);
    assert.equal(group.variableBindings?.opacity, operation === 'subtract' ? undefined : opacity.id);
    assert.equal(group.booleanGeometry, undefined, 'the synchronous legacy operation does not pretend its geometry was prepared');
    const restored = separateBoolean(document, group.id);
    assert.deepEqual(restored, [backBefore, frontBefore], 'unmodified Boolean sources recover their exact original geometry and paint');
    assert.equal(validateDocument(document), true);
  }
});

test('prepared vector Boolean includes open path and line stroke regions, preserves its paint owner, and bakes the same geometry', async () => {
  const document = createDocument();
  const line = createNode('line', { x: 8, y: 15, width: 70, height: 0, strokes: [createStroke({ width: 10, cap: 'round', color: '#ff2255' })] });
  const path = createNode('path', { x: 48, y: 0, width: 32, height: 30, closed: false,
    points: [{ x: 0, y: 1 }, { x: .5, y: 0 }, { x: 1, y: 1 }],
    fills: [], strokes: [createStroke({ width: 4, cap: 'round', color: '#335577' })] });
  addNode(document, line); addNode(document, path);
  const lineBefore = structuredClone(line); const pathBefore = structuredClone(path);
  const before = JSON.stringify(document);
  const plan = await prepareBooleanCombine(document, [line.id, path.id], 'union', document.activePageId, { booleanGeometry: nativeBoolean });
  assert.equal(JSON.stringify(document), before, 'preparation does not move or restyle editable sources');
  validateBooleanCombinePlan(document, plan);
  const group = applyBooleanCombine(document, plan);
  assert.equal(group.children[0], line); assert.equal(group.children[1], path, 'applying the plan reparents the exact source objects');
  assert.equal(group.booleanGeometry, 'vector');
  assert.deepEqual(group.strokes, pathBefore.strokes, 'front source supplies result stroke stack');
  const geometry = getBooleanVectorPath(document, group);
  assert.ok(geometry.points.length > 0);
  const separateDocument = structuredClone(document);
  const baked = applyBooleanBake(document, prepareBooleanBake(document, group.id));
  assert.equal(baked.type, 'path'); assert.equal(baked.closed, true);
  assert.ok(baked.points.length > 0);
  assert.ok(baked.points.some(point => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1),
    'line caps and open path stroke ink remain beyond the source geometry box');
  validateDocument(document);
  const restored = separateBoolean(separateDocument, group.id);
  assert.deepEqual(restored, [lineBefore, pathBefore], 'Separate restores original source coordinates after a successful vector operation');
  validateDocument(document);
});

test('vector Boolean source fills include holes and preserve empty output; stale preparations fail before applying', async () => {
  const document = createDocument();
  const ring = createNode('path', { width: 80, height: 60, closed: true, fillRule: 'evenodd', fill: '#224466',
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    subpaths: [{ closed: true, points: [{ x: .25, y: .25 }, { x: .75, y: .25 }, { x: .75, y: .75 }, { x: .25, y: .75 }] }] });
  const cutter = createNode('rectangle', { x: 15, y: 15, width: 50, height: 35, fill: '#ff6655' });
  addNode(document, ring); addNode(document, cutter);
  const plan = await prepareBooleanCombine(document, [ring.id, cutter.id], 'subtract', document.activePageId, { booleanGeometry: nativeBoolean });
  const group = applyBooleanCombine(document, plan); const result = getBooleanVectorPath(document, group);
  assert.ok(result.points.length > 0); assert.ok(result.subpaths?.length, 'the even-odd ring preserves its inner contour');
  assert.equal(result.fillRule, 'evenodd');

  const staleDocument = createDocument();
  const first = createNode('rectangle', { width: 30, height: 30 }); const second = createNode('line', { x: 10, width: 40, height: 0, strokes: [createStroke({ width: 4 })] });
  addNode(staleDocument, first); addNode(staleDocument, second);
  let release; let started;
  const waiting = new Promise(resolve => { release = resolve; });
  const didStart = new Promise(resolve => { started = resolve; });
  const planPromise = prepareBooleanCombine(staleDocument, [first.id, second.id], 'union', staleDocument.activePageId, {
    booleanGeometry: async request => { started(); await waiting; return nativeBoolean(request); }
  });
  await didStart; second.x += 3; release();
  await assert.rejects(planPromise, /changed while|stale/i);
  assert.equal(staleDocument.pages[0].children.length, 2, 'stale work never installs a partial Boolean group');
});

test('vector Boolean group frame uses resolved mode-bound source geometry', async () => {
  const document = createDocument();
  const source = createNode('rectangle', { x: 0, y: 10, width: 20, height: 20, fill: '#224466' });
  const other = createNode('rectangle', { x: 100, y: 10, width: 20, height: 20, fill: '#ee4455' });
  addNode(document, source); addNode(document, other);
  const collection = createVariableCollection(document, 'Boolean geometry');
  const x = createVariable(document, collection.id, 'Resolved x', 'number', 40);
  const width = createVariable(document, collection.id, 'Resolved width', 'number', 30);
  assert.equal(bindVariable(document, source.id, x.id, 'x'), true);
  assert.equal(bindVariable(document, source.id, width.id, 'width'), true);
  const plan = await prepareBooleanCombine(document, [source.id, other.id], 'union', document.activePageId, { booleanGeometry: nativeBoolean });
  const group = applyBooleanCombine(document, plan);
  assert.equal(group.x, 40);
  assert.equal(group.width, 80);
  const geometry = getBooleanVectorPath(document, group);
  const xs = [geometry.points, ...(geometry.subpaths || []).map(contour => contour.points)].flat().map(point => point.x * group.width);
  assert.ok(Math.min(...xs) >= -1e-5 && Math.max(...xs) <= group.width + 1e-5,
    'mode-bound source placement and size are represented inside the prepared group coordinate frame');
  assert.equal(group.children[0].width, 20, 'Separate retains the authored fallback width on the source');
});

test('Boolean source-frame metadata survives child add, delete, and reorder while retaining the group origin', () => {
  const document = createDocument();
  const first = createNode('rectangle', { x: 0, y: 10, width: 20, height: 20 });
  const middle = createNode('rectangle', { x: 60, y: 10, width: 20, height: 20 });
  const last = createNode('rectangle', { x: 120, y: 10, width: 20, height: 20 });
  addNode(document, first); addNode(document, middle); addNode(document, last);
  const collection = createVariableCollection(document, 'Position');
  const boundX = createVariable(document, collection.id, 'Source x', 'number', 40);
  assert.equal(bindVariable(document, first.id, boundX.id, 'x'), true);
  const group = combineBoolean(document, [first.id, middle.id, last.id], 'union');
  assert.equal(resolveBooleanSourceNode(document, group.children[0]).x, 0, 'wrapped source coordinates resolve in group-local space');
  assert.equal(bindVariable(document, first.id, null, 'x'), true);
  assert.equal(first.x, 0, 'unbinding a parent-space x value materializes it in the Boolean child local frame');
  assert.equal(resolveBooleanSourceNode(document, first).x, 0);
  const rebound = createVariable(document, collection.id, 'Rebound source x', 'number', 40);
  assert.equal(bindVariable(document, first.id, rebound.id, 'x'), true);
  assert.equal(deleteVariable(document, rebound.id), true);
  assert.equal(first.x, 0, 'deleting a bound variable materializes its value in the Boolean child local frame');
  removeNode(document, middle.id);
  validateDocument(document);
  assert.equal(resolveBooleanSourceNode(document, first).x, 0, 'deletion keeps the frame origin for mode-bound coordinate resolution');
  const added = createNode('rectangle', { x: 30, y: 5, width: 10, height: 10 });
  addNode(document, added, { parentId: group.id });
  const extra = createNode('rectangle', { x: 45, y: 5, width: 10, height: 10 });
  addNode(document, extra, { parentId: group.id, index: 0 });
  reorderNode(document, last.id, 0);
  validateDocument(document);
  assert.equal(resolveBooleanSourceNode(document, first).x, 0);
});

test('Separate fails atomically when group affine or transformed mode-bound sources cannot be preserved', () => {
  const affineDocument = createDocument();
  const a = createNode('rectangle', { width: 20, height: 20 }); const b = createNode('rectangle', { x: 30, width: 20, height: 20 });
  addNode(affineDocument, a); addNode(affineDocument, b);
  const affineGroup = combineBoolean(affineDocument, [a.id, b.id], 'union');
  affineGroup.affineTransform = { a: 1.5, b: 0, c: .25, d: 1 };
  const beforeAffineSeparate = JSON.stringify(affineDocument);
  assert.throws(() => separateBoolean(affineDocument, affineGroup.id), /affine transform/);
  assert.equal(JSON.stringify(affineDocument), beforeAffineSeparate, 'unsupported affine separation leaves every source and group field untouched');

  const boundDocument = createDocument();
  const source = createNode('rectangle', { width: 20, height: 20 }); const other = createNode('rectangle', { x: 50, width: 20, height: 20 });
  addNode(boundDocument, source); addNode(boundDocument, other);
  const collection = createVariableCollection(boundDocument, 'Position');
  const x = createVariable(boundDocument, collection.id, 'Source x', 'number', 15);
  bindVariable(boundDocument, source.id, x.id, 'x');
  const boundGroup = combineBoolean(boundDocument, [source.id, other.id], 'union');
  boundGroup.x += 10;
  const beforeBoundSeparate = JSON.stringify(boundDocument);
  assert.throws(() => separateBoolean(boundDocument, boundGroup.id), /mode-bound Boolean source geometry/);
  assert.equal(JSON.stringify(boundDocument), beforeBoundSeparate, 'Separate does not write fallback values that variable bindings would override');
});

test('baking an empty prepared vector Boolean produces a valid empty editable path', async () => {
  const document = createDocument();
  const a = createNode('rectangle', { x: 10, y: 10, width: 30, height: 30, fill: '#224466' });
  const b = createNode('rectangle', { x: 10, y: 10, width: 30, height: 30, fill: '#ee4455' });
  addNode(document, a); addNode(document, b);
  const plan = await prepareBooleanCombine(document, [a.id, b.id], 'subtract', document.activePageId, { booleanGeometry: nativeBoolean });
  const group = applyBooleanCombine(document, plan);
  assert.deepEqual(getBooleanVectorPath(document, group).points, []);
  const baked = applyBooleanBake(document, prepareBooleanBake(document, group.id));
  assert.equal(baked.type, 'path'); assert.deepEqual(baked.points, []);
  assert.equal(validateDocument(document), true);
});

test('vector Bake plans bind to their document and reject changed resolved visibility sources', async () => {
  const document = createDocument();
  const a = createNode('rectangle', { width: 30, height: 30, fill: '#224466' });
  const b = createNode('rectangle', { x: 20, width: 30, height: 30, fill: '#ee4455' });
  addNode(document, a); addNode(document, b);
  const collection = createVariableCollection(document, 'Visibility');
  const visible = createVariable(document, collection.id, 'Second source visible', 'boolean', true);
  assert.equal(bindVariable(document, b.id, visible.id, 'visible'), true);
  const combinePlan = await prepareBooleanCombine(document, [a.id, b.id], 'union', document.activePageId, { booleanGeometry: nativeBoolean });
  const group = applyBooleanCombine(document, combinePlan);
  const bakePlan = prepareBooleanBake(document, group.id);
  assert.throws(() => applyBooleanBake(structuredClone(document), bakePlan), /for this document/);
  assert.equal(setVariableValue(document, visible.id, false), true);
  assert.throws(() => applyBooleanBake(document, bakePlan), /resolved Boolean source geometry changed/);
  assert.equal(group.type, 'boolean', 'a stale prepared result never replaces the live group');
  assert.equal(validateDocument(document), true);
});
