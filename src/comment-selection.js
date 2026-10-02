/** Resolve a canvas hit to a component first, then its nearest frame, group, or leaf. */
export function commentSelectionTarget(entry, { preferComponent = true } = {}) {
  if (!entry?.node) return null;
  const candidates = [entry.node, ...(Array.isArray(entry.parents) ? [...entry.parents].reverse() : [])];
  if (preferComponent) {
    const component = candidates.find(node => node.isComponent || node.isInstance);
    if (component) return component;
  }
  return candidates.find(node => node.type === 'frame' || node.isComponent || node.isInstance)
    || candidates.find(node => node.type === 'group')
    || entry.node;
}

/** Resolve whether a Comment-tool canvas click selects an object or places a pin. */
export function commentCanvasAction(target, { addCommentShortcut = false, placementArmed = false } = {}) {
  return addCommentShortcut || placementArmed || !target ? 'place-comment' : 'select';
}
