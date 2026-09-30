import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, absoluteBounds, applyImageRecipe, createDocument, createImageRecipe, createNode, duplicateNode, findNode, parseDocument, removeNode, serializeDocument, updateNode, validateDocument } from '../src/model.js';
import { History } from '../src/history.js';
import { createImageFill } from '../src/image-fills.js';

test('new file has an active page and a valid empty layer tree', () => {
  const document = createDocument();
  assert.equal(document.pages.length, 1);
  assert.equal(document.pages[0].id, document.activePageId);
  assert.equal(validateDocument(document), true);
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
    assetId: 'asset-a', adjustments: { brightness: -12, contrast: 25, saturation: 7, sharpness: 41, blur: 2 },
    transforms: { crop: { left: 0.1, top: 0.2, right: 0.85, bottom: 0.9 }, rotation: 270 }
  });
  const target = createNode('image', { assetId: 'asset-b' });
  addNode(document, source); addNode(document, target);
  const recipe = createImageRecipe(source, 'Warm dusk');
  source.adjustments.brightness = 0;
  source.transforms.crop.left = 0.4;
  target.transforms = { crop: { left: 0, top: 0, right: 0.5, bottom: 0.5 }, rotation: 90 };
  assert.equal(applyImageRecipe(document, target.id, recipe), true);
  assert.deepEqual(target.adjustments, { brightness: -12, contrast: 25, saturation: 7, sharpness: 41, blur: 2 });
  assert.deepEqual(recipe.transforms, { crop: { left: 0.1, top: 0.2, right: 0.85, bottom: 0.9 }, rotation: 270 });
  assert.deepEqual(target.transforms, recipe.transforms, 'applying a recipe restores its crop and quarter-turn rotation');
  assert.equal(target.assetId, 'asset-b');
});

test('image layers default to no crop and zero rotation, and persist normalized transforms', () => {
  const document = createDocument();
  const image = createNode('image', { transforms: { crop: { left: 0.05, top: 0.15, right: 0.95, bottom: 0.8 }, rotation: 180 } });
  const untouched = createNode('image');
  addNode(document, image); addNode(document, untouched);
  assert.deepEqual(untouched.transforms, { crop: null, rotation: 0 });
  const restored = parseDocument(serializeDocument(document));
  assert.deepEqual(restored.pages[0].children[0].transforms, image.transforms);
  assert.deepEqual(restored.pages[0].children[1].transforms, { crop: null, rotation: 0 });
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

test('image fills validate and survive a portable design round trip', () => {
  const document = createDocument();
  const fill = createImageFill('asset-local-photo', { fit: 'contain', adjustments: { brightness: -18, contrast: 12, saturation: 8, sharpness: 35, blur: 2 } });
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
      { text: 'bold', fontWeight: 700, color: '#ff2200', textDecoration: 'underline' },
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
