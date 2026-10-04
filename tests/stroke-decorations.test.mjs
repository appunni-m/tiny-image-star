import test from 'node:test';
import assert from 'node:assert/strict';
import { createNode } from '../src/model.js';
import { strokeEndpointDecorations } from '../src/stroke-decorations.js';

test('line decorations use explicit start/end directions and line reversal', () => {
  const line = createNode('line', { width: 100, height: 0 });
  const stroke = { width: 2, startDecoration: 'triangle', endDecoration: 'arrow' };
  const [start, end] = strokeEndpointDecorations(line, stroke, { x: 10, y: 20 });
  assert.deepEqual(start, {
    type: 'triangle', side: 'start', tip: { x: 10, y: 20 },
    points: [{ x: 10, y: 20 }, { x: 18, y: 15.6 }, { x: 18, y: 24.4 }], closed: true, endpoint: 'start'
  });
  assert.equal(end.type, 'arrow');
  assert.equal(end.tip.x, 110);
  assert.deepEqual(end.points, [{ x: 102, y: 24.4 }, { x: 110, y: 20 }, { x: 102, y: 15.6 }]);

  line.height = 30;
  line.lineReverseY = true;
  const reverse = strokeEndpointDecorations(line, stroke, { x: 10, y: 20 });
  assert.deepEqual(reverse[0].tip, { x: 10, y: 50 });
  assert.deepEqual(reverse[1].tip, { x: 110, y: 20 });
  assert.ok(reverse[0].points[1].x > reverse[0].tip.x, 'start triangle points away from the reversed line');
});

test('filled circle and diamond markers have smooth and direction-aware endpoint geometry', () => {
  const line = createNode('line', { width: 40, height: 0 });
  const [circle, diamond] = strokeEndpointDecorations(line, {
    width: 2, startDecoration: 'circle', endDecoration: 'diamond'
  });
  assert.deepEqual(circle, {
    type: 'circle', side: 'start', tip: { x: 0, y: 0 }, center: { x: 0, y: 0 },
    radius: 4.4, closed: true, endpoint: 'start'
  });
  assert.deepEqual(diamond, {
    type: 'diamond', side: 'end', tip: { x: 40, y: 0 },
    points: [{ x: 40, y: 0 }, { x: 36, y: 4.4 }, { x: 32, y: 0 }, { x: 36, y: -4.4 }],
    closed: true, endpoint: 'end'
  });
});

test('open path contours get endpoint decorations while closed contours stay undecorated', () => {
  const path = createNode('path', {
    width: 100, height: 60, closed: false,
    points: [
      { x: .1, y: .5, out: { x: .2, y: 0 } },
      { x: .9, y: .5, in: { x: -.1, y: 0 } }
    ],
    subpaths: [
      { closed: true, points: [{ x: .2, y: .2 }, { x: .5, y: .2 }, { x: .4, y: .5 }] },
      { closed: false, points: [{ x: .25, y: .75 }, { x: .75, y: .75 }] }
    ]
  });
  const output = strokeEndpointDecorations(path, { width: 3, startDecoration: 'arrow', endDecoration: 'triangle' });
  assert.deepEqual(output.map(item => [item.endpoint, item.contourIndex, item.type]), [
    ['start', 0, 'arrow'], ['end', 0, 'triangle'], ['start', 2, 'arrow'], ['end', 2, 'triangle']
  ]);
  assert.deepEqual(output[0].tip, { x: 10, y: 30 });
  assert.deepEqual(output[1].tip, { x: 90, y: 30 });
  const startBaseX = (output[0].points[0].x + output[0].points[2].x) / 2;
  const endBaseX = (output[1].points[1].x + output[1].points[2].x) / 2;
  assert.ok(startBaseX > output[0].tip.x, 'the start arrow faces opposite the outgoing Bézier tangent');
  assert.ok(endBaseX < output[1].tip.x, 'the end triangle faces along the incoming Bézier tangent');
});

test('network decorations attach only to open graph terminals, not shared junctions', () => {
  const network = createNode('network', {
    width: 100, height: 100,
    vertices: [
      { id: 'a', x: 0, y: .5 }, { id: 'b', x: .5, y: .5 },
      { id: 'c', x: 1, y: .5 }, { id: 'd', x: .5, y: 1 }
    ],
    edges: [
      { id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'bd', from: 'b', to: 'd' }
    ]
  });
  const output = strokeEndpointDecorations(network, { width: 2, startDecoration: 'arrow', endDecoration: 'triangle' });
  assert.deepEqual(output.map(item => [item.edgeId, item.endpoint]), [
    ['ab', 'start'], ['bc', 'end'], ['bd', 'end']
  ]);
  assert.ok(output.every(item => !(item.tip.x === 50 && item.tip.y === 50)), 'the branch junction gets no endpoint marker');
});

test('none is the default and zero-width strokes do not produce decorations', () => {
  const line = createNode('line', { width: 40 });
  assert.deepEqual(strokeEndpointDecorations(line, { width: 2 }), []);
  assert.deepEqual(strokeEndpointDecorations(line, { width: 0, startDecoration: 'arrow', endDecoration: 'triangle' }), []);
  assert.deepEqual(strokeEndpointDecorations(line, { width: 2, startDecoration: 'none', endDecoration: 'none' }), []);
});
