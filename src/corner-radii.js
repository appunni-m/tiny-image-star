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

function smoothingBudget(radius, adjacentRadius, sideLength) {
  const used = radius + adjacentRadius;
  if (!radius || used <= 0) return radius;
  return radius + Math.max(0, sideLength - used) * radius / used;
}

// Figma's public squircle article describes p=(1+ξ)R edge consumption, a
// shrinking circular arc, and cubic ramps. Keep this path geometry shared by
// Canvas, clipping, hit testing, SVG, and Boolean conversion.
function cornerSmoothingParams(width, height, radii, smoothing) {
  const { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl } = radii;
  const budgets = {
    topLeft: Math.min(smoothingBudget(tl, tr, width), smoothingBudget(tl, bl, height)),
    topRight: Math.min(smoothingBudget(tr, tl, width), smoothingBudget(tr, br, height)),
    bottomRight: Math.min(smoothingBudget(br, bl, width), smoothingBudget(br, tr, height)),
    bottomLeft: Math.min(smoothingBudget(bl, br, width), smoothingBudget(bl, tl, height))
  };
  return Object.fromEntries(cornerRadiusKeys.map(key => {
    const radius = radii[key];
    if (!radius) return [key, { radius: 0, smoothing: 0, p: 0 }];
    const effectiveSmoothing = Math.max(0, Math.min(smoothing, budgets[key] / radius - 1));
    const p = (1 + effectiveSmoothing) * radius;
    const arcAngle = Math.PI / 2 * (1 - effectiveSmoothing);
    const arcSectionLength = Math.sin(arcAngle / 2) * radius * Math.SQRT2;
    const angleAlpha = (Math.PI / 2 - arcAngle) / 2;
    const p3ToP4Distance = radius * Math.tan(angleAlpha / 2);
    const angleBeta = Math.PI / 4 * effectiveSmoothing;
    const c = p3ToP4Distance * Math.cos(angleBeta);
    const d = c * Math.tan(angleBeta);
    const b = (p - arcSectionLength - c - d) / 3;
    return [key, {
      radius, smoothing: effectiveSmoothing, p, arcAngle, arcSectionLength,
      a: 2 * b, b, c, d
    }];
  }));
}

function addPoint(point, offset) {
  return { x: point.x + offset.x, y: point.y + offset.y };
}

function cubicCommand(from, offsets) {
  return {
    type: 'cubic',
    start: from,
    control1: addPoint(from, offsets[0]),
    control2: addPoint(from, offsets[1]),
    end: addPoint(from, offsets[2])
  };
}

function roundedCornerCommands(corner, start, params, width, height) {
  const { radius, smoothing, a, b, c, d, arcAngle, arcSectionLength } = params;
  if (!radius) return [];
  if (smoothing <= 1e-12) {
    const controls = {
      topRight: { control: { x: width, y: 0 }, end: { x: width, y: radius } },
      bottomRight: { control: { x: width, y: height }, end: { x: width - radius, y: height } },
      bottomLeft: { control: { x: 0, y: height }, end: { x: 0, y: height - radius } },
      topLeft: { control: { x: 0, y: 0 }, end: { x: radius, y: 0 } }
    }[corner];
    return [{ type: 'quadratic', start, control: controls.control, end: controls.end }];
  }
  const cornerVectors = {
    topRight: {
      center: { x: width - radius, y: radius }, first: [{ x: a, y: 0 }, { x: a + b, y: 0 }, { x: a + b + c, y: d }],
      arcDelta: { x: arcSectionLength, y: arcSectionLength }, second: [{ x: d, y: c }, { x: d, y: b + c }, { x: d, y: a + b + c }]
    },
    bottomRight: {
      center: { x: width - radius, y: height - radius }, first: [{ x: 0, y: a }, { x: 0, y: a + b }, { x: -d, y: a + b + c }],
      arcDelta: { x: -arcSectionLength, y: arcSectionLength }, second: [{ x: -c, y: d }, { x: -(b + c), y: d }, { x: -(a + b + c), y: d }]
    },
    bottomLeft: {
      center: { x: radius, y: height - radius }, first: [{ x: -a, y: 0 }, { x: -(a + b), y: 0 }, { x: -(a + b + c), y: -d }],
      arcDelta: { x: -arcSectionLength, y: -arcSectionLength }, second: [{ x: -d, y: -c }, { x: -d, y: -(b + c) }, { x: -d, y: -(a + b + c) }]
    },
    topLeft: {
      center: { x: radius, y: radius }, first: [{ x: 0, y: -a }, { x: 0, y: -(a + b) }, { x: d, y: -(a + b + c) }],
      arcDelta: { x: arcSectionLength, y: -arcSectionLength }, second: [{ x: c, y: -d }, { x: b + c, y: -d }, { x: a + b + c, y: -d }]
    }
  }[corner];
  const first = cubicCommand(start, cornerVectors.first);
  const arcStart = first.end;
  const arcStartAngle = Math.atan2(arcStart.y - cornerVectors.center.y, arcStart.x - cornerVectors.center.x);
  const arcEndAngle = arcStartAngle + arcAngle;
  const arcEnd = {
    x: cornerVectors.center.x + Math.cos(arcEndAngle) * radius,
    y: cornerVectors.center.y + Math.sin(arcEndAngle) * radius
  };
  const arc = {
    type: 'arc', center: cornerVectors.center, radius, startAngle: arcStartAngle,
    endAngle: arcEndAngle, start: arcStart, end: arcEnd
  };
  const second = cubicCommand(arcEnd, cornerVectors.second);
  return [first, arc, second];
}

/** Canonical line and curve segments shared by canvas, hit testing, and SVG. */
export function roundedRectPathCommands(width, height, values, smoothing = 0) {
  const w = Math.max(0, Math.abs(Number(width) || 0));
  const h = Math.max(0, Math.abs(Number(height) || 0));
  const radii = clampCornerRadii(w, h, values);
  const amount = Number.isFinite(Number(smoothing)) ? Math.max(0, Math.min(1, Number(smoothing))) : 0;
  const params = cornerSmoothingParams(w, h, radii, amount);
  const start = { x: w - params.topRight.p, y: 0 };
  const commands = [];
  let current = start;
  const corners = [
    { corner: 'topRight', start, end: { x: w, y: params.topRight.p } },
    { corner: 'bottomRight', start: { x: w, y: h - params.bottomRight.p }, end: { x: w - params.bottomRight.p, y: h } },
    { corner: 'bottomLeft', start: { x: params.bottomLeft.p, y: h }, end: { x: 0, y: h - params.bottomLeft.p } },
    { corner: 'topLeft', start: { x: 0, y: params.topLeft.p }, end: { x: params.topLeft.p, y: 0 } }
  ];
  for (const { corner, start: cornerStart, end: cornerEnd } of corners) {
    if (Math.hypot(current.x - cornerStart.x, current.y - cornerStart.y) > 1e-12) {
      commands.push({ type: 'line', start: current, end: cornerStart });
    }
    const cornerCommands = roundedCornerCommands(corner, cornerStart, params[corner], w, h);
    commands.push(...cornerCommands);
    current = cornerCommands.at(-1)?.end || cornerEnd;
  }
  // Keep the final straight edge explicit so SVG and Canvas close identically.
  if (Math.hypot(current.x - start.x, current.y - start.y) > 1e-12) {
    commands.push({ type: 'line', start: current, end: start });
  }
  return { start, commands, radii, smoothing: amount };
}

function appendQuadraticPoints(points, start, control, end, segments) {
  for (let step = 1; step <= segments; step += 1) {
    const t = step / segments;
    const inverse = 1 - t;
    points.push({
      x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
    });
  }
}

function appendCubicPoints(points, start, control1, control2, end, segments) {
  for (let step = 1; step <= segments; step += 1) {
    const t = step / segments;
    const inverse = 1 - t;
    points.push({
      x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * control1.x + 3 * inverse * t ** 2 * control2.x + t ** 3 * end.x,
      y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * control1.y + 3 * inverse * t ** 2 * control2.y + t ** 3 * end.y
    });
  }
}

export function roundedRectPathPoints(width, height, values, smoothing = 0) {
  const path = roundedRectPathCommands(width, height, values, smoothing);
  const radius = Math.max(...Object.values(path.radii));
  const segments = Math.max(6, Math.min(256, Math.ceil(Math.sqrt(radius) * 2)));
  const points = [path.start];
  for (const command of path.commands) {
    if (command.type === 'line') points.push(command.end);
    else if (command.type === 'quadratic') appendQuadraticPoints(points, command.start, command.control, command.end, segments);
    else if (command.type === 'cubic') appendCubicPoints(points, command.start, command.control1, command.control2, command.end, segments);
    else if (command.type === 'arc') {
      const arcSegments = Math.max(2, Math.min(256, Math.ceil((command.endAngle - command.startAngle) * command.radius / .5)));
      for (let index = 1; index <= arcSegments; index += 1) {
        const angle = command.startAngle + (command.endAngle - command.startAngle) * index / arcSegments;
        points.push({ x: command.center.x + Math.cos(angle) * command.radius, y: command.center.y + Math.sin(angle) * command.radius });
      }
    }
  }
  return points;
}

function containsPointInPathPolygon(x, y, points) {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current, current += 1) {
    const a = points[current]; const b = points[previous];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function traceRoundedRectPath(ctx, x, y, width, height, values, smoothing = 0) {
  if (Number(smoothing) > 0) {
    const path = roundedRectPathCommands(width, height, values, smoothing);
    const sx = Math.sign(width) || 1; const sy = Math.sign(height) || 1;
    const point = value => ({ x: x + value.x * sx, y: y + value.y * sy });
    const start = point(path.start);
    ctx.moveTo(start.x, start.y);
    for (const command of path.commands) {
      if (command.type === 'line') {
        const end = point(command.end); ctx.lineTo(end.x, end.y);
      } else if (command.type === 'quadratic') {
        const control = point(command.control); const end = point(command.end); ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
      } else if (command.type === 'cubic') {
        const control1 = point(command.control1); const control2 = point(command.control2); const end = point(command.end);
        ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
      } else if (command.type === 'arc') {
        const center = point(command.center);
        ctx.arc(center.x, center.y, command.radius, command.startAngle, command.endAngle, false);
      }
    }
    return;
  }
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

export function roundedRectSvgPath(width, height, values, smoothing = 0) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  if (smoothing > 0) {
    const path = roundedRectPathCommands(w, h, values, smoothing);
    const number = value => Number(value.toFixed(4)).toString();
    const parts = [`M ${number(path.start.x)} ${number(path.start.y)}`];
    for (const command of path.commands) {
      if (command.type === 'line') parts.push(`L ${number(command.end.x)} ${number(command.end.y)}`);
      else if (command.type === 'quadratic') parts.push(`Q ${number(command.control.x)} ${number(command.control.y)} ${number(command.end.x)} ${number(command.end.y)}`);
      else if (command.type === 'cubic') parts.push(`C ${number(command.control1.x)} ${number(command.control1.y)} ${number(command.control2.x)} ${number(command.control2.y)} ${number(command.end.x)} ${number(command.end.y)}`);
      else if (command.type === 'arc') parts.push(`A ${number(command.radius)} ${number(command.radius)} 0 0 1 ${number(command.end.x)} ${number(command.end.y)}`);
    }
    return `${parts.join(' ')} Z`;
  }
  const radii = clampCornerRadii(w, h, values);
  const { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl } = radii;
  return `M ${tl} 0 L ${w - tr} 0 Q ${w} 0 ${w} ${tr} L ${w} ${h - br} Q ${w} ${h} ${w - br} ${h} L ${bl} ${h} Q 0 ${h} 0 ${h - bl} L 0 ${tl} Q 0 0 ${tl} 0 Z`;
}

export function containsPointInRoundedRect(x, y, width, height, values, smoothing = 0) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  if (x < 0 || y < 0 || x > w || y > h) return false;
  if (smoothing > 0) return containsPointInPathPolygon(x, y, roundedRectPathPoints(w, h, values, smoothing));
  const radii = clampCornerRadii(w, h, values);
  // Match traceRoundedRectPath's quadratic corner segments exactly. Circular
  // distance checks subtly disagree with these curves near the bounding-box
  // corners, causing visible fill and clipping pixels to be unpickable.
  if (x < radii.topLeft && y < radii.topLeft) {
    const radius = radii.topLeft;
    if (!radius) return true;
    const t = Math.sqrt(Math.max(0, Math.min(1, x / radius)));
    const boundaryY = radius * (1 - t) ** 2;
    return y + 1e-9 >= boundaryY;
  }
  if (x > w - radii.topRight && y < radii.topRight) {
    const radius = radii.topRight;
    if (!radius) return true;
    const t = 1 - Math.sqrt(Math.max(0, Math.min(1, (w - x) / radius)));
    const boundaryY = radius * t ** 2;
    return y + 1e-9 >= boundaryY;
  }
  if (x > w - radii.bottomRight && y > h - radii.bottomRight) {
    const radius = radii.bottomRight;
    if (!radius) return true;
    const t = Math.sqrt(Math.max(0, Math.min(1, (w - x) / radius)));
    const boundaryY = h - radius * (1 - t) ** 2;
    return y <= boundaryY + 1e-9;
  }
  if (x < radii.bottomLeft && y > h - radii.bottomLeft) {
    const radius = radii.bottomLeft;
    if (!radius) return true;
    const t = 1 - Math.sqrt(Math.max(0, Math.min(1, x / radius)));
    const boundaryY = h - radius * t ** 2;
    return y <= boundaryY + 1e-9;
  }
  return true;
}
