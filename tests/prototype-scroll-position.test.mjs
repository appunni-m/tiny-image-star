import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFixedPositionWhenScrolling,
  isScrollableFrame,
  presentationChildrenInPaintOrder,
  scrollOffsetForPresentationChild
} from '../src/prototype-scroll-position.js';

test('fixed scroll positioning applies only to direct children of scrolling frames', () => {
  const frame = { type: 'frame', overflowBehavior: 'vertical' };
  const fixed = { id: 'fixed', fixedPositionWhenScrolling: true };
  const ordinary = { id: 'ordinary' };
  assert.equal(isScrollableFrame(frame), true);
  assert.equal(isFixedPositionWhenScrolling(fixed, frame), true);
  assert.equal(isFixedPositionWhenScrolling(fixed, { type: 'frame', overflowBehavior: 'none' }), false);
  assert.equal(isFixedPositionWhenScrolling(fixed, { type: 'group', overflowBehavior: 'vertical' }), false);
  assert.equal(isFixedPositionWhenScrolling(fixed, { ...frame, autoLayout: { axis: 'vertical' } }), false,
    'flow children of auto layout cannot be fixed');
  assert.equal(isFixedPositionWhenScrolling({ ...fixed, layoutPositioning: 'absolute' }, { ...frame, autoLayout: { axis: 'vertical' } }), true,
    'absolute auto-layout children can be fixed');
  assert.deepEqual(scrollOffsetForPresentationChild(frame, fixed, { x: 4, y: 8 }), { x: 0, y: 0 });
  assert.deepEqual(scrollOffsetForPresentationChild(frame, ordinary, { x: 4, y: 8 }), { x: 4, y: 8 });
});

test('fixed children paint above scrolling children without changing saved sibling order', () => {
  const fixedA = { id: 'fixed-a', fixedPositionWhenScrolling: true };
  const flowA = { id: 'flow-a' };
  const fixedB = { id: 'fixed-b', fixedPositionWhenScrolling: true };
  const frame = { type: 'frame', overflowBehavior: 'both', children: [fixedA, flowA, fixedB] };
  assert.deepEqual(presentationChildrenInPaintOrder(frame), [flowA, fixedA, fixedB]);
  assert.deepEqual(frame.children, [fixedA, flowA, fixedB], 'presentation ordering does not mutate document order');
  assert.deepEqual(presentationChildrenInPaintOrder({ ...frame, overflowBehavior: 'none' }), frame.children);
});
