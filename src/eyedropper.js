const DEFAULT_SAMPLE_BACKGROUND = '#e9e9e9';

/** Reuse an offscreen canvas at a stable viewport size to avoid per-sample allocations. */
export function resizeCanvasSurface(surface, width, height, createSurface) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('A sampling surface needs positive integer dimensions.');
  }
  const target = surface || createSurface?.();
  if (!target) throw new TypeError('A sampling surface factory is required.');
  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;
  return target;
}

function parseHexColor(value) {
  if (typeof value !== 'string') return null;
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map(char => char + char).join('') : match[1];
  return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
}

/** Convert a client-space point to a backing-store pixel, returning null outside the canvas. */
export function canvasPixelFromClientPoint({ clientX, clientY, rect, pixelWidth, pixelHeight }) {
  if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)
    || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)
    || rect.width <= 0 || rect.height <= 0
    || !Number.isInteger(pixelWidth) || !Number.isInteger(pixelHeight)
    || pixelWidth <= 0 || pixelHeight <= 0) return null;
  const x = Math.floor((clientX - rect.left) * pixelWidth / rect.width);
  const y = Math.floor((clientY - rect.top) * pixelHeight / rect.height);
  return x >= 0 && y >= 0 && x < pixelWidth && y < pixelHeight ? { x, y } : null;
}

/** Read one RGBA pixel and return its visible opaque hex color. */
export function sampleColorAt(imageData, x, y, { background = DEFAULT_SAMPLE_BACKGROUND } = {}) {
  if (!imageData || !Number.isInteger(imageData.width) || !Number.isInteger(imageData.height)
    || imageData.width <= 0 || imageData.height <= 0
    || !Number.isInteger(x) || !Number.isInteger(y)
    || x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return null;
  const data = imageData.data;
  const offset = (y * imageData.width + x) * 4;
  if (!data || data.length < offset + 4) return null;
  const alpha = data[offset + 3] / 255;
  const backdrop = parseHexColor(background);
  if (!backdrop) throw new TypeError('Eyedropper background must be a 3- or 6-digit hex color.');
  const channels = [0, 1, 2].map(index => Math.round(data[offset + index] * alpha + backdrop[index] * (1 - alpha)));
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}
