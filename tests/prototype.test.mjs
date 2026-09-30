import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, addVariableMode, bindVariable, createComponent, createComponentInstance, createComponentSet, createDocument, createNode, createVariable, createVariableCollection, findNode, getNodePropertyValue, parseDocument, serializeDocument, switchComponentInstanceVariant, validateDocument } from '../src/model.js';
import { addPrototypeInteraction, applyPrototypeInteraction, backPrototypeSession, clearPrototypeHoverInteraction, createPrototypeSession, easePrototypeProgress, findClickableInteraction, findFrameAtPoint, findPrototypeDelayInteraction, getPrototypeStartFrame, normalizePrototypeLinkUrl, removePrototypeInteraction, schedulePrototypeDelay, setPrototypeStartPoint } from '../src/prototype.js';

test('prototype change-variant swaps only its presentation instance and survives local serialization', () => {
  const document = createDocument();
  const home = createNode('frame', { name: 'Variant demo' });
  addNode(document, home);
  const defaultMaster = createNode('rectangle', { name: 'Button/State=Default', fill: '#2255cc' });
  const hoverMaster = createNode('rectangle', { name: 'Button/State=Hover', fill: '#1144aa' });
  addNode(document, defaultMaster); addNode(document, hoverMaster);
  const defaultComponent = createComponent(document, defaultMaster.id);
  const hoverComponent = createComponent(document, hoverMaster.id);
  createComponentSet(document, [defaultComponent.id, hoverComponent.id]);
  const instance = createComponentInstance(document, defaultComponent.id, { parentId: home.id, x: 20, y: 24 });
  addPrototypeInteraction(document, instance.id, null, {
    action: 'change-variant', targetVariantId: hoverComponent.id
  });

  const savedBeforePresentation = structuredClone(document);
  const persisted = parseDocument(serializeDocument(document));
  assert.equal(findNode(persisted, instance.id).node.interactions[0].targetVariantId, hoverComponent.id);
  const runtime = structuredClone(persisted);
  const session = createPrototypeSession({ page: runtime.pages[0], frame: findNode(runtime, home.id).node });

  assert.equal(applyPrototypeInteraction(runtime, session, runtime.pages[0].children[0].children[0].interactions[0]), 'variant-changed');
  assert.equal(findNode(runtime, instance.id).node.componentId, hoverComponent.id, 'presentation should replace the instance subtree with the target variant');
  assert.equal(findNode(runtime, instance.id).node.fill, '#1144aa', 'the rendered instance should use the target variant appearance');
  assert.equal(session.variantSelections[instance.id], hoverComponent.id, 'presentation state should record the active variant');
  assert.equal(findNode(document, instance.id).node.componentId, defaultComponent.id, 'the authored document must keep its chosen variant');
  assert.equal(findNode(document, instance.id).node.fill, '#2255cc', 'presentation changes must not replace the saved variant appearance');
  assert.equal(findNode(savedBeforePresentation, instance.id).node.componentId, defaultComponent.id, 'the saved snapshot must remain unchanged');
  assert.equal(applyPrototypeInteraction(runtime, session, findNode(runtime, instance.id).node.interactions[0]), 'variant-changed', 'reapplying the active variant should be harmless');
  validateDocument(savedBeforePresentation);

  const invalidTarget = structuredClone(document);
  findNode(invalidTarget, instance.id).node.interactions[0].targetVariantId = 'missing-component';
  assert.throws(() => validateDocument(invalidTarget), /Invalid component variant target/);
  const sameVariantTarget = structuredClone(document);
  findNode(sameVariantTarget, instance.id).node.interactions[0].targetVariantId = defaultComponent.id;
  assert.throws(() => validateDocument(sameVariantTarget), /Invalid component variant target/);
  const authoredVariantSwitch = structuredClone(document);
  switchComponentInstanceVariant(authoredVariantSwitch, instance.id, hoverComponent.id);
  assert.equal(findNode(authoredVariantSwitch, instance.id).node.interactions, undefined,
    'an authored selection change must remove a variant action that now targets the active variant');
  validateDocument(authoredVariantSwitch);
  assert.throws(() => addPrototypeInteraction(document, home.id, null, {
    action: 'change-variant', targetVariantId: hoverComponent.id
  }), /different variant from this component instance/);
});

test('while-hovering variant changes return to the original component when the hotspot is left', () => {
  const document = createDocument();
  const home = createNode('frame', { name: 'Hover variant demo' });
  addNode(document, home);
  const defaultMaster = createNode('rectangle', { name: 'Button/State=Default', fill: '#2255cc' });
  const hoverMaster = createNode('rectangle', { name: 'Button/State=Hover', fill: '#1144aa' });
  addNode(document, defaultMaster); addNode(document, hoverMaster);
  const defaultComponent = createComponent(document, defaultMaster.id);
  const hoverComponent = createComponent(document, hoverMaster.id);
  createComponentSet(document, [defaultComponent.id, hoverComponent.id]);
  const instance = createComponentInstance(document, defaultComponent.id, { parentId: home.id, x: 20, y: 24 });
  addPrototypeInteraction(document, instance.id, null, {
    action: 'change-variant', trigger: 'while-hovering', targetVariantId: hoverComponent.id
  });

  const runtime = structuredClone(document);
  const runtimeInstance = findNode(runtime, instance.id).node;
  const session = createPrototypeSession({ page: runtime.pages[0], frame: findNode(runtime, home.id).node });
  assert.equal(applyPrototypeInteraction(runtime, session, runtimeInstance.interactions[0]), 'variant-changed');
  assert.equal(findNode(runtime, instance.id).node.componentId, hoverComponent.id);
  assert.equal(clearPrototypeHoverInteraction(runtime, session), true, 'leaving the active hover route should restore its original component');
  assert.equal(findNode(runtime, instance.id).node.componentId, defaultComponent.id);
  assert.equal(session.variantSelections[instance.id], defaultComponent.id);
  assert.equal(session.lastHoverInteractionId, null);
  assert.equal(findNode(document, instance.id).node.componentId, defaultComponent.id, 'hover presentation must not alter the authored document');
});

test('prototype links persist as local navigation to a destination frame', () => {
  const document = createDocument();
  const source = createNode('rectangle', { name: 'Open details', x: 20, y: 30 });
  const firstFrame = createNode('frame', { name: 'Home' });
  const secondFrame = createNode('frame', { name: 'Details', x: 500 });
  firstFrame.children.push(source);
  addNode(document, firstFrame);
  addNode(document, secondFrame);

  const interaction = addPrototypeInteraction(document, source.id, secondFrame.id, { transition: 'dissolve', duration: 240 });
  assert.equal(interaction.action, 'navigate');
  assert.equal(interaction.destinationPageId, document.activePageId);
  assert.equal(interaction.destinationId, secondFrame.id);
  assert.equal(findClickableInteraction(document, document.activePageId, source.id).interaction.id, interaction.id);

  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(findNode(reloaded, source.id).node.interactions[0].transition, 'dissolve');
  assert.equal(removePrototypeInteraction(reloaded, source.id, interaction.id), true);
  assert.equal(findNode(reloaded, source.id).node.interactions.length, 0);
});

test('press and drag prototype triggers are validated and resolve independently from click', () => {
  const document = createDocument();
  const source = createNode('rectangle', { name: 'Gesture hotspot', x: 20, y: 30 });
  const home = createNode('frame', { name: 'Home' });
  const clickTarget = createNode('frame', { name: 'Click destination', x: 500 });
  const pressTarget = createNode('frame', { name: 'Press destination', x: 1000 });
  const dragTarget = createNode('frame', { name: 'Drag destination', x: 1500 });
  home.children.push(source);
  addNode(document, home); addNode(document, clickTarget); addNode(document, pressTarget); addNode(document, dragTarget);

  const click = addPrototypeInteraction(document, source.id, clickTarget.id, { trigger: 'on-click' });
  const press = addPrototypeInteraction(document, source.id, pressTarget.id, { trigger: 'on-press' });
  const drag = addPrototypeInteraction(document, source.id, dragTarget.id, { trigger: 'on-drag' });
  assert.equal(findClickableInteraction(document, document.activePageId, source.id, 'on-click').interaction.id, click.id);
  assert.equal(findClickableInteraction(document, document.activePageId, source.id, 'on-press').interaction.id, press.id);
  assert.equal(findClickableInteraction(document, document.activePageId, source.id, 'on-drag').interaction.id, drag.id);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true, 'gesture triggers should round-trip through local document storage');

  const invalid = structuredClone(document);
  findNode(invalid, source.id).node.interactions.find(item => item.id === drag.id).trigger = 'on-release';
  assert.throws(() => validateDocument(invalid), /Invalid prototype interactions/);
  assert.throws(() => addPrototypeInteraction(document, source.id, dragTarget.id, { trigger: 'on-release' }), /Unsupported prototype trigger/);
});

test('smart animate is stored for frame navigation and rejected for overlays', () => {
  const document = createDocument();
  const source = createNode('rectangle', { name: 'Open details' });
  const firstFrame = createNode('frame', { name: 'Home' });
  const destination = createNode('frame', { name: 'Details' });
  firstFrame.children.push(source);
  addNode(document, firstFrame); addNode(document, destination);

  const interaction = addPrototypeInteraction(document, source.id, destination.id, { transition: 'smart-animate', easing: 'ease-out', duration: 500 });
  assert.equal(interaction.transition, 'smart-animate');
  assert.equal(interaction.easing, 'ease-out');
  assert.equal(findNode(parseDocument(serializeDocument(document)), source.id).node.interactions[0].easing, 'ease-out');
  assert.throws(() => addPrototypeInteraction(document, source.id, destination.id, { easing: 'bounce' }), /Unsupported prototype easing/);
  assert.throws(() => addPrototypeInteraction(document, source.id, destination.id, { action: 'open-overlay', transition: 'smart-animate' }), /only be used for frame navigation/);

  const invalid = structuredClone(document);
  invalid.pages[0].children[0].children[0].interactions[0].action = 'open-overlay';
  assert.throws(() => validateDocument(invalid), /Invalid prototype interactions/);
  const invalidEasing = structuredClone(document);
  invalidEasing.pages[0].children[0].children[0].interactions[0].easing = 'bounce';
  assert.throws(() => validateDocument(invalidEasing), /Invalid prototype interactions/);
});

test('after-delay prototype routes validate, persist, schedule once, and cancel safely', () => {
  const document = createDocument();
  const home = createNode('frame', { name: 'Timed home' });
  const trigger = createNode('rectangle', { name: 'Timed route' });
  const destination = createNode('frame', { name: 'Timed destination' });
  home.children.push(trigger);
  addNode(document, home); addNode(document, destination);

  const interaction = addPrototypeInteraction(document, trigger.id, destination.id, { trigger: 'after-delay', delay: 1250 });
  assert.equal(interaction.delay, 1250);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true, 'the wait and destination should round-trip through document storage');
  const session = createPrototypeSession({ page: document.pages[0], frame: home });
  const timed = findPrototypeDelayInteraction(document, document.activePageId, home.id, session);
  assert.equal(timed.source.id, trigger.id);
  assert.equal(timed.interaction.id, interaction.id);
  assert.equal(applyPrototypeInteraction(document, session, timed.interaction), 'navigated');
  assert.equal(session.frameId, destination.id);

  const opener = createNode('rectangle', { name: 'Open timed overlay' });
  const overlay = createNode('frame', { name: 'Timed overlay' });
  const overlayTrigger = createNode('rectangle', { name: 'Continue after wait' });
  home.children.push(opener);
  overlay.children.push(overlayTrigger);
  addNode(document, overlay);
  const openOverlay = addPrototypeInteraction(document, opener.id, overlay.id, { action: 'open-overlay' });
  const overlayRoute = addPrototypeInteraction(document, overlayTrigger.id, destination.id, { trigger: 'after-delay', delay: 300 });
  const overlaySession = createPrototypeSession({ page: document.pages[0], frame: home });
  assert.equal(applyPrototypeInteraction(document, overlaySession, openOverlay), 'overlay-opened');
  const visibleOverlay = overlaySession.overlays.at(-1);
  assert.equal(findPrototypeDelayInteraction(document, visibleOverlay.pageId, visibleOverlay.frameId, overlaySession).interaction.id, overlayRoute.id,
    'the active overlay should scope delayed actions independently from its underlying frame');

  for (const delay of [99, 10_001, 1250.5, NaN]) {
    assert.throws(() => addPrototypeInteraction(document, trigger.id, destination.id, { trigger: 'after-delay', delay }), /whole-number delay/);
  }
  assert.throws(() => addPrototypeInteraction(document, trigger.id, null, { action: 'back', trigger: 'after-delay' }), /destination action/);
  const invalid = structuredClone(document);
  findNode(invalid, trigger.id).node.interactions[0].delay = 10_001;
  assert.throws(() => validateDocument(invalid), /Invalid prototype interactions/);
  const missingDelay = structuredClone(document);
  delete findNode(missingDelay, trigger.id).node.interactions[0].delay;
  assert.throws(() => validateDocument(missingDelay), /Invalid prototype interactions/);

  let scheduledCallback;
  let scheduledDelay;
  let clearedHandle = null;
  const timers = {
    setTimeout(callback, delay) { scheduledCallback = callback; scheduledDelay = delay; return 'timer-1'; },
    clearTimeout(handle) { clearedHandle = handle; }
  };
  let fired = 0;
  const cancel = schedulePrototypeDelay(interaction, () => { fired += 1; }, timers);
  assert.equal(scheduledDelay, 1250);
  assert.equal(cancel(), true);
  assert.equal(clearedHandle, 'timer-1');
  scheduledCallback();
  assert.equal(fired, 0, 'a callback already queued at cancellation time must remain inert');

  let completed = 0;
  schedulePrototypeDelay(interaction, () => { completed += 1; }, timers);
  scheduledCallback();
  assert.equal(completed, 1, 'an active delay should invoke its route exactly once');
});

test('prototype easing curves clamp progress and preserve the legacy smooth default', () => {
  assert.equal(easePrototypeProgress(-1, 'linear'), 0);
  assert.equal(easePrototypeProgress(2, 'linear'), 1);
  assert.equal(easePrototypeProgress(0.5, 'ease-in'), 0.25);
  assert.equal(easePrototypeProgress(0.5, 'ease-out'), 0.75);
  assert.equal(easePrototypeProgress(0.5, 'ease-in-out'), 0.5);
  assert.equal(easePrototypeProgress(0.5), 0.5);
});

test('prototype start point and frame hit-testing prefer a nested frame', () => {
  const document = createDocument();
  const outer = createNode('frame', { x: 10, y: 20, width: 400, height: 500 });
  const inner = createNode('frame', { x: 30, y: 40, width: 120, height: 160 });
  outer.children.push(inner);
  addNode(document, outer);
  setPrototypeStartPoint(document, inner.id);
  assert.equal(getPrototypeStartFrame(document).frame.id, inner.id);
  assert.equal(findFrameAtPoint(document.pages[0], { x: 50, y: 70 }).id, inner.id);
  assert.equal(findFrameAtPoint(document.pages[0], { x: 350, y: 470 }).id, outer.id);
});

test('invalid destinations and transitions are rejected', () => {
  const document = createDocument();
  const source = createNode('rectangle');
  const destination = createNode('rectangle');
  const frameDestination = createNode('frame');
  addNode(document, source);
  addNode(document, destination);
  addNode(document, frameDestination);
  assert.throws(() => addPrototypeInteraction(document, source.id, destination.id), /must end at a frame/);
  assert.throws(() => addPrototypeInteraction(document, source.id, destination.id, { transition: 'spin' }), /Unsupported prototype transition/);
  assert.throws(() => addPrototypeInteraction(document, source.id, frameDestination.id, { action: 'open-overlay', overlayPosition: 'floating' }), /Unsupported prototype overlay position/);
  assert.throws(() => addPrototypeInteraction(document, source.id, null, { action: 'navigate' }), /must end at a frame/);
});

test('prototype overlays open, close, preserve navigation history, and survive local reload', () => {
  const document = createDocument();
  const home = createNode('frame', { name: 'Home', width: 400, height: 700 });
  const openButton = createNode('rectangle', { name: 'Open menu', x: 20, y: 20, width: 140, height: 44 });
  const overlay = createNode('frame', { name: 'Menu', width: 260, height: 320 });
  const closeButton = createNode('rectangle', { name: 'Close menu', x: 20, y: 20, width: 100, height: 40 });
  const continueButton = createNode('rectangle', { name: 'Continue', x: 20, y: 80, width: 120, height: 40 });
  const destination = createNode('frame', { name: 'Details', x: 500 });
  home.children.push(openButton);
  overlay.children.push(closeButton, continueButton);
  addNode(document, home);
  addNode(document, overlay);
  addNode(document, destination);

  const open = addPrototypeInteraction(document, openButton.id, overlay.id, {
    action: 'open-overlay', overlayPosition: 'bottom-right', overlayOutsideClick: false,
    overlayBackground: true, overlayBackgroundColor: '#123456', overlayBackgroundOpacity: 0.45
  });
  const close = addPrototypeInteraction(document, closeButton.id, null, { action: 'close-overlay' });
  const navigate = addPrototypeInteraction(document, continueButton.id, destination.id);
  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(findClickableInteraction(reloaded, document.activePageId, openButton.id).interaction.action, 'open-overlay');
  assert.equal(findNode(reloaded, closeButton.id).node.interactions[0].destinationId, null);

  const session = createPrototypeSession({ page: reloaded.pages[0], frame: home });
  assert.equal(applyPrototypeInteraction(reloaded, session, open), 'overlay-opened');
  assert.deepEqual(session.overlays[0], {
    pageId: document.activePageId,
    frameId: overlay.id,
    position: 'bottom-right',
    outsideClick: false,
    background: true,
    backgroundColor: '#123456',
    backgroundOpacity: 0.45
  });
  assert.equal(applyPrototypeInteraction(reloaded, session, navigate), 'navigated');
  assert.equal(session.frameId, destination.id);
  assert.equal(session.overlays.length, 0);
  assert.equal(backPrototypeSession(session), 'navigated-back');
  assert.equal(session.frameId, home.id);
  assert.equal(session.overlays[0].frameId, overlay.id);
  assert.equal(backPrototypeSession(session), 'overlay-closed');
  assert.equal(session.overlays.length, 0);
  assert.equal(applyPrototypeInteraction(reloaded, session, close), false);
});

test('swap overlay replaces the top overlay in place without adding history', () => {
  const document = createDocument();
  const home = createNode('frame', { name: 'Home' });
  const menu = createNode('frame', { name: 'Menu' });
  const details = createNode('frame', { name: 'Details' });
  const swapButton = createNode('rectangle', { name: 'Show details' });
  menu.children.push(swapButton);
  addNode(document, home); addNode(document, menu); addNode(document, details);

  const open = addPrototypeInteraction(document, home.id, menu.id, {
    action: 'open-overlay', overlayPosition: 'bottom-right', overlayOutsideClick: false,
    overlayBackground: true, overlayBackgroundColor: '#abcdef', overlayBackgroundOpacity: 0.6
  });
  const swap = addPrototypeInteraction(document, swapButton.id, details.id, { action: 'swap-overlay' });
  const session = createPrototypeSession({ page: document.pages[0], frame: home });
  applyPrototypeInteraction(document, session, open);
  const before = structuredClone(session.overlays[0]);
  assert.equal(applyPrototypeInteraction(document, session, swap), 'overlay-swapped');
  assert.equal(session.overlays.length, 1);
  assert.equal(session.overlays[0].frameId, details.id);
  assert.deepEqual({ ...session.overlays[0], frameId: before.frameId }, before);
  assert.equal(session.stack.length, 0);
  assert.equal(backPrototypeSession(session), 'overlay-closed');
  assert.equal(session.frameId, home.id);
  assert.equal(session.stack.length, 0);
});

test('swap overlay from a regular frame behaves like navigation and remains backable', () => {
  const document = createDocument();
  const home = createNode('frame', { name: 'Home' });
  const destination = createNode('frame', { name: 'Destination' });
  addNode(document, home); addNode(document, destination);
  const swap = addPrototypeInteraction(document, home.id, destination.id, { action: 'swap-overlay' });
  const session = createPrototypeSession({ page: document.pages[0], frame: home });
  assert.equal(applyPrototypeInteraction(document, session, swap), 'navigated');
  assert.equal(session.frameId, destination.id);
  assert.equal(session.stack.length, 1);
  assert.equal(backPrototypeSession(session), 'navigated-back');
  assert.equal(session.frameId, home.id);
});

test('back and open-link actions are stored without frame destinations and links are restricted to safe schemes', () => {
  const document = createDocument();
  const source = createNode('rectangle', { name: 'External resource' });
  const home = createNode('frame', { name: 'Home' });
  const details = createNode('frame', { name: 'Details' });
  home.children.push(source);
  addNode(document, home); addNode(document, details);

  const link = addPrototypeInteraction(document, source.id, null, { action: 'open-link', url: 'https://example.com/help?q=a b' });
  assert.equal(link.url, 'https://example.com/help?q=a%20b');
  assert.equal(link.destinationId, null);
  assert.equal(applyPrototypeInteraction(document, createPrototypeSession({ page: document.pages[0], frame: home }), link), 'link-opened');
  assert.equal(normalizePrototypeLinkUrl('mailto:help@example.com?subject=Hello'), 'mailto:help@example.com?subject=Hello');
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,hi', '//example.com', 'mailto:', 'mailto://example.com', 'http://']) {
    assert.equal(normalizePrototypeLinkUrl(unsafe), null, unsafe);
    assert.throws(() => addPrototypeInteraction(document, source.id, null, { action: 'open-link', url: unsafe }), /safe http\(s\) or mailto URL/);
  }

  const back = addPrototypeInteraction(document, source.id, null, { action: 'back' });
  assert.equal(back.destinationId, null);
  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(findNode(reloaded, source.id).node.interactions.find(item => item.action === 'open-link').url, link.url);
  const invalidDocument = structuredClone(document);
  invalidDocument.pages[0].children[0].children[0].interactions.find(item => item.action === 'open-link').url = 'javascript:alert(1)';
  assert.throws(() => validateDocument(invalidDocument), /Invalid prototype interactions/);
  const session = createPrototypeSession({ page: document.pages[0], frame: home });
  assert.equal(applyPrototypeInteraction(document, session, back), false);
  applyPrototypeInteraction(document, session, addPrototypeInteraction(document, home.id, details.id));
  assert.equal(applyPrototypeInteraction(document, session, back), 'navigated-back');
  assert.equal(session.frameId, home.id);
  assert.equal(applyPrototypeInteraction(document, session, { ...link, url: 'javascript:alert(1)' }), false);
});

test('prototype variable-mode actions update the presentation session without mutating saved frame settings', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Theme');
  const light = collection.modes[0];
  const dark = addVariableMode(document, collection.id, 'Dark');
  const radius = createVariable(document, collection.id, 'Card radius', 'number', 8);
  radius.valuesByMode[dark.id] = 24;
  const home = createNode('frame', { name: 'Home' });
  const trigger = createNode('rectangle', { name: 'Switch theme' });
  const card = createNode('rectangle', { radius: 4 });
  home.children.push(trigger, card);
  addNode(document, home);
  assert.equal(bindVariable(document, card.id, radius.id, 'radius'), true);

  const interaction = addPrototypeInteraction(document, trigger.id, null, {
    action: 'set-variable-mode', collectionId: collection.id, modeId: dark.id
  });
  assert.equal(interaction.collectionId, collection.id);
  assert.equal(interaction.modeId, dark.id);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const session = createPrototypeSession({ page: document.pages[0], frame: home });
  assert.equal(applyPrototypeInteraction(document, session, interaction), 'variables-updated');
  assert.deepEqual(session.variableModes, { [collection.id]: dark.id });
  assert.equal(home.variableModes, undefined, 'prototype actions must not modify the saved frame');
  assert.equal(getNodePropertyValue(document, card, 'radius'), 8);

  const presentationDocument = structuredClone(document);
  findNode(presentationDocument, home.id).node.variableModes = { ...session.variableModes };
  const presentationCard = findNode(presentationDocument, card.id).node;
  assert.equal(getNodePropertyValue(presentationDocument, presentationCard, 'radius'), 24);

  const changedMode = addPrototypeInteraction(document, trigger.id, null, {
    action: 'set-variable-mode', collectionId: collection.id, modeId: light.id
  });
  assert.equal(changedMode.id, interaction.id, 'changing the chosen mode updates that collection action');
  assert.equal(changedMode.modeId, light.id);
  assert.equal(applyPrototypeInteraction(document, session, { ...interaction, modeId: 'missing-mode' }), false);
});

test('prototype routes match typed variable conditions using session modes and condition-aware deduplication', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Route state');
  const light = collection.modes[0];
  const dark = addVariableMode(document, collection.id, 'Dark');
  const route = createVariable(document, collection.id, 'Route', 'string', 'light');
  route.valuesByMode[dark.id] = 'dark';

  const home = createNode('frame', { name: 'Home' });
  const lightDestination = createNode('frame', { name: 'Light route', x: 500 });
  const darkDestination = createNode('frame', { name: 'Dark route', x: 1000 });
  const source = createNode('rectangle', { name: 'Conditional route' });
  const inequalitySource = createNode('rectangle', { name: 'Not dark route', y: 60 });
  const dedupeSource = createNode('rectangle', { name: 'Conditional duplicate', y: 120 });
  home.children.push(source, inequalitySource, dedupeSource);
  addNode(document, home); addNode(document, lightDestination); addNode(document, darkDestination);

  const lightRoute = addPrototypeInteraction(document, source.id, lightDestination.id, {
    condition: { variableId: route.id, type: 'string', operator: 'equals', value: 'light' }
  });
  const darkRoute = addPrototypeInteraction(document, source.id, darkDestination.id, {
    condition: { variableId: route.id, type: 'string', operator: 'equals', value: 'dark' }
  });
  const notDarkRoute = addPrototypeInteraction(document, inequalitySource.id, lightDestination.id, {
    condition: { variableId: route.id, type: 'string', operator: 'not-equals', value: 'dark' }
  });

  const session = createPrototypeSession({ page: document.pages[0], frame: home });
  assert.equal(findClickableInteraction(document, document.activePageId, source.id, 'on-click', session)?.interaction.id, lightRoute.id,
    'an unset session mode should use the collection/frame default');
  assert.equal(findClickableInteraction(document, document.activePageId, inequalitySource.id, 'on-click', session)?.interaction.id, notDarkRoute.id,
    'not-equals should match the default variable value');

  const setDark = addPrototypeInteraction(document, source.id, null, {
    action: 'set-variable-mode', collectionId: collection.id, modeId: dark.id
  });
  assert.equal(applyPrototypeInteraction(document, session, setDark), 'variables-updated');
  assert.equal(findClickableInteraction(document, document.activePageId, source.id, 'on-click', session)?.interaction.id, darkRoute.id,
    'the selected prototype mode should route to its matching interaction');
  assert.equal(findClickableInteraction(document, document.activePageId, inequalitySource.id, 'on-click', session), null,
    'a nonmatching not-equals condition should not route');

  const duplicateConditionA = { variableId: route.id, type: 'string', operator: 'equals', value: 'light' };
  const duplicateConditionB = { variableId: route.id, type: 'string', operator: 'equals', value: 'dark' };
  const firstDuplicate = addPrototypeInteraction(document, dedupeSource.id, lightDestination.id, { condition: duplicateConditionA });
  const secondDuplicate = addPrototypeInteraction(document, dedupeSource.id, lightDestination.id, { condition: duplicateConditionB });
  assert.notEqual(firstDuplicate.id, secondDuplicate.id, 'different conditions on the same trigger/action/destination must coexist');
  const updatedDuplicate = addPrototypeInteraction(document, dedupeSource.id, lightDestination.id, {
    condition: duplicateConditionA, duration: 640
  });
  assert.equal(updatedDuplicate.id, firstDuplicate.id, 're-adding the same condition should update the existing interaction');
  assert.equal(updatedDuplicate.duration, 640);
  assert.equal(dedupeSource.interactions.length, 2);

  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(findNode(reloaded, source.id).node.interactions[0].condition.value, 'light', 'conditions should survive local document round trips');
});

test('matching conditional prototype routes take precedence over an earlier unconditional fallback', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Route state');
  const light = collection.modes[0];
  const dark = addVariableMode(document, collection.id, 'Dark');
  const route = createVariable(document, collection.id, 'Route', 'string', 'light');
  route.valuesByMode[dark.id] = 'dark';

  const home = createNode('frame', { name: 'Home' });
  const fallback = createNode('frame', { name: 'Fallback', x: 500 });
  const conditional = createNode('frame', { name: 'Conditional', x: 1000 });
  const source = createNode('rectangle', { name: 'Route source' });
  home.children.push(source);
  addNode(document, home); addNode(document, fallback); addNode(document, conditional);

  const fallbackRoute = addPrototypeInteraction(document, source.id, fallback.id);
  const conditionalRoute = addPrototypeInteraction(document, source.id, conditional.id, {
    condition: { variableId: route.id, type: 'string', operator: 'equals', value: 'light' }
  });
  const session = createPrototypeSession({ page: document.pages[0], frame: home });
  assert.equal(findClickableInteraction(document, document.activePageId, source.id, 'on-click', session)?.interaction.id, conditionalRoute.id,
    'a matching conditional action should win even when the fallback was created first');

  session.variableModes[collection.id] = dark.id;
  assert.equal(findClickableInteraction(document, document.activePageId, source.id, 'on-click', session)?.interaction.id, fallbackRoute.id,
    'the unconditional action should remain available when no condition matches');
});

test('prototype interaction conditions reject invalid variable, operator, type, and value schemas', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Conditions');
  const variable = createVariable(document, collection.id, 'Enabled', 'boolean', true);
  const home = createNode('frame', { name: 'Home' });
  const destination = createNode('frame', { name: 'Destination' });
  const source = createNode('rectangle', { name: 'Conditional' });
  home.children.push(source);
  addNode(document, home); addNode(document, destination);
  const interaction = addPrototypeInteraction(document, source.id, destination.id, {
    condition: { variableId: variable.id, type: 'boolean', operator: 'equals', value: true }
  });
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true,
    'a typed condition must remain valid through serialize/parse validation');

  for (const condition of [
    { ...interaction.condition, variableId: 'missing-variable' },
    { ...interaction.condition, operator: 'contains' },
    { ...interaction.condition, type: 'string' },
    { ...interaction.condition, value: 'true' },
    { ...interaction.condition, extra: 'unknown field' },
    { variableId: variable.id, type: 'boolean', operator: 'equals' }
  ]) {
    const invalid = structuredClone(document);
    findNode(invalid, source.id).node.interactions[0].condition = condition;
    assert.throws(() => validateDocument(invalid), /Invalid prototype interactions/);
  }
  assert.throws(() => addPrototypeInteraction(document, source.id, destination.id, {
    condition: { variableId: variable.id, type: 'boolean', operator: 'equals', value: 'true' }
  }), /Invalid prototype interaction condition/);
});
