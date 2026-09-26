export const WORKING_COPY_EDGE = 2048;
export const WORKING_COPY_METHOD = "pillow-rs-lanczos-png@1";

// Coordinates remain normalized to the chosen upright image. The original is
// a separate retained asset, never overwritten by the reduced PNG.
export function workingCopySize(width, height, edge = WORKING_COPY_EDGE) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
