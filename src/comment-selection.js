/** Resolve a canvas hit to a component first, then its nearest frame, group, or leaf. */
export function commentSelectionTarget(entry, { preferComponent = true, preferHitContainer = false } = {}) {
  if (!entry?.node) return null;
  const candidates = [entry.node, ...(Array.isArray(entry.parents) ? [...entry.parents].reverse() : [])];
  // In Comment mode, a directly hit container should stay selectable even
  // when it is nested inside a component. Child artwork still resolves to its
  // containing component, preserving the normal one-click review workflow.
  if (preferHitContainer && (entry.node.type === 'frame' || entry.node.isComponent || entry.node.isInstance)) {
    return entry.node;
  }
  if (preferComponent) {
    const component = candidates.find(node => node.isComponent || node.isInstance);
    if (component) return component;
  }
  return candidates.find(node => node.type === 'frame' || node.isComponent || node.isInstance)
    || candidates.find(node => node.type === 'group')
    || entry.node;
}

/** Resolve whether a Comment-tool canvas click selects an object or places a pin. */
export function commentCanvasAction(target, { addCommentShortcut = false } = {}) {
  return addCommentShortcut || !target ? 'place-comment' : 'select';
}

/** Keep the canvas interactive when the mobile Comments panel is being used to select/place. */
export function commentPanelCanvasIsInteractive({
  mobile, hostViewOnly, inspectorOpen, inspectorTab, pendingCommentAnchor
} = {}) {
  // The visible canvas stays selectable from the Comments panel even when no
  // thread is open. A new-comment draft is the only modal comment state.
  const commentCanvasActionReady = !pendingCommentAnchor;
  return Boolean(mobile && !hostViewOnly && inspectorOpen && inspectorTab === 'comments' && commentCanvasActionReady);
}

/** Keep object selection available when a comment pin overlaps its target. */
export function commentPinCanvasAction(comment, target, { tool, activeCommentId, targetSelected = false } = {}) {
  if (!target) return 'open-thread';
  // Let the user leave an open thread by selecting the object beneath its pin,
  // whether they are in Comment mode or have switched back to Select.
  if (comment?.id === activeCommentId && ['comment', 'select'].includes(tool)) return 'select';
  // In Select mode, an unselected object under a comment pin gets the first
  // click. A second click on that selected object opens the thread. This keeps
  // pins from trapping selection when the Comments panel is active.
  if (tool === 'select') return targetSelected ? 'open-thread' : 'select';
  if (tool !== 'comment') return 'open-thread';
  // For other pins, select an unselected target on the first click; clicking
  // it again opens the thread without requiring pixel-perfect pin targeting.
  if (!targetSelected) return 'select';
  return 'open-thread';
}
