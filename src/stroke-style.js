const caps = new Set(['butt', 'round', 'square']);
const joins = new Set(['miter', 'round', 'bevel']);
const patterns = new Set(['solid', 'dashed', 'dotted', 'custom']);

export const MAX_STROKE_DASH_SEGMENTS = 16;
export const MAX_STROKE_DASH_LENGTH = 100_000;

function dashLength(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return Number.NaN;
}

/** Canonicalize SVG/Figma alternating dash and gap lengths to an even list. */
export function normalizeStrokeDashArray(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_STROKE_DASH_SEGMENTS) return null;
  const dash = Array.from(value, dashLength);
  if (dash.some(item => !Number.isFinite(item) || item < 0 || item > MAX_STROKE_DASH_LENGTH)
    || dash.every(item => item === 0)) return null;
  const normalized = dash.length % 2 ? [...dash, ...dash] : dash;
  return normalized.length <= MAX_STROKE_DASH_SEGMENTS ? normalized : null;
}

export function isValidStrokeDashArray(value) {
  return Array.isArray(value) && value.length >= 2 && value.length <= MAX_STROKE_DASH_SEGMENTS
    && value.length % 2 === 0
    && Array.from(value).every(item => Number.isFinite(item) && item >= 0 && item <= MAX_STROKE_DASH_LENGTH)
    && Array.from(value).some(item => item > 0);
}

/** Figma's default dashed rhythm, bounded for zero and very thick strokes. */
export function defaultStrokeDashArray(width = 1) {
  const numericWidth = typeof width === 'number' ? width
    : typeof width === 'string' && width.trim() ? Number(width) : Number.NaN;
  const strokeWidth = Number.isFinite(numericWidth) ? Math.max(0, numericWidth) : 1;
  return [
    Math.min(MAX_STROKE_DASH_LENGTH, Math.max(1, strokeWidth * 4)),
    Math.min(MAX_STROKE_DASH_LENGTH, Math.max(1, strokeWidth * 2))
  ];
}

/** Parse the Inspector's px values, accepting spaces or commas between entries. */
export function parseStrokeDashArray(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const tokens = value.trim().split(/[\s,]+/u);
  if (!tokens.length || tokens.length > MAX_STROKE_DASH_SEGMENTS
    || tokens.some(token => !/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(token))) return null;
  return normalizeStrokeDashArray(tokens.map(Number));
}

export function strokeDashArray(node = {}) {
  const width = Math.max(0, Number(node.strokeWidth ?? node.width) || 0);
  if (!width) return [];
  const pattern = node.strokePattern ?? node.pattern;
  if (pattern === 'custom') {
    const custom = node.dashArray ?? node.strokeDashArray;
    return isValidStrokeDashArray(custom) ? [...custom] : [];
  }
  if (pattern === 'dashed') return [width * 4, width * 2];
  if (pattern === 'dotted') return [0, Math.max(width * 2, 1)];
  return [];
}

export function applyStrokeStyle(context, node = {}) {
  const rawPattern = node.strokePattern ?? node.pattern;
  const pattern = patterns.has(rawPattern) ? rawPattern : 'solid';
  const cap = node.strokeCap ?? node.cap;
  const join = node.strokeJoin ?? node.join;
  context.lineCap = pattern === 'dotted' ? 'round' : caps.has(cap) ? cap : 'butt';
  context.lineJoin = joins.has(join) ? join : 'miter';
  const miterLimit = Number(node.strokeMiterLimit ?? node.miterLimit ?? 10);
  context.miterLimit = Number.isFinite(miterLimit) && miterLimit >= 1 && miterLimit <= 1000 ? miterLimit : 10;
  context.setLineDash(strokeDashArray({ ...node, strokeWidth: node.strokeWidth ?? node.width, strokePattern: pattern }));
}
