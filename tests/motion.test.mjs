import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMotionDocument,
  createMotionSampler,
  MAX_MOTION_DURATION_MS,
  MAX_MOTION_KEYFRAMES,
  MAX_MOTION_KEYFRAMES_PER_TRACK,
  MAX_MOTION_TRACKS,
  orderedMotionKeyframes,
  sampleMotion,
  sampleMotionTrack,
  validateMotion
} from '../src/motion.js';

const track = (property = 'x', keyframes = []) => ({ id: 'track-a', nodeId: 'node-a', property, keyframes });
const key = (id, timeMs, value, easing) => ({ id, timeMs, value, ...(easing ? { easing } : {}) });

test('empty motion has a bounded default and sampling an empty or missing track returns undefined', () => {
  const motion = createMotionDocument();
  assert.deepEqual(motion, { durationMs: 1000, tracks: [] });
  assert.equal(validateMotion(motion), true);
  assert.equal(sampleMotionTrack(track(), 0), undefined);
  assert.equal(sampleMotion(motion, 'node-a', 'x', 0), undefined);
});

test('sampling clamps to endpoint values and handles exact keyframe timestamps', () => {
  const motion = {
    durationMs: 1000,
    tracks: [track('x', [key('key-start', 100, 12), key('key-end', 900, 92)])]
  };
  assert.equal(sampleMotion(motion, 'node-a', 'x', 0), 12);
  assert.equal(sampleMotion(motion, 'node-a', 'x', 100), 12);
  assert.equal(sampleMotion(motion, 'node-a', 'x', 500), 52);
  assert.equal(sampleMotion(motion, 'node-a', 'x', 900), 92);
  assert.equal(sampleMotion(motion, 'node-a', 'x', 1400), 92);
});

test('linear and supported easing curves interpolate numeric design properties', () => {
  const properties = ['x', 'y', 'width', 'height', 'rotation', 'opacity'];
  for (const property of properties) {
    const motion = { durationMs: 100, tracks: [track(property, [key('a', 0, 0), key('b', 100, 1)])] };
    assert.equal(sampleMotion(motion, 'node-a', property, 25), 0.25);
  }
  const easings = [
    ['linear', 0.25],
    ['ease-in', 0.0625],
    ['ease-out', 0.4375],
    ['ease-in-out', 0.125]
  ];
  for (const [easing, expected] of easings) {
    assert.equal(sampleMotionTrack(track('x', [key('a', 0, 0, easing), key('b', 100, 1)]), 25), expected, easing);
  }
  assert.equal(sampleMotionTrack(track('x', [key('a', 0, 10, 'ease-in-out'), key('b', 100, 30)]), 50), 20);
});

test('keyframe ordering is stable by time then code-point ID without mutating the source', () => {
  const input = [key('z', 20, 2), key('b', 10, 1), key('a', 10, 0)];
  const ordered = orderedMotionKeyframes(track('x', input));
  assert.deepEqual(ordered.map(item => item.id), ['a', 'b', 'z']);
  assert.deepEqual(input.map(item => item.id), ['z', 'b', 'a']);
});

test('motion validation enforces document bounds, supported properties, values, and optional node membership', () => {
  const valid = { durationMs: 1000, tracks: [track('opacity', [key('key-a', 0, 0), key('key-b', 1000, 1)])] };
  assert.equal(validateMotion(valid, { nodeIds: new Set(['node-a']) }), true);
  assert.throws(() => validateMotion({ ...valid, durationMs: MAX_MOTION_DURATION_MS + 1 }), /durationMs/);
  assert.throws(() => validateMotion({ ...valid, durationMs: 1.5 }), /durationMs/);
  assert.throws(() => validateMotion({ ...valid, unexpected: true }), /unexpected document field/);
  assert.throws(() => validateMotion(valid, { nodeIds: new Set(['other-node']) }), /missing node/);
  assert.throws(() => validateMotion({ durationMs: 100, tracks: [track('fill', [key('k', 0, 1)])] }), /unsupported animated property/);
  assert.throws(() => validateMotion({ durationMs: 100, tracks: [track('opacity', [key('k', 0, 1.01)])] }), /invalid opacity/);
  assert.throws(() => validateMotion({ durationMs: 100, tracks: [track('width', [key('k', 0, -0.1)])] }), /invalid width/);
  assert.throws(() => validateMotion({ durationMs: 100, tracks: [track('height', [key('k', 0, 1_000_000_001)])] }), /invalid height/);
  assert.throws(() => validateMotion({ durationMs: 100, tracks: [track('x', [key('k', 0, Number.NaN)])] }), /invalid x/);
});

test('motion validation rejects duplicate IDs, duplicate track timestamps, and invalid keyframe times', () => {
  const duplicateTrackId = { durationMs: 100, tracks: [track(), { ...track(), nodeId: 'node-b' }] };
  assert.throws(() => validateMotion(duplicateTrackId), /track IDs.*unique/);

  const duplicateAcrossKinds = { durationMs: 100, tracks: [track('x', [key('track-a', 0, 0)])] };
  assert.throws(() => validateMotion(duplicateAcrossKinds), /keyframe IDs.*unique/);

  const duplicateTime = { durationMs: 100, tracks: [track('x', [key('a', 10, 0), key('b', 10, 1)])] };
  assert.throws(() => validateMotion(duplicateTime), /same time/);

  for (const timeMs of [-1, 101, 1.2, Number.POSITIVE_INFINITY]) {
    assert.throws(() => validateMotion({ durationMs: 100, tracks: [track('x', [key('a', timeMs, 0)])] }), /timeMs/);
  }
  assert.throws(() => validateMotion({ durationMs: 100, tracks: [track('x', [key('a', 0, 0, 'bounce')])] }), /easing/);
});

test('motion validation rejects excessive track, per-track keyframe, and total keyframe counts', () => {
  const trackLimit = Array.from({ length: MAX_MOTION_TRACKS + 1 }, (_, index) => ({
    id: `track-${index}`, nodeId: `node-${index}`, property: 'x', keyframes: []
  }));
  assert.throws(() => validateMotion({ durationMs: 100, tracks: trackLimit }), /tracks.*at most/);

  const keyframeLimit = Array.from({ length: MAX_MOTION_KEYFRAMES_PER_TRACK + 1 }, (_, index) => key(`key-${index}`, index, index));
  assert.throws(() => validateMotion({ durationMs: MAX_MOTION_KEYFRAMES_PER_TRACK + 1, tracks: [track('x', keyframeLimit)] }), /each track.*at most/);

  const totalLimitTracks = Array.from({ length: Math.ceil((MAX_MOTION_KEYFRAMES + 1) / MAX_MOTION_KEYFRAMES_PER_TRACK) }, (_, trackIndex) => ({
    id: `many-track-${trackIndex}`,
    nodeId: `many-node-${trackIndex}`,
    property: 'x',
    keyframes: Array.from({ length: MAX_MOTION_KEYFRAMES_PER_TRACK }, (_, keyIndex) => key(`many-${trackIndex}-${keyIndex}`, keyIndex, keyIndex))
  }));
  assert.throws(() => validateMotion({ durationMs: MAX_MOTION_KEYFRAMES_PER_TRACK, tracks: totalLimitTracks }), /exceeds .* keyframes/);
});

test('sampling rejects non-finite time values', () => {
  assert.throws(() => sampleMotionTrack(track('x', [key('a', 0, 1)]), Number.NaN), /finite/);
});

test('reusable sampling sorts tracks once and returns transient node-property maps', () => {
  const motion = {
    durationMs: 100,
    tracks: [track('x', [key('end', 100, 20), key('start', 0, 0)]), {
      id: 'track-opacity', nodeId: 'node-a', property: 'opacity', keyframes: [key('opaque', 0, 1), key('fade', 100, 0)]
    }]
  };
  const sample = createMotionSampler(motion);
  assert.deepEqual(sample(25), new Map([['node-a', { x: 5, opacity: 0.75 }]]));
  assert.deepEqual(sample(75), new Map([['node-a', { x: 15, opacity: 0.25 }]]));
  assert.throws(() => createMotionSampler({ durationMs: 100, tracks: [
    track('x', [key('a', 0, 0)]), { ...track('x', [key('b', 0, 1)]), id: 'second-track' }
  ] }), /node\/property pair/);
});
