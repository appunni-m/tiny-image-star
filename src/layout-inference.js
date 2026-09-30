import { applyAutoLayout, createAutoLayout } from './layout-engine.js';

const POSITION_TOLERANCE = 0.5;
const MAX_INFERENCE_CHILDREN = 2048;

function finiteBox(node) {
  return [node?.x, node?.y, node?.width, node?.height].every(value => Number.isFinite(Number(value)))
    && Number(node.width) > 0 && Number(node.height) > 0;
}

function geometrySignature(frame) {
  return JSON.stringify({
    id: frame.id,
    width: frame.width,
    height: frame.height,
    autoLayout: frame.autoLayout || null,
    children: (frame.children || []).map(node => ({
      id: node.id, type: node.type, x: node.x, y: node.y, width: node.width, height: node.height,
      rotation: node.rotation || 0, visible: node.visible !== false, locked: node.locked === true,
      layoutPositioning: node.layoutPositioning || 'flow', layoutSizingMain: node.layoutSizingMain || null,
      layoutSizingCross: node.layoutSizingCross || null, layoutSizingX: node.layoutSizingX || null,
      layoutSizingY: node.layoutSizingY || null, variableBindings: node.variableBindings || null,
      gridCell: node.gridCell || null, isInstance: node.isInstance === true
    }))
  });
}

function clusterByPosition(items, property, tolerance) {
  const ordered = [...items].sort((left, right) => left[property] - right[property] || left.id.localeCompare(right.id));
  const clusters = [];
  for (const item of ordered) {
    const previous = clusters.at(-1);
    if (!previous || Math.abs(item[property] - previous.mean) > tolerance) {
      clusters.push({ mean: item[property], sum: item[property], items: [item] });
      continue;
    }
    previous.items.push(item);
    previous.sum += item[property];
    previous.mean = previous.sum / previous.items.length;
  }
  return clusters;
}

function nearlyEqual(values, tolerance) {
  return values.length < 2 || Math.max(...values) - Math.min(...values) <= tolerance;
}

function findPositionCluster(clusters, position, tolerance) {
  let low = 0;
  let high = clusters.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (clusters[middle].mean < position) low = middle + 1;
    else high = middle;
  }
  const candidates = [low - 1, low].filter(index => index >= 0 && index < clusters.length);
  candidates.sort((left, right) => Math.abs(clusters[left].mean - position) - Math.abs(clusters[right].mean - position));
  const nearest = candidates[0];
  return nearest != null && Math.abs(clusters[nearest].mean - position) <= tolerance ? nearest : -1;
}

function settingsForLinear(frame, items, axis, gaps) {
  const horizontal = axis === 'horizontal';
  const ordered = [...items].sort((left, right) => (horizontal ? left.x - right.x : left.y - right.y) || left.id.localeCompare(right.id));
  const first = ordered[0];
  const last = ordered.at(-1);
  const crossStart = horizontal ? Math.min(...items.map(item => item.y)) : Math.min(...items.map(item => item.x));
  const crossEnd = horizontal
    ? Math.max(...items.map(item => item.y + item.height))
    : Math.max(...items.map(item => item.x + item.width));
  const padding = {
    top: first.y,
    right: horizontal ? frame.width - (last.x + last.width) : frame.width - crossEnd,
    bottom: horizontal ? frame.height - crossEnd : frame.height - (last.y + last.height),
    left: horizontal ? first.x : crossStart
  };
  if (Object.values(padding).some(value => !Number.isFinite(value) || value < 0)) return null;
  const gap = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  const settings = createAutoLayout({
    axis,
    gap,
    rowGap: horizontal ? 0 : gap,
    columnGap: horizontal ? gap : 0,
    padding,
    align: 'start',
    justify: 'start',
    wrap: false,
    mainSizing: 'fixed',
    crossSizing: 'fixed'
  });
  return { settings, cells: [], axis, ordered };
}

function inferLinear(frame, items, axis, tolerance) {
  const horizontal = axis === 'horizontal';
  const cross = horizontal ? 'y' : 'x';
  const main = horizontal ? 'x' : 'y';
  const mainSize = horizontal ? 'width' : 'height';
  if (clusterByPosition(items, cross, tolerance).length !== 1) return null;
  const ordered = [...items].sort((left, right) => left[main] - right[main] || left.id.localeCompare(right.id));
  const itemIds = new Set(items.map(item => item.id));
  const flowOrder = (frame.children || []).filter(node => itemIds.has(node.id)).map(node => node.id);
  if (flowOrder.some((id, index) => id !== ordered[index]?.id)) return null;
  const gaps = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index][main] - (ordered[index - 1][main] + ordered[index - 1][mainSize]);
    if (gap < 0 || !Number.isFinite(gap)) return null;
    gaps.push(gap);
  }
  if (!nearlyEqual(gaps, tolerance)) return null;
  const inferred = settingsForLinear(frame, items, axis, gaps);
  if (!inferred) return null;
  return inferred;
}

function inferGrid(frame, items, tolerance) {
  if (items.length < 4) return null;
  const columns = clusterByPosition(items, 'x', tolerance);
  const rows = clusterByPosition(items, 'y', tolerance);
  if (columns.length < 2 || rows.length < 2 || columns.length * rows.length !== items.length) return null;

  const byCell = new Map();
  const occupied = new Set();
  for (const item of items) {
    const rowIndex = findPositionCluster(rows, item.y, tolerance);
    const columnIndex = findPositionCluster(columns, item.x, tolerance);
    if (rowIndex < 0 || columnIndex < 0) return null;
    const key = `${rowIndex}:${columnIndex}`;
    if (occupied.has(key)) return null;
    occupied.add(key);
    byCell.set(item.id, { row: rowIndex + 1, column: columnIndex + 1, rowSpan: 1, columnSpan: 1, alignX: 'start', alignY: 'start' });
  }

  const xStarts = columns.map(column => column.mean);
  const xSteps = xStarts.slice(1).map((value, index) => value - xStarts[index]);
  if (!nearlyEqual(xSteps, tolerance)) return null;
  const cellWidth = Math.max(...items.map(item => item.width));
  const columnGap = xSteps[0] - cellWidth;
  if (columnGap < 0) return null;
  const left = xStarts[0];
  const right = frame.width - (xStarts.at(-1) + cellWidth);
  if (right < 0) return null;

  const rowStarts = rows.map(row => row.mean);
  const rowGaps = rowStarts.slice(1).map((value, index) => {
    const rowHeight = Math.max(...rows[index].items.map(item => item.height));
    return value - (rowStarts[index] + rowHeight);
  });
  if (rowGaps.some(gap => gap < 0) || !nearlyEqual(rowGaps, tolerance)) return null;
  const top = rowStarts[0];
  const lastRowHeight = Math.max(...rows.at(-1).items.map(item => item.height));
  const bottom = frame.height - (rowStarts.at(-1) + lastRowHeight);
  if (bottom < 0) return null;

  const settings = createAutoLayout({
    axis: 'grid', columns: columns.length, rows: 'auto', autoPositioning: false,
    columnGap, rowGap: rowGaps.reduce((sum, value) => sum + value, 0) / rowGaps.length,
    padding: { left, right, top, bottom }
  });
  return { settings, cells: [...byCell].map(([id, cell]) => ({ id, ...cell })), axis: 'grid', ordered: items };
}

function candidateReason(node) {
  if (!finiteBox(node)) return 'missing finite, positive-size geometry';
  const rotation = Number(node.rotation ?? 0);
  if (!Number.isFinite(rotation)) return 'invalid rotation';
  if (Math.abs(rotation) > POSITION_TOLERANCE) return 'rotated geometry';
  if (node.locked) return 'locked layer';
  if (node.isInstance) return 'component instance content';
  if (node.layoutSizingMain === 'fill' || node.layoutSizingCross === 'fill' || node.layoutSizingX === 'fill' || node.layoutSizingY === 'fill') return 'fill-sized geometry';
  if (node.variableBindings?.visible) return 'variable-bound visibility';
  if (['x', 'y', 'width', 'height', 'rotation'].some(property => node.variableBindings?.[property])) return 'variable-bound geometry';
  return null;
}

function failed(reason) { return { supported: false, reason }; }

export function suggestAutoLayout(frame, { tolerance = POSITION_TOLERANCE } = {}) {
  if (frame?.type !== 'frame') return failed('Select a frame to suggest its layout.');
  if (frame.autoLayout) return failed('This frame already has auto layout.');
  if (frame.locked) return failed('Unlock the frame before suggesting auto layout.');
  tolerance = Number.isFinite(Number(tolerance)) && Number(tolerance) >= 0 ? Math.min(8, Number(tolerance)) : POSITION_TOLERANCE;
  if (!Number.isFinite(Number(frame.width)) || !Number.isFinite(Number(frame.height)) || frame.width <= 0 || frame.height <= 0) return failed('The frame needs finite, positive dimensions.');
  const visible = (frame.children || []).filter(node => (node.visible !== false || node.variableBindings?.visible) && node.layoutPositioning !== 'absolute');
  if (visible.length < 2) return failed('Add at least two visible, flow-positioned layers.');
  if (visible.length > MAX_INFERENCE_CHILDREN) return failed(`Auto layout suggestions are limited to ${MAX_INFERENCE_CHILDREN} visible children for predictable analysis time.`);

  const supported = [];
  const absoluteIds = [];
  for (const node of visible) {
    const reason = candidateReason(node);
    if (reason) absoluteIds.push({ id: node.id, reason });
    else supported.push(node);
  }
  if (supported.length < 2) return failed('Fewer than two layers have geometry that can be inferred safely.');

  const inferred = inferLinear(frame, supported, 'horizontal', tolerance)
    || inferLinear(frame, supported, 'vertical', tolerance)
    || inferGrid(frame, supported, tolerance);
  if (!inferred) return failed('Visible layers do not form a clear horizontal row, vertical column, or complete regular grid.');

  const signature = geometrySignature(frame);
  return {
    supported: true,
    signature,
    pattern: inferred.axis,
    settings: inferred.settings,
    flowIds: inferred.ordered.map(item => item.id),
    absoluteIds,
    cells: inferred.cells,
    tolerance
  };
}

export function applyAutoLayoutSuggestion(frame, suggestion) {
  const fresh = suggestAutoLayout(frame, { tolerance: suggestion?.tolerance ?? POSITION_TOLERANCE });
  if (!fresh.supported || fresh.signature !== suggestion?.signature) throw new Error('The frame geometry changed; review a fresh auto layout suggestion before applying it.');

  const draft = structuredClone(frame);
  draft.autoLayout = structuredClone(fresh.settings);
  const absoluteIds = new Set(fresh.absoluteIds.map(item => item.id));
  const flowIds = new Set(fresh.flowIds);
  const cellsById = new Map(fresh.cells.map(cell => [cell.id, cell]));
  for (const item of draft.children || []) {
    if (absoluteIds.has(item.id)) item.layoutPositioning = 'absolute';
    const cell = cellsById.get(item.id);
    if (cell) item.gridCell = { ...cell };
  }
  applyAutoLayout(draft);

  const originals = new Map((frame.children || []).map(item => [item.id, item]));
  const draftById = new Map((draft.children || []).map(item => [item.id, item]));
  for (const result of draft.children || []) {
    const original = originals.get(result.id);
    if (!original) continue;
    if (Math.abs(result.width - original.width) > fresh.tolerance || Math.abs(result.height - original.height) > fresh.tolerance) {
      throw new Error('This suggestion would resize a child layer, so it was not applied.');
    }
    if (flowIds.has(result.id)
      && (Math.abs(result.x - original.x) > fresh.tolerance || Math.abs(result.y - original.y) > fresh.tolerance)) {
      throw new Error('This suggestion would move a layer too far from its current position, so it was not applied.');
    }
  }

  const movedIds = fresh.flowIds.filter(id => {
    const before = originals.get(id);
    const after = draftById.get(id);
    return Math.abs(before.x - after.x) > 0.01 || Math.abs(before.y - after.y) > 0.01;
  });

  frame.autoLayout = draft.autoLayout;
  for (const result of draft.children || []) {
    const original = originals.get(result.id);
    if (!original) continue;
    if (result.layoutPositioning === 'absolute' && absoluteIds.has(result.id)) original.layoutPositioning = 'absolute';
    if (cellsById.has(result.id)) original.gridCell = result.gridCell;
    original.x = result.x; original.y = result.y;
  }
  return { frame, movedIds, absoluteIds: fresh.absoluteIds.map(item => item.id) };
}
