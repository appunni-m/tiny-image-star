import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unicodeScriptFor } from '../src/unicode-script.js';

test('Unicode 18 script itemization returns HarfBuzz ISO 15924 tags across old and new scripts', () => {
  assert.equal(unicodeScriptFor(0x0041), 'Latn');
  assert.equal(unicodeScriptFor(0x10480), 'Osma');
  assert.equal(unicodeScriptFor(0x104b0), 'Osge');
  assert.equal(unicodeScriptFor(0x11f04), 'Kawi');
  assert.equal(unicodeScriptFor(0x1f600), 'Zyyy');
  assert.equal(unicodeScriptFor(0x10ffff), 'Zzzz');
});

test('Unicode script lookup rejects invalid code points', () => {
  for (const value of [-1, 0x110000, NaN, Infinity, 1.5]) assert.equal(unicodeScriptFor(value), null);
});

test('Unicode script ranges remain sorted and disjoint for binary lookup', async () => {
  const source = await readFile(new URL('../src/unicode-script.js', import.meta.url), 'utf8');
  const match = source.match(/const SCRIPT_RANGES = Uint32Array\.of\(([\s\S]*?)\n\);/u);
  assert.ok(match, 'the generated Unicode script ranges should exist');
  const values = [...match[1].matchAll(/0x[0-9a-f]+|\b\d+\b/giu)]
    .map(([value]) => value.startsWith('0x') ? Number.parseInt(value.slice(2), 16) : Number(value));
  assert.equal(values.length % 3, 0, 'each range should contain a start, end, and script-tag index');
  let previousEnd = -1;
  for (let index = 0; index < values.length; index += 3) {
    const [start, end] = values.slice(index, index + 2);
    assert.ok(start > previousEnd, `range ${index / 3} must be sorted and disjoint`);
    assert.ok(start <= end && end <= 0x10ffff, `range ${index / 3} must use valid Unicode bounds`);
    previousEnd = end;
  }
});
