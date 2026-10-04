import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_PRESET_CATEGORIES, FRAME_PRESETS, getFramePreset, groupFramePresetsByCategory } from '../src/frame-presets.js';

test('the curated frame catalog uses the seven requested categories in stable picker order', () => {
  assert.deepEqual(FRAME_PRESET_CATEGORIES, [
    { id: 'phone', name: 'Phone' },
    { id: 'tablet', name: 'Tablet' },
    { id: 'desktop', name: 'Desktop' },
    { id: 'presentation', name: 'Presentation' },
    { id: 'watch', name: 'Watch' },
    { id: 'paper', name: 'Paper' },
    { id: 'social', name: 'Social media' },
  ]);
  assert.equal(FRAME_PRESETS.length, 24);
  assert.ok(Object.isFrozen(FRAME_PRESET_CATEGORIES));
  assert.ok(Object.isFrozen(FRAME_PRESETS));
  assert.ok(FRAME_PRESETS.every(Object.isFrozen), 'callers cannot mutate shared preset definitions');
});

test('every preset has a unique stable ID, a clear name, and positive integer pixel dimensions', () => {
  const ids = FRAME_PRESETS.map(preset => preset.id);
  assert.equal(new Set(ids).size, ids.length, 'preset IDs must be unique');
  const categoryIds = new Set(FRAME_PRESET_CATEGORIES.map(category => category.id));
  for (const preset of FRAME_PRESETS) {
    assert.match(preset.id, /^[a-z][a-z0-9-]+$/);
    assert.ok(categoryIds.has(preset.category), `${preset.id} uses a declared category`);
    assert.ok(preset.name.trim(), `${preset.id} has a user-facing name`);
    assert.ok(Number.isSafeInteger(preset.width) && preset.width > 0, `${preset.id} has a positive integer width`);
    assert.ok(Number.isSafeInteger(preset.height) && preset.height > 0, `${preset.id} has a positive integer height`);
  }
});

test('representative device, presentation, paper, and social presets keep their named dimensions', () => {
  const dimensions = id => {
    const preset = getFramePreset(id);
    assert.ok(preset, `${id} is part of the catalog`);
    return [preset.name, preset.width, preset.height];
  };
  assert.deepEqual(dimensions('phone-standard'), ['Standard phone', 393, 852]);
  assert.deepEqual(dimensions('phone-iphone-18-pro'), ['iPhone 18 Pro', 402, 874]);
  assert.deepEqual(dimensions('phone-iphone-18-pro-max'), ['iPhone 18 Pro Max', 440, 956]);
  assert.deepEqual(dimensions('phone-iphone-air'), ['iPhone Air', 420, 912]);
  assert.deepEqual(dimensions('tablet-standard'), ['Standard tablet', 820, 1180]);
  assert.deepEqual(dimensions('desktop-standard'), ['Desktop', 1440, 900]);
  assert.deepEqual(dimensions('presentation-widescreen'), ['Widescreen · 16:9', 1920, 1080]);
  assert.deepEqual(dimensions('watch-45mm'), ['45 mm watch', 396, 484]);
  assert.deepEqual(dimensions('paper-a4'), ['A4', 794, 1123]);
  assert.deepEqual(dimensions('social-story'), ['Story · 9:16', 1080, 1920]);
});

test('category grouping preserves catalog order and returns all categories, including empty groups', () => {
  const groups = groupFramePresetsByCategory();
  assert.deepEqual(groups.map(({ id, name }) => ({ id, name })), FRAME_PRESET_CATEGORIES);
  for (const group of groups) {
    assert.ok(group.presets.length > 0, `${group.name} has curated choices`);
    assert.ok(group.presets.every(preset => preset.category === group.id));
  }
  assert.deepEqual(groups.flatMap(group => group.presets.map(preset => preset.id)), FRAME_PRESETS.map(preset => preset.id));
  assert.throws(() => groupFramePresetsByCategory([{ category: 'archive' }]), /Unknown frame preset category/);
  assert.throws(() => groupFramePresetsByCategory({}), /must be an array/);
});

test('preset lookup returns a stable entry or null for unknown IDs', () => {
  assert.equal(getFramePreset('phone-standard'), FRAME_PRESETS.find(preset => preset.id === 'phone-standard'));
  assert.equal(getFramePreset('not-a-preset'), null);
});
