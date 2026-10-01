import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createGradientFill, createNode, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { createStroke, ensureStrokeStack, isValidStroke, isValidStrokeStack, updateStroke } from '../src/strokes.js';

test('solid strokes remain the default and legacy scalar strokes migrate without gradient fields', () => {
  const solid = createStroke({ id: 'solid-default' });
  assert.equal(Object.hasOwn(solid, 'gradient'), false);
  assert.equal(isValidStroke(solid), true);

  const document = createDocument();
  const legacy = createNode('rectangle', { id: 'legacy-solid', stroke: '#123456', strokeWidth: 4 });
  addNode(document, legacy);
  assert.equal(Object.hasOwn(legacy, 'strokes'), false);
  const migrated = ensureStrokeStack(legacy);
  assert.equal(migrated.length, 1);
  assert.equal(Object.hasOwn(migrated[0], 'gradient'), false);
  assert.equal(migrated[0].color, '#123456');
  assert.equal(validateDocument(document), true);
});

test('linear, radial, and angular gradient strokes validate, clone on update, and reject malformed stops', () => {
  const node = createNode('ellipse', { stroke: '#445566', strokeWidth: 2 });
  const stroke = ensureStrokeStack(node)[0];
  const radial = createGradientFill('radial', '#00aa44');
  radial.stops[1].color = '#112233';
  const result = updateStroke(node, stroke.id, { gradient: radial });
  assert.deepEqual(result.gradient, radial);
  radial.stops[0].color = '#ffffff';
  assert.equal(result.gradient.stops[0].color, '#00aa44', 'stored stops are independent from the caller object');
  assert.equal(isValidStroke(result), true);
  assert.equal(isValidStrokeStack(node.strokes, node), true);
  const angular = createGradientFill('angular', '#ffaa00');
  angular.angle = 45;
  assert.equal(updateStroke(node, stroke.id, { gradient: angular }).gradient.type, 'angular');
  assert.equal(isValidStrokeStack(node.strokes, node), true);

  const invalid = [
    { ...result, gradient: { ...result.gradient, type: 'sweep' } },
    { ...result, gradient: { ...result.gradient, stops: [{ ...result.gradient.stops[0], color: 'red' }, result.gradient.stops[1]] } },
    { ...result, gradient: { ...result.gradient, stops: [...result.gradient.stops].reverse() } },
    { ...result, gradient: { ...result.gradient, stops: [{ ...result.gradient.stops[0], position: 1.1 }, result.gradient.stops[1]] } }
  ];
  for (const candidate of invalid) assert.equal(isValidStroke(candidate), false);

  updateStroke(node, stroke.id, { gradient: null });
  assert.equal(Object.hasOwn(stroke, 'gradient'), false, 'switching to solid removes only the optional gradient paint');
  assert.equal(isValidStroke(stroke), true);
});

test('gradient stroke definitions survive document reload and invalid data blocks document validation', () => {
  const document = createDocument();
  const gradient = createGradientFill('linear', '#ff0000');
  gradient.angle = 135;
  gradient.stops[1].color = '#0000ff';
  const rectangle = createNode('rectangle', {
    strokes: [createStroke({ id: 'gradient-stroke', color: '#ff0000', width: 5, gradient })]
  });
  addNode(document, rectangle);
  assert.equal(validateDocument(document), true);
  const restored = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(restored), true);
  assert.deepEqual(restored.pages[0].children[0].strokes[0].gradient, gradient);
  assert.equal(restored.pages[0].children[0].stroke, '#ff0000', 'the legacy scalar field mirrors the first gradient stop');

  const angular = createGradientFill('angular', '#00aa44');
  angular.angle = 180;
  rectangle.strokes[0].gradient = angular;
  assert.equal(validateDocument(document), true);
  const angularRestored = parseDocument(serializeDocument(document));
  assert.equal(angularRestored.pages[0].children[0].strokes[0].gradient.type, 'angular');

  const broken = structuredClone(restored);
  broken.pages[0].children[0].strokes[0].gradient.stops[1].position = 2;
  assert.throws(() => validateDocument(broken), /Invalid stroke stack/);
});
