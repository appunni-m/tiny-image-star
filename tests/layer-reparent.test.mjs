import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, createDocument, createNode, findNode, serializeDocument, validateDocument
} from '../src/model.js';
import { reparentLayer } from '../src/layer-reparent.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';
import { createAutoLayout } from '../src/layout-engine.js';

function assertPointAlmost(actual, expected) {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `x ${actual.x} should match ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `y ${actual.y} should match ${expected.y}`);
}

test('reparenting moves a layer between containers and preserves its page-space appearance', () => {
  const document = createDocument();
  const source = createNode('frame', { name: 'Source', x: 40, y: 30, width: 240, height: 180 });
  const destination = createNode('section', { name: 'Destination', x: 380, y: 40, width: 280, height: 200 });
  const existing = createNode('ellipse', { name: 'Existing' });
  const child = createNode('rectangle', {
    name: 'Pinned card', x: 26, y: 18, width: 90, height: 52, rotation: 12,
    constraints: { horizontal: 'right', vertical: 'bottom' }
  });
  addNode(document, source); addNode(document, destination);
  addNode(document, existing, { parentId: destination.id });
  addNode(document, child, { parentId: source.id });
  const originalConstraints = structuredClone(child.constraints);
  const originalOrigin = nodeLocalToPage(child, { x: 0, y: 0 }, [source]);
  const originalProperties = { width: child.width, height: child.height, rotation: child.rotation };

  assert.equal(reparentLayer(document, child.id, { parentId: destination.id, index: 0 }), true);
  assert.deepEqual(source.children, []);
  assert.deepEqual(destination.children.map(node => node.id), [child.id, existing.id]);
  assert.equal(findNode(document, child.id).node, child, 'reparenting keeps the same layer identity and object');
  assert.deepEqual(child.constraints, originalConstraints, 'parent constraints remain attached unchanged');
  assert.deepEqual({ width: child.width, height: child.height, rotation: child.rotation }, originalProperties);
  assertPointAlmost(nodeLocalToPage(child, { x: 0, y: 0 }, [destination]), originalOrigin);
  assert.equal(validateDocument(document), true);

  assert.equal(reparentLayer(document, child.id, { parentId: null, index: 1 }), true, 'a layer can be returned to the page');
  assert.deepEqual(document.pages[0].children.map(node => node.id), [source.id, child.id, destination.id]);
  assert.deepEqual(child.constraints, originalConstraints);
  assertPointAlmost(nodeLocalToPage(child, { x: 0, y: 0 }), originalOrigin);
  assert.equal(validateDocument(document), true);
});

test('reparenting preserves geometry through rotated and affine container transforms', () => {
  const document = createDocument();
  const source = createNode('group', { name: 'Rotated source', x: 50, y: 30, width: 180, height: 100, rotation: 23 });
  const destination = createNode('section', {
    name: 'Affine destination', x: 340, y: 80, width: 220, height: 160, rotation: -17,
    affineTransform: { a: 1.2, b: .08, c: -.1, d: .9 }
  });
  const child = createNode('ellipse', { x: 24, y: 36, width: 42, height: 28, rotation: 31 });
  addNode(document, source); addNode(document, destination); addNode(document, child, { parentId: source.id });
  const corners = [{ x: 0, y: 0 }, { x: child.width, y: 0 },
    { x: child.width, y: child.height }, { x: 0, y: child.height }];
  const before = corners.map(point => nodeLocalToPage(child, point, [source]));

  assert.equal(reparentLayer(document, child.id, { parentId: destination.id }), true);
  for (const [index, point] of corners.entries()) assertPointAlmost(nodeLocalToPage(child, point, [destination]), before[index]);
  assert.equal(validateDocument(document), true);
});

test('entering an auto-layout frame preserves page position using absolute positioning', () => {
  const document = createDocument();
  const source = createNode('group', { name: 'Source', x: 180, y: 90, width: 140, height: 90 });
  const destination = createNode('frame', {
    name: 'Auto layout destination', x: 40, y: 20, width: 260, height: 180, rotation: 17,
    autoLayout: createAutoLayout({ axis: 'horizontal', columnGap: 12, padding: 16, mainSizing: 'hug', crossSizing: 'hug' })
  });
  const existing = createNode('rectangle', { x: 16, y: 16, width: 48, height: 48 });
  const child = createNode('rectangle', { x: 38, y: 44, width: 60, height: 40 });
  addNode(document, source); addNode(document, destination);
  addNode(document, existing, { parentId: destination.id });
  addNode(document, child, { parentId: source.id });
  const before = nodeLocalToPage(child, { x: 0, y: 0 }, [source]);

  assert.equal(reparentLayer(document, child.id, { parentId: destination.id }), true);
  assert.equal(child.layoutPositioning, 'absolute');
  assert.equal(destination.width, 80, 'the destination Hug frame still recomputes its content size');
  assertPointAlmost(nodeLocalToPage(child, { x: 0, y: 0 }, [destination]), before);
  assert.equal(validateDocument(document), true);
});

test('reparent rejects missing, locked, same-parent, non-container, and cyclic targets without mutation', () => {
  const document = createDocument();
  const outer = createNode('frame', { name: 'Outer' });
  const inner = createNode('group', { name: 'Inner' });
  const leaf = createNode('rectangle', { name: 'Leaf' });
  const destination = createNode('frame', { name: 'Destination' });
  const locked = createNode('frame', { name: 'Locked destination', locked: true });
  const lockedLeaf = createNode('ellipse', { name: 'Locked leaf', locked: true });
  addNode(document, outer); addNode(document, destination); addNode(document, locked);
  addNode(document, inner, { parentId: outer.id });
  addNode(document, leaf, { parentId: inner.id });
  addNode(document, lockedLeaf, { parentId: outer.id });
  const before = serializeDocument(document);

  assert.equal(reparentLayer(document, 'missing-layer', { parentId: destination.id }), false);
  assert.equal(reparentLayer(document, leaf.id, { parentId: 'missing-parent' }), false);
  assert.equal(reparentLayer(document, leaf.id, { parentId: inner.id }), false, 'the current parent is not a reparent operation');
  assert.equal(reparentLayer(document, outer.id, { parentId: leaf.id }), false, 'a leaf cannot contain layers');
  assert.equal(reparentLayer(document, outer.id, { parentId: inner.id }), false, 'a layer cannot enter its descendant');
  assert.equal(reparentLayer(document, leaf.id, { parentId: locked.id }), false, 'locked destination layers reject drops');
  assert.equal(reparentLayer(document, lockedLeaf.id, { parentId: destination.id }), false, 'locked source layers cannot move');
  leaf.variableBindings = { x: 'position-x' };
  assert.equal(reparentLayer(document, leaf.id, { parentId: destination.id }), false, 'mode-bound x/y cannot be rewritten to preserve position');
  delete leaf.variableBindings;
  assert.equal(serializeDocument(document), before, 'all rejected moves leave the complete design unchanged');
});

test('model-rejected reparent operations preserve source and destination arrays atomically', () => {
  const document = createDocument();
  const source = createNode('frame', { name: 'Source' });
  const destination = createNode('frame', { name: 'Destination' });
  const child = createNode('rectangle', { name: 'Child' });
  const slice = createNode('slice', { name: 'Export region' });
  addNode(document, source); addNode(document, destination); addNode(document, child, { parentId: source.id }); addNode(document, slice);

  const beforeBadIndex = serializeDocument(document);
  assert.throws(() => reparentLayer(document, child.id, { parentId: destination.id, index: '1.5' }), /order index must be an integer/);
  assert.equal(serializeDocument(document), beforeBadIndex, 'invalid insertion indexes are rejected before detaching the source');

  const beforeSliceMove = serializeDocument(document);
  assert.equal(reparentLayer(document, slice.id, { parentId: destination.id }), false,
    'the model placement rule rejects slices as container children');
  assert.equal(serializeDocument(document), beforeSliceMove, 'model placement rules reject a slice move without partial mutation');

  assert.equal(reparentLayer(document, child.id, { parentId: destination.id }), true);
  assert.deepEqual(source.children, []);
  assert.deepEqual(destination.children.map(node => node.id), [child.id]);
  assert.equal(validateDocument(document), true);
});
