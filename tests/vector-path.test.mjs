import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, addNode, parseDocument, serializeDocument } from '../src/model.js';
import { closestVectorSegment, insertVectorNodePoint, longestVectorSegment, removeVectorNodePoint, setVectorNodePoint, setVectorNodePointMode, vectorGeometryFromAnchors, vectorNodePoint, vectorSegmentPoint } from '../src/vector-path.js';

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

test('anchor mode conversion is explicit, persists on the point, and preserves corner geometry', () => {
  const geometry = vectorGeometryFromAnchors([
    { x: 10, y: 10, in: { x: 0, y: 10 }, out: { x: 20, y: 10 }, mode: 'corner' },
    { x: 30, y: 10, mode: 'symmetric' }
  ]);
  assert.equal(geometry.points[0].mode, 'corner');
  assert.equal(geometry.points[1].mode, 'symmetric');
  const node = createNode('path', {
    x: 10, y: 20, width: 100, height: 80,
    points: [{ x: .5, y: .5, in: { x: -.1, y: -.2 }, out: { x: .3, y: 0 }, mode: 'corner' },
      { x: .8, y: .5, in: { x: -.1, y: 0 }, out: { x: .1, y: 0 }, mode: 'symmetric' }]
  });
  const originalIn = { ...node.points[0].in };
  const originalOut = { ...node.points[0].out };

  assert.equal(setVectorNodePointMode(node, 0, 'corner'), true);
  assert.equal(node.points[0].mode, 'corner');
  assert.deepEqual(node.points[0].out, originalOut);
  assert.deepEqual(node.points[0].in, originalIn);

  // Smooth mode aligns the handles but preserves their separate lengths.
  node.points[0].in = { x: -.1, y: -.2 };
  node.points[0].out = { x: .3, y: 0 };
  const smoothLength = Math.hypot(node.points[0].in.x * node.width, node.points[0].in.y * node.height);
  assert.equal(setVectorNodePointMode(node, 0, 'smooth', { preferredHandle: 'out' }), true);
  assert.equal(node.points[0].mode, 'smooth');
  assert.ok(Math.abs(node.points[0].in.y) < 1e-12);
  assert.ok(node.points[0].in.x < 0);
  assert.ok(Math.abs(Math.hypot(node.points[0].in.x * node.width, node.points[0].in.y * node.height) - smoothLength) < 1e-12);

  assert.equal(setVectorNodePointMode(node, 0, 'symmetric'), true);
  assert.equal(node.points[0].mode, 'symmetric');
  assert.ok(Math.abs(node.points[0].in.x + .3) < 1e-12 && Object.is(node.points[0].in.y, -0));
  assert.equal(Math.hypot(node.points[0].in.x * node.width, node.points[0].in.y * node.height),
    Math.hypot(node.points[0].out.x * node.width, node.points[0].out.y * node.height));

  const beforeCorner = { in: { ...node.points[0].in }, out: { ...node.points[0].out } };
  assert.equal(setVectorNodePointMode(node, 0, 'corner'), true);
  assert.equal(node.points[0].mode, 'corner');
  assert.deepEqual({ in: node.points[0].in, out: node.points[0].out }, beforeCorner);

  const document = createDocument();
  addNode(document, createNode('path', { ...node, points: node.points }));
  const restored = parseDocument(serializeDocument(document)).pages[0].children[0];
  assert.equal(restored.points[0].mode, 'corner');
  assert.equal(restored.points[1].mode, 'symmetric');
});

test('moving either handle obeys the persisted corner, smooth, and symmetric mode', () => {
  const makeNode = mode => createNode('path', {
    x: 10, y: 20, width: 100, height: 80,
    points: [{ x: .5, y: .5, in: { x: -.1, y: 0 }, out: { x: .1, y: 0 }, mode }]
  });
  const moved = (node, part, x, y) => {
    assert.equal(setVectorNodePoint(node, 0, part, { x, y }, { symmetric: true }), true);
    return { in: vectorNodePoint(node, 0, 'in'), out: vectorNodePoint(node, 0, 'out') };
  };

  const cornerOut = moved(makeNode('corner'), 'out', 80, 80);
  assert.deepEqual(cornerOut.in, { x: 50, y: 60 });
  assert.deepEqual(cornerOut.out, { x: 80, y: 80 });
  const cornerIn = moved(makeNode('corner'), 'in', 40, 50);
  assert.deepEqual(cornerIn.in, { x: 40, y: 50 });
  assert.deepEqual(cornerIn.out, { x: 70, y: 60 });

  const smoothOutNode = makeNode('smooth');
  smoothOutNode.points[0].in = { x: -.2, y: 0 };
  const smoothOut = moved(smoothOutNode, 'out', 80, 80);
  assert.deepEqual(smoothOut.out, { x: 80, y: 80 });
  const smoothOutVector = { x: smoothOut.out.x - 60, y: smoothOut.out.y - 60 };
  const smoothOutOpposite = { x: smoothOut.in.x - 60, y: smoothOut.in.y - 60 };
  assert.ok(Math.abs(smoothOutVector.x * smoothOutOpposite.y - smoothOutVector.y * smoothOutOpposite.x) < 1e-10);
  assert.ok(Math.abs(Math.hypot(smoothOutOpposite.x, smoothOutOpposite.y) - 20) < 1e-12);
  const smoothInNode = makeNode('smooth');
  smoothInNode.points[0].out = { x: .2, y: 0 };
  const smoothIn = moved(smoothInNode, 'in', 40, 50);
  assert.deepEqual(smoothIn.in, { x: 40, y: 50 });
  const smoothInVector = { x: smoothIn.in.x - 60, y: smoothIn.in.y - 60 };
  const smoothInOpposite = { x: smoothIn.out.x - 60, y: smoothIn.out.y - 60 };
  assert.ok(Math.abs(smoothInVector.x * smoothInOpposite.y - smoothInVector.y * smoothInOpposite.x) < 1e-10);
  assert.ok(Math.abs(Math.hypot(smoothInOpposite.x, smoothInOpposite.y) - 20) < 1e-12);

  const symmetricOut = moved(makeNode('symmetric'), 'out', 80, 80);
  assert.deepEqual(symmetricOut.out, { x: 80, y: 80 });
  assert.deepEqual(symmetricOut.in, { x: 40, y: 40 });
  const symmetricIn = moved(makeNode('symmetric'), 'in', 40, 50);
  assert.deepEqual(symmetricIn.in, { x: 40, y: 50 });
  assert.deepEqual(symmetricIn.out, { x: 80, y: 70 });
});

test('invalid anchor modes and malformed handle edits are rejected without mutation', () => {
  assert.throws(() => vectorGeometryFromAnchors([
    { x: 1, y: 2, mode: 'almost-smooth' }, { x: 3, y: 4 }
  ]), /anchor modes must be corner, smooth, or symmetric/);

  const node = createNode('path', {
    x: 10, y: 20, width: 100, height: 80,
    points: [{ x: .5, y: .5, in: { x: -.1, y: 0 }, out: { x: .1, y: 0 }, mode: 'invalid' }]
  });
  const original = structuredClone(node.points[0]);
  assert.equal(setVectorNodePointMode(node, 0, 'smooth'), false);
  assert.equal(setVectorNodePointMode(node, 0, 'invalid'), false);
  assert.equal(setVectorNodePointMode(node, 0, 'smooth', { preferredHandle: 'anchor' }), false);
  assert.equal(setVectorNodePoint(node, 0, 'out', { x: 80, y: 80 }), false);
  assert.equal(setVectorNodePoint(node, 0, 'anchor', { x: NaN, y: 80 }), false);
  assert.deepEqual(node.points[0], original);

  delete node.points[0].mode;
  assert.equal(setVectorNodePointMode(node, 3, 'corner'), false);
  assert.equal(setVectorNodePointMode(node, 0, 'smooth', { preferredHandle: 'bad' }), false);
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
