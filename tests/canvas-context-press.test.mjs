import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS_CONTEXT_PRESS_DELAY_MS,
  CANVAS_CONTEXT_PRESS_MOVE_TOLERANCE,
  createCanvasContextPressController,
  shouldArmCanvasContextPress
} from '../src/canvas-context-press.js';
import { CANVAS_TOUCH_DRAG_THRESHOLD_PX } from '../src/canvas-drag-slop.js';

function fakeTimers() {
  let nextId = 0;
  const timers = new Map();
  return {
    setTimer(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    run(id) {
      const timer = timers.get(id);
      assert.ok(timer, `timer ${id} is pending`);
      timers.delete(id);
      timer.callback();
    },
    entries() { return [...timers.entries()]; }
  };
}

test('context press is limited to touch or pen layer taps in Select mode', () => {
  for (const pointerType of ['touch', 'pen']) {
    assert.equal(shouldArmCanvasContextPress({ pointerType, tool: 'select', isLayerHit: true }), true);
  }
  for (const input of [
    { pointerType: 'mouse', tool: 'select', isLayerHit: true },
    { pointerType: 'touch', tool: 'comment', isLayerHit: true },
    { pointerType: 'pen', tool: 'frame', isLayerHit: true },
    { pointerType: 'touch', tool: 'select', isLayerHit: false },
    { pointerType: 'touch', tool: 'select', button: 2, isLayerHit: true }
  ]) assert.equal(shouldArmCanvasContextPress(input), false);
});

test('a stationary touch hold fires once with its layer target after the accessible delay', () => {
  const timers = fakeTimers();
  const controller = createCanvasContextPressController({
    setTimer: timers.setTimer, clearTimer: timers.clearTimer
  });
  const calls = [];
  controller.arm({ pointerId: 7, pointerType: 'touch', x: 30, y: 50, payload: { nodeId: 'image-1' } }, payload => calls.push(payload));
  const [[timerId, timer]] = timers.entries();
  assert.equal(timer.delay, CANVAS_CONTEXT_PRESS_DELAY_MS);
  assert.equal(controller.pendingPointerId, 7);
  timers.run(timerId);
  assert.deepEqual(calls, [{ nodeId: 'image-1' }]);
  assert.equal(controller.pendingPointerId, null);
  assert.equal(controller.finish(7), false);
});

test('movement beyond the drag slop cancels the context press without firing', () => {
  const timers = fakeTimers();
  const controller = createCanvasContextPressController({
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    moveTolerance: CANVAS_CONTEXT_PRESS_MOVE_TOLERANCE
  });
  let fired = false;
  controller.arm({ pointerId: 8, pointerType: 'pen', x: 10, y: 10 }, () => { fired = true; });
  assert.equal(controller.move({ pointerId: 9, x: 100, y: 100 }), false, 'another pointer cannot cancel this gesture');
  assert.equal(CANVAS_CONTEXT_PRESS_MOVE_TOLERANCE, CANVAS_TOUCH_DRAG_THRESHOLD_PX,
    'a touch movement that starts a drag must also cancel a pending context press');
  assert.equal(controller.move({ pointerId: 8, x: 18, y: 10 }), false, 'movement at the drag boundary remains a hold');
  assert.equal(controller.move({ pointerId: 8, x: 19, y: 10 }), true, 'movement beyond the drag boundary cancels the hold');
  assert.equal(timers.entries().length, 0);
  assert.equal(controller.pendingPointerId, null);
  assert.equal(fired, false);
});

test('pointer-up and a second pointer cancel a pending hold', () => {
  const timers = fakeTimers();
  const controller = createCanvasContextPressController({
    setTimer: timers.setTimer, clearTimer: timers.clearTimer
  });
  let fired = 0;
  controller.arm({ pointerId: 3, pointerType: 'touch', x: 0, y: 0 }, () => { fired += 1; });
  assert.equal(controller.finish(4), false);
  assert.equal(controller.finish(3), true);
  controller.arm({ pointerId: 5, pointerType: 'touch', x: 0, y: 0 }, () => { fired += 1; });
  assert.equal(controller.cancel(), true);
  assert.equal(timers.entries().length, 0);
  assert.equal(fired, 0);
});
