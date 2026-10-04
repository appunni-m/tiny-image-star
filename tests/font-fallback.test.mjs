import test from 'node:test';
import assert from 'node:assert/strict';
import { fontFamilyStack, itemizeLocalFontRuns } from '../src/font-fallback.js';

const coverage = (...ranges) => Uint32Array.from(ranges.flatMap(([start, end = start]) =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index))).sort();

test('mixed-script text is split by grapheme, font coverage, and HarfBuzz script tag', () => {
  const fonts = [
    { id: 'latin', coverage: coverage([0x20, 0x7e], [0x301]) },
    { id: 'arabic', coverage: coverage([0x600, 0x6ff], [0x20, 0x7e]) }
  ];
  const runs = itemizeLocalFontRuns('Hello مرحبا! नमस्ते', fonts);
  assert.deepEqual(runs, [
    { text: 'Hello ', fontId: 'latin', script: 'Latn' },
    { text: 'مرحبا', fontId: 'arabic', script: 'Arab' },
    { text: '! ', fontId: 'latin', script: 'Arab' },
    { text: 'नमस्ते', fontId: null, script: 'Deva' }
  ]);
});

test('grapheme fallback keeps combining marks together and ignores join controls for coverage', () => {
  const fonts = [{ id: 'latin', coverage: coverage([0x61, 0x7a], [0x1f469], [0x1f4bb]) }];
  assert.deepEqual(itemizeLocalFontRuns('a\u0301👩‍💻', fonts), [
    { text: 'a\u0301', fontId: null, script: 'Latn' },
    { text: '👩‍💻', fontId: null, script: null }
  ]);
});

test('less-common and newly encoded scripts receive their own local HarfBuzz runs when covered', () => {
  const osage = String.fromCodePoint(0x104b0);
  const fonts = [{ id: 'all', coverage: coverage([0x41], [0x42], [0x104b0], [0x11f04]) }];
  assert.deepEqual(itemizeLocalFontRuns(`A${osage}B`, fonts), [
    { text: 'A', fontId: 'all', script: 'Latn' },
    { text: osage, fontId: 'all', script: 'Osge' },
    { text: 'B', fontId: 'all', script: 'Latn' }
  ]);
  assert.deepEqual(itemizeLocalFontRuns(String.fromCodePoint(0x11f04), fonts), [
    { text: String.fromCodePoint(0x11f04), fontId: 'all', script: 'Kawi' }
  ]);
});

test('a font without coverage for a less-common script keeps that run on browser fallback', () => {
  const osage = String.fromCodePoint(0x104b0);
  const fonts = [{ id: 'latin', coverage: coverage([0x41], [0x42]) }];
  assert.deepEqual(itemizeLocalFontRuns(`A${osage}B`, fonts), [
    { text: 'A', fontId: 'latin', script: 'Latn' },
    { text: osage, fontId: null, script: 'Osge' },
    { text: 'B', fontId: 'latin', script: 'Latn' }
  ]);
});

test('covered Common-script digits inherit neighboring shaping context and stay in local font runs', () => {
  const font = { id: 'latin', coverage: coverage([0x30, 0x39], [0x41], [0x42]) };
  assert.deepEqual(itemizeLocalFontRuns('A1B', [font]), [
    { text: 'A1B', fontId: 'latin', script: 'Latn' }
  ]);
  assert.deepEqual(itemizeLocalFontRuns('123', [font]), [
    { text: '123', fontId: 'latin', script: 'Zyyy' }
  ]);
});

test('font-family parsing respects quoted commas and CSS fallback order', () => {
  assert.deepEqual(fontFamilyStack('"Family, Inc.", \'Local\\\' Face\', Arial, sans-serif'), [
    'Family, Inc.', "Local' Face", 'Arial', 'sans-serif'
  ]);
});
