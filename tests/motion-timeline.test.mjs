import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMotionKeyframeDragTime } from '../src/motion-timeline.js';

const track = (keyframes = []) => ({ id: 'track-a', nodeId: 'node-a', property: 'x', keyframes });
const frame = (id, timeMs) => ({ id, timeMs, value: timeMs });

test('keyframe dragging clamps to the motion duration and leaves track data untouched', () => {
  const source = track([frame('a', 100), frame('b', 400), frame('c', 800)]);
  assert.equal(resolveMotionKeyframeDragTime(source, 'a', -20, 1000), 0);
  assert.equal(resolveMotionKeyframeDragTime(source, 'a', 1_500, 1000), 1000);
  assert.equal(resolveMotionKeyframeDragTime(source, 'a', 250, 1000), 250);
  assert.deepEqual(source.keyframes.map(item => item.timeMs), [100, 400, 800]);
});

test('keyframe collisions resolve to the nearest free millisecond with drag-direction tie breaking', () => {
  const source = track([frame('moving', 100), frame('before', 399), frame('collision', 400), frame('after', 401)]);
  assert.equal(resolveMotionKeyframeDragTime(source, 'moving', 400, 1000, 1), 402);
  assert.equal(resolveMotionKeyframeDragTime(source, 'moving', 400, 1000, -1), 398);

  const tie = track([frame('moving', 100), frame('occupied', 40)]);
  assert.equal(resolveMotionKeyframeDragTime(tie, 'moving', 40, 100, -1), 39);
  assert.equal(resolveMotionKeyframeDragTime(tie, 'moving', 40, 100, 1), 41);
});

test('collision resolution returns null for stale keyframe identities and validates pointer times', () => {
  const source = track([frame('a', 0)]);
  assert.equal(resolveMotionKeyframeDragTime(source, 'missing', 20, 100), null);
  assert.throws(() => resolveMotionKeyframeDragTime(source, 'a', Number.NaN, 100), /must be finite/);
  assert.throws(() => resolveMotionKeyframeDragTime(source, 'a', 20, 0), /positive whole number/);
});
