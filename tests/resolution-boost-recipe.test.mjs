import test from 'node:test';
import assert from 'node:assert/strict';
import { planResolutionBoostRecipe } from '../src/resolution-boost-recipe.js';

test('resolution-boost recipes restore, reuse target-local caches, and generate from each target source', () => {
  assert.deepEqual(planResolutionBoostRecipe({ type: 'image', assetId: 'source-a' }, true), {
    action: 'boost', sourceAssetId: 'source-a', outputAssetId: null,
  });
  assert.deepEqual(planResolutionBoostRecipe({
    type: 'image', assetId: 'source-a', resolutionBoostSourceAssetId: 'source-a', resolutionBoostAssetId: 'boost-a',
  }, true), {
    action: 'activate-cache', sourceAssetId: 'source-a', outputAssetId: 'boost-a',
  });
  assert.deepEqual(planResolutionBoostRecipe({
    type: 'image', assetId: 'boost-a', resolutionBoosted: true,
    resolutionBoostSourceAssetId: 'source-a', resolutionBoostAssetId: 'boost-a',
  }, false), {
    action: 'restore', sourceAssetId: 'source-a', outputAssetId: 'boost-a',
  });
  assert.deepEqual(planResolutionBoostRecipe({
    type: 'image', assetId: 'boost-a', resolutionBoosted: true,
    resolutionBoostSourceAssetId: 'source-a', resolutionBoostAssetId: 'boost-a',
  }, true), {
    action: 'unchanged', sourceAssetId: 'source-a', outputAssetId: 'boost-a',
  });
  assert.deepEqual(planResolutionBoostRecipe({ type: 'image', assetId: 'source-b' }, false), {
    action: 'unchanged', sourceAssetId: 'source-b', outputAssetId: null,
  });
  assert.deepEqual(planResolutionBoostRecipe({ type: 'image' }, true), {
    action: 'unavailable', sourceAssetId: null, outputAssetId: null,
  });
  assert.throws(() => planResolutionBoostRecipe({ type: 'rectangle' }, true), /image layer/);
  assert.throws(() => planResolutionBoostRecipe({ type: 'image', assetId: 'source' }, 1), /boolean/);
});
