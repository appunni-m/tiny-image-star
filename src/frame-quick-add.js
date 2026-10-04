/** Gap between quick-added frames, matching the editor's existing 32 px frame spacing. */
export const FRAME_QUICK_ADD_GAP = 32;
/** A page can contain at most this many frame layers under the model's node limit. */
export const MAX_FRAME_QUICK_ADD_SIBLINGS = 100_000;

const modes = new Set(['duplicate', 'blank']);
const directions = new Set(['top', 'right', 'bottom', 'left']);

function dimensionsOf(frame, label) {
  if (!frame || frame.type !== 'frame'
    || ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)
    || frame.width <= 0 || frame.height <= 0
    || (frame.rotation != null && !Number.isFinite(frame.rotation))) {
    throw new TypeError(`${label} must be a frame with finite position, size, and rotation.`);
  }
  const rotation = frame.rotation ?? 0;
  const radians = rotation * Math.PI / 180;
  const width = Math.abs(frame.width * Math.cos(radians)) + Math.abs(frame.height * Math.sin(radians));
  const height = Math.abs(frame.width * Math.sin(radians)) + Math.abs(frame.height * Math.cos(radians));
  const left = frame.x + (frame.width - width) / 2;
  const top = frame.y + (frame.height - height) / 2;
  const bounds = { left, top, right: left + width, bottom: top + height, width, height };
  if (!Object.values(bounds).every(Number.isFinite)) throw new RangeError(`${label} has unrepresentable canvas bounds.`);
  return { rotation, ...bounds };
}

/**
 * Plan a same-size frame beside a source frame without overlapping any
 * same-container sibling frames. The search is bounded by the document's
 * maximum frame count and advances past each intersecting sibling at most once.
 *
 * `mode: 'duplicate'` tells the caller to clone the source frame's contents;
 * `mode: 'blank'` requests the same geometry with an empty layer tree. This
 * function only computes placement and never mutates the source or siblings.
 */
export function planFrameQuickAdd(sourceFrame, siblingFrames = [], {
  mode = 'duplicate',
  direction = 'right',
  gap = FRAME_QUICK_ADD_GAP
} = {}) {
  if (!modes.has(mode)) throw new TypeError('Frame quick-add mode must be “duplicate” or “blank”.');
  if (!directions.has(direction)) throw new TypeError('Frame quick-add direction must be top, right, bottom, or left.');
  if (!Array.isArray(siblingFrames) || siblingFrames.length > MAX_FRAME_QUICK_ADD_SIBLINGS) {
    throw new RangeError(`Frame quick-add accepts at most ${MAX_FRAME_QUICK_ADD_SIBLINGS.toLocaleString()} siblings.`);
  }
  if (!Number.isFinite(gap) || gap < 0) throw new TypeError('Frame quick-add gap must be a finite non-negative number.');

  const source = dimensionsOf(sourceFrame, 'The source');
  const horizontal = direction === 'right' || direction === 'left';
  const positive = direction === 'right' || direction === 'bottom';
  const sourcePrimaryStart = horizontal ? source.left : source.top;
  const sourcePrimaryEnd = horizontal ? source.right : source.bottom;
  const sourcePrimarySize = horizontal ? source.width : source.height;
  const sourceCrossStart = horizontal ? source.top : source.left;
  const sourceCrossSize = horizontal ? source.height : source.width;
  const frames = siblingFrames
    .filter(frame => frame?.type === 'frame' && frame !== sourceFrame)
    .map(frame => dimensionsOf(frame, 'A sibling'))
    .sort((left, right) => {
      const leading = horizontal ? 'left' : 'top';
      const trailing = horizontal ? 'right' : 'bottom';
      return positive
        ? left[leading] - right[leading] || left[trailing] - right[trailing]
        : right[trailing] - left[trailing] || right[leading] - left[leading];
    });

  let primaryStart = positive
    ? sourcePrimaryEnd + gap
    : sourcePrimaryStart - gap - sourcePrimarySize;
  let primaryEnd = primaryStart + sourcePrimarySize;
  const crossStart = sourceCrossStart;
  const crossEnd = crossStart + sourceCrossSize;
  for (const sibling of frames) {
    const siblingPrimaryStart = horizontal ? sibling.left : sibling.top;
    const siblingPrimaryEnd = horizontal ? sibling.right : sibling.bottom;
    const siblingCrossStart = horizontal ? sibling.top : sibling.left;
    const siblingCrossEnd = horizontal ? sibling.bottom : sibling.right;
    if (siblingCrossEnd <= crossStart || siblingCrossStart >= crossEnd) continue;

    if (positive) {
      if (siblingPrimaryEnd <= primaryStart) continue;
      if (siblingPrimaryStart >= primaryEnd) break;
      primaryStart = siblingPrimaryEnd + gap;
      primaryEnd = primaryStart + sourcePrimarySize;
    } else {
      if (siblingPrimaryStart >= primaryEnd) continue;
      if (siblingPrimaryEnd <= primaryStart) break;
      primaryEnd = siblingPrimaryStart - gap;
      primaryStart = primaryEnd - sourcePrimarySize;
    }
  }

  const visualLeft = horizontal ? primaryStart : crossStart;
  const visualTop = horizontal ? crossStart : primaryStart;
  const x = visualLeft - (sourceFrame.width - source.width) / 2;
  const y = visualTop - (sourceFrame.height - source.height) / 2;
  if (![x, y, primaryStart, primaryEnd].every(Number.isFinite)) throw new RangeError('No valid position is available for this quick-added frame.');

  return {
    mode,
    direction,
    x,
    y,
    width: sourceFrame.width,
    height: sourceFrame.height,
    rotation: source.rotation,
    copyContents: mode === 'duplicate'
  };
}
