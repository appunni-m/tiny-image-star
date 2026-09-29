import { findNode, findNodeAcrossPages, getActivePage, walkNodes } from './model.js';

const triggers = new Set(['on-click', 'while-hovering']);
const transitions = new Set(['instant', 'dissolve', 'move-left', 'move-right', 'smart-animate']);
const actions = new Set(['navigate', 'open-overlay', 'close-overlay']);
const easings = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out']);
const overlayPositions = new Set([
  'center', 'top-left', 'top-center', 'top-right', 'left-center', 'right-center',
  'bottom-left', 'bottom-center', 'bottom-right'
]);

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

export function easePrototypeProgress(progress, easing = 'ease-in-out') {
  const value = Math.max(0, Math.min(1, Number.isFinite(Number(progress)) ? Number(progress) : 0));
  if (easing === 'linear') return value;
  if (easing === 'ease-in') return value * value;
  if (easing === 'ease-out') return 1 - (1 - value) ** 2;
  return value * value * (3 - 2 * value);
}

export function prototypeEasingTimingFunction(easing = 'ease-in-out') {
  return easings.has(easing) ? easing : 'ease-in-out';
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
  action = 'navigate',
  trigger = 'on-click',
  transition = 'instant',
  easing = 'ease-in-out',
  duration = 300,
  overlayPosition = 'center',
  overlayOutsideClick = true,
  overlayBackground = true,
  overlayBackgroundColor = '#000000',
  overlayBackgroundOpacity = 0.32
} = {}) {
  if (!actions.has(action)) throw new TypeError('Unsupported prototype action.');
  if (!triggers.has(trigger)) throw new TypeError('Unsupported prototype trigger.');
  if (!transitions.has(transition)) throw new TypeError('Unsupported prototype transition.');
  if (!easings.has(easing)) throw new TypeError('Unsupported prototype easing.');
  if (transition === 'smart-animate' && action !== 'navigate') throw new TypeError('Smart animate can only be used for frame navigation.');
  const source = findNode(document, sourceId, sourcePageId);
  const needsDestination = action !== 'close-overlay';
  const candidateDestination = needsDestination ? findNodeAcrossPages(document, destinationId) : null;
  const destination = candidateDestination && (!destinationPageId || candidateDestination.page.id === destinationPageId) ? candidateDestination : null;
  if (!source) throw new Error('The interaction source layer no longer exists.');
  if (needsDestination && (!destination || destination.node.type !== 'frame')) throw new Error('Prototype navigation and overlay actions must end at a frame.');
  if (action === 'close-overlay' && destinationId != null) throw new TypeError('Close overlay actions cannot have a destination.');
  if (action === 'open-overlay' && !overlayPositions.has(overlayPosition)) throw new TypeError('Unsupported prototype overlay position.');
  const interactions = source.node.interactions ||= [];
  const existing = interactions.find(item => item.action === action && item.trigger === trigger && item.destinationId === (destination?.node?.id ?? null) && item.destinationPageId === (destination?.page?.id ?? null));
  if (existing) {
    existing.transition = transition;
    existing.easing = easing;
    existing.duration = Math.max(0, Math.min(2000, Number(duration) || 0));
    if (action === 'open-overlay') {
      existing.overlayPosition = overlayPosition;
      existing.overlayOutsideClick = Boolean(overlayOutsideClick);
      existing.overlayBackground = Boolean(overlayBackground);
      existing.overlayBackgroundColor = /^#[0-9a-f]{6}$/i.test(overlayBackgroundColor) ? overlayBackgroundColor : '#000000';
      existing.overlayBackgroundOpacity = Math.max(0, Math.min(1, Number(overlayBackgroundOpacity) || 0));
    }
    return existing;
  }
  const interaction = {
    id: `interaction-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`,
    trigger,
    action,
    destinationId: destination?.node?.id ?? null,
    destinationPageId: destination?.page?.id ?? null,
    transition,
    easing,
    duration: Math.max(0, Math.min(2000, Number(duration) || 0))
  };
  if (action === 'open-overlay') Object.assign(interaction, {
    overlayPosition,
    overlayOutsideClick: Boolean(overlayOutsideClick),
    overlayBackground: Boolean(overlayBackground),
    overlayBackgroundColor: /^#[0-9a-f]{6}$/i.test(overlayBackgroundColor) ? overlayBackgroundColor : '#000000',
    overlayBackgroundOpacity: Math.max(0, Math.min(1, Number(overlayBackgroundOpacity) || 0))
  });
  interactions.push(interaction);
  return interaction;
}

export function createPrototypeSession(start) {
  if (!start?.page?.id || start.frame?.type !== 'frame') throw new TypeError('Choose a frame to start this prototype.');
  return { pageId: start.page.id, frameId: start.frame.id, stack: [], overlays: [], lastHoverInteractionId: null };
}

export function applyPrototypeInteraction(document, session, interaction) {
  if (!session || !interaction || !actions.has(interaction.action)) return false;
  if (interaction.action === 'close-overlay') {
    if (!session.overlays.length) return false;
    session.overlays.pop();
    session.lastHoverInteractionId = null;
    return 'overlay-closed';
  }

  const candidateDestination = findNodeAcrossPages(document, interaction.destinationId);
  const destination = candidateDestination && (!interaction.destinationPageId || candidateDestination.page.id === interaction.destinationPageId) ? candidateDestination : null;
  if (!destination || destination.node.type !== 'frame') return false;

  if (interaction.action === 'open-overlay') {
    const position = overlayPositions.has(interaction.overlayPosition) ? interaction.overlayPosition : 'center';
    session.overlays.push({
      pageId: destination.page.id,
      frameId: destination.node.id,
      position,
      outsideClick: interaction.overlayOutsideClick !== false,
      background: interaction.overlayBackground !== false,
      backgroundColor: /^#[0-9a-f]{6}$/i.test(interaction.overlayBackgroundColor || '') ? interaction.overlayBackgroundColor : '#000000',
      backgroundOpacity: Math.max(0, Math.min(1, Number(interaction.overlayBackgroundOpacity ?? 0.32)))
    });
    session.lastHoverInteractionId = interaction.trigger === 'while-hovering' ? interaction.id : null;
    return 'overlay-opened';
  }

  session.stack.push({ pageId: session.pageId, frameId: session.frameId, overlays: structuredClone(session.overlays) });
  session.pageId = destination.page.id;
  session.frameId = destination.node.id;
  session.overlays = [];
  session.lastHoverInteractionId = interaction.trigger === 'while-hovering' ? interaction.id : null;
  return 'navigated';
}

export function backPrototypeSession(session) {
  if (!session) return false;
  if (session.overlays.length) {
    session.overlays.pop();
    session.lastHoverInteractionId = null;
    return 'overlay-closed';
  }
  if (!session.stack.length) return false;
  const previous = session.stack.pop();
  session.pageId = previous.pageId;
  session.frameId = previous.frameId;
  session.overlays = structuredClone(previous.overlays || []);
  session.lastHoverInteractionId = null;
  return 'navigated-back';
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
  const hit = findNode(document, hitId, pageId) || findNodeAcrossPages(document, hitId);
  if (!hit) return null;
  const chain = [hit.node, ...[...hit.parents].reverse()];
  for (const node of chain) {
    const interaction = node.interactions?.find(item => item.trigger === trigger && actions.has(item.action));
    if (interaction) return { source: node, interaction };
  }
  return null;
}
