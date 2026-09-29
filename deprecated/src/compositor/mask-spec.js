import { INITIAL_HEAP_BYTES, MiB, MAX_SOURCE_BYTES } from "../processing/policy.js";

const check = (condition, message) => { if (!condition) { const error = new Error(message); error.userMessage = message; throw error; } };
const unit = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
export function validateMaskStroke(stroke) {
  check(stroke && ["restore", "erase"].includes(stroke.mode), "Choose Restore or Erase for the brush.");
  check(Object.keys(stroke).every((key) => ["mode", "radius", "hardness", "opacity", "points"].includes(key)), "Unsupported mask brush setting.");
  check(Number.isFinite(stroke.radius) && stroke.radius > 0 && stroke.radius <= .25 && unit(stroke.hardness) && unit(stroke.opacity), "The brush settings are outside their limits.");
  check(Array.isArray(stroke.points) && stroke.points.length > 0 && stroke.points.length <= 512, "Use a shorter brush stroke.");
  for (const point of stroke.points) check(Array.isArray(point) && point.length === 2 && point.every(unit), "Brush points must stay inside the photo.");
  return stroke;
}

export function validateMaskRegion(region, width, height) {
  if (region == null) return null;
  check(region && Object.keys(region).length === 4 && ["x", "y", "width", "height"].every((key) => Number.isSafeInteger(region[key]))
    && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0 && region.width <= 1024 && region.height <= 1024
    && region.x + region.width <= width && region.y + region.height <= height, "The cutout detail area must stay inside the photo and within 1024 pixels per side.");
  return region;
}

export function maskWork({ width, height, encodedBytes = 0, previewEdge = 1024, previewRegion }) {
  check(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= 80_000_000, "The mask needs valid upright photo dimensions.");
  check(Number.isSafeInteger(encodedBytes) && encodedBytes >= 0 && encodedBytes <= MAX_SOURCE_BYTES, "These cutout sources are too large.");
  check(Number.isInteger(previewEdge) && previewEdge >= 64 && previewEdge <= 1024, "Unsupported cutout preview size.");
  validateMaskRegion(previewRegion, width, height);
  const pixels = width * height, preview = Math.min(pixels, previewEdge * previewEdge);
  return { heap: INITIAL_HEAP_BYTES + pixels * 24 + encodedBytes * 3,
    transient: pixels * 3 + encodedBytes * 2 + preview * 24 + 4 * MiB, output: pixels + preview * 12 + 4 * MiB, cpu: 1 };
}

// One stroke uses the maximum coverage of its segments. Sampling density and
// retracing the same path cannot inadvertently apply opacity several times.
export function paintMask(pixels, width, height, stroke) {
  validateMaskStroke(stroke);
  check(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= 80_000_000
    && pixels instanceof Uint8Array && pixels.length === width * height, "The mask pixel plane does not match the photo.");
  const radius = stroke.radius * Math.min(width, height), inner = radius * stroke.hardness;
  const points = stroke.points.map(([x, y]) => [x * width, y * height]);
  const coverage = new Uint8Array(pixels.length);
  for (let index = 0; index < points.length; index++) {
    const a = points[Math.max(0, index - 1)], b = points[index], dx = b[0] - a[0], dy = b[1] - a[1], squared = dx * dx + dy * dy;
    const left = Math.max(0, Math.floor(Math.min(a[0], b[0]) - radius)), right = Math.min(width, Math.ceil(Math.max(a[0], b[0]) + radius));
    const top = Math.max(0, Math.floor(Math.min(a[1], b[1]) - radius)), bottom = Math.min(height, Math.ceil(Math.max(a[1], b[1]) + radius));
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const t = squared ? Math.max(0, Math.min(1, ((x + .5 - a[0]) * dx + (y + .5 - a[1]) * dy) / squared)) : 0;
      const distance = Math.hypot(x + .5 - a[0] - t * dx, y + .5 - a[1] - t * dy);
      const amount = distance <= inner ? 255 : distance >= radius ? 0 : Math.round(255 * (radius - distance) / (radius - inner));
      const offset = y * width + x; coverage[offset] = Math.max(coverage[offset], amount);
    }
  }
  for (let index = 0; index < pixels.length; index++) {
    const alpha = coverage[index] / 255 * stroke.opacity;
    pixels[index] = Math.round(stroke.mode === "restore" ? pixels[index] + (255 - pixels[index]) * alpha : pixels[index] * (1 - alpha));
  }
  return pixels;
}
