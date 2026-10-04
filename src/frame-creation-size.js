export const DEFAULT_CLICK_FRAME_SIZE = Object.freeze({ width: 100, height: 100 });

/** Match Figma's Frame-tool click behavior: nested frames start at 100×100,
 * while a top-level click repeats the most recently created top-level size. */
export function frameSizeForCanvasClick(lastTopLevelSize = null, { nested = false } = {}) {
  if (nested) return { ...DEFAULT_CLICK_FRAME_SIZE };
  if (Number.isFinite(lastTopLevelSize?.width) && lastTopLevelSize.width > 0
    && Number.isFinite(lastTopLevelSize?.height) && lastTopLevelSize.height > 0) {
    return { width: lastTopLevelSize.width, height: lastTopLevelSize.height };
  }
  return { ...DEFAULT_CLICK_FRAME_SIZE };
}
