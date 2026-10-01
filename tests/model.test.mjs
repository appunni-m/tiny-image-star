import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, absoluteBounds, applyImageRecipe, createComponent, createComponentInstance, createDocument, createImageRecipe, createNode, duplicateNode, findNode, MAX_DOCUMENT_NODE_COUNT, MAX_DOCUMENT_TREE_DEPTH, parseDocument, removeNode, serializeDocument, syncComponentInstances, updateNode, validateDocument } from '../src/model.js';
import { History } from '../src/history.js';
import { createImageFill } from '../src/image-fills.js';

test('new file has an active page and a valid empty layer tree', () => {
  const document = createDocument();
  assert.equal(document.pages.length, 1);
  assert.equal(document.pages[0].id, document.activePageId);
  assert.equal(validateDocument(document), true);
});

test('auto-layout absolute positioning round-trips and is limited to direct layout children', () => {
  const document = createDocument();
  const layout = createNode('frame', { autoLayout: { axis: 'horizontal' }, width: 320, height: 120 });
  const positioned = createNode('rectangle', { layoutPositioning: 'absolute' });
  const defaultPositioning = createNode('rectangle', { layoutPositioning: 'auto' });
  addNode(document, layout);
  addNode(document, positioned, { parentId: layout.id });
  addNode(document, defaultPositioning);

  const reopened = parseDocument(serializeDocument(document));
  assert.equal(findNode(reopened, positioned.id).node.layoutPositioning, 'absolute');
  assert.equal(findNode(reopened, defaultPositioning.id).node.layoutPositioning, 'auto');
  assert.equal(validateDocument(reopened), true);

  const unsupported = structuredClone(reopened);
  findNode(unsupported, positioned.id).node.layoutPositioning = 'overlay';
  assert.throws(() => validateDocument(unsupported), /Invalid layout positioning/);

  const rootAbsolute = createDocument();
  addNode(rootAbsolute, createNode('rectangle', { layoutPositioning: 'absolute' }));
  assert.throws(() => validateDocument(rootAbsolute), /Invalid layout positioning/);

  const nestedAbsolute = createDocument();
  const outerLayout = createNode('frame', { autoLayout: { axis: 'horizontal' } });
  const innerGroup = createNode('group');
  const nestedChild = createNode('rectangle', { layoutPositioning: 'absolute' });
  addNode(nestedAbsolute, outerLayout);
  addNode(nestedAbsolute, innerGroup, { parentId: outerLayout.id });
  addNode(nestedAbsolute, nestedChild, { parentId: innerGroup.id });
  assert.throws(() => validateDocument(nestedAbsolute), /Invalid layout positioning/,
    'an auto-layout ancestor does not make a deeper descendant an absolute layout child');
});

test('component layout-positioning overrides round-trip and validate supported values', () => {
  const document = createDocument();
  const master = createNode('frame', { autoLayout: { axis: 'vertical' } });
  const child = createNode('rectangle');
  addNode(document, master);
  addNode(document, child, { parentId: master.id });
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  instanceNode.componentOverrides[child.id] = { layoutPositioning: 'absolute' };
  syncComponentInstances(document, component.id);

  assert.equal(findNode(document, instance.id).node.children[0].layoutPositioning, 'absolute');
  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(findNode(reopened, instance.id).node.componentOverrides[child.id], { layoutPositioning: 'absolute' });
  assert.equal(findNode(reopened, instance.id).node.children[0].layoutPositioning, 'absolute');

  const unsupported = structuredClone(reopened);
  findNode(unsupported, instance.id).node.componentOverrides[child.id].layoutPositioning = 'fixed';
  assert.throws(() => validateDocument(unsupported), /Invalid component layout positioning override/);

  const outsideAutoLayout = createDocument();
  const plainMaster = createNode('frame');
  const plainChild = createNode('rectangle');
  addNode(outsideAutoLayout, plainMaster);
  addNode(outsideAutoLayout, plainChild, { parentId: plainMaster.id });
  const plainComponent = createComponent(outsideAutoLayout, plainMaster.id);
  const plainInstance = createComponentInstance(outsideAutoLayout, plainComponent.id);
  const plainInstanceNode = findNode(outsideAutoLayout, plainInstance.id).node;
  const plainSourceId = plainInstanceNode.children[0].componentSourceId;
  plainInstanceNode.componentOverrides[plainSourceId] = { layoutPositioning: 'absolute' };
  assert.throws(() => validateDocument(outsideAutoLayout), /Invalid component layout positioning override/,
    'absolute override is invalid when the source layer is not a direct child of auto layout');
});

test('paragraph spacing and first-line indentation validate and survive local serialization', () => {
  const document = createDocument();
  const text = createNode('text', { text: 'First\nSecond', paragraphSpacing: 8, firstLineIndent: 14 });
  addNode(document, text);

  const restored = parseDocument(serializeDocument(document));
  assert.equal(restored.pages[0].children[0].paragraphSpacing, 8);
  assert.equal(restored.pages[0].children[0].firstLineIndent, 14);
  assert.equal(validateDocument(restored), true);

  for (const property of ['paragraphSpacing', 'firstLineIndent']) {
    for (const invalid of [-1, 10_001, Infinity]) {
      const candidate = structuredClone(restored);
      candidate.pages[0].children[0][property] = invalid;
      assert.throws(() => validateDocument(candidate), /Invalid paragraph typography/);
    }
  }

  const wrongLayer = createNode('rectangle', { paragraphSpacing: 1 });
  addNode(document, wrongLayer);
  assert.throws(() => validateDocument(document), /Invalid paragraph typography/);
});

test('bulleted and numbered paragraph metadata round-trips, stays independent of rich runs, and has bounded validation', () => {
  const document = createDocument();
  const text = createNode('text', {
    text: 'Plan\nBuild\nShip',
    textRuns: [{ text: 'Plan', fontWeight: 700 }, { text: '\nBuild\nShip', fontStyle: 'italic' }],
    paragraphStyles: [
      { listStyle: 'numbered', listLevel: 0, listStart: 4, align: 'center' },
      { listStyle: 'bulleted', listLevel: 1, align: 'right' },
      { listStyle: 'numbered', listLevel: 0, align: 'justify' }
    ],
    paragraphSpacing: 12,
    listSpacing: 5
  });
  addNode(document, text);

  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[0].paragraphStyles, text.paragraphStyles);
  assert.deepEqual(reopened.pages[0].children[0].textRuns, text.textRuns);
  assert.equal(reopened.pages[0].children[0].paragraphSpacing, 12);
  assert.equal(reopened.pages[0].children[0].listSpacing, 5);
  assert.equal(validateDocument(reopened), true);

  const oldDocument = createDocument();
  addNode(oldDocument, createNode('text', { text: 'Legacy\nparagraphs' }));
  assert.equal(validateDocument(parseDocument(serializeDocument(oldDocument))), true,
    'older text layers without paragraph metadata remain valid');

  const nonText = createDocument();
  addNode(nonText, createNode('rectangle', { paragraphStyles: [{ listStyle: 'bulleted', listLevel: 0 }] }));
  assert.throws(() => validateDocument(nonText), /Invalid text paragraph styles/);
  const nonTextSpacing = createDocument();
  addNode(nonTextSpacing, createNode('rectangle', { listSpacing: 1 }));
  assert.throws(() => validateDocument(nonTextSpacing), /Invalid list spacing/);

  for (const [label, mutate] of [
    ['wrong paragraph count', node => { node.paragraphStyles.pop(); }],
    ['unsupported list style', node => { node.paragraphStyles[0].listStyle = 'checklist'; }],
    ['depth beyond five levels', node => { node.paragraphStyles[1].listLevel = 5; }],
    ['fractional depth', node => { node.paragraphStyles[1].listLevel = 1.5; }],
    ['start on a bullet', node => { node.paragraphStyles[1].listStart = 2; }],
    ['zero start', node => { node.paragraphStyles[0].listStart = 0; }],
    ['unsupported paragraph alignment', node => { node.paragraphStyles[1].align = 'middle'; }],
    ['unknown paragraph property', node => { node.paragraphStyles[1].counterFormat = 'roman'; }]
  ]) {
    const invalid = structuredClone(reopened);
    mutate(invalid.pages[0].children[0]);
    assert.throws(() => validateDocument(invalid), /Invalid text paragraph styles/, label);
  }

  for (const invalidSpacing of [-1, 10_001, Infinity]) {
    const invalid = structuredClone(reopened);
    invalid.pages[0].children[0].listSpacing = invalidSpacing;
    assert.throws(() => validateDocument(invalid), /Invalid list spacing/);
  }
});

test('text alignment accepts justified paragraphs, round-trips, and rejects unsupported values', () => {
  const document = createDocument();
  const text = createNode('text', { align: 'justify' });
  addNode(document, text);
  const restored = parseDocument(serializeDocument(document));
  assert.equal(restored.pages[0].children[0].align, 'justify');
  assert.equal(validateDocument(restored), true);

  const unsupported = structuredClone(restored);
  unsupported.pages[0].children[0].align = 'distributed';
  assert.throws(() => validateDocument(unsupported), /Invalid text alignment/);
  const wrongLayer = structuredClone(restored);
  wrongLayer.pages[0].children[0] = createNode('rectangle', { align: 'justify' });
  assert.throws(() => validateDocument(wrongLayer), /Invalid text alignment/);
});

test('editable polygon and star geometry persists and rejects invalid shape values', () => {
  const document = createDocument();
  const polygon = createNode('polygon', { points: 9 });
  const star = createNode('star', { points: 8, innerRadius: .23 });
  addNode(document, polygon); addNode(document, star);

  const reopened = parseDocument(serializeDocument(document));
  assert.equal(reopened.pages[0].children[0].points, 9);
  assert.equal(reopened.pages[0].children[1].points, 8);
  assert.equal(reopened.pages[0].children[1].innerRadius, .23);

  const zeroRadius = structuredClone(reopened);
  zeroRadius.pages[0].children[1].innerRadius = 0;
  assert.equal(validateDocument(zeroRadius), true);
  assert.equal(parseDocument(serializeDocument(zeroRadius)).pages[0].children[1].innerRadius, 0);

  for (const [nodeIndex, property, invalid] of [
    [0, 'points', 2], [0, 'points', 33], [1, 'points', 2], [1, 'points', Infinity],
    [1, 'innerRadius', -0.01], [1, 'innerRadius', 1.01]
  ]) {
    const candidate = structuredClone(reopened);
    candidate.pages[0].children[nodeIndex][property] = invalid;
    assert.throws(() => validateDocument(candidate), property === 'innerRadius' ? /Invalid star inner radius/ : /Invalid shape point count/);
  }

  const wrongShapeProperty = structuredClone(reopened);
  wrongShapeProperty.pages[0].children[0].innerRadius = .5;
  assert.throws(() => validateDocument(wrongShapeProperty), /Star inner radius is only supported on star layers/);
});

test('vector path anchor modes are restricted to supported persisted values', () => {
  const document = createDocument();
  const path = createNode('path', { points: [
    { x: 0, y: 0, mode: 'smooth' },
    { x: 1, y: 1, mode: 'symmetric' }
  ] });
  addNode(document, path);
  assert.equal(validateDocument(document), true);
  for (const mode of ['automatic', '']) {
    const invalid = structuredClone(document);
    invalid.pages[0].children[0].points[0].mode = mode;
    assert.throws(() => validateDocument(invalid), /Invalid vector path/);
  }
});

test('compound vector paths and fill rules survive local document round trips and reject invalid contours', () => {
  const document = createDocument();
  const path = createNode('path', {
    closed: true,
    fillRule: 'evenodd',
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    subpaths: [{ closed: true, points: [{ x: .25, y: .25 }, { x: .75, y: .25 }, { x: .75, y: .75 }] }]
  });
  addNode(document, path);
  assert.equal(validateDocument(document), true);
  assert.deepEqual(parseDocument(serializeDocument(document)).pages[0].children[0], path);

  const invalidRule = structuredClone(document);
  invalidRule.pages[0].children[0].fillRule = 'inverse';
  assert.throws(() => validateDocument(invalidRule), /Invalid vector path/);
  const invalidContour = structuredClone(document);
  invalidContour.pages[0].children[0].subpaths[0].closed = 'yes';
  assert.throws(() => validateDocument(invalidContour), /Invalid vector path/);
  const tooManyPoints = structuredClone(document);
  tooManyPoints.pages[0].children[0].subpaths[0].points = Array.from({ length: 20_001 }, () => ({ x: 0, y: 0 }));
  assert.throws(() => validateDocument(tooManyPoints), /Invalid vector path/);
});

test('stroke cap, join, and pattern settings persist and reject invalid values', () => {
  const document = createDocument();
  const line = createNode('line', { strokeWidth: 4, strokeCap: 'round', strokeJoin: 'bevel', strokePattern: 'dashed', strokeMiterLimit: 4 });
  addNode(document, line);
  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[0], line);

  for (const [property, invalid] of [['strokeWidth', -1], ['strokeWidth', 100_001], ['strokeCap', 'triangle'], ['strokeJoin', 'chamfer'], ['strokePattern', 'custom'], ['strokeMiterLimit', 0], ['strokeMiterLimit', 1001]]) {
    const candidate = structuredClone(reopened);
    candidate.pages[0].children[0][property] = invalid;
    assert.throws(() => validateDocument(candidate), /Invalid stroke style/);
  }
  const invisibleDots = structuredClone(reopened);
  invisibleDots.pages[0].children[0].strokePattern = 'dotted';
  invisibleDots.pages[0].children[0].strokeCap = 'butt';
  assert.throws(() => validateDocument(invisibleDots), /Invalid stroke style/);
});

test('endpoint decorations persist in stroke stacks and reject unknown decoration values', () => {
  const document = createDocument();
  const line = createNode('line', { strokes: [
    { id: 'decorated-line', color: '#123456', width: 2, opacity: 1, visible: true,
      cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10,
      startDecoration: 'arrow', endDecoration: 'triangle' }
  ] });
  addNode(document, line);
  assert.equal(validateDocument(document), true);
  assert.deepEqual(parseDocument(serializeDocument(document)).pages[0].children[0].strokes, line.strokes);

  for (const [property, invalid] of [['startDecoration', 'circle'], ['endDecoration', 'diamond']]) {
    const candidate = structuredClone(document);
    candidate.pages[0].children[0].strokes[0][property] = invalid;
    assert.throws(() => validateDocument(candidate), /Invalid stroke stack/);
  }

  const oldDocument = structuredClone(document);
  delete oldDocument.pages[0].children[0].strokes[0].startDecoration;
  delete oldDocument.pages[0].children[0].strokes[0].endDecoration;
  assert.equal(validateDocument(oldDocument), true, 'older stroke stacks keep an implicit none state');
});

test('ordered stroke stacks and component overrides persist while legacy scalar strokes remain valid', () => {
  const document = createDocument();
  const master = createNode('frame', { children: [createNode('rectangle', {
    name: 'Outlined card', stroke: '#123456', strokeWidth: 2,
    strokes: [
      { id: 'inner', color: '#123456', width: 2, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 },
      { id: 'outer', color: '#abcdef', width: 8, opacity: .4, visible: true, cap: 'round', join: 'bevel', pattern: 'dashed', miterLimit: 4 }
    ]
  })] });
  addNode(document, master);
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  const sourceShape = instanceNode.children[0];
  instanceNode.componentOverrides[sourceShape.componentSourceId] = { strokes: structuredClone(sourceShape.strokes) };
  syncComponentInstances(document, component.id);

  assert.equal(validateDocument(document), true);
  const restored = parseDocument(serializeDocument(document));
  assert.deepEqual(findNode(restored, instance.id).node.children[0].strokes, sourceShape.strokes);
  assert.deepEqual(findNode(restored, instance.id).node.componentOverrides[sourceShape.componentSourceId].strokes, sourceShape.strokes);
  assert.deepEqual(findNode(restored, instance.id).node.children[0].stroke, sourceShape.strokes[0].color,
    'the primary stack entry stays mirrored for old tools');

  const legacy = createDocument();
  const legacyLine = createNode('line', { stroke: '#123456', strokeWidth: 4, strokePattern: 'dotted', strokeCap: 'round' });
  addNode(legacy, legacyLine);
  assert.deepEqual(parseDocument(serializeDocument(legacy)).pages[0].children[0].stroke, '#123456');

  for (const invalid of [
    [{ id: 'duplicate', color: '#123456', width: 2, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 },
      { id: 'duplicate', color: '#abcdef', width: 3, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 }],
    [{ id: 'invalid', color: '#123456', width: -1, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 }],
    [{ id: 'dot', color: '#123456', width: 2, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'dotted', miterLimit: 10 }]
  ]) {
    const invalidDocument = createDocument();
    addNode(invalidDocument, createNode('rectangle', { strokes: invalid }));
    assert.throws(() => validateDocument(invalidDocument), /Invalid stroke stack/);
  }
});

test('frames own nested layers and bounds resolve into page coordinates', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 120, y: 80, width: 400, height: 500 });
  const shape = createNode('rectangle', { x: 24, y: 32, width: 90, height: 60 });
  addNode(document, frame);
  addNode(document, shape, { parentId: frame.id });
  assert.deepEqual(absoluteBounds(document, shape.id), { x: 144, y: 112, width: 90, height: 60 });
  assert.equal(findNode(document, shape.id).parents[0].id, frame.id);
});

test('node edits, duplication and removal preserve independent identities', () => {
  const document = createDocument();
  const shape = createNode('ellipse', { x: 5, y: 6 }); addNode(document, shape);
  updateNode(document, shape.id, { x: 14, opacity: .5 });
  const copy = duplicateNode(document, shape.id);
  assert.notEqual(copy.id, shape.id);
  assert.equal(copy.x, 30);
  assert.equal(copy.opacity, .5);
  removeNode(document, shape.id);
  assert.equal(findNode(document, shape.id), null);
  assert.equal(findNode(document, copy.id).node.id, copy.id);
});

test('image recipes snapshot adjustments and apply to another source layer', () => {
  const document = createDocument();
  const source = createNode('image', {
    assetId: 'asset-a', adjustments: { exposure: 28, temperature: -20, tint: 15, brightness: -12, contrast: 25, saturation: 7, sharpness: 41, blur: 2, autoContrast: true, posterizeBits: 4, solarize: true, solarizeThreshold: 96, invert: true },
    transforms: { crop: { left: 0.1, top: 0.2, right: 0.85, bottom: 0.9 }, rotation: 270, flipHorizontal: true },
    outputFormat: 'webp', outputQuality: 74,
  });
  const target = createNode('image', { assetId: 'asset-b' });
  addNode(document, source); addNode(document, target);
  const recipe = createImageRecipe(source, 'Warm dusk');
  document.recipes.push(recipe);
  source.adjustments.brightness = 0;
  source.transforms.crop.left = 0.4;
  target.transforms = { crop: { left: 0, top: 0, right: 0.5, bottom: 0.5 }, rotation: 90 };
  assert.equal(applyImageRecipe(document, target.id, recipe), true);
  assert.deepEqual(target.adjustments, { exposure: 28, temperature: -20, tint: 15, brightness: -12, contrast: 25, saturation: 7, sharpness: 41, blur: 2, autoContrast: true, posterizeBits: 4, solarize: true, solarizeThreshold: 96, invert: true });
  assert.deepEqual(recipe.transforms, { crop: { left: 0.1, top: 0.2, right: 0.85, bottom: 0.9 }, rotation: 270, flipHorizontal: true, flipVertical: false });
  assert.deepEqual([recipe.format, recipe.quality], ['webp', 74]);
  assert.deepEqual(target.transforms, recipe.transforms, 'applying a recipe restores its crop, rotation, and flip');
  assert.deepEqual([target.outputFormat, target.outputQuality], ['webp', 74], 'recipe output format and quality follow the image layer');
  assert.equal(target.assetId, 'asset-b');

  const reopened = parseDocument(serializeDocument(document));
  const savedRecipe = reopened.recipes[0];
  assert.deepEqual(savedRecipe.adjustments, { exposure: 28, temperature: -20, tint: 15, brightness: -12, contrast: 25, saturation: 7, sharpness: 41, blur: 2, autoContrast: true, posterizeBits: 4, solarize: true, solarizeThreshold: 96, invert: true });
  assert.deepEqual([savedRecipe.format, savedRecipe.quality], ['webp', 74], 'output settings persist with the recipe');
  const reopenedTarget = findNode(reopened, target.id).node;
  assert.equal(applyImageRecipe(reopened, reopenedTarget.id, savedRecipe), true);
  assert.deepEqual(reopenedTarget.adjustments, savedRecipe.adjustments, 'creative tone controls round-trip and apply to another source');
});

test('legacy image recipes default to PNG output and reject invalid format or quality', () => {
  const document = createDocument();
  const image = createNode('image', { assetId: 'asset-legacy' }); addNode(document, image);
  const legacy = { id: 'recipe-legacy', name: 'Legacy', adjustments: {}, transforms: { crop: null, rotation: 0 } };
  document.recipes.push(legacy);
  assert.equal(validateDocument(document), true, 'older saved recipes remain valid without output settings');
  assert.equal(applyImageRecipe(document, image.id, legacy), true);
  assert.deepEqual([image.outputFormat, image.outputQuality], ['png', 90]);
  assert.throws(() => createImageRecipe(image, 'Bad format', { format: 'gif' }), /PNG, JPEG, or WebP/);
  assert.throws(() => createImageRecipe(image, 'Bad quality', { quality: 101 }), /1 to 100/);
  legacy.format = 'gif';
  assert.throws(() => validateDocument(document), /Invalid image output format in image recipe/);
  legacy.format = 'jpeg'; legacy.quality = 0;
  assert.throws(() => validateDocument(document), /Invalid image output quality in image recipe/);
});

test('image recipes validate complete fill/output settings before changing an image', () => {
  const document = createDocument();
  const image = createNode('image', {
    assetId: 'asset-safe', adjustments: { brightness: 12 },
    transforms: { crop: { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 }, rotation: 90 },
    fit: 'contain', opacity: 0.6, outputFormat: 'webp', outputQuality: 71
  });
  addNode(document, image);
  const before = structuredClone(image);
  for (const invalid of [
    { adjustments: { brightness: -20 }, transforms: { rotation: 45 }, format: 'jpeg', quality: 40 },
    { adjustments: { brightness: -20 }, transforms: { rotation: 90 }, format: 'jpeg', quality: 40, fit: 'stretch' },
    { adjustments: { brightness: -20 }, transforms: { rotation: 90 }, format: 'jpeg', quality: 40, opacity: 1.1 },
  ]) {
    assert.throws(() => applyImageRecipe(document, image.id, invalid));
    assert.deepEqual(image, before, 'a rejected recipe leaves every layer field unchanged');
  }
  const recipe = createImageRecipe(image, 'Complete look');
  assert.deepEqual([recipe.fit, recipe.opacity, recipe.format, recipe.quality], ['contain', 0.6, 'webp', 71]);
  document.recipes.push(recipe);
  assert.equal(validateDocument(document), true);
  for (const recipes of [[null], [{ id: 'x', name: '' }], [{ id: 'x', name: 'One' }, { id: 'x', name: 'Two' }]]) {
    const corrupted = structuredClone(document);
    corrupted.recipes = recipes;
    assert.throws(() => validateDocument(corrupted), /recipe identity/);
  }
  for (const invalid of [{ fit: 'stretch' }, { opacity: -0.1 }, { opacity: Infinity }]) {
    const corrupted = structuredClone(document);
    Object.assign(corrupted.recipes[0], invalid);
    assert.throws(() => validateDocument(corrupted), /Invalid image (fit mode|opacity)/);
  }
  image.fit = 'stretch';
  assert.throws(() => createImageRecipe(image, 'Invalid source'), /fit must be Fill or Fit/);
});

test('image adjustment validation rejects invalid creative tone settings', () => {
  const document = createDocument();
  const image = createNode('image'); addNode(document, image);
  image.adjustments.posterizeBits = 9;
  assert.throws(() => validateDocument(document), /Invalid image adjustments/);
  image.adjustments.posterizeBits = 3;
  image.adjustments.invert = 'true';
  assert.throws(() => validateDocument(document), /Invalid image adjustments/);
  image.adjustments = { brightness: 0, solarizeThreshold: 256 };
  assert.throws(() => validateDocument(document), /Invalid image adjustments/);
});

test('image layers default to no crop, zero rotation and no flips, and persist normalized transforms', () => {
  const document = createDocument();
  const image = createNode('image', { transforms: { crop: { left: 0.05, top: 0.15, right: 0.95, bottom: 0.8 }, rotation: 180, flipHorizontal: true, flipVertical: true } });
  const untouched = createNode('image');
  addNode(document, image); addNode(document, untouched);
  assert.deepEqual(untouched.transforms, { crop: null, rotation: 0, flipHorizontal: false, flipVertical: false });
  const restored = parseDocument(serializeDocument(document));
  assert.deepEqual(restored.pages[0].children[0].transforms, image.transforms);
  assert.deepEqual(restored.pages[0].children[1].transforms, { crop: null, rotation: 0, flipHorizontal: false, flipVertical: false });
});

test('image layer validation rejects invalid normalized crop bounds and non-quarter-turn rotation', () => {
  const document = createDocument();
  const image = createNode('image'); addNode(document, image);
  image.transforms.crop = { left: -0.1, top: 0, right: 0.8, bottom: 1 };
  assert.throws(() => validateDocument(document), /Invalid image transforms/);
  image.transforms = { crop: { left: 0.5, top: 0.2, right: 0.5, bottom: 0.9 }, rotation: 0 };
  assert.throws(() => validateDocument(document), /Invalid image transforms/);
  image.transforms = { crop: null, rotation: 45 };
  assert.throws(() => validateDocument(document), /Invalid image transforms/);
  image.transforms = { crop: null, rotation: 0, flipHorizontal: 1 };
  assert.throws(() => validateDocument(document), /Invalid image transforms/);
});

test('import validation rejects malformed image recipe transforms and accepts legacy recipes', () => {
  const document = createDocument();
  const malformedTransforms = [
    { crop: { left: -0.1, top: 0, right: 0.8, bottom: 1 }, rotation: 0 },
    { crop: { left: 0.2, top: 0, right: 0.2, bottom: 1 }, rotation: 0 },
    { crop: null, rotation: 45 },
    { crop: null, rotation: 90.5 },
    { crop: null, rotation: 0, scale: 2 }
  ];

  for (const transforms of malformedTransforms) {
    const imported = structuredClone(document);
    imported.recipes.push({ id: 'recipe-imported', name: 'Imported look', transforms });
    assert.throws(() => parseDocument(imported), /Invalid image transforms in image recipe/);
  }

  const legacy = structuredClone(document);
  legacy.recipes.push({ id: 'recipe-legacy', name: 'Legacy look', adjustments: { brightness: 10 } });
  assert.equal(validateDocument(legacy), true, 'recipes saved before crop/rotation remain loadable');
});

test('serialized design validates after reload and rejects duplicate layer identities', () => {
  const document = createDocument();
  addNode(document, createNode('frame', { name: 'Mobile frame' }));
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reopened), true);
  const duplicate = createNode('rectangle');
  reopened.pages[0].children.push(duplicate, structuredClone(duplicate));
  assert.throws(() => validateDocument(reopened), /duplicate layer/);
});

test('parseDocument rejects hostile layer nesting before cloning or recursive validation', () => {
  const document = createDocument();
  const root = createNode('group');
  document.pages[0].children.push(root);
  let parent = root;
  for (let depth = 1; depth < 6_000; depth += 1) {
    const child = createNode('group');
    parent.children.push(child);
    parent = child;
  }

  assert.throws(() => parseDocument(document), error => error instanceof TypeError
    && error.message.includes(`maximum depth of ${MAX_DOCUMENT_TREE_DEPTH}`));
});

test('document validation caps total layer count and still accepts large flat designs', () => {
  const oversized = createDocument();
  oversized.pages[0].children = Array.from({ length: MAX_DOCUMENT_NODE_COUNT + 1 }, (_, index) => ({
    id: `oversized-layer-${index}`, children: []
  }));
  assert.throws(() => parseDocument(oversized), error => error instanceof TypeError
    && error.message.includes(`more than ${MAX_DOCUMENT_NODE_COUNT.toLocaleString()} layer nodes`));

  const large = createDocument();
  large.pages[0].children = Array.from({ length: 20_000 }, () => createNode('rectangle'));
  assert.equal(parseDocument(large).pages[0].children.length, 20_000,
    'large ordinary documents under the published safety ceiling remain loadable');
});

test('image fills validate and survive a portable design round trip', () => {
  const document = createDocument();
  const fill = createImageFill('asset-local-photo', { fit: 'contain', adjustments: { brightness: -18, contrast: 12, saturation: 8, sharpness: 35, blur: 2, autoContrast: true, posterizeBits: 3, solarize: true, solarizeThreshold: 110, invert: true } });
  const rectangle = createNode('rectangle', { imageFill: fill });
  addNode(document, rectangle);
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reopened), true);
  assert.deepEqual(reopened.pages[0].children[0].imageFill, fill);

  const legacyFill = structuredClone(fill);
  delete legacyFill.adjustments.sharpness;
  const legacyDocument = structuredClone(reopened);
  legacyDocument.pages[0].children[0].imageFill = legacyFill;
  const loadedLegacyDocument = parseDocument(JSON.stringify(legacyDocument));
  assert.equal(validateDocument(loadedLegacyDocument), true, 'older image fills without sharpness stay loadable with a neutral default.');
  assert.deepEqual(loadedLegacyDocument.pages[0].children[0].imageFill, legacyFill);

  reopened.pages[0].children[0].imageFill.fit = 'stretch';
  assert.throws(() => validateDocument(reopened), /Invalid image fill/);
  reopened.pages[0].children[0].imageFill = fill;
  reopened.pages[0].children[0].imageFill.adjustments.blur = 25;
  assert.throws(() => validateDocument(reopened), /Invalid image fill/);
  reopened.pages[0].children[0].imageFill = fill;
  reopened.pages[0].children[0].imageFill.adjustments.solarizeThreshold = 300;
  assert.throws(() => validateDocument(reopened), /Invalid image fill/);
  reopened.pages[0].children[0] = createNode('text', { imageFill: fill });
  assert.throws(() => validateDocument(reopened), /Image fill is not supported/);
});

test('layer blend modes validate and survive local design serialization', () => {
  const document = createDocument();
  const rectangle = createNode('rectangle', { blendMode: 'multiply' });
  addNode(document, rectangle);
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(reopened.pages[0].children[0].blendMode, 'multiply');
  assert.equal(validateDocument(reopened), true);
  reopened.pages[0].children[0].blendMode = 'vivid-light';
  assert.throws(() => validateDocument(reopened), /Invalid blend mode/);
});

test('text typography supports system font names, the full weight range, and italic style', () => {
  const document = createDocument();
  const text = createNode('text', { text: 'Readable design', fontFamily: 'Atkinson Hyperlegible, sans-serif', fontWeight: 800, fontStyle: 'italic' });
  addNode(document, text);
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reopened), true);
  assert.deepEqual(
    (({ fontFamily, fontWeight, fontStyle }) => ({ fontFamily, fontWeight, fontStyle }))(reopened.pages[0].children[0]),
    { fontFamily: 'Atkinson Hyperlegible, sans-serif', fontWeight: 800, fontStyle: 'italic' }
  );
  reopened.pages[0].children[0].fontWeight = 1001;
  assert.throws(() => validateDocument(reopened), /Invalid font weight/);
  reopened.pages[0].children[0].fontWeight = 800;
  reopened.pages[0].children[0].fontStyle = 'oblique';
  assert.throws(() => validateDocument(reopened), /Invalid font style/);
  reopened.pages[0].children[0].fontStyle = 'italic';
  reopened.pages[0].children[0].fontFamily = '   ';
  assert.throws(() => validateDocument(reopened), /Invalid font family/);
  const legacy = createDocument();
  addNode(legacy, createNode('text', { fontWeight: '600' }));
  assert.equal(validateDocument(legacy), true, 'previous saves stored select values as numeric strings');
});

test('rich text runs are optional, validated, and preserved in local design serialization', () => {
  const document = createDocument();
  const text = createNode('text', {
    text: 'Hello bold world',
    textRuns: [
      { text: 'Hello ' },
      { text: 'bold', fontWeight: 700, lineHeight: 1.6, color: '#ff2200', textDecoration: 'underline' },
      { text: ' world', fontStyle: 'italic', fontSize: 18 }
    ]
  });
  addNode(document, text);
  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[0].textRuns, text.textRuns);
  assert.equal(reopened.pages[0].children[0].text, 'Hello bold world');

  const legacy = createDocument();
  addNode(legacy, createNode('text', { text: 'Uniform text' }));
  assert.equal(validateDocument(legacy), true, 'legacy uniform text remains valid without a textRuns property');
  assert.equal(Object.hasOwn(legacy.pages[0].children[0], 'textRuns'), false);

  const invalidCases = [
    ['text mismatch', runs => { runs.pages[0].children[0].text = 'Different'; }],
    ['unsupported style', runs => { runs.pages[0].children[0].textRuns[1].fontStyle = 'oblique'; }],
    ['invalid line height', runs => { runs.pages[0].children[0].textRuns[1].lineHeight = 0; }],
    ['invalid color', runs => { runs.pages[0].children[0].textRuns[1].color = 'red'; }],
    ['unknown field', runs => { runs.pages[0].children[0].textRuns[1].opacity = .5; }],
    ['empty run', runs => { runs.pages[0].children[0].textRuns[1].text = ''; }]
  ];
  for (const [label, mutate] of invalidCases) {
    const invalid = structuredClone(document);
    mutate(invalid);
    assert.throws(() => validateDocument(invalid), /Invalid rich text runs/, label);
  }

  const nonText = createDocument();
  addNode(nonText, createNode('rectangle', { textRuns: [{ text: 'Text' }] }));
  assert.throws(() => validateDocument(nonText), /Invalid rich text runs/);
});

test('history restores both document direction and redo state', () => {
  const document = createDocument();
  const history = new History();
  history.checkpoint(document, 'Create layer');
  addNode(document, createNode('rectangle'));
  const undone = history.undo(document);
  assert.equal(undone.pages[0].children.length, 0);
  const redone = history.redo(undone);
  assert.equal(redone.pages[0].children.length, 1);
});

test('negative-slope line direction round-trips and is restricted to line layers', () => {
  const document = createDocument();
  const line = createNode('line', { width: 80, height: 45, lineReverseY: true });
  addNode(document, line);
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(findNode(reopened, line.id).node.lineReverseY, true);
  assert.equal(validateDocument(reopened), true);

  const invalidLine = structuredClone(reopened);
  findNode(invalidLine, line.id).node.lineReverseY = 'yes';
  assert.throws(() => validateDocument(invalidLine), /Invalid line direction/);

  const invalidShape = createDocument();
  addNode(invalidShape, createNode('rectangle', { lineReverseY: true }));
  assert.throws(() => validateDocument(invalidShape), /Invalid line direction/);
});
