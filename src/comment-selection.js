const commentContainerTypes = new Set(['frame', 'group']);

/** Resolve a canvas hit to the nearest frame/component, then a group or leaf. */
export function commentSelectionTarget(entry) {
  if (!entry?.node) return null;
  const candidates = [entry.node, ...(Array.isArray(entry.parents) ? [...entry.parents].reverse() : [])];
  return candidates.find(node => node.type === 'frame' || node.isComponent || node.isInstance)
    || candidates.find(node => node.type === 'group')
    || entry.node;
}
