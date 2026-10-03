/** Return the component/frame targets reachable from one canvas hit, in selection order. */
export function commentSelectionTargets(entry, { preferComponent = true, preferHitContainer = false } = {}) {
  if (!entry?.node) return null;
  const candidates = [entry.node, ...(Array.isArray(entry.parents) ? [...entry.parents].reverse() : [])];
  const containers = candidates.filter(node => node.type === 'frame' || node.isComponent || node.isInstance);
  // In Comment mode, a directly hit container should stay selectable even
  // when it is nested inside a component. Child artwork still resolves to its
  // containing component, preserving the normal one-click review workflow.
  if (preferHitContainer && (entry.node.type === 'frame' || entry.node.isComponent || entry.node.isInstance)) {
    return [...new Map([entry.node, ...containers].map(node => [node.id, node])).values()];
  }
  if (preferComponent) {
    const component = candidates.find(node => node.isComponent || node.isInstance);
    if (component) return [...new Map([component, ...containers.filter(node => node.id !== component.id)].map(node => [node.id, node])).values()];
  }
  if (containers.length) return containers;
  return [candidates.find(node => node.type === 'group') || entry.node];
}

/** Resolve a canvas hit to a component first, then its nearest frame, group, or leaf. */
export function commentSelectionTarget(entry, options = {}) {
  return commentSelectionTargets(entry, options)?.[0] || null;
}

/** Cycle a repeated touch hit through the containers under that point. */
export function nextCommentSelectionTarget(entry, currentTargetId, options = {}) {
  const targets = commentSelectionTargets(entry, options) || [];
  if (!targets.length) return null;
  const current = targets.findIndex(node => node.id === currentTargetId);
  return targets[current < 0 ? 0 : (current + 1) % targets.length];
}

/** Repeated clicks or taps cycle container targets at one document point. */
export function advanceCommentSelection(entry, previous, {
  pageId, pointerType, x, y, time, tolerance = 18, selectedTargetId = null
} = {}, options = {}) {
  const targets = commentSelectionTargets(entry, options) || [];
  if (!targets.length || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(time)
    || !Number.isFinite(tolerance) || tolerance < 0) {
    return { target: null, cycle: null, cycled: false };
  }
  const previousIndex = targets.findIndex(node => node.id === previous?.targetId);
  const sameTargetPath = Array.isArray(previous?.targetPath)
    && previous.targetPath.length === targets.length
    && previous.targetPath.every(id => targets.some(node => node.id === id));
  const sameDocumentPoint = Number.isFinite(previous?.x) && Number.isFinite(previous?.y)
    && Math.hypot(x - previous.x, y - previous.y) <= tolerance;
  const sameSpot = previousIndex >= 0 && previous.pageId === pageId
    && previous.pointerType === pointerType && time >= previous.time && time - previous.time <= 5000
    // Mobile comment review can close or resize its panel between taps. In
    // that case the same artwork moves on screen and maps to a different
    // document point; a stable container path still identifies the intended
    // component/frame cycle.
    && (sameDocumentPoint || sameTargetPath);
  const selectedIndex = targets.findIndex(node => node.id === selectedTargetId);
  const selectionChangedSinceCycle = selectedIndex >= 0 && selectedTargetId !== previous?.targetId;
  const continuesCycle = sameSpot && !selectionChangedSinceCycle;
  // A selection made from the Layers panel has no canvas cycle to advance.
  // Let a comment-review hit on that already-selected container choose its
  // other containing frame/component immediately instead of appearing inert.
  const startsFromSelectedTarget = !continuesCycle && selectedIndex >= 0 && targets.length > 1;
  const target = continuesCycle
    ? nextCommentSelectionTarget(entry, previous.targetId, options)
    : startsFromSelectedTarget
      ? targets[(selectedIndex + 1) % targets.length]
      : targets[0];
  return {
    target,
    cycle: { pageId, pointerType, x, y, targetId: target.id, targetPath: targets.map(node => node.id), time },
    cycled: (continuesCycle || startsFromSelectedTarget) && targets.length > 1
  };
}

/** A pin only continues the selection cycle that was started from that pin. */
export function commentPinSelectionCycleMatches(cycle, commentId) {
  return typeof commentId === 'string' && cycle?.commentPinId === commentId;
}

/** Bind an active-pin selection cycle to the pin it is cycling beneath. */
export function commentPinSelectionCycle(cycle, commentId) {
  if (!cycle || typeof commentId !== 'string') return null;
  return { ...cycle, commentPinId: commentId };
}

/** Resolve whether a Comment-tool canvas click selects an object or places a pin. */
export function commentCanvasAction(target, { addCommentShortcut = false } = {}) {
  return addCommentShortcut || !target ? 'place-comment' : 'select';
}

/** The Comments panel routes object hits to selection before other canvas tools. */
export function commentPanelOverridesCanvasTool({ inspectorTab, tool } = {}) {
  // Route review-panel object hits before any canvas tool. Hand still pans on
  // a drag; the pointer handler distinguishes that from a selection click.
  return Boolean(inspectorTab === 'comments');
}

/** Keep an open thread from trapping object selection beneath another pin. */
export function commentPinOverridesCanvasSelection({ activeCommentId, commentPin, addCommentShortcut } = {}) {
  // Let an active pin reach the pin-specific cycling path so selecting the
  // object beneath it can bind the next hit to that pin. A different pin must
  // yield to the already-open review selection instead of replacing it.
  return Boolean(addCommentShortcut || (commentPin
    && (!activeCommentId || commentPin.id === activeCommentId)));
}

/** Keep Comment-tool object selection ahead of any stale canvas edit mode. */
export function commentSelectionOverridesCanvasTool({
  inspectorTab, tool, activeCommentId, pendingCommentAnchor
} = {}) {
  // Keep an active thread (or anchored draft) from falling back to a drawing
  // tool just because the inspector tab changed. A canvas hit should first
  // let the user leave comment review by selecting its target. Hand uses the
  // same hit route for clicks and retains panning for drags.
  return Boolean(tool === 'comment' || commentPanelOverridesCanvasTool({ inspectorTab, tool })
    || activeCommentId || pendingCommentAnchor);
}

/** Clear stale canvas-edit captures while the Comments panel expects object hits. */
export function commentPanelNeedsCanvasCaptureRelease({
  inspectorTab, tool, activeCommentId, pendingCommentAnchor
} = {}) {
  return Boolean(inspectorTab === 'comments' || activeCommentId || pendingCommentAnchor);
}

/** Distinguish a canvas tap that places a note from a drag that pans the view. */
export function commentPlacementGesturePans(start, end, threshold = 8) {
  return Number.isFinite(start?.x) && Number.isFinite(start?.y)
    && Number.isFinite(end?.x) && Number.isFinite(end?.y)
    && Number.isFinite(threshold) && threshold >= 0
    && Math.hypot(end.x - start.x, end.y - start.y) > threshold;
}

/** Keep the exposed mobile canvas interactive while comment review or selection is active. */
export function commentPanelCanvasIsInteractive({
  mobile, hostViewOnly, inspectorOpen, layersOpen, inspectorTab, commentToolActive, activeCommentId, pendingCommentAnchor
} = {}) {
  // The Comment tool remains a canvas tool even when the user switches the
  // inspector to Design. Keep the visible canvas hit-testable when either
  // mobile drawer is open, as well as during thread review and draft editing.
  return Boolean(mobile && !hostViewOnly && (inspectorOpen || layersOpen)
    && (commentToolActive || inspectorTab === 'comments' || activeCommentId || pendingCommentAnchor));
}

/** Keep object selection available when a comment pin overlaps its target. */
export function commentPinCanvasAction(comment, target, {
  tool, activeCommentId, targetSelected = false, selectionCycled = false, forceSelect = false
} = {}) {
  if (!target) return 'open-thread';
  // Shift-click is the explicit escape hatch for selecting a frame under an
  // overlapping pin. It must win before the normal second-click-to-open rule.
  if (forceSelect) return 'select';
  // In Comment mode, a repeated hit can mean the user is cycling from a
  // component to a nested frame underneath the pin. Let that selection win;
  // otherwise the pin would reset the cycle and trap selection on the component.
  if (tool === 'comment' && selectionCycled) return 'select';
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
