import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, addNode, parseDocument, serializeDocument } from '../src/model.js';
import { setVectorNodePoint, vectorGeometryFromAnchors, vectorNodePoint } from '../src/vector-path.js';

test('absolute anchors and Bézier controls become a scalable vector layer', () => {
  const geometry = vectorGeometryFromAnchors([
    { x: 20, y: 40, in: { x: 20, y: 40 }, out: { x: 80, y: 10 } },
    { x: 160, y: 80, in: { x: 120, y: 120 }, out: { x: 160, y: 80 } }
  ]);
  assert.deepEqual([geometry.x, geometry.y, geometry.width, geometry.height], [20, 10, 140, 110]);
  assert.deepEqual(geometry.points[0], { x: 0, y: 30 / 110, in: { x: 0, y: 0 }, out: { x: 60 / 140, y: -30 / 110 } });
  assert.deepEqual(geometry.points[1].in, { x: -40 / 140, y: 40 / 110 });
  assert.equal(geometry.closed, false);
});

test('vector anchors and handles can be moved with symmetric Bézier handles', () => {
  const node = createNode('path', {
    x: 10, y: 20, width: 100, height: 80,
    points: [{ x: 0.5, y: 0.5, in: { x: -0.1, y: 0 }, out: { x: 0.1, y: 0 } }]
  });
  assert.deepEqual(vectorNodePoint(node, 0, 'anchor'), { x: 60, y: 60 });
  assert.deepEqual(vectorNodePoint(node, 0, 'out'), { x: 70, y: 60 });
  assert.equal(setVectorNodePoint(node, 0, 'out', { x: 65, y: 50 }, { symmetric: true }), true);
  assert.deepEqual(vectorNodePoint(node, 0, 'out'), { x: 65, y: 50 });
  assert.deepEqual(vectorNodePoint(node, 0, 'in'), { x: 55, y: 70 });
  assert.equal(setVectorNodePoint(node, 0, 'anchor', { x: 70, y: 75 }), true);
  assert.deepEqual(vectorNodePoint(node, 0, 'anchor'), { x: 70, y: 75 });
});

test('closed Bézier vector data survives local document serialization', () => {
  const document = createDocument();
  const geometry = vectorGeometryFromAnchors([
    { x: 0, y: 10 }, { x: 30, y: 0, out: { x: 30, y: -10 } }, { x: 60, y: 10 }
  ], { closed: true });
  addNode(document, createNode('path', geometry));
  const restored = parseDocument(serializeDocument(document));
  const path = restored.pages[0].children[0];
  assert.equal(path.closed, true);
  assert.deepEqual(path.points, geometry.points);
});

test('vector path builder rejects malformed points instead of persisting them', () => {
  assert.throws(() => vectorGeometryFromAnchors([{ x: 1, y: 2 }]), /at least two/);
  assert.throws(() => vectorGeometryFromAnchors([{ x: 1, y: 2 }, { x: NaN, y: 3 }]), /finite coordinates/);
  const document = createDocument();
  addNode(document, createNode('path', { points: [{ x: NaN, y: 0 }] }));
  assert.throws(() => serializeDocument(document), /Invalid vector path/);
});
