import { findNode } from './model.js';

const policies = new Set(['preserve', 'reset']);

/**
 * Return presentation scroll offsets for entering a prototype frame.
 * `preserve` keeps the existing offsets. `reset` clears the destination frame
 * and its descendant scroll frames while leaving other screens' state intact.
 */
export function prototypeScrollOffsetsForFrame(document, currentOffsets, pageId, frameId, policy = 'preserve') {
  if (!(currentOffsets instanceof Map)) throw new TypeError('Prototype scroll offsets must be a Map.');
  if (!policies.has(policy)) throw new TypeError('Unsupported prototype scroll position policy.');
  const entry = findNode(document, frameId, pageId);
  if (!entry || entry.node.type !== 'frame') throw new TypeError('Choose a prototype frame for scroll-state selection.');

  const offsets = new Map(currentOffsets);
  if (policy === 'preserve') return offsets;

  const clearFrameTree = node => {
    if (node.type === 'frame') offsets.delete(node.id);
    for (const child of node.children || []) clearFrameTree(child);
  };
  clearFrameTree(entry.node);
  return offsets;
}
