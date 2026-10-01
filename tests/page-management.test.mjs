import test from 'node:test';
import assert from 'node:assert/strict';
import { deletePage, duplicatePage, renamePage, reorderPage } from '../src/page-management.js';

function fixture() {
  return {
    activePageId: 'b',
    pages: [
      { id: 'a', name: 'Page', children: [] },
      { id: 'b', name: 'Page copy', children: [
        { id: 'frame-a', type: 'frame', name: 'A', children: [], interactions: [{ id: 'i', action: 'navigate', destinationId: 'frame-b', destinationPageId: 'b' }] },
        { id: 'frame-b', type: 'frame', name: 'B', children: [{ id: 'rect', type: 'rectangle', children: [] }] }
      ] },
      { id: 'c', name: 'Other', children: [] }
    ],
    comments: [{ id: 'cb', pageId: 'b' }, { id: 'ca', pageId: 'a' }],
    prototypeStartPoint: { pageId: 'b', nodeId: 'frame-b' }
  };
}

test('duplicatePage inserts a uniquely named deep copy, renews node ids and local prototype links', () => {
  const document = fixture();
  let counter = 0;
  const duplicate = duplicatePage(document, 'b', { createId: prefix => `${prefix}-new-${++counter}` });
  assert.equal(document.pages[2], duplicate);
  assert.equal(duplicate.name, 'Page copy 2');
  assert.notEqual(duplicate.id, 'b');
  const [first, second] = duplicate.children;
  assert.notEqual(first.id, 'frame-a');
  assert.notEqual(second.id, 'frame-b');
  assert.notEqual(second.children[0].id, 'rect');
  assert.equal(first.interactions[0].destinationId, second.id);
  assert.equal(first.interactions[0].destinationPageId, duplicate.id);
  assert.equal(document.activePageId, 'b');
  assert.equal(document.pages[1].children[0].id, 'frame-a');
});

test('duplicatePage remaps internal scroll-to anchors without changing the source page', () => {
  const document = fixture();
  const sourcePage = document.pages.find(page => page.id === 'b');
  const sourceFrame = sourcePage.children[0];
  const scroller = { id: 'scroll-frame', type: 'frame', overflowBehavior: 'vertical', children: [] };
  const hotspot = { id: 'scroll-hotspot', type: 'rectangle', children: [], interactions: [
    { id: 'scroll-interaction', action: 'scroll-to', scrollTargetId: 'scroll-target', scrollAlignment: 'center' }
  ] };
  const target = { id: 'scroll-target', type: 'text', children: [] };
  scroller.children.push(hotspot, target);
  sourceFrame.children.push(scroller);
  let counter = 0;

  const duplicate = duplicatePage(document, 'b', { createId: prefix => `${prefix}-scroll-${++counter}` });
  const copiedScroller = duplicate.children[0].children.find(node => node.id.startsWith('frame-scroll-'));
  const copiedHotspot = copiedScroller.children.find(node => node.type === 'rectangle');
  const copiedTarget = copiedScroller.children.find(node => node.type === 'text');

  assert.notEqual(copiedHotspot.id, hotspot.id);
  assert.notEqual(copiedTarget.id, target.id);
  assert.equal(copiedHotspot.interactions[0].scrollTargetId, copiedTarget.id);
  assert.equal(copiedHotspot.interactions[0].scrollAlignment, 'center');
  assert.equal(hotspot.interactions[0].scrollTargetId, target.id, 'the source route remains on the original page and keeps its original anchor');
});

test('duplicatePage deep-clones ruler guides and assigns new guide ids', () => {
  const document = fixture();
  const source = document.pages.find(page => page.id === 'b');
  source.guides = [
    { id: 'guide-x', axis: 'x', position: -12.5 },
    { id: 'guide-y', axis: 'y', position: 80 }
  ];
  const originalGuides = structuredClone(source.guides);
  let counter = 0;
  const duplicate = duplicatePage(document, 'b', { createId: prefix => `${prefix}-copy-${++counter}` });

  assert.deepEqual(source.guides, originalGuides);
  assert.equal(duplicate.guides.length, 2);
  assert.deepEqual(duplicate.guides.map(({ axis, position }) => ({ axis, position })), [
    { axis: 'x', position: -12.5 },
    { axis: 'y', position: 80 }
  ]);
  assert.ok(duplicate.guides.every(guide => guide.id.startsWith('guide-copy-')));
  assert.notEqual(duplicate.guides[0].id, source.guides[0].id);
  assert.notEqual(duplicate.guides[0], source.guides[0]);
  duplicate.guides[0].position = 4;
  assert.equal(source.guides[0].position, -12.5, 'editing a copied guide does not change the source page');
});

test('duplicatePage rejects invalid and duplicate generated ruler guide ids without inserting a partial page', () => {
  const makeDocument = () => ({ pages: [{ id: 'source', name: 'Source', children: [], guides: [
    { id: 'guide-a', axis: 'x', position: 10 },
    { id: 'guide-b', axis: 'y', position: 20 }
  ] }] });
  const idFactory = guideId => prefix => prefix === 'page' ? 'new-page'
    : prefix === 'guide' ? guideId
      : `${prefix}-copy`;

  for (const guideId of ['', '   ']) {
    const document = makeDocument();
    assert.throws(() => duplicatePage(document, 'source', { createId: idFactory(guideId) }), /Guide id factory/);
    assert.equal(document.pages.length, 1);
  }
  const document = makeDocument();
  assert.throws(() => duplicatePage(document, 'source', { createId: idFactory('same-guide') }), /Guide id factory/);
  assert.equal(document.pages.length, 1);
});

test('renamePage trims valid names and leaves invalid input unchanged', () => {
  const document = fixture();
  assert.equal(renamePage(document, 'b', '  Checkout  ').name, 'Checkout');
  assert.equal(renamePage(document, 'b', '   '), null);
  assert.equal(renamePage(document, 'missing', 'Name'), null);
  assert.equal(document.pages[1].name, 'Checkout');
});

test('deletePage protects the last page and repairs active page plus page-owned references', () => {
  const document = fixture();
  document.motion = { durationMs: 1000, tracks: [
    { id: 'deleted-page-track', nodeId: 'frame-b', property: 'x', keyframes: [] },
    { id: 'kept-page-track', nodeId: 'frame-a', property: 'y', keyframes: [] }
  ] };
  document.prototypeFlows = [
    { id: 'flow-b', name: 'Deleted page', pageId: 'b', nodeId: 'frame-b' },
    { id: 'flow-a', name: 'Kept page', pageId: 'a', nodeId: 'frame-a' }
  ];
  document.prototypeStartFlowId = 'flow-b';
  document.pages[0].children.push({ id: 'source', type: 'frame', children: [], interactions: [
    { id: 'to-b-explicit', action: 'navigate', destinationId: 'frame-b', destinationPageId: 'b' },
    { id: 'to-b-implicit', action: 'navigate', destinationId: 'frame-b' }
  ] });
  document.motion.tracks[1].nodeId = 'source';
  assert.equal(deletePage(document, 'missing'), false);
  assert.equal(deletePage(document, 'b'), true);
  assert.deepEqual(document.pages.map(page => page.id), ['a', 'c']);
  assert.equal(document.activePageId, 'c');
  assert.deepEqual(document.comments, [{ id: 'ca', pageId: 'a' }]);
  assert.deepEqual(document.prototypeFlows.map(flow => flow.id), ['flow-a']);
  assert.equal(document.prototypeStartFlowId, 'flow-a');
  assert.deepEqual(document.prototypeStartPoint, { pageId: 'a', nodeId: 'frame-a' });
  assert.equal(document.pages[0].children[0].interactions, undefined);
  assert.deepEqual(document.motion.tracks.map(track => track.id), ['kept-page-track']);
  assert.equal(deletePage(document, 'a'), true);
  assert.equal(document.activePageId, 'c');
  assert.equal(deletePage(document, 'c'), false);
  assert.deepEqual(document.pages.map(page => page.id), ['c']);
});

test('reorderPage clamps the target index and preserves active page by id', () => {
  const document = fixture();
  assert.equal(reorderPage(document, 'b', 99), true);
  assert.deepEqual(document.pages.map(page => page.id), ['a', 'c', 'b']);
  assert.equal(document.activePageId, 'b');
  assert.equal(reorderPage(document, 'a', -5), true);
  assert.deepEqual(document.pages.map(page => page.id), ['a', 'c', 'b']);
  assert.equal(reorderPage(document, 'missing', 0), false);
  assert.equal(reorderPage(document, 'a', 1.5), false);
});
