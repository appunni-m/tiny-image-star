import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, parseDocument, serializeDocument } from '../src/model.js';
import {
  appendVectorNetworkPath, getVectorNetworkVertexMode, setVectorNetworkEdgeControlPoint,
  setVectorNetworkVertexMode, setVectorNetworkVertexPoint, vectorNetworkEdgePoints, vectorNetworkGeometryFromAnchors,
  vectorNetworkVertexPoint
} from '../src/vector-path.js';

const origin = { x: 0, y: 0 };

function curvedChain() {
  return vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0 },
    { x: 50, y: 30, in: { x: 36, y: 30 }, out: { x: 82, y: 30 } },
    { x: 100, y: 0, in: { x: 100, y: 0 } }
  ]);
}

function handleVector(node, vertexId, edgeId, part, at = origin) {
  const anchor = vectorNetworkVertexPoint(node, vertexId, at);
  const points = vectorNetworkEdgePoints(node, edgeId, at);
  const control = points[part === 'control1' ? 1 : 2];
  return { x: control.x - anchor.x, y: control.y - anchor.y };
}

function assertOpposingCollinear(left, right) {
  const cross = left.x * right.y - left.y * right.x;
  const dot = left.x * right.x + left.y * right.y;
  assert.ok(Math.abs(cross) < 1e-8, `handles should share a tangent (cross product ${cross})`);
  assert.ok(dot < 0, `handles should point in opposite directions (dot product ${dot})`);
}

test('network anchor modes are optional, persisted, and default legacy vertices to Corner', () => {
  const geometry = vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0 }, { x: 50, y: 0, mode: 'smooth' }, { x: 100, y: 0, mode: 'symmetric' }
  ]);
  assert.equal(getVectorNetworkVertexMode(geometry, 'v1'), 'corner');
  assert.equal(getVectorNetworkVertexMode(geometry, 'v2'), 'smooth');
  assert.equal(getVectorNetworkVertexMode(geometry, 'v3'), 'symmetric');
  assert.equal(getVectorNetworkVertexMode(geometry, 'missing'), null);

  const document = createDocument();
  addNode(document, createNode('network', geometry));
  const restored = parseDocument(serializeDocument(document)).pages[0].children[0];
  assert.equal(restored.vertices[1].mode, 'smooth');
  assert.equal(restored.vertices[2].mode, 'symmetric');
  assert.equal(restored.vertices[0].mode, undefined, 'legacy corner mode stays implicit in storage.');
});

test('Smooth mode aligns a degree-two vertex while preserving the paired handle length', () => {
  const node = curvedChain();
  const incomingBefore = handleVector(node, 'v2', 'e1', 'control2');
  const outgoingBefore = handleVector(node, 'v2', 'e2', 'control1');
  const outgoingLength = Math.hypot(outgoingBefore.x, outgoingBefore.y);

  assert.equal(setVectorNetworkVertexMode(node, 'v2', 'smooth'), true);
  const incoming = handleVector(node, 'v2', 'e1', 'control2');
  const outgoing = handleVector(node, 'v2', 'e2', 'control1');
  assert.equal(getVectorNetworkVertexMode(node, 'v2'), 'smooth');
  assertOpposingCollinear(incoming, outgoing);
  assert.ok(Math.abs(Math.hypot(outgoing.x, outgoing.y) - outgoingLength) < 1e-8,
    'mode assignment should keep the handle opposite the chosen/master handle at its old length.');

  const movedControl = vectorNetworkVertexPoint(node, 'v2', origin);
  const target = { x: movedControl.x + 18, y: movedControl.y + 12 };
  assert.equal(setVectorNetworkEdgeControlPoint(node, 'e2', 'control1', target, origin), true);
  assertOpposingCollinear(
    handleVector(node, 'v2', 'e1', 'control2'),
    handleVector(node, 'v2', 'e2', 'control1')
  );
  assert.ok(Math.abs(Math.hypot(...Object.values(handleVector(node, 'v2', 'e1', 'control2'))) - Math.hypot(incoming.x, incoming.y)) < 1e-8,
    'dragging in Smooth mode should retain the paired handle length.');
});

test('Symmetric mode mirrors equal-length handles when set and during either-side drags', () => {
  const node = curvedChain();
  assert.equal(setVectorNetworkVertexMode(node, 'v2', 'symmetric', { preferredEdgeId: 'e2' }), true);
  let incoming = handleVector(node, 'v2', 'e1', 'control2');
  let outgoing = handleVector(node, 'v2', 'e2', 'control1');
  assertOpposingCollinear(incoming, outgoing);
  assert.ok(Math.abs(Math.hypot(incoming.x, incoming.y) - Math.hypot(outgoing.x, outgoing.y)) < 1e-8);

  const anchor = vectorNetworkVertexPoint(node, 'v2', origin);
  assert.equal(setVectorNetworkEdgeControlPoint(node, 'e1', 'control2', { x: anchor.x - 9, y: anchor.y + 24 }, origin), true);
  incoming = handleVector(node, 'v2', 'e1', 'control2');
  outgoing = handleVector(node, 'v2', 'e2', 'control1');
  assertOpposingCollinear(incoming, outgoing);
  assert.ok(Math.abs(Math.hypot(incoming.x, incoming.y) - Math.hypot(outgoing.x, outgoing.y)) < 1e-8,
    'dragging either side should mirror its exact vector.');
});

test('Corner mode preserves geometry and returns the two controls to independent editing', () => {
  const node = curvedChain();
  assert.equal(setVectorNetworkVertexMode(node, 'v2', 'smooth'), true);
  const incomingBeforeCorner = vectorNetworkEdgePoints(node, 'e1', origin)[2];
  assert.equal(setVectorNetworkVertexMode(node, 'v2', 'corner'), true);
  assert.deepEqual(vectorNetworkEdgePoints(node, 'e1', origin)[2], incomingBeforeCorner,
    'choosing Corner should not reshape the current outline.');

  const anchor = vectorNetworkVertexPoint(node, 'v2', origin);
  assert.equal(setVectorNetworkEdgeControlPoint(node, 'e2', 'control1', { x: anchor.x + 8, y: anchor.y + 19 }, origin), true);
  assert.deepEqual(vectorNetworkEdgePoints(node, 'e1', origin)[2], incomingBeforeCorner,
    'a Corner handle drag should leave the other side untouched.');
  assert.equal(getVectorNetworkVertexMode(node, 'v2'), 'corner');
});

for (const mode of ['smooth', 'symmetric']) {
  test(`moving a ${mode} degree-two vertex preserves both handle vectors`, () => {
    const node = curvedChain();
    assert.equal(setVectorNetworkVertexMode(node, 'v2', mode), true);
    const beforeIncoming = handleVector(node, 'v2', 'e1', 'control2');
    const beforeOutgoing = handleVector(node, 'v2', 'e2', 'control1');
    const beforeAnchor = vectorNetworkVertexPoint(node, 'v2', origin);
    const movedAnchor = { x: beforeAnchor.x + 17, y: beforeAnchor.y - 11 };

    assert.equal(setVectorNetworkVertexPoint(node, 'v2', movedAnchor, origin), true);
    assert.deepEqual(vectorNetworkVertexPoint(node, 'v2', origin), movedAnchor);
    const afterIncoming = handleVector(node, 'v2', 'e1', 'control2');
    const afterOutgoing = handleVector(node, 'v2', 'e2', 'control1');
    assert.deepEqual(afterIncoming, beforeIncoming, 'incoming control should keep its exact vector relative to the moved anchor.');
    assert.deepEqual(afterOutgoing, beforeOutgoing, 'outgoing control should keep its exact vector relative to the moved anchor.');
    assertOpposingCollinear(afterIncoming, afterOutgoing);
    if (mode === 'symmetric') {
      assert.ok(Math.abs(Math.hypot(afterIncoming.x, afterIncoming.y) - Math.hypot(afterOutgoing.x, afterOutgoing.y)) < 1e-8);
    }
  });
}

test('endpoint modes persist but do not invent a paired handle', () => {
  const node = vectorNetworkGeometryFromAnchors([{ x: 0, y: 0 }, { x: 80, y: 0 }]);
  assert.equal(setVectorNetworkVertexMode(node, 'v1', 'symmetric'), true);
  assert.equal(setVectorNetworkEdgeControlPoint(node, 'e1', 'control1', { x: 22, y: 17 }, origin), true);
  assert.equal(node.edges[0].control2, null);
  assert.equal(getVectorNetworkVertexMode(node, 'v1'), 'symmetric');
});

test('extending a network keeps an explicitly supplied mode on a new vertex', () => {
  const node = curvedChain();
  const at = { x: node.x, y: node.y };
  const start = vectorNetworkVertexPoint(node, 'v2', at);
  assert.deepEqual(appendVectorNetworkPath(node, [
    { ...start, vertexId: 'v2' }, { x: start.x + 25, y: start.y + 35, mode: 'smooth' }
  ], at), { addedEdges: 1, addedVertices: 1 });
  assert.equal(getVectorNetworkVertexMode(node, 'v4'), 'smooth');

  const before = structuredClone(node);
  assert.equal(appendVectorNetworkPath(node, [
    { x: 0, y: 0 }, { x: 20, y: 20, mode: 'almost-smooth' }
  ], at), false);
  assert.deepEqual(node, before, 'an invalid mode must be rejected before changing the network.');
});

test('degree-three junction handles stay independent even when a mode is persisted', () => {
  const node = curvedChain();
  const junction = vectorNetworkVertexPoint(node, 'v2', { x: node.x, y: node.y });
  assert.deepEqual(appendVectorNetworkPath(node, [
    { ...junction, vertexId: 'v2' }, { x: junction.x + 12, y: junction.y + 42 }
  ], { x: node.x, y: node.y }), { addedEdges: 1, addedVertices: 1 });

  const at = { x: node.x, y: node.y };
  const priorHandles = [
    ['e1', 'control2'], ['e2', 'control1'], ['e3', 'control1']
  ].map(([edgeId, part]) => vectorNetworkEdgePoints(node, edgeId, at)[part === 'control1' ? 1 : 2]);
  assert.equal(setVectorNetworkVertexMode(node, 'v2', 'symmetric'), true);
  const afterMode = [
    ['e1', 'control2'], ['e2', 'control1'], ['e3', 'control1']
  ].map(([edgeId, part]) => vectorNetworkEdgePoints(node, edgeId, at)[part === 'control1' ? 1 : 2]);
  assert.deepEqual(afterMode, priorHandles, 'mode changes at branches must not couple existing handles.');

  const branchAnchor = vectorNetworkVertexPoint(node, 'v2', at);
  assert.equal(setVectorNetworkEdgeControlPoint(node, 'e1', 'control2', {
    x: branchAnchor.x - 13, y: branchAnchor.y - 20
  }, at), true);
  const controlsAfterDrag = [
    ['e1', 'control2'], ['e2', 'control1'], ['e3', 'control1']
  ].map(([edgeId, part]) => vectorNetworkEdgePoints(node, edgeId, at)[part === 'control1' ? 1 : 2]);
  assert.notDeepEqual(controlsAfterDrag[0], priorHandles[0], 'the actively dragged control should move.');
  assert.deepEqual(controlsAfterDrag.slice(1), priorHandles.slice(1),
    'the other branch handles should remain independent.');
});

test('invalid mode or handle requests leave vector data unchanged', () => {
  assert.throws(() => vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0, mode: 'almost-smooth' }, { x: 20, y: 10 }
  ]), /anchor modes must be corner, smooth, or symmetric/);

  const node = curvedChain();
  const before = structuredClone(node);
  assert.equal(setVectorNetworkVertexMode(node, 'v2', 'almost-smooth'), false);
  assert.equal(setVectorNetworkVertexMode(node, 'v2', 'smooth', { preferredEdgeId: 'absent' }), false);
  assert.equal(setVectorNetworkVertexMode(node, 'missing', 'smooth'), false);
  assert.equal(setVectorNetworkEdgeControlPoint(node, 'e1', 'anchor', { x: 1, y: 2 }, origin), false);
  assert.equal(setVectorNetworkEdgeControlPoint(node, 'e1', 'control1', { x: NaN, y: 2 }, origin), false);
  assert.deepEqual(node, before);
});
