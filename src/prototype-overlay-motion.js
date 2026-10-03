const directions = Object.freeze({
  left: Object.freeze([-1, 0]),
  right: Object.freeze([1, 0]),
  up: Object.freeze([0, -1]),
  down: Object.freeze([0, 1])
});

const transitionTypes = new Set(['move-in', 'move-out', 'push', 'slide-in', 'slide-out']);
const reverseTypes = Object.freeze({
  'move-in': 'move-out', 'move-out': 'move-in', push: 'push',
  'slide-in': 'slide-out', 'slide-out': 'slide-in'
});
const reverseDirections = Object.freeze({ left: 'right', right: 'left', up: 'down', down: 'up' });

function parseTransition(transition) {
  if (transition === 'dissolve') return { type: 'dissolve' };
  // Older saved prototypes use move-left/right/up/down. Keep their established
  // meaning: the named direction is travel for a Move In transition.
  const legacy = /^move-(left|right|up|down)$/.exec(transition || '');
  if (legacy) return { type: 'move-in', direction: legacy[1] };
  const match = /^(move-in|move-out|push|slide-in|slide-out)-(left|right|up|down)$/.exec(transition || '');
  if (!match || !transitionTypes.has(match[1])) {
    throw new TypeError('Unsupported overlay transition; use dissolve or a supported directional transition.');
  }
  return { type: match[1], direction: match[2] };
}

/** Reverse an overlay's presentation transition for Back/outside dismissal. */
export function reversePrototypeOverlayTransition(transition) {
  if (transition === 'instant' || transition === 'dissolve') return transition;
  const parts = parseTransition(transition);
  if (!parts || parts.type === 'dissolve') throw new TypeError('Cannot reverse an unsupported overlay transition.');
  return `${reverseTypes[parts.type]}-${reverseDirections[parts.direction]}`;
}

/**
 * Compute one overlay surface's normalized transform and opacity.
 *
 * `x` and `y` are viewport fractions (1 is one full viewport), so callers can
 * apply them as percentages or multiply by their current canvas dimensions.
 * The underlay is deliberately not part of this result and must remain fixed.
 * `role` is either `enter` (the replacement overlay) or `exit` (the old one).
 * Progress is clamped to [0, 1].
 *
 * Direction names describe travel. Thus `move-in-left` starts one viewport
 * to the right and travels left. For replacement overlays, Push moves the old
 * overlay out while the new one enters along the same path. Slide In moves the
 * new overlay over a fading old overlay; Slide Out moves the old overlay out
 * while the replacement fades in. Move Out keeps the entering replacement
 * stationary beneath the exiting surface. Those pairings are an explicit
 * policy for single-surface overlay rendering; Figma's frame-transition
 * descriptions do not fully specify every overlay-to-overlay pairing.
 *
 * @param {string} transition A supported transition name.
 * @param {number} width Positive viewport width (validated; normalization is independent of aspect ratio).
 * @param {number} height Positive viewport height.
 * @param {number} progress Animation progress; values outside [0, 1] are clamped.
 * @param {'enter'|'exit'} role Which overlay surface is being animated.
 * @returns {{x:number,y:number,opacity:number}} Normalized position and alpha.
 */
export function prototypeOverlayMotion(transition, width, height, progress, role = 'enter') {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError('Overlay viewport dimensions must be finite and positive.');
  }
  if (!Number.isFinite(progress)) throw new TypeError('Overlay transition progress must be finite.');
  if (role !== 'enter' && role !== 'exit') throw new TypeError('Overlay role must be enter or exit.');

  const amount = Math.max(0, Math.min(1, progress));
  const parts = parseTransition(transition);
  if (parts.type === 'dissolve') {
    return { x: 0, y: 0, opacity: role === 'enter' ? amount : 1 - amount };
  }

  const [dx, dy] = directions[parts.direction];
  const enteringMotion = (parts.type === 'move-in' || parts.type === 'push' || parts.type === 'slide-in');
  const exitingMotion = (parts.type === 'move-in' || parts.type === 'move-out' || parts.type === 'push' || parts.type === 'slide-out');

  if (role === 'enter') {
    if (enteringMotion) return {
      x: dx ? -dx * (1 - amount) : 0,
      y: dy ? -dy * (1 - amount) : 0,
      opacity: 1
    };
    if (parts.type === 'slide-out') return { x: 0, y: 0, opacity: amount };
    // Move Out's replacement is already underneath the departing surface.
    return { x: 0, y: 0, opacity: 1 };
  }

  if (exitingMotion) return {
    x: dx ? dx * amount : 0,
    y: dy ? dy * amount : 0,
    opacity: 1
  };
  if (parts.type === 'slide-in') return { x: 0, y: 0, opacity: 1 - amount };
  // Move Out keeps the exiting surface beneath the replacement until it is
  // removed; only the replacement layer changes in that transition.
  return { x: 0, y: 0, opacity: 1 };
}
