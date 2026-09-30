export const cornerRadiusKeys = Object.freeze(['topLeft', 'topRight', 'bottomRight', 'bottomLeft']);

const maxCornerRadius = 100_000;

export function isValidCornerRadii(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === cornerRadiusKeys.length
    && cornerRadiusKeys.every(key => Object.hasOwn(value, key)
      && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= maxCornerRadius));
}

export function cornerRadiiForNode(node, fallback = node?.radius ?? 0) {
  if (isValidCornerRadii(node?.cornerRadii)) return { ...node.cornerRadii };
  const radius = Number.isFinite(Number(fallback)) ? Math.max(0, Math.min(maxCornerRadius, Number(fallback))) : 0;
  return Object.fromEntries(cornerRadiusKeys.map(key => [key, radius]));
}

export function clampCornerRadii(width, height, values) {
  const w = Math.max(0, Math.abs(Number(width) || 0));
  const h = Math.max(0, Math.abs(Number(height) || 0));
  const radii = cornerRadiiForNode({ cornerRadii: values }, 0);
  const ratios = [
    radii.topLeft + radii.topRight ? w / (radii.topLeft + radii.topRight) : 1,
    radii.bottomLeft + radii.bottomRight ? w / (radii.bottomLeft + radii.bottomRight) : 1,
    radii.topLeft + radii.bottomLeft ? h / (radii.topLeft + radii.bottomLeft) : 1,
    radii.topRight + radii.bottomRight ? h / (radii.topRight + radii.bottomRight) : 1
  ];
  const scale = Math.min(1, ...ratios);
  return Object.fromEntries(cornerRadiusKeys.map(key => [key, radii[key] * scale]));
}

export function traceRoundedRectPath(ctx, x, y, width, height, values) {
  const radii = clampCornerRadii(width, height, typeof values === 'number'
    ? Object.fromEntries(cornerRadiusKeys.map(key => [key, values]))
    : values);
  const signX = Math.sign(width) || 1;
  const signY = Math.sign(height) || 1;
  const { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl } = radii;
  ctx.moveTo(x + signX * tl, y);
  ctx.lineTo(x + width - signX * tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + signY * tr);
  ctx.lineTo(x + width, y + height - signY * br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - signX * br, y + height);
  ctx.lineTo(x + signX * bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - signY * bl);
  ctx.lineTo(x, y + signY * tl);
  ctx.quadraticCurveTo(x, y, x + signX * tl, y);
}

export function roundedRectSvgPath(width, height, values) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const radii = clampCornerRadii(w, h, values);
  const { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl } = radii;
  return `M ${tl} 0 L ${w - tr} 0 Q ${w} 0 ${w} ${tr} L ${w} ${h - br} Q ${w} ${h} ${w - br} ${h} L ${bl} ${h} Q 0 ${h} 0 ${h - bl} L 0 ${tl} Q 0 0 ${tl} 0 Z`;
}

export function containsPointInRoundedRect(x, y, width, height, values) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const radii = clampCornerRadii(w, h, values);
  let radius = 0; let centerX = 0; let centerY = 0;
  if (x < radii.topLeft && y < radii.topLeft) { radius = radii.topLeft; centerX = radius; centerY = radius; }
  else if (x > w - radii.topRight && y < radii.topRight) { radius = radii.topRight; centerX = w - radius; centerY = radius; }
  else if (x > w - radii.bottomRight && y > h - radii.bottomRight) { radius = radii.bottomRight; centerX = w - radius; centerY = h - radius; }
  else if (x < radii.bottomLeft && y > h - radii.bottomLeft) { radius = radii.bottomLeft; centerX = radius; centerY = h - radius; }
  if (!radius) return true;
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2 + 1e-9;
}
