function countFor(guide) { return Math.max(1, Math.min(64, Math.floor(Number(guide.count) || 1))); }

function axisRegions(length, guide) {
  if (!(length > 0)) return [];
  const count = countFor(guide);
  if (guide.alignment === 'stretch') {
    const margin = Math.max(0, Math.min(length / 2, Number(guide.margin) || 0));
    const gutter = Math.max(0, Number(guide.gutter) || 0);
    const regionSize = Math.max(0, (length - margin * 2 - gutter * (count - 1)) / count);
    if (!(regionSize > 0)) return [];
    return Array.from({ length: count }, (_, index) => margin + index * (regionSize + gutter)).map(start => ({ start, size: regionSize }));
  }

  const regionSize = Math.max(0, Number(guide.bandSize) || 0);
  if (!(regionSize > 0)) return [];
  const offset = Math.max(0, Number(guide.offset) || 0);
  let first;
  if (guide.alignment === 'center') first = (length - regionSize * count) / 2;
  else if (guide.alignment === 'right' || guide.alignment === 'bottom') first = length - offset - regionSize * count;
  else first = offset;
  return Array.from({ length: count }, (_, index) => ({ start: first + index * regionSize, size: regionSize }));
}

export function layoutGuideRegions(guide, width, height) {
  if (!guide || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  if (guide.type === 'columns') return axisRegions(width, guide).map(({ start, size }) => ({ x: start, y: 0, width: size, height }));
  if (guide.type === 'rows') return axisRegions(height, guide).map(({ start, size }) => ({ x: 0, y: start, width, height: size }));
  return [];
}

export function layoutGuideGridLines(guide, width, height, maxLinesPerAxis = 1000) {
  if (guide?.type !== 'grid' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { verticals: [], horizontals: [] };
  const size = Number(guide.size);
  if (!(size > 0) || !Number.isFinite(size)) return { verticals: [], horizontals: [] };
  const spacing = length => size * Math.max(1, Math.ceil(Math.ceil(length / size) / maxLinesPerAxis));
  const positions = (length, step) => {
    const result = [];
    for (let position = step; position < length; position += step) result.push(position);
    return result;
  };
  return {
    verticals: positions(width, spacing(width)),
    horizontals: positions(height, spacing(height))
  };
}
