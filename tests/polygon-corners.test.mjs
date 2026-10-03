import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, bakeBoolean, bindVariable, combineBoolean, createComponent, createComponentInstance, createDocument, createNode, createVariable, createVariableCollection, findNode, parseDocument, serializeDocument, syncComponentInstances, validateDocument } from '../src/model.js';
import { buildInspectOutput } from '../src/inspect.js';
import { hitTestVisibleGeometry } from '../src/shape-hit-testing.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { isValidVertexRadii, regularShapeVertexCount, regularShapeVertices, roundedPolygonPathCommands, roundedPolygonPathPoints, roundedPolygonSvgPath, traceRoundedPolygonPath } from '../src/polygon-corners.js';

test('polygon and star corner paths preserve the unrounded shape and share curved output', () => {
  for (const type of ['polygon', 'star']) {
    const vertices = regularShapeVertices(type, 120, 80, type === 'star' ? 5 : 6, .42);
    const plain = roundedPolygonPathCommands(vertices);
    const points = roundedPolygonPathPoints(vertices);
    assert.deepEqual(points, vertices, `${type} without a radius keeps its original vertices`);
    assert.equal(plain.commands.every(command => command.type === 'line'), true);

    const rounded = roundedPolygonPathCommands(vertices, 8, 0);
    const smoothed = roundedPolygonPathCommands(vertices, 8, .6);
    assert.ok(rounded.commands.some(command => command.type === 'arc'));
    assert.ok(smoothed.commands.some(command => command.type === 'cubic'));
    assert.ok(roundedPolygonPathPoints(vertices, 8, .6).length > vertices.length);
    assert.ok(smoothed.commands.every(command => ['start', 'end', 'center', 'control1', 'control2']
      .filter(key => command[key]).every(key => Number.isFinite(command[key].x) && Number.isFinite(command[key].y))));
    assert.match(roundedPolygonSvgPath(vertices, 8, .6), / C /);
  }

  const starVertices = regularShapeVertices('star', 100, 100, 5, .48);
  const starCorners = roundedPolygonPathCommands(starVertices, 8, .45).commands.filter(command => command.type === 'arc');
  assert.ok(starCorners.some(command => command.endAngle < command.startAngle), 'concave star points keep the opposite signed arc sweep');

  const calls = [];
  const context = Object.fromEntries(['moveTo', 'lineTo', 'bezierCurveTo', 'arc', 'closePath'].map(name => [name, (...args) => calls.push([name, ...args])]));
  traceRoundedPolygonPath(context, 5, 7, starVertices, 8, .45);
  assert.equal(calls[0][0], 'moveTo');
  assert.ok(calls.some(([name]) => name === 'arc' && calls.length > 0));
  assert.ok(calls.some(([name]) => name === 'bezierCurveTo'));
  assert.equal(calls.at(-1)[0], 'closePath');
});

test('stars expose 60 editable points while regular polygons keep their 32-side limit', () => {
  assert.equal(regularShapeVertices('star', 100, 100, 60).length, 120);
  assert.equal(regularShapeVertices('star', 100, 100, 61).length, 120, 'generated star geometry clamps to the supported maximum');
  assert.equal(regularShapeVertices('polygon', 100, 100, 33).length, 32);
});

test('independent star and polygon radii affect each canonical corner and validate against topology', () => {
  for (const type of ['polygon', 'star']) {
    const points = type === 'star' ? 5 : 6;
    const count = regularShapeVertexCount(type, points);
    const vertices = regularShapeVertices(type, 120, 100, points, .42);
    const radii = Array.from({ length: count }, (_, index) => index % 3 === 0 ? 0 : index % 3 === 1 ? 1 : 2);
    const path = roundedPolygonPathCommands(vertices, radii, .2);
    assert.deepEqual(path.corners.map(corner => corner.radius), radii,
      `${type} uses authored radii independently when edge clearance permits`);
    assert.ok(path.commands.some(command => command.type === 'arc'));
    assert.ok(path.commands.some(command => command.type === 'line'), 'zero-radius corners stay sharp');
    assert.notDeepEqual(path.commands, roundedPolygonPathCommands(vertices, 1).commands,
      'different per-vertex values produce geometry distinct from a shared radius');
    assert.equal(isValidVertexRadii(type, points, radii), true);
    assert.equal(isValidVertexRadii(type, points, radii.slice(1)), false);
    assert.equal(isValidVertexRadii(type, points, [...radii.slice(0, -1), -1]), false);
  }
});

test('corner radius and smoothing change polygon/star fill and stroke hit geometry', () => {
  for (const type of ['polygon', 'star']) {
    const node = createNode(type, { width: 100, height: 100, points: type === 'star' ? 5 : 6, radius: 12 });
    const unrounded = { ...node, radius: 0 };
    assert.equal(hitTestVisibleGeometry(unrounded, { x: 50, y: 1 }, { tolerance: 0 }), true);
    assert.equal(hitTestVisibleGeometry(node, { x: 50, y: 1 }, { tolerance: 0 }), false,
      `${type} tip pixels removed by rounding are not clickable as fill`);
    node.stroke = '#111111'; node.strokeWidth = .5;
    assert.equal(hitTestVisibleGeometry(node, { x: 50, y: 1 }, { tolerance: 0 }), false,
      `${type} stroke hit testing follows the same rounded outline`);
  }

  const independentlyRoundedTip = createNode('star', {
    width: 100, height: 100, points: 5,
    vertexRadii: [12, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  });
  assert.equal(hitTestVisibleGeometry(independentlyRoundedTip, { x: 50, y: 1 }, { tolerance: 0 }), false,
    'hit testing follows the rounded geometry of the individually edited outer tip');
  independentlyRoundedTip.vertexRadii[0] = 0;
  assert.equal(hitTestVisibleGeometry(independentlyRoundedTip, { x: 50, y: 1 }, { tolerance: 0 }), true,
    'other zero-radius corners keep their sharp fill geometry');
});

test('model, variables, component overrides, SVG, and Inspect preserve regular-shape corner settings', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Shape geometry');
  const radiusVariable = createVariable(document, collection.id, 'Badge radius', 'number', 9);
  const master = createNode('star', { name: 'Badge', width: 100, height: 80, radius: 6, cornerSmoothing: .4 });
  addNode(document, master);
  assert.equal(bindVariable(document, master.id, radiusVariable.id, 'radius'), true);
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  instance.componentOverrides[master.id] = { radius: 4, cornerSmoothing: .2 };
  syncComponentInstances(document, component.id);

  const instanceLayer = findNode(document, instance.id).node;
  assert.equal(instanceLayer.radius, 4);
  assert.equal(instanceLayer.cornerSmoothing, .2);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const svg = exportNodeToSvg(master, { document });
  assert.match(svg, /<path d="M /);
  assert.match(svg, /A 9 9/);
  const inspect = buildInspectOutput(document, [findNode(document, master.id)]);
  assert.equal(inspect.layers[0].cornerRadius, '9px');
  assert.equal(inspect.layers[0].cornerSmoothing, .4);
  assert.equal(inspect.layers[0].borderRadius, undefined);

  const invalid = structuredClone(document);
  findNode(invalid, master.id).node.cornerSmoothing = 1.01;
  assert.throws(() => validateDocument(invalid), /Invalid corner smoothing/);
  const invalidOverride = structuredClone(document);
  findNode(invalidOverride, instance.id).node.componentOverrides[master.id].radius = -1;
  assert.throws(() => validateDocument(invalidOverride), /Invalid component corner-radius override/);
});

test('independent vertex radii survive component sync and export to SVG and Inspect', () => {
  const document = createDocument();
  const master = createNode('star', {
    name: 'Notched badge', width: 120, height: 100, points: 5,
    vertexRadii: Array.from({ length: 10 }, (_, index) => index % 2 ? 2 : 6),
    cornerSmoothing: .25
  });
  addNode(document, master);
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  instance.componentOverrides[master.id] = {
    points: 6,
    vertexRadii: Array.from({ length: 12 }, (_, index) => index % 2 ? 1 : 5)
  };
  syncComponentInstances(document, component.id);
  assert.equal(instance.children.length, 0);
  assert.equal(instance.points, 6);
  assert.deepEqual(instance.vertexRadii, instance.componentOverrides[master.id].vertexRadii);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const svg = exportNodeToSvg(master, { document });
  assert.match(svg, /<path d="M /);
  assert.match(svg, / A 6 6 /);
  const inspect = buildInspectOutput(document, [findNode(document, master.id)]);
  assert.deepEqual(inspect.layers[0].vertexRadii, master.vertexRadii.map(value => `${value}px`));
  assert.equal(inspect.layers[0].cornerRadius, undefined, 'the inspector does not flatten independent radii into a false uniform value');

  const invalid = structuredClone(document);
  findNode(invalid, master.id).node.vertexRadii.pop();
  assert.throws(() => validateDocument(invalid), /Invalid independent vertex radii/);
  const invalidOverride = structuredClone(document);
  findNode(invalidOverride, instance.id).node.componentOverrides[master.id].vertexRadii.pop();
  assert.throws(() => validateDocument(invalidOverride), /Invalid component independent vertex-radius override/);

  const boundDocument = createDocument();
  const collection = createVariableCollection(boundDocument, 'Bound radii');
  const variable = createVariable(boundDocument, collection.id, 'Uniform', 'number', 4);
  const boundStar = createNode('star', { vertexRadii: Array(10).fill(2) });
  addNode(boundDocument, boundStar);
  assert.equal(bindVariable(boundDocument, boundStar.id, variable.id, 'radius'), true);
  assert.throws(() => validateDocument(boundDocument), /Independent vertex radii cannot use a uniform radius variable binding/);
});

test('Boolean baking retains rounded concave star geometry as editable curves', () => {
  const document = createDocument();
  const star = createNode('star', { x: 10, y: 20, width: 100, height: 100,
    vertexRadii: [8, 2, 6, 2, 8, 2, 6, 2, 8, 2], cornerSmoothing: .5 });
  const separate = createNode('rectangle', { x: 160, y: 20, width: 20, height: 20 });
  addNode(document, star); addNode(document, separate);
  const group = combineBoolean(document, [star.id, separate.id], 'union');
  const baked = bakeBoolean(document, group.id);
  const points = [baked.points, ...(baked.subpaths || []).map(contour => contour.points)].flat();
  assert.ok(points.length >= 12);
  assert.ok(points.some(point => Math.hypot(point.in?.x || 0, point.in?.y || 0) > 1e-5
    || Math.hypot(point.out?.x || 0, point.out?.y || 0) > 1e-5), 'rounded Boolean output remains curved and editable');
  assert.equal(validateDocument(document), true);
});
