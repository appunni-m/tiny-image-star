import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, applyBooleanBake, bakeBoolean, bindVariable, canCombineBoolean, combineBoolean, createDocument, createNode, createVariable, createVariableCollection, findNode,
  parseDocument, prepareBooleanBake, separateBoolean, serializeDocument, validateDocument
} from '../src/model.js';
import { History } from '../src/history.js';
import { setVectorNodePoint, vectorNodePoint } from '../src/vector-path.js';
import { flattenBooleanContours, polygonBoolean } from '../src/boolean-geometry.js';
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

test('unsupported rounded, transparent, and non-polygonal inputs are refused atomically', () => {
  const unsupportedNodes = [
    [createNode('ellipse', { x: 10, y: 0, width: 30, height: 30 }), /Ellipses/],
    [createNode('rectangle', { x: 10, y: 0, width: 30, height: 30, radius: 8 }), /rounded corners/],
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

test('tangent cubic Boolean contacts are refused atomically instead of approximated', () => {
  const document = createDocument();
  const first = cubicCirclePath(0, 0, 40);
  const second = cubicCirclePath(80, 0, 40);
  addNode(document, first); addNode(document, second);
  const group = combineBoolean(document, [first.id, second.id], 'union');
  const before = serializeDocument(document);
  assert.throws(() => prepareBooleanBake(document, group.id), /tangent|touching|unstable|precision/);
  assert.equal(serializeDocument(document), before, 'an unstable tangency must leave the live Boolean sources untouched');
  assert.equal(group.type, 'boolean');
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
