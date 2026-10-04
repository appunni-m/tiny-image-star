import { applyFrameConstraints, captureChildGeometry } from './constraints.js';

const MIN_FRAME_DIMENSION = 0.01;
const MAX_FRAME_DIMENSION = 100_000;

/** Resize an existing frame to a preset while retaining its child constraints. */
export function resizeFrameToPreset(frame, preset, {
  geometryOf = node => ({ width: node.width, height: node.height }),
  setDimensions = (node, width, height) => {
    node.width = width;
    node.height = height;
    return true;
  },
  applyAutoLayout = () => {},
  parentOf = () => null,
} = {}) {
  if (!frame || frame.type !== 'frame') throw new TypeError('A frame is required to apply a frame preset.');
  for (const property of ['width', 'height']) {
    const value = Number(preset?.[property]);
    if (!Number.isFinite(value) || value < MIN_FRAME_DIMENSION || value > MAX_FRAME_DIMENSION) {
      throw new TypeError(`The frame preset ${property} is outside the supported range.`);
    }
  }
  if (typeof geometryOf !== 'function' || typeof setDimensions !== 'function'
    || typeof applyAutoLayout !== 'function' || typeof parentOf !== 'function') {
    throw new TypeError('Frame preset resize callbacks must be functions.');
  }

  const before = geometryOf(frame);
  if (!before || !Number.isFinite(before.width) || !Number.isFinite(before.height)
    || before.width < MIN_FRAME_DIMENSION || before.height < MIN_FRAME_DIMENSION) {
    throw new TypeError('The selected frame has invalid dimensions.');
  }
  if (Object.is(before.width, preset.width) && Object.is(before.height, preset.height)) {
    return { changed: false, before, after: before, childrenBefore: null, parent: parentOf(frame), parentChildrenBefore: null };
  }

  const childrenBefore = captureChildGeometry(frame);
  const parent = parentOf(frame);
  const parentChildrenBefore = parent?.autoLayout ? captureChildGeometry(parent) : null;
  if (setDimensions(frame, preset.width, preset.height) === false) {
    throw new Error('The frame dimensions could not be updated.');
  }
  const resized = geometryOf(frame);
  if (!resized || !Number.isFinite(resized.width) || !Number.isFinite(resized.height)
    || resized.width < MIN_FRAME_DIMENSION || resized.height < MIN_FRAME_DIMENSION) {
    throw new Error('The selected frame dimensions could not be resolved after applying the preset.');
  }

  if (frame.autoLayout) applyAutoLayout(frame);
  else applyFrameConstraints(frame, before.width, before.height, resized.width, resized.height, childrenBefore);
  if (parent?.autoLayout) applyAutoLayout(parent);

  return {
    changed: true,
    before,
    after: geometryOf(frame),
    childrenBefore,
    parent,
    parentChildrenBefore,
  };
}
