import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, addNode, parseDocument, serializeDocument } from '../src/model.js';
import { closestVectorSegment, insertVectorNodePoint, longestVectorSegment, removeVectorNodePoint, setVectorNodePoint, vectorGeometryFromAnchors, vectorNodePoint, vectorSegmentPoint } from '../src/vector-path.js';

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

test('inserting a point subdivides a curved Bézier segment without changing its outline', () => {
  const node = createNode('path', {
    x: 60, y: 90, width: 120, height: 100,
    points: [
      { x: .05, y: .8, in: { x: 0, y: 0 }, out: { x: .25, y: -.75 } },
      { x: .9, y: .3, in: { x: -.18, y: .5 }, out: { x: 0, y: 0 } }
    ]
  });
  const absoluteOrigin = { x: 420, y: 310 };
  const original = Array.from({ length: 101 }, (_, index) => vectorSegmentPoint(node, 0, index / 100, absoluteOrigin));
  const split = .37;
  const inserted = insertVectorNodePoint(node, 0, split, absoluteOrigin);

  assert.equal(inserted, 1);
  assert.equal(node.points.length, 3);
  for (let sample = 0; sample <= 100; sample += 1) {
    const t = sample / 100;
    const actual = t <= split
      ? vectorSegmentPoint(node, 0, t / split, absoluteOrigin)
      : vectorSegmentPoint(node, 1, (t - split) / (1 - split), absoluteOrigin);
    assert.ok(Math.hypot(actual.x - original[sample].x, actual.y - original[sample].y) < 1e-9, `curve changed at t=${t}`);
  }
  const nearest = closestVectorSegment(node, original[50], absoluteOrigin);
  assert.ok(nearest.distance < .001);
  assert.ok([0, 1].includes(longestVectorSegment(node, absoluteOrigin).segmentIndex));
});

test('closed path insertion splits the closing edge and point deletion preserves the two-point minimum', () => {
  const node = createNode('path', {
    x: 30, y: 40, width: 100, height: 80, closed: true,
    points: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .5, y: .9 }]
  });
  const origin = { x: 30, y: 40 };
  const original = Array.from({ length: 51 }, (_, index) => vectorSegmentPoint(node, 2, index / 50, origin));
  assert.equal(insertVectorNodePoint(node, 2, .5, origin), 3);
  for (let sample = 0; sample <= 50; sample += 1) {
    const t = sample / 50;
    const actual = t <= .5
      ? vectorSegmentPoint(node, 2, t * 2, origin)
      : vectorSegmentPoint(node, 3, (t - .5) * 2, origin);
    assert.ok(Math.hypot(actual.x - original[sample].x, actual.y - original[sample].y) < 1e-9);
  }
  assert.ok(Math.abs(removeVectorNodePoint(node, 3).x - .3) < 1e-9);
  assert.equal(node.points.length, 3);
  removeVectorNodePoint(node, 2);
  assert.equal(node.points.length, 2);
  assert.equal(removeVectorNodePoint(node, 0), null);
  assert.equal(node.points.length, 2);
});
