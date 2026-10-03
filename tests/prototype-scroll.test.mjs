import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addNode, createDocument, createNode } from '../src/model.js';
import { planPrototypeScrollTo } from '../src/prototype-scroll.js';
const editorSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function documentWithScrollFrame({ width = 100, height = 100, behavior = 'vertical' } = {}) {
  const document = createDocument();
  const viewport = createNode('frame', { name: 'Scrollable viewport', width, height, overflowBehavior: behavior });
  addNode(document, viewport);
  return { document, viewport };
}

test('scroll-to nearest preserves visible targets and reveals targets below the viewport', () => {
  const { document, viewport } = documentWithScrollFrame();
  const visible = createNode('rectangle', { x: 10, y: 20, width: 20, height: 20 });
  const target = createNode('rectangle', { x: 10, y: 240, width: 30, height: 20 });
  viewport.children.push(visible, target);

  const alreadyVisible = planPrototypeScrollTo(document, visible.id);
  assert.deepEqual(alreadyVisible.updates, []);
  assert.equal(alreadyVisible.offsets.has(viewport.id), false);

  const reveal = planPrototypeScrollTo(document, target.id);
  assert.deepEqual(reveal.updates, [{ frameId: viewport.id, from: { x: 0, y: 0 }, to: { x: 0, y: 160 } }]);
  assert.equal(reveal.offsets.get(viewport.id).y, 160);
  assert.equal(reveal.offsets.has('unrelated-frame'), false);
});

test('scroll-to supports explicit alignment, margins, and content-range clamping', () => {
  const { document, viewport } = documentWithScrollFrame();
  const target = createNode('rectangle', { x: 0, y: 180, width: 20, height: 20 });
  const finalContent = createNode('rectangle', { x: 0, y: 380, width: 20, height: 20 });
  viewport.children.push(target, finalContent);
  const offsets = new Map([[viewport.id, { x: 0, y: 40 }]]);

  const start = planPrototypeScrollTo(document, target.id, { currentOffsets: offsets, alignment: 'start', margin: 12 });
  assert.equal(start.offsets.get(viewport.id).y, 168);
  const center = planPrototypeScrollTo(document, target.id, { alignment: 'center' });
  assert.equal(center.offsets.get(viewport.id).y, 140);
  const end = planPrototypeScrollTo(document, target.id, { alignment: 'end' });
  assert.equal(end.offsets.get(viewport.id).y, 100);

  const atEnd = planPrototypeScrollTo(document, finalContent.id, {
    currentOffsets: new Map([[viewport.id, { x: 0, y: 999 }]]), alignment: 'start'
  });
  assert.equal(atEnd.offsets.get(viewport.id).y, 300, 'the maximum is the last visible-content pixel');
  assert.equal(offsets.get(viewport.id).y, 40, 'planning leaves the caller-owned offsets unchanged');
});

test('nested scroll-to reveals inner content before adjusting its outer viewport', () => {
  const { document, viewport: outer } = documentWithScrollFrame({ width: 200, height: 100 });
  const inner = createNode('frame', { name: 'Inner scroller', x: 0, y: 150, width: 100, height: 100, overflowBehavior: 'vertical' });
  const target = createNode('rectangle', { x: 10, y: 150, width: 40, height: 20 });
  inner.children.push(target, createNode('rectangle', { x: 0, y: 300, width: 20, height: 20 }));
  outer.children.push(inner, createNode('rectangle', { x: 0, y: 300, width: 10, height: 10 }));

  const plan = planPrototypeScrollTo(document, target.id, { alignment: 'start' });
  assert.deepEqual(plan.updates.map(update => update.frameId), [inner.id, outer.id]);
  assert.deepEqual(plan.offsets.get(inner.id), { x: 0, y: 150 });
  assert.deepEqual(plan.offsets.get(outer.id), { x: 0, y: 150 });
});

test('an explicit target frame scopes scrolling while still accounting for nested viewports', () => {
  const { document, viewport: outer } = documentWithScrollFrame({ width: 200, height: 100 });
  const inner = createNode('frame', { name: 'Anchor viewport', x: 0, y: 150, width: 100, height: 100, overflowBehavior: 'vertical' });
  const target = createNode('rectangle', { x: 10, y: 150, width: 40, height: 20 });
  inner.children.push(target, createNode('rectangle', { x: 0, y: 300, width: 20, height: 20 }));
  outer.children.push(inner, createNode('rectangle', { x: 0, y: 300, width: 10, height: 10 }));

  const plan = planPrototypeScrollTo(document, target.id, { targetFrameId: inner.id, alignment: 'start' });
  assert.deepEqual(plan.updates.map(update => update.frameId), [inner.id]);
  assert.equal(plan.targetFrameId, inner.id);
  const unrelated = createNode('frame', { overflowBehavior: 'vertical' });
  addNode(document, unrelated);
  assert.throws(() => planPrototypeScrollTo(document, target.id, { targetFrameId: unrelated.id }), /scrollable ancestor frame/,
    'an explicit frame must contain the layer and be scrollable');
});

test('the active prototype screen scopes scrolling without requiring the screen itself to scroll', () => {
  const { document, viewport: outer } = documentWithScrollFrame({ width: 200, height: 100 });
  const screen = createNode('frame', { name: 'Nested presentation screen', x: 0, y: 150, width: 160, height: 90 });
  const scroller = createNode('frame', { name: 'Screen content', width: 120, height: 80, overflowBehavior: 'vertical' });
  const target = createNode('rectangle', { name: 'Nested target', x: 8, y: 220, width: 20, height: 20 });
  scroller.children.push(target, createNode('rectangle', { x: 0, y: 360, width: 10, height: 10 }));
  screen.children.push(scroller);
  outer.children.push(screen, createNode('rectangle', { x: 0, y: 400, width: 10, height: 10 }));

  const plan = planPrototypeScrollTo(document, target.id, { screenFrameId: screen.id, alignment: 'start' });
  assert.deepEqual(plan.updates.map(update => update.frameId), [scroller.id]);
  assert.equal(plan.offsets.has(outer.id), false, 'scrolling above the active screen must not change its hidden parent');
  const outside = outer.children.at(-1);
  assert.throws(() => planPrototypeScrollTo(document, outside.id, { screenFrameId: screen.id }), /active prototype screen/);
});

test('scroll-to uses resolved transforms and bounds a rotated target', () => {
  const { document, viewport } = documentWithScrollFrame({ width: 120, height: 100, behavior: 'both' });
  const target = createNode('rectangle', { x: 220, y: 140, width: 40, height: 20, rotation: 90 });
  viewport.children.push(target, createNode('rectangle', { x: 400, y: 400, width: 10, height: 10 }));

  const plan = planPrototypeScrollTo(document, target.id, { alignment: 'start' });
  assert.deepEqual(plan.offsets.get(viewport.id), { x: 230, y: 130 });
});

test('scroll-to rejects stale targets, invalid alignment, and invalid current offset containers', () => {
  const { document } = documentWithScrollFrame();
  const target = createNode('rectangle');
  addNode(document, target);
  assert.throws(() => planPrototypeScrollTo(document, 'missing-layer'), /no longer exists/);
  assert.throws(() => planPrototypeScrollTo(document, target.id, { alignment: 'top' }), /Unsupported prototype scroll alignment/);
  assert.throws(() => planPrototypeScrollTo(document, target.id, { currentOffsets: {} }), /must be a Map/);
  assert.throws(() => planPrototypeScrollTo(document, target.id, { margin: -1 }), /non-negative/);
});

test('scroll-to leaves fixed targets visible and the Prototype inspector exposes fixed positioning', () => {
  const { document, viewport } = documentWithScrollFrame();
  const fixed = createNode('rectangle', { fixedPositionWhenScrolling: true, y: 10, width: 30, height: 20 });
  const scrolling = createNode('rectangle', { y: 360, width: 30, height: 20 });
  viewport.children.push(fixed, scrolling);
  const currentOffsets = new Map([[viewport.id, { x: 0, y: 80 }]]);
  const plan = planPrototypeScrollTo(document, fixed.id, { currentOffsets });
  assert.deepEqual(plan.updates, [], 'a fixed target is already visible and does not scroll its parent');
  assert.deepEqual(plan.offsets.get(viewport.id), { x: 0, y: 80 });

  const start = editorSource.indexOf('function fixedScrollPositionSection');
  const end = editorSource.indexOf('function inspectPanel()', start);
  assert.ok(start >= 0 && end > start, 'the Prototype inspector must render fixed-position controls');
  const section = editorSource.slice(start, end);
  assert.ok(section.includes('isScrollableFrame(parent)'));
  assert.ok(section.includes('data-prop="fixedPositionWhenScrolling"'));
  assert.ok(section.includes("parent.autoLayout && node.layoutPositioning !== 'absolute'"));
});
