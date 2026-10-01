import { vectorPathContours } from './vector-path.js';

export const gradientTypes = new Set(['linear', 'radial', 'angular']);
export const fillTypes = new Set(['solid', 'linear', 'radial', 'angular', 'image']);

const clone = value => structuredClone(value);
const MAX_GRADIENT_HANDLE_COORDINATE = 1_000_000;
const MIN_GRADIENT_BASIS_SINE = Number.EPSILON * 16;

/**
 * Check whether three affine gradient handles define a numerically stable 2D
 * basis. Normalizing each axis first makes this criterion independent of
 * coordinate scale and avoids overflow/underflow in the raw determinant.
 */
export function isValidGradientBasis(handles) {
  if (!Array.isArray(handles) || handles.length !== 3
    || handles.some(point => !point || typeof point !== 'object' || Array.isArray(point)
      || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  const [origin, xAxis, yAxis] = handles;
  const ux = xAxis.x - origin.x;
  const uy = xAxis.y - origin.y;
  const vx = yAxis.x - origin.x;
  const vy = yAxis.y - origin.y;
  const uLength = Math.hypot(ux, uy);
  const vLength = Math.hypot(vx, vy);
  if (!(uLength > 0) || !(vLength > 0) || !Number.isFinite(uLength) || !Number.isFinite(vLength)) return false;
  const normalizedDeterminant = (ux / uLength) * (vy / vLength) - (uy / uLength) * (vx / vLength);
  return Number.isFinite(normalizedDeterminant) && Math.abs(normalizedDeterminant) > MIN_GRADIENT_BASIS_SINE;
}

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
  } else if (gradientTypes.has(primary.type)) {
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
    || (node.type === 'path' && vectorPathContours(node).some(contour => contour.closed && contour.points.length >= 2))
    || (node.type === 'network' && Array.isArray(node.faces) && node.faces.length > 0);
}

export function isValidFillLayer(fill, node = null, { isValidImageFill = () => false, isImageFillSupported = () => false } = {}) {
  if (!fill || typeof fill !== 'object' || Array.isArray(fill)
    || typeof fill.id !== 'string' || !fill.id || fill.id.length > 256
    || !fillTypes.has(fill.type) || typeof fill.visible !== 'boolean'
    || !Number.isFinite(fill.opacity) || fill.opacity < 0 || fill.opacity > 1) return false;
  if (fill.type === 'solid') return typeof fill.color === 'string' && (/^#[0-9a-f]{6}$/i.test(fill.color) || fill.color === 'transparent');
  if (gradientTypes.has(fill.type)) return fill.gradient?.type === fill.type && isValidGradientFill(fill.gradient);
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
  if (Object.hasOwn(gradient, 'geometry') && !isValidGradientGeometry(gradient.type, gradient.geometry)) return false;
  const ids = new Set();
  let previousPosition = -1;
  for (const stop of gradient.stops) {
    if (!stop || typeof stop.id !== 'string' || !stop.id || ids.has(stop.id)
      || !/^#[0-9a-f]{6}$/i.test(stop.color) || !Number.isFinite(stop.position) || stop.position < 0 || stop.position > 1) return false;
    if (Object.hasOwn(stop, 'opacity') && (!Number.isFinite(stop.opacity) || stop.opacity < 0 || stop.opacity > 1)) return false;
    if (stop.position < previousPosition) return false;
    previousPosition = stop.position;
    ids.add(stop.id);
  }
  return true;
}

/** Validate the normalized, object-space points used by editable gradient geometry. */
function isValidGradientGeometry(type, geometry) {
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)
    || !Array.isArray(geometry.handles) || geometry.handles.length !== 3) return false;
  const handles = geometry.handles;
  if (handles.some(point => !point || typeof point !== 'object' || Array.isArray(point)
    || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || Math.abs(point.x) > MAX_GRADIENT_HANDLE_COORDINATE
    || Math.abs(point.y) > MAX_GRADIENT_HANDLE_COORDINATE)) return false;
  if (type !== 'linear' && type !== 'radial') return false;
  return isValidGradientBasis(handles);
}

/**
 * Resolve normalized object-space gradient handles to local pixel coordinates.
 * Bounds may include an x/y offset; omitted offsets are treated as zero.
 * Legacy gradients receive transient equivalent handles without changing the
 * document. `source` identifies whether the points are authored or derived.
 */
export function resolveGradientGeometry(gradient, bounds) {
  if (!isValidGradientFill(gradient) || !bounds || typeof bounds !== 'object' || Array.isArray(bounds)) return null;
  if (gradient.type === 'angular') return null;
  const x = bounds.x === undefined ? 0 : bounds.x;
  const y = bounds.y === undefined ? 0 : bounds.y;
  let { width, height } = bounds;
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) return null;
  const source = Object.hasOwn(gradient, 'geometry') ? 'geometry' : 'legacy';
  // SVG export and the canvas renderer both resolve empty/tiny axes to one
  // pixel. Keep authored normalized geometry aligned with that behavior too.
  width = Math.max(1, width);
  height = Math.max(1, height);
  let handles;
  if (source === 'geometry') {
    handles = gradient.geometry.handles.map(point => ({
      x: x + point.x * width,
      y: y + point.y * height
    }));
  } else if (gradient.type === 'linear') {
    // Match the existing angle-only line exactly. The third point is a
    // perpendicular basis handle, allowing an editor to persist this derived
    // geometry later without changing the gradient's current projection.
    const angle = gradient.angle * Math.PI / 180;
    const halfLength = Math.abs(Math.cos(angle)) * width / 2 + Math.abs(Math.sin(angle)) * height / 2;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const dx = Math.cos(angle) * halfLength;
    const dy = Math.sin(angle) * halfLength;
    handles = [
      { x: centerX - dx, y: centerY - dy },
      { x: centerX + dx, y: centerY + dy },
      { x: centerX - dx - Math.sin(angle) * halfLength, y: centerY - dy + Math.cos(angle) * halfLength }
    ];
  } else {
    const radius = Math.max(1, Math.hypot(width, height) / 2);
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    handles = [
      { x: centerX, y: centerY },
      { x: centerX + radius, y: centerY },
      { x: centerX, y: centerY + radius }
    ];
  }
  if (handles.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;

  // The authored basis was checked in normalized coordinates above. Testing
  // its raw pixel-space determinant here would spuriously reject valid small
  // scales when the product underflows; legacy output retains its historical
  // nonzero check and coordinate math.
  if (source === 'legacy') {
    const [origin, xAxis, yAxis] = handles;
    const determinant = (xAxis.x - origin.x) * (yAxis.y - origin.y)
      - (xAxis.y - origin.y) * (yAxis.x - origin.x);
    if (!Number.isFinite(determinant) || determinant === 0) return null;
  }
  return { type: gradient.type, handles, source };
}

/** Sample an opaque six-digit-hex gradient at a normalized position. */
export function sampleGradientColor(gradient, position) {
  if (!gradient || typeof gradient !== 'object' || Array.isArray(gradient) || !isValidGradientFill(gradient)
    || !Number.isFinite(position) || position < 0 || position > 1) return null;
  const stops = gradient.stops;
  if (position <= stops[0].position) return stops[0].color;
  if (position >= stops.at(-1).position) return stops.at(-1).color;

  const rightIndex = stops.findIndex(stop => stop.position >= position);
  const left = stops[rightIndex - 1];
  const right = stops[rightIndex];
  if (position === right.position || right.position === left.position) return right.color;

  const amount = (position - left.position) / (right.position - left.position);
  const channels = [1, 3, 5].map(offset => {
    const from = Number.parseInt(left.color.slice(offset, offset + 2), 16);
    const to = Number.parseInt(right.color.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * amount).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

/** Set a gradient stop's normalized alpha without mutating invalid gradients. */
export function setGradientStopOpacity(gradient, stopId, opacity) {
  if (!isValidGradientFill(gradient) || typeof stopId !== 'string' || !Number.isFinite(opacity)) return false;
  const stop = gradient.stops.find(item => item.id === stopId);
  if (!stop) return false;
  stop.opacity = Math.max(0, Math.min(1, opacity));
  return true;
}

function sampleGradientOpacity(gradient, position) {
  const stops = gradient.stops;
  if (position <= stops[0].position) return stops[0].opacity ?? 1;
  if (position >= stops.at(-1).position) return stops.at(-1).opacity ?? 1;
  const rightIndex = stops.findIndex(stop => stop.position >= position);
  const left = stops[rightIndex - 1];
  const right = stops[rightIndex];
  if (position === right.position || right.position === left.position) return right.opacity ?? 1;
  const amount = (position - left.position) / (right.position - left.position);
  return (left.opacity ?? 1) + ((right.opacity ?? 1) - (left.opacity ?? 1)) * amount;
}

function sampleGradientPaintColor(gradient, position) {
  const color = sampleGradientColor(gradient, position);
  return color ? gradientStopColor({ color, opacity: sampleGradientOpacity(gradient, position) }) : null;
}

/** Return a copied gradient with a sampled stop inserted in stable position order. */
export function insertGradientStop(gradient, position, id) {
  if (!gradient || typeof gradient !== 'object' || Array.isArray(gradient) || !isValidGradientFill(gradient)
    || gradient.stops.length >= 8
    || !Number.isFinite(position) || position < 0 || position > 1
    || typeof id !== 'string' || !id || id.length > 256
    || gradient.stops.some(stop => stop.id === id)) return null;

  const color = sampleGradientColor(gradient, position);
  const copied = clone(gradient);
  const stops = copied.stops;
  const opacity = sampleGradientOpacity(gradient, position);
  stops.push({ id, color, ...(opacity === 1 ? {} : { opacity }), position });
  stops.sort((left, right) => left.position - right.position);
  return copied;
}

export function createGradientPaint(ctx, gradient, x, y, width, height) {
  if (!isValidGradientFill(gradient)) return null;
  if (gradient.type === 'angular') {
    if (typeof ctx.createConicGradient !== 'function') return null;
    width = Math.max(1, width);
    height = Math.max(1, height);
    const startAngle = (gradient.angle - 90) * Math.PI / 180;
    const paint = ctx.createConicGradient(startAngle, x + width / 2, y + height / 2);
    for (const stop of gradient.stops) paint.addColorStop(stop.position, gradientStopColor(stop));
    return paint;
  }
  let paint;
  let geometryStops = false;
  if (Object.hasOwn(gradient, 'geometry')) {
    const geometry = resolveGradientGeometry(gradient, { x, y, width, height });
    if (!geometry) return null;
    const [origin, xAxis, yAxis] = geometry.handles;
    const ux = xAxis.x - origin.x;
    const uy = xAxis.y - origin.y;
    const vx = yAxis.x - origin.x;
    const vy = yAxis.y - origin.y;
    if (geometry.type === 'linear') {
      // A CanvasGradient interpolates perpendicular to its endpoint line. The
      // affine x coordinate is instead perpendicular to the y-axis handle,
      // which differs from the x-axis for skewed bases. Construct that exact
      // gradient line directly in object space, then remap stops over the
      // paint bounds. The current canvas transform still rotates/scales it
      // with the node when createLinearGradient captures its endpoints.
      const yAxisLength = Math.hypot(vx, vy);
      if (!(yAxisLength > 0) || !Number.isFinite(yAxisLength)) return null;
      let normalX = vy / yAxisLength;
      let normalY = -vx / yAxisLength;
      let gradientExtent = normalX * ux + normalY * uy;
      if (gradientExtent < 0) {
        normalX = -normalX;
        normalY = -normalY;
        gradientExtent = -gradientExtent;
      }
      if (!(gradientExtent > 0) || !Number.isFinite(gradientExtent)) return null;

      width = Math.max(1, width);
      height = Math.max(1, height);
      const corners = [
        { x, y }, { x: x + width, y },
        { x, y: y + height }, { x: x + width, y: y + height }
      ];
      const originProjection = normalX * origin.x + normalY * origin.y;
      const projections = corners.map(point => normalX * point.x + normalY * point.y);
      const minimum = Math.min(...projections);
      const maximum = Math.max(...projections);
      const span = maximum - minimum;
      if (![originProjection, minimum, maximum, span].every(Number.isFinite) || span <= 0) return null;

      const startOffset = minimum - originProjection;
      const endOffset = maximum - originProjection;
      const startX = origin.x + normalX * startOffset;
      const startY = origin.y + normalY * startOffset;
      const endX = origin.x + normalX * endOffset;
      const endY = origin.y + normalY * endOffset;
      if (![startX, startY, endX, endY].every(Number.isFinite)
        || (startX === endX && startY === endY)) return null;

      paint = ctx.createLinearGradient(startX, startY, endX, endY);
      const colorAtProjection = projection => {
        const distance = projection - originProjection;
        if (distance <= 0) return gradientStopColor(gradient.stops[0]);
        if (distance >= gradientExtent) return gradientStopColor(gradient.stops.at(-1));
        return sampleGradientPaintColor(gradient, distance / gradientExtent);
      };
      paint.addColorStop(0, colorAtProjection(minimum));
      for (const stop of gradient.stops) {
        const projection = originProjection + stop.position * gradientExtent;
        if (projection <= minimum || projection >= maximum) continue;
        paint.addColorStop(Math.max(0, Math.min(1, (projection - minimum) / span)), gradientStopColor(stop));
      }
      paint.addColorStop(1, colorAtProjection(maximum));
      geometryStops = true;
    } else {
      // Transforming a circle through the object basis produces an editable
      // elliptical radial gradient.
      ctx.save();
      try {
        ctx.transform(ux, uy, vx, vy, origin.x, origin.y);
        paint = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      } finally {
        ctx.restore();
      }
    }
  } else {
    width = Math.max(1, width);
    height = Math.max(1, height);
  }
  if (!Object.hasOwn(gradient, 'geometry') && gradient.type === 'linear') {
    const angle = gradient.angle * Math.PI / 180;
    const halfLength = Math.abs(Math.cos(angle)) * width / 2 + Math.abs(Math.sin(angle)) * height / 2;
    const centerX = x + width / 2; const centerY = y + height / 2;
    paint = ctx.createLinearGradient(centerX - Math.cos(angle) * halfLength, centerY - Math.sin(angle) * halfLength, centerX + Math.cos(angle) * halfLength, centerY + Math.sin(angle) * halfLength);
  } else if (!Object.hasOwn(gradient, 'geometry')) {
    const radius = Math.max(1, Math.hypot(width, height) / 2);
    paint = ctx.createRadialGradient(x + width / 2, y + height / 2, 0, x + width / 2, y + height / 2, radius);
  }
  if (!geometryStops) {
    for (const stop of gradient.stops) paint.addColorStop(stop.position, gradientStopColor(stop));
  }
  return paint;
}

function rgba(color, opacity) {
  const value = Number.parseInt(color.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(0, Math.min(1, opacity))})`;
}

function gradientStopColor(stop) {
  return (stop.opacity ?? 1) === 1 ? stop.color : rgba(stop.color, stop.opacity);
}

function cssNumber(value) {
  return String(Number(value.toFixed(6)));
}

function geometryGradientToCSS(gradient, opacity, bounds) {
  const geometry = resolveGradientGeometry(gradient, { x: 0, y: 0, width: bounds.width, height: bounds.height });
  if (!geometry) return null;
  const stops = gradient.stops.map(stop => ({
    color: rgba(stop.color, opacity * (stop.opacity ?? 1)),
    position: stop.position
  }));
  if (gradient.type === 'linear') {
    const [origin, xAxis, yAxis] = geometry.handles;
    const ux = xAxis.x - origin.x;
    const uy = xAxis.y - origin.y;
    const vx = yAxis.x - origin.x;
    const vy = yAxis.y - origin.y;
    const determinant = ux * vy - uy * vx;
    // The first row of the inverse affine basis gives the authored gradient
    // coordinate. CSS's line is centered and spans the rectangle's extreme
    // projections, so shift and scale the color stops onto that line.
    const gx = vy / determinant;
    const gy = -vx / determinant;
    const corners = [
      { x: 0, y: 0 }, { x: bounds.width, y: 0 },
      { x: 0, y: bounds.height }, { x: bounds.width, y: bounds.height }
    ].map(point => gx * point.x + gy * point.y);
    const gradientOrigin = gx * origin.x + gy * origin.y;
    const minimum = Math.min(...corners) - gradientOrigin;
    const maximum = Math.max(...corners) - gradientOrigin;
    const span = maximum - minimum;
    if (![gx, gy, minimum, maximum, span].every(Number.isFinite) || span <= 0) return null;
    const angle = ((Math.atan2(gx, -gy) * 180 / Math.PI) % 360 + 360) % 360;
    const cssStops = stops.map(stop => {
      const percent = ((stop.position - minimum) / span) * 100;
      return `${stop.color} ${cssNumber(percent)}%`;
    }).join(', ');
    return `linear-gradient(${cssNumber(angle)}deg, ${cssStops})`;
  }

  const [center, xAxis, yAxis] = geometry.handles;
  const ux = xAxis.x - center.x;
  const uy = xAxis.y - center.y;
  const vx = yAxis.x - center.x;
  const vy = yAxis.y - center.y;
  // CSS can represent the center and axis-aligned ellipse exactly. For a
  // rotated or sheared authored ellipse it uses the ellipse's axis-aligned
  // extents; Canvas rendering retains the complete affine geometry.
  const radiusX = Math.hypot(ux, vx);
  const radiusY = Math.hypot(uy, vy);
  const cssStops = stops.map(stop => `${stop.color} ${cssNumber(stop.position * 100)}%`).join(', ');
  return `radial-gradient(ellipse ${cssNumber(radiusX / bounds.width * 100)}% ${cssNumber(radiusY / bounds.height * 100)}% at ${cssNumber(center.x / bounds.width * 100)}% ${cssNumber(center.y / bounds.height * 100)}%, ${cssStops})`;
}

/**
 * Build a CSS preview of a gradient. Geometry previews use an optional
 * `{width,height}` reference box, defaulting to a square; legacy output is
 * intentionally kept byte-for-byte stable.
 */
export function gradientFillToCSS(gradient, opacity = 1, bounds = { width: 100, height: 100 }) {
  if (!isValidGradientFill(gradient)) return null;
  if (gradient.type === 'angular') {
    const stops = gradient.stops.map(stop => `${rgba(stop.color, opacity * (stop.opacity ?? 1))} ${Number((stop.position * 100).toFixed(3))}%`).join(', ');
    return `conic-gradient(from ${cssNumber(gradient.angle)}deg at 50% 50%, ${stops})`;
  }
  if (Object.hasOwn(gradient, 'geometry')) {
    if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)
      || !Number.isFinite(bounds.width) || bounds.width <= 0
      || !Number.isFinite(bounds.height) || bounds.height <= 0) return null;
    return geometryGradientToCSS(gradient, opacity, bounds);
  }
  const stops = gradient.stops.map(stop => `${rgba(stop.color, opacity * (stop.opacity ?? 1))} ${Number((stop.position * 100).toFixed(3))}%`).join(', ');
  return gradient.type === 'linear'
    ? `linear-gradient(${(gradient.angle + 90) % 360}deg, ${stops})`
    : `radial-gradient(circle, ${stops})`;
}
