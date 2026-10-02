import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fontFeatureSettings, isValidFontFeatureValues, parseFontFeatureSettings,
  setFontFeatureValue, MAX_FONT_FEATURES
} from '../src/font-features.js';

test('OpenType feature maps validate four-byte printable tags and bounded integer values', () => {
  assert.equal(isValidFontFeatureValues({ liga: 0, ss01: 1, cv01: 65_535 }), true);
  for (const invalid of [
    {}, [], null, { lig: 1 }, { '    ': 1 }, { 'li\ng': 1 }, { liga: -1 },
    { liga: 1.5 }, { liga: 65_536 }, { liga: '1' },
    Object.fromEntries(Array.from({ length: MAX_FONT_FEATURES + 1 }, (_, index) => [`f${String(index).padStart(3, '0')}`, 1]))
  ]) assert.equal(isValidFontFeatureValues(invalid), false, JSON.stringify(invalid));
});

test('OpenType feature settings serialize deterministically and parse strictly', () => {
  const features = { ss01: 1, liga: 0, cv01: 3 };
  const css = '"cv01" 3, "liga" 0, "ss01" 1';
  assert.equal(fontFeatureSettings(features), css);
  assert.deepEqual(parseFontFeatureSettings(css), { cv01: 3, liga: 0, ss01: 1 });
  assert.deepEqual(parseFontFeatureSettings('normal'), {});
  for (const invalid of ['liga 0', '"liga" 1.5', '"liga" -1', '"liga" 65536', '"liga" 0, "liga" 1', '"    " 1']) {
    assert.equal(parseFontFeatureSettings(invalid), null, invalid);
  }
});

test('setting Auto removes one feature without mutating or aliasing the existing map', () => {
  const source = { liga: 0, kern: 1 };
  const next = setFontFeatureValue(source, 'liga', null);
  assert.deepEqual(next, { kern: 1 });
  assert.deepEqual(source, { liga: 0, kern: 1 });
  assert.deepEqual(setFontFeatureValue(next, 'kern', null), {});
  assert.deepEqual(setFontFeatureValue({}, 'ss01', 1), { ss01: 1 });
  assert.throws(() => setFontFeatureValue({}, 'bad', 1), /four-character/);
  assert.throws(() => setFontFeatureValue({}, 'liga', 1.5), /integer value/);
});
