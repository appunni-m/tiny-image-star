import { findNode, getNodeGeometry, getNodePropertyValue } from './model.js';
import { IDENTITY_AFFINE, invertAffine, multiplyAffine, nodeToParentTransform, transformPoint } from './transform-geometry.js';
import { isFixedPositionWhenScrolling } from './prototype-scroll-position.js';

const scrollBehaviors = new Set(['vertical', 'horizontal', 'both']);
const alignments = new Set(['nearest', 'start', 'center', 'end']);

function translated(x, y) {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

function geometry(document, node) {
  return { ...node, ...getNodeGeometry(document, node) };
}

function scrollOffset(offsets, frame) {
  const value = offsets.get(frame.id);
  return {
    x: Number.isFinite(value?.x) ? Math.max(0, value.x) : 0,
    y: Number.isFinite(value?.y) ? Math.max(0, value.y) : 0
  };
}

/** Compose a node transform while accounting for already-applied ancestor scrolling. */
function nodeMatrix(node, ancestors, offsets, omitScrollFrameId = null) {
  let matrix = IDENTITY_AFFINE;
  for (let index = 0; index < ancestors.length; index += 1) {
    const ancestor = ancestors[index];
    matrix = multiplyAffine(matrix, nodeToParentTransform(ancestor));
    const nextChild = ancestors[index + 1] || node;
    if (ancestor.id === omitScrollFrameId || !scrollBehaviors.has(ancestor.overflowBehavior)
      || isFixedPositionWhenScrolling(nextChild, ancestor)) continue;
    const offset = scrollOffset(offsets, ancestor);
    if (offset.x || offset.y) matrix = multiplyAffine(matrix, translated(-offset.x, -offset.y));
  }
  return multiplyAffine(matrix, nodeToParentTransform(node));
}

function transformedBounds(matrix, width, height) {
  const points = [
    transformPoint(matrix, { x: 0, y: 0 }),
    transformPoint(matrix, { x: width, y: 0 }),
    transformPoint(matrix, { x: width, y: height }),
    transformPoint(matrix, { x: 0, y: height })
  ];
  return {
    left: Math.min(...points.map(point => point.x)),
    top: Math.min(...points.map(point => point.y)),
    right: Math.max(...points.map(point => point.x)),
    bottom: Math.max(...points.map(point => point.y))
  };
}

/** Return the scroll range implied by visible content, stopping at nested viewports. */
function frameScrollLimits(document, frame, frameAncestors) {
  const resolvedFrame = geometry(document, frame);
  const frameMatrix = nodeMatrix(resolvedFrame, frameAncestors, new Map());
  const pageToFrame = invertAffine(frameMatrix);
  const bounds = { right: resolvedFrame.width, bottom: resolvedFrame.height };
  const visit = (nodes, parents) => {
    for (const node of nodes || []) {
      if (!getNodePropertyValue(document, node, 'visible')) continue;
      const resolved = geometry(document, node);
      const matrix = nodeMatrix(resolved, [frame, ...parents], new Map());
      const localMatrix = multiplyAffine(pageToFrame, matrix);
      const childBounds = transformedBounds(localMatrix, resolved.width, resolved.height);
      bounds.right = Math.max(bounds.right, childBounds.right);
      bounds.bottom = Math.max(bounds.bottom, childBounds.bottom);
      if (!resolved.clip && !(resolved.type === 'frame' && scrollBehaviors.has(resolved.overflowBehavior))) {
        visit(resolved.children, [...parents, resolved]);
      }
    }
  };
  visit(frame.children.filter(child => !isFixedPositionWhenScrolling(child, frame)), []);
  const horizontal = frame.overflowBehavior === 'horizontal' || frame.overflowBehavior === 'both';
  const vertical = frame.overflowBehavior === 'vertical' || frame.overflowBehavior === 'both';
  return {
    maxX: horizontal ? Math.max(0, bounds.right - resolvedFrame.width) : 0,
    maxY: vertical ? Math.max(0, bounds.bottom - resolvedFrame.height) : 0
  };
}

function desiredOffset(start, end, current, viewport, alignment, margin) {
  if (alignment === 'start') return start - margin;
  if (alignment === 'center') return (start + end - viewport) / 2;
  if (alignment === 'end') return end - viewport + margin;
  const visibleStart = current + margin;
  const visibleEnd = current + viewport - margin;
  if (start >= visibleStart && end <= visibleEnd) return current;
  const toStart = start - margin;
  const toEnd = end - viewport + margin;
  if (start < visibleStart && end > visibleEnd) {
    return Math.abs(toStart - current) <= Math.abs(toEnd - current) ? toStart : toEnd;
  }
  return start < visibleStart ? toStart : toEnd;
}

/**
 * Plan a prototype “scroll to layer” action without mutating the document or
 * current presentation offsets. Ancestor scroll frames are processed from
 * innermost to outermost so nested viewports reveal the target correctly.
 *
 * `alignment` accepts `nearest`, `start`, `center`, or `end`; `margin` is the
 * desired inset from the viewport edge. The returned offsets can be applied to
 * the presentation renderer's `presentationScrollOffsets` Map.
 */
export function planPrototypeScrollTo(document, targetId, {
  pageId = document?.activePageId,
  screenFrameId = null,
  targetFrameId = null,
  currentOffsets = new Map(),
  alignment = 'nearest',
  margin = 0
} = {}) {
  if (!document || typeof targetId !== 'string' || !targetId) throw new TypeError('Choose a layer to scroll to.');
  if (!(currentOffsets instanceof Map)) throw new TypeError('Presentation scroll offsets must be a Map.');
  if (!alignments.has(alignment)) throw new TypeError('Unsupported prototype scroll alignment.');
  if (!Number.isFinite(margin) || margin < 0 || margin > 100_000) throw new TypeError('Scroll margin must be a finite non-negative value.');

  const entry = findNode(document, targetId, pageId);
  if (!entry) throw new Error('The prototype scroll target no longer exists on this page.');
  const screenFrameIndex = screenFrameId == null ? -1 : entry.parents.findIndex(node => node.id === screenFrameId);
  if (screenFrameId != null && (screenFrameIndex < 0 || entry.parents[screenFrameIndex]?.type !== 'frame')) {
    throw new Error('Choose a target layer inside the active prototype screen frame.');
  }
  const targetFrameIndex = targetFrameId == null ? -1 : entry.parents.findIndex(node => node.id === targetFrameId);
  if (targetFrameId != null && (targetFrameIndex < 0
    || entry.parents[targetFrameIndex]?.type !== 'frame'
    || !scrollBehaviors.has(entry.parents[targetFrameIndex]?.overflowBehavior))) {
    throw new Error('Choose a scrollable ancestor frame that contains the target layer.');
  }
  if (screenFrameIndex >= 0 && targetFrameIndex >= 0 && targetFrameIndex < screenFrameIndex) {
    throw new Error('Choose a scroll frame inside the active prototype screen.');
  }
  const minimumFrameIndex = Math.max(screenFrameIndex, targetFrameIndex);

  const offsets = new Map([...currentOffsets].map(([id, value]) => [id, {
    x: Number.isFinite(value?.x) ? Math.max(0, value.x) : 0,
    y: Number.isFinite(value?.y) ? Math.max(0, value.y) : 0
  }]));
  const target = geometry(document, entry.node);
  const updates = [];
  const scrollAncestors = entry.parents
    .map((node, index) => ({ node: geometry(document, node), ancestors: entry.parents.slice(0, index), index }))
    .filter(({ node, index }) => node.type === 'frame' && scrollBehaviors.has(node.overflowBehavior)
      && (minimumFrameIndex < 0 || index >= minimumFrameIndex)
      && !isFixedPositionWhenScrolling(entry.parents[index + 1] || entry.node, node))
    .reverse();

  for (const { node: frame, ancestors } of scrollAncestors) {
    const frameMatrix = nodeMatrix(frame, ancestors, offsets);
    const targetMatrix = nodeMatrix(target, entry.parents, offsets, frame.id);
    const pageToFrame = invertAffine(frameMatrix);
    const targetInFrame = transformedBounds(multiplyAffine(pageToFrame, targetMatrix), target.width, target.height);
    const limits = frameScrollLimits(document, frame, ancestors);
    const current = scrollOffset(offsets, frame);
    const marginX = Math.min(margin, frame.width / 2);
    const marginY = Math.min(margin, frame.height / 2);
    const next = {
      x: frame.overflowBehavior === 'horizontal'
        || frame.overflowBehavior === 'both'
        ? Math.max(0, Math.min(limits.maxX, desiredOffset(targetInFrame.left, targetInFrame.right, current.x, frame.width, alignment, marginX)))
        : current.x,
      y: frame.overflowBehavior === 'vertical'
        || frame.overflowBehavior === 'both'
        ? Math.max(0, Math.min(limits.maxY, desiredOffset(targetInFrame.top, targetInFrame.bottom, current.y, frame.height, alignment, marginY)))
        : current.y
    };
    if (next.x !== current.x || next.y !== current.y) {
      offsets.set(frame.id, next);
      updates.push({ frameId: frame.id, from: current, to: next });
    }
  }

  return { targetId, screenFrameId, targetFrameId, pageId, alignment, offsets, updates };
}
