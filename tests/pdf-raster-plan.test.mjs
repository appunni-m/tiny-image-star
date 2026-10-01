import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addVectorPdfEmbeddedImageBytes, hasRasterImageEdits, MAX_VECTOR_PDF_EMBEDDED_IMAGE_BYTES,
  planVectorPdfRaster, planVectorPdfRasterSource, VectorPdfImageBudgetError,
} from '../src/pdf-raster-plan.js';

test('untouched local PNG and JPEG sources remain byte-preserving PDF image inputs', () => {
  for (const mimeType of ['image/png', 'IMAGE/JPEG', 'image/jpeg; charset=binary']) {
    const plan = planVectorPdfRaster({ mimeType });
    assert.equal(plan.kind, 'source');
    assert.equal(plan.outputMimeType, plan.sourceMimeType);
  }
  assert.equal(hasRasterImageEdits(), false);
});

test('pixel edits, crop, rotation, and flips request a lossless local PNG preview', () => {
  const cases = [
    { adjustments: { brightness: 20 } },
    { adjustments: { highlights: 20 } },
    { adjustments: { shadows: -15 } },
    { adjustments: { solarize: true, solarizeThreshold: 128 } },
    { adjustments: { posterizeBits: 3 } },
    { transforms: { crop: { left: .1, top: 0, right: .9, bottom: 1 } } },
    { transforms: { rotation: 90 } },
    { transforms: { flipHorizontal: true } },
    { transforms: { flipVertical: true } },
    { inpaintStrokes: [{ radius: 0.04, points: [{ x: 0.3, y: 0.6 }] }] },
  ];
  for (const options of cases) {
    assert.equal(hasRasterImageEdits(options.adjustments, options.transforms, options.inpaintStrokes), true);
    assert.deepEqual(planVectorPdfRaster({ mimeType: 'image/jpeg', ...options }), {
      kind: 'png-preview', sourceMimeType: 'image/jpeg', outputMimeType: 'image/png',
    });
  }
  assert.equal(planVectorPdfRaster({ mimeType: 'image/webp', adjustments: { contrast: 10 } }).kind, 'png-preview',
    'the local renderer may convert an edited supported source to a PDF-compatible PNG');
});

test('untouched codecs outside PNG/JPEG fail closed instead of being mislabeled or flattened', () => {
  for (const mimeType of ['image/webp', 'image/gif', 'image/avif', '', 'application/octet-stream']) {
    const plan = planVectorPdfRaster({ mimeType });
    assert.equal(plan.kind, 'unsupported');
    assert.equal(plan.outputMimeType, null);
  }
});

test('source planning distinguishes missing local bytes and invalid adjustment records', () => {
  assert.equal(planVectorPdfRasterSource({ asset: { type: 'image/png' } }).kind, 'missing-source');
  assert.equal(planVectorPdfRasterSource({ asset: { type: 'image/png', sourceBytes: new Uint8Array() } }).kind, 'missing-source');
  assert.equal(planVectorPdfRasterSource({
    asset: { type: 'image/png', sourceBytes: new Uint8Array([1]) },
    adjustments: { brightness: 900 },
  }).kind, 'invalid-adjustments');
  assert.equal(planVectorPdfRasterSource({
    asset: { mimeType: 'image/jpeg; charset=binary', sourceBytes: new Uint8Array([1]) },
  }).kind, 'source');
  assert.equal(planVectorPdfRasterSource({
    asset: { type: 'image/png', sourceBytes: new Uint8Array([1]) },
    inpaintStrokes: [{ radius: 0, points: [{ x: 0.5, y: 0.5 }] }],
  }).kind, 'invalid-inpaint-strokes');
});

test('direct images and rendered previews share a bounded aggregate embedded-image budget', () => {
  assert.equal(MAX_VECTOR_PDF_EMBEDDED_IMAGE_BYTES, 80 * 1024 * 1024);
  assert.equal(addVectorPdfEmbeddedImageBytes(0, 4, { limitBytes: 10 }), 4);
  assert.equal(addVectorPdfEmbeddedImageBytes(4, 6, { limitBytes: 10 }), 10);
  assert.throws(() => addVectorPdfEmbeddedImageBytes(10, 1, { limitBytes: 10 }), VectorPdfImageBudgetError);
  assert.throws(() => addVectorPdfEmbeddedImageBytes(Number.MAX_SAFE_INTEGER, 1), RangeError,
    'overflowing totals must fail before data-URL/base64 expansion');
});
