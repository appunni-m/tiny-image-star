import { cloneDocument, removeNode, validateDocument } from './model.js';

/** Remove a set of top-level selections atomically, without leaving a partial delete. */
export function removeLayersAtomically(document, nodeIds, pageId = document.activePageId) {
  const ids = [...new Set(nodeIds)];
  if (!ids.length) return { document, removedIds: [] };

  const nextDocument = cloneDocument(document);
  for (const nodeId of ids) {
    if (!removeNode(nextDocument, nodeId, pageId)) {
      throw new Error('One of the selected layers no longer exists.');
    }
  }
  validateDocument(nextDocument);
  return { document: nextDocument, removedIds: ids };
}
