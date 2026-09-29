import assert from "node:assert/strict";
import test from "node:test";
import { textCompositorWorkerCounts } from "./text-compositor.browser.mjs";

test("text compositor smoke respects small reported CPU budgets", () => {
  assert.deepEqual(textCompositorWorkerCounts(1), [1]);
  assert.deepEqual(textCompositorWorkerCounts(2), [1, 2]);
  assert.deepEqual(textCompositorWorkerCounts(3), [1, 3]);
  assert.deepEqual(textCompositorWorkerCounts(4), [1, 4]);
  assert.deepEqual(textCompositorWorkerCounts(8), [1, 4, 8]);
  assert.deepEqual(textCompositorWorkerCounts(11), [1, 4, 8]);
  assert.throws(() => textCompositorWorkerCounts(0), RangeError);
});
