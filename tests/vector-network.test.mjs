import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendVectorNetworkPath, insertVectorNetworkPoint, setVectorNetworkEdgeControlPoint,
  removeVectorNetworkVertex, setVectorNetworkVertexPoint, vectorNetworkEdgePoints, vectorNetworkGeometryFromAnchors,
  vectorNetworkVertexPoint
} from '../src/vector-path.js';
import {
  addNode, canCombineBoolean, canCreateMaskGroup, combineBoolean, createDocument, createMaskGroup,
  createNode, parseDocument, serializeDocument
} from '../src/model.js';

function evaluate(points, t) {
  const inverse = 1 - t; const [p0, p1, p2, p3] = points;
  return {
    x: inverse ** 3 * p0.x + 3 * inverse ** 2 * t * p1.x + 3 * inverse * t ** 2 * p2.x + t ** 3 * p3.x,
    y: inverse ** 3 * p0.y + 3 * inverse ** 2 * t * p1.y + 3 * inverse * t ** 2 * p2.y + t ** 3 * p3.y
  };
}

test('pen geometry stores open and closed strokes as a connected network with shared junctions', () => {
  const network = vectorNetworkGeometryFromAnchors([
    { x: 10, y: 20, in: { x: 10, y: 20 }, out: { x: 10, y: 20 } },
    { x: 90, y: 20, in: { x: 90, y: 20 }, out: { x: 90, y: 20 } },
    { x: 50, y: 80, in: { x: 50, y: 80 }, out: { x: 50, y: 80 } }
  ], { closed: true });
  assert.equal(network.vertices.length, 3);
  assert.equal(network.edges.length, 3);
  assert.equal(network.faces.length, 1);
  assert.deepEqual(network.faces[0].vertexIds, network.vertices.map(vertex => vertex.id));

  const document = createDocument();
  const node = createNode('network', network);
  addNode(document, node);
  const open = createNode('network', vectorNetworkGeometryFromAnchors([{ x: 0, y: 0 }, { x: 20, y: 10 }]));
  const rectangle = createNode('rectangle');
  const image = createNode('image');
  addNode(document, open);
  addNode(document, rectangle);
  addNode(document, image);
  assert.equal(canCombineBoolean(document, [node.id, rectangle.id]), true);
  assert.equal(canCombineBoolean(document, [open.id, rectangle.id]), false);
  const maskDocument = createDocument();
  const maskImage = createNode('image');
  const maskNetwork = createNode('network', network);
  addNode(maskDocument, maskImage);
  addNode(maskDocument, maskNetwork);
  assert.equal(canCreateMaskGroup(maskDocument, [maskImage.id, maskNetwork.id]), true);
  const maskGroup = createMaskGroup(maskDocument, [maskImage.id, maskNetwork.id]);
  assert.equal(maskGroup.maskSourceId, maskNetwork.id);
  assert.equal(parseDocument(serializeDocument(maskDocument)).pages[0].children[0].maskSourceId, maskNetwork.id);
  const openMask = createNode('network', vectorNetworkGeometryFromAnchors([{ x: 0, y: 0 }, { x: 20, y: 10 }]));
  addNode(maskDocument, openMask);
  assert.equal(canCreateMaskGroup(maskDocument, [maskImage.id, openMask.id]), false);
  const restored = parseDocument(serializeDocument(document));
  assert.deepEqual(restored.pages[0].children[0].edges, network.edges);
  assert.equal(restored.pages[0].children[0].faces.length, 1);
  const booleanDocument = createDocument();
  const booleanNetwork = createNode('network', network);
  const booleanRectangle = createNode('rectangle');
  addNode(booleanDocument, booleanNetwork);
  addNode(booleanDocument, booleanRectangle);
  const booleanGroup = combineBoolean(booleanDocument, [booleanNetwork.id, booleanRectangle.id]);
  assert.equal(booleanGroup.type, 'boolean');
  assert.ok(booleanGroup.children.some(child => child.type === 'network' && child.faces.length === 1));
});

test('a new stroke can branch from two existing junctions without duplicating either vertex', () => {
  const network = vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }
  ]);
  const origin = { x: network.x, y: network.y };
  const firstId = network.vertices[0].id;
  const middleId = network.vertices[1].id;
  const middle = vectorNetworkVertexPoint(network, middleId, origin);
  const result = appendVectorNetworkPath(network, [
    { ...middle, vertexId: middleId }, { x: 110, y: 70 }, { ...origin, vertexId: firstId }
  ], origin);
  assert.deepEqual(result, { addedEdges: 2, addedVertices: 1 });
  assert.equal(network.vertices.length, 4);
  assert.equal(network.edges.length, 4);
  assert.ok(network.edges.some(edge => edge.from === middleId));
  assert.ok(network.edges.some(edge => edge.to === firstId));
});

test('extending a rotated network preserves existing junction positions around its rotation center', () => {
  const network = vectorNetworkGeometryFromAnchors([{ x: 20, y: 30 }, { x: 110, y: 35 }, { x: 55, y: 100 }]);
  network.rotation = 31;
  const origin = { x: network.x, y: network.y };
  const center = { x: origin.x + network.width / 2, y: origin.y + network.height / 2 };
  const rotate = point => {
    const angle = network.rotation * Math.PI / 180; const dx = point.x - center.x; const dy = point.y - center.y;
    return { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  };
  const before = new Map(network.vertices.map(vertex => [vertex.id, rotate(vectorNetworkVertexPoint(network, vertex.id, origin))]));
  const first = vectorNetworkVertexPoint(network, network.vertices[0].id, origin);
  assert.ok(appendVectorNetworkPath(network, [{ ...first, vertexId: network.vertices[0].id }, { x: -80, y: -95 }], origin));
  const nextOrigin = { x: network.x, y: network.y };
  const nextCenter = { x: nextOrigin.x + network.width / 2, y: nextOrigin.y + network.height / 2 };
  assert.ok(Math.hypot(center.x - nextCenter.x, center.y - nextCenter.y) < 1e-8);
  for (const [vertexId, expected] of before) {
    const actual = rotate(vectorNetworkVertexPoint(network, vertexId, nextOrigin));
    assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-8, `rotated point ${vertexId} shifted`);
  }
});

test('splitting a curved network edge preserves every rendered point on the original cubic', () => {
  const network = vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0, in: { x: 0, y: 0 }, out: { x: 28, y: -70 } },
    { x: 100, y: 10, in: { x: 82, y: 85 }, out: { x: 100, y: 10 } }
  ]);
  const origin = { x: network.x, y: network.y };
  const before = vectorNetworkEdgePoints(network, network.edges[0].id, origin);
  const inserted = insertVectorNetworkPoint(network, network.edges[0].id, .37, origin);
  assert.ok(inserted);
  const first = vectorNetworkEdgePoints(network, network.edges[0].id, origin);
  const second = vectorNetworkEdgePoints(network, network.edges[1].id, origin);
  for (let index = 0; index <= 100; index += 1) {
    const t = index / 100;
    const expected = evaluate(before, t);
    const actual = t <= .37 ? evaluate(first, t / .37) : evaluate(second, (t - .37) / .63);
    assert.ok(Math.hypot(expected.x - actual.x, expected.y - actual.y) < 1e-8, `curve changed at t=${t}`);
  }
  const splitDocument = createDocument();
  const splitNode = createNode('network', network);
  addNode(splitDocument, splitNode);
  const restoredSplit = parseDocument(serializeDocument(splitDocument)).pages[0].children[0];
  assert.deepEqual(restoredSplit.vertices.find(vertex => vertex.id === inserted).split, network.vertices.find(vertex => vertex.id === inserted).split);
  assert.equal(removeVectorNetworkVertex(network, inserted), true);
  assert.equal(network.vertices.length, 2);
  assert.equal(network.edges.length, 1);
  assert.deepEqual(network.edges[0], { id: 'e1', from: 'v1', to: 'v2', control1: { x: .28, y: 0 }, control2: { x: .82, y: 1 } });
  assert.deepEqual(vectorNetworkEdgePoints(network, network.edges[0].id, origin), before);
});

test('resizing a network preserves exact split-point restoration metadata', () => {
  const network = vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0, in: { x: 0, y: 0 }, out: { x: 28, y: -70 } },
    { x: 100, y: 10, in: { x: 82, y: 85 }, out: { x: 100, y: 10 } }
  ]);
  const origin = { x: network.x, y: network.y };
  const original = vectorNetworkEdgePoints(network, network.edges[0].id, origin);
  const inserted = insertVectorNetworkPoint(network, network.edges[0].id, .37, origin);
  const branchStart = vectorNetworkVertexPoint(network, network.vertices[0].id, origin);
  assert.ok(appendVectorNetworkPath(network, [{ ...branchStart, vertexId: network.vertices[0].id }, { x: -100, y: -120 }], origin));
  const nextOrigin = { x: network.x, y: network.y };
  assert.equal(removeVectorNetworkVertex(network, inserted), true);
  const restored = vectorNetworkEdgePoints(network, 'e1', nextOrigin);
  for (let index = 0; index < original.length; index += 1) {
    assert.ok(Math.hypot(original[index].x - restored[index].x, original[index].y - restored[index].y) < 1e-8);
  }
});

test('network junction moves and per-edge controls remain independently editable', () => {
  const network = vectorNetworkGeometryFromAnchors([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }]);
  const origin = { x: network.x, y: network.y };
  const shared = network.vertices[1].id;
  const edgeId = network.edges[0].id;
  assert.equal(setVectorNetworkVertexPoint(network, shared, { x: 120, y: 5 }, origin), true);
  assert.deepEqual(vectorNetworkEdgePoints(network, edgeId, origin)[3], { x: 120, y: 5 });
  assert.equal(setVectorNetworkEdgeControlPoint(network, edgeId, 'control1', { x: 34, y: -20 }, origin), true);
  assert.deepEqual(vectorNetworkEdgePoints(network, edgeId, origin)[1], { x: 34, y: -20 });
  assert.equal(setVectorNetworkEdgeControlPoint(network, network.edges[1].id, 'control1', { x: NaN, y: 0 }, origin), false);
});

test('deleting a moved split point preserves graph connectivity without restoring stale curve metadata', () => {
  const network = vectorNetworkGeometryFromAnchors([{ x: 0, y: 0 }, { x: 120, y: 0 }]);
  const origin = { x: network.x, y: network.y };
  const vertexId = insertVectorNetworkPoint(network, network.edges[0].id, .5, origin);
  assert.equal(setVectorNetworkVertexPoint(network, vertexId, { x: 62, y: 12 }, origin), true);
  assert.equal(network.vertices.find(vertex => vertex.id === vertexId).split, undefined);
  assert.equal(removeVectorNetworkVertex(network, vertexId), true);
  assert.equal(network.vertices.length, 2);
  assert.equal(network.edges.length, 1);
  assert.deepEqual(new Set([network.edges[0].from, network.edges[0].to]), new Set(['v1', 'v2']));
});

test('network validation rejects dangling edges, malformed faces, and duplicate graph identities', () => {
  const document = createDocument();
  const network = createNode('network', vectorNetworkGeometryFromAnchors([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 40, y: 70 }], { closed: true }));
  network.edges[0].to = 'missing';
  addNode(document, network);
  assert.throws(() => serializeDocument(document), /Invalid vector network/);

  const valid = createDocument();
  const duplicate = createNode('network', vectorNetworkGeometryFromAnchors([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 40, y: 70 }], { closed: true }));
  duplicate.vertices[1].id = duplicate.vertices[0].id;
  addNode(valid, duplicate);
  assert.throws(() => serializeDocument(valid), /Invalid vector network/);
});
