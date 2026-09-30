import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createLayerEffect, createNode, addNode, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { buildLayerEffectBoxShadow, buildLayerEffectFilter, isValidLayerEffects, layerEffectPadding } from '../src/layer-effects.js';

test('drop shadows and layer blur are saved as editable layer effects', () => {
  const document = createDocument();
  const shadow = createLayerEffect('drop-shadow', { offsetX: 5, opacity: 0.4 });
  const blur = createLayerEffect('layer-blur', { radius: 7 });
  const shape = createNode('rectangle', { effects: [shadow, blur] });
  addNode(document, shape);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
  assert.deepEqual(shape.effects, [shadow, blur]);
  assert.throws(() => createLayerEffect('unsupported'), /Unsupported layer effect/);
});

test('inner shadows are validated, serialized, and excluded from outer filter padding', () => {
  const document = createDocument();
  const inner = createLayerEffect('inner-shadow', { offsetX: 3, offsetY: -2, blur: 6, opacity: 0.4 });
  const shape = createNode('rectangle', { effects: [inner] });
  addNode(document, shape);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
  assert.deepEqual(shape.effects, [inner]);
  assert.equal(isValidLayerEffects([{ ...inner, blur: 101 }]), false);
  assert.equal(isValidLayerEffects([{ ...inner, offsetX: Infinity }]), false);
  assert.equal(buildLayerEffectFilter([inner]), 'none');
  assert.equal(buildLayerEffectBoxShadow([inner]), 'inset 3px -2px 6px rgba(0, 0, 0, 0.4)');
  assert.deepEqual(layerEffectPadding([inner]), { x: 0, y: 0 });
});

test('effect validation bounds the stack and rejects malformed or duplicate effects', () => {
  const effects = Array.from({ length: 8 }, (_, index) => createLayerEffect('layer-blur', { radius: index }));
  assert.equal(isValidLayerEffects(effects), true);
  assert.equal(isValidLayerEffects([...effects, createLayerEffect('layer-blur')]), false);
  assert.equal(isValidLayerEffects([effects[0], { ...effects[0] }]), false);
  assert.equal(isValidLayerEffects([{ ...effects[0], radius: 101 }]), false);
  assert.equal(isValidLayerEffects([{ ...createLayerEffect('drop-shadow'), opacity: 1.5 }]), false);
  assert.equal(isValidLayerEffects([{ ...effects[0], visible: 1 }]), false);
});

test('effect filters preserve order, scale with output resolution, and ignore hidden effects', () => {
  const shadow = createLayerEffect('drop-shadow', { offsetX: 2, offsetY: -3, blur: 4, color: '#123456', opacity: 0.5 });
  const blur = createLayerEffect('layer-blur', { radius: 5 });
  const hidden = createLayerEffect('layer-blur', { radius: 20, visible: false });
  assert.equal(buildLayerEffectFilter([shadow, blur, hidden], 2), 'drop-shadow(4px -6px 8px rgba(18, 52, 86, 0.5)) blur(10px)');
  assert.equal(buildLayerEffectFilter([hidden]), 'none');
  assert.deepEqual(layerEffectPadding([shadow, blur, hidden]), { x: 29, y: 30 });
});
