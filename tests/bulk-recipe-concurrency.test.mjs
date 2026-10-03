import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultImageRecipeConcurrency } from '../src/bulk-recipe-concurrency.js';

test('image recipes start with measured desktop parallelism and a conservative phone cap', () => {
  assert.equal(defaultImageRecipeConcurrency({ cpuBudget: 8, deviceMemory: 16 }), 4,
    'desktop batches should use the four-worker setting that improved the measured Pillow throughput');
  assert.equal(defaultImageRecipeConcurrency({ cpuBudget: 3, deviceMemory: 8 }), 3,
    'the default cannot exceed the available CPU budget');
  assert.equal(defaultImageRecipeConcurrency({ cpuBudget: 8, deviceMemory: 4 }), 2,
    'known low-memory devices should start conservatively');
  assert.equal(defaultImageRecipeConcurrency({ cpuBudget: 8, mobile: true }), 2,
    'phone layouts should start with fewer simultaneous large-image working sets');
  assert.equal(defaultImageRecipeConcurrency({ cpuBudget: 1, mobile: true }), 1,
    'single-core devices remain serialized');
  assert.throws(() => defaultImageRecipeConcurrency({ cpuBudget: 0 }), /positive integer/);
});
