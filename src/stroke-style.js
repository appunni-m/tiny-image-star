const caps = new Set(['butt', 'round', 'square']);
const joins = new Set(['miter', 'round', 'bevel']);
const patterns = new Set(['solid', 'dashed', 'dotted']);

export function strokeDashArray(node = {}) {
  const width = Math.max(0, Number(node.strokeWidth) || 0);
  if (!width) return [];
  if (node.strokePattern === 'dashed') return [width * 4, width * 2];
  if (node.strokePattern === 'dotted') return [0, Math.max(width * 2, 1)];
  return [];
}

export function applyStrokeStyle(context, node = {}) {
  const pattern = patterns.has(node.strokePattern) ? node.strokePattern : 'solid';
  context.lineCap = pattern === 'dotted' ? 'round' : caps.has(node.strokeCap) ? node.strokeCap : 'butt';
  context.lineJoin = joins.has(node.strokeJoin) ? node.strokeJoin : 'miter';
  const miterLimit = Number(node.strokeMiterLimit ?? 10);
  context.miterLimit = Number.isFinite(miterLimit) && miterLimit >= 1 && miterLimit <= 1000 ? miterLimit : 10;
  context.setLineDash(strokeDashArray({ ...node, strokePattern: pattern }));
}
