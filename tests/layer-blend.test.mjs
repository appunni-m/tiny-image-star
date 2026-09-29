import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasBlendOperation, isValidLayerBlendMode, layerBlendModes } from '../src/layer-blend.js';

test('the editor exposes the complete supported layer blend-mode set', () => {
  assert.equal(layerBlendModes.length, 16);
  for (const mode of layerBlendModes) {
    assert.equal(isValidLayerBlendMode(mode), true);
    assert.equal(canvasBlendOperation(mode), mode === 'normal' ? 'source-over' : mode);
  }
  assert.equal(isValidLayerBlendMode('vivid-light'), false);
});
