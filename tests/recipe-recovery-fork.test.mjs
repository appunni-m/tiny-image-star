import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createImageRecipe, createNode } from '../src/model.js';
import { createRecipeRecoveryForkDocument, recipeRecoveryForkName } from '../src/recipe-recovery-fork.js';

test('a recipe recovery fork preserves the saved design while receiving a new local identity', () => {
  const source = createDocument();
  source.name = 'Campaign';
  const image = createNode('image', { id: 'image-a', name: 'portrait.jpg', assetId: 'asset-a', width: 240, height: 160 });
  addNode(source, image);
  source.recipes.push(createImageRecipe(image, 'Warm light', { format: 'jpeg', quality: 84 }));
  const before = structuredClone(source);

  const fork = createRecipeRecoveryForkDocument(source, 'file_recovery-copy');

  assert.notEqual(fork.id, source.id);
  assert.equal(fork.name, 'Campaign (recipe recovery copy)');
  assert.deepEqual(fork.pages, source.pages);
  assert.deepEqual(fork.recipes, source.recipes);
  assert.equal(fork.pages[0].children[0].assetId, 'asset-a', 'the fork keeps the local source asset reference');
  assert.deepEqual(source, before, 'forking never mutates the original saved design');
  assert.notEqual(fork.pages, source.pages, 'the fork owns a deep copy of the page tree');
});

test('recipe recovery fork names fit the design-name limit', () => {
  const name = recipeRecoveryForkName('x'.repeat(200));
  assert.equal(name.length, 120);
  assert.ok(name.endsWith('(recipe recovery copy)'));
  assert.equal(recipeRecoveryForkName('   '), 'Untitled (recipe recovery copy)');
});
