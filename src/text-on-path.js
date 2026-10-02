import { vectorPathContours } from './vector-path.js';
import { textGraphemes } from './text-layout.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const MAX_TEXT_PATH_SAMPLES = 65_536;

/** Snapshot editable vector geometry onto a text layer so it survives source deletion. */
export function createTextPathGeometry(source, { startOffset = 0, flipped = false } = {}) {
  if (!source) return null;
  let contour;
  if (source.type === 'path' && Array.isArray(source.points) && source.points.length >= 2) {
    contour = vectorPathContours(source).find(item => Array.isArray(item.points) && item.points.length >= 2);
  } else if (source.type === 'ellipse') {
    const k = 4 * (Math.sqrt(2) - 1) / 3;
    contour = { closed: true, points: [
      { x: .5, y: 0, out: { x: k / 2, y: 0 } },
      { x: 1, y: .5, in: { x: 0, y: -k / 2 }, out: { x: 0, y: k / 2 } },
      { x: .5, y: 1, in: { x: k / 2, y: 0 }, out: { x: -k / 2, y: 0 } },
      { x: 0, y: .5, in: { x: 0, y: k / 2 }, out: { x: 0, y: -k / 2 } }
    ] };
  } else if (source.type === 'rectangle') {
    contour = { closed: true, points: [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }
    ] };
  } else if (source.type === 'line') {
    contour = { closed: false, points: [
      { x: 0, y: source.lineReverseY ? 1 : 0 }, { x: 1, y: source.lineReverseY ? 0 : 1 }
    ] };
  }
  if (!contour) return null;
  return {
    width: Math.max(1, Number(source.width) || 0), height: Math.max(1, Number(source.height) || 0),
    points: structuredClone(contour.points), closed: Boolean(contour.closed),
    startOffset, flipped: Boolean(flipped)
  };
}

export function isValidTextPathGeometry(path) {
  if (!path || typeof path !== 'object' || Array.isArray(path)
    || Object.keys(path).some(key => !['width', 'height', 'points', 'closed', 'startOffset', 'flipped'].includes(key))) return false;
  if (!Number.isFinite(path.width) || path.width <= 0 || path.width > 100_000
    || !Number.isFinite(path.height) || path.height <= 0 || path.height > 100_000
    || !Array.isArray(path.points) || path.points.length < 2 || path.points.length > 20_000
    || typeof path.closed !== 'boolean'
    || (path.startOffset != null && (!Number.isFinite(path.startOffset) || Math.abs(path.startOffset) > 100_000))
    || (path.flipped != null && typeof path.flipped !== 'boolean')) return false;
  const coordinate = value => Number.isFinite(value) && Math.abs(value) <= 1_000_000;
  return path.points.every(point => point && coordinate(point.x) && coordinate(point.y)
    && ['in', 'out'].every(part => point[part] == null || coordinate(point[part].x) && coordinate(point[part].y)));
}

function curvePoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y
  };
}

/** Flatten the stored cubic path into a bounded-distance lookup table. */
export function flattenTextPath(path, tolerance = 1) {
  if (!isValidTextPathGeometry(path)) return [];
  const points = path.points;
  const segments = path.closed ? points.length : points.length - 1;
  const output = [];
  for (let index = 0; index < segments; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const p0 = { x: start.x * path.width, y: start.y * path.height };
    const p3 = { x: end.x * path.width, y: end.y * path.height };
    const c1 = start.out ? { x: p0.x + start.out.x * path.width, y: p0.y + start.out.y * path.height } : p0;
    const c2 = end.in ? { x: p3.x + end.in.x * path.width, y: p3.y + end.in.y * path.height } : p3;
    const curved = start.out || end.in;
    const desiredSteps = curved ? clamp(Math.ceil(Math.hypot(p3.x - p0.x, p3.y - p0.y) / Math.max(0.25, tolerance)), 8, 128) : 1;
    const remainingSegments = segments - index;
    const availableSamples = MAX_TEXT_PATH_SAMPLES - output.length;
    const segmentBudget = Math.max(1, Math.floor((availableSamples - (index === 0 ? 1 : 0)) / remainingSegments));
    const steps = Math.min(desiredSteps, segmentBudget);
    for (let step = index === 0 ? 0 : 1; step <= steps; step += 1) {
      output.push(curved ? curvePoint(p0, c1, c2, p3, step / steps) : {
        x: p0.x + (p3.x - p0.x) * step / steps,
        y: p0.y + (p3.y - p0.y) * step / steps
      });
    }
  }
  let length = 0;
  return output.map((point, index) => {
    if (index) length += Math.hypot(point.x - output[index - 1].x, point.y - output[index - 1].y);
    return { ...point, distance: length };
  });
}

function sampleTextPathTable(path, table, distance) {
  if (table.length < 2) return null;
  const length = table.at(-1).distance;
  if (!(length > 0)) return null;
  const rawDistance = Number(distance) || 0;
  const requested = path.closed && length > 0
    ? (rawDistance % length + length) % length
    : clamp(rawDistance, 0, length);
  let low = 1;
  let high = table.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (table[middle].distance < requested) low = middle + 1;
    else high = middle;
  }
  const before = table[low - 1];
  const after = table[low];
  const span = after.distance - before.distance;
  const ratio = span > 0 ? (requested - before.distance) / span : 0;
  return {
    x: before.x + (after.x - before.x) * ratio,
    y: before.y + (after.y - before.y) * ratio,
    angle: Math.atan2(after.y - before.y, after.x - before.x),
    length
  };
}

/** Build one bounded distance index and reuse its logarithmic sampler for every glyph. */
export function createTextPathSampler(path, tolerance = 1) {
  const table = flattenTextPath(path, tolerance);
  if (table.length < 2 || !(table.at(-1).distance > 0)) return null;
  const length = table.at(-1).distance;
  return Object.freeze({
    length,
    at: distance => sampleTextPathTable(path, table, distance)
  });
}

export function pointAtTextPathDistance(path, distance, tolerance = 1) {
  return createTextPathSampler(path, tolerance)?.at(distance) || null;
}

export function textPathSvgData(path) {
  if (!isValidTextPathGeometry(path)) return '';
  const n = value => Number(Number(value).toFixed(6));
  const point = (item, part) => {
    const x = item.x * path.width; const y = item.y * path.height;
    const handle = item[part];
    return handle ? { x: x + handle.x * path.width, y: y + handle.y * path.height } : { x, y };
  };
  let data = '';
  const segments = path.closed ? path.points.length : path.points.length - 1;
  for (let index = 0; index < segments; index += 1) {
    const start = path.points[index]; const end = path.points[(index + 1) % path.points.length];
    const p0 = point(start, 'anchor'); const p3 = point(end, 'anchor');
    const c1 = point(start, 'out'); const c2 = point(end, 'in');
    data += index === 0 ? `M ${n(p0.x)} ${n(p0.y)}` : '';
    data += start.out || end.in ? ` C ${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p3.x)} ${n(p3.y)}` : ` L ${n(p3.x)} ${n(p3.y)}`;
  }
  return data + (path.closed ? ' Z' : '');
}

/** Draw editable graphemes along the vector path using the active canvas text style. */
export function drawTextAlongPath(ctx, text, node, x, y, measure, {
  fillOpacity = 1, paintMode = 'fill', fontSize: fontSizeOverride,
  letterSpacing: letterSpacingOverride, fontWeight, fontStyle, fontFamily
} = {}) {
  const path = node.textPath;
  const sampler = createTextPathSampler(path, 0.5);
  if (!sampler) return false;
  const fontSize = Number(fontSizeOverride ?? node.fontSize) || 24;
  const letterSpacing = Number(letterSpacingOverride ?? node.letterSpacing) || 0;
  const source = String(text ?? '').replace(/[\r\n]+/gu, ' ');
  const graphemes = textGraphemes(source);
  ctx.font = `${(fontStyle ?? node.fontStyle) === 'italic' ? 'italic ' : ''}${fontWeight ?? node.fontWeight ?? 400} ${fontSize}px ${fontFamily ?? node.fontFamily ?? 'Arial, sans-serif'}`;
  ctx.textBaseline = 'alphabetic';
  const advances = graphemes.map(grapheme => Number(measure(grapheme)) + letterSpacing);
  let cursor = Number(path.startOffset) || 0;
  if (node.align === 'center' || node.align === 'right') {
    const total = advances.reduce((sum, value) => sum + value, 0);
    cursor += node.align === 'center' ? (sampler.length - total) / 2 : sampler.length - total;
  }
  for (let index = 0; index < graphemes.length; index += 1) {
    const advance = advances[index];
    if (!path.closed && cursor + advance / 2 > sampler.length) break;
    const sample = sampler.at(cursor + advance / 2);
    if (!sample) break;
    const angle = sample.angle + (path.flipped ? Math.PI : 0);
    ctx.save();
    ctx.translate(x + sample.x, y + sample.y);
    ctx.rotate(angle);
    if (path.flipped) ctx.scale(1, -1);
    ctx.textAlign = 'center';
    if (paintMode === 'stroke') ctx.strokeText(graphemes[index], 0, 0);
    else {
      ctx.globalAlpha *= fillOpacity;
      ctx.fillText(graphemes[index], 0, 0);
    }
    ctx.restore();
    cursor += advance;
  }
  return true;
}
