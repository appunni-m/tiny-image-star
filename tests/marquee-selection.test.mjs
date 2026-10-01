import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendLassoPoint, clipMarqueePolygonThroughAncestors, clipPolygonToConvexPolygon, createLassoSelectionTest, isMarqueeLayerVisible,
  lassoSelectsPolygon, marqueeClipPolygon, marqueeSelectsPolygon, marqueeSelectionMode
} from '../src/marquee-selection.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';

const rectangle = (left, top, right, bottom) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }
];

test('left-to-right marquee selects only layers fully contained in its window', () => {
  assert.equal(marqueeSelectionMode({ x: 0, y: 0 }, { x: 20, y: 20 }), 'window');
  assert.equal(marqueeSelectsPolygon({ x: 0, y: 0 }, { x: 40, y: 40 }, rectangle(10, 10, 30, 30)), true);
  assert.equal(marqueeSelectsPolygon({ x: 0, y: 0 }, { x: 20, y: 20 }, rectangle(10, 10, 30, 30)), false,
    'merely crossing the selection window must not select a partially enclosed layer');
});

test('right-to-left marquee selects intersecting layers and fully enclosed marquee areas', () => {
  assert.equal(marqueeSelectionMode({ x: 20, y: 20 }, { x: 0, y: 0 }), 'crossing');
  assert.equal(marqueeSelectsPolygon({ x: 20, y: 20 }, { x: 0, y: 0 }, rectangle(10, 10, 30, 30)), true);
  assert.equal(marqueeSelectsPolygon({ x: 18, y: 18 }, { x: 12, y: 12 }, rectangle(0, 0, 30, 30)), true);
  assert.equal(marqueeSelectsPolygon({ x: 5, y: 5 }, { x: 0, y: 0 }, rectangle(10, 10, 30, 30)), false);
});

test('marquee intersection follows a rotated layer quadrilateral rather than its axis-aligned bounds', () => {
  const diamond = [{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 20 }];
  assert.equal(marqueeSelectsPolygon({ x: 4, y: 4 }, { x: 0, y: 0 }, diamond), false,
    'an overlapping bounding box with no layer geometry intersection must not count as a hit');
  assert.equal(marqueeSelectsPolygon({ x: 7, y: 7 }, { x: 3, y: 3 }, diamond), true);
});

test('crossing marquee intersects a nested rotated child’s visible page-space bounds', () => {
  const parent = { type: 'frame', x: 120, y: -90, width: 300, height: 220, rotation: 37, clip: true };
  const group = { type: 'group', x: 32, y: 24, width: 160, height: 110, rotation: -26 };
  const child = { type: 'rectangle', x: 22, y: 18, width: 64, height: 42, rotation: 19 };
  const ancestors = [parent, group];
  const corners = [[0, 0], [child.width, 0], [child.width, child.height], [0, child.height]]
    .map(([x, y]) => nodeLocalToPage(child, { x, y }, ancestors));
  const visible = clipMarqueePolygonThroughAncestors(corners, ancestors);
  const center = nodeLocalToPage(child, { x: child.width / 2, y: child.height / 2 }, ancestors);
  const start = { x: center.x + 268, y: center.y - 15 };
  const end = { x: center.x - 124, y: center.y - 15 };

  assert.ok(visible.length >= 3, 'nested clipping retains the visible child polygon');
  assert.equal(marqueeSelectionMode(start, end), 'crossing');
  assert.equal(marqueeSelectsPolygon(start, end, visible), true,
    'the marquee line intersects the child’s transformed visible geometry');
});

test('edge contact counts as crossing, and malformed marquee geometry fails closed', () => {
  assert.equal(marqueeSelectsPolygon({ x: 10, y: 0 }, { x: 0, y: 10 }, rectangle(10, 2, 20, 8)), true);
  assert.equal(marqueeSelectsPolygon({ x: 0, y: 0 }, { x: 10, y: 10 }, [{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 1, y: 0 }]), false);
  assert.throws(() => marqueeSelectionMode({ x: 0, y: 0 }, { x: Infinity, y: 1 }), /finite/);
});

test('marquee clipping excludes fully hidden geometry and selects only the visible clipped portion', () => {
  const hiddenAncestor = { type: 'frame', visible: false };
  assert.equal(isMarqueeLayerVisible({ visible: true }, [hiddenAncestor]), false,
    'a visible child under a hidden ancestor is not a canvas marquee target');
  assert.equal(isMarqueeLayerVisible({ visible: false }, []), false,
    'a hidden layer is not a canvas marquee target');

  const clipFrame = { type: 'frame', x: 0, y: 0, width: 10, height: 10, rotation: 0, clip: true, radius: 0 };
  assert.deepEqual(clipMarqueePolygonThroughAncestors(rectangle(20, 20, 40, 40), [clipFrame]), [],
    'marquee over a clipped-away child must not select it');
  const visiblePart = clipMarqueePolygonThroughAncestors(rectangle(5, 5, 15, 15), [clipFrame]);
  assert.ok(visiblePart.length >= 3);
  assert.equal(marqueeSelectsPolygon({ x: 0, y: 0 }, { x: 10, y: 10 }, visiblePart), true,
    'a window containing all visible pixels selects the clipped child');
  assert.equal(marqueeSelectsPolygon({ x: 15, y: 15 }, { x: 12, y: 12 }, visiblePart), false,
    'crossing only the clipped-away part must not select the child');
});

test('marquee clipping follows rotated and rounded ancestor viewports', () => {
  const roundedFrame = { type: 'frame', x: 0, y: 0, width: 100, height: 100, rotation: 0, clip: true, radius: 40 };
  const roundedViewport = marqueeClipPolygon(roundedFrame);
  assert.deepEqual(clipPolygonToConvexPolygon(rectangle(0, 0, 5, 5), roundedViewport), [],
    'the rounded-away corner is outside the actual frame viewport');

  const rotatedFrame = { ...roundedFrame, x: 20, y: 30, width: 20, height: 20, radius: 0, rotation: 45 };
  const child = rectangle(20, 30, 40, 50);
  const visible = clipMarqueePolygonThroughAncestors(child, [rotatedFrame]);
  assert.ok(visible.length >= 3, 'transformed child geometry should be clipped in page coordinates');
  assert.ok(visible.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('freeform lasso selects contained layers, enclosed regions, and edge intersections', () => {
  const lasso = rectangle(5, 5, 25, 25);
  assert.equal(lassoSelectsPolygon(lasso, rectangle(10, 10, 20, 20)), true,
    'a layer fully inside the lasso is selected');
  assert.equal(lassoSelectsPolygon(rectangle(10, 10, 20, 20), rectangle(0, 0, 30, 30)), true,
    'a lasso fully inside a layer still intersects that layer');
  assert.equal(lassoSelectsPolygon(rectangle(5, 5, 15, 15), rectangle(12, 8, 22, 18)), true,
    'crossing edges select the layer');
  assert.equal(lassoSelectsPolygon(rectangle(0, 0, 5, 5), rectangle(10, 10, 20, 20)), false,
    'overlapping bounds without a polygon intersection do not count');
});

test('lasso uses even-odd containment for self-crossing paths and rejects degenerate input', () => {
  const bowTie = [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 20, y: 0 }];
  assert.equal(lassoSelectsPolygon(bowTie, rectangle(8, 2, 12, 6)), true,
    'a valid self-crossing lasso selects geometry in one of its lobes');
  assert.equal(lassoSelectsPolygon([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }], rectangle(0, 0, 20, 20)), false);
  assert.equal(lassoSelectsPolygon(rectangle(0, 0, 10, 10), [{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 1, y: 0 }]), false);
});

test('lasso page hit-test can be reused across candidates and culls distant geometry', () => {
  const select = createLassoSelectionTest(rectangle(0, 0, 20, 20));
  assert.equal(select(rectangle(4, 4, 8, 8)), true);
  assert.equal(select(rectangle(200, 200, 220, 220)), false);
  assert.equal(createLassoSelectionTest([])(rectangle(0, 0, 10, 10)), false);
});

test('lasso pointer samples are spaced, finite, bounded, and preserve their endpoints', () => {
  const points = [{ x: 0, y: 0 }];
  assert.equal(appendLassoPoint(points, { x: .5, y: 0 }, { minDistance: 1 }), false);
  assert.equal(appendLassoPoint(points, { x: 2, y: 0 }, { minDistance: 1 }), true);
  assert.equal(appendLassoPoint(points, { x: Infinity, y: 4 }), false);
  assert.deepEqual(points, [{ x: 0, y: 0 }, { x: 2, y: 0 }]);

  const dense = [{ x: 0, y: 0 }];
  for (let index = 1; index <= 30; index += 1) appendLassoPoint(dense, { x: index, y: index % 2 }, { minDistance: 0, maxPoints: 8 });
  assert.ok(dense.length <= 8);
  assert.deepEqual(dense[0], { x: 0, y: 0 });
  assert.deepEqual(dense.at(-1), { x: 30, y: 0 });
});
