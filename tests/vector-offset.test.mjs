import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addNode, createDocument, createNode, validateDocument } from '../src/model.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';
import { offsetVectorPath, VectorOffsetError } from '../src/vector-offset.js';

const editorSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

const rectangle = (overrides = {}) => createNode('path', {
  name: 'Offset source', x: 20, y: 30, width: 100, height: 50, closed: true,
  fillRule: 'nonzero', points: [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }
  ],
  ...overrides
});

function contourBounds(points, width, height, x = 0, y = 0) {
  const values = points.map(value => ({ x: x + value.x * width, y: y + value.y * height }));
  return {
    left: Math.min(...values.map(value => value.x)),
    top: Math.min(...values.map(value => value.y)),
    right: Math.max(...values.map(value => value.x)),
    bottom: Math.max(...values.map(value => value.y))
  };
}

test('positive and negative offsets expand or contract a closed path in local pixels', () => {
  const source = rectangle();
  const expanded = offsetVectorPath(source, 10, 'square');
  const contracted = offsetVectorPath(source, -10, 'square');
  assert.deepEqual([expanded.x, expanded.y, expanded.width, expanded.height], [10, 20, 120, 70]);
  assert.deepEqual([contracted.x, contracted.y, contracted.width, contracted.height], [30, 40, 80, 30]);
  assert.deepEqual(expanded.points.map(({ x, y }) => [x, y]), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  assert.deepEqual(contracted.points.map(({ x, y }) => [x, y]), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  assert.equal(source.x, 20, 'the source node must remain unchanged until the caller commits the edit');
});

test('round joins create editable cubic corners while square joins keep sharp corners', () => {
  const source = rectangle();
  const square = offsetVectorPath(source, 10, 'square');
  const round = offsetVectorPath(source, 10, 'round');
  assert.equal(square.points.length, 4);
  assert.equal(round.points.length, 8);
  assert.ok(round.points.some(value => Math.hypot(value.in.x, value.in.y) > 0 || Math.hypot(value.out.x, value.out.y) > 0));
  assert.deepEqual(contourBounds(round.points, round.width, round.height), { left: 0, top: 0, right: 120, bottom: 70 });
});

test('offset retains even-odd holes and applies the signed distance to each filled boundary', () => {
  const source = rectangle({
    width: 100, height: 100, fillRule: 'evenodd',
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    subpaths: [{ closed: true, points: [
      { x: .25, y: .25 }, { x: .25, y: .75 }, { x: .75, y: .75 }, { x: .75, y: .25 }
    ] }]
  });
  const expanded = offsetVectorPath(source, 10, 'square');
  const hole = contourBounds(expanded.subpaths[0].points, expanded.width, expanded.height, expanded.x, expanded.y);
  assert.equal(expanded.fillRule, 'evenodd');
  assert.deepEqual([hole.left, hole.top, hole.right, hole.bottom], [55, 65, 85, 95]);
  const contracted = offsetVectorPath(source, -10, 'square');
  const enlargedHole = contourBounds(contracted.subpaths[0].points, contracted.width, contracted.height, contracted.x, contracted.y);
  assert.deepEqual([enlargedHole.left, enlargedHole.top, enlargedHole.right, enlargedHole.bottom], [35, 45, 105, 115]);
});

test('nonzero-winding holes offset inward and same-winding internal contours fail closed', () => {
  const hole = rectangle({
    width: 100, height: 100, fillRule: 'nonzero',
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    subpaths: [{ closed: true, points: [
      { x: .25, y: .25 }, { x: .25, y: .75 }, { x: .75, y: .75 }, { x: .75, y: .25 }
    ] }]
  });
  const expanded = offsetVectorPath(hole, 10, 'square');
  const innerBounds = contourBounds(expanded.subpaths[0].points, expanded.width, expanded.height, expanded.x, expanded.y);
  assert.deepEqual([innerBounds.left, innerBounds.top, innerBounds.right, innerBounds.bottom], [55, 65, 85, 95]);
  const ambiguous = { ...hole, subpaths: [{ closed: true, points: [
    { x: .25, y: .25 }, { x: .75, y: .25 }, { x: .75, y: .75 }, { x: .25, y: .75 }
  ] }] };
  assert.throws(() => offsetVectorPath(ambiguous, 10), /no unambiguous filled side/);
});

test('large offsets cannot invert the nesting order of holes and outer contours', () => {
  const ring = rectangle({
    width: 100, height: 100, fillRule: 'evenodd',
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    subpaths: [{ closed: true, points: [
      { x: .2, y: .2 }, { x: .2, y: .8 }, { x: .8, y: .8 }, { x: .8, y: .2 }
    ] }]
  });
  assert.throws(() => offsetVectorPath(ring, -30), /changes which contours contain each other/);
});

test('cubic paths are flattened to bounded-error editable points before offsetting', () => {
  const source = createNode('path', {
    width: 100, height: 100, closed: true,
    points: [
      { x: .5, y: 0, in: { x: -.276142, y: 0 }, out: { x: .276142, y: 0 } },
      { x: 1, y: .5, in: { x: 0, y: -.276142 }, out: { x: 0, y: .276142 } },
      { x: .5, y: 1, in: { x: .276142, y: 0 }, out: { x: -.276142, y: 0 } },
      { x: 0, y: .5, in: { x: 0, y: .276142 }, out: { x: 0, y: -.276142 } }
    ]
  });
  const result = offsetVectorPath(source, 6, 'round');
  assert.ok(result.points.length > 16, `expected a detailed editable curve, received ${result.points.length} anchors`);
  assert.ok(result.points.every(value => [value.x, value.y, value.in.x, value.in.y, value.out.x, value.out.y].every(Number.isFinite)));
});

test('reframing an offset preserves page placement under rotation and affine transforms', () => {
  const source = rectangle({
    rotation: 37,
    affineTransform: { a: 1.2, b: .1, c: -.2, d: .9, e: 0, f: 0 }
  });
  const result = offsetVectorPath(source, 10, 'square');
  const oldPosition = nodeLocalToPage(source, { x: 20, y: 15 });
  const newPosition = nodeLocalToPage({ ...source, ...result }, { x: 30, y: 25 });
  assert.ok(Math.hypot(oldPosition.x - newPosition.x, oldPosition.y - newPosition.y) < 1e-8,
    'the shifted local origin must preserve the path transform');
});

test('invalid, open, self-intersecting, and topology-collapsing offsets fail without mutation', () => {
  const source = rectangle();
  const snapshot = structuredClone(source);
  assert.throws(() => offsetVectorPath(source, 0), VectorOffsetError);
  assert.throws(() => offsetVectorPath(source, NaN), VectorOffsetError);
  assert.throws(() => offsetVectorPath({ ...source, closed: false }, 5), /Close every vector contour/);
  assert.throws(() => offsetVectorPath(rectangle({ points: [
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }
  ] }), 5), /intersecting contours/);
  assert.throws(() => offsetVectorPath(source, -30), /collapses or reverses/);
  assert.deepEqual(source, snapshot);
});

test('the resulting geometry remains valid in a saved design document', () => {
  const document = createDocument();
  const node = rectangle();
  addNode(document, node);
  Object.assign(node, offsetVectorPath(node, 12, 'round'));
  assert.doesNotThrow(() => validateDocument(document));
  assert.equal(document.pages[0].children[0].id, node.id);
});

test('the path Inspector exposes signed amount, join choices, Enter, and an undoable commit route', () => {
  assert.match(editorSource, /data-vector-offset-amount/);
  assert.match(editorSource, /data-vector-offset-join/);
  assert.match(editorSource, /data-action="offset-vector"/);
  assert.match(editorSource, /event\.key !== 'Enter'[\s\S]*?data-vector-offset-amount[\s\S]*?applyVectorOffset\(\)/);
  assert.match(editorSource, /function applyVectorOffset\(\)[\s\S]*?offsetVectorPath\([\s\S]*?checkpoint\('Offset vector'\)[\s\S]*?recordNodeComponentOverrides\([\s\S]*?queueSave\(\)/);
});
