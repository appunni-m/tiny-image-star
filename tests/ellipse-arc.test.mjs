import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, addNode, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { ellipseArcBoundaryPolylines, ellipseArcContainsPoint, ellipseArcSvgPathData, isValidEllipseArcData, traceEllipseArc, updateEllipseArcData } from '../src/ellipse-arc.js';
import { hitTestVisibleGeometry } from '../src/shape-hit-testing.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { shapeBuilderRegionAtPoint } from '../src/boolean-geometry.js';
import { ellipseArcAngleFromPointer, ellipseArcControlHandles, ellipseArcDataFromPointer, ellipseArcInnerRadiusFromPointer } from '../src/ellipse-arc-controls.js';

const TAU = Math.PI * 2;

function ellipse(arcData, overrides = {}) {
  return createNode('ellipse', {
    width: 100, height: 100, fill: '#ff0000', stroke: null, strokeWidth: 0,
    ...(arcData ? { arcData } : {}), ...overrides
  });
}

test('ellipse arc records validate and survive a local design round trip', () => {
  const document = createDocument();
  const ring = ellipse({ startingAngle: 0, endingAngle: TAU, innerRadius: .42 });
  addNode(document, ring);
  assert.equal(isValidEllipseArcData(ring.arcData), true);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
  assert.equal(validateDocument(document), true);
  assert.equal(isValidEllipseArcData({ startingAngle: 0, endingAngle: TAU + .1, innerRadius: 0 }), false);
  assert.throws(() => validateDocument({ ...document, pages: [{ ...document.pages[0], children: [ellipse({ startingAngle: 0, endingAngle: TAU + .1, innerRadius: 0 })] }] }), /ellipse arc data/i);
});

test('ellipse arc Appearance edits update degree fields without changing the layer bounds', () => {
  const shape = ellipse(null, { x: 8.5, y: 12.25, width: 143.75, height: 92.5 });
  shape.arcData = updateEllipseArcData(shape, 'start', 45);
  shape.arcData = updateEllipseArcData(shape, 'end', 220);
  shape.arcData = updateEllipseArcData(shape, 'innerRadius', .35);
  assert.deepEqual(shape.arcData, { startingAngle: Math.PI / 4, endingAngle: 220 * Math.PI / 180, innerRadius: .35 });
  assert.deepEqual([shape.x, shape.y, shape.width, shape.height], [8.5, 12.25, 143.75, 92.5]);
  assert.equal(updateEllipseArcData(shape, 'end', 420).endingAngle, TAU);
});

test('ellipse arc canvas handles expose start, end, and ratio controls with Figma angle direction', () => {
  const wedge = ellipse({ startingAngle: 0, endingAngle: Math.PI / 2, innerRadius: .25 });
  const handles = ellipseArcControlHandles(wedge);
  assert.deepEqual(handles.map(handle => handle.kind), ['start', 'end', 'innerRadius']);
  assert.deepEqual(handles[0].point, { x: 100, y: 50 });
  assert.deepEqual(handles[1].point, { x: 50, y: 100 });
  assert.equal(ellipseArcAngleFromPointer(wedge, { x: 100, y: 50 }), 0);
  assert.equal(ellipseArcAngleFromPointer(wedge, { x: 50, y: 100 }), Math.PI / 2);
  assert.equal(ellipseArcAngleFromPointer(wedge, { x: 50, y: 0 }), 3 * Math.PI / 2);
  assert.equal(ellipseArcInnerRadiusFromPointer(wedge, { x: 75, y: 50 }), .5);
  assert.deepEqual(ellipseArcDataFromPointer(wedge, 'start', { x: 50, y: 0 }, {
    startLocal: { x: 100, y: 50 }, initialArcData: wedge.arcData
  }),
    { startingAngle: 3 * Math.PI / 2, endingAngle: Math.PI / 2, innerRadius: .25 });

  const fullRing = ellipse({ startingAngle: 0, endingAngle: TAU, innerRadius: .4 });
  assert.deepEqual(ellipseArcControlHandles(fullRing).map(handle => handle.kind), ['start', 'end', 'innerRadius'],
    'a full ring keeps its coincident angle handles separated so all three controls remain accessible');
  const fullEllipse = ellipse(null);
  assert.deepEqual(ellipseArcControlHandles(fullEllipse).map(handle => handle.kind), ['start', 'end']);
  const startHandle = ellipseArcControlHandles(fullEllipse).find(handle => handle.kind === 'start');
  const from = startHandle.point;
  const at = { x: from.x + 2, y: from.y + 1 };
  const dragged = ellipseArcDataFromPointer(fullEllipse, 'start', at, { startLocal: from, initialArcData: fullEllipse.arcData });
  assert.notEqual(dragged.startingAngle, 0, 'a drag starts from the authored angle, not the visually separated handle position');
});

test('ellipse arc fill hit testing follows pies and leaves a donut hole empty', () => {
  const quarterPie = ellipse({ startingAngle: 0, endingAngle: Math.PI / 2, innerRadius: 0 });
  assert.equal(hitTestVisibleGeometry(quarterPie, { x: 75, y: 75 }, { tolerance: 0 }), true);
  assert.equal(hitTestVisibleGeometry(quarterPie, { x: 25, y: 25 }, { tolerance: 0 }), false);
  assert.equal(hitTestVisibleGeometry(quarterPie, { x: 10, y: 50 }, { tolerance: 0 }), false);

  const ring = ellipse({ startingAngle: 0, endingAngle: TAU, innerRadius: .4 });
  assert.equal(ellipseArcContainsPoint(ring, { x: 50, y: 50 }), false);
  assert.equal(hitTestVisibleGeometry(ring, { x: 80, y: 50 }, { tolerance: 0 }), true);
  assert.equal(hitTestVisibleGeometry(ring, { x: 60, y: 50 }, { tolerance: 0 }), false);
  assert.equal(hitTestVisibleGeometry(ring, { x: 105, y: 50 }, { tolerance: 0 }), false);
});

test('ellipse arc stroke hit testing includes the visible arc and its radial edges', () => {
  const wedge = ellipse({ startingAngle: 0, endingAngle: Math.PI / 2, innerRadius: 0, fill: 'transparent', stroke: '#000000', strokeWidth: 2 });
  assert.equal(hitTestVisibleGeometry(wedge, { x: 100, y: 50 }, { tolerance: 0 }), true);
  assert.equal(hitTestVisibleGeometry(wedge, { x: 50, y: 100 }, { tolerance: 0 }), true);
  assert.equal(hitTestVisibleGeometry(wedge, { x: 50, y: 50 }, { tolerance: 0 }), true, 'the pie boundary contains its two radial edges');
  assert.ok(ellipseArcBoundaryPolylines(wedge).length >= 3);
});

test('Canvas tracing builds a closed donut segment and an opposite-winding inner contour', () => {
  const calls = [];
  const context = {
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    ellipse: (...args) => calls.push(['ellipse', ...args]),
    closePath: () => calls.push(['closePath'])
  };
  assert.equal(traceEllipseArc(context, ellipse({ startingAngle: 0, endingAngle: Math.PI, innerRadius: .5 })), true);
  assert.equal(calls.filter(([name]) => name === 'ellipse').length, 2);
  assert.deepEqual(calls.filter(([name]) => name === 'ellipse').map(call => call.at(-1)), [false, true]);
  assert.deepEqual(calls.at(-1), ['closePath']);
});

test('Boolean and Shape Builder geometry preserves ellipse arc holes instead of treating them as full ellipses', () => {
  const ring = ellipse({ startingAngle: 0, endingAngle: TAU, innerRadius: .4 });
  const separate = createNode('rectangle', { x: 200, y: 0, width: 30, height: 30, fill: '#00ff00' });
  const center = shapeBuilderRegionAtPoint([ring, separate], { x: 50, y: 50 });
  const outer = shapeBuilderRegionAtPoint([ring, separate], { x: 90, y: 50 });
  assert.equal(center, null, 'the hole must remain empty in vector hit geometry');
  assert.equal(outer?.membership[0], true, 'the donut band remains a selectable filled region');
});

test('SVG export uses native ellipse paths for arc, pie, and ring geometry', () => {
  const full = exportNodeToSvg(ellipse(null));
  assert.match(full, /<ellipse\b/);

  const pie = exportNodeToSvg(ellipse({ startingAngle: 0, endingAngle: Math.PI / 2, innerRadius: 0 }));
  assert.match(pie, /<path d="M 100 50 A 50 50 0 0 1 50 100 L 50 50 Z"/);
  assert.match(pie, /fill-rule="evenodd"/);

  const ringPath = ellipseArcSvgPathData(ellipse({ startingAngle: 0, endingAngle: TAU, innerRadius: .5 }));
  assert.match(ringPath, /^M 100 50 A 50 50 0 0 1 0 50 A 50 50 0 0 1 100 50 M 75 50 A 25 25 0 0 0 25 50 A 25 25 0 0 0 75 50$/);
  assert.match(exportNodeToSvg(ellipse({ startingAngle: 0, endingAngle: TAU, innerRadius: .5 })), /<path d="M 100 50/);
});
