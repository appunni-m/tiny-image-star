import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { rasterExportBounds } from '../src/raster-export-bounds.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';

test('raster export includes visible aligned paint from the entire stroke stack', () => {
  const document = createDocument();
  const node = createNode('rectangle', { x: 10, y: 20, width: 100, height: 60, strokes: [
    createStroke({ width: 20, alignment: 'inside' }),
    createStroke({ width: 3, alignment: 'center' }),
    createStroke({ width: 8, alignment: 'outside' }),
    createStroke({ width: 50, alignment: 'outside', visible: false })
  ] });
  assert.deepEqual(rasterExportBounds(document, node), { x: 2, y: 12, width: 116, height: 76 });
  node.strokes = [createStroke({ width: 20, alignment: 'inside' })];
  assert.deepEqual(rasterExportBounds(document, node), { x: 10, y: 20, width: 100, height: 60 });
});

test('raster export bounds enclose transformed outside strokes and effect paint through affine ancestors', () => {
  const document = createDocument();
  const parent = createNode('frame', { x: 50, y: 20, width: 200, height: 100, affineTransform: { a: 1, b: 0.2, c: 0.4, d: 1, e: 0, f: 0 } });
  const node = createNode('rectangle', { x: 12, y: 9, width: 80, height: 40, rotation: 23,
    strokes: [createStroke({ width: 6, alignment: 'outside' })],
    effects: [{ id: 'shadow', type: 'drop-shadow', visible: true, showShadowBehindNode: true,
      color: '#000000', opacity: 0.5, offsetX: 2, offsetY: -3, blur: 4 }]
  });
  const bounds = rasterExportBounds(document, node, [parent]);
  const own = [{ x: -6, y: -6 }, { x: 86, y: -6 }, { x: 86, y: 46 }, { x: -6, y: 46 }]
    .map(point => nodeLocalToPage(node, point));
  const corners = [
    { x: Math.min(...own.map(point => point.x)) - 14, y: Math.min(...own.map(point => point.y)) - 15 },
    { x: Math.max(...own.map(point => point.x)) + 14, y: Math.min(...own.map(point => point.y)) - 15 },
    { x: Math.max(...own.map(point => point.x)) + 14, y: Math.max(...own.map(point => point.y)) + 15 },
    { x: Math.min(...own.map(point => point.x)) - 14, y: Math.max(...own.map(point => point.y)) + 15 }
  ].map(point => nodeLocalToPage(parent, point));
  for (const point of corners) {
    assert.ok(point.x >= bounds.x - 1e-8 && point.x <= bounds.x + bounds.width + 1e-8);
    assert.ok(point.y >= bounds.y - 1e-8 && point.y <= bounds.y + bounds.height + 1e-8);
  }
  assert.ok(bounds.width > 120 && bounds.height > 80);
});

test('raster export preserves a shadow offset after the layer affine transform shrinks its geometry', () => {
  const node = createNode('rectangle', { width: 100, height: 60, affineTransform: { a: .1, b: 0, c: 0, d: .1 },
    effects: [{ id: 'shadow', type: 'drop-shadow', visible: true, color: '#000000', opacity: 1, offsetX: 100, offsetY: 0, blur: 2 }] });
  const bounds = rasterExportBounds(createDocument(), node);
  assert.equal(bounds.x, -106);
  assert.equal(bounds.y, -6);
  assert.equal(bounds.width, 222);
  assert.equal(bounds.height, 18);
});

test('open line export keeps centered geometry even if copied paint carries an aligned position', () => {
  const document = createDocument();
  const line = createNode('line', { width: 100, height: 0, strokes: [createStroke({ width: 8, alignment: 'inside' })] });
  assert.deepEqual(rasterExportBounds(document, line), { x: -4, y: -4, width: 108, height: 8 });
});

test('raster export retains out-of-box path curves before adding the outside-stroke apron', () => {
  const node = createNode('path', { x: 30, y: 40, width: 100, height: 60, closed: true,
    points: [{ x: 0, y: 0, out: { x: -.5, y: -.5 } }, { x: 1, y: 0, in: { x: .5, y: -.5 } }, { x: .5, y: 1 }],
    strokes: [createStroke({ width: 4, alignment: 'outside', join: 'round' })]
  });
  assert.deepEqual(rasterExportBounds(createDocument(), node), { x: -24, y: 6, width: 208, height: 98 });
});
