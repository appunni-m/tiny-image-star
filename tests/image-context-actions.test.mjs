import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('the canvas image action bar exposes crop, save-recipe, and batch-recipe controls', () => {
  assert.match(html, /id="image-crop-toolbar" role="toolbar" aria-label="Image actions"/);
  assert.match(html, /id="image-context-save-recipe"[^>]*>Save recipe<\/button>/);
  assert.match(html, /id="image-crop-toolbar-done"[^>]*>Crop image<\/button>/);
  assert.match(html, /id="image-context-recipe"[^>]*aria-label="Choose a saved recipe to apply to selected images"/);
  assert.match(html, /id="image-context-apply-recipe"[^>]*disabled>Apply recipe<\/button>/);
  assert.match(html, /Crop this image or save its look to reuse it later\./);
});

test('single-image and multi-image canvas actions route to the existing recipe and crop workflows', () => {
  const syncStart = main.indexOf('function syncImageCropToolbar()');
  const syncEnd = main.indexOf('\nfunction toggleSelectedImageCropMode()', syncStart);
  assert.ok(syncStart >= 0 && syncEnd > syncStart, 'expected the contextual image toolbar synchronizer');
  const sync = main.slice(syncStart, syncEnd);
  assert.match(sync, /const singleImage = state\.selectedIds\.length === 1 && isImage/);
  assert.match(sync, /const batchImages = selectedImages\.length > 1/);
  assert.match(sync, /Apply to \$\{selectedImages\.length\} images/);
  assert.match(sync, /Other selected layers stay unchanged/);
  assert.match(sync, /Boolean\(state\.bulk\)/, 'avoid stacking the context bar on top of the active batch bar');

  const actionsStart = main.indexOf("$('#image-context-save-recipe').addEventListener");
  const actionsEnd = main.indexOf("$('#shape-builder-bar').addEventListener", actionsStart);
  assert.ok(actionsStart >= 0 && actionsEnd > actionsStart, 'expected direct contextual image action handlers');
  const actions = main.slice(actionsStart, actionsEnd);
  assert.match(main, /\$\('#image-crop-toolbar-done'\)\.addEventListener\('click', toggleSelectedImageCropMode\)/);
  assert.match(actions, /saveRecipeFor\(node\.id\)/);
  assert.match(actions, /startRecipe\(recipe, targets\)/);
  assert.match(actions, /closeMobilePanels\(\{ restoreFocus: false \}\)/);
});

test('floating recipe controls retain finger-sized touch targets on mobile', () => {
  assert.match(css, /\.image-context-save-recipe, \.image-context-recipe-picker, \.image-context-apply-recipe, \.image-crop-toolbar-done\s*\{[^}]*min-height:\s*44px/);
});
