import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRulerTicks, MAX_RULER_TICKS } from '../src/ruler-scale.js';

test('generates labeled major ticks and unlabeled minor ticks in screen space', () => {
  const result = generateRulerTicks({ viewportLength: 320, zoom: 1, screenPan: 100 });
  const zero = result.ticks.find(tick => tick.major && tick.value === 0);
  assert.ok(zero);
  assert.equal(zero.position, 100);
  assert.equal(zero.label, '0');
  assert.ok(result.ticks.some(tick => tick.major && tick.value < 0));
  assert.ok(result.ticks.some(tick => tick.major && tick.value > 0));
  assert.ok(result.ticks.some(tick => !tick.major && tick.label === null));
  assert.ok(result.ticks.every(tick => tick.position >= 0 && tick.position <= 320));
});

test('negative pan produces negative world values while keeping positions in the viewport', () => {
  const result = generateRulerTicks({ viewportLength: 240, zoom: 2, screenPan: -30 });
  assert.ok(result.ticks.length > 0);
  assert.ok(result.ticks.every(tick => tick.value > 0));
  assert.ok(result.ticks.some(tick => tick.position < 80));
  assert.ok(result.ticks.every(tick => tick.position >= 0 && tick.position <= 240));
});

test('major spacing remains readable as zoom changes and uses nice world intervals', () => {
  const atOne = generateRulerTicks({ viewportLength: 800, zoom: 1, screenPan: 0 });
  const atTwo = generateRulerTicks({ viewportLength: 800, zoom: 2, screenPan: 0 });
  assert.ok([1, 2, 5, 10].some(multiplier => {
    const scaled = atOne.majorStep / 10 ** Math.floor(Math.log10(atOne.majorStep));
    return Math.abs(scaled - multiplier) < 1e-9;
  }));
  const majorPositions = result => result.ticks.filter(tick => tick.major).map(tick => tick.position);
  const spacing = result => {
    const positions = majorPositions(result);
    return positions.length > 1 ? positions[1] - positions[0] : 0;
  };
  assert.ok(spacing(atOne) >= 60 && spacing(atOne) <= 100);
  assert.ok(spacing(atTwo) >= 60 && spacing(atTwo) <= 100);
});

test('negative world coordinates receive signed labels without negative zero', () => {
  const { ticks } = generateRulerTicks({ viewportLength: 200, zoom: 1, screenPan: 120 });
  const majors = ticks.filter(tick => tick.major);
  assert.ok(majors.some(tick => tick.value < 0 && tick.label.startsWith('-')));
  assert.ok(majors.some(tick => tick.value === 0 && tick.label === '0'));
});

test('bounds tick generation for a very large viewport', () => {
  const result = generateRulerTicks({ viewportLength: 1e12, zoom: 1, screenPan: -1e8 });
  assert.ok(result.ticks.length <= MAX_RULER_TICKS);
  assert.ok(result.ticks.every(tick => Number.isFinite(tick.value)
    && Number.isFinite(tick.position)
    && tick.position >= 0
    && tick.position <= 1e12));
});

test('handles very small and very large finite zoom values without unbounded work', () => {
  for (const zoom of [1e-300, 1e300]) {
    const result = generateRulerTicks({ viewportLength: 800, zoom, screenPan: 0 });
    assert.ok(result.ticks.length > 0);
    assert.ok(result.ticks.length <= MAX_RULER_TICKS);
    assert.ok(result.ticks.every(tick => Number.isFinite(tick.position)));
  }
  assert.deepEqual(generateRulerTicks({ viewportLength: 800, zoom: 1e-320, screenPan: 0 }).ticks, []);
});

test('returns an empty bounded result for invalid or unsafe inputs', () => {
  for (const input of [
    undefined,
    { viewportLength: 0, zoom: 1, screenPan: 0 },
    { viewportLength: -1, zoom: 1, screenPan: 0 },
    { viewportLength: 100, zoom: 0, screenPan: 0 },
    { viewportLength: 100, zoom: -1, screenPan: 0 },
    { viewportLength: Infinity, zoom: 1, screenPan: 0 },
    { viewportLength: 100, zoom: 1, screenPan: NaN },
    { viewportLength: 100, zoom: Number.MIN_VALUE, screenPan: 0 }
  ]) {
    assert.deepEqual(generateRulerTicks(input), { majorStep: 0, minorStep: 0, ticks: [] });
  }
});
