import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVectorAnchorSelection, removeVectorPathAnchors, setVectorPathAnchorTranslation,
  toggleVectorAnchorSelection, vectorAnchorKey
} from '../src/vector-anchor-selection.js';
import { vectorSegmentPoint } from '../src/vector-path.js';

const anchor = (index, contourIndex = 0, nodeId = 'path-1') => ({ nodeId, contourIndex, index });

function cubicPoint([start, control1, control2, end], t) {
  const u = 1 - t;
  return {
    x: u ** 3 * start.x + 3 * u ** 2 * t * control1.x + 3 * u * t ** 2 * control2.x + t ** 3 * end.x,
    y: u ** 3 * start.y + 3 * u ** 2 * t * control1.y + 3 * u * t ** 2 * control2.y + t ** 3 * end.y
  };
}

function splitCubicFixture(closed = false) {
  const points = [
    { x: 0, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: .5 } },
    { x: .5, y: .75, in: { x: -.25, y: 0 }, out: { x: .25, y: 0 } },
    { x: 1, y: 0, in: { x: 0, y: .5 }, out: { x: 0, y: 0 } }
  ];
  if (closed) points.push({ x: .4, y: -.1, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } });
  return { id: 'path-1', type: 'path', x: 0, y: 0, width: 100, height: 100, closed, points };
}

test('path anchor selection toggles by path, contour, and point identity without duplicates', () => {
  const selected = [anchor(0), anchor(0)];
  assert.deepEqual(normalizeVectorAnchorSelection(selected), [anchor(0)]);
  assert.deepEqual(toggleVectorAnchorSelection(selected, anchor(1)), [anchor(0), anchor(1)]);
  assert.deepEqual(toggleVectorAnchorSelection([anchor(0), anchor(1)], anchor(1)), [anchor(0)]);
  assert.deepEqual(toggleVectorAnchorSelection([anchor(0)], anchor(0, 1)), [anchor(0), anchor(0, 1)]);
  assert.deepEqual(toggleVectorAnchorSelection([anchor(0)], anchor(2, 0, 'path-2')), [anchor(2, 0, 'path-2')],
    'a path selection never mixes identities from two vector layers');
  assert.equal(vectorAnchorKey(anchor(0)), vectorAnchorKey({ ...anchor(0) }));
  assert.deepEqual(toggleVectorAnchorSelection([anchor(0)], { nodeId: '', contourIndex: -1, index: 1 }), [anchor(0)]);
});

test('one local translation moves selected anchors across contours and preserves Bézier handle offsets', () => {
  const node = {
    id: 'path-1', type: 'path', width: 100, height: 50,
    points: [{ x: .1, y: .2, in: { x: -.04, y: -.02 }, out: { x: .03, y: .01 } }, { x: .5, y: .5 }],
    subpaths: [{ closed: false, points: [{ x: .8, y: .4, in: { x: 0, y: 0 }, out: { x: .05, y: .03 } }] }]
  };
  const selected = [anchor(0), anchor(0, 1)];
  const beforeHandles = structuredClone([node.points[0].in, node.points[0].out, node.subpaths[0].points[0].out]);
  assert.equal(setVectorPathAnchorTranslation(node, selected, { x: 20, y: -5 }, { width: 200, height: 100 }), 2);
  assert.ok(Math.abs(node.points[0].x - .2) < 1e-12);
  assert.ok(Math.abs(node.points[0].y - .15) < 1e-12);
  assert.ok(Math.abs(node.subpaths[0].points[0].x - .9) < 1e-12);
  assert.ok(Math.abs(node.subpaths[0].points[0].y - .35) < 1e-12);
  assert.deepEqual([node.points[0].in, node.points[0].out, node.subpaths[0].points[0].out], beforeHandles);
  assert.deepEqual([node.points[1].x, node.points[1].y], [.5, .5], 'unselected anchors stay fixed');
});

test('multi-anchor movement rejects a stale or malformed set before changing any point', () => {
  const node = { id: 'path-1', type: 'path', width: 100, height: 100, points: [{ x: .1, y: .2 }, { x: .8, y: .9 }] };
  const before = structuredClone(node);
  assert.equal(setVectorPathAnchorTranslation(node, [anchor(0), anchor(7)], { x: 2, y: 3 }), false);
  assert.deepEqual(node, before);
  assert.equal(setVectorPathAnchorTranslation(node, [anchor(0), anchor(0)], { x: 2, y: 3 }), false);
  assert.deepEqual(node, before);
  assert.equal(setVectorPathAnchorTranslation(node, [anchor(0)], { x: Infinity, y: 1 }), false);
  assert.deepEqual(node, before);
});

test('group drag always derives from pointer-down geometry without cumulative drift', () => {
  const node = { id: 'path-1', type: 'path', width: 100, height: 100, points: [{ x: .1, y: .2 }, { x: .8, y: .9 }] };
  const selected = [anchor(0)];
  const origins = new Map([[vectorAnchorKey(anchor(0)), { x: .1, y: .2 }]]);
  assert.equal(setVectorPathAnchorTranslation(node, selected, { x: 10, y: 5 }, {}, origins), 1);
  assert.equal(setVectorPathAnchorTranslation(node, selected, { x: 20, y: -5 }, {}, origins), 1);
  assert.ok(Math.abs(node.points[0].x - .3) < 1e-12);
  assert.ok(Math.abs(node.points[0].y - .15) < 1e-12);
});

test('multi-anchor delete preflights each contour and removes points in descending index order', () => {
  const node = {
    id: 'path-1', type: 'path', width: 100, height: 100,
    points: [{ x: .1, y: .1 }, { x: .3, y: .3 }, { x: .5, y: .5 }, { x: .8, y: .8 }],
    subpaths: [{ points: [{ x: .1, y: .8 }, { x: .5, y: .8 }, { x: .9, y: .8 }] }]
  };
  assert.equal(removeVectorPathAnchors(node, [anchor(1), anchor(1, 1)]), 2);
  assert.deepEqual(node.points, [{ x: .1, y: .1 }, { x: .5, y: .5 }, { x: .8, y: .8 }]);
  assert.deepEqual(node.subpaths[0].points, [{ x: .1, y: .8 }, { x: .9, y: .8 }]);
});

test('deleting a curved interior anchor fits a replacement cubic without changing its contour', () => {
  const node = splitCubicFixture();
  const original = structuredClone(node);
  const sourceCurve = [
    { x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }
  ];
  assert.equal(removeVectorPathAnchors(node, [anchor(1)], { dryRun: true }), 1);
  assert.deepEqual(node, original, 'preflight leaves authored controls unchanged');
  assert.equal(removeVectorPathAnchors(node, [anchor(1)]), 1);
  assert.equal(node.points.length, 2);

  let maximumError = 0;
  for (let sample = 0; sample <= 100; sample += 1) {
    const t = sample / 100;
    const expected = cubicPoint(sourceCurve, t);
    const actual = vectorSegmentPoint(node, 0, t, { x: 0, y: 0 });
    maximumError = Math.max(maximumError, Math.hypot(actual.x - expected.x, actual.y - expected.y));
  }
  assert.ok(maximumError < .01, `fitted cubic should preserve the split source curve (max error ${maximumError})`);
});

test('deleting a closed contour anchor fits the replacement across the closing seam', () => {
  const node = splitCubicFixture(true);
  // Put the split cubic across the closed path seam: old point 3 -> 0 -> 1.
  const [start, middle, end, extra] = node.points;
  node.points = [middle, end, extra, start];
  const sourceCurve = [
    { x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }
  ];
  assert.equal(removeVectorPathAnchors(node, [anchor(0)]), 1);
  assert.equal(node.points.length, 3);
  let maximumError = 0;
  for (let sample = 0; sample <= 100; sample += 1) {
    const t = sample / 100;
    const expected = cubicPoint(sourceCurve, t);
    const actual = vectorSegmentPoint(node, 2, t, { x: 0, y: 0 });
    maximumError = Math.max(maximumError, Math.hypot(actual.x - expected.x, actual.y - expected.y));
  }
  assert.ok(maximumError < .01, `closed-seam fit should preserve the source curve (max error ${maximumError})`);
});

test('curved deletion keeps constrained endpoint handles intact', () => {
  const node = splitCubicFixture();
  node.points[0].mode = 'symmetric';
  const originalStart = structuredClone(node.points[0]);
  assert.equal(removeVectorPathAnchors(node, [anchor(1)]), 1);
  assert.deepEqual(node.points[0], originalStart, 'a constrained survivor keeps its authored paired handles');
});

test('multi-anchor delete leaves the document unchanged if any contour would be destroyed', () => {
  const node = {
    id: 'path-1', type: 'path', width: 100, height: 100,
    points: [{ x: .1, y: .1 }, { x: .3, y: .3 }, { x: .5, y: .5 }],
    subpaths: [{ points: [{ x: .1, y: .8 }, { x: .9, y: .8 }] }]
  };
  const before = structuredClone(node);
  assert.equal(removeVectorPathAnchors(node, [anchor(0), anchor(1, 1)]), false);
  assert.deepEqual(node, before);
});
