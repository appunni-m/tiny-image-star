const caps = new Set(['butt', 'round', 'square']);
const joins = new Set(['miter', 'round', 'bevel']);
const patterns = new Set(['solid', 'dashed', 'dotted']);

export function strokeDashArray(node = {}) {
  const width = Math.max(0, Number(node.strokeWidth ?? node.width) || 0);
  if (!width) return [];
  if (node.strokePattern === 'dashed') return [width * 4, width * 2];
  if (node.strokePattern === 'dotted') return [0, Math.max(width * 2, 1)];
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
