import test from 'node:test';
import assert from 'node:assert/strict';
import {
  imageCropFromDisplayDrag,
  imageCropFromDisplayRect,
  imageCropToDisplayRect,
  calculateImageCropDisplayBounds,
  moveImageCropHandle,
} from '../src/image-crop-geometry.js';

const sourceCrop = { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 };
const bounds = { left: 100, top: 50, width: 200, height: 100 };
function assertRectClose(actual, expected, message = '') {
  for (const edge of ['left', 'top', 'right', 'bottom']) {
    assert.ok(Math.abs(actual[edge] - expected[edge]) < 1e-12,
      `${message} ${edge}: expected ${expected[edge]}, received ${actual[edge]}`);
  }
}

test('source and displayed crop rectangles round-trip in all quarter-turn orientations', () => {
  const expectedDisplayed = [
    sourceCrop,
    { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 },
    { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 },
    { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 },
  ];
  for (const [index, rotation] of [0, 90, 180, 270].entries()) {
    const displayed = imageCropToDisplayRect(sourceCrop, rotation);
    assertRectClose(displayed, expectedDisplayed[index], `${rotation}° displayed crop`);
    assertRectClose(imageCropFromDisplayRect(displayed, rotation), sourceCrop, `${rotation}° inverse mapping`);
  }
});

test('flipped crop rectangles and pointer drags map back to their original source axes', () => {
  for (const rotation of [0, 90, 180, 270]) {
    for (const flips of [{}, { flipHorizontal: true }, { flipVertical: true }, { flipHorizontal: true, flipVertical: true }]) {
      const displayed = imageCropToDisplayRect(sourceCrop, rotation, flips);
      assertRectClose(imageCropFromDisplayRect(displayed, rotation, flips), sourceCrop,
        `${rotation}° ${JSON.stringify(flips)} displayed crop round-trip`);
    }
  }

  const mirroredDrag = imageCropFromDisplayDrag({
    start: { x: 120, y: 60 }, end: { x: 240, y: 90 }, bounds,
    sourceWidth: 400, sourceHeight: 200, flipHorizontal: true,
  });
  assertRectClose(mirroredDrag, { left: 0.3, top: 0.1, right: 0.9, bottom: 0.4 },
    'a visible left-to-right drag on a mirrored image maps to the matching source rectangle');

  const mirroredHandle = moveImageCropHandle({
    crop: sourceCrop, handle: 'e', point: { x: 240, y: 70 }, bounds,
    sourceWidth: 400, sourceHeight: 200, flipHorizontal: true,
  });
  assertRectClose(mirroredHandle, { left: 0.3, top: 0.1, right: 0.8, bottom: 0.9 },
    'a visible right-edge drag on a mirrored image edits the correct original source edge');
});

test('display drag maps to source-normalized crop and clamps pointer positions to displayed bounds', () => {
  const crop = imageCropFromDisplayDrag({
    start: { x: 120, y: 60 }, end: { x: 240, y: 90 }, bounds,
    rotation: 0, sourceWidth: 400, sourceHeight: 200,
  });
  assert.deepEqual(crop, { left: 0.1, top: 0.1, right: 0.7, bottom: 0.4 });

  const clamped = imageCropFromDisplayDrag({
    start: { x: -100, y: -50 }, end: { x: 400, y: 500 }, bounds,
    sourceWidth: 400, sourceHeight: 200,
  });
  assert.deepEqual(clamped, { left: 0, top: 0, right: 1, bottom: 1 });

  const reverseDrag = imageCropFromDisplayDrag({
    start: { x: 240, y: 90 }, end: { x: 120, y: 60 }, bounds,
    sourceWidth: 400, sourceHeight: 200,
  });
  assert.deepEqual(reverseDrag, crop, 'drag direction must not change the selected rectangle');
});

test('clockwise 90-degree displayed drag maps axes and edges back to original source', () => {
  // A 100×200 source rotated clockwise is displayed as 200×100.
  const crop = imageCropFromDisplayDrag({
    start: { x: 120, y: 60 }, end: { x: 220, y: 90 }, bounds,
    rotation: 90, sourceWidth: 100, sourceHeight: 200,
  });
  assert.deepEqual(crop, { left: 0.1, top: 0.4, right: 0.4, bottom: 0.9 });

  const counterClockwise = imageCropFromDisplayDrag({
    start: { x: 120, y: 60 }, end: { x: 220, y: 90 }, bounds,
    rotation: -90, sourceWidth: 100, sourceHeight: 200,
  });
  assert.deepEqual(counterClockwise, { left: 0.6, top: 0.1, right: 0.9, bottom: 0.6 },
    'negative 90° normalizes to the editor’s 270° counter-clockwise turn');
});

test('handle movement edits the requested displayed edge after mapping through source rotation', () => {
  const crop = moveImageCropHandle({
    crop: sourceCrop, handle: 'e', point: { x: 240, y: 70 }, bounds,
    rotation: 90, sourceWidth: 100, sourceHeight: 200,
  });
  assertRectClose(crop, { left: 0.2, top: 0.3, right: 0.8, bottom: 0.9 });

  const corner = moveImageCropHandle({
    crop: sourceCrop, handle: 'nw', point: { x: 130, y: 70 }, bounds,
    rotation: 0, sourceWidth: 400, sourceHeight: 200,
  });
  assertRectClose(corner, { left: 0.15, top: 0.2, right: 0.8, bottom: 0.9 });
});

test('handle motion cannot cross the opposite edge or crop away a full source axis', () => {
  const minimumWidth = moveImageCropHandle({
    crop: sourceCrop, handle: 'e', point: { x: 101, y: 70 }, bounds,
    rotation: 90, sourceWidth: 100, sourceHeight: 200,
  });
  assert.equal(minimumWidth.left, sourceCrop.left);
  assert.equal(minimumWidth.right, sourceCrop.right);
  assert.equal(minimumWidth.bottom, sourceCrop.bottom);
  assert.ok((minimumWidth.bottom - minimumWidth.top) * 200 >= 1,
    'a rotated handle must leave at least one pixel on the source vertical axis');

  const minimumDrag = imageCropFromDisplayDrag({
    start: { x: 120, y: 60 }, end: { x: 121, y: 60.25 }, bounds,
    rotation: 0, sourceWidth: 400, sourceHeight: 200,
  });
  assert.equal(minimumDrag, null, 'subpixel source selections are not valid crop rectangles');
});

test('fitted draw and virtual source bounds match cover/contain for crop-before-clockwise-rotation', () => {
  const input = {
    frameWidth: 96, frameHeight: 96,
    sourceWidth: 400, sourceHeight: 200,
    crop: { left: 0.26, top: 0.26, right: 0.74, bottom: 0.74 },
    rotation: 90,
  };
  const cover = calculateImageCropDisplayBounds({ ...input, fit: 'cover' });
  assert.deepEqual(cover.orientedSourceSize, { width: 200, height: 400 });
  assert.deepEqual(cover.croppedImageSize, { width: 96, height: 192 },
    'crop pixel rounding occurs against the source before the 90° axis swap');
  assert.deepEqual(cover.cropInDisplayPixels, { left: 52, top: 104, right: 148, bottom: 296 });
  assert.deepEqual(cover.drawBounds, { left: 0, top: -48, width: 96, height: 192 });
  assert.deepEqual(cover.virtualBounds, { left: -52, top: -152, width: 200, height: 400 });

  const contain = calculateImageCropDisplayBounds({ ...input, fit: 'contain' });
  assert.deepEqual(contain.drawBounds, { left: 24, top: 0, width: 48, height: 96 });
  assert.deepEqual(contain.virtualBounds, { left: -2, top: -52, width: 100, height: 200 });
});

test('full-source fit bounds use the renderer max/min scale and centered placement', () => {
  const input = { frameWidth: 100, frameHeight: 100, sourceWidth: 400, sourceHeight: 200 };
  const cover = calculateImageCropDisplayBounds({ ...input, fit: 'cover' });
  assert.deepEqual(cover.drawBounds, { left: -50, top: 0, width: 200, height: 100 });
  assert.deepEqual(cover.virtualBounds, cover.drawBounds);

  const contain = calculateImageCropDisplayBounds({ ...input, fit: 'contain' });
  assert.deepEqual(contain.drawBounds, { left: 0, top: 25, width: 100, height: 50 });
  assert.deepEqual(contain.virtualBounds, contain.drawBounds);
});

test('flipped crop pixels anchor to the same mirrored full-source context as the overlay', () => {
  const result = calculateImageCropDisplayBounds({
    frameWidth: 100, frameHeight: 100, sourceWidth: 400, sourceHeight: 200,
    crop: { left: 0.1, top: 0.2, right: 0.6, bottom: 0.8 },
    flipHorizontal: true, fit: 'contain',
  });
  assert.deepEqual(result.cropInDisplayPixels, { left: 160, top: 40, right: 360, bottom: 160 });
  assert.deepEqual(result.drawBounds, { left: 0, top: 20, width: 100, height: 60 });
  assert.deepEqual(result.virtualBounds, { left: -80, top: 0, width: 200, height: 100 });
});

test('fitted bounds reject invalid layer dimensions, image dimensions, and fit values', () => {
  const valid = { frameWidth: 100, frameHeight: 80, sourceWidth: 120, sourceHeight: 60 };
  assert.throws(() => calculateImageCropDisplayBounds({ ...valid, frameWidth: 0 }), /finite and positive/);
  assert.throws(() => calculateImageCropDisplayBounds({ ...valid, sourceHeight: 0 }), /positive safe integers/);
  assert.throws(() => calculateImageCropDisplayBounds({ ...valid, fit: 'stretch' }), /cover or contain/);
});

test('crop geometry rejects invalid source bounds, pointer coordinates, rotations, and handles', () => {
  const drag = overrides => imageCropFromDisplayDrag({
    start: { x: 120, y: 60 }, end: { x: 220, y: 90 }, bounds,
    sourceWidth: 400, sourceHeight: 200, ...overrides,
  });
  assert.throws(() => drag({ bounds: { left: 0, top: 0, width: 0, height: 10 } }), /positive dimensions/);
  assert.throws(() => drag({ start: { x: NaN, y: 0 } }), /finite/);
  assert.throws(() => drag({ rotation: 45 }), /quarter turns/);
  assert.throws(() => drag({ sourceWidth: 0 }), /positive safe integers/);
  assert.throws(() => moveImageCropHandle({
    crop: sourceCrop, handle: 'center', point: { x: 120, y: 70 }, bounds,
    sourceWidth: 400, sourceHeight: 200,
  }), /crop handle/);
});
