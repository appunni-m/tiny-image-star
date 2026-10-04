import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_QUICK_ADD_GAP,
  MAX_FRAME_QUICK_ADD_SIBLINGS,
  planFrameQuickAdd
} from '../src/frame-quick-add.js';

function frame(overrides = {}) {
  return { type: 'frame', x: 0, y: 0, width: 100, height: 80, rotation: 0, ...overrides };
}

function visualBounds(candidate) {
  const radians = candidate.rotation * Math.PI / 180;
  const width = Math.abs(candidate.width * Math.cos(radians)) + Math.abs(candidate.height * Math.sin(radians));
  const height = Math.abs(candidate.width * Math.sin(radians)) + Math.abs(candidate.height * Math.cos(radians));
  const left = candidate.x + (candidate.width - width) / 2;
  const top = candidate.y + (candidate.height - height) / 2;
  return { left, top, right: left + width, bottom: top + height };
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

test('quick-add places a same-size duplicate to the right with the standard gap', () => {
  const source = frame({ x: 20, y: 40, width: 320, height: 180 });
  const result = planFrameQuickAdd(source, [source]);

  assert.equal(FRAME_QUICK_ADD_GAP, 32);
  assert.deepEqual(result, {
    mode: 'duplicate', direction: 'right', x: 372, y: 40, width: 320, height: 180, rotation: 0, copyContents: true
  });
});

test('collision nudging clears a row of intersecting frames and preserves the gap', () => {
  const source = frame({ width: 100, height: 100 });
  const first = frame({ x: 120, y: -20, width: 140, height: 140 });
  const second = frame({ x: 260, y: 0, width: 140, height: 100 });
  const result = planFrameQuickAdd(source, [second, source, first]);

  assert.deepEqual(result, {
    mode: 'duplicate', direction: 'right', x: 432, y: 0, width: 100, height: 100, rotation: 0, copyContents: true
  });
  assert.equal(result.x - (second.x + second.width), FRAME_QUICK_ADD_GAP);
});

test('all four quick-add directions align beside the source and default to the right', () => {
  const source = frame({ x: 100, y: 100, width: 100, height: 80 });
  const expected = {
    top: { x: 100, y: -12 },
    right: { x: 232, y: 100 },
    bottom: { x: 100, y: 212 },
    left: { x: -32, y: 100 }
  };

  assert.equal(planFrameQuickAdd(source).direction, 'right');
  for (const [direction, position] of Object.entries(expected)) {
    const result = planFrameQuickAdd(source, [source], { direction });
    assert.equal(result.direction, direction);
    assert.deepEqual({ x: result.x, y: result.y }, position, `${direction} quick-add placement`);
    assert.equal(result.width, source.width);
    assert.equal(result.height, source.height);
  }
});

test('each quick-add direction nudges past intersecting sibling frames and keeps the gap', () => {
  const cases = [
    {
      direction: 'right', source: frame({ width: 100, height: 100 }),
      blockers: [frame({ x: 120, y: -20, width: 140, height: 140 }), frame({ x: 260, y: 0, width: 140, height: 100 })],
      expected: { x: 432, y: 0 }
    },
    {
      direction: 'left', source: frame({ x: 400, width: 100, height: 100 }),
      blockers: [frame({ x: 230, y: -20, width: 150, height: 140 }), frame({ x: 100, width: 140, height: 100 })],
      expected: { x: -32, y: 0 }
    },
    {
      direction: 'bottom', source: frame({ width: 100, height: 100 }),
      blockers: [frame({ x: -20, y: 120, width: 140, height: 140 }), frame({ x: 0, y: 260, width: 100, height: 140 })],
      expected: { x: 0, y: 432 }
    },
    {
      direction: 'top', source: frame({ y: 400, width: 100, height: 100 }),
      blockers: [frame({ x: -20, y: 230, width: 140, height: 150 }), frame({ y: 80, width: 100, height: 130 })],
      expected: { x: 0, y: -52 }
    }
  ];

  for (const { direction, source, blockers, expected } of cases) {
    const result = planFrameQuickAdd(source, [source, ...blockers], { direction });
    const targetBounds = visualBounds(result);
    assert.deepEqual({ x: result.x, y: result.y }, expected, `${direction} nudged position`);
    assert.ok(blockers.every(blocker => !overlaps(targetBounds, visualBounds(blocker))),
      `${direction} placement clears every blocker`);

    const blockerBounds = visualBounds(blockers.at(-1));
    const gap = direction === 'right' ? targetBounds.left - blockerBounds.right
      : direction === 'left' ? blockerBounds.left - targetBounds.right
        : direction === 'bottom' ? targetBounds.top - blockerBounds.bottom
          : blockerBounds.top - targetBounds.bottom;
    assert.equal(gap, FRAME_QUICK_ADD_GAP, `${direction} preserves the standard gap from the final blocker`);
  }
});

test('frames above and below the proposed position do not cause needless nudging', () => {
  const source = frame({ width: 100, height: 100 });
  const above = frame({ x: 132, y: -100, width: 100, height: 99 });
  const below = frame({ x: 132, y: 101, width: 100, height: 100 });
  const result = planFrameQuickAdd(source, [below, above]);

  assert.equal(result.x, 132);
  assert.equal(result.y, 0);
});

test('rotated source and sibling frames are placed and collision-checked by their visible bounds', () => {
  const source = frame({ x: 10, y: 20, width: 120, height: 80, rotation: 90 });
  const obstacle = frame({ x: 125, y: -20, width: 100, height: 100, rotation: 45 });
  const result = planFrameQuickAdd(source, [source, obstacle]);
  const targetBounds = visualBounds(result);
  const obstacleBounds = visualBounds(obstacle);

  assert.ok(targetBounds.left - visualBounds(source).right > FRAME_QUICK_ADD_GAP,
    'the rotated sibling should cause the initial adjacent position to move right');
  assert.equal(targetBounds.left - obstacleBounds.right, FRAME_QUICK_ADD_GAP);
  assert.equal(targetBounds.top, visualBounds(source).top);
  assert.equal(overlaps(targetBounds, obstacleBounds), false);
  assert.equal(result.direction, 'right');
  assert.equal(result.rotation, source.rotation);
});

test('blank mode returns same frame geometry without requesting copied contents', () => {
  const source = frame({ x: -40, y: 28, width: 393, height: 852, rotation: 15, children: [{ id: 'child' }] });
  const result = planFrameQuickAdd(source, [], { mode: 'blank', direction: 'bottom' });

  assert.equal(result.mode, 'blank');
  assert.equal(result.direction, 'bottom');
  assert.equal(result.copyContents, false);
  assert.equal(result.width, source.width);
  assert.equal(result.height, source.height);
  assert.equal(result.rotation, source.rotation);
  assert.notEqual(result.y, source.y);
  assert.deepEqual(source.children, [{ id: 'child' }]);
});

test('placement is deterministic and does not mutate source or sibling data', () => {
  const source = frame({ id: 'source', x: 8, y: 16 });
  const siblings = [frame({ id: 'collision', x: 140, y: 0, width: 160, height: 120 })];
  const before = structuredClone({ source, siblings });

  const first = planFrameQuickAdd(source, siblings);
  const second = planFrameQuickAdd(source, siblings);

  assert.deepEqual(first, second);
  assert.deepEqual({ source, siblings }, before);
});

test('invalid source geometry, options, mode, and oversized sibling lists fail clearly', () => {
  assert.throws(() => planFrameQuickAdd({ ...frame(), width: 0 }), /source.*finite position, size, and rotation/i);
  assert.throws(() => planFrameQuickAdd(frame(), [], { mode: 'copy' }), /mode/);
  assert.throws(() => planFrameQuickAdd(frame(), [], { direction: 'diagonal' }), /direction/);
  assert.throws(() => planFrameQuickAdd(frame(), [], { gap: -1 }), /gap/);
  assert.throws(() => planFrameQuickAdd(frame(), new Array(MAX_FRAME_QUICK_ADD_SIBLINGS + 1)), /at most/);
});
