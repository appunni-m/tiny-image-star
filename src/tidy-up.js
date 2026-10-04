const ALIGNMENT_OVERLAP_RATIO = 0.35;
const GAP_PRECISION = 100;
const EPSILON = 1e-7;

function visualBounds(node) {
  const width = Number(node.width);
  const height = Number(node.height);
  const x = Number(node.x);
  const y = Number(node.y);
  const rotation = Number(node.rotation) || 0;
  if (![x, y, width, height, rotation].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const angle = rotation * Math.PI / 180;
  const halfWidth = (Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle))) / 2;
  const halfHeight = (Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle))) / 2;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return {
    left: centerX - halfWidth,
    right: centerX + halfWidth,
    top: centerY - halfHeight,
    bottom: centerY + halfHeight,
  };
}

function extentOverlapRatio(aStart, aEnd, bStart, bEnd) {
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  const smaller = Math.min(aEnd - aStart, bEnd - bStart);
  return smaller > EPSILON ? overlap / smaller : 0;
}

function inSameBand(items, axis) {
  const horizontal = axis === 'horizontal';
  const ordered = [...items].sort((a, b) => horizontal
    ? a.bounds.left - b.bounds.left || a.index - b.index
    : a.bounds.top - b.bounds.top || a.index - b.index);
  return ordered.slice(1).every((item, index) => {
    const previous = ordered[index];
    return horizontal
      ? extentOverlapRatio(previous.bounds.top, previous.bounds.bottom, item.bounds.top, item.bounds.bottom) >= ALIGNMENT_OVERLAP_RATIO
      : extentOverlapRatio(previous.bounds.left, previous.bounds.right, item.bounds.left, item.bounds.right) >= ALIGNMENT_OVERLAP_RATIO;
  });
}

function gapMode(values) {
  if (!values.length) return 0;
  const counts = new Map();
  for (const value of values) {
    const bucket = Math.round(value * GAP_PRECISION) / GAP_PRECISION;
    const key = String(bucket);
    const record = counts.get(key) || { value: bucket, count: 0, firstIndex: counts.size };
    record.count += 1;
    counts.set(key, record);
  }
  const sortedValues = [...values].sort((a, b) => a - b);
  const median = sortedValues[Math.floor((sortedValues.length - 1) / 2)];
  return [...counts.values()].sort((a, b) => b.count - a.count
    || Math.abs(a.value - median) - Math.abs(b.value - median)
    || a.firstIndex - b.firstIndex)[0].value;
}

function horizontalPlan(items) {
  const ordered = [...items].sort((a, b) => a.bounds.left - b.bounds.left || a.index - b.index);
  const gaps = ordered.slice(1).map((item, index) => item.bounds.left - ordered[index].bounds.right);
  const gapX = gapMode(gaps);
  let cursor = ordered[0].bounds.left;
  const patches = ordered.map(item => {
    const patch = { id: item.node.id, dx: cursor - item.bounds.left, dy: 0 };
    cursor += item.bounds.right - item.bounds.left + gapX;
    return patch;
  });
  return { layout: 'row', gapX, gapY: null, patches };
}

function verticalPlan(items) {
  const ordered = [...items].sort((a, b) => a.bounds.top - b.bounds.top || a.index - b.index);
  const gaps = ordered.slice(1).map((item, index) => item.bounds.top - ordered[index].bounds.bottom);
  const gapY = gapMode(gaps);
  let cursor = ordered[0].bounds.top;
  const patches = ordered.map(item => {
    const patch = { id: item.node.id, dx: 0, dy: cursor - item.bounds.top };
    cursor += item.bounds.bottom - item.bounds.top + gapY;
    return patch;
  });
  return { layout: 'column', gapX: null, gapY, patches };
}

function rowsForGrid(items) {
  const ordered = [...items].sort((a, b) => {
    const center = (a.bounds.top + a.bounds.bottom) / 2 - (b.bounds.top + b.bounds.bottom) / 2;
    return center || a.bounds.left - b.bounds.left || a.index - b.index;
  });
  const rows = [];
  for (const item of ordered) {
    let best = null;
    let bestRatio = ALIGNMENT_OVERLAP_RATIO;
    for (const row of rows) {
      const ratio = extentOverlapRatio(row.top, row.bottom, item.bounds.top, item.bounds.bottom);
      if (ratio >= bestRatio) {
        const rowCenter = (row.top + row.bottom) / 2;
        const itemCenter = (item.bounds.top + item.bounds.bottom) / 2;
        if (!best || ratio > bestRatio || Math.abs(itemCenter - rowCenter) < best.distance) {
          best = { row, distance: Math.abs(itemCenter - rowCenter) };
          bestRatio = ratio;
        }
      }
    }
    if (!best) {
      rows.push({ top: item.bounds.top, bottom: item.bounds.bottom, items: [item] });
    } else {
      best.row.items.push(item);
      best.row.top = Math.min(best.row.top, item.bounds.top);
      best.row.bottom = Math.max(best.row.bottom, item.bounds.bottom);
    }
  }
  return rows.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
}

function gridPlan(items) {
  const rows = rowsForGrid(items);
  if (rows.length < 2 || rows.some(row => row.items.length < 2)) return null;
  const columnCount = rows[0].items.length;
  if (rows.some(row => row.items.length !== columnCount || !inSameBand(row.items, 'horizontal'))) return null;
  for (const row of rows) row.items.sort((a, b) => a.bounds.left - b.bounds.left || a.index - b.index);

  const columnWidths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(...rows.map(row => row.items[column].bounds.right - row.items[column].bounds.left)));
  const rowHeights = rows.map(row => Math.max(...row.items.map(item => item.bounds.bottom - item.bounds.top)));
  const horizontalGaps = rows.flatMap(row => row.items.slice(1).map((item, index) =>
    item.bounds.left - row.items[index].bounds.right));
  const verticalGaps = rows.slice(1).map((row, index) => row.top - (rows[index].top + rowHeights[index]));
  const gapX = gapMode(horizontalGaps);
  const gapY = gapMode(verticalGaps);
  const firstLeft = Math.min(...items.map(item => item.bounds.left));
  const firstTop = Math.min(...items.map(item => item.bounds.top));
  const columnLefts = [];
  let x = firstLeft;
  for (const width of columnWidths) {
    columnLefts.push(x);
    x += width + gapX;
  }
  const rowTops = [];
  let y = firstTop;
  for (const height of rowHeights) {
    rowTops.push(y);
    y += height + gapY;
  }
  const patches = rows.flatMap((row, rowIndex) => row.items.map((item, columnIndex) => ({
    id: item.node.id,
    dx: columnLefts[columnIndex] - item.bounds.left,
    dy: rowTops[rowIndex] - item.bounds.top,
  })));
  return { layout: 'grid', gapX, gapY, patches };
}

/**
 * Plan Figma-style Tidy up for a clear row, column, or rectangular grid.
 * The plan retains dimensions/rotation and uses the most common authored gap.
 * Ambiguous or ragged layouts return null rather than guessing.
 */
export function planTidyUp(nodes) {
  if (!Array.isArray(nodes) || nodes.length < 3 || new Set(nodes.map(node => node?.id)).size !== nodes.length) return null;
  const items = nodes.map((node, index) => ({ node, index, bounds: visualBounds(node) }));
  if (items.some(item => !item.node || typeof item.node.id !== 'string' || !item.node.id || !item.bounds)) return null;
  const horizontal = inSameBand(items, 'horizontal');
  const vertical = inSameBand(items, 'vertical');
  if (horizontal && !vertical) return horizontalPlan(items);
  if (vertical && !horizontal) return verticalPlan(items);
  if (horizontal || vertical) return null;
  return gridPlan(items);
}
