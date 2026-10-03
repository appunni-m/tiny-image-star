import test from 'node:test';
import assert from 'node:assert/strict';
import { rectangleStrokeSideJoins, rectangleStrokeSidePaths } from '../src/stroke-side-geometry.js';

test('rectangle side paths split a square-corner outline into four continuous edges', () => {
  const paths = rectangleStrokeSidePaths(100, 60, { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 });
  assert.deepEqual(paths.map(path => path.side).sort(), ['bottom', 'left', 'right', 'top']);
  for (const path of paths) assert.equal(path.points.length, 2);
  const bySide = Object.fromEntries(paths.map(path => [path.side, path.points]));
  assert.deepEqual(bySide.top, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  assert.deepEqual(bySide.right, [{ x: 100, y: 0 }, { x: 100, y: 60 }]);
  assert.deepEqual(bySide.bottom, [{ x: 100, y: 60 }, { x: 0, y: 60 }]);
  assert.deepEqual(bySide.left, [{ x: 0, y: 60 }, { x: 0, y: 0 }]);
});

test('rounded rectangle side paths share bisectors and retain corner curvature', () => {
  const paths = rectangleStrokeSidePaths(100, 60,
    { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 }, .35);
  assert.deepEqual(paths.map(path => path.side), ['top', 'right', 'bottom', 'left']);
  assert.ok(paths.every(path => path.points.length > 2), 'each edge includes its neighboring rounded-corner arcs');
  for (const path of paths) {
    assert.ok(path.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    assert.ok(path.points.every(point => point.x >= -1e-8 && point.x <= 100 + 1e-8 && point.y >= -1e-8 && point.y <= 60 + 1e-8));
  }
  assert.notDeepEqual(paths[0].points[0], { x: 0, y: 0 }, 'the top edge starts on its rounded-corner bisector');
  assert.notDeepEqual(paths[0].points.at(-1), { x: 100, y: 0 });
});

test('uniform numeric radii expand to all four corners', () => {
  const paths = rectangleStrokeSidePaths(80, 40, 8, .2);
  assert.deepEqual(paths.map(path => path.side), ['top', 'right', 'bottom', 'left']);
  assert.ok(paths.every(path => path.points.length > 2));
});

test('square rectangle joins share exact miter, bevel, round and miter-limit geometry', () => {
  const paths = rectangleStrokeSidePaths(100, 60, 0);
  const widths = { top: 2, right: 8, bottom: 4, left: 6 };
  const miter = rectangleStrokeSideJoins(paths, widths, 'miter', 10);
  const bevel = rectangleStrokeSideJoins(paths, widths, 'bevel', 10);
  const round = rectangleStrokeSideJoins(paths, widths, 'round', 10);
  assert.equal(miter.length, 4);
  assert.equal(bevel.length, 4);
  assert.equal(round.length, 4);
  assert.deepEqual(miter[0].points, [
    { x: 100, y: 0 }, { x: 100, y: -1 }, { x: 104, y: -1 }, { x: 104, y: 0 }
  ], 'the unequal-width outer miter intersects the two edge offset lines');
  assert.deepEqual(bevel[0].points, [
    { x: 100, y: 0 }, { x: 100, y: -1 }, { x: 104, y: 0 }
  ], 'bevel closes the wedge directly between side offsets');
  assert.ok(round[0].points.length > 5, 'round joins use deterministic sampled arc geometry');
  assert.ok(round[0].points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.deepEqual(rectangleStrokeSideJoins(paths, widths, 'miter', 1)[0].points, bevel[0].points,
    'a miter beyond its configured limit falls back to bevel');
});

test('rounded side transitions connect width changes using the same bisector geometry', () => {
  const paths = rectangleStrokeSidePaths(100, 60,
    { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 }, .35);
  const joins = rectangleStrokeSideJoins(paths,
    { top: 2, right: 8, bottom: 4, left: 6 }, 'round', 10);
  assert.equal(joins.length, 4);
  assert.ok(joins.every(join => join.points.length >= 3));
  assert.ok(joins.every(join => join.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))));
});
