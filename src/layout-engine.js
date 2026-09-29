const clamp = (value, min = 0) => Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min);
const trackCount = (value, fallback) => {
  const count = Math.floor(Number(value));
  return Number.isFinite(count) && count >= 1 ? Math.min(64, count) : fallback;
};

function constrainSize(node, axis, value) {
  const min = Number.isFinite(node[`min${axis}`]) ? Math.max(0, node[`min${axis}`]) : 0;
  const max = Number.isFinite(node[`max${axis}`]) ? Math.max(min, node[`max${axis}`]) : Infinity;
  const size = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  return Math.max(min, Math.min(max, size));
}

function constrainNodeSize(node) {
  node.width = constrainSize(node, 'Width', node.width);
  node.height = constrainSize(node, 'Height', node.height);
}

function distributeFill(items, available, axis) {
  const allocations = new Map();
  const pending = new Set(items);
  let remaining = Math.max(0, available);

  while (pending.size) {
    const share = Math.max(0, remaining / pending.size);
    const capped = [];
    for (const item of pending) {
      const min = Number.isFinite(item[`min${axis}`]) ? Math.max(0, item[`min${axis}`]) : 0;
      const max = Number.isFinite(item[`max${axis}`]) ? Math.max(min, item[`max${axis}`]) : Infinity;
      if (share < min) capped.push([item, min]);
      else if (share > max) capped.push([item, max]);
    }
    if (!capped.length) {
      for (const item of pending) allocations.set(item.id, constrainSize(item, axis, share));
      break;
    }
    for (const [item, size] of capped) {
      allocations.set(item.id, size);
      pending.delete(item);
      remaining -= size;
    }
  }
  return allocations;
}

export function createAutoLayout(overrides = {}) {
  const gap = clamp(overrides.gap ?? 8);
  const padding = typeof overrides.padding === 'object'
    ? { top: 16, right: 16, bottom: 16, left: 16, ...overrides.padding }
    : { top: overrides.padding ?? 16, right: overrides.padding ?? 16, bottom: overrides.padding ?? 16, left: overrides.padding ?? 16 };
  return {
    axis: 'vertical', gap, padding: { top: 16, right: 16, bottom: 16, left: 16 },
    rowGap: gap, columnGap: gap, columns: 2, rows: 'auto', autoPositioning: true,
    align: 'start', justify: 'start', wrap: false, mainSizing: 'fixed', crossSizing: 'fixed',
    ...overrides,
    gap,
    rowGap: clamp(overrides.rowGap ?? gap),
    columnGap: clamp(overrides.columnGap ?? gap),
    columns: trackCount(overrides.columns, 2),
    rows: overrides.rows === 'auto' || overrides.rows == null ? 'auto' : trackCount(overrides.rows, 'auto'),
    autoPositioning: overrides.autoPositioning !== false,
    padding: Object.fromEntries(Object.entries(padding).map(([side, value]) => [side, clamp(value)]))
  };
}

function flowGaps(settings) {
  return settings.axis === 'horizontal'
    ? { main: settings.columnGap, cross: settings.rowGap }
    : { main: settings.rowGap, cross: settings.columnGap };
}

function groupedItems(frame, settings, flowItems, mainGap) {
  const horizontal = settings.axis === 'horizontal';
  const padding = settings.padding;
  const availableMain = horizontal
    ? Math.max(0, frame.width - padding.left - padding.right)
    : Math.max(0, frame.height - padding.top - padding.bottom);
  if (!settings.wrap || settings.mainSizing === 'hug') return [flowItems];
  const groups = []; let group = []; let used = 0;
  for (const item of flowItems) {
    const size = horizontal ? item.width : item.height;
    const extra = group.length ? mainGap : 0;
    if (group.length && used + extra + size > availableMain) { groups.push(group); group = []; used = 0; }
    if (group.length) used += mainGap;
    group.push(item); used += size;
  }
  if (group.length) groups.push(group);
  return groups;
}

function distribute(items, mainAvailable, settings, mainGap) {
  const horizontal = settings.axis === 'horizontal';
  const sizes = items.map(item => horizontal ? item.width : item.height);
  const occupied = sizes.reduce((sum, value) => sum + value, 0);
  const spare = Math.max(0, mainAvailable - occupied);
  let gap = mainGap;
  let start = 0;
  if (settings.justify === 'center') start = spare / 2;
  else if (settings.justify === 'end') start = spare;
  else if (settings.justify === 'space-between' && items.length > 1) gap = Math.max(0, spare / (items.length - 1));
  return { start, gap };
}

function normalizedCell(node) {
  const cell = node.gridCell || {};
  return {
    row: trackCount(cell.row, null),
    column: trackCount(cell.column, null),
    rowSpan: trackCount(cell.rowSpan, 1),
    columnSpan: trackCount(cell.columnSpan, 1),
    alignX: ['start', 'center', 'end'].includes(cell.alignX) ? cell.alignX : 'start',
    alignY: ['start', 'center', 'end'].includes(cell.alignY) ? cell.alignY : 'start'
  };
}

function applyGridAutoLayout(frame, settings) {
  const padding = settings.padding;
  const columns = trackCount(settings.columns, 2);
  const columnGap = clamp(settings.columnGap);
  const rowGap = clamp(settings.rowGap);
  const requestedRows = settings.rows === 'auto' ? null : trackCount(settings.rows, null);
  const innerWidth = Math.max(0, frame.width - padding.left - padding.right);
  const innerHeight = Math.max(0, frame.height - padding.top - padding.bottom);
  const cellWidth = Math.max(0, (innerWidth - (columns - 1) * columnGap) / columns);
  const flowItems = (frame.children || []).filter(node => node.visible && node.layoutPositioning !== 'absolute');
  if (!flowItems.length) return;

  const occupied = new Set();
  const placements = new Map();
  const reserve = (row, column, rowSpan, columnSpan) => {
    for (let y = row; y < row + rowSpan; y += 1) for (let x = column; x < column + columnSpan; x += 1) occupied.add(`${y}:${x}`);
  };
  const fits = (row, column, rowSpan, columnSpan) => {
    if (column < 1 || column + columnSpan - 1 > columns) return false;
    for (let y = row; y < row + rowSpan; y += 1) for (let x = column; x < column + columnSpan; x += 1) if (occupied.has(`${y}:${x}`)) return false;
    return true;
  };
  const findOpenCell = (start, rowSpan, columnSpan) => {
    for (let cursor = start; cursor < 1_000_000; cursor += 1) {
      const row = Math.floor(cursor / columns) + 1;
      const column = cursor % columns + 1;
      if (column + columnSpan - 1 > columns) continue;
      if (fits(row, column, rowSpan, columnSpan)) return { row, column, cursor: cursor + columnSpan };
    }
    throw new RangeError('The grid does not have an available cell for this layer.');
  };

  let cursor = 0;
  if (settings.autoPositioning) {
    for (const item of flowItems) {
      const cell = normalizedCell(item);
      const columnSpan = Math.min(columns, cell.columnSpan);
      const placement = findOpenCell(cursor, cell.rowSpan, columnSpan);
      const nextCell = { ...cell, ...placement, rowSpan: cell.rowSpan, columnSpan };
      delete nextCell.cursor;
      placements.set(item.id, nextCell);
      reserve(nextCell.row, nextCell.column, nextCell.rowSpan, nextCell.columnSpan);
      cursor = placement.cursor;
    }
  } else {
    const unplaced = [];
    for (const item of flowItems) {
      const cell = normalizedCell(item);
      const rowSpan = cell.rowSpan;
      const columnSpan = Math.min(columns, cell.columnSpan);
      if (cell.row && cell.column && cell.column + columnSpan - 1 <= columns) {
        const placement = { ...cell, rowSpan, columnSpan };
        placements.set(item.id, placement);
        reserve(placement.row, placement.column, rowSpan, columnSpan);
      } else unplaced.push({ item, cell, rowSpan, columnSpan });
    }
    for (const { item, cell, rowSpan, columnSpan } of unplaced) {
      const placement = findOpenCell(cursor, rowSpan, columnSpan);
      const nextCell = { ...cell, ...placement, rowSpan, columnSpan };
      delete nextCell.cursor;
      placements.set(item.id, nextCell);
      reserve(nextCell.row, nextCell.column, nextCell.rowSpan, nextCell.columnSpan);
      cursor = placement.cursor;
    }
  }

  let rowCount = requestedRows || 1;
  for (const cell of placements.values()) rowCount = Math.max(rowCount, cell.row + cell.rowSpan - 1);
  const rowHeights = Array(rowCount).fill(requestedRows
    ? Math.max(0, (innerHeight - rowGap * (rowCount - 1)) / rowCount)
    : 0);
  if (!requestedRows) {
    for (const item of flowItems) {
      const cell = placements.get(item.id);
      if (cell.rowSpan === 1) rowHeights[cell.row - 1] = Math.max(rowHeights[cell.row - 1], item.height);
    }
    for (const item of flowItems) {
      const cell = placements.get(item.id);
      if (cell.rowSpan < 2) continue;
      const current = rowHeights.slice(cell.row - 1, cell.row - 1 + cell.rowSpan).reduce((sum, height) => sum + height, 0) + rowGap * (cell.rowSpan - 1);
      const extra = Math.max(0, item.height - current) / cell.rowSpan;
      for (let row = cell.row - 1; row < cell.row - 1 + cell.rowSpan; row += 1) rowHeights[row] += extra;
    }
  }
  const rowOffsets = Array(rowCount + 1).fill(0);
  for (let row = 1; row <= rowCount; row += 1) rowOffsets[row] = rowOffsets[row - 1] + rowHeights[row - 1] + rowGap;
  const rowTop = row => padding.top + rowOffsets[row - 1];
  const rowSize = (row, span) => rowOffsets[row - 1 + span] - rowOffsets[row - 1] - rowGap;

  for (const item of flowItems) {
    const cell = placements.get(item.id);
    const cellX = padding.left + (cell.column - 1) * (cellWidth + columnGap);
    const cellY = rowTop(cell.row);
    const spanWidth = cellWidth * cell.columnSpan + columnGap * (cell.columnSpan - 1);
    const spanHeight = rowSize(cell.row, cell.rowSpan);
    const width = constrainSize(item, 'Width', item.layoutSizingX === 'fill' ? spanWidth : item.width);
    const height = constrainSize(item, 'Height', item.layoutSizingY === 'fill' ? spanHeight : item.height);
    const alignOffset = (available, size, align) => align === 'center' ? (available - size) / 2 : align === 'end' ? available - size : 0;
    item.x = cellX + alignOffset(spanWidth, width, cell.alignX);
    item.y = cellY + alignOffset(spanHeight, height, cell.alignY);
    if (item.layoutSizingX === 'fill') item.width = width;
    if (item.layoutSizingY === 'fill') item.height = height;
    item.gridCell = { ...cell };
    delete item.gridCell.cursor;
  }
}

export function applyAutoLayout(frame) {
  if (!frame || frame.type !== 'frame' || !frame.autoLayout) return frame;
  constrainNodeSize(frame);
  const settings = createAutoLayout(frame.autoLayout);
  const flowItems = (frame.children || []).filter(node => node.visible && node.layoutPositioning !== 'absolute');
  for (const item of frame.children || []) constrainNodeSize(item);
  if (settings.axis === 'grid') {
    applyGridAutoLayout(frame, settings);
    frame.autoLayout = settings;
    return frame;
  }
  const horizontal = settings.axis === 'horizontal';
  const padding = settings.padding;
  const gaps = flowGaps(settings);
  const groups = groupedItems(frame, settings, flowItems, gaps.main);
  const crossGap = clamp(gaps.cross);
  const mainAvailable = horizontal
    ? Math.max(0, frame.width - padding.left - padding.right)
    : Math.max(0, frame.height - padding.top - padding.bottom);
  const crossAvailable = horizontal
    ? Math.max(0, frame.height - padding.top - padding.bottom)
    : Math.max(0, frame.width - padding.left - padding.right);
  let crossCursor = horizontal ? padding.top : padding.left;
  let computedMain = 0;

  for (const group of groups) {
    const lineCross = group.reduce((max, item) => Math.max(max, horizontal ? item.height : item.width), 0);
    const fillItems = settings.mainSizing === 'fixed' ? group.filter(item => item.layoutSizingMain === 'fill') : [];
    if (fillItems.length) {
      const usedByFixedItems = group.filter(item => item.layoutSizingMain !== 'fill').reduce((sum, item) => sum + (horizontal ? item.width : item.height), 0);
      const remaining = Math.max(0, mainAvailable - usedByFixedItems - gaps.main * Math.max(0, group.length - 1));
      const allocations = distributeFill(fillItems, remaining, horizontal ? 'Width' : 'Height');
      for (const item of fillItems) { if (horizontal) item.width = allocations.get(item.id); else item.height = allocations.get(item.id); }
    }
    const content = distribute(group, mainAvailable, settings.mainSizing === 'hug' ? { ...settings, justify: 'start' } : settings, gaps.main);
    let mainCursor = (horizontal ? padding.left : padding.top) + (settings.mainSizing === 'hug' ? 0 : content.start);
    computedMain = Math.max(computedMain, group.reduce((sum, item) => sum + (horizontal ? item.width : item.height), 0) + Math.max(0, group.length - 1) * content.gap);
    for (const item of group) {
      const mainSize = horizontal ? item.width : item.height;
      const crossSize = horizontal ? item.height : item.width;
      const canStretch = settings.align === 'stretch' && item.layoutSizingCross !== 'fixed';
      const nextCrossSize = canStretch ? constrainSize(item, horizontal ? 'Height' : 'Width', crossAvailable) : crossSize;
      const alignOffset = settings.align === 'center' ? (lineCross - crossSize) / 2 : settings.align === 'end' ? lineCross - crossSize : 0;
      if (horizontal) {
        item.x = mainCursor;
        item.y = crossCursor + Math.max(0, alignOffset);
        if (canStretch) item.height = nextCrossSize;
      } else {
        item.x = crossCursor + Math.max(0, alignOffset);
        item.y = mainCursor;
        if (canStretch) item.width = nextCrossSize;
      }
      mainCursor += mainSize + content.gap;
    }
    crossCursor += lineCross + crossGap;
  }

  if (flowItems.length) {
    if (settings.mainSizing === 'hug') {
      if (horizontal) frame.width = constrainSize(frame, 'Width', computedMain + padding.left + padding.right);
      else frame.height = constrainSize(frame, 'Height', computedMain + padding.top + padding.bottom);
    }
    if (settings.crossSizing === 'hug') {
      const crossExtent = groups.reduce((sum, group) => sum + group.reduce((max, item) => Math.max(max, horizontal ? item.height : item.width), 0), 0) + Math.max(0, groups.length - 1) * crossGap;
      if (horizontal) frame.height = constrainSize(frame, 'Height', crossExtent + padding.top + padding.bottom);
      else frame.width = constrainSize(frame, 'Width', crossExtent + padding.left + padding.right);
    }
  }
  frame.autoLayout = settings;
  return frame;
}
