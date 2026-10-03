import { fillStackForNode, isFillStackSupported } from './fills.js';
import { strokeStackForNode } from './strokes.js';

const paintKinds = new Set(['fill', 'stroke']);

function normalizedValue(value) {
  if (Array.isArray(value)) return value.map(normalizedValue);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    // Paint and gradient-stop IDs are editing metadata, not visible style.
    if (key === 'id' || key === 'name') continue;
    result[key] = normalizedValue(value[key]);
  }
  return result;
}

function signatureFor(node, kind, getPaintStack) {
  if (kind === 'fill' && !isFillStackSupported(node)) return null;
  if (kind === 'stroke' && node.type === 'boolean') return null;
  const stack = getPaintStack(node, kind);
  if (!Array.isArray(stack)) return null;
  const visiblePaints = stack.filter(paint => paint?.visible !== false && (paint?.opacity ?? 1) > 0);
  if (!visiblePaints.length) return null;
  return JSON.stringify(visiblePaints.map(normalizedValue));
}

/**
 * Return active-page layer IDs whose visible fill or stroke stack matches the
 * reference layer. Paint IDs and names are ignored; order, alpha, blend modes,
 * gradient geometry, and other saved paint values remain part of the comparison.
 * Hidden or locked layers and descendants are skipped.
 */
export function selectLayersWithSamePaint(rootNodes, referenceNode, kind, {
  getPaintStack = (node, paintKind) => paintKind === 'fill'
    ? fillStackForNode(node)
    : strokeStackForNode(node)
} = {}) {
  if (!paintKinds.has(kind)) throw new TypeError('Paint kind must be fill or stroke.');
  if (!Array.isArray(rootNodes) || !referenceNode || typeof referenceNode.id !== 'string' || typeof getPaintStack !== 'function') {
    return [];
  }

  const visited = new WeakSet();
  const entries = [];
  const pending = [];
  for (let index = rootNodes.length - 1; index >= 0; index -= 1) {
    pending.push({ node: rootNodes[index], hidden: false, locked: false });
  }
  let referenceFound = false;
  let referenceSignature = null;
  while (pending.length) {
    const { node, hidden: parentHidden, locked: parentLocked } = pending.pop();
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);
    const hidden = parentHidden || node.visible === false;
    const locked = parentLocked || node.locked === true;
    if (!hidden && !locked) {
      const signature = signatureFor(node, kind, getPaintStack);
      if (node === referenceNode || node.id === referenceNode.id) {
        referenceFound = true;
        referenceSignature = signature;
      }
      if (signature) entries.push({ id: node.id, signature });
    }
    if (Array.isArray(node.children)) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push({ node: node.children[index], hidden, locked });
      }
    }
  }
  if (!referenceFound || !referenceSignature) return [];
  return entries.filter(entry => entry.signature === referenceSignature).map(entry => entry.id);
}
