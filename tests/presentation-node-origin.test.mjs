import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode } from '../src/model.js';
import { presentationNodePageOrigin } from '../src/renderer.js';

test('presentation node origin follows nested scrolling offsets', () => {
  const document = createDocument();
  const screen = createNode('frame', { name: 'Screen', x: 100, y: 200, width: 400, height: 700 });
  const scroller = createNode('frame', { name: 'Scrollable panel', x: 30, y: 50, width: 200, height: 180, overflowBehavior: 'vertical' });
  const trigger = createNode('rectangle', { name: 'Trigger', x: 10, y: 140, width: 40, height: 24 });
  scroller.children.push(trigger);
  screen.children.push(scroller);
  addNode(document, screen);

  const origin = presentationNodePageOrigin(document.pages[0], trigger.id, document, new Map([[scroller.id, { x: 0, y: 100 }]]));
  assert.deepEqual(origin, { x: 140, y: 290 });
});

test('presentation node origin follows rotated parent and trigger transforms', () => {
  const document = createDocument();
  const screen = createNode('frame', { name: 'Screen', width: 400, height: 700 });
  const parent = createNode('frame', { name: 'Rotated parent', x: 40, y: 60, width: 200, height: 180, rotation: 90 });
  const trigger = createNode('rectangle', { name: 'Trigger', x: 20, y: 30, width: 40, height: 24, rotation: 15 });
  parent.children.push(trigger);
  screen.children.push(parent);
  addNode(document, screen);

  const origin = presentationNodePageOrigin(document.pages[0], trigger.id, document);
  assert.ok(Math.abs(origin.x - 204.76749081751925) < 1e-9);
  assert.ok(Math.abs(origin.y - 73.78731201544888) < 1e-9);
});
