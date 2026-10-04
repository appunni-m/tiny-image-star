import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, createDocument, createNode, findNode, validateDocument
} from '../src/model.js';
import { shapeBuilderRegionAtPoint } from '../src/boolean-geometry.js';
import { applyShapeBuilderEdit } from '../src/shape-builder-edit.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';

function boundsOf(region) {
  return region.contours.flat().flatMap(curve => [curve.p0, curve.p1, curve.p2, curve.p3])
    .reduce((bounds, point) => ({
      left: Math.min(bounds.left, point.x), top: Math.min(bounds.top, point.y),
      right: Math.max(bounds.right, point.x), bottom: Math.max(bounds.bottom, point.y)
    }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}

function assertBoundsNear(actual, expected) {
  for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-6, `${key}: ${actual[key]} ≈ ${expected[key]}`);
}

test('extract replaces only source regions, preserves their identities, and inserts a styled editable path', () => {
  const document = createDocument();
  const back = createNode('rectangle', { name: 'Back', x: -40, width: 10, height: 10 });
  const first = createNode('rectangle', { name: 'Base', x: 0, y: 0, width: 100, height: 100, fill: '#f00' });
  const between = createNode('ellipse', { name: 'Unselected', x: 200, y: 0, width: 20, height: 20 });
  const second = createNode('rectangle', { name: 'Top', x: 50, y: 0, width: 100, height: 100, fill: '#00f' });
  const front = createNode('rectangle', { name: 'Front', x: 300, width: 10, height: 10 });
  for (const node of [back, first, between, second, front]) addNode(document, node);

  const result = applyShapeBuilderEdit(document, [first.id, second.id], [{ x: 75, y: 50 }], { mode: 'extract' });
  assert.notEqual(result.document, document);
  assert.equal(result.resultPath.type, 'path');
  assert.equal(result.resultPath.fill, '#00f', 'the topmost contributing source supplies the extracted face style');
  assert.deepEqual(result.document.pages[0].children.map(node => node.id), [back.id, first.id, between.id, second.id, result.resultPath.id, front.id]);
  assert.equal(findNode(result.document, first.id).node.type, 'path');
  assert.equal(findNode(result.document, second.id).node.type, 'path');
  assert.equal(validateDocument(result.document), true);

  assertBoundsNear(boundsOf(shapeBuilderRegionAtPoint([findNode(result.document, first.id).node], { x: 25, y: 50 })),
    { left: 0, top: 0, right: 50, bottom: 100 });
  assertBoundsNear(boundsOf(shapeBuilderRegionAtPoint([result.resultPath], { x: 75, y: 50 })),
    { left: 50, top: 0, right: 100, bottom: 100 });
  assertBoundsNear(boundsOf(shapeBuilderRegionAtPoint([findNode(result.document, second.id).node], { x: 125, y: 50 })),
    { left: 100, top: 0, right: 150, bottom: 100 });
});

test('subtract removes the chosen face from every covering source without creating a replacement', () => {
  const document = createDocument();
  const first = createNode('rectangle', { x: 0, y: 0, width: 100, height: 100 });
  const second = createNode('rectangle', { x: 50, y: 0, width: 100, height: 100 });
  addNode(document, first); addNode(document, second);
  const result = applyShapeBuilderEdit(document, [first.id, second.id], [{ x: 75, y: 50 }], { mode: 'subtract' });
  assert.equal(result.resultPath, null);
  assert.deepEqual(result.document.pages[0].children.map(node => node.id), [first.id, second.id]);
  assertBoundsNear(boundsOf(shapeBuilderRegionAtPoint([findNode(result.document, first.id).node], { x: 25, y: 50 })),
    { left: 0, top: 0, right: 50, bottom: 100 });
  assertBoundsNear(boundsOf(shapeBuilderRegionAtPoint([findNode(result.document, second.id).node], { x: 125, y: 50 })),
    { left: 100, top: 0, right: 150, bottom: 100 });
  assert.equal(validateDocument(result.document), true);
});

test('drag merge combines disconnected faces into one compound path and deduplicates repeated samples', () => {
  const document = createDocument();
  const islands = createNode('path', {
    name: 'Islands', x: 0, y: 0, width: 100, height: 40, closed: true, fillRule: 'evenodd', fill: '#0aa',
    points: [{ x: 0, y: 0 }, { x: .2, y: 0 }, { x: .2, y: 1 }, { x: 0, y: 1 }],
    subpaths: [{ closed: true, points: [
      { x: .8, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: .8, y: 1 }
    ] }]
  });
  const enclosing = createNode('rectangle', { x: -10, y: -10, width: 120, height: 60 });
  addNode(document, islands); addNode(document, enclosing);
  const result = applyShapeBuilderEdit(document, [islands.id, enclosing.id], [
    { x: 10, y: 20 }, { x: 12, y: 20 }, { x: 90, y: 20 }
  ], { mode: 'merge' });
  assert.equal(result.regions, 2);
  assert.equal(result.resultPath.subpaths.length, 1);
  assert.equal(validateDocument(result.document), true);
  assertBoundsNear(boundsOf(shapeBuilderRegionAtPoint([result.resultPath], { x: 10, y: 20 })),
    { left: 0, top: 0, right: 20, bottom: 40 });
  assertBoundsNear(boundsOf(shapeBuilderRegionAtPoint([result.resultPath], { x: 90, y: 20 })),
    { left: 80, top: 0, right: 100, bottom: 40 });
});

test('Shape Builder keeps ellipse arcs and ring holes when converting a remaining source to a path', () => {
  const document = createDocument();
  const ring = createNode('ellipse', {
    name: 'Donut', x: 0, y: 0, width: 100, height: 100,
    arcData: { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: .4 }
  });
  const cutter = createNode('rectangle', { name: 'Cutter', x: 65, y: 40, width: 25, height: 20 });
  addNode(document, ring); addNode(document, cutter);

  const result = applyShapeBuilderEdit(document, [ring.id, cutter.id], [{ x: 75, y: 50 }], { mode: 'extract' });
  const remainingRing = findNode(result.document, ring.id).node;
  assert.equal(remainingRing.type, 'path');
  assert.equal(Object.hasOwn(remainingRing, 'arcData'), false, 'arc semantics are baked into the resulting path');
  assert.equal(validateDocument(result.document), true);
  assert.equal(shapeBuilderRegionAtPoint([remainingRing], { x: 50, y: 50 }), null,
    'conversion must preserve the donut hole');
  assert(shapeBuilderRegionAtPoint([remainingRing], { x: 90, y: 50 }),
    'the untouched outer band stays filled');
});

test('unsupported geometry and outside clicks fail atomically without mutating the source document', () => {
  const document = createDocument();
  const first = createNode('rectangle', { width: 20, height: 20 });
  const second = createNode('ellipse', { x: 10, width: 20, height: 20 });
  addNode(document, first); addNode(document, second);
  const snapshot = structuredClone(document);
  assert.throws(() => applyShapeBuilderEdit(document, [first.id, second.id], [{ x: 200, y: 200 }]), /Move inside a filled region/);
  assert.deepEqual(document, snapshot);

  first.variableBindings = { width: 'mode-bound-width' };
  assert.throws(() => applyShapeBuilderEdit(document, [first.id, second.id], [{ x: 15, y: 10 }]), /variable-bound geometry/);
  assert.deepEqual(document.pages[0].children.map(node => node.id), [first.id, second.id]);
});

test('affine-reflected and sheared sources bake their transforms into editable output paths', () => {
  const document = createDocument();
  const first = createNode('rectangle', {
    name: 'Affine source', x: 0, y: 0, width: 100, height: 100,
    affineTransform: { a: -1, b: .25, c: .3, d: 1 }
  });
  const second = createNode('rectangle', { name: 'Overlap', x: -110, y: -10, width: 70, height: 150 });
  addNode(document, first); addNode(document, second);
  const overlapPoint = nodeLocalToPage(first, { x: 80, y: 50 });
  const firstOnlyPoint = nodeLocalToPage(first, { x: 20, y: 30 });
  const secondOnlyPoint = { x: -105, y: 50 };
  assert(shapeBuilderRegionAtPoint([first, second], overlapPoint), 'the affine source should intersect the second source at the sampled point');

  const result = applyShapeBuilderEdit(document, [first.id, second.id], [overlapPoint], { mode: 'extract' });
  const firstRemainder = findNode(result.document, first.id).node;
  const secondRemainder = findNode(result.document, second.id).node;
  assert.equal(firstRemainder.type, 'path');
  assert.equal(secondRemainder.type, 'path');
  assert.equal(firstRemainder.affineTransform, undefined, 'the affine must be baked into path coordinates exactly once');
  assert.equal(secondRemainder.affineTransform, undefined);
  assert.equal(result.resultPath.affineTransform, undefined);
  assert(shapeBuilderRegionAtPoint([result.resultPath], overlapPoint), 'the extracted path should occupy the original affine overlap');
  assert.equal(shapeBuilderRegionAtPoint([firstRemainder], overlapPoint), null, 'the first remainder must exclude the extracted region');
  assert.equal(shapeBuilderRegionAtPoint([secondRemainder], overlapPoint), null, 'the second remainder must exclude the extracted region');
  assert(shapeBuilderRegionAtPoint([firstRemainder], firstOnlyPoint), 'the affine source-only area should remain in its source layer');
  assert(shapeBuilderRegionAtPoint([secondRemainder], secondOnlyPoint), 'the other source-only area should remain in its source layer');
  assert.equal(validateDocument(result.document), true);
});

test('Shape Builder refuses hidden and composited sources rather than changing their appearance silently', () => {
  const mutations = [
    node => { node.visible = false; },
    node => { node.opacity = .5; },
    node => { node.blendMode = 'multiply'; },
    node => { node.fill = '#ff000080'; },
    node => { node.fills = [{ id: 'translucent', type: 'solid', color: '#ff0000', opacity: .5 }]; }
  ];
  for (const mutate of mutations) {
    const document = createDocument();
    const first = createNode('rectangle', { width: 100, height: 100 });
    const second = createNode('rectangle', { x: 50, width: 100, height: 100 });
    mutate(first);
    addNode(document, first); addNode(document, second);
    const snapshot = structuredClone(document);
    assert.throws(() => applyShapeBuilderEdit(document, [first.id, second.id], [{ x: 75, y: 50 }]), /hidden|transparency or blending/);
    assert.deepEqual(document, snapshot, 'refusing an unsupported composite must not mutate any source layer');
  }
});

test('Shape Builder requires same-container unlocked source layers and keeps parent auto layout valid', () => {
  const document = createDocument();
  const frame = createNode('frame', { autoLayout: { axis: 'horizontal', gap: 12, padding: 8 } });
  const first = createNode('rectangle', { x: 0, y: 0, width: 100, height: 100 });
  const second = createNode('rectangle', { x: 50, y: 0, width: 100, height: 100 });
  addNode(document, frame); addNode(document, first); addNode(document, second);
  const nestedFirst = createNode('rectangle', { x: 0, width: 100, height: 100 });
  const nestedSecond = createNode('ellipse', { x: 50, y: -20, width: 100, height: 140 });
  addNode(document, nestedFirst, { parentId: frame.id }); addNode(document, nestedSecond, { parentId: frame.id });
  assert.throws(() => applyShapeBuilderEdit(document, [first.id, nestedSecond.id], [{ x: 75, y: 50 }]), /same container/);
  first.locked = true;
  assert.throws(() => applyShapeBuilderEdit(document, [first.id, second.id], [{ x: 75, y: 50 }]), /Unlock/);
  first.locked = false;
  const result = applyShapeBuilderEdit(document, [nestedFirst.id, nestedSecond.id], [{ x: 75, y: 50 }]);
  assert.equal(validateDocument(result.document), true);
});
