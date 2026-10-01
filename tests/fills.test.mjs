import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createComponent, createComponentInstance, createDocument, createGradientFill, createNode, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { createGradientPaint, gradientFillToCSS, insertGradientStop, isFillStackSupported, isValidGradientFill, resolveGradientGeometry, sampleGradientColor, setGradientStopOpacity } from '../src/fills.js';
import { createImageFill, defaultImageAdjustments, isImageFillSupported, isValidImageFill } from '../src/image-fills.js';

test('image fills default to uncropped upright pixels and validate crop, rotation, and flips', () => {
  const defaults = createImageFill('asset-photo');
  assert.deepEqual(defaults.transforms, { crop: null, rotation: 0, flipHorizontal: false, flipVertical: false });
  assert.deepEqual(defaults.adjustments, defaultImageAdjustments);
  assert.equal(isValidImageFill(defaults), true);

  const creativeFill = createImageFill('asset-photo', { adjustments: { highlights: 34, shadows: -28, autoContrast: true, posterizeBits: 5, solarize: true, solarizeThreshold: 80, invert: true } });
  assert.equal(isValidImageFill(creativeFill), true);
  assert.equal(isValidImageFill({ ...creativeFill, adjustments: { ...creativeFill.adjustments, posterizeBits: 9 } }), false);
  assert.equal(isValidImageFill({ ...creativeFill, adjustments: { ...creativeFill.adjustments, highlights: 101 } }), false);

  const cropped = createImageFill('asset-photo', {
    transforms: { crop: { left: 0.12, top: 0.08, right: 0.92, bottom: 0.88 }, rotation: 90, flipHorizontal: true }
  });
  assert.deepEqual(cropped.transforms, { crop: { left: 0.12, top: 0.08, right: 0.92, bottom: 0.88 }, rotation: 90, flipHorizontal: true, flipVertical: false });
  assert.equal(isValidImageFill(cropped), true);

  for (const transforms of [
    { crop: { left: -0.01, top: 0, right: 0.8, bottom: 1 }, rotation: 0 },
    { crop: { left: 0.6, top: 0, right: 0.6, bottom: 1 }, rotation: 0 },
    { crop: null, rotation: 45 },
    { crop: null, rotation: 90.5 },
    { crop: null, rotation: 0, flipVertical: 'yes' }
  ]) {
    assert.equal(isValidImageFill({ ...defaults, transforms }), false);
  }
  assert.throws(() => createImageFill('asset-photo', { transforms: { crop: { left: 0, top: 0, right: 1.1, bottom: 1 } } }), /crop edges/);
  assert.throws(() => createImageFill('asset-photo', { transforms: { rotation: 45 } }), /quarter turns/);
});

test('image-fill crop and rotation remain attached to the same source after document reload', () => {
  const document = createDocument();
  const fill = createImageFill('asset-photo', {
    transforms: { crop: { left: 0.125, top: 0.25, right: 0.875, bottom: 0.75 }, rotation: 270 },
    adjustments: { brightness: 18, saturation: -12 }
  });
  const shape = createNode('rectangle', { imageFill: fill });
  addNode(document, shape);

  const reopened = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reopened), true);
  assert.deepEqual(reopened.pages[0].children[0].imageFill.transforms, fill.transforms);
  assert.deepEqual(reopened.pages[0].children[0].imageFill.adjustments, fill.adjustments);
  assert.equal(reopened.pages[0].children[0].imageFill.assetId, 'asset-photo', 'reloading edits leaves the original asset identity unchanged');
});

test('compound paths with any closed contour support ordered solid and image fills', () => {
  const path = createNode('path', {
    closed: false,
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    subpaths: [{ closed: true, points: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .5, y: .8 }] }]
  });
  assert.equal(isFillStackSupported(path), true);
  assert.equal(isImageFillSupported(path), true);

  path.subpaths[0].closed = false;
  assert.equal(isFillStackSupported(path), false);
  assert.equal(isImageFillSupported(path), false);
});

test('linear, radial, and angular gradients survive local design serialization', () => {
  const document = createDocument();
  const linear = createNode('rectangle', { fillGradient: createGradientFill('linear', '#ff0000') });
  linear.fillGradient.stops[1].color = '#0000ff';
  linear.fillGradient.angle = 135;
  linear.fillGradient.geometry = { handles: [
    { x: -.1, y: .5 }, { x: .9, y: .5 }, { x: -.1, y: 1.5 }
  ] };
  const radial = createNode('ellipse', { fillGradient: createGradientFill('radial', '#00ff00') });
  radial.fillGradient.geometry = { handles: [
    { x: .5, y: .5 }, { x: .8, y: .5 }, { x: .5, y: .9 }
  ] };
  const angular = createNode('rectangle', { fillGradient: createGradientFill('angular', '#ff00ff') });
  angular.fillGradient.angle = 270;
  addNode(document, linear); addNode(document, radial); addNode(document, angular);
  const restored = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(restored), true);
  assert.deepEqual(restored.pages[0].children.map(node => node.fillGradient), [linear.fillGradient, radial.fillGradient, angular.fillGradient]);
});

test('gradient validation rejects invalid types, unsupported layers, and unordered stops', () => {
  const valid = createGradientFill('linear');
  assert.equal(isValidGradientFill(valid), true);
  const document = createDocument();
  addNode(document, createNode('text', { fillGradient: valid }));
  assert.throws(() => validateDocument(document), /Gradient fill is not supported/);
  const invalid = createDocument();
  const shape = createNode('rectangle', { fillGradient: valid });
  shape.fillGradient.stops.reverse();
  addNode(invalid, shape);
  assert.throws(() => validateDocument(invalid), /Invalid gradient fill/);
  assert.throws(() => createGradientFill('conic'), /Unsupported gradient fill/);
});

test('gradient stop alpha is editable, bounded, and preserved in canvas paint stops', () => {
  const gradient = createGradientFill('angular', '#ff0000');
  const [start, end] = gradient.stops;
  assert.equal(setGradientStopOpacity(gradient, start.id, 0.25), true);
  assert.equal(setGradientStopOpacity(gradient, end.id, 1.5), true, 'UI percentages are safely clamped to opaque');
  assert.equal(start.opacity, 0.25);
  assert.equal(end.opacity, 1);
  assert.equal(setGradientStopOpacity(gradient, 'missing-stop', 0.5), false);
  assert.equal(setGradientStopOpacity(gradient, start.id, Number.NaN), false);

  const calls = [];
  const context = {
    createConicGradient(...args) {
      calls.push(['conic', ...args]);
      return { addColorStop: (...stop) => calls.push(['stop', ...stop]) };
    }
  };
  createGradientPaint(context, gradient, 0, 0, 100, 100);
  assert.deepEqual(calls.slice(1), [
    ['stop', 0, 'rgba(255, 0, 0, 0.25)'],
    ['stop', 1, '#ffffff']
  ]);
  assert.equal(gradientFillToCSS(gradient), 'conic-gradient(from 0deg at 50% 50%, rgba(255, 0, 0, 0.25) 0%, rgba(255, 255, 255, 1) 100%)');
});

test('component gradient overrides validate before they can be synchronized into instances', () => {
  const document = createDocument();
  const master = createNode('rectangle'); addNode(document, master);
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  instance.componentOverrides[master.id] = { fillGradient: { type: 'linear', angle: 0, stops: [] } };
  assert.throws(() => validateDocument(document), /Invalid component gradient override/);
});

test('canvas gradient geometry follows angle and radial center while CSS includes fill opacity', () => {
  const calls = [];
  const context = {
    createLinearGradient(...args) { calls.push(['linear', ...args]); return { addColorStop: (...stop) => calls.push(['stop', ...stop]) }; },
    createRadialGradient(...args) { calls.push(['radial', ...args]); return { addColorStop: (...stop) => calls.push(['stop', ...stop]) }; },
    createConicGradient(...args) { calls.push(['conic', ...args]); return { addColorStop: (...stop) => calls.push(['stop', ...stop]) }; }
  };
  const linear = createGradientFill('linear', '#ff0000');
  linear.stops[1].color = '#0000ff';
  createGradientPaint(context, linear, 10, 20, 100, 50);
  assert.deepEqual(calls[0], ['linear', 10, 45, 110, 45]);
  const radial = createGradientFill('radial', '#123456');
  calls.length = 0;
  createGradientPaint(context, radial, 10, 20, 100, 50);
  assert.deepEqual(calls[0], ['radial', 60, 45, 0, 60, 45, Math.hypot(100, 50) / 2]);
  assert.equal(gradientFillToCSS(linear, 0.5), 'linear-gradient(90deg, rgba(255, 0, 0, 0.5) 0%, rgba(0, 0, 255, 0.5) 100%)');

  const angular = createGradientFill('angular', '#ff0000');
  angular.stops[1].color = '#0000ff';
  angular.angle = 90;
  calls.length = 0;
  createGradientPaint(context, angular, 10, 20, 100, 50);
  assert.deepEqual(calls[0], ['conic', 0, 60, 45], '90° begins at the right side of the shape and proceeds clockwise');
  assert.deepEqual(calls.slice(1), [['stop', 0, '#ff0000'], ['stop', 1, '#0000ff']]);
  assert.equal(gradientFillToCSS(angular, 0.5), 'conic-gradient(from 90deg at 50% 50%, rgba(255, 0, 0, 0.5) 0%, rgba(0, 0, 255, 0.5) 100%)');
  assert.equal(resolveGradientGeometry(angular, { width: 100, height: 50 }), null,
    'the initial angular tool exposes a rotation control and uses the layer center instead of pretending to be affine radial geometry');
});

test('gradient geometry validates finite bounded and well-conditioned affine handles', () => {
  const base = createGradientFill('linear');
  const geometryGradient = handles => ({ ...base, geometry: { handles } });
  assert.equal(isValidGradientFill(geometryGradient([
    { x: -.5, y: .5 }, { x: .5, y: .5 }, { x: -.5, y: 1.5 }
  ])), true);
  assert.equal(isValidGradientFill(geometryGradient([
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }
  ])), false, 'collinear basis handles cannot define a 2D transform');
  assert.equal(isValidGradientFill(geometryGradient([
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 1 + Number.EPSILON }
  ])), false, 'near-parallel handles cannot pass model validation and then fail SVG conversion');
  assert.equal(isValidGradientFill(geometryGradient([
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 1 + 1e-14 }
  ])), true, 'a small but representable angular difference remains valid');
  assert.equal(isValidGradientFill(geometryGradient([
    { x: 0, y: 0 }, { x: 1e-200, y: 0 }, { x: 0, y: 1e-200 }
  ])), true, 'basis validity is independent of uniform coordinate scale');
  assert.equal(isValidGradientFill(geometryGradient([
    { x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 1, y: 0 }
  ])), false);
  assert.equal(isValidGradientFill(geometryGradient([
    { x: 0, y: 0 }, { x: 1_000_001, y: 0 }, { x: 0, y: 1 }
  ])), false, 'extreme finite values are bounded to avoid hostile transforms');
  assert.equal(isValidGradientFill({ ...base, geometry: { handles: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } }), false);
});

test('gradient geometry resolver handles subnormal scales and empty object axes consistently', () => {
  const tiny = createGradientFill('linear');
  tiny.geometry = { handles: [
    { x: 0, y: 0 }, { x: 1e-200, y: 0 }, { x: 0, y: 1e-200 }
  ] };
  assert.ok(resolveGradientGeometry(tiny, { x: 0, y: 0, width: 100, height: 50 }),
    'the valid normalized basis is not rejected when its pixel determinant underflows');

  const horizontal = createGradientFill('linear');
  horizontal.geometry = { handles: [
    { x: .25, y: .5 }, { x: .75, y: .5 }, { x: .25, y: 1.5 }
  ] };
  assert.deepEqual(resolveGradientGeometry(horizontal, { x: 4, y: 9, width: 20, height: 0 }), {
    type: 'linear', source: 'geometry', handles: [
      { x: 9, y: 9.5 }, { x: 19, y: 9.5 }, { x: 9, y: 10.5 }
    ]
  }, 'zero-sized local axes use the same one-pixel extent as SVG export');
});

test('gradient geometry resolver maps authored and legacy handles without mutating gradients', () => {
  const legacyLinear = createGradientFill('linear');
  legacyLinear.angle = 0;
  const legacyBefore = structuredClone(legacyLinear);
  assert.deepEqual(resolveGradientGeometry(legacyLinear, { x: 10, y: 20, width: 100, height: 50 }), {
    type: 'linear', source: 'legacy', handles: [
      { x: 10, y: 45 }, { x: 110, y: 45 }, { x: 10, y: 95 }
    ]
  });
  assert.deepEqual(legacyLinear, legacyBefore, 'derived legacy handles are transient');

  const explicit = {
    ...legacyLinear,
    geometry: { handles: [
      { x: -.25, y: .5 }, { x: .75, y: .5 }, { x: -.25, y: 1.5 }
    ] }
  };
  assert.deepEqual(resolveGradientGeometry(explicit, { x: 10, y: 20, width: 100, height: 50 }), {
    type: 'linear', source: 'geometry', handles: [
      { x: -15, y: 45 }, { x: 85, y: 45 }, { x: -15, y: 95 }
    ]
  });
  assert.deepEqual(resolveGradientGeometry(explicit, { x: 0, y: 0, width: 0, height: 10 }), {
    type: 'linear', source: 'geometry', handles: [
      { x: -.25, y: 5 }, { x: .75, y: 5 }, { x: -.25, y: 15 }
    ]
  });
  assert.equal(resolveGradientGeometry(legacyLinear, null), null);
});

test('canvas renders affine linear and elliptical radial geometry while legacy math stays unchanged', () => {
  const calls = [];
  const context = {
    save() { calls.push(['save']); },
    transform(...args) { calls.push(['transform', ...args]); },
    restore() { calls.push(['restore']); },
    createLinearGradient(...args) { calls.push(['linear', ...args]); return { addColorStop: (...stop) => calls.push(['stop', ...stop]) }; },
    createRadialGradient(...args) { calls.push(['radial', ...args]); return { addColorStop: (...stop) => calls.push(['stop', ...stop]) }; }
  };
  const linear = {
    ...createGradientFill('linear'),
    geometry: { handles: [
      { x: .2, y: .2 }, { x: .6, y: .3 }, { x: .1, y: .9 }
    ] }
  };
  createGradientPaint(context, linear, 10, 20, 100, 50);
  const linearCall = calls.find(call => call[0] === 'linear');
  assert.ok(linearCall, 'an affine linear gradient is created');
  const [, startX, startY, endX, endY] = linearCall;
  const dx = endX - startX; const dy = endY - startY;
  const [{ x: ox, y: oy }, { x: xx, y: xy }, { x: yx, y: yy }] = resolveGradientGeometry(linear, { x: 10, y: 20, width: 100, height: 50 }).handles;
  assert.ok(Math.abs(dx * (yx - ox) + dy * (yy - oy)) < 1e-8,
    'the color axis is perpendicular to the affine y axis, including for a skewed basis');
  assert.ok(dx * (xx - ox) + dy * (xy - oy) > 0,
    'the color axis advances in the positive direction of the authored x axis');
  assert.equal(calls.some(call => call[0] === 'transform'), false,
    'linear gradient geometry is mapped directly into the canvas user space');

  calls.length = 0;
  const vertical = {
    ...createGradientFill('linear'),
    geometry: { handles: [
      { x: .5, y: .1 }, { x: .5, y: .9 }, { x: -.5, y: .1 }
    ] }
  };
  createGradientPaint(context, vertical, 8, 8, 40, 20);
  assert.deepEqual(calls[0], ['linear', 28, 8, 28, 28],
    'a vertical authored color axis stays vertical in the canvas coordinate system');

  calls.length = 0;
  const radial = {
    ...createGradientFill('radial'),
    geometry: { handles: [
      { x: .5, y: .5 }, { x: .8, y: .5 }, { x: .6, y: .9 }
    ] }
  };
  createGradientPaint(context, radial, 10, 20, 100, 50);
  assert.deepEqual(calls.slice(0, 4), [
    ['save'], ['transform', 30, 0, 10, 20, 60, 45], ['radial', 0, 0, 0, 0, 0, 1], ['restore']
  ]);

  calls.length = 0;
  createGradientPaint(context, createGradientFill('linear'), 10, 20, 100, 50);
  assert.deepEqual(calls[0], ['linear', 10, 45, 110, 45], 'legacy angle-only rendering uses its original endpoint math');
});

test('affine gradients interpolate stop alpha when authored stops extend beyond the painted bounds', () => {
  const calls = [];
  const context = {
    createLinearGradient(...args) {
      calls.push(['linear', ...args]);
      return { addColorStop: (...stop) => calls.push(['stop', ...stop]) };
    }
  };
  const gradient = {
    ...createGradientFill('linear', '#ff0000'),
    geometry: { handles: [
      { x: -.5, y: .5 }, { x: .5, y: .5 }, { x: -.5, y: 1.5 }
    ] }
  };
  gradient.stops[0].opacity = 0;
  gradient.stops[1].color = '#0000ff';
  gradient.stops[1].opacity = 1;

  createGradientPaint(context, gradient, 0, 0, 100, 100);

  assert.deepEqual(calls[0], ['linear', 0, 50, 100, 50]);
  assert.deepEqual(calls[1], ['stop', 0, 'rgba(128, 0, 128, 0.5)'],
    'the generated boundary stop samples both color and alpha at its position in the off-canvas gradient');
});

test('CSS geometry previews map affine linear stops and elliptical radial extents', () => {
  const linear = {
    ...createGradientFill('linear', '#ff0000'),
    geometry: { handles: [
      { x: .25, y: .5 }, { x: .75, y: .5 }, { x: .25, y: 1 }
    ] }
  };
  linear.stops[1].color = '#0000ff';
  assert.equal(gradientFillToCSS(linear), 'linear-gradient(90deg, rgba(255, 0, 0, 1) 25%, rgba(0, 0, 255, 1) 75%)');
  assert.equal(gradientFillToCSS(linear, 0.5, { width: 200, height: 100 }),
    'linear-gradient(90deg, rgba(255, 0, 0, 0.5) 25%, rgba(0, 0, 255, 0.5) 75%)');

  const radial = {
    ...createGradientFill('radial', '#123456'),
    geometry: { handles: [
      { x: .5, y: .4 }, { x: .75, y: .4 }, { x: .5, y: .7 }
    ] }
  };
  radial.stops[1].color = '#ffffff';
  assert.equal(gradientFillToCSS(radial),
    'radial-gradient(ellipse 25% 30% at 50% 40%, rgba(18, 52, 86, 1) 0%, rgba(255, 255, 255, 1) 100%)');
  assert.equal(gradientFillToCSS(radial, 1, { width: 0, height: 100 }), null);
});

test('gradient sampling handles endpoints, exact stops, and rounded channel interpolation', () => {
  const gradient = {
    type: 'linear', angle: 0,
    stops: [
      { id: 'start', color: '#000000', position: 0 },
      { id: 'middle', color: '#ABCDEF', position: 0.25 },
      { id: 'end', color: '#ffffff', position: 1 }
    ]
  };

  assert.equal(sampleGradientColor(gradient, 0), '#000000');
  assert.equal(sampleGradientColor(gradient, 1), '#ffffff');
  assert.equal(sampleGradientColor(gradient, 0.25), '#ABCDEF', 'an exact stop keeps its authored color');
  assert.equal(sampleGradientColor(gradient, 0.625), '#d5e6f7');
  assert.equal(sampleGradientColor(gradient, -0.01), null);
});

test('gradient stop insertion copies and stably orders stops at the requested position', () => {
  const gradient = {
    type: 'radial', angle: 0,
    stops: [
      { id: 'start', color: '#000000', position: 0, opacity: 0.2, metadata: { source: 'first' } },
      { id: 'middle-a', color: '#ff0000', position: 0.5, opacity: 0.4 },
      { id: 'middle-b', color: '#0000ff', position: 0.5, opacity: 0.8 },
      { id: 'end', color: '#ffffff', position: 1 }
    ],
    metadata: { editable: true }
  };
  const before = structuredClone(gradient);
  const result = insertGradientStop(gradient, 0.5, 'inserted');

  assert.deepEqual(result.stops.map(stop => stop.id), ['start', 'middle-a', 'middle-b', 'inserted', 'end']);
  assert.equal(result.stops[3].color, '#ff0000', 'the new stop samples the first exact-position color');
  assert.equal(result.stops[3].opacity, 0.4, 'the inserted stop also samples the first exact-position alpha');
  assert.notEqual(result, gradient);
  assert.notEqual(result.stops, gradient.stops);
  assert.notEqual(result.stops[0].metadata, gradient.stops[0].metadata);
  result.stops[0].metadata.source = 'changed';
  assert.deepEqual(gradient, before, 'insertion and edits to its result leave the input untouched');
});

test('gradient stop insertion rejects malformed gradients, duplicate IDs, and the eight-stop limit', () => {
  const gradient = createGradientFill('linear');
  assert.equal(insertGradientStop(gradient, 0.5, gradient.stops[0].id), null);
  assert.equal(insertGradientStop({ ...gradient, stops: [...gradient.stops].reverse() }, 0.5, 'new-stop'), null);
  assert.equal(insertGradientStop(gradient, 1.1, 'new-stop'), null);

  const full = {
    ...gradient,
    stops: Array.from({ length: 8 }, (_, index) => ({
      id: `stop-${index}`, color: '#123456', position: index / 7
    }))
  };
  const before = structuredClone(full);
  assert.equal(insertGradientStop(full, 0.5, 'extra-stop'), null);
  assert.deepEqual(full, before, 'rejected insertion does not mutate the input');
});
