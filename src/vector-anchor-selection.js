import { removeVectorPathPoints } from './vector-path.js';

function validAnchor(anchor) {
  return Boolean(anchor && typeof anchor.nodeId === 'string' && anchor.nodeId.length
    && Number.isInteger(anchor.contourIndex) && anchor.contourIndex >= 0
    && Number.isInteger(anchor.index) && anchor.index >= 0);
}

export function vectorAnchorKey(anchor) {
  return validAnchor(anchor) ? `${anchor.nodeId}\0${anchor.contourIndex}\0${anchor.index}` : null;
}

/** Keep unique point references for the one path being edited. */
export function normalizeVectorAnchorSelection(selection, nodeId = null) {
  if (!Array.isArray(selection)) return [];
  const result = [];
  const keys = new Set();
  for (const anchor of selection) {
    const key = vectorAnchorKey(anchor);
    if (!key || (nodeId != null && anchor.nodeId !== nodeId) || keys.has(key)) continue;
    keys.add(key);
    result.push({ nodeId: anchor.nodeId, contourIndex: anchor.contourIndex, index: anchor.index });
  }
  return result;
}

/** Toggle a path anchor without admitting duplicates or mixing path identities. */
export function toggleVectorAnchorSelection(selection, anchor) {
  if (!validAnchor(anchor)) return normalizeVectorAnchorSelection(selection);
  const current = normalizeVectorAnchorSelection(selection, anchor.nodeId);
  const key = vectorAnchorKey(anchor);
  return current.some(item => vectorAnchorKey(item) === key)
    ? current.filter(item => vectorAnchorKey(item) !== key)
    : [...current, { nodeId: anchor.nodeId, contourIndex: anchor.contourIndex, index: anchor.index }];
}

/** Apply one local-space delta to a saved set of path anchors atomically. */
export function setVectorPathAnchorTranslation(node, anchors, delta, geometry = {}, origins = null) {
  if (node?.type !== 'path' || !Array.isArray(anchors) || !anchors.length
    || !Number.isFinite(delta?.x) || !Number.isFinite(delta?.y)) return false;
  const width = Number.isFinite(geometry.width) && geometry.width > 0 ? geometry.width : node.width;
  const height = Number.isFinite(geometry.height) && geometry.height > 0 ? geometry.height : node.height;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return false;
  const unique = normalizeVectorAnchorSelection(anchors, node.id);
  if (!unique.length || unique.length !== anchors.length) return false;
  const changes = [];
  for (const anchor of unique) {
    const contour = anchor.contourIndex === 0 ? node : node.subpaths?.[anchor.contourIndex - 1];
    const point = contour?.points?.[anchor.index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    const origin = origins instanceof Map ? origins.get(vectorAnchorKey(anchor)) : null;
    if (origins instanceof Map && (!Number.isFinite(origin?.x) || !Number.isFinite(origin?.y))) return false;
    const x = (origin?.x ?? point.x) + delta.x / width;
    const y = (origin?.y ?? point.y) + delta.y / height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    changes.push({ point, x, y });
  }
  for (const change of changes) { change.point.x = change.x; change.point.y = change.y; }
  return changes.length;
}

/** Delete a selected set together, refusing before mutation if any contour gets too short. */
export function removeVectorPathAnchors(node, anchors, { dryRun = false } = {}) {
  if (node?.type !== 'path' || !Array.isArray(anchors) || !anchors.length) return false;
  const unique = normalizeVectorAnchorSelection(anchors, node.id);
  if (!unique.length || unique.length !== anchors.length) return false;
  const groups = new Map();
  for (const anchor of unique) {
    const points = anchor.contourIndex === 0 ? node.points : node.subpaths?.[anchor.contourIndex - 1]?.points;
    if (!Array.isArray(points) || !points[anchor.index]
      || !Number.isFinite(points[anchor.index].x) || !Number.isFinite(points[anchor.index].y)) return false;
    const group = groups.get(anchor.contourIndex) || { points, indexes: [] };
    if (group.points !== points) return false;
    group.indexes.push(anchor.index);
    groups.set(anchor.contourIndex, group);
  }
  for (const { points, indexes } of groups.values()) {
    if (points.length - indexes.length < 2) return false;
  }
  return removeVectorPathPoints(node, [...groups.entries()].map(([contourIndex, group]) => ({
    contourIndex, indexes: group.indexes
  })), { dryRun });
}
