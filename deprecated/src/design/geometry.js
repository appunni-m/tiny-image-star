function finite(value) { return Number.isFinite(value); }

export function selectionBounds(nodes, size) {
  if (!Array.isArray(nodes) || !nodes.length || !finite(size?.width) || !finite(size?.height) || size.width < 1 || size.height < 1) return null;
  const frames = nodes.map((node) => node?.frame).filter((frame) => frame && [frame.x, frame.y, frame.width, frame.height].every(finite));
  if (!frames.length) return null;
  const left = Math.min(...frames.map((frame) => frame.x * size.width));
  const top = Math.min(...frames.map((frame) => frame.y * size.height));
  const right = Math.max(...frames.map((frame) => (frame.x + frame.width) * size.width));
  const bottom = Math.max(...frames.map((frame) => (frame.y + frame.height) * size.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function resizeSelection(nodes, bounds, nextBounds, size) {
  if (!Array.isArray(nodes) || !nodes.length || !bounds || !nextBounds || !size
    || ![bounds.x, bounds.y, bounds.width, bounds.height, nextBounds.x, nextBounds.y, nextBounds.width, nextBounds.height,
      size.width, size.height].every(finite)
    || bounds.width <= 0 || bounds.height <= 0 || nextBounds.width <= 0 || nextBounds.height <= 0 || size.width < 1 || size.height < 1) {
    throw new Error("Choose a valid selection size.");
  }
  const scaleX = nextBounds.width / bounds.width, scaleY = nextBounds.height / bounds.height;
  return nodes.map((node) => {
    const frame = node.frame;
    if (!frame || ![frame.x, frame.y, frame.width, frame.height].every(finite)) throw new Error("A selected layer has no editable frame.");
    const x = frame.x * size.width, y = frame.y * size.height, width = frame.width * size.width, height = frame.height * size.height;
    return { ...node, frame: {
      x: (nextBounds.x + (x - bounds.x) * scaleX) / size.width,
      y: (nextBounds.y + (y - bounds.y) * scaleY) / size.height,
      width: width * scaleX / size.width,
      height: height * scaleY / size.height,
    } };
  });
}

export function rotateSelection(nodes, center, deltaDegrees, size) {
  if (!Array.isArray(nodes) || !nodes.length || !center || !size
    || ![center.x, center.y, deltaDegrees, size.width, size.height].every(finite)
    || size.width < 1 || size.height < 1) throw new Error("Choose a valid rotation.");
  const radians = deltaDegrees * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  const normalize = (degrees) => {
    const value = (degrees + deltaDegrees + 180) % 360;
    const wrapped = ((value + 360) % 360) - 180;
    return Object.is(wrapped, -0) ? 0 : wrapped;
  };
  return nodes.map((node) => {
    const frame = node.frame;
    if (!frame || ![frame.x, frame.y, frame.width, frame.height].every(finite)) throw new Error("A selected layer has no editable frame.");
    const x = frame.x * size.width, y = frame.y * size.height, width = frame.width * size.width, height = frame.height * size.height;
    const dx = x + width / 2 - center.x, dy = y + height / 2 - center.y;
    const rotatedX = center.x + dx * cosine - dy * sine, rotatedY = center.y + dx * sine + dy * cosine;
    return { ...node, frame: { ...frame, x: (rotatedX - width / 2) / size.width, y: (rotatedY - height / 2) / size.height },
      rotation: normalize(node.rotation ?? 0) };
  });
}

export function zoomAtPoint({ zoom, nextZoom, panX, panY, point, geometry }) {
  if (![zoom, nextZoom, panX, panY, point?.x, point?.y, geometry?.x, geometry?.y, geometry?.scale,
    geometry?.width, geometry?.height, geometry?.viewportWidth, geometry?.viewportHeight].every(finite)
    || zoom <= 0 || nextZoom <= 0 || geometry.scale <= 0) {
    throw new Error("Choose a valid zoom level.");
  }
  const nextScale = geometry.scale / zoom * nextZoom;
  const baseX = (geometry.viewportWidth - geometry.width * nextScale) / 2;
  const baseY = (geometry.viewportHeight - geometry.height * nextScale) / 2;
  const worldX = (point.x - geometry.x) / geometry.scale, worldY = (point.y - geometry.y) / geometry.scale;
  return { zoom: nextZoom,
    panX: point.x - baseX - worldX * nextScale,
    panY: point.y - baseY - worldY * nextScale };
}
