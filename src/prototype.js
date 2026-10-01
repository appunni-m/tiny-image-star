import { createId, findNode, findNodeAcrossPages, getActivePage, getNodeGeometry, getNodePropertyValue, isVariableValue, resolveVariableValueWithModeOverrides, switchComponentInstanceVariant, walkNodes } from './model.js';
import { pageToNodeLocal } from './transform-geometry.js';

const triggers = new Set(['on-click', 'on-press', 'on-drag', 'while-hovering', 'after-delay']);
const transitions = new Set(['instant', 'dissolve', 'move-left', 'move-right', 'smart-animate', 'scroll']);
const actions = new Set(['navigate', 'open-overlay', 'swap-overlay', 'close-overlay', 'back', 'open-link', 'set-variable-mode', 'change-variant', 'scroll-to']);
const delayedActions = new Set(['navigate', 'open-overlay', 'swap-overlay']);
const minPrototypeDelay = 100;
const maxPrototypeDelay = 10_000;
const easings = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out']);
const overlayPositions = new Set([
  'center', 'top-left', 'top-center', 'top-right', 'left-center', 'right-center',
  'bottom-left', 'bottom-center', 'bottom-right'
]);
const conditionOperators = new Set(['equals', 'not-equals', 'greater-than', 'greater-than-or-equal', 'less-than', 'less-than-or-equal']);
const numericConditionOperators = new Set(['greater-than', 'greater-than-or-equal', 'less-than', 'less-than-or-equal']);

function isPrototypeConditionOperator(operator, type) {
  return conditionOperators.has(operator)
    && (!numericConditionOperators.has(operator) || type === 'number');
}

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
    || !isPrototypeConditionOperator(condition.operator, condition.type)
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
  if (!variable || variable.type !== condition.type || !isPrototypeConditionOperator(condition.operator, condition.type)
    || !isVariableValue(condition.type, condition.value)) return false;
  const value = resolveVariableValueWithModeOverrides(document, variable.id, session?.variableModes, node);
  if (!isVariableValue(variable.type, value)) return false;
  if (numericConditionOperators.has(condition.operator)) {
    if (variable.type !== 'number') return false;
    if (condition.operator === 'greater-than') return value > condition.value;
    if (condition.operator === 'greater-than-or-equal') return value >= condition.value;
    if (condition.operator === 'less-than') return value < condition.value;
    return value <= condition.value;
  }
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
  document.prototypeFlows ??= [];
  let flow = document.prototypeFlows.find(item => item.id === document.prototypeStartFlowId)
    ?? document.prototypeFlows[0];
  if (!flow) {
    flow = { id: createId('flow'), name: nextPrototypeFlowName(document), pageId, nodeId: frameId };
    document.prototypeFlows.push(flow);
  } else {
    flow.pageId = pageId;
    flow.nodeId = frameId;
  }
  document.prototypeStartFlowId = flow.id;
  return document.prototypeStartPoint;
}

function normalizeFlowName(name) {
  if (typeof name !== 'string') throw new TypeError('A prototype flow needs a name.');
  const normalized = name.trim();
  if (!normalized || normalized.length > 120 || /[\x00-\x1f\x7f]/.test(normalized)) {
    throw new TypeError('Prototype flow names must contain 1–120 printable characters.');
  }
  return normalized;
}

function assertUniqueFlowName(document, name, exceptId = null) {
  const key = name.toLocaleLowerCase();
  if ((document.prototypeFlows || []).some(flow => flow.id !== exceptId && flow.name.trim().toLocaleLowerCase() === key)) {
    throw new Error('A prototype flow with that name already exists.');
  }
}

function nextPrototypeFlowName(document) {
  let index = 1;
  while ((document.prototypeFlows || []).some(flow => flow.name.trim().toLocaleLowerCase() === `flow ${index}`)) index += 1;
  return `Flow ${index}`;
}

function requirePrototypeFrame(document, frameId, pageId) {
  const entry = findNode(document, frameId, pageId);
  if (!entry || entry.node.type !== 'frame') throw new Error('Choose a frame to use as the prototype starting point.');
  return entry;
}

export function listPrototypeFlows(document) {
  return (document.prototypeFlows || []).map(flow => ({ ...flow }));
}

export function createPrototypeFlow(document, frameId, { name = null, pageId = document.activePageId } = {}) {
  requirePrototypeFrame(document, frameId, pageId);
  document.prototypeFlows ??= [];
  const flowName = normalizeFlowName(name ?? nextPrototypeFlowName(document));
  assertUniqueFlowName(document, flowName);
  const flow = { id: createId('flow'), name: flowName, pageId, nodeId: frameId };
  document.prototypeFlows.push(flow);
  if (!document.prototypeStartFlowId) {
    document.prototypeStartFlowId = flow.id;
    document.prototypeStartPoint = { pageId, nodeId: frameId };
  }
  return flow;
}

export function renamePrototypeFlow(document, flowId, name) {
  const flow = document.prototypeFlows?.find(item => item.id === flowId);
  if (!flow) throw new Error('Prototype flow not found.');
  const flowName = normalizeFlowName(name);
  assertUniqueFlowName(document, flowName, flowId);
  flow.name = flowName;
  return flow;
}

export function setPrototypeFlowStartPoint(document, flowId, frameId, pageId = document.activePageId) {
  const flow = document.prototypeFlows?.find(item => item.id === flowId);
  if (!flow) throw new Error('Prototype flow not found.');
  requirePrototypeFrame(document, frameId, pageId);
  flow.pageId = pageId;
  flow.nodeId = frameId;
  if (document.prototypeStartFlowId === flow.id) document.prototypeStartPoint = { pageId, nodeId: frameId };
  return flow;
}

export function setPrototypeStartFlow(document, flowId) {
  const flow = document.prototypeFlows?.find(item => item.id === flowId);
  if (!flow) throw new Error('Prototype flow not found.');
  document.prototypeStartFlowId = flow.id;
  document.prototypeStartPoint = { pageId: flow.pageId, nodeId: flow.nodeId };
  return flow;
}

export function deletePrototypeFlow(document, flowId) {
  const flows = document.prototypeFlows || [];
  const index = flows.findIndex(item => item.id === flowId);
  if (index < 0) return false;
  flows.splice(index, 1);
  if (document.prototypeStartFlowId === flowId) {
    const replacement = flows[0] || null;
    document.prototypeStartFlowId = replacement?.id ?? null;
    document.prototypeStartPoint = replacement ? { pageId: replacement.pageId, nodeId: replacement.nodeId } : null;
  }
  return true;
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

export function getPrototypeStartFrame(document, selectedId = null, flowId = document.prototypeStartFlowId) {
  const flow = flowId && document.prototypeFlows?.find(item => item.id === flowId);
  const start = flow ? { pageId: flow.pageId, nodeId: flow.nodeId } : document.prototypeStartPoint;
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

/** Resolve the session-only presentation start without changing the saved flow. */
export function resolvePrototypePresentationStart(document, selectedId = null) {
  if (selectedId) {
    const selected = findNodeAcrossPages(document, selectedId);
    if (selected) {
      const frame = selected.node.type === 'frame'
        ? selected.node
        : [...selected.parents].reverse().find(parent => parent.type === 'frame');
      if (frame) {
        const flow = document.prototypeFlows?.find(item => item.pageId === selected.page.id && item.nodeId === frame.id);
        return { start: { page: selected.page, frame }, flowId: flow?.id || null };
      }
    }
  }
  const flows = listPrototypeFlows(document);
  const defaultFlow = flows.find(flow => flow.id === document.prototypeStartFlowId) || flows[0] || null;
  const flowId = defaultFlow?.id || null;
  const start = flowId ? getPrototypeStartFrame(document, null, flowId) : getPrototypeStartFrame(document, null, null);
  return { start, flowId };
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
  scrollTargetId,
  scrollAlignment = 'nearest',
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
  if (transition === 'scroll' && action !== 'scroll-to') throw new TypeError('Scroll transitions can only be used with scroll-to actions.');
  if (action === 'scroll-to' && transition !== 'scroll' && transition !== 'instant') throw new TypeError('Scroll-to actions support only instant or scroll transitions.');
  if (!['nearest', 'start', 'center', 'end'].includes(scrollAlignment)) throw new TypeError('Unsupported prototype scroll alignment.');
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
  const scrollTarget = action === 'scroll-to' ? findNode(document, scrollTargetId, sourcePageId) : null;
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
  if (action === 'scroll-to') {
    if (!scrollTarget || typeof scrollTargetId !== 'string' || !scrollTargetId) throw new TypeError('Choose a scroll target on this page.');
    const sourceFrames = [...source.parents, source.node].filter(node => node.type === 'frame');
    const sourcePresentationFrame = sourceFrames.at(-1);
    const targetScreenIndex = sourcePresentationFrame
      ? scrollTarget.parents.findIndex(node => node.id === sourcePresentationFrame.id)
      : -1;
    const hasScrollableAncestor = targetScreenIndex >= 0 && scrollTarget.parents.slice(targetScreenIndex)
      .some(node => node.type === 'frame' && ['vertical', 'horizontal', 'both'].includes(node.overflowBehavior));
    if (!sourcePresentationFrame || !hasScrollableAncestor) {
      throw new TypeError('Choose a target inside a scrollable frame on the same prototype screen.');
    }
  } else if (scrollTargetId != null) throw new TypeError('Only scroll-to interactions can have a scroll target.');
  if (action === 'open-overlay' && !overlayPositions.has(overlayPosition)) throw new TypeError('Unsupported prototype overlay position.');
  const interactions = source.node.interactions ||= [];
  const existing = interactions.find(item => item.action === action && item.trigger === trigger && item.destinationId === (destination?.node?.id ?? null) && item.destinationPageId === (destination?.page?.id ?? null)
    && conditionIdentity(item.condition) === conditionIdentity(normalizedCondition)
    && (action !== 'open-link' || normalizePrototypeLinkUrl(item.url) === linkUrl)
    && (action !== 'set-variable-mode' || item.collectionId === collectionId)
    && (action !== 'change-variant' || item.targetVariantId === targetVariantId)
    && (action !== 'scroll-to' || (item.scrollTargetId === scrollTargetId && item.scrollAlignment === scrollAlignment)));
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
    if (action === 'scroll-to') {
      existing.scrollTargetId = scrollTargetId;
      existing.scrollAlignment = scrollAlignment;
    }
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
  if (action === 'scroll-to') Object.assign(interaction, { scrollTargetId, scrollAlignment });
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

export function createPrototypeSession(start, flowId = null) {
  if (!start?.page?.id || start.frame?.type !== 'frame') throw new TypeError('Choose a frame to start this prototype.');
  return {
    pageId: start.page.id,
    frameId: start.frame.id,
    startPageId: start.page.id,
    startFrameId: start.frame.id,
    flowId: typeof flowId === 'string' ? flowId : null,
    stack: [],
    overlays: [],
    variableModes: {},
    variantSelections: {},
    lastHoverInteractionId: null
  };
}

/** Return a fresh presentation session at its original or selected named-flow start. */
export function restartPrototypeSession(document, session, flowId = session?.flowId ?? null) {
  let start = null;
  if (flowId != null) {
    const flow = document.prototypeFlows?.find(item => item.id === flowId);
    const entry = flow && findNode(document, flow.nodeId, flow.pageId);
    const page = flow && document.pages.find(item => item.id === flow.pageId);
    if (!entry || entry.node.type !== 'frame' || !page) return null;
    start = { page, frame: entry.node };
  } else if (session?.startPageId && session?.startFrameId) {
    const entry = findNode(document, session.startFrameId, session.startPageId);
    const page = document.pages.find(item => item.id === session.startPageId);
    if (entry?.node.type === 'frame' && page) start = { page, frame: entry.node };
  } else {
    // Older callers can restart a session created before start-point metadata
    // was added. Keep their historical document-default behavior.
    start = getPrototypeStartFrame(document);
  }
  return start ? createPrototypeSession(start, flowId) : null;
}

function isPrototypeNodeVisible(document, node, session) {
  const variableId = node.variableBindings?.visible;
  const variable = variableId && document.variables?.find(item => item.id === variableId);
  if (variable?.type === 'boolean') {
    const value = resolveVariableValueWithModeOverrides(document, variableId, session?.variableModes, node);
    if (typeof value === 'boolean') return value;
  }
  return getNodePropertyValue(document, node, 'visible') !== false;
}

export function findPrototypeDelayInteraction(document, pageId, frameId, session = null) {
  const frame = findNode(document, frameId, pageId)?.node;
  if (!frame || frame.type !== 'frame') return null;
  let match = null;
  const visitVisibleNodes = nodes => {
    for (const node of nodes) {
      if (!isPrototypeNodeVisible(document, node, session)) continue;
      const interaction = node.interactions?.find(item => item.trigger === 'after-delay'
        && delayedActions.has(item.action)
        && Number.isInteger(item.delay) && item.delay >= minPrototypeDelay && item.delay <= maxPrototypeDelay
        && prototypeConditionMatches(document, item.condition, session, node));
      if (interaction) {
        match = { source: node, interaction };
        return true;
      }
      if (visitVisibleNodes(node.children || [])) return true;
    }
    return false;
  };
  visitVisibleNodes([frame]);
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
  if (interaction.action === 'scroll-to') {
    const pageId = session.overlays?.at(-1)?.pageId || session.pageId;
    const target = findNode(document, interaction.scrollTargetId, pageId);
    const frameId = session.overlays?.at(-1)?.frameId || session.frameId;
    const screenIndex = target?.parents.findIndex(node => node.id === frameId) ?? -1;
    if (!target || screenIndex < 0
      || !target.parents.slice(screenIndex).some(node => node.type === 'frame' && ['vertical', 'horizontal', 'both'].includes(node.overflowBehavior))) return false;
    rememberPrototypeHoverInteraction(session, interaction);
    return 'scroll-to';
  }
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

/** Replace one interaction atomically while keeping its stable identifier and list position. */
export function updatePrototypeInteraction(document, sourceId, interactionId, destinationId, options = {}, pageId = document.activePageId) {
  const source = findNode(document, sourceId, pageId)?.node;
  if (!source?.interactions) throw new Error('The interaction source no longer exists.');
  const index = source.interactions.findIndex(item => item.id === interactionId);
  if (index < 0) throw new Error('This prototype interaction no longer exists.');

  // Validate and normalize against a private copy. No partial update should be
  // observable if an action, condition, destination, or component variant is
  // no longer valid while the editor is open.
  const candidate = structuredClone(document);
  const candidateSource = findNode(candidate, sourceId, pageId)?.node;
  candidateSource.interactions.splice(index, 1);
  const remainingCount = candidateSource.interactions.length;
  const replacement = addPrototypeInteraction(candidate, sourceId, destinationId, {
    ...options,
    sourcePageId: pageId
  });
  if (candidateSource.interactions.length === remainingCount) {
    throw new Error('An interaction with these settings already exists on this layer.');
  }

  replacement.id = source.interactions[index].id;
  source.interactions[index] = structuredClone(replacement);
  return source.interactions[index];
}

export function findFrameAtPoint(page, point, document = null) {
  const matches = [];
  const visit = (nodes, ancestors = [], depth = 0) => {
    for (const node of nodes) {
      if (document ? !getNodePropertyValue(document, node, 'visible') : !node.visible) continue;
      const geometry = document ? { ...node, ...getNodeGeometry(document, node) } : node;
      const localPoint = pageToNodeLocal(geometry, point, ancestors);
      const inside = localPoint.x >= 0 && localPoint.y >= 0
        && localPoint.x <= geometry.width && localPoint.y <= geometry.height;
      if (inside && node.type === 'frame') matches.push({ node, depth, area: geometry.width * geometry.height });
      if (inside || !node.clip) visit(node.children || [], [...ancestors, geometry], depth + 1);
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
