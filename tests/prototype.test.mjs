import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, addVariableMode, bindVariable, createComponent, createComponentInstance, createComponentSet, createDocument, createNode, createVariable, createVariableCollection, deleteVariable, duplicateNode, findNode, getNodePropertyValue, listPrototypeExpressionVariables, moveNode, parseDocument, reconcilePrototypeScrollInteractions, removeNode, resolveVariableValue, serializeDocument, setVariableValue, switchComponentInstanceVariant, updateNode, validateDocument } from '../src/model.js';
import { addPrototypeInteraction, applyPrototypeInteraction, backPrototypeSession, clearPrototypeHoverInteraction, createPrototypeSession, easePrototypeProgress, findClickableInteraction, findFrameAtPoint, findPrototypeDelayInteraction, getPrototypeStartFrame, normalizePrototypeLinkUrl, prototypeEasingTimingFunction, prototypeMoveInOffset, removePrototypeInteraction, schedulePrototypeDelay, setPrototypeStartPoint, updatePrototypeInteraction } from '../src/prototype.js';

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

test('hover variant cleanup survives navigation and back history', () => {
  const document = createDocument();
  const home = createNode('frame', { name: 'Home' });
  const defaultMaster = createNode('rectangle', { name: 'Button/State=Default', fill: '#2255cc' });
  const hoverMaster = createNode('rectangle', { name: 'Button/State=Hover', fill: '#1144aa' });
  const destination = createNode('frame', { name: 'Destination' });
  addNode(document, home); addNode(document, defaultMaster); addNode(document, hoverMaster); addNode(document, destination);
  const defaultComponent = createComponent(document, defaultMaster.id);
  const hoverComponent = createComponent(document, hoverMaster.id);
  createComponentSet(document, [defaultComponent.id, hoverComponent.id]);
  const instance = createComponentInstance(document, defaultComponent.id, { parentId: home.id, x: 20, y: 24 });
  const hover = addPrototypeInteraction(document, instance.id, null, {
    action: 'change-variant', trigger: 'while-hovering', targetVariantId: hoverComponent.id
  });
  const navigate = addPrototypeInteraction(document, instance.id, destination.id, { trigger: 'on-click' });
  const runtime = structuredClone(document);
  const session = createPrototypeSession({ page: runtime.pages[0], frame: findNode(runtime, home.id).node });

  assert.equal(applyPrototypeInteraction(runtime, session, hover), 'variant-changed');
  assert.equal(findNode(runtime, instance.id).node.componentId, hoverComponent.id);
  assert.equal(applyPrototypeInteraction(runtime, session, navigate), 'navigated');
  assert.equal(session.hoverVariantOriginal.componentId, defaultComponent.id,
    'navigation must retain the hover reset point while the source frame is hidden');
  assert.equal(backPrototypeSession(session), 'navigated-back');
  assert.equal(session.lastHoverInteractionId, hover.id,
    'returning to the source frame must leave the hover route active until pointer movement is observed');
  assert.equal(clearPrototypeHoverInteraction(runtime, session), true);
  assert.equal(findNode(runtime, instance.id).node.componentId, defaultComponent.id,
    'leaving the hotspot after returning should restore the authored presentation variant');
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
  assert.equal(applyPrototypeInteraction(runtime, session, runtimeInstance.interactions[0]), 'variant-changed',
    'reapplying the active hover route should be idempotent');
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

test('scroll-to interactions persist, validate their screen, and resolve in presentation', () => {
  const document = createDocument();
  const screen = createNode('frame', { name: 'Long screen' });
  const source = createNode('rectangle', { name: 'Jump to footer' });
  const scroller = createNode('frame', { name: 'Content', y: 100, width: 300, height: 200, overflowBehavior: 'vertical' });
  const target = createNode('text', { name: 'Footer', y: 520, width: 120, height: 24, text: 'Footer' });
  scroller.children.push(target);
  screen.children.push(source, scroller);
  addNode(document, screen);

  const interaction = addPrototypeInteraction(document, source.id, null, {
    action: 'scroll-to', scrollTargetId: target.id, scrollAlignment: 'center', transition: 'scroll', duration: 450, easing: 'ease-out'
  });
  assert.equal(interaction.destinationId, null);
  assert.equal(interaction.scrollTargetId, target.id);
  assert.equal(interaction.scrollAlignment, 'center');
  assert.equal(findClickableInteraction(document, document.activePageId, source.id).interaction.id, interaction.id);
  const persisted = parseDocument(serializeDocument(document));
  assert.equal(findNode(persisted, source.id).node.interactions[0].scrollTargetId, target.id);
  validateDocument(persisted);

  const session = createPrototypeSession({ page: persisted.pages[0], frame: findNode(persisted, screen.id).node });
  assert.equal(applyPrototypeInteraction(persisted, session, findNode(persisted, source.id).node.interactions[0]), 'scroll-to');
  assert.equal(session.frameId, screen.id, 'scrolling does not navigate away from the active screen');

  const editable = structuredClone(persisted);
  const replacementTarget = createNode('rectangle', { name: 'Alternate anchor', y: 720 });
  addNode(editable, replacementTarget, { parentId: scroller.id });
  const updated = updatePrototypeInteraction(editable, source.id, interaction.id, null, {
    action: 'scroll-to', scrollTargetId: replacementTarget.id, scrollAlignment: 'end', transition: 'instant'
  });
  assert.equal(updated.id, interaction.id, 'editing keeps the route identity stable');
  assert.equal(updated.scrollTargetId, replacementTarget.id);
  assert.equal(updated.scrollAlignment, 'end');
  validateDocument(editable);

  const otherTarget = createNode('rectangle', { name: 'Outside content' });
  screen.children.push(otherTarget);
  assert.throws(() => addPrototypeInteraction(document, source.id, null, {
    action: 'scroll-to', scrollTargetId: otherTarget.id
  }), /scrollable frame on the same prototype screen/);
  const invalidPersisted = structuredClone(document);
  findNode(invalidPersisted, source.id).node.interactions[0].scrollTargetId = otherTarget.id;
  assert.throws(() => validateDocument(invalidPersisted), /Prototype scroll-to interactions/);
  assert.throws(() => addPrototypeInteraction(document, source.id, null, {
    action: 'scroll-to', scrollTargetId: target.id, transition: 'dissolve'
  }), /only instant or scroll/);
});

test('nested prototype screens scope scroll-to routes to the nearest active frame', () => {
  const document = createDocument();
  const outer = createNode('frame', { name: 'Outer screen', overflowBehavior: 'vertical' });
  const screen = createNode('frame', { name: 'Nested screen' });
  const source = createNode('rectangle', { name: 'Jump to section' });
  const scroller = createNode('frame', { name: 'Nested scroller', overflowBehavior: 'vertical' });
  const target = createNode('rectangle', { name: 'Section', y: 400 });
  const outsideTarget = createNode('rectangle', { name: 'Outside nested screen' });
  scroller.children.push(target);
  screen.children.push(source, scroller);
  outer.children.push(screen, outsideTarget);
  addNode(document, outer);

  const interaction = addPrototypeInteraction(document, source.id, null, {
    action: 'scroll-to', scrollTargetId: target.id
  });
  assert.equal(getPrototypeStartFrame(document, source.id).frame.id, screen.id);
  const session = createPrototypeSession({ page: document.pages[0], frame: screen });
  assert.equal(applyPrototypeInteraction(document, session, interaction), 'scroll-to');
  assert.throws(() => addPrototypeInteraction(document, source.id, null, {
    action: 'scroll-to', scrollTargetId: outsideTarget.id
  }), /scrollable frame on the same prototype screen/);
  validateDocument(document);
});

test('removing the last scrollable ancestor prunes dependent routes before saving', () => {
  const document = createDocument();
  const screen = createNode('frame', { name: 'Screen' });
  const source = createNode('rectangle', { name: 'Jump link' });
  const scroller = createNode('frame', { name: 'Scrollable section', overflowBehavior: 'vertical' });
  const target = createNode('rectangle', { name: 'Anchor', y: 400 });
  scroller.children.push(target);
  screen.children.push(source, scroller);
  addNode(document, screen);
  const interaction = addPrototypeInteraction(document, source.id, null, {
    action: 'scroll-to', scrollTargetId: target.id
  });

  scroller.overflowBehavior = 'none';
  assert.throws(() => validateDocument(document), /Prototype scroll-to interactions/);
  assert.equal(reconcilePrototypeScrollInteractions(document), 1);
  assert.equal(findNode(document, source.id).node.interactions, undefined);
  validateDocument(document);

  scroller.overflowBehavior = 'vertical';
  const apiRoute = addPrototypeInteraction(document, source.id, null, {
    action: 'scroll-to', scrollTargetId: target.id
  });
  assert.equal(updateNode(document, scroller.id, { overflowBehavior: 'none' }), true);
  assert.equal(findNode(document, source.id).node.interactions, undefined,
    'the public model update API prunes a route when its only scrollable ancestor is disabled');
  validateDocument(document);

  screen.overflowBehavior = 'vertical';
  scroller.overflowBehavior = 'vertical';
  const replacement = addPrototypeInteraction(document, source.id, null, {
    action: 'scroll-to', scrollTargetId: target.id
  });
  scroller.overflowBehavior = 'none';
  assert.equal(reconcilePrototypeScrollInteractions(document), 0,
    'the route remains valid while the active screen still provides a scrollable ancestor');
  assert.equal(findNode(document, source.id).node.interactions[0].id, replacement.id);
  assert.notEqual(apiRoute.id, replacement.id);
  validateDocument(document);
});

test('moving an anchor outside its prototype screen removes the stale scroll-to route', () => {
  const document = createDocument();
  const screen = createNode('frame', { name: 'Screen' });
  const source = createNode('rectangle', { name: 'Jump link' });
  const scroller = createNode('frame', { name: 'Scrollable section', overflowBehavior: 'vertical' });
  const target = createNode('rectangle', { name: 'Anchor', y: 400 });
  scroller.children.push(target);
  screen.children.push(source, scroller);
  addNode(document, screen);
  addPrototypeInteraction(document, source.id, null, { action: 'scroll-to', scrollTargetId: target.id });

  assert.equal(moveNode(document, target.id, { parentId: null }), true);
  assert.equal(findNode(document, source.id).node.interactions, undefined);
  validateDocument(document);
});

test('scroll-to references follow duplicated content and are removed with deleted targets', () => {
  const document = createDocument();
  const screen = createNode('frame', { name: 'Long screen' });
  const scroller = createNode('frame', { name: 'Scrollable content', width: 300, height: 180, overflowBehavior: 'vertical' });
  const section = createNode('group', { name: 'Footer section', y: 240 });
  const source = createNode('rectangle', { name: 'Jump link' });
  const target = createNode('rectangle', { name: 'Footer anchor' });
  section.children.push(source, target);
  scroller.children.push(section);
  screen.children.push(scroller);
  addNode(document, screen);
  addPrototypeInteraction(document, source.id, null, { action: 'scroll-to', scrollTargetId: target.id });

  const duplicate = duplicateNode(document, section.id);
  const duplicateSource = duplicate.children.find(node => node.name.startsWith('Jump link'));
  const duplicateTarget = duplicate.children.find(node => node.name.startsWith('Footer anchor'));
  assert.equal(duplicateSource.interactions[0].scrollTargetId, duplicateTarget.id);
  validateDocument(document);

  removeNode(document, target.id);
  assert.equal(findNode(document, source.id).node.interactions, undefined, 'removing an anchor clears actions that referenced it');
  assert.equal(findNode(document, duplicateSource.id).node.interactions[0].scrollTargetId, duplicateTarget.id,
    'removing the original anchor preserves the duplicated content’s remapped action');
  removeNode(document, duplicateTarget.id);
  assert.equal(findNode(document, duplicateSource.id).node.interactions, undefined);
  validateDocument(document);
});

test('prototype interaction edits preserve identity and position while replacing validated settings', () => {
  const document = createDocument();
  const home = createNode('frame', { name: 'Home' });
  const source = createNode('rectangle', { name: 'Open details' });
  const firstTarget = createNode('frame', { name: 'Details', x: 500 });
  const secondTarget = createNode('frame', { name: 'Help', x: 1000 });
  home.children.push(source);
  addNode(document, home); addNode(document, firstTarget); addNode(document, secondTarget);
  const first = addPrototypeInteraction(document, source.id, firstTarget.id, { duration: 300 });
  const second = addPrototypeInteraction(document, source.id, secondTarget.id, { trigger: 'on-press', transition: 'move-left' });

  const updated = updatePrototypeInteraction(document, source.id, first.id, secondTarget.id, {
    action: 'open-overlay', trigger: 'after-delay', delay: 1800,
    transition: 'dissolve', easing: 'ease-out', duration: 600,
    overlayPosition: 'bottom-right', overlayOutsideClick: false,
    overlayBackground: true, overlayBackgroundColor: '#123456', overlayBackgroundOpacity: .4
  });

  assert.equal(updated.id, first.id, 'editing keeps the interaction identity stable');
  assert.equal(updated.action, 'open-overlay');
  assert.equal(updated.destinationId, secondTarget.id);
  assert.equal(updated.destinationPageId, document.activePageId);
  assert.equal(updated.trigger, 'after-delay');
  assert.equal(updated.delay, 1800);
  assert.equal(updated.overlayPosition, 'bottom-right');
  assert.equal(updated.overlayOutsideClick, false);
  assert.equal(updated.overlayBackgroundColor, '#123456');
  assert.equal(updated.overlayBackgroundOpacity, .4);
  assert.deepEqual(source.interactions.map(item => item.id), [first.id, second.id], 'editing keeps the original list position');
  assert.equal(findClickableInteraction(document, document.activePageId, source.id, 'on-press').interaction.id, second.id);
  assert.equal(findClickableInteraction(document, document.activePageId, source.id, 'after-delay').interaction.id, first.id);
});

test('prototype interaction edits reject invalid and duplicate routes atomically', () => {
  const document = createDocument();
  const source = createNode('rectangle', { name: 'Routes' });
  const firstTarget = createNode('frame', { name: 'First', x: 500 });
  const secondTarget = createNode('frame', { name: 'Second', x: 1000 });
  addNode(document, source); addNode(document, firstTarget); addNode(document, secondTarget);
  const first = addPrototypeInteraction(document, source.id, firstTarget.id);
  const second = addPrototypeInteraction(document, source.id, secondTarget.id);
  const before = structuredClone(source.interactions);

  assert.throws(() => updatePrototypeInteraction(document, source.id, second.id, firstTarget.id, {}), /already exists/);
  assert.deepEqual(source.interactions, before, 'a duplicate route does not mutate the original document');
  assert.throws(() => updatePrototypeInteraction(document, source.id, second.id, 'missing-frame', {}), /must end at a frame/);
  assert.deepEqual(source.interactions, before, 'invalid destinations do not mutate the original document');
  assert.throws(() => updatePrototypeInteraction(document, source.id, 'missing-interaction', firstTarget.id, {}), /no longer exists/);
  assert.deepEqual(source.interactions, before, 'a stale edit does not mutate the original document');
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

test('smart animate is stored for frame navigation and swap overlays, but rejected for opening or closing overlays', () => {
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
  const swapOverlay = addPrototypeInteraction(document, source.id, destination.id, {
    action: 'swap-overlay', transition: 'smart-animate', easing: 'ease-out', duration: 500
  });
  assert.equal(swapOverlay.transition, 'smart-animate');
  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(findNode(reloaded, source.id).node.interactions.find(item => item.action === 'swap-overlay').transition, 'smart-animate',
    'swap-overlay Smart Animate should survive local document persistence');

  assert.throws(() => addPrototypeInteraction(document, source.id, destination.id, {
    action: 'open-overlay', transition: 'smart-animate'
  }), /frame navigation or swap-overlay/);
  assert.throws(() => addPrototypeInteraction(document, source.id, null, {
    action: 'close-overlay', transition: 'smart-animate'
  }), /frame navigation or swap-overlay/);

  const invalid = structuredClone(document);
  invalid.pages[0].children[0].children[0].interactions[0].action = 'open-overlay';
  assert.throws(() => validateDocument(invalid), /Invalid prototype interactions/);
  const invalidSwap = structuredClone(document);
  const persistedSwap = findNode(invalidSwap, source.id).node.interactions.find(item => item.action === 'swap-overlay');
  persistedSwap.action = 'open-overlay';
  assert.throws(() => validateDocument(invalidSwap), /Invalid prototype interactions/,
    'persisted open-overlay Smart Animate should be rejected');
  const invalidClose = structuredClone(document);
  const persistedClose = findNode(invalidClose, source.id).node.interactions.find(item => item.action === 'swap-overlay');
  persistedClose.action = 'close-overlay';
  persistedClose.destinationId = null;
  persistedClose.destinationPageId = null;
  assert.throws(() => validateDocument(invalidClose), /Invalid prototype interactions/,
    'persisted close-overlay Smart Animate should be rejected');
  assert.equal(validateDocument(reloaded), true, 'persisted swap-overlay Smart Animate should pass model validation');
  const invalidEasing = structuredClone(document);
  invalidEasing.pages[0].children[0].children[0].interactions[0].easing = 'bounce';
  assert.throws(() => validateDocument(invalidEasing), /Invalid prototype interactions/);
});

test('prototype transition kinds validate, update, and retain their direction after reload', () => {
  assert.deepEqual(prototypeMoveInOffset('move-left'), { x: 22, y: 0 });
  assert.deepEqual(prototypeMoveInOffset('move-right'), { x: -22, y: 0 });
  assert.deepEqual(prototypeMoveInOffset('move-up'), { x: 0, y: 22 });
  assert.deepEqual(prototypeMoveInOffset('move-down'), { x: 0, y: -22 });
  assert.equal(prototypeMoveInOffset('dissolve'), null);
  assert.throws(() => prototypeMoveInOffset('move-up', -1), /finite non-negative/);

  const document = createDocument();
  const source = createNode('rectangle', { name: 'Open details' });
  const home = createNode('frame', { name: 'Home' });
  home.children.push(source);
  addNode(document, home);
  const transitionKinds = [
    'move-left', 'move-right', 'move-up', 'move-down',
    'move-out-left', 'move-out-right', 'move-out-up', 'move-out-down',
    'push-left', 'push-right', 'push-up', 'push-down',
    'slide-in-left', 'slide-in-right', 'slide-in-up', 'slide-in-down',
    'slide-out-left', 'slide-out-right', 'slide-out-up', 'slide-out-down'
  ];
  const interactions = transitionKinds.map((transition, index) => {
    const target = createNode('frame', { name: `Transition target ${index + 1}` });
    addNode(document, target);
    return addPrototypeInteraction(document, source.id, target.id, { transition });
  });
  assert.deepEqual(interactions.map(item => item.transition), transitionKinds);
  assert.equal(updatePrototypeInteraction(document, source.id, interactions[0].id, interactions[0].destinationId, {
    transition: 'move-out-left'
  }).transition, 'move-out-left', 'editing an interaction should replace its saved transition kind');
  const reloaded = parseDocument(serializeDocument(document));
  assert.deepEqual(findNode(reloaded, source.id).node.interactions.map(item => item.transition), [
    'move-out-left', ...transitionKinds.slice(1)
  ]);
  validateDocument(reloaded);

  const invalid = structuredClone(reloaded);
  findNode(invalid, source.id).node.interactions[0].transition = 'slide-left';
  assert.throws(() => validateDocument(invalid), /Invalid prototype interactions/);
});

test('prototype transitions support and persist the full 10-second duration range', () => {
  const document = createDocument();
  const home = createNode('frame', { name: 'Timed home' });
  const source = createNode('rectangle', { name: 'Open destination' });
  const destination = createNode('frame', { name: 'Long transition' });
  home.children.push(source);
  addNode(document, home);
  addNode(document, destination);
  const interaction = addPrototypeInteraction(document, source.id, destination.id, {
    transition: 'push-left', duration: 10_000
  });
  assert.equal(interaction.duration, 10_000);
  assert.equal(updatePrototypeInteraction(document, source.id, interaction.id, destination.id, {
    transition: 'push-left', duration: 12_000
  }).duration, 10_000, 'programmatic values are clamped to Figma’s documented maximum');
  assert.equal(findNode(parseDocument(serializeDocument(document)), source.id).node.interactions[0].duration, 10_000);

  const invalid = structuredClone(document);
  findNode(invalid, source.id).node.interactions[0].duration = 10_001;
  assert.throws(() => validateDocument(invalid), /Invalid prototype interactions/);
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

test('after-delay routes ignore hidden subtrees and honor presentation visibility modes', () => {
  const document = createDocument();
  const home = createNode('frame', { name: 'Visibility-aware home' });
  const hiddenGroup = createNode('frame', { name: 'Hidden section', visible: false });
  const hiddenTrigger = createNode('rectangle', { name: 'Hidden timed route' });
  const modeTrigger = createNode('rectangle', { name: 'Mode-controlled timed route' });
  const fallbackTrigger = createNode('rectangle', { name: 'Visible timed route' });
  const destination = createNode('frame', { name: 'Destination' });
  hiddenGroup.children.push(hiddenTrigger);
  home.children.push(hiddenGroup, modeTrigger, fallbackTrigger);
  addNode(document, home);
  addNode(document, destination);

  const collection = createVariableCollection(document, 'Presentation');
  const hiddenMode = addVariableMode(document, collection.id, 'Hidden');
  const visibility = createVariable(document, collection.id, 'Show route', 'boolean', true);
  setVariableValue(document, visibility.id, false, hiddenMode.id);
  assert.equal(bindVariable(document, modeTrigger.id, visibility.id, 'visible'), true);
  const hiddenRoute = addPrototypeInteraction(document, hiddenTrigger.id, destination.id, { trigger: 'after-delay', delay: 200 });
  const modeRoute = addPrototypeInteraction(document, modeTrigger.id, destination.id, { trigger: 'after-delay', delay: 300 });
  const visibleRoute = addPrototypeInteraction(document, fallbackTrigger.id, destination.id, { trigger: 'after-delay', delay: 400 });
  const session = createPrototypeSession({ page: document.pages[0], frame: home });

  assert.equal(findPrototypeDelayInteraction(document, document.activePageId, home.id, session).interaction.id, modeRoute.id,
    'an invisible parent suppresses its descendant timer, while a visible mode-bound source remains eligible');
  session.variableModes[collection.id] = hiddenMode.id;
  assert.equal(findPrototypeDelayInteraction(document, document.activePageId, home.id, session).interaction.id, visibleRoute.id,
    'presentation mode overrides must suppress timers on layers that resolve to hidden');
  assert.notEqual(hiddenRoute.id, visibleRoute.id);
});

test('prototype easing curves clamp progress and preserve the legacy smooth default', () => {
  assert.equal(easePrototypeProgress(-1, 'linear'), 0);
  assert.equal(easePrototypeProgress(2, 'linear'), 1);
  assert.equal(easePrototypeProgress(0.5, 'ease-in'), 0.25);
  assert.equal(easePrototypeProgress(0.5, 'ease-out'), 0.75);
  assert.equal(easePrototypeProgress(0.5, 'ease-in-out'), 0.5);
  assert.equal(easePrototypeProgress(0.5), 0.5);
});

test('prototype custom Bézier and spring easings validate and round-trip per interaction', () => {
  const document = createDocument();
  const source = createNode('rectangle', { name: 'Open details' });
  const home = createNode('frame', { name: 'Home' });
  const destination = createNode('frame', { name: 'Details' });
  home.children.push(source);
  addNode(document, home); addNode(document, destination);

  const custom = addPrototypeInteraction(document, source.id, destination.id, {
    transition: 'smart-animate', easing: 'custom-bezier', easingBezier: [0.42, 0, 0.58, 1], duration: 500
  });
  assert.deepEqual(custom.easingBezier, [0.42, 0, 0.58, 1]);
  assert.equal(easePrototypeProgress(0, custom.easing, custom.easingBezier), 0);
  assert.equal(easePrototypeProgress(1, custom.easing, custom.easingBezier), 1);
  assert.equal(easePrototypeProgress(0.5, custom.easing, custom.easingBezier), 0.5);
  assert.equal(prototypeEasingTimingFunction(custom.easing, custom.easingBezier), 'cubic-bezier(0.42, 0, 0.58, 1)');
  assert.equal(findNode(parseDocument(serializeDocument(document)), source.id).node.interactions[0].easingBezier[0], 0.42);

  const updated = updatePrototypeInteraction(document, source.id, custom.id, destination.id, {
    action: 'navigate', trigger: 'on-click', transition: 'smart-animate', easing: 'custom-bezier',
    easingBezier: [0.25, 0.8, 0.25, 1], duration: 650
  });
  assert.equal(updated.id, custom.id);
  assert.deepEqual(updated.easingBezier, [0.25, 0.8, 0.25, 1], 'editing a route should retain its identity and persist its curve');

  const spring = addPrototypeInteraction(document, source.id, destination.id, {
    trigger: 'on-press', transition: 'smart-animate', easing: 'spring-bouncy', duration: 700
  });
  assert.equal(spring.easing, 'spring-bouncy');
  for (const easing of ['spring-gentle', 'spring-quick', 'spring-bouncy', 'spring-slow']) {
    assert.equal(easePrototypeProgress(0, easing), 0);
    assert.ok(Math.abs(easePrototypeProgress(1, easing) - 1) < 1e-9);
    const samples = Array.from({ length: 101 }, (_, index) => easePrototypeProgress(index / 100, easing));
    assert.ok(samples.every(Number.isFinite));
    assert.ok(Math.min(...samples) >= 0 && Math.max(...samples) <= 1.25, 'spring presets should overshoot without extreme jumps');
  }
  assert.ok(easePrototypeProgress(0.4, 'spring-bouncy') > 1, 'the bouncy spring should visibly overshoot the destination');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
  assert.equal(findNode(parseDocument(serializeDocument(document)), source.id).node.interactions[0].easingBezier[1], 0.8);
  assert.throws(() => addPrototypeInteraction(document, source.id, destination.id, {
    easing: 'custom-bezier', easingBezier: [1.2, 0, 0.2, 1]
  }), /Unsupported prototype easing settings/);

  const invalidCurve = structuredClone(document);
  findNode(invalidCurve, source.id).node.interactions[0].easingBezier = [0.42, 3, 0.58, 1];
  assert.throws(() => validateDocument(invalidCurve), /Invalid prototype interactions/);
  const unexpectedCurve = structuredClone(document);
  findNode(unexpectedCurve, source.id).node.interactions[1].easingBezier = [0.25, 0.1, 0.25, 1];
  assert.throws(() => validateDocument(unexpectedCurve), /Invalid prototype interactions/);
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

test('prototype frame hit-testing follows rotated ancestor transforms and frame clipping', () => {
  const document = createDocument();
  const rotated = createNode('frame', {
    name: 'Rotated container', x: 100, y: 100, width: 100, height: 60,
    rotation: 90, clip: false
  });
  const overflow = createNode('frame', {
    name: 'Overflow destination', x: 40, y: 65, width: 20, height: 20
  });
  rotated.children.push(overflow);
  addNode(document, rotated);

  assert.equal(findFrameAtPoint(document.pages[0], { x: 105, y: 130 }).id, overflow.id,
    'an unclipped child should be hit at its transformed page-space center');
  assert.equal(findFrameAtPoint(document.pages[0], { x: 150, y: 130 }).id, rotated.id,
    'the rotated parent should be hit at its own center');

  rotated.clip = true;
  assert.equal(findFrameAtPoint(document.pages[0], { x: 105, y: 130 }), null,
    'a point in the parent’s old axis-aligned box but outside its rotated clip must hit no frame');
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
    backgroundOpacity: 0.45,
    transition: 'instant',
    easing: 'ease-in-out',
    duration: 300
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
    transition: 'move-in-left', easing: 'ease-out', duration: 600,
    action: 'open-overlay', overlayPosition: 'bottom-right', overlayOutsideClick: false,
    overlayBackground: true, overlayBackgroundColor: '#abcdef', overlayBackgroundOpacity: 0.6
  });
  const swap = addPrototypeInteraction(document, swapButton.id, details.id, {
    action: 'swap-overlay', transition: 'smart-animate', easing: 'ease-out', duration: 500
  });
  const session = createPrototypeSession({ page: document.pages[0], frame: home });
  applyPrototypeInteraction(document, session, open);
  const before = structuredClone(session.overlays[0]);
  assert.equal(before.transition, 'move-in-left');
  assert.equal(before.easing, 'ease-out');
  assert.equal(before.duration, 600);
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

test('prototype set-variable actions evaluate bounded expressions in presentation state only', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Prototype state');
  const count = createVariable(document, collection.id, 'count value', 'number', 4);
  const result = createVariable(document, collection.id, 'result', 'number', 0);
  const label = createVariable(document, collection.id, 'label', 'string', 'Hello');
  const home = createNode('frame', { name: 'Home' });
  const trigger = createNode('rectangle', { name: 'Increase' });
  home.children.push(trigger);
  addNode(document, home);

  const interaction = addPrototypeInteraction(document, trigger.id, null, {
    action: 'set-variable', variableId: result.id, valueExpression: 'count_value * 2 + 1'
  });
  const literal = addPrototypeInteraction(document, trigger.id, null, {
    action: 'set-variable', trigger: 'on-drag', variableId: result.id, value: 2
  });
  const replacedLiteral = updatePrototypeInteraction(document, trigger.id, literal.id, null, {
    action: 'set-variable', trigger: 'on-drag', variableId: result.id, valueExpression: 'count_value + 3'
  });
  const labelInteraction = addPrototypeInteraction(document, trigger.id, null, {
    action: 'set-variable', trigger: 'on-press', variableId: label.id, valueExpression: 'label + "!"'
  });
  assert.equal(interaction.valueExpression, 'count_value * 2 + 1');
  assert.equal(Object.hasOwn(interaction, 'value'), false);
  assert.equal(replacedLiteral.id, literal.id);
  assert.equal(replacedLiteral.valueExpression, 'count_value + 3');
  assert.equal(Object.hasOwn(replacedLiteral, 'value'), false, 'switching from literal to expression removes the old stored literal');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const runtimeDocument = structuredClone(document);
  const session = createPrototypeSession({ page: runtimeDocument.pages[0], frame: runtimeDocument.pages[0].children[0] });
  const runtimeTrigger = findNode(runtimeDocument, trigger.id).node;
  const runtimeInteraction = runtimeTrigger.interactions.find(item => item.id === interaction.id);
  const runtimeLabelInteraction = runtimeTrigger.interactions.find(item => item.id === labelInteraction.id);
  assert.equal(applyPrototypeInteraction(runtimeDocument, session, runtimeInteraction), 'variables-updated');
  assert.equal(resolveVariableValue(runtimeDocument, result.id), 9);
  assert.equal(resolveVariableValue(document, result.id), 0, 'presentation actions do not change the saved design');
  assert.equal(applyPrototypeInteraction(runtimeDocument, session, runtimeLabelInteraction), 'variables-updated');
  assert.equal(resolveVariableValue(runtimeDocument, label.id), 'Hello!');
  assert.equal(resolveVariableValue(document, label.id), 'Hello');

  assert.throws(() => addPrototypeInteraction(document, trigger.id, null, {
    action: 'set-variable', variableId: result.id, valueExpression: 'label + 1'
  }), /Invalid variable expression/);
  assert.throws(() => addPrototypeInteraction(document, trigger.id, null, {
    action: 'set-variable', variableId: label.id, value: 'Hello', valueExpression: 'label + "!"'
  }), /bounded expression/);
  assert.equal(count.valuesByMode[collection.defaultModeId], 4);

  const invalid = structuredClone(document);
  findNode(invalid, trigger.id).node.interactions[0].valueExpression = 'unknown + 1';
  assert.throws(() => validateDocument(invalid), /Invalid prototype interactions/);
});

test('prototype expressions exclude ambiguous aliases produced by similar variable names', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Alias test');
  const target = createVariable(document, collection.id, 'total', 'number', 0);
  createVariable(document, collection.id, 'Card width', 'number', 20);
  createVariable(document, collection.id, 'Card_width', 'number', 24);
  const frame = createNode('frame', { name: 'Frame' });
  const trigger = createNode('rectangle');
  frame.children.push(trigger);
  addNode(document, frame);

  assert.equal(listPrototypeExpressionVariables(document).some(item => item.alias === 'Card_width'), false);
  assert.throws(() => addPrototypeInteraction(document, trigger.id, null, {
    action: 'set-variable', variableId: target.id, valueExpression: 'Card_width + 1'
  }), /Unknown variable/);
});

test('deleting a variable removes actions that depend on its expression alias without matching string literals', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Dependency test');
  const input = createVariable(document, collection.id, 'input value', 'number', 2);
  const total = createVariable(document, collection.id, 'total', 'number', 0);
  const label = createVariable(document, collection.id, 'label', 'string', '');
  const frame = createNode('frame', { name: 'Frame' });
  const trigger = createNode('rectangle');
  frame.children.push(trigger);
  addNode(document, frame);
  addPrototypeInteraction(document, trigger.id, null, {
    action: 'set-variable', variableId: total.id, valueExpression: 'input_value + 1'
  });
  const literalText = addPrototypeInteraction(document, trigger.id, null, {
    action: 'set-variable', trigger: 'on-press', variableId: label.id, valueExpression: '"input_value"'
  });

  assert.equal(deleteVariable(document, input.id), true);
  assert.deepEqual(findNode(document, trigger.id).node.interactions.map(item => item.id), [literalText.id]);
  assert.equal(validateDocument(document), true);
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

test('numeric prototype conditions support strict relational operators across variable modes and persistence', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Numeric routes');
  const highMode = addVariableMode(document, collection.id, 'High');
  const score = createVariable(document, collection.id, 'Score', 'number', 10);
  score.valuesByMode[highMode.id] = 20;

  const home = createNode('frame', { name: 'Home' });
  addNode(document, home);
  const operators = [
    ['greater-than', false, true],
    ['greater-than-or-equal', true, true],
    ['less-than', false, false],
    ['less-than-or-equal', true, false]
  ];
  const sources = new Map();
  for (const [operator] of operators) {
    const source = createNode('rectangle', { name: `${operator} route` });
    const destination = createNode('frame', { name: `${operator} destination` });
    home.children.push(source);
    addNode(document, destination);
    const interaction = addPrototypeInteraction(document, source.id, destination.id, {
      condition: { variableId: score.id, type: 'number', operator, value: 10 }
    });
    sources.set(operator, { source, interaction });
  }

  const session = createPrototypeSession({ page: document.pages[0], frame: home });
  for (const [operator, matchesAtBase] of operators) {
    const { source, interaction } = sources.get(operator);
    assert.equal(findClickableInteraction(document, document.activePageId, source.id, 'on-click', session)?.interaction.id,
      matchesAtBase ? interaction.id : undefined,
      `${operator} should compare the exact default value without coercion`);
  }

  session.variableModes[collection.id] = highMode.id;
  for (const [operator, , matchesAtHigh] of operators) {
    const { source, interaction } = sources.get(operator);
    assert.equal(findClickableInteraction(document, document.activePageId, source.id, 'on-click', session)?.interaction.id,
      matchesAtHigh ? interaction.id : undefined,
      `${operator} should evaluate the selected mode's resolved numeric value`);
  }

  const reloaded = parseDocument(serializeDocument(document));
  for (const [operator] of operators) {
    const { source, interaction } = sources.get(operator);
    const restored = findNode(reloaded, source.id).node.interactions[0];
    assert.equal(restored.id, interaction.id);
    assert.deepEqual(restored.condition, { variableId: score.id, type: 'number', operator, value: 10 },
      `${operator} should round-trip with a numeric operand`);
  }
  assert.equal(validateDocument(reloaded), true);

  const nonNumeric = createVariable(document, collection.id, 'Enabled', 'boolean', true);
  const validRoute = sources.get('greater-than');
  assert.throws(() => addPrototypeInteraction(document, validRoute.source.id, validRoute.interaction.destinationId, {
    condition: { variableId: nonNumeric.id, type: 'boolean', operator: 'greater-than', value: true }
  }), /Invalid prototype interaction condition/,
  'relational operators are only valid for numeric variables');

  for (const value of ['10', NaN, Infinity]) {
    assert.throws(() => addPrototypeInteraction(document, validRoute.source.id, validRoute.interaction.destinationId, {
      condition: { variableId: score.id, type: 'number', operator: 'greater-than', value }
    }), /Invalid prototype interaction condition/,
    'relational operands must be finite numbers, without string coercion');
  }
  const invalidPersisted = structuredClone(document);
  findNode(invalidPersisted, home.children[0].id).node.interactions[0].condition = {
    variableId: nonNumeric.id, type: 'boolean', operator: 'less-than-or-equal', value: true
  };
  assert.throws(() => validateDocument(invalidPersisted), /Invalid prototype interactions/,
    'document validation must reject persisted nonnumeric relational conditions');
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
    { ...interaction.condition, operator: 'greater-than' },
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
