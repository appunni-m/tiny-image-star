export const gradientTypes = new Set(['linear', 'radial']);
export const fillTypes = new Set(['solid', 'linear', 'radial', 'image']);

const clone = value => structuredClone(value);

/**
 * Return a node's ordered fill stack. Older documents have a single fill in
 * `fill`, `fillGradient`, or `imageFill`; expose that paint as a stable one-item
 * stack without changing the document until the user edits it.
 */
export function fillStackForNode(node) {
  if (!node) return [];
  if (Array.isArray(node.fills)) return node.fills;
  const base = { id: `legacy-fill:${node.id || 'node'}`, visible: true, opacity: node.fillOpacity ?? 1 };
  if (node.imageFill) return [{ ...base, type: 'image', imageFill: clone(node.imageFill) }];
  if (node.fillGradient) return [{ ...base, type: node.fillGradient.type, gradient: clone(node.fillGradient) }];
  return [{ ...base, type: 'solid', color: typeof node.fill === 'string' ? node.fill : '#d9d9d9' }];
}

/** Materialize the compatibility representation when changing a legacy fill. */
export function ensureFillStack(node) {
  if (!Array.isArray(node.fills)) node.fills = fillStackForNode(node).map(fill => clone(fill));
  return node.fills;
}

export function addFillLayer(node, fill) {
  const fills = ensureFillStack(node);
  if (fills.length >= 32 || !fill || typeof fill.id !== 'string' || fills.some(item => item.id === fill.id)) return false;
  fills.push(clone(fill));
  syncLegacyFillFields(node);
  return true;
}

export function removeFillLayer(node, fillId) {
  const fills = ensureFillStack(node);
  const index = fills.findIndex(fill => fill.id === fillId);
  if (index < 0) return null;
  const [removed] = fills.splice(index, 1);
  syncLegacyFillFields(node);
  return removed;
}

/** Move a fill one slot earlier (up) or later (down) in its compositing order. */
export function moveFillLayer(node, fillId, direction) {
  const fills = ensureFillStack(node);
  const index = fills.findIndex(fill => fill.id === fillId);
  const destination = index + (direction === 'up' ? -1 : direction === 'down' ? 1 : 0);
  if (index < 0 || destination < 0 || destination >= fills.length || destination === index) return false;
  [fills[index], fills[destination]] = [fills[destination], fills[index]];
  syncLegacyFillFields(node);
  return true;
}

export function updateFillLayer(node, fillId, changes = {}) {
  const fill = ensureFillStack(node).find(item => item.id === fillId);
  if (!fill) return null;
  if (Object.hasOwn(changes, 'visible') && typeof changes.visible === 'boolean') fill.visible = changes.visible;
  if (Object.hasOwn(changes, 'opacity') && Number.isFinite(changes.opacity) && changes.opacity >= 0 && changes.opacity <= 1) fill.opacity = changes.opacity;
  if (Object.hasOwn(changes, 'color') && (typeof changes.color === 'string' && (/^#[0-9a-f]{6}$/i.test(changes.color) || changes.color === 'transparent'))) fill.color = changes.color;
  syncLegacyFillFields(node);
  return fill;
}

/** Keep the first stack item mirrored to the original one-fill fields. */
export function syncLegacyFillFields(node) {
  if (!node || !Array.isArray(node.fills)) return node;
  const primary = node.fills[0];
  if (!primary) {
    node.fill = 'transparent';
    node.fillOpacity = 1;
    delete node.fillGradient;
    delete node.imageFill;
    return node;
  }
  node.fillOpacity = primary.opacity;
  if (primary.type === 'solid') {
    node.fill = primary.color;
    delete node.fillGradient;
    delete node.imageFill;
  } else if (primary.type === 'linear' || primary.type === 'radial') {
    node.fillGradient = clone(primary.gradient);
    delete node.imageFill;
  } else if (primary.type === 'image') {
    node.imageFill = clone(primary.imageFill);
    delete node.fillGradient;
  }
  return node;
}

/** Keep a node-level color binding from following a different paint into the primary slot. */
export function detachPrimaryFillBinding(node, previousPrimary, resolvedColor) {
  if (!node || !(node.fillStyleId || node.fillVariableId || node.variableBindings?.fill)) return false;
  if (Array.isArray(node.fills) && node.fills.includes(previousPrimary) && previousPrimary?.type === 'solid'
    && typeof resolvedColor === 'string' && (/^#[0-9a-f]{6}$/i.test(resolvedColor) || resolvedColor === 'transparent')) {
    previousPrimary.color = resolvedColor;
  }
  delete node.fillStyleId;
  delete node.fillVariableId;
  if (node.variableBindings) {
    delete node.variableBindings.fill;
    if (!Object.keys(node.variableBindings).length) delete node.variableBindings;
  }
  return true;
}

export function isFillStackSupported(node) {
  if (!node) return false;
  return ['frame', 'section', 'group', 'boolean', 'rectangle', 'ellipse', 'star', 'polygon'].includes(node.type)
    || (node.type === 'path' && node.closed === true)
    || (node.type === 'network' && Array.isArray(node.faces) && node.faces.length > 0);
}

export function isValidFillLayer(fill, node = null, { isValidImageFill = () => false, isImageFillSupported = () => false } = {}) {
  if (!fill || typeof fill !== 'object' || Array.isArray(fill)
    || typeof fill.id !== 'string' || !fill.id || fill.id.length > 256
    || !fillTypes.has(fill.type) || typeof fill.visible !== 'boolean'
    || !Number.isFinite(fill.opacity) || fill.opacity < 0 || fill.opacity > 1) return false;
  if (fill.type === 'solid') return typeof fill.color === 'string' && (/^#[0-9a-f]{6}$/i.test(fill.color) || fill.color === 'transparent');
  if (fill.type === 'linear' || fill.type === 'radial') return fill.gradient?.type === fill.type && isValidGradientFill(fill.gradient);
  return Boolean(node && isImageFillSupported(node) && isValidImageFill(fill.imageFill));
}

export function isValidFillStack(fills, node, imageFillValidators = {}) {
  if (!Array.isArray(fills) || fills.length > 32 || (fills.length && !isFillStackSupported(node))) return false;
  const ids = new Set();
  for (const fill of fills) {
    if (!isValidFillLayer(fill, node, imageFillValidators) || ids.has(fill.id)) return false;
    ids.add(fill.id);
  }
  return true;
}

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
