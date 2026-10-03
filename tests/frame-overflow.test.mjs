import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, bindVariable, createDocument, createNode, createVariable, createVariableCollection,
  parseDocument, serializeDocument, validateDocument
} from '../src/model.js';
import {
  applyPresentationScrollOffset, clipNodeContents, getPresentationScrollOffset, hitTestPage,
  scrollableFramePathAtPagePoint
} from '../src/renderer.js';

test('frame overflow behavior defaults safely and persists across local document reload', () => {
  const document = createDocument();
  const frame = createNode('frame', { overflowBehavior: 'vertical' });
  addNode(document, frame);
  assert.equal(createNode('frame').overflowBehavior, 'none');
  assert.equal(validateDocument(document), true);

  const restored = parseDocument(serializeDocument(document));
  assert.equal(restored.pages[0].children[0].overflowBehavior, 'vertical');
  assert.equal(validateDocument(restored), true);

  const legacy = structuredClone(restored);
  delete legacy.pages[0].children[0].overflowBehavior;
  assert.equal(validateDocument(legacy), true, 'documents authored before overflow behavior remain valid');

  for (const behavior of ['diagonal', '', null]) {
    const invalid = structuredClone(restored);
    invalid.pages[0].children[0].overflowBehavior = behavior;
    assert.throws(() => validateDocument(invalid), /Invalid frame overflow behavior/);
  }

  const nonFrame = createDocument();
  addNode(nonFrame, createNode('rectangle', { overflowBehavior: 'vertical' }));
  assert.throws(() => validateDocument(nonFrame), /Invalid frame overflow behavior/);
});

test('fixed scroll-position metadata validates and survives local document reload', () => {
  const document = createDocument();
  const frame = createNode('frame', { overflowBehavior: 'vertical' });
  const fixed = createNode('rectangle', { fixedPositionWhenScrolling: true });
  addNode(document, frame);
  addNode(document, fixed, { parentId: frame.id });
  assert.equal(validateDocument(document), true);
  const restored = parseDocument(serializeDocument(document));
  assert.equal(restored.pages[0].children[0].children[0].fixedPositionWhenScrolling, true);
  assert.equal(validateDocument(restored), true);
  const invalid = structuredClone(restored);
  invalid.pages[0].children[0].children[0].fixedPositionWhenScrolling = 'yes';
  assert.throws(() => validateDocument(invalid), /Invalid fixed scroll position/);
});

test('scroll position enums validate and survive local document reload', () => {
  const document = createDocument();
  const frame = createNode('frame', { overflowBehavior: 'vertical' });
  const sticky = createNode('rectangle', { scrollPosition: 'sticky' });
  addNode(document, frame);
  addNode(document, sticky, { parentId: frame.id });
  assert.equal(validateDocument(document), true);

  const restored = parseDocument(serializeDocument(document));
  assert.equal(restored.pages[0].children[0].children[0].scrollPosition, 'sticky');
  assert.equal(validateDocument(restored), true);

  const invalid = structuredClone(restored);
  invalid.pages[0].children[0].children[0].scrollPosition = 'float';
  assert.throws(() => validateDocument(invalid), /Invalid scroll position/);
});

test('scrollable frames clip children while default clipping behavior is preserved', () => {
  const calls = [];
  const context = {
    beginPath() { calls.push(['beginPath']); },
    rect(...args) { calls.push(['rect', ...args]); },
    clip() { calls.push(['clip']); }
  };

  const scrollFrame = createNode('frame', {
    x: 10, y: 20, width: 180, height: 120, clip: false, overflowBehavior: 'horizontal'
  });
  assert.equal(clipNodeContents(context, scrollFrame, 10, 20), true);
  assert.deepEqual(calls, [['beginPath'], ['rect', 10, 20, 180, 120], ['clip']]);

  calls.length = 0;
  assert.equal(clipNodeContents(context, createNode('frame'), 0, 0), true,
    'ordinary frames continue to clip by their existing clip flag');
  assert.equal(calls.at(-1)[0], 'clip');

  calls.length = 0;
  assert.equal(clipNodeContents(context, createNode('section'), 0, 0), false);
  assert.deepEqual(calls, []);
});

test('presentation offsets are frame-scoped, axis-limited, and translate only frame contents', () => {
  const offsets = new Map([
    ['vertical-frame', { x: 18, y: 75 }],
    ['horizontal-frame', { x: 42, y: 31 }],
    ['both-frame', { x: 11, y: 23 }],
    ['none-frame', { x: 7, y: 9 }]
  ]);
  const state = { presentationScrollOffsets: offsets };
  const vertical = { id: 'vertical-frame', type: 'frame', overflowBehavior: 'vertical' };
  const horizontal = { id: 'horizontal-frame', type: 'frame', overflowBehavior: 'horizontal' };
  const both = { id: 'both-frame', type: 'frame', overflowBehavior: 'both' };
  const none = { id: 'none-frame', type: 'frame', overflowBehavior: 'none' };

  assert.deepEqual(getPresentationScrollOffset(state, vertical), { x: 0, y: 75 });
  assert.deepEqual(getPresentationScrollOffset(state, horizontal), { x: 42, y: 0 });
  assert.deepEqual(getPresentationScrollOffset(state, both), { x: 11, y: 23 });
  assert.deepEqual(getPresentationScrollOffset(state, none), { x: 0, y: 0 });
  assert.deepEqual(getPresentationScrollOffset({ presentationScrollOffsets: { 'both-frame': { x: 1, y: 2 } } }, both), { x: 0, y: 0 },
    'only the explicit presentation Map API is consumed');

  const translations = [];
  const context = { translate(...args) { translations.push(args); } };
  assert.deepEqual(applyPresentationScrollOffset(context, state, vertical), { x: 0, y: 75 });
  assert.deepEqual(translations, [[0, -75]]);
  applyPresentationScrollOffset(context, state, none);
  assert.deepEqual(translations, [[0, -75]], 'non-scrollable frames leave child drawing in place');
});

test('presentation hit testing follows scrolled children but keeps the frame viewport fixed', () => {
  const document = createDocument();
  const frame = createNode('frame', {
    x: 10, y: 20, width: 100, height: 100, clip: false, overflowBehavior: 'vertical'
  });
  const child = createNode('rectangle', { x: 15, y: 120, width: 30, height: 20 });
  addNode(document, frame);
  addNode(document, child, { parentId: frame.id });
  const offsets = new Map([[frame.id, { x: 0, y: 100 }]]);

  assert.equal(hitTestPage(document.pages[0], { x: 30, y: 45 }, null, document, offsets)?.id, child.id,
    'the child hit region moves with the rendered child contents');
  assert.equal(hitTestPage(document.pages[0], { x: 30, y: 145 }, null, document, offsets), null,
    'content outside the fixed scroll viewport cannot receive hits');
  assert.equal(hitTestPage(document.pages[0], { x: 30, y: 45 }, null, document)?.id, frame.id,
    'without presentation offsets existing document hit testing is unchanged');
});

test('fixed children stay in the viewport, paint above scrolling siblings, and remain hit-testable', () => {
  const document = createDocument();
  const frame = createNode('frame', {
    id: 'fixed-scroll-frame', x: 10, y: 20, width: 100, height: 100,
    clip: false, overflowBehavior: 'vertical'
  });
  const fixed = createNode('rectangle', {
    id: 'fixed-header', x: 10, y: 10, width: 80, height: 30,
    fixedPositionWhenScrolling: true
  });
  const scrolling = createNode('rectangle', { id: 'scrolling-layer', x: 10, y: 45, width: 80, height: 30 });
  const lower = createNode('rectangle', { id: 'lower-content', x: 10, y: 110, width: 80, height: 20 });
  addNode(document, frame);
  addNode(document, fixed, { parentId: frame.id });
  addNode(document, scrolling, { parentId: frame.id });
  addNode(document, lower, { parentId: frame.id });
  const offsets = new Map([[frame.id, { x: 0, y: 40 }]]);

  assert.equal(hitTestPage(document.pages[0], { x: 25, y: 35 }, null, document, offsets)?.id, fixed.id,
    'the fixed header stays at its original position and wins over overlapping scrolled content');
  assert.equal(hitTestPage(document.pages[0], { x: 25, y: 95 }, null, document, offsets)?.id, lower.id,
    'ordinary siblings still follow the frame scroll offset');
  const path = scrollableFramePathAtPagePoint(document.pages[0], { x: 25, y: 35 }, null, document, offsets);
  assert.deepEqual(path.map(entry => entry.frame.id), [frame.id],
    'the fixed layer remains within its parent scroll viewport');
  assert.deepEqual(path[0].local, { x: 15, y: 15 });
});

test('sticky children pin to the top of their scrolled frame and remain hit-testable', () => {
  const document = createDocument();
  const frame = createNode('frame', {
    id: 'sticky-scroll-frame', x: 10, y: 20, width: 100, height: 100,
    clip: false, overflowBehavior: 'vertical'
  });
  const sticky = createNode('rectangle', {
    id: 'sticky-header', x: 10, y: 80, width: 80, height: 20, scrollPosition: 'sticky'
  });
  const scrolling = createNode('rectangle', { id: 'scrolling-layer', x: 10, y: 120, width: 80, height: 30 });
  addNode(document, frame);
  addNode(document, sticky, { parentId: frame.id });
  addNode(document, scrolling, { parentId: frame.id });

  assert.equal(hitTestPage(document.pages[0], { x: 25, y: 30 }, null, document,
    new Map([[frame.id, { x: 0, y: 180 }]]))?.id, sticky.id,
  'the sticky hit target remains at the frame top even after scrolling beyond its original position');
  assert.equal(hitTestPage(document.pages[0], { x: 25, y: 30 }, null, document,
    new Map([[frame.id, { x: 0, y: 40 }]]))?.id, frame.id,
  'before reaching the sticky threshold, the child continues to scroll with the frame');
});

test('nested sticky children stay pinned until their direct parent reaches the scroller edge', () => {
  const document = createDocument();
  const scroller = createNode('frame', {
    id: 'nested-sticky-scroller', x: 10, y: 20, width: 100, height: 100,
    clip: false, overflowBehavior: 'vertical'
  });
  const parent = createNode('group', { id: 'nested-sticky-parent', x: 5, y: 30, width: 80, height: 120 });
  const sticky = createNode('rectangle', {
    id: 'nested-sticky-layer', x: 5, y: 40, width: 50, height: 20, scrollPosition: 'sticky'
  });
  parent.children.push(sticky);
  scroller.children.push(parent);
  addNode(document, scroller);

  const offsets = new Map([[scroller.id, { x: 0, y: 90 }]]);
  assert.equal(hitTestPage(document.pages[0], { x: 30, y: 25 }, null, document, offsets)?.id, sticky.id,
    'the nested layer is hittable at the scroller top after its natural position has moved above the viewport');
  const path = scrollableFramePathAtPagePoint(document.pages[0], { x: 30, y: 25 }, null, document, offsets);
  assert.deepEqual(path.map(entry => entry.frame.id), [scroller.id]);

  const afterParentLeaves = new Map([[scroller.id, { x: 0, y: 160 }]]);
  assert.notEqual(hitTestPage(document.pages[0], { x: 30, y: 25 }, null, document, afterParentLeaves)?.id, sticky.id,
    'the sticky layer leaves with its direct parent once the parent bottom passes the scroller top');
});

test('presentation hit testing keeps nested rounded clips aligned after an outer frame scrolls', () => {
  const document = createDocument();
  const outer = createNode('frame', {
    x: 10, y: 20, width: 100, height: 100, clip: false, overflowBehavior: 'vertical'
  });
  const inner = createNode('frame', { x: 10, y: 120, width: 60, height: 50, radius: 8 });
  const child = createNode('rectangle', { x: 0, y: 5, width: 50, height: 30 });
  addNode(document, outer);
  addNode(document, inner, { parentId: outer.id });
  addNode(document, child, { parentId: inner.id });
  const offsets = new Map([[outer.id, { x: 0, y: 100 }]]);

  assert.equal(hitTestPage(document.pages[0], { x: 35, y: 55 }, null, document, offsets)?.id, child.id);
});

test('scrollable frame path follows variable geometry and accumulated outer scroll offsets', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Prototype geometry');
  const innerY = createVariable(document, collection.id, 'Nested frame Y', 'number', 120);
  const outer = createNode('frame', {
    x: 10, y: 20, width: 100, height: 100, clip: false, overflowBehavior: 'vertical'
  });
  const inner = createNode('frame', {
    x: 10, y: 0, width: 60, height: 80, overflowBehavior: 'both'
  });
  const child = createNode('rectangle', { x: 5, y: 10, width: 20, height: 20 });
  addNode(document, outer);
  addNode(document, inner, { parentId: outer.id });
  addNode(document, child, { parentId: inner.id });
  assert.equal(bindVariable(document, inner.id, innerY.id, 'y'), true);
  const offsets = new Map([[outer.id, { x: 0, y: 100 }]]);

  const path = scrollableFramePathAtPagePoint(document.pages[0], { x: 30, y: 55 }, null, document, offsets);
  assert.deepEqual(path.map(entry => entry.frame.id), [inner.id, outer.id],
    'nested candidates are returned before their scrollable ancestors');
  assert.deepEqual(path[0].ancestors.map(ancestor => ancestor.id), [outer.id]);
  assert.deepEqual(path[0].local, { x: 10, y: 15 });
  assert.deepEqual([path[0].frame.x, path[0].frame.y], [10, 20],
    'frame geometry uses the variable-resolved Y and applies the outer scroll offset');
  assert.deepEqual(path[1].ancestors, []);
  assert.deepEqual(path[1].local, { x: 20, y: 35 });

  assert.deepEqual(scrollableFramePathAtPagePoint(document.pages[0], { x: 30, y: 145 }, null, document), [],
    'children beyond the outer clipping viewport do not create scroll candidates');
});

test('scrollable frame path respects hidden frames and rounded ancestor viewport clips', () => {
  const document = createDocument();
  const outer = createNode('frame', {
    x: 10, y: 20, width: 100, height: 100, radius: 18, clip: false, overflowBehavior: 'vertical'
  });
  const inner = createNode('frame', {
    x: 10, y: 10, width: 60, height: 60, overflowBehavior: 'horizontal'
  });
  addNode(document, outer);
  addNode(document, inner, { parentId: outer.id });

  assert.deepEqual(scrollableFramePathAtPagePoint(document.pages[0], { x: 11, y: 21 }, null, document), [],
    'a pointer in the rounded outer corner is outside the visible clip');

  inner.visible = false;
  const path = scrollableFramePathAtPagePoint(document.pages[0], { x: 35, y: 45 }, null, document);
  assert.deepEqual(path.map(entry => entry.frame.id), [outer.id],
    'hidden nested frames cannot contribute candidates');
});
