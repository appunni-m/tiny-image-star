function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

function endpoint(point) { return { x: point.x, y: point.y }; }

/** Evaluate one frame-relative line or cubic segment between consecutive path points. */
export function vectorSegmentPoint(path, startIndex, t) {
  const points = path?.points, start = points?.[startIndex];
  if (!Array.isArray(points) || !start || !Number.isFinite(t) || t < 0 || t > 1)
    throw new Error("Choose a point on a valid vector segment.");
  const endIndex = (startIndex + 1) % points.length, end = points[endIndex];
  if (!end || (!path.closed && endIndex === 0)) throw new Error("Choose a segment between vector points.");
  const p0 = endpoint(start), p1 = start.handleOut ? endpoint(start.handleOut) : p0;
  const p3 = endpoint(end), p2 = end.handleIn ? endpoint(end.handleIn) : p3;
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

/** Insert a node by splitting its line or cubic Bézier segment without changing the rendered curve. */
export function insertVectorPoint(path, startIndex, t) {
  const count = path?.points?.length ?? 0;
  const endIndex = (startIndex + 1) % count;
  if (!Array.isArray(path?.points) || !Number.isInteger(startIndex) || startIndex < 0 || startIndex >= count
    || (!path.closed && endIndex === 0) || !Number.isFinite(t) || t <= 0 || t >= 1 || count >= 512)
    throw new Error("Choose a valid segment to add a vector point.");
  const points = structuredClone(path.points), start = points[startIndex], end = points[endIndex];
  const p0 = endpoint(start), p1 = start.handleOut ? endpoint(start.handleOut) : p0;
  const p3 = endpoint(end), p2 = end.handleIn ? endpoint(end.handleIn) : p3;
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
  const d = lerp(a, b, t), e = lerp(b, c, t), anchor = lerp(d, e, t);
  const point = { ...anchor };
  if (start.handleOut || end.handleIn) {
    start.handleOut = a;
    end.handleIn = c;
    point.handleIn = d;
    point.handleOut = e;
    point.handleMode = "smooth";
  }
  points.splice(startIndex + 1, 0, point);
  return { ...structuredClone(path), points };
}

/** Remove a vector node while retaining the other nodes and handles. */
export function deleteVectorPoint(path, index) {
  const count = path?.points?.length ?? 0, minimum = path?.closed ? 3 : 2;
  if (!Array.isArray(path?.points) || !Number.isInteger(index) || index < 0 || index >= count || count <= minimum)
    throw new Error(`A ${path?.closed ? "closed" : "open"} path needs at least ${minimum} points.`);
  const points = structuredClone(path.points);
  points.splice(index, 1);
  return { ...structuredClone(path), points };
}
