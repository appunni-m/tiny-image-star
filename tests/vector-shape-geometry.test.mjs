import test from 'node:test';
import assert from 'node:assert/strict';
import { nativePathGeometryForNode, traceNativePathContours, NativePathGeometryError, NATIVE_PATH_GEOMETRY_LIMITS } from '../src/vector-shape-geometry.js';
import { clampCornerRadii, traceRoundedRectPath } from '../src/corner-radii.js';
import { regularShapeVertices, traceRoundedPolygonPath } from '../src/polygon-corners.js';
import { traceEllipseArc } from '../src/ellipse-arc.js';
import { traceVectorNetworkFacePath } from '../src/vector-network-corners.js';

const shape = (type, overrides = {}) => ({ type, width: 100, height: 60, ...overrides });
const p = (x, y) => ({ x, y });
const methods = ['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'ellipse', 'closePath'];
function context() {
  const calls = [];
  return { calls, ctx: Object.fromEntries(methods.map(method => [method, (...values) => calls.push([method, ...values])])) };
}
function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}
function equivalentCalls(calls) {
  // Native arc APIs make tiny implicit connections due floating-point trig.
  // The geometry recorder makes these lines explicit; remove only subnanometre
  // connections when comparing otherwise identical canonical tracing calls.
  const result = []; let current = null; let first = null;
  for (const call of calls) {
    const [method, ...args] = call;
    if (method === 'moveTo') { current = p(args[0], args[1]); first = current; }
    else if (method === 'lineTo') {
      const end = p(args[0], args[1]);
      if (current && Math.hypot(end.x - current.x, end.y - current.y) < 1e-8) { current = end; continue; }
      current = end;
    } else if (method === 'quadraticCurveTo') current = p(args[2], args[3]);
    else if (method === 'bezierCurveTo') current = p(args[4], args[5]);
    else if (method === 'arc' || method === 'ellipse') {
      const ellipse = method === 'ellipse';
      const rx = args[2]; const ry = ellipse ? args[3] : rx;
      const rotation = ellipse ? args[4] : 0;
      const start = ellipse ? args[5] : args[3]; const end = ellipse ? args[6] : args[4];
      const at = angle => p(args[0] + rx * Math.cos(angle) * Math.cos(rotation) - ry * Math.sin(angle) * Math.sin(rotation),
        args[1] + rx * Math.cos(angle) * Math.sin(rotation) + ry * Math.sin(angle) * Math.cos(rotation));
      if (!current) { current = at(start); first = current; result.push(['moveTo', current.x, current.y]); }
      current = at(end);
    } else if (method === 'closePath') current = first;
    result.push(call);
  }
  return result;
}
function assertCanonicalTrace(node, trace) {
  const expected = context(); trace(expected.ctx);
  const actual = context(); traceNativePathContours(actual.ctx, nativePathGeometryForNode(node).strokeContours);
  assert.deepEqual(equivalentCalls(actual.calls), equivalentCalls(expected.calls));
}
function squareNetwork(overrides = {}) {
  return shape('network', {
    vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 1, y: 1 }, { id: 'd', x: 0, y: 1 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' },
      { id: 'cd', from: 'c', to: 'd' }, { id: 'da', from: 'd', to: 'a' }],
    faces: [{ id: 'face', vertexIds: ['a', 'b', 'c', 'd'] }], ...overrides
  });
}

test('plain rectangles are closed paths and individual-side inputs stay geometry-only', () => {
  const node = shape('rectangle', { radius: 0, x: 900, rotation: 45, fill: '#ff0000', stroke: '#123456' });
  const geometry = nativePathGeometryForNode(node);
  assert.equal(geometry.strokeContours.length, 1);
  assert.equal(geometry.strokeContours[0].closed, true);
  assert.deepEqual(geometry.strokeContours[0].start, p(0, 0));
  assert.deepEqual(geometry.strokeContours[0].commands.map(command => command.end), [p(100, 0), p(100, 60), p(0, 60)]);
  assert.deepEqual(geometry.rectangleSideGeometry, { width: 100, height: 60,
    radii: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }, smoothing: 0 });
  assert.equal(geometry.fillGroups.length, 1);
  assert.deepEqual(nativePathGeometryForNode(shape('frame')).rectangleSideGeometry, geometry.rectangleSideGeometry);
  for (const type of ['group', 'section', 'image']) assert.equal(nativePathGeometryForNode(shape(type)).rectangleSideGeometry, undefined);
});

test('rounded rectangles preserve native quadratics, exact Canvas start and literal cap/dash closure', () => {
  const radii = { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 };
  const node = shape('rectangle', { cornerRadii: radii });
  const geometry = nativePathGeometryForNode(node);
  assert.deepEqual(geometry.strokeContours[0].start, p(4, 0), 'dash phase starts at the renderer’s original top-left tangent');
  assert.equal(geometry.strokeContours[0].closed, false, 'the Canvas tracer returns to its start without closePath');
  assert.equal(geometry.strokeContours[0].commands.filter(command => command.type === 'quadratic').length, 4);
  assert.deepEqual(geometry.strokeContours[0].commands[1], { type: 'quadratic', start: p(92, 0), control: p(100, 0), end: p(100, 8) });
  assertCanonicalTrace(node, ctx => traceRoundedRectPath(ctx, 0, 0, 100, 60, radii));
  assert.deepEqual(geometry.rectangleSideGeometry.radii, clampCornerRadii(100, 60, radii));
});

test('smoothed rectangles and per-vertex stars/polygons retain canonical cubics and native circular arcs', () => {
  const node = shape('rectangle', { radius: 12, cornerSmoothing: 0.6 });
  const geometry = nativePathGeometryForNode(node);
  assert.ok(geometry.strokeContours[0].commands.some(command => command.type === 'cubic'));
  assert.equal(geometry.strokeContours[0].commands.filter(command => command.type === 'arc').length, 4);
  assertCanonicalTrace(node, ctx => traceRoundedRectPath(ctx, 0, 0, 100, 60,
    { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 }, 0.6));
  for (const type of ['star', 'polygon']) {
    const count = type === 'star' ? 5 : 6;
    const radii = Array.from({ length: type === 'star' ? count * 2 : count }, (_, index) => index % 2 ? 3 : 7);
    const rounded = shape(type, { points: count, innerRadius: 0.48, vertexRadii: radii, cornerSmoothing: 0.4 });
    const result = nativePathGeometryForNode(rounded);
    assert.equal(result.strokeContours[0].closed, true);
    assert.ok(result.strokeContours[0].commands.some(command => command.type === 'arc'));
    assertCanonicalTrace(rounded, ctx => traceRoundedPolygonPath(ctx, 0, 0,
      regularShapeVertices(type, 100, 60, count, 0.48), radii, 0.4));
  }
});

test('ellipses, partial arcs and rings retain native radii, direction and separate hole contours', () => {
  for (const arcData of [undefined,
    { startingAngle: 0.3, endingAngle: 2.9, innerRadius: 0 },
    { startingAngle: 4.8, endingAngle: 0.5, innerRadius: 0.6 },
    { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0.5 },
    { startingAngle: Math.PI * 2, endingAngle: 0, innerRadius: 0.5 }
  ]) {
    const node = shape('ellipse', { arcData });
    const geometry = nativePathGeometryForNode(node);
    assertCanonicalTrace(node, ctx => traceEllipseArc(ctx, node));
    assert.ok(geometry.strokeContours.flatMap(contour => contour.commands).some(command => command.type === 'ellipse'));
    assert.ok(!geometry.strokeContours.flatMap(contour => contour.commands).some(command => command.type === 'cubic'),
      'ellipses are never inset or approximated as editable cubic spans');
    const outer = geometry.strokeContours[0].commands.find(command => command.type === 'ellipse');
    assert.equal(outer.radiusX, 50); assert.equal(outer.radiusY, 30);
    if (arcData?.innerRadius > 0 && Math.abs(arcData.endingAngle - arcData.startingAngle) === Math.PI * 2) {
      assert.equal(geometry.strokeContours.length, 2);
      const inner = geometry.strokeContours[1].commands.find(command => command.type === 'ellipse');
      assert.equal(inner.radiusX, 25); assert.equal(inner.radiusY, 15);
      assert.notEqual(inner.anticlockwise, outer.anticlockwise);
      assert.ok(geometry.strokeContours.every(contour => !contour.closed));
    }
  }
  const empty = nativePathGeometryForNode(shape('ellipse', { arcData: { startingAngle: 1, endingAngle: 1, innerRadius: 0 } }));
  assert.deepEqual(empty.fillGroups, []); assert.deepEqual(empty.strokeContours, []);
});

test('open cubic paths and negative-slope lines retain endpoints, exact handles and no geometric fill', () => {
  const node = shape('path', { closed: false, points: [
    { x: 0.1, y: 0.2, out: p(0.2, -0.1) }, { x: 0.9, y: 0.8, in: p(-0.3, 0.1) }
  ] });
  const geometry = nativePathGeometryForNode(node);
  const contour = geometry.strokeContours[0];
  assert.equal(contour.closed, false); assert.deepEqual(geometry.fillGroups, []);
  assert.equal(contour.commands.length, 1); assert.equal(contour.commands[0].type, 'cubic');
  assert.deepEqual(contour.commands[0].start, p(10, 12));
  assert.deepEqual(contour.commands[0].control1, p(30, 6));
  assert.deepEqual(contour.commands[0].control2, p(60, 54));
  assert.deepEqual(contour.commands[0].end, p(90, 48));
  const reverse = nativePathGeometryForNode(shape('line', { lineReverseY: true }));
  assert.deepEqual(reverse.strokeContours[0].start, p(0, 60));
  assert.deepEqual(reverse.strokeContours[0].commands[0].end, p(100, 0));
  assert.equal(reverse.strokeContours[0].closed, false); assert.deepEqual(reverse.fillGroups, []);
  assert.equal(nativePathGeometryForNode(shape('line', { height: 0 })).strokeContours[0].commands.length, 1);
});

test('mixed compound paths retain evenodd holes, curved closing joins and Canvas implicit open-contour fill', () => {
  const node = shape('path', { closed: true, fillRule: 'evenodd', points: [
    p(0, 0), p(1, 0), { x: 1, y: 1, out: p(-0.2, 0.1) }
  ], subpaths: [
    { closed: true, points: [p(0.2, 0.2), p(0.2, 0.8), p(0.8, 0.8)] },
    { closed: false, points: [p(0.3, 0.3), p(0.7, 0.3), p(0.5, 0.6)] }
  ] });
  const geometry = nativePathGeometryForNode(node);
  assert.equal(geometry.fillRule, 'evenodd'); assert.equal(geometry.fillGroups.length, 1);
  assert.equal(geometry.fillGroups[0].contours.length, 3,
    'once any filled closed path exists, Canvas fills the full compound path including open subpaths');
  assert.deepEqual(geometry.strokeContours.map(contour => contour.closed), [true, true, false]);
  const closing = geometry.strokeContours[0].commands.at(-1);
  assert.equal(closing.type, 'cubic'); assert.deepEqual(closing.end, p(0, 0));
  near(closing.control1.x, 80); near(closing.control1.y, 66);
  const empty = nativePathGeometryForNode(shape('path', { closed: true, points: [] }));
  assert.deepEqual(empty.fillGroups, []); assert.deepEqual(empty.strokeContours, []);
});

test('network fill faces remain additive while center strokes keep edges open and aligned strokes retain joins', () => {
  const node = squareNetwork();
  node.faces.push({ id: 'reversed', vertexIds: ['d', 'c', 'b', 'a'] });
  const geometry = nativePathGeometryForNode(node);
  assert.equal(geometry.fillGroups.length, 2, 'opposite winding faces cannot cancel their additive source coverage');
  assert.ok(geometry.fillGroups.every(group => group.fillRule === 'nonzero' && group.contours.length === 1));
  assert.equal(geometry.strokeContours.length, 4); assert.ok(geometry.strokeContours.every(contour => !contour.closed));
  assert.equal(geometry.alignedStrokeContours.length, 2); assert.ok(geometry.alignedStrokeContours.every(contour => contour.closed));
  assert.deepEqual(geometry.alignedStrokeContours[0].commands.map(command => command.end), [p(100, 0), p(100, 60), p(0, 60), p(0, 0)]);
  assert.deepEqual(geometry.alignedStrokeContours[1].commands.map(command => command.end), [p(100, 60), p(100, 0), p(0, 0), p(0, 60)]);
});

test('rounded network edges preserve exact subdivision and closed face tracing without duplicate open edges', () => {
  const node = squareNetwork();
  node.vertices[0].cornerRadius = 10; node.vertices[2].cornerRadius = 6;
  node.edges[0].control1 = p(0.2, -0.15); node.edges[0].control2 = p(0.8, 0);
  const geometry = nativePathGeometryForNode(node);
  assert.equal(geometry.strokeContours.length, 1); assert.equal(geometry.strokeContours[0].closed, true);
  assert.deepEqual(geometry.strokeContours, geometry.alignedStrokeContours);
  assert.ok(geometry.strokeContours[0].commands.some(command => command.type === 'cubic'));
  const expected = context(); assert.equal(traceVectorNetworkFacePath(expected.ctx, node, node.faces[0]), true);
  const actual = context(); traceNativePathContours(actual.ctx, geometry.strokeContours);
  assert.deepEqual(equivalentCalls(actual.calls), equivalentCalls(expected.calls));
});

test('network curves reverse controls with face orientation and preserve unfilled and parallel edge strokes', () => {
  const node = squareNetwork();
  node.edges[0].control1 = p(0.2, -0.15); node.edges[0].control2 = p(0.8, 0.25);
  node.faces[0].vertexIds.reverse();
  node.vertices.push({ id: 'open', x: 0.5, y: 0.5 });
  node.edges.push({ id: 'branch', from: 'a', to: 'open' }, { id: 'parallel', from: 'a', to: 'b', control1: p(0.5, -0.5) });
  const geometry = nativePathGeometryForNode(node);
  assert.equal(geometry.strokeContours.length, 6); assert.equal(geometry.alignedStrokeContours.length, 1);
  const reversed = geometry.alignedStrokeContours[0].commands.find(command => command.type === 'cubic');
  assert.deepEqual(reversed.control1, p(80, 15)); assert.deepEqual(reversed.control2, p(20, -9));
  assert.deepEqual(reversed.end, p(0, 0));
  assert.ok(geometry.strokeContours.some(contour => contour.commands.some(command => command.type === 'cubic' && command.control1.y === -30)));
});

test('extraction never copies paints, assets, overrides or identity references and returns fresh numeric geometry', () => {
  const node = shape('path', { id: 'secret-layer', closed: true, points: [
    { x: 0, y: 0, out: { x: 0.1, y: 0.2, assetId: 'smuggled-asset' } }, p(1, 0), p(1, 1)
  ], fill: '#123456', fillVariableId: 'variable-secret', componentOverrides: { nested: { assetId: 'asset-secret' } },
  affineTransform: { a: 9, b: 3, c: 4, d: 1 }, x: 800, y: 900, rotation: 23 });
  node.children = [node];
  const geometry = nativePathGeometryForNode(node);
  assert.doesNotMatch(JSON.stringify(geometry), /secret|assetId|Variable|component|affine|rotation/);
  const originalEnd = { ...geometry.strokeContours[0].commands[0].end };
  geometry.strokeContours[0].commands[0].end.x = 9999;
  assert.deepEqual(nativePathGeometryForNode(node).strokeContours[0].commands[0].end, originalEnd);
  assert.equal(node.points[1].x, 1); assert.equal(node.children[0], node);
});

test('invalid, unsupported and oversized geometry fails before exposing partial contours', () => {
  const invalid = [
    shape('text'), shape('boolean'), shape('ellipse', { width: -1 }),
    shape('ellipse', { arcData: { startingAngle: 0, endingAngle: 8, innerRadius: 0 } }),
    shape('rectangle', { radius: NaN }), shape('rectangle', { cornerSmoothing: 2 }),
    shape('star', { points: 100 }), shape('polygon', { vertexRadii: [3] }),
    shape('path', { closed: false, points: [{ x: 0, y: Infinity }] }),
    shape('path', { closed: true, points: [p(0, 0), { x: 1, y: 1, out: { x: NaN, y: 0 } }] }),
    shape('path', { closed: true, points: [p(0, 0), p(100_001, 0)] }),
    shape('path', { closed: false, points: Array.from({ length: NATIVE_PATH_GEOMETRY_LIMITS.maxInputItems + 1 }, () => p(0, 0)) }),
    shape('path', { closed: false, points: [], subpaths: Array.from({ length: NATIVE_PATH_GEOMETRY_LIMITS.maxContours }, () => ({ closed: false, points: [] })) })
  ];
  const duplicate = squareNetwork(); duplicate.vertices[1].id = duplicate.vertices[0].id; invalid.push(duplicate);
  const brokenFace = squareNetwork(); brokenFace.edges.pop(); invalid.push(brokenFace);
  const oversizedFace = squareNetwork();
  oversizedFace.faces[0].vertexIds = Array(NATIVE_PATH_GEOMETRY_LIMITS.maxInputItems + 1).fill('a');
  oversizedFace.faces[0].vertexIds.some = () => { throw new Error('oversized rings must reject before visiting any references'); };
  invalid.push(oversizedFace);
  for (const node of invalid) assert.throws(() => nativePathGeometryForNode(node), error => error instanceof NativePathGeometryError
    && error.code === 'UNSUPPORTED_NATIVE_PATH_GEOMETRY');
});

test('geometry replay validates every command and required method before changing the target path', () => {
  assert.equal(traceNativePathContours(null, []), false);
  const valid = nativePathGeometryForNode(shape('rectangle', { radius: 8 })).strokeContours;
  const target = context(); assert.equal(traceNativePathContours(target.ctx, valid), true);
  assert.ok(target.calls.some(call => call[0] === 'quadraticCurveTo'));
  for (const invalid of [
    [{ start: p(0, 0), closed: false, commands: [{ type: 'unknown', start: p(0, 0), end: p(1, 1) }] }],
    [{ start: p(0, 0), closed: false, commands: [{ type: 'line', start: p(0, 0), end: p(Infinity, 1) }] }],
    [{ start: p(0, 0), closed: false, commands: [{ type: 'line', start: p(5, 5), end: p(10, 10) }] }],
    [{ start: p(0, 0), closed: false, commands: Array.from({ length: NATIVE_PATH_GEOMETRY_LIMITS.maxCommands + 1 }, () => ({ type: 'line', start: p(0, 0), end: p(0, 0) })) }]
  ]) {
    const untouched = context(); assert.throws(() => traceNativePathContours(untouched.ctx, invalid), NativePathGeometryError);
    assert.deepEqual(untouched.calls, []);
  }
  const untouched = context(); delete untouched.ctx.quadraticCurveTo;
  assert.throws(() => traceNativePathContours(untouched.ctx, valid), NativePathGeometryError); assert.deepEqual(untouched.calls, []);
});

test('large rounded network candidates reject before quadratic topology work begins', () => {
  const node = shape('network', { width: 1000, height: 1000, vertices: [], edges: [], faces: [] });
  for (let index = 0; index < 500; index += 1) {
    const ids = [`a-${index}`, `b-${index}`, `c-${index}`];
    const x = index % 25 / 25; const y = Math.floor(index / 25) / 20;
    node.vertices.push({ id: ids[0], x, y, cornerRadius: 1 }, { id: ids[1], x: x + 0.01, y }, { id: ids[2], x, y: y + 0.01 });
    for (let edge = 0; edge < 3; edge += 1) node.edges.push({ id: `edge-${index}-${edge}`, from: ids[edge], to: ids[(edge + 1) % 3] });
    node.faces.push({ id: `face-${index}`, vertexIds: ids });
  }
  assert.throws(() => nativePathGeometryForNode(node), error => error instanceof NativePathGeometryError
    && /bounded geometry work limit/.test(error.message));
});
