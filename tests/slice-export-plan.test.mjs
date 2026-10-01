import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SLICE_EXPORT_AXIS,
  MAX_SLICE_EXPORT_PIXELS,
  SUPPORTED_SLICE_EXPORT_SCALES,
  isValidSliceDimensionInput,
  planSliceRenderSurface,
  planSliceRasterExport,
  sliceExportContentSignature,
  sliceRasterBoundsIntersect,
  sliceRenderBleedPixels,
  validateSliceRect,
} from '../src/slice-export-plan.js';

test('slice crop dependency bounds use strict overlap and keep malformed geometry conservatively', () => {
  const crop = { x: 10, y: 20, width: 30, height: 40 };
  assert.equal(sliceRasterBoundsIntersect(crop, { x: 0, y: 25, width: 10, height: 10 }), false);
  assert.equal(sliceRasterBoundsIntersect(crop, { x: 39, y: 59, width: 4, height: 4 }), true);
  assert.equal(sliceRasterBoundsIntersect(crop, { x: 40, y: 20, width: 5, height: 5 }), false);
  assert.equal(sliceRasterBoundsIntersect(crop, null), true);
  assert.equal(sliceRasterBoundsIntersect(crop, { x: 0, y: 0, width: 0, height: 1 }), true);
});

test('slice dimension input refuses blanks and nonpositive or oversized geometry', () => {
  for (const value of ['', '  ', '0', '0.5', '-1', '100001', 'NaN', Infinity, null]) {
    assert.equal(isValidSliceDimensionInput(value), false, String(value));
  }
  for (const value of ['1', '1.25', '100000', 8]) {
    assert.equal(isValidSliceDimensionInput(value), true, String(value));
  }
});

test('slice export content signature is stable for equivalent trees and changes with artwork edits', () => {
  const pageChildren = [{ id: 'rect', width: 10, fill: '#fff' }, { id: 'photo', assetId: 'asset-1' }];
  const original = sliceExportContentSignature(pageChildren);
  assert.equal(sliceExportContentSignature(structuredClone(pageChildren)), original);
  pageChildren[0].width = 11;
  assert.notEqual(sliceExportContentSignature(pageChildren), original);
  assert.equal(sliceExportContentSignature(undefined), null);
});

test('backdrop render surface adds bounded bleed and keeps expanded axes and pixels within budget', () => {
  const plan = planSliceRasterExport({ x: 0, y: 0, width: 100, height: 80 }, { padding: 2 });
  assert.deepEqual(planSliceRenderSurface(plan, 12), { width: 128, height: 108, bleed: 12, pixels: 13_824 });
  assert.throws(() => planSliceRenderSurface(plan, -1), TypeError);
  assert.throws(() => planSliceRenderSurface({ outputSize: { width: MAX_SLICE_EXPORT_AXIS, height: 1 } }, 1), /axis limit/);
  assert.throws(() => planSliceRenderSurface({ outputSize: { width: 4000, height: 4000 } }, 1), /pixel limit/);
  assert.equal(sliceRenderBleedPixels(300, 2), 602);
  assert.equal(sliceRenderBleedPixels(96, 4), 386);
  assert.equal(sliceRenderBleedPixels(0, 4), 0);
  assert.throws(() => sliceRenderBleedPixels(-1, 1), TypeError);
});

test('slice source crop preserves fractional canvas coordinates and rounds output dimensions up', () => {
  const plan = planSliceRasterExport({ x: -12.25, y: 4.5, width: 10.1, height: 3.01 }, { scale: 1.5 });
  assert.deepEqual(plan.sourceCrop, { x: -12.25, y: 4.5, width: 10.1, height: 3.01 });
  assert.deepEqual(plan.outputSize, { width: 16, height: 5 });
  assert.equal(plan.pixels, 80);
});

test('pixel padding may be uniform or specified per side and is not scaled', () => {
  const uniform = planSliceRasterExport({ x: 0.25, y: 0.75, width: 10, height: 8 }, { scale: 2, padding: 3 });
  assert.deepEqual(uniform.outputSize, { width: 26, height: 22 });
  assert.deepEqual(uniform.padding, { top: 3, right: 3, bottom: 3, left: 3 });

  const perSide = planSliceRasterExport({ x: 0, y: 0, width: 10, height: 8 }, {
    padding: { top: 1, right: 2, bottom: 3, left: 4 },
  });
  assert.deepEqual(perSide.outputSize, { width: 16, height: 12 });
  assert.deepEqual(perSide.padding, { top: 1, right: 2, bottom: 3, left: 4 });
});

test('every editor-supported raster export scale is accepted', () => {
  assert.deepEqual(SUPPORTED_SLICE_EXPORT_SCALES, [0.5, 0.75, 1, 1.5, 2, 3, 4]);
  for (const scale of SUPPORTED_SLICE_EXPORT_SCALES) {
    assert.equal(planSliceRasterExport({ x: 0, y: 0, width: 4, height: 6 }, { scale }).scale, scale);
  }
  for (const scale of [0, -1, 0.25, 1.25, 8, Infinity, NaN, '2']) {
    assert.throws(() => planSliceRasterExport({ x: 0, y: 0, width: 4, height: 6 }, { scale }), RangeError);
  }
});

test('slice validation rejects missing, non-finite, and non-positive geometry', () => {
  for (const slice of [null, [], {}, { x: 0, y: 0, width: 1 },
    { x: Infinity, y: 0, width: 1, height: 1 }, { x: 0, y: NaN, width: 1, height: 1 }]) {
    assert.throws(() => validateSliceRect(slice), TypeError);
  }
  for (const slice of [{ x: 0, y: 0, width: 0, height: 1 }, { x: 0, y: 0, width: 1, height: -1 }]) {
    assert.throws(() => validateSliceRect(slice), RangeError);
  }
  assert.throws(() => validateSliceRect({ x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 1 }), /safe coordinate range/);
  assert.deepEqual(validateSliceRect({ x: 0, y: 0, width: Number.MAX_SAFE_INTEGER, height: 1 }), { x: 0, y: 0, width: Number.MAX_SAFE_INTEGER, height: 1 });
  assert.throws(() => planSliceRasterExport({ x: Number.MAX_SAFE_INTEGER * 0.75, y: 0, width: 10, height: 1 }, { scale: 2 }), /Scaled slice coordinates exceed the safe range/);
});

test('padding rejects fractional, negative, unsafe, and unknown-side values', () => {
  const slice = { x: 0, y: 0, width: 2, height: 2 };
  for (const padding of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null, [], { left: -1 }, { right: 1.5 }, { bottom: Infinity }, { centre: 1 }]) {
    assert.throws(() => planSliceRasterExport(slice, { padding }), TypeError);
  }
});

test('export dimension axis and pixel budgets are enforced', () => {
  assert.deepEqual(planSliceRasterExport({ x: 0, y: 0, width: MAX_SLICE_EXPORT_AXIS, height: 1 }).outputSize,
    { width: MAX_SLICE_EXPORT_AXIS, height: 1 });
  assert.equal(planSliceRasterExport({ x: 0, y: 0, width: 4000, height: 4000 }).pixels, MAX_SLICE_EXPORT_PIXELS);
  assert.throws(() => planSliceRasterExport({ x: 0, y: 0, width: MAX_SLICE_EXPORT_AXIS + 0.1, height: 1 }), /axis limit/);
  assert.throws(() => planSliceRasterExport({ x: 0, y: 0, width: 4000, height: 4001 }), /16,000,000 pixel limit/);
  assert.throws(() => planSliceRasterExport({ x: 0, y: 0, width: 100, height: 100 }, { padding: 16_284 }), /axis limit/);
  assert.throws(() => planSliceRasterExport({ x: 0, y: 0, width: 1e308, height: 1 }), /safe coordinate range/);
});
