import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTextRunRange } from '../src/text-run-selection.js';

test('text range summary reports one style when a selection spans equal runs', () => {
  const runs = [
    { text: 'Title', fontWeight: '600' },
    { text: ' copy', fontWeight: 600 }
  ];
  const summary = summarizeTextRunRange(
    runs, 1, 8, run => run.fontWeight, value => Number(value)
  );
  assert.deepEqual(summary, { selected: true, mixed: false, value: '600' });
});

test('text range summary flags only properties that differ across overlapping runs', () => {
  const runs = [
    { text: 'Title', fontFamily: 'Inter', color: '#112233' },
    { text: ' subtitle', fontFamily: 'Arial', color: '#112233' },
    { text: '!', fontFamily: 'Arial', color: '#aabbcc' }
  ];
  const family = summarizeTextRunRange(runs, 4, 13, run => run.fontFamily);
  const color = summarizeTextRunRange(runs, 0, 13, run => run.color, value => value.toLowerCase());
  assert.deepEqual(family, { selected: true, mixed: true, value: 'Inter' });
  assert.deepEqual(color, { selected: true, mixed: false, value: '#112233' });
});

test('text range summary handles run boundaries, absent properties, and empty selections safely', () => {
  const runs = [{ text: 'one' }, { text: ' two', fontSize: 18 }];
  const inherited = summarizeTextRunRange(runs, 0, 3, run => run.fontSize ?? 12);
  const secondRun = summarizeTextRunRange(runs, 3, 7, run => run.fontSize ?? 12);
  const empty = summarizeTextRunRange(runs, 2, 2, run => run.fontSize ?? 12);
  const outside = summarizeTextRunRange(runs, 10, 12, run => run.fontSize ?? 12);
  assert.deepEqual(inherited, { selected: true, mixed: false, value: 12 });
  assert.deepEqual(secondRun, { selected: true, mixed: false, value: 18 });
  assert.deepEqual(empty, { selected: false, mixed: false, value: null });
  assert.deepEqual(outside, { selected: false, mixed: false, value: null });
});
