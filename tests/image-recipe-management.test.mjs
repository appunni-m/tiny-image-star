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

test('an image context menu opens one recipe chooser to refresh the chosen recipe from that image', () => {
  const menuStart = source.indexOf('function openNodeMenu(');
  const menuEnd = source.indexOf('\nfunction combineSelectedBoolean', menuStart);
  assert.ok(menuStart >= 0 && menuEnd > menuStart, 'image context menu should have a bounded builder');
  const menu = source.slice(menuStart, menuEnd);
  assert.match(menu, /if \(node\?\.type === 'image'\)[\s\S]*?Refresh saved recipe from this image…/,
    'right-clicking an image should expose the recipe refresh action');
  assert.match(menu, /openImageRecipeDialog\('update', \{ nodeId: node\.id \}\)/,
    'refresh should be tied to the image that opened the menu');

  const dialogStart = source.indexOf('function openImageRecipeDialog(');
  const dialogEnd = source.indexOf('\nfunction saveRecipeFor', dialogStart);
  const dialog = source.slice(dialogStart, dialogEnd);
  assert.match(dialog, /imageRecipeOptions\('', \{ placeholder: 'Choose a saved recipe' \}\)/,
    'the dialog should offer one named selector instead of duplicating every refresh action in the menu');
  assert.match(dialog, /\$\('#recipe-name-fields'\)\.hidden = updating/,
    'the rename dialog must keep its name field while refresh uses the recipe selector');
  assert.match(dialog, /\$\('#recipe-update-fields'\)\.hidden = !updating/);
  assert.match(dialog, /\$\('#save-recipe-confirm'\)\.disabled = updating/);

  const closeStart = source.indexOf("$('#recipe-dialog').addEventListener('close'");
  const closeEnd = source.indexOf("$('#recipe-format').addEventListener", closeStart);
  const closeHandler = source.slice(closeStart, closeEnd);
  assert.match(closeHandler, /pending\.type === 'update'[\s\S]*?updateImageRecipeFromAssets\(\$\('#recipe-update-target'\)\.value, pending\.nodeId\)/,
    'confirming refresh should call the existing validated recipe update flow');
});

test('the recipe rename dialog exposes a labeled mobile-friendly save flow', () => {
  assert.match(html, /<p class="modal-copy" id="recipe-dialog-copy">/);
  assert.match(html, /An image recipe is a reusable preset\./,
    'new users should see that a recipe is a reusable image preset');
  assert.match(html, /<div id="recipe-name-fields"><label class="field-label" for="recipe-name">Recipe name/);
  assert.match(html, /<div class="recipe-output-controls" id="recipe-output-controls">/);
  assert.match(source, /\$\('#recipe-dialog-title'\)\.textContent = renaming \? 'Rename recipe' : updating \? 'Refresh saved recipe' : 'Save recipe'/);
  assert.match(source, /\$\('#recipe-output-controls'\)\.hidden = renaming \|\| updating/);
  assert.match(source, /dialog\.returnValue = ''/);
  assert.match(stylesheet, /\.recipe-management-actions \.add-fill \{ min-height: 44px; \}/,
    'recipe maintenance controls keep touch-sized targets on narrow phones');
});

test('the recipe refresh chooser and confirmation remain touch-sized on phones', () => {
  assert.match(html, /<div class="recipe-update-fields" id="recipe-update-fields" hidden><label[^>]*for="recipe-update-target">Saved recipe to refresh<\/label><select id="recipe-update-target"[^>]*aria-label="Choose a saved recipe to refresh" required disabled><\/select><\/div>/);
  assert.match(stylesheet, /#recipe-dialog \.recipe-update-picker \{ min-height: 44px; \}/,
    'the recipe chooser provides a 44px phone tap target');
  assert.match(stylesheet, /#recipe-dialog \.dialog-actions > button \{ min-height: 44px; \}/,
    'the refresh confirmation provides a 44px phone tap target');
});

test('unbroken saved recipe names can wrap inside the narrow mobile context menu', () => {
  assert.match(stylesheet, /\.context-menu button > span:first-child\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/,
    'the menu label must be allowed to shrink and break a long, unspaced recipe name instead of widening past the phone viewport');
  assert.match(stylesheet, /\.context-menu\s*\{[^}]*min-width:\s*205px/,
    'the wrapped label should preserve the menu’s usable minimum width');
});
