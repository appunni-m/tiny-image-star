/** Return the presentation-canvas offset where a move-in transition starts. */
export function prototypeMoveInOffset(transition, distance = 22) {
  if (!Number.isFinite(distance) || distance < 0) throw new TypeError('Transition distance must be a finite non-negative number.');
  const offsets = {
    'move-left': [distance, 0],
    'move-right': [-distance, 0],
    'move-up': [0, distance],
    'move-down': [0, -distance]
  };
  const offset = offsets[transition];
  return offset ? { x: offset[0], y: offset[1] } : null;
}

const directions = Object.freeze({
  left: Object.freeze([-1, 0]),
  right: Object.freeze([1, 0]),
  up: Object.freeze([0, -1]),
  down: Object.freeze([0, 1])
});

function transitionParts(transition) {
  // The original flattened values are kept in saved documents. Their names
  // describe the direction of travel, so they remain aliases for Move In.
  if (['move-left', 'move-right', 'move-up', 'move-down'].includes(transition)) {
    return { type: 'move-in', direction: transition.slice('move-'.length) };
  }
  const match = /^(move-in|move-out|push|slide-in|slide-out)-(left|right|up|down)$/.exec(transition || '');
  return match ? { type: match[1], direction: match[2] } : null;
}

/**
 * Compute the presentation-space motion for the old and new frame snapshots.
 * Direction describes travel (for example, `push-left` moves both snapshots
 * left; the incoming frame begins one viewport to the right).
 */
export function prototypeTransitionMotion(transition, width, height, progress) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError('Transition viewport dimensions must be finite and positive.');
  }
  if (!Number.isFinite(progress)) throw new TypeError('Transition progress must be finite.');
  const incoming = { x: 0, y: 0, opacity: 1 };
  const outgoing = { x: 0, y: 0, opacity: 1 };
  if (transition === 'dissolve') {
    incoming.opacity = Math.max(0, Math.min(1, progress));
    return { incoming, outgoing, front: 'incoming' };
  }
  const parts = transitionParts(transition);
  if (!parts) return { incoming, outgoing, front: 'incoming' };
  const [directionX, directionY] = directions[parts.direction];
  const travel = {
    x: directionX && progress ? directionX * width * progress : 0,
    y: directionY && progress ? directionY * height * progress : 0
  };
  const start = {
    x: directionX && progress !== 1 ? -directionX * width * (1 - progress) : 0,
    y: directionY && progress !== 1 ? -directionY * height * (1 - progress) : 0
  };
  if (parts.type === 'move-in') {
    incoming.x = start.x;
    incoming.y = start.y;
    return { incoming, outgoing, front: 'incoming' };
  }
  if (parts.type === 'move-out') {
    outgoing.x = travel.x;
    outgoing.y = travel.y;
    return { incoming, outgoing, front: 'outgoing' };
  }
  if (parts.type === 'push') {
    incoming.x = start.x;
    incoming.y = start.y;
    outgoing.x = travel.x;
    outgoing.y = travel.y;
    return { incoming, outgoing, front: 'incoming' };
  }
  if (parts.type === 'slide-in') {
    incoming.x = start.x;
    incoming.y = start.y;
    outgoing.opacity = Math.max(0, Math.min(1, 1 - progress));
    return { incoming, outgoing, front: 'outgoing' };
  }
  outgoing.x = travel.x;
  outgoing.y = travel.y;
  outgoing.opacity = Math.max(0, Math.min(1, 1 - progress));
  return { incoming, outgoing, front: 'outgoing' };
}
