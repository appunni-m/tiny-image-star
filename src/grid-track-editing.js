import { applyAutoLayout, createAutoLayout, normalizeGridTracks } from './layout-engine.js';

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
