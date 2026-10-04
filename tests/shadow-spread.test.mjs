import test from 'node:test';
import assert from 'node:assert/strict';
import { morphShadowAlpha } from '../src/shadow-spread.js';

function imageRows(alpha, width) {
  const rows = [];
  for (let y = 0; y < alpha.length / width; y += 1) {
    rows.push(Array.from(alpha.subarray(y * width, (y + 1) * width)));
  }
  return rows;
}

test('positive spread dilates a grayscale alpha silhouette with a bounded square kernel', () => {
  const source = new Uint8Array(25);
  source[12] = 200;
  assert.deepEqual(imageRows(morphShadowAlpha(source, 5, 5, 1), 5), [
    [0, 0, 0, 0, 0],
    [0, 200, 200, 200, 0],
    [0, 200, 200, 200, 0],
    [0, 200, 200, 200, 0],
    [0, 0, 0, 0, 0]
  ]);
});

test('negative spread erodes a silhouette and treats the canvas edge as transparent', () => {
  const source = new Uint8Array(25).fill(255);
  assert.deepEqual(imageRows(morphShadowAlpha(source, 5, 5, -1), 5), [
    [0, 0, 0, 0, 0],
    [0, 255, 255, 255, 0],
    [0, 255, 255, 255, 0],
    [0, 255, 255, 255, 0],
    [0, 0, 0, 0, 0]
  ]);
});

test('fractional spread interpolates neighboring integer morphology and zero is identity', () => {
  const source = new Uint8ClampedArray(9);
  source[4] = 255;
  const unchanged = morphShadowAlpha(source, 3, 3, 0);
  assert.deepEqual(unchanged, Uint8Array.from(source));
  assert.notEqual(unchanged, source, 'the caller-owned alpha data is never mutated or returned');
  assert.equal(morphShadowAlpha(source, 3, 3, 0.5)[1], 128);
  assert.equal(morphShadowAlpha(new Uint8Array(25).fill(255), 5, 5, -0.5)[0], 128);
});

test('spread morphology validates dimensions, alpha length, and finite values', () => {
  assert.throws(() => morphShadowAlpha([], 1, 1, 1), /valid alpha channel/i);
  assert.throws(() => morphShadowAlpha(new Uint8Array(2), 1, 1, 1), /valid alpha channel/i);
  assert.throws(() => morphShadowAlpha(new Uint8Array(1), 0, 1, 1), /valid alpha channel/i);
  assert.throws(() => morphShadowAlpha(new Uint8Array(1), 1, 1, NaN), /valid alpha channel/i);
});
