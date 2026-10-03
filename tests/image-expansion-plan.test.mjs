import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compositeExpandedImageRgba,
  createImageExpansionMask,
  planImageExpansion,
} from '../src/image-expansion-plan.js';
import { MAX_INPAINT_SOURCE_PIXELS } from '../src/inpaint-mask.js';

test('expansion validates positive finite integer source dimensions and non-negative integer padding', () => {
  for (const [width, height] of [[0, 2], [-1, 4], [1.5, 2], [NaN, 3], [Infinity, 3], [Number.MAX_SAFE_INTEGER, 2]]) {
    assert.throws(() => planImageExpansion(width, height, { right: 1 }), /integer|pixel-count/);
  }
  for (const padding of [null, [], {}, { left: -1 }, { top: 0.5 }, { right: NaN }, { bottom: Infinity }]) {
    assert.throws(() => planImageExpansion(3, 2, padding), /padding|integer/);
  }
  assert.throws(() => planImageExpansion(3, 2, { top: 0, right: 0, bottom: 0, left: 0 }), /positive padding/);
  assert.throws(() => planImageExpansion(MAX_INPAINT_SOURCE_PIXELS + 1, 1, { right: 1 }), /at most/);
});

test('landscape expansion returns deterministic offsets, bounds, and disjoint side regions', () => {
  const padding = { top: 2, right: 3, bottom: 4, left: 5 };
  const plan = planImageExpansion(7, 6, padding);
  assert.deepEqual(plan, planImageExpansion(7, 6, { ...padding }));
  assert.equal(plan.width, 15);
  assert.equal(plan.height, 12);
  assert.equal(plan.pixelCount, 180);
  assert.equal(plan.offsetX, 5);
  assert.equal(plan.offsetY, 2);
  assert.deepEqual(plan.sourceRect, { x: 5, y: 2, width: 7, height: 6 });
  assert.deepEqual(plan.unknownRegions, [
    { x: 0, y: 0, width: 15, height: 2 },
    { x: 0, y: 8, width: 15, height: 4 },
    { x: 0, y: 2, width: 5, height: 6 },
    { x: 12, y: 2, width: 3, height: 6 },
  ]);
  assert.equal(plan.unknownRegions.reduce((sum, region) => sum + region.width * region.height, 0), plan.pixelCount - 42);
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.unknownRegions) && Object.isFrozen(plan.unknownRegions[0]));
});

test('portrait expansion aligns the source at the exact requested integer offset', () => {
  const plan = planImageExpansion(3, 8, { top: 1, right: 2, bottom: 3, left: 4 });
  assert.equal(plan.width, 9);
  assert.equal(plan.height, 12);
  assert.deepEqual(plan.sourceRect, { x: 4, y: 1, width: 3, height: 8 });
  assert.deepEqual(plan.unknownRegions, [
    { x: 0, y: 0, width: 9, height: 1 },
    { x: 0, y: 9, width: 9, height: 3 },
    { x: 0, y: 1, width: 4, height: 8 },
    { x: 7, y: 1, width: 2, height: 8 },
  ]);
});

test('MI-GAN expansion mask marks source as known and each added region as fillable', () => {
  const plan = planImageExpansion(3, 2, { top: 1, right: 2, bottom: 1, left: 1 });
  const mask = createImageExpansionMask(plan);
  assert.equal(mask.length, plan.pixelCount);
  for (let y = 0; y < plan.height; y += 1) {
    for (let x = 0; x < plan.width; x += 1) {
      const insideSource = x >= plan.offsetX && x < plan.offsetX + plan.sourceWidth
        && y >= plan.offsetY && y < plan.offsetY + plan.sourceHeight;
      assert.equal(mask[y * plan.width + x], insideSource ? 255 : 0, `mask at (${x}, ${y})`);
    }
  }
});

test('expanded canvas admission accepts the exact maximum and rejects one pixel over', () => {
  const exactWidth = MAX_INPAINT_SOURCE_PIXELS / 2048;
  const plan = planImageExpansion(exactWidth - 1, 2048, { right: 1 });
  assert.equal(plan.pixelCount, MAX_INPAINT_SOURCE_PIXELS);
  assert.equal(createImageExpansionMask(plan).length, MAX_INPAINT_SOURCE_PIXELS);
  assert.throws(() => planImageExpansion(exactWidth, 2048, { right: 1 }), /at most/);
});

test('RGBA compositing restores every original source pixel at the planned offset', () => {
  const plan = planImageExpansion(2, 2, { top: 1, right: 1, bottom: 1, left: 1 });
  const source = new Uint8ClampedArray([
    1, 2, 3, 4, 5, 6, 7, 8,
    9, 10, 11, 12, 13, 14, 15, 16,
  ]);
  const originalSource = source.slice();
  const generated = new Uint8Array(plan.pixelCount * 4).fill(220);
  const originalGenerated = generated.slice();
  const output = compositeExpandedImageRgba(source, generated, plan);

  assert.ok(output instanceof Uint8ClampedArray);
  assert.deepEqual(generated, originalGenerated, 'generated input is not mutated');
  assert.deepEqual(source, originalSource, 'source input is not mutated');
  for (let y = 0; y < plan.sourceHeight; y += 1) {
    const sourceRow = source.subarray(y * plan.sourceWidth * 4, (y + 1) * plan.sourceWidth * 4);
    const destinationStart = ((plan.offsetY + y) * plan.width + plan.offsetX) * 4;
    assert.deepEqual(output.subarray(destinationStart, destinationStart + plan.sourceWidth * 4), sourceRow);
  }
  assert.deepEqual([...output.subarray(0, 4)], [220, 220, 220, 220], 'generated pixels remain in added regions');
});

test('RGBA compositing rejects buffers with mismatched dimensions or channel counts', () => {
  const plan = planImageExpansion(2, 1, { bottom: 1 });
  assert.throws(() => compositeExpandedImageRgba(new Uint8Array(7), new Uint8Array(plan.pixelCount * 4), plan), /matching/);
  assert.throws(() => compositeExpandedImageRgba(new Uint8Array(8), new Uint8Array(plan.pixelCount * 3), plan), /matching/);
  assert.throws(() => compositeExpandedImageRgba(new Float32Array(8), new Uint8Array(plan.pixelCount * 4), plan), /matching/);
});

test('mask and compositor reject a plan whose declared canvas dimensions were changed', () => {
  const plan = { ...planImageExpansion(2, 1, { right: 1 }), width: 99 };
  assert.throws(() => createImageExpansionMask(plan), /do not match/);
  assert.throws(() => compositeExpandedImageRgba(new Uint8Array(8), new Uint8Array(12), plan), /do not match/);
});
