export const MAX_PROGRESSIVE_BLUR_STEPS = 6;

export function isValidProgressiveBlur(effect) {
  if (!effect || (effect.blurType != null && !['NORMAL', 'PROGRESSIVE'].includes(effect.blurType))) return false;
  if (effect.blurType !== 'PROGRESSIVE') return true;
  const start = effect.startOffset;
  const end = effect.endOffset;
  return Number.isFinite(effect.startRadius) && effect.startRadius >= 0 && effect.startRadius <= 100
    && [start?.x, start?.y, end?.x, end?.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    && (Math.abs(start.x - end.x) > Number.EPSILON || Math.abs(start.y - end.y) > Number.EPSILON);
}

export function progressiveBlurWeights(progress, count) {
  if (!Number.isInteger(count) || count < 2) return [];
  const position = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) * (count - 1);
  return Array.from({ length: count }, (_, index) => Math.max(0, 1 - Math.abs(position - index)));
}

export function progressiveBlurStepCount(effect, pixelArea = 0) {
  const radiusDifference = Math.abs((Number(effect?.radius) || 0) - (Number(effect?.startRadius) || 0));
  if (radiusDifference < 0.01) return 2;
  const pixelLimit = pixelArea > 1_000_000 ? 2 : pixelArea > 250_000 ? 4 : MAX_PROGRESSIVE_BLUR_STEPS;
  return Math.min(pixelLimit, MAX_PROGRESSIVE_BLUR_STEPS, Math.max(2, Math.ceil(radiusDifference / 16) + 1));
}
