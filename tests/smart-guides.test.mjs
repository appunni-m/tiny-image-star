import test from 'node:test';
import assert from 'node:assert/strict';
import { drawAlignmentGuides, snapToAlignmentGuides } from '../src/smart-guides.js';

test('snaps the translated selection to the nearest peer edge or center', () => {
  const moving = { x: 10, y: 10, width: 20, height: 20 };
  const target = { x: 40, y: 8, width: 30, height: 20 };
  const result = snapToAlignmentGuides(moving, target, { x: 25, y: -1 }, 3);

  assert.deepEqual({ x: result.x, y: result.y }, { x: 25, y: -2 });
  assert.deepEqual(result.guides, [
    { axis: 'x', position: 55, from: 8, to: 28, movingFeature: 'right', targetFeature: 'center' },
    { axis: 'y', position: 8, from: 35, to: 70, movingFeature: 'top', targetFeature: 'top' }
  ]);
});

test('uses one shared translation for multi-selection bounds and resolves each axis independently', () => {
  const moving = [
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 30, y: 20, width: 10, height: 10 }
  ];
  const targets = [
    { x: 50, y: 9, width: 10, height: 10 },
    { x: -10, y: 31, width: 10, height: 10 }
  ];
  const result = snapToAlignmentGuides(moving, targets, { x: 19, y: 2 }, 3);

  assert.deepEqual({ x: result.x, y: result.y }, { x: 20, y: 1 });
  assert.deepEqual(result.guides.map(({ axis, position }) => [axis, position]), [['x', 60], ['y', 31]]);
  assert.deepEqual(moving, [
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 30, y: 20, width: 10, height: 10 }
  ]);
});

test('does not snap beyond the threshold or without valid peer bounds', () => {
  const moving = { x: 0, y: 0, width: 10, height: 10 };
  assert.deepEqual(snapToAlignmentGuides(moving, { x: 30, y: 40, width: 10, height: 10 }, { x: 2, y: 3 }, 1), {
    x: 2, y: 3, guides: []
  });
  assert.deepEqual(snapToAlignmentGuides(moving, { x: NaN, y: 0, width: 10, height: 10 }, { x: 2, y: 3 }, 6), {
    x: 2, y: 3, guides: []
  });
  assert.deepEqual(snapToAlignmentGuides(moving, [], { x: 2, y: 3 }, 6), { x: 2, y: 3, guides: [] });
});

test('draws vertical and horizontal guides with zoom-independent stroke width', () => {
  const calls = [];
  const context = Object.fromEntries(['save', 'beginPath', 'stroke', 'restore'].map(name => [name, () => calls.push([name])]));
  context.moveTo = (x, y) => calls.push(['moveTo', x, y]);
  context.lineTo = (x, y) => calls.push(['lineTo', x, y]);
  context.setLineDash = value => calls.push(['setLineDash', value]);

  assert.equal(drawAlignmentGuides(context, [
    { axis: 'x', position: 12, from: 5, to: 20 },
    { axis: 'y', position: 9, from: -2, to: 15 }
  ], 2), 2);
  assert.equal(context.lineWidth, .5);
  assert.equal(context.strokeStyle, '#ff4db8');
  assert.deepEqual(calls.filter(([name]) => ['moveTo', 'lineTo'].includes(name)), [
    ['moveTo', 12, 5], ['lineTo', 12, 20], ['moveTo', -2, 9], ['lineTo', 15, 9]
  ]);
  assert.deepEqual(calls.at(-1), ['restore']);
  assert.equal(drawAlignmentGuides(context, [], 1), 0);
});
