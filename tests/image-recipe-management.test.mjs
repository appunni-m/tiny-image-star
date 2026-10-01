import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, html, stylesheet] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
]);

test('single-image recipe controls can refresh, rename, and delete a selected saved recipe', () => {
  const start = source.indexOf('function imageRecipeManagementControls(');
  const end = source.indexOf('\nfunction singleImageRecipesSection', start);
  assert.ok(start >= 0 && end > start, 'recipe manager markup should have a bounded builder');
  const builder = source.slice(start, end);
  for (const action of ['update-image-recipe', 'rename-image-recipe', 'delete-image-recipe']) {
    assert.match(builder, new RegExp(`data-action="${action}"`));
  }
  assert.match(source, /imageRecipeManagementControls\(\{ nodeId: node\.id \}\)/,
    'one selected image offers updating the chosen recipe from its current settings');
  assert.match(source, /imageRecipeManagementControls\(\)/,
    'multi-selection exposes recipe catalog maintenance without guessing an update source');
});

test('recipe management actions operate on the picker choice and remain within local editing', () => {
  assert.match(source, /if \(action === 'update-image-recipe'\) \{ updateImageRecipeFromAssets\(\$\('#selection-image-recipe'\)\?\.value, details\.nodeId \|\| node\?\.id\)/);
  assert.match(source, /if \(action === 'rename-image-recipe'\) \{ renameImageRecipeFromAssets\(\$\('#selection-image-recipe'\)\?\.value\)/);
  assert.match(source, /if \(action === 'delete-image-recipe'\) \{ deleteImageRecipeFromAssets\(\$\('#selection-image-recipe'\)\?\.value\)/);
  assert.match(source, /Images already edited with it will stay unchanged/,
    'deleting a preset clearly preserves image layers that already used it');
  assert.match(source, /if \(!updateImageRecipe\(state\.document, recipe\.id, node\.id/,
    'refreshing a recipe snapshots the current image layer through the document model');
});

test('the recipe rename dialog exposes a labeled mobile-friendly save flow', () => {
  assert.match(html, /<p class="modal-copy" id="recipe-dialog-copy">/);
  assert.match(html, /<div id="recipe-name-fields"><label class="field-label" for="recipe-name">Recipe name/);
  assert.match(html, /<div class="recipe-output-controls" id="recipe-output-controls">/);
  assert.match(source, /\$\('#recipe-dialog-title'\)\.textContent = renaming \? 'Rename recipe' : 'Save recipe'/);
  assert.match(source, /\$\('#recipe-output-controls'\)\.hidden = renaming/);
  assert.match(source, /dialog\.returnValue = ''/);
  assert.match(stylesheet, /\.recipe-management-actions \.add-fill \{ min-height: 44px; \}/,
    'recipe maintenance controls keep touch-sized targets on narrow phones');
});
