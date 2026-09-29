import { findNode, findNodeAcrossPages, getActivePage, walkNodes } from './model.js';

const triggers = new Set(['on-click', 'while-hovering']);
const transitions = new Set(['instant', 'dissolve', 'move-left', 'move-right']);

export function listPrototypeFrames(document) {
  const frames = [];
  for (const page of document.pages) {
    walkNodes(page.children, ({ node, parents }) => {
      if (node.type === 'frame') frames.push({ page, frame: node, parents });
    });
  }
  return frames;
}

export function setPrototypeStartPoint(document, frameId, pageId = document.activePageId) {
  const entry = findNode(document, frameId, pageId);
  if (!entry || entry.node.type !== 'frame') throw new Error('Choose a frame to use as the prototype starting point.');
  document.prototypeStartPoint = { pageId, nodeId: frameId };
  return document.prototypeStartPoint;
}

export function getPrototypeStartFrame(document, selectedId = null) {
  const start = document.prototypeStartPoint;
  if (start) {
    const entry = findNode(document, start.nodeId, start.pageId);
    if (entry?.node.type === 'frame') return { page: document.pages.find(page => page.id === start.pageId), frame: entry.node };
  }
  if (selectedId) {
    const entry = findNode(document, selectedId);
    if (entry) {
      const selectedFrame = entry.node.type === 'frame' ? entry.node : [...entry.parents].reverse().find(parent => parent.type === 'frame');
      if (selectedFrame) return { page: getActivePage(document), frame: selectedFrame };
    }
  }
  const activeFrames = listPrototypeFrames(document).filter(item => item.page.id === document.activePageId);
  return activeFrames[0] ?? listPrototypeFrames(document)[0] ?? null;
}

export function addPrototypeInteraction(document, sourceId, destinationId, {
  sourcePageId = document.activePageId,
  destinationPageId,
  trigger = 'on-click',
  transition = 'instant',
  duration = 300
} = {}) {
  if (!triggers.has(trigger)) throw new TypeError('Unsupported prototype trigger.');
  if (!transitions.has(transition)) throw new TypeError('Unsupported prototype transition.');
  const source = findNode(document, sourceId, sourcePageId);
  const destination = destinationPageId
    ? findNode(document, destinationId, destinationPageId)
    : findNodeAcrossPages(document, destinationId);
  if (!source) throw new Error('The interaction source layer no longer exists.');
  if (!destination || destination.node.type !== 'frame') throw new Error('Prototype navigation must end at a frame.');
  const interactions = source.node.interactions ||= [];
  const existing = interactions.find(item => item.trigger === trigger && item.destinationId === destination.node.id && item.destinationPageId === destination.page.id);
  if (existing) {
    existing.transition = transition;
    existing.duration = Math.max(0, Math.min(2000, Number(duration) || 0));
    return existing;
  }
  const interaction = {
    id: `interaction-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`,
    trigger,
    action: 'navigate',
    destinationId: destination.node.id,
    destinationPageId: destination.page.id,
    transition,
    duration: Math.max(0, Math.min(2000, Number(duration) || 0))
  };
  interactions.push(interaction);
  return interaction;
}

export function removePrototypeInteraction(document, sourceId, interactionId, pageId = document.activePageId) {
  const source = findNode(document, sourceId, pageId)?.node;
  if (!source?.interactions) return false;
  const index = source.interactions.findIndex(item => item.id === interactionId);
  if (index < 0) return false;
  source.interactions.splice(index, 1);
  return true;
}

export function findFrameAtPoint(page, point) {
  const matches = [];
  const visit = (nodes, parentX = 0, parentY = 0, depth = 0) => {
    for (const node of nodes) {
      if (!node.visible) continue;
      const x = parentX + node.x;
      const y = parentY + node.y;
      const inside = point.x >= x && point.y >= y && point.x <= x + node.width && point.y <= y + node.height;
      if (inside && node.type === 'frame') matches.push({ node, depth });
      if (inside || !node.clip) visit(node.children || [], x, y, depth + 1);
    }
  };
  visit(page?.children || []);
  return matches.sort((a, b) => b.depth - a.depth || (a.node.width * a.node.height) - (b.node.width * b.node.height))[0]?.node ?? null;
}

export function findClickableInteraction(document, pageId, hitId, trigger = 'on-click') {
  const hit = findNode(document, hitId, pageId);
  if (!hit) return null;
  const chain = [hit.node, ...[...hit.parents].reverse()];
  for (const node of chain) {
    const interaction = node.interactions?.find(item => item.trigger === trigger && item.action === 'navigate');
    if (interaction) return { source: node, interaction };
  }
  return null;
}
