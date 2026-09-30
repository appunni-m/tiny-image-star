import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayerEffect, createNode } from '../src/model.js';
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

test('smart animation takes the shortest rotation arc and preserves exact frame and layer endpoints', () => {
  const from = createNode('frame', {
    rotation: 350,
    children: [createNode('rectangle', { name: 'Compass needle', rotation: 350 })]
  });
  const to = createNode('frame', {
    rotation: 10,
    children: [createNode('rectangle', { name: 'Compass needle', rotation: 10 })]
  });
  const originalFrom = structuredClone(from);
  const originalTo = structuredClone(to);

  const start = interpolateSmartFrame(from, to, 0);
  const quarter = interpolateSmartFrame(from, to, 0.25);
  const middle = interpolateSmartFrame(from, to, 0.5);
  const threeQuarter = interpolateSmartFrame(from, to, 0.75);
  const end = interpolateSmartFrame(from, to, 1);

  assert.deepEqual([start.rotation, start.children[0].rotation], [350, 350]);
  assert.deepEqual([quarter.rotation, quarter.children[0].rotation], [355, 355]);
  assert.deepEqual([middle.rotation, middle.children[0].rotation], [360, 360]);
  assert.deepEqual([threeQuarter.rotation, threeQuarter.children[0].rotation], [365, 365]);
  assert.deepEqual([end.rotation, end.children[0].rotation], [10, 10]);

  const reverse = interpolateSmartFrame(to, from, 0.5);
  assert.deepEqual([reverse.rotation, reverse.children[0].rotation], [0, 0], 'reverse transitions also take the short path');
  assert.deepEqual(from, originalFrom, 'interpolation leaves the source frame untouched');
  assert.deepEqual(to, originalTo, 'interpolation leaves the destination frame untouched');
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

test('smart animation interpolates node-level paragraph spacing and first-line indent with exact endpoints', () => {
  const from = createNode('frame', { children: [createNode('text', {
    name: 'Paragraph', text: 'A paragraph', paragraphSpacing: '4', firstLineIndent: 20
  })] });
  const to = createNode('frame', { children: [createNode('text', {
    name: 'Paragraph', text: 'A paragraph', paragraphSpacing: 12, firstLineIndent: 0
  })] });

  const layerAt = progress => interpolateSmartFrame(from, to, progress).children[0];
  assert.deepEqual(
    [layerAt(0.25).paragraphSpacing, layerAt(0.25).firstLineIndent],
    [6, 15]
  );
  assert.deepEqual(
    [layerAt(0.5).paragraphSpacing, layerAt(0.5).firstLineIndent],
    [8, 10]
  );
  assert.deepEqual(
    [layerAt(0).paragraphSpacing, layerAt(0).firstLineIndent],
    ['4', 20],
    'the start endpoint preserves the source values and representations'
  );
  assert.deepEqual(
    [layerAt(1).paragraphSpacing, layerAt(1).firstLineIndent],
    [12, 0],
    'the end endpoint preserves the destination values'
  );
  assert.deepEqual(
    [layerAt(-1).paragraphSpacing, layerAt(2).firstLineIndent],
    ['4', 0],
    'out-of-range progress clamps to the exact endpoints'
  );
});

test('smart animation treats omitted legacy text metrics as zero between frames and preserves endpoint shape', () => {
  const legacyText = createNode('text', { name: 'Paragraph', text: 'A paragraph' });
  delete legacyText.paragraphSpacing;
  delete legacyText.firstLineIndent;
  const from = createNode('frame', { children: [legacyText] });
  const to = createNode('frame', { children: [createNode('text', {
    name: 'Paragraph', text: 'A paragraph', paragraphSpacing: 8, firstLineIndent: 12
  })] });
  const layerAt = progress => interpolateSmartFrame(from, to, progress).children[0];

  const start = layerAt(0);
  assert.equal(Object.hasOwn(start, 'paragraphSpacing'), false);
  assert.equal(Object.hasOwn(start, 'firstLineIndent'), false);
  assert.deepEqual(
    [layerAt(0.5).paragraphSpacing, layerAt(0.5).firstLineIndent],
    [4, 6],
    'missing legacy metrics contribute zero during interpolation'
  );
  assert.deepEqual(
    [layerAt(1).paragraphSpacing, layerAt(1).firstLineIndent],
    [8, 12],
    'the authored target values are exact at the destination endpoint'
  );
});

test('smart animation treats explicit null text metrics as zero between frames and preserves exact null endpoints', () => {
  const from = createNode('frame', { children: [createNode('text', {
    name: 'Paragraph', text: 'A paragraph', paragraphSpacing: null, firstLineIndent: 12
  })] });
  const to = createNode('frame', { children: [createNode('text', {
    name: 'Paragraph', text: 'A paragraph', paragraphSpacing: 8, firstLineIndent: null
  })] });
  const layerAt = progress => interpolateSmartFrame(from, to, progress).children[0];

  assert.deepEqual(
    [layerAt(0.5).paragraphSpacing, layerAt(0.5).firstLineIndent],
    [4, 6],
    'explicit null metrics contribute zero during interpolation in either direction'
  );
  assert.equal(layerAt(0).paragraphSpacing, null, 'the source endpoint retains explicit null');
  assert.equal(layerAt(1).firstLineIndent, null, 'the destination endpoint retains explicit null');
});

test('smart animation snaps vertical text alignment from source to target at the midpoint', () => {
  const from = createNode('frame', { children: [createNode('text', { name: 'Label', text: 'Continue', verticalAlign: 'top' })] });
  const to = createNode('frame', { children: [createNode('text', { name: 'Label', text: 'Continue', verticalAlign: 'bottom' })] });
  assert.equal(interpolateSmartFrame(from, to, 0).children[0].verticalAlign, 'top');
  assert.equal(interpolateSmartFrame(from, to, 0.499).children[0].verticalAlign, 'top');
  assert.equal(interpolateSmartFrame(from, to, 0.5).children[0].verticalAlign, 'bottom');
  assert.equal(interpolateSmartFrame(from, to, 1).children[0].verticalAlign, 'bottom');
});

test('smart animation interpolates compatible gradient angles, stop positions, and colors with exact endpoints', () => {
  const fromGradient = {
    type: 'linear', angle: 350,
    stops: [
      { id: 'from-start', position: 0, color: '#000000' },
      { id: 'from-end', position: .75, color: '#ff0000' }
    ]
  };
  const toGradient = {
    type: 'linear', angle: 10,
    stops: [
      { id: 'to-start', position: .5, color: '#ffffff' },
      { id: 'to-end', position: 1, color: '#0000ff' }
    ]
  };
  const from = createNode('frame', { fillGradient: fromGradient, children: [
    createNode('rectangle', { name: 'Card', fillGradient: fromGradient })
  ] });
  const to = createNode('frame', { fillGradient: toGradient, children: [
    createNode('rectangle', { name: 'Card', fillGradient: toGradient })
  ] });
  const originals = [structuredClone(from), structuredClone(to)];

  const middle = interpolateSmartFrame(from, to, .5);
  const expected = {
    type: 'linear', angle: 0,
    stops: [
      { id: 'to-start', position: .25, color: '#808080' },
      { id: 'to-end', position: .875, color: '#800080' }
    ]
  };
  assert.deepEqual(middle.fillGradient, expected);
  assert.deepEqual(middle.children[0].fillGradient, expected);
  assert.deepEqual(interpolateSmartFrame(from, to, 0).fillGradient, fromGradient);
  assert.deepEqual(interpolateSmartFrame(from, to, 1).fillGradient, toGradient);
  assert.deepEqual(interpolateSmartFrame(from, to, 0).children[0].fillGradient, fromGradient);
  assert.deepEqual(interpolateSmartFrame(from, to, 1).children[0].fillGradient, toGradient);
  assert.deepEqual(from, originals[0], 'interpolation does not mutate the source gradient');
  assert.deepEqual(to, originals[1], 'interpolation does not mutate the destination gradient');

  const wrappedFrom = createNode('frame', { fillGradient: { ...fromGradient, angle: 0 } });
  const wrappedTo = createNode('frame', { fillGradient: { ...toGradient, angle: 270 } });
  assert.equal(interpolateSmartFrame(wrappedFrom, wrappedTo, .5).fillGradient.angle, 315, 'wrapped angles stay normalized in the 0–360 range');
});

test('smart animation snaps incompatible and variable-bound gradients at the midpoint', () => {
  const linear = { type: 'linear', angle: 0, stops: [
    { id: 'a', position: 0, color: '#000000' }, { id: 'b', position: 1, color: '#ffffff' }
  ] };
  const radial = { type: 'radial', angle: 90, stops: [
    { id: 'c', position: 0, color: '#ff0000' }, { id: 'd', position: 1, color: '#0000ff' }
  ] };
  const moreStops = { type: 'linear', angle: 180, stops: [
    { id: 'e', position: 0, color: '#ff0000' },
    { id: 'f', position: .5, color: '#00ff00' },
    { id: 'g', position: 1, color: '#0000ff' }
  ] };
  const from = createNode('frame', { children: [
    createNode('rectangle', { name: 'Type change', fillGradient: linear }),
    createNode('rectangle', { name: 'Topology change', fillGradient: linear }),
    createNode('rectangle', { name: 'Bound', fillGradient: linear, fillVariableId: 'surface' })
  ] });
  const to = createNode('frame', { children: [
    createNode('rectangle', { name: 'Type change', fillGradient: radial }),
    createNode('rectangle', { name: 'Topology change', fillGradient: moreStops }),
    createNode('rectangle', { name: 'Bound', fillGradient: radial, fillVariableId: 'surface-dark' })
  ] });
  const beforeMidpoint = interpolateSmartFrame(from, to, .499).children;
  const atMidpoint = interpolateSmartFrame(from, to, .5).children;

  assert.deepEqual(beforeMidpoint.map(node => node.fillGradient), [linear, linear, linear]);
  assert.deepEqual(atMidpoint.map(node => node.fillGradient), [radial, moreStops, radial]);
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
    createNode('path', { name: 'Icon', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 20, y: 20 }] }),
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
  assert.equal(icons.find(node => node.points.length === 2).opacity, 0.5);
  assert.equal(icons.find(node => node.points.length === 3).opacity, 0.5);
  assert.equal(networks.length, 2);
  assert.deepEqual(networks.map(node => node.opacity), [0.5, 0.5]);
});

test('smart animation morphs compatible vector anchors and Bézier handles with exact immutable endpoints', () => {
  const from = createNode('frame', { children: [createNode('path', {
    name: 'Curve', x: 0, y: 0, width: 100, height: 80,
    points: [
      { x: .1, y: .2, in: { x: 0, y: 0 }, out: { x: .2, y: 0 } },
      { x: .8, y: .7, in: { x: -.1, y: .2 }, out: { x: 0, y: 0 } }
    ]
  })] });
  const to = createNode('frame', { children: [createNode('path', {
    name: 'Curve', x: 20, y: 40, width: 200, height: 160,
    points: [
      { x: .5, y: .6, out: { x: .4, y: -.2 } },
      { x: .4, y: .3, in: { x: -.3, y: .4 } }
    ]
  })] });
  const originalFrom = structuredClone(from);
  const originalTo = structuredClone(to);

  const start = interpolateSmartFrame(from, to, 0).children[0];
  const middle = interpolateSmartFrame(from, to, .5).children[0];
  const end = interpolateSmartFrame(from, to, 1).children[0];

  assert.equal(middle.points.length, 2, 'matching topology stays a single interpolated layer');
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should be close to ${expected}`);
  near(middle.points[0].x, .3);
  near(middle.points[0].y, .4);
  near(middle.points[0].out.x, .3);
  near(middle.points[0].out.y, -.1);
  near(middle.points[0].in.x, 0);
  near(middle.points[0].in.y, 0);
  near(middle.points[1].x, .6);
  near(middle.points[1].y, .5);
  near(middle.points[1].in.x, -.2);
  near(middle.points[1].in.y, .3);
  near(middle.points[1].out.x, 0);
  near(middle.points[1].out.y, 0);
  assert.deepEqual(start.points, from.children[0].points, 'the source endpoint retains its exact handle representation');
  assert.deepEqual(end.points, to.children[0].points, 'the target endpoint retains its exact handle representation');
  assert.deepEqual(from, originalFrom, 'interpolation does not mutate the source path');
  assert.deepEqual(to, originalTo, 'interpolation does not mutate the target path');
});

test('smart animation morphs a compatible vector network without crossfading its graph', () => {
  const fromNetwork = {
    vertices: [
      { id: 'v1', x: 0, y: 0, label: 'start' },
      { id: 'v2', x: 1, y: 0 },
      { id: 'v3', x: .5, y: 1 }
    ],
    edges: [
      { id: 'e1', from: 'v1', to: 'v2', control1: { x: .2, y: -.2 }, control2: { x: .8, y: -.2 } },
      { id: 'e2', from: 'v2', to: 'v3' },
      { id: 'e3', from: 'v3', to: 'v1', control1: { x: .4, y: .8 } }
    ],
    faces: [{ id: 'f1', vertexIds: ['v1', 'v2', 'v3'], fill: '#000000', fillOpacity: .5, fillStyleId: 'style-before' }]
  };
  const toNetwork = {
    vertices: [
      { id: 'v1', x: .2, y: .4, label: 'end' },
      { id: 'v2', x: .8, y: .2 },
      { id: 'v3', x: .4, y: .8 }
    ],
    edges: [
      { id: 'e1', from: 'v1', to: 'v2', control1: { x: .3, y: -.4 }, control2: { x: .7, y: -.1 } },
      { id: 'e2', from: 'v2', to: 'v3', control1: { x: .75, y: .25 }, control2: null },
      { id: 'e3', from: 'v3', to: 'v1', control2: { x: .3, y: .6 } }
    ],
    faces: [{ id: 'f1', vertexIds: ['v1', 'v2', 'v3'], fill: '#ffffff', fillOpacity: 1, fillStyleId: 'style-after' }]
  };
  const from = createNode('frame', { children: [createNode('network', { name: 'Triangle', x: 10, width: 100, ...fromNetwork })] });
  const to = createNode('frame', { children: [createNode('network', { name: 'Triangle', x: 30, width: 200, ...toNetwork })] });
  const originalFrom = structuredClone(from);
  const originalTo = structuredClone(to);

  const start = interpolateSmartFrame(from, to, 0).children;
  const middle = interpolateSmartFrame(from, to, .5).children;
  const beforeMidpoint = interpolateSmartFrame(from, to, .499).children[0];
  const atMidpoint = interpolateSmartFrame(from, to, .5).children[0];
  const end = interpolateSmartFrame(from, to, 1).children;
  assert.equal(middle.length, 1, 'same graph topology is one continuously morphing layer');
  assert.equal(middle[0].type, 'network');
  assert.deepEqual([middle[0].x, middle[0].width], [20, 150], 'layer geometry continues interpolating with the network graph');
  assert.deepEqual(start[0].vertices, fromNetwork.vertices, 'the source endpoint is exact');
  assert.deepEqual(start[0].edges, fromNetwork.edges, 'the source controls are exact');
  assert.deepEqual(start[0].faces, fromNetwork.faces, 'the source face style is exact');
  assert.deepEqual(end[0].vertices, toNetwork.vertices, 'the destination endpoint is exact');
  assert.deepEqual(end[0].edges, toNetwork.edges, 'the destination controls are exact');
  assert.deepEqual(end[0].faces, toNetwork.faces, 'the destination face style is exact');

  assert.deepEqual(middle[0].vertices.map(({ x, y }) => [x, y]), [[.1, .2], [.9, .1], [.45, .9]]);
  const closePoint = (actual, expected) => {
    assert.ok(Math.abs(actual.x - expected.x) < 1e-12);
    assert.ok(Math.abs(actual.y - expected.y) < 1e-12);
  };
  closePoint(middle[0].edges[0].control1, { x: .25, y: -.3 });
  closePoint(middle[0].edges[0].control2, { x: .75, y: -.15 });
  closePoint(middle[0].edges[1].control1, { x: .875, y: .125 });
  assert.equal(middle[0].edges[1].control2, null, 'ordinary line semantics remain absent');
  closePoint(middle[0].edges[2].control1, { x: .4, y: .8 });
  closePoint(middle[0].edges[2].control2, { x: .15, y: .3 });
  assert.deepEqual(beforeMidpoint.faces[0], {
    id: 'f1', vertexIds: ['v1', 'v2', 'v3'], fill: '#7f7f7f', fillOpacity: .7495, fillStyleId: 'style-before'
  });
  assert.deepEqual(atMidpoint.faces[0], {
    id: 'f1', vertexIds: ['v1', 'v2', 'v3'], fill: '#808080', fillOpacity: .75, fillStyleId: 'style-after'
  }, 'face paint references switch categorically while direct paint values interpolate');
  assert.deepEqual(from, originalFrom, 'network interpolation leaves source frame untouched');
  assert.deepEqual(to, originalTo, 'network interpolation leaves destination frame untouched');
});

test('smart animation crossfades vector networks with changed identity, incidence, or face traversal order', () => {
  const base = {
    vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 0, y: 1 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'ca', from: 'c', to: 'a' }],
    faces: [{ id: 'face', vertexIds: ['a', 'b', 'c'] }]
  };
  const incompatible = [
    { ...base, edges: [{ ...base.edges[0], from: 'b', to: 'a' }, ...base.edges.slice(1)] },
    { ...base, edges: [base.edges[1], base.edges[0], base.edges[2]] },
    { ...base, faces: [{ id: 'face', vertexIds: ['a', 'c', 'b'] }] },
    { ...base, vertices: [{ ...base.vertices[0], id: 'renamed' }, ...base.vertices.slice(1)] }
  ];

  for (const [index, targetNetwork] of incompatible.entries()) {
    const from = createNode('frame', { children: [createNode('network', { name: `Topology ${index}`, ...base })] });
    const to = createNode('frame', { children: [createNode('network', { name: `Topology ${index}`, ...targetNetwork })] });
    const copies = interpolateSmartFrame(from, to, .5).children;
    assert.equal(copies.length, 2, `network topology variant ${index} crossfades`);
    assert.deepEqual(copies.map(node => node.opacity), [.5, .5]);
  }
});

test('smart animation crossfades malformed vector networks instead of propagating invalid geometry', () => {
  const valid = {
    vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 0, y: 1 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'ca', from: 'c', to: 'a' }],
    faces: [{ id: 'face', vertexIds: ['a', 'b', 'c'] }]
  };
  const invalidNetworks = [
    { ...valid, vertices: [{ ...valid.vertices[0] }, { ...valid.vertices[1], id: 'a' }, valid.vertices[2]] },
    { ...valid, vertices: [{ ...valid.vertices[0], x: Number.NaN }, ...valid.vertices.slice(1)] },
    { ...valid, edges: [{ ...valid.edges[0], control1: { x: Infinity, y: 0 } }, ...valid.edges.slice(1)] },
    { ...valid, edges: [{ ...valid.edges[0], to: 'missing' }, ...valid.edges.slice(1)] },
    { ...valid, faces: [{ ...valid.faces[0], vertexIds: ['a', 'missing', 'c'] }] }
  ];

  for (const [index, targetNetwork] of invalidNetworks.entries()) {
    const from = createNode('frame', { children: [createNode('network', { name: `Malformed ${index}`, ...valid })] });
    const to = createNode('frame', { children: [createNode('network', { name: `Malformed ${index}`, ...targetNetwork })] });
    const copies = interpolateSmartFrame(from, to, .5).children;
    assert.equal(copies.length, 2, `malformed network variant ${index} crossfades`);
    assert.deepEqual(copies.map(node => node.opacity), [.5, .5]);
  }
});

test('smart animation crossfades networks whose face rings lack a boundary edge', () => {
  const makeNetwork = (offset) => createNode('network', {
    name: 'Open triangle face',
    vertices: [
      { id: 'a', x: offset, y: 0 },
      { id: 'b', x: 1 + offset, y: 0 },
      { id: 'c', x: offset, y: 1 }
    ],
    // The face ring says a-b-c-a, but the graph has no c-a edge.
    edges: [
      { id: 'ab', from: 'a', to: 'b' },
      { id: 'bc', from: 'b', to: 'c' }
    ],
    faces: [{ id: 'face', vertexIds: ['a', 'b', 'c'] }]
  });
  const from = createNode('frame', { children: [makeNetwork(0)] });
  const to = createNode('frame', { children: [makeNetwork(.25)] });

  const copies = interpolateSmartFrame(from, to, .5).children;
  assert.equal(copies.length, 2, 'an invalid face boundary is incompatible even when both graphs otherwise match');
  assert.deepEqual(copies.map(node => node.opacity), [.5, .5]);
});

test('smart animation keeps extreme but finite vector coordinates finite while morphing', () => {
  const from = createNode('frame', { children: [createNode('network', {
    name: 'Extreme', vertices: [{ id: 'v1', x: 1e308, y: -1e308 }], edges: [], faces: []
  })] });
  const to = createNode('frame', { children: [createNode('network', {
    name: 'Extreme', vertices: [{ id: 'v1', x: -1e308, y: 1e308 }], edges: [], faces: []
  })] });

  const middle = interpolateSmartFrame(from, to, .5).children[0];
  assert.deepEqual([middle.vertices[0].x, middle.vertices[0].y], [0, 0]);
  assert.ok(Number.isFinite(middle.vertices[0].x));
  assert.ok(Number.isFinite(middle.vertices[0].y));
});

test('smart animation crossfades paths with different closure or invalid coordinates', () => {
  const from = createNode('frame', { children: [
    createNode('path', { name: 'Closure', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }),
    createNode('path', { name: 'Invalid', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
  ] });
  const to = createNode('frame', { children: [
    createNode('path', { name: 'Closure', closed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }),
    createNode('path', { name: 'Invalid', points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }] })
  ] });

  const middle = interpolateSmartFrame(from, to, .5).children;
  for (const name of ['Closure', 'Invalid']) {
    const copies = middle.filter(node => node.name === name);
    assert.equal(copies.length, 2, `${name} should crossfade because its path geometry is incompatible`);
    assert.deepEqual(copies.map(node => node.opacity), [0.5, 0.5]);
  }
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

test('smart animation interpolates compatible drop-shadow and layer-blur effects with exact immutable endpoints', () => {
  const fromEffects = [
    createLayerEffect('drop-shadow', {
      id: 'shadow-before', color: '#000000', opacity: 0.2, offsetX: 2, offsetY: 4, blur: 2, visible: true
    }),
    createLayerEffect('layer-blur', { id: 'blur-before', radius: 2 })
  ];
  const toEffects = [
    createLayerEffect('drop-shadow', {
      id: 'shadow-after', color: '#ffffff', opacity: 0.8, offsetX: 10, offsetY: -4, blur: 10, visible: false
    }),
    createLayerEffect('layer-blur', { id: 'blur-after', radius: 10 })
  ];
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: fromEffects })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: toEffects })] });
  const originalFrom = structuredClone(from);
  const originalTo = structuredClone(to);

  const quarter = interpolateSmartFrame(from, to, 0.25).children[0].effects;
  const threeQuarter = interpolateSmartFrame(from, to, 0.75).children[0].effects;
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should be close to ${expected}`);
  assert.deepEqual(quarter.map(({ id, type, visible }) => [id, type, visible]), [
    ['shadow-before', 'drop-shadow', true], ['blur-before', 'layer-blur', true]
  ]);
  assert.equal(quarter[0].color, '#404040');
  assert.deepEqual(threeQuarter.map(({ id, type, visible }) => [id, type, visible]), [
    ['shadow-after', 'drop-shadow', false], ['blur-after', 'layer-blur', true]
  ]);
  assert.equal(threeQuarter[0].color, '#bfbfbf');
  near(quarter[0].opacity, 0.35);
  near(quarter[0].offsetX, 4);
  near(quarter[0].offsetY, 2);
  near(quarter[0].blur, 4);
  near(quarter[1].radius, 4);
  near(threeQuarter[0].opacity, 0.65);
  near(threeQuarter[0].offsetX, 8);
  near(threeQuarter[0].offsetY, -2);
  near(threeQuarter[0].blur, 8);
  near(threeQuarter[1].radius, 8);
  assert.deepEqual(interpolateSmartFrame(from, to, 0).children[0].effects, fromEffects);
  assert.deepEqual(interpolateSmartFrame(from, to, 1).children[0].effects, toEffects);
  assert.deepEqual(from, originalFrom, 'interpolation does not mutate source effect values');
  assert.deepEqual(to, originalTo, 'interpolation does not mutate destination effect values');
});

test('smart animation snaps effect stacks with incompatible count, order, or invalid values at the midpoint', () => {
  const shadow = createLayerEffect('drop-shadow', { id: 'shadow', color: '#000000', opacity: 0.2, offsetX: 0, offsetY: 2, blur: 2 });
  const blur = createLayerEffect('layer-blur', { id: 'blur', radius: 2 });
  const changedCount = [createLayerEffect('drop-shadow', { ...shadow, id: 'shadow-end', color: '#ffffff' }), blur];
  const changedOrder = [createLayerEffect('layer-blur', { ...blur, id: 'blur-end', radius: 10 }), createLayerEffect('drop-shadow', { ...shadow, id: 'shadow-end', color: '#ffffff' })];
  const invalidValue = [createLayerEffect('drop-shadow', { ...shadow, id: 'shadow-end', color: 'red' })];
  const stacks = [
    { from: [shadow], to: changedCount },
    { from: [shadow, blur], to: changedOrder },
    { from: [shadow], to: invalidValue }
  ];

  for (const [index, stack] of stacks.entries()) {
    const from = createNode('frame', { children: [createNode('rectangle', { name: `Effect ${index}`, effects: stack.from })] });
    const to = createNode('frame', { children: [createNode('rectangle', { name: `Effect ${index}`, effects: stack.to })] });
    assert.deepEqual(
      interpolateSmartFrame(from, to, 0.25).children[0].effects,
      stack.from,
      `incompatible effect topology ${index} should retain the source stack before halfway`
    );
    assert.deepEqual(
      interpolateSmartFrame(from, to, 0.5).children[0].effects,
      stack.to,
      `incompatible effect topology ${index} should switch to the destination stack at halfway`
    );
  }
});

test('smart animation rejects non-frame endpoints and clamps its progress', () => {
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Shape', x: 0 })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Shape', x: 100 })] });
  assert.throws(() => interpolateSmartFrame(createNode('rectangle'), to, 0.5), /requires two frames/);
  assert.equal(interpolateSmartFrame(from, to, -2).children[0].x, 0);
  assert.equal(interpolateSmartFrame(from, to, 2).children[0].x, 100);
});
