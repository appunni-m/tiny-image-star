export const PROTOTYPE_OVERLAY_POSITIONS = Object.freeze([
  'center', 'top-left', 'top-center', 'top-right', 'left-center', 'right-center',
  'bottom-left', 'bottom-center', 'bottom-right', 'manual'
]);

const overlayPositionSet = new Set(PROTOTYPE_OVERLAY_POSITIONS);
const maxRelativeOffset = 1_000_000_000;

export function isValidPrototypeOverlayPosition(value) {
  return overlayPositionSet.has(value);
}

/** Figma's MANUAL overlay offset is relative to the layer that opened it. */
export function isValidPrototypeOverlayRelativePosition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes('x') && keys.includes('y')
    && Number.isFinite(value.x) && Number.isFinite(value.y)
    && Math.abs(value.x) <= maxRelativeOffset && Math.abs(value.y) <= maxRelativeOffset;
}

export function normalizePrototypeOverlayRelativePosition(value) {
  if (value == null) return { x: 0, y: 0 };
  if (!isValidPrototypeOverlayRelativePosition(value)) throw new TypeError('Manual overlay position needs finite X and Y offsets.');
  return { x: value.x, y: value.y };
}

/** Place a preset overlay or resolve a trigger-relative manual overlay. */
export function prototypeOverlayPositionInFrame(position, frame, overlay, anchorPoint = null, relativePosition = null) {
  const centered = { x: (frame.width - overlay.width) / 2, y: (frame.height - overlay.height) / 2 };
  if (position === 'center') return centered;
  if (position === 'manual') {
    if (!Number.isFinite(anchorPoint?.x) || !Number.isFinite(anchorPoint?.y)) return centered;
    return {
      x: anchorPoint.x + (Number.isFinite(relativePosition?.x) ? relativePosition.x : 0),
      y: anchorPoint.y + (Number.isFinite(relativePosition?.y) ? relativePosition.y : 0)
    };
  }
  const xSide = position.endsWith('left') ? 'left' : position.endsWith('right') ? 'right' : 'center';
  const ySide = position.startsWith('top') ? 'top' : position.startsWith('bottom') ? 'bottom' : 'center';
  const gap = 16;
  const edgePosition = (side, frameSize, overlaySize) => {
    const available = frameSize - overlaySize;
    const requested = side === 'start' ? gap : available - gap;
    return Math.max(0, Math.min(Math.max(0, available), requested));
  };
  return {
    x: xSide === 'left' ? edgePosition('start', frame.width, overlay.width)
      : xSide === 'right' ? edgePosition('end', frame.width, overlay.width) : centered.x,
    y: ySide === 'top' ? edgePosition('start', frame.height, overlay.height)
      : ySide === 'bottom' ? edgePosition('end', frame.height, overlay.height) : centered.y
  };
}
