const clamp = (value, min = 0) => Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min);
const boundedGap = (value, minimum = 0) => Math.min(100_000, clamp(value, minimum));
const trackCount = (value, fallback) => {
  const count = Math.floor(Number(value));
  return Number.isFinite(count) && count >= 1 ? Math.min(64, count) : fallback;
};

const gridTrackModes = new Set(['fixed', 'hug', 'fill']);
const boundedTrackValue = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100_000, number)) : fallback;
};

function normalizedGridTrack(track, fallbackMode = 'fill') {
  const source = track && typeof track === 'object' && !Array.isArray(track) ? track : {};
  const mode = gridTrackModes.has(source.mode) ? source.mode : fallbackMode;
  const weight = Number.isFinite(Number(source.weight)) ? Math.max(0.01, Math.min(100_000, Number(source.weight))) : 1;
  const normalized = mode === 'fixed'
    ? { mode, value: boundedTrackValue(source.value, 120) }
    : mode === 'fill'
      ? { mode, weight }
      : { mode: 'hug' };
  if (source.minContent === true) normalized.minContent = true;
  else if (source.minSize != null) normalized.minSize = boundedTrackValue(source.minSize);
  if (mode === 'fill' && Number.isFinite(Number(source.minWeight)) && Number(source.minWeight) > 0) {
    normalized.minWeight = Math.min(weight, Math.max(0.01, Number(source.minWeight)));
  }
  return normalized;
}

/*
 * Imported grid tracks can have an intrinsic-content or fixed lower bound in
 * addition to their fixed, hug, or fill sizing function. Keep that floor in
 * the normalized model so layout, editing, and serialization use one value.
 */
function gridTrackMinimum(track, intrinsicSize) {
  if (track.minContent) return intrinsicSize;
  if (Number.isFinite(track.minSize)) return track.minSize;
  return 0;
}

function allocateGridFillTracks(tracks, indices, sizes, minimums, available) {
  const pending = new Set(indices);
  let remaining = Math.max(0, available);
  while (pending.size) {
    const totalWeight = [...pending].reduce((sum, index) => sum + (tracks[index].weight || 1), 0);
    const capped = [...pending].filter(index => {
      const share = totalWeight > 0 ? remaining * (tracks[index].weight || 1) / totalWeight : 0;
      return share < minimums[index];
    });
    if (!capped.length) {
      for (const index of pending) {
        sizes[index] = totalWeight > 0 ? remaining * (tracks[index].weight || 1) / totalWeight : 0;
      }
      break;
    }
    for (const index of capped) {
      sizes[index] = minimums[index];
      remaining = Math.max(0, remaining - minimums[index]);
      pending.delete(index);
    }
  }
}

export function normalizeGridTracks(value, count, fallbackMode = 'fill') {
  const requested = Array.isArray(value) ? value.slice(0, 64) : [];
  const size = Math.max(trackCount(count, 1), requested.length);
  return Array.from({ length: Math.min(64, size) }, (_, index) => normalizedGridTrack(requested[index], fallbackMode));
}

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
  const axis = overrides.axis ?? 'vertical';
  const normalizeGap = axis === 'grid' ? value => boundedGap(value) : value => boundedGap(value, -100_000);
  const gap = normalizeGap(overrides.gap ?? 8);
  const padding = typeof overrides.padding === 'object'
    ? { top: 16, right: 16, bottom: 16, left: 16, ...overrides.padding }
    : { top: overrides.padding ?? 16, right: overrides.padding ?? 16, bottom: overrides.padding ?? 16, left: overrides.padding ?? 16 };
  const settings = {
    axis: 'vertical',
    align: 'start', justify: 'start', wrap: false, wrapDistribution: 'start', mainSizing: 'fixed', crossSizing: 'fixed',
    ...overrides,
    gap,
    rowGap: normalizeGap(overrides.rowGap ?? gap),
    columnGap: normalizeGap(overrides.columnGap ?? gap),
    columns: trackCount(overrides.columns, 2),
    rows: overrides.rows === 'auto' || overrides.rows == null ? 'auto' : trackCount(overrides.rows, 'auto'),
    autoPositioning: overrides.autoPositioning !== false,
    padding: Object.fromEntries(Object.entries(padding).map(([side, value]) => [side, clamp(value)]))
  };
  if (!['start', 'center', 'end', 'space-between'].includes(settings.wrapDistribution)) settings.wrapDistribution = 'start';
  if (settings.axis === 'grid') {
    settings.columnTracks = normalizeGridTracks(overrides.columnTracks, settings.columns, 'fill');
    settings.rowTracks = normalizeGridTracks(overrides.rowTracks, settings.rows === 'auto' ? 1 : settings.rows, settings.rows === 'auto' ? 'hug' : 'fill');
  }
  return settings;
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
  const footprint = linearFootprint(sizes, mainGap);
  const spare = Math.max(0, mainAvailable - footprint.extent);
  let gap = mainGap;
  let start = -footprint.min;
  if (settings.justify === 'center') start += spare / 2;
  else if (settings.justify === 'end') start += spare;
  else if (settings.justify === 'space-between' && items.length > 1) gap += spare / (items.length - 1);
  else if (settings.justify === 'space-around' && items.length) {
    const extraGap = spare / items.length;
    gap += extraGap;
    start += extraGap / 2;
  } else if (settings.justify === 'space-evenly' && items.length) {
    const extraGap = spare / (items.length + 1);
    gap += extraGap;
    start += extraGap;
  }
  return { start, gap };
}

function linearFootprint(sizes, gap) {
  let cursor = 0;
  let min = 0;
  let max = 0;
  for (const size of sizes) {
    min = Math.min(min, cursor);
    max = Math.max(max, cursor + size);
    cursor += size + gap;
  }
  return { min, max, extent: Math.max(0, max - min) };
}

function childAlign(node, settings) {
  return ['start', 'center', 'end', 'stretch'].includes(node.layoutAlignSelf)
    ? node.layoutAlignSelf : settings.align;
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

function preferredTrackSize(item, axis) {
  const size = Number(item[axis === 'Width' ? 'width' : 'height']);
  const min = Number(item[`min${axis}`]);
  return Math.max(Number.isFinite(size) ? size : 0, Number.isFinite(min) ? min : 0, 0);
}

function gridTrackSizes(definitions, count, available, gap, flowItems, placements, axis, fallbackMode = 'fill') {
  const tracks = Array.from({ length: count }, (_, index) => definitions[index] || (fallbackMode === 'fill' ? { mode: 'fill', weight: 1 } : { mode: fallbackMode }));
  const intrinsicSizes = Array(count).fill(0);

  // Hug tracks first take the largest non-spanning child in each track.
  for (const item of flowItems) {
    const cell = placements.get(item.id);
    const span = axis === 'Width' ? cell.columnSpan : cell.rowSpan;
    if (span !== 1) continue;
    const trackIndex = (axis === 'Width' ? cell.column : cell.row) - 1;
    const track = tracks[trackIndex];
    if (track?.mode !== 'hug' && !track?.minContent) continue;
    intrinsicSizes[trackIndex] = Math.max(intrinsicSizes[trackIndex], preferredTrackSize(item, axis));
  }

  // A spanning child can enlarge the hug tracks it crosses; fixed tracks stay fixed.
  for (const item of flowItems) {
    const cell = placements.get(item.id);
    const span = axis === 'Width' ? cell.columnSpan : cell.rowSpan;
    if (span < 2) continue;
    const start = (axis === 'Width' ? cell.column : cell.row) - 1;
    const end = Math.min(count, start + span);
    const indices = [];
    for (let index = start; index < end; index += 1) {
      if (tracks[index]?.mode === 'hug' || tracks[index]?.minContent) indices.push(index);
    }
    if (!indices.length) continue;
    const current = intrinsicSizes.slice(start, end).reduce((sum, size) => sum + size, 0) + gap * Math.max(0, end - start - 1);
    const extra = Math.max(0, preferredTrackSize(item, axis) - current) / indices.length;
    for (const index of indices) intrinsicSizes[index] += extra;
  }

  const sizes = tracks.map((track, index) => track.mode === 'fixed' ? track.value
    : track.mode === 'hug' ? intrinsicSizes[index] : 0);
  const nonFillExtent = sizes.reduce((sum, size, index) => sum + (tracks[index].mode === 'fill' ? 0 : size), 0);
  const fillAvailable = Math.max(0, available - gap * Math.max(0, count - 1) - nonFillExtent);
  const totalFillWeight = tracks.reduce((sum, track) => sum + (track.mode === 'fill' ? track.weight || 1 : 0), 0);
  // Fractional lower bounds use the same base fr unit as the maximum fill
  // tracks. Absolute/content floors may still force the grid to overflow.
  const fillUnit = totalFillWeight > 0 ? fillAvailable / totalFillWeight : 0;
  const minimums = tracks.map((track, index) => Math.max(
    gridTrackMinimum(track, intrinsicSizes[index]),
    track.mode === 'fill' && Number.isFinite(track.minWeight) ? track.minWeight * fillUnit : 0
  ));
  for (let index = 0; index < tracks.length; index += 1) {
    if (tracks[index].mode !== 'fill') sizes[index] = Math.max(sizes[index], minimums[index]);
  }
  const fillIndices = tracks.map((track, index) => track.mode === 'fill' ? index : -1).filter(index => index >= 0);
  allocateGridFillTracks(tracks, fillIndices, sizes, minimums, fillAvailable);
  return sizes;
}

function trackOffsets(sizes, gap, start) {
  const offsets = Array(sizes.length + 1).fill(start);
  for (let index = 0; index < sizes.length; index += 1) offsets[index + 1] = offsets[index] + sizes[index] + gap;
  return offsets;
}

function spannedTrackSize(sizes, start, span, gap) {
  const first = start - 1;
  const end = Math.min(sizes.length, first + span);
  return sizes.slice(first, end).reduce((sum, size) => sum + size, 0) + gap * Math.max(0, end - first - 1);
}

function gridLayoutPlan(frame, settings) {
  const padding = settings.padding;
  const columns = trackCount(settings.columns, 2);
  const columnGap = clamp(settings.columnGap);
  const rowGap = clamp(settings.rowGap);
  const requestedRows = settings.rows === 'auto' ? null : trackCount(settings.rows, null);
  const innerWidth = Math.max(0, frame.width - padding.left - padding.right);
  const innerHeight = Math.max(0, frame.height - padding.top - padding.bottom);
  const flowItems = (frame.children || []).filter(node => node.visible && node.layoutPositioning !== 'absolute');

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
  const columnWidths = gridTrackSizes(settings.columnTracks || [], columns, innerWidth, columnGap, flowItems, placements, 'Width');
  const rowHeights = gridTrackSizes(settings.rowTracks || [], rowCount, innerHeight, rowGap, flowItems, placements, 'Height', requestedRows ? 'fill' : 'hug');
  const columnOffsets = trackOffsets(columnWidths, columnGap, padding.left);
  const rowOffsets = trackOffsets(rowHeights, rowGap, padding.top);

  return { flowItems, placements, columnWidths, rowHeights, columnOffsets, rowOffsets, columnGap, rowGap, rowCount };
}

/** Measure grid tracks using the same placement and sizing rules as layout. */
export function gridTrackLayout(frame) {
  if (!frame || frame.type !== 'frame' || frame.autoLayout?.axis !== 'grid') return null;
  const settings = createAutoLayout(frame.autoLayout);
  const plan = gridLayoutPlan(frame, settings);
  return {
    columns: plan.columnWidths.map((size, index) => ({
      index, start: plan.columnOffsets[index], end: plan.columnOffsets[index] + size, size
    })),
    rows: plan.rowHeights.map((size, index) => ({
      index, start: plan.rowOffsets[index], end: plan.rowOffsets[index] + size, size
    })),
    columnGap: plan.columnGap,
    rowGap: plan.rowGap,
    rowCount: plan.rowCount
  };
}

function applyGridAutoLayout(frame, settings) {
  const { flowItems, placements, columnWidths, rowHeights, columnOffsets, rowOffsets, columnGap, rowGap } = gridLayoutPlan(frame, settings);
  if (!flowItems.length) return;

  for (const item of flowItems) {
    const cell = placements.get(item.id);
    const cellX = columnOffsets[cell.column - 1];
    const cellY = rowOffsets[cell.row - 1];
    const spanWidth = spannedTrackSize(columnWidths, cell.column, cell.columnSpan, columnGap);
    const spanHeight = spannedTrackSize(rowHeights, cell.row, cell.rowSpan, rowGap);
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

export function applyAutoLayout(frame, resolvedSettings = null) {
  if (!frame || frame.type !== 'frame' || !frame.autoLayout) return frame;
  constrainNodeSize(frame);
  const settings = createAutoLayout(resolvedSettings || frame.autoLayout);
  const persistNormalizedSettings = !resolvedSettings;
  const flowItems = (frame.children || []).filter(node => node.visible && node.layoutPositioning !== 'absolute');
  for (const item of frame.children || []) constrainNodeSize(item);
  if (settings.axis !== 'grid' && !flowItems.length) {
    const horizontal = settings.axis === 'horizontal';
    const padding = settings.padding;
    if (settings.mainSizing === 'hug') {
      const axis = horizontal ? 'Width' : 'Height';
      frame[axis.toLowerCase()] = constrainSize(frame, axis, horizontal
        ? padding.left + padding.right : padding.top + padding.bottom);
    }
    if (settings.crossSizing === 'hug') {
      const axis = horizontal ? 'Height' : 'Width';
      frame[axis.toLowerCase()] = constrainSize(frame, axis, horizontal
        ? padding.top + padding.bottom : padding.left + padding.right);
    }
    if (persistNormalizedSettings) frame.autoLayout = settings;
    return frame;
  }
  if (settings.axis === 'grid') {
    applyGridAutoLayout(frame, settings);
    if (persistNormalizedSettings) frame.autoLayout = settings;
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
  const naturalCrossSizes = groups.map(group => group.reduce((max, item) => Math.max(max, horizontal ? item.height : item.width), 0));
  const naturalCrossExtent = linearFootprint(naturalCrossSizes, crossGap).extent;
  const stretchGroups = settings.crossSizing !== 'hug'
    ? groups.filter(group => settings.align === 'stretch' || group.some(item => childAlign(item, settings) === 'stretch')).length
    : 0;
  const stretchPerGroup = stretchGroups
    ? Math.max(0, crossAvailable - naturalCrossExtent) / stretchGroups : 0;
  const groupCrossSizes = groups.map((group, index) => {
    // A non-wrapped stack has one line spanning the frame's available
    // cross-axis space. Without this, center/end alignment only sees the
    // children group's intrinsic size and has no space to distribute.
    if (!settings.wrap && settings.crossSizing !== 'hug') return crossAvailable;
    const canStretchGroup = settings.crossSizing !== 'hug'
      && (settings.align === 'stretch' || group.some(item => childAlign(item, settings) === 'stretch'));
    return naturalCrossSizes[index] + (canStretchGroup ? stretchPerGroup : 0);
  });
  const crossFootprint = linearFootprint(groupCrossSizes, crossGap);
  const crossSpare = settings.wrap && settings.crossSizing !== 'hug'
    ? Math.max(0, crossAvailable - crossFootprint.extent) : 0;
  let crossGapDistributed = crossGap;
  let crossStartOffset = 0;
  if (settings.wrap && settings.crossSizing !== 'hug') {
    if (settings.wrapDistribution === 'center') crossStartOffset = crossSpare / 2;
    else if (settings.wrapDistribution === 'end') crossStartOffset = crossSpare;
    else if (settings.wrapDistribution === 'space-between' && groups.length > 1) crossGapDistributed += crossSpare / (groups.length - 1);
  }
  const crossStarts = [];
  let crossPosition = (horizontal ? padding.top : padding.left) - crossFootprint.min + crossStartOffset;
  for (const size of groupCrossSizes) {
    crossStarts.push(crossPosition);
    crossPosition += size + crossGapDistributed;
  }
  let computedMain = 0;

  for (const [groupIndex, group] of groups.entries()) {
    const groupCross = groupCrossSizes[groupIndex];
    const crossCursor = crossStarts[groupIndex];
    const fillItems = settings.mainSizing === 'fixed' ? group.filter(item => item.layoutSizingMain === 'fill') : [];
    if (fillItems.length) {
      const usedByFixedItems = group.filter(item => item.layoutSizingMain !== 'fill').reduce((sum, item) => sum + (horizontal ? item.width : item.height), 0);
      const remaining = Math.max(0, mainAvailable - usedByFixedItems - gaps.main * Math.max(0, group.length - 1));
      const allocations = distributeFill(fillItems, remaining, horizontal ? 'Width' : 'Height');
      for (const item of fillItems) { if (horizontal) item.width = allocations.get(item.id); else item.height = allocations.get(item.id); }
    }
    const content = distribute(group, mainAvailable, settings.mainSizing === 'hug' ? { ...settings, justify: 'start' } : settings, gaps.main);
    let mainCursor = (horizontal ? padding.left : padding.top) + (settings.mainSizing === 'hug' ? 0 : content.start);
    computedMain = Math.max(computedMain, linearFootprint(group.map(item => horizontal ? item.width : item.height), content.gap).extent);
    for (const item of group) {
      const mainSize = horizontal ? item.width : item.height;
      const crossSize = horizontal ? item.height : item.width;
      const align = childAlign(item, settings);
      const canStretch = align === 'stretch' && item.layoutSizingCross !== 'fixed';
      const nextCrossSize = canStretch ? constrainSize(item, horizontal ? 'Height' : 'Width', groupCross) : crossSize;
      const alignOffset = align === 'center' ? (groupCross - crossSize) / 2 : align === 'end' ? groupCross - crossSize : 0;
      if (horizontal) {
        item.x = mainCursor;
        item.y = crossCursor + alignOffset;
        if (canStretch) item.height = nextCrossSize;
      } else {
        item.x = crossCursor + alignOffset;
        item.y = mainCursor;
        if (canStretch) item.width = nextCrossSize;
      }
      mainCursor += mainSize + content.gap;
    }
  }

  if (flowItems.length) {
    if (settings.mainSizing === 'hug') {
      if (horizontal) frame.width = constrainSize(frame, 'Width', computedMain + padding.left + padding.right);
      else frame.height = constrainSize(frame, 'Height', computedMain + padding.top + padding.bottom);
    }
    if (settings.crossSizing === 'hug') {
      const crossExtent = linearFootprint(groups.map(group => group.reduce((max, item) => Math.max(max, horizontal ? item.height : item.width), 0)), crossGap).extent;
      if (horizontal) frame.height = constrainSize(frame, 'Height', crossExtent + padding.top + padding.bottom);
      else frame.width = constrainSize(frame, 'Width', crossExtent + padding.left + padding.right);
    }
  }
  if (persistNormalizedSettings) frame.autoLayout = settings;
  return frame;
}
