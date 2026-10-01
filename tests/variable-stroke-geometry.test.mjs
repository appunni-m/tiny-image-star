import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, parseDocument, serializeDocument } from '../src/model.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { vectorGeometryFromAnchors } from '../src/vector-path.js';
import { MAX_VARIABLE_STROKE_SAMPLES, variableStrokeOutlineFromSamples } from '../src/variable-stroke-geometry.js';

const bounds = points => ({
  left: Math.min(...points.map(point => point.x)),
  top: Math.min(...points.map(point => point.y)),
  right: Math.max(...points.map(point => point.x)),
  bottom: Math.max(...points.map(point => point.y))
});

test('pressure-sensitive pencil creates a closed round-ended outline with pressure-scaled width', () => {
  const outline = variableStrokeOutlineFromSamples([
    { x: 0, y: 0, pressure: 0 },
    { x: 20, y: 0, pressure: 1 }
  ], { minWidth: 1, maxWidth: 9 });
  const box = bounds(outline);
  assert.ok(outline.length > 4, 'round caps add sampled vector points');
  assert.ok(box.bottom - box.top > 8.9, 'the high-pressure end is much wider than the low-pressure end');
  assert.ok(outline.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.ok(outline.some(point => point.x < 0), 'the first cap rounds behind the stroke start');
  assert.ok(outline.some(point => point.x > 20), 'the last cap rounds beyond the stroke end');
});

test('pressure outlines preserve curved paths and keep sharp joins within the miter bound', () => {
  const outline = variableStrokeOutlineFromSamples([
    { x: 0, y: 0, pressure: .3 },
    { x: 12, y: 0, pressure: .5 },
    { x: 12, y: 12, pressure: .9 },
    { x: 11.8, y: 14, pressure: 1 }
  ], { minWidth: 1, maxWidth: 12, maxMiter: 2 });
  const box = bounds(outline);
  assert.ok(outline.length > 20);
  assert.ok(outline.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.ok(box.left > -20 && box.right < 32 && box.top > -20 && box.bottom < 40,
    'a near-reversing join cannot create an unbounded spike');
});

test('coincident points coalesce, default pressure is stable, and a tap has no outline', () => {
  assert.equal(variableStrokeOutlineFromSamples([{ x: 1, y: 1 }, { x: 1, y: 1 }]), null);
  const outline = variableStrokeOutlineFromSamples([
    { x: 0, y: 0 }, { x: 0, y: 0, pressure: .5 }, { x: 10, y: 0 }
  ]);
  assert.ok(outline.length >= 3);
  assert.ok(outline.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('variable stroke input and allocation controls fail closed at malformed or excessive bounds', () => {
  assert.throws(() => variableStrokeOutlineFromSamples(null), /array/);
  assert.throws(() => variableStrokeOutlineFromSamples([{ x: 0, y: 0 }, { x: NaN, y: 1 }]), /finite/);
  assert.throws(() => variableStrokeOutlineFromSamples([{ x: 0, y: 0, pressure: Infinity }, { x: 1, y: 0 }]), /finite/);
  assert.throws(() => variableStrokeOutlineFromSamples([{ x: 0, y: 0 }, { x: 1, y: 0 }], { maxWidth: 200 }), /bounded/);
  assert.throws(() => variableStrokeOutlineFromSamples(Array.from({ length: MAX_VARIABLE_STROKE_SAMPLES + 1 }, (_, x) => ({ x, y: x % 2 }))), /limited/);
});

test('pressure outlines become ordinary editable, serializable, SVG-exportable vector paths', () => {
  const outline = variableStrokeOutlineFromSamples([
    { x: 12, y: 15, pressure: .1 },
    { x: 30, y: 22, pressure: .9 },
    { x: 46, y: 16, pressure: .45 }
  ]);
  const node = createNode('path', { ...vectorGeometryFromAnchors(outline, { closed: true }), fill: '#224466', fillOpacity: 1, stroke: null, strokeWidth: 0 });
  const document = createDocument();
  addNode(document, node);
  const restored = parseDocument(serializeDocument(document));
  const restoredPath = restored.pages[0].children[0];
  assert.equal(restoredPath.closed, true);
  assert.ok(restoredPath.points.length >= 3);
  assert.match(exportNodeToSvg(restoredPath), /<path[^>]*fill="#224466"/);
});
