import test from 'node:test';
import assert from 'node:assert/strict';
import { planImageExpansionRecipeTransition } from '../src/image-expansion-recipe.js';

const expansion = {
  sourceImageAssetId: 'source', sourceWidth: 100, sourceHeight: 60,
  originalGeometry: { x: 1, y: 2, width: 200, height: 120 },
  paddingRatio: { top: 0, right: 0.2, bottom: 0.1, left: 0 },
  originalInpaintStrokes: [],
};

test('same-ratio recipes keep an expanded target and remap saved source-relative erase strokes', () => {
  const plan = planImageExpansionRecipeTransition({ type: 'image', imageExpansion: expansion, backgroundRemoved: false }, {
    imageExpansionPaddingRatio: { left: 0, bottom: 0.1, right: 0.2, top: 0 },
    backgroundRemoved: false,
    inpaintStrokes: [{ radius: 0.03, points: [{ x: 0.5, y: 0.5 }] }],
  });
  assert.equal(plan.keepCurrentExpansion, true);
  assert.equal(plan.restoreExistingExpansion, false);
  assert.equal(plan.applyExpansion, true);
  assert.equal(plan.remapRecipeStrokes, true);
});

test('a changed or explicitly empty expansion restores existing generated borders', () => {
  const changedRatio = planImageExpansionRecipeTransition({ type: 'image', imageExpansion: expansion }, {
    imageExpansionPaddingRatio: { top: 0, right: 0.1, bottom: 0.1, left: 0 },
  });
  assert.equal(changedRatio.restoreExistingExpansion, true);
  assert.deepEqual(changedRatio.requestedRatio, { top: 0, right: 0.1, bottom: 0.1, left: 0 });

  const explicitNull = planImageExpansionRecipeTransition({ type: 'image', imageExpansion: expansion }, {
    imageExpansionPaddingRatio: null,
  });
  assert.equal(explicitNull.restoreExistingExpansion, true);
  assert.equal(explicitNull.applyExpansion, true);
  assert.equal(explicitNull.requestedRatio, null);
});

test('legacy recipes preserve an expansion unless a background operation changes its source', () => {
  const unchanged = planImageExpansionRecipeTransition({ type: 'image', imageExpansion: expansion }, { adjustments: {} });
  assert.equal(unchanged.expansionOperationRequested, false);
  assert.equal(unchanged.restoreExistingExpansion, false);

  const backgroundChange = planImageExpansionRecipeTransition({
    type: 'image', imageExpansion: expansion, backgroundRemoved: false,
  }, { backgroundRemoved: true });
  assert.deepEqual(backgroundChange.requestedRatio, expansion.paddingRatio,
    'legacy operations preserve the target’s own expansion ratio');
  assert.equal(backgroundChange.restoreExistingExpansion, true);
  assert.equal(backgroundChange.applyExpansion, true,
    'the batch rebuilds the same expansion from the changed target source');
});

test('legacy recipes keep erase marks on an unchanged expansion without rerunning the model', () => {
  const plan = planImageExpansionRecipeTransition({ type: 'image', imageExpansion: expansion }, {
    inpaintStrokes: [{ radius: 0.02, points: [{ x: 0.4, y: 0.6 }] }],
  });
  assert.equal(plan.keepCurrentExpansion, true);
  assert.equal(plan.remapRecipeStrokes, true);
  assert.equal(plan.applyExpansion, false);
});

test('invalid expansion recipe ratios fail before the batch changes a target', () => {
  assert.throws(() => planImageExpansionRecipeTransition({ type: 'image' }, {
    imageExpansionPaddingRatio: { top: -0.1, right: 0, bottom: 0, left: 0 },
  }), /between 0 and 100 percent/);
});
