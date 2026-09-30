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

test('renamePage trims valid names and leaves invalid input unchanged', () => {
  const document = fixture();
  assert.equal(renamePage(document, 'b', '  Checkout  ').name, 'Checkout');
  assert.equal(renamePage(document, 'b', '   '), null);
  assert.equal(renamePage(document, 'missing', 'Name'), null);
  assert.equal(document.pages[1].name, 'Checkout');
});

test('deletePage protects the last page and repairs active page plus page-owned references', () => {
  const document = fixture();
  document.prototypeFlows = [
    { id: 'flow-b', name: 'Deleted page', pageId: 'b', nodeId: 'frame-b' },
    { id: 'flow-a', name: 'Kept page', pageId: 'a', nodeId: 'frame-a' }
  ];
  document.prototypeStartFlowId = 'flow-b';
  document.pages[0].children.push({ id: 'source', type: 'frame', children: [], interactions: [
    { id: 'to-b-explicit', action: 'navigate', destinationId: 'frame-b', destinationPageId: 'b' },
    { id: 'to-b-implicit', action: 'navigate', destinationId: 'frame-b' }
  ] });
  assert.equal(deletePage(document, 'missing'), false);
  assert.equal(deletePage(document, 'b'), true);
  assert.deepEqual(document.pages.map(page => page.id), ['a', 'c']);
  assert.equal(document.activePageId, 'c');
  assert.deepEqual(document.comments, [{ id: 'ca', pageId: 'a' }]);
  assert.deepEqual(document.prototypeFlows.map(flow => flow.id), ['flow-a']);
  assert.equal(document.prototypeStartFlowId, 'flow-a');
  assert.deepEqual(document.prototypeStartPoint, { pageId: 'a', nodeId: 'frame-a' });
  assert.equal(document.pages[0].children[0].interactions, undefined);
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
