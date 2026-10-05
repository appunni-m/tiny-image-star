import { findNode, getNodePropertyValue } from './model.js';
import { initializeLuminanceMaskWasm } from './luminance-mask.js';

/** Wait for masks used by this render, including selected layers' clipping ancestors. */
export async function prepareRasterExportMasks(document, nodeIds, { initialize = initializeLuminanceMaskWasm } = {}) {
  const pending = [];
  for (const id of nodeIds) {
    const entry = findNode(document, id);
    if (!entry) throw new Error('The selected layer is no longer available.');
    if ([entry.node, ...entry.parents].some(node => getNodePropertyValue(document, node, 'visible') === false)) continue;
    let branchId = entry.node.id;
    let maskedOut = false;
    let usesLuminance = false;
    for (let index = entry.parents.length - 1; index >= 0; index -= 1) {
      const parent = entry.parents[index];
      if (parent.mask && parent.maskSourceId !== branchId) {
        const source = parent.children?.find(child => child.id === parent.maskSourceId);
        if (!source || getNodePropertyValue(document, source, 'visible') === false) { maskedOut = true; break; }
        usesLuminance ||= parent.maskMode === 'luminance';
      }
      branchId = parent.id;
    }
    if (maskedOut) continue;
    if (usesLuminance) { await initialize(); return; }
    pending.push(entry.node);
  }
  const visited = new Set();
  while (pending.length) {
    const node = pending.pop();
    if (visited.has(node) || getNodePropertyValue(document, node, 'visible') === false) continue;
    visited.add(node);
    if (node.mask) {
      const source = node.children?.find(child => child.id === node.maskSourceId);
      if (!source || getNodePropertyValue(document, source, 'visible') === false) continue;
    }
    if (node.mask && node.maskMode === 'luminance') { await initialize(); return; }
    // Boolean operands and mask-source descendants render in geometry/alpha
    // mode, where their own luminance-mask groups are not applied.
    if (node.type === 'boolean') continue;
    for (const child of node.children || []) if (!node.mask || child.id !== node.maskSourceId) pending.push(child);
  }
}
