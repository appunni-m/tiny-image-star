import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createEffectStyle, createLayerEffect, createNode, addNode, applyEffectStyle, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { buildLayerEffectBoxShadow, buildLayerEffectFilter, isValidLayerEffects, layerEffectPadding, moveLayerEffect, supportsShadowSpread } from '../src/layer-effects.js';
import { progressiveBlurStepCount, progressiveBlurWeights } from '../src/progressive-blur.js';

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

test('background blur is a bounded editable effect and is excluded from foreground filters and effect padding', () => {
  const document = createDocument();
  const blur = createLayerEffect('background-blur', { radius: 24 });
  const shape = createNode('rectangle', { effects: [blur] });
  addNode(document, shape);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
  assert.deepEqual(shape.effects, [blur]);
  assert.equal(isValidLayerEffects([{ ...blur, radius: 100 }]), true);
  assert.equal(isValidLayerEffects([{ ...blur, radius: 101 }]), false);
  assert.equal(buildLayerEffectFilter([blur]), 'none');
  assert.deepEqual(layerEffectPadding([blur]), { x: 0, y: 0 });
  assert.equal(isValidLayerEffects([blur, createLayerEffect('layer-blur')]), false, 'the two blur modes are mutually exclusive');
  assert.equal(isValidLayerEffects([blur, createLayerEffect('background-blur')]), false, 'a layer has only one background blur');
  assert.throws(() => createLayerEffect('not-a-blur'), /Unsupported layer effect/);
});

test('progressive blur geometry is validated, serialized, and expands by its strongest local radius', () => {
  const progressive = createLayerEffect('layer-blur', {
    id: 'progressive-blur', blurType: 'PROGRESSIVE', radius: 24, startRadius: 2,
    startOffset: { x: 0.25, y: 0 }, endOffset: { x: 0.75, y: 1 }
  });
  const node = createNode('rectangle', { width: 40, height: 30, effects: [progressive] });
  const document = createDocument();
  addNode(document, node);
  assert.equal(isValidLayerEffects([progressive]), true);
  assert.equal(buildLayerEffectFilter([progressive]), 'none', 'CSS output cannot claim the non-uniform blur as one uniform radius');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
  assert.deepEqual(parseDocument(serializeDocument(document)).pages[0].children[0].effects, [progressive]);
  assert.deepEqual(layerEffectPadding([progressive]), { x: 72, y: 72 });
  assert.equal(isValidLayerEffects([{ ...progressive, startRadius: 101 }]), false);
  assert.equal(isValidLayerEffects([{ ...progressive, startOffset: { x: -0.01, y: 0 } }]), false);
  assert.equal(isValidLayerEffects([{ ...progressive, endOffset: { x: 0.25, y: 0 } }]), false,
    'the progressive path needs a non-zero direction');
  assert.equal(isValidLayerEffects([{ ...progressive, blurType: 'RADIANT' }]), false);
});

test('progressive blur weights crossfade between neighboring radii and limit large surfaces', () => {
  assert.deepEqual(progressiveBlurWeights(0, 4), [1, 0, 0, 0]);
  assert.deepEqual(progressiveBlurWeights(1, 4), [0, 0, 0, 1]);
  const halfway = progressiveBlurWeights(0.5, 3);
  assert.deepEqual(halfway, [0, 1, 0]);
  assert.equal(progressiveBlurWeights(0.125, 3).reduce((sum, value) => sum + value, 0), 1);
  const blur = { startRadius: 0, radius: 80 };
  assert.equal(progressiveBlurStepCount(blur, 10_000), 6);
  assert.equal(progressiveBlurStepCount(blur, 500_000), 4);
  assert.equal(progressiveBlurStepCount(blur, 2_000_000), 2);
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

test('shadow spread defaults to zero, validates legacy values, and expands only outer effect bounds', () => {
  const drop = createLayerEffect('drop-shadow', { offsetX: 2, offsetY: -3, blur: 4, spread: 5 });
  const inner = createLayerEffect('inner-shadow', { offsetX: 3, offsetY: -2, blur: 6, spread: -4 });
  assert.equal(createLayerEffect('drop-shadow').spread, 0);
  assert.equal(createLayerEffect('drop-shadow').showShadowBehindNode, false,
    'drop shadows follow Figma’s default of staying out of transparent geometry');
  assert.equal(createLayerEffect('inner-shadow').spread, 0);
  assert.equal(isValidLayerEffects([{ ...drop, spread: undefined }]), true, 'older documents without the optional field remain valid');
  assert.equal(isValidLayerEffects([{ ...drop, spread: -1000 }]), true);
  assert.equal(isValidLayerEffects([{ ...drop, spread: 1000.01 }]), false);
  assert.equal(isValidLayerEffects([{ ...drop, spread: Infinity }]), false);
  assert.equal(isValidLayerEffects([{ ...drop, showShadowBehindNode: true }]), true);
  assert.equal(isValidLayerEffects([{ ...drop, showShadowBehindNode: 'yes' }]), false);
  assert.equal(isValidLayerEffects([{ ...inner, showShadowBehindNode: true }]), false,
    'the transparent-area option only applies to drop shadows');
  assert.deepEqual(layerEffectPadding([drop, inner]), { x: 19, y: 20 }, 'only positive drop-shadow spread expands the padded surface');
});

test('Figma spread eligibility matches shape and clipped visible-fill requirements', () => {
  assert.equal(supportsShadowSpread({ type: 'rectangle' }), true);
  assert.equal(supportsShadowSpread({ type: 'ellipse' }), true);
  assert.equal(supportsShadowSpread({ type: 'path' }), false);
  assert.equal(supportsShadowSpread({ type: 'frame', clip: false, fill: '#ffffff' }), false);
  assert.equal(supportsShadowSpread({ type: 'frame', clip: true, fill: '#ffffff', fillOpacity: 0.009 }), false);
  assert.equal(supportsShadowSpread({ type: 'frame', clip: true, fill: '#ffffff', fillOpacity: 0.01 }), true);
  assert.equal(supportsShadowSpread({ type: 'frame', clip: true, fill: 'transparent' }), false);
  assert.equal(supportsShadowSpread({ type: 'group', clip: true, isInstance: true, fills: [
    { id: 'visible', type: 'solid', visible: true, opacity: 0.5, color: '#ffffff' }
  ] }), true);
});

test('effect validation allows eight shadows of each kind and one mutually exclusive blur', () => {
  const dropShadows = Array.from({ length: 8 }, (_, index) => createLayerEffect('drop-shadow', { id: `drop-${index}` }));
  const innerShadows = Array.from({ length: 8 }, (_, index) => createLayerEffect('inner-shadow', { id: `inner-${index}` }));
  const layerBlur = createLayerEffect('layer-blur', { id: 'layer-blur' });
  const backgroundBlur = createLayerEffect('background-blur', { id: 'background-blur' });
  assert.equal(isValidLayerEffects([...dropShadows, ...innerShadows, layerBlur]), true);
  assert.equal(isValidLayerEffects([...dropShadows, ...innerShadows, backgroundBlur]), true);
  assert.equal(isValidLayerEffects([...dropShadows, createLayerEffect('drop-shadow', { id: 'drop-over-limit' })]), false);
  assert.equal(isValidLayerEffects([...innerShadows, createLayerEffect('inner-shadow', { id: 'inner-over-limit' })]), false);
  assert.equal(isValidLayerEffects([dropShadows[0], { ...dropShadows[0] }]), false);
  assert.equal(isValidLayerEffects([layerBlur, backgroundBlur]), false, 'layer and background blur are mutually exclusive');
  assert.equal(isValidLayerEffects([{ ...layerBlur, radius: 101 }]), false);
  assert.equal(isValidLayerEffects([{ ...dropShadows[0], opacity: 1.5 }]), false);
  assert.equal(isValidLayerEffects([{ ...innerShadows[0], visible: 1 }]), false);
});

test('per-effect blend modes default to normal, validate, and survive serialization and effect-style copies', () => {
  const document = createDocument();
  const shadow = createLayerEffect('drop-shadow', { blendMode: 'multiply', showShadowBehindNode: true });
  const noise = createLayerEffect('noise', { blendMode: 'screen' });
  const legacyShadow = createLayerEffect('inner-shadow');
  delete legacyShadow.blendMode;
  const source = createNode('rectangle', { effects: [shadow, noise, legacyShadow] });
  const target = createNode('rectangle');
  addNode(document, source);
  addNode(document, target);

  assert.equal(createLayerEffect('drop-shadow').blendMode, 'normal');
  assert.equal(createLayerEffect('inner-shadow').blendMode, 'normal');
  assert.equal(createLayerEffect('noise').blendMode, 'normal');
  assert.equal(isValidLayerEffects(source.effects), true, 'legacy effects without blendMode still mean Normal');
  assert.equal(isValidLayerEffects([{ ...shadow, blendMode: 'pass-through' }]), false);
  assert.equal(isValidLayerEffects([{ ...shadow, blendMode: 'not-a-mode' }]), false);
  assert.equal(isValidLayerEffects([{ ...legacyShadow, type: 'layer-blur', radius: 3, blendMode: 'multiply' }]), false,
    'only shadows and noise have per-effect blend modes');

  const restored = parseDocument(serializeDocument(document));
  assert.deepEqual(restored.pages[0].children[0].effects, source.effects);
  assert.equal(restored.pages[0].children[0].effects[0].showShadowBehindNode, true,
    'the transparent-area rendering option persists with an effect stack');
  const style = createEffectStyle(restored, source.id, 'Blended shadows');
  assert.equal(applyEffectStyle(restored, target.id, style.id), true);
  const applied = restored.pages[0].children[1].effects;
  assert.deepEqual(applied.map(effect => effect.blendMode || 'normal'), ['multiply', 'screen', 'normal']);
  assert.notEqual(applied[0].id, shadow.id, 'applying a style gives the effect a fresh identity');
  assert.equal(isValidLayerEffects(applied), true);
});

test('effect stack reordering is stable, directional, and bounded at both ends', () => {
  const effects = ['drop-shadow', 'inner-shadow', 'layer-blur'].map((type, index) => createLayerEffect(type, { id: `ordered-${index}` }));
  assert.equal(moveLayerEffect(effects, 'ordered-0', 'up'), false);
  assert.equal(moveLayerEffect(effects, 'ordered-2', 'down'), false);
  assert.equal(moveLayerEffect(effects, 'missing', 'up'), false);
  assert.equal(moveLayerEffect(effects, 'ordered-2', 'sideways'), false);
  assert.equal(moveLayerEffect(effects, 'ordered-2', 'up'), true);
  assert.deepEqual(effects.map(effect => effect.id), ['ordered-0', 'ordered-2', 'ordered-1']);
  assert.equal(moveLayerEffect(effects, 'ordered-0', 'down'), true);
  assert.deepEqual(effects.map(effect => effect.id), ['ordered-2', 'ordered-0', 'ordered-1']);
});

test('filter-based effects follow Figma paint phases: layer blur before drop shadows', () => {
  const effects = [
    createLayerEffect('inner-shadow', { id: 'mixed-inner' }),
    createLayerEffect('drop-shadow', { id: 'mixed-drop' }),
    createLayerEffect('layer-blur', { id: 'mixed-blur' })
  ];
  const outerFilters = buildLayerEffectFilter(effects);
  assert.match(outerFilters, /^blur\(/);
  assert.equal(moveLayerEffect(effects, 'mixed-inner', 'down'), true);
  assert.deepEqual(effects.map(effect => effect.id), ['mixed-drop', 'mixed-inner', 'mixed-blur'], 'the model retains the changed mixed-type order');
  assert.equal(buildLayerEffectFilter(effects), outerFilters, 'inner shadows remain between top effects and drop shadows');
  assert.equal(moveLayerEffect(effects, 'mixed-blur', 'up'), true);
  assert.equal(buildLayerEffectFilter(effects), outerFilters, 'crossing an inner shadow does not change the documented paint phases');
  assert.equal(moveLayerEffect(effects, 'mixed-blur', 'up'), true);
  assert.equal(buildLayerEffectFilter(effects), outerFilters, 'layer blur renders before drop shadows regardless of panel interleaving');
});

test('effect filters use documented layer-blur/drop-shadow phases, scale with resolution, and ignore hidden effects', () => {
  const shadow = createLayerEffect('drop-shadow', { offsetX: 2, offsetY: -3, blur: 4, color: '#123456', opacity: 0.5 });
  const blur = createLayerEffect('layer-blur', { radius: 5 });
  const hidden = createLayerEffect('layer-blur', { radius: 20, visible: false });
  assert.equal(buildLayerEffectFilter([shadow, blur, hidden], 2), 'blur(10px) drop-shadow(4px -6px 8px rgba(18, 52, 86, 0.5))');
  assert.equal(buildLayerEffectFilter([hidden]), 'none');
  assert.equal(buildLayerEffectFilter([{ ...shadow, blendMode: 'multiply' }, blur]), 'blur(5px)',
    'CSS filter export must not silently approximate a backdrop blend mode as Normal');
  assert.equal(buildLayerEffectBoxShadow([{ ...createLayerEffect('inner-shadow'), blendMode: 'screen' }]), 'none',
    'CSS box shadows must not discard an authored non-normal effect blend');
  assert.deepEqual(layerEffectPadding([shadow, blur, hidden]), { x: 29, y: 30 });
});
