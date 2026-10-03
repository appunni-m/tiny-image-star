import test from 'node:test';
import assert from 'node:assert/strict';
import { imageRecipeRenderWorkerBudget, imageRecipeUsesLocalModel, planBackgroundRemovalRecipe } from '../src/background-removal-recipe.js';

test('background-removal recipes resolve each target from its own original asset', () => {
  const recipeSource = {
    type: 'image', assetId: 'transparent-source', backgroundRemoved: true,
    backgroundRemovalSourceAssetId: 'source-a', backgroundRemovalAssetId: 'transparent-source',
  };
  const target = { type: 'image', assetId: 'source-b' };
  const plan = planBackgroundRemovalRecipe(target, true);
  assert.deepEqual(plan, { action: 'remove', sourceAssetId: 'source-b', outputAssetId: null });
  assert.notEqual(plan.sourceAssetId, recipeSource.assetId, 'the recipe stores an operation, never its source pixels');
});

test('matching per-image transparent caches are reusable and restore returns to source bytes', () => {
  const image = {
    type: 'image', assetId: 'transparent-a', backgroundRemoved: true,
    backgroundRemovalSourceAssetId: 'source-a', backgroundRemovalAssetId: 'transparent-a',
  };
  assert.deepEqual(planBackgroundRemovalRecipe(image, true), {
    action: 'unchanged', sourceAssetId: 'source-a', outputAssetId: 'transparent-a',
  });
  assert.deepEqual(planBackgroundRemovalRecipe(image, false), {
    action: 'restore', sourceAssetId: 'source-a', outputAssetId: 'transparent-a',
  });
  image.backgroundRemoved = false;
  image.assetId = 'source-a';
  assert.deepEqual(planBackgroundRemovalRecipe(image, true), {
    action: 'activate-cache', sourceAssetId: 'source-a', outputAssetId: 'transparent-a',
  });
});

test('stale caches are ignored after an image changes to a different original', () => {
  const image = {
    type: 'image', assetId: 'source-new', backgroundRemoved: false,
    backgroundRemovalSourceAssetId: 'source-old', backgroundRemovalAssetId: 'transparent-old',
  };
  assert.deepEqual(planBackgroundRemovalRecipe(image, true), {
    action: 'remove', sourceAssetId: 'source-new', outputAssetId: null,
  });
});

test('local-model recipes reserve one shared CPU slot only while inference is active', () => {
  assert.equal(imageRecipeUsesLocalModel({ backgroundRemoved: true }), true);
  assert.equal(imageRecipeUsesLocalModel({ resolutionBoosted: true }), true,
    '4× resolution boost uses the serialized local inference worker');
  assert.equal(imageRecipeUsesLocalModel({ imageExpansionPaddingRatio: { top: 0.1 } }), true);
  assert.equal(imageRecipeUsesLocalModel({ inpaintStrokes: [{ radius: 0.02, points: [{ x: 0.2, y: 0.3 }] }] }), true,
    'saved object erase uses the same local-model CPU slot');
  assert.equal(imageRecipeUsesLocalModel({ backgroundRemoved: false, resolutionBoosted: false, imageExpansionPaddingRatio: null, inpaintStrokes: [] }), false,
    'restoring an existing result and empty erase marks do not reserve inference capacity');
  assert.equal(imageRecipeRenderWorkerBudget(1, 1), 1, 'one-core devices serialize render and inference admission');
  assert.equal(imageRecipeRenderWorkerBudget(2, 2), 2, 'an idle model slot leaves the full user-selected cap available');
  assert.equal(imageRecipeRenderWorkerBudget(4, 4), 4);
  assert.throws(() => imageRecipeRenderWorkerBudget(0, 1, true), /positive integer/);
});
