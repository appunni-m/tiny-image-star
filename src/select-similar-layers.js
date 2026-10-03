import { fillStackForNode, isFillStackSupported } from './fills.js';
import { strokeStackForNode } from './strokes.js';
import { getNodePropertyValue } from './model.js';

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

function firstFontFamily(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let quote = '';
  let escaped = false;
  let end = value.length;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ',') { end = index; break; }
  }
  let family = value.slice(0, end).trim();
  if ((family[0] === '"' && family.at(-1) === '"') || (family[0] === "'" && family.at(-1) === "'")) {
    family = family.slice(1, -1);
  }
  family = family.replace(/\\([\\"'])/g, '$1').replace(/\s+/g, ' ').trim();
  return family ? family.toLocaleLowerCase('en-US') : null;
}

function fontFamiliesForNode(document, node) {
  const text = getNodePropertyValue(document, node, 'text');
  const baseFamily = getNodePropertyValue(document, node, 'fontFamily') || 'Arial, sans-serif';
  const runsAreCurrent = Array.isArray(node.textRuns)
    && node.textRuns.map(run => run.text).join('') === text;
  const runs = runsAreCurrent ? node.textRuns : null;
  const families = new Set();
  if (runs) {
    for (const run of runs) {
      if (run.text.length === 0) continue;
      const family = firstFontFamily(run.fontFamily ?? baseFamily);
      if (family) families.add(family);
    }
  }
  if (!families.size) {
    const family = firstFontFamily(baseFamily);
    if (family) families.add(family);
  }
  return [...families].sort();
}

/**
 * Return active-page text layer IDs whose effective font-family set matches
 * the reference. Run-level families override the resolved node family just as
 * they do in the renderer; font weights, axes, styles, and style IDs are not
 * part of a font-family match. Hidden or locked layers and descendants are
 * skipped.
 */
export function selectLayersWithSameFont(rootNodes, document, referenceNode) {
  if (!Array.isArray(rootNodes) || !document || !referenceNode || referenceNode.type !== 'text'
    || typeof referenceNode.id !== 'string') return [];

  const visited = new WeakSet();
  const entries = [];
  const pending = [];
  for (let index = rootNodes.length - 1; index >= 0; index -= 1) {
    pending.push({ node: rootNodes[index], hidden: false, locked: false });
  }
  let referenceFamilies = null;
  while (pending.length) {
    const { node, hidden: parentHidden, locked: parentLocked } = pending.pop();
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);
    const hidden = parentHidden || getNodePropertyValue(document, node, 'visible') === false;
    const locked = parentLocked || node.locked === true;
    if (!hidden && !locked && node.type === 'text') {
      const families = fontFamiliesForNode(document, node);
      if (node === referenceNode || node.id === referenceNode.id) referenceFamilies = families;
      if (families.length) entries.push({ id: node.id, families });
    }
    if (Array.isArray(node.children)) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push({ node: node.children[index], hidden, locked });
      }
    }
  }
  if (!referenceFamilies?.length) return [];
  const signature = JSON.stringify(referenceFamilies);
  return entries.filter(entry => JSON.stringify(entry.families) === signature).map(entry => entry.id);
}
