import test from 'node:test';
import assert from 'node:assert/strict';
import { createNode } from '../src/model.js';
import { applyAutoLayout, createAutoLayout } from '../src/layout-engine.js';

test('vertical auto layout positions children using padding and gap', () => {
  const frame = createNode('frame', { width: 240, height: 240, autoLayout: createAutoLayout({ gap: 8, padding: 12 }) });
  const first = createNode('rectangle', { width: 40, height: 20 });
  const second = createNode('rectangle', { width: 70, height: 30 });
  frame.children.push(first, second);
  applyAutoLayout(frame);
  assert.deepEqual([first.x, first.y, second.x, second.y], [12, 12, 12, 40]);
});

test('horizontal fill children divide remaining main-axis space', () => {
  const frame = createNode('frame', { width: 220, height: 100, autoLayout: createAutoLayout({ axis: 'horizontal', gap: 10, padding: { left: 10, right: 10, top: 8, bottom: 8 } }) });
  const fixed = createNode('rectangle', { width: 40, height: 30 });
  const fill = createNode('rectangle', { width: 20, height: 30, layoutSizingMain: 'fill' });
  frame.children.push(fixed, fill);
  applyAutoLayout(frame);
  assert.deepEqual([fixed.x, fill.x, fill.width], [10, 60, 150]);
});

test('hug sizing updates the frame to match its laid out content', () => {
  const frame = createNode('frame', { width: 220, height: 100, autoLayout: createAutoLayout({ axis: 'vertical', gap: 5, padding: 10, mainSizing: 'hug', crossSizing: 'hug' }) });
  frame.children.push(createNode('rectangle', { width: 60, height: 20 }), createNode('rectangle', { width: 80, height: 30 }));
  applyAutoLayout(frame);
  assert.deepEqual([frame.width, frame.height], [100, 75]);
});
