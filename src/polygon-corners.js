const MAX_CORNER_RADIUS = 100_000;
export const MIN_STAR_POINTS = 3;
export const MAX_STAR_POINTS = 60;
export const MAX_POLYGON_POINTS = 32;

const point = (x, y) => ({ x, y });
const add = (a, b) => point(a.x + b.x, a.y + b.y);
const subtract = (a, b) => point(a.x - b.x, a.y - b.y);
const multiply = (a, amount) => point(a.x * amount, a.y * amount);
const length = value => Math.hypot(value.x, value.y);

/** Return the number of editable vertices for a regular polygon or star. */
export function regularShapeVertexCount(type, points) {
  const maximum = type === 'star' ? MAX_STAR_POINTS : MAX_POLYGON_POINTS;
  const fallback = type === 'star' ? 5 : 6;
  const count = Math.max(MIN_STAR_POINTS, Math.min(maximum, Number(points) || fallback));
  return type === 'star' ? Math.ceil(count * 2) : Math.ceil(count);
}

/** Validate a persisted per-vertex radius array against its shape topology. */
export function isValidVertexRadii(type, points, radii) {
  return (type === 'star' || type === 'polygon') && Array.isArray(radii)
    && radii.length === regularShapeVertexCount(type, points)
    && radii.every(radius => Number.isFinite(radius) && radius >= 0 && radius <= MAX_CORNER_RADIUS);
}

/** Return the regular polygon or star vertices in local layer coordinates. */
export function regularShapeVertices(type, width, height, points, innerRadius = 0.48) {
  const w = Math.abs(Number(width) || 0);
  const h = Math.abs(Number(height) || 0);
  if (type === 'star') {
    const count = regularShapeVertexCount(type, points) / 2;
    const radius = Math.min(w, h) / 2;
    const ratio = Number.isFinite(Number(innerRadius)) ? Math.max(0, Math.min(1, Number(innerRadius))) : 0.48;
    return Array.from({ length: Math.ceil(count * 2) }, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / count;
      const distance = radius * (index % 2 ? ratio : 1);
      return point(w / 2 + Math.cos(angle) * distance, h / 2 + Math.sin(angle) * distance);
    });
  }
  const count = regularShapeVertexCount(type, points);
  return Array.from({ length: Math.ceil(count) }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    return point(w / 2 + Math.cos(angle) * w / 2, h / 2 + Math.sin(angle) * h / 2);
  });
}

function vertexCorner(vertices, index, radius, smoothing) {
  const vertex = vertices[index];
  const previous = vertices[(index + vertices.length - 1) % vertices.length];
  const next = vertices[(index + 1) % vertices.length];
  const incomingEdge = subtract(vertex, previous);
  const outgoingEdge = subtract(next, vertex);
  const incomingLength = length(incomingEdge);
  const outgoingLength = length(outgoingEdge);
  if (incomingLength < 1e-9 || outgoingLength < 1e-9 || !radius) {
    return { vertex, incoming: point(0, 0), outgoing: point(0, 0), baseTangent: 0, radius: 0, turn: 0, scale: 0 };
  }

  const incoming = multiply(incomingEdge, 1 / incomingLength);
  const outgoing = multiply(outgoingEdge, 1 / outgoingLength);
  const turn = Math.atan2(incoming.x * outgoing.y - incoming.y * outgoing.x,
    incoming.x * outgoing.x + incoming.y * outgoing.y);
  const angle = Math.abs(turn);
  // Straight-through and 180-degree vertices have no stable circular fillet.
  if (angle < 1e-8 || Math.PI - angle < 1e-8) {
    return { vertex, incoming, outgoing, baseTangent: 0, radius: 0, turn: 0, scale: 0 };
  }
  const tangentFactor = Math.tan(angle / 2);
  if (!Number.isFinite(tangentFactor)) {
    return { vertex, incoming, outgoing, baseTangent: 0, radius: 0, turn: 0, scale: 0 };
  }
  return {
    vertex, incoming, outgoing, incomingLength, outgoingLength, turn,
    tangentFactor, baseTangent: radius * tangentFactor, radius, scale: 1, smoothing
  };
}

function polygonCorners(verticesInput, requestedRadius, requestedSmoothing) {
  const vertices = Array.isArray(verticesInput)
    ? verticesInput.filter(item => Number.isFinite(item?.x) && Number.isFinite(item?.y)).map(item => point(item.x, item.y))
    : [];
  const radii = vertices.map((_, index) => {
    const value = Array.isArray(requestedRadius) ? requestedRadius[index] : requestedRadius;
    return Number.isFinite(Number(value)) ? Math.max(0, Math.min(MAX_CORNER_RADIUS, Number(value))) : 0;
  });
  const radius = Math.max(0, ...radii);
  const smoothing = Number.isFinite(Number(requestedSmoothing))
    ? Math.max(0, Math.min(1, Number(requestedSmoothing))) : 0;
  if (vertices.length < 3 || !radius) return { vertices, radius: 0, smoothing: 0, corners: [] };

  const corners = vertices.map((_, index) => vertexCorner(vertices, index, radii[index], smoothing));
  // Clamp each vertex against the space shared with its neighbours. Repeating
  // the pass handles tight alternating star points without making every corner
  // shrink to the smallest edge in the shape.
  for (let pass = 0; pass < vertices.length; pass += 1) {
    let changed = false;
    for (let index = 0; index < vertices.length; index += 1) {
      const nextIndex = (index + 1) % vertices.length;
      const edgeLength = length(subtract(vertices[nextIndex], vertices[index]));
      const current = corners[index];
      const next = corners[nextIndex];
      const used = current.baseTangent * current.scale + next.baseTangent * next.scale;
      if (used <= edgeLength + 1e-9 || used <= 0) continue;
      const factor = Math.max(0, edgeLength / used);
      current.scale *= factor;
      next.scale *= factor;
      changed = true;
    }
    if (!changed) break;
  }

  const baseTangents = corners.map(corner => corner.baseTangent * corner.scale);
  const effectiveSmoothing = corners.map((corner, index) => {
    if (!baseTangents[index]) return 0;
    const previousIndex = (index + vertices.length - 1) % vertices.length;
    const nextIndex = (index + 1) % vertices.length;
    const previousLength = length(subtract(vertices[index], vertices[previousIndex]));
    const nextLength = length(subtract(vertices[nextIndex], vertices[index]));
    const previousUsed = baseTangents[previousIndex] + baseTangents[index];
    const nextUsed = baseTangents[index] + baseTangents[nextIndex];
    const previousBudget = previousUsed > 0 ? Math.max(0, (previousLength - previousUsed) / previousUsed) : smoothing;
    const nextBudget = nextUsed > 0 ? Math.max(0, (nextLength - nextUsed) / nextUsed) : smoothing;
    return Math.min(smoothing, previousBudget, nextBudget);
  });

  return {
    vertices, radius, smoothing,
    corners: corners.map((corner, index) => {
      const actualRadius = corner.radius * corner.scale;
      const tangent = baseTangents[index];
      const amount = effectiveSmoothing[index];
      const entry = subtract(corner.vertex, multiply(corner.incoming, tangent * (1 + amount)));
      const exit = add(corner.vertex, multiply(corner.outgoing, tangent * (1 + amount)));
      if (!tangent || !actualRadius) return { ...corner, radius: 0, smoothing: 0, entry, exit };

      const sign = Math.sign(corner.turn);
      const startTangent = subtract(corner.vertex, multiply(corner.incoming, tangent));
      const normal = point(-corner.incoming.y * sign, corner.incoming.x * sign);
      const center = add(startTangent, multiply(normal, actualRadius));
      const startAngle = Math.atan2(startTangent.y - center.y, startTangent.x - center.x) + corner.turn * amount / 2;
      const endAngle = startAngle + corner.turn * (1 - amount);
      const arcStart = point(center.x + Math.cos(startAngle) * actualRadius, center.y + Math.sin(startAngle) * actualRadius);
      const arcEnd = point(center.x + Math.cos(endAngle) * actualRadius, center.y + Math.sin(endAngle) * actualRadius);
      const tangentAt = angle => point(-Math.sin(angle) * sign, Math.cos(angle) * sign);
      return {
        ...corner, radius: actualRadius, smoothing: amount, entry, exit, center,
        startAngle, endAngle, arcStart, arcEnd,
        arcStartTangent: tangentAt(startAngle), arcEndTangent: tangentAt(endAngle)
      };
    })
  };
}

function cubicCommand(start, control1, control2, end) {
  return { type: 'cubic', start, control1, control2, end };
}

function roundedCornerCommands(corner) {
  if (!corner.radius) return [];
  if (corner.smoothing <= 1e-10) {
    return [{ type: 'arc', center: corner.center, radius: corner.radius,
      startAngle: corner.startAngle, endAngle: corner.endAngle, start: corner.arcStart, end: corner.arcEnd }];
  }

  const incomingDelta = length(subtract(corner.arcStart, corner.entry));
  const outgoingDelta = length(subtract(corner.exit, corner.arcEnd));
  const incomingHandle = incomingDelta * 0.55;
  const outgoingHandle = outgoingDelta * 0.55;
  const commands = [];
  if (incomingDelta > 1e-9) {
    commands.push(cubicCommand(corner.entry,
      add(corner.entry, multiply(corner.incoming, incomingHandle)),
      subtract(corner.arcStart, multiply(corner.arcStartTangent, incomingHandle)), corner.arcStart));
  }
  if (Math.abs(corner.endAngle - corner.startAngle) > 1e-9) {
    commands.push({ type: 'arc', center: corner.center, radius: corner.radius,
      startAngle: corner.startAngle, endAngle: corner.endAngle, start: corner.arcStart, end: corner.arcEnd });
  }
  if (outgoingDelta > 1e-9) {
    commands.push(cubicCommand(corner.arcEnd,
      add(corner.arcEnd, multiply(corner.arcEndTangent, outgoingHandle)),
      subtract(corner.exit, multiply(corner.outgoing, outgoingHandle)), corner.exit));
  }
  return commands;
}

/** Canonical closed path segments shared by Canvas, hit testing, Boolean baking, and SVG. */
export function roundedPolygonPathCommands(vertices, radius = 0, smoothing = 0) {
  const geometry = polygonCorners(vertices, radius, smoothing);
  if (geometry.vertices.length < 3) return { start: geometry.vertices[0] || point(0, 0), commands: [], corners: geometry.corners };
  const corners = geometry.corners;
  const start = corners[0]?.entry || geometry.vertices[0];
  const commands = [];
  let current = start;
  for (let index = 0; index < geometry.vertices.length; index += 1) {
    const corner = corners[index];
    const entry = corner?.entry || geometry.vertices[index];
    const exit = corner?.exit || geometry.vertices[index];
    if (length(subtract(current, entry)) > 1e-9) commands.push({ type: 'line', start: current, end: entry });
    const cornerCommands = corner ? roundedCornerCommands(corner) : [];
    commands.push(...cornerCommands);
    current = cornerCommands.at(-1)?.end || exit;
    const nextEntry = corners[(index + 1) % geometry.vertices.length]?.entry || geometry.vertices[(index + 1) % geometry.vertices.length];
    if (length(subtract(current, nextEntry)) > 1e-9) {
      commands.push({ type: 'line', start: current, end: nextEntry });
      current = nextEntry;
    }
  }
  return { start, commands, corners };
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

export function roundedPolygonPathPoints(vertices, radius = 0, smoothing = 0) {
  const path = roundedPolygonPathCommands(vertices, radius, smoothing);
  const maxRadius = Math.max(0, ...path.corners.map(corner => corner.radius || 0));
  const segments = Math.max(6, Math.min(256, Math.ceil(Math.sqrt(maxRadius) * 2)));
  const points = [path.start];
  for (const command of path.commands) {
    if (command.type === 'line') points.push(command.end);
    else if (command.type === 'cubic') appendCubicPoints(points, command.start, command.control1, command.control2, command.end, segments);
    else if (command.type === 'arc') {
      const sweep = command.endAngle - command.startAngle;
      const arcSegments = Math.max(2, Math.min(256, Math.ceil(Math.abs(sweep) * command.radius / 0.5)));
      for (let index = 1; index <= arcSegments; index += 1) {
        const angle = command.startAngle + sweep * index / arcSegments;
        points.push({ x: command.center.x + Math.cos(angle) * command.radius, y: command.center.y + Math.sin(angle) * command.radius });
      }
    }
  }
  if (points.length > 1 && length(subtract(points[0], points.at(-1))) < 1e-9) points.pop();
  return points;
}

export function traceRoundedPolygonPath(ctx, x, y, vertices, radius = 0, smoothing = 0) {
  const path = roundedPolygonPathCommands(vertices, radius, smoothing);
  ctx.moveTo(x + path.start.x, y + path.start.y);
  for (const command of path.commands) {
    if (command.type === 'line') ctx.lineTo(x + command.end.x, y + command.end.y);
    else if (command.type === 'cubic') ctx.bezierCurveTo(
      x + command.control1.x, y + command.control1.y,
      x + command.control2.x, y + command.control2.y,
      x + command.end.x, y + command.end.y
    );
    else if (command.type === 'arc') ctx.arc(x + command.center.x, y + command.center.y, command.radius,
      command.startAngle, command.endAngle, command.endAngle < command.startAngle);
  }
  ctx.closePath();
}

function formatNumber(value) { return Number(value.toFixed(4)).toString(); }

export function roundedPolygonSvgPath(vertices, radius = 0, smoothing = 0) {
  const path = roundedPolygonPathCommands(vertices, radius, smoothing);
  const parts = [`M ${formatNumber(path.start.x)} ${formatNumber(path.start.y)}`];
  for (const command of path.commands) {
    if (command.type === 'line') parts.push(`L ${formatNumber(command.end.x)} ${formatNumber(command.end.y)}`);
    else if (command.type === 'cubic') parts.push(`C ${formatNumber(command.control1.x)} ${formatNumber(command.control1.y)} ${formatNumber(command.control2.x)} ${formatNumber(command.control2.y)} ${formatNumber(command.end.x)} ${formatNumber(command.end.y)}`);
    else if (command.type === 'arc') {
      const sweep = command.endAngle - command.startAngle;
      const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0;
      const clockwise = sweep >= 0 ? 1 : 0;
      parts.push(`A ${formatNumber(command.radius)} ${formatNumber(command.radius)} 0 ${largeArc} ${clockwise} ${formatNumber(command.end.x)} ${formatNumber(command.end.y)}`);
    }
  }
  return `${parts.join(' ')} Z`;
}
