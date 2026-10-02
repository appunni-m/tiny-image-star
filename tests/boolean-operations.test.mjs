import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, applyBooleanBake, bakeBoolean, bindVariable, canCombineBoolean, combineBoolean, createDocument, createNode, createVariable, createVariableCollection, findNode,
  parseDocument, prepareBooleanBake, separateBoolean, serializeDocument, validateDocument
} from '../src/model.js';
import { History } from '../src/history.js';
import {
  appendVectorNetworkPath, setVectorNodePoint, vectorNetworkEdgeForPair,
  vectorNetworkEdgePairIndex, vectorNetworkEdgePoints, vectorNetworkGeometryFromAnchors,
  vectorNetworkVertexPoint, vectorNodePoint
} from '../src/vector-path.js';
import { booleanSourceTransform, flattenBooleanContours, flattenBooleanPathContours, polygonBoolean, shapeBuilderRegionAtPoint } from '../src/boolean-geometry.js';
import { containsPointInRoundedRect } from '../src/corner-radii.js';
import { exportNodeToSvg } from '../src/svg-export.js';

test('Boolean combine keeps editable operands and their stacking order', () => {
  const document = createDocument();
  const back = createNode('rectangle', { name: 'Back layer', x: -200, y: 0 });
  const base = createNode('rectangle', { name: 'Base', x: 20, y: 30, width: 100, height: 60, fill: '#123456' });
  const middle = createNode('ellipse', { name: 'Unselected middle', x: 300, y: 0 });
  const cutter = createNode('ellipse', { name: 'Cutter', x: 80, y: 20, width: 50, height: 80 });
  const front = createNode('rectangle', { name: 'Front layer', x: 400, y: 0 });
  for (const node of [back, base, middle, cutter, front]) addNode(document, node);

  assert.equal(canCombineBoolean(document, [cutter.id, base.id]), true);
  const group = combineBoolean(document, [cutter.id, base.id], 'subtract');
  assert.equal(group.type, 'boolean');
  assert.equal(group.operation, 'subtract');
  assert.deepEqual(group.children.map(node => node.id), [base.id, cutter.id]);
  assert.deepEqual(document.pages[0].children.map(node => node.id), [back.id, middle.id, group.id, front.id]);
  assert.deepEqual({ x: group.x, y: group.y, width: group.width, height: group.height }, { x: 20, y: 20, width: 110, height: 80 });
  assert.deepEqual({ x: group.children[0].x, y: group.children[0].y }, { x: 0, y: 10 });
  assert.deepEqual({ x: group.children[1].x, y: group.children[1].y }, { x: 60, y: 0 });
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('Boolean combine accepts text layers and preserves editable text as a live operand', () => {
  const document = createDocument();
  const label = createNode('text', {
    name: 'Label', x: 10, y: 20, width: 100, height: 32,
    text: 'Local first', fontFamily: 'Arial, sans-serif', fontSize: 24
  });
  const cutter = createNode('rectangle', { name: 'Cutter', x: 45, y: 10, width: 50, height: 50 });
  addNode(document, label); addNode(document, cutter);

  assert.equal(canCombineBoolean(document, [label.id, cutter.id]), true);
  const group = combineBoolean(document, [label.id, cutter.id], 'intersect');
  assert.deepEqual(group.children.map(node => node.type), ['text', 'rectangle']);
  assert.equal(group.children[0].text, 'Local first');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true,
    'text remains editable and valid inside the non-destructive Boolean group');
});

test('Boolean combine requires unlocked closed vector siblings in one container', () => {
  const document = createDocument();
  const frame = createNode('frame');
  const first = createNode('rectangle');
  const second = createNode('ellipse', { x: 30 });
  const locked = createNode('rectangle', { locked: true });
  const openPath = createNode('path', { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false });
  addNode(document, frame); addNode(document, first); addNode(document, second);
  addNode(document, locked); addNode(document, openPath); addNode(document, createNode('rectangle'), { parentId: frame.id });

  assert.equal(canCombineBoolean(document, [first.id]), false);
  assert.equal(canCombineBoolean(document, [first.id, locked.id]), false);
  assert.equal(canCombineBoolean(document, [first.id, openPath.id]), false);
  assert.equal(canCombineBoolean(document, [first.id, frame.children[0].id]), false);
  assert.throws(() => combineBoolean(document, [first.id, second.id], 'merge'), /supported Boolean/);
  assert.throws(() => combineBoolean(document, [first.id, frame.children[0].id]), /same container/);
  assert.equal(canCombineBoolean(document, [first.id, second.id]), true);
});

test('Shape Builder resolves the exact overlap and source-only face of crossing vector layers', () => {
  const first = createNode('rectangle', { x: 0, y: 0, width: 100, height: 100 });
  const second = createNode('rectangle', { x: 50, y: 0, width: 100, height: 100 });
  const boundsOf = result => result.contours.flat().flatMap(curve => [curve.p0, curve.p1, curve.p2, curve.p3])
    .reduce((bounds, point) => ({
      left: Math.min(bounds.left, point.x), top: Math.min(bounds.top, point.y),
      right: Math.max(bounds.right, point.x), bottom: Math.max(bounds.bottom, point.y)
    }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const assertBoundsNear = (actual, expected) => {
    for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-6, `${key}: ${actual[key]} ≈ ${expected[key]}`);
  };

  const overlap = shapeBuilderRegionAtPoint([first, second], { x: 75, y: 50 });
  assert.deepEqual(overlap.membership, [true, true]);
  assertBoundsNear(boundsOf(overlap), { left: 50, top: 0, right: 100, bottom: 100 });

  const firstOnly = shapeBuilderRegionAtPoint([first, second], { x: 25, y: 50 });
  assert.deepEqual(firstOnly.membership, [true, false]);
  assertBoundsNear(boundsOf(firstOnly), { left: 0, top: 0, right: 50, bottom: 100 });
  assert.equal(shapeBuilderRegionAtPoint([first, second], { x: 125, y: 50 }).signature, '01');
  assert.equal(shapeBuilderRegionAtPoint([first, second], { x: 200, y: 50 }), null,
    'points outside the selected geometry do not invent a face');
});

test('Shape Builder keeps disconnected faces separate and includes holes in the selected face', () => {
  const compound = createNode('path', {
    name: 'Two islands', x: 0, y: 0, width: 100, height: 40, closed: true, fillRule: 'evenodd',
    points: [{ x: 0, y: 0 }, { x: .2, y: 0 }, { x: .2, y: 1 }, { x: 0, y: 1 }],
    subpaths: [{ closed: true, points: [
      { x: .8, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: .8, y: 1 }
    ] }]
  });
  const enclosing = createNode('rectangle', { x: -10, y: -10, width: 120, height: 60 });
  const left = shapeBuilderRegionAtPoint([compound, enclosing], { x: 10, y: 20 });
  const right = shapeBuilderRegionAtPoint([compound, enclosing], { x: 90, y: 20 });
  assert.equal(left.contours.length, 1);
  assert.equal(right.contours.length, 1);
  assert.notEqual(left.contours[0][0].p0.x, right.contours[0][0].p0.x,
    'clicking equal-membership islands must return only the component under the pointer');

  const outer = createNode('rectangle', { x: 0, y: 60, width: 100, height: 100 });
  const hole = createNode('rectangle', { x: 25, y: 85, width: 50, height: 50 });
  const ring = shapeBuilderRegionAtPoint([outer, hole], { x: 10, y: 110 });
  assert.deepEqual(ring.membership, [true, false]);
  assert.equal(ring.contours.length, 2, 'the extracted annulus needs both its outer and hole contours');
  const center = shapeBuilderRegionAtPoint([outer, hole], { x: 50, y: 110 });
  assert.equal(center.contours.length, 1, 'the face inside the hole stays separately selectable');
});

test('separate restores source geometry through Boolean group scale and rotation', () => {
  const document = createDocument();
  const first = createNode('rectangle', { x: 20, y: 40, width: 20, height: 20 });
  const second = createNode('ellipse', { x: 60, y: 40, width: 20, height: 20 });
  addNode(document, first); addNode(document, second);
  const group = combineBoolean(document, [first.id, second.id], 'union');
  group.width = 120; group.height = 40; group.rotation = 90;

  const restored = separateBoolean(document, group.id);
  assert.deepEqual(restored.map(node => node.id), [first.id, second.id]);
  assert.deepEqual(document.pages[0].children.map(node => node.id), [first.id, second.id]);
  assert.deepEqual(restored.map(({ x, y, width, height, rotation }) => ({ x, y, width, height, rotation })), [
    { x: 60, y: 0, width: 40, height: 40, rotation: 90 },
    { x: 60, y: 80, width: 40, height: 40, rotation: 90 }
  ]);
  assert.equal(findNode(document, group.id), null);
  assert.equal(validateDocument(document), true);
});

test('sub-unit Boolean sources keep their original geometry at the one-pixel group minimum', () => {
  const makeFixture = () => {
    const document = createDocument();
    const first = createNode('rectangle', { width: 0.25, height: 0.5 });
    const second = createNode('rectangle', { x: 0.25, width: 0.25, height: 0.5 });
    addNode(document, first); addNode(document, second);
    const group = combineBoolean(document, [first.id, second.id], 'union');
    assert.deepEqual({ width: group.width, height: group.height }, { width: 1, height: 1 });
    return { document, group, ids: [first.id, second.id] };
  };

  const bakeFixture = makeFixture();
  const contours = flattenBooleanContours(bakeFixture.group);
  assert.equal(Math.abs(contours.reduce((sum, contour) => sum + contourArea(contour), 0)), 0.25,
    'live and baked geometry should retain the original half-by-half union inside the minimum group box');
  const baked = bakeBoolean(bakeFixture.document, bakeFixture.group.id);
  const bakedArea = Math.abs(contourArea(baked.points.map(point => ({ x: point.x * baked.width, y: point.y * baked.height }))));
  assert.equal(bakedArea, 0.25);

  const separateFixture = makeFixture();
  const separated = separateBoolean(separateFixture.document, separateFixture.group.id);
  assert.deepEqual(separated.map(({ x, y, width, height }) => ({ x, y, width, height })), [
    { x: 0, y: 0, width: 0.25, height: 0.5 },
    { x: 0.25, y: 0, width: 0.25, height: 0.5 }
  ], 'Separate should keep the same source geometry as the live and baked preview');
});

test('Boolean groups reject invalid operations, child sets, and nested open paths on reload', () => {
  const document = createDocument();
  const group = createNode('boolean', { children: [createNode('rectangle'), createNode('ellipse')] });
  addNode(document, group);
  assert.equal(validateDocument(document), true);
  const invalidOperation = structuredClone(document);
  invalidOperation.pages[0].children[0].operation = 'merge';
  assert.throws(() => validateDocument(invalidOperation), /Invalid Boolean group/);
  const openOperand = structuredClone(document);
  openOperand.pages[0].children[0].children[0] = createNode('path', { closed: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
  assert.throws(() => validateDocument(openOperand), /Invalid Boolean group/);
  const tooFew = structuredClone(document);
  tooFew.pages[0].children[0].children.pop();
  assert.throws(() => validateDocument(tooFew), /Invalid Boolean group/);
});

function rectangleContour(x, y, width, height) {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

function contourArea(contour) {
  return contour.reduce((sum, point, index) => {
    const next = contour[(index + 1) % contour.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function cubicCirclePath(x, y, radius) {
  const k = 0.5522847498307936;
  return createNode('path', {
    x, y, width: radius * 2, height: radius * 2, closed: true, fillRule: 'nonzero',
    points: [
      { x: .5, y: 0, in: { x: -k / 2, y: 0 }, out: { x: k / 2, y: 0 } },
      { x: 1, y: .5, in: { x: 0, y: -k / 2 }, out: { x: 0, y: k / 2 } },
      { x: .5, y: 1, in: { x: k / 2, y: 0 }, out: { x: -k / 2, y: 0 } },
      { x: 0, y: .5, in: { x: 0, y: k / 2 }, out: { x: 0, y: -k / 2 } }
    ]
  });
}

function sampledPathContours(node, steps = 64) {
  return [
    { points: node.points || [], closed: node.closed ?? false },
    ...(node.subpaths || [])
  ].map(contour => {
    const result = [];
    const points = contour.points;
    const count = contour.closed ? points.length : points.length - 1;
    for (let index = 0; index < count; index += 1) {
      const start = points[index]; const end = points[(index + 1) % points.length];
      const p0 = { x: node.x + start.x * node.width, y: node.y + start.y * node.height };
      const p3 = { x: node.x + end.x * node.width, y: node.y + end.y * node.height };
      const hasControls = [start.out, end.in].some(handle => handle && (handle.x !== 0 || handle.y !== 0));
      const p1 = hasControls ? { x: p0.x + (start.out?.x || 0) * node.width, y: p0.y + (start.out?.y || 0) * node.height }
        : { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 };
      const p2 = hasControls ? { x: p3.x + (end.in?.x || 0) * node.width, y: p3.y + (end.in?.y || 0) * node.height }
        : { x: p0.x + 2 * (p3.x - p0.x) / 3, y: p0.y + 2 * (p3.y - p0.y) / 3 };
      for (let step = 0; step < steps; step += 1) {
        const t = step / steps; const u = 1 - t;
        result.push({
          x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
          y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y
        });
      }
    }
    return result;
  });
}

function sampledNetworkContours(node, steps = 64) {
  const edgesByPair = vectorNetworkEdgePairIndex(node);
  return node.faces.map(face => {
    const result = [];
    for (let index = 0; index < face.vertexIds.length; index += 1) {
      const fromId = face.vertexIds[index];
      const toId = face.vertexIds[(index + 1) % face.vertexIds.length];
      const edge = vectorNetworkEdgeForPair(edgesByPair, fromId, toId);
      const points = vectorNetworkEdgePoints(node, edge.id, { x: node.x, y: node.y });
      const reversed = edge.from !== fromId;
      const [p0, p1, p2, p3] = reversed
        ? [points[3], points[2], points[1], points[0]] : points;
      for (let step = 0; step < steps; step += 1) {
        const t = step / steps; const inverse = 1 - t;
        result.push({
          x: inverse ** 3 * p0.x + 3 * inverse ** 2 * t * p1.x + 3 * inverse * t ** 2 * p2.x + t ** 3 * p3.x,
          y: inverse ** 3 * p0.y + 3 * inverse ** 2 * t * p1.y + 3 * inverse * t ** 2 * p2.y + t ** 3 * p3.y
        });
      }
    }
    return result;
  });
}

function insideSampledContours(point, contours) {
  let inside = false;
  for (const contour of contours) {
    for (let index = 0, previous = contour.length - 1; index < contour.length; previous = index, index += 1) {
      const a = contour[index]; const b = contour[previous];
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

function booleanMembership(operation, first, second, point) {
  const a = insideSampledContours(point, first); const b = insideSampledContours(point, second);
  if (operation === 'union') return a || b;
  if (operation === 'subtract') return a && !b;
  if (operation === 'intersect') return a && b;
  return a !== b;
}

function nearestEllipseBoundaryDistance(point, ellipse) {
  const distanceAt = angle => Math.hypot(
    point.x - (ellipse.cx + Math.cos(angle) * ellipse.rx),
    point.y - (ellipse.cy + Math.sin(angle) * ellipse.ry)
  );
  const samples = 1024;
  let bestIndex = 0; let bestDistance = Infinity;
  for (let index = 0; index < samples; index += 1) {
    const candidate = distanceAt(index * Math.PI * 2 / samples);
    if (candidate < bestDistance) { bestDistance = candidate; bestIndex = index; }
  }
  let low = (bestIndex - 1) * Math.PI * 2 / samples;
  let high = (bestIndex + 1) * Math.PI * 2 / samples;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const first = (2 * low + high) / 3;
    const second = (low + 2 * high) / 3;
    if (distanceAt(first) <= distanceAt(second)) high = second;
    else low = first;
  }
  return distanceAt((low + high) / 2);
}

test('polygon Boolean boundaries preserve exact overlaps for all four operations', () => {
  const first = { contours: [rectangleContour(0, 0, 10, 10)] };
  const second = { contours: [rectangleContour(5, 0, 10, 10)] };
  const expected = { union: 150, subtract: 50, intersect: 50, exclude: 100 };
  for (const operation of Object.keys(expected)) {
    const contours = polygonBoolean([first, second], operation);
    assert.equal(contours.reduce((sum, contour) => sum + Math.abs(contourArea(contour)), 0), expected[operation], operation);
    assert.ok(contours.every(contour => contour.length === 4), `${operation} output should remove the collinear split points`);
  }
  assert.equal(polygonBoolean([{ contours: [rectangleContour(0, 0, 10, 10)] }, { contours: [rectangleContour(20, 0, 10, 10)] }], 'union').length, 2,
    'disjoint inputs become two editable contours');
});

test('coincident, contained, edge-adjacent, and point-touching polygons stitch deterministically', () => {
  const square = rectangleContour(0, 0, 10, 10);
  const inner = rectangleContour(2, 2, 6, 6);
  const coincident = { contours: [square] };
  const contained = { contours: [inner] };
  assert.equal(polygonBoolean([coincident, { contours: [rectangleContour(0, 0, 10, 10)] }], 'union').length, 1);
  assert.equal(polygonBoolean([coincident, { contours: [rectangleContour(0, 0, 10, 10)] }], 'subtract').length, 0);
  assert.equal(polygonBoolean([coincident, { contours: [rectangleContour(0, 0, 10, 10)] }], 'exclude').length, 0);
  assert.deepEqual(['union', 'subtract', 'intersect', 'exclude'].map(operation => {
    const contours = polygonBoolean([coincident, contained], operation);
    return Math.abs(contours.reduce((sum, contour) => sum + contourArea(contour), 0));
  }), [100, 64, 36, 64]);
  assert.deepEqual(polygonBoolean([
    { contours: [rectangleContour(0, 0, 10, 10)] },
    { contours: [rectangleContour(10, 0, 10, 10)] }
  ], 'union').map(contour => contour.length), [4], 'shared collinear edges disappear from adjacent union output');
  assert.deepEqual(polygonBoolean([
    { contours: [rectangleContour(0, 0, 10, 10)] },
    { contours: [rectangleContour(10, 10, 10, 10)] }
  ], 'union').map(contour => contour.length), [4, 4], 'point-touching shapes remain two valid contours that share one endpoint');
});

test('baking a subtract result preserves a hole, node identity, bounds, rotation and editable points', () => {
  const document = createDocument();
  const base = createNode('rectangle', { name: 'Base', x: 20, y: 30, width: 100, height: 80, fill: '#3567ab' });
  const cutter = createNode('rectangle', { name: 'Cutout', x: 45, y: 50, width: 20, height: 20 });
  addNode(document, base); addNode(document, cutter);
  const group = combineBoolean(document, [base.id, cutter.id], 'subtract');
  group.rotation = 17;
  const originalBounds = { x: group.x, y: group.y, width: group.width, height: group.height, rotation: group.rotation };

  const history = new History();
  history.checkpoint(document, 'Bake Boolean to vector path');
  const baked = bakeBoolean(document, group.id);
  assert.equal(baked, group, 'baking converts the selected layer in place');
  assert.equal(baked.type, 'path');
  assert.equal(baked.id, group.id);
  assert.equal(baked.fillRule, 'evenodd');
  assert.equal(baked.closed, true);
  assert.equal(baked.points.length, 4);
  assert.equal(baked.subpaths.length, 1, 'the subtraction hole is a second editable contour');
  assert.deepEqual({ x: baked.x, y: baked.y, width: baked.width, height: baked.height, rotation: baked.rotation }, originalBounds);
  assert.deepEqual(baked.children, []);
  assert.equal(Object.hasOwn(baked, 'operation'), false);
  const holeCoordinates = baked.subpaths[0].points.map(point => [point.x * baked.width, point.y * baked.height].join(','));
  assert.deepEqual(holeCoordinates.sort(), ['25,20', '25,40', '45,20', '45,40']);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true, 'native contours survive document serialization');

  const anchor = vectorNodePoint(baked, 0);
  assert.equal(setVectorNodePoint(baked, 0, 'anchor', { x: anchor.x + 1, y: anchor.y + 2 }), true);
  assert.deepEqual(vectorNodePoint(baked, 0), { x: anchor.x + 1, y: anchor.y + 2 }, 'baked corners use the ordinary vector point editor');

  const undone = history.undo(document);
  assert.equal(findNode(undone, group.id).node.type, 'boolean');
  assert.equal(history.undoStack.length, 0, 'the whole bake is one undo step');
  const redone = history.redo(undone);
  assert.equal(findNode(redone, group.id).node.type, 'path');
  assert.equal(history.redoStack.length, 0);
});

test('star Boolean baking matches live star angles and circular radius on a non-square layer', () => {
  const document = createDocument();
  const star = createNode('star', { width: 80, height: 40, points: 5, innerRadius: 0.48 });
  const separate = createNode('rectangle', { x: 100, width: 20, height: 20 });
  addNode(document, star); addNode(document, separate);
  const group = combineBoolean(document, [star.id, separate.id], 'union');
  const baked = bakeBoolean(document, group.id);

  const actual = baked.points.map(point => ({ x: point.x * baked.width, y: point.y * baked.height }));
  const expected = Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const radius = 20 * (index % 2 ? 0.48 : 1);
    return { x: 40 + Math.cos(angle) * radius, y: 20 + Math.sin(angle) * radius };
  });
  assert.equal(actual.length, 10, 'the star outline should retain its ten alternating vertices');
  for (const point of expected) {
    assert.ok(actual.some(candidate => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 1e-7),
      `the baked star should preserve the live vertex at ${point.x}, ${point.y}`);
  }
});

test('ellipse Boolean baking produces a bounded-error editable cubic path', () => {
  const document = createDocument();
  const ellipse = createNode('ellipse', { name: 'Ellipse', x: 20, y: 30, width: 100, height: 60 });
  const separate = createNode('rectangle', { x: 180, y: 35, width: 20, height: 20 });
  addNode(document, ellipse); addNode(document, separate);
  const group = combineBoolean(document, [ellipse.id, separate.id], 'union');
  const baked = bakeBoolean(document, group.id);

  const contours = [baked.points, ...baked.subpaths.map(contour => contour.points)];
  const ellipsePoints = contours.find(points => points.length === 12);
  assert.ok(ellipsePoints, 'the ellipse remains a 12-segment editable Bézier contour');
  assert.ok(ellipsePoints.some(point => Math.hypot(point.in.x, point.in.y) > 1e-5));
  assert.ok(ellipsePoints.some(point => Math.hypot(point.out.x, point.out.y) > 1e-5));
  const center = { cx: ellipse.x + ellipse.width / 2, cy: ellipse.y + ellipse.height / 2,
    rx: ellipse.width / 2, ry: ellipse.height / 2 };
  const sampled = sampledPathContours(baked, 24)
    .find(contour => contour.length === 12 * 24);
  assert.ok(sampled, 'the baked ellipse keeps all cubic spans through path conversion');
  const maxError = Math.max(...sampled.map(point => nearestEllipseBoundaryDistance({
    x: point.x - baked.x, y: point.y - baked.y
  }, center)));
  assert.ok(maxError < Math.max(center.rx, center.ry) * 1e-6,
    `ellipse approximation error ${maxError} stays below 1e-6 of its longer semiaxis`);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('rotated ellipse Boolean bake follows source resize transforms and preserves group rotation', () => {
  const document = createDocument();
  const ellipse = createNode('ellipse', { x: 30, y: 40, width: 110, height: 65, rotation: 31 });
  const separate = createNode('rectangle', { x: 260, y: 8, width: 27, height: 23 });
  addNode(document, ellipse); addNode(document, separate);
  const group = combineBoolean(document, [ellipse.id, separate.id], 'union');
  group.width *= 1.7;
  group.height *= .73;
  group.rotation = 19;
  const transform = booleanSourceTransform(group.children, group.width, group.height);
  const source = group.children.find(child => child.type === 'ellipse');
  const centerX = source.x + source.width / 2;
  const centerY = source.y + source.height / 2;
  const inset = 1 - 5e-7;
  const expectedAnchors = Array.from({ length: 12 }, (_, index) => {
    const angle = index * Math.PI / 6;
    const raw = { x: centerX + source.width / 2 * inset * Math.cos(angle),
      y: centerY + source.height / 2 * inset * Math.sin(angle) };
    const radians = source.rotation * Math.PI / 180;
    const dx = raw.x - centerX; const dy = raw.y - centerY;
    const rotated = { x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians) };
    return { x: (rotated.x - transform.left) * transform.scaleX,
      y: (rotated.y - transform.top) * transform.scaleY };
  });
  const baked = bakeBoolean(document, group.id);
  assert.equal(baked.rotation, 19, 'the Boolean group rotation stays on the editable path layer');
  const contours = [baked.points, ...baked.subpaths.map(contour => contour.points)];
  const ellipsePoints = contours.find(points => points.length === 12);
  assert.ok(ellipsePoints, 'resizing and rotation preserve the ellipse contour');
  const actualAnchors = ellipsePoints.map(point => ({ x: point.x * baked.width, y: point.y * baked.height }));
  for (const expected of expectedAnchors) {
    assert.ok(actualAnchors.some(actual => Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-6),
      `resized ellipse anchor ${expected.x},${expected.y} should retain its source transform`);
  }
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('ellipse boundaries participate in all four transversal Boolean operations', () => {
  for (const operation of ['union', 'subtract', 'intersect', 'exclude']) {
    const document = createDocument();
    const ellipse = createNode('ellipse', { x: 10, y: 20, width: 100, height: 60 });
    const rectangle = createNode('rectangle', { x: 75, y: 25, width: 50, height: 50 });
    addNode(document, ellipse); addNode(document, rectangle);
    const group = combineBoolean(document, [ellipse.id, rectangle.id], operation);
    const source = group.children.map(child => structuredClone(child));
    const baked = bakeBoolean(document, group.id);
    const output = sampledPathContours(baked, 32).map(contour => contour.map(point => ({
      x: point.x - baked.x, y: point.y - baked.y
    })));
    const ellipseSource = source[0];
    const rectSource = source[1];
    const cx = ellipseSource.x + ellipseSource.width / 2;
    const cy = ellipseSource.y + ellipseSource.height / 2;
    const rx = ellipseSource.width / 2;
    const ry = ellipseSource.height / 2;
    let checked = 0;
    for (let y = 2.31; y < group.height - 1; y += 4.93) for (let x = 1.77; x < group.width - 1; x += 4.37) {
      const ellipseValue = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      const nearEllipse = Math.abs(Math.sqrt(ellipseValue) - 1) * Math.min(rx, ry) < .25;
      const nearRectangle = Math.min(Math.abs(x - rectSource.x), Math.abs(x - rectSource.x - rectSource.width),
        Math.abs(y - rectSource.y), Math.abs(y - rectSource.y - rectSource.height)) < .25;
      if (nearEllipse || nearRectangle) continue;
      const a = ellipseValue < 1;
      const b = x > rectSource.x && x < rectSource.x + rectSource.width
        && y > rectSource.y && y < rectSource.y + rectSource.height;
      const expected = operation === 'union' ? a || b
        : operation === 'subtract' ? a && !b
          : operation === 'intersect' ? a && b : a !== b;
      assert.equal(insideSampledContours({ x, y }, output), expected,
        `${operation} ellipse Boolean output differs at ${x},${y}`);
      checked += 1;
    }
    assert.ok(checked > 100, `${operation} should compare a broad set of interior and exterior points`);
  }
});

test('zero-radius rectangle Booleans retain the exact polygon path', () => {
  const document = createDocument();
  const first = createNode('rectangle', { x: 10, y: 10, width: 70, height: 50, radius: 0 });
  const second = createNode('rectangle', { x: 45, y: 30, width: 60, height: 45 });
  addNode(document, first); addNode(document, second);
  const group = combineBoolean(document, [first.id, second.id], 'union');
  const exact = flattenBooleanContours(group);
  const curves = flattenBooleanPathContours(group);
  assert.deepEqual(curves.map(contour => contour.map(curve => curve.p0)), exact,
    'square-corner rectangle results keep the existing polygon vertices exactly');
  for (const contour of curves) for (const curve of contour) {
    const dx = curve.p3.x - curve.p0.x;
    const dy = curve.p3.y - curve.p0.y;
    assert.ok(Math.abs(curve.p1.x - (curve.p0.x + dx / 3)) < 1e-10);
    assert.ok(Math.abs(curve.p1.y - (curve.p0.y + dy / 3)) < 1e-10);
    assert.ok(Math.abs(curve.p2.x - (curve.p0.x + 2 * dx / 3)) < 1e-10);
    assert.ok(Math.abs(curve.p2.y - (curve.p0.y + 2 * dy / 3)) < 1e-10);
  }
});

test('independent rounded-rectangle corners bake as editable cubic curves', () => {
  const corners = [
    { key: 'topLeft', outside: [2, 2], inside: [12, 12] },
    { key: 'topRight', outside: [98, 2], inside: [88, 12] },
    { key: 'bottomRight', outside: [98, 78], inside: [88, 68] },
    { key: 'bottomLeft', outside: [2, 78], inside: [12, 68] }
  ];
  for (const { key, outside, inside } of corners) {
    const document = createDocument();
    const cornerRadii = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
    cornerRadii[key] = 24;
    const rounded = createNode('rectangle', { x: 10, y: 20, width: 100, height: 80, cornerRadii });
    const distant = createNode('rectangle', { x: 160, y: 20, width: 10, height: 10 });
    addNode(document, rounded); addNode(document, distant);
    const group = combineBoolean(document, [rounded.id, distant.id], 'union');
    const baked = bakeBoolean(document, group.id);
    const contours = sampledPathContours(baked);
    const output = contours.find(contour => contour.some(point => point.x >= 10 && point.x <= 110
      && point.y >= 20 && point.y <= 100));

    assert.ok(output, `${key} rounded rectangle contour should remain in the baked path`);
    const localRadii = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0, [key]: 24 };
    for (const [point, expected] of [[outside, false], [inside, true]]) {
      const absolute = { x: 10 + point[0], y: 20 + point[1] };
      assert.equal(insideSampledContours(absolute, [output]), expected,
        `${key} corner sample ${absolute.x},${absolute.y} should match its quadratic boundary`);
      assert.equal(containsPointInRoundedRect(point[0], point[1], 100, 80, localRadii), expected);
    }
    const pathContours = [baked.points, ...(baked.subpaths || []).map(contour => contour.points)];
    const roundedPath = pathContours.find(points => points.some(point => {
      const x = baked.x + point.x * baked.width;
      const y = baked.y + point.y * baked.height;
      return x >= 10 && x <= 110 && y >= 20 && y <= 100;
    }));
    assert.ok(roundedPath.some(point => Math.hypot(point.in.x, point.in.y) > 1e-6
      || Math.hypot(point.out.x, point.out.y) > 1e-6), `${key} quadratic must stay an editable cubic span`);
  }
});

test('rotated and resized rounded rectangles retain corner curves during Boolean baking', () => {
  const document = createDocument();
  const radii = { topLeft: 18, topRight: 9, bottomRight: 23, bottomLeft: 12 };
  const rounded = createNode('rectangle', {
    x: 25, y: 40, width: 100, height: 70, rotation: 31, cornerRadii: radii
  });
  const distant = createNode('rectangle', { x: 300, y: 10, width: 24, height: 32 });
  addNode(document, rounded); addNode(document, distant);
  const group = combineBoolean(document, [rounded.id, distant.id], 'union');
  group.width *= 1.6;
  group.height *= .8;
  group.rotation = 23;
  const sourceTransform = booleanSourceTransform(group.children, group.width, group.height);
  const source = group.children.find(child => child.type === 'rectangle' && child.cornerRadii);
  const sourceGeometry = structuredClone(source);
  const contours = sampledPathContours(bakeBoolean(document, group.id));
  const baked = findNode(document, group.id).node;
  const sourceCenter = { x: sourceGeometry.x + sourceGeometry.width / 2, y: sourceGeometry.y + sourceGeometry.height / 2 };
  const rotateSourcePoint = (u, v) => {
    const radians = sourceGeometry.rotation * Math.PI / 180;
    const dx = sourceGeometry.x + u - sourceCenter.x;
    const dy = sourceGeometry.y + v - sourceCenter.y;
    return {
      x: sourceCenter.x + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: sourceCenter.y + dx * Math.sin(radians) + dy * Math.cos(radians)
    };
  };
  for (const [local, expected] of [[{ x: 50, y: 35 }, true], [{ x: 1, y: 1 }, false]]) {
    const point = rotateSourcePoint(local.x, local.y);
    const mapped = {
      x: baked.x + (point.x - sourceTransform.left) * sourceTransform.scaleX,
      y: baked.y + (point.y - sourceTransform.top) * sourceTransform.scaleY
    };
    assert.equal(containsPointInRoundedRect(local.x, local.y, sourceGeometry.width, sourceGeometry.height, radii), expected);
    assert.equal(insideSampledContours(mapped, contours), expected,
      `resized local point ${local.x},${local.y} should retain its rounded-rectangle membership`);
  }
  assert.equal(baked.rotation, 23, 'the live Boolean group rotation remains on the editable path');
  const points = [baked.points, ...(baked.subpaths || []).map(contour => contour.points)].flat();
  assert.ok(points.some(point => Math.hypot(point.in.x, point.in.y) > 1e-6
    || Math.hypot(point.out.x, point.out.y) > 1e-6), 'resizing preserves editable corner handles');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('rounded rectangle boundaries participate in all four Boolean operations', () => {
  for (const operation of ['union', 'subtract', 'intersect', 'exclude']) {
    const document = createDocument();
    const radii = { topLeft: 18, topRight: 24, bottomRight: 8, bottomLeft: 15 };
    const rounded = createNode('rectangle', { x: 10, y: 10, width: 100, height: 80, cornerRadii: radii });
    const overlap = createNode('rectangle', { x: 80, y: 25, width: 50, height: 45 });
    addNode(document, rounded); addNode(document, overlap);
    const group = combineBoolean(document, [rounded.id, overlap.id], operation);
    const sourceTransform = booleanSourceTransform(group.children, group.width, group.height);
    const baked = bakeBoolean(document, group.id);
    const contours = sampledPathContours(baked);
    for (const pagePoint of [
      { x: 35, y: 50 }, // rounded rectangle only
      { x: 120, y: 50 }, // overlap only
      { x: 90, y: 50 }, // intersection
      { x: 12, y: 12 }, // outside at the independently rounded top-left corner
      { x: 140, y: 100 } // outside both
    ]) {
      const inRounded = containsPointInRoundedRect(pagePoint.x - rounded.x, pagePoint.y - rounded.y,
        rounded.width, rounded.height, radii);
      const inOverlap = pagePoint.x > overlap.x && pagePoint.x < overlap.x + overlap.width
        && pagePoint.y > overlap.y && pagePoint.y < overlap.y + overlap.height;
      const expected = operation === 'union' ? inRounded || inOverlap
        : operation === 'subtract' ? inRounded && !inOverlap
          : operation === 'intersect' ? inRounded && inOverlap : inRounded !== inOverlap;
      const mapped = {
        x: baked.x + (pagePoint.x - sourceTransform.left) * sourceTransform.scaleX,
        y: baked.y + (pagePoint.y - sourceTransform.top) * sourceTransform.scaleY
      };
      assert.equal(insideSampledContours(mapped, contours), expected,
        `${operation} rounded rectangle output differs at ${pagePoint.x},${pagePoint.y}`);
    }
  }
});

test('closed network faces bake as editable cubic contours through Boolean operations', () => {
  const anchors = [
    { x: 10, y: 10, in: { x: 10, y: 10 }, out: { x: 10, y: 10 } },
    { x: 100, y: 10, in: { x: 100, y: 10 }, out: { x: 130, y: 30 } },
    { x: 100, y: 90, in: { x: 130, y: 70 }, out: { x: 100, y: 90 } },
    { x: 10, y: 90, in: { x: 10, y: 90 }, out: { x: 10, y: 90 } }
  ];
  for (const operation of ['union', 'subtract', 'intersect', 'exclude']) {
    const document = createDocument();
    const network = createNode('network', vectorNetworkGeometryFromAnchors(anchors, { closed: true }));
    const rectangle = createNode('rectangle', { x: 110, y: 25, width: 18, height: 50 });
    addNode(document, network); addNode(document, rectangle);
    const group = combineBoolean(document, [network.id, rectangle.id], operation);
    const sourceContours = group.children.map(child => child.type === 'network'
      ? sampledNetworkContours(child, 96)
      : [rectangleContour(child.x, child.y, child.width, child.height)]);
    const baked = bakeBoolean(document, group.id);
    assert.equal(baked.type, 'path');
    assert.ok([baked.points, ...(baked.subpaths || []).map(contour => contour.points)]
      .flat().some(point => Math.hypot(point.in.x, point.in.y) > 1e-5 || Math.hypot(point.out.x, point.out.y) > 1e-5),
    `${operation} should preserve curved network edge handles`);
    const outputContours = sampledPathContours(baked, 64).map(contour => contour.map(point => ({
      x: point.x - baked.x, y: point.y - baked.y
    })));
    for (let y = 2.19; y < group.height - 1; y += 5.13) for (let x = 1.67; x < group.width - 1; x += 4.29) {
      const point = { x, y };
      const expected = booleanMembership(operation, sourceContours[0], sourceContours[1], point);
      assert.equal(insideSampledContours(point, outputContours), expected,
        `${operation} network result differs at ${x},${y}`);
    }
    assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
  }
});

test('rotated network face controls follow resized Boolean source geometry', () => {
  const document = createDocument();
  const networkGeometry = vectorNetworkGeometryFromAnchors([
    { x: 10, y: 10, in: { x: 10, y: 10 }, out: { x: 10, y: 10 } },
    { x: 100, y: 10, in: { x: 100, y: 10 }, out: { x: 130, y: 30 } },
    { x: 100, y: 90, in: { x: 130, y: 70 }, out: { x: 100, y: 90 } },
    { x: 10, y: 90, in: { x: 10, y: 90 }, out: { x: 10, y: 90 } }
  ], { closed: true });
  const network = createNode('network', { ...networkGeometry, rotation: 23 });
  const separate = createNode('rectangle', { x: 250, y: 15, width: 20, height: 20 });
  addNode(document, network); addNode(document, separate);
  const group = combineBoolean(document, [network.id, separate.id], 'union');
  group.width *= 1.45;
  group.height *= .82;
  group.rotation = 17;
  const transform = booleanSourceTransform(group.children, group.width, group.height);
  const source = group.children.find(child => child.type === 'network');
  const cx = source.x + source.width / 2;
  const cy = source.y + source.height / 2;
  const radians = source.rotation * Math.PI / 180;
  const expected = source.faces[0].vertexIds.map(id => {
    const point = vectorNetworkVertexPoint(source, id, { x: source.x, y: source.y });
    const dx = point.x - cx; const dy = point.y - cy;
    const rotated = { x: cx + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: cy + dx * Math.sin(radians) + dy * Math.cos(radians) };
    return { x: (rotated.x - transform.left) * transform.scaleX,
      y: (rotated.y - transform.top) * transform.scaleY };
  });
  const baked = bakeBoolean(document, group.id);
  assert.equal(baked.rotation, 17);
  const contours = [baked.points, ...baked.subpaths.map(contour => contour.points)];
  const networkPoints = contours.find(points => points.length === 4 && expected.every(point => points.some(candidate =>
    Math.hypot(candidate.x * baked.width - point.x, candidate.y * baked.height - point.y) < 1e-6)));
  assert.ok(networkPoints, 'the four-vertex network face remains one editable contour');
  const actual = networkPoints.map(point => ({ x: point.x * baked.width, y: point.y * baked.height }));
  for (const point of expected) {
    assert.ok(actual.some(candidate => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 1e-6),
      `resized network vertex ${point.x},${point.y} should retain its resolved rotation and source transform`);
  }
});

test('disconnected and edge-adjacent closed network faces bake into compound paths; malformed topology is refused', () => {
  const document = createDocument();
  const networkGeometry = vectorNetworkGeometryFromAnchors([
    { x: 10, y: 10 }, { x: 40, y: 10 }, { x: 25, y: 35 }
  ], { closed: true });
  appendVectorNetworkPath(networkGeometry, [
    { x: 80, y: 20 }, { x: 110, y: 20 }, { x: 95, y: 45 }
  ], { x: networkGeometry.x, y: networkGeometry.y }, { closed: true });
  const network = createNode('network', networkGeometry);
  const other = createNode('rectangle', { x: 150, y: 10, width: 20, height: 20 });
  addNode(document, network); addNode(document, other);
  const group = combineBoolean(document, [network.id, other.id], 'union');
  const baked = bakeBoolean(document, group.id);
  assert.equal(1 + baked.subpaths.length, 3, 'two disjoint filled network faces and the rectangle remain separate contours');

  const adjacentDocument = createDocument();
  const adjacentNetwork = createNode('network', {
    x: 10, y: 10, width: 60, height: 30, fill: 'transparent', stroke: '#1e1e1e', strokeWidth: 2,
    vertices: [
      { id: 'v1', x: 0, y: 0 }, { id: 'v2', x: .5, y: 0 }, { id: 'v3', x: 1, y: 0 },
      { id: 'v4', x: 0, y: 1 }, { id: 'v5', x: .5, y: 1 }, { id: 'v6', x: 1, y: 1 }
    ],
    edges: [
      { id: 'e1', from: 'v1', to: 'v2' }, { id: 'e2', from: 'v2', to: 'v3' },
      { id: 'e3', from: 'v3', to: 'v6' }, { id: 'e4', from: 'v6', to: 'v5' },
      { id: 'e5', from: 'v5', to: 'v4' }, { id: 'e6', from: 'v4', to: 'v1' },
      { id: 'e7', from: 'v2', to: 'v5' }
    ],
    faces: [
      { id: 'f1', vertexIds: ['v1', 'v2', 'v5', 'v4'], fill: null, fillOpacity: 1 },
      { id: 'f2', vertexIds: ['v2', 'v3', 'v6', 'v5'], fill: null, fillOpacity: 1 }
    ]
  });
  const adjacentOther = createNode('rectangle', { x: 100, y: 10, width: 10, height: 10 });
  addNode(adjacentDocument, adjacentNetwork); addNode(adjacentDocument, adjacentOther);
  const adjacentGroup = combineBoolean(adjacentDocument, [adjacentNetwork.id, adjacentOther.id], 'union');
  const adjacentBaked = bakeBoolean(adjacentDocument, adjacentGroup.id);
  const adjacentContours = [adjacentBaked.points, ...adjacentBaked.subpaths.map(contour => contour.points)];
  assert.equal(adjacentContours.length, 2, 'two faces sharing an edge merge into one outer contour alongside the disjoint rectangle');
  assert.deepEqual(adjacentContours.map(points => points.length).sort((a, b) => a - b), [4, 6],
    'the shared edge is removed while its collinear boundary endpoints remain editable anchors');
  const sharedEdgeRemains = adjacentContours.some(points => points.some((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.abs(point.x - .3) < 1e-9 && Math.abs(next.x - .3) < 1e-9
      && Math.abs(Math.abs(point.y - next.y) - 1) < 1e-9;
  }));
  assert.equal(sharedEdgeRemains, false, 'the shared interior segment is absent from every baked contour');
  const adjacentAreas = adjacentContours.map(points => {
    const coordinates = points.map(point => ({
      x: point.x * adjacentBaked.width, y: point.y * adjacentBaked.height
    }));
    return Math.abs(contourArea(coordinates));
  }).sort((a, b) => a - b);
  assert.deepEqual(adjacentAreas, [100, 1800], 'the two adjacent filled faces preserve their union area');

  const openDocument = createDocument();
  const openGeometry = vectorNetworkGeometryFromAnchors([
    { x: 10, y: 10 }, { x: 40, y: 10 }, { x: 25, y: 35 }
  ], { closed: true });
  appendVectorNetworkPath(openGeometry, [{ x: 55, y: 12 }, { x: 75, y: 20 }],
    { x: openGeometry.x, y: openGeometry.y });
  const openNetwork = createNode('network', openGeometry);
  const openOther = createNode('rectangle', { x: 100, y: 10, width: 20, height: 20 });
  addNode(openDocument, openNetwork); addNode(openDocument, openOther);
  const openGroup = combineBoolean(openDocument, [openNetwork.id, openOther.id], 'union');
  const before = serializeDocument(openDocument);
  assert.throws(() => prepareBooleanBake(openDocument, openGroup.id), /open or unfilled network (vertices|edges)/);
  assert.equal(serializeDocument(openDocument), before, 'refusing an open network must retain its live graph and Boolean group');

  const sharedDocument = createDocument();
  const sharedGeometry = vectorNetworkGeometryFromAnchors([
    { x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }
  ], { closed: true });
  const sharedTopRight = sharedGeometry.vertices[1].id;
  const sharedBottomRight = sharedGeometry.vertices[2].id;
  appendVectorNetworkPath(sharedGeometry, [
    { x: 40, y: 10, vertexId: sharedTopRight }, { x: 70, y: 10 },
    { x: 70, y: 40 }, { x: 40, y: 40, vertexId: sharedBottomRight }
  ], { x: sharedGeometry.x, y: sharedGeometry.y }, { closed: true });
  const sharedNetwork = createNode('network', sharedGeometry);
  const sharedOther = createNode('rectangle', { x: 100, y: 10, width: 20, height: 20 });
  addNode(sharedDocument, sharedNetwork); addNode(sharedDocument, sharedOther);
  const sharedGroup = combineBoolean(sharedDocument, [sharedNetwork.id, sharedOther.id], 'union');
  const sharedBefore = serializeDocument(sharedDocument);
  assert.throws(() => prepareBooleanBake(sharedDocument, sharedGroup.id), /parallel edges/);
  assert.equal(serializeDocument(sharedDocument), sharedBefore,
    'refusing duplicate parallel edge records must retain the exact network topology');

  const constrainedDocument = createDocument();
  const constrainedGeometry = vectorNetworkGeometryFromAnchors([
    { x: 10, y: 10 }, { x: 40, y: 10 }, { x: 25, y: 35 }
  ], { closed: true });
  constrainedGeometry.vertices[0].mode = 'smooth';
  const constrainedNetwork = createNode('network', constrainedGeometry);
  const constrainedOther = createNode('rectangle', { x: 100, y: 10, width: 20, height: 20 });
  addNode(constrainedDocument, constrainedNetwork); addNode(constrainedDocument, constrainedOther);
  const constrainedGroup = combineBoolean(constrainedDocument, [constrainedNetwork.id, constrainedOther.id], 'union');
  const constrainedBefore = serializeDocument(constrainedDocument);
  assert.throws(() => prepareBooleanBake(constrainedDocument, constrainedGroup.id), /constrained handle modes/);
  assert.equal(serializeDocument(constrainedDocument), constrainedBefore,
    'refusing constrained graph editing modes must leave the network and Boolean group unchanged');
});

test('baked polygon bounds include source rotations while the live group transform stays on the path', () => {
  const document = createDocument();
  const rotated = createNode('rectangle', { x: 10, y: 10, width: 20, height: 10, rotation: 90 });
  const distant = createNode('rectangle', { x: 80, y: 80, width: 10, height: 10 });
  addNode(document, rotated); addNode(document, distant);
  const group = combineBoolean(document, [rotated.id, distant.id], 'union');
  group.rotation = -23;
  const baked = bakeBoolean(document, group.id);
  const bounds = [baked.points, ...baked.subpaths.map(contour => contour.points)].map(points => {
    const xs = points.map(point => point.x * baked.width);
    const ys = points.map(point => point.y * baked.height);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }).sort((left, right) => left[0] - right[0]);
  assert.ok(Math.abs(bounds[0][0]) < 1e-10 && Math.abs(bounds[0][1]) < 1e-10);
  assert.deepEqual(bounds[0].slice(2), [10, 20]);
  assert.deepEqual(bounds[1], [65, 75, 75, 85]);
  assert.equal(baked.rotation, -23);
  assert.equal(baked.x, 15);
  assert.equal(baked.y, 5);
  assert.equal(validateDocument(document), true);
});

test('baking preserves existing compound path holes and adds disjoint contours', () => {
  const document = createDocument();
  const donut = createNode('path', {
    name: 'Donut', x: 0, y: 0, width: 100, height: 100, closed: true, fillRule: 'evenodd',
    points: rectangleContour(0, 0, 1, 1).map(({ x, y }) => ({ x, y })),
    subpaths: [{ closed: true, points: rectangleContour(.25, .25, .5, .5).map(({ x, y }) => ({ x, y })) }]
  });
  const island = createNode('polygon', { x: 130, y: 10, width: 20, height: 20, points: 4 });
  addNode(document, donut); addNode(document, island);
  const group = combineBoolean(document, [donut.id, island.id], 'union');
  const baked = bakeBoolean(document, group.id);
  assert.equal(baked.type, 'path');
  assert.equal(baked.fillRule, 'evenodd');
  assert.equal(1 + baked.subpaths.length, 3, 'outer shell, hole, and disjoint polygon are three native contours');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('cubic Boolean baking preserves editable Bézier geometry and sampled visual parity for every operation', () => {
  for (const operation of ['union', 'subtract', 'intersect', 'exclude']) {
    const document = createDocument();
    const first = cubicCirclePath(0, 0, 40);
    const second = cubicCirclePath(35, 0, 40);
    addNode(document, first); addNode(document, second);
    const group = combineBoolean(document, [first.id, second.id], operation);
    const sourceContours = group.children.map(child => sampledPathContours(child));
    const history = new History();
    history.checkpoint(document, 'Bake curved Boolean');

    const baked = bakeBoolean(document, group.id);
    assert.equal(baked.type, 'path', `${operation} should become a native path`);
    assert.ok(baked.points.length >= 4, `${operation} should retain a closed editable contour`);
    const outputPoints = [baked.points, ...(baked.subpaths || []).map(contour => contour.points)].flat();
    assert.ok(outputPoints.some(point => [point.in, point.out].some(handle => Math.hypot(handle.x, handle.y) > 1e-5)),
      `${operation} should preserve cubic handles instead of polygonizing the curves`);
    const vectorSvg = exportNodeToSvg(baked);
    assert.match(vectorSvg, / C /, `${operation} SVG export should render the baked Bézier geometry as vector curves`);
    assert.doesNotMatch(vectorSvg, /<image\b/, `${operation} SVG export must not rasterize the baked path`);

    const bakedSamples = sampledPathContours(baked);
    for (let y = 3.25; y < 76; y += 5.5) for (let x = 3.25; x < 112; x += 5.5) {
      const point = { x, y };
      assert.equal(insideSampledContours(point, bakedSamples),
        booleanMembership(operation, sourceContours[0], sourceContours[1], point),
        `${operation} sampled output differs at ${x},${y}`);
    }

    const savedGeometry = JSON.stringify({ points: baked.points, subpaths: baked.subpaths, fillRule: baked.fillRule });
    assert.equal(validateDocument(parseDocument(serializeDocument(document))), true,
      `${operation} cubic path should serialize as a valid editable design`);
    const roundTrip = parseDocument(serializeDocument(document));
    const roundTripPath = findNode(roundTrip, group.id).node;
    assert.equal(JSON.stringify({ points: roundTripPath.points, subpaths: roundTripPath.subpaths, fillRule: roundTripPath.fillRule }), savedGeometry,
      `${operation} should preserve all cubic handles through serialization`);

    const undone = history.undo(document);
    assert.equal(findNode(undone, group.id).node.type, 'boolean', `${operation} undo should restore live operands`);
    const redone = history.redo(undone);
    const redonePath = findNode(redone, group.id).node;
    assert.equal(redonePath.type, 'path', `${operation} redo should restore the baked path`);
    assert.equal(JSON.stringify({ points: redonePath.points, subpaths: redonePath.subpaths, fillRule: redonePath.fillRule }), savedGeometry,
      `${operation} redo should keep the same cubic geometry`);
  }
});

test('resized nested Booleans bake after scaling their source-local results to the current box', () => {
  const document = createDocument();
  const base = createNode('rectangle', { width: 20, height: 20 });
  const cut = createNode('rectangle', { x: 5, y: 5, width: 10, height: 10 });
  addNode(document, base); addNode(document, cut);
  const inner = combineBoolean(document, [base.id, cut.id], 'subtract');
  const separateShape = createNode('rectangle', { x: 30, width: 20, height: 20 });
  addNode(document, separateShape);
  const outer = combineBoolean(document, [inner.id, separateShape.id], 'union');
  outer.width = 100; outer.height = 40;

  const baked = bakeBoolean(document, outer.id);
  assert.equal(baked.type, 'path');
  assert.equal(1 + baked.subpaths.length, 3, 'nested shell, nested hole, and sibling shape all remain editable contours');
  const bounds = [baked.points, ...baked.subpaths.map(contour => contour.points)].map(points => {
    const xs = points.map(point => point.x * baked.width);
    const ys = points.map(point => point.y * baked.height);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }).sort((left, right) => left[0] - right[0]);
  assert.deepEqual(bounds, [[0, 0, 40, 40], [10, 10, 30, 30], [60, 0, 100, 40]]);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('an empty Boolean intersection bakes to a valid empty editable path', () => {
  const document = createDocument();
  const first = createNode('rectangle', { width: 20, height: 20 });
  const second = createNode('rectangle', { x: 40, width: 20, height: 20 });
  addNode(document, first); addNode(document, second);
  const group = combineBoolean(document, [first.id, second.id], 'intersect');
  const baked = bakeBoolean(document, group.id);
  assert.equal(baked.type, 'path');
  assert.deepEqual(baked.points, []);
  assert.equal(baked.subpaths, undefined);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('transparent inputs are refused atomically', () => {
  const unsupportedNodes = [
    [createNode('rectangle', { x: 10, y: 0, width: 30, height: 30, opacity: .5 }), /transparency/]
  ];
  for (const [badOperand, reason] of unsupportedNodes) {
    const document = createDocument();
    const base = createNode('rectangle', { width: 80, height: 80 });
    addNode(document, base); addNode(document, badOperand);
    const group = combineBoolean(document, [base.id, badOperand.id], 'union');
    const before = serializeDocument(document);
    assert.throws(() => prepareBooleanBake(document, group.id), error => error.name === 'BooleanBakeError' && reason.test(error.message));
    assert.equal(serializeDocument(document), before, 'a refused bake leaves the document untouched');
    assert.equal(group.type, 'boolean');
  }
});

test('axis-aligned tangent cubic contours bake exactly without inventing a crossing', () => {
  for (const contactOffset of [0, 1e-13]) for (const operation of ['union', 'subtract', 'intersect', 'exclude']) {
    const document = createDocument();
    const first = cubicCirclePath(0, 0, 40);
    const second = cubicCirclePath(80 + contactOffset, 0, 40);
    addNode(document, first); addNode(document, second);
    const group = combineBoolean(document, [first.id, second.id], operation);
    const sourceContours = group.children.map(child => sampledPathContours(child));

    const baked = bakeBoolean(document, group.id);
    assert.equal(baked.type, 'path', `${operation} should bake to an editable path`);
    assert.equal(baked.points.length === 0, operation === 'intersect',
      `${operation} should retain an empty result only for the empty intersection`);
    if (baked.points.length) {
      assert.ok(baked.points.some(point => [point.in, point.out].some(handle => handle && Math.hypot(handle.x, handle.y) > 1e-5)),
        `${operation} should preserve editable cubic handles at a tangency`);
    }
    const bakedContours = sampledPathContours(baked);
    for (let y = 2.5; y < 80; y += 5) for (let x = 2.5; x < 160; x += 5) {
      const point = { x, y };
      assert.equal(insideSampledContours(point, bakedContours),
        booleanMembership(operation, sourceContours[0], sourceContours[1], point),
        `${operation} should match the source membership at ${x},${y}`);
    }
    assert.equal(validateDocument(parseDocument(serializeDocument(document))), true,
      `${operation} should remain a valid editable document after serialization`);
  }
});

test('overlapping collinear cubics with non-linear parameterization fail closed', () => {
  const document = createDocument();
  const curvedLine = createNode('path', {
    width: 100, height: 100, closed: true,
    points: [
      { x: 0, y: .2, out: { x: .1, y: 0 } },
      { x: 1, y: .2, in: { x: -.4, y: 0 } },
      { x: 1, y: 1 }, { x: 0, y: 1 }
    ]
  });
  const overlapping = createNode('rectangle', { x: 35, y: 10, width: 40, height: 40 });
  addNode(document, curvedLine); addNode(document, overlapping);
  const group = combineBoolean(document, [curvedLine.id, overlapping.id], 'union');
  const before = serializeDocument(document);
  assert.throws(() => prepareBooleanBake(document, group.id), /non-linear parameterization/);
  assert.equal(serializeDocument(document), before, 'refusal must leave both source paths and the live Boolean group intact');
});

test('mode-bound rectangle radius is refused even when its raw radius is square', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Radius tokens');
  const radius = createVariable(document, collection.id, 'Square radius', 'number', 0);
  const base = createNode('rectangle', { width: 80, height: 80 });
  const radiusBound = createNode('rectangle', { x: 10, y: 10, width: 30, height: 30, radius: 0 });
  addNode(document, base); addNode(document, radiusBound);
  assert.equal(bindVariable(document, radiusBound.id, radius.id, 'radius'), true);
  const group = combineBoolean(document, [base.id, radiusBound.id], 'union');
  const before = serializeDocument(document);
  assert.throws(() => flattenBooleanPathContours(group), /mode-bound radius/);
  assert.throws(() => prepareBooleanBake(document, group.id), /mode-bound geometry/);
  assert.equal(serializeDocument(document), before, 'the refused bake is atomic and retains the live Boolean source');
});

test('prepared bake plans are atomic and reject stale Boolean sources', () => {
  const document = createDocument();
  const first = createNode('rectangle'); const second = createNode('polygon', { x: 40, points: 5 });
  addNode(document, first); addNode(document, second);
  const group = combineBoolean(document, [first.id, second.id], 'union');
  const plan = prepareBooleanBake(document, group.id);
  group.children[0].x += 1;
  assert.throws(() => applyBooleanBake(document, plan), /changed after the bake was prepared/);
  assert.equal(group.type, 'boolean');
});
