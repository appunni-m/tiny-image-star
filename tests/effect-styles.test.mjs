import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, applyEffectStyle, createDocument, createEffectStyle, createLayerEffect, createNode,
  deleteEffectStyle, parseDocument, serializeDocument, updateEffectStyle, validateDocument
} from '../src/model.js';
import { packLocalPackage, unpackLocalPackage } from '../src/storage.js';

function makeEffectStyleFixture() {
  const document = createDocument();
  const source = createNode('rectangle', {
    name: 'Source card',
    effects: [
      createLayerEffect('inner-shadow', { offsetX: 2, color: '#112233' }),
      createLayerEffect('drop-shadow', { offsetY: 9, blur: 12, opacity: 0.4 }),
      createLayerEffect('layer-blur', { radius: 3 })
    ]
  });
  const target = createNode('ellipse', { name: 'Target', effects: [createLayerEffect('drop-shadow', { id: 'old-target-effect' })] });
  addNode(document, source);
  addNode(document, target);
  return { document, source, target };
}

test('effect style saves a detached, named snapshot of the complete ordered stack and updates in place', () => {
  const { document, source } = makeEffectStyleFixture();
  const saved = createEffectStyle(document, source.id, '  Surface elevation  ');
  assert.equal(saved.name, 'Surface elevation');
  assert.deepEqual(saved.effects, source.effects);

  source.effects.reverse();
  source.effects[0].radius = 18;
  assert.deepEqual(saved.effects.map(effect => effect.type), ['inner-shadow', 'drop-shadow', 'layer-blur']);
  assert.equal(saved.effects[2].radius, 3, 'the named style does not alias the source effect objects');

  const id = saved.id;
  source.effects = [createLayerEffect('drop-shadow', { offsetX: -7, blur: 2 })];
  assert.equal(updateEffectStyle(document, saved.id, source.id), true);
  assert.equal(saved.id, id);
  assert.equal(saved.name, 'Surface elevation');
  assert.deepEqual(saved.effects, source.effects);
  assert.equal(updateEffectStyle(document, 'missing-style', source.id), false);
  assert.equal(updateEffectStyle(document, saved.id, 'missing-layer'), false);
});

test('applying an effect style replaces the full stack with fresh IDs and keeps style order independent', () => {
  const { document, source, target } = makeEffectStyleFixture();
  const style = createEffectStyle(document, source.id, 'Card depth');
  const originalIds = style.effects.map(effect => effect.id);

  assert.equal(applyEffectStyle(document, target.id, style.id), true);
  const withoutEffectIds = effects => effects.map(({ id, ...effect }) => effect);
  assert.deepEqual(withoutEffectIds(target.effects), withoutEffectIds(style.effects));
  assert.deepEqual(target.effects.map(effect => effect.type), ['inner-shadow', 'drop-shadow', 'layer-blur']);
  assert.equal(target.effects.some(effect => originalIds.includes(effect.id)), false, 'each applied layer owns new effect row IDs');
  target.effects[0].opacity = 0.9;
  assert.notEqual(style.effects[0].opacity, 0.9, 'editing an applied stack does not mutate the shared style');
  assert.equal(applyEffectStyle(document, target.id, 'missing-style'), false);
  assert.equal(applyEffectStyle(document, 'missing-layer', style.id), false);
});

test('effect styles survive serialized local saves and portable .flocal package round trips', () => {
  const { document, source } = makeEffectStyleFixture();
  createEffectStyle(document, source.id, 'Reusable surface');

  const locallySaved = parseDocument(serializeDocument(document));
  assert.deepEqual(locallySaved.effectStyles, document.effectStyles);
  const packageBytes = packLocalPackage(locallySaved, []);
  const portable = unpackLocalPackage(packageBytes);
  assert.deepEqual(portable.document.effectStyles, document.effectStyles);
  assert.equal(validateDocument(portable.document), true);
});

test('Glass settings retain their order through named effect styles and .flocal reloads', () => {
  const document = createDocument();
  const source = createNode('rectangle', {
    fillOpacity: .4,
    effects: [
      createLayerEffect('glass', { id: 'glass-refraction', lightAngle: 312, lightIntensity: 74, refraction: 63, depth: 28, dispersion: 12, frost: 31, splay: 54 }),
      createLayerEffect('background-blur', { id: 'later-backdrop', radius: 9 })
    ]
  });
  const target = createNode('ellipse');
  addNode(document, source);
  addNode(document, target);
  const style = createEffectStyle(document, source.id, 'Translucent glass');
  assert.deepEqual(style.effects, source.effects);
  assert.equal(applyEffectStyle(document, target.id, style.id), true);
  assert.deepEqual(target.effects.map(effect => effect.type), ['glass', 'background-blur']);
  assert.deepEqual(target.effects.map(effect => effect.lightAngle || null), [312, null]);
  const restored = unpackLocalPackage(packLocalPackage(parseDocument(serializeDocument(document)), [])).document;
  assert.deepEqual(restored.effectStyles[0].effects, style.effects);
  assert.deepEqual(restored.pages[0].children[1].effects, target.effects);
  assert.equal(validateDocument(restored), true);
});

test('effect style validation bounds the catalog and rejects malformed or duplicate styles', () => {
  const { document, source } = makeEffectStyleFixture();
  createEffectStyle(document, source.id, 'Valid');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  document.effectStyles = [{ id: 'bad', name: 'Broken', effects: [{ id: 'e', type: 'drop-shadow', visible: true, color: '#000000', opacity: 0.2, offsetX: 0, offsetY: 0, blur: -1 }] }];
  assert.throws(() => validateDocument(document), /Invalid or duplicate effect style/);
  document.effectStyles = [
    { id: 'duplicate', name: 'First', effects: [] },
    { id: 'duplicate', name: 'Second', effects: [] }
  ];
  assert.throws(() => validateDocument(document), /Invalid or duplicate effect style/);
  document.effectStyles = Array.from({ length: 1001 }, (_, index) => ({ id: `style-${index}`, name: `Style ${index}`, effects: [] }));
  assert.throws(() => validateDocument(document), /up to 1,000 presets/);
});

test('deleting a style removes only the preset, leaving already applied effects intact', () => {
  const { document, source, target } = makeEffectStyleFixture();
  const style = createEffectStyle(document, source.id, 'Reusable');
  applyEffectStyle(document, target.id, style.id);
  const appliedEffects = structuredClone(target.effects);
  assert.equal(deleteEffectStyle(document, style.id), true);
  assert.deepEqual(document.effectStyles, []);
  assert.deepEqual(target.effects, appliedEffects);
  assert.equal(deleteEffectStyle(document, style.id), false);
});
