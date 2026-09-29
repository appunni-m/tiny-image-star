const MAX_VECTOR_COORDINATE = 32_000;
const MAX_VECTOR_VERTICES = 10_000;
const MAX_VECTOR_SEGMENTS = 20_000;

const finite = (value, label) => {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_VECTOR_COORDINATE) throw new Error(`Invalid vector ${label}`);
  return value;
};
const point = (value, label) => ({
  x: finite(value?.x, `${label} x`),
  y: finite(value?.y, `${label} y`),
});

function orientedSegment(network, segmentIndex, fromVertex) {
  const segment = network.segments[segmentIndex];
  if (segment.start === fromVertex) return { from: segment.start, to: segment.end, out: segment.tangentStart, into: segment.tangentEnd };
  if (segment.end === fromVertex) return { from: segment.end, to: segment.start, out: segment.tangentEnd, into: segment.tangentStart };
  return null;
}

export function normalizeVectorNetwork(value) {
  if (!value || !Array.isArray(value.vertices) || !Array.isArray(value.segments)
    || value.vertices.length < 2 || value.vertices.length > MAX_VECTOR_VERTICES
    || !value.segments.length || value.segments.length > MAX_VECTOR_SEGMENTS) {
    throw new Error("The vector network has an invalid size");
  }
  const vertices = value.vertices.map((vertex) => ({
    ...vertex,
    ...point(vertex, "vertex"),
    cornerRadius: Number.isFinite(vertex.cornerRadius) ? Math.max(0, Math.min(1000, vertex.cornerRadius)) : undefined,
    handleMirroring: ["NONE", "ANGLE", "ANGLE_AND_LENGTH"].includes(vertex.handleMirroring) ? vertex.handleMirroring : "NONE",
  }));
  const segments = value.segments.map((segment) => {
    if (!Number.isInteger(segment.start) || !Number.isInteger(segment.end)
      || segment.start < 0 || segment.start >= vertices.length || segment.end < 0 || segment.end >= vertices.length) {
      throw new Error("The vector network has a segment that references a missing vertex");
    }
    return {
      start: segment.start,
      end: segment.end,
      tangentStart: point(segment.tangentStart ?? { x: 0, y: 0 }, "start tangent"),
      tangentEnd: point(segment.tangentEnd ?? { x: 0, y: 0 }, "end tangent"),
    };
  });
  const regions = (Array.isArray(value.regions) ? value.regions : []).map((region) => {
    if (!region || !Array.isArray(region.loops) || !region.loops.length) throw new Error("The vector network has an invalid fill region");
    const loops = region.loops.map((loop) => {
      if (!Array.isArray(loop) || loop.length < 2 || loop.some((index) => !Number.isInteger(index) || index < 0 || index >= segments.length)) {
        throw new Error("The vector network has an invalid fill loop");
      }
      let current = null; const first = orientedSegment({ vertices, segments }, loop[0], segments[loop[0]].start);
      if (!first) throw new Error("The vector network has a disconnected fill loop");
      current = first.to;
      for (const index of loop.slice(1)) {
        const edge = orientedSegment({ vertices, segments }, index, current);
        if (!edge) throw new Error("The vector network has a disconnected fill loop");
        current = edge.to;
      }
      if (current !== first.from) throw new Error("The vector network has an open fill loop");
      return [...loop];
    });
    return {
      windingRule: region.windingRule === "EVENODD" ? "EVENODD" : "NONZERO",
      loops,
    };
  });
  return { vertices, segments, regions };
}

export function vectorNetworkBounds(network) {
  const xs = []; const ys = [];
  const add = (value) => { xs.push(value.x); ys.push(value.y); };
  const evaluate = (a, b, c, d, t) => {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  };
  const extrema = (a, b, c, d) => {
    const quadratic = -a + 3 * b - 3 * c + d;
    const linear = 2 * (a - 2 * b + c);
    const constant = b - a;
    if (Math.abs(quadratic) < 1e-12) return Math.abs(linear) < 1e-12 ? [] : [-constant / linear];
    const discriminant = linear * linear - 4 * quadratic * constant;
    if (discriminant < 0) return [];
    const root = Math.sqrt(discriminant);
    return [(-linear + root) / (2 * quadratic), (-linear - root) / (2 * quadratic)];
  };
  for (const segment of network.segments) {
    const start = network.vertices[segment.start]; const end = network.vertices[segment.end];
    const control1 = { x: start.x + segment.tangentStart.x, y: start.y + segment.tangentStart.y };
    const control2 = { x: end.x + segment.tangentEnd.x, y: end.y + segment.tangentEnd.y };
    add(start); add(end);
    const parameters = new Set([...extrema(start.x, control1.x, control2.x, end.x), ...extrema(start.y, control1.y, control2.y, end.y)]);
    for (const t of parameters) if (t > 0 && t < 1) add({
      x: evaluate(start.x, control1.x, control2.x, end.x, t),
      y: evaluate(start.y, control1.y, control2.y, end.y, t),
    });
  }
  return {
    minX: Math.min(...xs), minY: Math.min(...ys),
    maxX: Math.max(...xs), maxY: Math.max(...ys),
  };
}

export function rebaseVectorNode(node) {
  const bounds = vectorNetworkBounds(node.network);
  node.x += bounds.minX; node.y += bounds.minY;
  for (const vertex of node.network.vertices) { vertex.x -= bounds.minX; vertex.y -= bounds.minY; }
  node.w = Math.max(1, bounds.maxX - bounds.minX);
  node.h = Math.max(1, bounds.maxY - bounds.minY);
  return node;
}

export function scaleVectorNetwork(network, scaleX, scaleY) {
  for (const vertex of network.vertices) {
    vertex.x *= scaleX; vertex.y *= scaleY;
  }
  for (const segment of network.segments) {
    segment.tangentStart.x *= scaleX; segment.tangentStart.y *= scaleY;
    segment.tangentEnd.x *= scaleX; segment.tangentEnd.y *= scaleY;
  }
}

function segmentControls(node, segment) {
  const start = node.network.vertices[segment.start]; const end = node.network.vertices[segment.end];
  return {
    start: { x: node.x + start.x, y: node.y + start.y },
    control1: { x: node.x + start.x + segment.tangentStart.x, y: node.y + start.y + segment.tangentStart.y },
    control2: { x: node.x + end.x + segment.tangentEnd.x, y: node.y + end.y + segment.tangentEnd.y },
    end: { x: node.x + end.x, y: node.y + end.y },
  };
}

function traceCurve(ctx, curve) {
  ctx.bezierCurveTo(curve.control1.x, curve.control1.y, curve.control2.x, curve.control2.y, curve.end.x, curve.end.y);
}

function traceRegion(ctx, node, loop) {
  const firstSegment = node.network.segments[loop[0]];
  const first = orientedSegment(node.network, loop[0], firstSegment.start);
  const firstVertex = node.network.vertices[first.from];
  ctx.moveTo(node.x + firstVertex.x, node.y + firstVertex.y);
  let current = first.to;
  for (const segmentIndex of loop) {
    const edge = orientedSegment(node.network, segmentIndex, current === first.to && segmentIndex === loop[0] ? first.from : current);
    const curve = edge && segmentControls(node, node.network.segments[segmentIndex]);
    if (!edge || !curve) continue;
    if (edge.from !== node.network.segments[segmentIndex].start) {
      traceCurve(ctx, { start: curve.end, control1: curve.control2, control2: curve.control1, end: curve.start });
    } else traceCurve(ctx, curve);
    current = edge.to;
  }
  ctx.closePath();
}

export function paintVectorNetwork(ctx, node) {
  const { network } = node;
  if (!network?.vertices?.length || !network.segments?.length) return;
  for (const region of network.regions ?? []) {
    ctx.beginPath();
    for (const loop of region.loops) traceRegion(ctx, node, loop);
    ctx.fillStyle = node.fill ?? "transparent";
    ctx.fill(region.windingRule === "EVENODD" ? "evenodd" : "nonzero");
  }
  if (node.stroke && node.strokeWidth > 0) {
    ctx.beginPath();
    for (const segment of network.segments) {
      const curve = segmentControls(node, segment);
      ctx.moveTo(curve.start.x, curve.start.y); traceCurve(ctx, curve);
    }
    ctx.strokeStyle = node.stroke; ctx.lineWidth = node.strokeWidth;
    ctx.lineJoin = node.strokeJoin ?? "round"; ctx.lineCap = node.strokeCap ?? "round"; ctx.stroke();
  }
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x; const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const ratio = length ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length)) : 0;
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}
function cubicPoint(curve, t) {
  const u = 1 - t; const uu = u * u; const tt = t * t;
  return {
    x: uu * u * curve.start.x + 3 * uu * t * curve.control1.x + 3 * u * tt * curve.control2.x + tt * t * curve.end.x,
    y: uu * u * curve.start.y + 3 * uu * t * curve.control1.y + 3 * u * tt * curve.control2.y + tt * t * curve.end.y,
  };
}
function sampledLoop(node, loop, precision = 12) {
  const points = []; let current = null;
  for (const segmentIndex of loop) {
    const segment = node.network.segments[segmentIndex];
    const edge = orientedSegment(node.network, segmentIndex, current ?? segment.start);
    if (!edge) continue;
    const curve = segmentControls(node, segment);
    const oriented = edge.from === segment.start ? curve : { start: curve.end, control1: curve.control2, control2: curve.control1, end: curve.start };
    if (!points.length) points.push(oriented.start);
    for (let i = 1; i <= precision; i++) points.push(cubicPoint(oriented, i / precision));
    current = edge.to;
  }
  return points;
}
function windingAt(point, polygon) {
  let winding = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]; const b = polygon[(index + 1) % polygon.length];
    if (a.y <= point.y) {
      if (b.y > point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) > 0) winding++;
    } else if (b.y <= point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) < 0) winding--;
  }
  return winding;
}

export function hitTestVectorNetwork(node, point, tolerance = 6) {
  const network = node.network;
  for (const segment of network.segments) {
    const curve = segmentControls(node, segment); let previous = curve.start;
    for (let index = 1; index <= 20; index++) {
      const current = cubicPoint(curve, index / 20);
      if (pointToSegmentDistance(point, previous, current) <= tolerance + (node.strokeWidth ?? 0) / 2) return true;
      previous = current;
    }
  }
  return (network.regions ?? []).some((region) => {
    const windings = region.loops.map((loop) => windingAt(point, sampledLoop(node, loop)));
    return region.windingRule === "EVENODD" ? windings.filter((winding) => winding !== 0).length % 2 === 1
      : windings.reduce((sum, winding) => sum + winding, 0) !== 0;
  });
}

export function drawVectorEditor(ctx, node, selectedVertex = -1) {
  const { network } = node;
  for (const segment of network.segments) {
    const start = network.vertices[segment.start]; const end = network.vertices[segment.end];
    for (const [vertexIndex, vertex, tangent, endpoint] of [
      [segment.start, start, segment.tangentStart, "start"],
      [segment.end, end, segment.tangentEnd, "end"],
    ]) {
      if (Math.hypot(tangent.x, tangent.y) < 1) continue;
      const x = node.x + vertex.x; const y = node.y + vertex.y;
      const hx = x + tangent.x; const hy = y + tangent.y;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.strokeStyle = "#8c8c96"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#0d99ff"; ctx.stroke();
      void vertexIndex; void endpoint;
    }
  }
  network.vertices.forEach((vertex, index) => {
    ctx.beginPath(); ctx.arc(node.x + vertex.x, node.y + vertex.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = index === selectedVertex ? "#0d99ff" : "#ffffff"; ctx.fill();
    ctx.strokeStyle = "#0d99ff"; ctx.lineWidth = 1.5; ctx.stroke();
  });
}

export function drawPenDraft(ctx, draft) {
  if (!draft?.vertices?.length) return;
  const vertices = draft.vertices;
  ctx.beginPath(); ctx.moveTo(vertices[0].x, vertices[0].y);
  for (let index = 1; index < vertices.length; index++) {
    const previous = vertices[index - 1]; const current = vertices[index];
    ctx.bezierCurveTo(
      previous.x + (previous.out?.x ?? 0), previous.y + (previous.out?.y ?? 0),
      current.x + (current.in?.x ?? 0), current.y + (current.in?.y ?? 0),
      current.x, current.y,
    );
  }
  if (draft.cursor && vertices.length) {
    const last = vertices.at(-1); ctx.lineTo(draft.cursor.x, draft.cursor.y);
  }
  ctx.strokeStyle = "#0d99ff"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]);
  vertices.forEach((vertex, index) => {
    ctx.beginPath(); ctx.arc(vertex.x, vertex.y, index === 0 ? 5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = index === 0 ? "#0d99ff" : "#ffffff"; ctx.fill(); ctx.strokeStyle = "#0d99ff"; ctx.lineWidth = 1.5; ctx.stroke();
  });
}

export function nearestVectorHandle(node, point, toScreen, tolerance = 10) {
  const candidates = [];
  for (const [segmentIndex, segment] of node.network.segments.entries()) {
    const start = node.network.vertices[segment.start]; const end = node.network.vertices[segment.end];
    if (Math.hypot(segment.tangentStart.x, segment.tangentStart.y) >= 1) candidates.push({
      kind: "tangent", segmentIndex, endpoint: "start", vertexIndex: segment.start,
      x: node.x + start.x + segment.tangentStart.x, y: node.y + start.y + segment.tangentStart.y,
    });
    if (Math.hypot(segment.tangentEnd.x, segment.tangentEnd.y) >= 1) candidates.push({
      kind: "tangent", segmentIndex, endpoint: "end", vertexIndex: segment.end,
      x: node.x + end.x + segment.tangentEnd.x, y: node.y + end.y + segment.tangentEnd.y,
    });
  }
  for (const [vertexIndex, vertex] of node.network.vertices.entries()) candidates.push({
    kind: "vertex", vertexIndex, x: node.x + vertex.x, y: node.y + vertex.y,
  });
  let nearest = null; let distance = tolerance;
  for (const candidate of candidates) {
    const screen = toScreen(candidate.x, candidate.y);
    const current = Math.hypot(screen.x - point.x, screen.y - point.y);
    if (current <= distance) { nearest = candidate; distance = current; }
  }
  return nearest;
}
