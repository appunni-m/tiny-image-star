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

test('unknown scripts stay on the browser fallback instead of inheriting a neighbor shaper', () => {
  const fonts = [{ id: 'all', coverage: coverage([0, 0xffff]) }];
  assert.deepEqual(itemizeLocalFontRuns('A𐒀B', fonts), [
    { text: 'A', fontId: 'all', script: 'Latn' },
    { text: '𐒀', fontId: null, script: null },
    { text: 'B', fontId: 'all', script: 'Latn' }
  ]);
});

test('font-family parsing respects quoted commas and CSS fallback order', () => {
  assert.deepEqual(fontFamilyStack('"Family, Inc.", \'Local\\\' Face\', Arial, sans-serif'), [
    'Family, Inc.', "Local' Face", 'Arial', 'sans-serif'
  ]);
});
