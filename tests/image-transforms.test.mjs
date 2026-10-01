import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageTransforms, flipImageTransforms, normalizeImageTransforms, rotateImageTransforms } from '../src/image-transforms.js';

test('legacy image transforms normalize to explicit unflipped defaults', () => {
  assert.deepEqual(createImageTransforms(), {
    crop: null, rotation: 0, flipHorizontal: false, flipVertical: false,
  });
  assert.deepEqual(normalizeImageTransforms({ crop: null, rotation: 90 }), {
    crop: null, rotation: 90, flipHorizontal: false, flipVertical: false,
  });
});

test('flip settings validate as booleans and reject unknown transforms', () => {
  assert.equal(createImageTransforms({ flipHorizontal: true }).flipHorizontal, true);
  assert.equal(createImageTransforms({ flipVertical: true }).flipVertical, true);
  assert.throws(() => createImageTransforms({ flipHorizontal: 'yes' }), /Boolean/);
  assert.throws(() => createImageTransforms({ mirror: true }), /flip settings/);
});

test('flipping toggles a visible axis and rotating a quarter turn carries the flipped image', () => {
  let transforms = flipImageTransforms(createImageTransforms(), 'horizontal');
  assert.deepEqual(transforms, {
    crop: null, rotation: 0, flipHorizontal: true, flipVertical: false,
  });

  transforms = rotateImageTransforms(transforms, 'right');
  assert.deepEqual(transforms, {
    crop: null, rotation: 90, flipHorizontal: false, flipVertical: true,
  });

  transforms = rotateImageTransforms(transforms, 'left');
  assert.deepEqual(transforms, {
    crop: null, rotation: 0, flipHorizontal: true, flipVertical: false,
  });
  assert.throws(() => flipImageTransforms(transforms, 'diagonal'), /horizontal or vertical/);
  assert.throws(() => rotateImageTransforms(transforms, 'up'), /left or right/);
});
