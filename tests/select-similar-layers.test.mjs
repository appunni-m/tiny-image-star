import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLayersWithSamePaint } from '../src/select-similar-layers.js';

const solid = (id, color, overrides = {}) => ({ id, type: 'solid', color, visible: true, opacity: 1, ...overrides });
const rectangle = (id, fills, overrides = {}) => ({ id, type: 'rectangle', fills, children: [], ...overrides });

test('same-fill selection matches visible paint appearance while ignoring paint and gradient-stop IDs', () => {
  const first = rectangle('first', [solid('fill-a', '#1769aa')]);
  const second = rectangle('second', [solid('fill-b', '#1769aa')]);
  const gradientA = rectangle('gradient-a', [{
    id: 'gradient-fill-a', type: 'linear', visible: true, opacity: 0.8,
    gradient: { type: 'linear', angle: 45, stops: [
      { id: 'stop-a', color: '#000000', position: 0 },
      { id: 'stop-b', color: '#ffffff', position: 1 }
    ] }
  }]);
  const gradientB = rectangle('gradient-b', [{
    id: 'gradient-fill-b', type: 'linear', visible: true, opacity: 0.8,
    gradient: { type: 'linear', angle: 45, stops: [
      { id: 'other-stop-a', color: '#000000', position: 0 },
      { id: 'other-stop-b', color: '#ffffff', position: 1 }
    ] }
  }]);

  assert.deepEqual(selectLayersWithSamePaint([first, second, gradientA, gradientB], first, 'fill'), ['first', 'second']);
  assert.deepEqual(selectLayersWithSamePaint([first, second, gradientA, gradientB], gradientA, 'fill'), ['gradient-a', 'gradient-b']);
});

test('same-fill selection distinguishes paint values, compositing, stack order, and fill visibility', () => {
  const reference = rectangle('reference', [solid('a', '#ff0000'), solid('b', '#0000ff', { opacity: 0.4 })]);
  const color = rectangle('color', [solid('a', '#00ff00'), solid('b', '#0000ff', { opacity: 0.4 })]);
  const opacity = rectangle('opacity', [solid('a', '#ff0000'), solid('b', '#0000ff', { opacity: 0.5 })]);
  const reversed = rectangle('reversed', [solid('b', '#0000ff', { opacity: 0.4 }), solid('a', '#ff0000')]);
  const hiddenOnly = rectangle('hidden-only', [solid('hidden', '#ff0000', { visible: false })]);

  assert.deepEqual(selectLayersWithSamePaint([reference, color, opacity, reversed, hiddenOnly], reference, 'fill'), ['reference']);
  assert.deepEqual(selectLayersWithSamePaint([hiddenOnly], hiddenOnly, 'fill'), []);
});

test('same-stroke selection compares stroke appearance without merging different line weights or patterns', () => {
  const reference = { id: 'reference', type: 'rectangle', strokes: [{ id: 'stroke-a', color: '#222222', width: 2, opacity: 1, visible: true, pattern: 'solid' }] };
  const same = { id: 'same', type: 'path', strokes: [{ id: 'stroke-b', color: '#222222', width: 2, opacity: 1, visible: true, pattern: 'solid' }] };
  const thick = { id: 'thick', type: 'ellipse', strokes: [{ id: 'stroke-c', color: '#222222', width: 3, opacity: 1, visible: true, pattern: 'solid' }] };
  const dashed = { id: 'dashed', type: 'rectangle', strokes: [{ id: 'stroke-d', color: '#222222', width: 2, opacity: 1, visible: true, pattern: 'dashed' }] };

  assert.deepEqual(selectLayersWithSamePaint([reference, same, thick, dashed], reference, 'stroke'), ['reference', 'same']);
});

test('same-paint selection skips hidden and locked ancestors and never reaches outside its page tree', () => {
  const reference = rectangle('reference', [solid('a', '#123456')]);
  const hiddenChild = rectangle('hidden-child', [solid('b', '#123456')]);
  const lockedChild = rectangle('locked-child', [solid('c', '#123456')]);
  const visibleChild = rectangle('visible-child', [solid('d', '#123456')]);
  const roots = [
    reference,
    { id: 'hidden-parent', type: 'group', visible: false, children: [hiddenChild] },
    { id: 'locked-parent', type: 'group', locked: true, children: [lockedChild] },
    { id: 'visible-parent', type: 'group', children: [visibleChild] }
  ];

  assert.deepEqual(selectLayersWithSamePaint(roots, reference, 'fill'), ['reference', 'visible-child']);
  assert.deepEqual(selectLayersWithSamePaint([visibleChild], reference, 'fill'), []);
  assert.throws(() => selectLayersWithSamePaint(roots, reference, 'effect'), /Paint kind must be fill or stroke/);
});
