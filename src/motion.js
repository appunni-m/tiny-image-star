export const DEFAULT_MOTION_DURATION_MS = 1_000;
export const MAX_MOTION_DURATION_MS = 120_000;
export const MAX_MOTION_TRACKS = 100;
export const MAX_MOTION_KEYFRAMES_PER_TRACK = 500;
export const MAX_MOTION_KEYFRAMES = 10_000;

const properties = new Set(['x', 'y', 'width', 'height', 'rotation', 'opacity']);
const easings = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out']);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const allowedMotionKeys = new Set(['durationMs', 'tracks']);
const allowedTrackKeys = new Set(['id', 'nodeId', 'property', 'keyframes']);
const allowedKeyframeKeys = new Set(['id', 'timeMs', 'value', 'easing']);

function fail(message) {
  throw new TypeError(`Invalid motion document: ${message}`);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every(key => allowed.has(key));
}

function validId(value) {
  return typeof value === 'string' && idPattern.test(value) && value.trim() === value;
}

function valueInRange(property, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (property === 'opacity') return value >= 0 && value <= 1;
  if (property === 'width' || property === 'height') return value >= 0 && value <= 1_000_000_000;
  if (property === 'rotation') return Math.abs(value) <= 1_000_000;
  return Math.abs(value) <= 1_000_000_000;
}

/** Create an empty motion document suitable for persistence. */
export function createMotionDocument(durationMs = DEFAULT_MOTION_DURATION_MS) {
  const motion = { durationMs, tracks: [] };
  validateMotion(motion);
  return motion;
}

/**
 * Validate the bounded motion schema and optionally require track node IDs to
 * exist in the owning design. Returns true or throws a descriptive TypeError.
 */
export function validateMotion(motion, { nodeIds } = {}) {
  if (!motion || typeof motion !== 'object' || Array.isArray(motion)) fail('expected an object');
  if (!hasOnlyKeys(motion, allowedMotionKeys)) fail('unexpected document field');
  if (!Number.isSafeInteger(motion.durationMs) || motion.durationMs < 1 || motion.durationMs > MAX_MOTION_DURATION_MS) {
    fail(`durationMs must be an integer from 1 to ${MAX_MOTION_DURATION_MS}`);
  }
  if (!Array.isArray(motion.tracks) || motion.tracks.length > MAX_MOTION_TRACKS) {
    fail(`tracks must contain at most ${MAX_MOTION_TRACKS} entries`);
  }

  const knownNodes = nodeIds == null ? null : nodeIds instanceof Set ? nodeIds : new Set(nodeIds);
  const ids = new Set();
  const targets = new Set();
  let keyframeCount = 0;
  for (const track of motion.tracks) {
    if (!track || typeof track !== 'object' || Array.isArray(track) || !hasOnlyKeys(track, allowedTrackKeys)) {
      fail('track must be an object with only id, nodeId, property, and keyframes');
    }
    if (!validId(track.id) || ids.has(track.id)) fail('track IDs must be valid and unique');
    ids.add(track.id);
    if (!validId(track.nodeId)) fail('track nodeId must be a valid ID');
    if (knownNodes && !knownNodes.has(track.nodeId)) fail(`track references missing node ${track.nodeId}`);
    if (!properties.has(track.property)) fail(`unsupported animated property ${String(track.property)}`);
    const targetKey = `${track.nodeId}\u0000${track.property}`;
    if (targets.has(targetKey)) fail('each node/property pair can have only one track');
    targets.add(targetKey);
    if (!Array.isArray(track.keyframes) || track.keyframes.length > MAX_MOTION_KEYFRAMES_PER_TRACK) {
      fail(`each track must contain at most ${MAX_MOTION_KEYFRAMES_PER_TRACK} keyframes`);
    }
    keyframeCount += track.keyframes.length;
    if (keyframeCount > MAX_MOTION_KEYFRAMES) fail(`motion document exceeds ${MAX_MOTION_KEYFRAMES} keyframes`);

    const timestamps = new Set();
    for (const keyframe of track.keyframes) {
      if (!keyframe || typeof keyframe !== 'object' || Array.isArray(keyframe) || !hasOnlyKeys(keyframe, allowedKeyframeKeys)) {
        fail('keyframe must be an object with only id, timeMs, value, and easing');
      }
      if (!validId(keyframe.id) || ids.has(keyframe.id)) fail('keyframe IDs must be valid and unique across the motion document');
      ids.add(keyframe.id);
      if (!Number.isSafeInteger(keyframe.timeMs) || keyframe.timeMs < 0 || keyframe.timeMs > motion.durationMs) {
        fail('keyframe timeMs must be an integer inside the motion duration');
      }
      if (timestamps.has(keyframe.timeMs)) fail('a track cannot contain two keyframes at the same time');
      timestamps.add(keyframe.timeMs);
      if (!valueInRange(track.property, keyframe.value)) fail(`invalid ${track.property} keyframe value`);
      if (keyframe.easing != null && !easings.has(keyframe.easing)) fail('unsupported keyframe easing');
    }
  }
  return true;
}

/**
 * Return a stable, time-ordered view of a track. The source is never mutated;
 * equal-time entries sort by code-point ID order to make malformed/unvalidated
 * input deterministic across host locale settings.
 */
export function orderedMotionKeyframes(track) {
  if (!Array.isArray(track?.keyframes)) return [];
  return [...track.keyframes].sort((left, right) => {
    const timeDelta = (Number(left?.timeMs) || 0) - (Number(right?.timeMs) || 0);
    if (timeDelta) return timeDelta;
    const leftId = String(left?.id ?? '');
    const rightId = String(right?.id ?? '');
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}

function easedProgress(easing, progress) {
  if (easing === 'ease-in') return progress * progress;
  if (easing === 'ease-out') return 1 - (1 - progress) * (1 - progress);
  if (easing === 'ease-in-out') return progress < 0.5
    ? 2 * progress * progress
    : 1 - ((-2 * progress + 2) ** 2) / 2;
  return progress;
}

/**
 * Sample one validated numeric track. Times outside the duration clamp to the
 * nearest authored value; empty tracks return undefined.
 */
export function sampleMotionTrack(track, timeMs) {
  if (!Number.isFinite(timeMs)) throw new TypeError('Motion sample time must be finite.');
  return sampleOrderedMotionKeyframes(orderedMotionKeyframes(track), timeMs);
}

function sampleOrderedMotionKeyframes(keyframes, timeMs) {
  if (!keyframes.length) return undefined;
  if (timeMs <= keyframes[0].timeMs) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (timeMs >= last.timeMs) return last.value;

  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const from = keyframes[index];
    const to = keyframes[index + 1];
    if (timeMs > to.timeMs) continue;
    const progress = (timeMs - from.timeMs) / (to.timeMs - from.timeMs);
    const eased = easedProgress(from.easing ?? 'linear', progress);
    return from.value + (to.value - from.value) * eased;
  }
  return last.value;
}

/** Build a reusable sampler so render loops sort authored keyframes only once. */
export function createMotionSampler(motion) {
  validateMotion(motion);
  const tracks = motion.tracks.map(track => ({
    nodeId: track.nodeId,
    property: track.property,
    keyframes: orderedMotionKeyframes(track)
  }));
  return timeMs => {
    if (!Number.isFinite(timeMs)) throw new TypeError('Motion sample time must be finite.');
    const values = new Map();
    for (const track of tracks) {
      const value = sampleOrderedMotionKeyframes(track.keyframes, timeMs);
      if (value === undefined) continue;
      const properties = values.get(track.nodeId) || {};
      properties[track.property] = value;
      values.set(track.nodeId, properties);
    }
    return values;
  };
}

/** Sample a node/property track; return undefined when no matching track exists. */
export function sampleMotion(motion, nodeId, property, timeMs) {
  const track = motion?.tracks?.find(item => item.nodeId === nodeId && item.property === property);
  return track ? sampleMotionTrack(track, timeMs) : undefined;
}

// Descriptive aliases keep call sites readable while the short names form the
// stable integration API used by the editor.
export const validateMotionDocument = validateMotion;
export const sampleMotionProperty = sampleMotion;
