import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, addNode, parseDocument, serializeDocument } from '../src/model.js';
import {
  closestVectorSegment, insertVectorNodePoint, longestVectorSegment, removeVectorNodePoint,
  setVectorNetworkVertexMode, setVectorNodePoint, setVectorNodePointMode, vectorGeometryFromAnchors, vectorGeometryFromContours,
  vectorNetworkEdgePoints, vectorNetworkGeometryFromAnchors, vectorNetworkGeometryFromFreehandSamples,
  vectorNetworkVertexPoint, vectorNodePoint, vectorSegmentPoint
} from '../src/vector-path.js';

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * amount), point.y - (start.y + dy * amount));
}

function closestPolylineDistance(point, polyline) {
  let closest = Infinity;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    closest = Math.min(closest, pointToSegmentDistance(point, polyline[index], polyline[index + 1]));
  }
  return closest;
}

function cubicPoint(segment, amount) {
  const inverse = 1 - amount;
  const [start, control1, control2, end] = segment;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * amount * control1.x + 3 * inverse * amount ** 2 * control2.x + amount ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * amount * control1.y + 3 * inverse * amount ** 2 * control2.y + amount ** 3 * end.y
  };
}

function networkPolyline(geometry, subdivisions = 24) {
  const origin = { x: geometry.x, y: geometry.y };
  const output = [];
  for (const edge of geometry.edges) {
    const segment = vectorNetworkEdgePoints(geometry, edge.id, origin);
    for (let step = output.length ? 1 : 0; step <= subdivisions; step += 1) {
      output.push(cubicPoint(segment, step / subdivisions));
    }
  }
  return output;
}

function sampledPolylineDeviation(first, second) {
  let maximum = 0;
  const probe = (point, target) => { maximum = Math.max(maximum, closestPolylineDistance(point, target)); };
  for (let index = 0; index < first.length - 1; index += 1) {
    for (let step = 0; step <= 4; step += 1) {
      const amount = step / 4;
      probe({ x: first[index].x + (first[index + 1].x - first[index].x) * amount,
        y: first[index].y + (first[index + 1].y - first[index].y) * amount }, second);
    }
  }
  for (let index = 0; index < second.length - 1; index += 1) {
    for (let step = 0; step <= 4; step += 1) {
      const amount = step / 4;
      probe({ x: second[index].x + (second[index + 1].x - second[index].x) * amount,
        y: second[index].y + (second[index + 1].y - second[index].y) * amount }, first);
    }
  }
  return maximum;
}

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

test('compound contours share normalized geometry and remain addressable for segment editing', () => {
  const geometry = vectorGeometryFromContours([
    { closed: false, anchors: [{ x: 10, y: 10 }, { x: 30, y: 10 }] },
    { closed: false, anchors: [{ x: 100, y: 100 }, { x: 120, y: 100 }] }
  ]);
  assert.deepEqual([geometry.x, geometry.y, geometry.width, geometry.height], [10, 10, 110, 90]);
  assert.deepEqual(geometry.points[0], { x: 0, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } });
  assert.equal(geometry.subpaths.length, 1);
  assert.deepEqual(geometry.subpaths[0].points[0], { x: 90 / 110, y: 1, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } });

  const origin = { x: geometry.x, y: geometry.y };
  const target = vectorSegmentPoint(geometry, 0, 0.5, origin, 1);
  const closest = closestVectorSegment(geometry, target, origin);
  assert.equal(closest.contourIndex, 1);
  assert.equal(closest.segmentIndex, 0);
  const inserted = insertVectorNodePoint(geometry, closest.segmentIndex, closest.t, origin, closest.contourIndex);
  assert.equal(inserted, 1);
  assert.equal(geometry.subpaths[0].points.length, 3);
  assert.equal(geometry.points.length, 2, 'editing one contour leaves its neighbors unchanged');
  removeVectorNodePoint(geometry, inserted, 1);
  assert.equal(geometry.subpaths[0].points.length, 2);
});

test('freehand samples become a finite smooth network and straight strokes collapse to one cubic', () => {
  const samples = Array.from({ length: 41 }, (_, index) => ({ x: index * 2, y: 18 }));
  const before = structuredClone(samples);
  const geometry = vectorNetworkGeometryFromFreehandSamples(samples, { tolerance: .2 });
  assert.deepEqual(samples, before, 'freehand conversion does not mutate caller samples');
  assert.equal(geometry.vertices.length, 2);
  assert.equal(geometry.edges.length, 1);
  assert.equal(geometry.edges[0].control1 != null, true);
  assert.equal(geometry.edges[0].control2 != null, true);
  assert.ok(geometry.vertices.every(vertex => vertex.mode === 'smooth'));
  assert.ok([geometry.x, geometry.y, geometry.width, geometry.height,
    ...geometry.vertices.flatMap(vertex => [vertex.x, vertex.y]),
    ...geometry.edges.flatMap(edge => [edge.control1, edge.control2].filter(Boolean).flatMap(point => [point.x, point.y]))]
    .every(Number.isFinite));
  assert.ok(sampledPolylineDeviation(samples, networkPolyline(geometry)) < 1e-8);
});

test('freehand cubic fitting stays within the requested page-space deviation tolerance', () => {
  const bezier = t => {
    const inverse = 1 - t;
    return {
      x: 3 * inverse ** 2 * t * 30 + 3 * inverse * t ** 2 * 70 + t ** 3 * 100,
      y: 3 * inverse ** 2 * t * 90 + 3 * inverse * t ** 2 * 90
    };
  };
  const samples = Array.from({ length: 121 }, (_, index) => bezier(index / 120));
  const tolerance = 1.5;
  const geometry = vectorNetworkGeometryFromFreehandSamples(samples, { tolerance });
  const rendered = networkPolyline(geometry, 48);
  const deviation = sampledPolylineDeviation(samples, rendered);
  assert.ok(deviation <= tolerance + 1e-6, `fitted curve deviated ${deviation}px for a ${tolerance}px tolerance`);
  assert.ok(geometry.vertices.length > 2, 'a curved stroke retains enough anchors to follow its shape');
  assert.ok(geometry.edges.some(edge => edge.control1 || edge.control2), 'the simplified anchors include smooth cubic controls');
});

test('freehand Ramer-Douglas-Peucker simplification removes sub-tolerance sample noise', () => {
  const samples = Array.from({ length: 1000 }, (_, index) => ({
    x: index / 10,
    y: Math.sin(index * 1.7) * .08
  }));
  const geometry = vectorNetworkGeometryFromFreehandSamples(samples, { tolerance: 1 });
  assert.equal(geometry.vertices.length, 2);
  assert.equal(geometry.edges.length, 1);
  assert.ok(sampledPolylineDeviation(samples, networkPolyline(geometry, 32)) <= 1 + 1e-6);
});

test('freehand conversion returns null only for a degenerate gesture and rejects malformed points', () => {
  assert.equal(vectorNetworkGeometryFromFreehandSamples([]), null);
  assert.equal(vectorNetworkGeometryFromFreehandSamples([{ x: 4, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 5 }]), null);
  assert.throws(() => vectorNetworkGeometryFromFreehandSamples([{ x: 0, y: 0 }, { x: NaN, y: 1 }]), /finite numeric coordinates/);
  assert.throws(() => vectorNetworkGeometryFromFreehandSamples([{ x: 0, y: 0 }, { x: '1', y: 1 }]), /finite numeric coordinates/);
  assert.throws(() => vectorNetworkGeometryFromFreehandSamples([{ x: 0, y: 0 }, { x: 1, y: 1 }], { tolerance: -1 }), /non-negative/);
  assert.throws(() => vectorNetworkGeometryFromFreehandSamples([{ x: 0, y: 0 }, { x: 1, y: 1 }], { maxAnchors: 1 }), /at least two/);
});

test('freehand processing caps source samples and fails when its anchor cap would break tolerance', () => {
  const oversized = Array.from({ length: 16385 }, (_, index) => ({ x: index, y: 0 }));
  assert.throws(() => vectorNetworkGeometryFromFreehandSamples(oversized), /limited to 16384 samples/);

  const zigzag = Array.from({ length: 40 }, (_, index) => ({ x: index, y: index % 2 ? 8 : -8 }));
  assert.throws(() => vectorNetworkGeometryFromFreehandSamples(zigzag, { tolerance: .01, maxAnchors: 2 }), /anchor limit/);
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

test('switching a handle-less corner to Smooth creates tangent handles from its neighbors', () => {
  const node = createNode('path', {
    x: 10, y: 20, width: 120, height: 80,
    points: [{ x: 0, y: 0 }, { x: 1 / 3, y: .5 }, { x: 1, y: 0 }]
  });
  const original = Array.from({ length: 101 }, (_, sample) => vectorSegmentPoint(node, 0, sample / 100));
  assert.equal(setVectorNodePointMode(node, 1, 'smooth'), true);
  const point = node.points[1];
  assert.equal(point.mode, 'smooth');
  assert.ok(Math.hypot(point.in.x * node.width, point.in.y * node.height) > 0);
  assert.ok(Math.hypot(point.out.x * node.width, point.out.y * node.height) > 0);
  assert.ok(Math.abs(point.in.y) < 1e-12 && Math.abs(point.out.y) < 1e-12);
  assert.ok(point.in.x < 0 && point.out.x > 0);

  const anchor = vectorNodePoint(node, 1, 'anchor');
  const incoming = vectorSegmentPoint(node, 0, .99999);
  const outgoing = vectorSegmentPoint(node, 1, .00001);
  const inTangent = { x: anchor.x - incoming.x, y: anchor.y - incoming.y };
  const outTangent = { x: outgoing.x - anchor.x, y: outgoing.y - anchor.y };
  assert.ok(Math.abs(inTangent.x * outTangent.y - inTangent.y * outTangent.x) < 1e-5);
  assert.ok(inTangent.x * outTangent.x + inTangent.y * outTangent.y > 0);
  assert.notDeepEqual(Array.from({ length: 101 }, (_, sample) => vectorSegmentPoint(node, 0, sample / 100)), original,
    'the generated handle should visibly round the formerly straight corner');
  const document = createDocument();
  addNode(document, node);
  const restored = parseDocument(serializeDocument(document)).pages[0].children[0];
  assert.deepEqual(restored.points, node.points, 'inferred handles persist as ordinary editable path data');
});

test('Smooth mode infers secondary-contour handles from that contour only', () => {
  const primaryPoints = [{ x: .05, y: .05 }, { x: .08, y: .05 }, { x: .05, y: .08 }];
  const secondaryPoints = [{ x: .6, y: .6 }, { x: .8, y: .6 }, { x: .7, y: .9 }];
  const node = createNode('path', {
    width: 100, height: 100, points: structuredClone(primaryPoints), closed: true,
    subpaths: [{ closed: false, points: structuredClone(secondaryPoints) }]
  });

  assert.equal(setVectorNodePointMode(node, 1, 'smooth', { contourIndex: 1 }), true);
  assert.deepEqual(node.points, primaryPoints, 'editing a secondary anchor leaves the primary contour alone');
  assert.equal(node.subpaths[0].points[1].mode, 'smooth');
  assert.ok(Math.abs(node.subpaths[0].points[1].in.x + 0.02108185106778919) < 1e-12);
  assert.ok(Math.abs(node.subpaths[0].points[1].in.y + 0.06324555320336758) < 1e-12);
  assert.ok(Math.abs(node.subpaths[0].points[1].out.x - 1 / 30) < 1e-12);
  assert.ok(Math.abs(node.subpaths[0].points[1].out.y - .1) < 1e-12);
});

test('automatic Smooth handles work at open endpoints and wrap across closed paths', () => {
  const open = createNode('path', {
    x: 0, y: 0, width: 100, height: 40,
    points: [{ x: 0, y: .5 }, { x: 1, y: .5 }]
  });
  assert.equal(setVectorNodePointMode(open, 0, 'smooth'), true);
  assert.equal(setVectorNodePointMode(open, 1, 'smooth'), true);
  assert.deepEqual(open.points[0].in, { x: 0, y: 0 });
  assert.ok(open.points[0].out.x > 0);
  assert.ok(Math.abs(vectorSegmentPoint(open, 0, .25).x - 25) < 1e-9);
  assert.ok(Math.abs(vectorSegmentPoint(open, 0, .25).y - 20) < 1e-9,
    'endpoint handles keep an existing straight segment straight');

  const closed = createNode('path', {
    x: 0, y: 0, width: 100, height: 100, closed: true,
    points: [{ x: .5, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }]
  });
  assert.equal(setVectorNodePointMode(closed, 0, 'smooth'), true);
  assert.ok(Math.hypot(closed.points[0].in.x, closed.points[0].in.y) > 0,
    'the first point uses the final point as its previous neighbor');
  assert.ok(Math.hypot(closed.points[0].out.x, closed.points[0].out.y) > 0,
    'the first point uses the second point as its next neighbor');
  const inVector = { x: closed.points[0].in.x * closed.width, y: closed.points[0].in.y * closed.height };
  const outVector = { x: closed.points[0].out.x * closed.width, y: closed.points[0].out.y * closed.height };
  assert.ok(Math.abs(inVector.x * outVector.y - inVector.y * outVector.x) < 1e-9);
  assert.ok(inVector.x * outVector.x + inVector.y * outVector.y < 0);
});

test('automatic smoothing leaves a degenerate reversing tangent finite and unchanged', () => {
  const node = createNode('path', {
    x: 0, y: 0, width: 20, height: 10,
    points: [{ x: 0, y: .5 }, { x: .5, y: .5 }, { x: 0, y: .5 }]
  });
  const handlesBefore = { in: node.points[1].in, out: node.points[1].out };
  assert.equal(setVectorNodePointMode(node, 1, 'smooth'), true);
  assert.equal(node.points[1].mode, 'smooth');
  assert.deepEqual({ in: node.points[1].in, out: node.points[1].out }, handlesBefore);
});

test('network Smooth and Symmetric modes infer handles at a straight triangle vertex', () => {
  for (const mode of ['smooth', 'symmetric']) {
    const node = vectorNetworkGeometryFromAnchors([
      { x: 0, y: 0 }, { x: 80, y: 0 }, { x: 25, y: 65 }
    ], { closed: true });
    const origin = { x: node.x, y: node.y };
    const anchor = vectorNetworkVertexPoint(node, 'v2', origin);
    const originalIncoming = vectorNetworkEdgePoints(node, 'e1', origin)[2];
    const originalOutgoing = vectorNetworkEdgePoints(node, 'e2', origin)[1];
    assert.deepEqual(originalIncoming, anchor);
    assert.deepEqual(originalOutgoing, anchor);

    assert.equal(setVectorNetworkVertexMode(node, 'v2', mode, { origin }), true);
    const incoming = vectorNetworkEdgePoints(node, 'e1', origin)[2];
    const outgoing = vectorNetworkEdgePoints(node, 'e2', origin)[1];
    const incomingVector = { x: incoming.x - anchor.x, y: incoming.y - anchor.y };
    const outgoingVector = { x: outgoing.x - anchor.x, y: outgoing.y - anchor.y };
    assert.ok(Math.hypot(incomingVector.x, incomingVector.y) > 0, `${mode} should create an incoming control`);
    assert.ok(Math.hypot(outgoingVector.x, outgoingVector.y) > 0, `${mode} should create an outgoing control`);
    assert.ok(Math.abs(incomingVector.x * outgoingVector.y - incomingVector.y * outgoingVector.x) < 1e-8,
      `${mode} controls should share an inferred tangent`);
    assert.ok(incomingVector.x * outgoingVector.x + incomingVector.y * outgoingVector.y < 0,
      `${mode} controls should point in opposite directions`);
    if (mode === 'symmetric') {
      assert.ok(Math.abs(Math.hypot(incomingVector.x, incomingVector.y) - Math.hypot(outgoingVector.x, outgoingVector.y)) < 1e-8);
    }
  }
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
