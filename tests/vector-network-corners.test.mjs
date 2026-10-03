import test from 'node:test';
import assert from 'node:assert/strict';
import {
  vectorNetworkGeometryFromAnchors, vectorNetworkEdgePoints
} from '../src/vector-path.js';
import {
  networkFaceCornerEligibility, traceVectorNetworkFacePath,
  vectorNetworkFacePathCommands, vectorNetworkFacePathPoints,
  vectorNetworkVertexCornerRadiusEligibility
} from '../src/vector-network-corners.js';

function square() {
  const geometry = vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }
  ], { closed: true });
  return { type: 'network', ...geometry };
}

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

function pointNear(actual, expected, tolerance = 1e-6) {
  near(actual.x, expected.x, tolerance);
  near(actual.y, expected.y, tolerance);
}

function cubicPoint(points, t) {
  const inverse = 1 - t;
  const [p0, p1, p2, p3] = points;
  return {
    x: inverse ** 3 * p0.x + 3 * inverse ** 2 * t * p1.x + 3 * inverse * t ** 2 * p2.x + t ** 3 * p3.x,
    y: inverse ** 3 * p0.y + 3 * inverse ** 2 * t * p1.y + 3 * inverse * t ** 2 * p2.y + t ** 3 * p3.y
  };
}

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function cubicLength(points, endT = 1) {
  let total = 0;
  let previous = points[0];
  for (let index = 1; index <= 5000; index += 1) {
    const next = cubicPoint(points, endT * index / 5000);
    total += distance(previous, next);
    previous = next;
  }
  return total;
}

function parameterAtLength(points, requested) {
  let low = 0; let high = 1;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (low + high) / 2;
    if (cubicLength(points, middle) < requested) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function split(points, t) {
  const mix = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const [p0, p1, p2, p3] = points;
  const p01 = mix(p0, p1); const p12 = mix(p1, p2); const p23 = mix(p2, p3);
  const p012 = mix(p01, p12); const p123 = mix(p12, p23); const middle = mix(p012, p123);
  return [[p0, p01, p012, middle], [middle, p123, p23, p3]];
}

function subcurve(points, start, end) {
  const left = split(points, end)[0];
  return start <= 0 ? left : split(left, start / end)[1];
}

test('network face eligibility requires a simple unshared cycle with degree-two boundary vertices', () => {
  const node = square();
  const face = node.faces[0];
  assert.deepEqual(networkFaceCornerEligibility(node, face), { eligible: true, reason: null });
  assert.deepEqual(vectorNetworkVertexCornerRadiusEligibility(node, face.vertexIds[0]), { eligible: true, reason: null });

  const branched = square();
  branched.vertices.push({ id: 'branch', x: 0.5, y: 0.5 });
  branched.edges.push({ id: 'branch-edge', from: branched.faces[0].vertexIds[0], to: 'branch' });
  assert.deepEqual(networkFaceCornerEligibility(branched, branched.faces[0]), { eligible: false, reason: 'boundary-branch' });

  const shared = square();
  shared.faces.push({ id: 'f2', vertexIds: [shared.faces[0].vertexIds[0], 'v2', 'v3'] });
  assert.deepEqual(networkFaceCornerEligibility(shared, shared.faces[0]), { eligible: false, reason: 'shared-face' });
  assert.deepEqual(vectorNetworkVertexCornerRadiusEligibility(shared, shared.faces[0].vertexIds[0]), { eligible: false, reason: 'shared-face' });
});

test('rounded square honors independent radii and leaves zero-radius corners sharp', () => {
  const node = square();
  node.vertices[0].cornerRadius = 12;
  node.vertices[2].cornerRadius = 24;
  const path = vectorNetworkFacePathCommands(node, node.faces[0], { x: node.x, y: node.y });
  assert.ok(path);
  const arcs = path.commands.filter(command => command.type === 'arc');
  assert.equal(arcs.length, 2);
  assert.deepEqual(arcs.map(command => command.radius).sort((a, b) => a - b), [12, 24]);
  pointNear(path.start, { x: node.x + 12, y: node.y });
  assert.equal(vectorNetworkFacePathPoints(node, node.faces[0], { x: node.x, y: node.y }).length > 8, true);

  const traceCalls = [];
  const ctx = {
    moveTo: (...args) => traceCalls.push(['moveTo', ...args]),
    lineTo: (...args) => traceCalls.push(['lineTo', ...args]),
    bezierCurveTo: (...args) => traceCalls.push(['bezierCurveTo', ...args]),
    arc: (...args) => traceCalls.push(['arc', ...args]),
    closePath: () => traceCalls.push(['closePath'])
  };
  assert.equal(traceVectorNetworkFacePath(ctx, node, node.faces[0], { x: node.x, y: node.y }), true);
  assert.equal(traceCalls.filter(call => call[0] === 'arc').length, 2);
  assert.equal(traceCalls.at(-1)[0], 'closePath');
});

test('rounded face trims an original cubic by exact subdivision and retains its curve', () => {
  const node = square();
  // Replace the top edge with a genuine cubic. Coordinates are normalized to
  // the graph box; node-local conversion must preserve its exact cubic shape.
  node.edges[0].control1 = { x: 0.2, y: 0 };
  node.edges[0].control2 = { x: 0.8, y: -0.25 };
  node.vertices[0].cornerRadius = 10;
  node.vertices[1].cornerRadius = 15;
  const origin = { x: node.x, y: node.y };
  const original = vectorNetworkEdgePoints(node, node.edges[0].id, origin);
  const path = vectorNetworkFacePathCommands(node, node.faces[0], origin);
  assert.ok(path);
  const preserved = path.commands[0];
  assert.equal(preserved.type, 'cubic');
  assert.ok(distance(preserved.start, original[0]) > 1);
  assert.ok(distance(preserved.end, original[3]) > 1);

  // The first corner is a right angle and consumes 10 document units. The
  // second corner follows the cubic's angled endpoint tangent, so calculate
  // its fillet distance from that turn and compare against the exact source
  // subcurve, rather than just checking a visually similar endpoint.
  const startT = parameterAtLength(original, 10);
  const reversed = [original[3], original[2], original[1], original[0]];
  const nextEdge = vectorNetworkEdgePoints(node, node.edges[1].id, origin);
  const incoming = { x: original[3].x - original[2].x, y: original[3].y - original[2].y };
  const outgoing = { x: nextEdge[3].x - nextEdge[0].x, y: nextEdge[3].y - nextEdge[0].y };
  const turn = Math.abs(Math.atan2(incoming.x * outgoing.y - incoming.y * outgoing.x,
    incoming.x * outgoing.x + incoming.y * outgoing.y));
  const endFromReverse = parameterAtLength(reversed, 15 * Math.tan(turn / 2));
  const expected = subcurve(original, startT, 1 - endFromReverse);
  for (let index = 0; index < 4; index += 1) pointNear(
    index === 0 ? preserved.start : index === 1 ? preserved.control1 : index === 2 ? preserved.control2 : preserved.end,
    expected[index], 0.03
  );

  for (let index = 0; index <= 20; index += 1) {
    const sample = cubicPoint([preserved.start, preserved.control1, preserved.control2, preserved.end], index / 20);
    const nearest = Math.min(...Array.from({ length: 2001 }, (_, sampleIndex) =>
      distance(sample, cubicPoint(original, sampleIndex / 2000))));
    assert.ok(nearest < 0.03, `trimmed cubic sample ${index} left the original curve by ${nearest}`);
  }
});

test('neighboring radii are proportionally clamped to the available edge length', () => {
  const node = square();
  for (const vertex of node.vertices) vertex.cornerRadius = 80;
  const path = vectorNetworkFacePathCommands(node, node.faces[0], { x: node.x, y: node.y });
  assert.ok(path);
  const arcs = path.commands.filter(command => command.type === 'arc');
  assert.equal(arcs.length, 4);
  for (const arc of arcs) near(arc.radius, 50, 1e-7);
  const topEdge = path.commands[0];
  assert.equal(topEdge.type, 'line');
  near(distance(topEdge.start, topEdge.end), 0, 1e-7);
});

test('no-radius faces return null and keep the legacy boundary path untouched', () => {
  const node = square();
  const face = node.faces[0];
  assert.equal(vectorNetworkFacePathCommands(node, face), null);
  assert.equal(vectorNetworkFacePathPoints(node, face), null);
  assert.equal(traceVectorNetworkFacePath({ moveTo() {} }, node, face), false);

  node.vertices[0].cornerRadius = 0;
  node.vertices[1].cornerRadius = -4;
  assert.equal(vectorNetworkFacePathCommands(node, face), null);
});
