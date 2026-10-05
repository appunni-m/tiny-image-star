import { findNode, getNodePropertyValue, prepareBooleanVectorPath, resolveBooleanSourceNode } from './model.js';
import { booleanVectorGeometryKey } from './boolean-vector-geometry.js';

const MAX_EXPORT_GEOMETRY_BYTES = 32 * 1024 * 1024;
const keyFor = (document, node) => booleanVectorGeometryKey(node, { resolveNode: source => resolveBooleanSourceNode(document, source) });

/** Prepare the exact vector regions that the subsequent local export will draw. */
export async function prepareBooleanVectorExport(document, nodeIds, {
  signal, prepare = prepareBooleanVectorPath
} = {}) {
  const roots = [];
  for (const id of nodeIds) {
    const entry = findNode(document, id);
    if (!entry) throw new Error('The selected layer is no longer available.');
    if ([entry.node, ...entry.parents].some(node => getNodePropertyValue(document, node, 'visible') === false)) continue;
    roots.push(entry.node);
    // Selected subtree exports also include masking sources in their wrappers.
    for (const parent of entry.parents) if (parent.mask) {
      const source = parent.children?.find(child => child.id === parent.maskSourceId);
      if (source) roots.push(source);
    }
  }
  const seen = new Set(); const prepared = new Map(); let bytes = 0;
  while (roots.length) {
    if (signal?.aborted) throw new DOMException('Vector export cancelled.', 'AbortError');
    const node = roots.pop();
    if (seen.has(node) || getNodePropertyValue(document, node, 'visible') === false) continue;
    seen.add(node);
    if (node.type === 'boolean' && node.booleanGeometry === 'vector') {
      // Sequential admission avoids filling the bounded native worker queue.
      const key = keyFor(document, node);
      const path = await prepare(document, node, { signal });
      bytes += (key.length + JSON.stringify(path).length) * 2;
      if (bytes > MAX_EXPORT_GEOMETRY_BYTES) throw new Error('This export exceeds the local vector geometry budget. Export fewer layers together.');
      prepared.set(node.id, { source: node, key, path });
    } else for (const child of node.children || []) roots.push(child);
  }
  if (signal?.aborted) throw new DOMException('Vector export cancelled.', 'AbortError');
  // An earlier region may have changed while a later one was preparing.
  for (const entry of prepared.values()) if (keyFor(document, entry.source) !== entry.key) {
    throw new Error('A Boolean source changed before export finished. Retry the export.');
  }
  return prepared;
}

/** Borrow prepared contours for one export without relying on global cache retention. */
export function projectBooleanVectorPaintTree(document, node, prepared) {
  if (getNodePropertyValue(document, node, 'visible') === false) return node;
  if (node.type === 'boolean' && node.booleanGeometry === 'vector') {
    const entry = prepared?.get(node.id);
    if (!entry || keyFor(document, node) !== entry.key) throw new Error('The Boolean geometry changed or was not prepared for this export. Retry the export.');
    const { children, ...own } = resolveBooleanSourceNode(document, node);
    const path = entry.path;
    return { ...own, type: 'path', children: [], points: path.points, closed: path.closed,
      ...(path.subpaths ? { subpaths: path.subpaths } : {}), fillRule: path.fillRule,
      __booleanGeometryBounds: path.__booleanGeometryBounds };
  }
  if (!node.children?.length) return node;
  return { ...node, children: node.children.map(child => projectBooleanVectorPaintTree(document, child, prepared)) };
}

/** Visit paint inputs, excluding the retained operands of full-geometry Booleans. */
export function walkBooleanPaintInputs(roots, visit) {
  const stack = roots.map(node => ({ node, parents: [] })).reverse();
  const seen = new Set();
  while (stack.length) {
    const entry = stack.pop(); const { node } = entry;
    if (!node || typeof node !== 'object' || seen.has(node) || seen.size >= 100_000 || entry.parents.length >= 256) {
      throw new Error('The export contains an invalid or oversized paint tree.');
    }
    seen.add(node); visit(entry);
    if (node.type === 'boolean' && node.booleanGeometry === 'vector') continue;
    const parents = [...entry.parents, node];
    for (let index = (node.children?.length || 0) - 1; index >= 0; index--) stack.push({ node: node.children[index], parents });
  }
}
