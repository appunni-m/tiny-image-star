// A detail tile is bounded independently of the original image. Its pixels
// map directly to the upright source; there is no thumbnail coordinate space.
export function maskDetailRegion(width, height, center, viewport, zoom) {
  const w = Math.min(width, 1024, Math.max(1, Math.floor(viewport.width / zoom)));
  const h = Math.min(height, 1024, Math.max(1, Math.floor(viewport.height / zoom)));
  return { x: Math.max(0, Math.min(width - w, Math.round(center[0] * width - w / 2))),
    y: Math.max(0, Math.min(height - h, Math.round(center[1] * height - h / 2))), width: w, height: h };
}

export function maskSourcePoint(region, width, height, x, y) {
  return [(region.x + Math.max(0, Math.min(1, x)) * region.width) / width,
    (region.y + Math.max(0, Math.min(1, y)) * region.height) / height];
}

export function maskViewPoint(region, width, height, point) {
  return [(point[0] * width - region.x) / region.width, (point[1] * height - region.y) / region.height];
}
