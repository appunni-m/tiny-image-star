const MAX_VARIABLE_STROKE_SAMPLES = 8192;
const MAX_VARIABLE_STROKE_WIDTH = 128;
const MAX_VARIABLE_STROKE_MITER = 8;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finitePoint(point) {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function unitNormal(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  return { x: -dy / length, y: dx / length };
}

function joinedNormal(previous, next, miterLimit) {
  const x = previous.x + next.x;
  const y = previous.y + next.y;
  const length = Math.hypot(x, y);
  if (!(length > 1e-9)) return { normal: next, scale: 1 };
  const normal = { x: x / length, y: y / length };
  const projection = normal.x * next.x + normal.y * next.y;
  const scale = Math.abs(projection) > 1e-9 ? 1 / projection : Infinity;
  if (!Number.isFinite(scale) || Math.abs(scale) > miterLimit) return { normal: next, scale: 1 };
  return { normal, scale };
}

function offsetPoint(sample, normal, halfWidth, side, scale = 1) {
  const distance = halfWidth * side * scale;
  return { x: sample.x + normal.x * distance, y: sample.y + normal.y * distance };
}

function appendRoundCap(points, center, radius, startAngle, direction, segments, includeEnd = false) {
  const end = includeEnd ? segments : segments - 1;
  for (let index = 1; index <= end; index += 1) {
    const angle = startAngle + direction * Math.PI * index / segments;
    points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  }
}

/**
 * Turn pressure samples into a closed, round-capped editable outline.
 * Width is measured in canvas/page units. The source and result are bounded
 * so malformed or extreme pointer input cannot create an unbounded path.
 */
export function variableStrokeOutlineFromSamples(samples, {
  minWidth = 0.8,
  maxWidth = 8,
  maxMiter = 2.5,
  capSegments = 8
} = {}) {
  if (!Array.isArray(samples)) throw new TypeError('Variable stroke samples must be an array.');
  if (samples.length > MAX_VARIABLE_STROKE_SAMPLES) throw new RangeError(`Variable strokes are limited to ${MAX_VARIABLE_STROKE_SAMPLES} samples.`);
  if (!Number.isFinite(minWidth) || !Number.isFinite(maxWidth) || minWidth <= 0 || maxWidth < minWidth || maxWidth > MAX_VARIABLE_STROKE_WIDTH) {
    throw new TypeError('Variable stroke widths must be positive and bounded.');
  }
  if (!Number.isFinite(maxMiter) || maxMiter < 1 || maxMiter > MAX_VARIABLE_STROKE_MITER) {
    throw new TypeError('Variable stroke miter limit must be between one and eight.');
  }
  if (!Number.isInteger(capSegments) || capSegments < 2 || capSegments > 32) {
    throw new TypeError('Variable stroke caps need between two and 32 segments.');
  }

  const points = [];
  for (const sample of samples) {
    if (!finitePoint(sample) || Math.abs(sample.x) > 1e9 || Math.abs(sample.y) > 1e9
      || (sample.pressure != null && !Number.isFinite(sample.pressure))) {
      throw new TypeError('Variable stroke samples must contain finite, bounded points and pressure.');
    }
    const pressure = clamp(sample.pressure == null ? 0.5 : sample.pressure, 0, 1);
    const normalized = { x: sample.x, y: sample.y, pressure };
    const previous = points.at(-1);
    if (previous && previous.x === normalized.x && previous.y === normalized.y) points[points.length - 1] = normalized;
    else points.push(normalized);
  }
  if (points.length < 2) return null;

  const normals = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const normal = unitNormal(points[index], points[index + 1]);
    if (!normal) return null;
    normals.push(normal);
  }
  const left = [];
  const right = [];
  for (let index = 0; index < points.length; index += 1) {
    const sample = points[index];
    const pressureCurve = Math.sqrt(sample.pressure);
    const halfWidth = (minWidth + (maxWidth - minWidth) * pressureCurve) / 2;
    let normal;
    let scale = 1;
    if (index === 0) normal = normals[0];
    else if (index === points.length - 1) normal = normals.at(-1);
    else {
      const joined = joinedNormal(normals[index - 1], normals[index], maxMiter);
      normal = joined.normal;
      scale = joined.scale;
    }
    left.push(offsetPoint(sample, normal, halfWidth, 1, scale));
    right.push(offsetPoint(sample, normal, halfWidth, -1, scale));
  }

  const firstTangent = { x: points[1].x - points[0].x, y: points[1].y - points[0].y };
  const lastTangent = { x: points.at(-1).x - points.at(-2).x, y: points.at(-1).y - points.at(-2).y };
  const firstAngle = Math.atan2(firstTangent.y, firstTangent.x);
  const lastAngle = Math.atan2(lastTangent.y, lastTangent.x);
  const outline = [...left];
  appendRoundCap(outline, points.at(-1), Math.hypot(left.at(-1).x - points.at(-1).x, left.at(-1).y - points.at(-1).y), lastAngle + Math.PI / 2, -1, capSegments, true);
  outline.push(...right.slice(0, -1).reverse());
  appendRoundCap(outline, points[0], Math.hypot(right[0].x - points[0].x, right[0].y - points[0].y), firstAngle - Math.PI / 2, -1, capSegments);
  return outline.length >= 3 && outline.every(finitePoint) ? outline : null;
}

export { MAX_VARIABLE_STROKE_SAMPLES, MAX_VARIABLE_STROKE_WIDTH };
