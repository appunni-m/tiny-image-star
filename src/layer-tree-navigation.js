import { findNode } from './model.js';
import { layerTreeSections } from './layer-order.js';

const directions = new Set(['child', 'parent', 'next-sibling', 'previous-sibling']);

/** Resolve Figma-style structural keyboard navigation to a layer ID. */
export function layerTreeNavigationTarget(document, selectedIds, direction, pageId = document.activePageId) {
  if (!directions.has(direction) || !Array.isArray(selectedIds) || selectedIds.length !== 1) return null;
  const entry = findNode(document, selectedIds[0], pageId);
  if (!entry) return null;

  if (direction === 'parent') return entry.parent?.id || null;
  if (direction === 'child') {
    const children = entry.node.children || [];
    return layerTreeSections(children, entry.node).flatMap(section => section.nodes)[0]?.id || null;
  }

  const page = document.pages.find(item => item.id === pageId);
  const siblings = entry.parent?.children || page?.children || [];
  const ordered = layerTreeSections(siblings, entry.parent).flatMap(section => section.nodes);
  const index = ordered.findIndex(node => node.id === entry.node.id);
  const nextIndex = index + (direction === 'next-sibling' ? 1 : -1);
  return ordered[nextIndex]?.id || null;
}
