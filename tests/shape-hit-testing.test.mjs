import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, addVariableMode, bindColorVariable, createColorVariable, createDocument,
  createNode, createVariable, createVariableCollection, setFrameVariableMode, setVariableValue
} from '../src/model.js';
import { hitTestPage } from '../src/renderer.js';
import { hitTestVisibleGeometry } from '../src/shape-hit-testing.js';
import { vectorNetworkGeometryFromAnchors } from '../src/vector-path.js';

test('ellipse hit testing follows its painted curve instead of its bounding corners', () => {
  const document = createDocument();
  const ellipse = createNode('ellipse', { x: 10, y: 20, width: 100, height: 60, fill: '#ff0000', stroke: null, strokeWidth: 0 });
  addNode(document, ellipse);
  assert.equal(hitTestPage(document.pages[0], { x: 12, y: 22 }, null, document), null,
    'an empty corner of the ellipse bounding box should not select the ellipse');
  assert.equal(hitTestPage(document.pages[0], { x: 60, y: 50 }, null, document)?.id, ellipse.id);
});

test('slice hit testing selects the export border without stealing underlying canvas artwork', () => {
  const document = createDocument();
  const artwork = createNode('rectangle', { x: 0, y: 0, width: 100, height: 80, fill: '#ff0000', stroke: null, strokeWidth: 0 });
  const slice = createNode('slice', { x: 10, y: 10, width: 60, height: 50 });
  addNode(document, artwork);
  addNode(document, slice);
  assert.equal(hitTestPage(document.pages[0], { x: 40, y: 35 }, null, document)?.id, artwork.id,
    'the slice interior must leave the underlying artwork directly selectable');
  assert.equal(hitTestPage(document.pages[0], { x: 10.5, y: 30 }, null, document)?.id, slice.id,
    'the slice border should select the export region');
});

test('polygon and star hit testing rejects unpainted corners', () => {
  for (const type of ['polygon', 'star']) {
    const document = createDocument();
    const shape = createNode(type, { x: 0, y: 0, width: 100, height: 100, fill: '#123456', stroke: null, strokeWidth: 0 });
    addNode(document, shape);
    assert.equal(hitTestPage(document.pages[0], { x: 2, y: 2 }, null, document), null, `${type} corner should be empty`);
    assert.equal(hitTestPage(document.pages[0], { x: 50, y: 50 }, null, document)?.id, shape.id, `${type} center should be painted`);
  }
});

test('negative-slope lines are selectable on the stroke and reject the other bounds diagonal', () => {
  const document = createDocument();
  const line = createNode('line', {
    x: 10, y: 10, width: 100, height: 100, fill: 'transparent', stroke: '#000000', strokeWidth: 2, lineReverseY: true
  });
  addNode(document, line);
  assert.equal(hitTestPage(document.pages[0], { x: 11, y: 11 }, null, document), null,
    'the empty top-left corner of a reverse line should not select it');
  assert.equal(hitTestPage(document.pages[0], { x: 11, y: 109 }, null, document)?.id, line.id,
    'the actual negative-slope stroke should be selectable');
});

test('rounded rectangle corners and stroke-only interiors match visible paint', () => {
  const filled = createNode('rectangle', { width: 100, height: 100, radius: 40, fill: '#ffffff', stroke: null, strokeWidth: 0 });
  assert.equal(hitTestVisibleGeometry(filled, { x: 2, y: 2 }), false);
  assert.equal(hitTestVisibleGeometry(filled, { x: 50, y: 50 }), true);
  const quadraticBoundary = createNode('rectangle', { width: 100, height: 100, radius: 20, fill: '#ffffff', stroke: null, strokeWidth: 0 });
  assert.equal(hitTestVisibleGeometry(quadraticBoundary, { x: 95, y: 5 }), true,
    'fill hit testing follows the visible quadratic top-right corner rather than a circular approximation');

  const outline = createNode('rectangle', { width: 100, height: 60, fill: 'transparent', stroke: '#000000', strokeWidth: 2 });
  assert.equal(hitTestVisibleGeometry(outline, { x: 50, y: 30 }), false);
  assert.equal(hitTestVisibleGeometry(outline, { x: 50, y: 0 }), true);
});

test('stroke tolerance extends a small amount beyond the shape bounds', () => {
  const ellipse = createNode('ellipse', { width: 100, height: 50, fill: 'transparent', stroke: '#000000', strokeWidth: 2 });
  assert.equal(hitTestVisibleGeometry(ellipse, { x: 102, y: 25 }), true);
  assert.equal(hitTestVisibleGeometry(ellipse, { x: 108, y: 25 }), false);
});

test('hit testing resolves color and radius variables before checking painted geometry', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Geometry');
  const radius = createVariable(document, collection.id, 'Radius', 'number', 40);
  const rounded = createNode('rectangle', {
    width: 100, height: 100, radius: 0, fill: '#ffffff',
    variableBindings: { radius: radius.id }
  });
  addNode(document, rounded);
  assert.equal(hitTestPage(document.pages[0], { x: 2, y: 2 }, null, document), null,
    'the variable-rounded corner is visibly empty');
  assert.equal(hitTestPage(document.pages[0], { x: 15, y: 15 }, null, document)?.id, rounded.id);

  const fill = createColorVariable(document, collection.id, 'Visible fill', '#ffffff');
  const boundFill = createNode('rectangle', { x: 120, width: 100, height: 100, fill: 'transparent' });
  addNode(document, boundFill);
  bindColorVariable(document, boundFill.id, fill.id, 'fill');
  assert.equal(hitTestPage(document.pages[0], { x: 170, y: 50 }, null, document)?.id, boundFill.id,
    'a visible mode-bound fill remains pickable when its fallback color is transparent');

  const stroke = createColorVariable(document, collection.id, 'Visible stroke', '#000000');
  const boundStroke = createNode('line', { x: 240, width: 100, height: 0, stroke: 'transparent', strokeWidth: 2 });
  addNode(document, boundStroke);
  bindColorVariable(document, boundStroke.id, stroke.id, 'stroke');
  assert.equal(hitTestPage(document.pages[0], { x: 290, y: 0 }, null, document)?.id, boundStroke.id,
    'a visible mode-bound stroke remains pickable when its fallback color is transparent');

  const radiusStroke = createNode('rectangle', {
    x: 360, width: 100, height: 100, radius: 0,
    fill: 'transparent', stroke: '#000000', strokeWidth: 2,
    variableBindings: { radius: radius.id }
  });
  addNode(document, radiusStroke);
  assert.equal(hitTestPage(document.pages[0], { x: 370, y: 10 }, null, document)?.id, radiusStroke.id,
    'stroke hit testing follows the variable-resolved quadratic corner geometry');
});

test('child hit testing follows the exact rounded clipping path of its frame', () => {
  const document = createDocument();
  const frame = createNode('frame', { width: 100, height: 100, radius: 20, clip: true, fill: '#ffffff' });
  const child = createNode('rectangle', { width: 100, height: 100, fill: '#ff0000', stroke: null, strokeWidth: 0 });
  addNode(document, frame);
  addNode(document, child, { parentId: frame.id });

  assert.equal(hitTestPage(document.pages[0], { x: 95, y: 5 }, null, document)?.id, child.id,
    'a point on the rendered quadratic frame clip remains inside for pointer picking');
  assert.equal(hitTestPage(document.pages[0], { x: 99, y: 1 }, null, document)?.id, frame.id,
    'points beyond the rendered rounded viewport cannot hit the clipped child');
});

test('design editing can pick a deselected child beyond its clipping frame', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 20, y: 20, width: 100, height: 100, clip: true, fill: '#ffffff' });
  const child = createNode('rectangle', { x: 120, y: 10, width: 40, height: 40, fill: '#ff0000', stroke: null, strokeWidth: 0 });
  addNode(document, frame);
  addNode(document, child, { parentId: frame.id });
  const outsidePoint = { x: 150, y: 40 };

  assert.equal(hitTestPage(document.pages[0], outsidePoint, null, document), null,
    'ordinary picking must keep respecting the visible frame clip');
  assert.equal(hitTestPage(document.pages[0], outsidePoint, null, document, null, 1, {
    allowAnyClippedNodes: true
  })?.id, child.id,
  'design editing can select the overflow child after a click-away cleared its previous selection');
});

test('hit testing follows the active frame mode for a bound corner radius', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Responsive radii');
  const radius = createVariable(document, collection.id, 'Radius', 'number', 0);
  const roundedMode = addVariableMode(document, collection.id, 'Rounded');
  setVariableValue(document, radius.id, 40, roundedMode.id);
  const frame = createNode('frame', { width: 100, height: 100, fill: 'transparent' });
  const rectangle = createNode('rectangle', {
    width: 100, height: 100, radius: 0, fill: '#ffffff', variableBindings: { radius: radius.id }
  });
  addNode(document, frame);
  addNode(document, rectangle, { parentId: frame.id });

  assert.equal(hitTestPage(document.pages[0], { x: 2, y: 2 }, null, document)?.id, rectangle.id,
    'the default mode has square corners');
  assert.equal(setFrameVariableMode(document, frame.id, collection.id, roundedMode.id), true);
  assert.equal(hitTestPage(document.pages[0], { x: 2, y: 2 }, null, document)?.id, frame.id,
    'the rounded-away corner falls through to the frame in the active mode');
  assert.equal(hitTestPage(document.pages[0], { x: 15, y: 15 }, null, document)?.id, rectangle.id,
    'the visible part of the variable-rounded child remains selectable');
});

test('canvas pick tolerance stays constant in screen pixels at different zoom levels', () => {
  const document = createDocument();
  const line = createNode('line', { width: 100, height: 0, fill: 'transparent', stroke: '#000000', strokeWidth: 1 });
  addNode(document, line);

  assert.equal(hitTestPage(document.pages[0], { x: 50, y: 8 }, null, document, null, .25)?.id, line.id,
    'two screen pixels at 25% zoom should fall inside the four-pixel pick radius');
  assert.equal(hitTestPage(document.pages[0], { x: 50, y: .5 }, null, document, null, 4)?.id, line.id,
    'two screen pixels at 400% zoom should fall inside the same pick radius');
  assert.equal(hitTestPage(document.pages[0], { x: 50, y: 28 }, null, document, null, .25), null,
    'seven screen pixels at 25% zoom should be outside the pick radius');
  assert.equal(hitTestPage(document.pages[0], { x: 50, y: 1.75 }, null, document, null, 4), null,
    'seven screen pixels at 400% zoom should be outside the same pick radius');
});

test('network face hit testing resolves parallel edge pairs the same way as rendering', () => {
  const document = createDocument();
  const geometry = vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }
  ], { closed: true });
  geometry.fill = '#ff0000';
  geometry.stroke = null;
  geometry.strokeWidth = 0;
  geometry.edges.push({
    id: 'parallel-reverse-edge', from: 'v2', to: 'v1',
    control1: { x: .67, y: .75 }, control2: { x: .33, y: .75 }
  });
  const network = createNode('network', geometry);
  addNode(document, network);

  assert.equal(hitTestPage(document.pages[0], { x: 50, y: 10 }, null, document)?.id, network.id,
    'the renderer uses the first straight edge for this face, so hit testing must too');
});

test('network face hit testing follows per-vertex corner radii for both fills and strokes', () => {
  const geometry = vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }
  ], { closed: true });
  geometry.vertices[0].cornerRadius = 20;

  const fillDocument = createDocument();
  const filled = createNode('network', { ...geometry, fill: '#ff0000', stroke: null, strokeWidth: 0 });
  addNode(fillDocument, filled);
  assert.equal(hitTestPage(fillDocument.pages[0], { x: 2, y: 2 }, null, fillDocument), null,
    'the transparent area cut away by a rounded network corner must not select the filled network');
  assert.equal(hitTestPage(fillDocument.pages[0], { x: 10, y: 10 }, null, fillDocument)?.id, filled.id,
    'the painted interior of a rounded network face remains selectable');

  const strokeDocument = createDocument();
  const outlined = createNode('network', { ...geometry, fill: 'transparent', stroke: '#000000', strokeWidth: 2 });
  addNode(strokeDocument, outlined);
  assert.equal(hitTestVisibleGeometry(outlined, { x: 10, y: 0 }, { tolerance: 0.1 }), false,
    'the sharp source edge trimmed away by the corner radius is no longer a stroke hit target');
  assert.equal(hitTestVisibleGeometry(outlined, { x: 6, y: 6 }, { tolerance: 0.1 }), true,
    'the visible rounded arc remains a stroke hit target');
});
