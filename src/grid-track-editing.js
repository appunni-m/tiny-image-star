import { applyAutoLayout, createAutoLayout, gridTrackLayout, normalizeGridTracks } from './layout-engine.js';

const axes = Object.freeze({
  columnTracks: { count: 'columns', position: 'column', span: 'columnSpan', gap: 'columnGap' },
  rowTracks: { count: 'rows', position: 'row', span: 'rowSpan', gap: 'rowGap' }
});

function isGridFrame(frame) {
  return frame?.type === 'frame' && frame.autoLayout?.axis === 'grid';
}

function autoRowCount(frame) {
  let count = 1;
  for (const child of frame.children || []) {
    if (!child.visible || child.layoutPositioning === 'absolute') continue;
    const row = Math.max(1, Math.floor(Number(child.gridCell?.row) || 1));
    const span = Math.max(1, Math.floor(Number(child.gridCell?.rowSpan) || 1));
    count = Math.max(count, Math.min(64, row + span - 1));
  }
  return count;
}

export function gridTrackCount(frame, axis) {
  if (!isGridFrame(frame) || !axes[axis]) return 0;
  const layout = createAutoLayout(frame.autoLayout);
  return axis === 'rowTracks' && layout.rows === 'auto' ? autoRowCount(frame) : layout[axes[axis].count];
}

/** Return local canvas grabbers between adjacent grid tracks. */
export function gridTrackResizeHandles(frame) {
  const layout = gridTrackLayout(frame);
  if (!layout) return [];
  const handles = [];
  for (let index = 0; index < layout.columns.length - 1; index += 1) {
    const current = layout.columns[index];
    const adjacent = layout.columns[index + 1];
    handles.push({
      axis: 'columnTracks', trackIndex: index, adjacentIndex: index + 1,
      point: { x: (current.end + adjacent.start) / 2, y: frame.height / 2 }
    });
  }
  for (let index = 0; index < layout.rows.length - 1; index += 1) {
    const current = layout.rows[index];
    const adjacent = layout.rows[index + 1];
    handles.push({
      axis: 'rowTracks', trackIndex: index, adjacentIndex: index + 1,
      point: { x: frame.width / 2, y: (current.end + adjacent.start) / 2 }
    });
  }
  return handles;
}

/** Add a track at the end; converting auto rows to a fixed count preserves their current hug sizing. */
export function addGridTrack(frame, axis) {
  if (!isGridFrame(frame) || !axes[axis]) return false;
  const layout = createAutoLayout(frame.autoLayout);
  const count = gridTrackCount(frame, axis);
  if (count >= 64) return false;

  if (axis === 'columnTracks') {
    const tracks = normalizeGridTracks(layout.columnTracks, layout.columns, 'fill');
    tracks.splice(layout.columns, 0, { mode: 'fill', weight: 1 });
    layout.columns += 1;
    layout.columnTracks = tracks;
  } else {
    const previousRows = layout.rows === 'auto' ? count : layout.rows;
    const fallback = layout.rows === 'auto' ? 'hug' : 'fill';
    const tracks = normalizeGridTracks(layout.rowTracks, previousRows, fallback);
    tracks.splice(previousRows, 0, { mode: 'fill', weight: 1 });
    layout.rows = previousRows + 1;
    layout.rowTracks = tracks;
  }

  frame.autoLayout = layout;
  applyAutoLayout(frame);
  return true;
}

/**
 * Delete a track while preserving multi-track layers. Single-cell layers in
 * that track, including hidden layers, are returned for atomic removal.
 */
export function deleteGridTrack(frame, axis, trackIndex) {
  if (!isGridFrame(frame) || !axes[axis]) return { changed: false, removedNodeIds: [] };
  const layout = createAutoLayout(frame.autoLayout);
  const count = gridTrackCount(frame, axis);
  if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= count || count <= 1) {
    return { changed: false, removedNodeIds: [] };
  }

  // Resolve implicit and automatically placed cells before changing the track map.
  applyAutoLayout(frame);
  const { position, span } = axes[axis];
  const trackNumber = trackIndex + 1;
  const removedNodeIds = [];
  for (const child of frame.children || []) {
    if (child.layoutPositioning === 'absolute') continue;
    const cell = child.gridCell || {};
    const start = Math.max(1, Math.floor(Number(cell[position]) || 1));
    const length = Math.max(1, Math.floor(Number(cell[span]) || 1));
    const coversDeletedTrack = start <= trackNumber && trackNumber < start + length;

    if (coversDeletedTrack && length === 1) {
      removedNodeIds.push(child.id);
      continue;
    }

    let nextStart = start;
    let nextLength = length;
    if (coversDeletedTrack && length > 1) nextLength -= 1;
    else if (start > trackNumber) nextStart -= 1;
    child.gridCell = { ...cell, [position]: nextStart, [span]: nextLength };
  }

  if (axis === 'columnTracks') {
    layout.columns -= 1;
    layout.columnTracks.splice(trackIndex, 1);
  } else {
    if (layout.rows !== 'auto') layout.rows -= 1;
    if (trackIndex < layout.rowTracks.length) layout.rowTracks.splice(trackIndex, 1);
  }
  frame.autoLayout = layout;
  applyAutoLayout(frame);
  return { changed: true, removedNodeIds };
}

function gridTrackGroups(frame, axis, count) {
  const { position, span } = axes[axis];
  const parents = Array.from({ length: count }, (_, index) => index);
  const root = index => {
    let current = index;
    while (parents[current] !== current) {
      parents[current] = parents[parents[current]];
      current = parents[current];
    }
    return current;
  };
  const join = (left, right) => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  // A spanned cell cannot be split across independently reordered tracks.
  // Join every track the cell covers so the complete span moves as one block.
  for (const child of frame.children || []) {
    if (child.layoutPositioning === 'absolute') continue;
    const cell = child.gridCell || {};
    const start = Math.max(1, Math.floor(Number(cell[position]) || 1));
    const length = Math.max(1, Math.floor(Number(cell[span]) || 1));
    const end = Math.min(count, start + length - 1);
    for (let index = start; index < end; index += 1) join(index - 1, index);
  }

  const byRoot = new Map();
  for (let index = 0; index < count; index += 1) {
    const key = root(index);
    const group = byRoot.get(key) || { start: index, end: index };
    group.start = Math.min(group.start, index);
    group.end = Math.max(group.end, index);
    byRoot.set(key, group);
  }
  return [...byRoot.values()].sort((left, right) => left.start - right.start);
}

/** Return the movable span block containing a track and its current bounds. */
export function gridTrackMoveRange(frame, axis, trackIndex) {
  const count = gridTrackCount(frame, axis);
  if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= count) return null;
  return gridTrackGroups(frame, axis, count).find(group => group.start <= trackIndex && trackIndex <= group.end) || null;
}

/** Reorder a track one neighboring span block at a time. Direction is -1 or +1. */
export function moveGridTrack(frame, axis, trackIndex, direction) {
  if (!isGridFrame(frame) || !axes[axis] || !Number.isInteger(direction) || ![-1, 1].includes(direction)) {
    return { changed: false, movedTrackCount: 0 };
  }
  const layout = createAutoLayout(frame.autoLayout);
  const count = gridTrackCount(frame, axis);
  if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= count) {
    return { changed: false, movedTrackCount: 0 };
  }

  // Resolve auto placement and spans before calculating which tracks must stay together.
  applyAutoLayout(frame);
  const groups = gridTrackGroups(frame, axis, count);
  const groupIndex = groups.findIndex(group => group.start <= trackIndex && trackIndex <= group.end);
  const neighborIndex = groupIndex + direction;
  if (groupIndex < 0 || neighborIndex < 0 || neighborIndex >= groups.length) {
    return { changed: false, movedTrackCount: 0 };
  }

  const moving = groups[groupIndex];
  const reorderedGroups = groups.slice();
  const [movingGroup] = reorderedGroups.splice(groupIndex, 1);
  reorderedGroups.splice(neighborIndex, 0, movingGroup);
  const order = reorderedGroups.flatMap(group => Array.from(
    { length: group.end - group.start + 1 }, (_, offset) => group.start + offset
  ));
  const nextIndexByOldIndex = new Map(order.map((oldIndex, nextIndex) => [oldIndex, nextIndex]));
  const fallbackMode = axis === 'rowTracks' && layout.rows === 'auto' ? 'hug' : 'fill';
  const tracks = normalizeGridTracks(layout[axis], count, fallbackMode);
  layout[axis] = order.map(oldIndex => tracks[oldIndex]);

  if (!layout.autoPositioning) {
    const { position, span } = axes[axis];
    for (const child of frame.children || []) {
      if (child.layoutPositioning === 'absolute') continue;
      const cell = child.gridCell || {};
      const start = Math.max(1, Math.floor(Number(cell[position]) || 1));
      const length = Math.max(1, Math.floor(Number(cell[span]) || 1));
      const last = Math.min(count, start + length - 1);
      const mapped = [];
      for (let index = start - 1; index < last; index += 1) {
        if (nextIndexByOldIndex.has(index)) mapped.push(nextIndexByOldIndex.get(index) + 1);
      }
      if (!mapped.length) continue;
      child.gridCell = { ...cell, [position]: Math.min(...mapped), [span]: mapped.length };
    }
  }

  frame.autoLayout = layout;
  applyAutoLayout(frame);
  return {
    changed: true,
    movedTrackCount: moving.end - moving.start + 1,
    fromIndex: moving.start,
    toIndex: Math.min(...Array.from({ length: moving.end - moving.start + 1 }, (_, offset) =>
      nextIndexByOldIndex.get(moving.start + offset)))
  };
}

/** Resize a grid track to a measured pixel size, optionally preserving its adjacent fixed track. */
export function resizeGridTrack(frame, axis, trackIndex, size, { adjacentIndex = null, adjacentSize = null } = {}) {
  if (!isGridFrame(frame) || !axes[axis] || !Number.isInteger(trackIndex)
    || !Number.isFinite(size) || size < 0 || size > 100_000) return false;
  const layout = createAutoLayout(frame.autoLayout);
  const count = gridTrackCount(frame, axis);
  if (trackIndex < 0 || trackIndex >= count) return false;

  // Auto rows have no authored count. Dragging a row divider makes the
  // measured rows explicit while preserving the current content placement.
  if (axis === 'rowTracks' && layout.rows === 'auto') layout.rows = count;
  const fallbackMode = axis === 'rowTracks' && frame.autoLayout.rows === 'auto' ? 'hug' : 'fill';
  const tracks = normalizeGridTracks(layout[axis], count, fallbackMode);
  tracks[trackIndex] = { mode: 'fixed', value: Math.round(size * 100) / 100 };
  if (Number.isInteger(adjacentIndex) && adjacentIndex >= 0 && adjacentIndex < count
    && adjacentIndex !== trackIndex && Number.isFinite(adjacentSize) && adjacentSize >= 0 && adjacentSize <= 100_000
    && tracks[adjacentIndex].mode === 'fixed') {
    const roundedSize = Math.round(size * 100) / 100;
    const combinedSize = Math.round((size + adjacentSize) * 100) / 100;
    tracks[adjacentIndex] = { mode: 'fixed', value: Math.max(0, combinedSize - roundedSize) };
  }

  layout[axis] = tracks;
  frame.autoLayout = layout;
  applyAutoLayout(frame);
  return true;
}
