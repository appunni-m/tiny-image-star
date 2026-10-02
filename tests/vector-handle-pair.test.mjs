import test from 'node:test';
import assert from 'node:assert/strict';
import {
  vectorGeometryFromAnchors, vectorNetworkEdgePoints, vectorNetworkGeometryFromAnchors,
  vectorNodePoint, vectorControlPairSnapshot, translateVectorControlPair
} from '../src/vector-path.js';

function makePath() {
  return {
    id: 'path-1', type: 'path', ...vectorGeometryFromAnchors([
      { x: 10, y: 20, out: { x: 20, y: 25 } },
      { x: 70, y: 60, in: { x: 60, y: 55 }, out: { x: 82, y: 48 } },
      { x: 100, y: 18, in: { x: 91, y: 22 } }
    ])
  };
}

function makeNetwork() {
  return {
    id: 'network-1', type: 'network', ...vectorNetworkGeometryFromAnchors([
      { x: 0, y: 0 },
      { x: 50, y: 30, in: { x: 39, y: 21 }, out: { x: 66, y: 35 } },
      { x: 100, y: 0, in: { x: 88, y: 8 } }
    ])
  };
}

const localOrigin = { x: 0, y: 0 };

test('Shift-dragging a path handle moves both anchor handles by the same local delta', () => {
  const node = makePath();
  const before = ['in', 'out'].map(part => vectorNodePoint(node, 1, part, localOrigin));
  const anchorBefore = vectorNodePoint(node, 1, 'anchor', localOrigin);
  const snapshot = vectorControlPairSnapshot(node, { part: 'out', index: 1, contourIndex: 0 }, node, {
    shiftKey: true, origin: localOrigin
  });

  assert.ok(snapshot);
  assert.equal(vectorControlPairSnapshot(node, { part: 'out', index: 1 }, node, { shiftKey: false }), null,
    'the pair gesture is only armed while Shift is held');
  assert.equal(translateVectorControlPair(node, snapshot, { x: 8, y: -6 }), 2);
  const after = ['in', 'out'].map(part => vectorNodePoint(node, 1, part, localOrigin));
  assert.deepEqual(after, before.map(point => ({ x: point.x + 8, y: point.y - 6 })));
  assert.deepEqual(vectorNodePoint(node, 1, 'anchor', localOrigin), anchorBefore);
});

test('Shift-dragging a network handle translates the two controls at its degree-two vertex', () => {
  const node = makeNetwork();
  const beforeIncoming = vectorNetworkEdgePoints(node, 'e1', localOrigin)[2];
  const beforeOutgoing = vectorNetworkEdgePoints(node, 'e2', localOrigin)[1];
  const snapshot = vectorControlPairSnapshot(node, { part: 'control2', edgeId: 'e1' }, node, {
    shiftKey: true, origin: localOrigin
  });

  assert.equal(snapshot?.vertexId, 'v2');
  assert.equal(translateVectorControlPair(node, snapshot, { x: -5, y: 11 }), 2);
  const afterIncoming = vectorNetworkEdgePoints(node, 'e1', localOrigin)[2];
  const afterOutgoing = vectorNetworkEdgePoints(node, 'e2', localOrigin)[1];
  assert.deepEqual(afterIncoming, { x: beforeIncoming.x - 5, y: beforeIncoming.y + 11 });
  assert.deepEqual(afterOutgoing, { x: beforeOutgoing.x - 5, y: beforeOutgoing.y + 11 });
});

test('Shift handle pairing refuses branches and stale inputs without partial mutation', () => {
  const branched = makeNetwork();
  branched.vertices.push({ id: 'v4', x: .5, y: .75 });
  branched.edges.push({ id: 'e3', from: 'v2', to: 'v4', control1: null, control2: null });
  assert.equal(vectorControlPairSnapshot(branched, { part: 'control2', edgeId: 'e1' }, branched, {
    shiftKey: true, origin: localOrigin
  }), null, 'branched vertices retain independent handle editing');

  const path = makePath();
  const snapshot = vectorControlPairSnapshot(path, { part: 'out', index: 1 }, path, {
    shiftKey: true, origin: localOrigin
  });
  const before = structuredClone(path);
  assert.equal(translateVectorControlPair(path, { ...snapshot, nodeId: 'other' }, { x: 2, y: 3 }), false);
  assert.deepEqual(path, before, 'a stale control identity cannot mutate the path');
  assert.equal(translateVectorControlPair(path, snapshot, { x: Infinity, y: 3 }), false);
  assert.deepEqual(path, before, 'non-finite movement is rejected before writing either handle');
});
