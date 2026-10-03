import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeTransitionMotion } from '../src/prototype-transition.js';

test('move in and move out use the actual presentation viewport in the chosen travel direction', () => {
  assert.deepEqual(prototypeTransitionMotion('move-left', 300, 500, 0), {
    incoming: { x: 300, y: 0, opacity: 1 },
    outgoing: { x: 0, y: 0, opacity: 1 },
    front: 'incoming'
  }, 'legacy move-left remains a Move In from the right');
  assert.deepEqual(prototypeTransitionMotion('move-in-down', 300, 500, .5).incoming, {
    x: 0, y: -250, opacity: 1
  });
  assert.deepEqual(prototypeTransitionMotion('move-out-up', 300, 500, 1).outgoing, {
    x: 0, y: -500, opacity: 1
  });
});

test('all horizontal and vertical directions preserve the correct viewport axis', () => {
  const cases = [
    { direction: 'left', x: -1, y: 0 },
    { direction: 'right', x: 1, y: 0 },
    { direction: 'up', x: 0, y: -1 },
    { direction: 'down', x: 0, y: 1 }
  ];
  const width = 800;
  const height = 600;
  const along = (direction, extent, progress = 1) => direction === 0 ? 0 : direction * extent * progress;
  for (const item of cases) {
    const moveIn = prototypeTransitionMotion(`move-in-${item.direction}`, width, height, 0);
    assert.deepEqual(moveIn.incoming, { x: along(-item.x, width), y: along(-item.y, height), opacity: 1 }, `Move In ${item.direction} begins one viewport away`);
    const moveOut = prototypeTransitionMotion(`move-out-${item.direction}`, width, height, 1);
    assert.deepEqual(moveOut.outgoing, { x: along(item.x, width), y: along(item.y, height), opacity: 1 }, `Move Out ${item.direction} exits on its selected axis`);
    const push = prototypeTransitionMotion(`push-${item.direction}`, width, height, .5);
    assert.deepEqual(push.incoming, { x: along(-item.x, width, .5), y: along(-item.y, height, .5), opacity: 1 });
    assert.deepEqual(push.outgoing, { x: along(item.x, width, .5), y: along(item.y, height, .5), opacity: 1 });
    const slideIn = prototypeTransitionMotion(`slide-in-${item.direction}`, width, height, .5);
    assert.deepEqual(slideIn.incoming, { x: along(-item.x, width, .5), y: along(-item.y, height, .5), opacity: 1 });
    assert.equal(slideIn.outgoing.opacity, .5);
    const slideOut = prototypeTransitionMotion(`slide-out-${item.direction}`, width, height, .5);
    assert.deepEqual(slideOut.outgoing, { x: along(item.x, width, .5), y: along(item.y, height, .5), opacity: .5 });
  }
});

test('push moves the old and new frames together while preserving their viewport-sized separation', () => {
  const start = prototypeTransitionMotion('push-left', 800, 600, 0);
  assert.deepEqual(start.incoming, { x: 800, y: 0, opacity: 1 });
  assert.deepEqual(start.outgoing, { x: 0, y: 0, opacity: 1 });
  const middle = prototypeTransitionMotion('push-left', 800, 600, .5);
  assert.deepEqual(middle.incoming, { x: 400, y: 0, opacity: 1 });
  assert.deepEqual(middle.outgoing, { x: -400, y: 0, opacity: 1 });
  const end = prototypeTransitionMotion('push-left', 800, 600, 1);
  assert.deepEqual(end.incoming, { x: 0, y: 0, opacity: 1 });
  assert.deepEqual(end.outgoing, { x: -800, y: 0, opacity: 1 });
});

test('slide in and slide out pair movement with a crossfade of the outgoing frame', () => {
  const slideIn = prototypeTransitionMotion('slide-in-right', 320, 700, .25);
  assert.deepEqual(slideIn.incoming, { x: -240, y: 0, opacity: 1 });
  assert.deepEqual(slideIn.outgoing, { x: 0, y: 0, opacity: .75 });
  assert.equal(slideIn.front, 'outgoing');
  const slideOut = prototypeTransitionMotion('slide-out-left', 320, 700, .5);
  assert.deepEqual(slideOut.incoming, { x: 0, y: 0, opacity: 1 });
  assert.deepEqual(slideOut.outgoing, { x: -160, y: 0, opacity: .5 });
  assert.equal(slideOut.front, 'outgoing');
});

test('dissolve fades the new frame over a stationary old frame', () => {
  const start = prototypeTransitionMotion('dissolve', 320, 700, 0);
  assert.equal(start.incoming.opacity, 0);
  assert.deepEqual(start.outgoing, { x: 0, y: 0, opacity: 1 });
  assert.equal(prototypeTransitionMotion('dissolve', 320, 700, .4).incoming.opacity, .4);
  assert.equal(prototypeTransitionMotion('dissolve', 320, 700, 1.2).incoming.opacity, 1);
});

test('unsupported transitions stay still and invalid geometry fails before animation', () => {
  assert.deepEqual(prototypeTransitionMotion('smart-animate', 320, 700, .5), {
    incoming: { x: 0, y: 0, opacity: 1 },
    outgoing: { x: 0, y: 0, opacity: 1 },
    front: 'incoming'
  });
  assert.throws(() => prototypeTransitionMotion('push-left', 0, 700, .5), /dimensions must be finite and positive/);
  assert.throws(() => prototypeTransitionMotion('push-left', 320, Number.NaN, .5), /dimensions must be finite and positive/);
  assert.throws(() => prototypeTransitionMotion('push-left', 320, 700, Number.NaN), /progress must be finite/);
});
