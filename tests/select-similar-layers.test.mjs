import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLayersWithSameEffects, selectLayersWithSameFont, selectLayersWithSameInstance, selectLayersWithSamePaint } from '../src/select-similar-layers.js';
import { addNode, bindVariable, createDocument, createLayerEffect, createNode, createVariable, createVariableCollection } from '../src/model.js';

const solid = (id, color, overrides = {}) => ({ id, type: 'solid', color, visible: true, opacity: 1, ...overrides });
const rectangle = (id, fills, overrides = {}) => ({ id, type: 'rectangle', fills, children: [], ...overrides });

test('same-fill selection matches visible paint appearance while ignoring paint and gradient-stop IDs', () => {
  const first = rectangle('first', [solid('fill-a', '#1769aa')]);
  const second = rectangle('second', [solid('fill-b', '#1769aa')]);
  const gradientA = rectangle('gradient-a', [{
    id: 'gradient-fill-a', type: 'linear', visible: true, opacity: 0.8,
    gradient: { type: 'linear', angle: 45, stops: [
      { id: 'stop-a', color: '#000000', position: 0 },
      { id: 'stop-b', color: '#ffffff', position: 1 }
    ] }
  }]);
  const gradientB = rectangle('gradient-b', [{
    id: 'gradient-fill-b', type: 'linear', visible: true, opacity: 0.8,
    gradient: { type: 'linear', angle: 45, stops: [
      { id: 'other-stop-a', color: '#000000', position: 0 },
      { id: 'other-stop-b', color: '#ffffff', position: 1 }
    ] }
  }]);

  assert.deepEqual(selectLayersWithSamePaint([first, second, gradientA, gradientB], first, 'fill'), ['first', 'second']);
  assert.deepEqual(selectLayersWithSamePaint([first, second, gradientA, gradientB], gradientA, 'fill'), ['gradient-a', 'gradient-b']);
});

test('same-fill selection distinguishes paint values, compositing, stack order, and fill visibility', () => {
  const reference = rectangle('reference', [solid('a', '#ff0000'), solid('b', '#0000ff', { opacity: 0.4 })]);
  const color = rectangle('color', [solid('a', '#00ff00'), solid('b', '#0000ff', { opacity: 0.4 })]);
  const opacity = rectangle('opacity', [solid('a', '#ff0000'), solid('b', '#0000ff', { opacity: 0.5 })]);
  const reversed = rectangle('reversed', [solid('b', '#0000ff', { opacity: 0.4 }), solid('a', '#ff0000')]);
  const hiddenOnly = rectangle('hidden-only', [solid('hidden', '#ff0000', { visible: false })]);

  assert.deepEqual(selectLayersWithSamePaint([reference, color, opacity, reversed, hiddenOnly], reference, 'fill'), ['reference']);
  assert.deepEqual(selectLayersWithSamePaint([hiddenOnly], hiddenOnly, 'fill'), []);
});

test('same-stroke selection compares stroke appearance without merging different line weights or patterns', () => {
  const reference = { id: 'reference', type: 'rectangle', strokes: [{ id: 'stroke-a', color: '#222222', width: 2, opacity: 1, visible: true, pattern: 'solid' }] };
  const same = { id: 'same', type: 'path', strokes: [{ id: 'stroke-b', color: '#222222', width: 2, opacity: 1, visible: true, pattern: 'solid' }] };
  const thick = { id: 'thick', type: 'ellipse', strokes: [{ id: 'stroke-c', color: '#222222', width: 3, opacity: 1, visible: true, pattern: 'solid' }] };
  const dashed = { id: 'dashed', type: 'rectangle', strokes: [{ id: 'stroke-d', color: '#222222', width: 2, opacity: 1, visible: true, pattern: 'dashed' }] };

  assert.deepEqual(selectLayersWithSamePaint([reference, same, thick, dashed], reference, 'stroke'), ['reference', 'same']);
});

test('same-paint selection respects variable-bound visibility in the active mode', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Visibility');
  const hidden = createVariable(document, collection.id, 'Hidden', 'boolean', false);
  const reference = createNode('rectangle', { fills: [solid('reference-fill', '#123456')] });
  const visible = createNode('ellipse', { fills: [solid('visible-fill', '#123456')] });
  const hiddenLayer = createNode('path', { fills: [solid('hidden-fill', '#123456')] });
  addNode(document, reference);
  addNode(document, visible);
  addNode(document, hiddenLayer);
  bindVariable(document, hiddenLayer.id, hidden.id, 'visible');

  assert.deepEqual(
    selectLayersWithSamePaint(document.pages[0].children, reference, 'fill', { document }),
    [reference.id, visible.id]
  );
});

test('same-paint selection skips hidden and locked ancestors and never reaches outside its page tree', () => {
  const reference = rectangle('reference', [solid('a', '#123456')]);
  const hiddenChild = rectangle('hidden-child', [solid('b', '#123456')]);
  const lockedChild = rectangle('locked-child', [solid('c', '#123456')]);
  const visibleChild = rectangle('visible-child', [solid('d', '#123456')]);
  const roots = [
    reference,
    { id: 'hidden-parent', type: 'group', visible: false, children: [hiddenChild] },
    { id: 'locked-parent', type: 'group', locked: true, children: [lockedChild] },
    { id: 'visible-parent', type: 'group', children: [visibleChild] }
  ];

  assert.deepEqual(selectLayersWithSamePaint(roots, reference, 'fill'), ['reference', 'visible-child']);
  assert.deepEqual(selectLayersWithSamePaint([visibleChild], reference, 'fill'), []);
  assert.throws(() => selectLayersWithSamePaint(roots, reference, 'effect'), /Paint kind must be fill or stroke/);
});

test('same-effects selection compares visible ordered effect values while ignoring effect identity', () => {
  const makeLayer = (id, effects) => ({ id, type: 'rectangle', effects, children: [] });
  const reference = makeLayer('reference', [
    createLayerEffect('drop-shadow', { id: 'effect-a', name: 'Soft shadow', offsetX: 2, blur: 9 }),
    createLayerEffect('layer-blur', { id: 'effect-b', radius: 3 })
  ]);
  const sameAppearance = makeLayer('same', [
    createLayerEffect('drop-shadow', { id: 'other-a', name: 'Card shadow', offsetX: 2, blur: 9 }),
    createLayerEffect('layer-blur', { id: 'other-b', radius: 3 })
  ]);
  const hiddenExtra = makeLayer('hidden-extra', [
    ...sameAppearance.effects.map(effect => ({ ...effect, id: `hidden-${effect.id}` })),
    createLayerEffect('noise', { visible: false })
  ]);
  const changedSetting = makeLayer('changed', [
    createLayerEffect('drop-shadow', { offsetX: 3, blur: 9 }),
    createLayerEffect('layer-blur', { radius: 3 })
  ]);
  const reversed = makeLayer('reversed', [...sameAppearance.effects].reverse());
  const noEffects = makeLayer('none', []);
  const noiseA = makeLayer('noise-a', [createLayerEffect('noise', { id: 'noise-effect-a', name: 'Grain' })]);
  const noiseB = makeLayer('noise-b', [createLayerEffect('noise', { id: 'noise-effect-b', name: 'Film grain' })]);
  const textureA = makeLayer('texture-a', [createLayerEffect('texture', { id: 'texture-effect-a' })]);
  const textureB = makeLayer('texture-b', [createLayerEffect('texture', { id: 'texture-effect-b' })]);
  const glassThenBlur = makeLayer('glass-then-blur', [createLayerEffect('glass', { id: 'glass-a' }), createLayerEffect('background-blur', { id: 'blur-a' })]);
  const blurThenGlass = makeLayer('blur-then-glass', [createLayerEffect('background-blur', { id: 'blur-b' }), createLayerEffect('glass', { id: 'glass-b' })]);
  const document = createDocument();

  assert.deepEqual(
    selectLayersWithSameEffects([reference, sameAppearance, hiddenExtra, changedSetting, reversed, noEffects], document, reference),
    ['reference', 'same', 'hidden-extra'],
    'effect parameters and stack order matter, invisible effects do not, and IDs/names are not visible appearance'
  );
  assert.deepEqual(selectLayersWithSameEffects([noEffects], document, noEffects), []);
  assert.deepEqual(selectLayersWithSameEffects([noiseA, noiseB], document, noiseA), ['noise-a', 'noise-b'],
    'equal noise settings match even though per-layer randomization may render different pixels');
  assert.deepEqual(selectLayersWithSameEffects([textureA, textureB], document, textureA), ['texture-a', 'texture-b']);
  assert.deepEqual(selectLayersWithSameEffects([glassThenBlur, blurThenGlass], document, glassThenBlur), ['glass-then-blur'],
    'backdrop effect order is part of the authored stack');
});

test('same-effects selection excludes hidden and locked subtrees, variable-hidden layers, and other pages', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Visibility');
  const hidden = createVariable(document, collection.id, 'Hidden', 'boolean', false);
  const effects = [createLayerEffect('inner-shadow')];
  const reference = createNode('rectangle', { name: 'Reference', effects: effects.map(effect => ({ ...effect })) });
  const visible = createNode('ellipse', { name: 'Visible', effects: effects.map(effect => ({ ...effect, id: 'visible-effect' })) });
  const hiddenLayer = createNode('path', { name: 'Variable hidden', effects: effects.map(effect => ({ ...effect, id: 'hidden-effect' })) });
  const hiddenParent = createNode('group', {
    visible: false,
    children: [createNode('rectangle', { effects: effects.map(effect => ({ ...effect, id: 'hidden-child-effect' })) })]
  });
  const lockedParent = createNode('group', {
    locked: true,
    children: [createNode('rectangle', { effects: effects.map(effect => ({ ...effect, id: 'locked-child-effect' })) })]
  });
  addNode(document, reference);
  addNode(document, visible);
  addNode(document, hiddenLayer);
  addNode(document, hiddenParent);
  addNode(document, lockedParent);
  bindVariable(document, hiddenLayer.id, hidden.id, 'visible');
  const otherPage = createNode('rectangle', { effects: effects.map(effect => ({ ...effect, id: 'other-page-effect' })) });
  document.pages.push({ id: 'other-page', name: 'Other', children: [otherPage], guides: [] });

  assert.deepEqual(selectLayersWithSameEffects(document.pages[0].children, document, reference), [reference.id, visible.id]);
  assert.deepEqual(selectLayersWithSameEffects([visible], document, reference), []);
  assert.deepEqual(selectLayersWithSameEffects(document.pages[1].children, document, reference), []);
});

test('same-instance selection matches component identity across the active page, not layer names or variants', () => {
  const document = createDocument();
  const reference = { id: 'instance-a', name: 'Primary button', isInstance: true, componentId: 'component-button', children: [] };
  const sameWithDifferentName = { id: 'instance-b', name: 'Button copy', isInstance: true, componentId: 'component-button', children: [] };
  const nestedSameInstance = { id: 'nested-instance', name: 'Button slot', isInstance: true, componentId: 'component-button', children: [] };
  const group = { id: 'group', type: 'group', children: [nestedSameInstance] };
  const otherVariant = { id: 'variant', isInstance: true, componentId: 'component-button-active', children: [] };
  const componentMaster = { id: 'master', isComponent: true, componentId: 'component-button', children: [] };
  const detachedLookalike = { id: 'detached', componentId: 'component-button', children: [] };
  const unrelated = { id: 'unrelated', isInstance: true, componentId: 'component-card', children: [] };

  assert.deepEqual(
    selectLayersWithSameInstance([reference, sameWithDifferentName, group, otherVariant, componentMaster, detachedLookalike, unrelated], document, reference),
    ['instance-a', 'instance-b', 'nested-instance'],
    'instance identity follows the exact main component ID through nested page content'
  );
  assert.deepEqual(selectLayersWithSameInstance([sameWithDifferentName], document, reference), []);
  assert.deepEqual(selectLayersWithSameInstance([reference], document, componentMaster), []);
});

test('same-instance selection excludes hidden, locked, and variable-hidden instances and stays page-scoped', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Visibility');
  const hidden = createVariable(document, collection.id, 'Hidden', 'boolean', false);
  const instance = (id, overrides = {}) => ({ id, isInstance: true, componentId: 'component-card', children: [], ...overrides });
  const reference = instance('reference');
  const visible = instance('visible');
  const variableHidden = instance('variable-hidden');
  const hiddenParent = { id: 'hidden-parent', visible: false, children: [instance('hidden-child')] };
  const lockedParent = { id: 'locked-parent', locked: true, children: [instance('locked-child')] };
  addNode(document, reference);
  addNode(document, visible);
  addNode(document, variableHidden);
  addNode(document, hiddenParent);
  addNode(document, lockedParent);
  bindVariable(document, variableHidden.id, hidden.id, 'visible');
  const otherPageInstance = instance('other-page');
  document.pages.push({ id: 'other-page', name: 'Other', children: [otherPageInstance], guides: [] });

  assert.deepEqual(selectLayersWithSameInstance(document.pages[0].children, document, reference), ['reference', 'visible']);
  assert.deepEqual(selectLayersWithSameInstance([visible], document, reference), []);
  assert.deepEqual(selectLayersWithSameInstance(document.pages[1].children, document, reference), []);
});

test('same-font selection compares effective family only and honors rich-text run overrides', () => {
  const document = createDocument();
  const reference = createNode('text', {
    name: 'Reference', text: 'Title', fontFamily: 'Inter, Arial, sans-serif',
    fontWeight: 700, fontAxes: { wght: 700 }, typographyStyleId: 'style-one'
  });
  const differentAppearance = createNode('text', {
    name: 'Same family', text: 'Body', fontFamily: '"INTER", system-ui',
    fontWeight: 300, fontStyle: 'italic', fontAxes: { wght: 300 }, typographyStyleId: 'style-two'
  });
  const richText = createNode('text', {
    name: 'Run family', text: 'Rich title', fontFamily: 'Body Sans',
    textRuns: [{ text: 'Rich ', fontFamily: 'Inter' }, { text: 'title', fontFamily: 'Inter, sans-serif', fontWeight: 800 }]
  });
  const differentFamily = createNode('text', { name: 'Different family', text: 'Other', fontFamily: 'Arial, sans-serif' });
  addNode(document, reference);
  addNode(document, differentAppearance);
  addNode(document, richText);
  addNode(document, differentFamily);

  assert.deepEqual(
    selectLayersWithSameFont(document.pages[0].children, document, reference),
    [reference.id, differentAppearance.id, richText.id],
    'family names compare case-insensitively by primary family while unrelated typography metadata is ignored'
  );
});

test('same-font selection resolves variable-bound families and rejects stale runs', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Typography');
  const family = createVariable(document, collection.id, 'Heading family', 'string', 'Editorial Sans');
  const reference = createNode('text', {
    text: 'Selected', fontFamily: 'Fallback Sans', variableBindings: { fontFamily: family.id }
  });
  const sameByRun = createNode('text', {
    text: 'Matching', fontFamily: 'Fallback Sans',
    textRuns: [{ text: 'Matching', fontFamily: 'Editorial Sans' }]
  });
  const staleRunsUseBase = createNode('text', {
    text: 'Changed text', fontFamily: 'Editorial Sans, Arial',
    textRuns: [{ text: 'Old text', fontFamily: 'Other Sans' }]
  });
  const wrongRunFamily = createNode('text', {
    text: 'Not matching', fontFamily: 'Editorial Sans',
    textRuns: [{ text: 'Not matching', fontFamily: 'Other Sans' }]
  });
  addNode(document, reference);
  addNode(document, sameByRun);
  addNode(document, staleRunsUseBase);
  addNode(document, wrongRunFamily);
  assert.equal(bindVariable(document, reference.id, family.id, 'fontFamily'), true);

  assert.deepEqual(
    selectLayersWithSameFont(document.pages[0].children, document, reference),
    [reference.id, sameByRun.id, staleRunsUseBase.id],
    'node bindings resolve in the active variable mode and stale rich-text runs follow renderer fallback behavior'
  );
});

test('same-font selection skips hidden or locked descendants and is scoped to the supplied page tree', () => {
  const document = createDocument();
  const reference = createNode('text', { text: 'Source', fontFamily: 'Inter' });
  const visible = createNode('text', { text: 'Visible', fontFamily: 'Inter' });
  const ownHidden = createNode('text', { text: 'Hidden', fontFamily: 'Inter', visible: false });
  const ownLocked = createNode('text', { text: 'Locked', fontFamily: 'Inter', locked: true });
  const hiddenAncestor = createNode('frame', {
    visible: false, children: [createNode('text', { text: 'Hidden child', fontFamily: 'Inter' })]
  });
  const lockedAncestor = createNode('frame', {
    locked: true, children: [createNode('text', { text: 'Locked child', fontFamily: 'Inter' })]
  });
  addNode(document, reference);
  addNode(document, visible);
  addNode(document, ownHidden);
  addNode(document, ownLocked);
  addNode(document, hiddenAncestor);
  addNode(document, lockedAncestor);
  const otherPageText = createNode('text', { text: 'Other page', fontFamily: 'Inter' });
  document.pages.push({ id: 'other-page', name: 'Other', children: [otherPageText], guides: [] });

  assert.deepEqual(selectLayersWithSameFont(document.pages[0].children, document, reference), [reference.id, visible.id]);
  assert.deepEqual(selectLayersWithSameFont([visible], document, reference), []);
  assert.deepEqual(selectLayersWithSameFont(document.pages[1].children, document, reference), []);
});
