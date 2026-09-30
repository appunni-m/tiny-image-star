import { findNode, findNodeAcrossPages, getActivePage, getNodeGeometry, getNodePropertyValue, isVariableValue, resolveVariableValueWithModeOverrides, switchComponentInstanceVariant, walkNodes } from './model.js';

const triggers = new Set(['on-click', 'on-press', 'on-drag', 'while-hovering', 'after-delay']);
const transitions = new Set(['instant', 'dissolve', 'move-left', 'move-right', 'smart-animate']);
const actions = new Set(['navigate', 'open-overlay', 'swap-overlay', 'close-overlay', 'back', 'open-link', 'set-variable-mode', 'change-variant']);
const delayedActions = new Set(['navigate', 'open-overlay', 'swap-overlay']);
const minPrototypeDelay = 100;
const maxPrototypeDelay = 10_000;
const easings = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out']);
const overlayPositions = new Set([
  'center', 'top-left', 'top-center', 'top-right', 'left-center', 'right-center',
  'bottom-left', 'bottom-center', 'bottom-right'
]);
const conditionOperators = new Set(['equals', 'not-equals']);

function normalizePrototypeCondition(document, condition) {
  if (condition == null) return null;
  const fields = ['variableId', 'type', 'operator', 'value'];
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)
    || Object.keys(condition).some(key => !fields.includes(key))) {
    throw new TypeError('Invalid prototype interaction condition.');
  }
  const variable = document.variables?.find(item => item.id === condition.variableId);
  if (typeof condition.variableId !== 'string' || !condition.variableId
    || !variable || condition.type !== variable.type
    || !conditionOperators.has(condition.operator)
    || !isVariableValue(condition.type, condition.value)) {
    throw new TypeError('Invalid prototype interaction condition.');
  }
  return {
    variableId: condition.variableId,
    type: condition.type,
    operator: condition.operator,
    value: condition.value
  };
}

function conditionIdentity(condition) {
  if (!condition) return null;
  const value = condition.type === 'color' && typeof condition.value === 'string'
    ? condition.value.toLowerCase()
    : condition.value;
  return JSON.stringify([condition.variableId, condition.type, condition.operator, value]);
}

function prototypeConditionMatches(document, condition, session, node) {
  if (condition == null) return true;
  const variable = document.variables?.find(item => item.id === condition.variableId);
  if (!variable || variable.type !== condition.type || !conditionOperators.has(condition.operator)
    || !isVariableValue(condition.type, condition.value)) return false;
  const value = resolveVariableValueWithModeOverrides(document, variable.id, session?.variableModes, node);
  if (!isVariableValue(variable.type, value)) return false;
  const matches = variable.type === 'color'
    ? value.toLowerCase() === condition.value.toLowerCase()
    : value === condition.value;
  return condition.operator === 'equals' ? matches : !matches;
}

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

export function normalizePrototypeLinkUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.hostname ? url.href : null;
    }
    if (url.protocol === 'mailto:' && !url.host && !url.username && !url.password && url.pathname.trim()) return url.href;
  } catch {
    // Invalid URLs are never stored as prototype actions.
  }
  return null;
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
  overlayBackgroundOpacity = 0.32,
  delay = 1000,
  url,
  collectionId,
  modeId,
  targetVariantId,
  condition = null
} = {}) {
  if (!actions.has(action)) throw new TypeError('Unsupported prototype action.');
  if (!triggers.has(trigger)) throw new TypeError('Unsupported prototype trigger.');
  if (trigger === 'after-delay' && (!delayedActions.has(action)
    || !Number.isInteger(delay) || delay < minPrototypeDelay || delay > maxPrototypeDelay)) {
    throw new TypeError('After-delay interactions need a destination action and a whole-number delay from 100 to 10,000 ms.');
  }
  if (!transitions.has(transition)) throw new TypeError('Unsupported prototype transition.');
  if (!easings.has(easing)) throw new TypeError('Unsupported prototype easing.');
  if (transition === 'smart-animate' && action !== 'navigate') throw new TypeError('Smart animate can only be used for frame navigation.');
  const source = findNode(document, sourceId, sourcePageId);
  const needsDestination = action === 'navigate' || action === 'open-overlay' || action === 'swap-overlay';
  const candidateDestination = needsDestination ? findNodeAcrossPages(document, destinationId) : null;
  const destination = candidateDestination && (!destinationPageId || candidateDestination.page.id === destinationPageId) ? candidateDestination : null;
  const linkUrl = action === 'open-link' ? normalizePrototypeLinkUrl(url) : null;
  const normalizedCondition = normalizePrototypeCondition(document, condition);
  const collection = action === 'set-variable-mode'
    ? document.variableCollections?.find(item => item.id === collectionId)
    : null;
  const sourceComponent = action === 'change-variant' && source?.node.isInstance
    ? document.components?.find(item => item.id === source.node.componentId)
    : null;
  const targetVariant = action === 'change-variant'
    ? document.components?.find(item => item.id === targetVariantId)
    : null;
  if (!source) throw new Error('The interaction source layer no longer exists.');
  if (needsDestination && (!destination || destination.node.type !== 'frame')) throw new Error('Prototype navigation and overlay actions must end at a frame.');
  if (!needsDestination && destinationId != null) throw new TypeError('Back, close overlay, and open link actions cannot have a frame destination.');
  if (action === 'open-link' && !linkUrl) throw new TypeError('Open link actions require a safe http(s) or mailto URL.');
  if (action === 'set-variable-mode' && (!collection || (modeId != null && !collection.modes.some(mode => mode.id === modeId)))) {
    throw new TypeError('Choose a variable collection and one of its modes.');
  }
  if (action === 'change-variant' && (!sourceComponent?.componentSetId || targetVariant?.componentSetId !== sourceComponent.componentSetId || targetVariant.id === sourceComponent.id)) {
    throw new TypeError('Choose a different variant from this component instance’s set.');
  }
  if (action === 'open-overlay' && !overlayPositions.has(overlayPosition)) throw new TypeError('Unsupported prototype overlay position.');
  const interactions = source.node.interactions ||= [];
  const existing = interactions.find(item => item.action === action && item.trigger === trigger && item.destinationId === (destination?.node?.id ?? null) && item.destinationPageId === (destination?.page?.id ?? null)
    && conditionIdentity(item.condition) === conditionIdentity(normalizedCondition)
    && (action !== 'open-link' || normalizePrototypeLinkUrl(item.url) === linkUrl)
    && (action !== 'set-variable-mode' || item.collectionId === collectionId)
    && (action !== 'change-variant' || item.targetVariantId === targetVariantId));
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
    if (action === 'set-variable-mode') existing.modeId = modeId ?? null;
    if (action === 'change-variant') existing.targetVariantId = targetVariantId;
    if (normalizedCondition) existing.condition = normalizedCondition;
    else delete existing.condition;
    if (trigger === 'after-delay') existing.delay = delay;
    else delete existing.delay;
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
  if (action === 'open-link') interaction.url = linkUrl;
  if (action === 'set-variable-mode') Object.assign(interaction, { collectionId, modeId: modeId ?? null });
  if (action === 'change-variant') Object.assign(interaction, { instanceId: source.node.id, targetVariantId });
  if (normalizedCondition) interaction.condition = normalizedCondition;
  if (trigger === 'after-delay') interaction.delay = delay;
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
  return { pageId: start.page.id, frameId: start.frame.id, stack: [], overlays: [], variableModes: {}, variantSelections: {}, lastHoverInteractionId: null };
}

export function findPrototypeDelayInteraction(document, pageId, frameId, session = null) {
  const frame = findNode(document, frameId, pageId)?.node;
  if (!frame || frame.type !== 'frame') return null;
  let match = null;
  walkNodes([frame], ({ node }) => {
    if (match) return;
    const interaction = node.interactions?.find(item => item.trigger === 'after-delay'
      && delayedActions.has(item.action)
      && Number.isInteger(item.delay) && item.delay >= minPrototypeDelay && item.delay <= maxPrototypeDelay
      && prototypeConditionMatches(document, item.condition, session, node));
    if (interaction) match = { source: node, interaction };
  });
  return match;
}

export function schedulePrototypeDelay(interaction, callback, timers = globalThis) {
  if (interaction?.trigger !== 'after-delay' || !delayedActions.has(interaction.action)
    || !Number.isInteger(interaction.delay) || interaction.delay < minPrototypeDelay || interaction.delay > maxPrototypeDelay
    || typeof callback !== 'function' || typeof timers?.setTimeout !== 'function' || typeof timers?.clearTimeout !== 'function') {
    return () => false;
  }
  let active = true;
  const timeout = timers.setTimeout(() => {
    if (!active) return;
    active = false;
    callback(interaction);
  }, interaction.delay);
  return () => {
    if (!active) return false;
    active = false;
    timers.clearTimeout(timeout);
    return true;
  };
}

export function clearPrototypeHoverInteraction(document, session) {
  if (!session) return false;
  const original = session.hoverVariantOriginal;
  let restoredVariant = false;
  if (original && original.interactionId === session.lastHoverInteractionId) {
    const source = findNodeAcrossPages(document, original.instanceId);
    const component = document.components?.find(item => item.id === original.componentId);
    if (source?.node.isInstance && component) {
      try {
        switchComponentInstanceVariant(document, source.node.id, component.id, source.page.id, { preservePrototypeInteractions: true });
        session.variantSelections ||= {};
        session.variantSelections[source.node.id] = component.id;
        restoredVariant = true;
      } catch { /* A stale hover target should not interrupt the active prototype. */ }
    }
  }
  session.hoverVariantOriginal = null;
  session.lastHoverInteractionId = null;
  return restoredVariant;
}

function rememberPrototypeHoverInteraction(session, interaction) {
  if (interaction.trigger === 'while-hovering') session.lastHoverInteractionId = interaction.id;
  // Pointer actions such as click, navigation, and overlay dismissal can happen
  // while the pointer is still over a hover hotspot. Keep its original variant
  // until the presentation pointer handler observes that the hotspot was left.
}

export function applyPrototypeInteraction(document, session, interaction) {
  if (!session || !interaction || !actions.has(interaction.action)) return false;
  if (interaction.action === 'back') return backPrototypeSession(session);
  if (interaction.action === 'open-link') return normalizePrototypeLinkUrl(interaction.url) ? 'link-opened' : false;
  if (interaction.action === 'set-variable-mode') {
    const collection = document.variableCollections?.find(item => item.id === interaction.collectionId);
    if (!collection || (interaction.modeId != null && !collection.modes.some(mode => mode.id === interaction.modeId))) return false;
    session.variableModes ||= {};
    session.variableModes[collection.id] = interaction.modeId ?? collection.defaultModeId;
    rememberPrototypeHoverInteraction(session, interaction);
    return 'variables-updated';
  }
  if (interaction.action === 'change-variant') {
    const source = findNodeAcrossPages(document, interaction.instanceId);
    const component = source?.node.isInstance && document.components?.find(item => item.id === source.node.componentId);
    const target = document.components?.find(item => item.id === interaction.targetVariantId);
    if (!component?.componentSetId || target?.componentSetId !== component.componentSetId) return false;
    if (target.id === component.id) {
      if (interaction.trigger === 'while-hovering') {
        const alreadyActive = session.lastHoverInteractionId === interaction.id
          && session.hoverVariantOriginal?.interactionId === interaction.id
          && session.hoverVariantOriginal?.instanceId === source.node.id;
        if (!alreadyActive) {
          session.hoverVariantOriginal = { interactionId: interaction.id, instanceId: source.node.id, pageId: source.page.id, componentId: component.id };
        }
      } else session.hoverVariantOriginal = null;
      session.variantSelections ||= {};
      session.variantSelections[source.node.id] = target.id;
      rememberPrototypeHoverInteraction(session, interaction);
      return 'variant-changed';
    }
    // The presentation caller supplies its private runtime document. The authored
    // design remains untouched while the instance subtree is replaced in-place.
    if (interaction.trigger === 'while-hovering') {
      session.hoverVariantOriginal = { interactionId: interaction.id, instanceId: source.node.id, pageId: source.page.id, componentId: component.id };
    } else session.hoverVariantOriginal = null;
    try {
      switchComponentInstanceVariant(document, source.node.id, target.id, source.page.id, { preservePrototypeInteractions: true });
    } catch { return false; }
    session.variantSelections ||= {};
    session.variantSelections[source.node.id] = target.id;
    rememberPrototypeHoverInteraction(session, interaction);
    return 'variant-changed';
  }
  if (interaction.action === 'close-overlay') {
    if (!session.overlays.length) return false;
    session.overlays.pop();
    rememberPrototypeHoverInteraction(session, interaction);
    return 'overlay-closed';
  }

  const candidateDestination = findNodeAcrossPages(document, interaction.destinationId);
  const destination = candidateDestination && (!interaction.destinationPageId || candidateDestination.page.id === interaction.destinationPageId) ? candidateDestination : null;
  if (!destination || destination.node.type !== 'frame') return false;

  if (interaction.action === 'swap-overlay') {
    if (session.overlays.length) {
      const current = session.overlays[session.overlays.length - 1];
      session.overlays[session.overlays.length - 1] = { ...current, pageId: destination.page.id, frameId: destination.node.id };
      rememberPrototypeHoverInteraction(session, interaction);
      return 'overlay-swapped';
    }
    session.stack.push({ pageId: session.pageId, frameId: session.frameId, overlays: structuredClone(session.overlays) });
    session.pageId = destination.page.id;
    session.frameId = destination.node.id;
    rememberPrototypeHoverInteraction(session, interaction);
    return 'navigated';
  }

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
    rememberPrototypeHoverInteraction(session, interaction);
    return 'overlay-opened';
  }

  session.stack.push({ pageId: session.pageId, frameId: session.frameId, overlays: structuredClone(session.overlays) });
  session.pageId = destination.page.id;
  session.frameId = destination.node.id;
  session.overlays = [];
  rememberPrototypeHoverInteraction(session, interaction);
  return 'navigated';
}

export function backPrototypeSession(session) {
  if (!session) return false;
  if (session.overlays.length) {
    session.overlays.pop();
    return 'overlay-closed';
  }
  if (!session.stack.length) return false;
  const previous = session.stack.pop();
  session.pageId = previous.pageId;
  session.frameId = previous.frameId;
  session.overlays = structuredClone(previous.overlays || []);
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

export function findFrameAtPoint(page, point, document = null) {
  const matches = [];
  const visit = (nodes, parentX = 0, parentY = 0, depth = 0) => {
    for (const node of nodes) {
      if (document ? !getNodePropertyValue(document, node, 'visible') : !node.visible) continue;
      const geometry = document ? getNodeGeometry(document, node) : node;
      const x = parentX + geometry.x;
      const y = parentY + geometry.y;
      const inside = point.x >= x && point.y >= y && point.x <= x + geometry.width && point.y <= y + geometry.height;
      if (inside && node.type === 'frame') matches.push({ node, depth, area: geometry.width * geometry.height });
      if (inside || !node.clip) visit(node.children || [], x, y, depth + 1);
    }
  };
  visit(page?.children || []);
  return matches.sort((a, b) => b.depth - a.depth || a.area - b.area)[0]?.node ?? null;
}

export function findClickableInteraction(document, pageId, hitId, trigger = 'on-click', session = null) {
  const hit = findNode(document, hitId, pageId) || findNodeAcrossPages(document, hitId);
  if (!hit) return null;
  const chain = [hit.node, ...[...hit.parents].reverse()];
  for (const node of chain) {
    const candidates = node.interactions?.filter(item => item.trigger === trigger && actions.has(item.action)) || [];
    // Treat unconditional interactions as the fallback route so adding one
    // before a conditional route does not make the condition unreachable.
    const interaction = candidates.find(item => item.condition != null
      && prototypeConditionMatches(document, item.condition, session, hit.node))
      || candidates.find(item => item.condition == null);
    if (interaction) return { source: node, interaction };
  }
  return null;
}
