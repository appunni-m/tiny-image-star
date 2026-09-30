import {
  nodeLocalToPage,
  pageToParentLocal,
  resizeOrientedRect
} from './transform-geometry.js';

const HANDLE_NAMES = new Set(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
const CORNERS = Object.freeze([
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 }
]);

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('A group transform needs at least one selected entry.');
  }
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !entry.node || typeof entry.node.id !== 'string' || !entry.node.id) {
      throw new TypeError('Each selected entry needs a node with a stable ID.');
    }
    if (ids.has(entry.node.id)) throw new TypeError(`Selected node ID is duplicated: ${entry.node.id}.`);
    ids.add(entry.node.id);
    if (entry.ancestors != null && !Array.isArray(entry.ancestors)) {
      throw new TypeError(`Ancestors for ${entry.node.id} must be an array ordered from outermost to innermost.`);
    }
    // Exercise the shared affine validation for the node and all ancestors.
    nodeLocalToPage(entry.node, { x: 0, y: 0 }, entry.ancestors || []);
  }
  return entries;
}

/** Explain why direct group movement cannot safely change these layer positions. */
export function selectionMoveBlockReason(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return 'empty';
  if (entries.some(({ node, ancestors = [] }) => node?.locked || ancestors.some(parent => parent.locked))) return 'locked';
  if (entries.length > 1 && entries.some(({ node, ancestors = [] }) =>
    ancestors.at(-1)?.autoLayout && node?.layoutPositioning !== 'absolute')) return 'auto-layout';
  if (entries.length > 1 && entries.some(({ node }) => node?.variableBindings?.x || node?.variableBindings?.y)) return 'shared-position-variable';
  return null;
}

function pointAt(bounds, x, y) {
  return { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y };
}

function centerOf(node) {
  return { x: node.width / 2, y: node.height / 2 };
}

function validateBounds(bounds) {
  if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))
    || bounds.width < 0 || bounds.height < 0) {
    throw new TypeError('Selection bounds need finite x, y, width, and height values with non-negative dimensions.');
  }
}

function validatePagePoint(point, label) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${label} needs finite page-space x and y coordinates.`);
  }
}

function parentLocalCenter(node, ancestors, pageCenter) {
  const local = pageToParentLocal(pageCenter, ancestors);
  return { x: local.x - node.width / 2, y: local.y - node.height / 2 };
}

function selectedAncestorPatches(ancestors, patches) {
  return ancestors.map(ancestor => {
    const patch = ancestor.id && patches.get(ancestor.id);
    return patch ? { ...ancestor, ...patch } : ancestor;
  });
}

function localSizeScales(node, ancestors, scaleX, scaleY) {
  const pageRotation = [...ancestors, node].reduce((total, item) => total + Number(item.rotation || 0), 0);
  const radians = pageRotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  // The page-space group scale can shear a rotated node. Keep its rotation and
  // use the lengths of its transformed local axes as width/height scale factors.
  return {
    width: Math.hypot(scaleX * cosine, scaleY * sine),
    height: Math.hypot(scaleX * sine, scaleY * cosine)
  };
}

function buildResizePatches(entries, bounds, handle, scaleX, scaleY, correction, minSize) {
  const affectsX = handle.includes('e') || handle.includes('w');
  const affectsY = handle.includes('n') || handle.includes('s');
  const anchor = {
    x: affectsX ? (handle.includes('w') ? bounds.x + bounds.width : bounds.x) : null,
    y: affectsY ? (handle.includes('n') ? bounds.y + bounds.height : bounds.y) : null
  };
  const patches = new Map();
  const ordered = [...entries].sort((left, right) => (left.ancestors?.length || 0) - (right.ancestors?.length || 0));
  for (const { node, ancestors = [] } of ordered) {
    const currentCenter = nodeLocalToPage(node, centerOf(node), ancestors);
    const targetCenter = {
      x: (affectsX ? anchor.x + (currentCenter.x - anchor.x) * scaleX : currentCenter.x) + correction.x,
      y: (affectsY ? anchor.y + (currentCenter.y - anchor.y) * scaleY : currentCenter.y) + correction.y
    };
    const sizeScale = localSizeScales(node, ancestors, scaleX, scaleY);
    const width = Math.abs(sizeScale.width - 1) <= 1e-12
      ? node.width : Math.max(minSize, node.width * sizeScale.width);
    const height = Math.abs(sizeScale.height - 1) <= 1e-12
      ? node.height : Math.max(minSize, node.height * sizeScale.height);
    const updatedAncestors = selectedAncestorPatches(ancestors, patches);
    const local = pageToParentLocal(targetCenter, updatedAncestors);
    patches.set(node.id, { id: node.id, x: local.x - width / 2, y: local.y - height / 2, width, height });
  }
  return patches;
}

/**
 * Return the page-space axis-aligned bounds of selected layer snapshots.
 * Entries are `{node, ancestors}`; ancestors are outermost-first and all
 * geometry must be resolved before calling this function.
 */
export function selectionBounds(entries) {
  validateEntries(entries);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const { node, ancestors = [] } of entries) {
    for (const corner of CORNERS) {
      const page = nodeLocalToPage(node, { x: node.width * corner.x, y: node.height * corner.y }, ancestors);
      left = Math.min(left, page.x);
      top = Math.min(top, page.y);
      right = Math.max(right, page.x);
      bottom = Math.max(bottom, page.y);
    }
  }
  const width = right - left;
  const height = bottom - top;
  return { x: left, y: top, width, height, center: { x: left + width / 2, y: top + height / 2 } };
}

/** Return the bounds aspect ratio only when both selection axes have extent. */
export function selectionAspectRatio(bounds) {
  return bounds.width > 0 && bounds.height > 0 ? bounds.width / bounds.height : undefined;
}

/**
 * Resize a selection around the opposite handle of its page-space AABB.
 * Layer centers follow the AABB scale in page space, while each layer's local
 * width/height are scaled independently and its own rotation is preserved.
 * This deliberately preserves rotation instead of introducing the shear that
 * an exact non-uniform page-space affine transform would require for rotated
 * layers. Resolved ancestor snapshots are adjusted top-down so nested selected
 * layers remain positioned at their intended page-space centers.
 */
export function resizeSelection(entries, bounds, handle, pointerPage, { aspectRatio, minSize = 1 } = {}) {
  validateEntries(entries);
  validateBounds(bounds);
  validatePagePoint(pointerPage, 'Resize pointer');
  if (!HANDLE_NAMES.has(handle)) throw new TypeError(`Unknown resize handle: ${handle}`);
  if (!Number.isFinite(minSize) || minSize <= 0) throw new TypeError('Minimum resize size must be a positive finite number.');
  if (aspectRatio !== undefined && (!Number.isFinite(aspectRatio) || aspectRatio <= 0)) {
    throw new TypeError('Aspect ratio must be a positive finite number.');
  }

  const affectsX = handle.includes('e') || handle.includes('w');
  const affectsY = handle.includes('n') || handle.includes('s');
  if ((affectsX && bounds.width <= 0) || (affectsY && bounds.height <= 0)) {
    throw new TypeError('Cannot resize a selection along an axis with zero bounds.');
  }

  const resizedBounds = resizeOrientedRect(
    { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, rotation: 0 },
    handle,
    pointerPage,
    [],
    { aspectRatio, minSize }
  );
  let scaleX = affectsX ? resizedBounds.width / bounds.width : 1;
  let scaleY = affectsY ? resizedBounds.height / bounds.height : 1;

  let patches = buildResizePatches(entries, bounds, handle, scaleX, scaleY, { x: 0, y: 0 }, minSize);
  const patchedBounds = selectionBounds(entries.map(({ node, ancestors = [] }) => ({
    node: { ...node, ...patches.get(node.id) },
    ancestors: selectedAncestorPatches(ancestors, patches)
  })));
  const fixedX = affectsX
    ? (handle.includes('w') ? bounds.x + bounds.width : bounds.x)
    : bounds.x + bounds.width / 2;
  const fixedY = affectsY
    ? (handle.includes('n') ? bounds.y + bounds.height : bounds.y)
    : bounds.y + bounds.height / 2;
  const movedFixedX = affectsX
    ? (handle.includes('w') ? patchedBounds.x + patchedBounds.width : patchedBounds.x)
    : patchedBounds.center.x;
  const movedFixedY = affectsY
    ? (handle.includes('n') ? patchedBounds.y + patchedBounds.height : patchedBounds.y)
    : patchedBounds.center.y;
  const correction = { x: fixedX - movedFixedX, y: fixedY - movedFixedY };
  if (Math.abs(correction.x) > 1e-12 || Math.abs(correction.y) > 1e-12) {
    patches = buildResizePatches(entries, bounds, handle, scaleX, scaleY, correction, minSize);
  }
  return [...patches.values()];
}

/**
 * Rotate every selected layer's center around one page-space pivot and add the
 * rotation to the selection as a whole. Ancestor patches are applied before
 * positioning descendants, so a selection containing nested layers does not
 * apply the same group rotation twice.
 */
export function rotateSelection(entries, centerPage, deltaDegrees) {
  validateEntries(entries);
  validatePagePoint(centerPage, 'Rotation center');
  if (!Number.isFinite(deltaDegrees)) throw new TypeError('Rotation delta must be finite degrees.');

  const radians = deltaDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const patches = new Map();
  const ordered = [...entries].sort((left, right) => (left.ancestors?.length || 0) - (right.ancestors?.length || 0));
  for (const { node, ancestors = [] } of ordered) {
    const oldCenter = nodeLocalToPage(node, centerOf(node), ancestors);
    const dx = oldCenter.x - centerPage.x;
    const dy = oldCenter.y - centerPage.y;
    const targetCenter = {
      x: centerPage.x + cosine * dx - sine * dy,
      y: centerPage.y + sine * dx + cosine * dy
    };
    const ancestorRotationDelta = ancestors.reduce((total, ancestor) => {
      const patch = ancestor.id && patches.get(ancestor.id);
      return total + (patch ? patch.rotation - Number(ancestor.rotation || 0) : 0);
    }, 0);
    const rotation = Number(node.rotation || 0) + deltaDegrees - ancestorRotationDelta;
    const updatedAncestors = selectedAncestorPatches(ancestors, patches);
    const local = parentLocalCenter(node, updatedAncestors, targetCenter);
    patches.set(node.id, { id: node.id, ...local, rotation });
  }
  return [...patches.values()];
}
