import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFixedPositionWhenScrolling,
  isStickyPositionWhenScrolling,
  isScrollableFrame,
  presentationChildrenInPaintOrder,
  scrollPositionForNode,
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

test('sticky direct children follow the scroll until they pin at the top edge', () => {
  const frame = { type: 'frame', overflowBehavior: 'vertical', height: 120 };
  const sticky = { id: 'sticky', scrollPosition: 'sticky', x: 14, y: 80, width: 40, height: 20 };
  const ordinary = { id: 'ordinary', x: 14, y: 80, width: 40, height: 20 };

  assert.equal(scrollPositionForNode(sticky), 'sticky');
  assert.equal(scrollPositionForNode({ fixedPositionWhenScrolling: true }), 'fixed',
    'legacy fixed-position documents keep their existing behavior');
  assert.equal(scrollPositionForNode({ scrollPosition: 'scroll', fixedPositionWhenScrolling: true }), 'scroll',
    'an explicit Scroll setting takes precedence over the legacy fixed flag');
  assert.equal(isStickyPositionWhenScrolling(sticky, frame), true);
  assert.equal(isStickyPositionWhenScrolling(sticky, { ...frame, overflowBehavior: 'horizontal' }), false);
  assert.equal(isStickyPositionWhenScrolling(sticky, { type: 'group', overflowBehavior: 'vertical' }), false);

  assert.deepEqual(scrollOffsetForPresentationChild(frame, sticky, { x: 7, y: 40 }), { x: 7, y: 40 },
    'before reaching the frame top, Sticky follows the ordinary scroll offset');
  assert.deepEqual(scrollOffsetForPresentationChild(frame, sticky, { x: 7, y: 80 }), { x: 7, y: 80 },
    'at its sticky threshold, its top edge aligns with the frame top');
  assert.deepEqual(scrollOffsetForPresentationChild(frame, sticky, { x: 7, y: 180 }), { x: 7, y: 80 },
    'after pinning, additional vertical scroll does not move the sticky child');
  assert.deepEqual(scrollOffsetForPresentationChild(frame, ordinary, { x: 7, y: 180 }), { x: 7, y: 180 });
});

test('nested sticky layers pin at the scroller edge and are pushed out by their direct parent', () => {
  const frame = { id: 'scroll', type: 'frame', x: 0, y: 0, width: 200, height: 100, overflowBehavior: 'vertical' };
  const parent = { id: 'parent', type: 'group', x: 0, y: 30, width: 120, height: 140 };
  const sticky = { id: 'sticky', scrollPosition: 'sticky', x: 0, y: 40, width: 80, height: 20 };
  const contextAt = y => ({ frame, ancestors: [], offset: { x: 0, y } });

  assert.deepEqual(scrollOffsetForPresentationChild(parent, sticky, { x: 0, y: 0 }, contextAt(50), []), { x: 0, y: 0 },
    'nested sticky content follows its parent before reaching the viewport top');
  assert.deepEqual(scrollOffsetForPresentationChild(parent, sticky, { x: 0, y: 0 }, contextAt(70), []), { x: 0, y: 0 },
    'the sticky threshold is the scroller top');
  assert.deepEqual(scrollOffsetForPresentationChild(parent, sticky, { x: 0, y: 0 }, contextAt(90), []), { x: 0, y: -20 },
    'the child receives the translation needed to remain pinned');
  assert.deepEqual(scrollOffsetForPresentationChild(parent, sticky, { x: 0, y: 0 }, contextAt(160), []), { x: 0, y: -80 },
    'the sticky child moves with its direct parent once the parent bottom reaches it');
});

test('nested sticky compensation converts scroller-space motion through rotated direct parents', () => {
  const frame = { id: 'scroll', type: 'frame', x: 0, y: 0, width: 300, height: 100, overflowBehavior: 'vertical' };
  const parent = { id: 'parent', type: 'group', x: 0, y: 30, width: 120, height: 140, rotation: 90 };
  const sticky = { id: 'sticky', scrollPosition: 'sticky', x: 30, y: 50, width: 20, height: 20 };
  const effective = scrollOffsetForPresentationChild(parent, sticky, { x: 0, y: 0 }, {
    frame, ancestors: [], offset: { x: 0, y: 90 }
  }, []);

  assert.ok(Math.abs(effective.x + 20) < 1e-9,
    'vertical movement in the scroll frame maps to the parent’s local horizontal axis');
  assert.ok(Math.abs(effective.y) < 1e-9);
});

test('sticky layers retain authored paint order while fixed layers paint above scrolling siblings', () => {
  const sticky = { id: 'sticky', scrollPosition: 'sticky' };
  const fixed = { id: 'fixed', scrollPosition: 'fixed' };
  const flow = { id: 'flow' };
  const frame = { type: 'frame', overflowBehavior: 'vertical', children: [sticky, fixed, flow] };
  assert.deepEqual(presentationChildrenInPaintOrder(frame), [sticky, flow, fixed]);
  assert.deepEqual(frame.children, [sticky, fixed, flow], 'presentation order does not mutate saved sibling order');
});
