import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeOverlayMotion, reversePrototypeOverlayTransition } from '../src/prototype-overlay-motion.js';

const axisCases = [
  { direction: 'left', x: -1, y: 0 },
  { direction: 'right', x: 1, y: 0 },
  { direction: 'up', x: 0, y: -1 },
  { direction: 'down', x: 0, y: 1 }
];

test('directional enter and exit geometry is normalized across all four axes', () => {
  for (const { direction, x, y } of axisCases) {
    const enter = prototypeOverlayMotion(`move-in-${direction}`, 1280, 720, 0.25, 'enter');
    assert.deepEqual(enter, { x: x ? -x * 0.75 : 0, y: y ? -y * 0.75 : 0, opacity: 1 }, `enter ${direction}`);

    const exit = prototypeOverlayMotion(`move-out-${direction}`, 1280, 720, 0.25, 'exit');
    assert.deepEqual(exit, { x: x ? x * 0.25 : 0, y: y ? y * 0.25 : 0, opacity: 1 }, `exit ${direction}`);
  }
});

test('swap transitions move the old surface out and the new surface in while underlay stays static', () => {
  for (const { direction, x, y } of axisCases) {
    const oldSurface = prototypeOverlayMotion(`push-${direction}`, 640, 360, 0.5, 'exit');
    const newSurface = prototypeOverlayMotion(`push-${direction}`, 640, 360, 0.5, 'enter');
    assert.deepEqual(oldSurface, { x: x ? x * 0.5 : 0, y: y ? y * 0.5 : 0, opacity: 1 });
    assert.deepEqual(newSurface, { x: x ? -x * 0.5 : 0, y: y ? -y * 0.5 : 0, opacity: 1 });
    // The helper returns only the moving overlay surface. Its normalized
    // geometry never implies a transform for the page underneath it.
  }
});

test('dissolve and slide transitions apply role-specific alpha without moving the underlay', () => {
  assert.deepEqual(prototypeOverlayMotion('dissolve', 800, 600, 0.3, 'enter'), { x: 0, y: 0, opacity: 0.3 });
  assert.deepEqual(prototypeOverlayMotion('dissolve', 800, 600, 0.3, 'exit'), { x: 0, y: 0, opacity: 0.7 });
  assert.deepEqual(prototypeOverlayMotion('slide-in-right', 800, 600, 0.4, 'exit'), { x: 0, y: 0, opacity: 0.6 });
  assert.deepEqual(prototypeOverlayMotion('slide-out-up', 800, 600, 0.4, 'enter'), { x: 0, y: 0, opacity: 0.4 });
  assert.deepEqual(prototypeOverlayMotion('slide-in-down', 800, 600, 0.4, 'enter'), { x: 0, y: -0.6, opacity: 1 });
  assert.deepEqual(prototypeOverlayMotion('slide-out-left', 800, 600, 0.4, 'exit'), { x: -0.4, y: 0, opacity: 1 });
});

test('progress clamps at both endpoints for geometry and opacity', () => {
  assert.deepEqual(prototypeOverlayMotion('move-in-left', 100, 100, -4, 'enter'), { x: 1, y: 0, opacity: 1 });
  assert.deepEqual(prototypeOverlayMotion('move-in-left', 100, 100, 8, 'enter'), { x: 0, y: 0, opacity: 1 });
  assert.deepEqual(prototypeOverlayMotion('dissolve', 100, 100, -4, 'enter'), { x: 0, y: 0, opacity: 0 });
  assert.deepEqual(prototypeOverlayMotion('dissolve', 100, 100, 8, 'exit'), { x: 0, y: 0, opacity: 0 });
});

test('legacy move names keep their Move In direction convention', () => {
  assert.deepEqual(prototypeOverlayMotion('move-right', 320, 200, 0, 'enter'), { x: -1, y: 0, opacity: 1 });
  assert.deepEqual(prototypeOverlayMotion('move-up', 320, 200, 1, 'exit'), { x: 0, y: -1, opacity: 1 });
});

test('overlay dismissal reverses the stored entrance transition and direction', () => {
  assert.equal(reversePrototypeOverlayTransition('dissolve'), 'dissolve');
  assert.equal(reversePrototypeOverlayTransition('move-in-left'), 'move-out-right');
  assert.equal(reversePrototypeOverlayTransition('push-up'), 'push-down');
  assert.equal(reversePrototypeOverlayTransition('slide-in-down'), 'slide-out-up');
  assert.equal(reversePrototypeOverlayTransition('slide-out-right'), 'slide-in-left');
  assert.equal(reversePrototypeOverlayTransition('move-left'), 'move-out-right');
  assert.throws(() => reversePrototypeOverlayTransition('smart-animate'), /unsupported overlay transition/i);
});

test('malformed transitions, roles, viewport geometry, and progress are rejected', () => {
  for (const value of ['', null, 'smart-animate', 'push-diagonal', 'slide-left']) {
    assert.throws(() => prototypeOverlayMotion(value, 320, 200, 0.5), /supported directional transition/);
  }
  assert.throws(() => prototypeOverlayMotion('dissolve', 0, 200, 0.5), /dimensions must be finite and positive/);
  assert.throws(() => prototypeOverlayMotion('dissolve', 320, Infinity, 0.5), /dimensions must be finite and positive/);
  assert.throws(() => prototypeOverlayMotion('dissolve', 320, 200, NaN), /progress must be finite/);
  assert.throws(() => prototypeOverlayMotion('dissolve', 320, 200, 0.5, 'background'), /role must be enter or exit/);
});
