import test from 'node:test';
import assert from 'node:assert/strict';
import { createNode } from '../src/model.js';
import { MAX_STAR_POINTS } from '../src/polygon-corners.js';
import { starControlHandles, starCornerRadiusFromDrag, starInnerRadiusFromPointer, starPointCountFromDrag } from '../src/star-controls.js';

test('selected stars expose editable points, ratio, and radius canvas handles', () => {
  const star = createNode('star', { width: 120, height: 80, points: 7, innerRadius: .4, radius: 5 });
  const handles = starControlHandles(star, 1.25);
  assert.deepEqual(handles.map(handle => handle.kind), ['points', 'ratio', 'radius']);
  assert.deepEqual(handles.map(handle => handle.label), ['Points', 'Ratio', 'Radius']);
  assert.ok(handles.every(handle => Number.isFinite(handle.point.x) && Number.isFinite(handle.point.y)));
  assert.ok(handles.find(handle => handle.kind === 'radius').maxRadius > 0);
  assert.equal(starControlHandles({ ...star, innerRadius: 0 }).some(handle => handle.kind === 'radius'), false,
    'the radius handle hides when a zero inner ratio collapses outer corners into straight-through tips');
  assert.equal(starControlHandles({ ...star, width: 0 }).length, 0);
});

test('star point-count dragging is discrete and clamps to the supported 3–60 range', () => {
  assert.equal(starPointCountFromDrag(5, 100, 64), 8);
  assert.equal(starPointCountFromDrag(5, 100, 1000), 3);
  assert.equal(starPointCountFromDrag(MAX_STAR_POINTS - 1, 100, 40), MAX_STAR_POINTS);
});

test('star ratio dragging measures radial distance from the shape center', () => {
  const star = createNode('star', { width: 100, height: 80 });
  assert.equal(starInnerRadiusFromPointer(star, { x: 50, y: 40 }), 0);
  assert.equal(starInnerRadiusFromPointer(star, { x: 82, y: 40 }), .8);
  assert.equal(starInnerRadiusFromPointer(star, { x: 110, y: 40 }), 1);
});

test('star radius dragging follows the outer corner tangent and stops at a safe geometric limit', () => {
  const [handle] = starControlHandles(createNode('star', { width: 100, height: 100, points: 5 }), 1)
    .filter(item => item.kind === 'radius');
  const distance = Math.min(8, handle.maxRadius) * handle.tangentFactor * (1 + handle.smoothing);
  const next = {
    x: handle.point.x + handle.axis.x * distance,
    y: handle.point.y + handle.axis.y * distance
  };
  assert.ok(Math.abs(starCornerRadiusFromDrag(0, handle.point, next, handle) - Math.min(8, handle.maxRadius)) < 1e-9);
  const beyond = {
    x: handle.point.x + handle.axis.x * 1_000_000,
    y: handle.point.y + handle.axis.y * 1_000_000
  };
  assert.equal(starCornerRadiusFromDrag(0, handle.point, beyond, handle), handle.maxRadius);
});
