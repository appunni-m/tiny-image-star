import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateImageFillCropWindow,
  moveImageFillCropWindow,
  zoomImageFillCropWindow,
} from '../src/image-fill-geometry.js';
import { imageCropFromDisplayRect } from '../src/image-crop-geometry.js';

const fullBounds = { left: 0, top: 0, width: 400, height: 200 };

function assertRectClose(actual, expected, message = '') {
  for (const edge of ['left', 'top', 'right', 'bottom']) {
    assert.ok(Math.abs(actual[edge] - expected[edge]) < 1e-12,
      `${message} ${edge}: expected ${expected[edge]}, received ${actual[edge]}`);
  }
}

test('fill starts at the centered cover window and fit can keep the whole source', () => {
  assert.deepEqual(calculateImageFillCropWindow({
    frameWidth: 100, frameHeight: 100, sourceWidth: 400, sourceHeight: 200, fit: 'cover',
  }), { left: 0.25, top: 0, right: 0.75, bottom: 1 });
  assert.deepEqual(calculateImageFillCropWindow({
    frameWidth: 100, frameHeight: 100, sourceWidth: 400, sourceHeight: 200, fit: 'contain',
  }), { left: 0, top: 0, right: 1, bottom: 1 });

  const portrait = calculateImageFillCropWindow({
    frameWidth: 100, frameHeight: 200, sourceWidth: 400, sourceHeight: 200, fit: 'cover',
  });
  assert.deepEqual(portrait, { left: 0.375, top: 0, right: 0.625, bottom: 1 });
});

test('cover window uses the rotated source orientation and remains symmetric under flips', () => {
  const rotated = calculateImageFillCropWindow({
    frameWidth: 100,
    frameHeight: 100,
    sourceWidth: 400,
    sourceHeight: 200,
    transforms: { rotation: 90 },
    fit: 'cover',
  });
  assert.deepEqual(rotated, { left: 0, top: 0.25, right: 1, bottom: 0.75 });

  const flipped = calculateImageFillCropWindow({
    frameWidth: 100,
    frameHeight: 100,
    sourceWidth: 400,
    sourceHeight: 200,
    transforms: { flipHorizontal: true, flipVertical: true },
    fit: 'cover',
  });
  assert.deepEqual(flipped, { left: 0.25, top: 0, right: 0.75, bottom: 1 });
});

test('an explicit source crop maps through rotation and flips before applying fill aspect', () => {
  const crop = { left: 0.1, top: 0.2, right: 0.7, bottom: 0.8 };
  const result = calculateImageFillCropWindow({
    frameWidth: 100,
    frameHeight: 100,
    sourceWidth: 400,
    sourceHeight: 200,
    transforms: { crop, rotation: 90, flipVertical: true },
    fit: 'cover',
  });
  assertRectClose(result, { left: 0.2, top: 0.45, right: 0.8, bottom: 0.75 });

  const contained = calculateImageFillCropWindow({
    frameWidth: 100,
    frameHeight: 100,
    sourceWidth: 400,
    sourceHeight: 200,
    transforms: { crop, rotation: 90, flipVertical: true },
    fit: 'contain',
  });
  assertRectClose(contained, { left: 0.2, top: 0.3, right: 0.8, bottom: 0.9 });
});

test('cover rejects extreme finite aspect inputs when a centered normalized crop is unrepresentable', () => {
  assert.throws(() => calculateImageFillCropWindow({
    frameWidth: 1e308,
    frameHeight: 1e-308,
    sourceWidth: 400,
    sourceHeight: 200,
  }), /too extreme to represent a non-empty crop/);

  // Both direct aspect calculations overflow to Infinity, but the underlying
  // ratios differ substantially; do not mistake Infinity === Infinity for an
  // aspect match and return a crop that does not cover the frame.
  assert.throws(() => calculateImageFillCropWindow({
    frameWidth: 1e308,
    frameHeight: 1e-308,
    sourceWidth: 1,
    sourceHeight: 1,
    transforms: { crop: { left: 0, top: 0, right: 1, bottom: 1e-320 } },
  }), /too extreme to represent a non-empty crop/);
});

test('pan moves the source window opposite the image drag and clamps without resizing', () => {
  const crop = { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 };
  const moved = moveImageFillCropWindow({
    crop, deltaX: 20, deltaY: -10, bounds: fullBounds,
    sourceWidth: 400, sourceHeight: 200,
  });
  assert.deepEqual(moved, { left: 0.2, top: 0.3, right: 0.7, bottom: 0.8 });

  const clampedLeft = moveImageFillCropWindow({
    crop, deltaX: 1000, deltaY: 0, bounds: fullBounds,
    sourceWidth: 400, sourceHeight: 200,
  });
  assert.deepEqual(clampedLeft, { left: 0, top: 0.25, right: 0.5, bottom: 0.75 });
  const clampedRight = moveImageFillCropWindow({
    crop, deltaX: -1000, deltaY: 0, bounds: fullBounds,
    sourceWidth: 400, sourceHeight: 200,
  });
  assert.deepEqual(clampedRight, { left: 0.5, top: 0.25, right: 1, bottom: 0.75 });
});

test('pan respects rotated and flipped displayed axes when returning source crop', () => {
  const displayCrop = { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 };
  const sourceCrop = imageCropFromDisplayRect(displayCrop, 90, { flipHorizontal: true });
  const result = moveImageFillCropWindow({
    crop: sourceCrop,
    deltaX: 20,
    deltaY: 10,
    bounds: { left: 0, top: 0, width: 200, height: 400 },
    sourceWidth: 400,
    sourceHeight: 200,
    rotation: 90,
    flipHorizontal: true,
  });
  const resultingDisplay = {
    left: 0.1, top: 0.175, right: 0.7, bottom: 0.775,
  };
  assertRectClose(imageCropFromDisplayRect(result, 90, { flipHorizontal: true }), resultingDisplay);
});

test('zoom anchors its focal point, scales both axes uniformly, and clamps at source edges', () => {
  const crop = { left: 0.25, top: 0, right: 0.75, bottom: 1 };
  const bounds = { left: -50, top: 0, width: 200, height: 100 };
  const result = zoomImageFillCropWindow({
    crop, zoom: 2, focal: { x: 90, y: 60 }, bounds,
    sourceWidth: 400, sourceHeight: 200,
  });
  assertRectClose(result, { left: 0.475, top: 0.3, right: 0.725, bottom: 0.8 });

  const clamped = zoomImageFillCropWindow({
    crop: { left: 0, top: 0, right: 1, bottom: 1 },
    zoom: 2,
    focal: { x: 0, y: 0 },
    bounds: fullBounds,
    sourceWidth: 400,
    sourceHeight: 200,
  });
  assertRectClose(clamped, { left: 0, top: 0, right: 0.5, bottom: 0.5 });
});

test('zoom-out fills the source at most, huge zoom retains at least one source pixel', () => {
  const zoomedOut = zoomImageFillCropWindow({
    crop: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
    zoom: 0.01,
    focal: { x: 200, y: 100 },
    bounds: fullBounds,
    sourceWidth: 400,
    sourceHeight: 200,
  });
  assert.deepEqual(zoomedOut, { left: 0, top: 0, right: 1, bottom: 1 });

  const maximumZoom = zoomImageFillCropWindow({
    crop: { left: 0, top: 0, right: 1, bottom: 1 },
    zoom: Number.MAX_VALUE,
    focal: { x: 200, y: 100 },
    bounds: fullBounds,
    sourceWidth: 400,
    sourceHeight: 200,
  });
  assert.ok((maximumZoom.right - maximumZoom.left) * 400 >= 1 - 1e-9);
  assert.ok((maximumZoom.bottom - maximumZoom.top) * 200 >= 1 - 1e-9);
});

test('geometry rejects invalid dimensions, deltas, zoom values, points, bounds, and transforms', () => {
  const valid = { frameWidth: 100, frameHeight: 80, sourceWidth: 400, sourceHeight: 200 };
  assert.throws(() => calculateImageFillCropWindow({ ...valid, frameWidth: Infinity }), /finite and positive/);
  assert.throws(() => calculateImageFillCropWindow({ ...valid, sourceWidth: 0 }), /positive safe integers/);
  assert.throws(() => calculateImageFillCropWindow({ ...valid, fit: 'stretch' }), /cover or contain/);
  assert.throws(() => calculateImageFillCropWindow({ ...valid, transforms: { rotation: 45 } }), /quarter turns/);

  const move = overrides => moveImageFillCropWindow({
    crop: null, deltaX: 0, deltaY: 0, bounds: fullBounds,
    sourceWidth: 400, sourceHeight: 200, ...overrides,
  });
  assert.throws(() => move({ deltaX: NaN }), /deltas must be finite/);
  assert.throws(() => move({ bounds: { ...fullBounds, width: 0 } }), /positive dimensions/);
  assert.throws(() => move({ rotation: 45 }), /quarter turns/);
  assert.throws(() => move({ crop: { left: 0.7, top: 0, right: 0.2, bottom: 1 } }), /non-empty rectangle/);

  const zoom = overrides => zoomImageFillCropWindow({
    crop: { left: 0, top: 0, right: 1, bottom: 1 }, zoom: 1,
    focal: { x: 100, y: 50 }, bounds: fullBounds,
    sourceWidth: 400, sourceHeight: 200, ...overrides,
  });
  assert.throws(() => zoom({ zoom: 0 }), /finite and positive/);
  assert.throws(() => zoom({ zoom: Infinity }), /finite and positive/);
  assert.throws(() => zoom({ focal: { x: NaN, y: 50 } }), /focal coordinates must be finite/);
  assert.throws(() => zoom({ sourceHeight: NaN }), /positive safe integers/);
});
