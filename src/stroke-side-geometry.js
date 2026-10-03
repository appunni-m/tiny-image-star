import { cornerRadiusKeys, roundedRectPathPoints } from './corner-radii.js';
import { strokeSideNames, strokeSideWidths } from './strokes.js';

/**
 * Split a rectangle/frame perimeter into four paths at the corner bisectors.
 * Each rounded-corner arc is shared by its neighboring sides, so a one-sided
 * border follows the same corner curve as the full outline instead of jumping
 * back to the unrounded box.
 */
export function rectangleStrokeSidePaths(width, height, radii, smoothing = 0) {
  const safeWidth = Math.max(0, Math.abs(Number(width) || 0));
  const safeHeight = Math.max(0, Math.abs(Number(height) || 0));
  if (!safeWidth || !safeHeight) return [];
  const cornerValues = typeof radii === 'number'
    ? Object.fromEntries(cornerRadiusKeys.map(key => [key, radii]))
    : radii;
  const points = roundedRectPathPoints(safeWidth, safeHeight, cornerValues, smoothing);
  if (points.length < 3) return [];

  const runs = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const side = nearestRectangleSide(middle, safeWidth, safeHeight);
    let run = runs.at(-1);
    if (!run || run.side !== side || !samePoint(run.points.at(-1), start)) {
      run = { side, points: [start, end] };
      runs.push(run);
    } else run.points.push(end);
  }

  // The rounded-rectangle path starts in the middle of the top edge, making
  // the top run straddle the array boundary. Join it without adding a cap at
  // the arbitrary path start.
  if (runs.length > 1 && runs[0].side === runs.at(-1).side
    && samePoint(runs.at(-1).points.at(-1), runs[0].points[0])) {
    runs[0].points = [...runs.at(-1).points, ...runs[0].points.slice(1)];
    runs.pop();
  }
  const order = new Map(strokeSideNames.map((side, index) => [side, index]));
  return runs.filter(run => run.points.length > 1)
    .sort((left, right) => order.get(left.side) - order.get(right.side));
}

/**
 * Build the corner wedges that connect adjacent side strokes. The side paths
 * intentionally end with butt caps at their bisectors; these wedges reproduce
 * the selected join without letting the editable line-cap setting create tabs
 * at those artificial endpoints. Coordinates are in the rectangle's local
 * space and are shared by Canvas and SVG.
 */
export function rectangleStrokeSideJoins(paths, sideWidths, join = 'miter', miterLimit = 10) {
  if (!Array.isArray(paths) || paths.length < 2 || !sideWidths) return [];
  const patches = [];
  for (let index = 0; index < paths.length; index += 1) {
    const previous = paths[index];
    const next = paths[(index + 1) % paths.length];
    const point = previous.points.at(-1);
    if (!point || !samePoint(point, next.points[0])) continue;
    const previousWidth = Math.max(0, Number(sideWidths[previous.side]) || 0);
    const nextWidth = Math.max(0, Number(sideWidths[next.side]) || 0);
    if (!(previousWidth > 0) || !(nextWidth > 0)) continue;
    const incoming = unitDirection(previous.points, true);
    const outgoing = unitDirection(next.points, false);
    if (!incoming || !outgoing) continue;
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    if (Math.abs(cross) < 1e-7) continue;
    const outerSign = cross > 0 ? -1 : 1;
    const incomingNormal = { x: -incoming.y * outerSign, y: incoming.x * outerSign };
    const outgoingNormal = { x: -outgoing.y * outerSign, y: outgoing.x * outerSign };
    const start = addScaled(point, incomingNormal, previousWidth / 2);
    const end = addScaled(point, outgoingNormal, nextWidth / 2);
    let boundary;
    if (join === 'round') {
      boundary = roundJoinBoundary(point, start, end,
        previousWidth / 2, nextWidth / 2, cross);
    } else if (join === 'miter') {
      const intersection = lineIntersection(start, incoming, end, outgoing);
      const limit = Math.max(1, Number(miterLimit) || 10) * Math.max(previousWidth, nextWidth) / 2;
      boundary = intersection && Math.hypot(intersection.x - point.x, intersection.y - point.y) <= limit + 1e-7
        ? [start, intersection, end]
        : [start, end];
    } else boundary = [start, end];
    const points = [point, ...boundary];
    if (points.length >= 3 && Math.abs(polygonArea(points)) > 1e-9) {
      patches.push({ corner: index, points });
    }
  }
  return patches;
}

function unitDirection(points, incoming) {
  const start = incoming ? points.at(-2) : points[0];
  const end = incoming ? points.at(-1) : points[1];
  if (!start || !end) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? { x: dx / length, y: dy / length } : null;
}

function addScaled(point, vector, amount) {
  return { x: point.x + vector.x * amount, y: point.y + vector.y * amount };
}

function lineIntersection(first, firstDirection, second, secondDirection) {
  const cross = firstDirection.x * secondDirection.y - firstDirection.y * secondDirection.x;
  if (Math.abs(cross) < 1e-9) return null;
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const distance = (dx * secondDirection.y - dy * secondDirection.x) / cross;
  return { x: first.x + firstDirection.x * distance, y: first.y + firstDirection.y * distance };
}

function roundJoinBoundary(center, start, end, startRadius, endRadius, cross) {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  let sweep = endAngle - startAngle;
  if (cross > 0) while (sweep < 0) sweep += Math.PI * 2;
  else while (sweep > 0) sweep -= Math.PI * 2;
  if (Math.abs(sweep) > Math.PI) sweep -= Math.sign(sweep) * Math.PI * 2;
  const maxRadius = Math.max(startRadius, endRadius);
  const steps = Math.max(2, Math.min(256, Math.ceil(Math.abs(sweep) * maxRadius / .5)));
  const points = [];
  for (let step = 0; step <= steps; step += 1) {
    const amount = step / steps;
    const angle = startAngle + sweep * amount;
    const radius = startRadius + (endRadius - startRadius) * amount;
    points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  }
  return points;
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    area += start.x * end.y - end.x * start.y;
  }
  return area / 2;
}

/** Return the effective weight for one rectangle/frame side. */
export function rectangleStrokeSideWidth(stroke, side) {
  if (!strokeSideNames.includes(side)) return 0;
  return strokeSideWidths(stroke)[side];
}

function nearestRectangleSide(point, width, height) {
  const distances = [
    ['top', Math.abs(point.y)],
    ['right', Math.abs(width - point.x)],
    ['bottom', Math.abs(height - point.y)],
    ['left', Math.abs(point.x)]
  ];
  distances.sort((left, right) => left[1] - right[1]);
  return distances[0][0];
}

function samePoint(left, right) {
  return Math.abs(left.x - right.x) < 1e-7 && Math.abs(left.y - right.y) < 1e-7;
}
