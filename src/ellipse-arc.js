const TAU = Math.PI * 2;
const ANGLE_EPSILON = 1e-9;
const DEFAULT_ARC = Object.freeze({ startingAngle: 0, endingAngle: TAU, innerRadius: 0 });

/** Figma stores ellipse arc angles in radians and inner radius as an ellipse ratio. */
export function isValidEllipseArcData(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Number.isFinite(value.startingAngle) && value.startingAngle >= 0 && value.startingAngle <= TAU
    && Number.isFinite(value.endingAngle) && value.endingAngle >= 0 && value.endingAngle <= TAU
    && Number.isFinite(value.innerRadius) && value.innerRadius >= 0 && value.innerRadius <= 1);
}

export function ellipseArcParameters(node) {
  const arc = isValidEllipseArcData(node?.arcData) ? node.arcData : DEFAULT_ARC;
  const sweep = arc.endingAngle - arc.startingAngle;
  return {
    start: arc.startingAngle,
    end: arc.endingAngle,
    sweep,
    innerRadius: arc.innerRadius,
    full: Math.abs(Math.abs(sweep) - TAU) <= ANGLE_EPSILON
  };
}

/** Apply one Appearance-field edit; angle fields use degrees in the Inspector. */
export function updateEllipseArcData(node, field, value) {
  if (!['start', 'end', 'innerRadius'].includes(field) || !Number.isFinite(value)) return null;
  const current = isValidEllipseArcData(node?.arcData) ? node.arcData : DEFAULT_ARC;
  if (field === 'innerRadius') {
    return { ...current, innerRadius: Math.max(0, Math.min(1, value)) };
  }
  const radians = Math.max(0, Math.min(360, value)) * Math.PI / 180;
  return field === 'start'
    ? { ...current, startingAngle: radians }
    : { ...current, endingAngle: radians };
}

function ellipsePoint(cx, cy, rx, ry, angle) {
  return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
}

/** Add an ellipse, pie slice, or donut segment to the current Canvas path. */
export function traceEllipseArc(context, node, x = 0, y = 0, width = node?.width, height = node?.height) {
  if (!context || typeof context.ellipse !== 'function') return false;
  const rx = Math.abs(Number(width)) / 2;
  const ry = Math.abs(Number(height)) / 2;
  if (!(rx > 0) || !(ry > 0)) return false;
  const cx = x + Number(width) / 2;
  const cy = y + Number(height) / 2;
  const { start, end, sweep, innerRadius, full } = ellipseArcParameters(node);
  if (Math.abs(sweep) <= ANGLE_EPSILON) return false;
  const outerAnticlockwise = sweep < 0;
  const outerStart = ellipsePoint(cx, cy, rx, ry, start);
  const outerEnd = ellipsePoint(cx, cy, rx, ry, end);

  if (full && innerRadius === 0) {
    context.ellipse(cx, cy, rx, ry, 0, start, end, outerAnticlockwise);
    return true;
  }

  context.moveTo(outerStart.x, outerStart.y);
  context.ellipse(cx, cy, rx, ry, 0, start, end, outerAnticlockwise);
  if (full) {
    // A second, reversed subpath creates the hole without changing the layer bounds.
    const innerStart = ellipsePoint(cx, cy, rx * innerRadius, ry * innerRadius, start);
    context.moveTo(innerStart.x, innerStart.y);
    context.ellipse(cx, cy, rx * innerRadius, ry * innerRadius, 0, end, start, !outerAnticlockwise);
    return true;
  }
  if (innerRadius > 0) {
    const innerEnd = ellipsePoint(cx, cy, rx * innerRadius, ry * innerRadius, end);
    context.lineTo(innerEnd.x, innerEnd.y);
    context.ellipse(cx, cy, rx * innerRadius, ry * innerRadius, 0, end, start, !outerAnticlockwise);
  } else {
    context.lineTo(cx, cy);
  }
  context.closePath();
  return true;
}

export function ellipseArcContainsPoint(node, point) {
  const width = Math.abs(Number(node?.width));
  const height = Math.abs(Number(node?.height));
  if (!(width > 0) || !(height > 0) || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
  const rx = width / 2;
  const ry = height / 2;
  const dx = (point.x - Number(node.width) / 2) / rx;
  const dy = (point.y - Number(node.height) / 2) / ry;
  const radius = Math.hypot(dx, dy);
  if (radius > 1 + ANGLE_EPSILON) return false;
  const { start, sweep, innerRadius, full } = ellipseArcParameters(node);
  if (radius + ANGLE_EPSILON < innerRadius) return false;
  if (full) return true;
  if (Math.abs(sweep) <= ANGLE_EPSILON) return false;
  const angle = Math.atan2(dy, dx);
  const turn = sweep > 0
    ? ((angle - start) % TAU + TAU) % TAU
    : ((start - angle) % TAU + TAU) % TAU;
  return turn <= Math.abs(sweep) + ANGLE_EPSILON;
}

/** Flatten only the visible boundary; used for precise stroke hit testing. */
export function ellipseArcBoundaryPolylines(node, maxSegmentLength = 1) {
  const width = Math.abs(Number(node?.width));
  const height = Math.abs(Number(node?.height));
  if (!(width > 0) || !(height > 0)) return [];
  const cx = Number(node.width) / 2;
  const cy = Number(node.height) / 2;
  const rx = width / 2;
  const ry = height / 2;
  const { start, end, sweep, innerRadius, full } = ellipseArcParameters(node);
  if (Math.abs(sweep) <= ANGLE_EPSILON) return [];
  const sample = (radius, from, to, closed = false) => {
    const length = Math.abs(to - from) * Math.max(rx, ry) * radius;
    const steps = Math.max(2, Math.min(16_384, Math.ceil(length / Math.max(.25, maxSegmentLength))));
    const points = Array.from({ length: steps + 1 }, (_, index) => {
      const angle = from + (to - from) * index / steps;
      return ellipsePoint(cx, cy, rx * radius, ry * radius, angle);
    });
    if (closed && points.length > 1) points.pop();
    return { points, closed };
  };
  const outer = sample(1, start, end, full);
  if (full) return innerRadius > 0 ? [outer, sample(innerRadius, end, start, true)] : [outer];
  const endPoint = outer.points.at(-1);
  const startPoint = outer.points[0];
  if (innerRadius > 0) {
    const inner = sample(innerRadius, end, start, false);
    return [outer, inner,
      { points: [endPoint, inner.points[0]], closed: false },
      { points: [inner.points.at(-1), startPoint], closed: false }];
  }
  const center = { x: cx, y: cy };
  return [outer, { points: [endPoint, center], closed: false }, { points: [center, startPoint], closed: false }];
}

function svgArcCommand(cx, cy, rx, ry, from, to) {
  const end = ellipsePoint(cx, cy, rx, ry, to);
  const largeArc = Math.abs(to - from) > Math.PI + ANGLE_EPSILON ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `A ${svgNumber(rx)} ${svgNumber(ry)} 0 ${largeArc} ${sweep} ${svgNumber(end.x)} ${svgNumber(end.y)}`;
}

function svgNumber(value) {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Exact SVG path data for ellipse arcs and rings; dimensions remain unchanged. */
export function ellipseArcSvgPathData(node) {
  const width = Math.abs(Number(node?.width));
  const height = Math.abs(Number(node?.height));
  const rx = width / 2;
  const ry = height / 2;
  const cx = rx;
  const cy = ry;
  if (!(rx > 0) || !(ry > 0)) return '';
  const { start, end, sweep, innerRadius, full } = ellipseArcParameters(node);
  if (Math.abs(sweep) <= ANGLE_EPSILON) return '';
  const sx = cx + rx * Math.cos(start);
  const sy = cy + ry * Math.sin(start);
  if (full && innerRadius === 0) return '';
  if (full) {
    const half = Math.sign(sweep) * Math.PI;
    const oppositeHalf = -half;
    const ix = cx + rx * innerRadius * Math.cos(start);
    const iy = cy + ry * innerRadius * Math.sin(start);
    const innerEnd = start - Math.sign(sweep) * TAU;
    return `M ${svgNumber(sx)} ${svgNumber(sy)} ${svgArcCommand(cx, cy, rx, ry, start, start + half)} ${svgArcCommand(cx, cy, rx, ry, start + half, end)} M ${svgNumber(ix)} ${svgNumber(iy)} ${svgArcCommand(cx, cy, rx * innerRadius, ry * innerRadius, start, start + oppositeHalf)} ${svgArcCommand(cx, cy, rx * innerRadius, ry * innerRadius, start + oppositeHalf, innerEnd)}`;
  }
  const outer = `M ${svgNumber(sx)} ${svgNumber(sy)} ${svgArcCommand(cx, cy, rx, ry, start, end)}`;
  if (innerRadius > 0) {
    const innerEnd = ellipsePoint(cx, cy, rx * innerRadius, ry * innerRadius, end);
    return `${outer} L ${svgNumber(innerEnd.x)} ${svgNumber(innerEnd.y)} ${svgArcCommand(cx, cy, rx * innerRadius, ry * innerRadius, end, start)} Z`;
  }
  return `${outer} L ${svgNumber(cx)} ${svgNumber(cy)} Z`;
}
