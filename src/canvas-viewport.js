/** Keep the same document-space point at the viewport center after a resize. */
export function preserveCanvasWorldCenterOnResize({ panX, panY, zoom, previousSize, nextSize }) {
  const values = [panX, panY, zoom, previousSize?.width, previousSize?.height, nextSize?.width, nextSize?.height];
  if (!values.every(Number.isFinite) || zoom <= 0 || previousSize.width <= 0 || previousSize.height <= 0
    || nextSize.width <= 0 || nextSize.height <= 0) return { panX, panY };
  const centerX = (previousSize.width / 2 - panX) / zoom;
  const centerY = (previousSize.height / 2 - panY) / zoom;
  return {
    panX: nextSize.width / 2 - centerX * zoom,
    panY: nextSize.height / 2 - centerY * zoom
  };
}
