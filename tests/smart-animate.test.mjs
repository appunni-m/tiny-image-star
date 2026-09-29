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

test('smart animation interpolates numeric font weight and snaps categorical text and paint at the midpoint', () => {
  const from = createNode('frame', { fill: '#000000', fillVariableId: 'surface-light', children: [
    createNode('text', {
      name: 'Title', text: 'Hello', fontFamily: 'Inter', fontWeight: '400', fontStyle: 'normal',
      textDecoration: 'none', align: 'left',
      textRuns: [{ text: 'Hello', fontFamily: 'Inter', fontWeight: 400, textDecoration: 'none' }]
    }),
    createNode('rectangle', { name: 'Surface', fill: '#000000', fillVariableId: 'surface-light', blendMode: 'normal', effects: [] })
  ] });
  const to = createNode('frame', { fill: '#ffffff', fillVariableId: 'surface-dark', children: [
    createNode('text', {
      name: 'Title', text: 'Hello', fontFamily: 'Arial', fontWeight: 700, fontStyle: 'italic',
      textDecoration: 'underline', align: 'center',
      textRuns: [{ text: 'Hello', fontFamily: 'Arial', fontWeight: 700, textDecoration: 'underline' }]
    }),
    createNode('rectangle', { name: 'Surface', fill: '#ffffff', fillVariableId: 'surface-dark', blendMode: 'multiply', effects: [{ id: 'shadow', type: 'drop-shadow' }] })
  ] });

  const start = interpolateSmartFrame(from, to, 0);
  const quarter = interpolateSmartFrame(from, to, 0.25);
  const middle = interpolateSmartFrame(from, to, 0.5);
  const end = interpolateSmartFrame(from, to, 1);
  const startTitle = start.children[0];
  const quarterTitle = quarter.children[0];
  const middleTitle = middle.children[0];
  const endTitle = end.children[0];

  assert.equal(startTitle.fontFamily, 'Inter');
  assert.equal(startTitle.fontWeight, '400', 'endpoints preserve the original weight representation');
  assert.equal(quarterTitle.fontWeight, 475);
  assert.equal(quarterTitle.fontFamily, 'Inter');
  assert.equal(quarterTitle.textDecoration, 'none');
  assert.equal(middleTitle.fontWeight, 550);
  assert.equal(middleTitle.fontFamily, 'Arial', 'categorical typography switches at the halfway point');
  assert.equal(middleTitle.fontStyle, 'italic');
  assert.equal(middleTitle.textDecoration, 'underline');
  assert.equal(middleTitle.align, 'center');
  assert.equal(endTitle.fontWeight, 700);
  assert.equal(endTitle.fontFamily, 'Arial');

  assert.equal(quarter.fill, '#000000');
  assert.equal(quarter.fillVariableId, 'surface-light');
  assert.equal(quarter.children[1].blendMode, 'normal');
  assert.equal(middle.fill, '#ffffff');
  assert.equal(middle.fillVariableId, 'surface-dark');
  assert.equal(middle.children[1].blendMode, 'multiply');
  assert.deepEqual(middle.children[1].effects, [{ id: 'shadow', type: 'drop-shadow' }]);
  assert.equal(from.children[0].fontWeight, '400', 'interpolation leaves the source unchanged');
  assert.equal(to.children[0].fontWeight, 700, 'interpolation leaves the destination unchanged');
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

test('smart animation interpolates compatible rich-text run metrics and solid colors', () => {
  const fromRuns = [
    { text: 'Hello ', fontSize: 12, fontWeight: '400', lineHeight: 1, letterSpacing: -2, color: '#000000' },
    { text: 'world', fontSize: 20, fontWeight: 500, lineHeight: 1.2, letterSpacing: 0, color: '#204060' }
  ];
  const toRuns = [
    { text: 'Hello ', fontSize: 32, fontWeight: 700, lineHeight: 2, letterSpacing: 4, color: '#ffffff' },
    { text: 'world', fontSize: 40, fontWeight: 800, lineHeight: 1.8, letterSpacing: 6, color: '#e0a080' }
  ];
  const from = createNode('frame', { children: [createNode('text', { name: 'Headline', text: 'Hello world', textRuns: fromRuns })] });
  const to = createNode('frame', { children: [createNode('text', { name: 'Headline', text: 'Hello world', textRuns: toRuns })] });

  const middleRuns = interpolateSmartFrame(from, to, 0.5).children[0].textRuns;
  assert.deepEqual(middleRuns, [
    { text: 'Hello ', fontSize: 22, fontWeight: 550, lineHeight: 1.5, letterSpacing: 1, color: '#808080' },
    { text: 'world', fontSize: 30, fontWeight: 650, lineHeight: 1.5, letterSpacing: 3, color: '#807070' }
  ]);

  assert.deepEqual(interpolateSmartFrame(from, to, 0).children[0].textRuns, fromRuns, 'the starting endpoint keeps its original run values');
  assert.deepEqual(interpolateSmartFrame(from, to, 1).children[0].textRuns, toRuns, 'the destination endpoint keeps its original run values');
  assert.deepEqual(interpolateSmartFrame(from, to, -1).children[0].textRuns, fromRuns, 'progress below zero clamps to the starting endpoint');
  assert.deepEqual(interpolateSmartFrame(from, to, 2).children[0].textRuns, toRuns, 'progress above one clamps to the destination endpoint');
  assert.deepEqual(from.children[0].textRuns, fromRuns, 'interpolation leaves source runs unchanged');
  assert.deepEqual(to.children[0].textRuns, toRuns, 'interpolation leaves destination runs unchanged');
});

test('smart animation snaps rich-text styles when unchanged text has incompatible run segmentation', () => {
  const from = createNode('frame', { children: [createNode('text', {
    name: 'Headline', text: 'Hello world',
    textRuns: [{ text: 'Hello ', fontSize: 12, color: '#000000' }, { text: 'world', fontSize: 20, color: '#204060' }]
  })] });
  const to = createNode('frame', { children: [createNode('text', {
    name: 'Headline', text: 'Hello world',
    textRuns: [{ text: 'Hello world', fontSize: 32, color: '#ffffff' }]
  })] });

  const middle = interpolateSmartFrame(from, to, 0.5).children;
  assert.equal(middle.length, 1, 'unchanged text remains a matched layer');
  assert.deepEqual(middle[0].textRuns, to.children[0].textRuns, 'unaligned run boundaries keep the existing destination-style snap');
  assert.deepEqual(interpolateSmartFrame(from, to, 0).children[0].textRuns, from.children[0].textRuns, 'the start endpoint keeps the source run segmentation');
  assert.deepEqual(interpolateSmartFrame(from, to, 1).children[0].textRuns, to.children[0].textRuns, 'the end endpoint keeps the destination run segmentation');
});

test('smart animation rejects non-frame endpoints and clamps its progress', () => {
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Shape', x: 0 })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Shape', x: 100 })] });
  assert.throws(() => interpolateSmartFrame(createNode('rectangle'), to, 0.5), /requires two frames/);
  assert.equal(interpolateSmartFrame(from, to, -2).children[0].x, 0);
  assert.equal(interpolateSmartFrame(from, to, 2).children[0].x, 100);
});
