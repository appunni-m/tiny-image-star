import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultImageRecipeName, MAX_IMAGE_RECIPE_NAME_LENGTH } from '../src/image-recipe-name.js';

test('image recipe defaults stay within the saved-name limit for long layer names', () => {
  const name = defaultImageRecipeName('Portrait retouch');
  assert.equal(name, 'Portrait retouch look');

  const longName = defaultImageRecipeName('reference-'.repeat(30));
  assert.ok(longName.length <= MAX_IMAGE_RECIPE_NAME_LENGTH);
  assert.ok(longName.endsWith('… look'));
});

test('truncating an image-derived recipe name never splits a surrogate pair', () => {
  const name = defaultImageRecipeName(`${'x'.repeat(53)}${'😀'.repeat(12)}`);
  assert.ok(name.length <= MAX_IMAGE_RECIPE_NAME_LENGTH);
  assert.ok(name.endsWith('… look'));
  assert.doesNotMatch(name, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
});

test('blank source names and API fallback names use bounded, printable labels', () => {
  assert.equal(defaultImageRecipeName('   '), 'Image look');
  assert.equal(defaultImageRecipeName('bad\nname', ' recipe'), 'bad name recipe');
});
