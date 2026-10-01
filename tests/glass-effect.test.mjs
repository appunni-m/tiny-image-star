import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayerEffect, createNode, createDocument, addNode, serializeDocument, parseDocument } from '../src/model.js';
import { isValidLayerEffects, MAX_EFFECTS_PER_LAYER, MAX_GLASS_EFFECTS_PER_LAYER as layerGlassLimit } from '../src/layer-effects.js';
import {
  firstBackdropEffect, glassEffectOverscan, glassVectorExportBlockReason,
  glassVisibleForNode, isValidGlassEffect, MAX_GLASS_AXIS, MAX_GLASS_EFFECTS_PER_LAYER,
  MAX_GLASS_OVERSCAN, MAX_GLASS_PIXELS, refractGlassBackdrop
} from '../src/glass-effect.js';

test('Glass exposes the complete bounded effect settings and persists as a normal editable effect', () => {
  const effect = createLayerEffect('glass');
  assert.deepEqual({ ...effect, id: undefined }, {
    id: undefined, type: 'glass', visible: true, lightAngle: 45, lightIntensity: 50,
    refraction: 50, depth: 50, dispersion: 0, frost: 0, splay: 0
  });
  assert.equal(isValidGlassEffect(effect), true);
  for (const invalid of [
    { ...effect, lightAngle: -1 }, { ...effect, lightAngle: 361 },
    { ...effect, lightIntensity: 101 }, { ...effect, refraction: -1 },
    { ...effect, depth: Infinity }, { ...effect, dispersion: NaN },
    { ...effect, frost: 101 }, { ...effect, splay: -0.1 }
  ]) assert.equal(isValidGlassEffect(invalid), false);

  const document = createDocument();
  const layer = createNode('rectangle', { fillOpacity: .45, effects: [effect] });
  addNode(document, layer);
  const restored = parseDocument(serializeDocument(document));
  assert.equal(restored.pages[0].children[0].effects[0].type, 'glass');
  assert.deepEqual(restored.pages[0].children[0].effects[0], effect);
});

test('one Glass shares the ordered backdrop slot with background blur and fits the full per-type stack limit', () => {
  const glass = createLayerEffect('glass', { id: 'glass' });
  const blur = createLayerEffect('background-blur', { id: 'blur' });
  assert.equal(isValidLayerEffects([glass, blur]), true, 'both settings persist so the authored first-visible order can be retained');
  assert.equal(firstBackdropEffect([glass, blur]), glass);
  assert.equal(firstBackdropEffect([glass, { ...blur, visible: false }]), glass);
  assert.equal(firstBackdropEffect([{ ...glass, visible: false }, blur]), blur);
  assert.equal(isValidLayerEffects([glass, createLayerEffect('glass', { id: 'second-glass' })]), false);

  const complete = [
    ...Array.from({ length: 8 }, (_, index) => createLayerEffect('drop-shadow', { id: `drop-${index}` })),
    ...Array.from({ length: 8 }, (_, index) => createLayerEffect('inner-shadow', { id: `inner-${index}` })),
    blur, createLayerEffect('noise', { id: 'noise-1' }), createLayerEffect('noise', { id: 'noise-2' }),
    createLayerEffect('texture', { id: 'texture' }), glass
  ];
  assert.equal(MAX_GLASS_EFFECTS_PER_LAYER, 1);
  assert.equal(layerGlassLimit, MAX_GLASS_EFFECTS_PER_LAYER,
    'layer effects must re-export the Glass limit consumed by the inspector');
  assert.equal(MAX_EFFECTS_PER_LAYER, 21);
  assert.equal(complete.length, MAX_EFFECTS_PER_LAYER);
  assert.equal(isValidLayerEffects(complete), true);
  assert.equal(isValidLayerEffects([...complete, createLayerEffect('glass', { id: 'extra-glass' })]), false);
});

test('Glass visibility follows opaque fill opacity while transparent fills and empty stacks reveal the backdrop', () => {
  const opaque = createNode('rectangle');
  assert.equal(glassVisibleForNode(opaque), false, 'a visible default 100% fill hides Glass');
  assert.equal(glassVisibleForNode({ ...opaque, fillOpacity: .99 }), true);
  assert.equal(glassVisibleForNode(createNode('group')), true, 'transparent group fills are not treated as opaque');
  assert.equal(glassVisibleForNode({ ...opaque, fills: [] }), true, 'an empty paint stack exposes the backdrop');
  assert.equal(glassVisibleForNode({ ...opaque, fills: [
    { id: 'invisible', type: 'solid', visible: false, opacity: 1, color: '#ffffff' },
    { id: 'partial', type: 'solid', visible: true, opacity: .6, color: '#000000' }
  ] }), true);
  assert.equal(glassVisibleForNode({ ...opaque, fills: [
    { id: 'transparent', type: 'solid', visible: true, opacity: 1, color: 'transparent' }
  ] }), true);
});

test('Glass overscan and refraction have stable, backdrop-reactive, bounded output', () => {
  const effect = createLayerEffect('glass', {
    lightAngle: 180, lightIntensity: 100, refraction: 100, depth: 100,
    dispersion: 100, frost: 100, splay: 100
  });
  assert.ok(glassEffectOverscan(effect) <= MAX_GLASS_OVERSCAN);
  assert.equal(glassEffectOverscan(effect), 88, 'maximum distortion receives a safe apron for blur and refractive offsets');
  assert.equal(MAX_GLASS_AXIS, 1536);

  const width = 12;
  const height = 12;
  const source = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const edge = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      source.data[index] = x * 18;
      source.data[index + 1] = y * 18;
      source.data[index + 2] = (x + y) * 9;
      source.data[index + 3] = 255;
      edge.data[index + 3] = Math.round(x / (width - 1) * 255);
    }
  }
  const original = Uint8ClampedArray.from(source.data);
  const one = refractGlassBackdrop(source, edge, width, height, effect, 1);
  const two = refractGlassBackdrop(source, edge, width, height, effect, 1);
  assert.deepEqual(one, two, 'rerendering identical backdrop pixels and layer settings gives identical preview pixels');
  assert.notDeepEqual(one.data, original, 'Glass visibly refracts and highlights its contour');
  const alternate = { ...source, data: Uint8ClampedArray.from(source.data, value => Math.max(0, 255 - value)) };
  assert.notDeepEqual(refractGlassBackdrop(alternate, edge, width, height, effect, 1).data, one.data,
    'preview is derived from the backdrop below the layer');
  assert.deepEqual(source.data, original, 'the source backdrop is never mutated');
  assert.throws(() => refractGlassBackdrop(source, edge, 1001, 1000, effect), /bounded pixel budget/);
  assert.throws(() => refractGlassBackdrop(source, edge, 0, height, effect), /bounded pixel budget/);
});

test('visible Glass has an actionable vector export boundary while hidden Glass is safe to omit', () => {
  const node = createNode('rectangle', { effects: [createLayerEffect('glass')] });
  assert.match(glassVectorExportBlockReason(node), /backdrop refraction and transparency/);
  node.effects[0].visible = false;
  assert.equal(glassVectorExportBlockReason(node), null);
});
