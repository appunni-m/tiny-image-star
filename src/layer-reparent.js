import { findNode, getNodeGeometry, moveNode, validateDocument } from './model.js';
import { captureAutoLayoutAncestors, reflowAutoLayoutAncestors } from './layer-auto-layout.js';
import { invertAffine, multiplyAffine, nodeToParentTransform, parentLocalToPageTransform, transformPoint } from './transform-geometry.js';

const containerTypes = new Set(['frame', 'section', 'group', 'boolean']);

function resolvedParents(document, parents) {
  return parents.map(parent => ({ ...parent, ...getNodeGeometry(document, parent) }));
}

function destinationParents(document, destination) {
  return destination ? [...resolvedParents(document, destination.parents), {
    ...destination.node, ...getNodeGeometry(document, destination.node)
  }] : [];
}

function normalizeIndex(index) {
  if (index == null) return undefined;
  if (!Number.isInteger(index)) throw new TypeError('The layer order index must be an integer.');
  return index;
}

function prepareMove(document, nodeId, { parentId, index, pageId }) {
  const page = document.pages?.find(item => item.id === pageId);
  if (!page) return null;
  const source = findNode(document, nodeId, pageId);
  if (!source) return null;

  const sourceParentId = source.parent?.id ?? null;
  if (sourceParentId === parentId) return null;

  let destination = null;
  if (parentId != null) {
    destination = findNode(document, parentId, pageId);
    if (!destination || !containerTypes.has(destination.node.type)) return null;
    if (destination.node.id === nodeId || destination.parents.some(parent => parent.id === nodeId)) return null;
  }

  if (source.node.locked || source.parents.some(parent => parent.locked)
    || destination?.node.locked || destination?.parents.some(parent => parent.locked)) return null;
  if (source.parent?.mask && source.parent.maskSourceId === source.node.id) return null;
  // Geometry bindings cannot be rewritten by a structural move. The displayed
  // layer would otherwise stay at its old variable position after reparenting.
  if (source.node.variableBindings?.x || source.node.variableBindings?.y) return null;
  if (source.node.isComponent || source.node.isInstance || source.parents.some(parent => parent.isComponent || parent.isInstance)
    || destination?.node.isComponent || destination?.node.isInstance
    || destination?.parents.some(parent => parent.isComponent || parent.isInstance)) return null;

  const sourceGeometry = getNodeGeometry(document, source.node);
  if (![sourceGeometry?.x, sourceGeometry?.y].every(Number.isFinite)) return null;
  if (source.node.type === 'slice' && !(parentId == null
    && sourceGeometry.width > 0 && sourceGeometry.height > 0 && sourceGeometry.rotation === 0
    && !(source.node.children || []).length && !source.node.isComponent && !source.node.isInstance && !source.node.mask)) return null;
  const sourceTransform = parentLocalToPageTransform(resolvedParents(document, source.parents));
  let desiredWorldTransform;
  try {
    desiredWorldTransform = multiplyAffine(sourceTransform, nodeToParentTransform({
      ...source.node, ...sourceGeometry
    }));
    // Ensure that the destination transform can be inverted before mutation.
    invertAffine(parentLocalToPageTransform(destinationParents(document, destination)));
  } catch { return null; }

  return { source, destination, desiredWorldTransform, index: normalizeIndex(index), pageId };
}

function applyMove(document, nodeId, parentId, plan) {
  const { destination, desiredWorldTransform, index, pageId } = plan;
  const nextAutoLayoutAncestors = captureAutoLayoutAncestors(document, [nodeId], pageId);
  const destinationAutoLayoutAncestors = destination
    ? captureAutoLayoutAncestors(document, [destination.node.id], pageId)
    : [];
  const layoutAncestors = new Map([...nextAutoLayoutAncestors, ...destinationAutoLayoutAncestors].map(item => [item.id, item]));
  if (destination?.node.type === 'frame' && destination.node.autoLayout) {
    layoutAncestors.set(destination.node.id, { id: destination.node.id, depth: destination.depth + 1 });
  }

  if (!moveNode(document, nodeId, { parentId, index, pageId })) return false;
  const moved = findNode(document, nodeId, pageId)?.node;
  if (!moved) return false;

  // Reparenting should keep the visual location stable. In an auto-layout
  // frame, an absolute child is the supported way to preserve that location.
  if (destination?.node.autoLayout) moved.layoutPositioning = 'absolute';
  else if (moved.layoutPositioning === 'absolute') delete moved.layoutPositioning;

  reflowAutoLayoutAncestors(document, [...layoutAncestors.values()], pageId);

  // Auto-layout can change a Hug frame's size and therefore its rotated local
  // origin. Solve the moved layer's local affine against the final destination
  // transform so its complete page-space transform stays identical.
  const updatedEntry = findNode(document, nodeId, pageId);
  const geometry = getNodeGeometry(document, moved);
  const parentTransform = parentLocalToPageTransform(resolvedParents(document, updatedEntry.parents));
  const localTransform = multiplyAffine(invertAffine(parentTransform), desiredWorldTransform);
  const rotationTransform = nodeToParentTransform({ ...moved, ...geometry, x: 0, y: 0, affineTransform: null });
  const affineTransform = multiplyAffine(localTransform, invertAffine(rotationTransform));
  moved.x = affineTransform.e;
  moved.y = affineTransform.f;
  if (Math.abs(affineTransform.a - 1) > 1e-12 || Math.abs(affineTransform.b) > 1e-12
    || Math.abs(affineTransform.c) > 1e-12 || Math.abs(affineTransform.d - 1) > 1e-12) {
    moved.affineTransform = {
      a: affineTransform.a, b: affineTransform.b,
      c: affineTransform.c, d: affineTransform.d
    };
  } else delete moved.affineTransform;
  return true;
}

/** Check whether a move can preserve the layer's current page-space origin. */
export function canReparentLayer(document, nodeId, {
  parentId = null,
  index,
  pageId = document.activePageId
} = {}) {
  try { return Boolean(prepareMove(document, nodeId, { parentId, index, pageId })); }
  catch { return false; }
}

/**
 * Move a layer to another layer container while preserving its page-space
 * origin and identity. Returns false for invalid targets or unsupported
 * variable-bound positions; rejected operations leave the document untouched.
 */
export function reparentLayer(document, nodeId, {
  parentId = null,
  index,
  pageId = document.activePageId
} = {}) {
  const plan = prepareMove(document, nodeId, { parentId, index, pageId });
  if (!plan) return false;

  // Validate the full move and any auto-layout reflow on an isolated candidate
  // before mutating the caller's document. This keeps model/layout failures
  // atomic while retaining live node identities on successful operations.
  const candidate = structuredClone(document);
  const candidatePlan = prepareMove(candidate, nodeId, { parentId, index: plan.index, pageId });
  if (!candidatePlan) return false;
  try {
    if (!applyMove(candidate, nodeId, parentId, candidatePlan)) return false;
    validateDocument(candidate);
  } catch {
    return false;
  }

  try {
    const moved = applyMove(document, nodeId, parentId, plan);
    if (!moved) return false;
    validateDocument(document);
    return true;
  } catch {
    // The candidate passed the same deterministic model/layout operations;
    // this path is reserved for externally mutated documents during the sync call.
    return false;
  }
}
