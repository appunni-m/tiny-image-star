import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, bindVariable, createDocument, createLayerEffect, createNode, createVariable, createVariableCollection, getNodePropertyValue } from '../src/model.js';
import { createImageFill } from '../src/image-fills.js';
import { interpolateSmartFrame } from '../src/smart-animate.js';
import { easePrototypeProgress } from '../src/prototype-easing.js';

test('back and spring easing preserve bounded layer presence while spatial geometry anticipates and overshoots', () => {
  const from = createNode('frame', {
    width: 100, height: 120, opacity: 0.8, fill: '#000000',
    children: [createNode('rectangle', {
      name: 'Card', x: 10, y: 20, width: 40, height: 30, rotation: 0, opacity: 0.7, fill: '#000000'
    })]
  });
  const to = createNode('frame', {
    width: 200, height: 220, opacity: 0.2, fill: '#ffffff',
    children: [
      createNode('rectangle', {
        name: 'Card', x: 110, y: 120, width: 80, height: 60, rotation: 90, opacity: 0.3, fill: '#ffffff'
      }),
      createNode('ellipse', { name: 'Entering layer', x: 30, y: 40, width: 10, height: 10 })
    ]
  });

  const anticipationProgress = easePrototypeProgress(0.2, 'ease-in-back');
  assert.ok(anticipationProgress < 0, 'ease-in-back should retain its negative anticipation sample');
  const anticipated = interpolateSmartFrame(from, to, anticipationProgress, { allowOvershoot: true });
  assert.equal(anticipated.children.length, 1, 'destination-only layers stay absent before the transition midpoint');
  assert.ok(anticipated.children[0].x < from.children[0].x, 'matched layer position anticipates past its source');
  assert.ok(anticipated.children[0].width < from.children[0].width, 'matched layer size anticipates past its source');
  assert.equal(anticipated.opacity, from.opacity, 'frame opacity stays bounded at the source endpoint');
  assert.equal(anticipated.fill, from.fill, 'categorical paint stays at the source endpoint');

  const overshootProgress = easePrototypeProgress(0.4, 'spring-bouncy');
  assert.ok(overshootProgress > 1, 'spring-bouncy should retain its endpoint overshoot sample');
  const overshot = interpolateSmartFrame(from, to, overshootProgress, { allowOvershoot: true });
  const overshotWithoutOptIn = interpolateSmartFrame(from, to, overshootProgress);
  assert.equal(overshot.children.length, 2, 'destination-only layers appear at the destination endpoint');
  assert.ok(overshot.children[0].x > to.children[0].x, 'matched layer position overshoots the destination');
  assert.ok(overshot.children[0].width > to.children[0].width, 'matched layer size overshoots the destination');
  assert.ok(overshot.children[0].rotation > to.children[0].rotation, 'matched layer rotation keeps the spring overshoot');
  assert.equal(overshot.opacity, to.opacity, 'frame opacity remains in [0, 1] at overshoot');
  assert.ok(overshot.children[0].opacity >= 0 && overshot.children[0].opacity <= 1,
    'layer opacity remains valid while geometry overshoots');
  assert.equal(overshotWithoutOptIn.children[0].x, to.children[0].x,
    'non-presentation callers retain the historical clamped interpolation behavior');
  assert.equal(overshot.fill, to.fill, 'paint remains the authored destination color');
  assert.ok(overshot.width >= 0 && overshot.height >= 0 && overshot.children[0].width >= 0,
    'eased geometry never produces negative dimensions');
  assert.deepEqual(interpolateSmartFrame(from, to, 0, { allowOvershoot: true }), from,
    'the presentation opt-in preserves the exact source endpoint');
  assert.deepEqual(interpolateSmartFrame(from, to, 1, { allowOvershoot: true }), to,
    'the presentation opt-in preserves the exact destination endpoint');
});

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

test('smart animation switches frame clipping and overflow behavior at the midpoint', () => {
  const from = createNode('frame', {
    clip: false,
    overflowBehavior: 'none',
    children: [createNode('frame', {
      name: 'Scrollable panel', clip: false, overflowBehavior: 'none',
      children: [createNode('rectangle', { name: 'Overflow content', x: 180, y: 180 })]
    })]
  });
  const to = createNode('frame', {
    clip: true,
    overflowBehavior: 'vertical',
    children: [createNode('frame', {
      name: 'Scrollable panel', clip: true, overflowBehavior: 'both',
      children: [createNode('rectangle', { name: 'Overflow content', x: 180, y: 180 })]
    })]
  });
  const sample = progress => interpolateSmartFrame(from, to, progress);

  assert.deepEqual(
    [sample(0.001).clip, sample(0.001).overflowBehavior,
      sample(0.001).children[0].clip, sample(0.001).children[0].overflowBehavior],
    [false, 'none', false, 'none'],
    'destination clipping must not activate while the transition is still at the source side'
  );
  assert.deepEqual(
    [sample(0.499).clip, sample(0.499).overflowBehavior,
      sample(0.499).children[0].clip, sample(0.499).children[0].overflowBehavior],
    [false, 'none', false, 'none']
  );
  assert.deepEqual(
    [sample(0.5).clip, sample(0.5).overflowBehavior,
      sample(0.5).children[0].clip, sample(0.5).children[0].overflowBehavior],
    [true, 'vertical', true, 'both'],
    'clipping and scrolling activate atomically with other categorical properties at halfway'
  );
  assert.deepEqual(sample(0), from, 'source clipping settings remain exact at the endpoint');
  assert.deepEqual(sample(1), to, 'destination clipping settings remain exact at the endpoint');
});

test('smart animation switches a child fixed-position flag at the scroll-mode midpoint', () => {
  const from = createNode('frame', {
    overflowBehavior: 'vertical',
    children: [createNode('rectangle', { name: 'Pinned badge', fixedPositionWhenScrolling: false })]
  });
  const to = createNode('frame', {
    overflowBehavior: 'vertical',
    children: [createNode('rectangle', { name: 'Pinned badge', fixedPositionWhenScrolling: true })]
  });
  const at = progress => interpolateSmartFrame(from, to, progress).children[0].fixedPositionWhenScrolling;

  assert.equal(at(0.499), false, 'the source child stays attached to scrolling content before halfway');
  assert.equal(at(0.5), true, 'the fixed layer becomes stationary atomically at halfway');
});

test('smart animation interpolates imported affine scale and shear without changing authored endpoints', () => {
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Imported card' })] });
  const to = createNode('frame', { children: [createNode('rectangle', {
    name: 'Imported card', affineTransform: { a: 2, b: .2, c: .6, d: 1.4 }
  })] });
  const determinant = matrix => matrix.a * matrix.d - matrix.b * matrix.c;
  const at = progress => interpolateSmartFrame(from, to, progress).children[0];
  const quarter = at(.25).affineTransform;
  const middle = at(.5).affineTransform;
  const threeQuarter = at(.75).affineTransform;

  assert.equal(at(0).affineTransform, undefined, 'the source endpoint retains the missing-identity representation');
  assert.deepEqual(at(1).affineTransform, to.children[0].affineTransform, 'the destination endpoint remains exact');
  for (const matrix of [quarter, middle, threeQuarter]) {
    assert.ok(Object.values(matrix).every(Number.isFinite));
    assert.ok(determinant(matrix) > 1e-12, 'every intermediate transform remains invertible');
  }
  assert.notDeepEqual(quarter, middle, 'the matrix changes continuously through the transition');
  assert.notDeepEqual(middle, threeQuarter, 'the matrix continues changing after halfway');
  assert.equal(from.children[0].affineTransform, undefined, 'the source document is not mutated');
});

test('smart animation uses polar rotation and keeps reflected affine layers invertible', () => {
  const makePair = (start, end) => {
    const from = createNode('frame', { children: [createNode('rectangle', { name: 'Card', affineTransform: start })] });
    const to = createNode('frame', { children: [createNode('rectangle', { name: 'Card', affineTransform: end })] });
    return progress => interpolateSmartFrame(from, to, progress).children[0].affineTransform;
  };
  const determinant = matrix => matrix.a * matrix.d - matrix.b * matrix.c;
  const halfTurn = makePair(
    { a: 1, b: 0, c: 0, d: 1 },
    { a: -1, b: 0, c: 0, d: -1 }
  );
  assert.ok(Math.abs(determinant(halfTurn(.5)) - 1) < 1e-9,
    'a 180-degree matrix transition rotates through a valid quarter turn instead of collapsing to zero');

  const reflectedScale = makePair(
    { a: -1, b: 0, c: 0, d: 1 },
    { a: -2, b: .2, c: .3, d: 1.5 }
  );
  for (const progress of [.1, .25, .5, .75, .9]) {
    assert.ok(determinant(reflectedScale(progress)) < -1e-12,
      `reflection orientation remains stable at progress ${progress}`);
  }
});

test('smart animation snaps affine reflection changes at the midpoint instead of creating a singular matrix', () => {
  const fromMatrix = { a: 1, b: 0, c: 0, d: 1 };
  const toMatrix = { a: -1, b: 0, c: 0, d: 1 };
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Card', affineTransform: fromMatrix })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Card', affineTransform: toMatrix })] });
  const at = progress => interpolateSmartFrame(from, to, progress).children[0].affineTransform;

  assert.deepEqual(at(.499), fromMatrix, 'the source reflection state remains before the midpoint');
  assert.deepEqual(at(.5), toMatrix, 'the target reflection state switches at the midpoint');
  assert.equal(at(1).a * at(1).d - at(1).b * at(1).c, -1);
});

test('smart animation interpolates independent corner radii continuously and preserves exact endpoints', () => {
  const fromRadii = { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 };
  const toRadii = { topLeft: 20, topRight: 40, bottomRight: 60, bottomLeft: 80 };
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Card', cornerRadii: fromRadii })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Card', cornerRadii: toRadii })] });
  const originalFrom = structuredClone(from);
  const originalTo = structuredClone(to);
  const layerAt = progress => interpolateSmartFrame(from, to, progress).children[0];

  assert.deepEqual(layerAt(0).cornerRadii, fromRadii, 'the source endpoint keeps its authored radii');
  assert.deepEqual(layerAt(0.25).cornerRadii, { topLeft: 8, topRight: 16, bottomRight: 24, bottomLeft: 32 });
  assert.deepEqual(layerAt(0.5).cornerRadii, { topLeft: 12, topRight: 24, bottomRight: 36, bottomLeft: 48 });
  assert.deepEqual(layerAt(1).cornerRadii, toRadii, 'the destination endpoint keeps its authored radii');
  assert.deepEqual(from, originalFrom, 'interpolation leaves the source radii unchanged');
  assert.deepEqual(to, originalTo, 'interpolation leaves the destination radii unchanged');
});

test('smart animation interpolates the shared corner-smoothing value continuously', () => {
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Card', radius: 20, cornerSmoothing: 0.2 })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Card', radius: 20, cornerSmoothing: 0.8 })] });
  const layerAt = progress => interpolateSmartFrame(from, to, progress).children[0];
  assert.equal(layerAt(0).cornerSmoothing, 0.2);
  assert.equal(layerAt(0.5).cornerSmoothing, 0.5);
  assert.equal(layerAt(1).cornerSmoothing, 0.8);
});

test('smart animation transitions smoothly between linked and independent corner radii', () => {
  const independent = { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 };
  const independentStart = createNode('frame', { children: [createNode('rectangle', {
    name: 'Card', radius: 2, cornerRadii: independent
  })] });
  const linkedEnd = createNode('frame', { children: [createNode('rectangle', { name: 'Card', radius: 20 })] });
  const linkedToIndependentStart = createNode('frame', { children: [createNode('rectangle', { name: 'Card', radius: 30 })] });
  const independentEnd = createNode('frame', { children: [createNode('rectangle', {
    name: 'Card', radius: 3, cornerRadii: independent
  })] });
  const layerAt = (from, to, progress) => interpolateSmartFrame(from, to, progress).children[0];

  assert.deepEqual(layerAt(independentStart, linkedEnd, 0).cornerRadii, independent,
    'the source endpoint retains independent corner mode');
  assert.deepEqual(layerAt(independentStart, linkedEnd, 0.25).cornerRadii,
    { topLeft: 8, topRight: 11, bottomRight: 14, bottomLeft: 17 });
  const linkedEndpoint = layerAt(independentStart, linkedEnd, 1);
  assert.equal(Object.hasOwn(linkedEndpoint, 'cornerRadii'), false, 'the linked destination endpoint has no independent radii');
  assert.equal(linkedEndpoint.radius, 20);

  const linkedEndpointStart = layerAt(linkedToIndependentStart, independentEnd, 0);
  assert.equal(Object.hasOwn(linkedEndpointStart, 'cornerRadii'), false, 'the linked source endpoint has no independent radii');
  assert.equal(linkedEndpointStart.radius, 30);
  assert.deepEqual(layerAt(linkedToIndependentStart, independentEnd, 0.25).cornerRadii,
    { topLeft: 23.5, topRight: 24.5, bottomRight: 25.5, bottomLeft: 26.5 });
  assert.deepEqual(layerAt(linkedToIndependentStart, independentEnd, 1).cornerRadii, independent,
    'the independent destination endpoint retains its authored radii');
});

test('smart animation interpolates independent radii on the transition frames themselves', () => {
  const independent = { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 };
  const from = createNode('frame', { radius: 2, cornerRadii: independent });
  const to = createNode('frame', { radius: 20 });

  assert.deepEqual(interpolateSmartFrame(from, to, 0).cornerRadii, independent);
  assert.deepEqual(interpolateSmartFrame(from, to, 0.5).cornerRadii,
    { topLeft: 12, topRight: 14, bottomRight: 16, bottomLeft: 18 });
  const endpoint = interpolateSmartFrame(from, to, 1);
  assert.equal(Object.hasOwn(endpoint, 'cornerRadii'), false);
  assert.equal(endpoint.radius, 20);
});

test('smart animation blends matching per-vertex radii and switches arrays with shape topology', () => {
  const fromRadii = Array(10).fill(2);
  const toRadii = Array.from({ length: 10 }, (_, index) => 4 + index);
  const from = createNode('frame', { children: [createNode('star', {
    name: 'Badge', points: 5, radius: 1, vertexRadii: fromRadii
  })] });
  const to = createNode('frame', { children: [createNode('star', {
    name: 'Badge', points: 5, radius: 2, vertexRadii: toRadii
  })] });
  const midpoint = interpolateSmartFrame(from, to, .5).children[0];
  assert.deepEqual(midpoint.vertexRadii, fromRadii.map((radius, index) => (radius + toRadii[index]) / 2));
  assert.deepEqual(interpolateSmartFrame(from, to, 0).children[0].vertexRadii, fromRadii);
  assert.deepEqual(interpolateSmartFrame(from, to, 1).children[0].vertexRadii, toRadii);

  const changedTopology = createNode('frame', { children: [createNode('star', {
    name: 'Badge', points: 6, radius: 2, vertexRadii: Array(12).fill(8)
  })] });
  const beforeSwitch = interpolateSmartFrame(from, changedTopology, .25).children[0];
  const afterSwitch = interpolateSmartFrame(from, changedTopology, .75).children[0];
  assert.equal(beforeSwitch.points, 5);
  assert.equal(beforeSwitch.vertexRadii.length, 10);
  assert.equal(afterSwitch.points, 6);
  assert.deepEqual(afterSwitch.vertexRadii, Array(12).fill(8));
});

test('smart animation uses the resolved variable radius when blending into independent corners', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Radius');
  const radiusVariable = createVariable(document, collection.id, 'Card radius', 'number', 42);
  const source = createNode('frame', { children: [createNode('rectangle', {
    name: 'Card', cornerRadii: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 }
  })] });
  const target = createNode('frame', { children: [createNode('rectangle', { name: 'Card', radius: 3 })] });
  addNode(document, source);
  addNode(document, target);
  const targetCard = target.children[0];
  assert.equal(bindVariable(document, targetCard.id, radiusVariable.id, 'radius'), true);
  assert.equal(getNodePropertyValue(document, targetCard, 'radius'), 42);

  const middle = interpolateSmartFrame(source, target, 0.5, {
    resolveRadius: node => getNodePropertyValue(document, node, 'radius')
  });
  assert.deepEqual(middle.children[0].cornerRadii,
    { topLeft: 23, topRight: 25, bottomRight: 27, bottomLeft: 29 },
    'the mode-resolved uniform radius is expanded before interpolation instead of using its stale local fallback');
});

test('smart animation interpolates stroke miter limits and switches stroke presentation at the midpoint', () => {
  const fromStroke = { strokeMiterLimit: 4, strokePattern: 'dashed', strokeCap: 'square', strokeJoin: 'bevel' };
  const toStroke = { strokeMiterLimit: 10, strokePattern: 'dotted', strokeCap: 'round', strokeJoin: 'round' };
  const from = createNode('frame', { children: [createNode('line', { name: 'Stroke', ...fromStroke })] });
  const to = createNode('frame', { children: [createNode('line', { name: 'Stroke', ...toStroke })] });
  const layerAt = progress => interpolateSmartFrame(from, to, progress).children[0];
  const styleOf = layer => ({
    strokeMiterLimit: layer.strokeMiterLimit,
    strokePattern: layer.strokePattern,
    strokeCap: layer.strokeCap,
    strokeJoin: layer.strokeJoin
  });

  assert.deepEqual(styleOf(layerAt(0)), fromStroke, 'the source endpoint preserves the exact authored stroke style');
  assert.deepEqual(styleOf(layerAt(0.25)), {
    ...fromStroke, strokeMiterLimit: 5.5
  });
  assert.deepEqual(styleOf(layerAt(0.499)), {
    ...fromStroke, strokeMiterLimit: 6.994
  }, 'categorical stroke settings remain on the source through the instant before halfway');
  assert.deepEqual(styleOf(layerAt(0.5)), {
    ...toStroke, strokeMiterLimit: 7
  }, 'categorical stroke settings switch together at halfway while the miter limit continues numerically');
  assert.deepEqual(styleOf(layerAt(0.75)), {
    ...toStroke, strokeMiterLimit: 8.5
  });
  assert.deepEqual(styleOf(layerAt(1)), toStroke, 'the destination endpoint preserves the exact authored stroke style');
});

test('smart animation interpolates compatible ordered stroke items and midpoint-snaps incompatible identities', () => {
  const makeStroke = (id, color, width, opacity, pattern, cap, join, miterLimit, blendMode = 'normal') => ({
    id, color, width, opacity, visible: true, pattern, cap, join, miterLimit, blendMode
  });
  const fromStack = [makeStroke('inner', '#000000', 2, .2, 'solid', 'butt', 'miter', 10, 'screen')];
  const toStack = [makeStroke('inner', '#ffffff', 6, .8, 'dashed', 'round', 'bevel', 4, 'multiply')];
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Card', strokes: fromStack })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Card', strokes: toStack })] });
  const at = progress => interpolateSmartFrame(from, to, progress).children[0].strokes;
  assert.deepEqual(at(0), fromStack);
  assert.deepEqual(at(1), toStack);
  const quarter = at(.25)[0];
  assert.deepEqual({ ...quarter, opacity: Number(quarter.opacity.toFixed(2)) }, makeStroke('inner', '#404040', 3, .35, 'solid', 'butt', 'miter', 8.5, 'screen'));
  assert.deepEqual(at(.5), [makeStroke('inner', '#808080', 4, .5, 'dashed', 'round', 'bevel', 7, 'multiply')]);

  const incompatibleTarget = createNode('frame', { children: [createNode('rectangle', {
    name: 'Card', strokes: [makeStroke('replacement', '#ffffff', 6, .8, 'solid', 'butt', 'miter', 10)]
  })] });
  const stackAt = progress => interpolateSmartFrame(from, incompatibleTarget, progress).children[0].strokes;
  assert.deepEqual(stackAt(.499), fromStack, 'items with different identities stay discrete before halfway');
  assert.deepEqual(stackAt(.5), incompatibleTarget.children[0].strokes, 'the full stack switches atomically at halfway');
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

test('smart animation interpolates list spacing and switches paragraph list structure at the midpoint', () => {
  const from = createNode('frame', { children: [createNode('text', {
    name: 'List', text: 'First\nSecond', listSpacing: 4
  })] });
  const paragraphStyles = [
    { listStyle: 'bulleted', listLevel: 0 },
    { listStyle: 'numbered', listLevel: 1, listStart: 3 }
  ];
  const to = createNode('frame', { children: [createNode('text', {
    name: 'List', text: 'First\nSecond', listSpacing: 18, paragraphStyles
  })] });
  const layerAt = progress => interpolateSmartFrame(from, to, progress).children[0];

  assert.equal(Object.hasOwn(layerAt(0), 'paragraphStyles'), false, 'the exact source endpoint preserves the legacy plain-text shape');
  assert.deepEqual(layerAt(0.25).paragraphStyles, undefined, 'the source paragraph structure remains plain before halfway');
  assert.deepEqual([layerAt(0.25).listSpacing, layerAt(0.49).listSpacing], [7.5, 10.86]);
  assert.deepEqual(layerAt(0.5).paragraphStyles, paragraphStyles, 'list formatting switches at the midpoint');
  assert.equal(layerAt(0.5).listSpacing, 11, 'list spacing continues to interpolate as its metadata switches');
  assert.equal(layerAt(0.75).listSpacing, 14.5);
  assert.deepEqual(layerAt(1).paragraphStyles, paragraphStyles, 'the destination endpoint preserves its list metadata');
  assert.equal(layerAt(1).listSpacing, 18);
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

test('smart animation interpolates normalized gradient geometry handles and stops', () => {
  const fromGradient = {
    type: 'linear', angle: 350,
    geometry: { handles: [
      { id: 'from-start', x: .1, y: .2 },
      { id: 'from-axis', x: .3, y: .4 },
      { id: 'from-end', x: .1, y: .6 }
    ] },
    stops: [
      { id: 'from-stop-a', position: 0, color: '#000000' },
      { id: 'from-stop-b', position: .5, color: '#ff0000' }
    ]
  };
  const toGradient = {
    type: 'linear', angle: 10,
    geometry: { handles: [
      { id: 'to-start', x: .5, y: .6 },
      { id: 'to-axis', x: .7, y: .8 },
      { id: 'to-end', x: .5, y: 1 }
    ] },
    stops: [
      { id: 'to-stop-a', position: .2, color: '#ffffff' },
      { id: 'to-stop-b', position: 1, color: '#0000ff' }
    ]
  };
  const from = createNode('frame', { children: [
    createNode('rectangle', { name: 'Direct gradient', fillGradient: fromGradient }),
    createNode('rectangle', { name: 'Stack gradient', fills: [
      { id: 'gradient', type: 'linear', visible: true, opacity: 1, gradient: fromGradient }
    ] })
  ] });
  const to = createNode('frame', { children: [
    createNode('rectangle', { name: 'Direct gradient', fillGradient: toGradient }),
    createNode('rectangle', { name: 'Stack gradient', fills: [
      { id: 'gradient', type: 'linear', visible: true, opacity: 1, gradient: toGradient }
    ] })
  ] });
  const originalFrom = structuredClone(from);
  const originalTo = structuredClone(to);

  const middle = interpolateSmartFrame(from, to, .5);
  const direct = middle.children[0].fillGradient;
  const stacked = middle.children[1].fills[0].gradient;
  const expectedGeometry = { handles: [
    { id: 'to-start', x: .3, y: .4 },
    { id: 'to-axis', x: .5, y: .6 },
    { id: 'to-end', x: .3, y: .8 }
  ] };
  assert.deepEqual(direct.geometry.handles.map(handle => handle.id), expectedGeometry.handles.map(handle => handle.id));
  direct.geometry.handles.forEach((handle, index) => {
    assert.ok(Math.abs(handle.x - expectedGeometry.handles[index].x) < 1e-12);
    assert.ok(Math.abs(handle.y - expectedGeometry.handles[index].y) < 1e-12);
  });
  assert.deepEqual(stacked.geometry, direct.geometry);
  assert.deepEqual(direct.stops.map(({ position, color }) => [position, color]), [
    [.1, '#808080'], [.75, '#800080']
  ]);
  assert.deepEqual(stacked.stops, direct.stops, 'modern paint stacks use the same interpolation');
  assert.equal(direct.angle, 0, 'the existing wrapped-angle interpolation remains intact');
  assert.deepEqual(interpolateSmartFrame(from, to, 0).children[0].fillGradient, fromGradient);
  assert.deepEqual(interpolateSmartFrame(from, to, 1).children[0].fillGradient, toGradient);
  assert.deepEqual(from, originalFrom, 'interpolation leaves the source handles and stops unchanged');
  assert.deepEqual(to, originalTo, 'interpolation leaves the destination handles and stops unchanged');
});

test('smart animation midpoint-snaps gradient geometry through singular and near-singular bases', () => {
  const gradient = (endY, color, angle) => ({
    type: 'linear', angle,
    geometry: { handles: [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: endY }
    ] },
    stops: [
      { id: 'start', position: 0, color },
      { id: 'end', position: 1, color: '#ffffff' }
    ]
  });
  const fromGradient = gradient(1, '#000000', 10);
  const toGradient = gradient(-1, '#ff0000', 20);
  const makeFrame = value => createNode('frame', { children: [
    createNode('rectangle', { name: 'Direct', fillGradient: value }),
    createNode('rectangle', { name: 'Stack', fills: [
      { id: 'gradient', type: 'linear', visible: true, opacity: 1, gradient: value }
    ] })
  ] });
  const from = makeFrame(fromGradient);
  const to = makeFrame(toGradient);
  const sample = progress => {
    const nodes = interpolateSmartFrame(from, to, progress).children;
    return [nodes[0].fillGradient, nodes[1].fills[0].gradient];
  };
  const assertGeometry = (gradients, expected, label) => {
    for (const current of gradients) {
      assert.deepEqual(current.geometry, expected.geometry, `${label}: geometry stays on a stable endpoint basis`);
    }
  };
  const assertAxisY = (gradients, expected, label) => {
    for (const current of gradients) {
      assert.equal(current.geometry.handles[2].y, expected, `${label}: both direct and stacked gradients use the expected interpolated axis`);
    }
  };

  assertAxisY(sample(.25), .5, 'well-conditioned progress interpolates normally');
  assertGeometry(sample(.499999999), fromGradient, 'near-singular progress before halfway snaps back to source');
  const middle = sample(.5);
  assertGeometry(middle, toGradient, 'the singular midpoint selects the destination geometry');
  assertGeometry(sample(.500000001), toGradient, 'near-singular progress after halfway snaps to destination');
  assertAxisY(sample(.75), -.5, 'well-conditioned progress after halfway interpolates normally');
  assert.equal(middle[0].stops[0].color, '#800000', 'stop colors remain continuous through the geometry fallback');
  assert.equal(middle[0].angle, 15, 'angle interpolation remains continuous through the geometry fallback');
  assert.deepEqual(from.children[0].fillGradient, fromGradient, 'the source gradient is not mutated');
  assert.deepEqual(to.children[0].fillGradient, toGradient, 'the destination gradient is not mutated');
});

test('smart animation keeps mixed or malformed gradient geometry on the midpoint snapshot path', () => {
  const legacy = {
    type: 'linear', angle: 0,
    stops: [
      { id: 'legacy-a', position: 0, color: '#000000' },
      { id: 'legacy-b', position: 1, color: '#ffffff' }
    ]
  };
  const geometry = {
    ...legacy,
    geometry: { handles: [{ x: .1, y: .2 }, { x: .4, y: .5 }, { x: .8, y: .9 }] }
  };
  const malformed = {
    ...geometry,
    geometry: { handles: [{ x: .1, y: .2 }, { x: .4, y: .5 }] }
  };
  const frameFor = gradient => createNode('frame', { children: [
    createNode('rectangle', { name: 'Direct', fillGradient: gradient }),
    createNode('rectangle', { name: 'Stack', fills: [
      { id: 'gradient', type: 'linear', visible: true, opacity: 1, gradient }
    ] })
  ] });
  const assertSnaps = (from, to, source, destination, label) => {
    const before = interpolateSmartFrame(from, to, .25).children;
    const after = interpolateSmartFrame(from, to, .75).children;
    assert.deepEqual(before[0].fillGradient, source, `${label}: direct gradient stays at source before midpoint`);
    assert.deepEqual(before[1].fills[0].gradient, source, `${label}: stack gradient stays at source before midpoint`);
    assert.deepEqual(after[0].fillGradient, destination, `${label}: direct gradient switches at midpoint`);
    assert.deepEqual(after[1].fills[0].gradient, destination, `${label}: stack gradient switches at midpoint`);
  };

  assertSnaps(frameFor(geometry), frameFor(legacy), geometry, legacy, 'geometry to legacy');
  assertSnaps(frameFor(legacy), frameFor(geometry), legacy, geometry, 'legacy to geometry');
  assertSnaps(frameFor(malformed), frameFor(geometry), malformed, geometry, 'invalid handle topology');
});

test('smart animation interpolates compatible modern fill stacks on frames and layers without mutating endpoint snapshots', () => {
  const fromFills = [
    { id: 'solid-before', type: 'solid', visible: true, opacity: .2, color: '#000000', blendMode: 'screen' },
    { id: 'gradient-before', type: 'linear', visible: true, opacity: .4, blendMode: 'darken', gradient: {
      type: 'linear', angle: 350,
      stops: [
        { id: 'before-start', position: 0, color: '#000000' },
        { id: 'before-end', position: .5, color: '#ff0000' }
      ]
    } }
  ];
  const toFills = [
    { id: 'solid-after', type: 'solid', visible: true, opacity: .8, color: '#ffffff', blendMode: 'multiply' },
    { id: 'gradient-after', type: 'linear', visible: true, opacity: .8, blendMode: 'overlay', gradient: {
      type: 'linear', angle: 10,
      stops: [
        { id: 'after-start', position: .5, color: '#ffffff' },
        { id: 'after-end', position: 1, color: '#0000ff' }
      ]
    } }
  ];
  const from = createNode('frame', { fills: fromFills, children: [createNode('rectangle', { name: 'Card', fills: fromFills })] });
  const to = createNode('frame', { fills: toFills, children: [createNode('rectangle', { name: 'Card', fills: toFills })] });
  const originals = [structuredClone(from), structuredClone(to)];
  const at = progress => interpolateSmartFrame(from, to, progress);
  const quarter = at(.25);
  const midpoint = at(.5);

  for (const node of [quarter, quarter.children[0]]) {
    assert.deepEqual(node.fills.map(fill => fill.id), ['solid-before', 'gradient-before']);
    assert.deepEqual(node.fills.map(fill => fill.blendMode), ['screen', 'darken']);
    assert.ok(Math.abs(node.fills[0].opacity - .35) < Number.EPSILON * 2);
    assert.equal(node.fills[1].opacity, .5);
    assert.equal(node.fills[0].color, '#404040');
    assert.deepEqual(node.fills[1].gradient, {
      type: 'linear', angle: 355,
      stops: [
        { id: 'after-start', position: .125, color: '#404040' },
        { id: 'after-end', position: .625, color: '#bf0040' }
      ]
    });
  }
  for (const node of [midpoint, midpoint.children[0]]) {
    assert.deepEqual(node.fills.map(fill => fill.id), ['solid-after', 'gradient-after']);
    assert.deepEqual(node.fills.map(fill => fill.blendMode), ['multiply', 'overlay']);
    assert.equal(node.fills[0].opacity, .5);
    assert.ok(Math.abs(node.fills[1].opacity - .6) < Number.EPSILON * 2);
    assert.equal(node.fills[0].color, '#808080');
    assert.deepEqual(node.fills[1].gradient, {
      type: 'linear', angle: 0,
      stops: [
        { id: 'after-start', position: .25, color: '#808080' },
        { id: 'after-end', position: .75, color: '#800080' }
      ]
    });
  }
  assert.deepEqual(at(0).fills, fromFills, 'the starting fill stack is cloned exactly');
  assert.deepEqual(at(1).fills, toFills, 'the destination fill stack is cloned exactly');
  assert.deepEqual(at(0).children[0].fills, fromFills, 'the layer starting stack is cloned exactly');
  assert.deepEqual(at(1).children[0].fills, toFills, 'the layer destination stack is cloned exactly');
  assert.deepEqual(from, originals[0], 'interpolation leaves the source frame and its paints unchanged');
  assert.deepEqual(to, originals[1], 'interpolation leaves the destination frame and its paints unchanged');
});

test('smart animation crossfades fill type and gradient topology changes while preserving discrete bindings', () => {
  const solid = (id, changes = {}) => ({ id, type: 'solid', visible: true, opacity: .25, color: '#000000', ...changes });
  const linear = (id, stops = 2) => ({
    id, type: 'linear', visible: true, opacity: .5,
    gradient: { type: 'linear', angle: 0, stops: Array.from({ length: stops }, (_, index) => ({
      id: `${id}-stop-${index}`, position: index / (stops - 1), color: index ? '#ffffff' : '#000000'
    })) }
  });
  const from = createNode('frame', { children: [
    createNode('rectangle', { name: 'Type', fills: [solid('type-before')] }),
    createNode('rectangle', { name: 'Topology', fills: [linear('topology-before')] }),
    createNode('rectangle', { name: 'Visibility', fills: [linear('visibility-before')] }),
    createNode('rectangle', { name: 'Binding', fillVariableId: 'surface-light', fills: [solid('binding-before')] }),
    createNode('rectangle', { name: 'Length', fills: [solid('length-before')] })
  ] });
  const to = createNode('frame', { children: [
    createNode('rectangle', { name: 'Type', fills: [linear('type-after')] }),
    createNode('rectangle', { name: 'Topology', fills: [linear('topology-after', 3)] }),
    createNode('rectangle', { name: 'Visibility', fills: [linear('visibility-after')] }),
    createNode('rectangle', { name: 'Binding', fillVariableId: 'surface-dark', fills: [solid('binding-after', { color: '#ffffff' })] }),
    createNode('rectangle', { name: 'Length', fills: [solid('length-after'), solid('length-extra')] })
  ] });
  to.children[2].fills[0].visible = false;
  const before = interpolateSmartFrame(from, to, .25).children;
  const atMidpoint = interpolateSmartFrame(from, to, .5).children;
  for (const index of [0, 1]) {
    assert.deepEqual(before[index].fills.map(fill => fill.type), [from.children[index].fills[0].type, to.children[index].fills[0].type]);
    assert.ok(before[index].fills[0].opacity > 0 && before[index].fills[1].opacity > 0, 'both incompatible paints contribute before halfway');
    assert.ok(atMidpoint[index].fills[0].opacity > 0 && atMidpoint[index].fills[1].opacity > 0, 'both incompatible paints contribute at halfway');
  }
  for (const index of [2, 3, 4]) {
    assert.deepEqual(before[index].fills, from.children[index].fills, `case ${from.children[index].name} stays on the source stack before halfway`);
    assert.deepEqual(atMidpoint[index].fills, to.children[index].fills, `case ${from.children[index].name} takes the destination stack at halfway`);
  }
});

test('smart animation crossfades image-fill replacements while preserving exact endpoints', () => {
  const fromFill = { id: 'photo-before', type: 'image', visible: true, opacity: .2, imageFill: createImageFill('asset-before') };
  const toFill = { id: 'photo-after', type: 'image', visible: true, opacity: .8, imageFill: createImageFill('asset-after') };
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Photo', fills: [fromFill] })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Photo', fills: [toFill] })] });
  const at = progress => interpolateSmartFrame(from, to, progress).children[0].fills;

  const quarter = at(.25);
  assert.deepEqual(quarter.map(fill => fill.imageFill.assetId), ['asset-before', 'asset-after']);
  assert.ok(quarter.every(fill => fill.__smartAnimateLiveImageFill), 'both fills render from their source bitmaps instead of stale processed previews');
  assert.ok(Math.abs(quarter[0].opacity - .15) < Number.EPSILON * 2);
  assert.equal(quarter[1].opacity, .2, 'both image fills contribute with their own opacity');
  const middle = at(.5);
  assert.deepEqual(middle.map(fill => fill.imageFill.assetId), ['asset-before', 'asset-after']);
  assert.deepEqual(middle.map(fill => fill.opacity), [.1, .4], 'the crossfade remains continuous at halfway');
  assert.deepEqual(at(0), [fromFill], 'the source image fill snapshot stays exact');
  assert.deepEqual(at(1), [toFill], 'the destination image fill snapshot stays exact');
});

test('smart animation interpolates valid same-asset image crops and preserves quarter-turn transforms', () => {
  const fromTransforms = {
    crop: { left: .1, top: .15, right: .9, bottom: .85 },
    rotation: 0, flipHorizontal: false, flipVertical: true
  };
  const toTransforms = {
    crop: { left: .3, top: .35, right: .7, bottom: .65 },
    rotation: 90, flipHorizontal: false, flipVertical: true
  };
  const from = createNode('frame', { children: [createNode('image', {
    name: 'Same photo', assetId: 'photo', fit: 'cover', rotation: 350, transforms: fromTransforms
  })] });
  const to = createNode('frame', { children: [createNode('image', {
    name: 'Same photo', assetId: 'photo', fit: 'cover', rotation: 10, transforms: toTransforms
  })] });
  const at = progress => interpolateSmartFrame(from, to, progress).children[0];

  const quarter = at(.25);
  const threeQuarter = at(.75);
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should be close to ${expected}`);
  assert.deepEqual([quarter.transforms.rotation, quarter.transforms.flipHorizontal, quarter.transforms.flipVertical], [0, false, true]);
  assert.deepEqual([threeQuarter.transforms.rotation, threeQuarter.transforms.flipHorizontal, threeQuarter.transforms.flipVertical], [90, false, true]);
  for (const [field, expected] of Object.entries({ left: .15, top: .2, right: .85, bottom: .8 })) near(quarter.transforms.crop[field], expected);
  for (const [field, expected] of Object.entries({ left: .25, top: .3, right: .75, bottom: .7 })) near(threeQuarter.transforms.crop[field], expected);
  assert.equal(quarter.__smartAnimateLiveImageTransforms, true, 'the renderer receives the interpolated crop instead of a cached endpoint preview');
  assert.equal(threeQuarter.__smartAnimateLiveImageTransforms, true);
  assert.equal(quarter.rotation, 355, 'the image layer itself follows continuous shortest-path rotation');
  assert.equal(at(.5).rotation, 360);
  assert.deepEqual(at(0).transforms, fromTransforms, 'the authored source transform remains exact');
  assert.deepEqual(at(1).transforms, toTransforms, 'the authored destination transform remains exact');

  const fitFrom = createNode('frame', { children: [createNode('image', {
    name: 'Fit change', assetId: 'photo', fit: 'cover', transforms: fromTransforms
  })] });
  const fitTo = createNode('frame', { children: [createNode('image', {
    name: 'Fit change', assetId: 'photo', fit: 'contain', transforms: toTransforms
  })] });
  assert.equal(interpolateSmartFrame(fitFrom, fitTo, .25).children[0].fit, 'cover');
  assert.deepEqual(interpolateSmartFrame(fitFrom, fitTo, .25).children[0].transforms, fromTransforms,
    'a layer fit change keeps its associated image transform on the source snapshot');
  assert.equal(interpolateSmartFrame(fitFrom, fitTo, .5).children[0].fit, 'contain');
  assert.deepEqual(interpolateSmartFrame(fitFrom, fitTo, .5).children[0].transforms, toTransforms,
    'layer fit and transform switch together at the midpoint');
});

test('smart animation interpolates image crops and crossfades source-renderable asset, fit, and flip changes', () => {
  const cropA = { left: .1, top: .1, right: .9, bottom: .9 };
  const cropB = { left: .3, top: .2, right: .8, bottom: .7 };
  const imageFill = (assetId, crop, options = {}) => createImageFill(assetId, {
    fit: 'cover', transforms: { crop, rotation: 0, flipHorizontal: false, flipVertical: false }, ...options
  });
  const fill = (id, image, opacity = 1) => ({ id, type: 'image', visible: true, opacity, imageFill: image });
  const make = (name, image, opacity = 1) => createNode('rectangle', {
    name, fills: [fill(`fill-${name}`, image, opacity)]
  });
  const cases = [
    { name: 'same asset', from: imageFill('photo', cropA), to: imageFill('photo', cropB), interpolates: true },
    { name: 'asset replacement', from: imageFill('photo-a', null), to: imageFill('photo-b', null), crossfades: true },
    { name: 'fit change', from: imageFill('photo', null), to: imageFill('photo', null, { fit: 'contain' }), crossfades: true },
    { name: 'flip topology change', from: imageFill('photo', null), to: imageFill('photo', null, {
      transforms: { crop: null, rotation: 0, flipHorizontal: true, flipVertical: false }
    }), crossfades: true },
    { name: 'cropped asset replacement', from: imageFill('photo-a', cropA), to: imageFill('photo-b', cropB), crossfades: true },
    { name: 'adjusted asset replacement', from: imageFill('photo-a', null, { adjustments: { brightness: 10 } }), to: imageFill('photo-b', null), crossfades: false },
    { name: 'adjusted crop change', from: imageFill('photo', cropA, { adjustments: { brightness: 10 } }), to: imageFill('photo', cropB), crossfades: false }
  ];
  const from = createNode('frame', { children: cases.map(item => make(item.name, item.from, .2)) });
  const to = createNode('frame', { children: cases.map(item => make(item.name, item.to, .8)) });

  for (const [index, item] of cases.entries()) {
    const quarter = interpolateSmartFrame(from, to, .25).children[index].fills;
    const middle = interpolateSmartFrame(from, to, .5).children[index].fills;
    if (item.interpolates) {
      assert.equal(quarter.length, 1);
      assert.equal(quarter[0].imageFill.assetId, 'photo');
      assert.ok(Math.abs(quarter[0].imageFill.transforms.crop.left - .15) < Number.EPSILON * 2);
      assert.equal(quarter[0].imageFill.fit, 'cover');
      assert.equal(quarter[0].__smartAnimateLiveImageFill, true);
    } else if (item.crossfades) {
      assert.equal(quarter.length, 2, `${item.name} keeps both configurations alive before halfway`);
      assert.deepEqual(quarter.map(fill => fill.imageFill), [item.from, item.to]);
      assert.deepEqual(middle.map(fill => fill.imageFill), [item.from, item.to], `${item.name} remains a crossfade at halfway`);
      assert.ok(quarter.every(fill => fill.opacity > 0));
      assert.ok(quarter.every(fill => fill.__smartAnimateLiveImageFill), `${item.name} renders each source configuration directly`);
    } else {
      assert.equal(quarter.length, 1, `${item.name} keeps its processed preview on the source snapshot before halfway`);
      assert.deepEqual(quarter[0].imageFill, item.from);
      assert.deepEqual(middle[0].imageFill, item.to, `${item.name} switches to the processed destination at halfway`);
    }
  }
});

test('smart animation carries verified endpoint descriptors for processed image layers and fills', () => {
  const fromImage = createNode('image', {
    name: 'Edited image', assetId: 'photo', adjustments: { brightness: 12 },
    transforms: { crop: null, rotation: 0, flipHorizontal: false, flipVertical: false },
    inpaintStrokes: [{ radius: .04, points: [{ x: .1, y: .12 }] }]
  });
  const toImage = createNode('image', {
    name: 'Edited image', assetId: 'photo', adjustments: { brightness: 34 },
    transforms: { crop: null, rotation: 0, flipHorizontal: false, flipVertical: false },
    inpaintStrokes: [{ radius: .06, points: [{ x: .2, y: .24 }] }]
  });
  const fromFill = createNode('rectangle', {
    name: 'Processed fill', fills: [{ id: 'photo-fill', type: 'image', visible: true, opacity: .2,
      imageFill: createImageFill('photo-fill-source', { adjustments: { contrast: 14 } }) }]
  });
  const toFill = createNode('rectangle', {
    name: 'Processed fill', fills: [{ id: 'photo-fill', type: 'image', visible: true, opacity: .8,
      imageFill: createImageFill('photo-fill-target', { adjustments: { contrast: 42 } }) }]
  });
  const from = createNode('frame', { children: [fromImage, fromFill] });
  const to = createNode('frame', { children: [toImage, toFill] });
  const calls = [];
  const resolveImageTransition = input => {
    calls.push(input);
    return {
      from: { previewKey: `${input.kind}:from`, assetId: 'source', opacity: .2 },
      to: { previewKey: `${input.kind}:to`, assetId: 'target', opacity: .8 }
    };
  };

  const middle = interpolateSmartFrame(from, to, .25, { resolveImageTransition });
  const image = middle.children.find(node => node.name === 'Edited image');
  const fill = middle.children.find(node => node.name === 'Processed fill').fills[0];
  assert.equal(image.__smartAnimateImageTransition.progress, .25);
  assert.deepEqual(image.__smartAnimateImageTransition.from, { previewKey: 'image-layer:from', assetId: 'source', opacity: .2 });
  assert.equal(fill.__smartAnimateImageTransition.progress, .25);
  assert.equal(fill.__smartAnimateImageTransition.to.previewKey, 'image-fill:to');
  assert.equal(fill.imageFill.assetId, 'photo-fill-source', 'the transition marker keeps a safe categorical fallback paint');
  assert.deepEqual(calls.map(call => call.kind).sort(), ['image-fill', 'image-layer']);

  const endpoint = interpolateSmartFrame(from, to, 1, { resolveImageTransition: () => { throw new Error('endpoints must stay exact clones'); } });
  assert.equal(endpoint.children.find(node => node.name === 'Edited image').__smartAnimateImageTransition, undefined);
});

test('smart animation keeps malformed image transforms discrete instead of interpolating them', () => {
  const from = createNode('frame', { children: [createNode('image', {
    name: 'Malformed photo', assetId: 'photo', transforms: { crop: null, rotation: 0 }
  })] });
  const to = createNode('frame', { children: [createNode('image', {
    name: 'Malformed photo', assetId: 'photo', transforms: { crop: null, rotation: 90 }
  })] });
  from.children[0].transforms.rotation = 45;
  to.children[0].transforms.crop = { left: .7, top: .2, right: .3, bottom: .8 };

  const quarter = interpolateSmartFrame(from, to, .25).children[0].transforms;
  const threeQuarter = interpolateSmartFrame(from, to, .75).children[0].transforms;
  assert.deepEqual(quarter, from.children[0].transforms, 'an invalid source representation is preserved as a discrete source snapshot');
  assert.deepEqual(threeQuarter, to.children[0].transforms, 'an invalid destination representation is preserved as a discrete destination snapshot');
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

test('smart animation keeps outgoing unmatched layers in their authored stack positions', () => {
  const from = createNode('frame', { children: [
    createNode('ellipse', { name: 'Leaving bottom', opacity: 0.4 }),
    createNode('rectangle', { name: 'Back' }),
    createNode('ellipse', { name: 'Leaving middle', opacity: 0.8 }),
    createNode('ellipse', { name: 'Leaving adjacent', opacity: 0.6 }),
    createNode('rectangle', { name: 'Front' }),
    createNode('ellipse', { name: 'Leaving top', opacity: 0.4 })
  ] });
  const to = createNode('frame', { children: [
    createNode('rectangle', { name: 'Back' }),
    createNode('rectangle', { name: 'Entering middle' }),
    createNode('rectangle', { name: 'Front' })
  ] });

  const middle = interpolateSmartFrame(from, to, 0.5).children;
  assert.deepEqual(middle.map(node => node.name), [
    'Leaving bottom', 'Back', 'Entering middle', 'Leaving middle', 'Leaving adjacent', 'Front', 'Leaving top'
  ], 'outgoing layers stay beside their nearest surviving siblings instead of being appended above the destination stack');
  assert.equal(middle[0].opacity, 0.2, 'the outgoing bottom layer remains below its next surviving sibling while fading');
  assert.equal(middle[3].opacity, 0.4, 'the interleaved outgoing layer stays below its next surviving sibling while fading');
  assert.equal(middle[4].opacity, 0.3, 'adjacent outgoing layers retain their relative stack order');
  assert.equal(middle[6].opacity, 0.2, 'the outgoing top layer remains above its previous surviving sibling while fading');
});

test('smart animation keeps changed text matched while incompatible vector content crossfades', () => {
  const from = createNode('frame', { children: [
    createNode('text', { name: 'Title', text: 'Before', x: 10, width: 40, opacity: 0.8 }),
    createNode('path', { name: 'Icon', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }),
    createNode('network', { name: 'Branch', vertices: [{ id: 'v1', x: 0, y: 0 }, { id: 'v2', x: 1, y: 1 }], edges: [{ id: 'e1', from: 'v1', to: 'v2' }], faces: [] })
  ] });
  const to = createNode('frame', { children: [
    createNode('text', { name: 'Title', text: 'After', x: 110, width: 80 }),
    createNode('path', { name: 'Icon', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 20, y: 20 }] }),
    createNode('network', { name: 'Branch', vertices: [{ id: 'v1', x: 0, y: 0 }, { id: 'v2', x: .5, y: 1 }, { id: 'v3', x: 1, y: 0 }], edges: [{ id: 'e1', from: 'v1', to: 'v2' }, { id: 'e2', from: 'v2', to: 'v3' }], faces: [] })
  ] });

  const middle = interpolateSmartFrame(from, to, 0.5);
  const titles = middle.children.filter(node => node.name === 'Title');
  const icons = middle.children.filter(node => node.name === 'Icon');
  const networks = middle.children.filter(node => node.name === 'Branch');
  assert.equal(titles.length, 1, 'same-name text layers remain matched when their content changes');
  assert.deepEqual([titles[0].text, titles[0].x, titles[0].width], ['After', 60, 60],
    'text switches at halfway while layer geometry interpolates');
  const beforeMidpoint = interpolateSmartFrame(from, to, 0.499).children.find(node => node.name === 'Title');
  assert.equal(beforeMidpoint.text, 'Before');
  assert.ok(Math.abs(beforeMidpoint.x - 59.9) < 1e-9);
  assert.equal(interpolateSmartFrame(from, to, 0).children.find(node => node.name === 'Title').text, 'Before');
  assert.equal(interpolateSmartFrame(from, to, 1).children.find(node => node.name === 'Title').text, 'After');
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

test('smart animation morphs compound contours only when every contour keeps its topology', () => {
  const contour = offset => ({ closed: true, points: [
    { x: offset, y: 0 }, { x: offset + .2, y: 0 }, { x: offset + .2, y: .2 }
  ] });
  const from = createNode('frame', { children: [createNode('path', {
    name: 'Compound', fillRule: 'nonzero', points: contour(0).points, closed: true, subpaths: [contour(.3)]
  })] });
  const to = createNode('frame', { children: [createNode('path', {
    name: 'Compound', fillRule: 'evenodd', points: contour(.2).points, closed: true, subpaths: [contour(.5)]
  })] });
  const middle = interpolateSmartFrame(from, to, .25).children[0];
  assert.equal(middle.subpaths.length, 1);
  assert.equal(middle.points[0].x, .05);
  assert.equal(middle.subpaths[0].points[0].x, .35);
  assert.equal(middle.fillRule, 'nonzero');
  assert.equal(interpolateSmartFrame(from, to, .5).children[0].fillRule, 'evenodd');

  to.children[0].subpaths.push(contour(.8));
  const crossfade = interpolateSmartFrame(from, to, .5).children;
  assert.equal(crossfade.length, 2, 'different contour counts crossfade instead of connecting unrelated outlines');
});

test('smart animation morphs a compatible vector network without crossfading its graph', () => {
  const fromNetwork = {
    vertices: [
      { id: 'v1', x: 0, y: 0, label: 'start', cornerRadius: 4 },
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
      { id: 'v1', x: .2, y: .4, label: 'end', cornerRadius: 12 },
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
  assert.equal(middle[0].vertices[0].cornerRadius, 8, 'matching network vertex corner radii interpolate continuously');
  assert.equal(beforeMidpoint.vertices[0].cornerRadius, 7.992, 'the radius morph remains continuous before the midpoint');
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

test('smart animation crossfades vector networks with changed edge direction, identity, or face traversal order', () => {
  const base = {
    vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 0, y: 1 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'ca', from: 'c', to: 'a' }],
    faces: [{ id: 'face', vertexIds: ['a', 'b', 'c'] }]
  };
  const incompatible = [
    { ...base, edges: [{ ...base.edges[0], from: 'b', to: 'a' }, ...base.edges.slice(1)] },
    { ...base, edges: [{ ...base.edges[0], id: 'renamed-edge' }, ...base.edges.slice(1)] },
    { ...base, faces: [{ id: 'face', vertexIds: ['a', 'c', 'b'] }] },
    {
      ...base,
      vertices: [{ ...base.vertices[0], id: 'renamed' }, ...base.vertices.slice(1)],
      edges: [{ ...base.edges[0], from: 'renamed' }, base.edges[1], { ...base.edges[2], to: 'renamed' }],
      faces: [{ id: 'face', vertexIds: ['renamed', 'b', 'c'] }]
    }
  ];

  for (const [index, targetNetwork] of incompatible.entries()) {
    const from = createNode('frame', { children: [createNode('network', { name: `Topology ${index}`, ...base })] });
    const to = createNode('frame', { children: [createNode('network', { name: `Topology ${index}`, ...targetNetwork })] });
    const copies = interpolateSmartFrame(from, to, .5).children;
    assert.equal(copies.length, 2, `network topology variant ${index} crossfades`);
    assert.deepEqual(copies.map(node => node.opacity), [.5, .5]);
  }
});

test('smart animation matches reordered vector network records by stable ID', () => {
  const fromNetwork = {
    vertices: [
      { id: 'a', x: 0, y: 0 }, { id: 'b', x: 2, y: 0 },
      { id: 'c', x: 2, y: 2 }, { id: 'd', x: 0, y: 2 }
    ],
    edges: [
      { id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' },
      { id: 'ca', from: 'c', to: 'a', control1: { x: 2.2, y: 2.4 } },
      { id: 'cd', from: 'c', to: 'd' }, { id: 'da', from: 'd', to: 'a' }
    ],
    faces: [
      { id: 'f1', vertexIds: ['a', 'b', 'c'], fill: '#000000', fillOpacity: .2 },
      { id: 'f2', vertexIds: ['a', 'c', 'd'], fill: '#ff0000', fillOpacity: .4 }
    ]
  };
  const targetNetwork = {
    vertices: [
      { id: 'c', x: 4, y: 6 }, { id: 'd', x: 2, y: 6 },
      { id: 'a', x: 2, y: 4 }, { id: 'b', x: 4, y: 4 }
    ],
    edges: [
      { id: 'da', from: 'd', to: 'a' }, { id: 'ca', from: 'c', to: 'a', control1: { x: 5, y: 7 } },
      { id: 'ab', from: 'a', to: 'b' }, { id: 'cd', from: 'c', to: 'd' },
      { id: 'bc', from: 'b', to: 'c' }
    ],
    faces: [
      { id: 'f2', vertexIds: ['a', 'c', 'd'], fill: '#ffffff', fillOpacity: .8 },
      { id: 'f1', vertexIds: ['a', 'b', 'c'], fill: '#00ff00', fillOpacity: .6 }
    ]
  };
  const from = createNode('frame', { children: [createNode('network', { name: 'Reordered', ...fromNetwork })] });
  const to = createNode('frame', { children: [createNode('network', { name: 'Reordered', ...targetNetwork })] });
  const middle = interpolateSmartFrame(from, to, .5).children;

  assert.equal(middle.length, 1, 'storage-order changes keep the graph continuously morphing');
  assert.deepEqual(middle[0].vertices.map(vertex => vertex.id), ['c', 'd', 'a', 'b']);
  assert.deepEqual(middle[0].vertices.map(({ x, y }) => [x, y]), [[3, 4], [1, 4], [1, 2], [3, 2]]);
  assert.deepEqual(middle[0].edges.map(edge => edge.id), ['da', 'ca', 'ab', 'cd', 'bc']);
  const control1 = middle[0].edges.find(edge => edge.id === 'ca').control1;
  assert.ok(Math.abs(control1.x - 3.6) < 1e-12);
  assert.ok(Math.abs(control1.y - 4.7) < 1e-12);
  assert.deepEqual(middle[0].faces.map(face => face.id), ['f2', 'f1']);
  assert.equal(middle[0].faces[0].fill, '#ff8080', 'faces interpolate their style by identity');
  assert.ok(Math.abs(middle[0].faces[0].fillOpacity - .6) < 1e-12);
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
    { text: 'Hello ', fontSize: 12, fontWeight: '400', lineHeight: 1, letterSpacing: -2, baselineShift: -4, color: '#000000' },
    { text: 'world', fontSize: 20, fontWeight: 500, lineHeight: 1.2, letterSpacing: 0, baselineShift: 2, color: '#204060' }
  ];
  const toRuns = [
    { text: 'Hello ', fontSize: 32, fontWeight: 700, lineHeight: 2, letterSpacing: 4, baselineShift: 8, color: '#ffffff' },
    { text: 'world', fontSize: 40, fontWeight: 800, lineHeight: 1.8, letterSpacing: 6, baselineShift: -6, color: '#e0a080' }
  ];
  const from = createNode('frame', { children: [createNode('text', { name: 'Headline', text: 'Hello world', textRuns: fromRuns })] });
  const to = createNode('frame', { children: [createNode('text', { name: 'Headline', text: 'Hello world', textRuns: toRuns })] });

  const middleRuns = interpolateSmartFrame(from, to, 0.5).children[0].textRuns;
  assert.deepEqual(middleRuns, [
    { text: 'Hello ', fontSize: 22, fontWeight: 550, lineHeight: 1.5, letterSpacing: 1, baselineShift: 2, color: '#808080' },
    { text: 'world', fontSize: 30, fontWeight: 650, lineHeight: 1.5, letterSpacing: 3, baselineShift: -2, color: '#807070' }
  ]);

  assert.deepEqual(interpolateSmartFrame(from, to, 0).children[0].textRuns, fromRuns, 'the starting endpoint keeps its original run values');
  assert.deepEqual(interpolateSmartFrame(from, to, 1).children[0].textRuns, toRuns, 'the destination endpoint keeps its original run values');
  assert.deepEqual(interpolateSmartFrame(from, to, -1).children[0].textRuns, fromRuns, 'progress below zero clamps to the starting endpoint');
  assert.deepEqual(interpolateSmartFrame(from, to, 2).children[0].textRuns, toRuns, 'progress above one clamps to the destination endpoint');
  assert.deepEqual(from.children[0].textRuns, fromRuns, 'interpolation leaves source runs unchanged');
  assert.deepEqual(to.children[0].textRuns, toRuns, 'interpolation leaves destination runs unchanged');
});

test('smart animation interpolates inherited run metrics through the layer styles while preserving sparse runs', () => {
  const from = createNode('frame', { children: [createNode('text', {
    name: 'Inherited', text: 'Title', fontSize: 12, fontWeight: 300, lineHeight: 1, letterSpacing: -2,
    color: '#000000', textRuns: [{ text: 'Title' }]
  })] });
  const to = createNode('frame', { children: [createNode('text', {
    name: 'Inherited', text: 'Title', fontSize: 28, fontWeight: 700, lineHeight: 2, letterSpacing: 6,
    color: '#ffffff', textRuns: [{ text: 'Title' }]
  })] });

  const middle = interpolateSmartFrame(from, to, .25).children[0];
  assert.deepEqual(middle.textRuns, [{ text: 'Title' }], 'inherited styles stay sparse on the run');
  assert.deepEqual([middle.fontSize, middle.fontWeight, middle.lineHeight, middle.letterSpacing, middle.color], [16, 400, 1.25, 0, '#404040']);
});

test('smart animation snaps rich text continuously only when run content matches and no typography binding is active', () => {
  const makeFrame = ({ text = 'Title', variableBindings = {}, textVariableId = null, value = 0 } = {}) => createNode('frame', { children: [createNode('text', {
    name: 'Bound title', text, fontSize: 12 + value, color: value ? '#ffffff' : '#000000',
    textVariableId, variableBindings,
    textRuns: [{ text, fontSize: 12 + value, baselineShift: value, color: value ? '#ffffff' : '#000000' }]
  })] });
  const from = makeFrame({ variableBindings: { fontSize: 'font-size-light' }, value: 0 });
  const to = makeFrame({ variableBindings: { fontSize: 'font-size-dark' }, value: 20 });
  const quarter = interpolateSmartFrame(from, to, .25).children[0];
  assert.deepEqual(quarter.textRuns, from.children[0].textRuns, 'a variable-bound typography value keeps its authored run style until midpoint');
  assert.equal(quarter.fontSize, from.children[0].fontSize);
  assert.deepEqual(quarter.variableBindings, from.children[0].variableBindings);
  assert.deepEqual(interpolateSmartFrame(from, to, .5).children[0].textRuns, to.children[0].textRuns);

  const changedContentFrom = createNode('frame', { children: [createNode('text', {
    name: 'Changing title', text: 'Before', textRuns: [{ text: 'Before', baselineShift: 2 }]
  })] });
  const changedContentTo = createNode('frame', { children: [createNode('text', {
    name: 'Changing title', text: 'After', textRuns: [{ text: 'After', baselineShift: 18 }]
  })] });
  assert.deepEqual(interpolateSmartFrame(changedContentFrom, changedContentTo, .25).children[0].textRuns,
    changedContentFrom.children[0].textRuns, 'changed content remains a discrete text transition');

  const colorBoundFrom = makeFrame({ textVariableId: 'light-text', value: 0 });
  const colorBoundTo = makeFrame({ textVariableId: 'dark-text', value: 20 });
  assert.deepEqual(interpolateSmartFrame(colorBoundFrom, colorBoundTo, .25).children[0].textRuns,
    colorBoundFrom.children[0].textRuns, 'text color variable bindings prevent interpolation of the run palette');
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
      id: 'shadow-after', color: '#ffffff', opacity: 0.8, offsetX: 10, offsetY: -4, blur: 10, visible: true
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
    ['shadow-after', 'drop-shadow', true], ['blur-after', 'layer-blur', true]
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

test('smart animation interpolates texture size and spread safely while clip-to-shape switches at halfway', () => {
  const fromEffect = createLayerEffect('texture', {
    id: 'texture-before', sizeX: 0.7, sizeY: 1.1, radius: 4, clipToShape: true
  });
  const toEffect = createLayerEffect('texture', {
    id: 'texture-after', sizeX: 2.7, sizeY: 5.1, radius: 20, clipToShape: false
  });
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Paper', effects: [fromEffect] })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Paper', effects: [toEffect] })] });
  const at = progress => interpolateSmartFrame(from, to, progress).children[0].effects[0];
  assert.deepEqual([at(0.25).sizeX, at(0.25).sizeY, at(0.25).radius], [1.2, 2.1, 8]);
  assert.equal(at(0.25).clipToShape, true, 'clip mode remains source-owned before halfway');
  assert.deepEqual([at(0.75).sizeX, at(0.75).sizeY, at(0.75).radius], [2.2, 4.1, 16]);
  assert.equal(at(0.75).clipToShape, false, 'clip mode switches at halfway');
  assert.deepEqual(at(0), fromEffect);
  assert.deepEqual(at(1), toEffect);

  const without = createNode('frame', { children: [createNode('rectangle', { name: 'Paper', effects: [] })] });
  const withTexture = createNode('frame', { children: [createNode('rectangle', { name: 'Paper', effects: [toEffect] })] });
  assert.deepEqual(interpolateSmartFrame(without, withTexture, 0.25).children[0].effects, [], 'a new edge-distress operation snaps as a whole because it has no opacity control');
  assert.deepEqual(interpolateSmartFrame(without, withTexture, 0.5).children[0].effects, [toEffect]);
});

test('smart animation interpolates Glass optics with wrapped light angles and snaps insertion at halfway', () => {
  const fromEffect = createLayerEffect('glass', {
    id: 'glass-before', lightAngle: 350, lightIntensity: 20, refraction: 10, depth: 30,
    dispersion: 0, frost: 10, splay: 20
  });
  const toEffect = createLayerEffect('glass', {
    id: 'glass-after', lightAngle: 10, lightIntensity: 80, refraction: 90, depth: 70,
    dispersion: 100, frost: 60, splay: 40
  });
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Glass card', fillOpacity: .5, effects: [fromEffect] })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Glass card', fillOpacity: .5, effects: [toEffect] })] });
  const at = progress => interpolateSmartFrame(from, to, progress).children[0].effects[0];
  assert.deepEqual([at(.25).lightAngle, at(.5).lightAngle, at(.75).lightAngle], [355, 0, 5], 'light direction takes the short circular route');
  assert.deepEqual([at(.25).lightIntensity, at(.25).refraction, at(.25).depth, at(.25).dispersion, at(.25).frost, at(.25).splay], [35, 30, 40, 25, 22.5, 25]);
  assert.deepEqual(at(0), fromEffect);
  assert.deepEqual(at(1), toEffect);

  const empty = createNode('frame', { children: [createNode('rectangle', { name: 'Glass card', effects: [] })] });
  const withGlass = createNode('frame', { children: [createNode('rectangle', { name: 'Glass card', fillOpacity: .5, effects: [toEffect] })] });
  assert.deepEqual(interpolateSmartFrame(empty, withGlass, .25).children[0].effects, [], 'new Glass has no opacity channel, so its full stack waits until halfway');
  assert.deepEqual(interpolateSmartFrame(empty, withGlass, .5).children[0].effects, [toEffect]);
});

test('smart animation smoothly interpolates noise settings and keeps a stable texture recipe', () => {
  const fromEffect = createLayerEffect('noise', {
    id: 'grain-before', mode: 'duo', sizeX: 2, sizeY: 4, density: 20,
    color: '#000000', color2: '#ffffff', opacity: 0.2
  });
  const toEffect = createLayerEffect('noise', {
    id: 'grain-after', mode: 'multi', sizeX: 10, sizeY: 12, density: 80,
    color: '#ff0000', color2: '#00ff00', opacity: 0.8
  });
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: [fromEffect] })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: [toEffect] })] });
  const at = progress => interpolateSmartFrame(from, to, progress).children[0].effects[0];
  const quarter = at(0.25);
  const middle = at(0.5);
  const threeQuarter = at(0.75);
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should be close to ${expected}`);
  assert.equal(quarter.mode, 'duo', 'the color-count mode remains source-owned before halfway');
  assert.deepEqual([quarter.sizeX, quarter.sizeY, quarter.density], [4, 6, 35]);
  near(quarter.opacity, 0.35);
  assert.equal(quarter.color, '#400000');
  assert.equal(quarter.color2, '#bfffbf');
  assert.equal(middle.mode, 'multi', 'categorical color-count mode switches at halfway');
  assert.deepEqual([middle.sizeX, middle.sizeY, middle.density], [6, 8, 50]);
  near(middle.opacity, 0.5);
  assert.equal(threeQuarter.mode, 'multi');
  assert.deepEqual([threeQuarter.sizeX, threeQuarter.sizeY, threeQuarter.density], [8, 10, 65]);
  near(threeQuarter.opacity, 0.65);
  assert.equal(threeQuarter.color, '#bf0000');
  assert.deepEqual(at(0), fromEffect, 'the start frame keeps its exact saved effect');
  assert.deepEqual(at(1), toEffect, 'the end frame keeps its exact saved effect');
  assert.deepEqual(JSON.parse(JSON.stringify(quarter)), quarter, 'intermediate noise settings remain locally serializable');
});

test('smart animation fades inserted noise while preserving its deterministic layer and effect identity', () => {
  const noise = createLayerEffect('noise', {
    id: 'grain-added', mode: 'mono', sizeX: 3, sizeY: 5, density: 60, color: '#334455', opacity: 0.8
  });
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: [] })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: [noise] })] });
  const incoming = interpolateSmartFrame(from, to, 0.25).children[0].effects[0];
  assert.equal(incoming.id, 'grain-added');
  assert.equal(incoming.type, 'noise');
  assert.equal(incoming.opacity, 0.2, 'a newly appearing noise texture ramps from transparent');
  assert.deepEqual([incoming.sizeX, incoming.sizeY, incoming.density], [3, 5, 60]);
  assert.equal(incoming.color, '#334455');
  assert.deepEqual(interpolateSmartFrame(from, to, 0).children[0].effects, []);
  assert.deepEqual(interpolateSmartFrame(from, to, 1).children[0].effects, [noise]);
});

test('smart animation interpolates background-blur radius and effect insertion continuously', () => {
  const fromEffect = createLayerEffect('background-blur', { id: 'backdrop-before', radius: 4 });
  const toEffect = createLayerEffect('background-blur', { id: 'backdrop-after', radius: 20 });
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: [fromEffect] })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: [toEffect] })] });
  const middle = interpolateSmartFrame(from, to, .25).children[0].effects[0];
  assert.equal(middle.type, 'background-blur');
  assert.equal(middle.id, 'backdrop-before');
  assert.equal(middle.radius, 8);
  const inserted = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: [] })] });
  const withEffect = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: [toEffect] })] });
  assert.equal(interpolateSmartFrame(inserted, withEffect, .5).children[0].effects[0].radius, 10);
});

test('smart animation interpolates compatible inner-shadow color and geometry without mutating or leaking non-serializable values', () => {
  const fromEffect = createLayerEffect('inner-shadow', {
    id: 'inner-before', color: '#000000', opacity: 0.2, offsetX: 0, offsetY: 2, blur: 2
  });
  const toEffect = createLayerEffect('inner-shadow', {
    id: 'inner-after', color: '#ffffff', opacity: 0.8, offsetX: 8, offsetY: -6, blur: 10
  });
  const from = createNode('frame', { children: [createNode('rectangle', { effects: [fromEffect] })] });
  const to = createNode('frame', { children: [createNode('rectangle', { effects: [toEffect] })] });
  const originalFrom = structuredClone(from);
  const originalTo = structuredClone(to);
  const quarterFrame = interpolateSmartFrame(from, to, 0.25);
  const quarter = quarterFrame.children[0].effects[0];
  assert.equal(quarter.type, 'inner-shadow');
  assert.equal(quarter.id, 'inner-before');
  assert.equal(quarter.color, '#404040');
  assert.ok(Math.abs(quarter.opacity - 0.35) < 1e-12);
  assert.equal(quarter.offsetX, 2);
  assert.equal(quarter.offsetY, 0);
  assert.equal(quarter.blur, 4);
  const threeQuarter = interpolateSmartFrame(from, to, 0.75).children[0].effects[0];
  assert.equal(threeQuarter.id, 'inner-after');
  assert.equal(threeQuarter.color, '#bfbfbf');
  assert.ok(Math.abs(threeQuarter.opacity - 0.65) < 1e-12);
  assert.equal(threeQuarter.offsetX, 6);
  assert.equal(threeQuarter.offsetY, -4);
  assert.equal(threeQuarter.blur, 8);
  assert.deepEqual(interpolateSmartFrame(from, to, 0).children[0].effects, [fromEffect]);
  assert.deepEqual(interpolateSmartFrame(from, to, 1).children[0].effects, [toEffect]);
  assert.deepEqual(JSON.parse(JSON.stringify(quarterFrame)), quarterFrame, 'a rendered keyframe round-trips as ordinary JSON');
  assert.deepEqual(from, originalFrom, 'interpolation does not mutate source effect values');
  assert.deepEqual(to, originalTo, 'interpolation does not mutate destination effect values');
});

test('smart animation keeps inner-shadow stacks discrete when visibility compatibility changes', () => {
  const fromEffect = createLayerEffect('inner-shadow', {
    id: 'inner-before', visible: true, color: '#123456', opacity: 0.2, offsetX: -5, offsetY: 2, blur: 3
  });
  const toEffect = createLayerEffect('inner-shadow', {
    id: 'inner-after', visible: false, color: '#abcdef', opacity: 0.8, offsetX: 9, offsetY: -6, blur: 12
  });
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: [fromEffect] })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: [toEffect] })] });

  const beforeMidpoint = interpolateSmartFrame(from, to, 0.25);
  const atMidpoint = interpolateSmartFrame(from, to, 0.5);
  assert.equal(beforeMidpoint.children.length, 1, 'an effect visibility change does not turn the matched layer into a crossfade');
  assert.deepEqual(beforeMidpoint.children[0].effects, [fromEffect], 'visibility mismatch preserves the complete source stack before halfway');
  assert.equal(atMidpoint.children.length, 1);
  assert.deepEqual(atMidpoint.children[0].effects, [toEffect], 'the full destination stack switches at the midpoint');
});

test('smart animation smoothly adds and removes compatible trailing effects', () => {
  const fromShadow = createLayerEffect('drop-shadow', {
    id: 'shadow-before', color: '#000000', opacity: 0.2, offsetX: 0, offsetY: 2, blur: 2
  });
  const toShadow = createLayerEffect('drop-shadow', {
    id: 'shadow-after', color: '#ffffff', opacity: 0.8, offsetX: 8, offsetY: -6, blur: 10
  });
  const addedInnerShadow = createLayerEffect('inner-shadow', {
    id: 'shadow-before', color: '#204060', opacity: 0.6, offsetX: 2, offsetY: 4, blur: 8
  });
  const addedBlur = createLayerEffect('layer-blur', { id: 'blur-entering', radius: 8 });
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: [fromShadow] })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Card', effects: [toShadow, addedInnerShadow, addedBlur] })] });
  const at = (start, end, progress) => interpolateSmartFrame(start, end, progress).children[0].effects;

  const quarter = at(from, to, 0.25);
  const threeQuarter = at(from, to, 0.75);
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should be close to ${expected}`);
  assert.equal(quarter.length, 3, 'the incoming tail is present as a valid zero-to-full contribution');
  assert.equal(new Set(quarter.map(effect => effect.id)).size, quarter.length, 'the transient union keeps effect IDs unique even if endpoints reused an ID');
  assert.equal(quarter[0].color, '#404040', 'the matched prefix continues to interpolate while the tail enters');
  assert.equal(quarter[0].offsetX, 2);
  near(quarter[1].opacity, 0.15);
  assert.equal(quarter[2].radius, 2);
  near(threeQuarter[1].opacity, 0.45);
  assert.equal(threeQuarter[2].radius, 6);
  assert.deepEqual(at(from, to, 0), [fromShadow], 'the source endpoint retains its exact stack shape');
  assert.deepEqual(at(from, to, 1), [toShadow, addedInnerShadow, addedBlur], 'the destination endpoint retains its exact stack shape');
  assert.deepEqual(JSON.parse(JSON.stringify(quarter)), quarter, 'the intermediate effect stack remains serialization-safe');

  const reverseQuarter = at(to, from, 0.25);
  assert.equal(reverseQuarter.length, 3, 'an outgoing tail remains present while it fades');
  assert.equal(new Set(reverseQuarter.map(effect => effect.id)).size, reverseQuarter.length);
  near(reverseQuarter[1].opacity, 0.45);
  assert.equal(reverseQuarter[2].radius, 6);
  assert.deepEqual(at(to, from, 1), [fromShadow], 'the reverse destination endpoint removes the completed tail');
});

test('smart animation snaps effect stacks with incompatible count, order, or invalid values at the midpoint', () => {
  const shadow = createLayerEffect('drop-shadow', { id: 'shadow', color: '#000000', opacity: 0.2, offsetX: 0, offsetY: 2, blur: 2 });
  const blur = createLayerEffect('layer-blur', { id: 'blur', radius: 2 });
  const changedCount = [createLayerEffect('layer-blur', { id: 'blur-end', radius: 10 })];
  const changedOrder = [createLayerEffect('layer-blur', { ...blur, id: 'blur-end', radius: 10 }), createLayerEffect('drop-shadow', { ...shadow, id: 'shadow-end', color: '#ffffff' })];
  const invalidValue = [createLayerEffect('drop-shadow', { ...shadow, id: 'shadow-end', color: 'red' })];
  const innerShadow = createLayerEffect('inner-shadow', {
    id: 'inner-before', color: '#000000', opacity: 0.2, offsetX: 0, offsetY: 2, blur: 2
  });
  const changedInnerShadowType = [createLayerEffect('drop-shadow', {
    id: 'drop-after', color: '#ffffff', opacity: 0.8, offsetX: 4, offsetY: 6, blur: 10
  })];
  const invalidInnerShadowColor = [createLayerEffect('inner-shadow', {
    id: 'inner-after', color: 'transparent', opacity: 0.8, offsetX: 4, offsetY: 6, blur: 10
  })];
  const stacks = [
    { from: [shadow, blur], to: changedCount },
    { from: [shadow, blur], to: changedOrder },
    { from: [shadow], to: invalidValue },
    { from: [innerShadow], to: changedInnerShadowType },
    { from: [innerShadow], to: invalidInnerShadowColor }
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
    assert.equal(interpolateSmartFrame(from, to, 0.25).children.length, 1, 'incompatible effects on an otherwise matched layer use midpoint fallback instead of crossfading the layer');
  }
});

test('smart animation preserves the exact authored frame snapshots at both transition endpoints', () => {
  const from = createNode('frame', {
    name: 'Source',
    rendererMetadata: { sourceOnly: true },
    children: [
      createNode('rectangle', { name: 'Shared', x: 10, rendererMetadata: { revision: 'source' } }),
      createNode('path', { name: 'Source mask', visible: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    ]
  });
  const to = createNode('frame', {
    name: 'Destination',
    rendererMetadata: { destinationOnly: true },
    children: [
      createNode('rectangle', { name: 'Shared', x: 20, rendererMetadata: { revision: 'destination' } }),
      createNode('network', { name: 'Destination mask', vertices: [], edges: [], faces: [] })
    ]
  });
  const originalFrom = structuredClone(from);
  const originalTo = structuredClone(to);

  const start = interpolateSmartFrame(from, to, 0);
  const end = interpolateSmartFrame(from, to, 1);
  assert.deepEqual(start, originalFrom, 'the start is the complete source snapshot, including unsupported metadata and child topology');
  assert.deepEqual(end, originalTo, 'the end is the complete destination snapshot without zero-opacity source leftovers');
  assert.notEqual(start, from, 'endpoint snapshots are cloned so callers cannot mutate either authored frame');
  assert.notEqual(end, to, 'endpoint snapshots are cloned so callers cannot mutate either authored frame');
  assert.deepEqual(from, originalFrom);
  assert.deepEqual(to, originalTo);
});

test('smart animation rejects non-frame endpoints and clamps its progress', () => {
  const from = createNode('frame', { children: [createNode('rectangle', { name: 'Shape', x: 0 })] });
  const to = createNode('frame', { children: [createNode('rectangle', { name: 'Shape', x: 100 })] });
  assert.throws(() => interpolateSmartFrame(createNode('rectangle'), to, 0.5), /requires two frames/);
  assert.equal(interpolateSmartFrame(from, to, -2).children[0].x, 0);
  assert.equal(interpolateSmartFrame(from, to, 2).children[0].x, 100);
});
