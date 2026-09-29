import test from 'node:test';
import assert from 'node:assert/strict';
import { createNode } from '../src/model.js';
import { interpolateSmartFrame } from '../src/smart-animate.js';

test('smart animation interpolates supported size, position, rotation, opacity, and solid-fill changes', () => {
  const from = createNode('frame', {
    name: 'Before', width: 400, height: 700,
    children: [createNode('rectangle', { name: 'Hero card', x: 10, y: 20, width: 40, height: 60, rotation: 0, opacity: 1, fill: '#000000' })]
  });
  const to = createNode('frame', {
    name: 'After', width: 600, height: 900,
    children: [createNode('rectangle', { name: 'Hero card', x: 110, y: 80, width: 80, height: 40, rotation: 90, opacity: 0.5, fill: '#ffffff' })]
  });

  const middle = interpolateSmartFrame(from, to, 0.5);
  assert.deepEqual([middle.width, middle.height], [500, 800]);
  assert.deepEqual(
    [middle.children[0].x, middle.children[0].y, middle.children[0].width, middle.children[0].height, middle.children[0].rotation, middle.children[0].opacity, middle.children[0].fill],
    [60, 50, 60, 50, 45, 0.75, '#808080']
  );
  assert.equal(from.children[0].x, 10, 'the source frame remains unchanged');
  assert.equal(to.children[0].x, 110, 'the destination frame remains unchanged');
});

test('smart animation matches by layer name and parent hierarchy and fades unmatched layers', () => {
  const from = createNode('frame', { children: [
    createNode('group', { name: 'Card', children: [
      createNode('rectangle', { name: 'Shared', x: 10 }),
      createNode('rectangle', { name: 'Leaving', opacity: 0.8 })
    ] }),
    createNode('ellipse', { name: 'Old badge', opacity: 0.6 })
  ] });
  const to = createNode('frame', { children: [
    createNode('group', { name: 'Card', children: [
      createNode('rectangle', { name: 'Shared', x: 30 }),
      createNode('rectangle', { name: 'Entering' })
    ] }),
    createNode('ellipse', { name: 'New badge' })
  ] });

  const middle = interpolateSmartFrame(from, to, 0.5);
  const card = middle.children.find(node => node.name === 'Card');
  const leaving = card.children.find(node => node.name === 'Leaving');
  const entering = card.children.find(node => node.name === 'Entering');
  const oldBadge = middle.children.find(node => node.name === 'Old badge');
  const newBadge = middle.children.find(node => node.name === 'New badge');
  assert.equal(card.children.find(node => node.name === 'Shared').x, 20);
  assert.equal(leaving.opacity, 0.4);
  assert.equal(entering.opacity, 0.5);
  assert.equal(oldBadge.opacity, 0.3);
  assert.equal(newBadge.opacity, 0.5);
});

test('smart animation crossfades incompatible content instead of morphing it', () => {
  const from = createNode('frame', { children: [
    createNode('text', { name: 'Title', text: 'Before', opacity: 0.8 }),
    createNode('path', { name: 'Icon', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }),
    createNode('network', { name: 'Branch', vertices: [{ id: 'v1', x: 0, y: 0 }, { id: 'v2', x: 1, y: 1 }], edges: [{ id: 'e1', from: 'v1', to: 'v2' }], faces: [] })
  ] });
  const to = createNode('frame', { children: [
    createNode('text', { name: 'Title', text: 'After' }),
    createNode('path', { name: 'Icon', points: [{ x: 0, y: 0 }, { x: 20, y: 20 }] }),
    createNode('network', { name: 'Branch', vertices: [{ id: 'v1', x: 0, y: 0 }, { id: 'v2', x: .5, y: 1 }, { id: 'v3', x: 1, y: 0 }], edges: [{ id: 'e1', from: 'v1', to: 'v2' }, { id: 'e2', from: 'v2', to: 'v3' }], faces: [] })
  ] });

  const middle = interpolateSmartFrame(from, to, 0.5);
  const titles = middle.children.filter(node => node.name === 'Title');
  const icons = middle.children.filter(node => node.name === 'Icon');
  const networks = middle.children.filter(node => node.name === 'Branch');
  assert.equal(titles.length, 2);
  assert.equal(titles.find(node => node.text === 'Before').opacity, 0.4);
  assert.equal(titles.find(node => node.text === 'After').opacity, 0.5);
  assert.equal(icons.length, 2);
  assert.equal(icons.find(node => node.points[1].x === 10).opacity, 0.5);
  assert.equal(icons.find(node => node.points[1].x === 20).opacity, 0.5);
  assert.equal(networks.length, 2);
  assert.deepEqual(networks.map(node => node.opacity), [0.5, 0.5]);
});

test('smart animation rejects non-frame endpoints and clamps its progress', () => {
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Shape', x: 0 })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Shape', x: 100 })] });
  assert.throws(() => interpolateSmartFrame(createNode('rectangle'), to, 0.5), /requires two frames/);
  assert.equal(interpolateSmartFrame(from, to, -2).children[0].x, 0);
  assert.equal(interpolateSmartFrame(from, to, 2).children[0].x, 100);
});
