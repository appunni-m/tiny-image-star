const MAX_OFFSET_AMOUNT = 100_000;
const MAX_FLATTENED_POINTS = 20_000;
const MAX_INTERSECTION_CHECKS = 1_000_000;

export class VectorOffsetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VectorOffsetError';
  }
}

function fail(message) { throw new VectorOffsetError(message); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function point(x, y) { return { x, y }; }
function add(a, b) { return point(a.x + b.x, a.y + b.y); }
function subtract(a, b) { return point(a.x - b.x, a.y - b.y); }
function scale(a, factor) { return point(a.x * factor, a.y * factor); }
function cross(a, b) { return a.x * b.y - a.y * b.x; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function length(a) { return Math.hypot(a.x, a.y); }
function unit(a) {
  const size = length(a);
  return size > 0 ? scale(a, 1 / size) : null;
}

function cubicFlatness(curve) {
  const chord = subtract(curve.p3, curve.p0);
  const chordLength = length(chord);
  if (chordLength <= Number.EPSILON) return Math.max(distance(curve.p0, curve.p1), distance(curve.p0, curve.p2));
  const distanceToChord = value => Math.abs(cross(chord, subtract(value, curve.p0))) / chordLength;
  return Math.max(distanceToChord(curve.p1), distanceToChord(curve.p2));
}

function splitCubic(curve) {
  const p01 = scale(add(curve.p0, curve.p1), .5);
  const p12 = scale(add(curve.p1, curve.p2), .5);
  const p23 = scale(add(curve.p2, curve.p3), .5);
  const p012 = scale(add(p01, p12), .5);
  const p123 = scale(add(p12, p23), .5);
  const middle = scale(add(p012, p123), .5);
  return [
    { p0: curve.p0, p1: p01, p2: p012, p3: middle },
    { p0: middle, p1: p123, p2: p23, p3: curve.p3 }
  ];
}

function flattenCubic(curve, tolerance, output, depth = 0) {
  if (cubicFlatness(curve) <= tolerance || depth >= 18) {
    output.push(curve.p3);
    if (output.length > MAX_FLATTENED_POINTS) fail('This path is too detailed to offset safely. Simplify it and try again.');
    return;
  }
  const [left, right] = splitCubic(curve);
  flattenCubic(left, tolerance, output, depth + 1);
  flattenCubic(right, tolerance, output, depth + 1);
}

function sourceContours(node, width, height, tolerance) {
  const source = [{ points: node.points, closed: node.closed === true }, ...(Array.isArray(node.subpaths) ? node.subpaths : [])];
  if (!source.length || source.some(contour => contour.closed !== true)) {
    fail('Close every vector contour before offsetting it.');
  }
  let total = 0;
  return source.map(contour => {
    if (!Array.isArray(contour.points) || contour.points.length < 3) fail('Each closed contour needs at least three points.');
    const anchors = contour.points.map(value => {
      const x = Number(value?.x); const y = Number(value?.y);
      const incoming = value?.in || { x: 0, y: 0 };
      const outgoing = value?.out || { x: 0, y: 0 };
      if (![x, y, Number(incoming.x), Number(incoming.y), Number(outgoing.x), Number(outgoing.y)].every(Number.isFinite)) {
        fail('This path contains invalid anchor coordinates.');
      }
      const anchor = {
        point: point(x * width, y * height),
        incoming: point(Number(incoming.x) * width, Number(incoming.y) * height),
        outgoing: point(Number(outgoing.x) * width, Number(outgoing.y) * height)
      };
      if (![anchor.point.x, anchor.point.y, anchor.incoming.x, anchor.incoming.y, anchor.outgoing.x, anchor.outgoing.y].every(finite)) {
        fail('This path exceeds the coordinate range that can be offset safely.');
      }
      return anchor;
    });
    const vertices = [];
    for (let index = 0; index < anchors.length; index += 1) {
      const start = anchors[index];
      const end = anchors[(index + 1) % anchors.length];
      const p0 = start.point; const p3 = end.point;
      const chord = subtract(p3, p0);
      const outgoing = start.outgoing;
      const incoming = end.incoming;
      const curved = length(outgoing) > 1e-10 || length(incoming) > 1e-10;
      const curve = curved
        ? { p0, p1: add(p0, outgoing), p2: add(p3, incoming), p3 }
        : { p0, p1: add(p0, scale(chord, 1 / 3)), p2: add(p0, scale(chord, 2 / 3)), p3 };
      if (index === 0) vertices.push({ ...start.point, sharp: isSharpAnchor(anchors, index) });
      const samples = [];
      flattenCubic(curve, tolerance, samples);
      for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
        const last = sampleIndex === samples.length - 1;
        const closesContour = last && index === anchors.length - 1;
        if (closesContour) continue;
        const isAnchor = last;
        vertices.push({ ...samples[sampleIndex], sharp: isAnchor ? isSharpAnchor(anchors, (index + 1) % anchors.length) : false });
      }
    }
    const cleaned = removeDuplicateVertices(vertices);
    if (cleaned.length < 3) fail('Each closed contour needs at least three distinct points.');
    total += cleaned.length;
    if (total > MAX_FLATTENED_POINTS) fail('This path is too detailed to offset safely. Simplify it and try again.');
    return cleaned;
  });
}

function isSharpAnchor(anchors, index) {
  const current = anchors[index];
  const previous = anchors[(index - 1 + anchors.length) % anchors.length];
  const next = anchors[(index + 1) % anchors.length];
  const incoming = unit(length(current.incoming) > 1e-10 ? scale(current.incoming, -1) : subtract(current.point, previous.point));
  const outgoing = unit(length(current.outgoing) > 1e-10 ? current.outgoing : subtract(next.point, current.point));
  if (!incoming || !outgoing) return true;
  return incoming.x * outgoing.x + incoming.y * outgoing.y < Math.cos(Math.PI / 90);
}

function removeDuplicateVertices(vertices) {
  const output = [];
  for (const vertex of vertices) {
    const previous = output.at(-1);
    if (previous && distance(previous, vertex) <= 1e-10) {
      previous.sharp ||= vertex.sharp;
      continue;
    }
    output.push({ ...vertex });
  }
  if (output.length > 1 && distance(output[0], output.at(-1)) <= 1e-10) {
    output[0].sharp ||= output.at(-1).sharp;
    output.pop();
  }
  return output;
}

function signedArea(vertices) {
  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    area += cross(vertices[index], vertices[(index + 1) % vertices.length]);
  }
  return area / 2;
}

function pointScale(points) {
  if (!points.length) return 1;
  let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
  for (const value of points) {
    left = Math.min(left, value.x); top = Math.min(top, value.y);
    right = Math.max(right, value.x); bottom = Math.max(bottom, value.y);
  }
  return Math.max(1, right - left, bottom - top);
}

function windingAt(value, contours, budget) {
  let winding = 0;
  let crossings = 0;
  for (const contour of contours) {
    for (let index = 0; index < contour.length; index += 1) {
      budget.checks += 1;
      if (budget.checks > 5_000_000) fail('This path has too many nested contours to offset safely. Simplify it and try again.');
      const start = contour[index];
      const end = contour[(index + 1) % contour.length];
      if ((start.y <= value.y && end.y > value.y) || (start.y > value.y && end.y <= value.y)) {
        const side = cross(subtract(end, start), subtract(value, start));
        const crossesRight = (end.y > start.y && side > 0) || (end.y < start.y && side < 0);
        if (crossesRight) crossings += 1;
        if (start.y <= value.y && end.y > value.y && side > 0) winding += 1;
        else if (start.y > value.y && end.y <= value.y && side < 0) winding -= 1;
      }
    }
  }
  return { winding, crossings };
}

function filledAt(value, contours, fillRule, budget) {
  const result = windingAt(value, contours, budget);
  return fillRule === 'evenodd' ? result.crossings % 2 === 1 : result.winding !== 0;
}

function pointInsideContour(value, contour) {
  let inside = false;
  for (let index = 0, previousIndex = contour.length - 1; index < contour.length; previousIndex = index, index += 1) {
    const current = contour[index]; const previous = contour[previousIndex];
    if ((current.y > value.y) !== (previous.y > value.y)) {
      const intersectionX = (previous.x - current.x) * (value.y - current.y) / (previous.y - current.y) + current.x;
      if (value.x < intersectionX) inside = !inside;
    }
  }
  return inside;
}

function containmentMatrix(contours) {
  return contours.map((contour, index) => contours.map((other, otherIndex) =>
    index !== otherIndex && pointInsideContour(contour[0], other)));
}

function contourOutwardSide(contour, contours, fillRule, scaleHint, budget) {
  const epsilon = Math.max(1e-8, Math.min(scaleHint * 1e-7, scaleHint * 1e-4));
  const edges = contour.map((start, index) => ({ start, end: contour[(index + 1) % contour.length] }))
    .sort((a, b) => distance(b.start, b.end) - distance(a.start, a.end));
  for (const edge of edges) {
    const direction = unit(subtract(edge.end, edge.start));
    if (!direction) continue;
    const midpoint = scale(add(edge.start, edge.end), .5);
    const left = point(-direction.y, direction.x);
    for (const factor of [1, .1, .01, .001, .0001]) {
      const sampleDistance = epsilon * factor;
      const filledLeft = filledAt(add(midpoint, scale(left, sampleDistance)), contours, fillRule, budget);
      const filledRight = filledAt(subtract(midpoint, scale(left, sampleDistance)), contours, fillRule, budget);
      if (filledLeft !== filledRight) return filledLeft ? -1 : 1;
    }
  }
  fail('This contour overlaps another edge or has no unambiguous filled side.');
}

function crossTolerance(a, b, tolerance) { return tolerance * Math.max(1, length(a), length(b)); }

function pointOnSegment(value, start, end, tolerance) {
  if (value.x < Math.min(start.x, end.x) - tolerance || value.x > Math.max(start.x, end.x) + tolerance
    || value.y < Math.min(start.y, end.y) - tolerance || value.y > Math.max(start.y, end.y) + tolerance) return false;
  return Math.abs(cross(subtract(end, start), subtract(value, start))) <= crossTolerance(subtract(end, start), subtract(value, start), tolerance);
}

function segmentsIntersect(first, second, tolerance) {
  if (first.maxX < second.minX - tolerance || second.maxX < first.minX - tolerance
    || first.maxY < second.minY - tolerance || second.maxY < first.minY - tolerance) return false;
  const a = first.start; const b = first.end; const c = second.start; const d = second.end;
  const ab = subtract(b, a); const cd = subtract(d, c);
  const o1 = cross(ab, subtract(c, a)); const o2 = cross(ab, subtract(d, a));
  const o3 = cross(cd, subtract(a, c)); const o4 = cross(cd, subtract(b, c));
  const tol1 = crossTolerance(ab, subtract(c, a), tolerance);
  const tol2 = crossTolerance(ab, subtract(d, a), tolerance);
  const tol3 = crossTolerance(cd, subtract(a, c), tolerance);
  const tol4 = crossTolerance(cd, subtract(b, c), tolerance);
  if (((o1 > tol1 && o2 < -tol2) || (o1 < -tol1 && o2 > tol2))
    && ((o3 > tol3 && o4 < -tol4) || (o3 < -tol3 && o4 > tol4))) return true;
  return (Math.abs(o1) <= tol1 && pointOnSegment(c, a, b, tolerance))
    || (Math.abs(o2) <= tol2 && pointOnSegment(d, a, b, tolerance))
    || (Math.abs(o3) <= tol3 && pointOnSegment(a, c, d, tolerance))
    || (Math.abs(o4) <= tol4 && pointOnSegment(b, c, d, tolerance));
}

function heapPush(heap, value) {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].maxX <= value.maxX) break;
    heap[index] = heap[parent]; index = parent;
  }
  heap[index] = value;
}

function heapPop(heap) {
  const first = heap[0];
  const last = heap.pop();
  if (heap.length && last) {
    let index = 0;
    while (true) {
      const left = index * 2 + 1; const right = left + 1;
      if (left >= heap.length) break;
      const child = right < heap.length && heap[right].maxX < heap[left].maxX ? right : left;
      if (heap[child].maxX >= last.maxX) break;
      heap[index] = heap[child]; index = child;
    }
    heap[index] = last;
  }
  return first;
}

function adjacentSegments(first, second) {
  if (first.contourIndex !== second.contourIndex) return false;
  const difference = Math.abs(first.index - second.index);
  return difference === 1 || difference === first.count - 1;
}

function assertNoIntersections(contours, message) {
  const segments = [];
  contours.forEach((contour, contourIndex) => {
    for (let index = 0; index < contour.length; index += 1) {
      const start = contour[index]; const end = contour[(index + 1) % contour.length];
      segments.push({
        start, end, contourIndex, index, count: contour.length,
        minX: Math.min(start.x, end.x), maxX: Math.max(start.x, end.x),
        minY: Math.min(start.y, end.y), maxY: Math.max(start.y, end.y)
      });
    }
  });
  segments.sort((a, b) => a.minX - b.minX || a.minY - b.minY);
  const active = new Set(); const expirations = [];
  let checked = 0; let visited = 0;
  const scaleHint = pointScale(contours.flat());
  const tolerance = scaleHint * 1e-10;
  for (const segment of segments) {
    while (expirations.length && expirations[0].maxX < segment.minX - tolerance) active.delete(heapPop(expirations));
    for (const candidate of active) {
      visited += 1;
      if (visited > MAX_INTERSECTION_CHECKS * 2) fail('This path is too complex to offset safely. Simplify it and try again.');
      if (adjacentSegments(segment, candidate)
        || candidate.maxY < segment.minY - tolerance || segment.maxY < candidate.minY - tolerance) continue;
      checked += 1;
      if (checked > MAX_INTERSECTION_CHECKS) fail('This path is too complex to offset safely. Simplify it and try again.');
      if (segmentsIntersect(segment, candidate, tolerance)) fail(message);
    }
    active.add(segment);
    heapPush(expirations, segment);
  }
}

function lineCurve(start, end) {
  const delta = subtract(end, start);
  return { p0: start, p1: add(start, scale(delta, 1 / 3)), p2: add(start, scale(delta, 2 / 3)), p3: end, line: true };
}

function lineIntersection(startA, directionA, startB, directionB) {
  const denominator = cross(directionA, directionB);
  if (Math.abs(denominator) <= 1e-12) return null;
  const amount = cross(subtract(startB, startA), directionB) / denominator;
  const result = add(startA, scale(directionA, amount));
  return finite(result.x) && finite(result.y) ? result : null;
}

function roundArc(center, start, end, direction) {
  const radius = distance(center, start);
  if (!(radius > 1e-12) || distance(start, end) <= 1e-12) return [];
  const firstAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const lastAngle = Math.atan2(end.y - center.y, end.x - center.x);
  let sweep = Math.atan2(Math.sin(lastAngle - firstAngle), Math.cos(lastAngle - firstAngle));
  if (direction > 0 && sweep < 0) sweep += Math.PI * 2;
  else if (direction < 0 && sweep > 0) sweep -= Math.PI * 2;
  if (Math.abs(sweep) > Math.PI + 1e-9) sweep -= Math.sign(sweep) * Math.PI * 2;
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-10));
  const curves = [];
  for (let index = 0; index < count; index += 1) {
    const angle0 = firstAngle + sweep * index / count;
    const angle1 = firstAngle + sweep * (index + 1) / count;
    const step = angle1 - angle0;
    const controlScale = 4 / 3 * Math.tan(step / 4) * radius;
    const p0 = index === 0 ? start : add(center, point(Math.cos(angle0) * radius, Math.sin(angle0) * radius));
    const p3 = index === count - 1 ? end : add(center, point(Math.cos(angle1) * radius, Math.sin(angle1) * radius));
    const tangent0 = point(-Math.sin(angle0), Math.cos(angle0));
    const tangent1 = point(-Math.sin(angle1), Math.cos(angle1));
    curves.push({ p0, p1: add(p0, scale(tangent0, controlScale)), p2: subtract(p3, scale(tangent1, controlScale)), p3, line: false });
  }
  return curves;
}

function offsetContour(vertices, distanceAmount, outwardSide, join) {
  const joins = [];
  const signedDistance = distanceAmount * outwardSide;
  for (let index = 0; index < vertices.length; index += 1) {
    const previous = vertices[(index - 1 + vertices.length) % vertices.length];
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const incomingVector = subtract(current, previous);
    const outgoingVector = subtract(next, current);
    const incoming = unit(incomingVector); const outgoing = unit(outgoingVector);
    if (!incoming || !outgoing) fail('This contour contains a zero-length segment.');
    const turn = cross(incoming, outgoing);
    const leftIncoming = point(-incoming.y, incoming.x);
    const leftOutgoing = point(-outgoing.y, outgoing.x);
    const start = add(current, scale(leftIncoming, signedDistance));
    const end = add(current, scale(leftOutgoing, signedDistance));
    const convexOuter = turn * signedDistance < -1e-10;
    if (join === 'round' && current.sharp && convexOuter) {
      joins.push({ start, end, curves: roundArc(current, start, end, Math.sign(turn)) });
      continue;
    }
    const intersection = lineIntersection(start, incoming, end, outgoing);
    const miter = intersection && Math.abs(signedDistance) > 1e-12
      ? distance(current, intersection) / Math.abs(signedDistance) : 1;
    if (intersection && finite(miter) && miter <= 32) {
      joins.push({ start: intersection, end: intersection, curves: [] });
    } else if (distance(start, end) > 1e-10) {
      joins.push({ start, end, curves: [lineCurve(start, end)] });
    } else {
      joins.push({ start, end: start, curves: [] });
    }
  }
  const curves = [];
  for (let index = 0; index < joins.length; index += 1) {
    const current = joins[index]; const next = joins[(index + 1) % joins.length];
    curves.push(...current.curves);
    if (distance(current.end, next.start) > 1e-10) curves.push(lineCurve(current.end, next.start));
  }
  if (curves.length < 3) fail('This offset collapsed to an unusable contour.');
  return curves;
}

function geometryFromCurveContours(curvesByContour, node, geometry) {
  const controls = curvesByContour.flatMap(contour => contour.flatMap(curve => [curve.p0, curve.p1, curve.p2, curve.p3]));
  let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
  for (const value of controls) {
    left = Math.min(left, value.x); top = Math.min(top, value.y);
    right = Math.max(right, value.x); bottom = Math.max(bottom, value.y);
  }
  const width = right - left; const height = bottom - top;
  if (![left, top, width, height].every(finite) || width <= 1e-8 || height <= 1e-8) fail('This offset has no positive editable bounds.');
  const normalize = value => ({ x: (value.x - left) / width, y: (value.y - top) / height });
  let pointCount = 0;
  const encode = curves => {
    if (curves.length > MAX_FLATTENED_POINTS) fail('This offset creates too many editable points. Reduce the offset distance.');
    pointCount += curves.length;
    if (pointCount > MAX_FLATTENED_POINTS) fail('This offset creates too many editable points. Reduce the offset distance.');
    return curves.map((curve, index) => {
      const anchor = curve.p0;
      const previous = curves[(index - 1 + curves.length) % curves.length];
      const inControl = previous.line ? anchor : previous.p2;
      const outControl = curve.line ? anchor : curve.p1;
      return {
        ...normalize(anchor),
        in: { x: (inControl.x - anchor.x) / width, y: (inControl.y - anchor.y) / height },
        out: { x: (outControl.x - anchor.x) / width, y: (outControl.y - anchor.y) / height }
      };
    });
  };
  const contours = curvesByContour.map(encode);
  const oldCenter = point(geometry.width / 2, geometry.height / 2);
  const newCenter = point(width / 2, height / 2);
  const radians = Number(geometry.rotation || 0) * Math.PI / 180;
  const cosine = Math.cos(radians); const sine = Math.sin(radians);
  const rotate = value => point(cosine * value.x - sine * value.y, sine * value.x + cosine * value.y);
  const originShift = point(left, top);
  const centerDelta = subtract(oldCenter, newCenter);
  const baseShift = add(rotate(originShift), subtract(centerDelta, rotate(centerDelta)));
  const affine = node.affineTransform || {};
  const parentShift = point(
    Number(affine.a ?? 1) * baseShift.x + Number(affine.c || 0) * baseShift.y,
    Number(affine.b || 0) * baseShift.x + Number(affine.d ?? 1) * baseShift.y
  );
  if (![parentShift.x, parentShift.y, geometry.x + parentShift.x, geometry.y + parentShift.y].every(finite)) {
    fail('This offset exceeds the coordinate range that can be saved safely.');
  }
  const first = contours[0];
  return {
    x: geometry.x + parentShift.x,
    y: geometry.y + parentShift.y,
    width,
    height,
    points: first,
    ...(contours.length > 1 ? { subpaths: contours.slice(1).map(points => ({ closed: true, points })) } : { subpaths: [] }),
    closed: true,
    fillRule: node.fillRule || 'nonzero'
  };
}

/** Build a destructive, undoable path replacement without mutating the source node. */
export function offsetVectorPath(node, amount, join = 'square', geometry = node) {
  if (node?.type !== 'path') fail('Select one editable vector path to offset.');
  if (!finite(amount) || amount === 0 || Math.abs(amount) > MAX_OFFSET_AMOUNT) {
    fail(`Enter a non-zero offset between −${MAX_OFFSET_AMOUNT.toLocaleString()} and ${MAX_OFFSET_AMOUNT.toLocaleString()} px.`);
  }
  if (!['square', 'round'].includes(join)) fail('Choose a square or round join.');
  if (!geometry || !['x', 'y', 'width', 'height'].every(key => finite(geometry[key]))
    || geometry.width <= 0 || geometry.height <= 0) fail('This path needs finite positive dimensions before it can be offset.');
  if (!finite(Number(geometry.rotation || 0))) fail('This path has an invalid rotation.');
  if (node.fillRule != null && !['nonzero', 'evenodd'].includes(node.fillRule)) fail('This path has an unsupported fill rule.');
  if (node.affineTransform != null && (!node.affineTransform || typeof node.affineTransform !== 'object' || Array.isArray(node.affineTransform)
    || !['a', 'b', 'c', 'd'].every(key => finite(node.affineTransform[key])))) fail('This path has an invalid affine transform.');
  const tolerance = Math.max(.05, Math.min(.25, Math.abs(amount) * .005 || .05));
  const contours = sourceContours(node, geometry.width, geometry.height, tolerance);
  const points = contours.flat();
  const scaleHint = pointScale(points);
  assertNoIntersections(contours, 'This path contains intersecting contours and cannot be offset safely.');
  if (contours.some(contour => Math.abs(signedArea(contour)) < 1e-10)) fail('This contour has no stable filled area to offset.');
  const fillRule = node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
  const fillBudget = { checks: 0 };
  const curves = contours.map(contour => {
    const outward = contourOutwardSide(contour, contours, fillRule, scaleHint, fillBudget);
    const result = offsetContour(contour, amount, outward, join);
    const area = signedArea(contour);
    const outputAnchors = result.map(curve => curve.p0);
    if (Math.abs(signedArea(outputAnchors)) <= 1e-8 || Math.sign(signedArea(outputAnchors)) !== Math.sign(area)) {
      fail('This offset collapses or reverses a contour. Choose a smaller amount.');
    }
    return result;
  });
  const outputPolygons = curves.map(contour => contour.map(curve => curve.p0));
  assertNoIntersections(outputPolygons, 'This offset would merge or cross contours. Choose a smaller amount.');
  const sourceContainment = containmentMatrix(contours);
  const outputContainment = containmentMatrix(outputPolygons);
  if (sourceContainment.some((row, index) => row.some((contained, otherIndex) => contained !== outputContainment[index][otherIndex]))) {
    fail('This offset changes which contours contain each other. Choose a smaller amount.');
  }
  return geometryFromCurveContours(curves, node, geometry);
}
