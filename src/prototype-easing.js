export const PROTOTYPE_EASINGS = Object.freeze([
  'linear', 'ease-in', 'ease-out', 'ease-in-out',
  'ease-in-back', 'ease-out-back', 'ease-in-out-back',
  'spring-gentle', 'spring-quick', 'spring-bouncy', 'spring-slow', 'custom-bezier'
]);

export const DEFAULT_PROTOTYPE_BEZIER = Object.freeze([0.25, 0.1, 0.25, 1]);

const easingSet = new Set(PROTOTYPE_EASINGS);
const springCurves = Object.freeze({
  'spring-gentle': [6, 6],
  'spring-quick': [8, 10],
  'spring-bouncy': [4.5, 9.5],
  'spring-slow': [4, 5]
});

export function isValidPrototypeBezier(bezier) {
  return Array.isArray(bezier) && bezier.length === 4
    && bezier.every(Number.isFinite)
    && bezier[0] >= 0 && bezier[0] <= 1
    && bezier[2] >= 0 && bezier[2] <= 1
    && bezier[1] >= -2 && bezier[1] <= 2
    && bezier[3] >= -2 && bezier[3] <= 2;
}

export function isValidPrototypeEasing(easing, bezier) {
  if (easing == null) return bezier == null;
  if (!easingSet.has(easing)) return false;
  return easing === 'custom-bezier'
    ? isValidPrototypeBezier(bezier)
    : bezier == null;
}

function cubicCoordinate(t, a, b) {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * a + 3 * inverse * t * t * b + t * t * t;
}

function cubicDerivative(t, a, b) {
  const inverse = 1 - t;
  return 3 * inverse * inverse * a + 6 * inverse * t * (b - a) + 3 * t * t * (1 - b);
}

function cubicBezierProgress(value, bezier) {
  const [x1, y1, x2, y2] = isValidPrototypeBezier(bezier) ? bezier : DEFAULT_PROTOTYPE_BEZIER;
  let parameter = value;
  for (let index = 0; index < 8; index += 1) {
    const difference = cubicCoordinate(parameter, x1, x2) - value;
    const slope = cubicDerivative(parameter, x1, x2);
    if (Math.abs(difference) < 1e-7 || Math.abs(slope) < 1e-7) break;
    parameter = Math.max(0, Math.min(1, parameter - difference / slope));
  }
  let low = 0;
  let high = 1;
  for (let index = 0; index < 20; index += 1) {
    const x = cubicCoordinate(parameter, x1, x2);
    if (Math.abs(x - value) < 1e-7) break;
    if (x < value) low = parameter;
    else high = parameter;
    parameter = (low + high) / 2;
  }
  return cubicCoordinate(parameter, y1, y2);
}

function springProgress(value, easing) {
  const [decay, frequency] = springCurves[easing] || springCurves['spring-gentle'];
  const response = time => 1 - Math.exp(-decay * time)
    * (Math.cos(frequency * time) + decay / frequency * Math.sin(frequency * time));
  const terminal = response(1);
  return terminal > 1e-6 ? response(value) / terminal : value;
}

export function easePrototypeProgress(progress, easing = 'ease-in-out', bezier = DEFAULT_PROTOTYPE_BEZIER) {
  const value = Math.max(0, Math.min(1, Number.isFinite(Number(progress)) ? Number(progress) : 0));
  if (easing === 'linear') return value;
  if (easing === 'ease-in') return value * value;
  if (easing === 'ease-out') return 1 - (1 - value) ** 2;
  if (easing === 'ease-in-back') {
    const overshoot = 1.70158;
    return (overshoot + 1) * value ** 3 - overshoot * value ** 2;
  }
  if (easing === 'ease-out-back') {
    const overshoot = 1.70158;
    return 1 + (overshoot + 1) * (value - 1) ** 3 + overshoot * (value - 1) ** 2;
  }
  if (easing === 'ease-in-out-back') {
    const overshoot = 1.70158 * 1.525;
    return value < 0.5
      ? (2 * value) ** 2 * ((overshoot + 1) * 2 * value - overshoot) / 2
      : ((2 * value - 2) ** 2 * ((overshoot + 1) * (value * 2 - 2) + overshoot) + 2) / 2;
  }
  if (easing?.startsWith('spring-')) return springProgress(value, easing);
  if (easing === 'custom-bezier') return cubicBezierProgress(value, bezier);
  return value * value * (3 - 2 * value);
}

export function prototypeEasingTimingFunction(easing = 'ease-in-out', bezier = DEFAULT_PROTOTYPE_BEZIER) {
  if (easing?.startsWith('spring-')) return 'ease-in-out';
  if (easing === 'custom-bezier') {
    const curve = isValidPrototypeBezier(bezier) ? bezier : DEFAULT_PROTOTYPE_BEZIER;
    return `cubic-bezier(${curve.join(', ')})`;
  }
  if (easing === 'ease-in-back') return 'cubic-bezier(0.36, 0, 0.66, -0.56)';
  if (easing === 'ease-out-back') return 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  if (easing === 'ease-in-out-back') return 'cubic-bezier(0.68, -0.6, 0.32, 1.6)';
  return easingSet.has(easing) ? easing : 'ease-in-out';
}
