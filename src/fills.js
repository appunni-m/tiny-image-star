export const gradientTypes = new Set(['linear', 'radial']);

export function isValidGradientFill(gradient) {
  if (!gradient || !gradientTypes.has(gradient.type) || !Array.isArray(gradient.stops)
    || gradient.stops.length < 2 || gradient.stops.length > 8
    || !Number.isFinite(gradient.angle) || gradient.angle < 0 || gradient.angle >= 360) return false;
  const ids = new Set();
  let previousPosition = -1;
  for (const stop of gradient.stops) {
    if (!stop || typeof stop.id !== 'string' || !stop.id || ids.has(stop.id)
      || !/^#[0-9a-f]{6}$/i.test(stop.color) || !Number.isFinite(stop.position) || stop.position < 0 || stop.position > 1) return false;
    if (stop.position < previousPosition) return false;
    previousPosition = stop.position;
    ids.add(stop.id);
  }
  return true;
}

export function createGradientPaint(ctx, gradient, x, y, width, height) {
  if (!isValidGradientFill(gradient)) return null;
  width = Math.max(1, width);
  height = Math.max(1, height);
  let paint;
  if (gradient.type === 'linear') {
    const angle = gradient.angle * Math.PI / 180;
    const halfLength = Math.abs(Math.cos(angle)) * width / 2 + Math.abs(Math.sin(angle)) * height / 2;
    const centerX = x + width / 2; const centerY = y + height / 2;
    paint = ctx.createLinearGradient(centerX - Math.cos(angle) * halfLength, centerY - Math.sin(angle) * halfLength, centerX + Math.cos(angle) * halfLength, centerY + Math.sin(angle) * halfLength);
  } else {
    const radius = Math.max(1, Math.hypot(width, height) / 2);
    paint = ctx.createRadialGradient(x + width / 2, y + height / 2, 0, x + width / 2, y + height / 2, radius);
  }
  for (const stop of gradient.stops) paint.addColorStop(stop.position, stop.color);
  return paint;
}

function rgba(color, opacity) {
  const value = Number.parseInt(color.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(0, Math.min(1, opacity))})`;
}

export function gradientFillToCSS(gradient, opacity = 1) {
  if (!isValidGradientFill(gradient)) return null;
  const stops = gradient.stops.map(stop => `${rgba(stop.color, opacity)} ${Number((stop.position * 100).toFixed(3))}%`).join(', ');
  return gradient.type === 'linear'
    ? `linear-gradient(${(gradient.angle + 90) % 360}deg, ${stops})`
    : `radial-gradient(circle, ${stops})`;
}
