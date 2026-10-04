import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode } from '../src/model.js';
import { prototypeScrollOffsetsForFrame } from '../src/prototype-scroll-state.js';

test('preserve policy retains destination and unrelated scroll offsets without mutating input', () => {
  const document = createDocument();
  const destination = createNode('frame', { name: 'Destination', overflowBehavior: 'vertical' });
  addNode(document, destination);
  const nested = createNode('frame', { name: 'Nested scroller', overflowBehavior: 'both' });
  destination.children.push(nested);
  const outside = createNode('frame', { name: 'Other screen', overflowBehavior: 'vertical' });
  addNode(document, outside);
  const current = new Map([
    [destination.id, { x: 0, y: 40 }],
    [nested.id, { x: 25, y: 60 }],
    [outside.id, { x: 0, y: 80 }]
  ]);

  const result = prototypeScrollOffsetsForFrame(document, current, document.activePageId, destination.id);
  assert.notEqual(result, current);
  assert.deepEqual([...result], [...current]);
  assert.deepEqual([...current], [
    [destination.id, { x: 0, y: 40 }],
    [nested.id, { x: 25, y: 60 }],
    [outside.id, { x: 0, y: 80 }]
  ]);
});

test('reset policy clears the destination frame subtree while retaining other frames and pages', () => {
  const document = createDocument();
  const destination = createNode('frame', { name: 'Destination' });
  const nestedGroup = createNode('group', { name: 'Nested group' });
  const nestedScroller = createNode('frame', { name: 'Nested scroller', overflowBehavior: 'vertical' });
  nestedGroup.children.push(nestedScroller);
  destination.children.push(nestedGroup);
  addNode(document, destination);
  const outside = createNode('frame', { name: 'Other screen', overflowBehavior: 'vertical' });
  addNode(document, outside);
  const otherPage = structuredClone(document.pages[0]);
  otherPage.id = 'other-page';
  otherPage.children = [createNode('frame', { id: 'other-page-frame', overflowBehavior: 'both' })];
  document.pages.push(otherPage);
  const current = new Map([
    [destination.id, { x: 0, y: 40 }],
    [nestedScroller.id, { x: 0, y: 60 }],
    [outside.id, { x: 0, y: 80 }],
    ['other-page-frame', { x: 15, y: 25 }]
  ]);

  const result = prototypeScrollOffsetsForFrame(document, current, document.activePageId, destination.id, 'reset');
  assert.deepEqual([...result], [
    [outside.id, { x: 0, y: 80 }],
    ['other-page-frame', { x: 15, y: 25 }]
  ]);
  assert.equal(current.size, 4, 'reset leaves the prior history state untouched');
});

test('scroll-state helper rejects malformed maps, policies, and stale destinations', () => {
  const document = createDocument();
  const frame = createNode('frame');
  addNode(document, frame);
  assert.throws(() => prototypeScrollOffsetsForFrame(document, {}, document.activePageId, frame.id), /must be a Map/);
  assert.throws(() => prototypeScrollOffsetsForFrame(document, new Map(), document.activePageId, frame.id, 'clear'), /policy/);
  assert.throws(() => prototypeScrollOffsetsForFrame(document, new Map(), document.activePageId, 'missing'), /prototype frame/);
});
